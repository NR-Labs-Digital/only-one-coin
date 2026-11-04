'use client'

import { useId, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Popover } from 'radix-ui'
import { BoIcon } from '@/components/backoffice/icons'

/**
 * The (?) beside a field: what it is and how to use it, out of the way until
 * somebody asks (OOC-133, OOC-134). A popover and not a tooltip, because a
 * tooltip opens on hover and the panel is operated on a phone too. The icon is
 * small so it does not push the label; the `after:` box is the 44px touch area.
 */
export function HelpHint({ what, how }: { what: string; how?: string }) {
  const t = useTranslations('bo')
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={t('help.open')}
        className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition after:absolute after:-inset-3.5 hover:text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue/40 data-[state=open]:text-brand-blue"
        type="button"
      >
        <BoIcon name="help" size={16} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className="z-50 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border border-line bg-white p-3 text-xs font-normal normal-case leading-relaxed tracking-normal text-ink shadow-lg"
        >
          <p>{what}</p>
          {how && <p className="text-muted-foreground">{how}</p>}
          <Popover.Arrow className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * A field with a (?) by its label. The control takes its id from the render
 * prop: a button inside `<label>` would become the label's control, and a click
 * on the label's text would open the help instead of focusing the field.
 */
export function HelpField({
  label,
  what,
  how,
  className = '',
  children,
}: {
  label: string
  what: string
  how?: string
  className?: string
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <span className="flex items-center gap-1.5">
        <label
          htmlFor={id}
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          {label}
        </label>
        <HelpHint what={what} how={how} />
      </span>
      {children(id)}
    </div>
  )
}
