# Link do Classroom na turma (OOC-98)

Desenho aprovado em 27/10/2026. Pedido do Linear OOC-98 ("Atribuição de
docente + link do Classroom"). Destrava o "enlace da aula" da sessão 42 do
roadmap (portal do aluno, `meetingUrl: null` desde a OOC-32) e o card de
acessos do portal do docente (flag `teacher.class_links`, PR #136).

## Problema

O ticket pede que a atribuição do docente e o cadastro do link do Google
Classroom sejam um processo só, com quatro critérios:

1. não é possível atribuir o docente sem informar o link;
2. após a atribuição, a turma fica ativa;
3. o link fica visível para o docente no portal dele;
4. o link aparece no portal do aluno, na turma correspondente.

Hoje nenhum link existe no backend — nem coluna, nem domínio, nem API. O
portal do aluno já desenha o botão quando houver link; o portal do docente
tem o card atrás de flag, gravando só na tela.

## Decisões (27/10/2026)

1. **Escopo da triagem: só o link.** Os critérios 1 e 2 contradizem regra
   fechada e ficam **em aberto, aguardando o dono**:
   - critério 2 contra a OOC-35 — o status da turma só avança por uma pessoa,
     um passo por vez, nunca como efeito colateral;
   - critério 1 contra a OOC-80 — atribuir docente já funciona sem link, e
     há turmas em produção com docente e sem link.

   Então o link é um campo opcional da turma, no mesmo formulário (e no mesmo
   request) do seletor de docente — o "processo único" do ticket — sem travar
   a atribuição e sem mexer no status.
2. **Um link só: o Classroom da turma.** A coordenação cola; docente e aluno
   veem o mesmo. O Meet vive dentro do Classroom. Saem do mock do PR #136 o
   `meetUrl` e o `studentClassroomUrl` (o Classroom "para os alunos" que o
   docente publicaria).
3. **Aluno só vê com vaga confirmada.** A API devolve o link apenas para a
   matrícula com vaga `confirmed`; reservada ou devolvida recebe `null` no
   próprio JSON. Coerente com a OOC-55 (matrícula só existe depois do dinheiro
   confirmado). A decisão vive na API, não na tela.

Decorrentes do desenho, aprovadas junto:

- **Coluna na própria turma** (`class_groups.classroom_url`). O link é 1:1 com
  a turma; uma tabela à parte não compraria nada.
- **Link válido = `https:` em `classroom.google.com`**, a mesma regra que
  `parseClassLink(…, 'classroom')` já aplica no app — as duas pontas não podem
  divergir (mesmo princípio da OOC-94).
- **Duplicar período zera o link**, como datas, janela e vagas: turma nova
  costuma ter Classroom novo, e copiar mandaria o aluno novo para a sala
  antiga.
- **Avisa, não trava:** a lista de turmas ganha o selo *Sin Classroom* nas
  turmas `enrolling`/`in_progress` sem link, no padrão do destaque de turma
  sem docente.
- **`teacher.class_links` passa a `production: true`**: o que a flag mostra
  passa a ser real.

## Fora do escopo

- Link obrigatório ao atribuir docente e status automático (decisão 1).
- Meet separado e link publicado pelo docente (decisão 2).
- Material do módulo por turma — qual módulo a turma ensina é OOC-85/OOC-100.
- Histórico de links: trocar substitui; o `audit_log` guarda que o campo
  mudou, nunca o valor (CLAUDE.md §8).

## Dado

Migration `0038`:

```sql
ALTER TABLE class_groups ADD COLUMN classroom_url text;
```

- Aditiva, nula: `null` = ninguém colou ainda. Sem CHECK de host no banco — a
  regra vive no domínio, como o material do módulo (`0037`).

## Domínio (`packages/domain/src/catalog/`)

- `ClassroomUrlSchema`, em `ClassGroup.ts`: trim; vazio vira `null`; aceita só
  `https:` com host `classroom.google.com` e devolve a URL normalizada
  (`new URL(...).toString()`); recusa o resto (inclusive `javascript:` e host
  parecido).
- `ClassGroup.classroomUrl: string | null`. O schema de props carrega
  `string | null` sem validar host — linha lida nunca lança.
- `ClassGroup.create` e `ClassGroup.update(patch)` validam o link quando ele
  vem no input/patch. Patch sem `classroomUrl` não olha o campo.
- Duplicação de período (`ClassGroup` de duplicação / `DuplicateClassGroupsUseCase`)
  cria a cópia com `classroomUrl: null`.

## API (`apps/api`)

**Escrita** — sem rota nova:

- `POST /class-groups` e `PATCH /class-groups/:id` aceitam `classroomUrl`
  (`string | null`, opcional). Mesmos papéis de hoje (`master`, `admin`,
  `enrollment_supervisor`); link inválido → 422 com o código de erro do
  domínio, traduzido no app.
- `audit_log` do update entra com `classroomUrl` na lista `fields` quando muda,
  nunca o valor.
- `GET /class-groups` e `GET /class-groups/:id` devolvem `classroomUrl`.

**Leitura do docente** — `/teaching/*` (turma, lista e agenda) devolve
`classroomUrl` dentro do escopo já checado no usecase (`teachingScope.ts`):
nada muda no acesso, só entra o campo no `TeachingReader`.

**Leitura do aluno** — `GET /portal/overview` (`StudentPortalQuery`) devolve
`classGroup.classroomUrl`, **e só quando `enrollments.seat_status =
'confirmed'`**; nos outros casos o campo sai `null`. A regra fica no SQL/no
mapeamento da query, nunca no app.

## App (`apps/app`)

**Backoffice — turmas**

- `class-group-form.tsx`: campo *Link del Classroom* logo abaixo do seletor de
  docente, opcional, validado com `parseClassLink(…, 'classroom')` antes do
  envio (o mesmo erro inline do card do docente). Entra em `patch` só quando
  muda, no `POST` sempre.
- `class-group-table.tsx`: selo *Sin Classroom* para `enrolling`/`in_progress`
  sem link.
- Tipos: `ClassGroupRow.classroomUrl` passa a vir da API; `meetUrl` e
  `studentClassroomUrl` saem.

**Portal do docente**

- `class-resources.tsx`: o card fica com a porta do **Classroom** (real) e a
  do **material**, esta só desenhada quando houver link (OOC-100 traz o dado).
  Sai o bloco "para os alunos" e o aviso de "salvo só nesta tela".
- `class-links.tsx`: sai o botão do Meet.
- Agenda (`teacher-agenda.tsx`) usa o `classroomUrl` real da turma.
- `teacher.class_links` → `production: true` em `feature-flags/registry.ts`.
- i18n: saem as chaves do Meet e do "publicar para os alunos" nos três
  locales; entram as do campo, do erro e do selo no backoffice (es-PE, pt-BR,
  en).

**Portal do aluno**

- `meetingUrl` vira `classroomUrl` em `lib/portal/types.ts`; `toEnrollment`
  lê o campo da API em vez do `null` fixo. Os botões que já existem
  (`portal/page.tsx`, `portal/courses/[enrollmentId]/page.tsx`) passam a ter
  link.

## Testes

- Domínio: `ClassroomUrlSchema` (válido normalizado, vazio → `null`, host
  errado, `http:`, `javascript:`, host parecido); `update` recusa link
  inválido e aceita `null`; duplicação zera o link.
- API, integração no Postgres:
  - `StudentPortalQuery`: vaga `reserved` e `released` → `null`; `confirmed` →
    o link.
  - `Teaching.integration.test.ts`: o docente lê o link da própria turma; a
    turma do docente B continua 404 para o A.
  - Rota de update: grava, devolve, e o `audit_log` leva `classroomUrl` em
    `fields` sem o valor.
- Autorização: o teste de papel do `PATCH` já existe; nada novo.
- App: `parseClassLink` já coberto; ajustar os testes que montam
  `ClassGroupRow` e o overview do portal.

## Documentação (mesmo PR)

- `CLAUDE.md` raiz §1: o link do Classroom na regra da turma, com os dois
  critérios em aberto.
- `docs/ROADMAP.md`: sessões 36 e 42 e o resumo.
- `apps/app/README.md`: estado por tela (turmas, portal do docente, portal do
  aluno).
- `docs/ARCHITECTURE.md`: a linha da flag `teacher.class_links`.
- Linear OOC-98: comentário com o que entrou e o que ficou aguardando o dono.
