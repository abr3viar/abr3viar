import { defineConfig, devices } from "@playwright/test";

/**
 * E2E com Groq e Stripe FALSOS (tests/e2e/mock-server.ts). Requer PostgreSQL em
 * E2E_DATABASE_URL (descartável). O Playwright sobe: servidor falso, Next.js (dev) e worker.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 3999);
const APP_URL = `http://localhost:${PORT}`;
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://app:app@localhost:5432/psicanalista_e2e";

const appEnv: Record<string, string> = {
  NODE_ENV: "development" as string,
  APP_URL,
  PORT: String(PORT),
  DATABASE_URL,
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
  SESSION_SECRET: "e2e-session-secret-0123456789abcdef0123456789abcdef",
  HASH_PEPPER: "e2e-pepper-0123456789",
  GROQ_API_KEY: "gsk_e2e_dummy",
  GROQ_BASE_URL: `http://localhost:${MOCK_PORT}/groq`,
  GROQ_VISION_MODEL: "mock/vision",
  GROQ_REPORT_MODEL: "mock/report",
  GROQ_SUMMARY_MODEL: "mock/summary",
  STRIPE_SECRET_KEY: "sk_test_e2e_dummy",
  STRIPE_WEBHOOK_SECRET: "whsec_e2e_secret",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: "./.data/e2e-uploads",
  EMAIL_DRIVER: "outbox",
  EMAIL_OUTBOX_DIR: "./.data/e2e-outbox",
  ADMIN_EMAILS: "admin@example.com",
  LOG_LEVEL: "warn",
  E2E_MOCK_PORT: String(MOCK_PORT),
  E2E_APP_URL: APP_URL,
  NEXT_DIST_DIR: ".next-e2e",
};

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
      },
    },
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: [
    {
      command: "npx tsx tests/e2e/mock-server.ts",
      url: `http://localhost:${MOCK_PORT}/health`,
      env: appEnv,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // Next.js (dev) + worker no mesmo comando.
      command: "node tests/e2e/start-app.mjs",
      url: `${APP_URL}/api/health`,
      env: appEnv,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});

export { appEnv };
