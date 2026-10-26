/**
 * Repasse da taxa do Stripe: o preço cobrado é calculado para que, depois da taxa,
 * chegue ao dono exatamente o valor LÍQUIDO configurado (ex.: R$ 10,00).
 *
 *   bruto = arredondar_para_cima( (líquido + taxa_fixa) / (1 − taxa_percentual) )
 */
export type StripeFees = { percent: number; fixedCents: number };

export function grossFromNet(netCents: number, fees: StripeFees): number {
  if (netCents <= 0) return 0;
  const rate = fees.percent / 100;
  if (rate < 0 || rate >= 1) throw new Error("taxa percentual inválida");
  let gross = Math.ceil((netCents + fees.fixedCents) / (1 - rate));
  // Garante que o líquido (bruto − taxa arredondada) nunca fique abaixo do desejado.
  while (netFromGross(gross, fees) < netCents) gross += 1;
  return gross;
}

/** Quanto sobra de um valor bruto depois da taxa (taxa arredondada para cima, pior caso). */
export function netFromGross(grossCents: number, fees: StripeFees): number {
  const fee = Math.ceil((grossCents * fees.percent) / 100) + fees.fixedCents;
  return grossCents - fee;
}

/**
 * "10", "10,5", "10,50" ou "10.50" → centavos. Só UM separador decimal seguido de 1–2
 * dígitos: "10.50" nunca vira R$ 1.050 (separador de milhar não é aceito). Inválido → null.
 */
export function parseBrlToCents(input: string): number | null {
  const m = /^(\d{1,5})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
}
