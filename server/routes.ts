import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { lookupRequestSchema, spinRequestSchema } from "@shared/schema";
import type { LookupResponse, SpinResponse, ErrorResponse, SpinLogRow } from "@shared/schema";
import { getWagerRow, countSpinsForStakeId, appendSpinLogRow, calculateTickets, determineSpinResult } from "./lib/sheets";
import { hashIp } from "./lib/hash";
import { isRateLimited } from "./lib/rateLimit";
import { config, validateConfig } from "./lib/config";
import { ZodError } from "zod";

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
      const stakeId = parsed.stake_id;

      const wagerRow = await getWagerRow(stakeId);
      if (!wagerRow) {
        return res.status(404).json({ message: "Stake ID not found in wager sheet." } as ErrorResponse);
      }

      const ticketsTotal = calculateTickets(wagerRow.wageredAmount);
      const ticketsUsed = await countSpinsForStakeId(stakeId);
      const ticketsRemaining = Math.max(0, ticketsTotal - ticketsUsed);

      const response: LookupResponse = {
        stake_id: wagerRow.stakeId,
        period_label: wagerRow.periodLabel,
        wagered_amount: wagerRow.wageredAmount,
        tickets_total: ticketsTotal,
        tickets_used: ticketsUsed,
        tickets_remaining: ticketsRemaining,
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
      const stakeId = parsed.stake_id;

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
