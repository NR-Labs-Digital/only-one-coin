---
name: preview
description: Abre o app local num navegador já logado, para ver uma tela do backoffice funcionando. Sobe Postgres/Redis/S3 no Docker, aplica as migrations, sobe API (3333) e app (3000) se não estiverem no ar, cria uma conta local de preview do cargo pedido, faz o login por HTTP e abre o Chromium do Playwright com a sessão. Use quando pedirem "preview", "quero ver como ficou", "abre a tela", ou para conferir uma mudança de UI antes do PR.
---

# Preview local

```bash
.claude/skills/preview/preview.sh [cargo] [caminho]
```

- **cargo**: `enrollment_supervisor` (padrão), `academic_supervisor`, `analyst`, `sales` ou `support`.
- **caminho**: onde abrir, padrão `/backoffice/home` (ex.: `/backoffice/class-groups`, `/en/backoffice/payments`).

Escolha o cargo pela tela: turmas, cursos, alunos e matrícula manual → `enrollment_supervisor`; docentes → `academic_supervisor`; só leitura → `analyst`. Na dúvida, o padrão.

O script é idempotente: o que já está no ar é reaproveitado, e a conta (`preview.<cargo>@example.com` / `preview1234`) é criada uma vez e devolvida ao cargo pedido nas seguintes. Rode-o em foreground (leva até ~3 min a frio) e repasse a última linha ao usuário. O navegador abre sozinho pelo WSLg.

## O que fica de fora, e por quê

- **`master`, `admin`, `billing`:** pedem código de MFA por e-mail em todo login (`MFA_REQUIRED_ROLES`). O script não contorna isso. Se precisar de uma tela só deles, use `admin@admin.com` / `admin1234` (`seed:admin`) no navegador aberto e leia o código no outbox local (comando em `apps/api/CLAUDE.md`, MFA do staff).
- **Docente e aluno:** a conta deles pendura numa ficha (`teachers.user_id`, `students.user_id`) que o seed não cria.
- **Banco remoto:** `seed:preview` recusa qualquer `DATABASE_URL` que não seja `localhost`/`127.0.0.1`. Nunca rode isso contra staging ou produção.

## Quando falha

Logs em `tmp/preview/` (ignorado pelo Git): `migrate.log`, `api.log`, `app.log`, `seed.log`, `sign-in.json`, `browser.log`. O script para no primeiro passo que falhar e diz qual log ler.

- **Memória do WSL (7,7 GB):** API + `next dev` + Chromium cabem. Não rode `next build` nem o vitest paralelo com o preview aberto.
- **Catálogo vazio:** `pnpm --filter @ooc/api seed:catalog` antes.
- **Para desligar:** feche o navegador; API e app ficam rodando para o próximo preview (`pkill -f "tsx watch"` e `pkill -f "next dev"` para parar).
