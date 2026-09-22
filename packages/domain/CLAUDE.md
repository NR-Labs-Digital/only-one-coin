# CLAUDE.md — `packages/domain`

Carregado junto com o `CLAUDE.md` da raiz quando uma sessão trabalha aqui dentro. Este pacote é sibling de `apps/api`, não descendente — quem edita só `packages/domain` **não** vê o `apps/api/CLAUDE.md` automaticamente, por isso a regra de fronteira abaixo mora aqui, na íntegra, e não só referenciada de lá.

---

## Regra de fronteira — DDD puro

Vale pra qualquer bounded context novo (não só `identity`/`enrollment` etc.): `packages/domain` é DDD puro (entidades, usecases, portas de repositório) — **nunca** importa Fastify, provedor de banco ou Redis, só define a **interface** de repositório. A implementação concreta mora na infra de quem consome (`apps/api/src/infra/`).

Detalhe de padrão (`BaseModel`/`BaseUseCase`, `RouteBuilder`, `container.ts`, entrypoints) está em [`packages/domain/README.md`](README.md) e `apps/api/README.md` — não duplicado aqui. Estrutura e dependência entre os pacotes: `docs/ARCHITECTURE.md` §1.

## Exceção documentada à regra acima

O vocabulário de erro HTTP (`src/shared/base/errors/` — `HttpError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `UnableToProcessEntryError`) carrega uma noção de HTTP (`status`) dentro do pacote de domínio. Decisão consciente pra reaproveitar o mesmo vocabulário entre `apps/api` e qualquer bounded context futuro, em vez de duplicar a classe do lado de fora.

**Nada além dessas classes pode importar ou expor tipo de framework** — o resto do pacote continua puro.

---

Regras de negócio, stack e segurança (papéis, RBAC) estão no `CLAUDE.md` da raiz — não duplicadas aqui. Regras de payload/pipeline (pagamento, OCR, vagas) que consomem este pacote estão em `apps/api/CLAUDE.md`.
