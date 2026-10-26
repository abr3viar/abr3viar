// Carrega .env/.env.local em desenvolvimento (scripts fora do Next.js).
// Em produção as variáveis vêm da plataforma de hospedagem.
import { config } from "dotenv";

if (process.env.NODE_ENV !== "production") {
  config({ path: [".env.local", ".env"], quiet: true });
}
