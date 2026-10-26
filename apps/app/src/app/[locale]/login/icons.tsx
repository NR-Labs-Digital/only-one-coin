import type { SVGProps } from 'react'

/**
 * Ícones da tela de login do aluno — traço, `currentColor`, tamanho pela prop.
 * Locais de propósito, como os do backoffice: a porta do aluno não deve puxar
 * dependência de outra área do painel para desenhar um envelope.
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

export function ArrowRightIcon(props: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M5 12h14m0 0-7-7m7 7-7 7" />
    </Svg>
  )
}

export function IdCardIcon(props: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <circle cx="8.5" cy="11" r="2" />
      <path d="M5.5 16c.5-1.4 1.7-2.2 3-2.2s2.5.8 3 2.2M14.5 10h4M14.5 13.5h4" />
    </Svg>
  )
}

export function HelpIcon(props: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2-2.5 3.5" />
      <path d="M12 17h.01" strokeWidth={2.4} />
    </Svg>
  )
}
