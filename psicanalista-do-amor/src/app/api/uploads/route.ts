import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { getEnv } from "@/env";
import { LEGAL_VERSION } from "@/lib/copy";
import { createSession, findOrCreateUser, getViewer, normalizeEmail } from "@/server/auth/session";
import { encryptField, pepperedHash } from "@/server/crypto";
import { getDb } from "@/server/db/client";
import { consents, conversationFiles, conversations, funnelEvents } from "@/server/db/schema";
import { getClientIp, getUserAgent, isSameOrigin, jsonError, noStoreHeaders, readBodyLimited, BodyTimeoutError } from "@/server/http";
import { detectFileKind } from "@/server/ingest/detect";
import { IngestError } from "@/server/ingest/types";
import { enqueue } from "@/server/jobs/boss";
import { sendAlert } from "@/server/alerts";
import { log, safeErr } from "@/server/log";
import { consumeGlobalUploadSlot, consumeRateLimit, isRateLimited } from "@/server/rate-limit";
import { putEncrypted, uploadPrefix } from "@/server/storage";
import { recordAccess } from "@/server/access-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const fieldsSchema = z.object({
  mode: z.enum(["paste", "txt", "zip", "images"]),
  email: z.email().max(254),
  consent_terms: z.literal("on"),
  consent_adult: z.literal("on"),
  timezone: z.string().max(64).optional(),
});

type StoredFile = { buf: Buffer; mime: string; name: string };

/**
 * Recebe a conversa (texto colado, .txt, .zip ou prints), valida, guarda os originais
 * CIFRADOS no storage (temporários) e enfileira a ingestão. Nunca loga conteúdo.
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError("forbidden", 403);
  const env = getEnv();
  // Rate limit por IP ANTES de ler o corpo (envios de até 25 MB).
  const ip = await getClientIp();
  // IP e faixa de rede (/24, /48): poucos IPs não esgotam o teto global do site.
  if (!(await consumeRateLimit("upload", [`ip:${ip}`, `net:${ip}`]))) return jsonError("rate_limited", 429);

  // Corpo lido com contador de bytes reais (nada de carregar GBs na memória).
  let body: Buffer | null;
  try {
    body = await readBodyLimited(req, env.UPLOAD_MAX_BYTES + 1_048_576);
  } catch (err) {
    if (err instanceof BodyTimeoutError) return jsonError("upload_timeout", 408);
    throw err;
  }
  if (!body) return jsonError("too_large", 413);
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength), { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return jsonError("invalid_form", 400);
  }
  const parsed = fieldsSchema.safeParse({
    mode: form.get("mode"),
    email: typeof form.get("email") === "string" ? String(form.get("email")).trim() : undefined,
    consent_terms: form.get("consent_terms"),
    consent_adult: form.get("consent_adult"),
    timezone: form.get("timezone") ?? undefined,
  });
  if (!parsed.success) {
    const consentMissing = parsed.error.issues.some((i) => String(i.path[0]).startsWith("consent_"));
    return jsonError(consentMissing ? "consent_required" : "invalid_fields", 400);
  }
  const { mode } = parsed.data;
  const email = normalizeEmail(parsed.data.email);

  // ---------------------------------------------------------------- arquivos
  const files: StoredFile[] = [];
  try {
    if (mode === "paste") {
      const text = form.get("text");
      if (typeof text !== "string" || !text.trim()) return jsonError("empty_input", 400);
      if (text.length > env.PASTE_MAX_CHARS) return jsonError("text_too_long", 413);
      files.push({ buf: Buffer.from(text, "utf8"), mime: "text/plain", name: "texto-colado.txt" });
    } else {
      const entries = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
      if (entries.length === 0) return jsonError("no_files", 400);
      if (mode !== "images" && entries.length > 1) return jsonError("too_many_files", 400);
      if (mode === "images" && entries.length > env.MAX_IMAGES) return jsonError("too_many_images", 400);
      let total = 0;
      for (const f of entries) {
        total += f.size;
        if (total > env.UPLOAD_MAX_BYTES) return jsonError("too_large", 413);
        if (mode === "images" && f.size > env.MAX_IMAGE_BYTES) return jsonError("image_too_large", 413);
        const buf = Buffer.from(await f.arrayBuffer());
        const detected = await detectFileKind(buf);
        const expected = mode === "txt" ? "text" : mode === "zip" ? "zip" : "image";
        if (detected.kind !== expected) return jsonError("unsupported_file_type", 415);
        files.push({ buf, mime: detected.mime, name: f.name.slice(0, 255) });
      }
    }
  } catch (err) {
    if (err instanceof IngestError) return jsonError(err.code, 415);
    log.warn({ err: safeErr(err) }, "upload_read_failed");
    return jsonError("invalid_form", 400);
  }

  // Limites por e-mail e global só para envios VÁLIDOS (que vão ser guardados): errar de aba
  // não bloqueia a pessoa por 1 h nem gasta o teto do site inteiro (QA-02).
  // E-mail que já estourou não gasta vaga do teto global; e, com o site cheio, a pessoa não
  // perde a vaga dela (o limite por e-mail só é consumido depois do teto).
  if (await isRateLimited("upload", [`email:${email}`])) return jsonError("rate_limited", 429);
  if (!(await consumeGlobalUploadSlot(env.UPLOAD_GLOBAL_MAX_PER_HOUR))) {
    log.warn({ code: "upload_global_limit" }, "upload_global_limit");
    await sendAlert("teto_global_de_envios", { limite: env.UPLOAD_GLOBAL_MAX_PER_HOUR });
    return jsonError("busy", 503);
  }
  if (!(await consumeRateLimit("upload", [`email:${email}`]))) {
    return jsonError("rate_limited", 429);
  }

  // ---------------------------------------------------------------- usuário e sessão (D4, D26)
  const viewer = await getViewer();
  let userId: string;
  let sessionId: string;
  if (viewer && viewer.email === email) {
    userId = viewer.userId;
    sessionId = viewer.sessionId;
  } else {
    const user = await findOrCreateUser(email);
    userId = user.id;
    sessionId = (await createSession(user.id, { verified: false, userAgent: await getUserAgent() })).sessionId;
  }

  // ---------------------------------------------------------------- persistência
  const conversationId = uuidv7();
  const sourceType = mode === "zip" ? "zip_images" : mode;
  const prefix = uploadPrefix(conversationId);
  try {
    const stored = [] as { key: string; f: StoredFile; index: number }[];
    for (const [index, f] of files.entries()) {
      const key = `${prefix}${uuidv7()}`;
      await putEncrypted(key, f.buf);
      stored.push({ key, f, index });
    }
    const ipHash = pepperedHash(`ip:${ip}`);
    await getDb().transaction(async (tx) => {
      await tx.insert(conversations).values({
        id: conversationId,
        userId,
        createdBySessionId: sessionId,
        sourceType,
        status: "uploaded",
        progress: { step: "received" },
        timezone: "America/Sao_Paulo",
        expiresAt: new Date(Date.now() + env.RETENTION_UNPAID_DAYS * 86_400_000),
      });
      await tx.insert(conversationFiles).values(
        stored.map(({ key, f, index }) => ({
          conversationId,
          storageKey: key,
          originalName: encryptField(f.name),
          mime: f.mime,
          sizeBytes: f.buf.length,
          sha256: createHash("sha256").update(f.buf).digest("hex"),
          orderIndex: index,
        })),
      );
      // A caixa dos Termos reúne, no texto, a participação na conversa, o aviso de IA e a autorização de
      // dados sensíveis e transferência internacional (D101): cada item fica registrado com a versão.
      await tx.insert(consents).values(
        (["terms", "privacy", "adult", "third_party_data", "ai_disclaimer", "sensitive_data", "international_transfer"] as const).map((kind) => ({
          userId,
          conversationId,
          kind,
          version: LEGAL_VERSION,
          ipHash,
        })),
      );
      await tx.insert(funnelEvents).values({ event: "upload", sourceType });
      await enqueue("ingest", { conversationId }, { singletonKey: conversationId, tx });
    });
  } catch (err) {
    log.error({ conversationId, err: safeErr(err) }, "upload_persist_failed");
    return jsonError("server_error", 500);
  }

  await recordAccess("upload", userId);
  log.info({ conversationId, mode, files: files.length }, "upload_received");
  return Response.json({ conversationId }, { status: 201, headers: noStoreHeaders() });
}
