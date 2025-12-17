import { config } from "./config";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

const HOUR_MS = 60 * 60 * 1000;

export function isRateLimited(ipHash: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(ipHash);
  
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ipHash, {
      count: 1,
      resetAt: now + HOUR_MS,
    });
    return false;
  }
  
  if (entry.count >= config.rateLimitPerIpPerHour) {
    return true;
  }
  
  entry.count++;
  return false;
}

export function cleanupExpiredEntries(): void {
  const now = Date.now();
  const keys = Array.from(rateLimitStore.keys());
  for (const key of keys) {
    const entry = rateLimitStore.get(key);
    if (entry && now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

setInterval(cleanupExpiredEntries, HOUR_MS);
