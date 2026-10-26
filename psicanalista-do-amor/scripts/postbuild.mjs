#!/usr/bin/env node
/**
 * Depois do `next build`:
 *  1. copia .next/static e public para dentro de .next/standalone (servidor autossuficiente);
 *  2. empacota o worker e a migração com esbuild em dist/*.mjs (sem tsx em produção).
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { hashSources } from "./source-hash.mjs";

const root = process.cwd();
const distDir = process.env.NEXT_DIST_DIR || ".next";
const standalone = path.join(root, distDir, "standalone");

if (existsSync(standalone)) {
  cpSync(path.join(root, distDir, "static"), path.join(standalone, distDir, "static"), { recursive: true });
  if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
}

rmSync(path.join(root, "dist"), { recursive: true, force: true });
mkdirSync(path.join(root, "dist"), { recursive: true });
await build({
  entryPoints: { worker: "worker/index.ts", migrate: "scripts/migrate-prod.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  minify: false,
  legalComments: "none",
  // `server-only` resolve para o módulo vazio com esta condição.
  conditions: ["react-server", "node", "import"],
  tsconfig: "tsconfig.json",
  // Binários nativos ficam fora do pacote (resolvidos em node_modules).
  // (pg, pg-boss e pino também ficam de fora: já estão no node_modules do standalone e o
  // pg não funciona empacotado por causa de requires circulares.)
  external: ["sharp", "pg-native", "pg", "pg-boss", "pino"],
  banner: {
    js: "import { createRequire as __pdaCreateRequire } from 'node:module'; const require = __pdaCreateRequire(import.meta.url);",
  },
  logLevel: "warning",
});
writeFileSync(path.join(root, distDir, "SOURCE_HASH"), hashSources(root));
console.log("postbuild: standalone pronto e dist/worker.mjs + dist/migrate.mjs gerados");
