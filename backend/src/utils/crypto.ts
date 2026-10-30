import crypto from "node:crypto";

/**
 * AES-256-GCM for sensitive values held in server memory (e.g. a broker access token).
 * The key is SHA-256 of ENCRYPTION_KEY. If none is configured, a random per-process key is
 * used, which means encrypted values do not survive a restart (that is intended).
 */
const key = crypto.createHash("sha256")
  .update(process.env.ENCRYPTION_KEY ?? crypto.randomBytes(32).toString("hex"))
  .digest();

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB, tagB, encB] = payload.split(".").map((s) => Buffer.from(s, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, ivB);
  decipher.setAuthTag(tagB);
  return Buffer.concat([decipher.update(encB), decipher.final()]).toString("utf8");
}

/** SHA-256 hex, used for the Kite session checksum (api_key + request_token + api_secret). */
export function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}
