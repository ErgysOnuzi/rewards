import { config } from "./config";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ipRateLimitStore = new Map<string, RateLimitEntry>();
const stakeIdRateLimitStore = new Map<string, RateLimitEntry>();

const HOUR_MS = 60 * 60 * 1000;
const STAKE_ID_LIMIT_PER_HOUR = 50; // Max spins per stake ID per hour

export function isRateLimited(ipHash: string): boolean {
  const now = Date.now();
  const entry = ipRateLimitStore.get(ipHash);
  
  if (!entry || now > entry.resetAt) {
    ipRateLimitStore.set(ipHash, {
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

export function isStakeIdRateLimited(stakeId: string): boolean {
  const now = Date.now();
  const key = stakeId.toLowerCase();
  const entry = stakeIdRateLimitStore.get(key);
  
  if (!entry || now > entry.resetAt) {
    stakeIdRateLimitStore.set(key, {
      count: 1,
      resetAt: now + HOUR_MS,
    });
    return false;
  }
  
  if (entry.count >= STAKE_ID_LIMIT_PER_HOUR) {
    return true;
  }
  
  entry.count++;
  return false;
}

export function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const store of [ipRateLimitStore, stakeIdRateLimitStore]) {
    const keys = Array.from(store.keys());
    for (const key of keys) {
      const entry = store.get(key);
      if (entry && now > entry.resetAt) {
        store.delete(key);
      }
    }
  }
}

setInterval(cleanupExpiredEntries, HOUR_MS);
