# @ooc/api

Processo Node separado do Next.js (`apps/app`). Expõe `@ooc/domain` via HTTP
(Fastify) e roda os workers que consomem `@ooc/queue` (Redis/BullMQ).

Esboço baseado no template `Psykka/template-ddd` — ver `packages/domain/README.md`
para o que foi mantido e o que mudou em relação a ele.

## Um entrypoint só

- `src/index.ts` — servidor HTTP (Fastify) e os workers de fila (BullMQ) no
  mesmo processo (`pnpm dev`).

Já existiu um `src/worker.ts` separado, pensado pra escalar/reiniciar API e
workers de forma independente — mas isso só se justifica se a hospedagem
permitir escalar cada um à parte. Como `apps/api` roda no Fly.io como VM
*always-on* única, a separação não se justificava; fundido num entrypoint só
(sessão 31/08/2026, `CLAUDE.md` §3).

## Build de produção

`pnpm build` compila `@ooc/domain`, `@ooc/queue`, `@ooc/db` e `@ooc/api` via
`tsc` (cada pacote ganhou um `tsconfig.build.json` — o `tsconfig.json` normal
continua `noEmit` pro `typecheck`) e reescreve os imports de alias `@/*` pra
caminho relativo com `tsc-alias`, já que `tsc` sozinho não resolve `paths` em
tempo de execução.

Os pacotes do workspace exportam sob condição: `development` aponta pro
`.ts` cru (o que `pnpm dev`/`vitest` usam, via `tsx --conditions=development`
e `resolve.conditions` no `vitest.config.ts` — edição ao vivo sem rebuild),
`default` aponta pro `dist/` compilado (o que produção usa, sem TypeScript
instalado). `pnpm deploy --filter=@ooc/api --prod --legacy` empacota só
`@ooc/api` e as deps de produção (workspace + npm) num diretório
autocontido — `apps/api/package.json` ganhou `"files": ["dist"]` pra esse
empacotamento levar o `dist/` compilado (por padrão `pnpm deploy` respeita
`.gitignore`, que exclui `dist/`).

`apps/api/Dockerfile` (contexto = raiz do monorepo, ver comentário no
arquivo) e `fly.toml` (raiz do repo, pelo mesmo motivo de contexto)
encadeiam exatamente esses passos pro deploy no Fly.io.

## Estrutura

```
src/
  config.ts               # env validada com zod no boot (NODE_ENV, PORT, HOST, REDIS_URL, DATABASE_URL...)
  container.ts             # composition root — monta identity, repositories, useCases e queries de @ooc/domain
  app.ts                    # build do Fastify (zod type provider, swagger fora de produção, rotas, plugin de autorização)
  index.ts                  # entrypoint único: servidor HTTP + workers de fila no mesmo processo
  http/
    RootRoute.ts, HealthCheckRoute.ts
    auth/AuthCatchAllRoute.ts            # traduz erro nativo do Better Auth pro envelope do projeto
    catalog/                              # GetPublicCatalogRoute, ListOpenClassGroupsRoute, RetireCatalogEntryRoute, RestoreCatalogEntryRoute
    enrollment/                           # ClaimSeatHoldRoute, ReleaseSeatHoldRoute e SubmitPublicEnrollmentRoute (checkout público), CreateManualEnrollmentRoute e ListEnrollmentsRoute (backoffice)
    identity/                             # staff: convite, promoção de cargo, acesso, redefinição de senha, bitácora
    platform/                             # feature flags: Get/List/Set; settings: GetPlatformSettings, UpdatePlatformSettings (PATCH) — cargos em settingsRoles.ts
    student/                              # diretório e seletor (ListStudents, SearchStudents), ficha (GetStudent, ListStudentActivity), cadastro e edição (RegisterStudent, UpdateStudent, SaveGuardian) — cargos em studentRoles.ts
  workers/
    outbox-relay.worker.ts     # a cada 5 s oferece as linhas pending da outbox à fila send-email
    send-email.worker.ts       # entrega pelo NotificationProvider (Brevo, atrás da allowlist)
    seat-hold-sweep.worker.ts  # a cada 30 s expira os holds de checkout vencidos e devolve as vagas
    receipt-upload-relay.worker.ts  # a cada 5 s oferece comprovantes `uploaded` ao normalize e os `processed` + ligados a pagamento ao screen
    receipt-normalize.worker.ts     # magic bytes, HEIC, downscale/cinza/strip EXIF + impressão digital (sha256, pHash, EXIF)
    receipt-screen.worker.ts        # antifraude nível 0: compara com comprovantes de outros pagamentos, grava os sinais
    receipt-validate.worker.ts      # semáforo (OOC-21): compara valor, nº de operação e meio lidos com o esperado; só valida (verde fica pendente), o resto vai pra revisão
  infra/
    db/client.ts                  # pg.Pool + drizzle(), aponta pro Postgres local ou Neon via DATABASE_URL
    logger.ts                     # pino compartilhado (container.logger)
    auth/betterAuth.ts             # Better Auth embutido no processo
    identity/                      # adapters Drizzle de identidade (staff, convites, audit_log, role) + pontes com o Better Auth
    persistence/                   # repositórios/queries Drizzle por bounded context: student/, enrollment/ (inclui ListEnrollmentsQuery), catalog/, identity/, platform/
    plugins/
      authorization.ts               # deny-by-default: rota sem .roles()/.owners()/.public() falha o boot; onRequest resolve sessão e checa papel/domínio
      errorHandler.ts                 # setErrorHandler global — mapeia HttpError (@ooc/domain) e erro zod pro envelope de ErrorResponseSchema
      swagger.ts, authSwagger.ts      # docs interativas (fora de produção)
  scripts/
    seed-admin.ts, seed-catalog.ts             # bootstrap local (ver CLAUDE.md §8 "Bootstrap")
    seed-students.ts, seed-enrollments.ts       # dado fictício e determinístico pro backoffice ter lista de verdade (ver README.md da raiz, "Rodar local") — sempre exigem --confirm-host fora do Postgres local
    report-duplicate-students.ts                 # lista documento repetido e quantas matrículas cada cópia carrega — passo prévio ao índice único de (national_id_type, national_id), CLAUDE.md §1
    import-legacy-enrollments.ts, legacy-import/  # importador da base antiga (dry-run, deduplicação)
  tests/
    register-student-dedupe.test.ts, soft-deletable-model.test.ts, retire-catalog-entry.test.ts, seed-students.test.ts, seed-enrollments.test.ts, seat-hold.test.ts, enrollment-emails.test.ts, …
    (e ao lado dos repositórios: *.integration.test.ts, rodados por test:db contra Postgres migrado)
  shared/http/RouteBuilder.ts, ErrorResponseSchema.ts
```

Não existe mais rota nem repositório de exemplo (`CreateExampleRoute`,
`InMemoryExampleRepository`) — essa era a base do scaffold inicial e já foi
substituída pelos bounded contexts reais acima.

## Pendências conhecidas

- **Build/deploy**: feito — app real `only-one-coin-api` no ar em
  `only-one-coin-api.fly.dev` (GRU, 1 máquina `shared-cpu-1x`/256mb sempre
  ligada), os 5 secrets (`FLY_API_TOKEN`, `DATABASE_URL`,
  `TIGRIS_ACCESS_KEY_ID`, `TIGRIS_SECRET_ACCESS_KEY`, `VERCEL_TOKEN`) já
  setados no repo do GitHub, CI/CD automatizado
  (`.github/workflows/deploy-api.yml`): a cada push em `main`, backup do Neon
  pro Tigris → migration → `flyctl deploy`, nessa ordem, cada um só roda se
  o anterior passar (`docs/ARCHITECTURE.md` §5.8).
- **Persistência**: real via Drizzle sobre `@ooc/db` — todo repositório em
  `infra/persistence/` e `infra/identity/` fala com o Postgres, não existe
  implementação em memória. Ainda faltam bounded contexts inteiros: não há
  vínculo conta ↔ docente (`teachers.user_id`, OOC-79) nem upload de contrato (OOC-81), de turma no lado da escrita (só
  leitura, `GET /class-groups`), de `payments` avulso fora do fluxo de
  matrícula, nem de `attendance`/`grades`/`materials`/`certificates`/`campaigns`.
- **Índice único de documento** (`national_id_type` + `national_id`, CLAUDE.md
  §1 "Um documento, uma pessoa, uma ficha"): ainda não existe — só a garantia
  de aplicação no `RegisterStudentUseCase`. `scripts/report-duplicate-students.ts`
  é o passo prévio (lista as duplicatas já na base) antes da migration do
  índice parcial.
- **OCR**: extração não iniciada. O checkout público
  (`SubmitPublicEnrollmentRoute`) grava `payments` com idempotency key e já
  tem upload por signed URL com magic bytes e normalização no worker
  (OOC-19), mais o antifraude nível 0 (OOC-22: nº de operação único por meio
  no submit, triagem por sha256/pHash/EXIF no `receipt-screen` —
  `CLAUDE.md` deste app, "Antifraude do comprovante"). Ainda não enfileira
  extração por IA, não escreve `payment_receipts`.
- **Proteção da rota pública** (OOC-24): real. Toda rota `.public()` declara
  rate limit (o boot cai sem ele), contado no Redis da fila por IP do leitor
  e, no checkout, por hold; o submit passa por cache de idempotência no Redis
  e por Cloudflare Turnstile antes do usecase. Detalhe: `CLAUDE.md` deste
  app, "Proteção da rota pública".
- **Hold de checkout (relógio curto)**: real. `POST /seat-holds` prende a vaga
  com o `UPDATE … WHERE seats_taken < capacity` atômico e grava a linha em
  `seat_holds` com `expires_at` pelo relógio do Postgres (minutos lidos de
  `platform_settings`, editáveis em `PATCH /settings`, com
  `audit_log`). O submit exige `holdId` e **consome** o hold (não incrementa
  a vaga de novo); hold vencido ou desconhecido → 422
  `enrollment.seat_hold_expired`. `POST /seat-holds/:id/release` devolve a
  vaga quando o checkout troca de turma; o `seat-hold-sweep.worker.ts` (a cada
  30 s) expira os vencidos e devolve as vagas numa instrução só. O claim tem
  rate limit por IP, não captcha: um script com muitos IPs ainda consegue
  prender vagas pelo tempo de um hold.
- **Relógio longo (janela de revisão de 5 dias)**: não existe. Nenhum cron
  devolve a vaga de uma matrícula `reserved` cujo pagamento ficou parado.
- **Origem da matrícula**: real. O checkout manda a `source` resolvida na
  chegada junto com o claim do hold; o servidor a guarda no hold e a copia
  para `enrollments.origin` no submit (nunca do body do submit). A matrícula
  manual grava `whatsapp`. Os `utm_*` ainda **não** são gravados — ficam só
  no rascunho do navegador.
- **E-mail transacional**: real. As duas matrículas (checkout público e manual)
  gravam o "matrícula recebida" na tabela `outbox` na mesma transação; o
  `outbox-relay.worker.ts` (a cada 5 s) oferece as linhas `pending` à fila
  `send-email`, e o `send-email.worker.ts` entrega pelo `NotificationProvider`
  de `packages/notifications` (Brevo), sempre atrás da guarda de allowlist
  (`NODE_ENV` ≠ `production` → só `EMAIL_ALLOWLIST`). Sem `BREVO_API_KEY` o
  e-mail é renderizado e só logado. Os templates de aprovado/em revisão/
  rejeitado/credenciais existem e renderizam, mas **nenhum usecase os emite
  ainda** — aprovação, revisão humana e conta do portal não existem (OCR e
  fila de revisão, `docs/ROADMAP.md` Sessões 26+).
- **MFA**: nenhum plugin `twoFactor` do Better Auth configurado — `admin`/`billing`
  não têm segundo fator ainda, apesar de `CLAUDE.md` §8 exigir.
