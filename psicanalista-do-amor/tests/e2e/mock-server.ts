/**
 * Servidor FALSO para E2E e testes manuais — nenhum serviço real é chamado.
 *
 *  - /groq/openai/v1/chat/completions : imita a API da Groq e devolve JSON plausível
 *    conforme o tipo de prompt (relatório principal, adicional, resumo, visão...).
 *    Seções bloqueadas levam o marcador "SEGREDO-BLOQUEADO" para o teste de vazamento.
 *  - /stripe/pay/:slug : imita a página do Payment Link. O botão "Pagar" envia um
 *    `checkout.session.completed` ASSINADO para o webhook do app e redireciona
 *    para a página de retorno.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import Stripe from "stripe";
import { grossFromNet } from "../../src/lib/pricing";

const port = Number(process.env.E2E_MOCK_PORT ?? 3999);
const appUrl = process.env.E2E_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_e2e_secret";
const stripe = new Stripe("sk_test_mock");

// O Payment Link cobra o preço BRUTO (líquido + taxa do Stripe), como o /admin indica.
const FEES = { percent: Number(process.env.STRIPE_FEE_PERCENT ?? 3.99), fixedCents: Number(process.env.STRIPE_FEE_FIXED_CENTS ?? 39) };
const NET: Record<string, number> = { principal: 3000, "assinatura-mensal": 4699, "relatorio-alem-do-limite": 500 };
const SUBSCRIPTION_SLUG = "assinatura-mensal";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

type ChatMessage = { role: string; content: string | { type: string; text?: string }[] };

function textOf(m: ChatMessage | undefined): string {
  if (!m) return "";
  return typeof m.content === "string" ? m.content : m.content.map((p) => p.text ?? "").join("\n");
}

function namesFrom(user: string): { a: string; b: string } {
  return {
    a: /- A = (.+)/.exec(user)?.[1]?.trim() ?? "A",
    b: /- B = (.+)/.exec(user)?.[1]?.trim() ?? "B",
  };
}

function firstSeq(user: string): number {
  return Number(/#(\d+)/.exec(user)?.[1] ?? "1");
}

/**
 * Linhas de mensagem do prompt ("#12 [dd/mm hh:mm] A: texto"). O servidor confere as
 * citações contra a mensagem real (IA-9), então o mock cita trechos REAIS: a primeira
 * mensagem nas seções grátis e a última nas bloqueadas (o E2E confere que a citação
 * bloqueada não vaza antes do pagamento).
 */
function messageLines(user: string): { seq: number; text: string }[] {
  return [...user.matchAll(/^#(\d+)(?: \[[^\]]*\])? [AB]: (.+)$/gm)].map((m) => ({ seq: Number(m[1]), text: m[2]!.trim() }));
}

const MAIN_KEYS = ["retrato", "ritmo", "temas", "estilos", "virada", "investimento", "pontos-de-atrito", "leitura-final"];

function mainReport(user: string) {
  const { a, b } = namesFrom(user);
  const seq = firstSeq(user);
  const lines = messageLines(user);
  const firstQuote = lines[0]?.text.slice(0, 20) ?? "trecho citado";
  const lockedCite = lines.at(-1) ?? { seq, text: "trecho citado" };
  const safety = /\bme machucar\b|\bvou te matar\b/i.test(user);
  return {
    schema_version: 1,
    sections: [
      ...(safety
        ? [{ key: "alerta", title: "Um cuidado importante", locked_title: "Um cuidado importante", content: "ALERTA-DE-RISCO: há trechos que preocupam e merecem cuidado. Procure apoio.", evidence: [] }]
        : []),
      ...MAIN_KEYS.map((key, i) => {
        const free = i < 4;
        const marker = free ? `CONTEUDO-LIVRE-${key}` : `SEGREDO-BLOQUEADO-${key}`;
        return {
          key,
          title: free ? `Título aberto ${key}` : `TITULO-REAL-SPOILER-${key}`,
          locked_title: free ? `Título aberto ${key}` : `O que ninguém percebeu (${i + 1})`,
          content: `${marker}: ${a} e ${b} mostram um padrão interessante nesta parte da conversa. **A conversa sugere** cuidado e curiosidade dos dois lados, com momentos de leveza e outros de tensão.\n\n- Um ponto\n- Outro ponto`,
          evidence: [
            free ? { seq, quote: firstQuote } : { seq: lockedCite.seq, quote: lockedCite.text },
            { seq: 999999, quote: "citação inválida que deve ser removida" },
          ],
        };
      }),
    ],
    hook: `GANCHO-TESTE: mas existe algo no jeito como ${b} responde que muda tudo…`,
    safety_flag: safety,
  };
}

function extraReport(user: string, system: string) {
  const { a } = namesFrom(user);
  const keys = [...system.matchAll(/key "([a-z-]+)"/g)].map((m) => m[1]!).filter((k) => k !== "alerta");
  return {
    schema_version: 1,
    sections: (keys.length ? keys : ["unica"]).map((key) => ({
      key,
      title: `Seção adicional ${key}`,
      content: `CONTEUDO-ADICIONAL-${key}: análise extra sobre ${a}, com detalhes suficientes para passar na validação de tamanho mínimo.`,
      evidence: [{ seq: firstSeq(user), quote: "trecho" }],
    })),
    verdict: /VERDICT \(obrigatório\)/.test(system) ? { label: `${a} demonstra mais interesse`, score: 64, explanation: "Placar de teste." } : null,
    safety_flag: false,
  };
}

function chunkNotes() {
  return {
    period: "trecho",
    themes: ["rotina"],
    moments: [{ seq: 1, quote: "oi", why: "abertura" }],
    a_behaviors: ["puxa assunto"],
    b_behaviors: ["responde"],
    conflicts: [],
    affection: ["carinho"],
    tone_shifts: [],
    safety_concerns: [],
  };
}

function visionOutput(messages: ChatMessage[]) {
  const user = messages.find((m) => m.role === "user");
  const images = Array.isArray(user?.content) ? user!.content.filter((p) => p.type === "image_url").length : 1;
  return {
    images: Array.from({ length: images }, (_, index) => ({
      index,
      app: "whatsapp",
      chat_title: "Ana",
      messages: [
        { side: "left", sender_name: null, time: "23:41", day_label: null, kind: "text", text: `mensagem esquerda ${index}`, quoted_text: null, legible: true },
        { side: "right", sender_name: null, time: "23:42", day_label: null, kind: "text", text: `mensagem direita ${index}`, quoted_text: null, legible: true },
      ],
    })),
  };
}

function groqResponse(body: { model: string; messages: ChatMessage[] }) {
  const system = textOf(body.messages.find((m) => m.role === "system"));
  const user = textOf(body.messages.filter((m) => m.role === "user").at(-1));
  let payload: unknown;
  if (/extrator de texto de capturas de tela/i.test(system)) payload = visionOutput(body.messages);
  else if (/anotações objetivas sobre um TRECHO|condensá-las em UMA nota/i.test(system)) payload = chunkNotes();
  else if (/Gere SOMENTE a seção "([a-z-]+)"/.test(user)) {
    const key = /Gere SOMENTE a seção "([a-z-]+)"/.exec(user)![1]!;
    payload = { section: { key, title: key, locked_title: key, content: `Seção regenerada ${key} com conteúdo suficiente para o teste passar.`, evidence: [] } };
  } else if (/Escreva SOMENTE o "hook"/.test(user)) payload = { hook: "GANCHO-TESTE regenerado" };
  else if (/RELATÓRIO ADICIONAL/.test(system)) payload = extraReport(user, system);
  else payload = mainReport(user);
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(payload) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1000, completion_tokens: 800, total_tokens: 1800 },
  };
}

function html(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(body);
}

async function sendEvent(type: string, object: Record<string, unknown>) {
  const event = {
    id: `evt_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "event",
    type,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  };
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  const res = await fetch(`${appUrl}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": header },
    body: payload,
  });
  return res.status;
}

/** Assinatura (D96): checkout em modo assinatura + evento da assinatura com o fim do período. */
async function subscribeAndNotify(purchaseId: string) {
  const short = purchaseId.replace(/-/g, "").slice(0, 20);
  const sub = {
    id: `sub_test_${short}`,
    object: "subscription",
    customer: `cus_test_${short}`,
    status: "active",
    livemode: false,
    cancel_at_period_end: false,
    items: { object: "list", data: [{ id: `si_${short}`, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400 }] },
  };
  const status = await sendEvent("checkout.session.completed", {
    id: `cs_test_${short}`,
    object: "checkout.session",
    client_reference_id: purchaseId,
    payment_link: `plink_e2e_${SUBSCRIPTION_SLUG.replace(/-/g, "_")}`,
    amount_total: grossFromNet(NET[SUBSCRIPTION_SLUG]!, FEES),
    currency: "brl",
    mode: "subscription",
    livemode: false,
    payment_status: "paid",
    status: "complete",
    payment_intent: null,
    subscription: sub.id,
    customer: sub.customer,
    payment_method_types: ["card"],
  });
  await sendEvent("customer.subscription.updated", sub);
  return status;
}

async function payAndNotify(slug: string, purchaseId: string, mode: "paid" | "unpaid") {
  if (slug === SUBSCRIPTION_SLUG) return subscribeAndNotify(purchaseId);
  const session = {
    id: `cs_test_${purchaseId.replace(/-/g, "").slice(0, 24)}`,
    object: "checkout.session",
    client_reference_id: purchaseId,
    payment_link: `plink_e2e_${slug.replace(/-/g, "_")}`,
    amount_total: grossFromNet(NET[slug] ?? 1000, FEES),
    currency: "brl",
    mode: "payment",
    livemode: false,
    payment_status: mode,
    status: "complete",
    payment_intent: `pi_test_${purchaseId.replace(/-/g, "").slice(0, 20)}`,
    payment_method_types: ["card"],
  };
  const event = {
    id: `evt_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: session },
  };
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  const res = await fetch(`${appUrl}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": header },
    body: payload,
  });
  return res.status;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (url.pathname === "/health") return void res.writeHead(200).end("ok");

    if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
      const body = JSON.parse(await readBody(req)) as { model: string; messages: ChatMessage[] };
      const out = groqResponse(body);
      res.writeHead(200, {
        "content-type": "application/json",
        "x-ratelimit-remaining-tokens": "100000",
        "x-ratelimit-remaining-requests": "1000",
        "x-ratelimit-reset-tokens": "1s",
        "x-ratelimit-reset-requests": "1s",
      });
      return void res.end(JSON.stringify(out));
    }

    const pay = /^\/stripe\/pay\/([a-z0-9-]+)(\/confirm)?$/.exec(url.pathname);
    if (pay) {
      const slug = pay[1]!;
      const ref = url.searchParams.get("client_reference_id") ?? "";
      if (!pay[2]) {
        return html(
          res,
          200,
          `<!doctype html><html lang="pt-BR"><body><h1>Stripe (simulado)</h1><p>Produto: ${slug}</p>
<form method="get" action="/stripe/pay/${slug}/confirm"><input type="hidden" name="client_reference_id" value="${ref.replace(/[^a-zA-Z0-9-]/g, "")}"><button type="submit">Pagar</button></form></body></html>`,
        );
      }
      const status = await payAndNotify(slug, ref, "paid");
      res.writeHead(302, { location: `${appUrl}/pagamento/retorno?link=${slug}`, "x-webhook-status": String(status) });
      return void res.end();
    }
    res.writeHead(404).end();
  } catch {
    res.writeHead(500).end();
  }
}).listen(port);
