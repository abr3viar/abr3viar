import { requireAdmin } from "@/server/auth/admin";
import { adminPurchases } from "@/server/admin/queries";
import { formatPrice } from "@/lib/views";

const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d) : "—");

export default async function AdminCompras() {
  await requireAdmin();
  const rows = await adminPurchases();
  return (
    <div className="card overflow-x-auto">
      <h2 className="mb-3 font-semibold text-wine-900">Últimas 200 compras</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr><th>Criada</th><th>Paga</th><th>Relatório</th><th>Valor</th><th>Status</th><th>Modo</th><th>Método</th><th>E-mail</th><th>ID (client_reference_id)</th></tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-t border-wine-100">
              <td>{fmt(p.createdAt)}</td>
              <td>{fmt(p.paidAt)}</td>
              <td>{p.slug}</td>
              <td>{formatPrice(p.amountPaidCents ?? p.amountCents, "brl")}</td>
              <td>{p.status}</td>
              <td>{p.livemode ? "produção" : "teste"}</td>
              <td>{p.method ?? "—"}</td>
              <td>{p.email ?? "(conta excluída)"}</td>
              <td className="font-mono text-xs">{p.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
