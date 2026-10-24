import os from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * How many test processes to run at once. Each one imports the whole API
 * (Fastify, Better Auth, sharp, the AWS SDK) and holds ~300 MB; vitest's
 * default of one per core asked a 16-core WSL with 7.7 GB for 4 GB+ on top of
 * the dev servers, and the machine started killing processes. Locally the
 * count follows the memory free right now (~700 MB of headroom per process,
 * at most 4 — 4 ran the suite in ~30 s); CI keeps vitest's default.
 * `VITEST_MAX_WORKERS` overrides both.
 */
function maxWorkers(): number | undefined {
  const forced = Number(process.env.VITEST_MAX_WORKERS);
  if (forced > 0) return forced;
  if (process.env.CI) return undefined;
  const fitting = Math.floor(os.freemem() / (700 * 1024 * 1024));
  return Math.max(1, Math.min(fitting, 4));
}

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
    maxWorkers: maxWorkers(),
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
      APP_PUBLIC_URLS: "http://localhost:3000",
      BACKOFFICE_PUBLIC_URL: "http://localhost:3000",
      PORTAL_PUBLIC_URL: "http://localhost:3000",
      AWS_ENDPOINT_URL_S3: "http://localhost:9000",
      BUCKET_NAME: "test-bucket",
      AWS_ACCESS_KEY_ID: "test-access-key",
      AWS_SECRET_ACCESS_KEY: "test-secret-key",
      // Cloudflare's always-passes test secret; no test calls siteverify.
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    },
  },
});
