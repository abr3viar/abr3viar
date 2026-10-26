import { SUBSCRIPTION_DAILY_LIMIT } from "@/lib/subscription";
import { formatPrice } from "@/lib/views";

export type FaqItem = { id: string; q: string; a: string };
export type FaqPrices = {
  mainCents: number;
  extraFromCents: number | null;
  extraUniform: boolean;
  currency: string;
  subscriptionCents?: number | null;
  overageCents?: number | null;
};

/**
 * Perguntas frequentes — fonte ÚNICA para a landing, a /ajuda e o JSON-LD `FAQPage`
 * (o texto marcado precisa ser idêntico ao visível). O preço é sempre o COBRADO.
 */
export function buildFaq(prices: FaqPrices): FaqItem[] {
  const main = formatPrice(prices.mainCents, prices.currency);
  const extra = prices.extraFromCents ? formatPrice(prices.extraFromCents, prices.currency) : null;
  const extraText = extra ? ` Cada relatório adicional custa ${prices.extraUniform ? "" : "a partir de "}${extra}.` : "";
  const sub = prices.subscriptionCents ? formatPrice(prices.subscriptionCents, prices.currency) : null;
  const overage = prices.overageCents ? formatPrice(prices.overageCents, prices.currency) : null;
  const subText = sub
    ? ` Quem analisa muitas conversas pode assinar por ${sub} por mês: até ${SUBSCRIPTION_DAILY_LIMIT} relatórios completos por dia, com os adicionais incluídos.`
    : "";
  return [
    { id: "psicanalista", q: "É uma consulta com psicanalista?", a: "Não. É uma análise de texto feita por inteligência artificial — não é consulta, sessão nem terapia. Ela pode errar e não substitui um profissional." },
    { id: "outra-pessoa", q: "A outra pessoa fica sabendo?", a: "Não. Nada é enviado para a outra pessoa." },
    { id: "quem-ve", q: "Quem consegue ver a minha conversa?", a: "Só você, entrando com o seu e-mail. A conversa fica cifrada no nosso banco e é processada pela IA só para gerar o relatório; ninguém da equipe abre conversas. Os arquivos originais são apagados logo depois de lidos." },
    { id: "quanto-custa", q: "Quanto custa?", a: `A primeira metade do relatório é grátis. O relatório completo custa ${main}, em pagamento único.${extraText}${subText} Esses são os valores finais, já com as tarifas de pagamento.` },
    {
      id: "como-pago",
      q: "Como pago?",
      a: `Com cartão ou Pix, pelo Stripe. A liberação é automática quando o pagamento é confirmado.${sub ? " A assinatura mensal é só no cartão, com renovação automática." : ""}`,
    },
    ...(sub
      ? [
          {
            id: "assinatura",
            q: "Como funciona a assinatura?",
            a: `Custa ${sub} por mês, cobrados no cartão com renovação automática. Você libera até ${SUBSCRIPTION_DAILY_LIMIT} relatórios completos por dia (o limite renova à meia-noite, horário de Brasília, e o que não for usado não acumula), e os relatórios adicionais ficam incluídos.${overage ? ` Se precisar de mais relatórios completos no mesmo dia, cada um a mais custa ${overage}.` : ""} Para usar, entre pelo link enviado ao seu e-mail. Você cancela quando quiser em Minha conta, e o acesso continua até o fim do período já pago.`,
          },
        ]
      : []),
    { id: "nao-liberou", q: "O que faço se paguei e o relatório não liberou?", a: "Cartão costuma liberar em segundos; Pix pode levar alguns instantes. Você recebe um e-mail quando o relatório estiver pronto para ler. Se passar de 1 hora, escreva para o contato da Ajuda com o e-mail usado na compra." },
    {
      id: "reembolso",
      q: "Como peço reembolso?",
      a: `Você pode pedir reembolso em até 7 dias após a compra: escreva para o contato da Ajuda com o e-mail usado na compra. Se o relatório não foi entregue por uma falha nossa, o reembolso vale mesmo depois desse prazo. Com o reembolso, o acesso ao relatório correspondente é encerrado.${sub ? " Na assinatura, o prazo de 7 dias vale para a primeira cobrança; com o reembolso, a assinatura e os relatórios liberados por ela são encerrados." : ""}`,
    },
    { id: "apagar", q: "Como apago meus dados?", a: "Em cada análise há a opção \"Excluir esta análise\". Em Minha conta você pode excluir tudo. As análises também são apagadas automaticamente depois de um tempo sem acesso." },
    { id: "grupo", q: "Posso analisar conversas de grupo?", a: "Sim. Você escolhe as duas pessoas que serão analisadas." },
  ];
}

/** As perguntas que aparecem na landing (as demais ficam na /ajuda). */
export const LANDING_FAQ_IDS = ["psicanalista", "outra-pessoa", "quem-ve", "quanto-custa", "como-pago"];

/** JSON-LD FAQPage (escapado para ir num <script type="application/ld+json">). */
export function faqJsonLd(items: FaqItem[]): string {
  return jsonLd({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })),
  });
}

/** JSON.stringify seguro para <script>: "<" vira < (não fecha a tag). */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
