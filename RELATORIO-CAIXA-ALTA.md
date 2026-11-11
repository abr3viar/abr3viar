# Relatório detalhado — Caixa Alta (SaaS)

Gerado em 11/11/2026 a partir do repositório `abr3viar/caixa-alta` (branch `main`, commit `d378cfd`, clone raso).
**Base da análise:** `CLAUDE.md`, `README.md`, `package.json`, `squarecloud.app`, `docs/PROGRESSO.md` (linhas 1–150), `docs/RELATORIO_TECNICO.md` (1–250), `docs/PLANO.md` (1–200 + índice de seções), `docs/DECISOES.md` (início), lista de migrations, `packages/shared/src/modules.ts` e a estrutura de pastas. **Não li** o código das telas nem os documentos de segurança/jurídico/banco/backup por inteiro; onde só vi o título, está dito.

---

## 1. Resumo executivo

O Caixa Alta é um SaaS multi-comércio para **bares, restaurantes, lanchonetes, lojas e (novo) papelarias**. Está **em produção com clientes reais**, hospedado na **Square Cloud** com banco **PostgreSQL 17 próprio na Square** (migrado do Neon em 24–27/10/2026).

| Indicador | Valor |
|---|---|
| Arquivos versionados | 766 |
| Migrations do banco | 53 (0000 a 0052) |
| Arquivos de teste (Vitest) | 111 (849 testes na última contagem de 03/11) |
| Testes E2E (Playwright) | 7 arquivos / 32 cenários (contagem de 03/11) |
| Código TS/TSX | ~58 mil linhas (local 26,4k · cloud 13,7k · central 10,6k · shared 5,5k · scripts 1,2k · landing 1,2k) |
| Stack | Node 24, TypeScript, Hono, React 19 + Vite 8, Drizzle ORM, Zod 4, Argon2id, Vitest, Playwright |
| Itens no PLANO.md | 37 itens numerados (1–37; o 35 não aparece no índice) |

**Em uma frase:** produto já maduro (PDV, cozinha, estoque, fiado, cardápio digital, totem, telão, papelaria online, cobrança por Pix com Discord, vigia anti-ataque), com disciplina forte de segurança e testes, e com o maior risco concentrado no **processo de deploy manual** e em **dependência de pessoa única (o dono)**.

---

## 2. Arquitetura

### 2.1 Monorepo (npm workspaces)

| Pasta | Papel |
|---|---|
| `apps/cloud` | Servidor do site (Hono). Junta tudo: `server.ts` (Square), `app.ts`, `cron.ts` (tarefa diária), `scheduler.ts` (agendador em UTC), `discord/` (bot), `reports.ts`, `visits.ts`, `purge.ts`, `email-job.ts`. |
| `apps/central` | Painel do dono do sistema (`/platform`): comércios, planos, módulos, assinaturas, cobrança Pix, auditoria, links de teste, 2FA do admin. |
| `apps/local` | Operação de cada comércio: pedidos, cozinha, caixa, produtos, estoque, equipe, relatórios, cliente (cardápio/totem/loja). `src/` API + `web/` React. |
| `apps/landing` | Site de vendas, `/termos`, `/privacidade` (HTML gerado no build). |
| `packages/shared` | Domínio (pedidos, preços, parcelas, módulos, permissões, lista escolar…), validação Zod, infraestrutura de servidor (vigia, http, crypto) e **design system** (`src/ui/ds`, vitrine em `/platform/design`). |
| `drizzle/` | Migrations do banco único. |
| `esteira/` + `.claude/` | **Esteira de Agentes**: ferramenta do PC do dono (nunca vai para produção). |
| `scripts/` | build, pack-square, pack-zip, check-deploy-package, migrate, seed, demo, vigia. |

### 2.2 Multi-tenancy
Todos os comércios no **mesmo banco**, separados por `business_id` em **toda** consulta + chaves estrangeiras compostas. RLS foi avaliado e **descartado por ora** (decisão registrada). Há testes de isolamento (ler/editar produto e pedido de outro comércio por ID, `business_id` no corpo, etc.) e o teste `rotas-sem-login.test.ts` garante 401 em toda rota que não está na lista de públicas.

### 2.3 Modelo de módulos e planos
Catálogo atual de 14 módulos: `pedidos, cozinha, produtos, estoque, vendas, pagamentos, mesas, funcionarios, clientes, relatorios, dashboard, totem, cardapio, lista`.
Regra: `módulos efetivos = plano + extras concedidos − desativados (+ o Início, sempre ligado)`. O **tipo de comércio só filtra** (ex.: papelaria não tem cozinha/mesas; `lista` só existe na papelaria). O bloqueio é no backend; a tela só esconde o menu.
Preços citados em notas: Básico R$ 99→79, Profissional R$ 199→149, Completo R$ 250→170 (promocional, via prospecção; **o valor real vigente fica no /platform**, não verifiquei).

### 2.4 Papéis e permissões
- **PLATFORM_ADMIN:** só no `/platform`, login + TOTP obrigatório, código de liberação de uso único no primeiro acesso.
- **Dono do comércio:** login por e-mail/senha; **2FA opcional por código no e-mail** (item 32, no ar desde 03/11).
- **Cargos do comércio são dados** (ADMIN, ATENDENTE, COZINHA + personalizados); cada rota exige permissão **e** módulo efetivo **e** licença/assinatura ativa.
- Senhas com Argon2id; atraso progressivo e Turnstile no login; CSRF por cookie SameSite + token.

---

## 3. Funcionalidades do produto (o que o cliente final usa)

**Operação do comércio (`apps/local`)**
- Pedidos com máquina de estados configurável (com ou sem cozinha); mesas; receber a mesa; pagamento **dividido**; **fiado**; taxa de serviço 10%; **cartão parcelado 2x–12x** (só registra, sem juros) com relatório à vista × parcelado.
- **Caixa** com leitor de código de barras (câmera **e** leitor USB), notinha/impressão térmica 80 mm.
- Produtos: fotos (WEBP 800px + miniatura), **variações**, **promoções por horário**, **doses e receitas** (adega/bar), margem padrão, import de catálogo (CSV).
- **Estoque** com movimentações, mínimo, **lista de compras**, **notas de compra** (XML/texto/IA) com casamento de produtos.
- **Clientes**, LGPD (exportar, anonimizar), **brindes/fidelidade** (saldo por compra, resgate zera o saldo), assistente de IA ("Dúvidas"), estimativa de imposto, relatórios, pedidos de treino/teste.
- **Cliente final:** cardápio digital + **totem** (mesma tela, modos diferentes), **modo senha + telão**, busca por lupa, opção só-retirada-no-balcão.
- **Papelaria (item 30, fases A–E no ar):** loja na internet, produtos com marca/faixa/personagem, **conta do cliente**, **orçamento por lista de material escolar** (lê a lista colada, casa com o catálogo sem IA, 3 opções por faixa de preço), **pedido com dia de retirada** e aviso por e-mail. Falta a **Fase F (tablet da loja)**.

**Painel do dono do sistema (`/platform`)**
Comércios, planos, tipos, extras de módulos, assinaturas (ACTIVE → PAST_DUE → EXPIRED / SUSPENDED / CANCELLED), cobrança por **comprovante de Pix** (IA lê o comprovante; aprovação humana), renovação manual, **links de teste** de uso único (7 dias), contas de teste e de venda, auditoria, Métricas (receita), Vigia, visitas por UTM.

**Landing:** site de vendas, páginas por tipo de comércio (SEO), termos e privacidade (com `TERMS_VERSION` e aceite).

---

## 4. IA, Discord e Esteira

- **IA (Groq, modelo padrão `openai/gpt-oss-120b`):** botão Dúvidas, leitura de comprovante Pix, importação de nota de compra, assistente. Regra de ouro (testada em `sistema-sem-ia.test.ts`): **nada crítico depende da IA**; sem chave/limite/erro, tudo segue.
- **Bot do Discord** (sem discord.js; **endpoint de interações com assinatura Ed25519** dentro do próprio site): `/lucro`, `/analise`, `/painel`, `/relatorio`; mensagens em Components V2 com emojis personalizados (183 emojis); relatórios às 12:20 e 00:00 (Brasília); aprovar/recusar comprovante por botão; lista de IDs autorizados + vínculo ao usuário do painel; auditoria.
- **Vigia:** a cada 10 min (configurável 1–60) lê contagens em memória; só consulta o banco se houve requisição; em ataque de login liga o **modo de defesa** (atraso maior + Turnstile). Sem bloqueio por IP (IP real atrás do proxy da Square ainda não confirmado).
- **Esteira de Agentes** (`/esteira`, `/vendas`, `/financas`): ferramenta local do dono; trava `guarda.mjs` bloqueia main/Square/escrita no banco com tarefa aberta. Existe também prospecção por WhatsApp com 4 agentes agendados e teto de uso diário.

---

## 5. Banco de dados

- **PostgreSQL 17 na Square** (`caixa-alta-db`), TLS 1.3 com certificado de cliente; app usa o usuário `caixa_alta_app` (poucos privilégios), migrations rodam com o dono (`DATABASE_URL_UNPOOLED`).
- **Neon** (antigo) mantido só até ~31/10 — **a decisão de apagá-lo é do dono**; a Política de Privacidade ainda cita o Neon (pendência).
- **Regras:** migration só aditiva, nunca editar antiga, dinheiro em centavos (`::bigint` nas somas), Drizzle parametrizado.
- **Histórico das 53 migrations** mostra a evolução: base (0000–0010), caixa/fiado/pagamento dividido (0013–0017), vigia (0019), fotos e pedidos de clientes (0024–0026), LGPD/termos (0027–0029), Discord e comprovantes (0031–0035), variações/promoções/imposto/brindes (0036–0039), e-mails e papelaria (0040–0050), 2FA do dono e links de teste (0051–0052).
- **Backup:** workflow `backup-semanal.yml` (GitHub Actions) + `docs/BACKUP.md` (não li o conteúdo).

---

## 6. Segurança (ponto forte)

Auditoria registrada em `docs/AUDITORIA-SEGURANCA.md` (item 13) e nova rodada em 30/10 (item 28, 5 agentes de leitura; nada grave; corrigidos: Turnstile não desliga por relato anônimo em modo de defesa; teto de pedidos públicos por comércio).

Controles confirmados: Argon2id; cookie Secure; CSRF; CSP/HSTS/headers; HTTPS (301); rate limit; validação Zod em tudo; escape de saída; upload validado; `sql.raw` só com constantes; varredura de segredos no CI (gitleaks + checker de pacote); **Dependabot** semanal; prompt injection tratado (comprovante, nota, botão Dúvidas); licença/assinatura bloqueia ações comerciais mas **nunca apaga dados** (suspender ≠ apagar).

Pendências/riscos conhecidos que li:
- **RLS não implementado** (decisão consciente; o isolamento depende de toda consulta filtrar `business_id`).
- **IP real atrás do proxy** (`TRUSTED_PROXY_HOPS`) não conferido → sem bloqueio por IP.
- `drizzle-kit` com 4 avisos médios de segurança (só no PC do dono, sem versão corrigida).
- Revisão adversarial pelo Codex ficou **pendente** (Codex sem login).
- Itens de decisão do dono do item 28 ainda abertos (não li o texto).

---

## 7. Qualidade, CI/CD e operação

- **Testes:** Vitest com PostgreSQL real embutido (isolamento, pedidos, barcode, modo senha, cron…) e Playwright no celular/tablet. Regra: `typecheck` + `npm test` verdes ou o deploy não sai; teste nunca é enfraquecido.
- **CI:** `.github/workflows/deploy-square.yml` (auditoria, typecheck, testes, build, varredura de segredos → branch `deploy-square`).
- **Deploy REAL (atenção):** o app da Square **não está ligado ao GitHub**. Cada fase aprovada sobe manualmente: merge → `pack:square` → conferência do pacote → (aviso ao dono, horário calmo) `parar_app` → `fazer_deploy` → `iniciar_app` pelo MCP da Square → conferir log (`banco pronto`, `TLSv1.3`), migrations e `/api/health`. Plano B: `npm run pack:zip`.
- **Infra:** Square, 1024 MB, `AUTORESTART=true`, Node 24; domínio antigo da Vercel só redireciona (301).
- **Monitoramento:** `docs/MONITORAMENTO.md` (não li).

---

## 8. Histórico recente (do PROGRESSO.md)

- 20–21/10: Fases 1, 3 e 4 (base, segurança, Discord, comprovantes sem IA).
- 24–27/10: migração do banco Neon → Square (TLS, usuário restrito).
- 27–31/10: e-mails de conferência, visual novo, confirmação do e-mail do dono, **Papelaria A–D**.
- 03/11: lote grande — Papelaria Fase E, Completo com cardápio/totem, parcelado, 2FA do dono, atualizações de segurança, contas de teste/venda, link de teste e sessão longa do painel.
- **Última coisa registrada:** link de teste no ar às 18:48 de 03/11 (main `00738f4`). Não há registro no que li de 04–11/11.

---

## 9. Riscos e pontos de atenção (minha avaliação)

1. **Deploy manual e dependente do dono** — sem integração GitHub→Square, qualquer correção urgente espera alguém parar/subir o app; já houve incidente (CRLF no `squarecloud.app` derrubou o site ~5 min; `docs/INCIDENTE.md`). Recomendo **reconectar a Square ao GitHub** ou automatizar o `pack:square` + deploy com verificação de saúde e rollback.
2. **Ponto único de falha:** um servidor de 1 GB e um banco único para todos os clientes. Sem réplica, o backup semanal é a rede de segurança — vale testar **restauração** periodicamente.
3. **Sem RLS:** um `business_id` esquecido numa consulta nova vira vazamento entre clientes. Hoje mitigado por testes; considerar uma verificação automática (lint/teste que varre consultas) ou RLS com usuário não-superusuário agora que o banco é gerenciado.
4. **Documentação desencontrada:** `PROGRESSO.md` tem a seção "Onde parei" misturando datas (cita 20/10 e 28/10 no topo, mas o trabalho vai até 03/11) e `RELATORIO_TECNICO.md` ainda descreve a arquitetura **antiga local+central** (v0.1.0, 30/09) que não bate com o site único atual. Vale atualizar para novos membros/IA não se confundirem.
5. **Política de Privacidade desatualizada** (cita o Neon) e `TERMS_VERSION` — decisão jurídica do dono; `docs/REVISAO-JURIDICA.md` indica revisão por advogado ainda necessária.
6. **Dependência de IA externa (Groq)** — mitigada por design; mas dado de cliente nunca deve ir para IA externa, e a regra existe no CLAUDE.md — manter a checagem nos testes.
7. **Custo/limites:** comprovantes (até 4 MB) e fotos ficam dentro do banco; o estudo de mover para R2/S3 está feito só como análise (`ESTUDO-ARQUIVOS.md`). O banco próprio na Square tem seus próprios limites — monitorar o aviso de espaço (70%/85%).
8. **Complexidade crescente:** 53 migrations, 37 itens de plano, bot, esteira, prospecção. O risco é de **escopo**: considerar congelar funcionalidades novas por um ciclo para consolidar docs, observabilidade e deploy.

---

## 10. Próximos passos que já estão no plano

- **Papelaria Fase F** (tablet da loja) — quando o dono pedir.
- Decisões do dono pendentes: preço do Completo no `/platform`, subir `TERMS_VERSION`, descarte do Neon + atualização da Política, decisões do item 28.
- Aprovar e subir branches ainda abertas segundo o PROGRESSO (e-mail de conferência, Esteira, fases da papelaria já reintegradas — **conferir no git quais já entraram na main**, não verifiquei).
- Revisão adversarial por Codex quando houver login.

---

## 11. O que NÃO consegui verificar (transparência)

- Não rodei `npm install`, testes nem build: os números de testes são os **registrados em PROGRESSO.md (03/11)**.
- Não abri o site em produção nem o painel da Square/GitHub Actions; "no ar" vem do que está anotado.
- Não li os documentos `INCIDENTE`, `MONITORAMENTO`, `BACKUP`, `BANCO-SQUARE`, `REVISAO-JURIDICA`, `AUDITORIA-SEGURANCA`, `TOTEM`, `IMPRESSORA` nem o PLANO além do item 8 (só os títulos dos demais), nem o código das telas React.
- O clone é raso (1 commit): não analisei histórico, autores ou frequência de commits.

Se quiser, aprofundo qualquer parte (segurança, banco, deploy, UX do totem, plano de negócio) lendo os arquivos que faltam.
