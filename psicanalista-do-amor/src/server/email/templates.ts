import "server-only";
import { getEnv } from "@/env";

/** E-mails transacionais (pt-BR). Nunca incluem conteúdo da conversa nem nomes. */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${escapeHtml(cta.url)}" style="background:#b42a53;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">${escapeHtml(cta.label)}</a></p>`
    : "";
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#fffaf6;font-family:Arial,Helvetica,sans-serif;color:#2a1a20">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<p style="font-family:Georgia,serif;font-size:18px;color:#7c1d3c;font-weight:bold">💬 Psicanalista do Amor</p>
<h1 style="font-size:22px;margin:16px 0">${escapeHtml(title)}</h1>
${bodyHtml}${button}
<p style="font-size:12px;color:#78716c;margin-top:32px">Os relatórios são gerados por inteligência artificial e não substituem aconselhamento profissional.<br>Você recebeu este e-mail porque usou o Psicanalista do Amor com este endereço.</p>
</div></body></html>`;
}

const url = (p: string) => new URL(p, getEnv().APP_URL).toString();

export function magicLinkEmail(token: string) {
  const link = url(`/entrar/verificar?token=${encodeURIComponent(token)}`);
  return {
    subject: "Seu link para entrar no Psicanalista do Amor",
    html: layout(
      "Seu link de acesso",
      `<p>Clique no botão para entrar e ver suas análises. O link vale por <strong>15 minutos</strong> e só pode ser usado uma vez.</p><p style="font-size:13px;color:#78716c">Se não foi você que pediu, ignore este e-mail.</p>`,
      { label: "Entrar", url: link },
    ),
    text: `Seu link para entrar (vale 15 minutos, uso único): ${link}\n\nSe não foi você que pediu, ignore este e-mail.`,
  };
}

export function analysisReadyEmail(conversationId: string) {
  const link = url(`/r/${conversationId}`);
  return {
    subject: "Sua análise está pronta",
    html: layout(
      "Sua análise está pronta",
      `<p>A primeira metade do seu relatório já pode ser lida. Para abrir em outro aparelho, peça um link de acesso com este e-mail.</p>`,
      { label: "Ler o relatório", url: link },
    ),
    text: `Sua análise está pronta. A primeira metade do relatório já pode ser lida: ${link}`,
  };
}

export function reportUnlockedEmail(conversationId: string) {
  const link = url(`/r/${conversationId}`);
  return {
    subject: "Seu relatório completo foi liberado",
    html: layout("Pagamento confirmado!", `<p>Seu relatório completo já está liberado. Obrigado pela confiança.</p>`, {
      label: "Ler o relatório completo",
      url: link,
    }),
    text: `Pagamento confirmado! Leia o relatório completo: ${link}`,
  };
}

export function extraReadyEmail(conversationId: string, slug: string, reportName: string) {
  const link = url(`/r/${conversationId}/extra/${slug}`);
  return {
    subject: `Seu relatório "${reportName}" está pronto`,
    html: layout(`"${reportName}" está pronto`, `<p>O relatório adicional que você comprou já pode ser lido.</p>`, {
      label: "Ler agora",
      url: link,
    }),
    text: `Seu relatório "${reportName}" está pronto: ${link}`,
  };
}

export function retentionWarningEmail(conversationId: string, deleteOn: string) {
  const link = url(`/r/${conversationId}`);
  return {
    subject: "Sua análise será apagada em 7 dias",
    html: layout(
      "Sua análise será apagada em breve",
      `<p>Para proteger seus dados, apagamos análises sem acesso por muito tempo. Esta será excluída em <strong>${escapeHtml(deleteOn)}</strong>, com a conversa e os relatórios. Basta abri-la para mantê-la por mais tempo.</p>`,
      { label: "Abrir minha análise", url: link },
    ),
    text: `Sua análise será apagada em ${deleteOn}. Abra para mantê-la: ${link}`,
  };
}

export function dataDeletedEmail() {
  return {
    subject: "Seus dados foram excluídos",
    html: layout(
      "Seus dados foram excluídos",
      `<p>Conforme pedido, excluímos suas análises, conversas e relatórios. Registros de compra são mantidos apenas pelo prazo fiscal, sem nenhum conteúdo.</p>`,
    ),
    text: "Seus dados foram excluídos. Registros de compra são mantidos apenas pelo prazo fiscal, sem conteúdo.",
  };
}
