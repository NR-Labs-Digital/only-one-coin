# apps/app

Next.js App Router — portal do aluno e backoffice administrativo no mesmo
deploy (`CLAUDE.md` §8, "Pontos de entrada separados"): duas telas de login,
um único processo. Nunca fala direto com o Postgres — toda leitura/escrita
passa por `apps/api` via `fetch` (`src/lib/backoffice/api-client.ts`).

Regras e convenções deste app (layout responsivo, regras de celular, feature
flags, RBAC na UI) estão em [`CLAUDE.md`](CLAUDE.md), não aqui — este arquivo
é só "o que é e como roda" e o estado de cada tela (abaixo).

## Rodar local

```bash
pnpm dev:web   # sobe apps/landing + apps/app (na raiz do monorepo)
```

As telas marcadas como reais na tabela abaixo chamam `apps/api` — para elas
funcionarem, suba também `pnpm db:up` + `pnpm dev:api`. As mock funcionam sem
API no ar.

| Comando | O que faz |
| --- | --- |
| `pnpm --filter @ooc/app dev` | só este app, em `localhost:3000` |
| `pnpm --filter @ooc/app build` | build de produção (o que a Vercel roda) |
| `pnpm --filter @ooc/app typecheck` | `tsc --noEmit` |
| `pnpm --filter @ooc/app lint` | `next lint` |

## Estado por tela (07/10/2026)

O que já fala com `apps/api` e o que ainda é mock. Atualize a linha no mesmo PR
que muda a tela.

| Tela | Estado |
| --- | --- |
| Checkout público (`/enrollment`) | **Real**: hold de vaga, verificação do Gmail do aluno por código de 6 dígitos, upload por URL assinada, Turnstile, submit |
| Login do aluno (`/login`, `/forgot-password`, `/access/[token]`) | **Real**: e-mail ou documento, definir/recuperar senha por link |
| Portal do aluno (`/portal/*`) | **Real** (OOC-32): sessão (`GET /portal/me`) e dados (`GET /portal/overview`) — ficha, apoderado, matrículas, pagamentos, próxima aula, comprovante por URL assinada. Sem backend ainda, chegam vazios: módulos/mensalidade/cadeado, documentos, trâmites pagos, avisos, ofertas de continuação. Perfil só leitura |
| Login, convite e senha do staff | **Real** (Better Auth), com MFA por código de e-mail (OOC-29): desafio no login, código de recuperação, ativação obrigatória para `master`/`admin`/`billing` |
| Alunos (`/backoffice/students`) | **Real**: diretório com busca/filtros no servidor, abre em Ativos (matrícula vigente), com abas Ativos · Ex-alunos · Sem matrícula · Todos e contador (OOC-116), cadastro, ficha com matrículas, edição de aluno e apoderado, aba Atividade. Faltam documentos emitidos e trâmites (OOC-33), suspensão e exportação |
| Matrículas (`/backoffice/enrollments`) | **Real**: só vaga confirmada; abre em Vigentes (turma em inscrição ou em andamento), com abas Vigentes · Encerradas · Todas e contador do servidor (OOC-115); abertura manual manda pra Pagos |
| Pagos e fila de revisão (`/backoffice/payments*`) | **Real**: livro (abre em Abertos; abas Abertos · Resolvidos · Todos com contador, Resolvidos por data de decisão — OOC-114), fila, comprovante por URL assinada, leitura da IA, semáforo, aprovar/rejeitar (cria a conta do portal). Faltam lote, ordenação por confiança e atalhos |
| Cursos (`/backoffice/courses`) | **Real**: CRUD, aposentar/reativar, planos com preço agendado, página da landing ligada ao curso e aviso das páginas sem curso (OOC-117). Nuevo curso sem "Sobre el curso" e com idioma em texto livre (OOC-106, OOC-107) |
| Turmas (`/backoffice/class-groups`) | **Real**: períodos (o seletor do topo é filtro — *período de matrícula*, a campanha de vendas, não a data das aulas —; o form de nova turma cria o período ali mesmo, OOC-104), filtro por mês de *início das aulas* ao lado de idioma/estado (OOC-93), duplicar, ciclo de vida, lista de espera manual, docente escolhido do cadastro com aviso de horário e turmas sem docente destacadas (OOC-80), e a lista de matriculados na página da turma (OOC-71: vaga confirmada + status do pagamento; documento, contato e link da ficha só para `master`/`admin`/`enrollment_supervisor`). Visão do docente (com o roster dela), notas e certificados são mock |
| Docentes (`/backoffice/teachers`) | **Real** (OOC-78): diretório com abas, busca e filtros no servidor; cadastro, edição de dados, disponibilidade e saída/volta ao quadro gravando na API. Contrato só é lido — upload e download são o OOC-81. O docente lendo a própria ficha espera o vínculo da conta (OOC-79) |
| Equipe (`/backoffice/team`) | **Real**: contas, convite, troca de cargo com bitácora (histórico de cargos sob a lista, lido do `audit_log` — OOC-69). Convite de docente sai como qualquer cargo, ainda sem vínculo com a ficha em Docentes — é o OOC-79 |
| Funcionalidades (`/backoffice/features`) | **Real** |
| Conta (`/backoffice/account`) | **Real**: troca da própria senha e verificação em dois passos (ativar, gerar códigos de recuperação, desativar onde é opcional). Sessões são mock |
| Configuração (`/backoffice/settings`) | Parcial: reais só a reserva durante o pagamento, a tolerância de valor e o limite de rejeição do comprovante — OOC-41 |
| Home do backoffice | **Real** (OOC-67): KPIs, prévia da fila, vagas sob pressão e badge de Pagos, cada bloco só para o cargo que a API serve. A home do docente segue mock |
| E-mails (`/backoffice/emails*`) | Mock — OOC-42, OOC-88 |
| Relatórios (`/backoffice/reports`) | Mock — OOC-40 |

O papel `teacher` ainda entra pela ponte de demonstração em `getStaffSession()`
(`DEMO_TEACHER_ID`), que morre com OOC-79.

## Estrutura

```
src/
  app/          # rotas do App Router — [locale]/portal/*, [locale]/backoffice/*, [locale]/login, [locale]/enrollment
  components/   # componentes de UI (shadcn/ui sobre Tailwind v4) e de layout (AutoGrid, TableShell...)
  lib/          # clientes de API, permissões (backoffice/permissions.ts), feature flags, dados mock
  hooks/        # hooks de cliente
  i18n/         # roteamento e mensagens trilíngues (es-PE padrão, pt-BR, en)
  messages/     # arquivos de tradução — es-PE.json / pt-BR.json / en.json
```

`src/lib/*/mock-data.ts` é onde vive o dado mockado de cada área — trocar por
chamada real não deve exigir tocar em nenhum componente que já lê de lá
(mesmo contrato de dados).
