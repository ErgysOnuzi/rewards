import * as fs from "fs";
import * as path from "path";
import { db, pool } from "../db";
import { backupLogs } from "@shared/schema";
import { desc, lt } from "drizzle-orm";

const BACKUP_DIR = "./backups";
const MAX_BACKUP_AGE_DAYS = 7;
const BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000;

let backupIntervalId: NodeJS.Timeout | null = null;

function ensureBackupDir(): void {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log("[Backup] Created backup directory:", BACKUP_DIR);
  }
}

function getBackupFilename(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `backup_${timestamp}.sql`;
}

async function cleanupOldBackups(): Promise<number> {
  const files = fs.readdirSync(BACKUP_DIR);
  const now = Date.now();
  const maxAge = MAX_BACKUP_AGE_DAYS * 24 * 60 * 60 * 1000;
  let deletedCount = 0;

  for (const file of files) {
    if (!file.endsWith(".sql")) continue;
    
    const filePath = path.join(BACKUP_DIR, file);
    const stats = fs.statSync(filePath);
    const age = now - stats.mtime.getTime();
    
    if (age > maxAge) {
      fs.unlinkSync(filePath);
      deletedCount++;
      console.log("[Backup] Deleted old backup:", file);
    }
  }

  const cutoffDate = new Date(now - maxAge);
  try {
    await db.delete(backupLogs).where(lt(backupLogs.createdAt, cutoffDate));
  } catch (e) {
    console.log("[Backup] Could not clean backup_logs:", e);
  }

  return deletedCount;
}

const TABLES_TO_BACKUP = [
  "users",
  "verification_requests", 
  "spin_logs",
  "user_wallets",
  "user_spin_balances",
  "withdrawal_requests",
  "wallet_transactions",
  "user_flags",
  "admin_sessions",
  "admin_credentials",
  "export_logs",
  "feature_toggles",
  "payouts",
  "rate_limit_logs",
  "user_state",
  "wager_overrides",
  "guaranteed_wins",
  "demo_users",
  "admin_activity_logs",
  "backup_logs"
];

async function exportTableToSQL(client: any, tableName: string): Promise<string> {
  try {
    const result = await client.query(`SELECT * FROM ${tableName}`);
    if (result.rows.length === 0) {
      return `-- Table ${tableName}: 0 rows\n`;
    }

    const columns = Object.keys(result.rows[0]);
    let sql = `-- Table ${tableName}: ${result.rows.length} rows\n`;
    sql += `DELETE FROM ${tableName};\n`;

    for (const row of result.rows) {
      const values = columns.map(col => {
        const val = row[col];
        if (val === null) return "NULL";
        if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
        if (typeof val === "number") return String(val);
        if (val instanceof Date) return `'${val.toISOString()}'`;
        const escaped = String(val).replace(/'/g, "''");
        return `'${escaped}'`;
      });
      sql += `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${values.join(", ")});\n`;
    }

    return sql + "\n";
  } catch (error) {
    return `-- Table ${tableName}: Error exporting - ${error}\n`;
  }
}

export async function createBackup(manual: boolean = false): Promise<{ success: boolean; filename?: string; error?: string }> {
  ensureBackupDir();
  
  const filename = getBackupFilename();
  const filepath = path.join(BACKUP_DIR, filename);
  
  const client = await pool.connect();
  
  try {
    await client.query("SET search_path TO public");
    
    let sqlContent = `-- LukeRewards Database Backup\n`;
    sqlContent += `-- Created: ${new Date().toISOString()}\n`;
    sqlContent += `-- Type: ${manual ? "Manual" : "Scheduled"}\n\n`;
    sqlContent += `SET search_path TO public;\n\n`;

    for (const table of TABLES_TO_BACKUP) {
      sqlContent += await exportTableToSQL(client, table);
    }

    fs.writeFileSync(filepath, sqlContent, "utf8");
    const stats = fs.statSync(filepath);
    const sizeBytes = stats.size;
    
    try {
      await db.insert(backupLogs).values({
        filename,
        sizeBytes,
        status: "success",
      });
    } catch (e) {
      console.log("[Backup] Could not log to backup_logs table");
    }
    
    console.log(`[Backup] ${manual ? "Manual" : "Scheduled"} backup created: ${filename} (${(sizeBytes / 1024).toFixed(2)} KB)`);
    
    const deletedCount = await cleanupOldBackups();
    if (deletedCount > 0) {
      console.log(`[Backup] Cleaned up ${deletedCount} old backup(s)`);
    }
    
    return { success: true, filename };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[Backup] Failed:", errorMessage);
    
    try {
      await db.insert(backupLogs).values({
        filename,
        status: "failed",
        errorMessage,
      });
    } catch (e) {
      console.log("[Backup] Could not log failure to backup_logs table");
    }
    
    return { success: false, error: errorMessage };
  } finally {
    client.release();
  }
}

export function startBackupScheduler(): void {
  if (backupIntervalId) {
    console.log("[Backup] Scheduler already running");
    return;
  }

  console.log(`[Backup] Starting scheduler (every ${BACKUP_INTERVAL_MS / 3600000} hours)`);
  
  backupIntervalId = setInterval(async () => {
    console.log("[Backup] Running scheduled backup...");
    await createBackup(false);
  }, BACKUP_INTERVAL_MS);

  setTimeout(async () => {
    console.log("[Backup] Running initial backup on startup...");
    await createBackup(false);
  }, 60000);
}

export function stopBackupScheduler(): void {
  if (backupIntervalId) {
    clearInterval(backupIntervalId);
    backupIntervalId = null;
    console.log("[Backup] Scheduler stopped");
  }
}

export async function getBackupStatus(): Promise<{
  schedulerRunning: boolean;
  backupDir: string;
  backupCount: number;
  lastBackup: { filename: string; createdAt: Date; sizeBytes: number | null } | null;
  recentBackups: Array<{ filename: string; createdAt: Date; status: string; sizeBytes: number | null }>;
}> {
  let recentBackups: Array<{ filename: string; createdAt: Date; status: string; sizeBytes: number | null }> = [];
  
  try {
    const logs = await db
      .select()
      .from(backupLogs)
      .orderBy(desc(backupLogs.createdAt))
      .limit(10);
    
    recentBackups = logs.map(b => ({
      filename: b.filename,
      createdAt: b.createdAt,
      status: b.status,
      sizeBytes: b.sizeBytes,
    }));
  } catch (e) {
    console.log("[Backup] Could not fetch backup logs from database");
  }

  let backupCount = 0;
  try {
    if (fs.existsSync(BACKUP_DIR)) {
      backupCount = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith(".sql")).length;
    }
  } catch {}

  const lastSuccessful = recentBackups.find(b => b.status === "success");

  return {
    schedulerRunning: backupIntervalId !== null,
    backupDir: BACKUP_DIR,
    backupCount,
    lastBackup: lastSuccessful ? {
      filename: lastSuccessful.filename,
      createdAt: lastSuccessful.createdAt,
      sizeBytes: lastSuccessful.sizeBytes,
    } : null,
    recentBackups,
  };
}

export async function listBackupFiles(): Promise<Array<{ filename: string; sizeBytes: number; createdAt: Date }>> {
  if (!fs.existsSync(BACKUP_DIR)) {
    return [];
  }

  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith(".sql"))
    .map(filename => {
      const filepath = path.join(BACKUP_DIR, filename);
      const stats = fs.statSync(filepath);
      return {
        filename,
        sizeBytes: stats.size,
        createdAt: stats.mtime,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return files;
}
