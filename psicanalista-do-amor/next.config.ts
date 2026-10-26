import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // O E2E usa uma pasta própria para não conflitar com o build de produção.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // Checagem de tipos do build sem testes/configs de dev (funciona com `npm install --omit=dev`).
  typescript: { tsconfigPath: "tsconfig.build.json" },
  reactStrictMode: true,
  // Pacotes nativos/pesados que só rodam no servidor.
  serverExternalPackages: ["sharp", "pg-boss", "pino", "yauzl"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Páginas e APIs com dados do usuário nunca são cacheadas nem indexadas
        // (o X-Robots-Tag cobre também JSON, redirects e respostas de erro).
        source: "/(r|analisar|minhas-analises|conta|admin|pagamento|entrar|api)/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
      {
        // As raízes dessas seções (ex.: /analisar, /conta) não casam com "/:path*" vazio.
        source: "/(analisar|minhas-analises|conta|admin|entrar)",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
      {
        // Página pública (indexável), mas mostra o estado da assinatura de quem está logado (D96).
        source: "/assinatura",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
