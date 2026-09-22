# @ooc/domain

Domínio DDD puro: entidades, regras de negócio e casos de uso. **Sem
Fastify, sem provedor de banco, sem Redis** — não importa nada de `apps/api`
nem de `packages/queue`. Quem depende deste pacote é `apps/api` (e, no
futuro, possivelmente `apps/app`).

Esboço baseado no template `Psykka/template-ddd`, adaptado para viver num
pacote separado (o template original é um único app Fastify). Vai mudar
quando o próximo ajuste do template chegar.

## Estrutura

```
src/
  shared/base/
    BaseModel.ts        # entidade com id + created_at/updated_at
    SoftDeletableModel.ts # + deleted_at, isDeleted, softDelete() — só pra quem pode ser aposentado
    BaseUseCase.ts       # abstract run(input): Promise<output> — equivalente ao "BaseService" do template
    IBaseRepository.ts   # contrato CRU_ (sem D — delete físico não existe, CLAUDE.md §6) + ISoftDeletableRepository
    errors/               # vocabulário de erro HTTP — ver exceção na seção "Regra" abaixo
      HttpError.ts          # base: status (default 500), reason (chave de i18n), path, cause
      UnauthorizedError.ts  # 401
      ForbiddenError.ts     # 403
      NotFoundError.ts      # 404
      UnableToProcessEntryError.ts  # 422 — regra de negócio recusa uma requisição bem formada
  example/                # contexto de exemplo — apagar quando o 1º contexto real (enrollment, payment...) entrar
    Example.ts             # entidade
    ExampleRepository.ts    # só a interface (porta). Implementação concreta mora em apps/api/src/infra
    CreateExampleUseCase.ts  # caso de uso
  identity/                  # autenticação/autorização — porta pura, adapter real (Better Auth) mora em apps/api/src/infra
    Role.ts                    # union fechada dos papéis (docs/ARCHITECTURE.md §3)
    AuthenticatedUser.ts        # shape mínimo lido pelos usecases
    errors.ts                    # NotFreshlyAuthenticatedError, InsufficientPrivilegeError — estendem shared/base/errors
    ports/
      ICurrentSessionPort.ts       # resolve(sessionToken: string) — string opaca, não Headers/FastifyRequest
      IUserRoleRepository.ts        # findRoleByUserId/updateRole — não estende IBaseRepository (role só muda pelo usecase)
      IAuditLogRepository.ts         # só append — sem update/delete no tipo (audit_log é append-only)
      IFreshAuthVerifier.ts           # exigido pela promoção de papel — Better Auth não garante reautenticação fresca sozinho
    PromoteUserRoleUseCase.ts          # único caminho pra mudar o role de alguém
  index.ts                   # barrel
```

Cada bounded context ganha sua própria pasta (entidade + porta de
repositório + usecases juntos), em vez de pastas genéricas por tipo de
arquivo (`entities/`, `value-objects/`...) — é o agrupamento que o template
usa.

## Regra

O pacote de domínio nunca implementa acesso a banco, fila ou HTTP — só
define a **interface** (porta) que a infraestrutura (`apps/api`) precisa
implementar.

**Exceção documentada:** `shared/base/errors/` carrega uma noção de HTTP
(`status`) dentro do pacote — decisão consciente pra reaproveitar o mesmo
vocabulário de erro entre `apps/api` e qualquer bounded context futuro, em
vez de duplicar a classe do lado de fora (`CLAUDE.md` §5). Nada além dessas
classes pode importar ou expor tipo de framework.
