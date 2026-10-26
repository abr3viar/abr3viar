import { TrashIcon } from "./icons";

/**
 * Exclusão de uma análise em dois passos (QA-03): o `<summary>` só abre o aviso; quem apaga é
 * o botão de confirmação, que envia `confirm=sim` (a action exige).
 */
export function DeleteConversation({
  conversationId,
  action,
  label = "Excluir esta análise",
  srContext,
  className = "",
}: {
  conversationId: string;
  action: (form: FormData) => Promise<void>;
  label?: string;
  /** Complemento só para leitores de tela quando há vários na página (ex.: "Ana & Lucas"). */
  srContext?: string;
  className?: string;
}) {
  return (
    <details className={`group rounded-control open:border open:border-red-100 open:bg-white open:p-4 ${className}`}>
      <summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm font-medium text-muted hover:text-red-700 group-open:text-red-700">
        <TrashIcon className="h-4 w-4" />
        {label}
        {srContext && <span className="sr-only"> ({srContext})</span>}
      </summary>
      <p className="mt-2 text-sm text-stone-700">
        Apaga para sempre a conversa e todos os relatórios desta análise, inclusive os pagos. Não dá para desfazer.
      </p>
      <form action={action} className="mt-3">
        <input type="hidden" name="conversationId" value={conversationId} />
        <input type="hidden" name="confirm" value="sim" />
        <button type="submit" className="btn-danger text-sm">Sim, excluir definitivamente</button>
      </form>
    </details>
  );
}
