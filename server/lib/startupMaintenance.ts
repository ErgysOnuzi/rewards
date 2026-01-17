import { db } from "../db";
import { sql, eq, isNull, and } from "drizzle-orm";
import { users, referrals } from "@shared/schema";

const DEFAULT_REFERRER = "ergysonuzi";

export async function runStartupMaintenance(): Promise<void> {
  console.log("[Maintenance] Running startup maintenance...");
  
  await ensureTablesExist();
  await fixSchemaColumns();
  await setupDefaultReferrals();
  
  console.log("[Maintenance] Startup maintenance completed");
}

async function ensureTablesExist(): Promise<void> {
  try {
    // Create referrals table if it doesn't exist
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_user_id INTEGER NOT NULL REFERENCES users(id),
        referred_user_id INTEGER NOT NULL REFERENCES users(id) UNIQUE,
        referral_code VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        bonus_amount INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        qualified_at TIMESTAMP
      )
    `);
    console.log("[Maintenance] Ensured referrals table exists");
  } catch (err) {
    console.error("[Maintenance] Error creating tables:", err);
  }
}

async function fixSchemaColumns(): Promise<void> {
  try {
    // Use individual safe SQL statements for each column
    try {
      await db.execute(sql`ALTER TABLE users DROP COLUMN IF EXISTS profile_image_url`);
      console.log(`[Maintenance] Dropped column profile_image_url (if existed)`);
    } catch (err) {
      console.log(`[Maintenance] Column profile_image_url already removed or doesn't exist`);
    }
    
    try {
      await db.execute(sql`ALTER TABLE users DROP COLUMN IF EXISTS referral_code`);
      console.log(`[Maintenance] Dropped column referral_code (if existed)`);
    } catch (err) {
      console.log(`[Maintenance] Column referral_code already removed or doesn't exist`);
    }
    
    try {
      await db.execute(sql`ALTER TABLE users DROP COLUMN IF EXISTS referred_by`);
      console.log(`[Maintenance] Dropped column referred_by (if existed)`);
    } catch (err) {
      console.log(`[Maintenance] Column referred_by already removed or doesn't exist`);
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
