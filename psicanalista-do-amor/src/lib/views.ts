/**
 * Tipos de VIEW que chegam aos componentes (CLAUDE.md: componentes nunca recebem
 * linhas do banco). Sem dependências de servidor.
 */

export type Evidence = { seq: number; quote: string };

export type OpenSectionView = {
  kind: "open";
  position: number;
  key: string;
  title: string;
  contentMarkdown: string;
  evidence: Evidence[];
  isSafety: boolean;
};

/** Seção bloqueada: SÓ o título instigante e uma faixa de tamanho (nada do conteúdo real). */
export type LockedSectionView = {
  kind: "locked";
  position: number;
  lockedTitle: string;
  lengthHint: "short" | "medium" | "long";
};

export type SectionView = OpenSectionView | LockedSectionView;

export type VerdictView = { label: string; score: number | null; explanation: string };

export type ReportView = {
  reportId: string;
  conversationId: string;
  slug: string;
  kind: "main" | "extra";
  name: string;
  status: "pending_payment" | "queued" | "generating" | "ready" | "failed";
  errorCode: string | null;
  isUnlocked: boolean;
  /** Frase-gancho: só enviada enquanto o relatório está bloqueado. */
  hook: string | null;
  participants: { a: string; b: string };
  sections: SectionView[];
  safetyFlag: boolean;
  verdict: VerdictView | null;
  priceCents: number;
  currency: string;
  /** false quando o Payment Link ainda não foi configurado no /admin. */
  purchasable: boolean;
  progress: { step: string; current?: number; total?: number } | null;
};

export type ExtraOfferView = {
  slug: string;
  name: string;
  teaser: string;
  description: string;
  priceCents: number;
  currency: string;
  purchasable: boolean;
  /** Estado do relatório adicional desta conversa, se já existir. */
  state: "available" | "pending_payment" | "queued" | "generating" | "ready" | "failed";
  reportId: string | null;
  blockedReason: "needs_user_side" | null;
};

/** Assinatura mensal (D96) do usuário logado com sessão verificada. */
export type SubscriptionStateView = {
  /** Dá direito ao uso agora. */
  active: boolean;
  /** Status do Stripe (active, past_due, canceled...) ou "revoked" (cobrança reembolsada). */
  status: string;
  /** Fim do período pago (ISO), se conhecido. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  usedToday: number;
  dailyLimit: number;
  remainingToday: number;
};

/** Oferta pública da assinatura e do relatório além do limite (preços cobrados, do banco). */
export type SubscriptionOfferView = {
  priceCents: number;
  overagePriceCents: number | null;
  currency: string;
  dailyLimit: number;
  purchasable: boolean;
  overagePurchasable: boolean;
};

export type ConversationStatusView = {
  status: "uploaded" | "processing" | "needs_confirmation" | "generating" | "ready" | "failed" | "deleted";
  progress: { step: string; current?: number; total?: number } | null;
  errorCode: string | null;
  /** false = falha permanente (formato não reconhecido, originais já apagados): só reenviando. */
  canRetry: boolean;
};

export function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export type SenderView = {
  index: number;
  label: string;
  count: number;
  samples: string[];
  side: "left" | "right" | null;
  suggested: "a" | "b" | "other";
};

export const TIMEZONES: { value: string; label: string }[] = [
  { value: "America/Sao_Paulo", label: "Brasília (SP, RJ, MG, Sul, GO, DF…)" },
  { value: "America/Manaus", label: "Amazonas (Manaus)" },
  { value: "America/Cuiaba", label: "Mato Grosso (Cuiabá)" },
  { value: "America/Campo_Grande", label: "Mato Grosso do Sul" },
  { value: "America/Porto_Velho", label: "Rondônia" },
  { value: "America/Boa_Vista", label: "Roraima" },
  { value: "America/Rio_Branco", label: "Acre" },
  { value: "America/Noronha", label: "Fernando de Noronha" },
  { value: "America/Belem", label: "Pará / Amapá" },
  { value: "America/Fortaleza", label: "Nordeste (CE, RN, PB, PI, MA)" },
  { value: "America/Recife", label: "Pernambuco" },
  { value: "America/Bahia", label: "Bahia" },
  { value: "America/Maceio", label: "Alagoas / Sergipe" },
  { value: "Europe/Lisbon", label: "Portugal (Lisboa)" },
  { value: "America/New_York", label: "EUA — Leste" },
  { value: "Europe/London", label: "Reino Unido" },
];
