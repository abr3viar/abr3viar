# Prompts (Groq)

Cada arquivo exporta `PROMPT_VERSION` no formato `<prompt>@<data>.<n>`. Toda mudança de
conteúdo (inclusive em `common.ts`, que é compartilhado) incrementa a versão de **todos** os
prompts afetados e ganha uma linha aqui. A versão é gravada em `reports.prompt_version` e,
para o resumo, em `conversation_digests.prompt_version` (versão nova = notas refeitas).

| Arquivo | Usa de `common.ts` | Onde é chamado |
|---|---|---|
| `vision-extract.ts` | nada | `src/server/ingest/images-ingest.ts` (OCR das prints) |
| `chunk-summary.ts` | `INJECTION_RULES` | `src/server/reports/context.ts` (map e condensação) |
| `main-report.ts` | todos | `src/server/reports/generate-main.ts` |
| `extra-report.ts` | todos (+ `prompt_template` do catálogo) | `src/server/reports/generate-extra.ts` |

Os templates dos adicionais ficam em `src/server/reports/catalog.ts` (vão para
`report_types.prompt_template` pelo seed); mudar um template incrementa `extra-report`.

Regras que valem para todos: saída `json_object` + zod tolerante (`../schemas.ts`), modelo
só por env, conteúdo da conversa sempre entre delimitadores e tratado como dado, nada de
resposta da IA nos logs. O que o prompt pede e o servidor garante fica em
`src/server/reports/guards.ts` e `sections.ts`.

## Histórico

### vision-extract
- **2026-10-25.1** — versão inicial (plano.md 5.4).

### chunk-summary
- **2026-10-25.1** — versão inicial (map + condensação hierárquica, plano.md 5.3).
- **2026-10-25.2** — `safety_concerns` amplo ("na dúvida, registre", formato `#seq — descrição`);
  a condensação nunca descarta riscos nem os momentos ligados a eles (IA-2).
- **2026-10-25.3** — regra de injeção reforçada (marcações falsas, nomes como dado — IA-12);
  `seq` só com o número e citação copiada literalmente (IA-9); `period` com as datas como
  aparecem, com ano quando houver (IA-8).
- **2026-10-25.4** — não registrar brincadeiras evidentes ("vou te matar kkk"); o servidor só liga o alerta pelas notas com 2+ sinais ou categoria grave (revisão de código).


### main-report
- **2026-10-25.1** — versão inicial (8 seções, gancho, `safety_flag`, plano.md 5.5).
- **2026-10-25.2** — `locked_title` sem nomes, números nem resposta; gancho sem números,
  horários, datas e citações, apontando para onde olhar (IA-3/IA-4).
- **2026-10-25.3**
  - IA-5: as seções 1–4 não antecipam quem investe mais, a virada, a análise dos atritos nem
    a direção da relação; os briefs grátis descrevem hábitos, sem interpretá-los como interesse.
    O servidor confere (`anticipatesPaidConclusion`) e refaz a seção grátis uma vez.
  - IA-7: números só dos blocos de estatísticas, "n/d" não se estima, sem proporções
    inventadas ("9 de cada 10"); base < 10 é amostra pequena.
  - IA-10: regras de especificidade (detalhe que só existe nesta conversa), lista de
    clichês proibidos e conselhos sem controle/vigilância do parceiro.
  - IA-11: "AMOSTRA CURTA" (< 40 mensagens) no cabeçalho vira linguagem de hipótese.
  - IA-12: regra de injeção reforçada.
  - IA-9: `seq` sem "#", citação literal da mesma mensagem e só de mensagens de texto.
  - IA-15: regeneração de seção recebe "Já escritas: key (título)"; alerta cita o Disque 100
    quando houver criança ou adolescente.

### extra-report
- **2026-10-25.1** — versão inicial (system comum + template do catálogo, plano.md 5.6).
- **2026-10-25.2**
  - Tudo o que mudou em `common.ts` (IA-7, IA-9, IA-10, IA-11, IA-12, Disque 100).
  - IA-7: exemplo do `quem-gosta-mais` sem número inventado ("9 de cada 10").
  - IA-8: `esfriando` e `linha-do-tempo` comparam começo e fim só com o bloco
    "ESTATÍSTICAS POR PERÍODO" (primeiro × último terço); datas com ano em conversas longas.
  - IA-13: bloco "LEITURA JÁ ENTREGUE" (títulos do principal liberado) — não repetir, aprofundar;
    no `quem-gosta-mais` o label do placar é derivado do score no servidor (> 55: A; < 45: B;
    senão "Interesse equilibrado") e o template avisa isso.
  - IA-15: seção de conselhos faltando é regenerada sozinha (`ADVICE_SECTION_KEY`), com as
    já escritas no pedido.

## Contexto montado pelo servidor (não versionado como prompt, mas afeta a saída)
`src/server/reports/context.ts` monta o cabeçalho: participantes (nomes sem quebras/controles e
sem `<`), quem é o usuário, `AMOSTRA CURTA` (< 40 mensagens), `ESTATÍSTICAS` (com datas de início
e fim, "(base: N respostas)" no tempo de resposta e "n/d" para iniciativa/tempo/mensagens
seguidas quando não há horários) e, a partir de 40 mensagens, `ESTATÍSTICAS POR PERÍODO`.
Mensagens com `<conversa>`/`</notas>` no texto têm o `<` trocado por `‹`.
