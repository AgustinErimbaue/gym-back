import cors from "cors";
import express from "express";
import helmet from "helmet";
import attendancesRouter from "./routes/attendances.js";
import membershipsRouter from "./routes/memberships.js";
import membersRouter from "./routes/members.js";
import plansRouter from "./routes/plans.js";
import publicRouter from "./routes/public.js";
import adminRouter from "./routes/admin.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { requireApiToken } from "./middleware/requireApiToken.js";

const app = express();
const allowedOrigins = process.env.CORS_ORIGIN
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({
  origin: allowedOrigins?.length ? allowedOrigins : false,
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});
app.use("/api/public", publicRouter);
app.use("/api/admin", adminRouter);
app.use("/api", requireApiToken);
app.use("/api/members", membersRouter);
app.use("/api/plans", plansRouter);
app.use("/api/memberships", membershipsRouter);
app.use("/api/attendances", attendancesRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
