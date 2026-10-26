import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Página não encontrada" };

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="heading-1">Página não encontrada</h1>
      <p className="mt-3 text-muted">O endereço não existe ou você não tem acesso a ele. Se for uma análise sua, entre com o seu e-mail.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/entrar" className="btn-primary">Entrar</Link>
        <Link href="/" className="btn-secondary">Início</Link>
      </div>
    </div>
  );
}
