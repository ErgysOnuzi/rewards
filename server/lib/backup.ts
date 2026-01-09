import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { db } from "../db";
import { backupLogs } from "@shared/schema";
import { desc, lt } from "drizzle-orm";

const execAsync = promisify(exec);

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
  await db.delete(backupLogs).where(lt(backupLogs.createdAt, cutoffDate));

  return deletedCount;
}

export async function createBackup(manual: boolean = false): Promise<{ success: boolean; filename?: string; error?: string }> {
  ensureBackupDir();
  
  const filename = getBackupFilename();
  const filepath = path.join(BACKUP_DIR, filename);
  
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    const error = "DATABASE_URL not configured";
    console.error("[Backup] Failed:", error);
    await db.insert(backupLogs).values({
      filename,
      status: "failed",
      errorMessage: error,
    });
    return { success: false, error };
  }

  try {
    const command = `pg_dump "${databaseUrl}" --no-owner --no-acl -f "${filepath}"`;
    await execAsync(command, { timeout: 300000 });
    
    const stats = fs.statSync(filepath);
    const sizeBytes = stats.size;
    
    await db.insert(backupLogs).values({
      filename,
      sizeBytes,
      status: "success",
    });
    
    console.log(`[Backup] ${manual ? "Manual" : "Scheduled"} backup created: ${filename} (${(sizeBytes / 1024 / 1024).toFixed(2)} MB)`);
    
    const deletedCount = await cleanupOldBackups();
    if (deletedCount > 0) {
      console.log(`[Backup] Cleaned up ${deletedCount} old backup(s)`);
    }
    
    return { success: true, filename };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[Backup] Failed:", errorMessage);
    
    await db.insert(backupLogs).values({
      filename,
      status: "failed",
      errorMessage,
    });
    
    return { success: false, error: errorMessage };
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
  const recentBackups = await db
    .select()
    .from(backupLogs)
    .orderBy(desc(backupLogs.createdAt))
    .limit(10);

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
    recentBackups: recentBackups.map(b => ({
      filename: b.filename,
      createdAt: b.createdAt,
      status: b.status,
      sizeBytes: b.sizeBytes,
    })),
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
