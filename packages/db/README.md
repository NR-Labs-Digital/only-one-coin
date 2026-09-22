# @ooc/db

Schema e migrations do Postgres — mesma `DATABASE_URL` aponta pro Postgres
local (Docker, este pacote) em desenvolvimento e pro Neon em staging/produção,
sem trocar de ferramenta.

## Ferramenta — Drizzle Kit

Schema declarado em TypeScript (`src/schema.ts`) e migration SQL **gerada**
por diff contra esse schema (`drizzle-kit generate`), não escrita à mão.
Escolhido em vez de um migration runner separado (`node-pg-migrate` etc.)
porque o schema-first já resolve migration + (futuramente) tipagem de query
com uma ferramenta só — decisão registrada em `docs/ARCHITECTURE.md` §5.8.

`Drizzle ORM` como client de query em `apps/api` é uma decisão separada,
ainda em aberto — este pacote só cobre schema/migration.

## Estrutura

```
drizzle.config.ts   # dialect postgresql, schema -> migrations, lê DATABASE_URL
src/
  schema.ts          # base schema (uuidPk/timestamps/softDeletable) + tabelas Drizzle — modelo acadêmico, de pessoas, matrícula/pagamento e identidade (12 migrations além da baseline, ver README.md da raiz)
migrations/          # SQL gerado pelo drizzle-kit, versionado no Git
tests/
  privileges.test.ts # emite as operações proibidas direto no Postgres e exige a recusa
  soft-delete.test.ts # confere, nos dois sentidos, em que tabelas deleted_at existe
```

## Uso

Requer `compose.yml` da raiz do monorepo rodando (`pnpm db:up`) e um `.env`
neste pacote (copiar de `.env.example`).

| Comando (raiz) | O que faz |
| --- | --- |
| `pnpm db:up` | sobe o Postgres local (Docker) |
| `pnpm db:down` | derruba o container, mantém o volume |
| `pnpm db:generate` | gera migration nova a partir do diff de `src/schema.ts` |
| `pnpm db:migrate` | aplica as migrations pendentes |
| `pnpm db:reset` | derruba o container **e o volume**, sobe do zero, reaplica todas as migrations |
| `pnpm test:db` | roda `tests/privileges.test.ts` e `tests/soft-delete.test.ts` contra o banco migrado |
| `pnpm test:api:db` | roda os testes de repositório de `apps/api` contra o mesmo banco |

`pnpm test:db` **não** lê o `.env` deste pacote: ele fala com um Postgres de
verdade, então a `DATABASE_URL` vem do ambiente, explícita, pra ninguém rodar
sem querer contra o banco errado (e pra não deixar um `localhost` fixo no
código, `CLAUDE.md` §6):

```
DATABASE_URL=postgres://ooc:ooc@localhost:5432/ooc_dev pnpm test:db
```

## Trava de privilégio (migration `0011`)

`audit_log` é append-only e não existe delete físico de aluno, pagamento,
comprovante ou consentimento (`CLAUDE.md` §6/§8). Desde a `0011` isso é trava
de banco, em duas camadas — detalhe e a regra pra tabela nova em
`CLAUDE.md` deste pacote.

**Passo de ambiente, uma vez por banco, fora do Git.** A migration cria o papel
`ooc_app` sem login (senha é credencial, não entra em migration versionada).
Para a camada de GRANT valer de verdade, o papel precisa ser ligado e a
`DATABASE_URL` do `apps/api` precisa passar a usá-lo:

```sql
ALTER ROLE ooc_app WITH LOGIN PASSWORD '<secret>';
```

— e então `fly secrets set DATABASE_URL=postgres://ooc_app:<secret>@.../<db>`
(staging e produção, cada um com a sua senha). O papel que roda as migrations
continua sendo o dono, que é outro. Enquanto esse passo não acontece, quem
conecta é o dono e só a camada de trigger está segurando.

Migrations são sempre **aditivas** em staging/produção (`CLAUDE.md` §7) — o
`drizzle-kit generate` produzindo um `DROP`/`RENAME` é sinal de que a mudança
precisa virar duas migrations (expand/contract), não uma.
