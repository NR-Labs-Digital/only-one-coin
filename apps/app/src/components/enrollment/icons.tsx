import type { ReactElement, SVGProps } from 'react'

/**
 * Inline icon set for the public checkout. Its own set rather than the portal's
 * or the panel's: this is the one surface a stranger sees, and the three should
 * be free to drift without one dragging the others.
 */

export type CheckoutIconName =
  | 'check'
  | 'arrow-right'
  | 'arrow-left'
  | 'clock'
  | 'copy'
  | 'upload'
  | 'file'
  | 'alert'
  | 'lock'
  | 'seat'
  | 'calendar'
  | 'globe'
  | 'chevron-down'
  | 'user'
  | 'trash'

const paths: Record<CheckoutIconName, ReactElement> = {
  check: <path d="m5 13 4 4L19 7" />,
  'arrow-right': <path d="M5 12h14m-6-6 6 6-6 6" />,
  'arrow-left': <path d="M19 12H5m6 6-6-6 6-6" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />,
  copy: (
    <path d="M9 9V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-4M5 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
  ),
  upload: <path d="M12 16V4m-5 5 5-5 5 5M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />,
  file: <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7zM14 3v4h4" />,
  alert: <path d="M12 8v5m0 3.5v.5M10.3 4.2 3.4 16.5A2 2 0 0 0 5.1 19.5h13.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />,
  lock: <path d="M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3" />,
  seat: (
    <path d="M6 10V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4M5 10h14v6H5zM7 16v3M17 16v3" />
  ),
  globe: (
    <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  ),
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  calendar: <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5zM4 9.5h16M8.5 3v3M15.5 3v3" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0" />,
  trash: <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-12" />,
}

export function CheckoutIcon({
  name,
  size = 20,
  style,
  ...props
}: { name: CheckoutIconName; size?: number } & SVGProps<SVGSVGElement>) {
  // `size` is px at the 16px root, emitted as rem so the icon grows with the
  // checkout's ruler (`globals.css`, OOC-125) instead of shrinking beside text.
  const length = `${size / 16}rem`
  return (
    <svg
      width={size}
      height={size}
      style={{ width: length, height: length, ...style }}
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
