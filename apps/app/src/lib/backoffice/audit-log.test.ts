import { describe, expect, it } from 'vitest'
import { AUDIT_ACTION_KEYS, AUDIT_ENTITIES, AUDIT_FIELD_KEYS } from '@ooc/domain/audit-catalog'
import en from '@/messages/backoffice/en.json'
import es from '@/messages/backoffice/es-PE.json'
import pt from '@/messages/backoffice/pt-BR.json'
import { auditExportHeader, auditExportLine, type AuditExportLabels } from './audit-export'
import { auditLogSearchParams, parseAuditLogQuery, type AuditLogEntry } from './audit-log-query'

/**
 * OOC-122: every action, entity and field the catalogue can hand the screen
 * has a label in each locale (CLAUDE.md §4 — never a code on screen), the
 * filters survive the URL, and the CSV writes words, not codes.
 */

describe('audit log labels', () => {
  it.each([
    ['es-PE', es],
    ['pt-BR', pt],
    ['en', en],
  ])('%s labels every action, entity and field of the catalogue', (_locale, messages) => {
    const audit = messages.bo.audit_log as {
      action: Record<string, string>
      entity: Record<string, string>
      field: Record<string, string>
    }
    expect([...AUDIT_ACTION_KEYS, 'unknown'].filter((key) => !audit.action[key])).toEqual([])
    expect(AUDIT_ENTITIES.filter((key) => !audit.entity[key])).toEqual([])
    expect(AUDIT_FIELD_KEYS.filter((key) => !audit.field[key])).toEqual([])
  })
})

describe('audit log query in the URL', () => {
  it('keeps what the API accepts and drops the rest', () => {
    expect(
      parseAuditLogQuery({
        from: '2026-10-01',
        to: '2026-02-30',
        actorId: 'u1',
        action: 'payment_approved',
        entity: 'enrollment',
      }),
    ).toEqual({ from: '2026-10-01', to: '', actorId: 'u1', action: 'payment_approved', entity: '' })
  })

  it('swaps a period typed backwards instead of listing nothing', () => {
    const query = parseAuditLogQuery({ from: '2026-10-20', to: '2026-10-01' })
    expect([query.from, query.to]).toEqual(['2026-10-01', '2026-10-20'])
  })

  it('round-trips through search params, leaving out what is empty', () => {
    const query = parseAuditLogQuery({ entity: 'payment', from: '2026-10-01' })
    expect(auditLogSearchParams(query).toString()).toBe('from=2026-10-01&entity=payment')
    expect(parseAuditLogQuery(Object.fromEntries(auditLogSearchParams(query)))).toEqual(query)
  })
})

describe('audit log CSV', () => {
  const labels: AuditExportLabels = {
    column: (key) => `[${key}]`,
    action: (key) => `action:${key}`,
    entity: (key) => `entity:${key}`,
    field: (key) => `field:${key}`,
    role: (role) => `role:${role}`,
    unknownActor: 'gone',
  }

  const entry: AuditLogEntry = {
    id: 'e1',
    at: '2026-10-20T03:30:00.000Z',
    action: 'student_updated',
    entity: 'student',
    subject: { entity: 'student', id: 's1', label: '=Rosa' },
    fields: ['email', 'phone'],
    actor: { id: 'u1', name: 'Ana', role: 'admin' },
  }

  it('writes titles, words and the Lima time, and neutralizes formulas', () => {
    expect(auditExportHeader(labels)).toBe(
      '﻿[date],[action],[entity],[subject],[fields],[actor],[actor_role]\r\n',
    )
    expect(auditExportLine(entry, labels)).toBe(
      "2026-10-19 22:30,action:student_updated,entity:student,'=Rosa,\"field:email; field:phone\",Ana,role:admin\r\n",
    )
  })

  it('names a gone author in words and leaves what is unknown blank', () => {
    expect(auditExportLine({ ...entry, entity: null, subject: null, fields: [], actor: null }, labels)).toBe(
      '2026-10-19 22:30,action:student_updated,,,,gone,\r\n',
    )
  })
})
