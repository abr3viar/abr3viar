// Variáveis FALSAS para os testes. Nenhum serviço externo real é chamado.
const testEnv: Record<string, string> = {
  NODE_ENV: "test",
  APP_URL: "http://localhost:3000",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://invalid:invalid@127.0.0.1:1/none",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  SESSION_SECRET: "test-session-secret-0123456789abcdef0123456789abcdef",
  HASH_PEPPER: "test-pepper-0123456789",
  GROQ_API_KEY: "gsk_test_dummy",
  GROQ_VISION_MODEL: "test/vision-model",
  GROQ_REPORT_MODEL: "test/report-model",
  GROQ_SUMMARY_MODEL: "test/summary-model",
  STRIPE_SECRET_KEY: "sk_test_dummy",
  STRIPE_WEBHOOK_SECRET: "whsec_test_dummy_secret",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: "./.data/test-uploads",
  EMAIL_DRIVER: "outbox",
  EMAIL_OUTBOX_DIR: "./.data/test-outbox",
  LOG_LEVEL: "silent",
  ADMIN_EMAILS: "admin@example.com",
};
for (const [k, v] of Object.entries(testEnv)) {
  if (k === "DATABASE_URL" || process.env[k] === undefined || k === "NODE_ENV") process.env[k] = v;
}
delete process.env.DATA_ENCRYPTION_KEY_PREVIOUS;
