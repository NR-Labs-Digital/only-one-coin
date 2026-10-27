# Curso com módulos e material por módulo (OOC-94) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada curso guarda um link de material (Drive/Docs) por módulo, exigido ao criar o curso e ao mexer nos módulos; curso antigo sem material avisa, não trava.

**Architecture:** Uma coluna `courses.module_materials text[]` (migration `0037`). A regra vive na entidade `Course` (`packages/domain`), que recusa com dois erros `catalog.*` (422). As rotas existentes de criação e de opções carregam o campo; a leitura do catálogo devolve a lista e um booleano `missingModuleMaterials`. No app, o formulário compartilhado de opções ganha um campo por módulo, e a lista/página do curso ganham o selo "Sin material".

**Tech Stack:** Drizzle ORM + Drizzle Kit, zod, Fastify (`RouteBuilder`), Vitest, Next.js App Router + next-intl.

**Spec:** `docs/superpowers/specs/2026-10-26-course-modules-design.md`

## Global Constraints

- Código, comentários, commits, branch e PR em inglês; texto de tela só nos locales `es-PE` · `pt-BR` · `en`, mesmas chaves nos três (`CLAUDE.md` §4).
- Link válido: protocolo `https:` e host exatamente `drive.google.com` ou `docs.google.com` (spec, decisão 2). Nada mais.
- Invariante: `module_materials` é vazio (curso antigo) **ou** tem exatamente `modules` links válidos (spec, "Dado").
- Exigir links só quando `modules` **muda de valor** ou a lista **muda de conteúdo** — um patch que reenvia `modules` igual não exige nada (spec, decisão 1; o teste existente `patch: { minAge: 15, modules: 4 }` precisa continuar passando).
- Erros: `catalog.module_materials_incomplete` e `catalog.module_material_invalid`, ambos `UnableToProcessEntryError` (422).
- `audit_log` registra só o nome do campo (`moduleMaterials`), nunca os links (`CLAUDE.md` §8).
- Migration aditiva, sem CHECK de tamanho, sem `ANALYZE` (coluna fora de `WHERE`).
- Commits pequenos, convencionais, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Curso antigo + patch com `modules` igual** (a tela de opções ou um cliente que manda o objeto inteiro) → salva sem pedir links. Teste na Task 1.
2. **Mesma lista reenviada, inclusive com espaço em volta** → não conta como mudança, não gera linha de auditoria. Teste na Task 1.
3. **Host parecido** (`https://drive.google.com.evil.com/x`, `http://drive.google.com/x`, `javascript:alert(1)`, `https://evil.com/?u=drive.google.com`) → recusado; `https://DRIVE.GOOGLE.COM/x` → aceito e normalizado para minúsculo. Testes na Task 1 (domínio) e Task 3 (`parseClassLink`).
4. **Diminuir de 4 para 3 módulos sem mandar a lista** (cliente que só manda `modules`) → 422 `module_materials_incomplete`, nada gravado. Teste na Task 1.
5. **Campo "Módulos" vazio ou negativo no formulário** (`Number('')` é `0`) → a lista de campos não quebra (comprimento ≥ 0) e o botão fica desabilitado. Teste do helper na Task 3.

---

### Task 1: Domínio — `moduleMaterials` no `Course`

**Files:**
- Modify: `packages/domain/src/catalog/Course.ts`
- Modify: `packages/domain/src/catalog/errors.ts`
- Modify: `packages/domain/src/index.ts` (exportar o que for novo, se o arquivo não reexporta `Course.ts`/`errors.ts` inteiros)
- Modify: `packages/domain/src/identity/auditCatalog.ts` (`AUDIT_FIELDS`)
- Test: `apps/api/src/tests/catalog-course.test.ts` (os testes de domínio do catálogo moram em `apps/api/src/tests`)
- Modify (fixtures): `apps/api/src/tests/catalog-class-group.test.ts`, `apps/api/src/tests/catalog-plan.test.ts` — todo `CreateCourseDTO` ganha `moduleMaterials` com `modules` links válidos

**Interfaces:**
- Produces:
  - `MODULE_MATERIAL_HOSTS = ["drive.google.com", "docs.google.com"] as const`
  - `normalizeModuleMaterials(modules: number, materials: readonly string[]): string[]` — trim + `new URL(...).toString()`; lança `ModuleMaterialsIncompleteError` se `materials.length !== modules`, `ModuleMaterialInvalidError` se algum não é `https:` num host da lista.
  - `class ModuleMaterialsIncompleteError extends UnableToProcessEntryError` (reason `catalog.module_materials_incomplete`)
  - `class ModuleMaterialInvalidError extends UnableToProcessEntryError` (reason `catalog.module_material_invalid`)
  - `CoursePropsSchema.moduleMaterials: z.array(z.string())` (frouxo — linha lida nunca lança)
  - `CourseOptionsSchema.moduleMaterials: z.array(z.string())` — entra em `CreateCourseSchema` (obrigatório, via `CoursePropsSchema`) e em `UpdateCourseSchema` (opcional)
  - `Course.moduleMaterials: string[]`
  - `AUDIT_FIELDS.moduleMaterials = "module_materials"`

- [ ] **Step 1: Escrever os testes que falham** em `catalog-course.test.ts`. Acrescentar `moduleMaterials` ao `A_COURSE` (quatro links `https://drive.google.com/drive/folders/m1`…`m4`) e:

```ts
const LINKS = ["https://drive.google.com/drive/folders/m1", "https://drive.google.com/drive/folders/m2",
  "https://docs.google.com/presentation/d/m3", "https://drive.google.com/drive/folders/m4"];

describe("Course module materials (OOC-94)", () => {
  it("refuses a course with fewer links than modules", () => {
    expect(() => Course.create({ ...A_COURSE, moduleMaterials: LINKS.slice(0, 3) }))
      .toThrow(ModuleMaterialsIncompleteError);
  });
  it.each([
    "http://drive.google.com/x",
    "https://drive.google.com.evil.com/x",
    "https://evil.com/?u=drive.google.com",
    "javascript:alert(1)",
    "",
  ])("refuses %s as a module material", (bad) => {
    expect(() => Course.create({ ...A_COURSE, moduleMaterials: [bad, ...LINKS.slice(1)] }))
      .toThrow(ModuleMaterialInvalidError);
  });
  it("normalizes the links it keeps", () => {
    const course = Course.create({ ...A_COURSE, moduleMaterials: ["  https://DRIVE.GOOGLE.COM/x ", ...LINKS.slice(1)] });
    expect(course.moduleMaterials[0]).toBe("https://drive.google.com/x");
  });
});

describe("UpdateCourseUseCase — module materials", () => {
  // A course written before OOC-94: a module count, no links.
  const legacy = () => courses.create(new Course({ ...Course.create(A_COURSE), moduleMaterials: [] }));

  it("lets a course without materials change another option", async () => { /* patch {minAge: 15} → minAge 15, fields ["minAge"] */ });
  it("does not ask for links when modules is resent unchanged", async () => { /* legacy, patch {minAge: 15, modules: 4} → ok */ });
  it("refuses a module count change without links", async () => { /* legacy, patch {modules: 3} → ModuleMaterialsIncompleteError, auditLog.appended empty */ });
  it("fills the materials of a course that had none", async () => { /* legacy, patch {moduleMaterials: LINKS} → fields ["moduleMaterials"] */ });
  it("drops the last module with its link", async () => { /* full course, patch {modules: 3, moduleMaterials: LINKS.slice(0,3)} → fields ["modules","moduleMaterials"] */ });
  it("refuses fewer modules when the links are not resent", async () => { /* full course, patch {modules: 3} → ModuleMaterialsIncompleteError */ });
  it("does not count the same links as a change", async () => { /* full course, patch {moduleMaterials: LINKS.map(l => ` ${l} `)} → returns course, auditLog.appended empty */ });
});
```

(`legacy()` é um esboço; construir a entidade com `moduleMaterials: []` pelo construtor, que usa o schema frouxo. Os corpos comentados dizem exatamente o patch e as asserções.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ooc/api test -- catalog-course`
Expected: FAIL (`ModuleMaterialsIncompleteError` não exportado / `moduleMaterials` desconhecido).

- [ ] **Step 3: Implementar em `errors.ts` e `Course.ts`**

- Os dois erros seguem o molde de `PriceInPastError` (mensagem em inglês, só para log).
- `Course.create`: depois do `CreateCourseSchema.parse`, `moduleMaterials = normalizeModuleMaterials(parsed.modules, parsed.moduleMaterials)`.
- `Course.update(patch)`: **valida antes de mutar qualquer campo.** Ordem:
  1. `valid = UpdateCourseSchema.parse(patch)`.
  2. `modulesChanged = valid.modules !== undefined && valid.modules !== this.modules`.
  3. `listGiven = valid.moduleMaterials !== undefined`.
  4. Se `modulesChanged || listGiven`: `next = normalizeModuleMaterials(valid.modules ?? this.modules, valid.moduleMaterials ?? this.moduleMaterials)` — **exceto** quando `!modulesChanged` e a lista dada, normalizada elemento a elemento, é igual à atual (nesse caso não valida nem conta). Use `next` no lugar de `valid.moduleMaterials`.
  5. No laço de mudança, `moduleMaterials` compara por conteúdo (mesmo comprimento e mesmos elementos na ordem), nunca por `===`.
- Atualizar o comentário de `CourseOptionsSchema` para dizer que os links andam com a contagem.

- [ ] **Step 4: `AUDIT_FIELDS.moduleMaterials = "module_materials"`** em `auditCatalog.ts`, logo depois de `modules`. O rótulo de tela entra na Task 3.

- [ ] **Step 5: Atualizar as fixtures** de `catalog-class-group.test.ts` e `catalog-plan.test.ts` (todo `CreateCourseDTO` com `moduleMaterials` de `modules` links válidos).

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @ooc/api test -- catalog-course catalog-class-group catalog-plan audit-catalog`
Expected: PASS (o `audit-catalog.test.ts` "labels every field an edit can record" cobre `moduleMaterials` via `UpdateCourseSchema`).

Run: `pnpm typecheck:domain`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add packages/domain apps/api/src/tests
git commit -m "feat(domain): a course carries one material link per module (OOC-94)"
```

---

### Task 2: Banco, repositório e leitura do catálogo

**Files:**
- Modify: `packages/db/src/schema.ts:113` (coluna nova ao lado de `modules`)
- Create: `packages/db/migrations/0037_course_module_materials.sql` (+ `meta/` gerados)
- Modify: `apps/api/src/infra/persistence/catalog/DrizzleCourseRepository.ts` (`courseFromRow`, `create`, `update`)
- Modify: `apps/api/src/infra/persistence/catalog/ListCoursesQuery.ts` (`CourseListItem`, `toCourseListItem`)
- Modify: `apps/api/src/http/catalog/CatalogSchemas.ts` (`CourseListItemSchema`)
- Modify: `apps/api/src/http/catalog/UpdateCourseOptionsRoute.ts` (só o comentário: os links andam com as opções)
- Test: `apps/api/src/infra/persistence/catalog/CourseCatalog.integration.test.ts`
- Modify: `packages/db/CLAUDE.md` (nota da `0037`, no estilo das anteriores)

**Interfaces:**
- Consumes: `Course.moduleMaterials`, `CreateCourseSchema`/`CourseOptionsSchema` com `moduleMaterials` (Task 1).
- Produces: coluna `courses.module_materials` (`text[] not null default '{}'`, Drizzle `moduleMaterials: text("module_materials").array().notNull().default(sql\`'{}'::text[]\`)`); `CourseListItem.moduleMaterials: string[]` e `CourseListItem.missingModuleMaterials: boolean` (= `moduleMaterials.length !== modules`), servidos por `GET /catalog/courses` e `GET /catalog/courses/:id`.

- [ ] **Step 1: Escrever o teste de integração que falha** em `CourseCatalog.integration.test.ts`, no padrão de transação com `RollBack` que o arquivo já usa:
  - `"stores and reads back one material per module"`: cria pelo repositório um `Course.create` com 4 links, relê com `findById` → `moduleMaterials` igual, na ordem; lista com `ListCoursesQuery` → item com `missingModuleMaterials: false`.
  - `"flags a course written without materials"`: `insert(courses)` direto, sem a coluna (o default vale) → `ListCoursesQuery` devolve `moduleMaterials: []` e `missingModuleMaterials: true`; `GetCourseQuery` idem.
  - Ajustar as chamadas de `Course.create` já existentes no arquivo para levar `moduleMaterials`.

- [ ] **Step 2: Coluna no schema e migration**

Run: `pnpm --filter @ooc/db db:generate -- --name course_module_materials`
Expected: `packages/db/migrations/0037_course_module_materials.sql` com um único `ALTER TABLE "courses" ADD COLUMN "module_materials" text[] DEFAULT '{}'::text[] NOT NULL;` e o journal atualizado. Nada além disso no SQL.

- [ ] **Step 3: Repositório e leitura** — `courseFromRow` lê `row.moduleMaterials`; `create` e `update` gravam `moduleMaterials`; `toCourseListItem` devolve os dois campos; `CourseListItemSchema` ganha `moduleMaterials: z.array(z.string())` e `missingModuleMaterials: z.boolean()`. `GetCourseQuery` já passa por `toCourseListItem`; confirmar.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test:api:db` (Postgres local migrado; `pnpm --filter @ooc/db db:migrate` antes, se preciso)
Expected: PASS, incluindo os dois testes novos.

Run: `pnpm typecheck:api && pnpm typecheck:db && pnpm --filter @ooc/api test`
Expected: sem erros; suíte de unidade verde (inclui `catalog-routes-authorization.test.ts`).

- [ ] **Step 5: Nota em `packages/db/CLAUDE.md`**, depois da `0036`: `courses.module_materials` (`text[]`, padrão `'{}'`), um link por posição; sem CHECK de tamanho porque curso anterior à OOC-94 tem lista vazia e avisa; a invariante (vazio ou exatamente `modules` links válidos) é do domínio; fora de `WHERE`, sem `ANALYZE`.

- [ ] **Step 6: Commit**

```bash
git add packages/db apps/api/src/infra/persistence/catalog apps/api/src/http/catalog
git commit -m "feat(api): store and serve the material link of each course module (OOC-94)"
```

---

### Task 3: Tela — um campo por módulo e o selo "Sin material"

**Files:**
- Modify: `apps/app/src/lib/backoffice/class-links.ts` (`drive` aceita os dois hosts)
- Create: `apps/app/src/lib/backoffice/class-links.test.ts`
- Create: `apps/app/src/lib/backoffice/module-materials.ts`
- Create: `apps/app/src/lib/backoffice/module-materials.test.ts`
- Modify: `apps/app/src/lib/backoffice/types.ts` (`CourseRow`, `CourseOptions`, `CatalogErrorKey`)
- Modify: `apps/app/src/lib/backoffice/catalog-client.ts` (`KNOWN`)
- Modify: `apps/app/src/app/[locale]/backoffice/(panel)/(gated)/courses/course-option-fields.tsx`
- Modify: `apps/app/src/app/[locale]/backoffice/(panel)/(gated)/courses/new-course-form.tsx`
- Modify: `apps/app/src/app/[locale]/backoffice/(panel)/(gated)/courses/course-options-form.tsx`
- Modify: `apps/app/src/app/[locale]/backoffice/(panel)/(gated)/courses/courses-view.tsx` (selo na lista, ao lado do "Sin precio", ~linha 327)
- Modify: `apps/app/src/app/[locale]/backoffice/(panel)/(gated)/courses/[courseId]/page.tsx` (selo no cabeçalho)
- Modify: `apps/app/src/messages/backoffice/{es-PE,pt-BR,en}.json`

**Interfaces:**
- Consumes: `moduleMaterials`/`missingModuleMaterials` na resposta do catálogo (Task 2); reasons `catalog.module_materials_incomplete` / `catalog.module_material_invalid` (Task 1).
- Produces (em `module-materials.ts`):
  - `resizeModuleMaterials(list: readonly string[], count: number): string[]` — comprimento `max(0, trunc(count))` (NaN → 0); mantém o que já está nas posições, completa com `''`.
  - `sameModuleMaterials(a: readonly string[], b: readonly string[]): boolean` — mesmo comprimento e mesmos elementos na ordem.
  - `type ModuleMaterialIssue = 'missing' | 'invalid'`
  - `moduleMaterialIssues(list: readonly string[]): (ModuleMaterialIssue | null)[]` — via `parseClassLink(raw, 'drive')`: `''` → `'missing'`, `null` → `'invalid'`, senão `null`.
  - `CourseOptions` passa a incluir `moduleMaterials`; `CourseRow` ganha `moduleMaterials: string[]` e `missingModuleMaterials: boolean` (o `ApiCourse` herda de `CourseRow`).

- [ ] **Step 1: Testes que falham**

`class-links.test.ts`:
```ts
it("accepts Docs as module material", () => {
  expect(parseClassLink("https://docs.google.com/presentation/d/x", "drive")).toBe("https://docs.google.com/presentation/d/x")
})
it.each(["https://drive.google.com.evil.com/x", "http://drive.google.com/x", "javascript:alert(1)"])(
  "refuses %s as module material", (raw) => expect(parseClassLink(raw, "drive")).toBeNull())
it("keeps meet and classroom on their own host", () => {
  expect(parseClassLink("https://docs.google.com/x", "meet")).toBeNull()
})
```

`module-materials.test.ts`:
```ts
expect(resizeModuleMaterials(["a", "b"], 4)).toEqual(["a", "b", "", ""])
expect(resizeModuleMaterials(["a", "b", "c"], 2)).toEqual(["a", "b"])
expect(resizeModuleMaterials(["a"], 0)).toEqual([])
expect(resizeModuleMaterials(["a"], -3)).toEqual([])
expect(resizeModuleMaterials(["a"], Number.NaN)).toEqual([])
expect(sameModuleMaterials(["a"], ["a"])).toBe(true)
expect(sameModuleMaterials(["a"], ["a", ""])).toBe(false)
expect(moduleMaterialIssues(["", "https://evil.com/x", "https://drive.google.com/x"])).toEqual(["missing", "invalid", null])
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @ooc/app test -- class-links module-materials`
Expected: FAIL (`docs.google.com` recusado; módulo inexistente).

- [ ] **Step 3: Implementar `class-links.ts` e `module-materials.ts`.** Em `class-links.ts`, `HOSTS` vira `Record<ClassLinkKind, readonly string[]>` (`drive`: os dois hosts) e o comentário de topo cita o Docs.

- [ ] **Step 4: Rodar e ver passar** — mesmo comando; Expected: PASS.

- [ ] **Step 5: Tela**
  - `CourseOptionFields`: logo depois do campo "Módulos", um `fieldset` com um campo por posição `1..value.modules` (`value.moduleMaterials[i] ?? ''`), rótulo `course_options.module_material` (`{n}`), `type="url"`, `inputMode="url"`. Erro ao lado do campo (`module_material_missing` / `module_material_invalid`) só depois que o campo foi tocado ou quando a prop `showMaterialIssues` vier ligada. Mudar "Módulos" chama `onChange` com `modules` e `moduleMaterials: resizeModuleMaterials(...)` juntos. Dica `module_materials_hint` embaixo do grupo. Grade com `AutoGrid` (`min="16rem"`), nada de `grid-cols-*` com breakpoint (`apps/app/CLAUDE.md`).
  - `DEFAULT_COURSE_OPTIONS.moduleMaterials = ['', '', '', '']` (`modules` é 4).
  - `new-course-form.tsx`: `ready` exige também `moduleMaterialIssues(draft.moduleMaterials).every((i) => i === null)` e `moduleMaterials.length === modules`; o POST manda `moduleMaterials` normalizado por `parseClassLink`.
  - `course-options-form.tsx`: `optionsOf` inclui `moduleMaterials: course.moduleMaterials`. No `save`, o filtro de chaves alteradas trata `moduleMaterials` com `sameModuleMaterials`. Se `modules` **ou** `moduleMaterials` mudou, o patch manda os dois (`modules` e a lista inteira); senão, nenhum dos dois. "Guardar" fica desabilitado quando houve mudança em módulos/links e algum campo tem problema, com o aviso ao lado do campo.
  - Selo `courses.no_material_badge` (tom `warning`, `title` = `courses.no_material_hint`) quando `course.active && course.missingModuleMaterials`, na lista e no cabeçalho do curso, ao lado do "Sin precio" (os dois podem aparecer juntos).
  - `CatalogErrorKey` + `KNOWN` ganham `module_materials_incomplete` e `module_material_invalid`.

- [ ] **Step 6: Locales** — as mesmas chaves nos três arquivos:
  - `bo.course_options.module_material` — es-PE `"Material del módulo {n}"` · pt-BR `"Material do módulo {n}"` · en `"Module {n} material"`
  - `bo.course_options.module_materials_hint` — es-PE `"Un enlace de Google Drive o Docs por módulo. El docente lo verá en su aula."` · pt-BR `"Um link do Google Drive ou Docs por módulo. O docente vai vê-lo na turma."` · en `"One Google Drive or Docs link per module. The teacher will see it in their class."`
  - `bo.course_options.module_material_missing` — `"Falta el enlace de este módulo."` · `"Falta o link deste módulo."` · `"This module needs a link."`
  - `bo.course_options.module_material_invalid` — `"Tiene que ser un enlace de Google Drive o Docs (https)."` · `"Precisa ser um link do Google Drive ou Docs (https)."` · `"Must be a Google Drive or Docs link (https)."`
  - `bo.courses.no_material_badge` — `"Sin material"` · `"Sem material"` · `"No material"`
  - `bo.courses.no_material_hint` — `"Falta el enlace de material de algún módulo. Complétalo en las opciones del curso."` · `"Falta o link de material de algum módulo. Complete nas opções do curso."` · `"A module has no material link. Fill it in the course options."`
  - `bo.catalog_errors.module_materials_incomplete` — `"Cada módulo necesita su enlace de material."` · `"Cada módulo precisa do seu link de material."` · `"Every module needs its material link."`
  - `bo.catalog_errors.module_material_invalid` — `"Algún enlace no es de Google Drive o Docs."` · `"Algum link não é do Google Drive ou Docs."` · `"A link is not from Google Drive or Docs."`
  - `bo.audit_log.field.module_materials` — `"Material de los módulos"` · `"Material dos módulos"` · `"Module materials"`

- [ ] **Step 7: Verificar**

Run: `pnpm --filter @ooc/app test && pnpm typecheck:app && pnpm --filter @ooc/app lint`
Expected: tudo verde (o lint pega string solta em `.tsx`).

Manual (`pnpm dev:stack`, `seed:catalog`): criar curso com 4 módulos → "Crear" só habilita com os 4 links; um link `https://evil.com` mostra o erro ao lado do campo. Curso do seed (sem material) → selo "Sin material" na lista e na página; mudar só a idade salva; mudar "Módulos" para 3 exige os 3 links; preencher e salvar some o selo.

- [ ] **Step 8: Commit**

```bash
git add apps/app
git commit -m "feat(app): ask for a material link per module and flag courses without one (OOC-94)"
```

---

### Task 4: Documentação viva e portão final

**Files:**
- Modify: `CLAUDE.md` (raiz, §1 — um item novo perto de "Catálogo sai do ar, não some")
- Modify: `docs/ROADMAP.md` (linha da "Progressão de módulo em lote e curso com módulos" — OOC-94 ✅/🟡 conforme o resto da linha — e o quadro Resumo, se a contagem mudar)
- Modify: `apps/app/README.md` ("Estado por tela", linha de Cursos)
- Modify: `docs/superpowers/specs/2026-10-26-course-modules-design.md` (Domínio: "se o patch **muda** `modules` ou a lista", não "traz" — alinhado ao Global Constraints)

- [ ] **Step 1: Item no §1 da raiz**: curso tem N módulos, cada um com link de material (`https`, `drive.google.com` ou `docs.google.com`), exigido ao criar e ao mexer em módulos/links; curso anterior à OOC-94 aparece "Sin material" e continua editável (avisa, não trava); edita quem edita as opções (`master`/`admin`/`enrollment_supervisor`); o link é a fonte do material que o OOC-100 vai mostrar ao docente. Referência ao spec.

- [ ] **Step 2: ROADMAP, README do app e correção do spec** como listado em Files.

- [ ] **Step 3: Portão**

Run: `pnpm lint && pnpm typecheck:domain && pnpm typecheck:api && pnpm typecheck:db && pnpm typecheck:app && pnpm test:api && pnpm --filter @ooc/app test && pnpm test:api:db`
Expected: tudo verde.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs apps/app/README.md
git commit -m "docs: record course module materials and track OOC-94 (OOC-94)"
```
