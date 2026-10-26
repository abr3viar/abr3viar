import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { PRIVATE_ROBOTS, appUrl } from "@/lib/seo";

export const generateMetadata = (): Metadata => ({
  metadataBase: new URL(appUrl()),
  title: {
    default: "Psicanalista do Amor — descubra o que está nas entrelinhas",
    template: "%s · Psicanalista do Amor",
  },
  description:
    "Cole a conversa e receba uma leitura feita por inteligência artificial sobre a dinâmica entre vocês: quem puxa assunto, como cada um demonstra afeto e onde estão os atritos.",
  applicationName: "Psicanalista do Amor",
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Psicanalista do Amor",
    title: "Psicanalista do Amor — descubra o que está nas entrelinhas",
    description:
      "Uma leitura feita por IA da dinâmica entre duas pessoas a partir da conversa de vocês.",
  },
  // Indexação é OPT-IN: só a landing e as páginas de (marketing) liberam (SEO-3).
  robots: PRIVATE_ROBOTS,
});

export const viewport: Viewport = {
  themeColor: "#b42a53",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Lê os cabeçalhos para tornar a renderização dinâmica (nonce da CSP aplicado pelo Next).
  await headers();
  return (
    <html lang="pt-BR" className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
