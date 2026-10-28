# Link do Classroom na turma — plano de implementação (OOC-98)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A turma guarda um link do Google Classroom, colado pela coordenação no formulário da turma, lido pelo docente no portal dele e pelo aluno com vaga confirmada.

**Architecture:** Coluna nula `class_groups.classroom_url`; a regra do link (só `https://classroom.google.com`) vive no domínio do catálogo e é espelhada pelo `parseClassLink` do app. A API grava pelo `POST`/`PATCH` já existentes da turma e devolve o campo no catálogo, em `/teaching/*` e em `/portal/overview` (este só para vaga `confirmed`). O app ganha o campo no formulário, o selo *Sin Classroom* na lista, e liga o card do docente e o botão do portal do aluno ao dado real.

**Tech Stack:** Drizzle (Postgres), zod, Fastify (`RouteBuilder`), Vitest, Next.js App Router + next-intl.

**Spec:** `docs/superpowers/specs/2026-10-27-class-group-classroom-link-design.md`

## Global Constraints

- Código, commits, branch e comentários em inglês; conversa e docs internas em português (CLAUDE.md §4, §9).
- Zero string de UI em `.ts`/`.tsx`; toda chave nova nos três locales `es-PE`/`pt-BR`/`en` (`apps/app/src/messages/backoffice/*.json`), mesma estrutura.
- Link válido = protocolo `https:` e host exatamente `classroom.google.com`; normalizado por `new URL(raw.trim()).toString()`; string vazia/só espaço = `null`.
- Migration aditiva, gerada pelo Drizzle Kit (`pnpm --filter @ooc/db db:generate`), número `0038`.
- `audit_log` grava só o nome do campo (`classroomUrl`), nunca o valor (CLAUDE.md §8).
- Erro do link: `ClassroomUrlInvalidError`, reason `catalog.classroom_url_invalid`, 422.
- Commits convencionais com sufixo `(OOC-98)` e o trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Link colado com espaço em volta ou host em maiúsculas (`  https://CLASSROOM.google.com/c/x `) → gravado normalizado, não recusado. Teste no Task 1.
2. Campo esvaziado na edição (o usuário apaga o link) → o `PATCH` manda `null` e o link sai; não pode virar "não mudou". Teste no Task 1 (domínio) e no Task 4 (o form manda `null`).
3. Aluno com duas matrículas na mesma turma — uma `released`, outra `confirmed` → só a confirmada carrega o link. Teste no Task 3.
4. Link gravado antes por alguém e lido de volta com host que hoje seria inválido (linha antiga/manual) → leitura não lança; o app re-checa antes de virar `href` (`parseClassLink`). Teste no Task 1 (props aceitam qualquer string).
5. Duplicar período de turma que tem link → cópia sem link. Teste no Task 1.

---

### Task 1: Banco + domínio da turma

**Files:**
- Modify: `packages/db/src/schema.ts` (tabela `classGroups`, depois de `teacherId`)
- Create (gerado): `packages/db/migrations/0038_*.sql`, `packages/db/migrations/meta/0038_snapshot.json`, `_journal.json`
- Modify: `packages/db/CLAUDE.md` (a lista de migrations, se ela registra cada uma — seguir o que a OOC-94 fez para a `0037`)
- Modify: `packages/domain/src/catalog/ClassGroup.ts`
- Modify: `packages/domain/src/catalog/errors.ts`
- Modify: `packages/domain/src/index.ts` (exportar o erro, `CLASSROOM_HOST`, `normalizeClassroomUrl`)
- Modify: `packages/domain/src/identity/auditCatalog.ts` (`AUDIT_FIELDS.classroomUrl = "classroom_url"`)
- Test: `apps/api/src/tests/catalog-class-group.test.ts`

**Interfaces:**
- Produces:
  - coluna Drizzle `classGroups.classroomUrl: text("classroom_url")` (nula)
  - `export const CLASSROOM_HOST = "classroom.google.com"`
  - `export function normalizeClassroomUrl(raw: string | null): string | null` — `null`/vazio → `null`; inválido → lança `ClassroomUrlInvalidError`
  - `ClassGroupPropsSchema.classroomUrl: z.string().nullable()` (sem checar host — linha lida nunca lança)
  - `CreateClassGroupSchema.classroomUrl: z.string().nullable().optional()` (e portanto `UpdateClassGroupSchema`)
  - `ClassGroup.classroomUrl: string | null`; `update()` devolve `"classroomUrl"` em `changed` quando muda
  - `ClassroomUrlInvalidError extends UnableToProcessEntryError`, reason `catalog.classroom_url_invalid`

- [ ] **Step 1: Write the failing tests** em `catalog-class-group.test.ts`, novo `describe("classroom link (OOC-98)")`:

```ts
it("stores the link normalized", () => {
  const group = ClassGroup.create({ ...draftOf(), classroomUrl: "  https://CLASSROOM.google.com/c/abc " });
  expect(group.classroomUrl).toBe("https://classroom.google.com/c/abc");
});
it("treats a blank link as none", () => {
  expect(ClassGroup.create({ ...draftOf(), classroomUrl: "   " }).classroomUrl).toBeNull();
  expect(ClassGroup.create(draftOf()).classroomUrl).toBeNull();
});
it.each([
  "http://classroom.google.com/c/abc",
  "https://classroom.google.com.evil.io/c/abc",
  "https://meet.google.com/abc-defg-hij",
  "javascript:alert(1)",
  "not a link",
])("refuses %s", (bad) => {
  expect(() => ClassGroup.create({ ...draftOf(), classroomUrl: bad })).toThrow(ClassroomUrlInvalidError);
});
it("reports the change and clears with null", () => {
  const group = ClassGroup.create(draftOf());
  expect(group.update({ classroomUrl: "https://classroom.google.com/c/abc" })).toEqual(["classroomUrl"]);
  expect(group.update({ classroomUrl: "https://classroom.google.com/c/abc" })).toEqual([]);
  expect(group.update({ classroomUrl: null })).toEqual(["classroomUrl"]);
  expect(group.classroomUrl).toBeNull();
});
it("leaves the link alone when the patch does not carry it", () => {
  const group = ClassGroup.create({ ...draftOf(), classroomUrl: "https://classroom.google.com/c/abc" });
  group.update({ code: "ING-0102" });
  expect(group.classroomUrl).toBe("https://classroom.google.com/c/abc");
});
it("reads back a stored link it would refuse today", () => {
  const stored = new ClassGroup({ ...ClassGroup.create(draftOf()), classroomUrl: "https://example.com/x" } as ClassGroupProps);
  expect(stored.classroomUrl).toBe("https://example.com/x");
});
it("does not carry the link into a duplicated period", () => {
  const group = ClassGroup.create({ ...draftOf(), classroomUrl: "https://classroom.google.com/c/abc" });
  expect(ClassGroup.copyInto(group, period.id).classroomUrl).toBeNull();
});
it("audits the field name, never the link", async () => { /* UpdateClassGroupUseCase com o fake: o último append tem metadata.fields contendo "classroomUrl" e JSON.stringify(metadata) não contém "classroom.google.com" */ });
```

(Ajustar a construção do "stored" ao que as props/`FakeClassGroupRepository` aceitam; a asserção é a que importa.)

- [ ] **Step 2: Run** `pnpm --filter @ooc/api exec vitest run src/tests/catalog-class-group.test.ts` — Expected: FAIL (`classroomUrl` não existe / erro não exportado).

- [ ] **Step 3: Implement.** Coluna no schema com comentário curto no estilo dos vizinhos (link colado pela coordenação, nula até alguém colar, OOC-98). `normalizeClassroomUrl` ao lado do schema da turma, no padrão de `normalizeModuleMaterial` (`Course.ts:30`). `create` e `update` passam o valor por ele; `copyInto` grava `null` (atualizar o doc comment de `copyInto`: "no dates, no window, no seats, no Classroom link"). Comparação de mudança no `update` sobre o valor já normalizado. Adicionar `classroomUrl: "classroom_url"` em `AUDIT_FIELDS` (o teste do catálogo de auditoria exige todo campo editável coberto).

- [ ] **Step 4: Generate the migration** `pnpm --filter @ooc/db db:generate` — Expected: `0038_<nome>.sql` com exatamente `ALTER TABLE "class_groups" ADD COLUMN "classroom_url" text;`. Renomear o arquivo/tag para `0038_class_group_classroom_url` se o Kit der nome aleatório e o `_journal.json` dos anteriores tiver nome descritivo (manter tag e arquivo coerentes).

- [ ] **Step 5: Run** `pnpm --filter @ooc/api exec vitest run src/tests/catalog-class-group.test.ts src/tests/audit-catalog.test.ts` e `pnpm --filter @ooc/domain typecheck && pnpm --filter @ooc/db typecheck` — Expected: PASS.

- [ ] **Step 6: Commit** `feat(domain): give the class group a Classroom link (OOC-98)`.

---

### Task 2: API do catálogo grava e devolve o link

**Files:**
- Modify: `apps/api/src/infra/persistence/catalog/DrizzleClassGroupRepository.ts` (mapear `row.classroomUrl` ↔ `group.classroomUrl` no `toDomain`, insert e update)
- Modify: `apps/api/src/http/catalog/CatalogSchemas.ts` (`CreateClassGroupBodySchema.classroomUrl: z.string().max(2048).nullable().optional()`; `ClassGroupItemSchema.classroomUrl: z.string().nullable()`)
- Modify: `apps/api/src/infra/persistence/catalog/ListClassGroupsQuery.ts` (`ClassGroupItem.classroomUrl: string | null`)
- Modify: `apps/api/src/http/catalog/CreateClassGroupRoute.ts` só se ele não repassar o body inteiro ao usecase
- Test: `apps/api/src/infra/persistence/catalog/ClassGroupCatalog.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ClassGroup.classroomUrl`, coluna, erro)
- Produces: `GET /catalog/class-groups` e `GET /catalog/class-groups/:id` com `classroomUrl: string | null`; `POST`/`PATCH /catalog/class-groups[/:id]` aceitam `classroomUrl`

- [ ] **Step 1: Write the failing integration test** — no arquivo existente, seguindo o setup dele: cria turma com `classroomUrl: "https://classroom.google.com/c/abc"`, relê pelo repositório e pelo `ListClassGroupsQuery` (`{ id }`) → `classroomUrl` igual; `update` com `null` → relido `null`.

- [ ] **Step 2: Run** `pnpm --filter @ooc/api test:db -- ClassGroupCatalog` com `DATABASE_URL` de um Postgres migrado local — Expected: FAIL. Se não houver banco local acessível, registrar isso e seguir para o Step 3; o CI roda essa suíte.

- [ ] **Step 3: Implement** os mapeamentos e schemas. O 422 do link já sai pelo mapeamento genérico de `UnableToProcessEntryError` — conferir que a rota declara `.response(422, …)` (o `PATCH` declara; o `POST` também precisa).

- [ ] **Step 4: Run** a integração (se houver banco), `pnpm --filter @ooc/api test` e `pnpm --filter @ooc/api typecheck` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): store and serve the class group Classroom link (OOC-98)`.

---

### Task 3: Docente e aluno leem o link

**Files:**
- Modify: `packages/domain/src/teaching/TeachingReader.ts` (`TeachingClassGroup.classroomUrl: string | null`)
- Modify: `apps/api/src/infra/persistence/teaching/DrizzleTeachingReader.ts`
- Modify: `apps/api/src/http/teaching/teachingSchemas.ts` (`classroomUrl: z.string().nullable()` no schema e no `serializeTeachingClassGroup`)
- Modify: `apps/api/src/infra/persistence/portal/StudentPortalQuery.ts` (`PortalEnrollmentRow.classGroup.classroomUrl`)
- Modify: `apps/api/src/http/portal/GetPortalOverviewRoute.ts` (schema + serialização)
- Fakes de teaching em `apps/api/src/tests/fakes/` que montam `TeachingClassGroup` (o `tsc` aponta)
- Test: `apps/api/src/infra/persistence/teaching/Teaching.integration.test.ts`, `apps/api/src/infra/persistence/portal/StudentPortalQuery.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 (coluna)
- Produces: `/teaching/class-groups`, `/teaching/class-groups/:id` com `classroomUrl: string | null`; `/portal/overview` → `enrollments[].classGroup.classroomUrl: string | null`

- [ ] **Step 1: Write the failing integration tests.**
  - Teaching: turma do docente A com link → `findClassGroup`/`listClassGroupsOf(A)` trazem o link. A prova de escopo existente (A não lê a turma de B) continua passando sem mudança.
  - Portal: um aluno com três matrículas em turmas com link — `seat_status` `confirmed`, `reserved` e `released` → só a `confirmed` tem `classGroup.classroomUrl` igual ao link; as outras `null`. Incluir o caso da Review Focus 3 (uma `released` e uma `confirmed` na **mesma** turma).

- [ ] **Step 2: Run** `pnpm --filter @ooc/api test:db -- Teaching StudentPortalQuery` — Expected: FAIL.

- [ ] **Step 3: Implement.** No `StudentPortalQuery`, selecionar `classGroups.classroomUrl` e decidir no mapeamento: `classroomUrl: row.seatStatus === "confirmed" ? row.classroomUrl : null`, com um comentário de uma linha dizendo que o link só sai com o dinheiro confirmado (OOC-55, OOC-98). Nada muda no `teachingScope.ts`.

- [ ] **Step 4: Run** a integração (se houver banco), `pnpm --filter @ooc/api test`, `pnpm --filter @ooc/api typecheck`, `pnpm --filter @ooc/domain typecheck` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): show the Classroom link to the teacher and to confirmed students (OOC-98)`.

---

### Task 4: Backoffice — campo no formulário e selo na lista

**Files:**
- Modify: `apps/app/src/lib/backoffice/types.ts` (`ClassGroupItem.classroomUrl: string | null`; `CatalogErrorKey` ganha `'classroom_url_invalid'`; em `ClassGroupRow` saem `meetUrl` e `studentClassroomUrl`)
- Modify: `apps/app/src/lib/backoffice/catalog-client.ts` (`KNOWN` ganha `'classroom_url_invalid'`)
- Modify: `apps/app/src/app/[locale]/backoffice/(panel)/(gated)/class-groups/class-group-form.tsx`
- Modify: `apps/app/src/app/[locale]/backoffice/(panel)/(gated)/class-groups/class-group-table.tsx`
- Modify: mocks que montam `ClassGroupRow` com os campos removidos (o `tsc` aponta)
- Modify: `apps/app/src/messages/backoffice/{es-PE,pt-BR,en}.json`
- Test: `apps/app/src/lib/backoffice/class-links.test.ts` (já cobre `parseClassLink`; acrescentar o caso de host em maiúsculas e espaços → normalizado, se faltar)

**Interfaces:**
- Consumes: Task 2 (API com `classroomUrl`)
- Produces: i18n `bo.class_groups.field_classroom`, `bo.class_groups.classroom_placeholder`, `bo.class_groups.classroom_invalid`, `bo.class_groups.classroom_missing`, `bo.catalog_errors.classroom_url_invalid` (usar o namespace real onde moram os erros do catálogo — o de `module_material_invalid`, linha ~2105), e o rótulo do campo de auditoria `classroom_url` ao lado de `module_materials` (linha ~370)

- [ ] **Step 1: Form.** Estado `classroomUrl` iniciado em `initial?.classroomUrl ?? ''`, input `type="url"` logo abaixo do seletor de docente, validado com `parseClassLink(value, 'classroom')` (`null` = inválido → erro inline `classroom_invalid` e submit desabilitado como os outros erros do form). No `POST` vai `classroomUrl: parsed || null`; no `PATCH` entra só quando `(parsed || null) !== (initial.classroomUrl ?? null)`, e esvaziar manda `null` (Review Focus 2).

- [ ] **Step 2: Table.** Na célula de status, `StatusBadge tone="warning" label={t('class_groups.classroom_missing')}` quando `!row.classroomUrl && (row.status === 'enrolling' || row.status === 'in_progress')`.

- [ ] **Step 3: i18n** nos três locales. es-PE: `field_classroom` "Enlace del Classroom", `classroom_placeholder` "https://classroom.google.com/…", `classroom_invalid` "Pega un enlace https://classroom.google.com/…", `classroom_missing` "Sin Classroom", erro do catálogo "El enlace no es de Google Classroom.", auditoria "Enlace del Classroom". pt-BR e en equivalentes.

- [ ] **Step 4: Run** `pnpm --filter app test`, `pnpm --filter app typecheck` (ou `exec tsc --noEmit`) e `pnpm --filter app lint` — Expected: PASS, sem string literal acusada.

- [ ] **Step 5: Commit** `feat(app): set the Classroom link with the teacher and flag class groups without one (OOC-98)`.

---

### Task 5: Portal do docente e portal do aluno com o link real

**Files:**
- Modify: `apps/app/src/lib/docente/teaching.ts` (`TeachingClassGroup.classroomUrl: string | null`)
- Modify: `apps/app/src/lib/docente/agenda.ts` (`AgendaClassGroup.classroomUrl` e o `agendaClassGroup()` copia o campo)
- Modify: `apps/app/src/components/backoffice/class-links.tsx` (`ClassLinks` recebe `{ classroomUrl: string | null }`, só a porta do Classroom)
- Modify: `apps/app/src/app/[locale]/docente/(panel)/class-groups/class-resources.tsx` (props `{ classroomUrl: string | null; moduleMaterialsUrl: string | null }`; sai o bloco "para os alunos", o `useState`, `NO_CLASS_LINKS` e o aviso de salvo só na tela; porta de material só quando o link existe e passa no `parseClassLink(…, 'drive')`; reescrever o doc comment)
- Modify: `apps/app/src/app/[locale]/docente/(panel)/class-groups/[classGroupId]/class-group-workspace.tsx` (`<ClassResources classroomUrl={group.classroomUrl} moduleMaterialsUrl={null} />`, comentário sem OOC-98 entre os "screen state")
- Modify: `apps/app/src/app/[locale]/docente/(panel)/agenda/teacher-agenda.tsx` (`<ClassLinks classroomUrl={selected.group.classroomUrl} />`, comentário da prop)
- Modify: `apps/app/src/lib/feature-flags/registry.ts` (`teacher.class_links` → `production: true`, comentário: Classroom real; material com OOC-100)
- Modify: `apps/app/src/lib/portal/types.ts` (`meetingUrl` → `classroomUrl` nas duas interfaces)
- Modify: `apps/app/src/lib/portal/overview.ts` (`ApiEnrollment.classGroup.classroomUrl`; `toEnrollment` lê da API; `nextClassOf` repassa)
- Modify: `apps/app/src/app/[locale]/portal/page.tsx`, `apps/app/src/app/[locale]/portal/courses/[enrollmentId]/page.tsx` (renomear o campo)
- Modify: `apps/app/src/messages/backoffice/{es-PE,pt-BR,en}.json` (saem `class_links.meet` e as chaves de `class_resources` que ficarem órfãs: `for_students`, `classroom_placeholder`, `publish`, `classroom_invalid`, `students_see`, `students_none`, `saved_local_only`, `published_short`, `not_published_short`)

**Interfaces:**
- Consumes: Task 3 (`/teaching/*` e `/portal/overview` com `classroomUrl`), Task 4 (`ClassGroupRow` sem `meetUrl`/`studentClassroomUrl`)

- [ ] **Step 1: Implement** as mudanças acima. O `href` do portal do aluno continua passando por checagem de host antes de virar link: usar `parseClassLink(url, 'classroom')` (importar de `@/lib/backoffice/class-links`) no `toEnrollment`, tratando `''`/`null` como `null`.

- [ ] **Step 2: Grep de sobras** `grep -rn "meetUrl\|studentClassroomUrl\|meetingUrl\|NO_CLASS_LINKS\|class_links.meet" apps/app/src` — Expected: nenhuma ocorrência.

- [ ] **Step 3: Run** `pnpm --filter app test`, typecheck e lint do app — Expected: PASS; o lint de i18n não acusa chave usada inexistente.

- [ ] **Step 4: Commit** `feat(app): open the class group's Classroom from both portals (OOC-98)`.

---

### Task 6: Documentação viva e verificação final

**Files:**
- Modify: `CLAUDE.md` (§1, no item "Turma nasce rascunho…" ou logo após: a turma guarda o link do Classroom colado pela coordenação no formulário da turma; docente vê, aluno vê só com vaga confirmada; duplicar zera; **em aberto (dono):** link obrigatório ao atribuir docente e turma ativa após a atribuição — contradizem OOC-80/OOC-35)
- Modify: `docs/ROADMAP.md` (linhas 36 e 42 e o "Resumo" do topo; linha 212 se listar OOC-98 como pendente)
- Modify: `apps/app/README.md` ("Estado por tela": turmas do backoffice, portal do docente — turma e agenda —, portal do aluno)
- Modify: `docs/ARCHITECTURE.md:659` (linha da flag `teacher.class_links`: `production: true`, Classroom real; material espera OOC-100)
- Modify: `apps/app/CLAUDE.md:199` e `apps/api/CLAUDE.md` só onde citarem `teacher.class_links`/link da aula como sem backend

- [ ] **Step 1: Update** os docs acima — só a coluna Estado do roadmap (Sessão/Entregável/Pronto quando não se tocam).

- [ ] **Step 2: Verify the whole branch:** `pnpm -r typecheck`, `pnpm -r lint`, `pnpm --filter @ooc/api test`, `pnpm --filter app test`, `pnpm --filter @ooc/db test` e, com banco, `pnpm test:api:db`. Expected: tudo verde; registrar o que não pôde rodar.

- [ ] **Step 3: Commit** `docs: record the class group Classroom link (OOC-98)`.
