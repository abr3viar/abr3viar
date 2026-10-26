// Sobe o Next.js (dev) e o worker juntos para o E2E; encerra os dois juntos.
import { spawn } from "node:child_process";

const port = process.env.PORT ?? "3100";
const procs = [
  spawn("npx", ["next", "dev", "--port", port], { stdio: "inherit", env: process.env }),
  spawn("npm", ["run", "worker"], { stdio: "inherit", env: process.env }),
];
const stop = () => {
  for (const p of procs) p.kill("SIGTERM");
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
for (const p of procs) p.on("exit", (code) => { if (code && code !== 0) { stop(); process.exitCode = code; } });
