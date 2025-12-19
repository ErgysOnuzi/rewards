import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { readFileSync, existsSync } from "fs";

function getDatabaseUrl(): string {
  // In production deployments, check /tmp/replitdb first
  if (existsSync("/tmp/replitdb")) {
    try {
      const url = readFileSync("/tmp/replitdb", "utf-8").trim();
      if (url) return url;
    } catch (e) {
      // Fall through to env var
    }
  }
  return process.env.DATABASE_URL || "";
}

const pool = new pg.Pool({
  connectionString: getDatabaseUrl(),
});

export const db = drizzle(pool, { schema });
