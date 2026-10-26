import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/server/auth/admin";
import { PRIVATE_ROBOTS } from "@/lib/seo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: PRIVATE_ROBOTS };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-2xl font-bold text-wine-900">Painel</h1>
        <nav className="flex flex-wrap gap-3 text-sm font-medium">
          <Link href="/admin" className="hover:text-wine-700">Visão geral</Link>
          <Link href="/admin/relatorios" className="hover:text-wine-700">Relatórios e Payment Links</Link>
          <Link href="/admin/compras" className="hover:text-wine-700">Compras</Link>
          <Link href="/admin/operacoes" className="hover:text-wine-700">Operações</Link>
        </nav>
        <span className="text-xs text-stone-500">{admin.email}</span>
      </div>
      {children}
    </div>
  );
}
