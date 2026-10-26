# Teste de carga do worker e do limitador da Groq

## 1. Automático (simulado) — roda no `npm test`

`tests/integration/load.test.ts` simula **3 workers** (instâncias do cliente da Groq, cada um com concorrência 2) compartilhando o limitador de tokens no Postgres, contra uma Groq **falsa** com orçamento de 6.000 tokens por janela de 1,5 s que responde `429` ao estourar.

Critérios: as 24 chamadas terminam; nunca há mais de 6 chamadas simultâneas; o número de `429` fica abaixo do número de chamadas (o limitador evita a "tempestade" de rejeições); tudo em menos de 40 s.

Resultado de referência (25/10/2026, sandbox): 24 chamadas em ~6,4 s, 7 respostas 429 simuladas (todas recuperadas pelo retry), pico de 5 chamadas simultâneas.

> Por que ainda há alguns 429: a reserva de tokens é otimista (lê e depois desconta, sem trava) e a primeira chamada de cada janela não conhece o saldo. É intencional — o retry com backoff + `retry-after` resolve, e uma trava global serializaria os workers.

## 2. Manual (com a chave real) — antes de abrir ao público

Faça **em horário de pouco uso**, no ambiente de produção já configurado, **com conversas fictícias**:

1. Confira no `console.groq.com → Settings → Limits` os limites do seu plano (tokens por minuto de cada modelo).
2. Abra 5 janelas anônimas e envie, quase ao mesmo tempo, 5 conversas fictícias de ~300 mensagens (copie a do passo 11 do `DEPLOY.md` várias vezes, trocando nomes).
3. Acompanhe os logs da Square Cloud:
   - `ai_rate_limit_wait` = o limitador está segurando chamadas (esperado);
   - `ai_call_failed` com `code: ai_rate_limited` repetido muitas vezes = limite baixo demais para o volume → suba o plano da Groq ou reduza `GROQ_MAX_CONCURRENCY`;
   - `job_falhou` = algum relatório esgotou as tentativas → `/admin → Operações` → reprocessar.
4. Anote o tempo até cada prévia ficar pronta. Referência aceitável: até ~3 min com 5 envios simultâneos no plano pago.
5. Envie um `.zip` com 30 prints fictícias e confira o progresso "Lendo prints".
6. Observe a memória do app no painel da Square Cloud (deve ficar abaixo de 2 GB).

Registre os números aqui (data, plano da Groq, tempos, nº de 429) para comparar no futuro.
