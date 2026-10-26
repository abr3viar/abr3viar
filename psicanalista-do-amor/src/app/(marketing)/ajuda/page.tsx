import type { Metadata } from "next";
import { ExportInstructions } from "@/components/export-instructions";
import { contactEmails } from "@/env";
import { AI_DISCLAIMER } from "@/lib/copy";
import { buildFaq, faqJsonLd } from "@/lib/faq";
import { publicPrices } from "@/server/reports/pricing";

const DESCRIPTION = "Como exportar a conversa do WhatsApp (Android e iPhone), quanto custa, reembolso, privacidade e contato.";
export const metadata: Metadata = {
  title: "Ajuda",
  description: DESCRIPTION,
  alternates: { canonical: "/ajuda" },
  openGraph: { title: "Ajuda · Psicanalista do Amor", description: DESCRIPTION, url: "/ajuda" },
};

export default async function AjudaPage() {
  const prices = await publicPrices();
  const { support } = contactEmails();
  const faq = buildFaq(prices);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="heading-1">Ajuda</h1>
      <p className="mt-3 rounded-control bg-wine-50 p-3 text-sm text-wine-900">{AI_DISCLAIMER}</p>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd(faq) }} />
      <dl className="mt-8 space-y-6">
        {faq.map((i) => (
          <div key={i.id}>
            <dt className="font-semibold text-wine-900">{i.q}</dt>
            <dd className="mt-1 text-stone-700">{i.a}</dd>
          </div>
        ))}
      </dl>
      <ExportInstructions />
      <p className="mt-10 text-sm text-muted">
        {support ? (
          <>
            Contato (dúvidas, problemas com o pagamento e reembolso):{" "}
            <a href={`mailto:${support}`} className="font-semibold underline">{support}</a>
          </>
        ) : (
          <>
            Para exportar ou excluir os seus dados, use{" "}
            <a href="/conta" className="font-semibold underline">Minha conta</a>.
          </>
        )}
      </p>
    </div>
  );
}
