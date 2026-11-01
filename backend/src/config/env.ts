import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  KITE_API_KEY: z.string().min(1).optional(),
  KITE_API_SECRET: z.string().min(1).optional(),
  KITE_REDIRECT_URL: z.string().url().optional(),
  ADMIN_TOKEN: z.string().min(16).optional(),
  ENCRYPTION_KEY: z.string().min(32).optional(),
  ALERT_WEBHOOK_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().min(20).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Env = z.infer<typeof schema> & {
  corsOrigins: string[];
  kiteConfigured: boolean;
  llmConfigured?: boolean;
};

/** Validates process configuration. Throws with a readable list of problems. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration — ${problems}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    const missing = (["ADMIN_TOKEN", "ENCRYPTION_KEY", "CORS_ORIGINS", "FRONTEND_URL"] as const).filter((k) => !source[k]);
    if (missing.length) throw new Error(`Production requires: ${missing.join(", ")}`);
    if (env.ALERT_WEBHOOK_URL && !env.ALERT_WEBHOOK_URL.startsWith("https://")) throw new Error("ALERT_WEBHOOK_URL must use https in production");
  }
  return {
    ...env,
    corsOrigins: env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    kiteConfigured: Boolean(env.KITE_API_KEY && env.KITE_API_SECRET && env.KITE_REDIRECT_URL),
    llmConfigured: Boolean(env.ANTHROPIC_API_KEY),
  };
}
