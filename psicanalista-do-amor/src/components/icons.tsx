import type { ReactNode, SVGProps } from "react";

/**
 * Ícones em SVG inline (sem biblioteca e sem emoji). Todos decorativos por padrão
 * (`aria-hidden`); o texto ao lado é que dá o nome acessível.
 */
type IconProps = SVGProps<SVGSVGElement> & { className?: string };

function Stroke({ children, className = "h-5 w-5", ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Marca: balão de conversa com coração (o mesmo desenho do ícone do app). */
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <rect width="32" height="32" rx="8" fill="#b42a53" />
      <path
        d="M8.5 9.2A2.7 2.7 0 0 1 11.2 6.5h9.6a2.7 2.7 0 0 1 2.7 2.7v7.6a2.7 2.7 0 0 1-2.7 2.7h-6.3l-4.3 3.8v-3.8a2.7 2.7 0 0 1-1.7-2.5V9.2Z"
        fill="#fff"
      />
      <path d="M16 16.6s-3.1-1.8-3.1-3.9a1.75 1.75 0 0 1 3.1-1.1 1.75 1.75 0 0 1 3.1 1.1c0 2.1-3.1 3.9-3.1 3.9Z" fill="#b42a53" />
    </svg>
  );
}

export const LockIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    <path d="M12 14.5v2" />
  </Stroke>
);

export const ShieldIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-2.5Z" />
    <rect x="9.25" y="11" width="5.5" height="4.5" rx="1" />
    <path d="M10.5 11V9.8a1.5 1.5 0 0 1 3 0V11" />
  </Stroke>
);

export const FileEraseIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M14 3.5H7.5A2 2 0 0 0 5.5 5.5v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8L14 3.5Z" />
    <path d="M14 3.5V8h4.5" />
    <path d="m9.75 12.5 4.5 4.5M14.25 12.5l-4.5 4.5" />
  </Stroke>
);

export const EyeOffIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3.5 12s3-6 8.5-6c1.4 0 2.6.4 3.7.9M20.5 12s-3 6-8.5 6c-1.4 0-2.6-.4-3.7-.9" />
    <path d="M9.9 14.1a3 3 0 0 1 4.2-4.2" />
    <path d="m4 20 16-16" />
  </Stroke>
);

export const TrashIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4.5 7h15M10 4h4M6.5 7l.8 11.6a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9L17.5 7" />
    <path d="M10 11v5.5M14 11v5.5" />
  </Stroke>
);

export const PhoneIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M6.6 3.5h2.2l1.4 4-2 1.4a12 12 0 0 0 6.9 6.9l1.4-2 4 1.4v2.2a2 2 0 0 1-2.1 2A16.5 16.5 0 0 1 4.6 5.6a2 2 0 0 1 2-2.1Z" />
  </Stroke>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m6 9 6 6 6-6" />
  </Stroke>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Stroke>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Stroke>
);

export const FolderIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z" />
  </Stroke>
);

export const TextIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M5 6.5h14M5 11h14M5 15.5h9" />
  </Stroke>
);

export const FileTextIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M14 3.5H7.5A2 2 0 0 0 5.5 5.5v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8L14 3.5Z" />
    <path d="M14 3.5V8h4.5M9 12.5h6M9 16h4" />
  </Stroke>
);

export const ArchiveIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
    <path d="M5 8.5v9.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4" />
  </Stroke>
);

export const ImagesIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="3.5" y="5" width="13" height="13" rx="2" />
    <path d="M7.5 21h9.5a3 3 0 0 0 3-3V8.5" />
    <path d="m3.5 15 3.5-3.5 3 3 2-2 4.5 4.5" />
  </Stroke>
);

export const CheckIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Stroke>
);

export const ClockIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Stroke>
);

export const AlertIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5M12 16v.01" />
  </Stroke>
);
