import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import cookieParser from "cookie-parser";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { startBackgroundRefresh } from "./lib/sheets";
import { securityHeaders, csrfProtection, requestIdMiddleware } from "./lib/security";
import { enforceSecurityRequirements } from "./lib/config";
import { pool } from "./db";

// Validate security requirements at startup - fail hard if missing
enforceSecurityRequirements();

const app = express();
const httpServer = createServer(app);

// Trust proxy for production (Replit uses reverse proxy)
app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Security middleware - apply first
app.use(requestIdMiddleware);
app.use(securityHeaders);

app.use(cookieParser());

// Session middleware for custom authentication
// Sessions expire after 20 minutes of inactivity (rolling resets on each request)
const SESSION_TIMEOUT = 20 * 60 * 1000; // 20 minutes in milliseconds
const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "sessions",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET || "dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    rolling: true, // Reset session expiry on each request (activity)
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: SESSION_TIMEOUT, // 20 minutes of inactivity
      sameSite: "lax",
    },
  })
);

// CSRF protection for state-changing requests
app.use(csrfProtection);

// Request body size limits to prevent DoS attacks
const JSON_LIMIT = "100kb"; // Reasonable limit for API requests
const URL_ENCODED_LIMIT = "100kb";

app.use(
  express.json({
    limit: JSON_LIMIT,
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: URL_ENCODED_LIMIT }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  startBackgroundRefresh();
  
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    
    // Log full error server-side for debugging
    console.error(`[ERROR] ${status}:`, err.message || err);
    
    // Never expose internal error details to client in production
    const isProduction = process.env.NODE_ENV === "production";
    const safeMessage = isProduction && status >= 500 
      ? "An error occurred. Please try again."
      : (err.message || "Internal Server Error");

    res.status(status).json({ message: safeMessage });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
