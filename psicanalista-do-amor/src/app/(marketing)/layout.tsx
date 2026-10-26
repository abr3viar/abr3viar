import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PUBLIC_ROBOTS } from "@/lib/seo";

// Páginas públicas: liberam a indexação (o layout raiz bloqueia por padrão).
export const metadata: Metadata = { robots: PUBLIC_ROBOTS };

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return children;
}
