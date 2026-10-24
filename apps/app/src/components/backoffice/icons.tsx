import type { ReactElement, SVGProps } from 'react'

/**
 * Inline icon set for the backoffice (no icon library). Stroke-based and
 * currentColor, so the parent's text color drives them. Same shape as the
 * portal set, but its own names — the two navs have nothing in common.
 */

export type BoIconName =
  | 'dashboard'
  | 'students'
  | 'enrollments'
  | 'payments'
  | 'courses'
  | 'teachers'
  | 'email'
  | 'reports'
  | 'settings'
  | 'staff'
  | 'logout'
  | 'search'
  | 'filter'
  | 'edit'
  | 'check'
  | 'close'
  | 'alert'
  | 'clock'
  | 'chevron-right'
  | 'chevron-left'
  | 'refresh'
  | 'arrow-left'
  | 'external'
  | 'download'
  | 'doc'
  | 'shield'
  | 'seat'
  | 'trend-up'
  | 'guardian'
  | 'menu'
  | 'plus'
  | 'sort'
  | 'chevron-down'
  | 'help'
  | 'eye'
  | 'eye-off'
  | 'device'
  | 'key'
  | 'globe'
  | 'more'
  | 'link'
  | 'video'
  | 'copy'
  | 'spinner'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'heading-1'
  | 'heading-2'
  | 'list-bullet'
  | 'list-ordered'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-justify'
  | 'undo'
  | 'redo'
  | 'tag'

const paths: Record<BoIconName, ReactElement> = {
  dashboard: <path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" />,
  students: (
    <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 11.5a3 3 0 1 0 0-6M18 20h3.5a5.5 5.5 0 0 0-3.6-5.2" />
  ),
  enrollments: (
    <path d="M4 5h16v6a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4zM9 9h6M9 13h4" />
  ),
  payments: (
    <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18M7 15h4" />
  ),
  courses: (
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v14H5.5A1.5 1.5 0 0 0 4 19.5zM19 18v2H6" />
  ),
  teachers: (
    <path d="M4 4h16v11H4zM12 15v5M8 20h8M9 8l2.5 2L9 12" />
  ),
  email: (
    <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM4 7l8 6 8-6" />
  ),
  reports: <path d="M4 20h16M7 16V9M12 16V5M17 16v-4" />,
  settings: (
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 13H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.4a2 2 0 1 1 0 4h-.3a1.6 1.6 0 0 0-1.3.9Z" />
  ),
  staff: (
    <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20a7 7 0 0 1 14 0M12 3v1" />
  ),
  logout: <path d="M15 12H4m0 0 3.5-3.5M4 12l3.5 3.5M10 5h9v14h-9" />,
  search: <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  edit: <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17zM15 6l3 3" />,
  check: <path d="m5 13 4 4 10-10" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  alert: <path d="M12 4 2.5 20h19zM12 10v4M12 17h.01" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  'chevron-left': <path d="m15 6-6 6 6 6" />,
  refresh: <path d="M20 11a8 8 0 0 0-14.9-3.9M4 5v3h3M4 13a8 8 0 0 0 14.9 3.9M20 19v-3h-3" />,
  'arrow-left': <path d="M19 12H5m0 0 6-6m-6 6 6 6" />,
  external: (
    <path d="M14 5h5v5M19 5l-8 8M12 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />
  ),
  download: <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" />,
  doc: <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 13h5M10 17h5" />,
  shield: <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6zM9 12l2 2 4-4" />,
  seat: (
    <path d="M6 10V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4M5 10h14v6H5zM7 16v3M17 16v3" />
  ),
  'trend-up': <path d="M4 17l6-6 3.5 3.5L20 8M15 8h5v5" />,
  guardian: (
    <path d="M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 20a6 6 0 0 1 12 0M19 4l1.5 1.5L19 7" />
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  more: (
    <path d="M12 12h.01M5 12h.01M19 12h.01M12.8 12a.8.8 0 1 1-1.6 0 .8.8 0 0 1 1.6 0Zm-7 0a.8.8 0 1 1-1.6 0 .8.8 0 0 1 1.6 0Zm14 0a.8.8 0 1 1-1.6 0 .8.8 0 0 1 1.6 0Z" />
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  sort: <path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  help: (
    <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.6 9.5a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.3v.6M12 17h.01" />
  ),
  eye: (
    <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
  ),
  'eye-off': (
    <path d="M4 4l16 16M9.9 5.2A9.8 9.8 0 0 1 12 5c6.4 0 10 6 10 6a17 17 0 0 1-3.5 4M6.3 7.8C3.7 9.4 2 12 2 12s3.6 6 10 6a10 10 0 0 0 3.4-.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  ),
  device: (
    <path d="M3 5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M3 5v9a1 1 0 0 0 1 1h6M8 19h4M10 15v4M15 11h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1ZM17 17.5h1" />
  ),
  key: (
    <path d="M14.5 4a5.5 5.5 0 1 1-4.1 9.2L4 19.6V21h3v-2h2v-2h2l1.4-1.4A5.5 5.5 0 0 1 14.5 4ZM16 8.5h.01" />
  ),
  globe: (
    <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3a14 14 0 0 1 3.5 9A14 14 0 0 1 12 21a14 14 0 0 1-3.5-9A14 14 0 0 1 12 3Z" />
  ),
  link: (
    <path d="M9 15l6-6M8.5 12 6 14.5a3 3 0 1 0 4.2 4.2L12.5 16M15.5 12 18 9.5a3 3 0 1 0-4.2-4.2L11.5 8" />
  ),
  /* Three-quarter arc, not a full circle — a closed ring gives `animate-spin`
     nothing to show motion against. Pair with `className="animate-spin"` at
     the call site; this glyph never spins on its own. */
  copy: <path d="M9 9h10v11H9zM5 15V4h10" />,
  video: <path d="M4 7h11v10H4zM15 10.5 20 7.5v9l-5-3" />,
  spinner: <path d="M12 3a9 9 0 1 1-9 9" />,
  bold: <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />,
  italic: <path d="M10 5h8M6 19h8M14 5l-4 14" />,
  underline: <path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14" />,
  'heading-1': <path d="M4 6v12M12 6v12M4 12h8M16.5 10.5 19 9v9" />,
  'heading-2': <path d="M4 6v12M12 6v12M4 12h8M16.5 10.5a2.2 2.2 0 1 1 3.6 1.7L16.5 18H21" />,
  'list-bullet': <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  'list-ordered': <path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1V9M4 14.5a1.5 1.5 0 1 1 2.5 1.1L4 18h3" />,
  'align-left': <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />,
  'align-center': <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />,
  'align-right': <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />,
  'align-justify': <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  redo: <path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />,
  tag: <path d="M3 12V4h8l9 9-8 8zM7.5 7.5h.01" />,
}

export function BoIcon({
  name,
  size = 20,
  ...props
}: { name: BoIconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
