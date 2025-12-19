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
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
