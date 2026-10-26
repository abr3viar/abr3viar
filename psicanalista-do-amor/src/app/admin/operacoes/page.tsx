import { requireAdmin } from "@/server/auth/admin";
import { adminFailures } from "@/server/admin/queries";
import { adminRetryAction, adminRunJobAction } from "../actions";

const JOBS = [
  { job: "reconcile_payments", label: "Reconciliar pagamentos agora", hint: "Procura pagamentos dos últimos 3 dias cujo webhook não chegou." },
  { job: "cleanup_files", label: "Limpar arquivos originais", hint: "Apaga originais com mais de 24 h e órfãos." },
  { job: "retention", label: "Rodar retenção agora", hint: "Apaga análises vencidas e envia avisos." },
  { job: "rotate_encryption_key", label: "Rotacionar chave de criptografia", hint: "Use só depois de configurar a nova chave (ver DEPLOY.md)." },
];

export default async function AdminOperacoes(props: { searchParams: Promise<{ ok?: string }> }) {
  await requireAdmin();
  const { ok } = await props.searchParams;
  const { failedConversations, failedReports } = await adminFailures();
  return (
    <div className="space-y-6">
      {ok && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-900">Feito.</p>}
      <section className="card space-y-3">
        <h2 className="font-semibold text-wine-900">Tarefas de manutenção</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {JOBS.map((j) => (
            <form key={j.job} action={adminRunJobAction} className="rounded-xl border border-wine-100 p-3">
              <input type="hidden" name="job" value={j.job} />
              <button type="submit" className="btn-secondary text-sm">{j.label}</button>
              <p className="mt-1 text-xs text-stone-500">{j.hint}</p>
            </form>
          ))}
        </div>
      </section>
      <section className="card">
        <h2 className="font-semibold text-wine-900">Análises com falha</h2>
        {failedConversations.length === 0 ? <p className="text-sm text-stone-500">Nenhuma.</p> : (
          <ul className="mt-2 space-y-2 text-sm">
            {failedConversations.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-xs">{c.id}</span><span>{c.sourceType}</span><span className="text-red-700">{c.errorCode}</span>
                <form action={adminRetryAction}>
                  <input type="hidden" name="kind" value="conversation" /><input type="hidden" name="id" value={c.id} />
                  <button type="submit" className="btn-secondary px-3 py-1 text-xs">Reprocessar</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h2 className="font-semibold text-wine-900">Relatórios adicionais com falha</h2>
        {failedReports.length === 0 ? <p className="text-sm text-stone-500">Nenhum.</p> : (
          <ul className="mt-2 space-y-2 text-sm">
            {failedReports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-xs">{r.id}</span><span>{r.slug}</span><span className="text-red-700">{r.errorCode}</span>
                {r.isUnlocked && (
                  <form action={adminRetryAction}>
                    <input type="hidden" name="kind" value="report" /><input type="hidden" name="id" value={r.id} />
                    <button type="submit" className="btn-secondary px-3 py-1 text-xs">Reprocessar</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
