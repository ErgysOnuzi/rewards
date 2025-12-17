import { createHash } from "crypto";

const SALT = "lukerewards-spins";

export function hashIp(ip: string): string {
  return createHash("sha256")
    .update(SALT + ip)
    .digest("hex");
}
