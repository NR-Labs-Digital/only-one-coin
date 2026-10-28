# @ooc/notifications

E-mail transacional atrás de `NotificationProvider` — o resto da plataforma não
conhece o Brevo (`apps/api/CLAUDE.md`, "Notificações").

## Estrutura

```
src/
  NotificationProvider.ts   # a interface + EmailDeliveryError (retryable ou não) + RecipientNotAllowedError
  locales/                  # es-PE.json (padrão) · pt-BR.json · en.json — todo texto do e-mail, mesmas chaves nos três
  render/renderEmail.ts     # template + vars → { subject, html, text }; datas em America/Lima, dinheiro PEN
  providers/
    BrevoNotificationProvider.ts   # POST /v3/smtp/email com o HTML já renderizado (sem template id do Brevo)
    AllowlistGuard.ts              # embrulha qualquer provider; fora de produção só a allowlist passa
    LogNotificationProvider.ts     # sem chave do Brevo: renderiza e loga, não envia
  index.ts
```

Os tipos de template e as vars de cada um vivem no domínio
(`packages/domain/src/notification/EmailNotification.ts`); este pacote só sabe
escrevê-los e entregá-los.

## Regra

Não lê `process.env` — quem faz boot (`apps/api/src/infra/notification/createNotificationProvider.ts`)
valida a env com zod e passa a configuração. Template novo = entrada no
catálogo (`packages/domain/src/notification/emailCatalog.ts`, com `emitted: true`)
+ chave nova em `EmailTemplateVars` + a mesma entrada nos três arquivos de
`locales/`; o `tsc` recusa catálogo e vars fora de sincronia, e os testes
em `apps/api/src/tests/email-templates.test.ts` recusam locale com chave
faltando ou placeholder sem valor.
