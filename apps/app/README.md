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

## Estado por tela (23/10/2026)

O que já fala com `apps/api` e o que ainda é mock. Atualize a linha no mesmo PR
que muda a tela.

| Tela | Estado |
| --- | --- |
| Checkout público (`/enrollment`) | **Real**: hold de vaga, verificação do Gmail do aluno por código de 6 dígitos, upload por URL assinada, Turnstile, submit |
| Login do aluno (`/login`, `/forgot-password`, `/access/[token]`) | **Real**: e-mail ou documento, definir/recuperar senha por link |
| Portal do aluno (`/portal/*`) | **Real** (OOC-32): sessão (`GET /portal/me`) e dados (`GET /portal/overview`) — ficha, apoderado, matrículas, pagamentos, próxima aula, comprovante por URL assinada. Sem backend ainda, chegam vazios: módulos/mensalidade/cadeado, documentos, trâmites pagos, avisos, ofertas de continuação. Perfil só leitura |
| Login, convite e senha do staff | **Real** (Better Auth), com MFA por código de e-mail (OOC-29): desafio no login, código de recuperação, ativação obrigatória para `master`/`admin`/`billing` |
| Alunos (`/backoffice/students`) | **Real**: diretório com busca/filtros no servidor, abre em Ativos (matrícula vigente), com abas Ativos · Ex-alunos · Sem matrícula · Todos e contador (OOC-116), cadastro, ficha com matrículas, edição de aluno e apoderado, aba Atividade, exportação em CSV do que a tela filtra (OOC-121). Faltam documentos emitidos e trâmites (OOC-33) e suspensão |
| Matrículas (`/backoffice/enrollments`) | **Real**: só vaga confirmada; abre em Vigentes (turma em inscrição ou em andamento), com abas Vigentes · Encerradas · Todas e contador do servidor (OOC-115); abertura manual manda pra Pagos |
| Pagos e fila de revisão (`/backoffice/payments*`) | **Real**: livro (abre em Abertos; abas Abertos · Resolvidos · Todos com contador, Resolvidos por data de decisão — OOC-114), fila por prioridade (ou por chegada), comprovante por URL assinada e ampliado, leitura da IA, semáforo, aprovar/rejeitar (cria a conta do portal), "Ler de novo" e atalhos de teclado com legenda — OOC-120. Falta o lote (Sessão 33) |
| Cursos (`/backoffice/courses`) | **Real**: CRUD, aposentar/reativar, planos com preço agendado, página da landing ligada ao curso e aviso das páginas sem curso (OOC-117). Nuevo curso sem "Sobre el curso" e com idioma em texto livre (OOC-106, OOC-107) |
| Turmas (`/backoffice/class-groups`) | **Real**: períodos (o seletor do topo é filtro — *período de matrícula*, a campanha de vendas, não a data das aulas —; o form de nova turma cria o período ali mesmo, OOC-104), filtro por mês de *início das aulas* ao lado de idioma/estado (OOC-93), duplicar, ciclo de vida, lista de espera manual, docente escolhido do cadastro com aviso de horário e turmas sem docente destacadas (OOC-80), e a lista de matriculados na página da turma (OOC-71: vaga confirmada + status do pagamento; documento, contato e link da ficha só para `master`/`admin`/`enrollment_supervisor`). A visão do docente saiu daqui para o portal `/docente` (abaixo) |
| Docentes (`/backoffice/teachers`) | **Real** (OOC-78): diretório com abas, busca e filtros no servidor; cadastro, edição de dados, disponibilidade e saída/volta ao quadro gravando na API. Contrato real (OOC-81): arquivar PDF com o período pela ficha (`master`/`admin`/`academic_supervisor`), baixar o vigente e os anteriores (também o `analyst`), selo e filtro com o prazo da configuração. *Generar contrato* (quem edita a ficha) pede o período e baixa o PDF preenchido a partir do modelo publicado, sem guardar nada (OOC-123). O docente lê a própria ficha (só leitura) em `/docente/profile`, sem o contrato, pelo vínculo da conta (OOC-79) |
| Equipe (`/backoffice/team`) | **Real**: contas, convite, troca de cargo com bitácora (histórico de cargos sob a lista, lido do `audit_log` — OOC-69). Convite de docente escolhe a ficha em Docentes e liga a conta a ela ao ser aceito; conta de docente sem ficha aparece como achado; o cargo `teacher` não troca por aqui (OOC-79) |
| Funcionalidades (`/backoffice/features`) | **Real**: mostra o que os demais veem; a conta dos donos vê no backoffice e no docente o que está desligado, com tarja e item de menu marcado (OOC-61) |
| Conta (`/backoffice/account`, `/docente/account`) | **Real**: troca da própria senha e verificação em dois passos (ativar, gerar códigos de recuperação, desativar onde é opcional) — a mesma tela nas duas portas. Sessões são mock |
| Auditoria (`/backoffice/audit`) | **Real** (OOC-122): bitácora geral lida do `audit_log`, filtros na URL (período, autor, ação, entidade) aplicados no servidor, "ver anteriores" por cursor, texto da ação pelo locale, link para aluno/turma/docente/Pagos quando o registro existe e o cargo abre a tela, campos alterados sem valores, exportação CSV (registrada no próprio log). `master`/`admin`/`analyst` |
| Configuração (`/backoffice/settings`) | **Real** (OOC-41): os nove parâmetros leem `GET /settings` e salvam num `PATCH` só, com `audit_log` por campo; API fora do ar mostra erro, nunca número inventado. Notas, certificados, constancia, contratos e a fila de Pagos leem daí. Aba **Documentos** (`/backoffice/settings/documents`, OOC-123): editor visual do contrato do docente (TipTap — dados entram como etiquetas escolhidas numa lista, sem HTML nem Liquid na tela), preview do PDF real ao lado (pdf.js, refeito ~1 s depois de parar de digitar; no celular, abas Editar/Vista previa), salvar rascunho e publicar com confirmação |
| Home do backoffice | **Real** (OOC-67): KPIs, prévia da fila, vagas sob pressão e badge de Pagos, cada bloco só para o cargo que a API serve |
| E-mails (`/backoffice/emails*`) | Mock — OOC-42, OOC-88 |
| Relatórios (`/backoffice/reports`) | Mock — OOC-40 |
| Portal do docente — login e shell (`/docente`) | **Real**: login próprio (mesmo Better Auth e mesmos passos de MFA), porta decidida pelo cargo no servidor (`getTeacherSession`), flag `teacher` |
| Portal do docente — ficha (`/docente/profile`) | **Real** (OOC-79): `GET /teachers/:id` com o `teacherId` da sessão, só leitura |
| Portal do docente — home (`/docente/home`) | **Real** (OOC-82): `GET /teaching/summary` (turmas em inscrição ou em andamento, alunos confirmados nelas) e a tabela das turmas; sem turma, "No tienes cursos activos" (OOC-101). Notas e certificados pendentes entram quando existirem (OOC-38, OOC-33) |
| Portal do docente — minhas turmas e turma (`/docente/class-groups`, `/docente/class-groups/[id]`) | **Real** (OOC-82): lista por idioma (sem turma, "No tienes cursos activos", OOC-101) e a turma no próprio endereço — dados, semana, datas, vagas e os alunos (só nome), tudo de `/teaching/*`, escopo checado no usecase; turma de outro docente, fechada ou rascunho é 404. Atrás de flag, desligada em produção e gravando **só na tela**: ficha de notas, observações e relatório CSV (`teacher.grades`, OOC-38/OOC-102), acessos da turma (`teacher.class_links`, OOC-98/OOC-100/OOC-94) e avisos (`teacher.notices`). A emissão de certificados do PR #136 saiu do portal (precisava de pagamento e conclusão, que o docente não recebe) — fica para a OOC-33 |
| Portal do docente — agenda (`/docente/agenda`) | **Real** (OOC-82), atrás de `teacher.agenda` (`production: false`) — semana e mês a partir dos horários reais das turmas, cada aula com a duração do horário; sem turma, o mesmo "No tienes cursos activos" da home em vez do calendário vazio (OOC-101) |

O papel `teacher` entra com o `teacherId` real que o `/me` devolve (OOC-79). Conta `teacher`
sem ficha vê o portal vazio — a API não lhe atribui turma nenhuma.

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
