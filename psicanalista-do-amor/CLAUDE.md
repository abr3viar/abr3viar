# CLAUDE.md — Psicanalista do Amor

## O projeto
SaaS de análise de relacionamentos. O usuário envia uma conversa entre duas pessoas (texto colado, `.txt` do WhatsApp, `.zip` ou prints) e recebe um relatório gerado por IA (Groq) sobre a dinâmica entre elas.

**Modelo de negócio**
- Relatório principal: gerado e salvo logo após o envio. A primeira metade (4 de 8 seções) é grátis e termina com uma frase-gancho; o relatório completo rende **R$ 30 líquidos**.
- Relatórios adicionais: **R$ 10 líquidos** cada. Só aparecem depois que o principal foi pago, usam a mesma conversa e são gerados **depois** do pagamento. Catálogo na tabela `report_types`.
- **Assinatura mensal (D96, pedido do dono):** **R$ 46,99 líquidos/mês** (cobrado R$ 49,35, só cartão, renovação automática). Dá até **10 relatórios completos por dia** (dia no horário de Brasília, sem acúmulo) e os adicionais incluídos. Depois dos 10 do dia, cada relatório completo a mais custa **R$ 5 líquidos** (R$ 5,62). A compra avulsa continua para quem não assina. Detalhes em `plano.md` 6.8.
- **Repasse da taxa do Stripe (decisão definitiva do dono):** o cliente vê e paga o preço **bruto** = líquido + taxa, arredondado para cima (`src/lib/pricing.ts`, `STRIPE_FEE_PERCENT`/`STRIPE_FEE_FIXED_CENTS`). Com a taxa padrão (3,99% + R$ 0,39): **R$ 31,66** no principal, **R$ 10,83** nos adicionais, **R$ 49,35/mês** na assinatura e **R$ 5,62** no relatório além do limite. Textos e telas mostram sempre o preço cobrado vindo do banco (`report_types.price_cents`), nunca "R$ 30"/"R$ 10" fixos. Não mude preço, modelo de negócio nem o fluxo de liberação por webhook.

## Fonte da verdade
**`plano.md` é a fonte da verdade.** Antes de implementar algo, leia a seção correspondente. Ao concluir uma tarefa, marque `[x]` no checklist da seção 11 do `plano.md`. Se uma decisão mudar, atualize a seção 13 (Decisões e suposições) no mesmo commit.

## Stack
- Next.js 16 (App Router) + TypeScript estrito + Tailwind CSS 4
- PostgreSQL 16 + Drizzle ORM (drizzle-kit para migrations)
- pg-boss (fila no Postgres) + processo `worker` separado
- Groq (`groq-sdk`): modelos **sempre** por env (`GROQ_VISION_MODEL`, `GROQ_REPORT_MODEL`, `GROQ_SUMMARY_MODEL`)
- Stripe Payment Links + webhook
- Storage: driver local (dev) / S3-compatível (prod)
- E-mail por SMTP (Gmail, `nodemailer`) enquanto não há domínio próprio; Resend depois (D95). zod, sharp, yauzl, pino, Vitest, Playwright
- Gerenciador de pacotes: **npm**

## Estrutura de pastas (planejada)
```
src/
  app/                      # rotas (App Router)
    (marketing)/            # landing, termos, privacidade, ajuda
    analisar/               # envio
    r/[id]/                 # processando, confirmar, relatório, extra/[slug]
    pagamento/retorno/
    entrar/                 # link mágico
    minhas-analises/  conta/  admin/
    api/
      uploads/
      webhooks/stripe/route.ts
      purchases/
  components/               # UI (sem acesso ao banco)
  server/                   # código só de servidor ("server-only")
    db/                     # schema Drizzle, cliente, migrations
    auth/                   # sessões, link mágico
    crypto/                 # AES-256-GCM (encrypt/decrypt de campos)
    ingest/                 # parsers: whatsapp.ts, generic.ts, zip.ts, images.ts, stitch.ts
    ai/                     # cliente Groq, rate limiter, prompts/, schemas zod
    reports/                # geração, stats, get-report-view.ts (ÚNICO ponto de leitura)
    payments/               # start-checkout.ts, fulfill.ts (ÚNICO que libera)
    storage/                # interface + drivers local/s3
    jobs/                   # definições dos jobs pg-boss
    log.ts                  # pino com redact
  env.ts                    # validação das variáveis com zod
worker/index.ts             # entrada do processo worker
drizzle/                    # migrations geradas
tests/
  fixtures/                 # exportações de WhatsApp e prints FICTÍCIAS
  unit/  integration/  e2e/
```

## Comandos (a confirmar na Fase 0)
```bash
docker compose up -d        # Postgres local
npm run dev                 # Next.js em http://localhost:3000
npm run worker              # worker dos jobs (outro terminal)
npm run build && npm start  # produção
npm run db:generate         # gerar migration a partir do schema
npm run db:migrate          # aplicar migrations
npm run db:seed             # report_types (principal + adicionais)
npm run db:studio           # Drizzle Studio
npm run lint                # ESLint
npm run typecheck           # tsc --noEmit
npm test                    # Vitest
npm run test:e2e            # Playwright
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

## Convenções de código
- TypeScript estrito; sem `any` (use `unknown` + zod). Entradas externas (formulários, arquivos, IA, Stripe) **sempre** validadas com zod.
- Código em inglês (variáveis, funções, tabelas, colunas em `snake_case` no banco); textos de interface, e-mails e prompts em **pt-BR**.
- Arquivos em `kebab-case.ts`; componentes React em `PascalCase`.
- Server Components por padrão; `"use client"` só onde há interação. Tudo em `src/server/` importa `server-only`.
- Componentes recebem tipos de *view* (ex.: `ReportView`), nunca linhas do banco.
- IDs em UUID v7. Datas em `timestamptz` (UTC no banco; exibir em `America/Sao_Paulo`).
- Prompts versionados em `src/server/ai/prompts/` (cada um com `PROMPT_VERSION`); saída da IA em `json_object` + zod tolerante (não usar Structured Outputs estrito).
- Toda chamada à Groq passa pelo cliente com retry/backoff/limitador; nunca chamar o SDK direto.
- Migrations sempre geradas pelo drizzle-kit e commitadas; nunca editar o banco à mão.
- Testes obrigatórios para: parsers, zip seguro, criptografia, `getReportView`, webhook, assinatura (limite diário, revogação, sessão verificada).
- Commits pequenos, mensagens em pt-BR.

## Regras críticas (nunca quebrar)
1. **Conteúdo pago nunca vai para o client antes da confirmação do Stripe** (pagamento pelo webhook ou assinatura ativa, regra 2). O recorte é feito no servidor por `src/server/reports/get-report-view.ts`; seções bloqueadas saem só com `lockedTitle`. Nada de CSS/blur sobre texto real; o texto desfocado é lorem ipsum gerado no client.
2. **Só o Stripe libera.** `reports.is_unlocked = true` só é escrito em `src/server/payments/fulfill.ts`, em dois casos:
   - pelo webhook, depois de validar a assinatura (`STRIPE_WEBHOOK_SECRET`) e conferir `payment_link`, `currency`, `amount_total` e `mode`;
   - pelo uso de uma assinatura mensal (D96) cujo estado veio do Stripe (webhook ou API autenticada). Esse uso exige sessão verificada e respeita o limite diário.

   A página de retorno e parâmetros de URL **nunca** liberam conteúdo.
3. **Webhook idempotente**: registrar `event.id` em `stripe_events` e tratar eventos repetidos sem efeito duplicado.
4. **Nunca commitar segredos**: `GROQ_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `DATABASE_URL`, `DATA_ENCRYPTION_KEY`, `SESSION_SECRET`, `HASH_PEPPER`, `RESEND_API_KEY`, `SMTP_PASSWORD`, chaves S3. Só `.env.example` com valores falsos. `.env*` e `.data/` ficam no `.gitignore`.
5. **Dados de conversas são sensíveis**: nunca aparecem em logs, mensagens de erro, analytics, URLs ou ferramentas de monitoramento. Logar só IDs, status, contagens, durações e códigos de erro. Isso inclui respostas da Groq (`failed_generation`) e payloads do Stripe.
6. **Criptografia em repouso**: mensagens, nomes dos participantes, conteúdo de relatórios, gancho e evidências são gravados cifrados (AES-256-GCM) via `src/server/crypto`.
7. **Autorização em toda leitura**: o usuário só acessa conversas/relatórios que são dele; responder 404 (não 403) para os demais.
8. **Upload seguro**: validar por magic bytes, respeitar limites de tamanho/quantidade, nunca usar o nome do arquivo do zip como caminho, proteger contra zip bomb, re-encodar imagens (remove EXIF).
9. **Arquivos originais são temporários**: apagar após a normalização.
10. **Páginas de relatório são dinâmicas** e `Cache-Control: private, no-store`; nunca cachear conteúdo por usuário.
11. **Modelos da Groq não são fixados no código**: sempre por env. Antes de mexer em IA, reconferir `console.groq.com/docs/models` e `/docs/deprecations`.
12. **Aviso de IA** ("não substitui aconselhamento profissional") presente no relatório e na landing. Alerta de risco (`safety_flag`) nunca fica bloqueado.
13. Fixtures de teste usam **apenas conversas fictícias**. Nunca colocar conversas reais no repositório.

## Ao terminar uma sessão
- Marcar o checklist no `plano.md`.
- Registrar decisões novas na seção 13 do `plano.md`.
