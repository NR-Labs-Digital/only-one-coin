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

- **`amount_cents INTEGER`.** Nunca float, nunca `numeric` de ponto flutuante, em qualquer coluna de dinheiro.
- **`timestamptz` sempre.** UTC no banco; `America/Lima` só na renderização (`apps/app`/`apps/landing`).
- **Sem grant de `DELETE`** em `student`, `payment`, `audit_log` — exclusão é sempre `deleted_at`. `audit_log` também não tem grant de `UPDATE`, nem para admin.
- Preço é **versionado, nunca editado**: `plan_prices` ganha uma linha nova por vigência, a linha antiga não muda. `enrollments` congela o `plan_price_id` vigente no momento da matrícula.
- Índice único por `idempotency_key` em `payments` e por `image_phash` em `payment_receipts` — a aplicação não é a única linha de defesa contra duplicata.
- `CHECK (seats_taken <= capacity)` em `class_groups` é rede, não o mecanismo — a alocação atômica é regra de `apps/api` (`apps/api/CLAUDE.md`).

---

Regras de negócio e o resto da arquitetura estão no `CLAUDE.md` da raiz — não duplicadas aqui.
