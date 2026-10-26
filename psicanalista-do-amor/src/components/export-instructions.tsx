export function ExportInstructions() {
  return (
    <section className="mt-12 space-y-4" aria-labelledby="como-exportar">
      <h2 id="como-exportar" className="heading-2">
        Como exportar a conversa do WhatsApp
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card">
          <h3 className="font-semibold text-wine-800">Android</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-stone-700">
            <li>Abra a conversa.</li>
            <li>Toque em ⋮ (três pontos) → <strong>Mais</strong> → <strong>Exportar conversa</strong>.</li>
            <li>Escolha <strong>Sem mídia</strong>.</li>
            <li>Salve o arquivo .txt (ou envie para você mesmo por e-mail) e anexe aqui.</li>
          </ol>
        </div>
        <div className="card">
          <h3 className="font-semibold text-wine-800">iPhone</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-stone-700">
            <li>Abra a conversa e toque no nome do contato no topo.</li>
            <li>Role até <strong>Exportar conversa</strong>.</li>
            <li>Escolha <strong>Sem mídia</strong>.</li>
            <li>Salve em Arquivos e envie o .zip ou o .txt aqui.</li>
          </ol>
        </div>
      </div>
      <p className="text-sm text-muted">
        Também dá para enviar <strong>prints</strong> da conversa (até 60). Envie na ordem em que as mensagens aparecem.
      </p>
    </section>
  );
}
