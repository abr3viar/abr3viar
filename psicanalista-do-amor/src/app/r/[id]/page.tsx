import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AI_DISCLAIMER } from "@/lib/copy";
import { errorMessage } from "@/lib/messages";
import { SubscriptionAwareCheckout } from "@/components/report/subscription-cta";
import { ReportBody } from "@/components/report/report-body";
import { ExtrasShowcase } from "@/components/report/extras-showcase";
import { DeleteConversation } from "@/components/delete-conversation";
import { getOwnedConversation, sentWithoutLogin } from "@/server/access";
import { getViewer } from "@/server/auth/session";
import { getReportViewBySlug } from "@/server/reports/get-report-view";
import { listExtraOffers } from "@/server/reports/extras";
import { MAIN_REPORT_SLUG, OVERAGE_SLUG } from "@/server/reports/catalog";
import { subscriptionStateFor } from "@/server/payments/subscriptions";
import { getSubscriptionOffer } from "@/server/reports/pricing";
import { touchConversation } from "@/server/retention";
import { deleteConversation, startCheckoutAction, unlockExtraWithSubscriptionAction, unlockWithSubscriptionAction } from "./actions";
import { setUserSideAction } from "../extra-actions";
import { PRIVATE_ROBOTS } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Seu relatório", robots: PRIVATE_ROBOTS };

export default async function ReportPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { id } = await props.params;
  const { erro } = await props.searchParams;
  const viewer = await getViewer();
  const conv = await getOwnedConversation(id, viewer);
  if (!conv) notFound();
  if (conv.status === "needs_confirmation") redirect(`/r/${conv.id}/confirmar`);
  if (conv.status !== "ready") redirect(`/r/${conv.id}/processando`);

  const view = await getReportViewBySlug(conv.id, MAIN_REPORT_SLUG, viewer);
  if (!view || view.status !== "ready") redirect(`/r/${conv.id}/processando`);
  await touchConversation(conv.id);
  const offers = view.isUnlocked ? await listExtraOffers(conv.id, conv.userIs) : [];
  // Assinatura (D96): só com sessão verificada (subscriptionStateFor devolve null para as demais).
  const subscription = await subscriptionStateFor(viewer);
  const subscriptionOffer = await getSubscriptionOffer();
  // S-03: enviada por uma sessão sem login de outro aparelho (alguém digitou este e-mail?).
  const planted = viewer && !view.isUnlocked ? (await sentWithoutLogin(viewer, [conv])).has(conv.id) : false;

  const lockedCount = view.sections.filter((s) => s.kind === "locked").length;
  // Com alerta de risco (TXT-5), o convite à compra fica neutro: nada de curiosidade colada ao alerta.
  const hasSafety = view.safetyFlag || view.sections.some((s) => s.kind === "open" && s.isSafety);
  const checkout = (
    <SubscriptionAwareCheckout
      conversationId={conv.id}
      slug={view.slug}
      priceCents={view.priceCents}
      currency={view.currency}
      purchasable={view.purchasable}
      overageSlug={OVERAGE_SLUG}
      subscription={subscription}
      offer={subscriptionOffer}
      viewerVerified={Boolean(viewer?.verified)}
      checkoutAction={startCheckoutAction}
      unlockAction={unlockWithSubscriptionAction}
    />
  );
  // Dois pontos de compra (UX-2): logo depois do gancho e no fim das seções bloqueadas
  // (#desbloquear, para onde apontam os links "Disponível no relatório completo").
  const cta = !view.isUnlocked ? (
    <div className="card space-y-4 border-wine-300 text-center">
      <div className="space-y-1">
        <p className="font-serif text-xl font-semibold text-wine-900">
          {hasSafety ? "Sobre o relatório completo" : "Continue lendo o relatório completo"}
        </p>
        <p className="text-sm text-stone-600">
          {hasSafety
            ? `${lockedCount === 1 ? "A seção restante fica" : `As outras ${lockedCount} seções ficam`} no relatório completo, se e quando fizer sentido para você.`
            : lockedCount === 1
              ? "Falta 1 seção para completar a leitura."
              : `Faltam ${lockedCount} seções, entre elas o momento de virada, os pontos de atrito e a leitura final com conselhos práticos.`}
        </p>
      </div>
      <div className="mx-auto max-w-sm">{checkout}</div>
    </div>
  ) : null;
  const ctaEnd = !view.isUnlocked ? (
    <div id="desbloquear" className="card space-y-4 border-2 border-wine-300 bg-wine-50/40 text-center">
      <p className="font-serif text-xl font-semibold text-wine-900">
        {hasSafety ? "Relatório completo" : lockedCount === 1 ? "Leia a seção que falta" : `Leia as ${lockedCount} seções que faltam`}
      </p>
      <div className="mx-auto max-w-sm">{checkout}</div>
    </div>
  ) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <header className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-wine-600">Relatório</p>
        <h1 className="font-serif text-3xl font-bold text-wine-900">
          {view.participants.a} & {view.participants.b}
        </h1>
        <p className="rounded-xl bg-wine-50 p-3 text-xs leading-relaxed text-wine-900">{AI_DISCLAIMER}</p>
        {erro && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{errorMessage(erro)}</p>}
        {planted && (
          <p role="note" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
            Esta análise foi enviada sem entrar na conta, de outro aparelho ou navegador. Se não foi você que enviou esta conversa,
            não pague: exclua a análise no fim da página. Ao comprar, só quem entra pelo link do seu e-mail continua com acesso.
          </p>
        )}
      </header>

      <ReportBody view={view} cta={cta} ctaEnd={ctaEnd} />

      {view.isUnlocked && (
        <ExtrasShowcase
          conversationId={conv.id}
          offers={offers}
          action={startCheckoutAction}
          includedAction={subscription?.active ? unlockExtraWithSubscriptionAction : null}
          setUserSideAction={setUserSideAction}
          names={view.participants}
        />
      )}

      <footer className="border-t border-wine-100 pt-4">
        <DeleteConversation conversationId={conv.id} action={deleteConversation} />
      </footer>
    </div>
  );
}
