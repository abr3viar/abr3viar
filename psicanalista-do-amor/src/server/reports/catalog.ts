/**
 * Catálogo inicial de `report_types` (plano.md 5.5 e 5.6). Usado pelo seed idempotente.
 *
 * O seed só INSERE tipos que não existem (com o preço bruto calculado a partir do líquido)
 * e atualiza os campos "do código"
 * (`prompt_template`, `output_schema_version`, `requires_user_side`, `kind`).
 * Preço, moeda, nome, textos de vitrine, Payment Links e `is_active` são do painel /admin
 * e nunca são sobrescritos depois da criação.
 */

export type CatalogEntry = {
  slug: string;
  kind: "main" | "extra" | "subscription" | "overage";
  name: string;
  teaser: string;
  description: string;
  /** Valor LÍQUIDO desejado (o preço cobrado é calculado com a taxa do Stripe). */
  netPriceCents: number;
  currency: "brl";
  promptTemplate: string;
  outputSchemaVersion: number;
  sortOrder: number;
  requiresUserSide: boolean;
};

export const MAIN_REPORT_SLUG = "principal";
/** Assinatura mensal (D96): até SUBSCRIPTION_DAILY_LIMIT relatórios completos por dia, adicionais incluídos. */
export const SUBSCRIPTION_SLUG = "assinatura-mensal";
/** Relatório completo do assinante depois de usar o limite do dia (pagamento avulso, D96). */
export const OVERAGE_SLUG = "relatorio-alem-do-limite";

export const CATALOG: CatalogEntry[] = [
  {
    slug: MAIN_REPORT_SLUG,
    kind: "main",
    name: "Relatório completo",
    teaser: "A leitura completa da dinâmica entre vocês: as 8 seções.",
    description:
      "Retrato, ritmo, temas, estilos, o momento de virada, quem está mais investido, os pontos de atrito e a leitura final com conselhos práticos.",
    netPriceCents: 3000,
    currency: "brl",
    // O prompt do relatório principal fica versionado em src/server/ai/prompts/main-report.ts.
    promptTemplate: "main-report",
    outputSchemaVersion: 1,
    sortOrder: 0,
    requiresUserSide: false,
  },
  {
    slug: "quem-gosta-mais",
    kind: "extra",
    name: "Quem demonstra mais interesse?",
    teaser: "Um placar de investimento com os sinais de cada lado.",
    description:
      "Compara iniciativa, tempo de resposta, perguntas, carinho e esforço de cada pessoa e mostra um placar de interesse com as evidências.",
    netPriceCents: 1000,
    currency: "brl",
    promptTemplate: `OBJETIVO: avaliar qual das duas pessoas demonstra mais interesse/investimento na relação, com base em comportamentos observáveis.

SEÇÕES (nesta ordem, use exatamente estas keys):
1. key "sinais-a": "Os sinais de interesse de {A}" — iniciativa, perguntas, retomadas de assunto, carinho, esforço; cite evidências.
2. key "sinais-b": "Os sinais de interesse de {B}" — idem.
3. key "desequilibrios": "Onde o esforço não é igual" — momentos em que um puxa e o outro não acompanha (use os números de stats).
4. key "o-que-significa": "O que esse placar quer dizer" — interpretação cautelosa; interesse demonstrado não é o mesmo que sentimento.

VERDICT (obrigatório): "score" = porcentagem (0–100) de interesse demonstrado por {A} em relação ao total ({B} = 100 − score); "label" no formato "{Nome} demonstra mais interesse" (ou "Interesse equilibrado") — o sistema confere o label pelo score (acima de 55: {A}; abaixo de 45: {B}; de 45 a 55: equilibrado), então escolha um score coerente com a análise; "explanation" em 1–2 frases, coerente com o score e sem números que não estejam nas ESTATÍSTICAS.`,
    outputSchemaVersion: 1,
    sortOrder: 10,
    requiresUserSide: false,
  },
  {
    slug: "red-flags",
    kind: "extra",
    name: "Red flags e sinais de alerta",
    teaser: "Padrões que merecem atenção — e o que fazer com eles.",
    description:
      "Identifica padrões preocupantes (controle, desrespeito, chantagem emocional, sumiços) com cuidado e evidências, e indica recursos de ajuda quando couber.",
    netPriceCents: 1000,
    currency: "brl",
    promptTemplate: `OBJETIVO: identificar padrões de comunicação que merecem atenção (controle, ciúme possessivo, desrespeito, chantagem emocional, desvalorização, sumiços e retornos, pressão), sem rotular pessoas e sem diagnóstico.

SEÇÕES (nesta ordem, use exatamente estas keys):
1. key "panorama": "O panorama geral" — o nível geral de atenção que a conversa pede (baixo, moderado, alto) e por quê.
2. key "sinais": "Os sinais que apareceram" — lista de padrões observados, cada um com quem, quando e evidência. Se não houver, diga claramente.
3. key "sinais-positivos": "O que é saudável aqui" — contrapontos reais.
4. key "o-que-fazer": "O que fazer com isso" — orientações práticas e respeitosas.

Se houver qualquer sinal de violência, ameaça, controle extremo, ideação suicida ou risco à integridade, marque "safety_flag": true e inclua uma seção key "alerta" (primeira posição) com Ligue 180, CVV 188 e 190.

VERDICT (opcional): "label" com o nível de atenção (ex.: "Atenção moderada"), "score" 0–100 (quanto maior, mais atenção), "explanation" curta.`,
    outputSchemaVersion: 1,
    sortOrder: 20,
    requiresUserSide: false,
  },
  {
    slug: "linguagem-do-amor",
    kind: "extra",
    name: "A linguagem do amor de cada um",
    teaser: "Como cada um demonstra — e pede — afeto.",
    description:
      "Mostra como cada pessoa expressa carinho (palavras, tempo, gestos, presença) e o que parece pedir do outro, com sugestões para se entenderem melhor.",
    netPriceCents: 1000,
    currency: "brl",
    promptTemplate: `OBJETIVO: descrever como cada pessoa demonstra e pede afeto na conversa (palavras de afirmação, tempo de qualidade, atos de serviço, presentes, toque/presença física mencionada), sem tratar isso como teste científico.

SEÇÕES (nesta ordem, use exatamente estas keys):
1. key "como-a-demonstra": "Como {A} demonstra afeto" — com evidências.
2. key "como-b-demonstra": "Como {B} demonstra afeto" — com evidências.
3. key "o-que-cada-um-pede": "O que cada um parece pedir" — pedidos explícitos e implícitos.
4. key "desencontros": "Onde as linguagens se desencontram" — e como aproximar.

VERDICT: não use (deixe null).`,
    outputSchemaVersion: 1,
    sortOrder: 30,
    requiresUserSide: false,
  },
  {
    slug: "conflitos",
    kind: "extra",
    name: "Padrões de conflito",
    teaser: "Gatilhos, reações e como as brigas terminam.",
    description:
      "Mapeia o que costuma gerar tensão, como cada um reage (ataque, defesa, silêncio, humor) e como os conflitos se resolvem — ou não.",
    netPriceCents: 1000,
    currency: "brl",
    promptTemplate: `OBJETIVO: mapear os padrões de conflito entre as duas pessoas.

SEÇÕES (nesta ordem, use exatamente estas keys):
1. key "gatilhos": "O que costuma acender a tensão" — temas e situações recorrentes, com evidências.
2. key "reacoes": "Como cada um reage" — estilos de reação de {A} e de {B} (confronto, defesa, retirada, humor, conciliação).
3. key "desfechos": "Como as brigas terminam" — quem cede, quem retoma, o que fica sem resolver.
4. key "caminhos": "Como brigar melhor" — 3 a 5 sugestões práticas e específicas para este par.

Se a conversa não tiver conflitos relevantes, diga isso com honestidade e foque nos pequenos atritos.

VERDICT: não use (deixe null).`,
    outputSchemaVersion: 1,
    sortOrder: 40,
    requiresUserSide: false,
  },
  {
    slug: "futuro",
    kind: "extra",
    name: "Compatibilidade e futuro",
    teaser: "Pontos fortes, riscos e os cenários possíveis.",
    description:
      "Avalia o que une e o que afasta vocês, os riscos para a relação e cenários possíveis daqui para frente — sem previsões mágicas.",
    netPriceCents: 1000,
    currency: "brl",
    promptTemplate: `OBJETIVO: avaliar a compatibilidade de comunicação e os cenários possíveis para a relação, com cautela (não é previsão).

SEÇÕES (nesta ordem, use exatamente estas keys):
1. key "pontos-fortes": "O que joga a favor de vocês" — com evidências.
2. key "riscos": "O que pode atrapalhar" — com evidências.
3. key "cenarios": "Três cenários possíveis" — um otimista, um realista e um de alerta, cada um com o que precisaria acontecer.
4. key "proximos-passos": "O que depende de cada um" — atitudes concretas.

VERDICT (obrigatório): "label" curto (ex.: "Boa compatibilidade com ajustes"), "score" 0–100 de compatibilidade de comunicação, "explanation" em 1–2 frases.`,
    outputSchemaVersion: 1,
    sortOrder: 50,
    requiresUserSide: false,
  },
  {
    slug: "como-responder",
    kind: "extra",
    name: "Como responder a última mensagem",
    teaser: "Três respostas possíveis, em tons diferentes, para a última mensagem.",
    description:
      "Analisa a última mensagem recebida e sugere 3 respostas em tons diferentes, explicando o efeito provável de cada uma. Exige saber quem é você na conversa.",
    netPriceCents: 1000,
    currency: "brl",
    promptTemplate: `OBJETIVO: ajudar o USUÁRIO ({USER}) a responder a última mensagem que recebeu de {OTHER}. Considere o histórico e, principalmente, as últimas mensagens.

SEÇÕES (nesta ordem, use exatamente estas keys):
1. key "leitura": "O que a última mensagem parece dizer" — o tom, o que está implícito e o contexto recente.
2. key "resposta-acolhedora": "Opção 1 — acolhedora" — uma resposta pronta (entre aspas, no estilo de escrita do usuário) + o efeito provável.
3. key "resposta-direta": "Opção 2 — direta" — idem.
4. key "resposta-leve": "Opção 3 — leve/bem-humorada" — idem.
5. key "evitar": "O que evitar agora" — 2 a 3 armadilhas.

Se a última mensagem foi enviada pelo próprio usuário, diga isso na seção "leitura" e sugira como retomar a conversa.
Nunca sugira manipulação, chantagem, ciúme provocado ou qualquer forma de pressão.

VERDICT: não use (deixe null).`,
    outputSchemaVersion: 1,
    sortOrder: 60,
    requiresUserSide: true,
  },
  {
    slug: "esfriando",
    kind: "extra",
    name: "Está esfriando?",
    teaser: "Compara o começo e o agora: frequência, carinho e tempo de resposta.",
    description:
      "Mostra como a conversa mudou do início para o fim — quantidade de mensagens, tamanho, carinho, iniciativa e tempo de resposta — e o que isso pode indicar.",
    netPriceCents: 1000,
    currency: "brl",
    promptTemplate: `OBJETIVO: comparar o INÍCIO e o FIM da conversa para avaliar se a relação está esfriando, estável ou esquentando.

NÚMEROS: para comparar começo e fim, use SOMENTE os números do bloco "ESTATÍSTICAS POR PERÍODO" (PRIMEIRO TERÇO × ÚLTIMO TERÇO). Os totais de "ESTATÍSTICAS" valem para a conversa inteira e não mostram mudança: não os use como "antes" ou "agora". Se o bloco "ESTATÍSTICAS POR PERÍODO" não existir, a conversa é curta demais para comparar com números: diga isso e compare só o tom, com evidências. Quando houver notas cronológicas, compare as primeiras com as últimas.

SEÇÕES (nesta ordem, use exatamente estas keys):
1. key "como-era": "Como era no começo" — tom, frequência, carinho e iniciativa no início, com evidências.
2. key "como-esta": "Como está agora" — o mesmo para o período mais recente, com evidências.
3. key "o-que-mudou": "O que mudou (e o que não mudou)" — diferenças concretas de cada lado.
4. key "o-que-fazer": "O que fazer com isso" — sugestões práticas para reaquecer ou manter.

Seja honesto: mudanças de rotina também mudam a conversa; nem toda queda é desinteresse.

VERDICT (obrigatório): "label" ("Esfriando", "Estável" ou "Esquentando", com uma qualificação curta), "score" 0–100 (0 = esfriou muito, 50 = estável, 100 = esquentou muito), "explanation" em 1–2 frases.`,
    outputSchemaVersion: 1,
    sortOrder: 70,
    requiresUserSide: false,
  },
  {
    slug: "linha-do-tempo",
    kind: "extra",
    name: "A linha do tempo de vocês",
    teaser: "As fases da relação e os momentos de virada, com datas.",
    description:
      "Organiza a conversa em fases (começo, aproximação, crises, reconciliações…) com os momentos marcantes de cada uma e as datas, quando a conversa tiver horários.",
    netPriceCents: 1000,
    currency: "brl",
    promptTemplate: `OBJETIVO: contar a história da relação como uma linha do tempo em fases, a partir da conversa (e das notas cronológicas, quando houver). Use datas apenas quando aparecerem nas mensagens (formato [dd/mm hh:mm], ou [dd/mm/aa hh:mm] em conversas de mais de um ano) ou no período das ESTATÍSTICAS; nunca invente datas. Para comparar fases com números, use SOMENTE o bloco "ESTATÍSTICAS POR PERÍODO" (primeiro × último terço), quando existir; não crie outras contagens.

SEÇÕES (nesta ordem, use exatamente estas keys):
1. key "fases": "As fases de vocês" — lista das fases com nome curto, período aproximado e o tom de cada uma.
2. key "momentos-marcantes": "Os momentos que marcaram" — 4 a 6 momentos com evidência (seq e citação) e por que importam.
3. key "viradas": "As viradas" — onde a dinâmica mudou e o que parece ter provocado a mudança.
4. key "fase-atual": "Em que fase vocês estão agora" — leitura da fase atual e o que costuma vir depois.

VERDICT: não use (deixe null).`,
    outputSchemaVersion: 1,
    sortOrder: 80,
    requiresUserSide: false,
  },
  {
    slug: "nao-ditos",
    kind: "extra",
    name: "O que não está sendo dito",
    teaser: "Assuntos evitados, perguntas sem resposta e mudanças de assunto.",
    description:
      "Procura os silêncios da conversa: perguntas que ficaram sem resposta, temas que um puxa e o outro desvia, e o que parece estar nas entrelinhas.",
    netPriceCents: 1000,
    currency: "brl",
    promptTemplate: `OBJETIVO: identificar o que NÃO está sendo dito: perguntas sem resposta, mudanças bruscas de assunto, temas evitados, respostas evasivas e pedidos implícitos. Fale sempre de comportamentos observáveis; não adivinhe pensamentos.

SEÇÕES (nesta ordem, use exatamente estas keys):
1. key "perguntas-sem-resposta": "As perguntas que ficaram no ar" — com evidências de quem perguntou e o que aconteceu depois.
2. key "assuntos-evitados": "Os assuntos que alguém desvia" — temas que aparecem e são trocados, de cada lado.
3. key "entrelinhas": "O que parece estar nas entrelinhas" — pedidos e sentimentos implícitos, com linguagem cautelosa.
4. key "como-falar": "Como trazer isso para a conversa" — 3 sugestões de frases ou atitudes para falar do que está sendo evitado.

VERDICT: não use (deixe null).`,
    outputSchemaVersion: 1,
    sortOrder: 90,
    requiresUserSide: false,
  },
  {
    slug: SUBSCRIPTION_SLUG,
    kind: "subscription",
    name: "Assinatura mensal",
    teaser: "Até 10 relatórios completos por dia, com os relatórios adicionais incluídos.",
    description:
      "Cobrança mensal no cartão, com renovação automática. Até 10 relatórios completos por dia (o limite renova à meia-noite, horário de Brasília) e todos os relatórios adicionais incluídos. Cancele quando quiser em Minha conta.",
    netPriceCents: 4699,
    currency: "brl",
    // Não gera relatório: o catálogo guarda só preço e Payment Link.
    promptTemplate: "-",
    outputSchemaVersion: 1,
    sortOrder: 1000,
    requiresUserSide: false,
  },
  {
    slug: OVERAGE_SLUG,
    kind: "overage",
    name: "Relatório além do limite diário (assinantes)",
    teaser: "Para assinantes que já usaram os 10 relatórios do dia.",
    description: "Libera o relatório completo de uma conversa para quem é assinante e já usou o limite do dia.",
    netPriceCents: 500,
    currency: "brl",
    promptTemplate: "-",
    outputSchemaVersion: 1,
    sortOrder: 1001,
    requiresUserSide: false,
  },
];
