import { rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { appEnv } from "../../playwright.config";

/** Prepara o banco do E2E (migrations, seed, limpeza e Payment Links falsos). */
export default async function globalSetup(): Promise<void> {
  rmSync("./.data/e2e-outbox", { recursive: true, force: true });
  execFileSync("npx", ["tsx", "--conditions=react-server", "tests/e2e/prepare-db.ts"], {
    stdio: "inherit",
    env: { ...process.env, ...appEnv },
  });
}
