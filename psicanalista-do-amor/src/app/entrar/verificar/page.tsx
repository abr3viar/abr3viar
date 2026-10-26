import type { Metadata } from "next";
import { verifyLoginAction } from "../actions";
import { PRIVATE_ROBOTS } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Entrar", robots: PRIVATE_ROBOTS, referrer: "no-referrer" };

/**
 * O token só é consumido com um clique (POST), para que leitores automáticos de e-mail
 * que abrem links não gastem o link de uso único.
 */
export default async function VerificarPage(props: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await props.searchParams;
  return (
    <div className="mx-auto max-w-md px-4 py-12 text-center">
      <h1 className="font-serif text-3xl font-bold text-wine-900">Quase lá</h1>
      <p className="mt-2 text-stone-600">Clique para entrar e ver suas análises.</p>
      <form action={verifyLoginAction} className="mt-6">
        <input type="hidden" name="token" value={token ?? ""} />
        <button type="submit" className="btn-primary">Entrar</button>
      </form>
    </div>
  );
}
