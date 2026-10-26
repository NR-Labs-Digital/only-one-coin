import type { InputHTMLAttributes, ReactNode } from 'react'
import { CheckoutIcon, type CheckoutIconName } from './icons'
import { display } from '@/lib/enrollment/fonts'

/**
 * Presentational primitives for the public checkout. Like the portal's, they
 * never hold copy — every label arrives already translated (`CLAUDE.md` §4).
 *
 * Shapes follow the landing: 20px card radius, pill buttons, and the primary
 * action going blue → yellow on hover with the same coloured lift. A visitor
 * gets here one click from that site, and controls that change shape between
 * the two read as two different products.
 *
 * Sizing follows the column, not the window (`CLAUDE.md` §5, "Layout das
 * telas"). The checkout has no sidebar, but it is capped at a reading width and
 * sits inside a `@container/checkout`, so a card row wraps on the space it
 * actually got.
 */

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'li' | 'form'
}) {
  return (
    <Tag className={`rounded-[1.25rem] border border-line bg-white shadow-card ${className}`}>
      {children}
    </Tag>
  )
}

/**
 * No step number above the title: the rail right above it already says which
 * step this is, in a way that also shows what is behind and ahead. Printing
 * "PASO 2" a second time is the same fact twice, and it pushed the question
 * the reader actually has to answer further down the screen.
 */
export function StepHeading({
  title,
  subtitle,
}: {
  title: string
  subtitle?: string
}) {
  return (
    <header className="mb-5">
      <h1
        className={`${display.className} text-2xl font-semibold leading-tight tracking-[-0.01em] text-ink sm:text-3xl`}
      >
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
      )}
    </header>
  )
}

/**
 * Every field on this form is required, and the asterisk says so on each one
 * rather than once in a line of small print above them. A reader who scrolls
 * back to a half-filled form should not have to remember which of the two
 * conventions this page used.
 *
 * The marker is `aria-hidden` and the requirement is carried to assistive tech
 * by `required` on the control itself — a screen reader announcing "asterisk"
 * after every label is noise, not information.
 */
export function FieldGroup({
  label,
  error,
  hint,
  htmlFor,
  onLeave,
  children,
}: {
  label: string
  error?: string
  hint?: string
  htmlFor?: string
  /** Focus left the field for good — not just moved between its own parts
      (the phone field's dial code and number are one field). */
  onLeave?: () => void
  children: ReactNode
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-1.5"
      onBlur={
        onLeave
          ? (event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onLeave()
            }
          : undefined
      }
    >
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
      >
        {label}
        <span aria-hidden="true" className="ml-1 text-brand-blue">
          *
        </span>
      </label>
      {children}
      {error ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-red-600">
          <CheckoutIcon name="alert" size={14} />
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

const inputBase =
  'w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink outline-none transition placeholder:text-muted-foreground/70 focus:ring-2'

export function TextInput({
  invalid = false,
  className = '',
  ...props
}: { invalid?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={`${inputBase} ${
        invalid
          ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15'
          : 'border-line focus:border-brand-blue focus:ring-brand-blue/15'
      } ${className}`}
    />
  )
}

export function SelectInput({
  invalid = false,
  className = '',
  children,
  ...props
}: {
  invalid?: boolean
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      aria-invalid={invalid || undefined}
      className={`${inputBase} ${
        invalid
          ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15'
          : 'border-line focus:border-brand-blue focus:ring-brand-blue/15'
      } ${className}`}
    >
      {children}
    </select>
  )
}

/**
 * A pickable option — a language, a course, a class group, a payment rail.
 * A real `<button>` rather than a styled `<div>`: the whole first step is
 * keyboard-reachable or it is not usable on a slow phone with a cheap keyboard.
 */
export function ChoiceCard({
  selected,
  disabled = false,
  onSelect,
  title,
  meta,
  aside,
  children,
}: {
  selected: boolean
  disabled?: boolean
  onSelect: () => void
  /** A node, not a string: a class group's week is one line per session. */
  title: ReactNode
  meta?: string
  aside?: ReactNode
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full min-w-0 flex-col gap-1 rounded-2xl border p-4 text-left transition ${
        disabled
          ? 'cursor-not-allowed border-line bg-sky-soft opacity-60'
          : selected
            ? 'border-brand-blue bg-sky ring-2 ring-brand-blue/20'
            : 'border-line bg-white hover:-translate-y-0.5 hover:border-brand-blue/50 hover:bg-sky-soft hover:shadow-card'
      }`}
    >
      <span className="flex w-full items-start justify-between gap-3">
        <span className="min-w-0 text-sm font-semibold text-ink">{title}</span>
        {aside}
      </span>
      {meta && <span className="text-xs text-muted-foreground">{meta}</span>}
      {children}
    </button>
  )
}

/**
 * The landing's dot grid, at its exact spacing. Decoration only, so it is
 * `aria-hidden` and never carries meaning.
 *
 * Used on the screens that are a moment rather than a task — the confirmation
 * and the expiry — and deliberately not on the form: a field that a reader is
 * squinting at does not need a texture behind it.
 */
export function DotGrid({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute size-28 opacity-30 ${className}`}
      style={{
        backgroundImage:
          'radial-gradient(var(--color-brand-blue) 0.15rem, transparent 0.15rem)',
        backgroundSize: '1rem 1rem',
      }}
    />
  )
}

export type NoteTone = 'info' | 'warning' | 'danger' | 'success'

const noteStyles: Record<NoteTone, string> = {
  info: 'border-brand-blue/20 bg-sky text-brand-blue-deep',
  warning: 'border-brand-yellow-deep/25 bg-brand-yellow/10 text-ink',
  danger: 'border-red-600/20 bg-red-50 text-red-800',
  success: 'border-emerald-600/20 bg-emerald-50 text-emerald-800',
}

const noteIcons: Record<NoteTone, CheckoutIconName> = {
  info: 'alert',
  warning: 'alert',
  danger: 'alert',
  success: 'check',
}

export function Note({
  tone,
  children,
}: {
  tone: NoteTone
  children: ReactNode
}) {
  return (
    <p
      className={`flex items-start gap-2 rounded-2xl border px-4 py-3.5 text-sm ${noteStyles[tone]}`}
    >
      <CheckoutIcon name={noteIcons[tone]} size={16} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/**
 * The primary action. Renders an `<a>` when it is given an `href` and a
 * `<button>` otherwise — a control that navigates has to be a link, or it is
 * invisible to a middle click, a long press and a screen reader listing the
 * page's destinations.
 */
export function PrimaryButton({
  children,
  onClick,
  href,
  disabled = false,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  href?: string
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  /* Largura inteira no celular. Num telefone a ação principal do passo é a
     única coisa que a pessoa vai tocar naquela dobra, e uma pílula de 160px
     encostada na direita é a que mais erra o dedo — além de parecer opcional
     ao lado de um formulário que ocupa a tela toda. */
  const className =
    'inline-flex w-full items-center justify-center gap-2 rounded-full bg-brand-blue px-7 py-3.5 text-[0.9375rem] font-bold text-white shadow-blue transition hover:-translate-y-0.5 hover:bg-brand-yellow hover:text-ink hover:shadow-yellow disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none sm:w-auto'

  if (href) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    )
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={className}
    >
      {children}
    </button>
  )
}

export function GhostButton({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      /* Yellow on hover, like the primary — the pair reads as one family. It
         stays outlined rather than filling, so "back" never competes with
         "continue" for the eye. `-deep` for the text because the flat yellow
         is too light to read on white. Disabled drops the hover entirely: a
         control that lights up under the finger and then does nothing reads
         as broken. */
      className="inline-flex w-full items-center justify-center gap-2 rounded-full border-2 border-transparent px-6 py-3.5 text-[0.9375rem] font-bold text-muted-foreground transition hover:border-brand-yellow hover:bg-brand-yellow/10 hover:text-brand-yellow-deep disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent disabled:text-muted-foreground disabled:opacity-60 sm:w-auto"
    >
      {children}
    </button>
  )
}

/** Label / value row used by the price panel and the final review. */
export function SummaryRow({
  label,
  children,
  strong = false,
}: {
  label: string
  children: ReactNode
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`min-w-0 text-right ${
          strong ? 'text-base font-bold text-ink' : 'text-sm font-medium text-ink'
        }`}
      >
        {children}
      </dd>
    </div>
  )
}

/**
 * A linha que fecha um passo: voltar e continuar.
 *
 * No celular os dois empilham e a ação principal fica EM CIMA — daí o
 * `flex-col-reverse`, que inverte só o desenho: na ordem do documento (e do
 * teclado, e do leitor de tela) "voltar" continua vindo antes, como em toda
 * outra largura. A pilha na ordem natural colocaria "voltar" debaixo do polegar
 * e "continuar" longe dele, que é o contrário do que o passo pede.
 *
 * Aqui a janela é a régua mesmo (`sm:`): o checkout público não tem shell
 * roubando largura (CLAUDE.md §5).
 */
export function StepNav({
  back,
  children,
}: {
  /** O botão de voltar. Ausente no primeiro passo, que não tem para onde. */
  back?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      {back ?? <span className="hidden sm:block" />}
      {children}
    </div>
  )
}
