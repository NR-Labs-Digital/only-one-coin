import { z } from "zod";
import { receiptOcrEnvShape } from "./infra/ocr/receiptOcrEnv.js";

export const ConfigSchema = z
  .object({
    // environment
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.string().default("3333").transform((val) => parseInt(val, 10)),
    HOST: z.string().default("0.0.0.0"),

    // database
    REDIS_URL: z.string().min(1),
    DATABASE_URL: z.string().min(1),

    // better-auth
    BETTER_AUTH_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    // Comma-separated origins apps/app is served from — student.* and
    // backoffice.* are two domains on the same Vercel deploy (apps/app/CLAUDE.md,
    // "Dois domínios, um deploy"), and better-auth's own origin check
    // (trustedOrigins, betterAuth.ts) needs every one of them listed or it
    // 403s any host not in the list.
    APP_PUBLIC_URLS: z
      .string()
      .min(1)
      .transform((val) => val.split(",").map((url) => url.trim()).filter(Boolean)),
    // The origin the panel is served from, for links that leave by e-mail —
    // today the staff password reset (OOC-30). One origin, not the list
    // above: an e-mail has to point at exactly one host. Production:
    // https://backoffice.onlyonecoin.edu.pe; locally the apps/app origin.
    // Only the origin is kept (no path, no trailing slash).
    BACKOFFICE_PUBLIC_URL: z
      .string()
      .url()
      .transform((val) => new URL(val).origin),
    // The origin the student portal is served from, for the links in the
    // portal e-mails (activation and reset). Production:
    // https://student.onlyonecoin.edu.pe; locally the apps/app origin.
    // Required: a credentials e-mail pointing nowhere is an approval nobody
    // can use. `fly secrets set` before merging (CLAUDE.md §7).
    PORTAL_PUBLIC_URL: z
      .string()
      .url()
      .transform((val) => new URL(val).origin),

    // Public-route protection (OOC-24). The Turnstile secret pairs with
    // apps/app's NEXT_PUBLIC_TURNSTILE_SITE_KEY — one widget per environment.
    // Required: a captcha that silently switches itself off when a secret is
    // missing is a front door left open without anybody noticing.
    TURNSTILE_SECRET_KEY: z.string().min(1),
    // Shared with apps/app's proxy. Every call from apps/app arrives here from
    // a Vercel IP, so the student's IP travels in a header of its own — and is
    // believed only when this secret comes with it (infra/edge/clientIp.ts).
    // Optional so a deploy never goes down over it (the INTERNAL_API_TOKEN
    // lesson, apps/app/CLAUDE.md): unset, the API falls back to the first
    // X-Forwarded-For hop, which a caller hitting fly.dev directly can forge,
    // and index.ts warns at boot in production.
    // An empty value (the .env.example line copied as is) counts as unset.
    API_PROXY_SECRET: z.preprocess((val) => (val === "" ? undefined : val), z.string().min(32).optional()),

    // storage (Tigris in production, any S3-compatible endpoint locally —
    // OOC-19). The comprovante image never reaches this process's own HTTP
    // function (CLAUDE.md §6); this is only the credential apps/api uses to
    // mint presigned upload targets and to HEAD/GET/PUT/DELETE objects from
    // the normalize worker.
    // Named exactly as `fly storage create` writes them into the app's
    // secrets, so provisioning the bucket is the whole setup.
    AWS_ENDPOINT_URL_S3: z.string().min(1),
    AWS_REGION: z.string().default("auto"),
    BUCKET_NAME: z.string().min(1),
    AWS_ACCESS_KEY_ID: z.string().min(1),
    AWS_SECRET_ACCESS_KEY: z.string().min(1),
    // Tigris (and AWS S3) resolve a bucket from the hostname; a local
    // S3-compatible server (LocalStack, compose.yml) needs the bucket in the path.
    STORAGE_FORCE_PATH_STYLE: z
      .string()
      .default("false")
      .transform((val) => val === "true"),
    // Receipt upload (CLAUDE.md §1, "comprovante" — a phone photo, not a
    // scan; old Android JPEGs run larger than a fresh HEIC). Env constant
    // rather than a `platform_settings` column: unlike the payment
    // tolerance or the checkout hold minutes, nothing in the business rules
    // asks for this to be staff-editable.
    RECEIPT_MAX_UPLOAD_BYTES: z
      .string()
      .default("15000000")
      .transform((val) => parseInt(val, 10)),

    // OCR level 1 (packages/ocr — OOC-20): provider, keys and model ids, in
    // their own module so the ocr:eval script validates them the same way.
    // Same stance as the Brevo key below: without the chosen provider's key
    // receipts are normalized and screened but never read, and index.ts
    // warns at boot — a missing model key never takes the API down. The
    // model id is env so a provider rename is a secret change, not a
    // deploy; every reading records the id it actually used.
    ...receiptOcrEnvShape,

    // e-mail (Brevo, behind NotificationProvider — CLAUDE.md §3). Without a
    // key, e-mails are rendered and logged, never sent — optional even in
    // production, so a deploy never goes down over a missing e-mail secret
    // (index.ts warns at boot instead).
    BREVO_API_KEY: z.string().min(1).optional(),
    // The secret Brevo sends with every webhook call (OOC-91). Brevo does not
    // sign the body, so this static bearer token is the whole proof of origin.
    // Optional like the key — a deploy never goes down over it — but without
    // it the webhook route refuses everything (503): closed, never open.
    BREVO_WEBHOOK_TOKEN: z.string().min(32).optional(),
    // A sender Brevo has verified for this account.
    EMAIL_SENDER_ADDRESS: z.string().email().optional(),
    EMAIL_SENDER_NAME: z.string().min(1).default("Only One Coin"),
    // Outside production, the only recipients that ever get a real e-mail:
    // comma-separated addresses and/or "@domain" entries. Empty = nobody.
    EMAIL_ALLOWLIST: z
      .string()
      .default("")
      .transform((val) =>
        val
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
  })
  .superRefine((config, ctx) => {
    if (config.BREVO_API_KEY && !config.EMAIL_SENDER_ADDRESS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EMAIL_SENDER_ADDRESS"],
        message: "is required when BREVO_API_KEY is set",
      });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse(process.env);
}
