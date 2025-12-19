import { google } from "googleapis";
import { config, validateConfig } from "./config";
import type { WagerRow } from "@shared/schema";

let sheetsClient: ReturnType<typeof google.sheets> | null = null;

// Cache for sheet data to reduce API calls
let wagerDataCache: Map<string, WagerRow> | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  
  const configErrors = validateConfig();
  if (configErrors.length > 0) {
    throw new Error(`Configuration errors: ${configErrors.join(", ")}`);
  }

  const auth = new google.auth.JWT({
    email: config.googleServiceAccountEmail,
    key: config.googleServiceAccountPrivateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

// Find column index by header name (case-insensitive)
function findColumnIndex(headers: string[], columnName: string): number {
  const normalized = columnName.toLowerCase();
  return headers.findIndex(h => h?.toLowerCase() === normalized);
}

// Load all wager data into cache
async function loadWagerDataCache(): Promise<Map<string, WagerRow>> {
  const sheets = getSheetsClient();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetsId,
    range: `${config.wagerSheetName}`,
  });

  const rows = response.data.values;
  const cache = new Map<string, WagerRow>();
  
  if (!rows || rows.length <= 1) return cache;

  // First row is headers - find column indices
  const headers = rows[0].map((h: any) => String(h || ""));
  const userNameIdx = findColumnIndex(headers, "User_Name");
  const wageredWeeklyIdx = findColumnIndex(headers, "Wagered_Weekly");
  const wageredMonthlyIdx = findColumnIndex(headers, "Wagered_Monthly");
  const wageredOverallIdx = findColumnIndex(headers, "Wagered_Overall");
  
  // If headers not found, try fallback column positions
  const stakeIdCol = userNameIdx >= 0 ? userNameIdx : 0;
  const wageredCol = wageredWeeklyIdx >= 0 ? wageredWeeklyIdx : 1;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const stakeId = (row[stakeIdCol] || "").toString().trim();
    if (!stakeId) continue;
    
    const normalizedId = stakeId.toLowerCase();
    
    // Check for duplicate usernames
    if (cache.has(normalizedId)) {
      console.error(`Duplicate username found in sheet: ${stakeId}`);
      continue;
    }
    
    // Parse wagered amount - use weekly if available, otherwise fall back
    let wageredAmount = 0;
    if (wageredWeeklyIdx >= 0 && row[wageredWeeklyIdx]) {
      wageredAmount = parseFloat(row[wageredWeeklyIdx]) || 0;
    } else if (row[wageredCol]) {
      wageredAmount = parseFloat(row[wageredCol]) || 0;
    }
    
    // Clamp negative values to 0
    wageredAmount = Math.max(0, wageredAmount);
    
    cache.set(normalizedId, {
      stakeId: stakeId,
      wageredAmount: wageredAmount,
      periodLabel: "Weekly",
    });
  }

  return cache;
}

export async function getWagerRow(stakeId: string): Promise<WagerRow | null> {
  const now = Date.now();
  
  // Refresh cache if expired or not loaded
  if (!wagerDataCache || (now - cacheTimestamp) > CACHE_TTL_MS) {
    try {
      wagerDataCache = await loadWagerDataCache();
      cacheTimestamp = now;
      console.log(`Loaded ${wagerDataCache.size} users from wager sheet`);
    } catch (err) {
      console.error("Failed to load wager data from sheet:", err);
      throw err;
    }
  }
  
  const normalizedStakeId = stakeId.toLowerCase().trim();
  return wagerDataCache.get(normalizedStakeId) || null;
}

export function calculateTickets(wageredAmount: number): number {
  return Math.floor(wageredAmount / 1000);
}

import { TIER_CONFIG, type SpinTier } from "@shared/schema";

export function determineSpinResult(tier: SpinTier = "bronze"): "WIN" | "LOSE" {
  const winProbability = TIER_CONFIG[tier].winProbability;
  return Math.random() < winProbability ? "WIN" : "LOSE";
}
