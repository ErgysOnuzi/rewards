import { createHash } from "crypto";

const SALT = "lukerewards-spins";

export function hashIp(ip: string): string {
  return createHash("sha256")
    .update(SALT + ip)
    .digest("hex");
}

export function maskUsername(username: string): string {
  if (!username) return "";
  const clean = username.trim();
  if (clean.length <= 4) {
    return clean.charAt(0) + "***";
  }
  const first2 = clean.slice(0, 2);
  const last2 = clean.slice(-2);
  return `${first2}***${last2}`;
}
