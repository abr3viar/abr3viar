import "server-only";
import { eq } from "drizzle-orm";
import { encryptField, encryptJson } from "@/server/crypto";
import type { Tx } from "@/server/db/client";
import { reportSections } from "@/server/db/schema";
import type { Evidence } from "@/lib/views";

export type SectionToSave = {
  key: string;
  title: string;
  lockedTitle: string;
  content: string;
  evidence: Evidence[];
  isSafety: boolean;
};

export const SAFETY_SECTION_KEY = "alerta";

export const DEFAULT_SAFETY_CONTENT = `A conversa tem trechos que podem indicar uma situação de risco ou sofrimento. Esta é uma leitura automática e pode estar errada, mas, se algo aqui fez sentido para você, **você não precisa lidar com isso sozinho(a)**.

- **Ligue 180** — Central de Atendimento à Mulher (violência contra a mulher), 24 h, gratuito.
- **CVV 188** — apoio emocional e prevenção do suicídio, 24 h, gratuito (também em cvv.org.br).
- **190** — Polícia Militar, em caso de perigo imediato.
- **Disque 100** — Direitos Humanos, se a situação envolver criança ou adolescente, 24 h, gratuito.

Se puder, converse com alguém de confiança.`;

/** Texto da IA para o alerta + os contatos padrão que ela não citou (180, 188, 190, Disque 100). */
export function safetyContent(aiText: string): string {
  const t = aiText.trim();
  const has = (re: RegExp) => re.test(t);
  if (has(/\b180\b/) && has(/\b188\b/) && has(/\b190\b/) && has(/disque\s*100/i)) return t;
  return `${t}\n\n${DEFAULT_SAFETY_CONTENT}`;
}

/**
 * `is_free` é decidido pelo SERVIDOR, nunca pela IA (plano.md 7.5):
 * - relatório principal: as primeiras ceil(n/2) seções regulares (4 de 8) são grátis;
 * - seção de alerta de risco (safety) é SEMPRE grátis (D19);
 * - adicionais: nada é grátis (são gerados só depois do pagamento), exceto o alerta.
 */
export function computeFreeFlags(sections: Pick<SectionToSave, "isSafety">[], kind: "main" | "extra"): boolean[] {
  const regularCount = sections.filter((s) => !s.isSafety).length;
  const freeRegular = kind === "main" ? Math.ceil(regularCount / 2) : 0;
  let seenRegular = 0;
  return sections.map((s) => {
    if (s.isSafety) return true;
    seenRegular += 1;
    return seenRegular <= freeRegular;
  });
}

export type CitableMessage = { sender: string; content: string };

/** Mensagens de TEXTO por seq, com o remetente (mídias, áudios etc. não podem ser citados). */
export function textMessagesBySeq(messages: { seq: number; kind: string; content: string; sender?: string }[]): Map<number, CitableMessage> {
  return new Map(
    messages
      .filter((m) => m.kind === "text" && m.content.trim() !== "")
      .map((m) => [m.seq, { sender: m.sender ?? "", content: m.content }]),
  );
}

const QUOTE_MAX = 140;

const clip = (s: string) => (s.length > QUOTE_MAX ? `${s.slice(0, QUOTE_MAX - 1)}…` : s);

/** Para comparar citação × mensagem: caixa, acentos de composição, aspas e pontuação viram espaço. */
function normalizeForMatch(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * A citação (com "…" para trechos omitidos) aparece de fato na mensagem, como PALAVRAS
 * inteiras ("sim" não casa com "assim")? Cada trecho precisa ter 2+ palavras ou 8+ letras.
 */
export function quoteMatches(quote: string, message: string): boolean {
  const msg = ` ${normalizeForMatch(message)} `;
  const parts = quote
    // `[\s.]*` (um só quantificador) em vez de `\s*\.*\s*`: sem custo quadrático (ReDoS, S-01).
    .split(/…|\.{3,}|\[[\s.]*\]/)
    .map(normalizeForMatch)
    .filter((p) => p !== "");
  if (parts.length === 0) return false;
  const total = parts.join(" ");
  if (total.split(" ").length < 2 && total.length < 8) return false;
  return parts.every((p) => msg.includes(` ${p} `));
}

/**
 * Confere as citações contra a mensagem REAL (IA-9): só mensagens de texto; mantém a
 * citação se ela está na mensagem; se a IA errou o seq por pouco (±3), corrige para a
 * mensagem vizinha DO MESMO REMETENTE; senão, descarta (nunca troca por outro texto, que
 * não sustentaria a afirmação). Sem repetir mensagem e no máximo 3 por seção.
 */
export function sanitizeEvidence(evidence: Evidence[], messages: Map<number, CitableMessage>): Evidence[] {
  const seen = new Set<number>();
  const out: Evidence[] = [];
  for (const e of evidence) {
    const quote = e.quote.replace(/\s+/g, " ").trim();
    const real = messages.get(e.seq);
    if (!quote || real === undefined) continue;
    let seq: number | null = null;
    if (quoteMatches(quote, real.content)) seq = e.seq;
    else {
      for (const d of [1, -1, 2, -2, 3, -3]) {
        const near = messages.get(e.seq + d);
        if (near !== undefined && near.sender === real.sender && !seen.has(e.seq + d) && quoteMatches(quote, near.content)) {
          seq = e.seq + d;
          break;
        }
      }
    }
    if (seq === null || seen.has(seq)) continue;
    seen.add(seq);
    out.push({ seq, quote: clip(quote) });
    if (out.length === 3) break;
  }
  return out;
}

/** Substitui as seções do relatório (cifradas). Retorna quantas regulares são grátis. */
export async function replaceSections(
  tx: Tx,
  reportId: string,
  sections: SectionToSave[],
  kind: "main" | "extra",
): Promise<number> {
  const free = computeFreeFlags(sections, kind);
  await tx.delete(reportSections).where(eq(reportSections.reportId, reportId));
  if (sections.length) {
    await tx.insert(reportSections).values(
      sections.map((s, i) => ({
        reportId,
        position: i + 1,
        key: s.key,
        title: encryptField(s.title),
        // Cifrado (regra crítica 6): pode vir da IA e citar o conteúdo.
        lockedTitle: encryptField(s.lockedTitle),
        content: encryptField(s.content),
        isFree: free[i]!,
        isSafety: s.isSafety,
        evidence: encryptJson(s.evidence),
      })),
    );
  }
  return sections.filter((s, i) => free[i] && !s.isSafety).length;
}
