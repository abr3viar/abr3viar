import type { Metadata } from "next";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { AI_DISCLAIMER } from "@/lib/copy";
import { errorMessage } from "@/lib/messages";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/icons";
import { CheckoutButton } from "@/components/report/checkout-button";
import { ReportBody } from "@/components/report/report-body";
import { ReportProgress } from "@/components/report/report-progress";
import { Verdict } from "@/components/report/verdict";
import { getOwnedConversation } from "@/server/access";
import { getViewer } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { reportTypes } from "@/server/db/schema";
import { getReportViewBySlug, paymentLinkFor } from "@/server/reports/get-report-view";
import { MAIN_REPORT_SLUG } from "@/server/reports/catalog";
import { touchConversation } from "@/server/retention";
import { retryExtraAction } from "../../../extra-actions";
import { startCheckoutAction, unlockExtraWithSubscriptionAction } from "../../actions";
import { subscriptionStateFor } from "@/server/payments/subscriptions";
import { SubmitButton } from "@/components/submit-button";
import { PRIVATE_ROBOTS } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Relatório adicional", robots: PRIVATE_ROBOTS };

export default async function ExtraPage(props: { params: Promise<{ id: string; slug: string }> }) {
  const { id, slug } = await props.params;
  if (slug === MAIN_REPORT_SLUG) redirect(`/r/${id}`);
  const viewer = await getViewer();
  const conv = await getOwnedConversation(id, viewer);
  if (!conv || conv.status !== "ready") notFound();
  const [rt] = await getDb()
    .select()
    .from(reportTypes)
    .where(and(eq(reportTypes.slug, slug), eq(reportTypes.kind, "extra")));
  if (!rt) notFound();

  const main = await getReportViewBySlug(conv.id, MAIN_REPORT_SLUG, viewer);
  if (!main?.isUnlocked) redirect(`/r/${conv.id}`);
  const view = await getReportViewBySlug(conv.id, slug, viewer);
  await touchConversation(conv.id);

  const header = (
    <header className="space-y-2">
      <Link href={`/r/${conv.id}`} className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-wine-700 hover:underline">
        <ArrowLeftIcon className="h-4 w-4" />
        Voltar ao relatório principal
      </Link>
      <h1 className="heading-1">{rt.name}</h1>
      <p className="text-muted">{main.participants.a} & {main.participants.b}</p>
      <p className="rounded-control bg-wine-50 p-3 text-xs leading-relaxed text-wine-900">{AI_DISCLAIMER}</p>
    </header>
  );

  // Ainda não comprado (ou pagamento pendente): oferta.
  if (!view || !view.isUnlocked) {
    if (!rt.isActive) notFound();
    // Assinante ativo (D96, sessão verificada): o adicional sai sem cobrança.
    const subscription = await subscriptionStateFor(viewer);
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        {header}
        <div className="card space-y-4">
          <p className="text-stone-700">{rt.description}</p>
          {rt.requiresUserSide && conv.userIs === "none" ? (
            <div className="space-y-3">
              <p className="text-sm text-amber-800">
                Para este relatório, precisamos saber qual das duas pessoas é você. Dá para indicar em poucos segundos na
                página do relatório principal, sem custo.
              </p>
              <Link href={`/r/${conv.id}#extras`} className="btn-secondary w-full sm:w-auto">
                Indicar quem é você
                <ArrowRightIcon className="h-4 w-4" />
              </Link>
            </div>
          ) : subscription?.active ? (
            <form action={unlockExtraWithSubscriptionAction} className="space-y-2">
              <input type="hidden" name="conversationId" value={conv.id} />
              <input type="hidden" name="slug" value={rt.slug} />
              <p className="text-sm text-wine-900">Incluído na sua assinatura, sem custo extra.</p>
              <SubmitButton className="btn-primary min-h-12 w-full text-base sm:text-lg" pendingLabel="Preparando…">
                Gerar este relatório
              </SubmitButton>
            </form>
          ) : (
            <CheckoutButton
              conversationId={conv.id}
              slug={rt.slug}
              priceCents={rt.priceCents}
              currency={rt.currency}
              purchasable={paymentLinkFor(rt) !== null}
              label="Comprar este relatório"
              action={startCheckoutAction}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      {header}
      {view.status === "ready" ? (
        <>
          {view.verdict && <Verdict verdict={view.verdict} twoSided={slug === "quem-gosta-mais"} names={view.participants} />}
          <ReportBody view={view} />
        </>
      ) : view.status === "failed" ? (
        <div className="card space-y-3" role="alert">
          <p className="font-semibold text-wine-900">Não conseguimos gerar este relatório</p>
          <p className="text-stone-700">{errorMessage(view.errorCode)}</p>
          <p className="text-sm text-muted">
            Seu pagamento está confirmado e este relatório continua sendo seu. Tentar de novo não gera nenhuma nova
            cobrança. Se continuar falhando, fale com a gente pelo contato da{" "}
            <Link href="/ajuda" className="underline underline-offset-2">Ajuda</Link>: resolvemos o problema ou devolvemos o
            valor.
          </p>
          <form action={retryExtraAction}>
            <input type="hidden" name="reportId" value={view.reportId} />
            <button type="submit" className="btn-primary">Tentar de novo</button>
          </form>
        </div>
      ) : (
        <ReportProgress reportId={view.reportId} initial={{ status: view.status, progress: view.progress }} />
      )}
    </div>
  );
}
