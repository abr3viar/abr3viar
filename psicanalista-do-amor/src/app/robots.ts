import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/seo";

// Lido em tempo de execução: o build (Docker) não conhece o APP_URL de produção.
export const dynamic = "force-dynamic";

/**
 * Só /api e /admin ficam fora do crawl. As demais páginas privadas são liberadas para o
 * robô LER o `noindex` (meta + X-Robots-Tag): com Disallow ele nunca veria a proibição.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/admin"] }],
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
