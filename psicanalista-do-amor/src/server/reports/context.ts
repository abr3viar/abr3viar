import "server-only";
import { seriousSafetyConcerns } from "./guards";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getEnv } from "@/env";
import { getAiClient, estimateTokens } from "@/server/ai/client";
import {
  PROMPT_VERSION as CHUNK_PROMPT_VERSION,
  chunkSummarySystemPrompt,
  notesMergeSystemPrompt,
} from "@/server/ai/prompts/chunk-summary";
import { chunkNotesSchema, type ChunkNotes } from "@/server/ai/schemas";
import { decryptField, decryptJson, decryptNullable, encryptJson } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { conversationDigests, conversations, messages, type Conversation } from "@/server/db/schema";
import { zonedParts } from "@/server/ingest/time";
import { SafeError } from "@/server/log";
import {
  computePeriodStats,
  computeStats,
  formatPeriodStatsForPrompt,
  formatStatsForPrompt,
  type ConversationStats,
} from "./stats";

/** Mensagem pronta para a IA (já decifrada; vive só na memória do worker). */
export type AiMessage = {
  seq: number;
  sender: "a" | "b";
  sentAt: Date | null;
  kind: "text" | "media_omitted" | "deleted" | "sticker" | "audio" | "system";
  content: string;
};

export type LoadedConversation = {
  conversation: Conversation;
  names: { a: string; b: string };
  userIs: "a" | "b" | "none";
  messages: AiMessage[];
  stats: ConversationStats;
};

export const SILENCE_SPLIT_HOURS = 6;
/** Abaixo disso a conversa é uma AMOSTRA curta: padrões viram hipóteses (IA-11). */
export const SHORT_SAMPLE_MESSAGES = 40;
/** Conversas que passam disso levam o ano no horário de cada mensagem (dd/mm/aa). */
export const YEAR_IN_TIMESTAMP_AFTER_DAYS = 300;
export const LAST_MESSAGES_LITERAL = 150;
const CHUNK_OVERLAP = 20;

const KIND_LABEL: Record<AiMessage["kind"], string> = {
  text: "",
  media_omitted: "[mídia]",
  deleted: "[mensagem apagada]",
  sticker: "[figurinha]",
  audio: "[áudio]",
  system: "[sistema]",
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Proteção contra injeção (IA-12): o conteúdo não pode abrir/fechar os delimitadores
 * do prompt. `</conversa>` dentro de uma mensagem vira `‹/conversa>`.
 */
export function neutralizeDelimiters(text: string): string {
  // NFKC transforma "＜" em "<"; caracteres invisíveis (largura zero) no meio da tag saem.
  const t = text.normalize("NFKC").replace(/[\u200B-\u200F\u2060\uFEFF]/g, "");
  // `(?:\/\s*)?` em vez de `\/?\s*`: dois `\s*` vizinhos dão custo quadrático (ReDoS, S-01).
  return t.replace(/<(?=\s*(?:\/\s*)?(?:conversa|notas)\b)/giu, "‹");
}

/**
 * Nome de participante seguro para o prompt: sem quebras de linha nem caracteres de
 * controle (que poderiam criar linhas falsas como "- B = ..."), sem "<" e curto.
 */
export function sanitizeName(name: string, fallback: string): string {
  const clean = name
    .replace(/[\p{Cc}\u2028\u2029]+/gu, " ")
    .replace(/</g, "‹")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  return clean || fallback;
}

/** `#812 [12/10 23:41] A: você sumiu hoje` (plano.md 5.3); com `withYear`, `[12/10/25 23:41]`. */
export function formatMessageLine(m: AiMessage, timeZone: string, withTime: boolean, withYear = false): string {
  let ts = "";
  if (withTime && m.sentAt) {
    const p = zonedParts(m.sentAt, timeZone);
    const year = withYear ? `/${pad(p.year % 100)}` : "";
    ts = ` [${pad(p.day)}/${pad(p.month)}${year} ${pad(p.hour)}:${pad(p.minute)}]`;
  }
  const body = m.kind === "text" ? neutralizeDelimiters(m.content.replace(/\r?\n/g, " / ")) : KIND_LABEL[m.kind];
  return `#${m.seq}${ts} ${m.sender.toUpperCase()}: ${body}`;
}

export function formatMessages(msgs: AiMessage[], timeZone: string, withTime: boolean, withYear = false): string {
  return msgs.map((m) => formatMessageLine(m, timeZone, withTime, withYear)).join("\n");
}

/** Conversa longa no calendário (> 300 dias): o dia/mês sozinho fica ambíguo. */
export function needsYear(stats: ConversationStats): boolean {
  return (stats.periodDays ?? 0) > YEAR_IN_TIMESTAMP_AFTER_DAYS;
}

/**
 * Divide em blocos de ~`chunkTokens`, preferindo cortar em silêncios > 6 h, com
 * sobreposição de 20 mensagens entre blocos (plano.md 5.3).
 */
export function splitIntoChunks(
  msgs: AiMessage[],
  timeZone: string,
  withTime: boolean,
  chunkTokens: number,
  withYear = false,
): AiMessage[][] {
  const chunks: AiMessage[][] = [];
  let start = 0;
  while (start < msgs.length) {
    let tokens = 0;
    let end = start;
    let lastSilenceCut = -1;
    while (end < msgs.length) {
      const t = estimateTokens(formatMessageLine(msgs[end]!, timeZone, withTime, withYear)) + 1;
      if (tokens + t > chunkTokens && end > start) break;
      tokens += t;
      const prev = msgs[end - 1];
      const cur = msgs[end]!;
      if (end > start && prev?.sentAt && cur.sentAt) {
        const gapH = (cur.sentAt.getTime() - prev.sentAt.getTime()) / 3_600_000;
        if (gapH > SILENCE_SPLIT_HOURS && tokens > chunkTokens * 0.6) lastSilenceCut = end;
      }
      end++;
    }
    if (end < msgs.length && lastSilenceCut > start) end = lastSilenceCut;
    chunks.push(msgs.slice(start, end));
    if (end >= msgs.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}

/** Carrega e decifra a conversa confirmada (só A e B; sistema e terceiros ficam de fora). */
export async function loadConversationForAi(conversationId: string): Promise<LoadedConversation> {
  const db = getDb();
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conversation) throw new SafeError("conversation_not_found");
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), inArray(messages.sender, ["a", "b"])))
    .orderBy(asc(messages.seq));
  const msgs: AiMessage[] = rows.map((r) => ({
    seq: r.seq,
    sender: r.sender as "a" | "b",
    sentAt: r.sentAt,
    kind: r.kind,
    content: decryptField(r.content),
  }));
  if (msgs.length === 0) throw new SafeError("no_messages");
  const names = {
    a: sanitizeName(decryptNullable(conversation.participantAName) ?? "", "Pessoa A"),
    b: sanitizeName(decryptNullable(conversation.participantBName) ?? "", "Pessoa B"),
  };
  const stats = computeStats(msgs, { timeZone: conversation.timezone, hasTimestamps: conversation.hasTimestamps });
  return { conversation, names, userIs: conversation.userIs, messages: msgs, stats };
}

export function contextHeader(loaded: LoadedConversation): string {
  const { userIs, stats } = loaded;
  const names = { a: sanitizeName(loaded.names.a, "Pessoa A"), b: sanitizeName(loaded.names.b, "Pessoa B") };
  const tz = loaded.conversation.timezone;
  const who =
    userIs === "a"
      ? `O usuário (quem enviou a conversa) é A (${names.a}).`
      : userIs === "b"
        ? `O usuário (quem enviou a conversa) é B (${names.b}).`
        : "Não sabemos qual das duas pessoas enviou a conversa: fale das duas pelo nome.";
  return `PARTICIPANTES
- A = ${names.a}
- B = ${names.b}
${who}
${
  stats.analyzedMessages < SHORT_SAMPLE_MESSAGES
    ? `\nAMOSTRA CURTA: só ${stats.analyzedMessages} mensagens. Trate qualquer padrão como hipótese ("nesse trecho", "por enquanto"), sem afirmar tendências, evolução ou "sempre/nunca".\n`
    : ""
}
ESTATÍSTICAS (fatos calculados pelo sistema — use só estes números)
${formatStatsForPrompt(stats, names, { timeZone: tz })}${periodBlock(loaded, names)}`;
}

function periodBlock(loaded: LoadedConversation, names: { a: string; b: string }): string {
  const period = computePeriodStats(loaded.messages, {
    timeZone: loaded.conversation.timezone,
    hasTimestamps: loaded.conversation.hasTimestamps,
  });
  if (!period) return "";
  return `

ESTATÍSTICAS POR PERÍODO (primeiro × último terço da conversa, calculadas pelo sistema — para comparar começo e fim, use só estes números)
${formatPeriodStatsForPrompt(period, names, { timeZone: loaded.conversation.timezone })}`;
}

/** Notas do map como texto (com delimitadores neutralizados: as citações vêm da conversa). */
export function formatNotes(notes: ChunkNotes[]): string {
  return neutralizeDelimiters(notes
    .map((n, i) => {
      const lines = [`[Nota ${i + 1}] Período: ${n.period || "n/d"}`];
      if (n.themes.length) lines.push(`Temas: ${n.themes.join("; ")}`);
      if (n.a_behaviors.length) lines.push(`A: ${n.a_behaviors.join("; ")}`);
      if (n.b_behaviors.length) lines.push(`B: ${n.b_behaviors.join("; ")}`);
      if (n.conflicts.length) lines.push(`Conflitos: ${n.conflicts.join("; ")}`);
      if (n.affection.length) lines.push(`Afeto: ${n.affection.join("; ")}`);
      if (n.tone_shifts.length) lines.push(`Mudanças de tom: ${n.tone_shifts.join("; ")}`);
      if (n.safety_concerns.length) lines.push(`Possíveis riscos: ${n.safety_concerns.join("; ")}`);
      for (const m of n.moments) lines.push(`- #${m.seq} "${m.quote.replace(/\s+/g, " ")}" — ${m.why}`);
      return lines.join("\n");
    })
    .join("\n\n"));
}

export type AnalysisContext = {
  text: string;
  mode: "direct" | "mapreduce";
  /** Alguma nota do map (nível 0) registrou sinal de risco: liga o alerta mesmo se a IA esquecer. */
  safetyConcerns: boolean;
  tokensIn: number;
  tokensOut: number;
};

/**
 * Monta o contexto da análise: conversa inteira (se couber) ou notas do map +
 * últimas 150 mensagens literais (plano.md 5.3). As notas ficam cifradas em
 * `conversation_digests` e são reaproveitadas pelos relatórios adicionais.
 */
export async function buildAnalysisContext(
  loaded: LoadedConversation,
  onProgress?: (current: number, total: number) => Promise<void>,
): Promise<AnalysisContext> {
  const env = getEnv();
  const tz = loaded.conversation.timezone;
  const withTime = loaded.conversation.hasTimestamps;
  const withYear = needsYear(loaded.stats);
  const header = contextHeader(loaded);
  const full = formatMessages(loaded.messages, tz, withTime, withYear);
  if (estimateTokens(full) <= env.REPORT_DIRECT_MAX_TOKENS) {
    return { text: `${header}\n\n<conversa>\n${full}\n</conversa>`, mode: "direct", safetyConcerns: false, tokensIn: 0, tokensOut: 0 };
  }

  const chunks = splitIntoChunks(loaded.messages, tz, withTime, env.CHUNK_TOKENS, withYear);
  const db = getDb();
  const cached = await db
    .select()
    .from(conversationDigests)
    .where(
      and(
        eq(conversationDigests.conversationId, loaded.conversation.id),
        eq(conversationDigests.level, 0),
        eq(conversationDigests.promptVersion, CHUNK_PROMPT_VERSION),
      ),
    );
  const cacheByIndex = new Map(cached.map((c) => [c.chunkIndex, c]));
  const ai = getAiClient();
  let tokensIn = 0;
  let tokensOut = 0;
  const notes: ChunkNotes[] = [];

  for (const [i, chunk] of chunks.entries()) {
    await onProgress?.(i + 1, chunks.length);
    const fromSeq = chunk[0]!.seq;
    const toSeq = chunk[chunk.length - 1]!.seq;
    const hit = cacheByIndex.get(i);
    if (hit && hit.fromSeq === fromSeq && hit.toSeq === toSeq) {
      notes.push(chunkNotesSchema.parse(decryptJson(hit.content)));
      continue;
    }
    const res = await ai.callJson({
      purpose: "summary",
      label: "chunk_summary",
      schema: chunkNotesSchema,
      maxCompletionTokens: 2500,
      temperature: 0.3,
      reasoningEffort: "low",
      messages: [
        { role: "system", content: chunkSummarySystemPrompt() },
        {
          role: "user",
          content: `Trecho ${i + 1} de ${chunks.length}.\n\n<conversa>\n${formatMessages(chunk, tz, withTime, withYear)}\n</conversa>`,
        },
      ],
    });
    tokensIn += res.tokensIn;
    tokensOut += res.tokensOut;
    notes.push(res.data);
    await db
      .insert(conversationDigests)
      .values({
        conversationId: loaded.conversation.id,
        chunkIndex: i,
        level: 0,
        promptVersion: CHUNK_PROMPT_VERSION,
        fromSeq,
        toSeq,
        content: encryptJson(res.data),
      })
      .onConflictDoUpdate({
        target: [
          conversationDigests.conversationId,
          conversationDigests.level,
          conversationDigests.chunkIndex,
          conversationDigests.promptVersion,
        ],
        set: { fromSeq, toSeq, content: encryptJson(res.data) },
      });
  }

  // Resumo hierárquico se as notas também não couberem.
  let current = notes;
  let level = 1;
  const budget = Math.floor(env.REPORT_DIRECT_MAX_TOKENS * 0.6);
  while (estimateTokens(formatNotes(current)) > budget && current.length > 1 && level <= 4) {
    const groups: ChunkNotes[][] = [];
    for (let i = 0; i < current.length; i += 4) groups.push(current.slice(i, i + 4));
    const merged: ChunkNotes[] = [];
    for (const group of groups) {
      if (group.length === 1) {
        merged.push(group[0]!);
        continue;
      }
      const res = await ai.callJson({
        purpose: "summary",
        label: "notes_merge",
        schema: chunkNotesSchema,
        maxCompletionTokens: 2500,
        temperature: 0.3,
        reasoningEffort: "low",
        messages: [
          { role: "system", content: notesMergeSystemPrompt() },
          { role: "user", content: `<notas>\n${formatNotes(group)}\n</notas>` },
        ],
      });
      tokensIn += res.tokensIn;
      tokensOut += res.tokensOut;
      merged.push(res.data);
    }
    current = merged;
    level++;
  }

  const tail = loaded.messages.slice(-LAST_MESSAGES_LITERAL);
  const text = `${header}

A conversa é longa (${loaded.messages.length} mensagens). Abaixo: NOTAS cronológicas de cada trecho (com citações e seq) e as ÚLTIMAS ${tail.length} mensagens literais (o fim importa mais para entender "como está agora").

<notas>
${formatNotes(current)}
</notas>

<conversa>
${formatMessages(tail, tz, withTime, withYear)}
</conversa>`;
  const safetyConcerns = seriousSafetyConcerns(notes.flatMap((n) => n.safety_concerns));
  return { text, mode: "mapreduce", safetyConcerns, tokensIn, tokensOut };
}
