import "dotenv/config";
import app from "./app.js";
import { sequelize } from "./models/index.js";
import { startReminderScheduler } from "./services/reminders.js";

const port = Number(process.env.PORT ?? 3000);

try {
  if (!process.env.API_TOKEN || Buffer.byteLength(process.env.API_TOKEN) < 32) {
    throw new Error("API_TOKEN es obligatorio y debe tener al menos 32 bytes.");
  }
  if (!process.env.MEMBER_SESSION_SECRET || Buffer.byteLength(process.env.MEMBER_SESSION_SECRET) < 32) {
    throw new Error("MEMBER_SESSION_SECRET debe tener al menos 32 bytes.");
  }

  await sequelize.authenticate();
  await sequelize.sync();
  app.listen(port, () => {
    console.log(`API del gimnasio disponible en http://localhost:${port}`);
  });
  startReminderScheduler();
} catch (error) {
  console.error("No se pudo iniciar la API o conectar con PostgreSQL:", error);
  process.exitCode = 1;
}
