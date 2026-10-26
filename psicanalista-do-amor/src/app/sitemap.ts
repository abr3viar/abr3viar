import type { MetadataRoute } from "next";
import { LEGAL_VERSION } from "@/lib/copy";
import { appUrl } from "@/lib/seo";

// Lido em tempo de execução: o build (Docker) não conhece o APP_URL de produção.
export const dynamic = "force-dynamic";

/** Só páginas indexáveis (o /analisar é noindex e não entra). */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();
  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/ajuda`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/assinatura`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/termos`, changeFrequency: "yearly", priority: 0.3, lastModified: LEGAL_VERSION },
    { url: `${base}/privacidade`, changeFrequency: "yearly", priority: 0.3, lastModified: LEGAL_VERSION },
  ];
}
