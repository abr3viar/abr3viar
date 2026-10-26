import { requireAdmin } from "@/server/auth/admin";
import { adminOverview } from "@/server/admin/queries";
import { isStripeLiveMode } from "@/env";
import { formatPrice } from "@/lib/views";

const fmt = (d: Date) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d);

export default async function AdminHome() {
  await requireAdmin();
  const o = await adminOverview();
  const live = isStripeLiveMode();
  const missingLinks = o.types.filter((t) => t.isActive && !(live ? t.stripePaymentLinkUrl : t.stripeTestPaymentLinkUrl));
  return (
    <div className="space-y-6">
      <p className="rounded-xl bg-wine-50 p-3 text-sm text-wine-900">
        Stripe em modo <strong>{live ? "PRODUÇÃO" : "TESTE"}</strong> (definido pela STRIPE_SECRET_KEY).
      </p>
      {missingLinks.length > 0 && (
        <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          Sem Payment Link de {live ? "produção" : "teste"} (botão de compra desabilitado): {missingLinks.map((t) => t.name).join(", ")}.{" "}
          <a href="/admin/relatorios" className="underline">Configurar</a>
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <p className="text-sm text-stone-500">Receita bruta (30 dias)</p>
          <p className="text-2xl font-bold text-wine-900">{formatPrice(o.revenue.cents, "brl")}</p>
          <p className="text-xs text-stone-500">{o.revenue.n} compras pagas (renovações da assinatura ficam no Stripe)</p>
        </div>
        <div className="card">
          <p className="text-sm text-stone-500">Assinaturas</p>
          {o.subs.length === 0 ? (
            <p className="mt-1 text-sm">Nenhuma.</p>
          ) : (
            <ul className="mt-1 text-sm">{o.subs.map((s) => <li key={s.status}>{s.status}: {s.n}</li>)}</ul>
          )}
        </div>
        <div className="card">
          <p className="text-sm text-stone-500">Análises por status</p>
          <ul className="mt-1 text-sm">{o.byStatus.map((s) => <li key={s.status}>{s.status}: {s.n}</li>)}</ul>
        </div>
        <div className="card">
          <p className="text-sm text-stone-500">Funil (30 dias)</p>
          <ul className="mt-1 text-sm">{o.funnel.map((f) => <li key={f.event}>{f.event}: {f.n}</li>)}</ul>
        </div>
      </div>
      <section className="card">
        <h2 className="font-semibold text-wine-900">Eventos do webhook com erro (reconciliar manualmente)</h2>
        {o.webhookErrors.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Nenhum.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm">
            <thead><tr><th>Quando</th><th>Evento</th><th>Tipo</th><th>Erro</th></tr></thead>
            <tbody>
              {o.webhookErrors.map((e) => (
                <tr key={e.id} className="border-t border-wine-100"><td>{fmt(e.receivedAt)}</td><td className="font-mono text-xs">{e.id}</td><td>{e.type}</td><td>{e.error}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
