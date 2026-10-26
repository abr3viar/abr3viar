# Auditoria — 25/10/2026

Auditoria do site inteiro feita por 6 agentes em paralelo (somente leitura): `security-auditor`, `qa-tester`, `seo-performance`, `frontend-designer`, `copywriter-ptbr` e `report-prompt-engineer`. Achados deduplicados, com um ID por achado e classificados assim:

- **P0**: segurança, vazamento de conteúdo pago, perda de dados ou quebra do fluxo de pagamento;
- **P1**: bugs, acessibilidade séria ou conversão;
- **P2**: acabamento.

Prefixos dos IDs: `F5` = revisão de segurança da fase 5 (antes da auditoria geral); `SEC` = segurança/LGPD; `QA` = bugs e acessibilidade; `SEO` = SEO e performance; `UX` = design; `TXT` = textos; `IA` = prompts e relatórios.

## Tabela de status

| ID | Pri. | Resumo | Status |
|---|---|---|---|
| F5-1 | P0 | Páginas do `/admin` só protegidas pelo layout: anônimo lia compras e e-mails via navegação RSC | resolvido (200467f) |
| F5-2 | P1 | TLS do banco sem verificar o servidor por padrão; `sslmode=verify-*` perdido; produção sem TLS possível | resolvido (200467f); fixar o certificado do servidor **adiado** até a Square Cloud informar a CA (D82) |
| F5-3 | P0 | "10.50" no `/admin` virava R$ 1.050 → todo pagamento em `mismatch_amount` (relatório não libera) | resolvido (200467f) |
| F5-4 | P0 | Conferência do Payment Link só pegava link mais barato e era feita depois de gravar (cliente podia pagar mais que o anunciado) | resolvido (200467f) |
| F5-5 | P2 | Texto livre de `?erro=` exibido no painel (phishing) | resolvido (200467f) |
| F5-6 | P2 | CSP com `style-src 'unsafe-inline'` | **adiado**: necessário para as barras de progresso; sem injeção de HTML possível hoje (D73) |
| F5-7 | P2 | Build automático do `start.mjs` recebia todos os segredos | resolvido (200467f) |
| HOST-1 | P0 | Build falhava com `npm install` só de produção (Square Cloud): o `next build` checava os tipos dos testes | resolvido (167fe9c): `tsconfig.build.json`; testado com `npm ci --omit=dev` + `start.mjs` (D86) |
| F5-8 | P2 | `sitemap.xml`/`robots.txt` estáticos com o `APP_URL` do build | resolvido (200467f) |
| SEC-1 | P0 | Upload e webhook liam o corpo inteiro na memória antes de qualquer limite (chunked sem Content-Length derrubava o container) | resolvido: leitura com contador de bytes, rate limit por IP antes de ler, webhook ≤ 1 MB |
| IA-1 | P0 | Alerta de risco sumia se `safety_flag` não viesse exatamente `true` ou se a IA escrevesse a seção sem a flag | resolvido: booleano tolerante; alerta liga com a flag, com a seção `alerta` ou com risco nas notas do map |
| IA-2 | P0 | Map-reduce perdia sinais de risco (resumo e condensação não preservavam `safety_concerns`) | resolvido: regra explícita nos dois prompts + servidor liga o alerta se alguma nota tiver risco |
| IA-3 | P0 | `locked_title` podia ter spoiler/nomes (só checava `!== title`) e ficava em texto puro no banco; seções grátis gravavam o título real ali (inclui SEC-4) | resolvido: regras no prompt, conferência no servidor (`guards.ts`), seções grátis com título neutro, coluna cifrada (D83) |
| IA-4 | P0 | Gancho podia revelar a conclusão (exemplo do prompt com "23h"); servidor só checava o tamanho | resolvido: prompt sem números/horários; servidor exige nome e nenhum número, refaz com os títulos neutros (nunca o conteúdo); com alerta de risco, gancho sóbrio |
| TXT-1 | P0 | Textos diziam "Nem nós lemos" e "Nada é enviado para ninguém", mas a conversa é processada pela Groq (contradiz a Política) | resolvido |
| F5-1b | P2 | Invariante do /admin aceitava a chamada em comentário; E2E sem controle positivo | resolvido (b3aa1d6) |
| F5-2b | P2 | `?sslmode=no-verify` na URL sem as variáveis não gerava o aviso `db_tls_unverified` | resolvido (b3aa1d6) |
| F5-4b | P1 | Em produção, Stripe indisponível salvava link/preço novos sem conferir | resolvido (72dd5c2): nada é salvo, o painel pede para tentar de novo |
| F5-4c | P1 | Conferência ignorava cupom, itens opcionais, vários produtos e quantidade ajustável do Payment Link | resolvido (72dd5c2) |
| F5-4d | P2 | Links do outro modo (produção salvo em modo teste) nunca são conferidos | **adiado**: a chave de teste não lê objetos de produção; o DEPLOY.md manda salvar de novo cada link depois de virar para produção, o que dispara a conferência |
| SEC-2 | P1 | Reembolso/contestação que chegava antes da liberação era perdido e a liberação acontecia depois | resolvido (72dd5c2) |
| SEC-3 | P1 | Mesma compra paga por duas sessões (Pix + cartão) passava em silêncio | resolvido (72dd5c2): `duplicate_payment` + alerta |
| SEC-5 | P1 | E-mail "análise pronta" nunca enviado | **não procede**: é enfileirado em `src/server/jobs/generate-main.ts` (chamada em várias linhas) |
| SEC-6 | P1 | E-mail do usuário nunca apagado quando não há mais análises | resolvido (72dd5c2): retenção apaga usuários sem análises nem sessão válida |
| SEC-7 | P1 | Rate limit contornável por IPv6 e injusto com CGNAT | resolvido (6c03135): /64 e limite por IP separado |
| SEC-8 | P1 | Sem teto global de gasto com a Groq | resolvido (6c03135): `UPLOAD_GLOBAL_MAX_PER_HOUR` |
| SEC-9 | P1 | Rate limit não atômico | resolvido (6c03135): advisory lock na transação |
| SEC-10 | P2 | Qualquer pessoa pode criar análises na conta (e-mail) de outra | **adiado**: a pessoa dona só vê depois de entrar pelo link mágico e pode excluir; exige rever D26 (promover sessão leve) — fica para depois do lançamento |
| SEC-11 | P2 | Sessão leve dura 30 dias; sem "sair de todos os aparelhos" | resolvido (6713e86): sessão leve 7 dias; "Sair de todos os aparelhos" em /conta |
| QA-01 | P1 | "Tentar de novo" depois de falha permanente cai num formulário vazio sem explicação (`?erro=` ignorado) (= TXT-8) | resolvido (6713e86): falha permanente oferece "Enviar outra conversa"; /analisar mostra `?erro` |
| QA-02 | P1 | Limites por e-mail e global consumidos antes de validar o arquivo (erro de aba bloqueia 1 h; DoS barato do teto global) | resolvido (6713e86 + 76a7a79): limites só para envios válidos; teto global antes do e-mail; limite por faixa de rede (/24, /48) |
| QA-03 | P1 | "Excluir esta análise" apaga tudo num clique (= UX-3, TXT-9) | resolvido (6713e86): passo de confirmação + campo `confirm` exigido no servidor |
| QA-04 | P2 | Sem confirmação depois de "Excluir tudo" (= TXT-8) | resolvido (6713e86) |
| QA-05 | P1 | Página de retorno acompanha a compra errada (ordem por `created_at` com compra pendente reaproveitada) | resolvido (6713e86): ordena por última atividade, `?link` escolhe entre as compras do usuário, filtra por `canAccess` |
| QA-06 | P1 | Vitrine não atualiza depois de "Sou X" | resolvido (6713e86): `revalidatePath` + redirect com query |
| QA-07 | P1 | Contraste `text-stone-400` abaixo de AA (= UX-8) | resolvido (6713e86): stone-500/600; tolerância do axe removida |
| QA-08 | P1 | HEIC anunciado e aceito no envio, mas falha no worker (= TXT-6) | resolvido (6713e86): `heic_unsupported` no envio; HEIC fora do rótulo e do `accept` |
| QA-09 | P2 | Enviar com outro e-mail troca a sessão sem aviso | resolvido (d3c4f04): aviso quando o e-mail digitado é outro |
| QA-10 | P2 | Link mágico sempre leva a /minhas-analises | **adiado**: exige guardar o destino junto do token do link mágico (mudança de schema); a análise aparece em /minhas-analises logo após entrar |
| QA-11 | P2 | Confirmação: rádio usa o nome detectado; grupo com a mesma pessoa duas vezes sem explicação (= UX-4 parcial) | resolvido (d3c4f04) |
| QA-12 | P2 | Envio: trocar de aba apaga o texto; sem checagem de tamanho no navegador; /minhas-analises sem excluir | resolvido (d3c4f04): texto preservado, checagem de tamanho no navegador, excluir em /minhas-analises |
| IA-5 | P1 | Seções grátis antecipam as conclusões das pagas | resolvido: regra e briefs no prompt (main-report .3); servidor detecta e refaz a seção grátis uma vez (`anticipatesPaidConclusion`, D85) |
| IA-6 | P1 | Orçamento de tokens apertado; truncamento repete a mesma chamada; esforço único | resolvido: `reasoningEffort` por chamada ("low" em gancho, resumo, condensação e regeneração); truncada → ×1,5 (teto 16k); adicional até 7000; env padrão sem mudança |
| IA-7 | P1 | Estatísticas induzem números falsos (sem horários, base pequena, regex de carinho) | resolvido: "n/d" sem horários, "(base: N respostas)", datas de início e fim, dias de calendário, lookarounds Unicode, exemplo sem "9 de cada 10", regra de amostra < 10 |
| IA-8 | P1 | `esfriando`/`linha-do-tempo` pedem dados por período que o contexto não tem | resolvido: bloco "ESTATÍSTICAS POR PERÍODO" (primeiro × último terço, ≥ 40 mensagens); ano no horário se > 300 dias; templates comparam só esses números |
| IA-9 | P1 | Citações não conferidas com a mensagem; `"#812"` descartado | resolvido: zod aceita "#812"; `sanitizeEvidence` confere contra a mensagem de texto real (corrige seq vizinho, troca pelo trecho real ou descarta) |
| IA-10 | P1 | Faltam regras de especificidade e contra conselhos de controle | resolvido: ESPECIFICIDADE, clichês proibidos e CONSELHOS sem controle/vigilância em `TONE_RULES` |
| IA-11 | P1 | Conversas curtas sem tratamento | resolvido: "AMOSTRA CURTA" (< 40 mensagens) no cabeçalho + regra no prompt |
| IA-12 | P1 | Delimitadores contra injeção podem ser fechados de dentro da conversa | resolvido: `</?conversa>`/`</?notas>` neutralizados (‹) em mensagens, notas e nomes; nomes sem quebras/controles; regra de injeção reforçada |
| IA-13 | P1 | Adicional incoerente com o principal; label × score do placar | resolvido: bloco "LEITURA JÁ ENTREGUE" (títulos do principal liberado); label do `quem-gosta-mais` derivado do score |
| IA-14 | P2 | Parse falha com variações comuns de JSON | resolvido: `not_json` no segundo parse; content em lista; sections como objeto; key normalizada |
| IA-15 | P2 | README dos prompts, regeneração no adicional, Disque 100 | resolvido: `src/server/ai/prompts/README.md`; seção de conselhos do adicional regenerada; "Já escritas" na regeneração; Disque 100 no texto padrão |
| UX-1 | P1 | Cabeçalho quebra a 375 px; logo emoji; CTA de analisar compete com o de pagamento | resolvido (d3c4f04) |
| UX-2 | P1 | Paywall com CTA único no meio; a última ação da página é "Excluir"; preço perdido no botão | resolvido (d3c4f04): preço em destaque + CTA no fim (`#desbloquear`); barra fixa no mobile **não feita** (cobriria conteúdo; o CTA final resolve) |
| UX-4 | P1 | Confirmação: legenda sobre a borda, rádios pequenos, botão sem largura total | resolvido (d3c4f04) |
| UX-5 | P1 | Abas do envio: ARIA de tabs incompleta, alvos de 38 px, quebra em 2 linhas | resolvido (d3c4f04): grupo de rádios |
| UX-6 | P1 | Alvos de toque < 44 px (rodapé, evidências, telefones do alerta, "Sou X") | resolvido (d3c4f04) |
| UX-7 | P1 | `prefers-reduced-motion` ignorado | resolvido (d3c4f04) |
| UX-9 | P1 | Retorno do pagamento: spinner infinito, estado lento sem saída, falha sem "tentar de novo" | resolvido (d3c4f04) |
| UX-10 | P2 | Sem `loading.tsx`; envio sem estado; dicas mudam de altura | resolvido (d3c4f04): esqueletos + layout que garante 404 antes do esqueleto (D91) |
| UX-11 | P2 | Aviso de IA repetido até 3 vezes | resolvido (d3c4f04) |
| UX-12 | P2 | Landing: garantias de privacidade escondidas; "como funciona" com cara de template | resolvido (d3c4f04) |
| UX-13 | P2 | Seção bloqueada: emoji de cadeado, sem convite ao CTA | resolvido (d3c4f04) |
| UX-14 | P2 | Vitrine: parede de botões iguais; beco sem saída do "quem é você" | resolvido (d3c4f04) |
| UX-15 | P2 | Foco inconsistente | resolvido (d3c4f04) |
| UX-16 | P2 | Faixa "pendente de revisão jurídica" visível ao usuário em Termos/Privacidade | resolvido (d3c4f04) |
| TXT-2 | P1 | Termos citam arrependimento/"ciência" sem regra clara de reembolso | resolvido (texto): reembolso em até 7 dias pela Ajuda + aviso junto do botão de pagamento (D92); **prazo e texto pendentes de validação jurídica** |
| TXT-3 | P1 | Notas internas publicadas na Privacidade; contato "em breve" | resolvido (texto): notas removidas, Groq como operadora; sem e-mail configurado, frase neutra (D92) |
| TXT-4 | P1 | CTA exagera ("as mais reveladoras"); falta "pagamento único, sem assinatura" | resolvido (texto) |
| TXT-5 | P1 | Com alerta de risco, CTA de venda colado ao alerta; quadro não explica por que aparece | resolvido (texto): quadro explica o motivo; CTA neutro com alerta (gancho já resolvido em IA-4) |
| TXT-7 | P1 | Adicional pago que falhou não tranquiliza o usuário | resolvido (texto) |
| TXT-10 | P1 | Erros de envio não dizem o que fazer | resolvido (texto) |
| TXT-11 | P1 | "Sua análise fica guardada" contradiz a exclusão em 7 dias | resolvido (texto) |
| TXT-12 | P2 | Retorno do pagamento: texto do principal também nos adicionais | resolvido (texto) |
| TXT-13 | P2 | Confirmação: "diga quem é você" (é opcional); plurais com (s) | resolvido (texto) |
| TXT-14 | P2 | "Análise" × "relatório" misturados | resolvido (texto): "análise" = o pacote (conversa + relatórios); "relatório" = o documento |
| TXT-15 | P2 | Preço dos adicionais como "cada" quando pode variar ("a partir de") | resolvido (30b53c8): "a partir de" quando os preços dos adicionais diferem |
| SEO-1 | P1 | `X-Robots-Tag` ausente (JSON de exportação, APIs e 404 sem noindex); `/analisar` fora do grupo | resolvido (30b53c8) |
| SEO-2 | P1 | Páginas privadas sem `nofollow` | resolvido (30b53c8) |
| SEO-3 | P1 | Indexação liberada por padrão no layout raiz; 404 com duas metas robots | resolvido (30b53c8): layout raiz noindex; (marketing) e landing liberam; invariante |
| SEO-4 | P1 | Sitemap lista `/analisar` (noindex); `APP_URL` lido fora do `env.ts` | resolvido (30b53c8) |
| SEO-5 | P2 | `Disallow` impede o Google de ver o `noindex` | resolvido (30b53c8): só /api e /admin bloqueados |
| SEO-6 | P1 | Sem canonical | resolvido (30b53c8) |
| SEO-7 | P1 | Ajuda/Termos/Privacidade herdam a descrição da landing | resolvido (30b53c8) |
| SEO-8 | P1 | Sem JSON-LD (Organization, WebSite, Product com preço cobrado) | resolvido (30b53c8): preço cobrado vindo de `publicPrices()` |
| SEO-9 | P1 | Sem `FAQPage` em /ajuda | resolvido (30b53c8) |
| SEO-10 | P2 | FAQ da landing diverge da ajuda | resolvido (30b53c8): `src/lib/faq.ts` único |
| SEO-11 | P1 | Landing espera o banco sem cache nem timeout de conexão (TTFB/LCP) | resolvido (30b53c8): cache de 60 s por processo (limpo ao salvar no /admin) + `connectionTimeoutMillis` |
| SEO-12 | P2 | Lorem em latim no HTML da landing; hierarquia de títulos | resolvido (d3c4f04): `data-nosnippet` e `headingLevel` |
| SEO-13 | P2 | Imagem OG sem negrito; sem ícones maiores | parcial (30b53c8): ícones `icon`/`apple-icon` gerados; negrito na imagem OG **adiado** (exige commitar um arquivo de fonte) |
| SEO-14 | P2 | Rotas de imagem passam pelo proxy da CSP | resolvido (30b53c8) |
| SEO-15 | P2 | TTFB depende do servidor (D24): medir depois do deploy | **adiado**: só dá para medir em produção (DEPLOY.md, checklist) |
| REV-1 | P0 | Revisão de código: regras do alerta de risco deixavam passar sinais graves (ideação suicida, coerção, "brincadeira") | resolvido (c10d5b5 → d99bff2, 5 rodadas): qualquer nota de risco liga o alerta; seção `alerta` só é ignorada se for apenas uma negação completa (D90) |
| REV-2 | P1 | Revisão: nomes só reconhecidos completos (spoiler com o primeiro nome); citações atribuídas à pessoa errada; títulos pagos no prompt de seção grátis | resolvido (76a7a79) |
| REV-3 | P1 | Revisão: corrida/deadlock entre reembolso e liberação; locked_title legado nunca cifrado; decisões sem registro no plano | resolvido (76a7a79, c10d5b5): advisory lock na mesma ordem; cifragem do legado na inicialização; D87–D90 |
| SEC-M1 | P1 | Security: teto global esgotável com poucos IPs | resolvido (76a7a79): limite por faixa de rede + teto antes do e-mail + alerta |
| SEC-M2 | P1 | Security: link recorrente/inativo/URL de outro link passava na conferência | resolvido (76a7a79) |
| FIN-1 | P1 | Rodada final (code-reviewer): aviso de conteúdo digital/reembolso só no botão principal, não na vitrine; Privacidade não citava as prints; promessa de reembolso sem `SUPPORT_EMAIL` | resolvido (232556e): `PaymentNotice` em todo botão de compra; prints citadas; `SUPPORT_EMAIL` obrigatório em produção |
| FIN-2 | P1 | Rodada final (security): teto global ainda esgotável; reconciliação podia liberar pagamento reembolsado; Payment Link com imposto/frete/redirect errado | resolvido (232556e) |
| FIN-3 | P2 | Rodada final: alertas engolidos pelo dedup; duplicado reprocessado; login sem teto global; `APP_URL` http em produção; retenção após reembolso | resolvido (232556e) |
| FIN-4 | P2 | Rodada final (security): TLS do banco sem verificar o servidor na Square Cloud (`no-verify`) | **adiado** (D94): depende da Square Cloud fornecer a CA; DEPLOY.md orienta pedir ao suporte e preencher `DATABASE_SSL_CA_BASE64` |

**Resumo de status:** todos os P0 e P1 estão resolvidos, exceto os itens adiados com motivo (D94); nenhum P0/CRÍTICO restante na rodada final do security-auditor; code-reviewer aprovou a rodada final.

## Achados por agente (resumo)

- **security-auditor**: 8 na revisão da fase 5 (F5-1 a F5-8) + 3 complementos + 11 na auditoria geral (SEC-1 a SEC-11, sendo SEC-4 mesclado em IA-3).
- **qa-tester**: 12 (QA-01 a QA-12); criou `a11y.spec.ts` (axe, 375 e 1280 px), `qa-flows.spec.ts`, `qa-payment-return.test.ts`, `qa-extras-showcase.test.ts`, `qa-heic.test.ts`. Bugs ainda abertos ficam como `fixme`/`it.fails` (rode com `QA_RUN_BUGS=1`).
- **report-prompt-engineer**: 15 (IA-1 a IA-15).
- **frontend-designer**: 15 (UX-1 a UX-15) + 1 decisão (UX-16). UX-3 = QA-03, UX-8 = QA-07.
- **copywriter-ptbr**: 15 (TXT-1 a TXT-15). TXT-6 = QA-08, TXT-8 = QA-01/QA-04, TXT-9 = QA-03.
- **seo-performance**: 15 (SEO-1 a SEO-15), nenhuma página privada indexável com dado do usuário.

Duplicatas foram mescladas no ID indicado entre parênteses.
