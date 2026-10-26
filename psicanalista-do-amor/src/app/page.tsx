import Link from "next/link";
import { AI_DISCLAIMER } from "@/lib/copy";
import { formatPrice } from "@/lib/views";
import { LockedSection } from "@/components/report/locked-section";
import { ArrowRightIcon, EyeOffIcon, FileEraseIcon, ShieldIcon, TrashIcon } from "@/components/icons";
import { publicPrices } from "@/server/reports/pricing";
import { SUBSCRIPTION_DAILY_LIMIT } from "@/lib/subscription";
import { LANDING_FAQ_IDS, buildFaq, faqJsonLd, jsonLd } from "@/lib/faq";
import { PUBLIC_ROBOTS, appUrl } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: PUBLIC_ROBOTS,
  alternates: { canonical: "/" },
  // (openGraph na página substitui o do layout: repetir título e descrição)
  openGraph: {
    url: "/",
    type: "website",
    locale: "pt_BR",
    siteName: "Psicanalista do Amor",
    title: "Psicanalista do Amor — descubra o que está nas entrelinhas",
    description: "Uma leitura feita por IA da dinâmica entre duas pessoas a partir da conversa de vocês.",
  },
};

const STEPS = [
  { title: "Envie a conversa", text: "Cole o texto, envie o .txt exportado do WhatsApp, um .zip ou prints. Os arquivos são apagados logo depois de lidos." },
  { title: "Confirme quem é quem", text: "Você dá nome às duas pessoas e, se quiser, diz qual delas é você." },
  { title: "Leia o relatório", text: "Metade do relatório é grátis. Se quiser ir até o fim, desbloqueie o relatório completo." },
];

// Garantias de privacidade (UX-12): só o que o sistema de fato faz (CLAUDE.md, regras críticas 6 e 9; exclusão em /conta e em cada análise).
const TRUST = [
  { text: "Conversa guardada com criptografia", Icon: ShieldIcon },
  { text: "Arquivos originais apagados depois da leitura", Icon: FileEraseIcon },
  { text: "Nada é enviado para a outra pessoa", Icon: EyeOffIcon },
  { text: "Você apaga tudo quando quiser", Icon: TrashIcon },
];

export default async function Home(props: { searchParams: Promise<{ "dados-excluidos"?: string }> }) {
  const deleted = (await props.searchParams)["dados-excluidos"] === "1";
  const prices = await publicPrices();
  const faq = buildFaq(prices).filter((i) => LANDING_FAQ_IDS.includes(i.id));
  const base = appUrl();
  // Dados estruturados SÓ na landing (nunca no layout: não podem ir para páginas privadas).
  const structured = jsonLd([
    { "@context": "https://schema.org", "@type": "Organization", name: "Psicanalista do Amor", url: base, logo: `${base}/icon` },
    { "@context": "https://schema.org", "@type": "WebSite", name: "Psicanalista do Amor", url: base, inLanguage: "pt-BR" },
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Relatório completo — Psicanalista do Amor",
      description: "Leitura feita por IA da dinâmica entre duas pessoas a partir da conversa: 8 seções, com a primeira metade grátis.",
      brand: { "@type": "Brand", name: "Psicanalista do Amor" },
      offers: [
        { "@type": "Offer", price: (prices.mainCents / 100).toFixed(2), priceCurrency: prices.currency.toUpperCase(), availability: "https://schema.org/InStock", url: `${base}/analisar` },
        ...(prices.extraFromCents
          ? [{ "@type": "Offer", name: "Relatório adicional", price: (prices.extraFromCents / 100).toFixed(2), priceCurrency: prices.currency.toUpperCase(), availability: "https://schema.org/InStock" }]
          : []),
        ...(prices.subscriptionCents
          ? [
              {
                "@type": "Offer",
                name: "Assinatura mensal",
                price: (prices.subscriptionCents / 100).toFixed(2),
                priceCurrency: prices.currency.toUpperCase(),
                availability: "https://schema.org/InStock",
                url: `${base}/assinatura`,
                priceSpecification: {
                  "@type": "UnitPriceSpecification",
                  price: (prices.subscriptionCents / 100).toFixed(2),
                  priceCurrency: prices.currency.toUpperCase(),
                  billingDuration: "P1M",
                  unitCode: "MON",
                },
              },
            ]
          : []),
      ],
    },
  ]);
  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structured }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd(faq) }} />
      {deleted && (
        <div role="status" className="alert alert-success mx-auto mt-6 max-w-3xl px-4 sm:px-6">
          <p>Pronto: seus dados foram excluídos. Enviamos uma confirmação para o seu e-mail.</p>
        </div>
      )}

      {/* Hero: a proposta à esquerda e uma prévia do relatório (texto fictício) à direita. */}
      <section className="mx-auto grid max-w-5xl gap-10 px-4 pt-10 pb-12 sm:pt-16 sm:pb-16 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-14">
        <div>
          <p className="eyebrow">Análise de conversas por IA</p>
          <h1 className="heading-display mt-4">Cole a conversa e descubra o que está nas entrelinhas.</h1>
          <p className="lead mt-5 max-w-xl">
            Quem puxa assunto, como cada um demonstra afeto, onde estão os atritos e o que muda tudo. Uma leitura da
            dinâmica entre duas pessoas, a partir do que vocês escreveram.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/analisar" className="btn-primary min-h-12 px-6 text-base sm:text-lg">
              Analisar uma conversa
              <ArrowRightIcon className="h-5 w-5" />
            </Link>
            <a href="#exemplo" className="btn-secondary min-h-12 px-6 text-base">Ver um exemplo</a>
          </div>
          <p className="hint mt-4">
            Primeira metade grátis · relatório completo {formatPrice(prices.mainCents, prices.currency)} em pagamento único
            {prices.subscriptionCents ? ` · ou assinatura com até ${SUBSCRIPTION_DAILY_LIMIT} por dia` : ""}
          </p>
        </div>

        <figure aria-label="Prévia de um relatório fictício" className="card relative space-y-4 overflow-hidden">
          <figcaption className="flex items-center justify-between gap-3 text-xs font-medium text-muted">
            <span className="eyebrow">Prévia · fictício</span>
            <span>Bia & Rafa</span>
          </figcaption>
          <p className="heading-3">O retrato de vocês dois</p>
          <p className="text-sm leading-relaxed text-ink">
            Os dois procuram um ao outro, mas de jeitos diferentes. Em três palavras: <strong className="text-wine-900">cumplicidade, ritmo, expectativa</strong>.
          </p>
          <div className="space-y-2" role="img" aria-label="Iniciativa: Bia 62%, Rafa 38%">
            <div className="flex justify-between text-xs font-medium text-muted">
              <span>Bia · 62%</span>
              <span>38% · Rafa</span>
            </div>
            <div className="flex h-2.5 overflow-hidden rounded-full">
              <div className="bg-wine-600" style={{ width: "62%" }} />
              <div className="bg-wine-200" style={{ width: "38%" }} />
            </div>
          </div>
          <LockedSection position={0} lockedTitle="O momento de virada" lengthHint="short" headingLevel={3} unlockHref="#precos" tone="paper" />
        </figure>
      </section>

      {/* Garantias: lista com separadores, não grade de cartões. */}
      <section aria-labelledby="confianca" className="border-y border-wine-100 bg-paper">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <h2 id="confianca" className="sr-only">Como cuidamos da sua conversa</h2>
          <ul className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map(({ text, Icon }) => (
              <li key={text} className="flex items-start gap-3 text-sm font-medium text-ink">
                <Icon className="mt-0.5 h-5 w-5 text-wine-700" />
                {text}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-sm">
            <Link href="/privacidade" className="link">Veja como cuidamos dos seus dados</Link>
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16 sm:py-20" aria-labelledby="como">
        <p className="eyebrow">Passo a passo</p>
        <h2 id="como" className="heading-2 mt-2">Como funciona</h2>
        <ol className="mt-10 grid gap-8 sm:grid-cols-3 sm:gap-10">
          {STEPS.map((s, i) => (
            <li key={s.title} className="border-t-2 border-wine-200 pt-5">
              <span className="font-serif text-sm font-semibold text-wine-600">0{i + 1}</span>
              <h3 className="heading-3 mt-1">{s.title}</h3>
              <p className="hint mt-2">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="exemplo" className="border-y border-wine-100 bg-paper py-16 sm:py-20" aria-labelledby="exemplo-titulo">
        <div className="mx-auto max-w-2xl space-y-8 px-4">
          <div className="text-center">
            <p className="eyebrow">Exemplo</p>
            <h2 id="exemplo-titulo" className="heading-2 mt-2">Um exemplo (fictício)</h2>
            <p className="hint mt-3">Bia e Rafa não existem. A conversa e a análise abaixo foram inventadas para mostrar o formato.</p>
          </div>
          {/* Uma folha só, com seções separadas por filete: o relatório lê-se como texto, não como painel. */}
          <article className="space-y-7 border-l-2 border-wine-100 pl-5 sm:pl-7">
            <section>
              <h3 className="heading-3">O retrato de vocês dois</h3>
              <p className="prose-report mt-2">
                Bia e Rafa conversam quase todos os dias, com um tom leve e cheio de piadas internas. A conversa sugere uma
                relação em construção: os dois procuram um ao outro, mas de jeitos diferentes. Em três palavras:{" "}
                <strong>cumplicidade, ritmo, expectativa</strong>.
              </p>
            </section>
            <section>
              <h3 className="heading-3">O ritmo da conversa</h3>
              <p className="prose-report mt-2">
                Bia inicia <strong>62%</strong> das conversas depois de longos silêncios e costuma responder em poucos minutos.
                Rafa demora mais, mas escreve mensagens mais longas — um padrão que aparece principalmente à noite.
              </p>
              <blockquote className="mt-3 border-l-4 border-wine-300 pl-4 text-sm text-muted italic">
                “desculpa a demora, tava pensando no que você falou ontem”
              </blockquote>
            </section>
          </article>
          <p className="rounded-card bg-wine-900 p-6 font-serif text-lg leading-relaxed text-cream italic">
            Mas o jeito como Rafa responde quando a conversa fica séria conta uma história diferente da que vimos até aqui…
          </p>
          <LockedSection position={5} lockedTitle="O dia em que algo mudou entre vocês" lengthHint="medium" headingLevel={3} unlockHref="#precos" tone="paper" />
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16 sm:py-20" aria-labelledby="precos">
        <p className="eyebrow text-center">Preço</p>
        <h2 id="precos" className="heading-2 mt-2 text-center">Pague uma vez ou assine</h2>
        <div className="mx-auto mt-10 grid max-w-4xl gap-5 lg:grid-cols-5">
          {/* Oferta principal em destaque (3 colunas no desktop). */}
          <div className="card-featured flex flex-col lg:col-span-3">
            <p className="eyebrow">Relatório completo</p>
            <p className="mt-3 font-serif text-4xl font-semibold text-wine-900">{formatPrice(prices.mainCents, prices.currency)}</p>
            <p className="mt-1 text-sm font-semibold text-ink">Pagamento único, sem recorrência.</p>
            <p className="hint mt-4">
              A primeira metade é grátis. O completo tem 8 seções, com o momento de virada, quem está mais investido, os
              atritos e conselhos práticos.
            </p>
            <Link href="/analisar" className="btn-primary mt-6 w-full sm:w-auto">Analisar uma conversa</Link>
          </div>
          {/* Demais ofertas: uma lista única, em vez de três cartões iguais. */}
          <ul className="divide-y divide-wine-100 rounded-card border border-wine-100 bg-paper lg:col-span-2">
            <li className="space-y-1 p-5 sm:p-6">
              <p className="font-semibold text-wine-900">Relatórios adicionais</p>
              <p className="text-lg font-semibold text-wine-800">
                {prices.extraFromCents ? `${prices.extraUniform ? "" : "a partir de "}${formatPrice(prices.extraFromCents, prices.currency)}` : "—"}
              </p>
              <p className="hint">
                Pagamento único por relatório, disponível depois do relatório completo, sobre a mesma conversa. Por exemplo:
                quem demonstra mais interesse, padrões de conflito ou como responder a última mensagem.
              </p>
            </li>
            {prices.subscriptionCents != null && (
              <li className="space-y-1 p-5 sm:p-6">
                <p className="font-semibold text-wine-900">Assinatura mensal</p>
                <p className="text-lg font-semibold text-wine-800">
                  {formatPrice(prices.subscriptionCents, prices.currency)}
                  <span className="text-sm font-medium text-muted"> /mês</span>
                </p>
                <p className="hint">
                  No cartão, com renovação automática. Cancele quando quiser. Até {SUBSCRIPTION_DAILY_LIMIT} relatórios
                  completos por dia, com os relatórios adicionais incluídos.
                  {prices.overageCents ? ` Passou do limite no dia? Cada relatório a mais custa ${formatPrice(prices.overageCents, prices.currency)}.` : ""}
                </p>
                <Link href="/assinatura" className="link inline-flex min-h-11 items-center text-sm">
                  Conhecer a assinatura
                  <ArrowRightIcon className="ml-1 h-4 w-4" />
                </Link>
              </li>
            )}
          </ul>
        </div>
      </section>

      <section className="border-t border-wine-100 bg-paper py-16 sm:py-20" aria-labelledby="faq">
        <div className="mx-auto max-w-3xl px-4">
          <h2 id="faq" className="heading-2 text-center">Perguntas frequentes</h2>
          <dl className="mt-10 divide-y divide-wine-100">
            {faq.map((i) => (
              <div key={i.id} className="py-5 first:pt-0">
                <dt className="font-semibold text-wine-900">{i.q}</dt>
                <dd className="mt-2 leading-relaxed text-ink">{i.a}</dd>
              </div>
            ))}
          </dl>
          <p className="alert alert-info mt-10 text-sm">{AI_DISCLAIMER}</p>
          <div className="mt-10 text-center">
            <Link href="/analisar" className="btn-primary min-h-12 w-full px-6 text-base sm:w-auto sm:text-lg">Analisar uma conversa</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
