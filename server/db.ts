import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

const isExternalDb = connectionString.includes('neon.tech') || 
                     connectionString.includes('supabase') ||
                     connectionString.includes('sslmode=require');

export const pool = new pg.Pool({
  connectionString,
  ssl: isExternalDb ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool, { schema });

// Bootstrap function to ensure all required tables exist
// This runs on startup and creates any missing tables
export async function bootstrapDatabase(): Promise<void> {
  console.log("[DB Bootstrap] Checking database tables...");
  
  const client = await pool.connect();
  try {
    // Ensure we're using the public schema
    await client.query(`SET search_path TO public`);
    
    // Create sessions table (required for express-session)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR PRIMARY KEY,
        sess JSONB NOT NULL,
        expire TIMESTAMP NOT NULL
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions (expire)`);
    
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR UNIQUE NOT NULL,
        password_hash VARCHAR NOT NULL,
        email VARCHAR,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        stake_username VARCHAR,
        stake_platform VARCHAR,
        verification_status VARCHAR DEFAULT 'unverified',
        verified_at TIMESTAMP,
        security_disclaimer_accepted BOOLEAN DEFAULT false,
        deleted_at TIMESTAMP
      )
    `);
    
    // Add missing columns to users table (for existing tables that need migration)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS security_disclaimer_accepted BOOLEAN DEFAULT false`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stake_username VARCHAR`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stake_platform VARCHAR`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_status VARCHAR DEFAULT 'unverified'`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP`);
    
    // Create verification_requests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS verification_requests (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR NOT NULL,
        screenshot_url VARCHAR NOT NULL,
        submitted_at TIMESTAMP DEFAULT NOW(),
        reviewed_at TIMESTAMP,
        reviewed_by VARCHAR,
        status VARCHAR DEFAULT 'pending',
        admin_notes VARCHAR
      )
    `);
    
    // Create spin_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS spin_logs (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT NOW() NOT NULL,
        stake_id VARCHAR NOT NULL,
        wagered_amount REAL NOT NULL,
        spin_number INTEGER NOT NULL,
        result VARCHAR NOT NULL,
        prize_label VARCHAR NOT NULL,
        prize_value INTEGER DEFAULT 0 NOT NULL,
        prize_color VARCHAR,
        is_bonus BOOLEAN DEFAULT false NOT NULL,
        ip_hash VARCHAR
      )
    `);
    
    // Create user_wallets table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_wallets (
        id SERIAL PRIMARY KEY,
        stake_id VARCHAR UNIQUE NOT NULL,
        balance INTEGER DEFAULT 0 NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    
    // Create user_spin_balances table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_spin_balances (
        id SERIAL PRIMARY KEY,
        stake_id VARCHAR NOT NULL,
        tier VARCHAR NOT NULL,
        balance INTEGER DEFAULT 0 NOT NULL
      )
    `);
    
    // Create withdrawal_requests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id SERIAL PRIMARY KEY,
        stake_id VARCHAR NOT NULL,
        amount INTEGER NOT NULL,
        status VARCHAR DEFAULT 'pending' NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        processed_at TIMESTAMP,
        admin_notes VARCHAR
      )
    `);
    
    // Create wallet_transactions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id SERIAL PRIMARY KEY,
        stake_id VARCHAR NOT NULL,
        type VARCHAR NOT NULL,
        amount INTEGER NOT NULL,
        tier VARCHAR,
        description VARCHAR,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    
    // Create user_flags table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_flags (
        id SERIAL PRIMARY KEY,
        stake_id VARCHAR UNIQUE NOT NULL,
        flag_type VARCHAR NOT NULL,
        notes VARCHAR,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    
    // Create admin_sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id SERIAL PRIMARY KEY,
        token_hash VARCHAR NOT NULL,
        ip_hash VARCHAR NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        is_valid BOOLEAN DEFAULT true NOT NULL
      )
    `);
    
    // Create admin_credentials table - stores encrypted username and bcrypt password hash
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_credentials (
        id SERIAL PRIMARY KEY,
        username_encrypted VARCHAR NOT NULL,
        password_hash VARCHAR NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    
    // Create user_state table (for bonus spin tracking)
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_state (
        id SERIAL PRIMARY KEY,
        stake_id VARCHAR UNIQUE NOT NULL,
        last_bonus_spin_at TIMESTAMP,
        total_spins INTEGER DEFAULT 0 NOT NULL,
        total_won INTEGER DEFAULT 0 NOT NULL
      )
    `);
    
    // Create feature_toggles table
    await client.query(`
      CREATE TABLE IF NOT EXISTS feature_toggles (
        id SERIAL PRIMARY KEY,
        key VARCHAR UNIQUE NOT NULL,
        value VARCHAR NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    
    // Create payouts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS payouts (
        id SERIAL PRIMARY KEY,
        stake_id VARCHAR NOT NULL,
        amount INTEGER NOT NULL,
        type VARCHAR NOT NULL,
        reference VARCHAR,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    
    // Create export_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS export_logs (
        id SERIAL PRIMARY KEY,
        campaign VARCHAR NOT NULL,
        week VARCHAR NOT NULL,
        exported_at TIMESTAMP DEFAULT NOW() NOT NULL,
        row_count INTEGER NOT NULL,
        exported_by VARCHAR
      )
    `);
    
    // Create rate_limit_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS rate_limit_logs (
        id SERIAL PRIMARY KEY,
        ip_hash VARCHAR NOT NULL,
        endpoint VARCHAR NOT NULL,
        count INTEGER DEFAULT 1 NOT NULL,
        window_start TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    
    // Create wager_overrides table
    await client.query(`
      CREATE TABLE IF NOT EXISTS wager_overrides (
        id SERIAL PRIMARY KEY,
        stake_id VARCHAR NOT NULL,
        wagered_override INTEGER NOT NULL,
        notes VARCHAR,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    
    // Create guaranteed_wins table
    await client.query(`
      CREATE TABLE IF NOT EXISTS guaranteed_wins (
        id SERIAL PRIMARY KEY,
        stake_id VARCHAR NOT NULL,
        spin_number INTEGER NOT NULL
      )
    `);
    
    // Create demo_users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS demo_users (
        id SERIAL PRIMARY KEY,
        stake_id VARCHAR UNIQUE NOT NULL,
        wagered_amount INTEGER NOT NULL,
        period_label VARCHAR NOT NULL
      )
    `);
    
    // Create admin_activity_logs table for audit trail
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_activity_logs (
        id SERIAL PRIMARY KEY,
        action VARCHAR NOT NULL,
        target_type VARCHAR,
        target_id VARCHAR,
        details TEXT,
        ip_hash VARCHAR,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    
    // Create backup_logs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS backup_logs (
        id SERIAL PRIMARY KEY,
        filename VARCHAR NOT NULL,
        size_bytes INTEGER,
        status VARCHAR NOT NULL,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    
    // Create password_reset_tokens table
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        request_ip_hash TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);
    
    console.log("[DB Bootstrap] All tables verified/created successfully");
  } catch (error) {
    console.error("[DB Bootstrap] Failed to create tables:", error);
    throw error;
  } finally {
    client.release();
  }
}
