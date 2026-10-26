# Plano de resposta a incidentes de segurança (LGPD, art. 48)

> Rascunho técnico. **Precisa ser validado por advogado(a)** e completado nos campos `[PREENCHER]`.
> Referências: LGPD, arts. 46 a 49; Resolução CD/ANPD nº 15/2024 (Regulamento de Comunicação de Incidente de Segurança).
> Conferir na ANPD se houve atualização das regras antes de usar este plano.

## 1. Quem faz o quê

| Papel | Pessoa | Contato |
|---|---|---|
| Responsável pela decisão (controlador) | [PREENCHER: nome do responsável] | [PREENCHER: telefone e e-mail] |
| Encarregado (DPO) | [PREENCHER: nome do encarregado] | `PRIVACY_EMAIL` |
| Técnico (investigação e contenção) | [PREENCHER: nome] | [PREENCHER: contato] |
| Advogado(a) | [PREENCHER: nome / escritório] | [PREENCHER: contato] |

## 2. O que conta como incidente

Qualquer acesso não autorizado, perda, alteração, vazamento ou indisponibilidade de dados pessoais. Exemplos neste sistema:

- vazamento de conversas, relatórios, nomes ou e-mails;
- vazamento de segredos (`DATA_ENCRYPTION_KEY`, `DATABASE_URL`, `SESSION_SECRET`, chaves do Stripe, Groq, Gmail, Square Cloud);
- acesso indevido ao `/admin` ou ao banco;
- conteúdo pago entregue sem pagamento por falha do sistema;
- perda do banco ou da `DATA_ENCRYPTION_KEY` (indisponibilidade permanente dos dados).

Sinais de alerta: alertas no `ALERT_WEBHOOK_URL`; erros de autenticação em massa; acessos ao `/admin` não reconhecidos; aviso de um fornecedor (Groq, Stripe, Google, Square Cloud).

## 3. Primeiras horas: conter

1. **Registrar** o que se sabe, com data e hora (um documento só, fora do sistema afetado).
2. **Conter**, conforme o caso:
   - segredo vazado: gerar um novo e trocar na Square Cloud (para a `DATA_ENCRYPTION_KEY`, seguir a rotação do `DEPLOY.md` §14); revogar o antigo no fornecedor;
   - sessões suspeitas: trocar `SESSION_SECRET` (derruba todas as sessões) e reiniciar;
   - acesso indevido ao `/admin`: tirar o e-mail de `ADMIN_EMAILS` e trocar `SESSION_SECRET`;
   - falha de código: parar a app (`parar_app` ou painel) até corrigir.
3. **Preservar evidências**: logs do app (Square Cloud), `audit_log`, `access_logs` (Marco Civil), eventos do Stripe. Não apagar nada.

## 4. Avaliar o risco (até 2 dias úteis)

Responder, com o encarregado e o advogado:

- quais dados e quantos titulares (as conversas podem conter **dados sensíveis**: sempre tratar como risco alto);
- os dados estavam cifrados? A chave também vazou?
- o incidente pode causar risco ou dano relevante aos titulares (discriminação, constrangimento, fraude)?

## 5. Comunicar (se houver risco ou dano relevante)

- **ANPD**: em até **3 dias úteis** do conhecimento do incidente, pelo formulário do site da ANPD (conferir o prazo e o canal atuais).
- **Titulares**: no mesmo prazo, por e-mail, em linguagem simples: o que aconteceu, quais dados, o que já foi feito e o que a pessoa pode fazer.
  - Modelo de e-mail: [PREENCHER: texto revisado pelo advogado].
- Conteúdo mínimo da comunicação (art. 48, §1º): natureza dos dados; titulares envolvidos; medidas de segurança usadas; riscos; motivos da demora, se houver; medidas para reverter ou mitigar.

## 6. Depois

- Corrigir a causa e registrar a decisão no `plano.md` §13.
- Guardar o registro do incidente (mesmo dos que não foram comunicados) por pelo menos 5 anos (Res. 15/2024, art. 10 — conferir).
- Revisar este plano.
