import { config } from "./config";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const ipRateLimitStore = new Map<string, RateLimitEntry>();
const stakeIdRateLimitStore = new Map<string, RateLimitEntry>();
const adminLoginAttemptStore = new Map<string, RateLimitEntry>();
const authAttemptStore = new Map<string, RateLimitEntry>();

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const STAKE_ID_LIMIT_PER_HOUR = 50; // Max spins per stake ID per hour
const ADMIN_LOGIN_LIMIT = 5; // Max admin login attempts per 15 minutes
const ADMIN_LOGIN_WINDOW_MS = 15 * MINUTE_MS;
const AUTH_ATTEMPT_LIMIT = 10; // Max login/register attempts per 15 minutes
const AUTH_ATTEMPT_WINDOW_MS = 15 * MINUTE_MS;

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

// Admin login brute force protection - 5 attempts per 15 minutes
export function isAdminLoginRateLimited(ipHash: string): boolean {
  const now = Date.now();
  const entry = adminLoginAttemptStore.get(ipHash);
  
  if (!entry || now > entry.resetAt) {
    adminLoginAttemptStore.set(ipHash, {
      count: 1,
      resetAt: now + ADMIN_LOGIN_WINDOW_MS,
    });
    return false;
  }
  
  if (entry.count >= ADMIN_LOGIN_LIMIT) {
    return true;
  }
  
  entry.count++;
  return false;
}

// Get remaining lockout time for admin login
export function getAdminLoginLockoutMs(ipHash: string): number {
  const entry = adminLoginAttemptStore.get(ipHash);
  if (!entry) return 0;
  const remaining = entry.resetAt - Date.now();
  return remaining > 0 ? remaining : 0;
}

// Reset admin login attempts on successful login
export function resetAdminLoginAttempts(ipHash: string): void {
  adminLoginAttemptStore.delete(ipHash);
}

// User login/register brute force protection - 10 attempts per 15 minutes
export function isAuthRateLimited(ipHash: string): boolean {
  const now = Date.now();
  const entry = authAttemptStore.get(ipHash);
  
  if (!entry || now > entry.resetAt) {
    authAttemptStore.set(ipHash, {
      count: 1,
      resetAt: now + AUTH_ATTEMPT_WINDOW_MS,
    });
    return false;
  }
  
  if (entry.count >= AUTH_ATTEMPT_LIMIT) {
    return true;
  }
  
  entry.count++;
  return false;
}

// Get remaining lockout time for auth attempts
export function getAuthLockoutMs(ipHash: string): number {
  const entry = authAttemptStore.get(ipHash);
  if (!entry) return 0;
  const remaining = entry.resetAt - Date.now();
  return remaining > 0 ? remaining : 0;
}

// Reset auth attempts on successful login
export function resetAuthAttempts(ipHash: string): void {
  authAttemptStore.delete(ipHash);
}

export function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const store of [ipRateLimitStore, stakeIdRateLimitStore, adminLoginAttemptStore, authAttemptStore]) {
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
