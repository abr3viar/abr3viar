import Link from "next/link";
import { AI_DISCLAIMER } from "@/lib/copy";
import { formatPrice } from "@/lib/views";
import { LockedSection } from "@/components/report/locked-section";
import { EyeOffIcon, FileEraseIcon, ShieldIcon, TrashIcon } from "@/components/icons";
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
        <p role="status" className="mx-auto mt-6 max-w-3xl rounded-xl bg-green-50 p-4 text-center text-sm text-green-900">
          Pronto: seus dados foram excluídos. Enviamos uma confirmação para o seu e-mail.
        </p>
      )}
      <section className="bg-gradient-to-b from-wine-50 to-cream">
        <div className="mx-auto max-w-5xl px-4 pt-12 pb-10 text-center sm:pt-20 sm:pb-16">
          <p className="text-sm font-semibold uppercase tracking-widest text-wine-600">Análise de conversas por IA</p>
          <h1 className="mx-auto mt-4 max-w-3xl font-serif text-4xl font-bold leading-tight text-wine-900 sm:text-5xl">
            Cole a conversa, descubra o que está nas entrelinhas.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-stone-600">
            Quem puxa assunto, como cada um demonstra afeto, onde estão os atritos e o que muda tudo. Uma leitura da
            dinâmica entre duas pessoas, a partir do que vocês escreveram.
          </p>
          <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
            <Link href="/analisar" className="btn-primary min-h-12 text-lg">Analisar uma conversa</Link>
            <a href="#exemplo" className="btn-secondary min-h-12">Ver um exemplo</a>
          </div>
          <p className="mt-4 text-sm text-stone-600">
            Primeira metade grátis · relatório completo {formatPrice(prices.mainCents, prices.currency)} em pagamento único
            {prices.subscriptionCents ? ` · ou assinatura com até ${SUBSCRIPTION_DAILY_LIMIT} por dia` : ""}
          </p>
        </div>
      </section>

      <section aria-labelledby="confianca" className="border-y border-wine-100 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
          <h2 id="confianca" className="sr-only">Como cuidamos da sua conversa</h2>
          <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map(({ text, Icon }) => (
              <li key={text} className="flex items-center gap-3 text-sm font-medium text-ink">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wine-50 text-wine-700">
                  <Icon className="h-5 w-5" />
                </span>
                {text}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm">
            <Link href="/privacidade" className="link">Veja como cuidamos dos seus dados</Link>
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16" aria-labelledby="como">
        <h2 id="como" className="text-center font-serif text-3xl font-bold text-wine-900">Como funciona</h2>
        {/* Linha do tempo: vertical no celular, horizontal a partir de sm. */}
        <ol className="mx-auto mt-10 max-w-md space-y-8 sm:grid sm:max-w-none sm:grid-cols-3 sm:gap-8 sm:space-y-0">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative flex gap-4 sm:flex-col sm:gap-4">
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute top-11 -bottom-6 left-[1.1875rem] w-px bg-wine-200 sm:top-5 sm:right-[-1.5rem] sm:bottom-auto sm:left-14 sm:h-px sm:w-auto"
                />
              )}
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wine-600 font-semibold text-white">{i + 1}</span>
              <div>
                <h3 className="font-semibold text-wine-900">{s.title}</h3>
                <p className="mt-1 text-sm text-stone-600">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="exemplo" className="bg-white py-16" aria-labelledby="exemplo-titulo">
        <div className="mx-auto max-w-3xl space-y-6 px-4">
          <h2 id="exemplo-titulo" className="text-center font-serif text-3xl font-bold text-wine-900">Um exemplo (fictício)</h2>
          <p className="text-center text-sm text-stone-600">Bia e Rafa não existem. A conversa e a análise abaixo foram inventadas para mostrar o formato.</p>
          <article className="card">
            <h3 className="font-serif text-xl font-semibold text-wine-900">O retrato de vocês dois</h3>
            <p className="mt-3 leading-relaxed text-stone-800">
              Bia e Rafa conversam quase todos os dias, com um tom leve e cheio de piadas internas. A conversa sugere uma
              relação em construção: os dois procuram um ao outro, mas de jeitos diferentes. Em três palavras:{" "}
              <strong>cumplicidade, ritmo, expectativa</strong>.
            </p>
          </article>
          <article className="card">
            <h3 className="font-serif text-xl font-semibold text-wine-900">O ritmo da conversa</h3>
            <p className="mt-3 leading-relaxed text-stone-800">
              Bia inicia <strong>62%</strong> das conversas depois de longos silêncios e costuma responder em poucos minutos.
              Rafa demora mais, mas escreve mensagens mais longas — um padrão que aparece principalmente à noite.
            </p>
            <blockquote className="mt-3 border-l-4 border-wine-200 pl-4 text-sm italic text-stone-600">
              “desculpa a demora, tava pensando no que você falou ontem”
            </blockquote>
          </article>
          <p className="rounded-2xl bg-wine-900 p-6 font-serif text-lg italic text-white">
            Mas o jeito como Rafa responde quando a conversa fica séria conta uma história diferente da que vimos até aqui…
          </p>
          <LockedSection position={5} lockedTitle="O dia em que algo mudou entre vocês" lengthHint="medium" headingLevel={3} unlockHref="#precos" />
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16" aria-labelledby="precos">
        <h2 id="precos" className="text-center font-serif text-3xl font-bold text-wine-900">Preço</h2>
        <div className={`mx-auto mt-8 grid gap-6 sm:grid-cols-2 ${prices.subscriptionCents ? "max-w-5xl lg:grid-cols-3" : "max-w-3xl"}`}>
          <div className="card">
            <h3 className="font-semibold text-wine-900">Relatório completo</h3>
            <p className="mt-2 text-3xl font-bold text-wine-800">{formatPrice(prices.mainCents, prices.currency)}</p>
            <p className="mt-1 text-sm font-medium text-stone-700">Pagamento único, sem recorrência.</p>
            <p className="mt-2 text-sm text-stone-600">A primeira metade é grátis. O completo tem 8 seções, com o momento de virada, quem está mais investido, os atritos e conselhos práticos.</p>
          </div>
          <div className="card">
            <h3 className="font-semibold text-wine-900">Relatórios adicionais</h3>
            <p className="mt-2 text-3xl font-bold text-wine-800">
              {prices.extraFromCents ? `${prices.extraUniform ? "" : "a partir de "}${formatPrice(prices.extraFromCents, prices.currency)}` : "—"}
            </p>
            <p className="mt-1 text-sm font-medium text-stone-700">Pagamento único por relatório.</p>
            <p className="mt-2 text-sm text-stone-600">Disponíveis depois do relatório completo, sobre a mesma conversa. Por exemplo: quem demonstra mais interesse, padrões de conflito ou como responder a última mensagem.</p>
          </div>
          {prices.subscriptionCents != null && (
            <div className="card border-2 border-wine-300">
              <h3 className="font-semibold text-wine-900">Assinatura mensal</h3>
              <p className="mt-2 text-3xl font-bold text-wine-800">
                {formatPrice(prices.subscriptionCents, prices.currency)}
                <span className="text-base font-medium text-stone-600"> /mês</span>
              </p>
              <p className="mt-1 text-sm font-medium text-stone-700">No cartão, com renovação automática. Cancele quando quiser.</p>
              <p className="mt-2 text-sm text-stone-600">
                Até {SUBSCRIPTION_DAILY_LIMIT} relatórios completos por dia, com os relatórios adicionais incluídos.
                {prices.overageCents ? ` Passou do limite no dia? Cada relatório a mais custa ${formatPrice(prices.overageCents, prices.currency)}.` : ""}
              </p>
              <Link href="/assinatura" className="btn-secondary mt-4 w-full">Conhecer a assinatura</Link>
            </div>
          )}
        </div>
      </section>

      <section className="bg-white py-16" aria-labelledby="faq">
        <div className="mx-auto max-w-3xl px-4">
          <h2 id="faq" className="text-center font-serif text-3xl font-bold text-wine-900">Perguntas frequentes</h2>
          <dl className="mt-8 space-y-6">
            {faq.map((i) => (
              <div key={i.id}>
                <dt className="font-semibold text-wine-900">{i.q}</dt>
                <dd className="mt-1 text-stone-700">{i.a}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-10 rounded-xl bg-wine-50 p-4 text-sm text-wine-900">{AI_DISCLAIMER}</p>
          <div className="mt-8 text-center">
            <Link href="/analisar" className="btn-primary min-h-12 w-full text-lg sm:w-auto">Analisar uma conversa</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
