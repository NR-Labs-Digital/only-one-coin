---
name: rbac-role-change
description: Checklist for adding, renaming, or retiring a staff role (master, admin, analyst, enrollment_supervisor, academic_supervisor, teacher, sales, support, billing). Use whenever a role name changes anywhere in the codebase, or a screen/route's allowed roles change.
---

# Changing a role — every place it has to move together

This project already shipped one bug from a role rename landing in some files
and not others: `coordinator`/`treasury`/`mass_approver` were retired for
`enrollment_supervisor`/`billing` (dono, 07/09/2026), but stale references
survived for weeks in comments across `apps/app`, `README.md` and
`docs/ROADMAP.md` because nothing forced a full sweep. Treat every role
change as touching **all** of the following, in the same PR:

## 1. Source of truth

- `packages/domain/src/identity/Role.ts` — the `Role` union type and, if the
  change touches who can hold `master`, `MASTER_EMAIL_DOMAINS`/`canHoldMaster`.

## 2. Backend enforcement (`apps/api`)

- Grep every route under `apps/api/src/http/**` for `.roles(...)` calls
  naming the old value — `RouteBuilder`'s `.roles()` takes a `Role` literal,
  so TypeScript will catch most renames at compile time, but a role that's
  only **removed** (not renamed) compiles fine if a route still lists it
  alongside others.
- Deny-by-default (`infra/plugins/authorization.ts`) guarantees every route
  declares *some* auth — it does **not** guarantee the roles listed are the
  ones the business rule actually wants. That's a manual check, not a test
  that runs itself.
- `packages/db/migrations/` — a new **additive** migration updating the
  `CHECK` constraint on `user.role` and `staff_invites.role` (see the pattern
  in `0009_overrated_the_captain.sql`). Never edit an old migration to change
  the constraint — old migrations describe history, not current state
  (`packages/db/CLAUDE.md`).

## 3. Frontend gating (`apps/app`)

- `apps/app/src/lib/backoffice/permissions.ts` — the screen-by-screen matrix.
  This is UI-only gating (hide/show); it is not the security boundary, but it
  has to agree with what the backend actually allows or a screen will render
  buttons that 403 when clicked.
- `apps/app/src/lib/backoffice/types.ts` and any other file with a *comment*
  naming roles (e.g. "required for admin/billing") — comments don't get
  caught by the compiler, and are exactly what went stale last time.

## 4. Documentation (source of truth for prose)

- `CLAUDE.md` §8 (root) — the role list, one-line description of what each
  role can do, and the "Papéis" bullet that documents the old→new mapping if
  this is a rename. This file is cross-cutting on purpose (`apps/app` and
  `apps/api` both need the same vocabulary) — don't fork it into a
  per-app `CLAUDE.md`.
- `README.md` (root) — anywhere a screen's permitted roles are named in the
  "Estado atual" prose.
- `docs/ARCHITECTURE.md` §3 — known pending item: the RBAC table there still
  describes the pre-07/09/2026 role board as of this writing. If you're
  already in this area, updating it closes that gap.

## 5. The sweep that catches what the list above misses

Before opening the PR, grep the **old** name across the whole repo, not just
the files you think you touched — narrative comments (`// o coordenador
confirma`, `// until billing settles it`) don't break any build and are the
easiest thing to miss:

```bash
grep -rn "<old_role_name>" apps packages docs README.md CLAUDE.md \
  --include="*.ts" --include="*.tsx" --include="*.md" --include="*.sql"
```

A hit inside an already-landed migration file (`packages/db/migrations/000*.sql`)
is fine to leave — those are historical and never edited. Everything else is
a real leftover.
