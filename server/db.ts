import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

// Use NEON_DATABASE_URL if available, otherwise fall back to DATABASE_URL
const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;

const isExternalDb = connectionString?.includes('neon.tech') || 
                     connectionString?.includes('supabase') ||
                     connectionString?.includes('sslmode=require');

const pool = new pg.Pool({
  connectionString,
  ssl: isExternalDb ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema });
