# Como colocar o Psicanalista do Amor no ar

Guia passo a passo, escrito para quem **nunca publicou um site** e **não vai instalar nada no computador**. Tudo é feito pelo navegador: painéis da Square Cloud, Stripe, Groq e da sua conta Google (Gmail), mais o console do navegador (F12) para gerar chaves.

A hospedagem principal é a **Square Cloud**, que roda o site, o worker e o banco PostgreSQL. As alternativas (Railway, Fly.io e Docker) estão no [fim do guia](#16-alternativas-railway-flyio-e-docker).

> ⚠️ **Confira a documentação da Square Cloud.** Durante o desenvolvimento, o site `docs.squarecloud.app` não pôde ser consultado (a rede do ambiente estava bloqueada). Os nomes de botões e menus da Square Cloud citados aqui, e as chaves do arquivo `squarecloud.app`, seguem o formato conhecido da plataforma, mas **podem ter mudado**. Antes do primeiro deploy, abra a documentação oficial e confira, em especial:
> - as chaves do `squarecloud.app` (`MAIN`, `MEMORY`, `VERSION`, `SUBDOMAIN`, `START`, `AUTORESTART`, `DISPLAY_NAME`, `DESCRIPTION`);
> - onde ficam as **variáveis de ambiente** no painel;
> - como baixar o **certificado** do banco PostgreSQL;
> - qual plano permite **2 GB de memória** e **banco de dados** (e, mais tarde, **domínio próprio**).

---

## Sumário

1. [O que você vai precisar](#1-o-que-você-vai-precisar)
2. [Gerar as chaves secretas (no navegador)](#2-gerar-as-chaves-secretas-no-navegador)
3. [Criar o banco PostgreSQL na Square Cloud](#3-criar-o-banco-postgresql-na-square-cloud)
4. [Onde ficam os arquivos enviados (storage)](#4-onde-ficam-os-arquivos-enviados-storage)
5. [Groq (a inteligência artificial)](#5-groq-a-inteligência-artificial)
6. [E-mail pelo Gmail (sem domínio próprio)](#6-e-mail-pelo-gmail-sem-domínio-próprio)
7. [Stripe, parte 1: chaves e webhook](#7-stripe-parte-1-chaves-e-webhook)
8. [Publicar na Square Cloud](#8-publicar-na-square-cloud)
9. [Primeiro acesso ao /admin](#9-primeiro-acesso-ao-admin)
10. [Stripe, parte 2: Payment Links e Pix](#10-stripe-parte-2-payment-links-e-pix)
11. [Teste completo em modo teste](#11-teste-completo-em-modo-teste)
12. [Virar para produção (dinheiro de verdade)](#12-virar-para-produção-dinheiro-de-verdade)
13. [Mais tarde: domínio próprio e Resend (opcional)](#13-mais-tarde-domínio-próprio-e-resend-opcional)
14. [Backups, alertas e rotação de chave](#14-backups-alertas-e-rotação-de-chave)
15. [Solução de problemas](#15-solução-de-problemas)
16. [Alternativas: Railway, Fly.io e Docker](#16-alternativas-railway-flyio-e-docker)
17. [Checklist final antes de abrir ao público](#17-checklist-final-antes-de-abrir-ao-público)
- [Apêndice: todas as variáveis de ambiente](#apêndice-todas-as-variáveis-de-ambiente)

---

## 1. O que você vai precisar

| Conta | Para quê | Custo |
|---|---|---|
| **GitHub** (onde o código já está) | A Square Cloud pode puxar o código daqui | grátis |
| **Square Cloud** | Hospedar o site, o worker e o banco | plano pago com pelo menos **2 GB de memória** para o app, mais o banco PostgreSQL |
| **Groq** (`console.groq.com`) | Ler prints e escrever os relatórios | por uso. Em produção, use o plano pago (o grátis aguenta ~1 relatório por minuto no site inteiro) |
| **Stripe** (`dashboard.stripe.com`) | Receber pagamentos por cartão e Pix | por transação |
| **Conta Google (Gmail)** | Enviar o link de login e os avisos por e-mail (sem precisar de domínio) | grátis (até ~500 e-mails por dia) |
| **Domínio** (ex.: no Registro.br) | Endereço próprio. **Opcional, para depois** ([passo 13](#13-mais-tarde-domínio-próprio-e-resend-opcional)) | anual |
| **Gerenciador de senhas** (Bitwarden, 1Password...) | Guardar as chaves geradas | grátis/pago |

> 🔐 **Regra de ouro:** chaves e senhas vão **só** no painel da hospedagem e no seu gerenciador de senhas. **Nunca** no GitHub, em e-mail ou em mensagens.

Durante o guia, anote cada valor num **bloco de notas seguro** do gerenciador de senhas, com o nome da variável ao lado. No fim, você cola tudo de uma vez na Square Cloud.

---

## 2. Gerar as chaves secretas (no navegador)

O site precisa de três segredos aleatórios: `DATA_ENCRYPTION_KEY`, `SESSION_SECRET` e `HASH_PEPPER`.

1. Abra uma aba nova do Chrome, Edge ou Firefox e digite `about:blank` na barra de endereço.
2. Aperte **F12** (no Mac: `Cmd + Option + I`) e clique na aba **Console**.
3. Se o Chrome mostrar um aviso dizendo que não é permitido colar, digite `allow pasting` (ou `permitir colar`) e aperte Enter.
4. Cole o código abaixo inteiro e aperte **Enter**:

```js
const b64 = (n) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n))));
const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const out = `DATA_ENCRYPTION_KEY=${b64(32)}\nSESSION_SECRET=${hex(32)}\nHASH_PEPPER=${hex(24)}`;
console.log(out);
copy(out);
```

5. Aparecem três linhas, e elas **já estão copiadas** para a área de transferência. Cole no seu gerenciador de senhas.

> ⚠️ **`DATA_ENCRYPTION_KEY` é a chave que cifra todas as conversas e relatórios no banco.** Se ela se perder, **todos os dados cifrados viram lixo** e nem os backups salvam. Guarde **duas cópias** em lugares diferentes do gerenciador de senhas. Nunca troque essa chave sem seguir a [rotação de chave](#rotação-da-chave-de-criptografia).

---

## 3. Criar o banco PostgreSQL na Square Cloud

1. Entre em `squarecloud.app` → **Dashboard**.
2. Procure a área de **Bancos de dados / Databases** e clique em **criar/novo**.
3. Escolha **PostgreSQL** (versão 16 ou mais nova) e a memória sugerida pelo plano. Dê um nome, por exemplo `psicanalista-db`.
4. Quando o banco estiver criado, abra a página dele e anote:
   - a **URL de conexão** (começa com `postgres://` ou `postgresql://`): é o valor de `DATABASE_URL`;
   - o **certificado** do banco: clique para **baixar** (normalmente um arquivo `.pem`). Ele contém a chave privada e o certificado do cliente.

### 3.1 Converter o certificado para base64 (no navegador)

As variáveis de ambiente não aceitam arquivos, então o certificado entra como texto em **base64**.

1. Abra `about:blank`, aperte **F12** → **Console** (como no passo 2).
2. Cole e aperte **Enter**:

```js
const i = Object.assign(document.createElement("input"), { type: "file", multiple: true });
i.style = "position:fixed;top:20px;left:20px;z-index:99999;padding:24px;font-size:18px;background:#fff;border:3px solid #a33";
document.body.append(i);
i.onchange = async () => {
  const texts = await Promise.all([...i.files].map((f) => f.text()));
  const b64 = btoa(texts.join("\n"));
  copy(b64);
  console.log(`Pronto: ${b64.length} caracteres copiados. Cole em DATABASE_SSL_CERT_BASE64.`);
};
```

3. Aparece um botão **"Escolher arquivos"** no canto da página. Clique nele e selecione o arquivo `.pem` baixado. Se a Square Cloud entregou **dois arquivos** (um `.crt` e um `.key`), selecione **os dois juntos**.
4. O resultado já fica copiado. Cole no gerenciador de senhas como **`DATABASE_SSL_CERT_BASE64`**.

> O texto é longo (uns 3 mil caracteres) e começa com `LS0tLS1CRUdJTi`. Se começar com outra coisa, você provavelmente escolheu o arquivo errado.

Configuração final do banco:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | a URL de conexão copiada do painel |
| `DATABASE_SSL_CERT_BASE64` | o base64 gerado acima |
| `DATABASE_SSL` | `no-verify` (conexão cifrada com certificado de cliente; o certificado do servidor não é verificado). **Obrigatória em produção**: sem ela (ou sem `?sslmode=` na URL), o site não sobe |
| `DATABASE_SSL_CA_BASE64` | **recomendado**: peça ao suporte da Square Cloud o certificado da autoridade (CA) do servidor do banco, converta do mesmo jeito e cole aqui — assim o site também confere que está falando com o banco certo. Sem ele, a conexão é cifrada mas não verifica o servidor (risco baixo, mas existe) |

> **Alternativa com o MCP da Square Cloud:** a ferramenta `conectar_banco_app` grava `DATABASE_URL`, envia o certificado como arquivo `certificate.pem` e define `DATABASE_URL_CERT_PATH=certificate.pem`. O site aceita esse formato. Nesse caso, você não precisa do passo 3.1: basta acrescentar `DATABASE_SSL=no-verify`.

Não é preciso criar tabelas. Na primeira inicialização, o site aplica as migrations e cadastra os tipos de relatório sozinho.

---

## 4. Onde ficam os arquivos enviados (storage)

Prints, `.zip` e `.txt` enviados pelos usuários ficam guardados **por pouco tempo**: são **cifrados** antes de ir para o disco, lidos pelo worker e **apagados logo depois**. Um job apaga qualquer sobra em no máximo **24 horas**.

### Opção A (recomendada para começar): disco da própria Square Cloud

| Variável | Valor |
|---|---|
| `STORAGE_DRIVER` | `local` |
| `STORAGE_LOCAL_DIR` | `./.data/uploads` |
| `ALLOW_LOCAL_STORAGE_IN_PRODUCTION` | `1` |

Sem `ALLOW_LOCAL_STORAGE_IN_PRODUCTION=1`, o site **se recusa a subir** em produção com storage local. A trava existe para que ninguém use storage local por engano num host sem disco.

Limitação: se o app reiniciar **no meio** da leitura de um envio, aquele envio falha e o usuário vê "tentar de novo". Isso é raro.

### Opção B (opcional): Cloudflare R2

1. `dash.cloudflare.com` → **R2** → **Create bucket** (nome: `psicanalista-uploads`, **privado**).
2. **R2** → **Manage R2 API Tokens** → **Create API token** com permissão *Object Read & Write* só nesse bucket.
3. Configure:

| Variável | Valor |
|---|---|
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (aparece na página do R2) |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | `psicanalista-uploads` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | os do token criado |
| `ALLOW_LOCAL_STORAGE_IN_PRODUCTION` | `0` |

---

## 5. Groq (a inteligência artificial)

1. Entre em `console.groq.com` → **API Keys** → **Create API Key**. Copie como **`GROQ_API_KEY`** (começa com `gsk_`). Ela só aparece uma vez.
2. Em **Settings → Billing**, ative o plano pago (Developer) antes de abrir ao público.
3. **Escolha dos modelos.** Os modelos mudam com frequência: vários foram desligados em 2026. **Antes de configurar, abra e leia:**
   - `console.groq.com/docs/models`: modelos disponíveis;
   - `console.groq.com/docs/deprecations`: modelos que vão ser desligados.

| Variável | Valor sugerido (conferido em 23/10/2026) | O que precisa ter |
|---|---|---|
| `GROQ_VISION_MODEL` | `qwen/qwen3.8-27b` | modelo **de visão** (lê imagens), aceita `json_object` |
| `GROQ_REPORT_MODEL` | `openai/gpt-oss-120b` | contexto grande (≥ 128k), bom em português |
| `GROQ_SUMMARY_MODEL` | `openai/gpt-oss-20b` | mais barato e rápido |
| `GROQ_REASONING_EFFORT` | `medium` | use `off` se o modelo escolhido **não** for de raciocínio |

Se um modelo da tabela aparecer como *deprecated* ou não existir mais, troque pelo substituto que a própria Groq indica. Basta mudar a variável e reiniciar; não é preciso mexer no código.

---

## 6. E-mail pelo Gmail (sem domínio próprio)

O e-mail é **essencial**: é por ele que você entra no `/admin` e que os clientes voltam para os relatórios. Como o site ainda não tem domínio próprio (só o endereço `*.squareweb.app`), os e-mails saem por uma **conta Gmail**, sem verificar domínio nenhum: o Google já assina os e-mails (SPF/DKIM) por você.

> 💡 Recomendado: crie uma conta Gmail **só para o site** (ex.: `psicanalistadoamor@gmail.com`). Ela aparece como remetente para os clientes e não mistura com o seu e-mail pessoal.

### 6.1 Ligar a verificação em duas etapas (obrigatório para a senha de app)

1. Entre na conta Gmail do site e abra `myaccount.google.com/security`.
2. Em **Como você faz login no Google**, clique em **Verificação em duas etapas** → **Ativar**. Siga os passos (celular por SMS ou app).

### 6.2 Gerar a senha de app

1. Abra `myaccount.google.com/apppasswords` (se pedir, faça login de novo).
2. Em **Nome do app**, digite `Psicanalista do Amor` e clique em **Criar**.
3. O Google mostra uma senha de **16 letras** (ex.: `abcd efgh ijkl mnop`). **Copie agora**: ela não aparece de novo. Guarde no gerenciador de senhas como **`SMTP_PASSWORD`**.

> ⚠️ A senha de app **não é** a senha da conta. Se você trocar a senha da conta Google, as senhas de app são apagadas: gere outra e atualize `SMTP_PASSWORD`.
> Se a página `apppasswords` disser que a opção não está disponível, a verificação em duas etapas não está ativa (volte ao 6.1). Contas do Google Workspace podem ter isso bloqueado pelo administrador.

### 6.3 Variáveis

| Variável | Valor |
|---|---|
| `EMAIL_DRIVER` | `smtp` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | o endereço Gmail inteiro (ex.: `psicanalistadoamor@gmail.com`) |
| `SMTP_PASSWORD` 🔐 | a senha de app de 16 letras, **sem os espaços** (ex.: `abcdefghijklmnop`) |
| `EMAIL_FROM` | deixe **vazio**: o site usa `Psicanalista do Amor <SMTP_USER>` |

Dicas:
- Use o mesmo Gmail em `SUPPORT_EMAIL` (contato de suporte e reembolso), para as respostas dos clientes caírem na mesma caixa.
- O limite do Gmail é de cerca de **500 e-mails por dia**. O site para sozinho em 450 (`SMTP_DAILY_LIMIT`): os avisos "análise pronta" param antes, e o link de login e o "relatório liberado" usam o resto. Se chegar o alerta `orcamento_diario_de_email`, alguém pode estar abusando do formulário de login. No começo sobra; se o site crescer, passe para o Resend com domínio próprio ([passo 13](#13-mais-tarde-domínio-próprio-e-resend-opcional)).
- Na primeira vez, o link pode cair no **spam** de quem recebe; marcar como "não é spam" ajuda.

---

## 7. Stripe, parte 1: chaves e webhook

Comece **sempre no modo teste** (chave no canto superior direito do painel: *Test mode* ligado).

1. A conta Stripe precisa ser **do Brasil** e estar em **BRL**. No cadastro do negócio, descreva o produto de forma honesta, como **serviço digital / software de análise de texto por IA**. Categorias de "encontros/relacionamentos" (MCC 7273) **não podem usar Pix**.
2. **Developers → API keys**: copie a **Secret key** (`sk_test_...`) como **`STRIPE_SECRET_KEY`**.
3. **Developers → Webhooks → Add endpoint**:
   - **Endpoint URL**: `https://psicanalistadoamor.squareweb.app/api/webhooks/stripe` (troque pelo endereço do seu app, ver [passo 8](#8-publicar-na-square-cloud));
   - **Events to send**: selecione **exatamente** estes 9:
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
     - `checkout.session.async_payment_failed`
     - `checkout.session.expired`
     - `charge.refunded`
     - `charge.dispute.created`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`

     Os três últimos são da assinatura mensal: renovação, cobrança recusada e cancelamento.
   - Salve. Na página do endpoint, clique em **Reveal** no *Signing secret* e copie como **`STRIPE_WEBHOOK_SECRET`** (começa com `whsec_`).

> A lista de eventos também aparece no `/admin` → **Relatórios e Payment Links** → "Como criar cada Payment Link".

### 7.1 A taxa do Stripe é repassada ao cliente

Você define quanto quer **receber líquido**: **R$ 30** pelo relatório completo, **R$ 10** por adicional, **R$ 46,99** por mês na assinatura e **R$ 5** por relatório do assinante além do limite do dia. O site calcula o preço **cobrado** para que, depois da taxa, chegue exatamente esse valor:

```
preço cobrado = arredondar para cima ( (líquido + taxa fixa) ÷ (1 − taxa percentual) )
```

Com a taxa padrão de cartão nacional (**3,99% + R$ 0,39**):

| Relatório | Você recebe | Cliente paga |
|---|---|---|
| Principal (completo) | R$ 30,00 | **R$ 31,66** |
| Cada adicional | R$ 10,00 | **R$ 10,83** |
| Assinatura mensal | R$ 46,99 por mês | **R$ 49,35 por mês** |
| Relatório além do limite (assinante) | R$ 5,00 | **R$ 5,62** |

As variáveis são:

| Variável | Padrão | Significado |
|---|---|---|
| `STRIPE_FEE_PERCENT` | `3.99` | parte percentual da taxa (use ponto ou vírgula) |
| `STRIPE_FEE_FIXED_CENTS` | `39` | parte fixa, **em centavos** (R$ 0,39 = `39`) |
| `STRIPE_SUBSCRIPTION_EXTRA_FEE_PERCENT` | `0` | tarifa a mais do **Stripe Billing** nas cobranças recorrentes, somada **só** no preço da assinatura |

> ⚠️ **Assinatura: confira a tarifa do Stripe Billing.** Cobranças recorrentes costumam ter uma tarifa a mais, além da do cartão. Nos EUA, ela é de 0,7% do valor. Veja a da sua conta em `stripe.com/br/pricing`, seção **Billing**. Se existir, coloque a porcentagem em `STRIPE_SUBSCRIPTION_EXTRA_FEE_PERCENT` (ex.: `0.7`) e reinicie. Depois, no `/admin`, clique em **Salvar** na assinatura e crie o Payment Link com o novo preço. Sem isso, você recebe um pouco menos que R$ 46,99 por mês.

**Confira as tarifas reais da sua conta** em *Settings → Billing / Pricing* ou na página de preços do Stripe Brasil. Elas variam por conta, por tipo de cartão e por forma de pagamento.

> ⚠️ **A tarifa do Pix pode ser diferente da do cartão.** Cada Payment Link tem **um único preço** para todas as formas de pagamento, então configure `STRIPE_FEE_*` com a **maior** tarifa entre as formas ativas (normalmente a do cartão). Com isso, você recebe **pelo menos** R$ 30/R$ 10 em qualquer forma. No Pix, se a tarifa for menor, sobra um pouco a mais.
>
> **Se as tarifas mudarem:** troque `STRIPE_FEE_PERCENT`/`STRIPE_FEE_FIXED_CENTS` na Square Cloud e reinicie. Depois, no `/admin` → **Relatórios e Payment Links**, clique em **Salvar** em cada relatório (o aviso amarelo mostra o novo preço). Por fim, crie **novos** Payment Links com o novo preço e cole no `/admin`, porque o preço de um Payment Link existente não pode ser alterado.

---

## 8. Publicar na Square Cloud

O arquivo `squarecloud.app` na raiz do projeto já está pronto:

```
DISPLAY_NAME=Psicanalista do Amor
MAIN=scripts/start.mjs
MEMORY=2048
VERSION=recommended
SUBDOMAIN=psicanalistadoamor
START=npm start
AUTORESTART=true
```

- `MEMORY=2048`: **2 GB** são necessários, porque a primeira inicialização compila o site.
- `SUBDOMAIN`: o endereço fica `https://psicanalistadoamor.squareweb.app`. Se esse nome estiver ocupado, troque (só letras minúsculas e números) e use o novo endereço em `APP_URL` e no webhook do Stripe.
- O site escuta na **porta 80**, como a Square Cloud exige. Isso é automático.
- O projeto precisa de **Node.js 22.12 ou mais novo**. `VERSION=recommended` usa a versão recomendada da plataforma; se o log mostrar uma versão anterior à 22 (ou um erro de `engines`), troque para `VERSION=latest`.
- Não importa se a Square Cloud instala só as dependências de produção: o build foi testado assim (`npm ci --omit=dev`).

### 8.1 Enviar o código

**Pelo GitHub (recomendado):** no painel da Square Cloud, procure **Nova aplicação / Upload** → **Importar do GitHub**, autorize o acesso ao repositório e escolha o branch com o código. Em geral, novos pushes no branch podem ser publicados com um clique (ou automaticamente, se você ativar).

**Por arquivo .zip:** no GitHub, clique em **Code → Download ZIP**. Abra o zip e confira que o arquivo **`squarecloud.app` está na raiz**, não dentro de uma subpasta. Se estiver numa subpasta, extraia, entre na pasta e compacte **o conteúdo** dela. Envie o zip em **Nova aplicação → Upload**.

### 8.2 Variáveis de ambiente

Na página do app, abra **Configurações → Variáveis de ambiente** (o nome pode variar; ver o aviso no topo) e cadastre cada variável. A lista completa está no [apêndice](#apêndice-todas-as-variáveis-de-ambiente). O mínimo para subir é:

```
NODE_ENV=production
APP_URL=https://psicanalistadoamor.squareweb.app
DATABASE_URL=...
DATABASE_SSL=no-verify
DATABASE_SSL_CERT_BASE64=...
DATA_ENCRYPTION_KEY=...
SESSION_SECRET=...
HASH_PEPPER=...
GROQ_API_KEY=...
GROQ_VISION_MODEL=...
GROQ_REPORT_MODEL=...
GROQ_SUMMARY_MODEL=...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_FEE_PERCENT=3.99
STRIPE_FEE_FIXED_CENTS=39
STORAGE_DRIVER=local
ALLOW_LOCAL_STORAGE_IN_PRODUCTION=1
EMAIL_DRIVER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=psicanalistadoamor@gmail.com
SMTP_PASSWORD=...
ADMIN_EMAILS=seu-email@gmail.com
SUPPORT_EMAIL=psicanalistadoamor@gmail.com
PRIVACY_EMAIL=psicanalistadoamor@gmail.com
PROCESS_TYPE=all
TRUSTED_PROXY_HOPS=1
```

- `APP_URL`: endereço exato, com `https://` (obrigatório em produção) e **sem barra no final**.
- `SUPPORT_EMAIL`: obrigatório em produção — é o contato de suporte e de reembolso.
- `ADMIN_EMAILS`: o(s) e-mail(s) que podem abrir o `/admin`, separados por vírgula. Pode ser o seu e-mail pessoal: o link de login é enviado para ele pelo Gmail do site.
- `SMTP_USER`/`SMTP_PASSWORD`: o Gmail do site e a senha de app (passo 6).
- `PROCESS_TYPE=all`: site e worker rodam juntos no mesmo app.

### 8.3 Primeira inicialização (demora alguns minutos)

Na primeira vez, e sempre que o código mudar, o `scripts/start.mjs`:
1. **compila** o projeto, o que leva **de 3 a 8 minutos** (o log mostra `compilando o projeto...`);
2. aplica as **migrations** e cadastra os relatórios (`aplicando migrations e seed...`);
3. sobe o **site** (`site na porta 80`) e o **worker** (`worker iniciado`).

Nas reinicializações sem código novo, ele pula a compilação (compara um hash do código) e sobe em segundos. A compilação não recebe as chaves secretas (só o necessário para compilar).

Acompanhe pela aba **Logs / Console** do app. Se aparecer `Variáveis de ambiente inválidas ou ausentes`, veja a [solução de problemas](#15-solução-de-problemas).

### 8.4 Conferir se está no ar

Abra `https://psicanalistadoamor.squareweb.app/api/health`. Deve aparecer:

```json
{"status":"ok"}
```

Esse é o **healthcheck**: ele confere o banco e a fila. Se a Square Cloud tiver opção de healthcheck/monitoramento, aponte para `/api/health`. Depois abra a página inicial.

---

## 9. Primeiro acesso ao /admin

1. Abra `${APP_URL}/entrar` e digite o e-mail que está em `ADMIN_EMAILS`.
2. Abra o e-mail **"Seu link para entrar no Psicanalista do Amor"** e clique no link. Na página que abrir, clique em **Entrar**. O link vale 15 minutos e funciona uma vez só.
3. Abra `${APP_URL}/admin`. Se aparecer "página não encontrada", o e-mail não está em `ADMIN_EMAILS` (confira e reinicie) ou você não entrou pelo link do e-mail.

No painel:
- **Visão geral**: funil (envios, prévias, pagamentos), receita e eventos do webhook com erro.
- **Relatórios e Payment Links**: preço a cobrar de cada relatório e campos para colar os links.
- **Compras**: lista de compras.
- **Operações**: reconciliar pagamentos, limpeza, retenção, rotação de chave e reprocessar falhas.

---

## 10. Stripe, parte 2: Payment Links e Pix

### 10.1 Habilitar o Pix

**Settings → Payment methods** → procure **Pix** → **Turn on**. O Pix só aparece em contas do Brasil e pode exigir aprovação. Se for negado (por exemplo, pela categoria do negócio), siga só com cartão.

### 10.2 Criar um Payment Link por relatório

No `/admin` → **Relatórios e Payment Links**, cada relatório mostra o **"Preço a cobrar no Payment Link"**: R$ 31,66 no principal e R$ 10,83 nos adicionais, com a taxa padrão. Para **cada** relatório ativo:

1. Stripe → **Product catalog → Add product**:
   - nome igual ao do `/admin` (ex.: "Relatório completo");
   - **One-off** (pagamento único), **BRL**, valor = o **preço a cobrar** mostrado no `/admin`.
2. **Payment Links → New** (ou **Create payment link**):
   - escolha o produto, **quantidade fixa 1** (desmarque "permitir ajustar quantidade");
   - **não** colete endereço nem telefone;
   - em **After payment**, escolha **Don't show confirmation page** → redirecionar para:
     ```
     https://psicanalistadoamor.squareweb.app/pagamento/retorno?link=SLUG
     ```
     trocando `SLUG` pelo slug do relatório (aparece entre parênteses no `/admin`, ex.: `principal`, `quem-gosta-mais`);
   - formas de pagamento: **cartão** e **Pix**.
3. Copie a **URL** do link (`https://buy.stripe.com/...`) e o **ID** (`plink_...`, que aparece na página do link ou na URL do painel).
4. No `/admin`, cole URL e ID em **Payment Link — TESTE** (ou **PRODUÇÃO**, no modo produção) e clique em **Salvar**.

Ao salvar, o site **confere pela API do Stripe** se o link do modo atual cobra **exatamente** o preço calculado, em BRL e com preço fixo. Se estiver tudo certo, aparece "Salvo. O Payment Link foi conferido no Stripe.". Se o valor for diferente (para mais ou para menos), o resto é salvo, mas **o link é removido** e aparece "O Payment Link cobra R$ X, mas o preço calculado é R$ Y...". Assim ninguém paga um valor diferente do anunciado. Crie um link com o valor certo e cole de novo. Se o Stripe não puder ser consultado na hora, aparece "Não foi possível conferir o Payment Link no Stripe agora": confira o valor você mesmo. **Isso importa:** um pagamento menor que o esperado **não libera** o relatório.

Relatório adicional sem link configurado continua aparecendo na vitrine, com o botão de compra desabilitado e a mensagem "Em breve". Para tirá-lo da vitrine, desmarque **Ativo na vitrine**.

### 10.3 Assinatura mensal e relatório além do limite

No `/admin`, a **Assinatura mensal** (slug `assinatura-mensal`) mostra o preço a cobrar **por mês**: R$ 49,35 com a taxa padrão. O **Relatório além do limite diário** (slug `relatorio-alem-do-limite`) mostra R$ 5,62.

1. **Assinatura**: Stripe → **Product catalog → Add product**:
   - nome "Assinatura mensal — Psicanalista do Amor";
   - preço **Recurring** → **Monthly**, em **BRL**, com o valor do `/admin`;
   - **sem** período de teste grátis.
2. **Payment Links → New** com esse produto:
   - quantidade fixa 1, sem cupom;
   - redirect para `https://psicanalistadoamor.squareweb.app/pagamento/retorno?link=assinatura-mensal`.

   O link de assinatura aceita **só cartão**, porque o Pix não renova sozinho. Cole URL e ID no `/admin` e salve. O site confere se o preço é recorrente mensal e sem teste grátis.
3. **Relatório além do limite**: crie um produto **One-off** de R$ 5,62 e um Payment Link do mesmo jeito do passo 10.2, com redirect `...?link=relatorio-alem-do-limite`. Cartão e Pix.
4. **Portal do cliente** (para o assinante trocar o cartão, ver faturas e cancelar sozinho): Stripe → **Settings → Billing → Customer portal**. Ative:
   - **Cancel subscriptions**: no fim do período;
   - **Update payment methods**;
   - **Invoice history**.

   Deixe **desligadas** a troca de plano e a de quantidade. Senão, o cliente poderia pagar menos e manter o acesso. Salve. É por esse portal que o botão **Gerenciar ou cancelar a assinatura**, em Minha conta, funciona.
5. Confira se o webhook tem os 3 eventos `customer.subscription.*` (passo 7).

Como funciona para o cliente:
- **Limite e adicionais:** até 10 relatórios completos por dia. O limite renova à meia-noite, no horário de Brasília. Os adicionais ficam incluídos.
- **Login:** para usar a assinatura, a pessoa entra pelo link enviado ao e-mail.
- **Depois do limite:** passou dos 10 no dia, o botão vira "Liberar este relatório agora", por R$ 5,62.
- **Cancelamento:** vale no fim do período. Se a renovação for recusada, o uso fica suspenso até o pagamento entrar.

Se precisar parar de vender a assinatura, desmarque **À venda** no `/admin`. Quem já assina continua até cancelar.

> **Reembolso de uma cobrança da assinatura** (Stripe → Payments → Refund): o site encerra a assinatura na hora, volta a bloquear o que ela liberou e **cancela a assinatura no Stripe sozinho**. Se o cancelamento falhar várias vezes, chega o alerta `assinatura_cancelar_manualmente`: cancele em Customers → assinatura → **Cancel**. A **contestação** de uma cobrança da assinatura tem o mesmo efeito.
>
> O redirect dos links da assinatura e do relatório além do limite **precisa** terminar com `?link=assinatura-mensal` e `?link=relatorio-alem-do-limite`. Sem isso, o `/admin` recusa o link.

---

## 11. Teste completo em modo teste

Com `STRIPE_SECRET_KEY=sk_test_...` e os links de **TESTE** colados:

1. Abra o site numa **janela anônima**, clique em **Analisar uma conversa** e cole uma conversa **inventada**, como:
   ```
   10/10/2026 20:01 - Ana: oi! chegou bem?
   10/10/2026 20:05 - Lucas: cheguei sim, e você?
   ```
   (repita e varie até ter umas 30 mensagens).
2. Confirme os participantes e espere a prévia (metade grátis).
3. Clique em **Desbloquear**. No Stripe de teste, pague com o cartão `4242 4242 4242 4242`, qualquer data futura e qualquer CVC.
4. Você volta para "Confirmando pagamento…" e, em segundos, o relatório completo abre.
5. Teste um **adicional** do mesmo jeito.
6. Teste o **Pix** de teste (o Stripe mostra um botão para simular o pagamento).
7. Teste um **reembolso**: Stripe → **Payments** → o pagamento → **Refund**. O relatório volta a ficar bloqueado.
8. No Stripe → **Developers → Webhooks** → seu endpoint, todos os eventos devem estar com **200**.
9. No `/admin` → **Visão geral**, a lista "Eventos do webhook com erro" deve estar vazia.
10. Teste **/entrar** de outro navegador e **Minha conta → Excluir tudo**.
11. **Assinatura**:
    - entre pelo link do e-mail, abra `/assinatura` e assine com o cartão `4242 4242 4242 4242`;
    - envie uma conversa nova e clique em **Ver o relatório completo** (sem pagar). Depois gere um adicional;
    - em **Minha conta**, confira "Hoje: 1 de 10" e abra **Gerenciar ou cancelar a assinatura**;
    - cancele pelo portal e confira em Minha conta que aparece "Cancelada: vale até…".

---

## 12. Virar para produção (dinheiro de verdade)

1. No Stripe, **desligue o Test mode**.
2. **Developers → API keys** → copie a **Secret key** `sk_live_...`.
3. **Developers → Webhooks** → crie **outro** endpoint (o de teste não vale em produção) com a mesma URL e os mesmos 9 eventos. Copie o novo `whsec_...`.
4. Crie os **produtos e Payment Links de produção** (passos 10.2 e 10.3, agora em modo produção) e ative o **portal do cliente** também no modo produção.
5. Na Square Cloud, troque `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` pelos de produção e **reinicie**.
6. No `/admin`, o modo agora aparece como **produção**. Cole os links nos campos **PRODUÇÃO**.
7. Faça **uma compra real** de R$ 10,83, confira que liberou e que chegaram **R$ 10,00** líquidos (Stripe → **Payments** → detalhes → *Fee* e *Net*). Depois, se quiser, reembolse.

---

## 13. Mais tarde: domínio próprio e Resend (opcional)

Nada disso é necessário para abrir o site: o endereço `https://psicanalistadoamor.squareweb.app` e o Gmail funcionam. Faça quando quiser um endereço próprio ou enviar mais de ~500 e-mails por dia.

### 13.1 Apontar o domínio para a Square Cloud

1. Compre o domínio (ex.: Registro.br) e confira se o seu plano da Square Cloud permite **domínio personalizado**.
2. No painel do app → **Domínio / Custom domain**, informe `seudominio.com.br` (ou `www.seudominio.com.br`).
3. A Square Cloud mostra um registro DNS (geralmente CNAME). Crie-o no painel do seu domínio (ex.: Registro.br → **DNS** → **Editar zona**).
4. Espere o HTTPS ficar ativo (o cadeado aparece no navegador).
5. Atualize **tudo** para o novo endereço:
   - `APP_URL=https://seudominio.com.br` na Square Cloud (e reinicie);
   - a URL do **webhook** no Stripe;
   - o **redirect** de cada Payment Link (`https://seudominio.com.br/pagamento/retorno?link=SLUG`).

### 13.2 Trocar o Gmail pelo Resend (e-mail com o seu domínio)

1. Entre em `resend.com` → **Domains** → **Add Domain**. Use um subdomínio, por exemplo `mail.seudominio.com.br`.
2. O Resend mostra alguns **registros DNS** (TXT para **SPF**, TXT/CNAME para **DKIM** e às vezes MX). Crie **cada registro exatamente como aparece** no painel do domínio.
3. Recomendado: crie também um registro **DMARC** (TXT em `_dmarc.seudominio.com.br` com valor `v=DMARC1; p=none;`).
4. Volte ao Resend e clique em **Verify**. Espere ficar **Verified** em todos os itens (minutos a horas).
5. **API Keys** → **Create API Key** (permissão *Sending access*). Copie a chave (começa com `re_`).
6. Na Square Cloud, troque as variáveis e reinicie:

| Variável | Valor |
|---|---|
| `EMAIL_DRIVER` | `resend` |
| `RESEND_API_KEY` 🔐 | a chave copiada |
| `EMAIL_FROM` | `Psicanalista do Amor <oi@mail.seudominio.com.br>` (obrigatório; o domínio precisa ser o verificado) |

As variáveis `SMTP_*` podem ser apagadas depois. Atualize também `SUPPORT_EMAIL`/`PRIVACY_EMAIL` se criar endereços no domínio.

---

## 14. Backups, alertas e rotação de chave

### Backups do banco
- Ative os **backups/snapshots automáticos** do PostgreSQL no painel da Square Cloud, se o plano tiver, e veja como restaurar.
- Uma vez por semana, baixe uma cópia manual (opção de *backup/exportar* do banco) e guarde num lugar seguro.
- O backup **só serve com a `DATA_ENCRYPTION_KEY`**: os conteúdos estão cifrados. Guarde a chave separada do backup.

### Alertas
Crie um webhook no **Discord** (canal → Editar → Integrações → Webhooks → Novo → Copiar URL) ou no **Slack** (Incoming Webhooks) e cole em **`ALERT_WEBHOOK_URL`**. Você recebe uma mensagem curta, **sem dados pessoais** (só código e IDs), quando:
- um evento do webhook do Stripe falha ou precisa de reconciliação manual;
- um job falha de vez;
- acontece um erro no servidor.

Há no máximo 1 alerta do mesmo tipo a cada 5 minutos.

### Rotação da chave de criptografia
Faça a rotação se suspeitar que a chave vazou, ou uma vez por ano:
1. Gere uma chave nova (passo 2, só a linha `DATA_ENCRYPTION_KEY`).
2. Na Square Cloud: mova a chave **atual** para `DATA_ENCRYPTION_KEY_PREVIOUS` e coloque a **nova** em `DATA_ENCRYPTION_KEY`. Reinicie.
3. `/admin` → **Operações** → **Rotacionar chave de criptografia**. O job re-cifra tudo em lotes.
4. Espere terminar (acompanhe nos logs) e então **apague** `DATA_ENCRYPTION_KEY_PREVIOUS` e reinicie.
5. Atualize as cópias da chave no gerenciador de senhas.

`SESSION_SECRET` e `HASH_PEPPER` podem ser trocados a qualquer momento. O único efeito é que todos precisam entrar de novo pelo link do e-mail.

---

## 15. Solução de problemas

| Sintoma | Causa provável | Como resolver |
|---|---|---|
| Log mostra **`Variáveis de ambiente inválidas ou ausentes`** seguido de uma lista | Variável faltando, vazia ou no formato errado. A lista diz **qual** e **por quê** (nunca mostra o valor) | Corrija cada item listado e reinicie. Casos comuns: `DATA_ENCRYPTION_KEY` precisa ter 32 bytes em base64 (gere de novo no passo 2); `APP_URL` sem `https://`; `ainda está com o valor de exemplo` = você colou o valor do `.env.example` |
| `APP_URL: use o endereço com https:// em produção` | `APP_URL` com `http://` | Use o endereço com `https://` (o da Square Cloud já é https) |
| `SUPPORT_EMAIL: obrigatória em produção` | Faltou o e-mail de suporte | Cadastre `SUPPORT_EMAIL` (é o canal de reembolso dos Termos) |
| `STORAGE_DRIVER: use s3 em produção` | Faltou `ALLOW_LOCAL_STORAGE_IN_PRODUCTION=1` | Adicione a variável (passo 4) |
| `EMAIL_DRIVER: outbox é só para desenvolvimento` | `EMAIL_DRIVER` errado | Use `EMAIL_DRIVER=smtp` com `SMTP_USER` e `SMTP_PASSWORD` (passo 6) |
| `SMTP_USER` / `SMTP_PASSWORD: obrigatória com EMAIL_DRIVER=smtp` | Faltou o Gmail ou a senha de app | Cadastre as duas (passo 6) |
| `EMAIL_FROM: ainda está com o remetente de exemplo` | `EMAIL_FROM` com `@example.com` | Deixe `EMAIL_FROM` vazio (usa o Gmail) ou coloque o remetente certo |
| `DATABASE_SSL: defina no-verify, require ou disable` | Em produção a escolha de TLS do banco é obrigatória | Na Square Cloud use `DATABASE_SSL=no-verify` (passo 3) |
| `[migrate] ... código ECONNREFUSED` / `ENOTFOUND` / `28P01` | Endereço do banco errado, banco desligado ou senha errada | Copie de novo a `DATABASE_URL` do painel do banco e confira se ele está ligado |
| `falha nas migrations` / `/api/health` responde `{"status":"error"}` | Banco inacessível ou certificado inválido (a linha `[migrate]` logo acima mostra o código do erro) | Confira `DATABASE_URL` (copie de novo do painel); gere o base64 do certificado de novo (passo 3.1) e confira se começa com `LS0tLS1CRUdJTi`; use `DATABASE_SSL=no-verify`; confira se o banco está ligado |
| Erro `self signed certificate` ou `unable to verify` | `DATABASE_SSL=require` sem a CA | Use `no-verify` ou informe `DATABASE_SSL_CA_BASE64` |
| `falha no build` / app reinicia durante a compilação | Memória insuficiente | Confira `MEMORY=2048` e se o plano tem 2 GB livres |
| Compra aprovada no Stripe, mas o relatório **não libera** | Webhook com assinatura errada, endereço errado ou evento faltando | Stripe → Webhooks → endpoint: se os eventos estão com **400**, o `STRIPE_WEBHOOK_SECRET` está errado (o de teste e o de produção são diferentes!). Se estão com **404**, a URL está errada. Confira os 9 eventos. Depois, `/admin` → **Operações** → **Reconciliar pagamentos agora** |
| Alerta `webhook_stripe_reconciliar` com `duplicate_payment` ou `overage_expired` | Cliente pagou um link avulso de um relatório já liberado (ex.: pela assinatura), ou pagou o valor de assinante mais de 24 h depois e já não assina | **Reembolse** o pagamento no Stripe (Payments → Refund). O relatório continua como estava |
| Assinou, mas a assinatura não aparece ativa | Webhook sem os eventos `customer.subscription.*` ou com erro | Confira os 9 eventos e os status 200 no endpoint. `/admin` → **Operações** → **Reconciliar pagamentos agora** |
| "Não foi possível abrir o gerenciamento da assinatura" | Portal do cliente não ativado no Stripe (no modo atual) | Stripe → Settings → Billing → Customer portal → ativar e salvar (passo 10.3) |
| Ao salvar a assinatura no `/admin`: "A assinatura precisa de um preço recorrente MENSAL" | Preço avulso, anual ou com teste grátis | Crie um preço **Recurring → Monthly** sem teste grátis e um link novo |
| `/admin` → "Eventos do webhook com erro" com **`mismatch_amount`** | O Payment Link cobra **menos** que o preço calculado (ex.: R$ 30 em vez de R$ 31,66) | Crie um link novo com o **preço a cobrar** do `/admin`, cole e salve. Reembolse ou libere manualmente o cliente afetado (reconciliação) |
| Erro **`mismatch_link`** | O pagamento veio de um link diferente do cadastrado para aquele relatório | Confira se o ID `plink_...` colado é do link certo e do modo certo (teste × produção) |
| **`missing_client_reference_id`** / **`purchase_not_found`** | Alguém pagou abrindo o link do Stripe direto (sem passar pelo site) | Não libera sozinho, de propósito. Identifique o cliente pelo e-mail no Stripe e reembolse ou oriente a comprar pelo site |
| Ao salvar no `/admin`: "O Payment Link cobra R$ X, mas o preço calculado é R$ Y" (link removido) | Link com preço errado | Crie um link novo com o preço certo (R$ Y) e cole |
| Ao salvar no `/admin`: "Não encontramos esse Payment Link no Stripe" (link removido) | ID errado ou do outro modo (teste × produção) | Copie de novo o `plink_...` do link certo |
| Ao salvar no `/admin`: "O Payment Link não está em BRL" ou "deixa o cliente escolher o valor" (link removido) | Produto em outra moeda ou com preço livre | Crie um preço fixo em BRL e um link novo |
| Ao salvar no `/admin`: "Confira os campos: Valor líquido (use o formato 10,00)" | Valor digitado em formato não aceito (ex.: `1.000,00`) | Digite só números com vírgula ou ponto para os centavos: `30`, `30,00` ou `30.00` |
| Botão de compra aparece **desabilitado** | Payment Link não cadastrado para o modo atual (teste/produção) | Cole o link no `/admin`, no campo do modo atual |
| **E-mail não chega** e o log mostra `email_send_failed` com `code: EAUTH` | Senha de app errada ou apagada (trocar a senha do Google apaga as senhas de app) | Gere outra senha de app (passo 6.2), atualize `SMTP_PASSWORD` e reinicie. Confira se `SMTP_USER` é o Gmail inteiro |
| `email_send_failed` com `ETIMEDOUT`/`ECONNECTION` | A rede da hospedagem bloqueou a porta 465 | Tente `SMTP_PORT=587` e reinicie |
| **E-mail não chega** sem erro no log (`email_sent`) | Caiu no spam ou passou do limite diário do Gmail (~500) | Peça para olhar o spam e marcar “não é spam”; confira em `mail.google.com` → **Enviados** se o e-mail saiu; se o volume cresceu, passe para o Resend (passo 13.2). Com Resend: **Domains** todos **Verified** e `EMAIL_FROM` no mesmo domínio |
| Link do e-mail diz **"expirado"** | Passou de 15 minutos ou já foi usado | Peça outro em `/entrar` |
| Relatório fica muito tempo em "Escrevendo relatório" ou falha | Limite da Groq (plano grátis), chave errada ou modelo desligado | Procure `ai_call_failed` nos logs e veja o `code`: `ai_rate_limited` = aumente o plano da Groq; `ai_auth` = `GROQ_API_KEY` errada; `ai_model_not_found` = modelo desligado ou nome errado (troque, passo 5); `ai_bad_request` = o modelo não aceita algum parâmetro (tente `GROQ_REASONING_EFFORT=off`) |
| Prints não são lidas | `GROQ_VISION_MODEL` não é um modelo de visão | Escolha um modelo com suporte a imagens em `/docs/models` |
| Alerta `job_falhou` | Um job esgotou as tentativas | `/admin` → **Operações** → reprocessar |

---

## 16. Alternativas: Railway, Fly.io e Docker

Todas usam o `Dockerfile` do projeto (a mesma imagem roda site + worker com `PROCESS_TYPE=all`). Nesses hosts, prefira **S3/R2** (passo 4, opção B) e deixe `ALLOW_LOCAL_STORAGE_IN_PRODUCTION=0`.

### Railway
1. `railway.com` → **New Project → Deploy from GitHub repo** → escolha o repositório. O `railway.json` já define o build pelo Dockerfile e o healthcheck em `/api/health`.
2. No projeto, **New → Database → PostgreSQL**. Em **Variables** do app, use `DATABASE_URL=${{Postgres.DATABASE_URL}}` e `DATABASE_SSL=no-verify` (pela rede interna do Railway, `DATABASE_SSL=disable` também funciona). Não use `DATABASE_SSL_CERT_BASE64`.
3. Cadastre as demais variáveis do [apêndice](#apêndice-todas-as-variáveis-de-ambiente) e, em **Settings → Networking**, gere o domínio (`*.up.railway.app`). Use esse endereço em `APP_URL`.

### Fly.io
1. Pelo painel `fly.io/dashboard` → **Launch an app** a partir do GitHub (usa o Dockerfile; porta interna **3000**).
2. Crie um Postgres (**Managed Postgres**) e copie a URL para `DATABASE_URL`.
3. Cadastre as variáveis em **Secrets**. Healthcheck em `/api/health`.

### Docker (qualquer servidor)
```bash
docker build -t psicanalista .
docker run -d --restart unless-stopped -p 3000:3000 --env-file /caminho/seguro/.env psicanalista
```
O container aplica as migrations na inicialização e expõe a porta 3000, com healthcheck embutido. Defina `DATABASE_SSL` (`require`, `no-verify` ou, com o banco na mesma rede privada, `disable`). Coloque um proxy com HTTPS (Caddy, Nginx, Cloudflare) na frente e ajuste `TRUSTED_PROXY_HOPS`.

Para separar site e worker em dois serviços, rode a mesma imagem duas vezes, com `PROCESS_TYPE=web` e `PROCESS_TYPE=worker`.

---

## 17. Checklist final antes de abrir ao público

- [ ] `/api/health` responde `{"status":"ok"}`.
- [ ] `DATA_ENCRYPTION_KEY` guardada em **dois** lugares seguros.
- [ ] Modelos da Groq reconferidos em `/docs/models` e `/docs/deprecations`; plano pago ativo.
- [ ] E-mail pelo Gmail funcionando (`EMAIL_DRIVER=smtp`, senha de app); link mágico chegando na caixa de entrada (não no spam).
- [ ] Teste completo em modo teste feito (passo 11), incluindo Pix e reembolso.
- [ ] Stripe em **produção**: `sk_live_`, webhook de produção com os 9 eventos, `whsec_` de produção.
- [ ] Assinatura: produto recorrente mensal, Payment Links da assinatura e do relatório além do limite e portal do cliente, em teste e em produção (passo 10.3); tarifa do Stripe Billing conferida (`STRIPE_SUBSCRIPTION_EXTRA_FEE_PERCENT`).
- [ ] Tarifas reais da conta conferidas; `STRIPE_FEE_*` com a **maior** tarifa entre cartão e Pix.
- [ ] Payment Links de **produção** colados no `/admin`, todos conferidos (sem erro ao salvar), com o redirect certo.
- [ ] Compra real de um adicional feita e líquido de R$ 10,00 conferido no Stripe.
- [ ] (Opcional, depois) Domínio próprio com HTTPS; `APP_URL`, webhook e redirects atualizados; e-mail no Resend (passo 13).
- [ ] Backups automáticos do banco ativos e uma restauração testada.
- [ ] `ALERT_WEBHOOK_URL` configurada e recebendo alertas.
- [ ] `SUPPORT_EMAIL` (obrigatório em produção: o site não sobe sem ele) e `PRIVACY_EMAIL` (encarregado/DPO; vazio = usa o de suporte) configurados. Eles aparecem em **Ajuda** e **Privacidade** e são o canal de reembolso prometido nos Termos.
- [ ] **Revisão jurídica** dos Termos e da Política de Privacidade (LGPD, CDC, prazo de reembolso de 7 dias) feita por advogado(a) e o registro de operações (`docs/ropa.md`) revisado. Depois, `LEGAL_REVIEW_DONE=1`.
- [ ] Pedido de registro da marca no **INPI** (classes 42 e 45).
- [ ] Teste de carga com a chave real da Groq em horário de pouco uso (ver `docs/teste-de-carga.md`).

---

## Apêndice: todas as variáveis de ambiente

As mesmas do `.env.example` e da seção 9 do `plano.md`. 🔐 = segredo.

| Variável | Obrigatória | Valor na Square Cloud |
|---|---|---|
| `NODE_ENV` | sim | `production` |
| `APP_URL` | sim | `https://psicanalistadoamor.squareweb.app` (ou, depois, seu domínio), sem barra no fim |
| `DATABASE_URL` 🔐 | sim | URL do Postgres da Square Cloud |
| `DATABASE_SSL` | não | `no-verify` (ou `require` com CA) |
| `DATABASE_SSL_CERT_BASE64` 🔐 | Square Cloud | certificado do banco em base64 (passo 3.1) |
| `DATABASE_URL_CERT_PATH` | não | alternativa ao base64: `certificate.pem` (arquivo na raiz do app; é o que o MCP da Square Cloud configura com `conectar_banco_app`) |
| `DATABASE_SSL_CA_BASE64` | não | CA do servidor em base64, se houver |
| `DATABASE_POOL_MAX` | não | `10` |
| `DATA_ENCRYPTION_KEY` 🔐 | sim | passo 2 |
| `DATA_ENCRYPTION_KEY_PREVIOUS` 🔐 | não | só durante a rotação |
| `SESSION_SECRET` 🔐 | sim | passo 2 |
| `HASH_PEPPER` 🔐 | sim | passo 2 |
| `GROQ_API_KEY` 🔐 | sim | passo 5 |
| `GROQ_BASE_URL` | não | vazio (só testes) |
| `GROQ_VISION_MODEL` / `GROQ_REPORT_MODEL` / `GROQ_SUMMARY_MODEL` | sim | passo 5 |
| `GROQ_REASONING_EFFORT` | não | `medium` |
| `GROQ_VISION_MAX_IMAGES_PER_REQUEST` | não | `3` |
| `GROQ_MAX_CONCURRENCY` | não | `2` |
| `GROQ_REPORT_MAX_COMPLETION_TOKENS` | não | `8000` |
| `REPORT_DIRECT_MAX_TOKENS` | não | `40000` |
| `CHUNK_TOKENS` | não | `12000` |
| `STRIPE_SECRET_KEY` 🔐 | sim | `sk_test_...` → depois `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` 🔐 | sim | `whsec_...` do endpoint do modo atual |
| `STRIPE_FEE_PERCENT` | não | `3.99` (confira a sua conta) |
| `STRIPE_FEE_FIXED_CENTS` | não | `39` |
| `STRIPE_SUBSCRIPTION_EXTRA_FEE_PERCENT` | não | `0` (ou a tarifa do Stripe Billing da sua conta, ex.: `0.7`; só na assinatura) |
| `STORAGE_DRIVER` | sim | `local` (ou `s3`) |
| `STORAGE_LOCAL_DIR` | não | `./.data/uploads` |
| `ALLOW_LOCAL_STORAGE_IN_PRODUCTION` | Square Cloud | `1` com storage local |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | com `s3` | passo 4B |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` 🔐 | com `s3` | passo 4B |
| `EMAIL_DRIVER` | sim | `smtp` (Gmail, passo 6) → depois, com domínio, `resend` (passo 13.2) |
| `SMTP_HOST` | não | `smtp.gmail.com` |
| `SMTP_PORT` | não | `465` (ou `587`) |
| `SMTP_USER` | com `smtp` | o Gmail do site |
| `SMTP_PASSWORD` 🔐 | com `smtp` | senha de app do Gmail (passo 6.2) |
| `RESEND_API_KEY` 🔐 | com `resend` | passo 13.2 |
| `EMAIL_FROM` | com `resend` | vazio com `smtp` (usa o Gmail); com `resend`, remetente no domínio verificado |
| `EMAIL_OUTBOX_DIR` | não | (só dev/testes) |
| `SMTP_DAILY_LIMIT` | não | `450` (abaixo do limite de ~500/dia do Gmail; conta Google Workspace aguenta mais: até ~1.900) |
| `UPLOAD_MAX_BYTES` / `MAX_IMAGES` / `MAX_IMAGE_BYTES` / `PASTE_MAX_CHARS` | não | padrões: 25 MB / 60 / 8 MB / 500 mil |
| `UPLOAD_GLOBAL_MAX_PER_HOUR` | não | `120` envios por hora no site inteiro (protege a cota da Groq; aumente se o site crescer) |
| `RETENTION_UNPAID_DAYS` / `RETENTION_PAID_DAYS` | não | `7` / `180` |
| `ADMIN_EMAILS` | sim, para usar o painel | seu e-mail |
| `SUPPORT_EMAIL` | **sim** (produção) | e-mail de suporte e reembolso (Ajuda) |
| `PRIVACY_EMAIL` | antes de abrir ao público | e-mail do encarregado/DPO (Privacidade); vazio = usa o `SUPPORT_EMAIL` |
| `LEGAL_REVIEW_DONE` | não | `1` depois que o(a) advogado(a) revisar Termos e Privacidade (some o aviso "em revisão") |
| `LOG_LEVEL` | não | `info` |
| `PROCESS_TYPE` | não | `all` |
| `TRUSTED_PROXY_HOPS` | não | `1` |
| `ALERT_WEBHOOK_URL` | não | webhook do Discord/Slack |
