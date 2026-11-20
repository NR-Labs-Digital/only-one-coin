import nextPlugin from "@next/eslint-plugin-next";
import i18next from "eslint-plugin-i18next";
import i18nextDefaults from "eslint-plugin-i18next/lib/options/defaults.js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import { baseTypeScriptConfig } from "../../eslint.base.mjs";

export default tseslint.config(
  ...baseTypeScriptConfig(
    tseslint,
    import.meta.dirname,
    [".next/**", "next-env.d.ts", "postcss.config.mjs"],
  ),
  {
    // Registra os plugins e liga só as regras clássicas que o código já
    // referenciava via `eslint-disable-next-line`, com justificativa —
    // sem isso o comentário aponta pra uma regra inexistente (erro) e,
    // registrado mas desligado, vira "unused eslint-disable" (também
    // erro). O resto de cada plugin (as novas regras do React Compiler
    // em eslint-plugin-react-hooks 7.x, o restante do "recommended" do
    // Next) fica fora — não auditado, além do escopo desta issue (só
    // no-floating-promises/no-literal-string). Severidade igual ao
    // padrão de cada plugin, não inventada aqui.
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@next/next/no-img-element": "warn",
      "@next/next/no-html-link-for-pages": "warn",
    },
  },
  {
    // Portão de CI item 4 (CLAUDE.md §6/§4) — string de UI fora do locale.
    // Modo jsx-only: pega texto em JSX *e* nos atributos configurados abaixo
    // (placeholder, alt, title, aria-*) — "jsx-text-only" (o default do
    // plugin) ignora atributo por completo, checado na fonte da regra.
    // `src/messages/**/*.json` (os arquivos de locale em si) não é .ts/.tsx,
    // então nem entra no escopo desta regra.
    files: ["src/**/*.{ts,tsx}"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          "jsx-attributes": {
            include: ["placeholder", "alt", "title", "label", "aria-label", "aria-description"],
          },
          // Nome da marca, mesma exceção do glossário (CLAUDE.md §4) que já
          // cobre Yape/Plin/BCP — não traduz, aparece igual nos três idiomas.
          // Reaproveita a lista default (dígitos, tudo-maiúsculo, entidade
          // HTML, emoji) em vez de reescrevê-la — `words` não faz merge
          // profundo com o default do plugin.
          words: { exclude: [...i18nextDefaults.words.exclude, "Only One Coin"] },
        },
      ],
    },
  },
  {
    // OOC-92: the backoffice's mock dataset is gone — every screen reads
    // `apps/api`, and a screen that has no API yet says so instead of drawing
    // invented rows (the reports screen showed made-up figures in production
    // for weeks because of one). No route, component or helper of the staff
    // surfaces may import a mock again. `*` stands for `[locale]`: a bracket
    // in a glob is a character class. The campaign screen's empty audience
    // (`emails/new/campaign-audience.ts`) is not a dataset and is not caught.
    files: [
      "src/app/*/backoffice/**/*.{ts,tsx}",
      "src/app/*/docente/**/*.{ts,tsx}",
      "src/components/backoffice/**/*.{ts,tsx}",
      "src/lib/backoffice/**/*.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/mock-data", "**/mock-data.*", "**/*mock*"],
              message:
                "The backoffice reads apps/api, never a mock dataset (OOC-92). A screen without an API shows an empty state.",
            },
          ],
        },
      ],
    },
  },
);
