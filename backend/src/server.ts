import { createServer } from "node:http";
import { loadEnv } from "./config/env.js";
import { createApp } from "./app.js";
import { attachWebSocket } from "./ws/index.js";
import { logger } from "./utils/logger.js";

const env = loadEnv();
const { app, paper } = createApp(env);
const http = createServer(app);
const ws = attachWebSocket(http, { allowedOrigins: env.corsOrigins, production: env.NODE_ENV === "production", paper });

http.listen(env.PORT, () => logger.info({ port: env.PORT, kiteConfigured: env.kiteConfigured, dataSource: "SAMPLE" }, "StockPilot AI backend listening"));

let shuttingDown = false;
const shutdown = (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  ws.close().then(() => http.close(() => process.exit(0)));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
