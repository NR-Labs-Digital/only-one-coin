# Restaurar um backup do banco (OOC-50)

Passo a passo para provar que o backup de produção restaura. Repetir **a cada trimestre** (`CLAUDE.md` §6, "Backup nunca restaurado") e sempre que o formato do backup mudar.

## O que é o backup

A cada deploy da API, antes da migration, o job `backup-and-migrate` (`.github/workflows/deploy-api.yml`) roda `pg_dump` (cliente 18) contra o Neon de produção e sobe o arquivo para o Tigris:

- bucket `only-one-coin-backups`, endpoint `https://t3.storage.dev`
- nome `ooc-prod-AAAAMMDDTHHMMSSZ.sql.gz` (hora UTC), SQL puro em gzip
- retenção de 30 dias

Não há backup agendado: o do deploy é a política (`CLAUDE.md` §3).

## Onde restaurar

**Num banco vazio, criado só para o ensaio, e apagado no fim.** O backup é dado real de aluno (Ley 29733), então:

- **Nunca em staging.** Staging não recebe dado real (`CLAUDE.md` §7). O "Pronto quando" da sessão 55 do `docs/ROADMAP.md` diz "em staging", e isso contradiz a regra; a reescrita espera confirmação do dono.
- **Nunca em produção.** O script recusa qualquer banco que já tenha tabelas, e produção nunca está vazia.
- **Opção recomendada:** um banco novo e vazio no projeto do Neon (`sa-east-1`). Um branch do Neon não serve: ele nasce com os dados (ou com o schema) do pai, e o script recusa banco que não está vazio. Outra opção é um Postgres 18 local, como o do `compose.yml`.

## O que é preciso

- Chaves do Tigris com leitura no bucket `only-one-coin-backups`, em `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY`, e o `aws` CLI.
- `psql` 18: o script usa `PG_BIN`, depois o `psql` do PATH, e por último a imagem `postgres:18-alpine` via `docker`. Cliente mais velho que 18 é recusado, porque o dump vem de um servidor 18.
- A connection string do banco vazio.

## Passo a passo

1. **Criar o banco vazio.** No Neon: *Databases → New database* (por exemplo `ooc_restore_drill`) e copiar a connection string. Localmente: `docker compose exec postgres psql -U ooc -d ooc_dev -c "create database ooc_restore_drill"`.

2. **Restaurar o backup mais recente.**

   ```bash
   export AWS_ACCESS_KEY_ID=...        # leitura no bucket de backups
   export AWS_SECRET_ACCESS_KEY=...
   scripts/restore-backup.sh --target "postgres://...ooc_restore_drill?sslmode=require"
   ```

   Para escolher um backup: `--key ooc-prod-20261110T120000Z.sql.gz`. Para um arquivo já baixado: `--file caminho.sql.gz` (não precisa do Tigris).

   O script confere se o banco está vazio, baixa e testa o gzip, e pede que você **digite o nome do banco** antes de escrever. `--yes` pula essa confirmação.

   A restauração roda numa transação só, e o primeiro erro desfaz tudo. As linhas `ALTER ... OWNER TO` saem, porque o papel dono de produção não existe no destino. Se o destino também não tiver o papel `ooc_app`, os `GRANT` falham: rode com `--skip-acl`.

3. **Ler a conferência que o script imprime:**
   - contagem de linhas das tabelas principais (`students`, `enrollments`, `payments`, `grades`, `audit_log`...);
   - quantas migrations o backup tem, comparado com o repositório. O backup roda antes da migration do deploy, então pode estar uma ou mais atrás;
   - a trava append-only da `0011`: um `UPDATE` em `audit_log` precisa ser recusado.

   Compare as contagens com produção, se tiver acesso de leitura, ou com a tela do backoffice (Alunos, Pagos).

4. **Registrar o resultado** na OOC-50, ou no ticket do ensaio do trimestre: data, qual backup (`ooc-prod-...`), tempo de restauração, contagens e quem rodou.

5. **Apagar o banco do ensaio.** No Neon: *Delete database*. Localmente: `drop database ooc_restore_drill`. Dado real não fica parado num banco esquecido.

## Pela tela do backoffice (OOC-153)

A área **NR Labs → Backups** (`/backoffice/platform/backups`, só contas dos domínios dos donos) faz os passos 1 a 3 acima sozinha: cria um banco novo no Neon, restaura o backup escolhido (digitando o nome dele), confere e mostra o relatório. **Se qualquer verificação falhar, o banco novo é apagado na hora** e a produção não é tocada. O que passa fica guardado até alguém clicar em *Eliminar base restaurada* (passo 5). Mecanismo em `apps/api/CLAUDE.md`, "Restaurar backup".

Verificações da tela, além das do script: as tabelas das quais nada se apaga (`students`, `payments`, `audit_log`) não podem ter mais linhas no backup que na produção de agora — mais quer dizer que o arquivo não é backup desta produção.

**Ligar em produção (uma vez, fora do Git):**

1. No Neon, criar um **branch só para restauração** (não usar o de produção: a carga dividiria a compute com o site) e anotar o id dele e o papel dono (`neondb_owner`, normalmente).
2. Criar uma chave da API do Neon (*Account → API keys*).
3. `fly secrets set NEON_API_KEY=... NEON_PROJECT_ID=... NEON_RESTORE_BRANCH_ID=... NEON_RESTORE_ROLE=... BACKUP_BUCKET_NAME=only-one-coin-backups`. Se as chaves do Tigris da API não leem o bucket de backups, também `BACKUP_ACCESS_KEY_ID`/`BACKUP_SECRET_ACCESS_KEY` (só leitura).

Sem esses secrets a tela abre e diz que o ambiente não lista ou não restaura — nenhum é obrigatório para o deploy.

## Restaurar de verdade (incidente)

Este passo a passo prova que o backup volta, mas não troca o banco de produção. Num incidente real, o caminho é restaurar num banco novo como acima, conferir e só então apontar a `DATABASE_URL` da API para ele (`fly secrets set`). Antes disso, avalie o *point-in-time restore* do próprio Neon, que volta minutos e não um deploy inteiro. Esse procedimento ainda não foi ensaiado e é decisão do dono na hora.

A área do backoffice que restaura backup (OOC-153, seção acima) só restaura num banco novo — a troca da produção continua sendo este passo manual.

## Histórico de ensaios

| Data | Backup | Onde | Resultado | Quem |
| --- | --- | --- | --- | --- |
| 27/11/2026 | dump do `ooc_dev` local, mesmo formato; e o mesmo dump cortado ao meio | Postgres 18 local, pelo worker da OOC-153 (`LocalPostgresRestoreTarget`) | OK: dump inteiro restaurado em ~2 s, 325 alunos, 5 verificações aprovadas; o cortado falhou como `dump_corrupt` e o banco novo foi apagado. Prova o caminho da tela, não o backup de produção nem o Neon. | Claude (OOC-153) |
| 10/11/2026 | dump do `ooc_dev` local, no mesmo formato do deploy | Postgres 18 local (`ooc_restore_drill`) | OK: 309 alunos, 41 tabelas, 51 migrations, trava da `audit_log` ativa, ~1 s. Recusou banco não vazio e confirmação errada. Prova o script, não o backup de produção. | Claude (OOC-50) |
