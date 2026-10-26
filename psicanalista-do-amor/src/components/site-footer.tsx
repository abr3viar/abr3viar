import Link from "next/link";
import { BrandMark } from "./icons";

const LEGAL = [
  { href: "/termos", label: "Termos de uso" },
  { href: "/privacidade", label: "Privacidade" },
];

const PRODUCT = [
  { href: "/analisar", label: "Analisar conversa" },
  { href: "/assinatura", label: "Assinatura" },
  { href: "/minhas-analises", label: "Minhas análises" },
];

const ACCOUNT = [
  { href: "/ajuda", label: "Ajuda" },
  { href: "/conta", label: "Minha conta" },
];

/** Rodapé em três grupos (produto, legal, conta). O aviso de IA fica no topo do relatório e na landing (UX-11). */
export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-wine-100 bg-paper">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="grid gap-8 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="space-y-3">
            <p className="flex items-center gap-2.5 font-serif text-base font-semibold text-wine-900">
              <BrandMark className="h-7 w-7 shrink-0" />
              Psicanalista do Amor
            </p>
            <p className="hint max-w-xs">Uma leitura por IA da dinâmica entre duas pessoas, a partir da conversa de vocês.</p>
          </div>
          <FooterGroup title="Produto" links={PRODUCT} />
          <FooterGroup title="Legal" links={LEGAL} />
          <FooterGroup title="Conta" links={ACCOUNT} />
        </div>
        <p className="mt-10 border-t border-wine-100 pt-5 text-xs text-muted">
          © {new Date().getFullYear()} Psicanalista do Amor.
        </p>
      </div>
    </footer>
  );
}

function FooterGroup({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <nav aria-label={`Rodapé: ${title}`}>
      <p className="eyebrow">{title}</p>
      <ul className="mt-2 -ml-2 space-y-0.5">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="inline-flex min-h-11 items-center rounded-control px-2 text-sm text-ink hover:bg-wine-50 hover:text-wine-800 motion-safe:transition-colors"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
