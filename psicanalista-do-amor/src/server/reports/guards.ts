import "server-only";

/**
 * Proteções do servidor para o que aparece ANTES do pagamento e foi escrito pela IA
 * (gancho e títulos bloqueados): o prompt pede para não revelar, o servidor confere.
 */

/** minúsculas, sem acento, só letras/números separados por espaço. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const STOPWORDS = new Set(
  "a o as os um uma uns umas de da do das dos e em no na nos nas que com por para pra se sua seu suas seus como mais menos entre voces vcs voce ele ela eles elas isso esse essa este esta quando onde quem qual".split(" "),
);

function significantWords(s: string): string[] {
  return normalizeText(s)
    .split(" ")
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Partes reconhecíveis de cada nome: o nome completo e cada parte com 3+ letras que não seja
 * conectivo ("Ana Júlia Souza" → "ana julia souza", "ana", "julia", "souza").
 */
export function nameParts(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names.map(normalizeText).filter((x) => x.length >= 2)) {
    out.add(n);
    for (const p of n.split(" ")) if (p.length >= 3 && !STOPWORDS.has(p)) out.add(p);
  }
  return [...out];
}

/** true se o texto menciona algum dos nomes (nome completo ou qualquer parte; sem acento/caixa). */
export function mentionsName(text: string, names: string[]): boolean {
  const norm = ` ${normalizeText(text)} `;
  return nameParts(names).some((n) => norm.includes(` ${n} `));
}

/**
 * Título para uma seção BLOQUEADA: o `locked_title` da IA só é aceito se não for o título
 * real, não citar os nomes e não repetir mais da metade das palavras do título real
 * (que pode ter spoiler). Caso contrário, usa o título neutro fixo.
 */
export function safeLockedTitle(locked: string | null, realTitle: string, names: string[], fallback: string): string {
  const candidate = (locked ?? "").replace(/\s+/g, " ").trim();
  if (candidate.length < 4 || candidate.length > 120) return fallback;
  if (normalizeText(candidate) === normalizeText(realTitle)) return fallback;
  if (mentionsName(candidate, names)) return fallback;
  // Horários, datas e porcentagens costumam ser o próprio achado ("As 23h que mudam tudo").
  if (/\d{1,2}\s?h\b|\d{1,2}:\d{2}|\d\s?%|\d{1,2}\/\d{1,2}|\b(?:19|20)\d{2}\b/i.test(candidate)) return fallback;
  if (anticipatesPaidConclusion(candidate)) return fallback;
  const real = new Set(significantWords(realTitle));
  const words = significantWords(candidate);
  if (words.length && real.size) {
    const overlap = words.filter((w) => real.has(w)).length;
    if (overlap / words.length > 0.5) return fallback;
  }
  return candidate;
}

/**
 * Gancho aceitável: cita uma das pessoas pelo nome e não traz números/horários/datas
 * (que costumam ser o próprio achado da segunda metade).
 */
export function isSafeHook(hook: string, names: string[]): boolean {
  const h = hook.trim();
  if (h.length < 10 || h.length > 300) return false;
  if (!mentionsName(h, names)) return false;
  // Números no nome da pessoa (ex.: "Ana2") não contam.
  let rest = ` ${normalizeText(h)} `;
  for (const n of nameParts(names).sort((x, y) => y.length - x.length)) rest = rest.split(` ${n} `).join(" ");
  if (/\p{N}/u.test(rest)) return false;
  return !anticipatesPaidConclusion(h);
}

/**
 * Conclusões que pertencem às seções PAGAS (investimento, virada, atritos, leitura final)
 * e não podem aparecer nas grátis (IA-5). Conservador: só expressões inequívocas.
 */
const PAID_CONCLUSION_PATTERNS: RegExp[] = [
  // "é/está/parece o mais investido" (não "mais interessados em séries")
  /\b(?:e|esta|parece|parecem|se mostra|demonstra|demonstram|sao|estao) (?:o |a |os |as )?(?:mais|menos) (?:investid|envolvid|apegad|empenhad|interessad)\w*\b(?! (?:em|por) (?!voce\b|ele\b|ela\b|mim\b|ti\b|nele\b|nela\b)\w)/,
  /\bquem (?:gosta|se importa|investe|se esforca|corre atras|se dedica) mais\b/,
  /\b(?:momento|ponto) de virada\b/,
  /\besta (?:se afastando|esfriando|perdendo o interesse)\b/,
  /\b(?:relacao|namoro|relacionamento|isso|isso entre voces|voces dois) (?:vai|deve|pode) (?:terminar|acabar)\b/,
  /\b(?:meu|primeiro|segundo|terceiro) conselho\b|\bconselhos praticos\b/,
];

/** true se o texto de uma seção grátis antecipa uma conclusão da segunda metade. */
export function anticipatesPaidConclusion(content: string): boolean {
  const norm = normalizeText(content);
  return PAID_CONCLUSION_PATTERNS.some((re) => re.test(norm));
}

/**
 * Termos de risco GRAVE (normalizados: minúsculas, sem acento). Na dúvida, o alerta liga:
 * um falso positivo custa só o gancho de venda; um falso negativo pode custar uma vida.
 */
const GRAVE = new RegExp(
  [
    "amea", "violen", "agress", "\\bbat(?:e|eu|er|endo|ia)\\b", "\\btapa", "\\bsoco", "empurr", "machuc", "\\barma\\b", "\\bfaca\\b",
    "suic", "\\bmorr", "\\bmatar\\b", "\\bmato\\b", "se matar", "\\bviver\\b", "sumir do mundo", "autoles", "cortar os pulsos", "se cortar",
    "estupr", "abus", "coerc", "coag", "chantag", "fotos intimas", "\\bnudes?\\b", "expor",
    "perseg", "vigia", "rastre", "controla", "proib", "senha",
    "menor de idade", "crianca", "adolescente", "\\b(?:1[0-7]|[5-9]) anos\\b",
  ].join("|"),
);

/** Algum termo grave no texto? (usado no alerta da IA e nas notas do map) */
export function hasGraveSignal(text: string): boolean {
  return GRAVE.test(normalizeText(text));
}

/**
 * A seção "alerta" escrita pela IA indica risco de verdade? Só deixa de contar quando a
 * primeira frase é uma negação completa ("Não há sinais de risco…") E o texto não traz
 * nenhum termo grave, nenhuma ressalva ("mas", "porém"…) nem medo/insegurança/isolamento.
 * Na dúvida, conta.
 */
export function isRealAlert(section: { content: string } | undefined): boolean {
  if (!section || section.content.trim().length < 40) return false;
  if (hasGraveSignal(section.content)) return true;
  const norm = normalizeText(section.content);
  if (/\b(?:mas|porem|contudo|entretanto|todavia|no entanto|ainda assim|apesar)\b/.test(norm)) return true;
  if (/medo|insegur|seguro|segura|isola|assust|furios|ciume|obsess|exige|proib|control/.test(norm)) return true;
  const sentences = section.content.split(/[.!?\n]/).filter((x) => x.trim() !== "");
  // Qualquer frase além da negação (ex.: "Ele diz que se ela terminar, ela vai se arrepender") conta.
  if (sentences.length > 1) return true;
  const first = normalizeText(sentences[0] ?? "");
  const fullNegation = /^(?:nao ha|nao foram encontrad\w*|nao encontramos|sem|nenhum) (?:\w+ ){0,3}(?:sinal|sinais|indicio|indicios|risco|riscos)\b/;
  return !fullNegation.test(first);
}

/**
 * Notas do map: QUALQUER sinal de risco registrado liga o alerta. Não há descarte por
 * "piada": chamar de brincadeira é a forma clássica de minimizar abuso, e o resumo já é
 * instruído a não registrar brincadeiras evidentes. Falso positivo custa só o gancho.
 */
export function seriousSafetyConcerns(concerns: string[]): boolean {
  return concerns.some((c) => normalizeText(c) !== "");
}
