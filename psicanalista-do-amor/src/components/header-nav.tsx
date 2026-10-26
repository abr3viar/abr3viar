"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderIcon } from "./icons";

/**
 * Navegação do cabeçalho. Client só por causa do `usePathname`: o CTA "Analisar conversa"
 * some no próprio envio e nas telas da análise (lá ele competiria com o de pagamento).
 */
export function HeaderNav() {
  const pathname = usePathname() ?? "/";
  const hideCta = pathname === "/analisar" || pathname.startsWith("/r/") || pathname.startsWith("/pagamento");
  const onList = pathname === "/minhas-analises";
  return (
    <nav aria-label="Principal" className="flex items-center gap-1 sm:gap-3">
      <Link
        href="/minhas-analises"
        aria-current={onList ? "page" : undefined}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-2 text-sm font-medium text-stone-700 hover:bg-wine-50 hover:text-wine-800 aria-[current=page]:text-wine-800 sm:px-3"
      >
        <FolderIcon className="h-5 w-5 sm:hidden" />
        <span className="sr-only sm:not-sr-only">Minhas análises</span>
      </Link>
      {!hideCta && (
        <Link href="/analisar" className="btn-primary min-h-11 px-4 py-2 text-sm whitespace-nowrap">
          <span className="sm:hidden">Analisar</span>
          <span className="hidden sm:inline">Analisar conversa</span>
        </Link>
      )}
    </nav>
  );
}
