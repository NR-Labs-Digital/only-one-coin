# Docentes no banco: tabelas e `teacher_id` na turma (OOC-77)

Desenho aprovado em 11/10/2026. ROADMAP Sessão 36 (Docentes), quebrada em
OOC-77 → 78 → 79 → 80 → 81 → 82. Este é o primeiro passo: base de dados e
entidade de domínio. Nenhuma tela, rota, upload ou vínculo de conta.

## Problema

Docente não existe no banco. A tela Docentes lê `mock-data.ts` (vazio), a
turma guarda o docente como texto livre (`class_groups.teacher_name`) e o
convite de cargo `teacher` sai sem ficha nenhuma (OOC-68). Todo o resto da
Sessão 36 — ficha, contrato vigiado, docente vendo só as próprias turmas —
precisa de uma tabela para apontar.

## Decisões (do dono, 11/10/2026)

1. **Contrato: os três campos `NOT NULL`.** Uma linha de `teacher_contracts`
   só existe quando o contrato foi arquivado; arquivo, início e fim são
   obrigatórios. "Sem contrato" é não ter linha — o mesmo que o mock já faz
   (`contract: null`). Cumpre "os três juntos ou nenhum" (CLAUDE.md §1) sem
   admitir uma linha de contrato vazia.
2. **Contrato é append-only.** Contrato arquivado é prova documental:
   corrigir é arquivar um novo, o antigo fica. Entra na trava de histórico
   com as duas camadas (`REVOKE` + trigger), como `audit_log` e `plan_prices`.
3. **Documento do docente único desde já.** Índice único parcial — a tabela
   nasce vazia, então não há duplicata para consolidar (diferente do aluno,
   CLAUDE.md §1).

Decorrentes do desenho, aprovadas junto:

- **`teachers` entra na trava de delete**, como `students`: "docente nunca é
  apagado" vira regra do banco. `UPDATE` continua (o status muda).
- **Idiomas e disponibilidade em tabelas filhas**, não `jsonb` em
  `teachers`: a busca "quem ensina italiano às terças" é o uso que vem.

## 1. Modelo de dados — migration `0025` (aditiva)

### `teachers`

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | uuid | `uuidPk()` |
| `first_name`, `last_name` | text not null | |
| `national_id_type` | text not null | CHECK `DNI`/`CE`/`passport` (`nationalIdTypeCheck`) |
| `national_id` | text not null | gravado normalizado pelo domínio |
| `email` | text not null | qualquer provedor (a regra do Gmail é do aluno) |
| `phone` | text not null | |
| `nationality` | text not null | ISO 3166-1 alpha-2 — de onde a pessoa é |
| `country` | text not null | ISO alpha-2 — onde mora |
| `region` | text | primeira divisão; null fora do Peru |
| `city` | text not null | |
| `address_line` | text not null | o que falta pra postar uma carta |
| `status` | text not null default `active` | CHECK `active`/`inactive` |
| `user_id` | text | FK `"user"(id)` `restrict`, único — a conta de acesso |
| `created_at`, `updated_at`, `deleted_at` | timestamptz | `timestamps()` + `softDeletable()` |

Índices: único parcial `(national_id_type, national_id) where deleted_at is
null`; único em `user_id` (null não colide).

### `teacher_languages`

`id`, `teacher_id` (FK `restrict`), `language` (text not null — o mesmo texto
de `courses.language`; não há tabela de idiomas, CLAUDE.md §1), `created_at`.
Único `(teacher_id, language)`. Tabela comum: editar a lista apaga e regrava.

### `teacher_availability`

`id`, `teacher_id` (FK `restrict`), `weekday` (CHECK `mon`…`sun`),
`start_time` e `end_time` (`time`), `created_at`. CHECK `start_time <
end_time`; único `(teacher_id, weekday, start_time)`; índice em `teacher_id`.

**Exceção documentada a "timestamptz sempre":** é hora de parede de
`America/Lima`, a mesma coisa que os `slots` da turma (`HH:mm`). Não é um
instante — "terça às 19h" não tem fuso para converter.

Sobreposição de faixas não é garantida no banco (exigiria `btree_gist` e
constraint de exclusão); o domínio recusa.

### `teacher_contracts` (append-only)

| Coluna | Tipo | Nota |
| --- | --- | --- |
| `id` | uuid | |
| `teacher_id` | uuid not null | FK `restrict` |
| `object_key` | text not null, único | chave no storage; bucket fica pro ticket do upload |
| `file_name` | text not null | como o arquivo veio |
| `file_size_bytes` | integer not null | CHECK `> 0` |
| `starts_on`, `ends_on` | timestamptz not null | CHECK `starts_on <= ends_on` |
| `uploaded_by` | text not null | FK `"user"(id)` `restrict` |
| `created_at` | timestamptz | a data de arquivamento |

Sem `updated_at` e sem `deleted_at`: `createdAt()` sozinho declara a tabela
append-only (`packages/db/CLAUDE.md`). Contrato vigente = o mais recente por
`created_at`, lido pela aplicação.

Trava: `REVOKE UPDATE, DELETE ON teacher_contracts FROM ooc_app` + trigger
`forbid_history_rewrite()` `BEFORE UPDATE OR DELETE OR TRUNCATE`.

### `teachers` na trava de delete

`REVOKE DELETE ON teachers FROM ooc_app` + trigger `BEFORE DELETE OR
TRUNCATE`. `teacher_languages` e `teacher_availability` ficam fora: são
listas regravadas, e o histórico que importa (quem deu a turma) está em
`class_groups.teacher_id`.

### `class_groups.teacher_id`

uuid anulável, FK `teachers(id)` `restrict`, índice. `teacher_name` continua
até o contract (expand/contract, CLAUDE.md §7).

A trava e as FKs são SQL escrito à mão na migration (o Drizzle Kit não gera
`REVOKE` nem trigger) — mesmo precedente da `0011` e da `0017`.

## 2. Domínio — `packages/domain/src/teacher/`

- `Teacher extends SoftDeletableModel`: props validadas por zod, com
  `languages: string[]` e `availability: WeeklySlot[]` dentro do agregado —
  o mesmo `WeeklySlotSchema` dos horários da turma (`catalog/ClassGroup.ts`),
  porque uma turma é alocada numa faixa livre do docente.
- Regras de campo reaproveitadas de `student/fields.ts`: nome, documento
  (normalizado e refinado por tipo), telefone. E-mail com formato válido, sem
  a regra do Gmail.
- Disponibilidade: `weekday` válido, `HH:mm`, início antes do fim, faixas do
  mesmo dia sem sobreposição. Idiomas: texto não vazio, sem repetidos.
- `leaveRoster()` / `rejoinRoster()` trocam o status; `isActive` lê. Sair do
  quadro não apaga nada.
- `CreateTeacherSchema` para o cadastro que vem no próximo ticket.
- Sem repositório nem use case.

## 3. Testes (escritos antes do código)

`packages/db` (Postgres migrado):

- contrato sem `object_key`, sem `starts_on` ou sem `ends_on` é recusado;
  `starts_on > ends_on` também; `file_size_bytes = 0` também;
- `UPDATE`, `DELETE` e `TRUNCATE` em `teacher_contracts` recusados;
  `DELETE`/`TRUNCATE` em `teachers` recusados (`privileges.test.ts`);
- `soft-delete.test.ts`: o conjunto exato ganha `teachers`;
- documento duplicado entre docentes vivos é recusado; docente aposentado
  libera o documento;
- `class_groups.teacher_id` apontando para docente inexistente é recusado;
- disponibilidade com `start_time >= end_time` é recusada.

`packages/domain` (unidade): o agregado — documento normalizado, faixa
inválida, sobreposição, idioma repetido, sair e voltar ao quadro.

## 4. Docs no mesmo PR

- `packages/db/CLAUDE.md`: as tabelas, a trava nova, a exceção do `time`, oito
  tabelas com `deleted_at`.
- `CLAUDE.md` raiz §6: lista da trava e "oito tabelas".
- `docs/ARCHITECTURE.md` não ganha nada: ele não descreve o modelo de dados,
  e duplicar o `packages/db/CLAUDE.md` violaria a regra de camada (§10).
- `SoftDeletableModel`: "quem estende" ganha `Teacher`.
- `docs/ROADMAP.md`: Sessão 36, OOC-77 feito.

## Fora

Telas, rotas, upload e bucket do contrato, vínculo conta ↔ docente no
convite, alocação de docente na turma, remoção de `teacher_name`.
