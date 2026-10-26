import Link from "next/link";

const LINKS = [
  { href: "/termos", label: "Termos de uso" },
  { href: "/privacidade", label: "Privacidade" },
  { href: "/assinatura", label: "Assinatura" },
  { href: "/ajuda", label: "Ajuda" },
  { href: "/conta", label: "Minha conta" },
];

/** Rodapé. O aviso de IA fica no topo do relatório e na landing (UX-11), não aqui (pedido do dono). */
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-wine-100 bg-white">
      <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-stone-600">
        <nav aria-label="Rodapé">
          <ul className="-mx-2 flex flex-wrap gap-x-1">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="inline-flex min-h-11 items-center rounded-lg px-2 underline-offset-4 hover:text-wine-800 hover:underline"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="mt-3 text-xs text-stone-600">
          © {new Date().getFullYear()} Psicanalista do Amor.
        </p>
      </div>
    </footer>
  );
}
