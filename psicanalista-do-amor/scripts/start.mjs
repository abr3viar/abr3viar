#!/usr/bin/env node
/**
 * Entrada de PRODUÇÃO (Square Cloud, Docker, Railway, Fly):
 *   1. compila o projeto se ainda não houver build (ou se o código mudou);
 *   2. aplica as migrations e o seed de report_types (com advisory lock);
 *   3. sobe o site e/ou o worker conforme PROCESS_TYPE (all | web | worker).
 * Se um dos processos cair, o outro é encerrado e o container sai com erro, para a
 * hospedagem reiniciar tudo (AUTORESTART).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { hashSources } from "./source-hash.mjs";

const root = process.cwd();
const log = (msg) => console.log(`[start] ${msg}`);
const SERVER = path.join(root, ".next", "standalone", "server.js");
const WORKER = path.join(root, "dist", "worker.mjs");
const MIGRATE = path.join(root, "dist", "migrate.mjs");
const HASH_FILE = path.join(root, ".next", "SOURCE_HASH");

function ensureBuild() {
  const hasSource = existsSync(path.join(root, "src"));
  const built = existsSync(SERVER) && existsSync(WORKER) && existsSync(MIGRATE);
  const current = hasSource ? hashSources() : null;
  const previous = existsSync(HASH_FILE) ? readFileSync(HASH_FILE, "utf8").trim() : null;
  if (built && (!hasSource || current === previous)) return;
  if (!hasSource) throw new Error("Build ausente e sem código-fonte para compilar.");
  log("compilando o projeto (primeira inicialização ou código novo; pode levar alguns minutos)...");
  // O build NÃO recebe os segredos (banco, Stripe, Groq...): só o necessário para compilar.
  const BUILD_ENV_KEYS = ["PATH", "HOME", "TMPDIR", "LANG", "APP_URL", "NEXT_DIST_DIR", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"];
  const buildEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => BUILD_ENV_KEYS.includes(k) || k.startsWith("npm_config_")),
  );
  const r = spawnSync("npm", ["run", "build"], {
    stdio: "inherit",
    env: {
      ...buildEnv,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_OPTIONS: process.env.BUILD_NODE_OPTIONS ?? "--max-old-space-size=1536",
    },
  });
  if (r.status !== 0) throw new Error("falha no build");
}

function migrate() {
  log("aplicando migrations e seed...");
  const r = spawnSync(process.execPath, [MIGRATE], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error("falha nas migrations");
}

/**
 * O server.js do Next standalone faz `chdir` para .next/standalone: caminhos relativos do env
 * viram absolutos a partir da raiz do app, para o site e o worker usarem os MESMOS arquivos
 * (uploads gravados pelo site e lidos pelo worker; certificado do banco).
 */
const PATH_VARS = { STORAGE_LOCAL_DIR: "./.data/uploads", EMAIL_OUTBOX_DIR: "./.data/outbox", DATABASE_URL_CERT_PATH: null };
function absolutizePaths() {
  for (const [name, fallback] of Object.entries(PATH_VARS)) {
    const value = process.env[name] || fallback;
    if (value) process.env[name] = path.resolve(root, value);
  }
}

function main() {
  process.env.NODE_ENV ??= "production";
  absolutizePaths();
  ensureBuild();
  migrate();
  const type = process.env.PROCESS_TYPE ?? "all";
  // A Square Cloud exige que sites escutem na porta 80.
  const port = process.env.PORT ?? (existsSync(path.join(root, "squarecloud.app")) ? "80" : "3000");
  const children = [];
  if (type === "all" || type === "web") {
    children.push(spawn(process.execPath, [SERVER], { stdio: "inherit", env: { ...process.env, PORT: port, HOSTNAME: process.env.HOSTNAME_BIND ?? "0.0.0.0", PROCESS_ROLE: "web" } }));
    log(`site na porta ${port}`);
  }
  if (type === "all" || type === "worker") {
    children.push(spawn(process.execPath, [WORKER], { stdio: "inherit", env: { ...process.env, PROCESS_ROLE: "worker" } }));
    log("worker iniciado");
  }
  if (children.length === 0) throw new Error(`PROCESS_TYPE inválido: ${type}`);

  let exiting = false;
  const stopAll = (code) => {
    if (exiting) return;
    exiting = true;
    for (const c of children) c.kill("SIGTERM");
    setTimeout(() => process.exit(code), 25_000).unref();
  };
  for (const c of children) {
    c.on("exit", (code) => {
      log(`processo encerrado (código ${code ?? "sinal"})`);
      stopAll(code ?? 1);
      if (children.every((x) => x.exitCode !== null || x.signalCode !== null)) process.exit(code ?? 1);
    });
  }
  process.on("SIGTERM", () => stopAll(0));
  process.on("SIGINT", () => stopAll(0));
}

try {
  main();
} catch (err) {
  console.error(`[start] ${err instanceof Error ? err.message : "erro"}`);
  process.exit(1);
}
