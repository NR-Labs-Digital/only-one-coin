# Contexto de build é a raiz do monorepo, não este diretório — fly.toml
# (raiz) chama `dockerfile = "apps/api/Dockerfile"` e o flyctl usa a raiz
# como contexto por padrão, o que é exatamente o que precisamos pra COPY
# alcançar packages/* (docs/ARCHITECTURE.md §5.2). Rodar localmente com
# `docker build -f apps/api/Dockerfile .` a partir da raiz do repo.

FROM node:22-alpine AS base
RUN corepack enable

# --- deps: só os manifests, pra cache de layer sobreviver a mudança de código ---
FROM base AS deps
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/app/package.json apps/app/package.json
COPY apps/landing/package.json apps/landing/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/notifications/package.json packages/notifications/package.json
COPY packages/ocr/package.json packages/ocr/package.json
COPY packages/templates/package.json packages/templates/package.json
COPY packages/db/package.json packages/db/package.json
# pnpm precisa do manifest de todo workspace member pra validar o lockfile
# compartilhado, mesmo filtrando a instalação só pro grafo do @ooc/api.
RUN pnpm install --frozen-lockfile --filter @ooc/api...

# --- build: compila @ooc/domain, @ooc/queue, @ooc/notifications, @ooc/ocr, @ooc/db e @ooc/api pra dist/ ---
FROM deps AS build
COPY packages/domain packages/domain
COPY packages/queue packages/queue
COPY packages/notifications packages/notifications
COPY packages/ocr packages/ocr
COPY packages/templates packages/templates
COPY packages/db packages/db
COPY apps/api apps/api
RUN pnpm --filter @ooc/domain --filter @ooc/queue --filter @ooc/notifications --filter @ooc/ocr --filter @ooc/templates --filter @ooc/db --filter @ooc/api build
# Empacota só o @ooc/api e suas deps de produção (workspace + npm) num
# diretório autocontido — sem TypeScript/tsx/devDependencies. "--legacy"
# porque este workspace não usa injected dependencies (pnpm 10+ default).
RUN pnpm deploy --filter=@ooc/api --prod --legacy /prod/api

# --- runner: só o resultado do deploy, sem toolchain de build ---
FROM base AS runner
# WeasyPrint: HTML → PDF dos documentos editáveis (OOC-123), chamado como
# comando pelo `WeasyPrintRenderer` (~0,5 s e ~60 MB por render). Motor de
# impressão, não navegador — por isso não um Chromium. DejaVu é a fonte que a
# moldura do documento pede primeiro (`documents/frame.ts`); sem ela o PDF sai
# com a fonte que o fontconfig achar.
RUN apk add --no-cache weasyprint font-dejavu
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /prod/api .
USER node
EXPOSE 3333
CMD ["node", "dist/index.js"]
