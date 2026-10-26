import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { contactEmails, emailProvider } from "@/env";
import { LEGAL_VERSION } from "@/lib/copy";

const DESCRIPTION = "Como o Psicanalista do Amor trata os dados das conversas: criptografia, retenção, exclusão, operadores e seus direitos (LGPD).";
export const metadata: Metadata = {
  title: "Política de privacidade",
  description: DESCRIPTION,
  alternates: { canonical: "/privacidade" },
  openGraph: { title: "Política de privacidade · Psicanalista do Amor", description: DESCRIPTION, url: "/privacidade" },
};

export default function PrivacidadePage() {
  const { privacy } = contactEmails();
  return (
    <LegalPage title="Política de privacidade" version={LEGAL_VERSION}>
      <p>
        Esta política explica como o <strong>Psicanalista do Amor</strong> (controlador) trata dados pessoais, nos termos
        da Lei Geral de Proteção de Dados (Lei 13.709/2018 — LGPD).
      </p>
      <h2>1. Quais dados tratamos</h2>
      <ul>
        <li><strong>Seu e-mail</strong>: acesso às análises, link de login e avisos.</li>
        <li>
          <strong>A conversa enviada</strong> (texto, .txt, .zip ou prints): contém dados seus e de outra pessoa e pode conter
          dados sensíveis (saúde, vida sexual, religião etc.). Tratamos tudo como sensível.
        </li>
        <li><strong>Relatórios gerados</strong> a partir da conversa.</li>
        <li><strong>Registros de pagamento</strong> (valor, data, status — sem dados do cartão, que ficam com o Stripe).</li>
        <li>
          <strong>Assinatura</strong>, se você assinar: identificadores da assinatura e do cliente no Stripe, status, datas de
          renovação e quantos relatórios foram liberados por dia (para aplicar o limite diário).
        </li>
        <li><strong>Dados técnicos mínimos</strong>: hash irreversível do IP para limitar abusos; registros de consentimento.</li>
        <li>
          <strong>Registros de acesso</strong> exigidos pelo Marco Civil da Internet (Lei 12.965/2014, art. 15): endereço IP,
          data e hora do login, dos envios, das compras e das solicitações de exportação ou exclusão de dados.
        </li>
      </ul>
      <h2>2. Para que usamos</h2>
      <ul>
        <li>Gerar a análise que você pediu (execução do serviço) e cobrar por ela.</li>
        <li>Permitir que você volte às suas análises e receba avisos.</li>
        <li>Segurança e prevenção de abuso.</li>
      </ul>
      <p>Não usamos as conversas para treinar modelos, publicidade ou perfis de marketing.</p>
      <h2>3. Base legal</h2>
      <p>
        Consentimento para os seus dados; para os dados da outra pessoa, você declara participar da conversa (ou ter
        autorização) e assume a responsabilidade pelo envio. Adotamos minimização, retenção curta e criptografia como
        salvaguardas.
      </p>
      <p>
        Como a conversa pode conter dados sensíveis e é processada por IA fora do Brasil, pedimos no envio, em destaque, a
        sua autorização para o tratamento dos dados sensíveis (art. 11, I) e para a transferência internacional (art. 33,
        VIII), só para gerar o relatório. Você pode revogá-la a qualquer momento excluindo a análise ou todos os seus dados
        em Minha conta.
      </p>
      <p>
        Os registros de acesso (IP, data e hora) são guardados para cumprir obrigação legal (LGPD, art. 7º, II, e Marco Civil
        da Internet, art. 15).
      </p>
      <h2>4. Com quem compartilhamos (operadores)</h2>
      <ul>
        <li id="transferencia">
          <strong>Groq, Inc.</strong> (EUA) — atua como operadora: processa o texto da conversa, os nomes escolhidos e, quando você
          envia prints, as imagens (para ler o texto delas) para gerar o relatório. Esses dados vão para a Groq apenas para essa geração.
        </li>
        <li><strong>Stripe</strong> (EUA/Brasil) — pagamentos.</li>
        <li><strong>{emailProvider()}</strong> — envio de e-mails.</li>
        <li>
          <strong>Provedor de hospedagem, banco de dados e armazenamento de arquivos</strong> (por exemplo, Square Cloud,
          Railway, Cloudflare R2 ou AWS).
        </li>
        <li>
          <strong>Ferramenta de alertas técnicos</strong> (por exemplo, Discord), quando configurada: recebe só códigos de erro e
          identificadores técnicos, nunca conversas, nomes ou e-mails.
        </li>
      </ul>
      <p>
        Cada fornecedor recebe só o necessário para a sua função, por conexão cifrada (HTTPS), e trata os dados conforme os
        próprios termos de uso e políticas de privacidade. Como alguns ficam fora do Brasil, há transferência internacional
        de dados (art. 33 da LGPD). Nós não usamos as conversas para treinar modelos de IA.
      </p>
      <h2>5. Por quanto tempo guardamos</h2>
      <ul>
        <li>Arquivos originais (prints, .zip, .txt): apagados logo após a leitura (no máximo 24 horas).</li>
        <li>Análises não pagas: excluídas após 7 dias sem acesso.</li>
        <li>Análises pagas: excluídas após 180 dias sem acesso (avisamos por e-mail 7 dias antes).</li>
        <li>Registros de compra, sem nenhum conteúdo: 5 anos (obrigação fiscal).</li>
        <li>Logs técnicos, sem conteúdo: até 30 dias.</li>
        <li>
          Registros de acesso (IP, data e hora): 6 meses, guardados cifrados e em sigilo, mesmo que você exclua a conta
          (obrigação legal do Marco Civil da Internet). Só são entregues a você, se pedir, ou por ordem judicial.
        </li>
      </ul>
      <h2>6. Segurança</h2>
      <p>
        Conexões com HTTPS; conversas, nomes e relatórios cifrados no banco (AES-256-GCM); arquivos cifrados e apagados após
        o uso; acesso restrito ao dono da análise; registros técnicos sem conteúdo.
      </p>
      <h2>7. Seus direitos</h2>
      <ul>
        <li>Excluir uma análise ou todos os seus dados (em <a href="/conta" className="underline">Minha conta</a>).</li>
        <li>Exportar seus dados em formato JSON.</li>
        <li>Pedir informações, correção ou revogar o consentimento.</li>
      </ul>
      <h2>8. Encarregado (DPO)</h2>
      <p>
        {privacy ? (
          <>
            Contato do encarregado: <a href={`mailto:${privacy}`} className="underline">{privacy}</a>
          </>
        ) : (
          <>
            Você pode exportar ou excluir os seus dados a qualquer momento em{" "}
            <a href="/conta" className="underline">Minha conta</a>, sem precisar pedir para ninguém.
          </>
        )}
      </p>
      <h2>9. Crianças e adolescentes</h2>
      <p>O serviço é exclusivo para maiores de 18 anos. Conversas com menores são proibidas.</p>
      <h2>10. Cookies</h2>
      <p>
        Usamos um único cookie, essencial para o funcionamento: o de sessão, que mantém você conectado (até 30 dias depois de
        entrar pelo link do e-mail, ou 7 dias depois de um envio sem login). Ele não é usado para publicidade nem para medir
        audiência. Não usamos cookies de terceiros, pixels ou ferramentas de rastreamento.
      </p>
    </LegalPage>
  );
}
