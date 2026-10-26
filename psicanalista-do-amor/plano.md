# Plano de desenvolvimento — Psicanalista do Amor

> SaaS de análise de relacionamentos: o usuário envia uma conversa entre duas pessoas e recebe um relatório da dinâmica entre elas. Metade do relatório é grátis; o relatório completo rende R$ 30 líquidos. Depois disso, relatórios adicionais rendem R$ 10 líquidos cada. O cliente paga o preço com a taxa do Stripe repassada (R$ 31,66 e R$ 10,83 com a taxa padrão — ver 6.7). Opcionalmente, há a **assinatura mensal** (R$ 46,99 líquidos; R$ 49,35 cobrados): até 10 relatórios completos por dia, adicionais incluídos, e R$ 5 líquidos (R$ 5,62) por relatório completo além do limite do dia (ver 6.8 e D96).
>
> Este arquivo é a **fonte da verdade** do projeto. Marque `[x]` nos checklists da seção 11 conforme as tarefas forem concluídas.
>
> Documentação externa consultada em 23/10/2026: Groq (`/docs/models`, `/docs/vision`, `/docs/deprecations`) e Stripe (`/payments/pix`, `/payment-links/url-parameters`).

---

## 1. Visão geral e fluxo do usuário

### Proposta de valor
"Cole a conversa, descubra o que está nas entrelinhas." Uma leitura feita por IA da dinâmica entre duas pessoas: quem puxa assunto, como cada um demonstra afeto, onde estão os atritos e o que muda tudo.

### Fluxo completo

1. **Landing** (`/`): proposta, exemplo de relatório (fictício), preço, aviso de que é IA, CTA "Analisar uma conversa".
2. **Envio** (`/analisar`): o usuário escolhe uma forma de entrada:
   - colar texto;
   - enviar `.txt` (exportação do WhatsApp);
   - enviar `.zip` (prints **ou** exportação do WhatsApp "com mídia", que vem como zip com `_chat.txt`);
   - enviar prints diretamente (1 a N imagens).
   Informa o e-mail e marca os consentimentos obrigatórios (termos, privacidade, declaração de que tem 18+ e participa da conversa ou tem autorização para analisá-la).
3. **Processamento** (`/r/[id]/processando`): tela de progresso por etapas (Recebendo → Lendo prints → Organizando mensagens → Pronto para confirmar). Atualiza por polling a cada 2 s.
4. **Confirmação dos participantes** (`/r/[id]/confirmar`): o sistema mostra os remetentes detectados (ou "Pessoa da esquerda/direita" nas prints) com a contagem de mensagens e algumas amostras. O usuário:
   - dá nome a cada um (ou mantém o detectado);
   - indica qual dos dois é ele (opcional, mas melhora "Como responder a última mensagem");
   - se houver mais de 2 remetentes (grupo), escolhe os 2 que serão analisados.
5. **Geração** (`/r/[id]/processando`): estatísticas determinísticas + relatório principal pela IA. Barra de progresso (Analisando trecho 3 de 7 → Escrevendo relatório).
6. **Relatório com corte** (`/r/[id]`): as seções gratuitas aparecem completas. A última termina com a **frase-gancho**. Abaixo, as seções bloqueadas aparecem só com título instigante e um bloco de "texto falso" desfocado (gerado no client, sem nenhum conteúdo real). CTA "Desbloquear relatório completo — R$ 31,66" (preço cobrado, ver 6.7).
7. **Pagamento**: o clique cria uma `purchase` pendente no servidor e redireciona para o Payment Link do Stripe com `client_reference_id=<purchase.id>` e `prefilled_email`. O usuário paga com cartão ou Pix.
8. **Retorno** (`/r/[id]/pagamento`): "Confirmando pagamento…" com polling do status da compra. **Não libera nada**: só mostra o que o webhook já liberou.
9. **Webhook** (`/api/webhooks/stripe`): valida a assinatura, confere valor/link/moeda, marca a compra como paga e libera o relatório. A tela de retorno detecta e redireciona para o relatório completo.
10. **Relatórios adicionais**: com o principal pago, aparece a vitrine de relatórios adicionais (R$ 10,83 cada, R$ 10 líquidos) no fim do relatório. Mesmo fluxo de compra; após o webhook, um job gera o relatório adicional com a conversa já processada; o usuário acompanha o progresso e lê.
11. **Retorno posterior**: o usuário volta pelo navegador onde enviou (sessão ativa) ou pede um link mágico por e-mail em `/entrar`, e vê tudo em `/minhas-analises`.
12. **Exclusão**: em qualquer análise ou em `/conta`, o usuário pode excluir a análise ou todos os seus dados.

---

## 2. Arquitetura e stack

| Camada | Escolha | Justificativa |
|---|---|---|
| App web | **Next.js 16 (App Router) + TypeScript estrito** | Server Components permitem montar o relatório recortado no servidor; Route Handlers para webhook e uploads; um só repositório. |
| UI | **Tailwind CSS 4** + componentes próprios (shadcn/ui onde ajudar) | Rápido, consistente, sem CSS solto. |
| ORM | **Drizzle ORM** + drizzle-kit | SQL explícito, migrations versionadas, tipos inferidos; já usado em outros projetos do dono. |
| Banco | **PostgreSQL 16** (Docker em dev; Postgres da Square Cloud em produção, com certificado de cliente — D69) | Exigido. Também guarda a fila de jobs e o rate limit, evitando Redis. |
| Fila/jobs | **pg-boss** (fila sobre o próprio Postgres) + **processo worker separado** | Sem serviço extra; retries, backoff, agendamento e singleton prontos. OCR e geração levam de segundos a minutos e não podem rodar dentro de uma requisição HTTP. |
| IA | **Groq** via SDK oficial `groq-sdk` | Exigido. Modelos configuráveis por env (ver 5.1). |
| Pagamento | **Stripe Payment Links** (BRL) + webhook | Exigido. Sem página de checkout própria = menos superfície de PCI. |
| Arquivos | Interface `Storage` com driver **local** (dev) e **S3-compatível** (produção: Cloudflare R2 ou AWS S3) | Arquivos originais são temporários (apagados após o processamento). |
| E-mail | **SMTP (Gmail)** enquanto não há domínio próprio; **Resend** depois (D95) | Link mágico e aviso "seu relatório está pronto". |
| Validação | **zod** | Entrada de formulários, env, e saída da IA (tolerante). |
| Imagens | **sharp** | Normalizar/reduzir prints antes do OCR (economiza tokens e respeita o limite de 20 MB). |
| Zip | **yauzl** (leitura em streaming) | Permite checar cada entrada antes de extrair (zip bomb, path traversal). |
| Logs | **pino** com `redact` | Logs estruturados sem conteúdo de conversas. |
| Testes | **Vitest** (unidade/integração) + **Playwright** (e2e) | Parsers, recorte de conteúdo e webhook são críticos e testáveis. |

### Hospedagem
Next.js e worker precisam rodar como **processos persistentes** (o worker não cabe em serverless). Recomendação: **um container com dois processos** (`web` e `worker`). Hospedagem principal: **Square Cloud** com o PostgreSQL dela (D69, D70); Railway, Fly.io ou Docker como alternativas. Passo a passo em `DEPLOY.md`.

### Diagrama lógico

```
Navegador ──► Next.js (web)
               ├─ Server Components: monta relatório JÁ recortado
               ├─ /api/uploads ──► Storage (temp) ──► pg-boss: "ingest"
               ├─ /api/webhooks/stripe ──► libera conteúdo / enfileira "extra"
               └─ Server Actions: confirmar participantes, criar purchase, excluir dados
Worker (pg-boss)
               ├─ ingest: txt/zip/imagens/texto ──► OCR (Groq visão) ──► mensagens normalizadas
               ├─ generate_main: estatísticas + map-reduce ──► Groq texto ──► seções
               ├─ generate_extra: relatório adicional pago
               └─ cleanup: retenção (agendado diariamente)
PostgreSQL ◄── tudo (dados sensíveis cifrados com AES-256-GCM na aplicação)
```

---

## 3. Modelagem do banco

Convenções: `id` em **UUID v7** (não sequencial, não adivinhável); `created_at`/`updated_at` em `timestamptz`; nomes de tabelas e colunas em `snake_case`, em inglês. Campos marcados 🔒 são **cifrados na aplicação** (AES-256-GCM, guardados como `bytea` ou texto base64 `v1:iv:tag:ciphertext`).

### `users`
| campo | tipo | notas |
|---|---|---|
| id | uuid PK | |
| email | text unique | normalizado em minúsculas |
| email_verified_at | timestamptz null | preenchido ao usar o link mágico |
| created_at, updated_at | timestamptz | |
| deleted_at | timestamptz null | exclusão pedida (dados apagados em seguida) |

### `sessions`
| id (uuid PK) | user_id FK → users | token_hash (text unique, SHA-256 do cookie) | expires_at | created_at | user_agent_hash |

### `login_tokens` (link mágico)
| id | email | token_hash (unique) | expires_at (15 min) | used_at null | created_at |

### `consents`
| id | user_id FK | conversation_id FK null | kind (`terms` \| `privacy` \| `third_party_data` \| `adult`) | version (ex.: `2026-10-23`) | accepted_at | ip_hash |

### `conversations`
| campo | tipo | notas |
|---|---|---|
| id | uuid PK | |
| user_id | FK → users | dono |
| source_type | enum `paste` \| `txt` \| `zip_images` \| `zip_whatsapp` \| `images` | |
| status | enum `uploaded` \| `processing` \| `needs_confirmation` \| `ready` \| `failed` \| `deleted` | |
| progress | jsonb | `{ step, current, total }` para a tela de progresso (sem conteúdo) |
| error_code | text null | código genérico, nunca texto da conversa |
| participant_a_name 🔒 | text | nome de exibição escolhido |
| participant_b_name 🔒 | text | |
| user_is | enum `a` \| `b` \| `none` | quem é o usuário |
| message_count | int | |
| has_timestamps | bool | |
| started_at, ended_at | timestamptz null | período coberto |
| stats | jsonb | métricas determinísticas (contagens, tempos de resposta) — números apenas |
| files_purged_at | timestamptz null | quando os originais foram apagados |
| last_accessed_at | timestamptz | base da retenção |
| expires_at | timestamptz | data de exclusão automática |
| created_at, updated_at | | |

### `conversation_files` (temporário)
| id | conversation_id FK | storage_key | original_name 🔒 | mime | size_bytes | sha256 | order_index | purged_at null |

### `messages` (formato normalizado)
| campo | tipo | notas |
|---|---|---|
| id | uuid PK | |
| conversation_id | FK (on delete cascade) | |
| seq | int | ordem na conversa; unique (conversation_id, seq) |
| sender | enum `a` \| `b` \| `other` \| `system` | papel normalizado |
| sender_raw 🔒 | text | nome como veio no arquivo |
| sent_at | timestamptz null | quando houver |
| kind | enum `text` \| `media_omitted` \| `deleted` \| `sticker` \| `audio` \| `system` | |
| content 🔒 | text | |
| source | enum `text` \| `ocr` | |
| ocr_confidence | real null | |

> Índice: `(conversation_id, seq)`. Como `content` é cifrado, não há busca textual no banco (intencional).

### `report_types` (catálogo; relatório principal e adicionais)
| campo | tipo | notas |
|---|---|---|
| id | uuid PK | |
| slug | text unique | `principal`, `quem-gosta-mais`, … |
| kind | enum `main` \| `extra` \| `subscription` \| `overage` | `subscription` (assinatura mensal) e `overage` (relatório do assinante além do limite) não geram relatório: guardam preço e Payment Link (D96) |
| name | text | "Quem demonstra mais interesse?" |
| teaser | text | descrição curta na vitrine |
| description | text | |
| price_cents | int | preço em centavos |
| currency | text | `brl` |
| prompt_template | text | prompt específico do tipo (ver 5.4) |
| output_schema_version | int | para evoluir o formato |
| stripe_payment_link_id | text | `plink_...` (conferido no webhook) |
| stripe_payment_link_url | text | `https://buy.stripe.com/...` |
| stripe_test_payment_link_id / _url | text null | links do modo teste |
| sort_order | int | |
| is_active | bool | |
| requires_user_side | bool | ex.: "Como responder" exige saber quem é o usuário |
| created_at, updated_at | | |

Cadastrar um novo relatório adicional = inserir uma linha (via `npm run db:seed` ou painel admin na Fase 4) + criar o Payment Link no Stripe.

### `reports`
| campo | tipo | notas |
|---|---|---|
| id | uuid PK | |
| conversation_id | FK (cascade) | |
| report_type_id | FK → report_types | unique (conversation_id, report_type_id) |
| status | enum `pending_payment` \| `queued` \| `generating` \| `ready` \| `failed` | principal: gera antes de pagar; adicional: gera depois |
| hook_text 🔒 | text null | frase-gancho (só no principal) |
| free_section_count | int | quantas seções iniciais são grátis |
| is_unlocked | bool | **só o webhook muda para true** |
| unlocked_at | timestamptz null | |
| model_used | text | modelo Groq efetivo (auditoria) |
| prompt_version | text | |
| tokens_in, tokens_out | int | custo |
| error_code | text null | |
| created_at, updated_at | | |

### `report_sections`
| campo | tipo | notas |
|---|---|---|
| id | uuid PK | |
| report_id | FK (cascade) | |
| position | int | unique (report_id, position) |
| key | text | `abertura`, `quem-puxa-assunto`, … |
| title | text | título real (pode ser exibido mesmo bloqueado) — **não pode conter spoiler** |
| locked_title | text | título instigante para a versão bloqueada |
| content 🔒 | text | Markdown restrito |
| is_free | bool | definido pelo servidor (não pela IA) |
| evidence 🔒 | jsonb | trechos citados `[{ seq, quote }]` |

### `purchases`
| campo | tipo | notas |
|---|---|---|
| id | uuid PK | vai no `client_reference_id` |
| user_id | FK | |
| report_id | FK → reports | o que a compra libera |
| report_type_id | FK | |
| amount_cents | int | preço esperado no momento da compra |
| currency | text | |
| status | enum `pending` \| `paid` \| `failed` \| `expired` \| `refunded` \| `disputed` | |
| stripe_checkout_session_id | text unique null | idempotência |
| stripe_payment_intent_id | text null | |
| payment_method_type | text null | `card` \| `pix` |
| paid_at | timestamptz null | |
| created_at, updated_at | | |

Regra: no máximo uma purchase `paid` por `report_id` (índice parcial unique `WHERE status = 'paid'`). A compra da assinatura (D96) não tem `report_id`.

### `stripe_events` (idempotência do webhook)
| id (text PK = `evt_...`) | type | received_at | processed_at null | error null |

### `access_logs` (Marco Civil da Internet, art. 15 — D100)
| campo | tipo | notas |
|---|---|---|
| id | uuid PK | |
| user_id | uuid null | sem FK de propósito: fica 6 meses mesmo depois da exclusão da conta (obrigação legal) |
| event | text | `login` \| `upload` \| `checkout` \| `data_export` \| `account_deletion` |
| ip | text 🔒 | IP do cliente, cifrado (entra na rotação de chave) |
| occurred_at | timestamptz | |

Apagado automaticamente após 183 dias (job diário de limpeza). Só sai para o próprio titular (exportação) ou por ordem judicial.

### `subscriptions` (assinatura mensal, D96)
| campo | tipo | notas |
|---|---|---|
| id | uuid PK | |
| user_id | FK null | `set null` ao excluir a conta (a assinatura é cancelada no Stripe antes) |
| purchase_id | FK null | compra do primeiro pagamento |
| stripe_subscription_id | text unique | `sub_...` |
| stripe_customer_id | text null | para o portal do cliente e para achar a assinatura num reembolso |
| status | text | status do Stripe (`active`, `trialing`, `past_due`, `canceled`, `unpaid`, ...) |
| livemode | bool | |
| current_period_end | timestamptz null | fim do período pago (itens da assinatura) |
| cancel_at_period_end | bool | |
| revoked_at | timestamptz null | reembolso de cobrança da assinatura |
| last_event_at | timestamptz null | `created` do último evento aplicado (descarta eventos fora de ordem) |
| synced_at, created_at, updated_at | | |

Direito ao uso: `status in (active, trialing)`, `revoked_at` nulo, mesmo modo (teste/produção) e `current_period_end > now()` (sem a data, vale por até 2 dias após a criação).

### `subscription_unlocks` (uso da assinatura)
| campo | tipo | notas |
|---|---|---|
| id | uuid PK | |
| subscription_id | FK cascade | |
| user_id | FK cascade | |
| report_id | FK set null, unique | excluir a análise não devolve a cota |
| counts | bool | `true` = relatório principal (conta no limite); `false` = adicional incluído |
| day | date | dia no horário de Brasília (`America/Sao_Paulo`) |
| created_at | | |

### `rate_limits`
| key_hash (text) | action (`upload` \| `login_email` \| `checkout`) | created_at | — índice (action, key_hash, created_at) |

### `audit_log` (sem conteúdo sensível)
| id | user_id null | action (`report.unlocked`, `data.deleted`, …) | target_id | meta jsonb | created_at |

### Relações
```
users 1─N sessions, consents, conversations, purchases
conversations 1─N conversation_files, messages, reports
report_types 1─N reports
reports 1─N report_sections, purchases
```

---

## 4. Pipeline de processamento por tipo de entrada

Todas as entradas terminam em `NormalizedMessage[]`:

```ts
type NormalizedMessage = {
  seq: number;
  senderRaw: string;          // "Ana", "Pessoa da direita"
  sentAt: Date | null;
  kind: 'text' | 'media_omitted' | 'deleted' | 'sticker' | 'audio' | 'system';
  content: string;
  source: 'text' | 'ocr';
  ocrConfidence?: number;
};
```

Depois da normalização: mapear `senderRaw` → `a`/`b`/`other`/`system` (os dois mais frequentes viram `a` e `b`, o usuário confirma na tela 4), gravar cifrado, apagar os originais, status `needs_confirmation`.

### 4.1 Validação comum (antes de qualquer coisa, no upload)
- Limite total do upload: **25 MB** (`UPLOAD_MAX_BYTES`). Texto colado: até **500 mil caracteres**.
- Tipo verificado por **magic bytes** (`file-type`), não pela extensão nem pelo `Content-Type`. Aceitos: `text/plain`, `application/zip`, `image/png`, `image/jpeg`, `image/webp`, `image/heic` (convertido com sharp).
- Máximo de **60 imagens** por análise (`MAX_IMAGES`), cada uma até **8 MB**.
- `.txt` é decodificado como UTF-8 (com detecção de BOM/UTF-16, que algumas exportações do iPhone usam).
- Rate limit: 5 envios por hora por usuário/IP.
- O arquivo vai para o Storage com nome aleatório (`uploads/<conversationId>/<uuid>`), nunca com o nome original.

### 4.2 Texto colado
1. Tenta o parser do WhatsApp (o usuário costuma colar a exportação).
2. Se não reconhecer, tenta o formato genérico `Nome: mensagem` por linha.
3. Se ainda não reconhecer, pede ao usuário para indicar o formato ou usar outro método (sem chamar IA para "adivinhar" — evita custo e alucinação).

### 4.3 `.txt` do WhatsApp — parser
Formatos a reconhecer (testes com fixtures de cada um):

| Origem | Exemplo |
|---|---|
| Android pt-BR | `23/10/2026 14:05 - Ana: oi` |
| Android 12 h | `10/23/26, 2:05 PM - Ana: oi` |
| iOS pt-BR | `[23/10/2026, 14:05:33] Ana: oi` |
| iOS 12 h | `[10/23/26, 2:05:33 PM] Ana: oi` |
| Variantes | separador `,` ou espaço; `-` ou `–`; ano com 2 ou 4 dígitos; caractere invisível `‎` no início; `a.m./p.m.` |

Regras:
- Regex de início de mensagem testada linha a linha; linhas que não casam são **continuação** da mensagem anterior (mensagens multilinha).
- Linhas de sistema (sem `Nome:`) → `kind: system` (ex.: "As mensagens e ligações são protegidas…", "X mudou o número").
- `<Mídia oculta>`, `<arquivo de mídia oculto>`, `imagem ocultada`, `áudio omitido` etc. → `media_omitted` ou `audio`.
- "Esta mensagem foi apagada" / "Você apagou esta mensagem" → `deleted`.
- Ordem dia/mês ambígua (`05/06/26`): detectar pelo conjunto (se algum primeiro campo > 12 → DD/MM; se algum segundo > 12 → MM/DD; senão assumir DD/MM para pt-BR).
- Fuso: interpretar no fuso `America/Sao_Paulo` por padrão (configurável na confirmação).
- Exportação "com mídia" (`.zip` com `_chat.txt` ou `WhatsApp Chat with X.txt`): usar apenas o `.txt`; ignorar mídia.

### 4.4 `.zip`
Leitura em streaming com `yauzl`, **sem extrair para disco** de forma ingênua:
1. Rejeitar se o zip tiver mais de **200 entradas** ou se a soma dos tamanhos descompactados declarados passar de **100 MB**.
2. Para cada entrada: rejeitar caminhos absolutos, com `..`, com `\`, com bytes nulos ou links simbólicos (atributo externo Unix). Usar apenas o *basename* gerado por nós.
3. Rejeitar razão de compressão > **100:1** por entrada e contar os bytes **reais** lidos durante a descompressão (abortar ao passar do limite, sem confiar no tamanho declarado).
4. Zip dentro de zip: ignorado (não recursivo).
5. Ignorar `__MACOSX/`, `.DS_Store`, `Thumbs.db`.
6. Classificar: se houver `.txt` de WhatsApp → fluxo 4.3. Senão, imagens → fluxo 4.5 (ordem: ordenação natural do nome do arquivo, ex.: `Screenshot_2.png` antes de `Screenshot_10.png`; empate pela data no EXIF ou no nome).
7. Zip protegido por senha ou corrompido → erro amigável.

### 4.5 Prints (diretas ou do zip) — OCR com visão
1. **Pré-processamento (sharp)**: remover metadados EXIF (inclui GPS), converter para JPEG/WebP, limitar o lado maior a ~2.000 px, rotacionar conforme EXIF. Hash perceptual simples para descartar prints duplicadas.
2. **Lotes**: o modelo de visão atual aceita até **3 imagens por requisição** (ver 5.1). Enviar em lotes de até `GROQ_VISION_MAX_IMAGES_PER_REQUEST` imagens consecutivas, em ordem.
3. **Prompt de extração** (5.2) devolve JSON por imagem: mensagens com `side` (`left`/`right`), nome se visível, horário se visível, texto, e marcação de mídia/figurinha.
4. **Costura entre prints**: prints consecutivas costumam se sobrepor. Remover a sobreposição comparando as últimas K mensagens de uma print com as primeiras da seguinte (mesmo lado + texto normalizado com distância de Levenshtein pequena).
5. **Remetentes**: `right` normalmente é quem tirou a print (o usuário). Na confirmação, mostrar "Pessoa da direita" / "Pessoa da esquerda" (ou o nome lido no cabeçalho do chat) e deixar o usuário nomear.
6. **Horários**: prints quase sempre têm só a hora (e às vezes separadores de dia "Hoje", "Ontem", "12 de outubro"). Guardar a hora quando houver; data só quando o separador permitir. `has_timestamps` fica `false` se a cobertura for baixa, e as métricas de tempo de resposta são omitidas.
7. **Confiança**: se o modelo marcar trechos ilegíveis, gravar `ocr_confidence` baixo e avisar na confirmação ("3 prints ficaram difíceis de ler").
8. Progresso: `Lendo prints (12 de 40)`.

### 4.6 Pós-normalização
- Descartar mensagens `system` da análise (mantidas para contexto de datas).
- Se depois disso houver < **20 mensagens** de texto, avisar que a análise fica pouco confiável (permite seguir).
- Calcular `stats` (determinístico, sem IA): mensagens por pessoa, palavras por pessoa, quem inicia conversas (primeira mensagem após 6 h de silêncio), tempo mediano de resposta de cada um, horários mais ativos, emojis mais usados, perguntas feitas, mensagens apagadas. Esses números entram no prompt como **fatos** e evitam que a IA invente estatísticas.
- **Apagar os arquivos originais** do Storage e marcar `files_purged_at`.

---

## 5. Estratégia de prompts (Groq)

### 5.1 Modelos (configuráveis por env — nada fixo no código)
Conferido em `console.groq.com/docs` em 23/10/2026:

| Uso | Variável | Valor inicial | Observações |
|---|---|---|---|
| OCR das prints | `GROQ_VISION_MODEL` | `qwen/qwen3.8-27b` | Único modelo de visão em acesso geral. Até 3 imagens por requisição, ~2.048 tokens por imagem, requisição até 20 MB, aceita `json_object`. Atenção: a página de modelos lista-o como *preview*. |
| Relatório principal e adicionais | `GROQ_REPORT_MODEL` | `openai/gpt-oss-120b` | 131k de contexto, até 65k de saída. Modelo de raciocínio: usar `include_reasoning: false` e `reasoning_effort` configurável; tokens de raciocínio contam no `max_completion_tokens`. |
| Resumo de trechos (map) | `GROQ_SUMMARY_MODEL` | `openai/gpt-oss-20b` | Mais barato e rápido para a etapa de resumo. |

`llama-3.3-70b-versatile`, `llama-3.1-8b-instant` e `llama-4-scout` foram desligados em 2026: **não usar**. Antes de cada fase que mexe com IA, reconferir `/docs/models` e `/docs/deprecations`.

### 5.2 Cliente Groq — robustez
- **Formato de saída**: `response_format: { type: "json_object" }` com o formato descrito no prompt + validação com **zod tolerante** (corrige campos ausentes/nulos). Não usar Structured Outputs estrito: em outro projeto ele recusou (`json_validate_failed`) a maioria das chamadas com schemas grandes, e cada recusa gasta uma chamada inteira.
- **Retries**: até 4 tentativas com backoff exponencial + jitter para `429`, `5xx`, timeout e JSON inválido. No `429`, respeitar `retry-after` e os cabeçalhos `x-ratelimit-reset-tokens` / `x-ratelimit-reset-requests`.
- **Orçamento de tokens**: limitador próprio (token bucket no Postgres, por modelo) que lê `x-ratelimit-remaining-tokens` e evita disparar requisições que vão bater no limite. O `max_completion_tokens` pedido conta no limite por minuto: pedir só o necessário.
- **Concorrência**: o worker processa no máximo `GROQ_MAX_CONCURRENCY` chamadas por vez (padrão 2).
- **Falha definitiva**: o job marca `failed` com `error_code`; o usuário vê "Não conseguimos concluir, tente novamente" com botão de reprocessar (sem novo upload, pois as mensagens normalizadas já estão salvas).
- **Prompt injection**: a conversa vai sempre dentro de delimitadores (`<conversa>…</conversa>`), com a instrução explícita de que é **dado a analisar**, nunca instrução. A saída é sempre validada; nada do que a IA escreve é executado ou vira HTML cru.

### 5.3 Conversas longas (map-reduce)
1. Estimar tokens (≈ caracteres/3,5 para pt-BR; calibrar com o `usage` real).
2. Se a conversa formatada couber em `REPORT_DIRECT_MAX_TOKENS` (padrão 40k), ela vai inteira no prompt.
3. Senão:
   - **Map**: dividir em blocos de ~`CHUNK_TOKENS` (padrão 12k), cortando em limites de conversa (silêncio > 6 h) quando possível, com 20 mensagens de sobreposição. Para cada bloco, o modelo de resumo devolve notas estruturadas: período, temas, momentos marcantes com `seq` e citação curta, comportamentos de A e de B, conflitos, demonstrações de afeto, mudanças de tom.
   - **Reduce**: o relatório é gerado a partir de `stats` + todas as notas (em ordem) + as **últimas 150 mensagens literais** (o fim da conversa importa mais para "como está agora").
   - Se as notas também passarem do limite, resumir as notas em níveis (hierárquico).
4. As notas do map ficam cifradas no banco (tabela `conversation_digests`, opcional na Fase 2) para reaproveitar nos relatórios adicionais sem refazer o map.

Formato das mensagens no prompt (compacto):
```
#812 [12/10 23:41] A: você sumiu hoje
#813 [12/10 23:58] B: tava com a cabeça cheia, desculpa
```

### 5.4 Prompt de extração das prints (visão)
**System** (resumo):
> Você é um extrator de texto de capturas de tela de aplicativos de mensagem (WhatsApp, Instagram, Telegram, iMessage). Transcreva fielmente, sem corrigir ortografia nem resumir. Não invente texto ilegível: use `"[ilegível]"`. Ignore barra de status, teclado e botões. Responda apenas com JSON.

**Saída esperada:**
```json
{
  "images": [
    {
      "index": 0,
      "app": "whatsapp",
      "chat_title": "Ana",
      "messages": [
        { "side": "left",  "sender_name": null, "time": "23:41", "day_label": "Ontem", "kind": "text", "text": "você sumiu hoje", "quoted_text": null, "legible": true },
        { "side": "right", "sender_name": null, "time": "23:58", "day_label": null, "kind": "text", "text": "tava com a cabeça cheia, desculpa", "quoted_text": null, "legible": true },
        { "side": "left",  "sender_name": null, "time": "23:59", "day_label": null, "kind": "sticker", "text": "", "quoted_text": null, "legible": true }
      ]
    }
  ]
}
```

### 5.5 Prompt do relatório principal
**Princípios**:
- Tom: empático, direto, sem diagnóstico clínico, sem rotular ninguém como "narcisista", "tóxico" etc. Falar de **comportamentos observáveis** com evidências (citações curtas com `seq`).
- Nada de certeza sobre sentimentos: "a conversa sugere…", "um padrão que aparece…".
- Usar os nomes escolhidos pelo usuário.
- Usar `stats` como fonte dos números; nunca inventar números.
- **Ordem das seções**: as mais reveladoras/surpreendentes ficam na **segunda metade**. A primeira metade entrega valor real (o usuário precisa sentir que a análise é boa) e prepara o terreno.
- `hook`: uma frase que fecha a parte grátis, cria curiosidade específica sobre o que vem depois e **não revela** a conclusão. Deve citar uma das pessoas pelo nome.
- `locked_title` de cada seção da segunda metade: instigante, sem spoiler.
- Se houver sinais de violência, ameaça, controle extremo ou risco à integridade, a seção de alerta **não fica bloqueada** e inclui recursos de ajuda (Ligue 180, CVV 188, 190). O servidor garante isso (ver 7).

**Seções do relatório principal (8, ordem fixa; o prompt pede todas):**

| # | key | Metade | Conteúdo |
|---|---|---|---|
| 1 | `retrato` | grátis | Resumo da relação em 1 parágrafo + 3 palavras que a definem |
| 2 | `ritmo` | grátis | Quem fala mais, quem puxa assunto, tempos de resposta (de `stats`) e o que isso sugere |
| 3 | `temas` | grátis | Assuntos recorrentes e o "clima" da conversa |
| 4 | `estilos` | grátis | Como cada um se comunica (perguntas, humor, emojis, formalidade) — termina com o gancho |
| 5 | `virada` | bloqueada | O padrão escondido / momento de virada da conversa |
| 6 | `investimento` | bloqueada | Quem está mais investido emocionalmente e os sinais disso |
| 7 | `pontos-de-atrito` | bloqueada | O que gera tensão e como cada um reage |
| 8 | `leitura-final` | bloqueada | Onde a relação parece estar indo + 3 conselhos práticos |

**Saída esperada (JSON):**
```json
{
  "schema_version": 1,
  "participants": { "a": "Ana", "b": "Lucas" },
  "sections": [
    {
      "key": "retrato",
      "title": "O retrato de vocês dois",
      "locked_title": "O retrato de vocês dois",
      "content": "Ana e Lucas mantêm uma conversa…",
      "evidence": [ { "seq": 812, "quote": "você sumiu hoje" } ]
    },
    {
      "key": "estilos",
      "title": "Como cada um fala",
      "locked_title": "Como cada um fala",
      "content": "…"
    },
    {
      "key": "virada",
      "title": "Quando Lucas passou a responder mais rápido",
      "locked_title": "O dia em que algo mudou entre vocês",
      "content": "…"
    }
  ],
  "hook": "Mas existe um padrão no jeito como Lucas responde depois das 23h que muda tudo o que vimos até aqui…",
  "safety_flag": false
}
```
Observação: `title` real de uma seção bloqueada **pode** conter spoiler; por isso o client recebe só `locked_title` enquanto estiver bloqueada.

Parâmetros: `temperature` 0,7; `max_completion_tokens` ~6.000 (ajustar após medir); `reasoning_effort: "medium"`.

Validação pós-geração: 8 seções com as `key` esperadas; seção sem conteúdo → reprocessar só ela (1 tentativa, com "Já escritas"); seção grátis que antecipa conclusão paga → 1 nova tentativa; `hook` ruim → gerar só o gancho numa chamada curta; citações conferidas contra a mensagem de texto real (D85).

### 5.6 Prompts dos relatórios adicionais
Cada `report_types.prompt_template` contém só a **parte específica** (objetivo, seções, critérios). O sistema monta: `system` comum (tom, segurança, formato) + `prompt_template` + contexto (stats + notas do map ou conversa inteira + nomes + quem é o usuário).

Saída comum a todos os adicionais:
```json
{
  "schema_version": 1,
  "sections": [ { "key": "…", "title": "…", "content": "…", "evidence": [] } ],
  "verdict": { "label": "Lucas demonstra mais interesse", "score": 64, "explanation": "…" }
}
```
(`verdict` opcional, usado para relatórios com "placar", ex.: interesse 64% × 36%.)

**Catálogo inicial (R$ 10 líquidos cada; preço cobrado em 6.7):**

| slug | Nome | Ideia |
|---|---|---|
| `quem-gosta-mais` | Quem demonstra mais interesse? | Placar de investimento com sinais de cada lado |
| `red-flags` | Red flags e sinais de alerta | Padrões preocupantes (com recursos de ajuda quando couber; nunca bloqueado se houver risco) |
| `linguagem-do-amor` | A linguagem do amor de cada um | Como cada um demonstra e pede afeto |
| `conflitos` | Padrões de conflito | Gatilhos, como cada um reage, como as brigas terminam |
| `futuro` | Compatibilidade e futuro | Pontos fortes, riscos e cenários |
| `como-responder` | Como responder a última mensagem | 3 opções de resposta (tons diferentes) para a última mensagem recebida; exige `user_is` |

**Propostas adicionais:**

| slug | Nome | Ideia |
|---|---|---|
| `linha-do-tempo` | A linha do tempo de vocês | Fases da relação e os momentos de virada, com datas |
| `esfriando` | Está esfriando? | Compara início × fim (frequência, tamanho, carinho, tempo de resposta) |
| `nao-ditos` | O que não está sendo dito | Assuntos evitados, perguntas sem resposta, mudanças de assunto |
| `ciume-inseguranca` | Ciúme e insegurança | Sinais de cada lado e como aparecem |
| `perfil-comunicacao` | O perfil de comunicação de cada um | Estilo, necessidades e como falar melhor com o outro |
| `mensagens-marcantes` | As 10 mensagens que mais disseram | As mensagens com maior peso emocional e por quê |
| `amizade-ou-algo-mais` | Amizade ou algo mais? | Para conversas ambíguas (crush, ficante) |

---

## 6. Fluxo de pagamento (Stripe Payment Links + webhook)

### 6.1 Configuração no Stripe (manual, uma vez por ambiente)
1. Conta Stripe **Brasil**, moeda BRL.
2. Criar os preços em BRL com o **preço cobrado** mostrado no `/admin` (líquido + taxa, ver 6.7): R$ 31,66 para o relatório principal e R$ 10,83 para cada adicional com a taxa padrão.
3. Criar um **Payment Link** por produto, quantidade fixa 1, sem coleta de endereço, confirmação **redirect** para `${APP_URL}/pagamento/retorno?link=<slug>` (a página descobre a compra pela sessão do usuário, não pela URL).
4. Formas de pagamento: **cartão** e **Pix** (ver 6.5).
5. Webhook endpoint `${APP_URL}/api/webhooks/stripe` com os eventos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` (os três últimos para a assinatura, D96).
6. Registrar `plink_...` e URL de cada link em `report_types` (seed por ambiente).

### 6.2 Iniciar compra (servidor)
Server Action `startCheckout(reportId)`:
1. Usuário autenticado e dono do relatório.
2. Para adicional: o principal da mesma conversa precisa estar `is_unlocked`.
3. Relatório ainda não liberado (senão, redireciona direto).
4. Rate limit (10/hora).
5. Reaproveita uma `purchase` `pending` recente do mesmo relatório ou cria uma nova com `amount_cents` = preço atual.
6. Redireciona para `${payment_link_url}?client_reference_id=${purchase.id}&prefilled_email=${encodeURIComponent(email)}&locale=pt-BR`.
   - `client_reference_id` aceita até 200 caracteres alfanuméricos, `-` e `_`: um UUID cabe. Valores inválidos são descartados silenciosamente pelo Stripe → o webhook trata a ausência.
   - O ID da compra **não é segredo** e não dá acesso a nada; ele só reconcilia.

### 6.3 Webhook — passo a passo
`POST /api/webhooks/stripe` (runtime Node, corpo **cru**):
1. Ler `await req.text()` e validar com `stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET)`. Falhou → `400`, nada mais.
2. **Idempotência**: numa transação, `INSERT INTO stripe_events (id, type) ON CONFLICT DO NOTHING`. Se já existia e `processed_at` não é nulo → responder `200` e sair.
3. Despachar por tipo:
   - `checkout.session.completed`:
     - `payment_status === 'paid'` → **liberar** (passo 4).
     - `payment_status === 'unpaid'` (pagamento assíncrono pendente) → gravar `stripe_checkout_session_id` e aguardar `async_payment_succeeded`.
   - `checkout.session.async_payment_succeeded` → **liberar**.
   - `checkout.session.async_payment_failed` / `expired` → purchase `failed`/`expired`.
   - `charge.refunded` (total) / `charge.dispute.created` → purchase `refunded`/`disputed`, `reports.is_unlocked = false` (decisão D9), `audit_log`. Reembolso de cobrança da assinatura (sem compra avulsa com aquele PaymentIntent): revoga a assinatura do `charge.customer` e volta a bloquear o que ela liberou (6.8).
   - `customer.subscription.created/updated/deleted` → atualiza `subscriptions` (6.8).
4. **Liberar** (tudo na mesma transação):
   - Buscar a `purchase` por `client_reference_id` (`SELECT … FOR UPDATE`). Não encontrada → registrar `error` no `stripe_events`, alertar (log sem dados pessoais) e responder `200` (reconciliação manual).
   - Conferir: `session.payment_link` = `report_types.stripe_payment_link_id` do tipo da compra; `session.currency === 'brl'`; `session.amount_total >= purchase.amount_cents` (cupom futuro: ajustar regra); `session.mode === 'payment'`.
   - Divergência → não libera, marca erro, alerta.
   - Se a purchase já está `paid` → nada a fazer (idempotente).
   - `purchases`: `status=paid`, `paid_at`, `stripe_checkout_session_id` (unique), `stripe_payment_intent_id`, `payment_method_type`.
   - `reports`: `is_unlocked=true`, `unlocked_at`.
   - Se o relatório é adicional e ainda não foi gerado → enfileirar job `generate_extra` (com `singletonKey = report.id`, para não duplicar).
   - `audit_log` `report.unlocked`.
   - `stripe_events.processed_at = now()`.
5. Responder `200` rápido. Erro inesperado → `500` (o Stripe reenvia; a idempotência protege).
6. Enviar e-mail "seu relatório completo está liberado" **fora** da transação (job).

### 6.4 Página de retorno
`/pagamento/retorno` mostra "Confirmando seu pagamento…" e consulta `GET /api/purchases/latest?report=…` (do usuário logado) a cada 2 s por até 2 min. Quando a compra virar `paid`, redireciona para `/r/[id]`. Se demorar: "Pix pode levar alguns instantes. Você receberá um e-mail quando liberar." **Nenhum parâmetro da URL de retorno libera conteúdo.**

### 6.5 Pix
Conferido na documentação do Stripe (23/10/2026):
- Contas Stripe **do Brasil** aceitam **Pix para pagamentos únicos**, liquidação em BRL (T+2). Funciona em **Payment Links** e Checkout. Pix Automático (recorrente) **não** está disponível para empresas do Brasil (não precisamos).
- Habilitar em *Dashboard → Settings → Payment methods*. Acesso "instant provisional".
- Mínimo R$ 0,50; máximo padrão ~US$ 3.000 por pagamento: R$ 10,83 e R$ 31,66 cabem.
- Reembolso em até 90 dias. Contestações via MED são decididas pelo banco, sem recurso.
- Confirmação "imediata", mas o fluxo trata `async_payment_succeeded` de qualquer forma (robustez).
- ⚠️ **Risco**: a categoria MCC **7273 (serviços de encontros e acompanhantes) é proibida para Pix**. O produto precisa ser cadastrado de forma correta e honesta como serviço digital/software de análise de texto. Se o Stripe classificar como "encontros", o Pix pode ser negado → seguir só com cartão. Ver R4.

### 6.6 Testes de pagamento
- Modo teste do Stripe com Payment Links de teste (`stripe_test_payment_link_*`).
- `stripe listen --forward-to localhost:3000/api/webhooks/stripe` em dev.
- `stripe trigger checkout.session.completed` + testes de integração que reenviam o mesmo evento 3 vezes e conferem que libera uma única vez.

### 6.7 Repasse da taxa do Stripe (preço cobrado × líquido)
Pedido do dono, **definitivo**: o valor configurado é o **líquido** que deve chegar (R$ 30 no principal, R$ 10 nos adicionais), e o cliente paga o **bruto**:

```
bruto = ceil( (líquido + STRIPE_FEE_FIXED_CENTS) / (1 − STRIPE_FEE_PERCENT/100) )
```
seguido de um ajuste que garante `bruto − ceil(bruto × percentual) − fixa ≥ líquido` (pior caso de arredondamento). Implementação em `src/lib/pricing.ts`.

| Relatório | Líquido (`net_price_cents`) | Cobrado (`price_cents`), taxa 3,99% + R$ 0,39 |
|---|---|---|
| Principal | R$ 30,00 | **R$ 31,66** |
| Adicional | R$ 10,00 | **R$ 10,83** |

- `report_types.net_price_cents` guarda o líquido; `price_cents` guarda o bruto e é o que aparece em **todas** as telas, termos, ajuda e na `purchase.amount_cents` (conferida no webhook, D11).
- O `/admin` edita o líquido, mostra o "preço a cobrar no Payment Link", avisa quando a taxa da env mudou e, ao salvar, **confere pela API do Stripe** se o link do modo atual cobra pelo menos esse valor em BRL.
- Um Payment Link tem um único preço para cartão e Pix: `STRIPE_FEE_*` deve ser a **maior** tarifa entre as formas ativas (normalmente cartão). Ver DEPLOY.md 7.1.

### 6.8 Assinatura mensal (D96)
Pedido do dono: **R$ 46,99 líquidos por mês** (cobrado R$ 49,35 com a taxa padrão), **até 10 relatórios completos por dia** (limite `SUBSCRIPTION_DAILY_LIMIT` em `src/lib/subscription.ts`; o dia é o do horário de Brasília e o que não for usado não acumula), **relatórios adicionais incluídos** e, depois de usar os 10 do dia, **R$ 5 líquidos** (R$ 5,62) por relatório completo a mais. Quem não assina continua com a compra avulsa.

1. **Catálogo**: `report_types` `assinatura-mensal` (kind `subscription`, Payment Link de preço **recorrente mensal**, só cartão, sem teste grátis) e `relatorio-alem-do-limite` (kind `overage`, pagamento único). O `/admin` edita o líquido e cola os links; ao salvar, confere pela API que o link da assinatura é recorrente mensal e sem teste grátis.
2. **Assinar** (`/assinatura` → `startSubscriptionCheckout`): exige **sessão verificada** pelo link mágico (a assinatura fica ligada ao e-mail confirmado), não deixa assinar com assinatura ativa, cria a `purchase` pendente sem `report_id` e redireciona para o Payment Link com `client_reference_id`.
3. **Webhook**: `checkout.session.completed` com `mode = subscription` e pago → confere link, moeda, valor, modo e ambiente (como D11) → `purchase` paga e `subscriptions` ligada à conta da compra. `customer.subscription.*` atualizam status, fim do período e cancelamento (eventos mais antigos que o último aplicado são ignorados). A reconciliação diária reconfere no Stripe as assinaturas abertas.
4. **Uso** (`unlockWithSubscription`, em `fulfill.ts`): sessão verificada, dono da conversa, relatório principal pronto e ainda bloqueado, assinatura com direito ao uso (travada com `FOR SHARE` contra revogação simultânea) e menos de 10 usos hoje (advisory lock por usuário: pedidos simultâneos não passam do limite) → grava `subscription_unlocks` e libera. **Adicionais** (`unlockExtraWithSubscription`): com o principal liberado, criam o relatório e enfileiram `generate_extra`, sem contar no limite.
5. **Além do limite**: `startCheckout` com o slug `relatorio-alem-do-limite` só vale para assinante (sessão verificada) que já usou os 10 do dia; a compra é do relatório principal daquela conversa e o webhook libera como uma compra avulsa.
6. **Fim**:
   - **Cancelamento** (portal do cliente do Stripe, aberto em Minha conta) vale ao fim do período. `past_due` suspende o uso. Os relatórios já liberados continuam.
   - **Reembolso** de cobrança da assinatura: revoga na hora, volta a bloquear o que ela liberou (menos o que foi pago à parte) e agenda o cancelamento no Stripe (job `subscription_cancel`, que alerta se falhar).
   - **Contestação**: o job `subscription_dispute` acha o cliente da cobrança na API e faz o mesmo.
   - **Assinatura paga sem compra do site** (link aberto direto, conta excluída no meio, sessão duplicada): é cancelada no Stripe, com alerta para reembolso. Só quando o Payment Link da sessão é o da assinatura deste site; outros produtos recorrentes da mesma conta Stripe nunca são cancelados daqui.
   - Caso raro aceito: reembolso de uma compra avulsa cuja compra ainda não tem o PaymentIntent gravado e cujo pagamento o Stripe ligou a um cliente com assinatura revoga essa assinatura (Payment Links avulsos normalmente não criam cliente).
   - Enquanto houver assinatura aberta no Stripe, o site não deixa assinar de novo.
   - **Excluir a conta** cancela a assinatura no Stripe antes de apagar. Se o Stripe falhar, nada é excluído.
   - A **limpeza por inatividade** (10.1) nunca apaga quem tem assinatura aberta.
7. Sessões leves (criadas no envio, e-mail não confirmado) **nunca** usam nem enxergam a assinatura daquele e-mail. Ao liberar pela assinatura, a sessão leve que enviou a conversa perde o acesso a ela (quem digitou o e-mail de um assinante não lê o relatório com a cota dele).
8. **Ordem dos eventos**: eventos `customer.subscription.*` mais antigos que o último aplicado são ignorados. No mesmo segundo, fica o status mais adiante no ciclo (`incomplete` < `active` < `past_due` < `canceled`). O checkout pago promove `incomplete` para `active`. Toda mudança agenda o job `subscription_sync`, que relê a assinatura na API do Stripe.
9. **Cobrança em dobro**: um link avulso pago depois de o relatório já ter sido liberado (pela assinatura ou por outra compra) não é marcado como pago. Gera alerta para reembolso. A compra de relatório além do limite vale por 24 h (só é reaproveitada por 1 h); paga depois disso, libera se a pessoa ainda for assinante, senão gera alerta para reembolso.
10. A oferta da assinatura só aparece (landing, FAQ, Termos, JSON-LD) com o Payment Link do modo atual configurado. O link da assinatura e o do relatório além do limite precisam redirecionar com `?link=<slug>`.

---

## 7. Lógica de bloqueio/desbloqueio no servidor

**Princípio: o conteúdo bloqueado nunca sai do servidor antes do pagamento confirmado pelo webhook.** Não existe "esconder com CSS".

1. Uma única função em `src/server/reports/get-report-view.ts`:
   ```ts
   getReportView(reportId, viewer): ReportView
   ```
   - Confere se `viewer` é dono da conversa (senão, 404 — não revelar existência).
   - Lê `reports` + `report_sections`.
   - Para cada seção: se `report.is_unlocked || section.is_free` → `{ kind: 'open', title, content, evidence }` (decifrado); senão → `{ kind: 'locked', lockedTitle, position }` **sem** `content`, `title` real nem `evidence`.
   - `hook` só é enviado quando o relatório está bloqueado (no desbloqueado ele vira transição normal).
2. O tipo `ReportView` é a **única** forma que chega a componentes. Componentes nunca recebem o objeto do banco. Um teste de unidade garante que, com `is_unlocked=false`, o JSON serializado do `ReportView` não contém nenhum trecho do conteúdo bloqueado.
3. O "texto desfocado" das seções bloqueadas é **lorem ipsum gerado no client** (comprimento aproximado), não derivado do conteúdo real. Nem o tamanho exato do conteúdo é enviado (usar faixas: curto/médio/longo).
4. Páginas de relatório são **dinâmicas** (`cache: no-store`, sem `generateStaticParams`, sem Cache Components com dados do usuário), para nunca servir versão cacheada de outro estado/usuário. Cabeçalho `Cache-Control: private, no-store`.
5. `is_free` é definido pelo **servidor** na gravação: as primeiras `ceil(n/2)` seções (4 de 8). Exceção: se `safety_flag=true`, a seção com alerta de segurança fica `is_free=true` (nunca cobrar por um alerta de risco).
6. Somente `src/server/payments/fulfill.ts` escreve `is_unlocked = true`: pelo webhook (pagamento conferido) ou, na assinatura (D96), pelo uso de uma assinatura cujo estado veio do Stripe, dentro do limite diário (6.8). Regra de lint/revisão: `grep` no CI falha se `is_unlocked` aparecer em escrita fora desse arquivo (e do revert por reembolso no mesmo módulo).
7. Nenhuma API JSON pública devolve seções; a página usa Server Components. Se houver rota de API (ex.: app futuro), ela chama o mesmo `getReportView`.
8. Relatórios adicionais não pagos não têm conteúdo (são gerados depois do pagamento), então não há o que vazar.

---

## 8. Telas e páginas

| Rota | Tela | Notas |
|---|---|---|
| `/` | Landing | Proposta, como funciona, exemplo fictício, preço, FAQ, aviso de IA |
| `/analisar` | Envio | Grupo de rádios (forma de envio): Colar / .txt / .zip / Prints, com checagem de tamanho no navegador (o servidor confere de novo); e-mail; consentimentos; instruções "como exportar do WhatsApp" (Android e iPhone) |
| `/r/[id]/processando` | Progresso | Etapas, porcentagem, mensagens de espera; trata `failed` com "tentar de novo" |
| `/r/[id]/confirmar` | Participantes | Nomes, quem é você, escolher 2 em grupos, avisos de OCR |
| `/r/[id]` | Relatório | Seções abertas, gancho, seções bloqueadas, CTA com o preço cobrado (6.7) depois do gancho e no fim das bloqueadas; depois de pago: relatório completo + vitrine de adicionais; aviso de IA completo no topo e frase curta no rodapé global (D91) |
| `/r/[id]/extra/[slug]` | Relatório adicional | Progresso de geração → conteúdo |
| `/pagamento/retorno` | Confirmando pagamento | Polling do status (na assinatura, `?link=assinatura-mensal` acompanha a ativação) |
| `/assinatura` | Assinatura mensal (D96) | Preço cobrado, limite diário, adicionais incluídos, preço além do limite, renovação e cancelamento; pede login pelo link do e-mail antes de assinar |
| `/entrar` | Login por link mágico | Só e-mail |
| `/entrar/verificar` | Consome o token | Token de uso único; redireciona |
| `/minhas-analises` | Lista | Conversas do usuário, status, data de expiração, excluir |
| `/conta` | Conta | Assinatura (status, uso do dia, portal do Stripe para cartão/faturas/cancelamento), exportar dados (JSON), excluir tudo, sair |
| `/termos` | Termos de uso | Versionado |
| `/privacidade` | Política de privacidade | Versionada; retenção, direitos do titular, contato do encarregado |
| `/ajuda` | Ajuda / FAQ | Como exportar, reembolso, contato |
| `/admin` (Fase 4) | Painel | CRUD de `report_types`, compras, reprocessar jobs; acesso por e-mail em `ADMIN_EMAILS` |
| `not-found`, `error` | Erros | Genéricos, sem detalhes internos |

E-mails: link mágico, "análise pronta", "relatório liberado", "seus dados foram excluídos".

---

## 9. Variáveis de ambiente

| Variável | Obrigatória | Exemplo / descrição |
|---|---|---|
| `NODE_ENV` | sim | `development` / `production` |
| `APP_URL` | sim | `http://localhost:3000` |
| `DATABASE_URL` | sim | `postgres://…` 🔐 |
| `DATABASE_SSL` | não | `require` \| `no-verify` \| `disable` (vazio = o que a URL disser) |
| `DATABASE_SSL_CERT_BASE64` | Square Cloud | PEM do certificado de cliente (chave + certificado) em base64 🔐 |
| `DATABASE_URL_CERT_PATH` | não | alternativa: caminho do arquivo PEM na raiz do app (ex.: `certificate.pem`, gravado pelo MCP da Square Cloud); o base64 tem prioridade |
| `DATABASE_SSL_CA_BASE64` | não | CA do servidor em base64 (com ela, o servidor é verificado) |
| `DATABASE_POOL_MAX` | não | `10` (conexões por processo) |
| `DATA_ENCRYPTION_KEY` | sim | 32 bytes em base64 (AES-256-GCM) 🔐 |
| `DATA_ENCRYPTION_KEY_PREVIOUS` | não | chave antiga durante rotação 🔐 |
| `SESSION_SECRET` | sim | segredo para assinar cookies/tokens 🔐 |
| `HASH_PEPPER` | sim | pepper para hash de IP/e-mail no rate limit 🔐 |
| `GROQ_API_KEY` | sim | 🔐 |
| `GROQ_VISION_MODEL` | sim | `qwen/qwen3.8-27b` |
| `GROQ_REPORT_MODEL` | sim | `openai/gpt-oss-120b` |
| `GROQ_SUMMARY_MODEL` | sim | `openai/gpt-oss-20b` |
| `GROQ_REASONING_EFFORT` | não | `medium` |
| `GROQ_VISION_MAX_IMAGES_PER_REQUEST` | não | `3` |
| `GROQ_BASE_URL` | não | só testes (servidor falso) |
| `GROQ_MAX_CONCURRENCY` | não | `2` |
| `GROQ_REPORT_MAX_COMPLETION_TOKENS` | não | `8000` |
| `REPORT_DIRECT_MAX_TOKENS` | não | `40000` |
| `CHUNK_TOKENS` | não | `12000` |
| `STRIPE_SECRET_KEY` | sim | `sk_test_…` / `sk_live_…` 🔐 |
| `STRIPE_WEBHOOK_SECRET` | sim | `whsec_…` 🔐 |
| `STRIPE_FEE_PERCENT` | não | `3.99` (taxa repassada, ver 6.7) |
| `STRIPE_FEE_FIXED_CENTS` | não | `39` |
| `STRIPE_SUBSCRIPTION_EXTRA_FEE_PERCENT` | não | `0` (tarifa do Stripe Billing somada só no preço da assinatura, D96) |
| `STORAGE_DRIVER` | sim | `local` \| `s3` |
| `STORAGE_LOCAL_DIR` | dev | `./.data/uploads` (no `.gitignore`) |
| `ALLOW_LOCAL_STORAGE_IN_PRODUCTION` | Square Cloud | `1` libera `local` em produção (D71) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | prod | R2/S3 |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | prod | 🔐 |
| `EMAIL_DRIVER` | sim | `smtp` (produção sem domínio próprio, D95) \| `resend` (com domínio verificado) \| `outbox` (dev/testes, D33) |
| `SMTP_HOST` | não | `smtp.gmail.com` |
| `SMTP_PORT` | não | `465` (TLS direto; `587` = STARTTLS obrigatório) |
| `SMTP_USER` | com `smtp` | endereço da conta (ex.: Gmail) |
| `SMTP_PASSWORD` | com `smtp` | 🔐 senha de app do Gmail |
| `RESEND_API_KEY` | com `resend` | 🔐 |
| `EMAIL_FROM` | com `resend` | `Psicanalista do Amor <oi@dominio>`; com `smtp`, vazio = `Psicanalista do Amor <SMTP_USER>` |
| `EMAIL_OUTBOX_DIR` | não | `./.data/outbox` |
| `SMTP_DAILY_LIMIT` | não | `450` (orçamento diário de e-mails pelo SMTP; avisos não essenciais param em 80%, D99) |
| `UPLOAD_MAX_BYTES` | não | `26214400` |
| `MAX_IMAGES` | não | `60` |
| `MAX_IMAGE_BYTES` | não | `8388608` |
| `PASTE_MAX_CHARS` | não | `500000` |
| `UPLOAD_GLOBAL_MAX_PER_HOUR` | não | `120` (teto de envios/hora no site inteiro, D84) |
| `RETENTION_UNPAID_DAYS` | não | `7` |
| `RETENTION_PAID_DAYS` | não | `180` |
| `ADMIN_EMAILS` | não | lista separada por vírgula |
| `SUPPORT_EMAIL` | sim (produção) | contato de suporte e reembolso (Ajuda) |
| `PRIVACY_EMAIL` | antes do lançamento | encarregado/DPO (Privacidade); vazio = `SUPPORT_EMAIL` |
| `LEGAL_REVIEW_DONE` | não | `1` depois da revisão jurídica (some o aviso "em revisão" de Termos e Privacidade) |
| `LOG_LEVEL` | não | `info` |
| `PROCESS_TYPE` | não | `all` (site + worker) \| `web` \| `worker` |
| `TRUSTED_PROXY_HOPS` | não | `1` (D68) |
| `ALERT_WEBHOOK_URL` | não | webhook Discord/Slack para alertas sem PII (D75) |

Lidas só pelo `scripts/start.mjs` (infraestrutura, fora do `env.ts`): `PORT` (padrão 80 com `squarecloud.app`, senão 3000), `HOSTNAME_BIND`, `BUILD_NODE_OPTIONS` (memória do build, padrão `--max-old-space-size=1536`), `MIGRATIONS_DIR`.

Os Payment Links ficam no banco (`report_types`), não em env, para cadastrar novos relatórios sem deploy. 🔐 = segredo: nunca commitar; `.env.example` só com nomes e valores falsos; `src/env.ts` valida tudo com zod na inicialização. **Esta tabela, o `.env.example` e o `src/env.ts` têm exatamente as mesmas variáveis.**

---

## 10. Segurança e LGPD

### 10.1 LGPD
- **Natureza dos dados**: conversas privadas contêm dados pessoais do usuário **e de um terceiro** que não consentiu, e frequentemente dados sensíveis (saúde, vida sexual, religião — art. 5º, II). Tratar tudo como sensível.
- **Papéis**: a empresa é controladora; Groq, Stripe, provedor de e-mail (Google/Gmail ou Resend), provedor de hospedagem e storage são operadores (listar na política, com países — transferência internacional, art. 33).
- **Base legal** (a validar com advogado): consentimento do usuário para os dados dele; para o terceiro, o usuário declara participar da conversa e assume responsabilidade pelo envio; minimização e retenção curta como salvaguardas. Ver R1.
- **Consentimento no upload** (checkboxes não pré-marcados, registrados em `consents` com versão):
  1. Li e aceito os Termos de Uso e a Política de Privacidade.
  2. Tenho 18 anos ou mais.
  3. Participo desta conversa (ou tenho autorização) e entendo que ela contém dados de outra pessoa.
  4. Entendo que a análise é gerada por IA e não substitui aconselhamento profissional.
- **Proibições nos termos**: conversas com menores, conversas obtidas sem autorização (celular de terceiros), uso para assédio/perseguição.
- **Retenção**:
  - Arquivos originais (prints, zip, txt): **apagados logo após a normalização** (e no máximo 24 h depois do upload, mesmo com falha — job de limpeza).
  - Conversa + relatórios **não pagos**: excluídos após `RETENTION_UNPAID_DAYS` (7) sem acesso.
  - Conversa + relatórios **pagos**: excluídos após `RETENTION_PAID_DAYS` (180) sem acesso; e-mail de aviso 7 dias antes.
  - Registros de compra (`purchases`, sem conteúdo): mantidos pelo prazo fiscal (5 anos), desvinculados do conteúdo.
  - Logs: 30 dias, sem conteúdo.
  - Usuários sem nenhuma análise e sem sessão válida: e-mail apagado depois de `RETENTION_UNPAID_DAYS` (D88).
- **Direitos do titular**: excluir uma análise, excluir conta e todos os dados (exclusão real em cascata + objetos do storage + `audit_log`), exportar dados (JSON), contato do encarregado (e-mail na política).
- **Groq**: confirmar a política de retenção/treinamento da Groq para dados enviados via API e citar na política de privacidade. Não enviar e-mail nem nada além dos nomes escolhidos e das mensagens.

### 10.2 Criptografia
- Em trânsito: HTTPS obrigatório (HSTS).
- Em repouso: disco do banco cifrado pelo provedor **e** criptografia na aplicação (AES-256-GCM, IV aleatório por campo, formato versionado `v1:`) para: mensagens, nomes, relatórios, gancho, evidências, notas do map. Chave em `DATA_ENCRYPTION_KEY`, suporte a rotação (`_PREVIOUS`).
- Storage: bucket privado, criptografia do provedor (SSE), URLs pré-assinadas de curta duração apenas para o worker; nada público.

### 10.3 Upload
- Ver 4.1 e 4.4: limites de tamanho e quantidade, magic bytes, zip bomb (entradas, tamanho real descompactado, razão de compressão), path traversal (nomes nunca usados como caminho), symlinks, zip aninhado ignorado, imagens re-encodadas pelo sharp (remove EXIF/GPS e neutraliza payloads em imagens), `sharp.limitInputPixels` contra "pixel flood".
- Processamento de arquivos só no worker.

### 10.4 Aplicação
- Sessão: cookie `__Host-session`, `HttpOnly`, `Secure`, `SameSite=Lax`; 30 dias (verificada, pelo link mágico) ou 7 dias (leve, criada no envio — D88); token guardado só como hash; "Sair de todos os aparelhos" em /conta.
- Link mágico: token aleatório de 32 bytes, hash no banco, 15 min, uso único; resposta igual exista ou não o e-mail (sem enumeração); rate limit de 3 pedidos/15 min por e-mail e IP.
- Autorização em toda leitura: `conversation.user_id === session.user_id`; IDs UUID v7; 404 em vez de 403.
- CSRF: Server Actions do Next já checam origem; Route Handlers mutáveis exigem `Origin` igual a `APP_URL`.
- Cabeçalhos: CSP restrita (sem inline script além do necessário pelo Next com nonce), `X-Content-Type-Options`, `Referrer-Policy: same-origin` (evita vazar IDs em referers), `Permissions-Policy`, `frame-ancestors 'none'`.
- Renderização do conteúdo da IA: Markdown restrito (negrito, itálico, listas, citações) com `react-markdown` sem HTML cru.
- Webhook: assinatura obrigatória, corpo cru, idempotência, conferência de valor/link/moeda.
- Rate limit no Postgres para upload, login, checkout e reprocessamento.
- Dependências: `npm audit` no CI, Renovate/Dependabot.

### 10.5 Logs
- `pino` com `redact` em caminhos como `*.content`, `*.text`, `*.messages`, `*.email`, `req.body`, `authorization`, `stripe-signature`.
- Nunca logar: conteúdo de mensagens, nomes dos participantes, texto do relatório, respostas da Groq, payload completo do Stripe, e-mails. Logar: IDs, status, contagens, durações, tokens usados, códigos de erro.
- Erros da Groq podem trazer `failed_generation` com conteúdo → sanitizar antes de logar.
- Ferramenta de erros (ex.: Sentry, se adotada) com `beforeSend` removendo corpo e variáveis locais.

### 10.6 Produto
- Aviso fixo: "Esta análise é gerada por inteligência artificial a partir do texto enviado. Ela pode errar e não substitui aconselhamento psicológico, jurídico ou de qualquer outro profissional."
- Se `safety_flag`: bloco destacado com Ligue 180 (violência contra a mulher), CVV 188 (apoio emocional) e 190, **sempre grátis**.
- Linguagem não estigmatizante; sem diagnósticos.

---

## 11. Fases de desenvolvimento (MVP primeiro)

### Fase 0 — Fundação
- [x] Criar app Next.js 16 + TypeScript estrito + Tailwind 4 + ESLint/Prettier
- [x] `src/env.ts` com validação zod; `.env.example`; `.gitignore` (inclui `.env*`, `.data/`)
- [x] Docker Compose com Postgres 16 para dev
- [x] Drizzle configurado; schema inicial (users, sessions, login_tokens, consents, conversations, conversation_files, messages, report_types, reports, report_sections, purchases, stripe_events, rate_limits, audit_log); primeira migration
- [x] Módulo de criptografia (AES-256-GCM) com testes
- [x] Logger pino com redact + teste que garante que conteúdo não aparece
- [x] pg-boss + script `worker` + job de teste
- [x] Interface `Storage` com driver local
- [x] Vitest e Playwright configurados; CI (lint, typecheck, test)
- [x] Seed de `report_types` (principal + 6 adicionais; os Payment Links — de teste e de produção — são colados no `/admin`, ver D30)

### Fase 1 — MVP: texto → relatório com corte → pagamento R$ 30
- [x] Parser de WhatsApp (.txt) com fixtures de Android/iOS/24h/12h/multilinha/mídia/apagadas
- [x] Parser genérico `Nome: mensagem` para texto colado
- [x] Tela `/analisar` com abas Colar e .txt, e-mail, consentimentos
- [x] Sessão automática no envio + link mágico (`/entrar`, `/entrar/verificar`) com Resend
- [x] Job `ingest` para texto/txt → mensagens cifradas → `needs_confirmation`
- [x] Tela `/r/[id]/confirmar` (nomes, quem é você, escolha em grupos)
- [x] Cálculo de `stats` determinístico com testes
- [x] Cliente Groq com retries, backoff, limitador de tokens, zod tolerante
- [x] Prompt do relatório principal + validação + regeneração de seção faltante
- [x] Map-reduce para conversas longas
- [x] Gravação das seções com `is_free` definido no servidor (+ regra do `safety_flag`)
- [x] `getReportView` + teste de "não vaza conteúdo bloqueado"
- [x] Tela `/r/[id]/processando` com polling
- [x] Tela `/r/[id]` com seções abertas, gancho, bloqueadas (lorem no client) e CTA
- [x] `startCheckout` + redirecionamento para Payment Link com `client_reference_id`
- [x] Webhook com assinatura, idempotência, conferências e liberação transacional
- [x] Página `/pagamento/retorno` com polling
- [x] Testes de integração do webhook (evento repetido, valor errado, link errado, purchase inexistente)
- [x] Termos, privacidade e aviso de IA (textos iniciais, marcados para revisão jurídica)
- [x] Exclusão de análise pelo usuário
- [x] E2E Playwright: colar conversa → relatório parcial → pagamento de teste → relatório completo

### Fase 2 — Prints e .zip
- [x] Upload multipart com limites, magic bytes e rate limit
- [x] Leitura segura de .zip (yauzl) com testes de zip bomb, path traversal, symlink, zip aninhado
- [x] Zip de exportação do WhatsApp (`_chat.txt`)
- [x] Pré-processamento de imagens com sharp (EXIF, tamanho, HEIC, dedupe)
- [x] Prompt de extração por visão em lotes + validação
- [x] Costura de prints sobrepostas
- [x] Mapeamento esquerda/direita → participantes na confirmação; avisos de OCR
- [x] Driver de Storage S3/R2
- [x] Exclusão dos originais após a normalização + job de limpeza de órfãos (24 h)
- [x] Progresso detalhado ("Lendo prints 12 de 40")
- [x] Tabela `conversation_digests` para reaproveitar o map

### Fase 3 — Relatórios adicionais (R$ 10)
- [x] Vitrine de adicionais (só com o principal pago)
- [x] `startCheckout` para adicionais (exige principal liberado)
- [x] Webhook enfileira `generate_extra` (singleton por relatório)
- [x] Montagem de prompt `system` comum + `prompt_template` + contexto
- [x] Prompts dos 6 adicionais iniciais + exemplos de saída
- [x] Tela `/r/[id]/extra/[slug]` com progresso e leitura
- [x] `verdict` com placar visual quando existir
- [x] E-mail "relatório pronto"

### Fase 4 — Conta, retenção, admin e Pix
- [x] `/minhas-analises` e `/conta` (exportar JSON, excluir tudo)
- [x] Job diário de retenção (não pagos 7 dias, pagos 180 dias, aviso por e-mail)
- [x] Reembolso/contestação revogam acesso (`charge.refunded`, `charge.dispute.created`)
- [ ] Habilitar Pix na conta Stripe e testar `async_payment_*` (manual — ver DEPLOY.md; o código trata `checkout.session.async_payment_*` e tem testes de integração com eventos simulados)
- [x] Painel `/admin` (report_types, compras, reprocessar)
- [x] Rotação de `DATA_ENCRYPTION_KEY`

### Fase 5 — Produção e crescimento
- [x] Dockerfile (web + worker), `squarecloud.app`, `railway.json` e `scripts/start.mjs` (build automático, migrations + seed com lock, site + worker)
- [x] Postgres com TLS e certificado de cliente (Square Cloud)
- [x] `DEPLOY.md` (Square Cloud passo a passo; Railway, Fly.io e Docker como alternativas) e `README.md`
- [ ] Deploy na Square Cloud (manual — ver DEPLOY.md)
- [ ] Domínio próprio e HTTPS (manual — ver DEPLOY.md)
- [ ] Backups do Postgres ativos e restauração testada (manual — ver DEPLOY.md)
- [x] Cabeçalhos de segurança e CSP com nonce
- [x] Monitoramento de erros sem conteúdo (`onRequestError`); alertas de webhook/job/servidor sem PII (`ALERT_WEBHOOK_URL`)
- [x] Registro de operações (ROPA) — rascunho técnico em `docs/ropa.md`
- [ ] Revisão jurídica de termos/privacidade e do ROPA (manual — ver DEPLOY.md)
- [ ] Registro da marca no INPI; domínio próprio é opcional, para depois (D95) (manual — ver DEPLOY.md)
- [x] Landing com exemplo fictício, SEO (sitemap, robots), Open Graph
- [x] Analytics sem dados pessoais (`funnel_events`: envio → parcial → checkout → pagamento → adicional; painel no /admin)
- [x] Implementar 2–3 adicionais da lista proposta (`esfriando`, `linha-do-tempo`, `nao-ditos`)
- [x] Repasse da taxa do Stripe (preço cobrado = líquido + taxa; conferência do Payment Link pela API no /admin)
- [x] Teste de carga **simulado** do limitador de tokens com vários workers (`tests/integration/load.test.ts`)
- [ ] Teste de carga com a chave real da Groq (manual — ver DEPLOY.md e `docs/teste-de-carga.md`)
- [ ] Payment Links de teste e de produção criados e colados no /admin (manual — ver DEPLOY.md)
- [ ] Pix habilitado na conta Stripe e testado (manual — ver DEPLOY.md)
- [x] Auditoria completa em 25/10/2026 com 6 agentes (segurança, QA/acessibilidade, SEO/performance, design, textos, prompts) e correção de todos os P0/P1 (`docs/auditoria-2026-10-25.md`)
- [x] Testes de acessibilidade com axe (375 e 1280 px) no E2E
- [x] Build testado com `npm ci --omit=dev` (Square Cloud) e imagem Docker testada (health ok)
- [ ] Configurar `SUPPORT_EMAIL`, `PRIVACY_EMAIL` e, após a revisão jurídica, `LEGAL_REVIEW_DONE=1` (manual — ver DEPLOY.md)

### Fase 6 — Assinatura mensal (D96)
- [x] Catálogo `assinatura-mensal` (R$ 46,99 líquidos) e `relatorio-alem-do-limite` (R$ 5 líquidos); tabelas `subscriptions` e `subscription_unlocks` (migration 0002)
- [x] Webhook: checkout de assinatura, `customer.subscription.*`, reembolso de cobrança da assinatura; reconciliação das assinaturas abertas
- [x] Liberação pela assinatura (10 por dia, horário de Brasília, sem corrida) e adicionais incluídos, em `fulfill.ts`
- [x] Relatório além do limite (só assinante sem cota no dia)
- [x] Telas: `/assinatura`, CTA do relatório, vitrine e página do adicional, retorno do pagamento, Minha conta (portal do Stripe), landing, FAQ, Termos e Privacidade
- [x] Exclusão da conta cancela a assinatura no Stripe; exportação inclui a assinatura
- [x] Testes de integração (`tests/integration/subscription.test.ts`) e E2E (`tests/e2e/subscription.spec.ts`)
- [ ] Criar no Stripe o produto recorrente mensal e o Payment Link da assinatura, o Payment Link do relatório além do limite, ativar o portal do cliente e adicionar os 3 eventos `customer.subscription.*` ao webhook (manual — ver DEPLOY.md)
- [ ] Revisão jurídica do texto da assinatura nos Termos (renovação automática, cancelamento, reembolso) (manual)

---

## 12. Riscos e pontos de atenção

| # | Risco | Mitigação |
|---|---|---|
| R1 | **LGPD e dados de terceiros**: o terceiro não consentiu; dados sensíveis | Consentimentos explícitos, retenção curta, criptografia, exclusão fácil, revisão jurídica antes do lançamento, DPIA/RIPD |
| R2 | **Limites da Groq**: no plano grátis, gpt-oss tem ~8.000 tokens/min — cabe ~1 relatório por minuto no site inteiro; cada imagem custa ~2.048 tokens | Usar plano pago (Developer) em produção; limitador de tokens; fila com concorrência baixa; map com modelo menor |
| R3 | **Modelo de visão em preview / mudanças de catálogo** (vários modelos foram desligados em 2026) | Modelos por env; checagem na inicialização com chamada barata; reconferir a documentação a cada fase; fallback configurável |
| R4 | **Stripe e categoria do negócio**: MCC 7273 (encontros) é proibido para Pix e pode ter restrições no Stripe | Cadastro honesto como serviço digital de análise; se Pix for negado, cartão apenas; considerar Mercado Pago/Pagar.me como plano B para Pix |
| R5 | **Qualidade do OCR** (prints cortadas, temas escuros, apps diferentes) | Pré-processamento, avisos de baixa confiança, confirmação pelo usuário, testes com prints reais (com dados fictícios) |
| R6 | **Alucinação** e afirmações injustas sobre o terceiro | Estatísticas determinísticas, evidências com `seq`, remoção de citações inválidas, linguagem cautelosa, aviso de IA |
| R7 | **Vazamento do conteúdo pago** por erro de implementação (cache, API, props) | `getReportView` único, teste de serialização, páginas dinâmicas, `no-store`, regra no CI para `is_unlocked` |
| R8 | **Webhook perdido ou atrasado** | Stripe reenvia por até 3 dias; job de reconciliação diário que consulta Checkout Sessions recentes pela API; página de retorno com mensagem clara |
| R9 | **Reembolso / CDC (direito de arrependimento, art. 49)** | Política de reembolso clara (D92: reembolso em até 7 dias, mediante pedido pela Ajuda; aviso junto do botão de pagamento); **o jurídico ainda vai validar** o prazo e o texto dos Termos antes do lançamento |
| R10 | **Custo por relatório** maior que o esperado em conversas enormes | Medir tokens por relatório; limite de mensagens (ex.: 50 mil) com aviso; map com modelo menor |
| R11 | **Prompt injection** dentro da conversa | Delimitadores, instrução de dado, validação da saída, Markdown restrito |
| R12 | **Uso abusivo** (stalking, menores, conversas obtidas sem permissão) | Termos, declaração, detecção simples de menções a idade/escola (aviso), canal de denúncia |
| R13 | **Formatos de exportação do WhatsApp mudam** | Parser com fixtures, fallback genérico, telemetria de "formato não reconhecido" (sem conteúdo) |
| R15 | **Nome sugere atendimento profissional** ("analista") enquanto o produto avisa que não substitui um profissional; marca ainda não registrada | Deixar claro na landing e no relatório que é uma análise por IA; nunca usar "consulta", "sessão" ou "terapia"; pedir registro no INPI (classes 42 e 45) e registrar o domínio antes do lançamento |
| R14 | **Payment Link compartilhado** sem `client_reference_id` (ex.: link copiado) | Webhook trata ausência: registra, não libera, alerta para reconciliação manual |
| R16 | **Tarifa Stripe varia por conta, cartão/Pix e pode mudar** | Conferir as tarifas e formas de pagamento ativas na conta antes de publicar |

---

## 13. Decisões e suposições

| # | Decisão / suposição | Motivo |
|---|---|---|
| D1 | **Nome: "Psicanalista do Amor"** (escolhido pelo dono em 23/10/2026) | Pesquisa na web em 23/10/2026 não encontrou empresa, app, livro ou perfil com esse nome (nem com a grafia "Psiquianalista"). Falta conferir domínio e INPI (ver R15) |
| D2 | **Drizzle** em vez de Prisma | SQL explícito, migrations simples, experiência prévia do dono; sem engine binária |
| D3 | **pg-boss** (fila no Postgres) em vez de BullMQ/Redis | Um serviço a menos; volume esperado é baixo; retries e agendamento prontos |
| D4 | **Acesso com "conta leve"**: e-mail obrigatório no envio; o navegador que enviou recebe sessão na hora; em outro dispositivo, **link mágico** por e-mail | Login antes do envio derruba conversão; link único na URL vaza fácil (histórico, prints, compartilhamento). O e-mail também é usado no `prefilled_email` e nos avisos |
| D5 | Link mágico **implementado no projeto** (tabelas `login_tokens`/`sessions`) em vez de biblioteca de auth | Só um método de login; menos dependências e controle total sobre o que é guardado |
| D6 | Hospedagem em **container persistente** (web + worker), ex.: Railway/Fly.io/Square Cloud — não Vercel | O worker roda minutos e precisa de processo contínuo |
| D7 | **Relatório principal é gerado antes do pagamento**; **adicionais só depois** | O principal precisa da metade grátis para vender; os adicionais não têm prévia e gerar antes seria custo sem receita |
| D8 | Corte em **4 de 8 seções** (metade), com ordem fixa e seções mais reveladoras na segunda metade | Previsível, testável, e o prompt controla o conteúdo de cada posição |
| D9 | **Reembolso ou contestação revogam o acesso** ao relatório | Coerência com a liberação via webhook; registrado em `audit_log` |
| D10 | `client_reference_id` = **ID da purchase** (não do relatório) | Permite várias tentativas de pagamento, auditoria e conferência do valor esperado |
| D11 | Conferência de `payment_link`, `currency` e `amount_total` no webhook | Impede que um pagamento do link de R$ 10 libere o relatório de R$ 30 |
| D12 | `response_format: json_object` + zod tolerante, **sem** Structured Outputs estrito | Lição de outro projeto: o modo estrito recusou a maioria das chamadas com schemas grandes |
| D13 | Modelos iniciais: visão `qwen/qwen3.8-27b`, relatório `openai/gpt-oss-120b`, resumo `openai/gpt-oss-20b` (todos por env) | Conferidos na documentação da Groq em 23/10/2026; Llama 3.x/4 foram desligados |
| D14 | Apenas **2 participantes** analisados; em grupos o usuário escolhe os 2 | O produto é sobre a dinâmica de um par |
| D15 | Fuso padrão `America/Sao_Paulo`; datas ambíguas assumidas como DD/MM | Público brasileiro |
| D16 | Limites iniciais: 25 MB por envio, 60 imagens, 8 MB por imagem, 500 mil caracteres colados, zip com até 200 entradas/100 MB descompactados | Cobrem conversas reais com folga e protegem o worker; todos configuráveis |
| D17 | Retenção: originais apagados após processar; não pagos 7 dias; pagos 180 dias sem acesso; compras 5 anos sem conteúdo | Minimização (LGPD) equilibrada com a necessidade de reler e comprar adicionais |
| D18 | Criptografia na aplicação (AES-256-GCM) para conteúdo de conversas e relatórios | Exigência de criptografia em repouso para dados sensíveis, além da do disco |
| D19 | Seção com alerta de risco (`safety_flag`) **nunca é bloqueada** | Ética e reputação: não cobrar por aviso de violência/risco |
| D20 | Público: maiores de 18 anos, Brasil, pt-BR | Mercado e moeda do pagamento |
| D21 | Sem IA para "adivinhar" formatos de texto não reconhecidos | Custo e risco de alucinação; melhor pedir outro formato |
| D22 | npm como gerenciador de pacotes | Padrão do ambiente do dono |
| D23 | Payment Links guardados no banco (`report_types`), não em env | Cadastrar relatórios novos sem deploy |
| D24 | Next.js 16 **sem Cache Components** (`cacheComponents` desligado); o layout raiz lê `headers()`, então todas as páginas são dinâmicas | Evita qualquer cache de conteúdo por usuário (seção 7.4) e permite o nonce da CSP em todas as páginas |
| D25 | Fontes do sistema (sem `next/font/google`) | O build não depende de rede externa (sandbox, CI e Docker) |
| D26 | **Sessão leve restrita**: a sessão criada automaticamente no envio (não verificada) só acessa as análises criadas por ela (`conversations.created_by_session_id`); a sessão do link mágico (`sessions.verified=true`) acessa todas as análises do e-mail | Sem isso, quem digitasse o e-mail de outra pessoa no envio ganharia acesso às análises dela. Mantém a conversão do D4 |
| D27 | Arquivos originais são **cifrados na aplicação** (AES-256-GCM) antes de ir para o storage, além do SSE do provedor | Os originais são o dado mais sensível; também protege o driver local em dev |
| D28 | Ajustes no schema: status `generating` em `conversations`; colunas `detected_senders` 🔒, `warnings`, `timezone`, `created_by_session_id`, `retention_warned_at`; `messages.sender_index`; `reports.progress`, `verdict` 🔒, `safety_flag`; `report_sections.is_safety`; `purchases.livemode`/`amount_paid_cents`; tabelas `ai_rate_state` (limitador da Groq), `funnel_events` (analytics sem PII) e `conversation_digests` já na migration inicial; `title` das seções também cifrado | Necessários para confirmação de remetentes sem decifrar tudo, progresso dos adicionais, regra do alerta de risco e Fase 5 |
| D29 | Campos JSON sensíveis (`evidence`, `verdict`, `detected_senders`, notas do map) são gravados como **texto cifrado** (JSON serializado + AES-256-GCM), não `jsonb` | `jsonb` exigiria conteúdo em claro |
| D30 | O seed **não** grava Payment Links; eles são colados no painel `/admin` (URL + ID, de teste e de produção). O modo é decidido pelo prefixo da `STRIPE_SECRET_KEY` (`sk_test_`/`sk_live_`). Sem link configurado, o botão de compra fica desabilitado com mensagem amigável | O dono não roda scripts; links mudam por ambiente |
| D31 | Testes de integração usam `TEST_DATABASE_URL` (banco **descartável**, tabelas truncadas) e são pulados com aviso quando ela não existe; o E2E usa `E2E_DATABASE_URL` | Nunca truncar por engano o banco apontado por `DATABASE_URL` |
| D32 | Em 25/10/2026 a rede do ambiente de desenvolvimento bloqueou `console.groq.com`; os modelos do `.env.example` são os da seção 9 e **precisam ser reconferidos** em `/docs/models` e `/docs/deprecations` antes do deploy | R3 |
| D33 | `EMAIL_DRIVER=outbox` (grava e-mails em `.data/outbox`) para dev/testes; proibido em produção pela validação do `env.ts` | Testar link mágico sem Resend |
| D34 | Filas pg-boss com política `stately` + `singletonKey` (1 na fila + 1 ativo por conversa/relatório); jobs disparados pelo webhook entram **na mesma transação** (adaptador `fromDrizzle`) | Sem jobs duplicados nem perdidos |
| D35 | Worker e migração empacotados com esbuild (`dist/*.mjs`) na imagem de produção; módulos `server-only` resolvidos com a condição `react-server` (tsx em dev, esbuild em produção, alias no Vitest) | Uma imagem só, sem `tsx` em produção |
| D36 | `src/server/db/schema.ts` não importa `server-only` | É carregado pelo drizzle-kit fora do Next |
| D37 | TypeScript 5.9 e ESLint 9 | Versões suportadas pelo Next 16.4 / `eslint-config-next` |
| D38 | `overrides` do npm força um esbuild atual dentro do drizzle-kit | Zera os alertas do `npm audit` (dependência só de desenvolvimento) |
| D39 | O 4º consentimento (aviso de IA) é registrado em `consents` com `kind = ai_disclaimer` | Prova do aceite, como os demais |
| D40 | O E2E roda com `next dev` | As travas de produção do `env.ts` impedem storage local/outbox em `next start`, de propósito |
| D41 | O link mágico só é consumido com um clique (POST) na página `/entrar/verificar`; abrir o link (GET) não gasta o token | Leitores automáticos de e-mail abrem links e gastariam o token de uso único |
| D42 | Envio da conversa por Route Handler (`POST /api/uploads`, multipart) com checagem de `Origin`, em vez de Server Action | Server Actions têm limite de corpo de 1 MB; envios chegam a 25 MB |
| D43 | Com `safety_flag`, o servidor insere uma seção extra `alerta` (sempre grátis, `is_safety`) **antes** das 8 seções; o corte continua sendo 4 das 8 regulares. Se a IA não escrever o alerta, entra um texto padrão com Ligue 180, CVV 188 e 190 | D19 sem mudar o número de seções pagas |
| D44 | `payment_method_type` só é gravado quando a Checkout Session tem um único método; caso contrário fica nulo | Evita uma chamada extra à API do Stripe dentro do webhook |
| D45 | Pagamento em dobro do mesmo relatório: a segunda compra não libera de novo (índice parcial), fica `pending` com `audit_log` `payment.duplicate` para reembolso manual | Integridade do "1 compra paga por relatório" |
| D46 | `startCheckout` reaproveita uma purchase `pending` do mesmo relatório criada há menos de 24 h, com mesmo valor e mesmo modo (teste/produção) | Evita lixo de compras pendentes a cada clique |
| D47 | Só as mensagens de A e B vão para a IA (sistema e terceiros de grupos ficam de fora); conversas com mais de 60 mil mensagens usam as últimas 60 mil (aviso na confirmação) | D14 e R10 |
| D48 | Tempo de resposta só conta quando a resposta vem em menos de 6 h; depois disso é "iniciativa" | Silêncios longos distorceriam a mediana |
| D49 | E-mails de avisos vão pela fila (`send_email`, com chave de idempotência); o e-mail do link mágico é enviado direto na requisição | O token do link nunca fica gravado na tabela de jobs |
| D50 | A faixa de tamanho de seções bloqueadas (curta/média/longa) é calculada a partir do tamanho do texto cifrado | O conteúdo nem é decifrado para seções bloqueadas |
| D51 | Fuso escolhido na confirmação reinterpreta os horários "de parede" no banco (`AT TIME ZONE`), sem precisar dos arquivos originais (já apagados) | Plano 4.3 ("configurável na confirmação") |
| D52 | Fotos **HEIC/HEVC não são suportadas** pelo sharp pré-compilado (só AVIF): o envio retorna erro amigável pedindo JPG/PNG. Prints de tela do iPhone já são PNG | Evita compilar libheif com HEVC (licença/patentes) na imagem |
| D53 | Dedupe de prints com dHash de **1024 bits** (miniatura 33×32) e limite de 12 bits de diferença | O dHash clássico de 64 bits confunde prints diferentes da mesma conversa (são muito parecidas) |
| D54 | Costura: mesmo lado; horários lidos iguais; mesmos dígitos; textos com menos de 12 caracteres só se forem idênticos; demais com Levenshtein ≤ 15%; balão cortado na borda (prefixo/sufixo) também conta | Evita apagar mensagens diferentes como "ok 1"/"ok 2" ou "18h"/"19h" |
| D55 | Datas das prints só a partir de separadores de dia ("Hoje", "Ontem", "12 de outubro", dd/mm/aaaa, dia da semana), relativos à data do envio; virada da meia-noite detectada pelo horário; sem separador, a mensagem fica sem data | Plano 4.5, passo 6 — nunca inventar datas |
| D56 | Remetentes das prints: direita = "Pessoa da direita"; esquerda = nome do cabeçalho em conversas 1:1 ou o nome acima do balão em grupos (herdado pelos balões seguintes da mesma pessoa) | O usuário confirma/renomeia na tela de confirmação |
| D57 | Zip: `strictFileNames` do yauzl (barra invertida é recusada); zip aninhado também é detectado pela assinatura `PK\x03\x04` mesmo renomeado; um .txt que não é exportação do WhatsApp ainda é tentado no formato "Nome: mensagem" | Plano 4.4 |
| D58 | A limpeza horária também marca como falha conversas presas há mais de 24 h em `uploaded`/`processing` e apaga sessões/tokens vencidos e registros de rate limit com mais de 1 dia | Minimização e tela de "tentar de novo" consistente |
| D59 | Adicionais: `system` comum (tom, segurança, formato) + `prompt_template` do banco com marcadores `{A}`, `{B}`, `{USER}`, `{OTHER}` + exemplo curto de formato por slug + contexto (stats e conversa ou notas do map já em cache). Exige ≥ 75% das `key` pedidas; seções na ordem do template | Plano 5.6 |
| D60 | O job `generate_extra` só gera se o relatório já estiver liberado pelo webhook; reprocessar um adicional pago que falhou não gera nova cobrança | D7 e regra crítica 2 |
| D61 | Quem escolheu "prefiro não dizer" pode indicar depois, na vitrine, qual das duas pessoas é (libera "Como responder") | Evita refazer a análise |
| D62 | Placar: barra de dois lados (A × B) para "Quem demonstra mais interesse?"; barra 0–100 para os demais com `verdict` | Plano 5.6 |
| D63 | Exportar e "excluir tudo" exigem sessão **verificada** (link mágico) e, na exclusão, digitar EXCLUIR | Uma sessão leve pode ter sido criada por quem digitou o e-mail de outra pessoa (D26) |
| D64 | Exclusão total: apaga conversas (cascata), storage, sessões, tokens e o usuário; compras ficam com `user_id`/`report_id` nulos (prazo fiscal); e-mail de confirmação vai pela fila com o endereço **cifrado** | LGPD + D17 |
| D65 | Reconciliação de pagamentos (R8) a cada 30 min e sob demanda no /admin: lista Checkout Sessions pagas dos últimos 3 dias e libera pelo mesmo `fulfill.ts`, com as mesmas conferências | Webhook perdido não deixa cliente sem relatório |
| D66 | Rotação de chave: nova chave em `DATA_ENCRYPTION_KEY`, antiga em `DATA_ENCRYPTION_KEY_PREVIOUS`, botão no /admin dispara o job que re-cifra em lotes (idempotente); depois a antiga é removida | Plano 10.2 |
| D67 | Painel /admin: só sessão verificada com e-mail em `ADMIN_EMAILS` (demais recebem 404); edita nome, textos, preço, ordem, ativo, Payment Links de teste e produção (ID `plink_` + URL https) e o prompt dos adicionais; cria novos adicionais (nascem inativos); lista compras, eventos de webhook com erro e falhas com botão de reprocessar | Plano 8 e pedido do dono (sem scripts) |
| D68 | IP para rate limit = entrada de `X-Forwarded-For` acrescentada pelo proxy confiável (`TRUSTED_PROXY_HOPS`, padrão 1, contando do fim) | O primeiro item do cabeçalho pode ser forjado pelo cliente |
| D69 | Hospedagem principal na **Square Cloud** (site + worker no mesmo app, 2 GB) com o **PostgreSQL da Square Cloud**, que exige **certificado de cliente**: o PEM (chave + certificado) entra em `DATABASE_SSL_CERT_BASE64`; CA opcional em `DATABASE_SSL_CA_BASE64`; sem CA, TLS sem verificar o servidor (`no-verify`). Parâmetros `sslmode`/`sslcert`… são removidos da URL para não sobrescrever o objeto `ssl` do node-postgres. Railway, Fly.io e Docker continuam suportados | Pedido do dono; a Square Cloud não roda Dockerfile, então o app sobe pelo `scripts/start.mjs` |
| D70 | `scripts/start.mjs` é a entrada de produção: compila se não houver build **ou se o hash do código-fonte mudou** (`scripts/source-hash.mjs`), aplica migrations + seed com advisory lock e sobe site e/ou worker (`PROCESS_TYPE`); se um processo cai, derruba o outro para a hospedagem reiniciar. Porta 80 quando há `squarecloud.app` | A Square Cloud recebe o código-fonte (GitHub/zip), não uma imagem pronta; reinício sem código novo não recompila |
| D71 | Na Square Cloud o storage padrão é o **disco local** (`STORAGE_DRIVER=local` + `ALLOW_LOCAL_STORAGE_IN_PRODUCTION=1`): os originais já são cifrados (D27) e apagados após a leitura ou em até 24 h (D58). R2/S3 é opcional. Sem a variável, o `env.ts` recusa storage local em produção | Menos uma conta para o dono; a trava evita uso acidental num host sem disco |
| D72 | **Repasse da taxa do Stripe (definitivo, pedido do dono):** o cliente paga `ceil((líquido + fixa)/(1 − %))` com ajuste de pior caso; `net_price_cents` guarda o líquido (R$ 30/R$ 10), `price_cents` o cobrado (R$ 31,66/R$ 10,83 com 3,99% + R$ 0,39). Taxa por env (`STRIPE_FEE_*`, usar a maior entre cartão e Pix). O /admin recalcula ao salvar e confere o Payment Link pela API do Stripe (preço ≥ esperado, BRL) | O dono quer receber exatamente R$ 30/R$ 10; o webhook já recusa pagamento abaixo de `amount_cents` (D11) |
| D73 | CSP com nonce por requisição em `src/proxy.ts` (`script-src 'nonce-…' 'strict-dynamic'`), mas `style-src 'self' 'unsafe-inline'` | As barras de progresso e o placar usam `style={{ width }}`; estilos inline não executam código e o risco é baixo frente a reescrever os componentes |
| D74 | `pg`, `pg-boss` e `pino` ficam **fora** do bundle do esbuild (`dist/worker.mjs`/`dist/migrate.mjs`) e são resolvidos do `node_modules` (no Docker, o do standalone) | O `pg` quebra empacotado (requires circulares) e o `pino` usa workers dinâmicos |
| D75 | Alertas operacionais por `ALERT_WEBHOOK_URL` (Discord/Slack) **sem PII**: só código e IDs (evento do Stripe, fila/job, rota); no máximo 1 por código a cada 5 min por processo. `onRequestError` loga só nome/código do erro, rota e digest | Regra crítica 5 |
| D76 | Adicionais `esfriando`, `linha-do-tempo` e `nao-ditos` entram no seed **ativos**; sem Payment Link do modo atual, o botão aparece desabilitado com "Em breve". Adicionais criados no /admin nascem inativos | Vitrine completa desde o início sem risco de cobrança sem link |
| D77 | Instruções alinhadas ao preço cobrado: `CLAUDE.md` ("Modelo de negócio") e os agentes (`copywriter-ptbr`, `seo-performance`) dizem que o cliente vê o bruto e que R$ 30/R$ 10 é o líquido. Ajuda e Termos deixam de ter "R$ 30/R$ 10" fixos e leem `publicPrices()` (preço do banco; sem banco, calcula o bruto a partir do líquido padrão) | Nenhum agente "corrige" o preço depois; o preço exibido é sempre o cobrado (CDC) |
| D78 | Toda variável lida pelo app passa pelo `env.ts` (inclusive `ALLOW_LOCAL_STORAGE_IN_PRODUCTION`, `TRUSTED_PROXY_HOPS`, `ALERT_WEBHOOK_URL`, `DATABASE_POOL_MAX`), e a seção 9, o `.env.example` e o `env.ts` têm a mesma lista. Novas: `SUPPORT_EMAIL` e `PRIVACY_EMAIL` (contatos de Ajuda e do encarregado na Privacidade; sem elas a página mostra "em breve") | Plano 8 e 10.1 pedem contato do encarregado; validação única |
| D79 | Teste de carga **simulado** no Vitest (3 workers × 8 chamadas contra Groq falsa com orçamento por janela) e roteiro do teste real em `docs/teste-de-carga.md`; ROPA como rascunho técnico em `docs/ropa.md`, pendente de revisão jurídica | A chave real e o jurídico são externos ao código |
| D80 | `/admin`: **cada página e cada consulta** de `src/server/admin` chamam `requireAdmin()` (o layout sozinho não protege: o Next 16 pode renderizar só o segmento da página numa navegação RSC); regra no `check-invariants.mjs` | Auditoria da fase 5 (SEC): anônimo lia compras/e-mails via RSC |
| D81 | Conferência do Payment Link exige preço **igual** ao calculado, BRL e preço fixo (sem `custom_unit_amount`), **antes** de gravar; divergente → o link daquele modo é removido (botão vira "Em breve") e o painel explica. Valor líquido aceita só `10`, `10,5`, `10,50` ou `10.50` (sem separador de milhar). Erros voltam ao painel como códigos fixos, nunca texto livre da URL | Evita cobrar mais que o anunciado (CDC), relatório travado por `mismatch_amount` e "R$ 10.50" virar R$ 1.050; evita phishing via `?erro=` |
| D82 | TLS do banco: o servidor só deixa de ser verificado com `DATABASE_SSL=no-verify` **explícito** (e nunca com CA ou `sslmode=verify-*` na URL); em produção `DATABASE_SSL` (ou `?sslmode=`) é obrigatória; `db_tls_unverified` vai para o log ao abrir o pool. O build automático do `start.mjs` não recebe segredos (lista fixa de variáveis). `robots.txt`/`sitemap.xml` dinâmicos (APP_URL em tempo de execução). A migração mostra o motivo da falha (nomes de variáveis ou código do erro) | Auditoria da fase 5; fixar o certificado do servidor fica para quando a Square Cloud informar a CA |
| D83 | Proteções no servidor para o que a IA escreve e aparece ANTES do pagamento (`src/server/reports/guards.ts`): `locked_title` sem nomes, diferente do título real e com no máximo metade das palavras dele (senão, título neutro fixo); seções grátis guardam só o título neutro; `report_sections.locked_title` passa a ser **cifrado** (linhas antigas em texto puro são lidas como estão e cifradas pelo job de rotação). Gancho precisa citar uma das pessoas e não ter números/horários/datas; senão é refeito com os títulos neutros das seções 5–8 (nunca o conteúdo) e, por fim, cai no gancho padrão. Com alerta de risco, gancho sóbrio (sem curiosidade) | Auditoria IA-3/IA-4/SEC-4: o prompt pede, o servidor garante (regras críticas 1 e 6) |
| D84 | Alerta de risco liga com `safety_flag` tolerante (true/1/"sim"…), com a seção `alerta` escrita pela IA mesmo sem a flag, ou com `safety_concerns` em qualquer nota do map; os prompts de resumo/condensação preservam os riscos. Rate limit: contagem + registro numa transação com advisory lock; IPv6 conta pelo /64; limite por IP maior que o por e-mail (CGNAT): envio 5/h por e-mail e 20/h por IP (antes 5/h para os dois), login 3/15 min por e-mail e 30 por IP; teto global de envios (`UPLOAD_GLOBAL_MAX_PER_HOUR`, padrão 120/h). Upload e webhook leem o corpo com contador de bytes reais (nada de confiar no Content-Length) e o rate limit por IP vem antes da leitura | Auditoria IA-1/IA-2/SEC-1/SEC-7/SEC-8/SEC-9 |
| D85 | Prompts e parse (auditoria IA-5 a IA-15; main-report .3, extra-report .2, chunk-summary .3): seções grátis não antecipam investimento/virada/atritos/direção (prompt + `anticipatesPaidConclusion` refaz a seção grátis 1 vez). `callJson` aceita `reasoningEffort` por chamada ("low" em gancho, resumo, condensação e regeneração); resposta truncada → nova tentativa com ×1,5 tokens (teto 16k); adicional até 7000. Estatísticas: "n/d" para iniciativa/tempo/mensagens seguidas sem horários, "(base: N respostas)", datas de início e fim, período em dias de calendário, carinho/risadas com lookarounds Unicode; "ESTATÍSTICAS POR PERÍODO" (primeiro × último terço, a partir de 40 mensagens) e ano no horário quando o período passa de 300 dias; "AMOSTRA CURTA" abaixo de 40 mensagens. Citações conferidas contra a mensagem de texto real (seq vizinho ±3 corrigido; senão, trecho real até 140 ou descarte). `</?conversa>`/`</?notas>` neutralizados com "‹" em mensagens, notas e nomes. Adicional recebe "LEITURA JÁ ENTREGUE" (títulos do principal liberado); no `quem-gosta-mais` o label vem do score (> 55 A, < 45 B, senão equilibrado); seção de conselhos faltando é regenerada. Histórico em `src/server/ai/prompts/README.md` | Relatório específico, números verdadeiros e coerência entre principal e adicionais |
| D86 | O `next build` checa tipos com `tsconfig.build.json` (sem `tests/`, `vitest.config.ts`, `playwright.config.ts`, `drizzle.config.ts`); o `npm run typecheck` continua checando tudo. Testado: `npm ci --omit=dev` + `node scripts/start.mjs` compila, migra e sobe site + worker | A Square Cloud pode instalar só as dependências de produção (`NODE_ENV=production`); sem isso o build falhava por falta do vitest/playwright |
| D87 | Pagamento: (a) reembolso/contestação que chega ANTES da liberação marca a compra ou registra `payment.revoked_unmatched` pelo PaymentIntent, e a liberação posterior (reenvio do Stripe ou reconciliação) é recusada; liberação e revogação do mesmo PaymentIntent são serializadas por advisory lock; (b) a mesma compra paga por duas sessões vira `duplicate_payment` (audit + alerta, reembolso manual); (c) o Payment Link só é aceito no /admin com preço fixo único (`one_time`) IGUAL ao calculado, em BRL, quantidade fixa 1, sem cupom, sem itens opcionais, ativo e com a URL do mesmo link; em produção, sem conseguir conferir, nada é salvo | Auditoria SEC-2/SEC-3/F5-4 e revisões |
| D88 | Contas: sessão leve (criada no envio) dura 7 dias, a verificada 30; "Sair de todos os aparelhos" exige sessão verificada. Retenção apaga usuários sem análises nem sessão válida após `RETENTION_UNPAID_DAYS` (e os tokens de login do e-mail) | Auditoria SEC-6/SEC-11 (LGPD, aparelho compartilhado) |
| D89 | Indexação **opt-in**: o layout raiz é `noindex, nofollow`; só a landing e `(marketing)` usam `PUBLIC_ROBOTS` (invariante no CI). `X-Robots-Tag: noindex, nofollow, noarchive` em todas as rotas privadas e na API. `robots.txt` só bloqueia `/api` e `/admin` (o robô precisa conseguir LER o noindex das demais). Preço público em cache de 60 s por processo (só quando veio do banco; o /admin limpa) | Auditoria SEO-1 a SEO-11 |
| D90 | Proteções do que a IA escreve, revisadas: nomes reconhecidos por qualquer parte (primeiro nome, sobrenome); título bloqueado também recusa horário/data/porcentagem e conclusões pagas; gancho recusa conclusões pagas; ao refazer seção grátis, o modelo só vê os títulos das grátis. Citações: só palavras inteiras (2+ palavras ou 8+ letras), seq corrigido só para vizinha do MESMO remetente, inventadas são descartadas. Alerta automático com `safety_flag`, com a seção `alerta` (sempre que citar termo grave; sem termo grave, só deixa de contar se começar negando) ou com QUALQUER nota do map que registre risco (nada é descartado como "brincadeira"; a seção `alerta` só é ignorada se começar com negação completa sem ressalva, sem medo/insegurança e sem termo grave); na dúvida, liga — falso positivo custa só o gancho; contatos padrão sempre completos (180, 188, 190, Disque 100). Upload: limite por faixa de rede (/24, /48), teto global antes do limite por e-mail, prazo total de leitura do corpo (5 min) | Revisão de código e de segurança das frentes |
| D91 | Design (auditoria UX): aviso de IA completo no topo do relatório, do adicional e na landing; rodapé global com a frase curta (sem triplicar). Sem `loading.tsx` em `/r/[id]`: com o esqueleto em Suspense, os `notFound()`/`redirect()` das páginas saíam com status 200 (404 "mole", redirect por meta-refresh); a página do relatório lê só o banco e é rápida. O esqueleto fica só em `/analisar`. Envio por grupo de rádios (não abas) e checagem de tamanho no navegador; exclusão sempre com passo de confirmação; CTA também no fim das seções bloqueadas (`#desbloquear`) | Mobile primeiro, acessibilidade (axe sem violações sérias a 375 e 1280 px) e regra crítica 7 |
| D92 | Textos (auditoria TXT-2 a TXT-14): **reembolso em até 7 dias após a compra, mediante pedido pelo contato da Ajuda**; falha de entrega reembolsa mesmo depois do prazo; reembolso ou contestação encerram o acesso (D9). Aviso curto junto do botão de pagamento ("Conteúdo digital, liberado assim que o pagamento é confirmado. Você pode pedir reembolso em até 7 dias pela Ajuda.") e "pagamento único, sem assinatura" junto do preço. Privacidade sem notas internas; Groq descrita como operadora que recebe o texto só para gerar o relatório, sem promessas sobre a retenção dela. Sem `SUPPORT_EMAIL`/`PRIVACY_EMAIL`, Ajuda e Privacidade mostram uma frase neutra apontando para Minha conta (antes, "em breve"/"em definição"). **Pendente: o jurídico ainda vai validar o prazo de 7 dias, a seção 6 dos Termos e a seção 4 da Privacidade** (junto da revisão jurídica da seção 11) | Regra clara e coerente com o código (CDC); o texto final depende do jurídico |
| D93 | Revisões finais (code-reviewer e security-auditor, 25/10): `APP_URL` com `https://` e `SUPPORT_EMAIL` obrigatórios em produção (canal de reembolso dos Termos); aviso "pagamento único, conteúdo digital, reembolso em 7 dias" junto de TODO botão de compra (`PaymentNotice`, também na vitrine); reconciliação não libera pagamento já reembolsado/contestado (consulta o PaymentIntent); cobrança em dobro registrada uma vez só; dedup de alertas por código + erro; Payment Link sem imposto automático/frete e com redirect para `${APP_URL}/pagamento/retorno`; link mágico com limite por faixa de rede e teto global (300/h); teto global de envios: e-mail já estourado não gasta vaga e faixa de rede limitada a 12/h; revogação sem relatório liberado volta a análise à retenção de não paga; Privacidade cita as prints enviadas à Groq. A exclusão na tela de confirmação de conversa VAZIA (sem mensagens) não tem passo extra (não há conteúdo a perder). Textos "cartão ou Pix": se o Pix for negado pelo Stripe, revisar `PaymentNotice`, FAQ e Termos | Rodada final de revisão |
| D94 | **Adiados com motivo:** (a) TLS do banco sem verificar o servidor na Square Cloud (`no-verify`) até a plataforma fornecer a CA — pedir ao suporte e preencher `DATABASE_SSL_CA_BASE64` (DEPLOY.md); (b) SEC-10 (alguém criar análises no e-mail de outra pessoa; o dono só vê ao entrar pelo link mágico e pode excluir) — exige rever D26 depois do lançamento; (c) QA-10 (link mágico voltar ao relatório de origem) — exige guardar o destino junto do token; (d) negrito na imagem OG — exige commitar um arquivo de fonte; (e) F5-4d — links do outro modo só são conferidos ao salvar no modo atual (salvar de novo depois de virar para produção) | Baixo risco ou dependem de terceiros |
| D95 | **Sem domínio próprio por enquanto (só o subdomínio da Square Cloud)**: o e-mail sai por SMTP (`EMAIL_DRIVER=smtp`, padrão), pensado para o Gmail com senha de app (`smtp.gmail.com:465`, TLS obrigatório), sem verificar domínio (SPF/DKIM ficam por conta do Google). `EMAIL_FROM` vazio = `Psicanalista do Amor <SMTP_USER>`. O Resend continua disponível (`EMAIL_DRIVER=resend`, exige `EMAIL_FROM` do domínio verificado) para quando houver domínio. Message-ID fixo (hash da chave de idempotência) para repetições do job. Erros do SMTP vão ao log só com o código (ex.: `EAUTH`). A Política de Privacidade cita o operador de e-mail conforme o driver. Limite do Gmail: ~500 destinatários/dia (conta comum) | Pedido do dono: o site ainda não tem domínio; o Resend sem domínio só entrega para o e-mail da própria conta |
| D96 | **Assinatura mensal** (pedido do dono, 26/10): R$ 46,99 líquidos/mês (cobrado R$ 49,35 com a taxa padrão, só cartão, renovação automática), até **10 relatórios completos por dia** (dia no horário de Brasília, sem acúmulo), **adicionais incluídos** e R$ 5 líquidos (R$ 5,62) por relatório completo além do limite do dia; a compra avulsa continua. Catálogo reaproveitado (`report_kind` `subscription`/`overage`); estado da assinatura só a partir do Stripe (webhook validado ou API na reconciliação); a regra "só o webhook libera" passa a ser "só `fulfill.ts` libera, a partir de pagamento ou de assinatura confirmados pelo Stripe". Uso exige **sessão verificada** (sessões leves do envio nunca usam a assinatura do e-mail digitado). Liberação pelo assinante com botão explícito ("Ver o relatório completo"), não automática, para não gastar a cota com envios de teste. Reembolso ou contestação de cobrança da assinatura revogam, rebloqueiam o que ela liberou e cancelam no Stripe (jobs com nova tentativa e alerta); cancelamento normal e `past_due` mantêm o que já foi liberado. Excluir a conta cancela a assinatura no Stripe antes; a limpeza por inatividade não apaga assinantes. Revisões (code-reviewer e security-auditor, 26/10): eventos no mesmo segundo, cobrança em dobro com alerta, compra além do limite válida por 24 h, corte do acesso da sessão leve, `?link=<slug>` obrigatório nos dois links novos. O portal do cliente fica configurado só com cancelamento, cartão e faturas (sem troca de plano). Detalhes em 6.8 | Pedido do dono; segue D9, D11 e D72 |
| D97 | Certificado do Postgres também por **arquivo** (`DATABASE_URL_CERT_PATH`, relativo à raiz do app), para funcionar com o `conectar_banco_app` do MCP da Square Cloud (que envia `certificate.pem`). O base64 (`DATABASE_SSL_CERT_BASE64`) continua e tem prioridade. Arquivo ausente: erro com o nome da variável, sem caminho nem conteúdo | Hospedagem pelo MCP sem o dono converter o certificado |
| D98 | `scripts/start.mjs` converte para caminho absoluto (a partir da raiz do app) `STORAGE_LOCAL_DIR`, `EMAIL_OUTBOX_DIR` e `DATABASE_URL_CERT_PATH` antes de subir site e worker: o `server.js` do Next standalone faz `chdir` para `.next/standalone`, e com caminho relativo o site gravava os envios numa pasta e o worker procurava em outra (o envio nunca era processado com storage local). Conferido subindo em modo produção: envio pelo site, ingestão pelo worker | Bug encontrado ao preparar o deploy pelo MCP |
| D99 | **Auditoria de segurança de 26/10** (relatório na conversa). Achados e correções: **S-01 (alta)**, ReDoS no processamento das conversas: cinco regexes quadráticas com espaços longos (200 mil espaços = 2 min de CPU no worker, sem login) trocadas por formas lineares, com teste de regressão. **S-02 (média)**, cota diária do Gmail esgotável por pedidos de link e envios: orçamento diário `SMTP_DAILY_LIMIT` (450; avisos não essenciais param em 80%), sem migration. **S-04 (baixa)**: `billing.stripe.com` na CSP `form-action` (portal da assinatura sem JS). **S-03 (baixa, aprovado pelo dono)**: análise "plantada" (enviada sem login digitando o e-mail de outra pessoa) mostra aviso em Minhas análises e no relatório para quem entrou pelo link do e-mail, e, ao comprar logado, a sessão sem login de outro aparelho perde o acesso (quem envia e compra no mesmo aparelho sem login continua normal). Pendentes: S-05 (conferir no deploy se o proxy da Square Cloud acrescenta o IP real ao `X-Forwarded-For`) e S-06 (rotas de status sem limite; aceito, consultas leves e só do dono) | Auditoria pedida pelo dono |
| D100 | **Auditoria jurídica de 26/10** (`RELATORIO_JURIDICO.md`). Aplicado: termos sem exclusão de responsabilidade (CDC art. 51, I); cookies e ferramenta de alertas na Política; favicon da Vercel removido; licença `UNLICENSED`; plano de resposta a incidentes e levantamento de licenças em `docs/`; **consentimentos específicos e destacados** para dados sensíveis e transferência internacional no envio (LGPD arts. 11, I e 33, VIII; migration 0003); **registro de acesso do Marco Civil** (art. 15): IP cifrado, data e hora de login, envio, compra, exportação e exclusão, por 6 meses, mesmo após excluir a conta (migration 0004). Decisões do dono: identificação da empresa fica para quando houver CNPJ/endereço (pendente); arrependimento continua pelo e-mail da Ajuda. Pendentes de advogado: base legal para dados sensíveis do terceiro da conversa, textos dos consentimentos, cláusulas de alteração e suspensão, nome do produto | Auditoria pedida pelo dono |
| D101 | **Envio com só 2 caixas** (pedido do dono, 26/10): (1) "Li e aceito os Termos e a Política de Privacidade, e **autorizo o tratamento dos dados desta conversa (que podem ser sensíveis) e o envio dela para análise por IA nos Estados Unidos**, só para gerar o relatório"; (2) "Tenho 18 anos ou mais". A participação na conversa e o aviso de IA passam para o texto dos Termos (introdução). Os consentimentos continuam registrados por item (`terms`, `privacy`, `third_party_data`, `ai_disclaimer`, `sensitive_data`, `international_transfer`, `adult`) com a versão. Substitui as caixas separadas de D100 (J-03); o risco de consentimento agrupado fica no `RELATORIO_JURIDICO.md` para o advogado. Rodapé sem a frase "Uma ferramenta de análise de texto por IA — não é consulta, sessão ou terapia" (o aviso de IA continua no topo do relatório e na landing; revisa D91) | Pedido do dono |
| D102 | **Redesenho visual (26/10, pedido do dono)**. Sistema em `globals.css` (tokens, escala tipográfica, raios `control` 12 px e `card` 16 px, sombras, classes `card-featured`, `alert-*`, `heading-*`, `eyebrow`). Fonte: pilha do sistema, **sem fontes externas** (privacidade e CSP). Lógica, webhook, preços e liberação intactos. Bloqueio: lorem no client com blur (continua), agora sem caixa e com filete "Continua no relatório completo" (texto novo, a revisar). Rótulos novos na landing ("Passo a passo", "Exemplo", "Preço", "Prévia · fictício", "Pague uma vez ou assine") precisam de revisão de copy. Rodapé agrupado em três colunas.
