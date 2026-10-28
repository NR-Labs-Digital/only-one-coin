# CLAUDE.md — `packages/domain`

Carregado junto com o `CLAUDE.md` da raiz quando uma sessão trabalha aqui dentro. Este pacote é sibling de `apps/api`, não descendente — quem edita só `packages/domain` **não** vê o `apps/api/CLAUDE.md` automaticamente, por isso a regra de fronteira abaixo mora aqui, na íntegra, e não só referenciada de lá.

---

## Regra de fronteira — DDD puro

Vale pra qualquer bounded context novo (não só `identity`/`enrollment` etc.): `packages/domain` é DDD puro (entidades, usecases, portas de repositório) — **nunca** importa Fastify, provedor de banco ou Redis, só define a **interface** de repositório. A implementação concreta mora na infra de quem consome (`apps/api/src/infra/`).

Detalhe de padrão (`BaseModel`/`BaseUseCase`, `RouteBuilder`, `container.ts`, entrypoints) está em [`packages/domain/README.md`](README.md) e `apps/api/README.md` — não duplicado aqui. Estrutura e dependência entre os pacotes: `docs/ARCHITECTURE.md` §1.

## Aposentar é marcar, nunca apagar

Entidade cuja linha pode ser aposentada estende **`SoftDeletableModel`** (`deletedAt`, `isDeleted`, `softDelete()`); entidade append-only estende **`BaseModel`** e fica sem `softDelete()` — de propósito. A separação não é estilo: a migration `0011` faz o Postgres **recusar** DELETE em `payments`, `payment_receipts`, `consents` e `audit_log`, e um método que o banco responde com exceção não é contrato, é armadilha pra quem implementar a porta depois. Pelo mesmo motivo `IBaseRepository` não tem `delete(id)`, e quem precisa dele usa `ISoftDeletableRepository`.

Hoje estendem `SoftDeletableModel`: `Student`, `Guardian`, `Enrollment`, `Teacher` e as entidades do catálogo (`AcademicPeriod`, `Course`, `Plan`, `ClassGroup`, `Language`). `Payment` não — `status` já diz que um pagamento não vale. A lista de tabelas correspondente está em `packages/db/CLAUDE.md`.

## Exceção documentada à regra acima

O vocabulário de erro HTTP (`src/shared/base/errors/` — `HttpError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `UnableToProcessEntryError`, `InvalidFieldsError`) carrega uma noção de HTTP (`status`) dentro do pacote de domínio. Decisão consciente pra reaproveitar o mesmo vocabulário entre `apps/api` e qualquer bounded context futuro, em vez de duplicar a classe do lado de fora.

**Nada além dessas classes pode importar ou expor tipo de framework** — o resto do pacote continua puro.

## `src/student/fields.ts` e `src/catalog/landingCourseKeys.ts` — os arquivos que o navegador importa

As regras de campo da ficha (normalização, formato do documento por tipo, celular, Gmail do aluno no checkout, faixa de idade, limites de tamanho, códigos de erro) vivem **uma vez só**, aqui, e são lidas pela API (via `CreateStudentSchema`/`GuardianFieldsSchema`) e pelo `apps/app` (via o subpath `@ooc/domain/fields`, OOC-64). Esse subpath aponta pro `.ts` cru, compilado pelo Next — então o arquivo tem que continuar **autocontido: só `zod`, nenhum import relativo**. Regra que precisa de mais que isso vai na entidade, não aqui.

`src/catalog/landingCourseKeys.ts` (subpath `@ooc/domain/landing-course-keys`, OOC-117) é o segundo, pela mesma regra e mais apertada: **sem dependência nenhuma**, nem `zod` — além do Next, é importado pelo build do Astro (`apps/landing`). É a lista de páginas da landing que vendem curso; o `Course` a valida com `z.enum` do lado de cá.

`src/identity/auditCatalog.ts` (subpath `@ooc/domain/audit-catalog`, OOC-122) é o terceiro, mesma regra do anterior — sem dependência e sem import relativo: o vocabulário da bitácora geral (ação gravada → chave de tela, entidade e onde a entrada guarda o id do registro; nomes de campo → chave de rótulo). As colunas de `platform_settings` estão repetidas ali como lista literal, e o teste do catálogo em `apps/api` as amarra a `PLATFORM_SETTING_COLUMNS`.

Dois schemas por entidade, de propósito: `StudentPropsSchema`/`GuardianPropsSchema` são o que **carrega** do banco (frouxo — linha antiga e import legado ainda precisam abrir); `CreateStudentSchema`/`CreateGuardianSchema` são o que um registro **novo** precisa cumprir (normaliza, depois checa). `create()` recusa com `InvalidFieldsError` — campo + código, nunca frase.

---

Regras de negócio, stack e segurança (papéis, RBAC) estão no `CLAUDE.md` da raiz — não duplicadas aqui. Regras de payload/pipeline (pagamento, OCR, vagas) que consomem este pacote estão em `apps/api/CLAUDE.md`.
