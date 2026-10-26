// Hash do código-fonte: o start recompila só quando o código muda.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const PATHS = ["src", "worker", "scripts", "drizzle", "public", "package-lock.json", "next.config.ts", "tsconfig.json"];

export function hashSources(root = process.cwd()) {
  const h = createHash("sha256");
  const walk = (p) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) for (const name of readdirSync(p).sort()) walk(path.join(p, name));
    else h.update(p.slice(root.length)).update(readFileSync(p));
  };
  for (const p of PATHS) walk(path.join(root, p));
  return h.digest("hex");
}
