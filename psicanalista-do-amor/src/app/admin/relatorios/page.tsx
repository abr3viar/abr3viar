import { getEnv, isStripeLiveMode, stripeFees, stripeFeesFor } from "@/env";
import { grossFromNet, netFromGross } from "@/lib/pricing";
import { adminReportTypes } from "@/server/admin/queries";
import { requireAdmin } from "@/server/auth/admin";
import { STRIPE_WEBHOOK_EVENTS } from "@/server/payments/stripe";
import { createReportTypeAction, updateReportTypeAction } from "../actions";

const brl = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

const KIND_LABEL: Record<string, string> = {
  main: "principal",
  extra: "adicional",
  subscription: "assinatura mensal",
  overage: "assinante além do limite",
};

const FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  teaser: "Chamada",
  description: "Descrição",
  netPrice: "Valor líquido (use o formato 10,00)",
  sortOrder: "Ordem",
  slug: "Slug",
  promptTemplate: "Prompt",
  stripePaymentLinkId: "ID do link de produção (plink_...)",
  stripePaymentLinkUrl: "URL do link de produção (https://...)",
  stripeTestPaymentLinkId: "ID do link de teste (plink_...)",
  stripeTestPaymentLinkUrl: "URL do link de teste (https://...)",
};

/** Mensagens fixas por código: nada de texto livre vindo da URL (evita phishing no painel). */
function errorMessage(q: Record<string, string | undefined>, mode: string): string | null {
  const cents = (v: string | undefined) => (v && /^\d{1,7}$/.test(v) ? `R$ ${brl(Number(v))}` : "?");
  const removed = `Os demais dados foram salvos, mas o link de ${mode} foi removido para ninguém pagar um valor diferente do anunciado.`;
  switch (q.erro) {
    case undefined:
      return null;
    case "invalid_form": {
      const fields = (q.campos ?? "").split(",").map((f) => FIELD_LABELS[f]).filter(Boolean);
      return `Confira os campos: ${fields.length ? fields.join(", ") : "formulário"}.`;
    }
    case "link_pair":
      return "Preencha o ID e a URL de cada Payment Link (ou deixe os dois vazios).";
    case "slug_exists":
      return "Já existe um relatório com esse slug.";
    case "link_price":
      return `O Payment Link cobra ${cents(q.link)}, mas o preço calculado é ${cents(q.esperado)}. ${removed} Crie um link de ${cents(q.esperado)} e cole aqui.`;
    case "link_currency_mismatch":
      return `O Payment Link não está em BRL. ${removed}`;
    case "link_custom_amount":
      return `O Payment Link deixa o cliente escolher o valor. Use um preço fixo. ${removed}`;
    case "link_redirect_mismatch":
      return `O Payment Link não volta para o site depois do pagamento. Em "After payment", escolha redirecionar para o endereço do site + /pagamento/retorno?link=SLUG (veja as instruções acima). ${removed}`;
    case "link_url_mismatch":
      return `A URL colada não é a desse Payment Link (o ID e a URL precisam ser do mesmo link). ${removed}`;
    case "link_billing_mismatch":
      return `A assinatura precisa de um preço recorrente MENSAL (a cada 1 mês), sem período de teste grátis; os relatórios precisam de preço único. ${removed}`;
    case "link_options":
      return `O Payment Link permite cupom, itens opcionais, mais de um produto, quantidade ajustável ou é uma assinatura. Use um preço único (pagamento avulso), quantidade fixa 1 e sem cupom. ${removed}`;
    case "link_unavailable_live":
      return "Não foi possível conferir o Payment Link no Stripe agora, e em produção nada é salvo sem conferir. Nada foi alterado: tente de novo em instantes.";
    case "link_not_found":
      return `Não encontramos esse Payment Link no Stripe (confira o ID e o modo teste/produção). ${removed}`;
    default:
      return "Não foi possível salvar. Tente de novo.";
  }
}

export default async function AdminRelatorios(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const q = await props.searchParams;
  const ok = q.ok;
  const types = await adminReportTypes();
  const live = isStripeLiveMode();
  const erro = errorMessage(q, live ? "produção" : "teste");
  const appUrl = getEnv().APP_URL;
  const fees = stripeFees();
  return (
    <div className="space-y-6">
      {ok && (
        <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-900">
          {ok === "conferido"
            ? "Salvo. O Payment Link foi conferido no Stripe."
            : ok === "sem-conferencia"
              ? "Salvo. Não foi possível conferir o Payment Link no Stripe agora: confira o valor no painel do Stripe."
              : "Salvo."}
        </p>
      )}
      {erro && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{erro}</p>}
      <details className="card text-sm">
        <summary className="cursor-pointer font-semibold text-wine-900">Como criar cada Payment Link no Stripe</summary>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-stone-700">
          <li>Stripe → Product catalog → crie o produto com o <strong>preço a cobrar</strong> (em BRL) mostrado em cada relatório abaixo.</li>
          <li>Payment Links → New → selecione o produto, quantidade fixa 1, sem coleta de endereço.</li>
          <li>Em <em>After payment</em>: &quot;Don&apos;t show confirmation page&quot; → redirecionar para <code>{appUrl}/pagamento/retorno?link=SLUG</code>.</li>
          <li>Formas de pagamento: cartão e Pix.</li>
          <li>Copie a URL (<code>https://buy.stripe.com/...</code>) e o ID (<code>plink_...</code>, em Developers → API do link) e cole aqui.</li>
          <li>
            <strong>Assinatura mensal:</strong> no produto, escolha preço <em>Recurring</em> → <em>Monthly</em>, sem teste grátis; o
            Payment Link aceita só cartão (Pix não renova sozinho). Ative também o portal do cliente em Settings → Billing → Customer
            portal (para o cliente cancelar e trocar o cartão).
          </li>
          <li>Webhook: {appUrl}/api/webhooks/stripe com os eventos: {STRIPE_WEBHOOK_EVENTS.join(", ")}.</li>
        </ol>
        <p className="mt-2 text-stone-600">Modo atual: <strong>{live ? "produção" : "teste"}</strong> — o site usa os links do modo atual.</p>
        <p className="mt-2 text-stone-600">
          Taxa do Stripe repassada: <strong>{String(fees.percent).replace(".", ",")}% + R$ {brl(fees.fixedCents)}</strong> (variáveis
          STRIPE_FEE_PERCENT e STRIPE_FEE_FIXED_CENTS). O preço a cobrar é calculado para você receber o valor líquido.
        </p>
      </details>

      {types.map((t) => (
        <form key={t.id} action={updateReportTypeAction} className="card space-y-4">
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="currency" value="brl" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-wine-900">
              {t.name} <span className="font-mono text-xs text-stone-500">({t.slug} · {KIND_LABEL[t.kind] ?? t.kind})</span>
            </h2>
            {t.kind !== "main" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isActive" defaultChecked={t.isActive} className="accent-wine-600" />{" "}
                {t.kind === "extra" ? "Ativo na vitrine" : "À venda"}
              </label>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Nome</span><input name="name" className="input" defaultValue={t.name} required /></label>
            <label className="block">
              <span className="label">Valor líquido que você quer receber (R$)</span>
              <input name="netPrice" className="input" defaultValue={brl(t.netPriceCents || t.priceCents)} inputMode="decimal" required />
            </label>
            <div className="rounded-xl bg-wine-50 p-3 text-sm sm:col-span-2">
              Preço a cobrar no Payment Link: <strong className="text-lg text-wine-900">R$ {brl(t.priceCents)}</strong>
              {t.kind === "subscription" ? " por mês " : " "}
              <span className="text-stone-600">(você recebe ≈ R$ {brl(netFromGross(t.priceCents, stripeFeesFor(t.kind)))} depois da taxa)</span>
              {t.kind === "subscription" && (
                <p className="mt-1 text-stone-600">
                  Inclui a tarifa do Stripe Billing de {String(stripeFeesFor(t.kind).percent - fees.percent).replace(".", ",")}% (variável
                  STRIPE_SUBSCRIPTION_EXTRA_FEE_PERCENT).
                </p>
              )}
              {t.netPriceCents > 0 && grossFromNet(t.netPriceCents, stripeFeesFor(t.kind)) !== t.priceCents && (
                <p className="mt-1 text-amber-800">
                  A taxa configurada mudou: clique em Salvar para recalcular (novo preço R$ {brl(grossFromNet(t.netPriceCents, stripeFeesFor(t.kind)))}) e atualize o Payment Link.
                </p>
              )}
            </div>
            <label className="block sm:col-span-2"><span className="label">Chamada na vitrine</span><input name="teaser" className="input" defaultValue={t.teaser} required /></label>
            <label className="block sm:col-span-2"><span className="label">Descrição</span><textarea name="description" className="input" rows={2} defaultValue={t.description} required /></label>
            <label className="block"><span className="label">Ordem</span><input name="sortOrder" type="number" className="input" defaultValue={t.sortOrder} /></label>
          </div>
          <fieldset className="grid gap-3 rounded-xl border border-wine-100 p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold">Payment Link — TESTE</legend>
            <label className="block"><span className="label">ID (plink_...)</span><input name="stripeTestPaymentLinkId" className="input font-mono text-sm" defaultValue={t.stripeTestPaymentLinkId ?? ""} /></label>
            <label className="block"><span className="label">URL</span><input name="stripeTestPaymentLinkUrl" className="input font-mono text-sm" defaultValue={t.stripeTestPaymentLinkUrl ?? ""} /></label>
          </fieldset>
          <fieldset className="grid gap-3 rounded-xl border border-wine-100 p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold">Payment Link — PRODUÇÃO</legend>
            <label className="block"><span className="label">ID (plink_...)</span><input name="stripePaymentLinkId" className="input font-mono text-sm" defaultValue={t.stripePaymentLinkId ?? ""} /></label>
            <label className="block"><span className="label">URL</span><input name="stripePaymentLinkUrl" className="input font-mono text-sm" defaultValue={t.stripePaymentLinkUrl ?? ""} /></label>
          </fieldset>
          {t.kind === "extra" && (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-wine-700">Prompt específico (avançado)</summary>
              <textarea name="promptTemplate" className="input mt-2 font-mono text-xs" rows={12} defaultValue={t.promptTemplate} />
            </details>
          )}
          <button type="submit" className="btn-primary">Salvar</button>
        </form>
      ))}

      <details className="card">
        <summary className="cursor-pointer font-semibold text-wine-900">Novo relatório adicional</summary>
        <form action={createReportTypeAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Slug (ex.: esfriando)</span><input name="slug" className="input" required /></label>
          <label className="block"><span className="label">Valor líquido desejado (R$)</span><input name="netPrice" className="input" defaultValue="10,00" required /></label>
          <label className="block sm:col-span-2"><span className="label">Nome</span><input name="name" className="input" required /></label>
          <label className="block sm:col-span-2"><span className="label">Chamada</span><input name="teaser" className="input" required /></label>
          <label className="block sm:col-span-2"><span className="label">Descrição</span><textarea name="description" className="input" rows={2} required /></label>
          <label className="block sm:col-span-2">
            <span className="label">Prompt específico (objetivo, seções com key &quot;...&quot;, critérios, VERDICT)</span>
            <textarea name="promptTemplate" className="input font-mono text-xs" rows={10} required />
          </label>
          <p className="text-xs text-stone-500 sm:col-span-2">O novo relatório nasce inativo. Cadastre o Payment Link e marque &quot;Ativo&quot;.</p>
          <button type="submit" className="btn-primary sm:col-span-2">Criar</button>
        </form>
      </details>
    </div>
  );
}
