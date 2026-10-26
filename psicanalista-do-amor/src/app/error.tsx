"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="heading-1">Algo deu errado</h1>
      <p className="mt-3 text-muted">Tivemos um problema ao carregar esta página. Tente de novo em instantes.</p>
      <button type="button" onClick={reset} className="btn-primary mt-6">Tentar de novo</button>
    </div>
  );
}
