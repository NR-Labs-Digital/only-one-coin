import { describe, expect, it } from 'vitest'
import { routeForHost } from './host-routing'

const LOCALES = ['es', 'en', 'pt'] as const
const route = (host: string | null, pathname: string, search = '') => routeForHost(host, pathname, search, LOCALES)

const BACKOFFICE = 'backoffice.onlyonecoin.edu.pe'
const STUDENT = 'student.onlyonecoin.edu.pe'
const TEACHER = 'teacher.onlyonecoin.edu.pe'

describe('routeForHost — teacher domain', () => {
  it('serves the teacher portal at the root', () => {
    expect(route(TEACHER, '/')).toEqual({ kind: 'rewrite', pathname: '/docente' })
    expect(route(TEACHER, '/home')).toEqual({ kind: 'rewrite', pathname: '/docente/home' })
    expect(route(TEACHER, '/en')).toEqual({ kind: 'rewrite', pathname: '/en/docente' })
    expect(route(TEACHER, '/pt/class-groups/abc')).toEqual({ kind: 'rewrite', pathname: '/pt/docente/class-groups/abc' })
  })

  it('leaves a path that already names the portal alone', () => {
    expect(route(TEACHER, '/docente/home')).toEqual({ kind: 'pass' })
    expect(route(TEACHER, '/en/docente')).toEqual({ kind: 'pass' })
  })

  it('serves the shared staff account screens, so a teacher invite starts its session here', () => {
    expect(route(TEACHER, '/backoffice/invite/tok')).toEqual({ kind: 'pass' })
    expect(route(TEACHER, '/en/backoffice/reset-password/tok')).toEqual({ kind: 'pass' })
  })

  it('sends the rest of the panel to its own domain', () => {
    expect(route(TEACHER, '/backoffice/home', '?x=1')).toEqual({
      kind: 'redirect',
      url: `https://${BACKOFFICE}/backoffice/home?x=1`,
    })
    expect(route(TEACHER, '/backoffice')).toEqual({ kind: 'redirect', url: `https://${BACKOFFICE}/backoffice` })
  })
})

describe('routeForHost — the portal moves off the other domains', () => {
  it('redirects /docente on the student and backoffice domains, keeping locale and query', () => {
    expect(route(STUDENT, '/docente/home')).toEqual({ kind: 'redirect', url: `https://${TEACHER}/docente/home` })
    expect(route(BACKOFFICE, '/en/docente', '?mfa=challenge')).toEqual({
      kind: 'redirect',
      url: `https://${TEACHER}/en/docente?mfa=challenge`,
    })
  })
})

describe('routeForHost — backoffice domain (unchanged)', () => {
  it('serves the panel under /backoffice', () => {
    expect(route(BACKOFFICE, '/')).toEqual({ kind: 'rewrite', pathname: '/backoffice' })
    expect(route(BACKOFFICE, '/en')).toEqual({ kind: 'rewrite', pathname: '/en/backoffice' })
    expect(route(BACKOFFICE, '/payments')).toEqual({ kind: 'rewrite', pathname: '/backoffice/payments' })
    expect(route(BACKOFFICE, '/pt/students/1')).toEqual({ kind: 'rewrite', pathname: '/pt/backoffice/students/1' })
    expect(route(BACKOFFICE, '/backoffice/home')).toEqual({ kind: 'pass' })
  })
})

describe('routeForHost — one origin serves all', () => {
  it('passes everything on the student domain, local and preview hosts', () => {
    expect(route(STUDENT, '/portal')).toEqual({ kind: 'pass' })
    expect(route('localhost:3000', '/docente/home')).toEqual({ kind: 'pass' })
    expect(route('localhost:3000', '/backoffice')).toEqual({ kind: 'pass' })
    expect(route(null, '/docente')).toEqual({ kind: 'pass' })
  })
})
