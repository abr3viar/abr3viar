# Psicanalista do Amor

SaaS de análise de relacionamentos: a pessoa envia uma conversa entre duas pessoas (texto colado, `.txt` do WhatsApp, `.zip` ou prints) e recebe um relatório gerado por IA (Groq) sobre a dinâmica entre elas.

- **Metade do relatório é grátis** e termina com uma frase-gancho. O relatório completo e os adicionais são pagos pelo Stripe (cartão e Pix), com a taxa repassada: o cliente paga **R$ 31,66** pelo completo e **R$ 10,83** por adicional (R$ 30 e R$ 10 líquidos; `plano.md` 6.7).
- **Assinatura mensal opcional** (D96): **R$ 49,35/mês** (R$ 46,99 líquidos, cartão) com até 10 relatórios completos por dia e os adicionais incluídos; além do limite do dia, **R$ 5,62** por relatório (R$ 5 líquidos).
- O conteúdo pago **só sai do servidor depois da confirmação do Stripe**: pagamento conferido no webhook ou assinatura ativa (estado vindo do Stripe), sempre por `fulfill.ts`.
- Conversas e relatórios ficam **cifrados** (AES-256-GCM) no banco. Os arquivos originais são apagados logo depois de lidos.
- A análise é feita por IA e **não substitui aconselhamento profissional**.

| Documento | Para quê |
|---|---|
| [`DEPLOY.md`](DEPLOY.md) | Colocar no ar na **Square Cloud** passo a passo, sem instalar nada (alternativas: Railway, Fly.io, Docker) |
| [`plano.md`](plano.md) | **Fonte da verdade**: fluxo, banco, prompts, pagamento, segurança/LGPD, checklist das fases e decisões |
| [`CLAUDE.md`](CLAUDE.md) | Regras para quem (ou qual agente) mexe no código: convenções e regras críticas |
| [`docs/`](docs) | Auditoria, ROPA (rascunho LGPD) e roteiro do teste de carga |

## Arquitetura

```
Navegador ──► Next.js 16 (site)
               ├─ Server Components: o relatório já sai RECORTADO do servidor (get-report-view.ts)
               ├─ /api/uploads ─► storage temporário cifrado ─► fila "ingest"
               ├─ /api/webhooks/stripe ─► fulfill.ts (ÚNICO que libera) ─► fila "generate_extra"
               └─ Server Actions: confirmar participantes, iniciar checkout, excluir dados, /admin
Worker (pg-boss)
               ├─ ingest: txt / zip / prints (OCR com visão da Groq) ─► mensagens normalizadas e cifradas
               ├─ generate_main: estatísticas determinísticas + map-reduce ─► relatório (4 de 8 seções grátis)
               ├─ generate_extra: adicionais pagos (gerados depois do pagamento)
               └─ manutenção: limpeza de originais, retenção (LGPD), reconciliação de pagamentos, rotação de chave
PostgreSQL 16 ◄── dados, fila (pg-boss), rate limit e limitador de tokens da Groq
```

**Stack:** Next.js 16 (App Router) · TypeScript estrito · Tailwind CSS 4 · PostgreSQL 16 + Drizzle ORM · pg-boss · Groq (`groq-sdk`, modelos por env) · Stripe Payment Links + webhook · e-mail por SMTP (Gmail) ou Resend · zod · sharp · yauzl · pino · Vitest · Playwright.

Em produção, um único processo (`scripts/start.mjs`) compila se preciso, aplica as migrations e sobe **site + worker**.

## Estrutura de pastas

```
src/
  app/                 rotas: landing, (marketing)/ ajuda-termos-privacidade, analisar/, r/[id]/ (processando,
                       confirmar, relatório, extra/[slug]), pagamento/retorno, entrar/, minhas-analises/, conta/,
                       admin/, api/ (uploads, webhooks/stripe, purchases, status, health, account/export)
  components/          UI (recebe tipos de view, nunca linhas do banco)
  lib/                 código compartilhado sem segredo (views, textos, cálculo de preço)
  server/              só servidor ("server-only")
    db/                schema Drizzle, cliente (TLS/certificado), migrations, seed
    auth/              sessões e link mágico
    crypto/            AES-256-GCM
    ingest/            parsers (WhatsApp, genérico), zip seguro, imagens, OCR, costura de prints
    ai/                cliente Groq (retry, backoff, limitador), prompts versionados, schemas zod
    reports/           geração, estatísticas, get-report-view.ts (ÚNICO ponto de leitura)
    payments/          start-checkout.ts, fulfill.ts (ÚNICO que libera), conferência do Payment Link
    storage/           driver local e S3/R2
    jobs/ maintenance/ filas, retenção, reconciliação, rotação de chave
  env.ts               validação das variáveis (zod)
  proxy.ts             CSP com nonce
worker/index.ts        entrada do worker
scripts/               start.mjs (produção), postbuild, migrate, seed, check-invariants
drizzle/               migrations geradas
tests/                 unit/, integration/ (Postgres descartável), e2e/ (Groq e Stripe simulados), fixtures FICTÍCIAS
```

## Desenvolvimento (para quem programa)

```bash
cp .env.example .env          # valores de desenvolvimento
docker compose up -d          # Postgres local
npm ci
npm run db:migrate && npm run db:seed
npm run dev                   # http://localhost:3000
npm run worker                # outro terminal

npm run lint                  # ESLint + invariantes (ex.: is_unlocked só em fulfill.ts)
npm run typecheck
TEST_DATABASE_URL=postgres://app:app@localhost:5432/psicanalista_test npm test
npm run test:e2e              # Playwright; Groq e Stripe falsos (tests/e2e/mock-server.ts)
npm run build && npm start
```

Webhook local: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

As regras críticas (paywall no servidor, só o webhook libera, nada de conteúdo em logs, criptografia, autorização com 404, upload seguro) estão no [`CLAUDE.md`](CLAUDE.md) e valem acima de qualquer melhoria.
