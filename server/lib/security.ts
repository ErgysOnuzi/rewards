import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// =================== CSRF PROTECTION ===================

// CSRF token storage (in production, use Redis or database)
const csrfTokens = new Map<string, { token: string; expires: number }>();

// Generate CSRF token tied to session
export function generateCSRFToken(sessionId: string): string {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = Date.now() + 60 * 60 * 1000; // 1 hour
  csrfTokens.set(sessionId, { token, expires });
  
  // Cleanup expired tokens periodically
  if (csrfTokens.size > 1000) {
    const now = Date.now();
    Array.from(csrfTokens.entries()).forEach(([key, value]) => {
      if (value.expires < now) {
        csrfTokens.delete(key);
      }
    });
  }
  
  return token;
}

// Validate CSRF token with timing-safe comparison
export function validateCSRFToken(sessionId: string, token: string): boolean {
  if (!token || !sessionId) return false;
  
  const stored = csrfTokens.get(sessionId);
  if (!stored || stored.expires < Date.now()) {
    csrfTokens.delete(sessionId);
    return false;
  }
  
  try {
    const tokenBuffer = Buffer.from(token, "hex");
    const storedBuffer = Buffer.from(stored.token, "hex");
    
    if (tokenBuffer.length !== storedBuffer.length) {
      return false;
    }
    
    return crypto.timingSafeEqual(tokenBuffer, storedBuffer);
  } catch {
    return false;
  }
}

// =================== SECURITY HEADERS ===================

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  // Strict Transport Security - force HTTPS for 2 years
  res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  
  // Content Security Policy
  // NOTE: unsafe-inline is required for Vite HMR in development
  // In production, consider using nonces or moving to external scripts
  const isProduction = process.env.NODE_ENV === "production";
  
  const cspDirectives = [
    "default-src 'self'",
    // Production should ideally use nonces, but many React frameworks need unsafe-inline
    `script-src 'self'${isProduction ? "" : " 'unsafe-inline'"}`,
    `style-src 'self' 'unsafe-inline'`, // CSS-in-JS requires this
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self'${isProduction ? "" : " ws: wss:"} https:`,
    "object-src 'none'",
    "base-uri 'self'",
    // Allow iframe embedding from specific trusted domains
    "frame-ancestors 'self' http://lukerewards.com https://lukerewards.com http://www.lukerewards.com https://www.lukerewards.com http://lukethedegen.com https://lukethedegen.com http://www.lukethedegen.com https://www.lukethedegen.com http://*.replit.dev https://*.replit.dev http://*.replit.app https://*.replit.app",
    "form-action 'self'",
  ];
  
  if (isProduction) {
    cspDirectives.push("upgrade-insecure-requests");
  }
  
  res.setHeader("Content-Security-Policy", cspDirectives.join("; "));
  
  // X-Frame-Options removed - CSP frame-ancestors handles iframe security
  
  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  
  // Control referrer information
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  
  // Disable XSS filter - CSP provides better protection
  res.setHeader("X-XSS-Protection", "0");
  
  // Permissions Policy - disable sensitive APIs we don't need
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
  
  next();
}

// =================== CSRF MIDDLEWARE ===================

// CSRF protection using Double Submit Cookie pattern
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Skip for safe methods (idempotent requests)
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }
  
  // Get the session/auth token from cookie using the configured cookie name
  const sessionToken = req.cookies?.[SESSION_CONFIG.COOKIE_NAME];
  
  // For state-changing requests, validate origin/referer as additional layer
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers.host;
  
  // Validate Origin header matches Host
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const expectedHosts = [
        host?.split(":")[0],
        "localhost",
        "127.0.0.1",
      ].filter(Boolean);
      
      if (!expectedHosts.includes(originUrl.hostname)) {
        logSecurityEvent({
          type: "csrf_violation",
          ipHash: hashForLogging(getClientIpForSecurity(req)),
          details: `Origin mismatch: ${origin} vs ${host}`,
        });
        return res.status(403).json({ message: "Request blocked for security reasons" });
      }
    } catch {
      return res.status(403).json({ message: "Request blocked for security reasons" });
    }
  } else if (referer && process.env.NODE_ENV === "production") {
    // In production, require origin or valid referer
    try {
      const refererUrl = new URL(referer);
      const expectedHosts = [host?.split(":")[0]].filter(Boolean);
      
      if (!expectedHosts.includes(refererUrl.hostname)) {
        logSecurityEvent({
          type: "csrf_violation",
          ipHash: hashForLogging(getClientIpForSecurity(req)),
          details: `Referer mismatch: ${referer} vs ${host}`,
        });
        return res.status(403).json({ message: "Request blocked for security reasons" });
      }
    } catch {
      return res.status(403).json({ message: "Request blocked for security reasons" });
    }
  }
  
  // For admin endpoints, also check CSRF token in header
  if (req.path.startsWith("/api/admin/") && sessionToken) {
    const csrfHeader = req.headers["x-csrf-token"] as string;
    if (csrfHeader && !validateCSRFToken(sessionToken, csrfHeader)) {
      logSecurityEvent({
        type: "csrf_violation",
        ipHash: hashForLogging(getClientIpForSecurity(req)),
        details: "Invalid CSRF token",
      });
      return res.status(403).json({ message: "Invalid security token. Please refresh and try again." });
    }
  }
  
  next();
}

// =================== REQUEST TRACKING ===================

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = crypto.randomUUID();
  req.headers["x-request-id"] = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
}

// =================== ERROR HANDLING ===================

// Known safe error codes that map to user-friendly messages
const ERROR_CODES: Record<string, string> = {
  STAKE_ID_NOT_FOUND: "Stake ID not found.",
  NO_TICKETS: "No tickets remaining.",
  INSUFFICIENT_FUNDS: "Not enough available funds.",
  ACCOUNT_SUSPENDED: "Account suspended. Contact support.",
  INVALID_REQUEST: "Invalid request.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  INVALID_PASSWORD: "Invalid password.",
  UNAUTHORIZED: "Unauthorized.",
  SESSION_EXPIRED: "Session expired. Please log in again.",
};

// Sanitize error for client - never expose internal details
export function sanitizeError(error: unknown, errorCode?: string): string {
  // If we have a known error code, use the safe message
  if (errorCode && ERROR_CODES[errorCode]) {
    return ERROR_CODES[errorCode];
  }
  
  // Default generic message - never expose internals
  return "An error occurred. Please try again.";
}

// Get error code from error if it has one
export function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: string }).code;
  }
  return undefined;
}

// =================== SECURITY LOGGING ===================

export type SecurityEventType = 
  | "auth_failure"
  | "auth_success"
  | "session_created"
  | "session_invalidated"
  | "access_denied"
  | "rate_limit_exceeded"
  | "suspicious_activity"
  | "blacklist_hit"
  | "csrf_violation";

interface SecurityEvent {
  type: SecurityEventType;
  timestamp: Date;
  ipHash: string;
  stakeId?: string;
  details?: string;
  requestId?: string;
}

const securityEvents: SecurityEvent[] = [];
const MAX_SECURITY_EVENTS = 1000;

export function logSecurityEvent(event: Omit<SecurityEvent, "timestamp">) {
  const fullEvent: SecurityEvent = {
    ...event,
    timestamp: new Date(),
  };
  
  securityEvents.push(fullEvent);
  if (securityEvents.length > MAX_SECURITY_EVENTS) {
    securityEvents.shift();
  }
  
  const isWarning = [
    "auth_failure", 
    "access_denied", 
    "rate_limit_exceeded", 
    "suspicious_activity", 
    "blacklist_hit", 
    "csrf_violation"
  ].includes(event.type);
  
  const logMessage = `[SECURITY] ${event.type.toUpperCase()}: ${event.stakeId || "anonymous"} from ${event.ipHash}${event.details ? ` - ${event.details}` : ""}`;
  
  if (isWarning) {
    console.warn(logMessage);
  } else {
    console.log(logMessage);
  }
}

export function getRecentSecurityEvents(limit: number = 100): SecurityEvent[] {
  return securityEvents.slice(-limit).reverse();
}

// =================== INPUT SANITIZATION ===================

// Basic HTML entity encoding for display
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// Sanitize stake ID - strict alphanumeric only
export function sanitizeStakeId(stakeId: string): string {
  if (typeof stakeId !== "string") return "";
  return stakeId
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 100);
}

// =================== SESSION CONFIGURATION ===================

export const SESSION_CONFIG = {
  COOKIE_NAME: "admin_session",
  MAX_AGE_MS: 30 * 60 * 1000, // 30 minutes inactivity timeout
  ABSOLUTE_TIMEOUT_MS: 24 * 60 * 60 * 1000, // 24 hours absolute
  COOKIE_OPTIONS: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const, // Strict for maximum CSRF protection
    path: "/",
  },
};

// =================== HELPER FUNCTIONS ===================

// Hash IP for logging using SHA-256 (cryptographically secure)
export function hashForLogging(ip: string): string {
  return crypto
    .createHash("sha256")
    .update(ip + (process.env.SESSION_SECRET || "default-salt"))
    .digest("hex")
    .slice(0, 16); // Truncate for readability in logs
}

// Get client IP for security purposes
export function getClientIpForSecurity(req: Request): string {
  const socketIp = req.socket.remoteAddress || "";
  
  // In production, prefer the socket IP to prevent header spoofing
  if (process.env.NODE_ENV === "production") {
    return socketIp || "unknown";
  }
  
  // In development, allow X-Forwarded-For for local testing
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  
  return socketIp || "unknown";
}
