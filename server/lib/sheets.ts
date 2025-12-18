import { google } from "googleapis";
import { config, validateConfig } from "./config";
import type { WagerRow, SpinLogRow } from "@shared/schema";

let sheetsClient: ReturnType<typeof google.sheets> | null = null;

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  
  const configErrors = validateConfig();
  if (configErrors.length > 0) {
    throw new Error(`Configuration errors: ${configErrors.join(", ")}`);
  }

  const auth = new google.auth.JWT({
    email: config.googleServiceAccountEmail,
    key: config.googleServiceAccountPrivateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

export async function getWagerRow(stakeId: string): Promise<WagerRow | null> {
  const sheets = getSheetsClient();
  const normalizedStakeId = stakeId.toLowerCase();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetsId,
    range: `${config.wagerSheetName}!A:D`,
  });

  const rows = response.data.values;
  if (!rows || rows.length <= 1) return null;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowStakeId = (row[0] || "").toString().toLowerCase();
    
    if (rowStakeId === normalizedStakeId) {
      return {
        stakeId: row[0]?.toString() || stakeId,
        wageredAmount: parseFloat(row[1]) || 0,
        periodLabel: row[2]?.toString() || undefined,
        updatedAt: row[3]?.toString() || undefined,
      };
    }
  }

  return null;
}

export async function countSpinsForStakeId(stakeId: string): Promise<number> {
  const sheets = getSheetsClient();
  const normalizedStakeId = stakeId.toLowerCase();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetsId,
    range: `${config.spinLogSheetName}!B:B`,
  });

  const rows = response.data.values;
  if (!rows || rows.length <= 1) return 0;

  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    const rowStakeId = (rows[i]?.[0] || "").toString().toLowerCase();
    if (rowStakeId === normalizedStakeId) {
      count++;
    }
  }

  return count;
}

export async function appendSpinLogRow(logRow: SpinLogRow): Promise<void> {
  const sheets = getSheetsClient();
  
  const row = [
    logRow.timestampIso,
    logRow.stakeId,
    logRow.wageredAmount,
    logRow.ticketsTotal,
    logRow.ticketsUsedBefore,
    logRow.ticketsUsedAfter,
    logRow.ticketsRemainingAfter,
    logRow.result,
    logRow.winProbability,
    logRow.prizeLabel,
    logRow.requestId,
    logRow.ipHash,
    logRow.userAgent,
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.googleSheetsId,
    range: `${config.spinLogSheetName}!A:M`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [row],
    },
  });
}

export function calculateTickets(wageredAmount: number): number {
  return Math.floor(wageredAmount / 1000);
}

import { TIER_CONFIG, type SpinTier } from "@shared/schema";

export function determineSpinResult(tier: SpinTier = "bronze"): "WIN" | "LOSE" {
  const winProbability = TIER_CONFIG[tier].winProbability;
  return Math.random() < winProbability ? "WIN" : "LOSE";
}
