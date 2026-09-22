import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    // @ooc/domain, @ooc/queue e @ooc/db exportam .ts cru sob a condição
    // "development" (dist/ compilado é só pra produção) — sem isso o
    // resolver do Vitest cairia no "default" (dist/) e os testes
    // quebrariam sem um build prévio.
    conditions: ["development"],
  },
  test: {
    // The *.integration.test.ts suites need a real, migrated Postgres and run
    // from vitest.integration.config.ts (`pnpm test:api:db`). Keeping them out
    // here is what lets `pnpm test` stay a pure-domain run with no database.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
    // container.ts builds the app container at import time and validates
    // env eagerly (config.ts) — these let it build in tests without a real
    // Postgres/Redis reachable; no route under test touches either.
    env: {
      NODE_ENV: "test",
      REDIS_URL: "redis://127.0.0.1:6379",
      DATABASE_URL: "postgres://ooc:ooc@localhost:5432/ooc_dev",
      BETTER_AUTH_URL: "http://localhost:3333/api/auth",
      BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
      APP_PUBLIC_URL: "http://localhost:3000",
    },
  },
});
