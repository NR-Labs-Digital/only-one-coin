# CLAUDE.md — `packages/db`

Carregado junto com o `CLAUDE.md` da raiz quando uma sessão trabalha aqui dentro (schema, migrations, seed).

---

## Migrations

- **Sempre aditivas.** Renomear/apagar coluna ou tabela é em duas etapas (expand/contract), separadas por semanas — nunca uma migration só.
- **Nunca editar uma migration depois que ela mergeou.** Corrigir é outra migration. Isso vale mesmo que a anterior descreva algo que já não é mais verdade (papéis antigos, coluna que sumiu) — migration é histórico, não estado atual.
- Migration em produção **sempre depois de backup** (`pg_dump` → Tigris, `docs/ARCHITECTURE.md` §5.8).
- `db reset` roda do zero e reaplica todas as migrations — se não rodar limpo, a migration está errada, não o script.
- Staging nunca recebe dado real; seed é sempre anonimizado.

## Convenções de schema

- **Toda tabela começa pelo base schema** (topo de `src/schema.ts`): `uuidPk()`, `timestamps()` (`created_at` + `updated_at`) e `softDeletable()` (os dois mais `deleted_at`). Espalhar `...softDeletable()` **é** a declaração de que a linha pode ser aposentada; `createdAt: createdAt()` sozinho declara tabela append-only. Nenhuma tabela redeclara essas colunas na mão.
  - Cada helper é **função**, nunca constante compartilhada — um column builder do Drizzle carrega o estado da coluna que está construindo, e a mesma instância em duas tabelas as faz compartilhar a coluna.
  - Mora dentro de `src/schema.ts`, não num módulo à parte: o `drizzle-kit` carrega esse arquivo por `require` CJS, que não segue um especificador NodeNext `.js` até o `.ts` — arquivo separado quebra o `db:generate`.
  - O espelho no domínio é `BaseModel` / `SoftDeletableModel` (`packages/domain/src/shared/base/`).
- **`deleted_at` existe em sete tabelas e é uma decisão, não gosto:** `students`, `guardians`, `enrollments`, `academic_periods`, `courses`, `plans`, `class_groups`. Fora, de propósito: `plan_prices`, `consents` e `audit_log` são append-only (§5 preço versionado, §1 consentimento da Ley 29733, §8 trilha de auditoria) — um `deleted_at` ali seria um jeito de esconder o que a plataforma promete guardar. `payments` e `payment_receipts` também ficaram fora: `payments.status` já diz que um pagamento não vale, e a `0011` proíbe o delete de qualquer jeito. O conjunto exato é asserido nos dois sentidos por `tests/soft-delete.test.ts`.
- **`amount_cents INTEGER`.** Nunca float, nunca `numeric` de ponto flutuante, em qualquer coluna de dinheiro.
- **`timestamptz` sempre.** UTC no banco; `America/Lima` só na renderização (`apps/app`/`apps/landing`).
- **Sem grant de `DELETE`** em `students`, `payments`, `payment_receipts`, `consents` e `audit_log` — exclusão é sempre `deleted_at`. `audit_log` também não tem grant de `UPDATE`, nem para admin. Desde a migration `0011` isso é **trava de banco em duas camadas**, não convenção:
  - **GRANT** — o papel de aplicação `ooc_app` (criado pela `0011`, dono de nada) recebe `SELECT/INSERT/UPDATE/DELETE` em tudo e perde as quatro operações acima. Pega quem entra pela credencial do `apps/api`.
  - **TRIGGER** — `forbid_history_rewrite()` em trigger `FOR EACH STATEMENT` (`BEFORE DELETE OR TRUNCATE`, mais `UPDATE` no `audit_log`) levanta o SQLSTATE `OOC01`. Pega quem entra pela credencial do **dono** das tabelas — que é o que a `DATABASE_URL` ainda carrega hoje, e por isso a camada que de fato está segurando.
  - **Tabela nova que entra na trava leva as duas** — `REVOKE` e trigger, nunca só uma. Privilégio default (`ALTER DEFAULT PRIVILEGES`) dá `DELETE` a toda tabela futura de propósito: o normal é poder apagar, a trava é a exceção e exceção se escreve.
  - **Levantar a trava é migration** — não há flag de sessão que desligue o trigger, senão a chave estaria na mão de quem ele existe pra barrar.
  - Coberto por `tests/privileges.test.ts`, que emite cada operação proibida direto no Postgres e exige a recusa (`pnpm test:db`, roda no job `migrations` do CI).
- **`ooc_app` nasce `NOLOGIN`** — senha é credencial e não entra em migration versionada. Cada ambiente liga o papel uma vez, fora do Git (`ALTER ROLE ooc_app WITH LOGIN PASSWORD '<secret>'`), e só então a `DATABASE_URL` do `apps/api` passa a apontar pra ele em vez do dono. Enquanto esse passo não for dado, a camada GRANT está inerte e só o trigger segura.
- Preço é **versionado, nunca editado**: `plan_prices` ganha uma linha nova por vigência, a linha antiga não muda. `enrollments` congela o `plan_price_id` vigente no momento da matrícula.
- Índice único por `idempotency_key` em `payments` e por `image_phash` em `payment_receipts` — a aplicação não é a única linha de defesa contra duplicata.
- `CHECK (seats_taken <= capacity)` em `class_groups` é rede, não o mecanismo — a alocação atômica é regra de `apps/api` (`apps/api/CLAUDE.md`).

---

Regras de negócio e o resto da arquitetura estão no `CLAUDE.md` da raiz — não duplicadas aqui.
