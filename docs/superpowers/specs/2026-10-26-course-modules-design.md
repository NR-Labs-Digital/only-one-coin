# Curso com módulos e material por módulo (OOC-94)

Desenho aprovado em 26/10/2026. Pedido do Linear OOC-94 ("Cadastro de curso
com módulos"), primeiro da série OOC-94..103. Bloqueia o OOC-100 (portal do
docente: materiais do módulo).

## Problema

O curso tem hoje só a contagem de módulos (`courses.modules`, inteiro, editado
em Opções). Não existe nada por módulo. O ticket pede:

- na criação do curso, definir a quantidade de módulos;
- cada módulo exige um link de material do Drive;
- não salvar o curso se algum módulo estiver sem link.

O portal do docente já tem o lugar do link (`moduleMaterialsUrl` em
`apps/app/src/app/[locale]/docente/(panel)/class-groups/class-resources.tsx`,
atrás da flag `teacher.class_links`), sem backend.

## Decisões (do dono, 26/10/2026)

1. **Curso antigo avisa, não trava.** O link é exigido ao criar o curso e
   sempre que quantidade ou links forem alterados. O curso que já existe sem
   material ganha o selo "Sem material" (como o "Sem preço"), e mudar outra
   opção dele (idade, horas, regra do certificado) continua salvando.
2. **Link válido = `https` em `drive.google.com` ou `docs.google.com`.** Cobre
   pasta, arquivo, Docs, Slides e Sheets; recusa qualquer outro host. A mesma
   regra passa a valer na tela do docente (`parseClassLink(…, 'drive')`), que
   hoje aceita só `drive.google.com` — as duas pontas não podem divergir.
3. **Guardar na própria linha do curso** (opção A de três): uma coluna
   `courses.module_materials text[]`, um link por posição. Descartadas: tabela
   `course_modules` (contagem em dois lugares, regra de sincronia, DELETE ao
   diminuir) e tabela com a contagem derivada (expand/contract de semanas só
   para trocar a fonte do número). Se módulo ganhar atributos próprios (nome,
   horas, id referenciado por outra tabela), migrar para tabela é direto.

Decorrentes do desenho, aprovadas junto:

- Módulo é posição + link. Sem nome — "Módulo 3" é o que o OOC-100 e o OOC-85
  chamam de módulo.
- Quem edita os links é quem edita a quantidade: `CATALOG_WRITE_ROLES`
  (`master`, `admin`, `enrollment_supervisor`). Criar curso continua
  `CATALOG_OWNER_ROLES` (`master`, `admin`).

## Fora do escopo

- Qual módulo uma turma ensina (OOC-85 / OOC-100).
- Mostrar o link ao docente (OOC-100) e ao aluno.
- Histórico de links: trocar o link substitui; o `audit_log` registra que o
  campo mudou, nunca o valor (§8).

## Dado

Migration `0037`:

```sql
ALTER TABLE courses ADD COLUMN module_materials text[] NOT NULL DEFAULT '{}';
```

- Aditiva. Fora de `WHERE`, sem `ANALYZE`.
- Sem CHECK de tamanho: o curso antigo tem a lista vazia de propósito
  (decisão 1). A contagem oficial continua em `courses.modules`.
- Invariante, mantida pelo domínio: lista vazia (curso sem material) **ou**
  exatamente `modules` links, todos válidos. Quantidade e lista são gravadas no
  mesmo `UPDATE` do curso.

## Domínio (`packages/domain/src/catalog/`)

- `ModuleMaterialUrlSchema`, em `Course.ts` ao lado dos outros schemas do
  curso: normaliza (trim) e aceita só `https:` com host `drive.google.com` ou
  `docs.google.com`; devolve a URL normalizada (`new URL(...).toString()`) ou
  recusa.
- `Course.moduleMaterials: string[]`; `CoursePropsSchema` carrega `string[]`
  sem validar host (linha lida nunca lança).
- `Course.create`: exige `moduleMaterials.length === modules` e todo link
  válido.
- `Course.update(patch)`: se o patch **muda** `modules` ou o conteúdo de
  `moduleMaterials`, o estado final precisa ter um link válido por módulo.
  Patch que não muda nenhum dos dois — inclusive um que reenvia `modules`
  igual — não olha os links (curso antigo continua editável). Comparação de mudança da
  lista é por conteúdo, não por referência — senão todo PATCH contaria
  `moduleMaterials` como alterado.
- Diminuir de 4 para 3 módulos: a tela manda 3 links; o quarto sai da lista.
  Aumentar: a tela manda o link novo junto.
- Erros novos em `catalog/errors.ts`, 422:
  - `ModuleMaterialsIncompleteError` → `catalog.module_materials_incomplete`
    (número de links ≠ módulos);
  - `ModuleMaterialInvalidError` → `catalog.module_material_invalid` (link fora
    da regra).
- Leitura derivada: `missingModuleMaterials = moduleMaterials.length !==
  modules`.

## API

Nenhuma rota nova.

- `POST /catalog/courses` (`CATALOG_OWNER_ROLES`): `moduleMaterials` passa a
  ser obrigatório no corpo (`CreateCourseSchema`).
- `PATCH /catalog/courses/:id/options` (`CATALOG_WRITE_ROLES`):
  `CourseOptionsSchema` ganha `moduleMaterials: string[]`.
- `PATCH /catalog/courses/:id` (identidade) não muda.
- O corpo aceita `string[]` cru; a validação de host é do domínio, para a tela
  receber o motivo `catalog.*` em vez de um 400 genérico do zod.
- `CourseListItemSchema` (lista e `GET /catalog/courses/:id`) ganha
  `moduleMaterials: string[]` e `missingModuleMaterials: boolean`.
- `audit_log`: as ações já existentes (`catalog.course.created`,
  `catalog.course.updated`) passam a listar `moduleMaterials` entre os campos;
  o nome do campo entra em `packages/domain/src/identity/auditCatalog.ts` no
  mesmo PR (o teste do catálogo de auditoria exige).

## Tela (`apps/app`)

- `CourseOptionFields` (compartilhado por criar e editar): logo abaixo do
  campo "Módulos", N campos "Módulo n · material". Mudar a quantidade acrescenta
  campos vazios no fim ou corta os do fim. Cada campo valida na hora com
  `parseClassLink(…, 'drive')` e mostra o erro ao lado do campo.
- `CourseOptions` (tipo do app) ganha `moduleMaterials: string[]`;
  `DEFAULT_COURSE_OPTIONS` nasce com 4 campos vazios.
- **Criar curso:** "Criar" desabilitado até todo módulo ter link válido; o
  motivo fica ao lado do campo.
- **Página do curso:** o formulário de Opções manda `moduleMaterials` no mesmo
  PATCH de `/options`, só quando quantidade ou links mudaram (comparação por
  conteúdo). Curso antigo: mexer só na idade salva; mexer em "Módulos" ou em
  algum link exige completar todos.
- **Selo "Sem material"** (tom de aviso) na lista de Cursos e no cabeçalho da
  página do curso, ao lado de onde mora o "Sem preço".
- `CatalogErrorKey` + `KNOWN` (`catalog-client.ts`) ganham
  `module_materials_incomplete` e `module_material_invalid`.
- `class-links.ts`: o tipo `drive` aceita `drive.google.com` e
  `docs.google.com`.
- Locales `es-PE`, `pt-BR`, `en` (mesmas chaves): rótulo do módulo, dica,
  erro de campo, os dois `catalog_errors.*`, o selo e a dica do selo.

## Testes

- Domínio: `Course.create` exige os links; `update` sem módulos passa em curso
  antigo; diminuir/aumentar; link de outro host, `http:` e `javascript:`
  recusados; normalização; lista igual não conta como mudança.
- API: rota de opções e de criação respondem 422 com os dois motivos; teste de
  integração do repositório grava e lê `module_materials`.
- App: `parseClassLink` aceita `docs.google.com` em `drive` e segue recusando
  look-alike.

## Documentação no mesmo PR

- `CLAUDE.md` raiz §1: curso tem módulos, cada um com link de material
  (Drive/Docs), exigido na criação e ao mexer nos módulos; curso antigo avisa.
- `packages/db/CLAUDE.md`: nota da `0037`.
- `docs/ROADMAP.md`: Estado da linha do OOC-94 e o quadro Resumo.
- `apps/app/README.md`: "Estado por tela" de Cursos.
