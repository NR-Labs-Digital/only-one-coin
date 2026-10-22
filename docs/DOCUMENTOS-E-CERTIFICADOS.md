# Documentos e certificados

Decisões fechadas na sessão de 19/08/2026. Complementa `CLAUDE.md` (fonte da
verdade) e `docs/REGRAS-NEGOCIO.md` (o que a instituição já pratica hoje).

As decisões de regra de negócio e de papéis já estão refletidas no
`CLAUDE.md` (§1 e §8); este documento guarda o detalhe que não cabe lá.

---

## 1. Dois conceitos que não se misturam

| | Documento emitido | Arquivo anexado |
| --- | --- | --- |
| Quem cria | A instituição, via sistema | Aluno (portal) ou equipe (backoffice) |
| O que é | PDF gerado, com **código de verificação** | Upload cru (DNI, consentimento) |
| Página pública de validação | Sim | **Nunca** |
| Tipos | `enrollment_certificate`, `certificate` | `national_id`, `guardian_consent`, `receipt`, `other` |

A separação é dura: um PDF subido à mão não tem como ser verificado, então
tratá-lo como documento faria a página pública de validação mentir. São tabelas
diferentes e blocos diferentes na tela.

**Upload de arquivo pelo aluno** é superfície nova e herda o que já vale para o
comprovante (`CLAUDE.md` §5 e §8): signed URL direto ao Storage, bucket privado,
caminho escopado por aluno, validação por magic bytes, re-encode e teto de
tamanho. A rota de upload não confia em nenhum id vindo do cliente.

---

## 2. Constancia de matrícula — procedimento **pago**

`docs/REGRAS-NEGOCIO.md` §5: a constancia custa **S/25**, cobrada à parte, como
qualquer procedimento administrativo. Não é um botão grátis.

O fluxo reaproveita o motor da matrícula inteiro — nada de pasarela de pago
(`CLAUDE.md` §2):

```
aluno pede a constancia no portal
  → paga a taxa por Yape/transferência (fora do sistema, como hoje)
  → sobe o comprovante
  → mesma escada de OCR valida contra o valor vigente da taxa
  → aprovado: documento emitido + e-mail disparado
  → duvidoso: mesma fila de revisão humana
```

Modelado como `DocumentRequest`: `feeCents` congelado no momento do pedido
(mesma regra do preço versionado, `CLAUDE.md` §5), `paymentStatus` reusando a
máquina de estados de pagamento. Vira `DocumentItem` só quando o pagamento é
aprovado.

Outros procedimentos da mesma tabela (exame de rezagados S/10, repetir módulo
S/20, cambio de e-mail S/5, congelamento S/10) têm o mesmo formato. Se forem
entrar na plataforma, entram como o mesmo conceito — **solicitação com pagamento
associado** — não como fluxos separados.

---

## 3. Certificado de finalização — emissão em lote por turma

Grátis, dentro de **25 dias úteis** após o término do curso
(`docs/REGRAS-NEGOCIO.md` §6).

### Por que em lote

Emissão individual pela ficha do aluno não sobrevive ao volume (`CLAUDE.md` §1:
5.000/mês normal, até 20.000/mês no pico). O lote é **por `class_group`**: o
coordenador confirma uma vez e a turma inteira sai.

```
turma termina
  → aparece na lista de turmas com "N por emitir"
  → coordenação abre a turma, vê a prévia de quem qualifica e quem fica fora (com o motivo)
  → confirma uma vez
  → job na fila: gera N PDFs
  → cada documento emitido grava 1 linha na outbox
  → worker manda o e-mail (Brevo, template versionado)
```

### Estado da turma: `finished` ≠ `closed`

Uma turma **não** vira "encerrada" quando todos os certificados saíram — quem
reprovou (nota < 14) ou levou DA nunca recebe um, então essa regra deixaria
qualquer turma com reprovação aberta para sempre. São dois estados:

| Estado | Significa | Onde aparece |
| --- | --- | --- |
| `finished` | As aulas acabaram, ainda falta emitir | Seção "fechadas", com aviso |
| `closed` | Todo mundo que qualificava recebeu | Seção "fechadas", sem aviso |

A tela de turmas separa ativas (`enrolling`, `in_progress`) das fechadas
(`finished`, `closed`). A seção de fechadas ordena por pendência, mostra a
contagem no cabeçalho e **abre sozinha** enquanto houver certificado a emitir —
esconder isso atrás de uma seção colapsada é como se perde o prazo de 25 dias
úteis.

A lista de fechadas **pagina de 10 em 10**: turma fechada só acumula, e um ano
de turmas empurraria as ativas para fora da tela. A ordenação por pendência é o
que garante que paginar não esconda o que falta emitir — o que está pendente
está sempre na primeira página, e a contagem no cabeçalho é do total, não da
página.

### Gate humano, sempre

O sistema **não** dispara sozinho quando a data de término passa. Quem concluiu
e quem não concluiu é decisão da coordenação; automatizar por data mandaria
certificado para quem abandonou. O sistema deixa a lista pronta e o botão à mão
— o clique é de gente.

### Quem qualifica

Ordem de checagem (o primeiro motivo bloqueante vence), em
`apps/app/src/lib/backoffice/certificates.ts` no mockup e num usecase de
`packages/domain` no sistema real — **nunca** no navegador (`CLAUDE.md` §8):

1. `already_issued` — já emitido
2. `payment_not_approved` — pagamento sem aprovar
3. `enrollment_not_completed` — matrícula sem fechar
4. `auto_failed` — DA, não rendeu exame final
5. `grade_pending` — nota ainda não fechada
6. `grade_below_minimum` — nota < **14** (`docs/REGRAS-NEGOCIO.md` §3)
7. `exam_not_approved` — curso com regra de exame e o aluno não o aprovou

### Exceção: Inglés Básico

`certificateRule: 'exam_required'`. O certificado exige concluir os 4 módulos
**e** solicitar o exame de certificação (`docs/REGRAS-NEGOCIO.md` §6). Quem não
o prestou fica fora do lote, com o motivo na tela. Nota mínima **não** basta.

### Nota mínima e taxa: configuráveis

Nota mínima (14), prazo do certificado (25 dias úteis) e taxa da constancia
(S/25) são **configuração de backoffice** desde a OOC-41 (22/10/2026):
`platform_settings.passing_grade`, `certificate_deadline_business_days` e
`constancia_fee_cents`, editáveis em Configuração e lidos pelas telas de notas,
certificados e documentos — nunca constante no código (`apps/api/CLAUDE.md`,
"Configurações da plataforma").

---

## 4. O e-mail é consequência da emissão, nunca um botão

Regra central: **não existe "enviar e-mail" por documento**. Emitir um documento
grava uma linha na `outbox`; o worker envia. Um botão de envio por documento é
exatamente o trabalho manual que o volume torna impossível.

- Idempotência por `(document_id, template)` — reprocessar a fila não manda duas
  vezes.
- **Reenviar** existe como exceção auditada: e-mail que voltou (o caso clássico
  do Gmail sem espaço, `docs/REGRAS-NEGOCIO.md` §7), aluno que perdeu. Vai para
  o `audit_log` com autor e data.
- Templates: `enrollment_certificate_issued` e `certificate_issued`,
  versionados no repositório (`CLAUDE.md` §5).
- Estado de entrega por documento: `not_sent | queued | sent | failed`,
  espelhando a outbox.

---

## 5. Quem pode emitir

| Papel | Emite avulso | Dispara o lote da turma |
| --- | --- | --- |
| `admin` | Sim | Sim |
| `coordinator` | Sim | Sim |
| `teacher` | Sim, **só nas próprias turmas** | Sim, **só nas próprias turmas** |
| `treasury` | Não | Não |
| `mass_approver` | Não | Não |

Na tela, o botão "Nova turma" só aparece para `admin` e `coordinator`
(`permissions.ts`) — docente conduz turma, não abre turma. Isso é conveniência
de tela; quem barra de verdade é a rota em `apps/api`.

O escopo do docente é checado no usecase, comparando o `teacher_id` do usuário
autenticado com o da turma — nunca um filtro montado a partir de input do
cliente (`CLAUDE.md` §8). Toda emissão (avulsa ou em lote) e todo reenvio vão
para o `audit_log` append-only.

---

## 6. Onde isso está no código (fase de mockup)

| Peça | Arquivo |
| --- | --- |
| Tipos de domínio | `apps/app/src/lib/backoffice/types.ts` |
| Elegibilidade + prazo | `apps/app/src/lib/backoffice/certificates.ts` |
| Gates de tela por papel | `apps/app/src/lib/backoffice/permissions.ts` |
| Aba Documentos da ficha | `apps/app/src/app/[locale]/backoffice/(panel)/students/[studentId]/student-documents.tsx` |
| Lista de turmas (busca, filtros, agrupamento) | `apps/app/src/app/[locale]/backoffice/(panel)/class-groups/class-groups-view.tsx` |
| Turma + lote | `apps/app/src/app/[locale]/backoffice/(panel)/class-groups/[classGroupId]/` |
| Procedimentos por matrícula (§5 de `REGRAS-NEGOCIO.md`) | `apps/app/src/lib/backoffice/enrollment-procedures.ts` |
| Catálogo de cursos + opções | `apps/app/src/app/[locale]/backoffice/(panel)/courses/` |

Tudo em estado local: não há backend. A escrita real passa por `apps/api`,
nunca pelo navegador (`CLAUDE.md` §8).

---

## 7. Em aberto

- **Prazo de 25 dias úteis** ignora feriados peruanos — falta um calendário de
  feriados. Contar só fins de semana faz o prazo mentir a favor da instituição.
- **Página pública de validação** (`docs/ROADMAP.md` item 45) substitui o site
  externo usado hoje (`ooc.asvnets.com/consultar`, busca por DNI). Formato do
  código de verificação ainda não fechado.
- **Demais procedimentos pagos** (§2) — confirmar se entram na plataforma e se
  compartilham o fluxo de solicitação com pagamento. A tela de turmas já
  registra três deles (mover de turma, congelar, retirar) como **registro do
  que já foi pago e combinado fora da plataforma**, não como execução: o
  backoffice pede confirmação da taxa antes de liberar o botão. Falta amarrar
  isso a um pagamento aprovado de verdade, como a constancia do §2.
- **Retirada/cancelamento de matrícula não tem regra.** Nenhuma fonte define
  devolução, prazo ou consequência — a tela libera a vaga e diz que a regra não
  existe. Confirmar com a Asociación antes de tratar isso como fluxo pronto.
- **Traspaso × cambio de horário.** `docs/REGRAS-NEGOCIO.md` §5 cobra S/10 por
  um e nada pelo outro; `docs/REQUISITOS.md` RF11 já sinaliza que RF11/RF12/RF13
  podem ser a mesma coisa. A tela mostra S/10 por ora.
- **Formato do código da turma.** A tela mostra um `code` por turma — no mock,
  três letras do idioma mais uma sequência de 4 dígitos (`ALE-0002`). Nível e
  ciclo saíram do código de propósito: o nome do curso já diz o nível e o
  período tem coluna própria, então repeti-los só alongava a etiqueta. A
  sequência **não zera** a cada período, senão `ING-0001` existiria em dois
  ciclos e a busca ficaria ambígua — e é por isso que ela tem 4 dígitos: com o
  volume do `CLAUDE.md` §1 e uma sequência que nunca zera, 2 dígitos acabariam. É dado de catálogo, não id técnico — por isso pode aparecer na tela
  (`CLAUDE.md` §4) — mas o formato real ainda não foi confirmado com a
  Asociación.
- **Nome do período.** `academicPeriodName` aparece como "Ciclo 2026-II" no
  mock; é invenção do mockup. Falta confirmar se a instituição agrupa a venda em
  períodos nomeados e como os chama.
- **Idioma como dado, não como enum traduzido.** `language.name` vem do
  catálogo, junto com o nome do curso — é o que permite abrir um idioma novo sem
  tocar em código nem nos três arquivos de locale (`CLAUDE.md` §1: nada
  específico de idioma no código). O custo é que o nome do idioma não é
  traduzido por locale; se isso incomodar, o catálogo passa a guardar um nome
  por idioma da interface.
- **Notas** — a tela de turma exibe nota final e DA, mas o lançamento de notas
  (hoje no Classroom) não foi desenhado. `docs/ROADMAP.md` item 7 prevê a tabela
  `grades`.
