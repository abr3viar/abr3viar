import Link from "next/link";
import { BrandMark } from "./icons";
import { HeaderNav } from "./header-nav";

export function SiteHeader() {
  return (
    <header className="border-b border-wine-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-1.5 sm:px-4 sm:py-2.5">
        <Link
          href="/"
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg pr-1 font-serif text-[1.05rem] font-semibold whitespace-nowrap text-wine-800 sm:text-lg"
        >
          <BrandMark className="h-7 w-7 shrink-0" />
          Psicanalista do Amor
        </Link>
        <HeaderNav />
      </div>
    </header>
  );
}
