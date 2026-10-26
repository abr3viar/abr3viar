import "./load-env";
import { seedReportTypes } from "@/server/db/seed";
import { closeDb } from "@/server/db/client";

seedReportTypes()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async () => {
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
