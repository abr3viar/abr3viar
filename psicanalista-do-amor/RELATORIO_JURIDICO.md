# Relatório jurídico — Psicanalista do Amor

Auditoria técnica de conformidade feita em 26/10/2026. Escopo: LGPD (Lei 13.709/2018), Código de Defesa do Consumidor (Lei 8.078/1990), Decreto 7.962/2013 (comércio eletrônico), Marco Civil da Internet (Lei 12.965/2014), direitos autorais e licenças de software.

Referência do código: branch `claude/wonderful-maxwell-q7jj2b`, commits `e5f27e1`, `64a56d3` e `394c2cd`.

## 1. Resumo executivo

O produto recebe conversas de duas pessoas, que podem conter dados sensíveis, e gera por IA uma análise paga. Os achados:

- **A base técnica de privacidade é boa:**
  - coleta mínima (só o e-mail e a conversa);
  - criptografia em repouso;
  - exclusão e exportação em autoatendimento;
  - retenção automática;
  - nenhum rastreador ou cookie de terceiros;
  - consentimentos sem pré-marcação;
  - preço final antes do pagamento;
  - cancelamento da assinatura simples.
- **O maior risco é estrutural (J-01):** o serviço trata dados, possivelmente sensíveis, de uma **terceira pessoa** que não consentiu e monta um perfil de comportamento dela. Isso só um(a) advogado(a) pode avaliar.
- **Faltam dados obrigatórios do fornecedor** (J-02): razão social, CNPJ e endereço. O dono ainda não tem CNPJ.

| Gravidade | Total | Corrigidos | Pendentes de decisão | Pendentes de advogado |
|---|---|---|---|---|
| CRÍTICO | 1 | 0 | 0 | 1 |
| ALTO | 4 | 1 | 2 | 1 |
| MÉDIO | 9 | 2 | 4 | 3 |
| BAIXO | 6 | 5 | 1 | 0 |
| **Total** | **20** | **8** | **7** | **5** |

O ALTO corrigido (J-04) também tem textos a validar pelo advogado.

## 2. Achados

| ID | Gravidade | Arquivo e linha | Descrição | Status |
|---|---|---|---|---|
| J-01 | CRÍTICO | `src/app/(marketing)/privacidade/page.tsx:48-53`; modelo de negócio | O serviço trata dados pessoais, e possivelmente **sensíveis** (saúde, vida sexual, religião), da **outra pessoa da conversa**, que não consentiu. A IA produz um perfil de comportamento dela ("quem demonstra mais interesse", "padrões de conflito"). <br><br>O art. 11 da LGPD praticamente só admite o consentimento do próprio titular para dados sensíveis. A declaração do usuário ("participo da conversa") não substitui o consentimento do terceiro. <br><br>Também há questões de tratamento automatizado (art. 20) e de exercício de direitos por quem não é usuário | Pendente de advogado |
| J-02 | ALTO | `src/components/site-footer.tsx:34`; Termos; Privacidade `:19` | Não há razão social, CNPJ (ou CPF) nem endereço físico e eletrônico. São exigidos pelo Decreto 7.962/2013, art. 2º, I e II, e a LGPD exige identificar o controlador (art. 9º, III) | Pendente de decisão (o dono não tem CNPJ nem endereço a divulgar) |
| J-03 | ALTO | `src/components/upload-form.tsx` (caixa `consent_terms`); `src/app/api/uploads/route.ts:26-27` | O consentimento para dados sensíveis (art. 11, I: "específica e destacada") e para a transferência internacional à Groq/EUA (art. 33, VIII: "específico e em destaque") estava embutido no "li e aceito". <br><br>Foram criadas duas caixas próprias (`64a56d3`). Depois, **por decisão do dono**, o envio voltou a ter só duas caixas (Termos e 18 anos), com a autorização **em negrito dentro do texto da caixa dos Termos** (D101). <br><br>Risco: consentimento agrupado com o aceite dos Termos pode ser considerado genérico (art. 8º, §4º) e não "específico e destacado" | Pendente de advogado |
| J-04 | ALTO | (não existia) | O Marco Civil, art. 15, obriga a guardar em sigilo, por 6 meses, os registros de acesso (IP, data e hora). O site só guardava um hash do IP por 24 h | **Corrigido.** A porta lógica de origem não é registrada (ver pergunta 7) |
| J-05 | ALTO | `src/app/(marketing)/termos/page.tsx:104`; Ajuda | O arrependimento (CDC, art. 49) só pode ser exercido por e-mail. O Decreto 7.962, art. 5º, pede que o meio seja informado de forma clara e ostensiva, que o direito possa ser exercido "pela mesma ferramenta" da contratação, e confirmação imediata do recebimento | Pendente de decisão (o dono escolheu manter por e-mail; avaliar com o advogado) |
| J-06 | MÉDIO | `src/app/(marketing)/privacidade/page.tsx:109-121` | A política mostra só o e-mail do encarregado. O art. 41, §1º, pede a identidade e o contato divulgados publicamente | Pendente de decisão (`[PREENCHER: nome do encarregado]`) |
| J-07 | MÉDIO | `src/app/(marketing)/termos/page.tsx:122` (antes: "oferecido como está") | A expressão podia ser lida como exclusão de responsabilidade, que é nula pelo CDC, art. 51, I | **Corrigido** |
| J-08 | MÉDIO | `src/app/(marketing)/termos/page.tsx:133` | "Estes termos podem mudar": é uma alteração unilateral sem aviso prévio nem regra para contratos em curso, como a assinatura (CDC, art. 51, XIII) | Pendente de advogado |
| J-09 | MÉDIO | `src/app/(marketing)/termos/page.tsx:36-42` | Há usos proibidos, mas não há regra de suspensão e encerramento da conta (aviso, defesa, destino dos valores pagos) | Pendente de decisão |
| J-10 | MÉDIO | `src/app/(marketing)/privacidade/page.tsx:48-57` × `docs/ropa.md:9-13` | A base legal da política ("consentimento") diverge do ROPA ("execução de contrato"). Não cita obrigação legal (registros fiscais) nem legítimo interesse (segurança, prevenção de fraude) | Pendente de advogado |
| J-11 | MÉDIO | `src/app/(marketing)/privacidade/page.tsx:73-76` e `:92` | A hospedagem aparece como "por exemplo, Square Cloud…", sem dizer qual é usada nem o país dos servidores. O prazo "logs técnicos: até 30 dias" depende da retenção da Square Cloud, que não foi conferida | Pendente de decisão (`[PREENCHER]`) |
| J-12 | MÉDIO | `src/server/maintenance/retention.ts` (ausente) | A política diz "registros de compra: 5 anos", mas nada apaga as compras depois desse prazo. A trilha de auditoria (`audit_log`) não tem prazo de retenção | Pendente de decisão (apagar é irreversível) |
| J-13 | MÉDIO | (não existia) | Não havia plano de resposta a incidentes (LGPD, art. 48; Res. CD/ANPD 15/2024) | **Corrigido** (`docs/plano-de-resposta-a-incidentes.md`, com `[PREENCHER]`) |
| J-14 | MÉDIO | nome do produto (todo o site) | "Psicanalista do Amor" pode sugerir atendimento por profissional (publicidade enganosa, CDC, art. 37), mesmo com o aviso "não é consulta…". A marca não está registrada no INPI | Pendente de advogado |
| J-15 | BAIXO | `src/app/(marketing)/privacidade/page.tsx:124` | A política não mencionava o cookie. O site usa só o cookie de sessão, essencial, então não é preciso banner | **Corrigido** |
| J-16 | BAIXO | `src/app/(marketing)/privacidade/page.tsx:77` | O webhook de alertas (ex.: Discord) não estava entre os terceiros. Ele recebe só códigos e identificadores técnicos | **Corrigido** |
| J-17 | BAIXO | `src/app/favicon.ico` (removido) | O ícone do site era o logo do Next.js (Vercel), marca de terceiro que sobrou do modelo inicial | **Corrigido** (fica o ícone próprio, `src/app/icon.tsx`) |
| J-18 | BAIXO | `package.json:5` | O projeto não declarava licença | **Corrigido** (`"license": "UNLICENSED"`) |
| J-19 | BAIXO | dependências | Não há GPL nem AGPL. Há LGPL-3.0 (libvips/sharp, biblioteca separada), MPL-2.0 (lightningcss, só no build) e CC-BY-4.0 (caniuse-lite, só no build). Num SaaS não há obrigação extra; se o código ou a imagem Docker for distribuído, é preciso aviso de licenças | **Corrigido** (documentado em `docs/licencas-de-terceiros.md`) |
| J-20 | BAIXO | painel do Stripe | Confirmação imediata da contratação (Decreto 7.962, art. 4º, III): ligar os recibos por e-mail do Stripe, principalmente na assinatura | Pendente de decisão (ação manual) |

**Verificado e conforme** (não entra na contagem):
- política de privacidade com link no rodapé de todas as telas;
- coleta só de e-mail e conversa (sem CPF, telefone, nascimento nem localização);
- consentimentos obrigatórios e nunca pré-marcados;
- confirmação de maioridade e proibição de conversas com menores;
- exportação (portabilidade em JSON) e exclusão em autoatendimento;
- retenção automática das análises;
- nenhum rastreador, pixel, analytics, fonte ou script de terceiros;
- e-mails apenas transacionais (não há marketing, então não é preciso descadastro);
- preço final, já com taxas, antes do pagamento, sem extras pré-selecionados;
- assinatura com renovação automática informada e cancelamento em autoatendimento, tão simples quanto contratar;
- aviso de IA na landing, no relatório e nos Termos;
- usos proibidos nos Termos;
- upload validado (tipo pelos magic bytes, tamanho, zip seguro), com originais apagados em até 24 h;
- segurança (ver a auditoria de segurança de 26/10):
  - sem segredos no repositório nem no histórico;
  - cookies `__Host-`, HttpOnly, Secure e SameSite;
  - HTTPS com HSTS;
  - CSP;
  - proteção contra SQL injection, XSS e CSRF;
  - controle de acesso por dono em todas as rotas;
  - criptografia AES-256-GCM das conversas e relatórios.

**Não se aplica:**
- banner de cookies, porque não há cookies não essenciais;
- moderação e canal de denúncia de conteúdo público (Marco Civil, arts. 19 e 21), porque o conteúdo do usuário não é publicado: fica privado, só para quem enviou.

## 3. Correções aplicadas

Depois das correções: 287 testes unitários e de integração passando, lint e typecheck ok.

**`e5f27e1` — Etapa A**
- **Termos:** o trecho "O serviço é oferecido 'como está'" foi trocado por: *"Fazemos o possível para manter o serviço disponível e funcionando bem, mas a análise é feita por IA e pode conter erros (seção 1). […] Nada nestes termos afasta ou limita os direitos garantidos pelo Código de Defesa do Consumidor."*
- **Privacidade:**
  - nova seção "10. Cookies": um único cookie essencial de sessão, sem publicidade, medição de audiência, cookies de terceiros ou pixels;
  - novo operador "Ferramenta de alertas técnicos (ex.: Discord)", que recebe só códigos e identificadores.
- **Favicon:** `src/app/favicon.ico` (logo da Vercel) removido.
- **`package.json`:** `+ "license": "UNLICENSED"`.
- **Documentos novos:**
  - `docs/plano-de-resposta-a-incidentes.md`: papéis, contenção, avaliação, comunicação à ANPD e aos titulares em 3 dias úteis, registro;
  - `docs/licencas-de-terceiros.md`.

**`64a56d3` — J-03, consentimentos específicos** (depois agrupados na caixa dos Termos por decisão do dono; ver D101)
- **Formulário de envio:** duas caixas novas, obrigatórias, não pré-marcadas e destacadas (fundo âmbar):
  - *"Autorizo o tratamento dos dados desta conversa, que podem ser sensíveis (por exemplo, sobre saúde, vida sexual, religião ou opinião política), só para gerar a análise que estou pedindo."*
  - *"Autorizo o envio da conversa para processamento por IA nos Estados Unidos (Groq, Inc.), só para gerar a análise, como explicado na Política de Privacidade."*
- **Servidor:** recusa o envio sem elas (`consent_required`) e registra `sensitive_data` e `international_transfer` com a versão dos textos (migration 0003).
- **Política:** explica os dois consentimentos e como revogá-los.

**`394c2cd` — J-04, registro de acesso (Marco Civil, art. 15)**
- **Tabela nova** `access_logs` (migration 0004): IP **cifrado** (AES-256-GCM, entra na rotação de chave), data, hora e tipo.
- **O que é registrado:** login, envio de conversa, início de compra ou assinatura, exportação de dados e exclusão da conta. Uma falha no registro nunca impede a ação.
- **Prazo:** guardado 6 meses (183 dias), **mesmo depois da exclusão da conta** (obrigação legal, LGPD, art. 16, I), e apagado automaticamente depois.
- **Acesso:** a exportação de dados inclui os registros do próprio titular. Não há tela de consulta: o restante só por ordem judicial.
- **Textos atualizados:** Privacidade (dados, base legal e retenção), Minha conta (o que fica após a exclusão), `docs/ropa.md` (nova operação) e `plano.md` (D100).

## 4. Perguntas para o responsável pelo produto e para o advogado

1. **(J-01, advogado)** Qual base legal sustenta o tratamento dos dados, inclusive sensíveis, da outra pessoa da conversa e a análise de comportamento dela? Está ligado a isto:
   - Seria preciso restringir o produto? Por exemplo: exigir que a outra pessoa consinta, anonimizar o nome dela, ou proibir conversas com dados sensíveis.
   - Como essa pessoa, que não é usuária, exerce seus direitos (art. 18)?
   - Cabe revisão de decisão automatizada (art. 20)?
2. **(J-02, dono)** O site vai vender antes de haver CNPJ?
   - Vender online exige informar nome empresarial, CNPJ (ou CPF, se for pessoa física) e endereço físico e eletrônico (Decreto 7.962/2013, art. 2º).
   - Opções: abrir um MEI, usar um endereço comercial ou virtual, ou não vender até regularizar.
   - O Stripe também pede esses dados para ativar a conta.
3. **(J-03, advogado)** A autorização de dados sensíveis e de transferência internacional, em negrito dentro da caixa "Li e aceito os Termos" (decisão do dono, D101), atende aos arts. 8º, §4º, 11, I e 33, VIII? Ou precisa de caixa própria?
   - A transferência à Groq deveria se basear em cláusulas-padrão contratuais (Res. CD/ANPD 19/2024) em vez de consentimento?
4. **(J-05, dono e advogado)** Manter o arrependimento só por e-mail atende ao art. 5º do Decreto 7.962 ("pela mesma ferramenta utilizada para a contratação")?
   - O direito de arrependimento vale para conteúdo digital entregue na hora? Hoje o site promete reembolso em 7 dias, o que é mais benéfico ao consumidor.
5. **(J-06, dono)** Quem é o encarregado (DPO)? A política deve trazer o nome e o contato.
6. **(J-08 e J-09, dono e advogado)**
   - Com quantos dias de antecedência e por qual meio as mudanças nos Termos serão avisadas?
   - Mudanças valem para a assinatura em curso só na renovação, com direito de cancelar sem custo?
   - Quais as regras de suspensão e encerramento da conta por uso proibido (aviso, direito de resposta, reembolso)?
7. **(J-04, dono)** O registro de acesso não guarda a **porta lógica de origem**, que o STJ já considerou necessária em casos de CGNAT, porque o proxy da hospedagem não a repassa.
   - A Square Cloud fornece essa informação?
   - Também é preciso confirmar se o IP registrado é o real (item S-05 da auditoria de segurança).
8. **(J-10, advogado)** Quais são as bases legais corretas para cada operação? Hoje política e ROPA divergem:
   - conta e pagamento: execução de contrato;
   - registros fiscais: obrigação legal;
   - segurança: legítimo interesse;
   - conversa: consentimento específico.
9. **(J-11, dono)**
   - A hospedagem é só a Square Cloud?
   - Em que país ficam os servidores e o banco?
   - Por quanto tempo a Square Cloud guarda os logs da aplicação?
10. **(J-12, dono e advogado)**
    - As compras devem ser apagadas, ou anonimizadas, automaticamente depois de 5 anos, como diz a política?
    - Qual o prazo da trilha de auditoria (`audit_log`)?
11. **(J-14, advogado)** O nome "Psicanalista do Amor" tem risco perante o CDC (art. 37) ou entidades de psicanálise e psicologia?
    - O registro no INPI (classes 42 e 45) está disponível?
12. **(Geral, advogado)** Revisar os Termos e a Política inteiros e, depois disso, ligar a variável `LEGAL_REVIEW_DONE=1`, que tira o aviso "texto inicial, em revisão jurídica".

## 5. Marcadores [PREENCHER]

| Marcador | Onde usar |
|---|---|
| `[PREENCHER: razão social ou nome completo do fornecedor]` | Rodapé, Termos e Privacidade (controlador) |
| `[PREENCHER: CNPJ]` (ou CPF, se pessoa física) | Rodapé e Termos |
| `[PREENCHER: endereço físico]` | Rodapé e Termos |
| `[PREENCHER: nome do encarregado]` | Privacidade, seção 8; plano de incidentes |
| `[PREENCHER: contato do encarregado]` | Variável `PRIVACY_EMAIL` (sem ela, usa o `SUPPORT_EMAIL`) |
| `[PREENCHER: país dos servidores da hospedagem]` | Privacidade, seção 4; `docs/ropa.md` |
| `[PREENCHER: prazo de retenção dos logs na Square Cloud]` | Privacidade, seção 5 (hoje diz "até 30 dias") |
| `[PREENCHER: nome do responsável]`, `[PREENCHER: telefone e e-mail]`, `[PREENCHER: nome]` (técnico), `[PREENCHER: contato]` | `docs/plano-de-resposta-a-incidentes.md`, seção 1 |
| `[PREENCHER: nome / escritório]` e `[PREENCHER: contato]` do advogado(a) | `docs/plano-de-resposta-a-incidentes.md`, seção 1 |
| `[PREENCHER: texto revisado pelo advogado]` | Modelo de e-mail aos titulares em caso de incidente |

## 6. Aviso

**Este relatório é uma análise técnica preliminar e não substitui parecer de advogado especializado em LGPD e direito do consumidor.** As citações de leis e resoluções devem ser conferidas na versão vigente. Os textos legais do site continuam marcados como "texto inicial, em revisão jurídica" até a revisão por um(a) profissional.
