import { db } from "../db";
import { sql, eq, isNull, and } from "drizzle-orm";
import { users, referrals } from "@shared/schema";

const DEFAULT_REFERRER = "ergysonuzi";

export async function runStartupMaintenance(): Promise<void> {
  console.log("[Maintenance] Running startup maintenance...");
  
  await fixSchemaColumns();
  await setupDefaultReferrals();
  
  console.log("[Maintenance] Startup maintenance completed");
}

async function fixSchemaColumns(): Promise<void> {
  try {
    const columnsToRemove = ['profile_image_url', 'referral_code', 'referred_by'];
    
    for (const column of columnsToRemove) {
      try {
        await db.execute(sql.raw(`ALTER TABLE users DROP COLUMN IF EXISTS ${column}`));
        console.log(`[Maintenance] Dropped column ${column} (if existed)`);
      } catch (err) {
        console.log(`[Maintenance] Column ${column} already removed or doesn't exist`);
      }
    }
  } catch (err) {
    console.error("[Maintenance] Schema fix error:", err);
  }
}

async function setupDefaultReferrals(): Promise<void> {
  try {
    const [defaultReferrer] = await db.select()
      .from(users)
      .where(sql`LOWER(${users.username}) = ${DEFAULT_REFERRER.toLowerCase()}`);
    
    if (!defaultReferrer) {
      console.log(`[Maintenance] Default referrer "${DEFAULT_REFERRER}" not found - skipping referral setup`);
      return;
    }
    
    const usersWithoutReferrals = await db.select({ id: users.id, username: users.username })
      .from(users)
      .leftJoin(referrals, eq(users.id, referrals.referredUserId))
      .where(and(
        isNull(referrals.id),
        sql`LOWER(${users.username}) != ${DEFAULT_REFERRER.toLowerCase()}`
      ));
    
    if (usersWithoutReferrals.length === 0) {
      console.log("[Maintenance] All users already have referrers");
      return;
    }
    
    let assigned = 0;
    for (const user of usersWithoutReferrals) {
      try {
        await db.insert(referrals).values({
          referrerUserId: defaultReferrer.id,
          referredUserId: user.id,
          referralCode: DEFAULT_REFERRER.toLowerCase(),
          status: "pending",
          createdAt: new Date(),
        });
        assigned++;
      } catch (err) {
        // Skip duplicates
      }
    }
    
    console.log(`[Maintenance] Assigned ${assigned} users to default referrer "${DEFAULT_REFERRER}"`);
  } catch (err) {
    console.error("[Maintenance] Referral setup error:", err);
  }
}
