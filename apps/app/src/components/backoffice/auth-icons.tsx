import type { SVGProps } from 'react'

/**
 * Minimal inline icons for the staff sign-in screens — the login form both
 * staff doors share (`/backoffice`, `/docente`), the invite and the password
 * reset. Stroke-based, currentColor, so the parent's text color drives them.
 */
function Svg({ size = 20, children, ...props }: { size?: number } & SVGProps<SVGSVGElement>) {
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
      {children}
    </svg>
  )
}

export function ShieldIcon(props: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6zM9 12l2 2 4-4" />
    </Svg>
  )
}

export function ArrowLeftIcon(props: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M19 12H5m0 0 6-6m-6 6 6 6" />
    </Svg>
  )
}

export function EyeIcon(props: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.75" />
    </Svg>
  )
}

export function EyeOffIcon(props: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M10.6 6.7A9.9 9.9 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a18 18 0 0 1-3.3 4M6.3 8A17.7 17.7 0 0 0 2 12s3.6 6.5 10 6.5a9.8 9.8 0 0 0 4-.8M10 10a2.75 2.75 0 0 0 4 4M3 3l18 18" />
    </Svg>
  )
}

export function MailIcon(props: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM4 7l8 6 8-6" />
    </Svg>
  )
}

export function LockIcon(props: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M5 11h14v9H5zM8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  )
}

export function CheckCircleIcon(props: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </Svg>
  )
}
