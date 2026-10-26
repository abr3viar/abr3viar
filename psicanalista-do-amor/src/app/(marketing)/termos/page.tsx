import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { LEGAL_VERSION } from "@/lib/copy";
import { formatPrice } from "@/lib/views";
import { publicPrices } from "@/server/reports/pricing";
import { SUBSCRIPTION_DAILY_LIMIT } from "@/lib/subscription";

const DESCRIPTION = "Termos de uso do Psicanalista do Amor: o serviço, quem pode usar, preços, pagamento, entrega e reembolso.";
export const metadata: Metadata = {
  title: "Termos de uso",
  description: DESCRIPTION,
  alternates: { canonical: "/termos" },
  openGraph: { title: "Termos de uso · Psicanalista do Amor", description: DESCRIPTION, url: "/termos" },
};

export default async function TermosPage() {
  const prices = await publicPrices();
  return (
    <LegalPage title="Termos de uso" version={LEGAL_VERSION}>
      <p>
        Estes termos regem o uso do <strong>Psicanalista do Amor</strong>, um serviço digital de análise de texto por
        inteligência artificial (IA). Ao enviar uma conversa, você declara ter lido e aceitado estes termos e a{" "}
        <a href="/privacidade" className="underline">Política de Privacidade</a>. Ao aceitar, você também declara que{" "}
        <strong>participa da conversa enviada</strong> (ou tem autorização para analisá-la) e que entende que{" "}
        <strong>os relatórios são gerados por inteligência artificial</strong> e não substituem aconselhamento profissional.
      </p>
      <h2>1. O que o serviço é — e o que não é</h2>
      <p>
        O serviço gera, por IA, uma leitura da dinâmica de comunicação entre duas pessoas a partir do texto enviado. A
        análise <strong>pode conter erros</strong> e <strong>não substitui aconselhamento psicológico, jurídico ou de
        qualquer outro profissional</strong>. Não é consulta, sessão, terapia nem diagnóstico, apesar do nome.
      </p>
      <h2>2. Quem pode usar</h2>
      <ul>
        <li>Pessoas com 18 anos ou mais.</li>
        <li>Somente para conversas das quais você participa ou que tem autorização para analisar.</li>
      </ul>
      <h2>3. Usos proibidos</h2>
      <ul>
        <li>Enviar conversas envolvendo menores de 18 anos.</li>
        <li>Enviar conversas obtidas sem autorização (por exemplo, do celular de outra pessoa).</li>
        <li>Usar o serviço para assédio, perseguição, chantagem, exposição ou qualquer forma de violência.</li>
        <li>Tentar burlar limites técnicos, de pagamento ou de segurança.</li>
      </ul>
      <h2>4. Sua responsabilidade sobre os dados enviados</h2>
      <p>
        As conversas contêm dados de outra pessoa. Ao enviar, você declara participar da conversa (ou ter autorização) e
        assume a responsabilidade pelo envio. Recomendamos remover informações que não sejam necessárias.
      </p>
      <h2>5. Preços e pagamento</h2>
      <ul>
        <li>A primeira metade do relatório principal é gratuita. O relatório completo custa {formatPrice(prices.mainCents, prices.currency)} (preço final, já com as tarifas de pagamento).</li>
        <li>
          Relatórios adicionais custam{" "}
          {prices.extraFromCents
            ? `${prices.extraUniform ? "" : "a partir de "}${formatPrice(prices.extraFromCents, prices.currency)} cada`
            : "o valor indicado na vitrine"}{" "}
          e ficam disponíveis após a compra do relatório completo.
        </li>
        <li>
          Cada compra avulsa (relatório completo ou adicional) é um pagamento único, sem cobranças recorrentes. A assinatura
          mensal, descrita abaixo, é opcional e só começa quando você a contrata.
        </li>
        <li>O preço exibido antes do pagamento é o valor total cobrado, sem acréscimos.</li>
        <li>Pagamentos são processados pelo Stripe (cartão ou Pix). A liberação ocorre após a confirmação do pagamento.</li>
      </ul>
      {prices.subscriptionCents != null && (
        <>
          <h3 className="mt-4 font-semibold text-wine-900">Assinatura mensal</h3>
          <ul>
            <li>
              Custa {formatPrice(prices.subscriptionCents, prices.currency)} por mês (preço final), cobrados no cartão pelo Stripe,
              com renovação automática a cada mês até você cancelar.
            </li>
            <li>
              Dá direito a liberar até {SUBSCRIPTION_DAILY_LIMIT} relatórios completos por dia. O dia é contado no horário de
              Brasília e o limite renova à meia-noite; relatórios não usados no dia não acumulam. Os relatórios adicionais das
              conversas com o relatório completo liberado ficam incluídos enquanto a assinatura estiver ativa.
            </li>
            {prices.overageCents != null && (
              <li>
                Depois de usar o limite do dia, cada relatório completo a mais custa {formatPrice(prices.overageCents, prices.currency)}, em
                pagamento único.
              </li>
            )}
            <li>
              Para usar a assinatura, é preciso entrar pelo link enviado ao e-mail da assinatura. A assinatura é pessoal e fica
              ligada a esse e-mail.
            </li>
            <li>
              Você pode cancelar a qualquer momento em Minha conta. O cancelamento vale ao fim do período já pago: até lá, o acesso
              continua; depois, não há novas cobranças. Relatórios liberados durante a assinatura continuam disponíveis.
            </li>
            <li>Se uma cobrança da renovação não for aprovada, o uso fica suspenso até o pagamento ser regularizado.</li>
          </ul>
        </>
      )}
      <h2>6. Entrega e reembolso</h2>
      <p>
        O conteúdo é digital, como informado junto do botão de pagamento. O relatório completo é liberado assim que o
        pagamento é confirmado; os relatórios adicionais começam a ser gerados nesse momento e ficam prontos em poucos
        minutos.
      </p>
      <ul>
        <li>
          Você pode pedir o reembolso em até 7 dias após a compra, pelo contato da página de{" "}
          <a href="/ajuda" className="underline">Ajuda</a>, informando o e-mail usado na compra.
        </li>
        <li>Se o relatório não for entregue ou houver uma falha técnica que não consigamos resolver, fazemos o reembolso mesmo depois desse prazo.</li>
        {prices.subscriptionCents != null && (
          <li>
            Na assinatura, o prazo de 7 dias vale a partir da primeira cobrança. Com o reembolso de uma cobrança da assinatura, a
            assinatura é encerrada e os relatórios liberados por ela voltam a ficar bloqueados (os comprados à parte continuam).
            Se uma cobrança da assinatura for contestada junto ao banco ou à operadora do cartão, a assinatura é cancelada.
          </li>
        )}
        <li>
          Com o reembolso, ou se o pagamento for contestado junto ao banco ou à operadora do cartão, o acesso ao relatório
          correspondente é encerrado.
        </li>
      </ul>
      <h2>7. Disponibilidade e limites</h2>
      <p>
        Fazemos o possível para manter o serviço disponível e funcionando bem, mas a análise é feita por IA e pode conter
        erros (seção 1). Podemos limitar envios, tamanhos e frequência para proteger o sistema. Conversas muito curtas podem
        gerar relatórios pouco confiáveis. Nada nestes termos afasta ou limita os direitos garantidos pelo Código de Defesa
        do Consumidor.
      </p>
      <h2>8. Exclusão e retenção</h2>
      <p>
        Você pode excluir uma análise ou todos os seus dados a qualquer momento. Prazos de retenção estão na Política de
        Privacidade.
      </p>
      <h2>9. Alterações</h2>
      <p>Estes termos podem mudar. A versão aceita fica registrada a cada envio.</p>
      <h2>10. Lei e foro</h2>
      <p>Aplicam-se as leis brasileiras, incluindo o Código de Defesa do Consumidor e a LGPD.</p>
    </LegalPage>
  );
}
