import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { lookupRequestSchema, spinRequestSchema, demoUsers, spinLogs, guaranteedWins } from "@shared/schema";
import type { LookupResponse, SpinResponse, ErrorResponse, SpinLogRow } from "@shared/schema";
import { getWagerRow, countSpinsForStakeId, appendSpinLogRow, calculateTickets, determineSpinResult } from "./lib/sheets";
import { hashIp } from "./lib/hash";
import { isRateLimited } from "./lib/rateLimit";
import { config, validateConfig } from "./lib/config";
import { ZodError } from "zod";
import { db } from "./db";
import { eq, desc, sql } from "drizzle-orm";

function isDemoMode(): boolean {
  const errors = validateConfig();
  return errors.length > 0;
}

// Seed default demo users if they don't exist
async function seedDemoData() {
  const defaultUsers = [
    { stakeId: "ergys", wageredAmount: 10000, periodLabel: "December 2024" },
    { stakeId: "demo", wageredAmount: 5000, periodLabel: "December 2024" },
    { stakeId: "luke", wageredAmount: 20000, periodLabel: "December 2024" },
  ];
  
  const defaultWins = [
    { stakeId: "luke", spinNumber: 13 },
    { stakeId: "ergys", spinNumber: 2 },
  ];

  for (const user of defaultUsers) {
    const existing = await db.select().from(demoUsers).where(eq(demoUsers.stakeId, user.stakeId));
    if (existing.length === 0) {
      await db.insert(demoUsers).values(user);
    }
  }

  for (const win of defaultWins) {
    const existing = await db.select().from(guaranteedWins)
      .where(eq(guaranteedWins.stakeId, win.stakeId));
    if (!existing.some(w => w.spinNumber === win.spinNumber)) {
      await db.insert(guaranteedWins).values(win);
    }
  }
}

// Initialize on startup
seedDemoData().catch(console.error);

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  app.post("/api/lookup", async (req: Request, res: Response) => {
    try {
      const parsed = lookupRequestSchema.parse(req.body);
      const stakeId = parsed.stake_id.toLowerCase();

      // Demo mode when Google Sheets isn't configured
      if (isDemoMode()) {
        const [demoUser] = await db.select().from(demoUsers).where(eq(demoUsers.stakeId, stakeId));
        if (!demoUser) {
          return res.status(404).json({ message: "Stake ID not found. Try 'ergys', 'demo', or 'luke'." } as ErrorResponse);
        }
        const ticketsTotal = calculateTickets(demoUser.wageredAmount);
        const spinCount = await db.select({ count: sql<number>`count(*)` }).from(spinLogs).where(eq(spinLogs.stakeId, stakeId));
        const ticketsUsed = Number(spinCount[0]?.count || 0);
        const ticketsRemaining = Math.max(0, ticketsTotal - ticketsUsed);
        const winningsSum = await db.select({ sum: sql<number>`COALESCE(SUM(prize_value), 0)` }).from(spinLogs).where(eq(spinLogs.stakeId, stakeId));
        const totalWinnings = Number(winningsSum[0]?.sum || 0);

        const response: LookupResponse = {
          stake_id: stakeId,
          period_label: demoUser.periodLabel,
          wagered_amount: demoUser.wageredAmount,
          tickets_total: ticketsTotal,
          tickets_used: ticketsUsed,
          tickets_remaining: ticketsRemaining,
          total_winnings: totalWinnings,
        };
        return res.json(response);
      }

      const wagerRow = await getWagerRow(stakeId);
      if (!wagerRow) {
        return res.status(404).json({ message: "Stake ID not found in wager sheet." } as ErrorResponse);
      }

      const ticketsTotal = calculateTickets(wagerRow.wageredAmount);
      const ticketsUsed = await countSpinsForStakeId(stakeId);
      const ticketsRemaining = Math.max(0, ticketsTotal - ticketsUsed);
      const winningsSum = await db.select({ sum: sql<number>`COALESCE(SUM(prize_value), 0)` }).from(spinLogs).where(eq(spinLogs.stakeId, stakeId));
      const totalWinnings = Number(winningsSum[0]?.sum || 0);

      const response: LookupResponse = {
        stake_id: wagerRow.stakeId,
        period_label: wagerRow.periodLabel,
        wagered_amount: wagerRow.wageredAmount,
        tickets_total: ticketsTotal,
        tickets_used: ticketsUsed,
        tickets_remaining: ticketsRemaining,
        total_winnings: totalWinnings,
      };

      return res.json(response);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" } as ErrorResponse);
      }
      console.error("Lookup error:", err);
      return res.status(500).json({ message: "Internal server error" } as ErrorResponse);
    }
  });

  app.post("/api/spin", async (req: Request, res: Response) => {
    try {
      const clientIp = getClientIp(req);
      const ipHash = hashIp(clientIp);

      if (isRateLimited(ipHash)) {
        return res.status(429).json({ message: "Too many spin attempts. Try again later." } as ErrorResponse);
      }

      const parsed = spinRequestSchema.parse(req.body);
      const stakeId = parsed.stake_id.toLowerCase();

      // Demo mode when Google Sheets isn't configured
      if (isDemoMode()) {
        const [demoUser] = await db.select().from(demoUsers).where(eq(demoUsers.stakeId, stakeId));
        if (!demoUser) {
          return res.status(404).json({ message: "Stake ID not found. Try 'ergys', 'demo', or 'luke'." } as ErrorResponse);
        }

        const ticketsTotal = calculateTickets(demoUser.wageredAmount);
        const spinCount = await db.select({ count: sql<number>`count(*)` }).from(spinLogs).where(eq(spinLogs.stakeId, stakeId));
        const ticketsUsedBefore = Number(spinCount[0]?.count || 0);
        const ticketsRemaining = ticketsTotal - ticketsUsedBefore;

        if (ticketsRemaining <= 0) {
          return res.status(403).json({ message: "No tickets remaining." } as ErrorResponse);
        }

        // Check for guaranteed win (spin number is ticketsUsedBefore + 1)
        const spinNumber = ticketsUsedBefore + 1;
        const userGuaranteedWins = await db.select().from(guaranteedWins).where(eq(guaranteedWins.stakeId, stakeId));
        const isGuaranteedWin = userGuaranteedWins.some(w => w.spinNumber === spinNumber);
        
        const result = isGuaranteedWin ? "WIN" : determineSpinResult();
        const prizeLabel = result === "WIN" ? config.prizeLabel : "";
        const prizeValue = result === "WIN" ? config.prizeValue : 0;
        const ticketsUsedAfter = ticketsUsedBefore + 1;
        const ticketsRemainingAfter = ticketsTotal - ticketsUsedAfter;

        // Log spin to database
        await db.insert(spinLogs).values({
          stakeId,
          wageredAmount: demoUser.wageredAmount,
          spinNumber,
          result,
          prizeLabel,
          prizeValue,
          ipHash,
        });

        const response: SpinResponse = {
          stake_id: stakeId,
          wagered_amount: demoUser.wageredAmount,
          tickets_total: ticketsTotal,
          tickets_used_before: ticketsUsedBefore,
          tickets_used_after: ticketsUsedAfter,
          tickets_remaining_after: ticketsRemainingAfter,
          result,
          prize_label: prizeLabel,
          prize_value: prizeValue,
        };
        return res.json(response);
      }

      const wagerRow = await getWagerRow(stakeId);
      if (!wagerRow) {
        return res.status(404).json({ message: "Stake ID not found in wager sheet." } as ErrorResponse);
      }

      const ticketsTotal = calculateTickets(wagerRow.wageredAmount);
      const ticketsUsedBefore = await countSpinsForStakeId(stakeId);
      const ticketsRemaining = ticketsTotal - ticketsUsedBefore;

      if (ticketsRemaining <= 0) {
        return res.status(403).json({ message: "No tickets remaining." } as ErrorResponse);
      }

      const result = determineSpinResult();
      const prizeLabel = result === "WIN" ? config.prizeLabel : "";
      const prizeValue = result === "WIN" ? config.prizeValue : 0;
      const ticketsUsedAfter = ticketsUsedBefore + 1;
      const ticketsRemainingAfter = ticketsTotal - ticketsUsedAfter;

      const logRow: SpinLogRow = {
        timestampIso: new Date().toISOString(),
        stakeId: wagerRow.stakeId,
        wageredAmount: wagerRow.wageredAmount,
        ticketsTotal,
        ticketsUsedBefore,
        ticketsUsedAfter,
        ticketsRemainingAfter,
        result,
        winProbability: config.winProbability,
        prizeLabel,
        requestId: randomUUID(),
        ipHash,
        userAgent: req.headers["user-agent"] || "unknown",
      };

      await appendSpinLogRow(logRow);

      const response: SpinResponse = {
        stake_id: wagerRow.stakeId,
        wagered_amount: wagerRow.wageredAmount,
        tickets_total: ticketsTotal,
        tickets_used_before: ticketsUsedBefore,
        tickets_used_after: ticketsUsedAfter,
        tickets_remaining_after: ticketsRemainingAfter,
        result,
        prize_label: prizeLabel,
        prize_value: prizeValue,
      };

      return res.json(response);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: err.errors[0]?.message || "Invalid request" } as ErrorResponse);
      }
      console.error("Spin error:", err);
      return res.status(500).json({ message: "Internal server error" } as ErrorResponse);
    }
  });

  app.get("/api/admin/logs", async (_req: Request, res: Response) => {
    try {
      // Get logs from database (works in both demo and sheets mode)
      const logs = await db.select().from(spinLogs).orderBy(desc(spinLogs.timestamp)).limit(100);
      const totalCount = await db.select({ count: sql<number>`count(*)` }).from(spinLogs);
      const winCount = await db.select({ count: sql<number>`count(*)` }).from(spinLogs).where(eq(spinLogs.result, "WIN"));
      
      const formattedLogs = logs.map(log => ({
        timestamp: log.timestamp.toISOString(),
        stakeId: log.stakeId,
        wageredAmount: log.wageredAmount,
        spinNumber: log.spinNumber,
        result: log.result as "WIN" | "LOSE",
        prizeLabel: log.prizeLabel,
      }));

      return res.json({
        mode: isDemoMode() ? "demo" : "sheets",
        logs: formattedLogs,
        totalSpins: Number(totalCount[0]?.count || 0),
        totalWins: Number(winCount[0]?.count || 0),
      });
    } catch (err) {
      console.error("Admin logs error:", err);
      return res.status(500).json({ message: "Failed to fetch logs" });
    }
  });

  app.get("/api/config", (_req: Request, res: Response) => {
    const configErrors = validateConfig();
    if (configErrors.length > 0) {
      return res.status(500).json({
        configured: false,
        errors: configErrors,
        message: "Please configure the required environment variables in Replit Secrets.",
      });
    }
    return res.json({
      configured: true,
      siteName: config.siteName,
      prizeLabel: config.prizeLabel,
    });
  });

  return httpServer;
}
