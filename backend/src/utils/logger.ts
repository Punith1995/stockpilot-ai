import { pino } from "pino";

/** Structured logger. Secret-bearing fields are redacted before output. */
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers['x-admin-token']",
      "*.access_token",
      "*.accessToken",
      "*.request_token",
      "*.requestToken",
      "*.api_secret",
      "*.apiSecret",
      "*.checksum",
      "*.token",
      "*.password",
    ],
    censor: "[REDACTED]",
  },
});
