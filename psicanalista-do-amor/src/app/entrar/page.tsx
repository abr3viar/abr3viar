import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
import { requestLoginAction } from "./actions";
import { PRIVATE_ROBOTS } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Entrar", robots: PRIVATE_ROBOTS };

export default async function EntrarPage(props: { searchParams: Promise<{ erro?: string; saiu?: string; assinar?: string }> }) {
  const { erro, saiu, assinar } = await props.searchParams;
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="heading-1">Entrar</h1>
      <p className="mt-2 text-muted">Sem senha: enviamos um link de acesso para o e-mail que você usou ao enviar a conversa.</p>
      {erro === "link" && (
        <p role="alert" className="mt-4 rounded-control bg-amber-50 p-4 text-sm text-amber-900">
          Este link expirou ou já foi usado. Peça um novo abaixo.
        </p>
      )}
      {assinar === "1" && (
        <p role="status" className="mt-4 rounded-control bg-wine-50 p-4 text-sm text-wine-900">
          Para assinar, entre pelo link que enviamos ao seu e-mail. A assinatura fica ligada a esse e-mail. Depois de entrar,
          volte à página <a href="/assinatura" className="underline underline-offset-2">Assinatura</a>.
        </p>
      )}
      {saiu === "todos" && (
        <p role="status" className="mt-4 rounded-control bg-green-50 p-4 text-sm text-green-900">
          Pronto: você saiu de todos os aparelhos.
        </p>
      )}
      <div className="card mt-6">
        <LoginForm action={requestLoginAction} />
      </div>
    </div>
  );
}
