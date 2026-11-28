# Restaurar um backup do banco (OOC-50)

Passo a passo para provar que o backup de produção restaura. Repetir **a cada trimestre** (`CLAUDE.md` §6, "Backup nunca restaurado") e sempre que o formato do backup mudar.

## O que é o backup

A cada deploy da API, antes da migration, o job `backup-and-migrate` (`.github/workflows/deploy-api.yml`) roda `pg_dump` (cliente 18) contra o banco de produção e sobe o arquivo para o Tigris:

- bucket `only-one-coin-backups`, endpoint `https://t3.storage.dev`
- nome `ooc-prod-AAAAMMDDTHHMMSSZ.sql.gz` (hora UTC), SQL puro em gzip
- retenção de 30 dias

Não há backup agendado: o do deploy é a política (`CLAUDE.md` §3).

## Onde restaurar

**Num banco vazio, criado só para o ensaio, e apagado no fim.** O backup é dado real de aluno (Ley 29733), então:

- **Nunca em staging.** Staging não recebe dado real (`CLAUDE.md` §7). O "Pronto quando" da sessão 55 do `docs/ROADMAP.md` diz "em staging", e isso contradiz a regra; a reescrita espera confirmação do dono.
- **Nunca em produção.** O script recusa qualquer banco que já tenha tabelas, e produção nunca está vazia.
- **Opção recomendada:** um Postgres 18 local, como o do `compose.yml`. Serve também um banco novo e vazio em qualquer servidor Postgres 18 que não seja o de produção. Cópia do banco de produção (branch, snapshot) não serve: nasce com dados ou schema, e o script recusa banco que não está vazio.

## O que é preciso

- Chaves do Tigris com leitura no bucket `only-one-coin-backups`, em `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY`, e o `aws` CLI.
- `psql` 18: o script usa `PG_BIN`, depois o `psql` do PATH, e por último a imagem `postgres:18-alpine` via `docker`. Cliente mais velho que 18 é recusado, porque o dump vem de um servidor 18.
- A connection string do banco vazio.

## Passo a passo

1. **Criar o banco vazio** (por exemplo `ooc_restore_drill`). Localmente: `docker compose exec postgres psql -U ooc -d ooc_dev -c "create database ooc_restore_drill"`.

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

5. **Apagar o banco do ensaio.** Localmente: `drop database ooc_restore_drill`. Dado real não fica parado num banco esquecido.

## Pela tela do backoffice (OOC-153)

A área **NR Labs → Backups** (`/backoffice/platform/backups`, só contas dos domínios dos donos) lista os backups do bucket. **Em produção ela não restaura** (28/11/2026): a restauração pela tela criava o banco do ensaio pela API do Neon, e a plataforma vai sair do Neon — o alvo foi retirado e um destino que não dependa de provedor ficou para depois, por falta de recurso agora. Até lá, o ensaio de produção é o passo a passo acima, e a tela diz que o ambiente lista mas não restaura.

Localmente (`BACKUP_RESTORE_ADMIN_URL` apontando para o Postgres do `compose.yml`) a tela faz os passos 1 a 3 sozinha: cria um banco novo, restaura o backup escolhido (digitando o nome dele), confere e mostra o relatório. **Se qualquer verificação falhar, o banco novo é apagado na hora.** O que passa fica guardado até alguém clicar em *Eliminar base restaurada* (passo 5). Mecanismo em `apps/api/CLAUDE.md`, "Restaurar backup".

Verificações da tela, além das do script: as tabelas das quais nada se apaga (`students`, `payments`, `audit_log`) não podem ter mais linhas no backup que no banco de agora — mais quer dizer que o arquivo não é backup deste banco.

Para a tela listar em produção basta `fly secrets set BACKUP_BUCKET_NAME=only-one-coin-backups` (e `BACKUP_ACCESS_KEY_ID`/`BACKUP_SECRET_ACCESS_KEY` só leitura, se as chaves do Tigris da API não leem o bucket). Nenhum é obrigatório para o deploy.

## Restaurar de verdade (incidente)

Este passo a passo prova que o backup volta, mas não troca o banco de produção. Num incidente real, o caminho é restaurar num banco novo como acima, conferir e só então apontar a `DATABASE_URL` da API para ele (`fly secrets set`). Enquanto o banco estiver no Neon, o *point-in-time restore* dele volta minutos e não um deploy inteiro, mas o plano é sair do Neon e não contar com ele. Esse procedimento ainda não foi ensaiado e é decisão do dono na hora.

A área do backoffice que restaura backup (OOC-153, seção acima) só restaura num banco novo — a troca da produção continua sendo este passo manual.

## Histórico de ensaios

| Data | Backup | Onde | Resultado | Quem |
| --- | --- | --- | --- | --- |
| 27/11/2026 | dump do `ooc_dev` local, mesmo formato; e o mesmo dump cortado ao meio | Postgres 18 local, pelo worker da OOC-153 (`LocalPostgresRestoreTarget`) | OK: dump inteiro restaurado em ~2 s, 325 alunos, 5 verificações aprovadas; o cortado falhou como `dump_corrupt` e o banco novo foi apagado. Prova o caminho da tela, não o backup de produção nem o Neon. | Claude (OOC-153) |
| 10/11/2026 | dump do `ooc_dev` local, no mesmo formato do deploy | Postgres 18 local (`ooc_restore_drill`) | OK: 309 alunos, 41 tabelas, 51 migrations, trava da `audit_log` ativa, ~1 s. Recusou banco não vazio e confirmação errada. Prova o script, não o backup de produção. | Claude (OOC-50) |
