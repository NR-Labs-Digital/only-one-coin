# `@ooc/templates`

A engine de templates do projeto: **todo texto que alguém edita e o código preenche** passa por aqui — contrato do docente, constancia, certificado, e-mail (OOC-123, OOC-60). É LiquidJS, travado para texto editado no backoffice. Nunca crie um `new Liquid()` solto em outro lugar: as travas abaixo só valem dentro deste pacote.

## O que a engine garante

| Garantia | Como |
| --- | --- |
| Só os placeholders do tipo | `check` lê todas as variáveis do template por **análise estática** (sem renderizar) e recusa a que o schema do tipo não oferece, com linha e coluna. `render` nunca roda template que não passa no `check`. |
| Nada lê arquivo | `include`, `render`, `layout` e `block` são recusados no parse (`forbidden_tag`). Um template é um texto só. |
| Valor nunca vira markup | Tipo `html` escapa todo valor (`<script>` sai como texto). Tipo `text` não escapa — assunto de e-mail mostraria `&amp;`. |
| Sem branco silencioso | Filtro inexistente falha no `check`; valor ausente na hora de imprimir falha o `render` (`missing_value`) — e `null` conta como ausente (o modo estrito do Liquid só barra `undefined`, então a engine tira os `null` antes de renderizar). Dentro de `{% if %}` / `unless` e com `\| default:` o ausente é permitido — é assim que o template protege um campo opcional. |
| Com teto | Tamanho do texto (`maxSourceLength`, padrão 100 mil caracteres), tempo de render (`renderLimitMs`, padrão 1 s) e memória. |
| Erro é código | `check` devolve `issues` com `code` (`syntax_error`, `unknown_variable`, `unknown_filter`, `forbidden_tag`, `too_large`); `render` lança `TemplateRenderError` com `code` (`invalid_template`, `invalid_data`, `missing_value`, `limit_exceeded`, `render_failed`). Nunca a mensagem do Liquid — a tela traduz o código (`CLAUDE.md` §4). |

## Filtros nossos

Além dos do Liquid (`upcase`, `size`, `default`, `date`…):

- `money` — centavos inteiros → PEN no idioma do render: `{{ contract.feeCents | money }}` → `S/ 1,500.00`. Dinheiro chega sempre como `*_cents` inteiro (`CLAUDE.md` §6).
- `local_date` — `{{ contract.endsOn | local_date }}` ou `| local_date: "short"` (`short`, `medium`, `long` padrão, `full`). Dia de calendário (`2026-12-31`) sai como aquele dia, sem fuso; instante sai em America/Lima (ou no `timeZone` do render).

## Como usar

```ts
import { z } from "zod";
import { defineTemplateKind, placeholdersOf, TemplateEngine } from "@ooc/templates";

// 1. O tipo: o schema É o catálogo de placeholders. `.describe()` é o texto
//    que o editor mostra ao lado de cada um. A amostra alimenta o preview e
//    é conferida contra o schema na definição.
export const teacherContract = defineTemplateKind({
  key: "teacher_contract",
  format: "html",
  variables: z.object({
    teacher: z.object({
      fullName: z.string().describe("Nombre completo del docente"),
      nationalId: z.string(),
    }),
    contract: z.object({ startsOn: z.string(), endsOn: z.string(), feeCents: z.number().int() }),
  }),
  sample: {
    teacher: { fullName: "Ana Quispe", nationalId: "12345678" },
    contract: { startsOn: "2026-11-01", endsOn: "2026-12-31", feeCents: 150000 },
  },
});

const engine = new TemplateEngine();

// 2. Ao salvar uma edição: recusa com tudo o que está errado, para marcar no editor.
const check = engine.check(teacherContract, source);

// 3. Preview com a amostra, ou documento de verdade com o registro real.
const preview = await engine.renderSample(teacherContract, source, { locale: "es-PE" });
const html = await engine.render(teacherContract, source, data, { locale: "es-PE" });

// 4. O que o editor oferece para inserir: `teacher.fullName`, `groups[].code`…
const list = placeholdersOf(teacherContract);
```

## O que **não** está aqui (ainda)

O pacote só transforma texto + dados em texto. Guardar o modelo versionado, a moldura do documento e a conversão para PDF (WeasyPrint) moram em `apps/api` — ver "Documentos editáveis" no `apps/api/CLAUDE.md`.
