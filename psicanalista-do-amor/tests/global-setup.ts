/**
 * Testes de integração precisam de um PostgreSQL DESCARTÁVEL em TEST_DATABASE_URL
 * (as tabelas são truncadas). Sem essa variável, eles são pulados com aviso.
 */
export default async function globalSetup(): Promise<void> {
  if (!process.env.TEST_DATABASE_URL) {
    process.stdout.write(
      "\n[aviso] TEST_DATABASE_URL não definida: testes de integração com banco serão PULADOS.\n" +
        "        Ex.: TEST_DATABASE_URL=postgres://app:app@localhost:5432/psicanalista_test npm test\n\n",
    );
  }
}
