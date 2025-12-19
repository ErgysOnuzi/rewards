import { google } from "googleapis";
import { config } from "./config";
import type { WagerRow } from "@shared/schema";
import crypto from "crypto";

// Google Sheets OAuth connection via Replit integration
let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('Replit token not found - Google Sheets connection unavailable');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-sheet',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Google Sheet not connected - please connect via Replit integrations');
  }
  return accessToken;
}

// Get a fresh Google Sheets client (tokens expire, so never cache)
async function getSheetsClient() {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.sheets({ version: 'v4', auth: oauth2Client });
}

// Cache for sheet data to reduce API calls
let wagerDataCache: Map<string, WagerRow> | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 1 * 60 * 1000; // 1 minute

// Find column index by header name (case-insensitive)
function findColumnIndex(headers: string[], columnName: string): number {
  const normalized = columnName.toLowerCase();
  return headers.findIndex(h => h?.toLowerCase() === normalized);
}

// Load all wager data into cache
async function loadWagerDataCache(): Promise<Map<string, WagerRow>> {
  const sheets = await getSheetsClient();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.googleSheetsId,
    range: `${config.wagerSheetName}`,
  });

  const rows = response.data.values;
  const cache = new Map<string, WagerRow>();
  
  if (!rows || rows.length <= 2) return cache;

  // Find the header row - check first few rows for "User_Name" column
  let headerRowIdx = 0;
  let headers: string[] = [];
  
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const potentialHeaders = rows[i].map((h: any) => String(h || "").trim());
    if (potentialHeaders.some((h: string) => h.toLowerCase() === "user_name")) {
      headerRowIdx = i;
      headers = potentialHeaders;
      break;
    }
  }
  
  if (headers.length === 0) {
    console.error("Could not find User_Name column in sheet headers");
    return cache;
  }

  const userNameIdx = findColumnIndex(headers, "User_Name");
  const wageredMonthlyIdx = findColumnIndex(headers, "Wagered_Monthly");
  const wageredWeeklyIdx = findColumnIndex(headers, "Wagered_Weekly");
  const wageredOverallIdx = findColumnIndex(headers, "Wagered_Overall");
  
  console.log(`Found headers at row ${headerRowIdx + 1}: User_Name=${userNameIdx}, Wagered_Monthly=${wageredMonthlyIdx}`);
  
  // If headers not found, try fallback column positions
  const stakeIdCol = userNameIdx >= 0 ? userNameIdx : 0;
  // Prefer monthly, fall back to weekly, then overall
  const wageredCol = wageredMonthlyIdx >= 0 ? wageredMonthlyIdx : 
                     wageredWeeklyIdx >= 0 ? wageredWeeklyIdx : 
                     wageredOverallIdx >= 0 ? wageredOverallIdx : 1;

  // Start from the row after headers
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    // Pad row to header length - Google Sheets API truncates trailing empty cells
    const rawRow = rows[i];
    const row = [...rawRow, ...Array(Math.max(0, headers.length - rawRow.length)).fill('')];
    const stakeId = (row[stakeIdCol] || "").toString().trim();
    if (!stakeId) continue;
    
    const normalizedId = stakeId.toLowerCase();
    
    // For duplicates, sum the wagered amounts instead of skipping
    const existing = cache.get(normalizedId);
    
    // Parse wagered amount - prefer monthly, fall back to weekly, then overall
    let wageredAmount = 0;
    const parseWager = (val: any): number => {
      if (!val) return 0;
      // Remove $ signs, commas and parse
      return parseFloat(String(val).replace(/[$,]/g, "")) || 0;
    };
    
    if (wageredMonthlyIdx >= 0 && row[wageredMonthlyIdx]) {
      wageredAmount = parseWager(row[wageredMonthlyIdx]);
    } else if (wageredWeeklyIdx >= 0 && row[wageredWeeklyIdx]) {
      wageredAmount = parseWager(row[wageredWeeklyIdx]);
    } else if (wageredOverallIdx >= 0 && row[wageredOverallIdx]) {
      wageredAmount = parseWager(row[wageredOverallIdx]);
    }
    
    // Clamp negative values to 0
    wageredAmount = Math.max(0, wageredAmount);
    
    if (existing) {
      // Sum wagered amounts for duplicate users
      existing.wageredAmount += wageredAmount;
    } else {
      cache.set(normalizedId, {
        stakeId: stakeId,
        wageredAmount: wageredAmount,
        periodLabel: "Monthly",
      });
    }
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

import { TIER_CONFIG, type SpinTier, type PrizeOption } from "@shared/schema";

export interface SpinResult {
  outcome: "WIN" | "LOSE";
  prize: PrizeOption | null;
}

export function determineSpinResult(tier: SpinTier = "bronze"): SpinResult {
  const tierConfig = TIER_CONFIG[tier];
  const roll = Math.random();
  
  // Check each prize in order (highest value last, so we check from common to rare)
  let cumulativeProbability = 0;
  for (const prize of tierConfig.prizes) {
    cumulativeProbability += prize.probability;
    if (roll < cumulativeProbability) {
      return { outcome: "WIN", prize };
    }
  }
  
  return { outcome: "LOSE", prize: null };
}

export function getCacheStatus(): {
  loaded: boolean;
  rowCount: number;
  lastFetchTime: Date | null;
  cacheTtlMs: number;
  cacheAge: number;
  isExpired: boolean;
} {
  const now = Date.now();
  const cacheAge = cacheTimestamp ? now - cacheTimestamp : 0;
  return {
    loaded: wagerDataCache !== null,
    rowCount: wagerDataCache?.size || 0,
    lastFetchTime: cacheTimestamp ? new Date(cacheTimestamp) : null,
    cacheTtlMs: CACHE_TTL_MS,
    cacheAge,
    isExpired: !cacheTimestamp || cacheAge > CACHE_TTL_MS,
  };
}

export async function refreshCache(): Promise<{ success: boolean; rowCount: number }> {
  try {
    wagerDataCache = await loadWagerDataCache();
    cacheTimestamp = Date.now();
    return { success: true, rowCount: wagerDataCache.size };
  } catch (err) {
    console.error("Failed to refresh cache:", err);
    throw err;
  }
}

export function getAllWagerData(): WagerRow[] {
  if (!wagerDataCache) return [];
  return Array.from(wagerDataCache.values());
}

export function computeDataHash(data: WagerRow[]): string {
  const content = JSON.stringify(data.sort((a, b) => a.stakeId.localeCompare(b.stakeId)));
  return crypto.createHash("sha256").update(content).digest("hex");
}
