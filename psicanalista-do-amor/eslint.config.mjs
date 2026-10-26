import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Logs só via pino com redact (src/server/log.ts).
      "no-console": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "groq-sdk",
              message: "Use src/server/ai/client.ts (retry, backoff e limitador). Nunca o SDK direto.",
            },
          ],
        },
      ],
    },
  },
  {
    // O único lugar que pode importar o SDK da Groq.
    files: ["src/server/ai/client.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // Componentes de UI não acessam o banco nem código de servidor.
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/server/*", "@/server/**"], message: "Componentes recebem views, não acessam o servidor." }] },
      ],
    },
  },
  {
    files: ["scripts/**/*.{ts,mjs}", "tests/**/*.ts", "docker/**/*.mjs"],
    rules: { "no-console": "off" },
  },
  globalIgnores([".next/**", ".next-e2e/**", "out/**", "build/**", "dist/**", "drizzle/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
