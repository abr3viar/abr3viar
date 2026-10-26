import Link from "next/link";
import { BrandMark } from "./icons";
import { HeaderNav } from "./header-nav";

export function SiteHeader() {
  return (
    <header className="border-b border-wine-100 bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2 sm:py-3">
        <Link
          href="/"
          className="flex min-h-11 shrink-0 items-center gap-2.5 rounded-control pr-2 font-serif text-base font-semibold whitespace-nowrap text-wine-900 sm:text-lg"
        >
          <BrandMark className="h-8 w-8 shrink-0" />
          Psicanalista do Amor
        </Link>
        <HeaderNav />
      </div>
    </header>
  );
}
