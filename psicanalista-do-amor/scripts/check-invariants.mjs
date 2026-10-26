#!/usr/bin/env node
/**
 * Checagens de segurança que o CI roda junto com o lint (plano.md 7.6 e CLAUDE.md):
 *  1. `is_unlocked` / `isUnlocked` só é ESCRITO em src/server/payments/fulfill.ts.
 *  2. O SDK da Groq só é importado em src/server/ai/client.ts.
 *  3. Nenhum nome de modelo da Groq fixo no código.
 *  4. Nenhum console.log/info/debug em código de aplicação.
 *  6. Indexação é opt-in: `PUBLIC_ROBOTS` só na landing e em src/app/(marketing).
 *  5. Toda página do /admin e toda consulta de src/server/admin chamam `requireAdmin()`
 *     (o layout não protege: o Next pode renderizar só a página numa navegação RSC).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "worker", "scripts", "tests/e2e"];
const EXTS = new Set([".ts", ".tsx", ".mts", ".mjs", ".js"]);

function walk(dir) {
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full));
    else if (EXTS.has(path.extname(name))) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");
const problems = [];

const FULFILL = "src/server/payments/fulfill.ts";
const SCHEMA = "src/server/db/schema.ts";
const SELF = "scripts/check-invariants.mjs";

// Escrita em SQL cru: `is_unlocked = ...` ou `SET ... is_unlocked`.
const unlockSqlWrite = /\bis_unlocked\s*=(?!=)|SET\s+[^;]*\bis_unlocked\b/i;

/** Blocos `.set({ ... })` / `.values({ ... })` (Drizzle) que mencionam isUnlocked. */
function drizzleUnlockWrites(text) {
  const hits = [];
  const re = /\.(set|values)\(\s*[{\[]/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{" || ch === "[" || ch === "(") depth++;
      else if (ch === "}" || ch === "]" || ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const block = text.slice(start, i + 1);
    if (/\bisUnlocked\b|\bis_unlocked\b/.test(block)) {
      hits.push(text.slice(0, m.index).split("\n").length);
    }
  }
  return hits;
}
const groqImport = /from\s+["']groq-sdk["']|require\(\s*["']groq-sdk["']\s*\)|import\(\s*["']groq-sdk["']\s*\)/;
const modelLiteral = /["'`](?:[a-z0-9-]+\/)?(?:gpt-oss-\d+b|qwen[\w.-]*|llama-?[\w.-]*|mixtral[\w.-]*|gemma[\w.-]*|deepseek[\w.-]*|kimi[\w.-]*|whisper[\w.-]*)["'`]/i;
const consoleLog = /\bconsole\.(log|info|debug|trace)\s*\(/;

for (const file of files) {
  const r = rel(file);
  if (r === SELF) continue;
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  if (r !== FULFILL && r !== SCHEMA) {
    for (const line of drizzleUnlockWrites(text)) {
      problems.push(`${r}:${line}: escrita em is_unlocked fora de ${FULFILL}`);
    }
  }
  lines.forEach((line, i) => {
    const where = `${r}:${i + 1}`;
    if (r !== FULFILL && r !== SCHEMA && unlockSqlWrite.test(line)) {
      problems.push(`${where}: escrita em is_unlocked fora de ${FULFILL}`);
    }
    if (r !== "src/server/ai/client.ts" && groqImport.test(line)) {
      problems.push(`${where}: import do SDK da Groq fora de src/server/ai/client.ts`);
    }
    if (modelLiteral.test(line)) {
      problems.push(`${where}: nome de modelo fixo no código (use as variáveis GROQ_*_MODEL)`);
    }
    if (!r.startsWith("scripts/") && consoleLog.test(line)) {
      problems.push(`${where}: console.* em código de aplicação (use src/server/log.ts)`);
    }
  });
}

// 5. /admin: proteção em cada página e em cada consulta exportada — a PRIMEIRA instrução
// do componente/função precisa ser `await requireAdmin()` (comentários não contam).
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
for (const file of files) {
  const r = rel(file);
  const text = stripComments(readFileSync(file, "utf8"));
  if (/^src\/app\/admin\/(.+\/)?page\.tsx$/.test(r)) {
    if (!/export default async function \w*\([^)]*\)[^{]*\{\s*await requireAdmin\(\);/.test(text)) {
      problems.push(`${r}: a página do /admin precisa começar com \`await requireAdmin()\``);
    }
  }
  if (r.startsWith("src/server/admin/")) {
    if (/export\s+(const|let|var|class|default|function\s)|export\s+\{|export\s+\*/.test(text)) {
      problems.push(`${r}: exporte só \`export async function\` (cada uma começando com \`await requireAdmin()\`)`);
    }
    for (const m of text.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\s*([^\n]*)/g)) {
      if (!m[2].startsWith("await requireAdmin();")) problems.push(`${r}: ${m[1]} não começa com \`await requireAdmin()\``);
    }
  }
}

// 6. Só a landing e as páginas de (marketing) podem liberar a indexação.
for (const file of files) {
  const r = rel(file);
  if (!r.startsWith("src/app/")) continue;
  if (r === "src/app/page.tsx" || r.startsWith("src/app/(marketing)/")) continue;
  if (/\bPUBLIC_ROBOTS\b|index:\s*true/.test(readFileSync(file, "utf8"))) {
    problems.push(`${r}: indexação liberada fora da landing/(marketing) (use PRIVATE_ROBOTS)`);
  }
}

if (problems.length) {
  console.error("Falha nas checagens de invariantes:\n" + problems.map((p) => "  - " + p).join("\n"));
  process.exit(1);
}
console.log(`check-invariants: ok (${files.length} arquivos)`);
