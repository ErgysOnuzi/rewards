import { db } from "../db";
import { adminActivityLogs } from "@shared/schema";
import { desc } from "drizzle-orm";

export type AdminAction = 
  | "login"
  | "logout"
  | "login_failed"
  | "verify_user"
  | "reject_user"
  | "approve_withdrawal"
  | "reject_withdrawal"
  | "flag_user"
  | "unflag_user"
  | "export_raffle"
  | "refresh_cache"
  | "update_toggle"
  | "delete_user"
  | "update_wager_override"
  | "delete_wager_override"
  | "view_user"
  | "manual_backup"
  | "download_backup"
  | "update_user_profile"
  | "setup_referrals";

export type TargetType = "user" | "withdrawal" | "toggle" | "export" | "cache" | "backup" | "session" | "referral";

export interface AdminActivityLogEntry {
  action: AdminAction;
  targetType?: TargetType;
  targetId?: string;
  details?: Record<string, unknown>;
  ipHash?: string;
}

export async function logAdminActivity(entry: AdminActivityLogEntry): Promise<void> {
  try {
    await db.insert(adminActivityLogs).values({
      action: entry.action,
      targetType: entry.targetType || null,
      targetId: entry.targetId || null,
      details: entry.details ? JSON.stringify(entry.details) : null,
      ipHash: entry.ipHash || null,
    });
  } catch (error) {
    console.error("[AdminActivityLog] Failed to log activity:", error);
  }
}

export async function getAdminActivityLogs(limit: number = 100, offset: number = 0) {
  return db
    .select()
    .from(adminActivityLogs)
    .orderBy(desc(adminActivityLogs.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getAdminActivityLogCount(): Promise<number> {
  const result = await db
    .select({ count: adminActivityLogs.id })
    .from(adminActivityLogs);
  return result.length;
}
