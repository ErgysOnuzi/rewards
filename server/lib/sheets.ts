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
let backgroundRefreshInterval: NodeJS.Timeout | null = null;

// Weighted wager caches (for .us and .com domains)
let weightedDataCacheUs: Map<string, number> | null = null;
let weightedDataCacheCom: Map<string, number> | null = null;
let weightedCacheTimestamp: number = 0;

// Start automatic background refresh every 5 minutes
export function startBackgroundRefresh() {
  if (backgroundRefreshInterval) {
    clearInterval(backgroundRefreshInterval);
  }
  
  // Initial load - NGR sheet
  loadWagerDataCache().then(cache => {
    wagerDataCache = cache;
    cacheTimestamp = Date.now();
    console.log(`[Sheets] Initial load: ${cache.size} users from wager sheet`);
  }).catch(err => {
    console.error("[Sheets] Failed initial load:", err);
  });
  
  // Initial load - Weighted sheets
  loadAllWeightedData().catch(err => {
    console.error("[Sheets] Failed to load weighted data:", err);
  });
  
  // Schedule refresh every 5 minutes
  backgroundRefreshInterval = setInterval(async () => {
    try {
      const newCache = await loadWagerDataCache();
      wagerDataCache = newCache;
      cacheTimestamp = Date.now();
      console.log(`[Sheets] Background refresh: ${newCache.size} users loaded at ${new Date().toISOString()}`);
      
      // Also refresh weighted data
      await loadAllWeightedData();
    } catch (err) {
      console.error("[Sheets] Background refresh failed:", err);
    }
  }, CACHE_TTL_MS);
  
  console.log(`[Sheets] Background refresh started (every ${CACHE_TTL_MS / 1000 / 60} minutes)`);
}

export function stopBackgroundRefresh() {
  if (backgroundRefreshInterval) {
    clearInterval(backgroundRefreshInterval);
    backgroundRefreshInterval = null;
    console.log("[Sheets] Background refresh stopped");
  }
}

// Load weighted wager data from a specific sheet
async function loadWeightedDataFromSheet(sheetId: string): Promise<Map<string, number>> {
  const sheets = await getSheetsClient();
  const cache = new Map<string, number>();
  
  console.log(`[Weighted] Loading sheet: ${sheetId.substring(0, 10)}... tab: ${config.weightedSheetName}`);
  
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: config.weightedSheetName,
    });

    const rows = response.data.values;
    console.log(`[Weighted] Got ${rows?.length || 0} rows from ${sheetId.substring(0, 10)}...`);
    if (!rows || rows.length <= 1) return cache;

    // Find header row - check first few rows for "User_Name" or similar column
    let headerRowIdx = 0;
    let headers: string[] = [];
    
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const potentialHeaders = rows[i].map((h: any) => String(h || "").trim().toLowerCase());
      if (potentialHeaders.some((h: string) => h === "user_name" || h === "username" || h === "stake_id" || h === "stakeid")) {
        headerRowIdx = i;
        headers = rows[i].map((h: any) => String(h || "").trim());
        break;
      }
    }
    
    if (headers.length === 0) {
      // Fallback: assume first row is headers
      headerRowIdx = 0;
      headers = rows[0].map((h: any) => String(h || "").trim());
    }
    
    console.log(`[Weighted] Sheet ${sheetId.substring(0, 10)}... headers found: ${headers.join(', ')}`);

    // Find column indices
    const userNameIdx = headers.findIndex(h => 
      h.toLowerCase() === "user_name" || 
      h.toLowerCase() === "username" || 
      h.toLowerCase() === "stake_id" ||
      h.toLowerCase() === "stakeid"
    );
    
    const wageredIdx = headers.findIndex(h => 
      h.toLowerCase() === "wagered" || 
      h.toLowerCase() === "weighted wager" || 
      h.toLowerCase() === "weighted_wager" ||
      h.toLowerCase() === "weightedwager"
    );
    
    if (userNameIdx < 0 || wageredIdx < 0) {
      console.warn(`[Weighted] Could not find required columns in sheet ${sheetId}. Headers: ${headers.join(', ')}`);
      return cache;
    }

    // Parse data rows
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      const stakeId = (row[userNameIdx] || "").toString().trim().toLowerCase();
      if (!stakeId) continue;
      
      const weightedWager = parseFloat(String(row[wageredIdx] || "0").replace(/[$,]/g, "")) || 0;
      
      // Sum if duplicate
      const existing = cache.get(stakeId) || 0;
      cache.set(stakeId, existing + Math.max(0, weightedWager));
    }
    
    console.log(`[Weighted] Loaded ${cache.size} users from sheet ${sheetId.substring(0, 10)}...`);
    return cache;
  } catch (err) {
    console.error(`[Weighted] Failed to load sheet ${sheetId}:`, err);
    return cache;
  }
}

// Load all weighted data (both .us and .com sheets)
async function loadAllWeightedData(): Promise<void> {
  const [usCache, comCache] = await Promise.all([
    loadWeightedDataFromSheet(config.weightedSheetsUs),
    loadWeightedDataFromSheet(config.weightedSheetsCom),
  ]);
  
  weightedDataCacheUs = usCache;
  weightedDataCacheCom = comCache;
  weightedCacheTimestamp = Date.now();
  
  console.log(`[Weighted] Total loaded: US=${usCache.size}, COM=${comCache.size}`);
}

// Get weighted wager for a user - checks BOTH sheets and returns the one with data
// If user has data in both, returns the higher value
export function getWeightedWager(stakeId: string, _domain?: "us" | "com"): number {
  const normalizedId = stakeId.toLowerCase().trim();
  const usWager = weightedDataCacheUs?.get(normalizedId) || 0;
  const comWager = weightedDataCacheCom?.get(normalizedId) || 0;
  
  // Return whichever has data (or the higher value if both have data)
  return Math.max(usWager, comWager);
}

// Get weighted wager with domain info - for cases where we need to know which sheet matched
export function getWeightedWagerWithDomain(stakeId: string): { wager: number; domain: "us" | "com" | null } {
  const normalizedId = stakeId.toLowerCase().trim();
  const usWager = weightedDataCacheUs?.get(normalizedId) || 0;
  const comWager = weightedDataCacheCom?.get(normalizedId) || 0;
  
  if (usWager > 0 && comWager > 0) {
    // User in both sheets - return higher value with that domain
    return usWager >= comWager 
      ? { wager: usWager, domain: "us" }
      : { wager: comWager, domain: "com" };
  } else if (usWager > 0) {
    return { wager: usWager, domain: "us" };
  } else if (comWager > 0) {
    return { wager: comWager, domain: "com" };
  }
  
  return { wager: 0, domain: null };
}

// Get weighted wager status for admin
export function getWeightedCacheStatus(): {
  usLoaded: boolean;
  usRowCount: number;
  comLoaded: boolean;
  comRowCount: number;
  lastRefresh: Date | null;
} {
  return {
    usLoaded: weightedDataCacheUs !== null,
    usRowCount: weightedDataCacheUs?.size || 0,
    comLoaded: weightedDataCacheCom !== null,
    comRowCount: weightedDataCacheCom?.size || 0,
    lastRefresh: weightedCacheTimestamp ? new Date(weightedCacheTimestamp) : null,
  };
}

// Get all weighted users for admin panel
export function getAllWeightedUsers(domain: "us" | "com"): Array<{ stakeId: string; wagered: number }> {
  const cache = domain === "us" ? weightedDataCacheUs : weightedDataCacheCom;
  if (!cache) return [];
  return Array.from(cache.entries()).map(([stakeId, wagered]) => ({
    stakeId,
    wagered,
  })).sort((a, b) => b.wagered - a.wagered);
}

// Check if a username exists in the weighted sheets (checks BOTH sheets)
export function usernameExistsInSpreadsheet(username: string, _domain?: "us" | "com"): boolean {
  const normalizedUsername = username.toLowerCase().trim();
  const inUs = weightedDataCacheUs?.has(normalizedUsername) || false;
  const inCom = weightedDataCacheCom?.has(normalizedUsername) || false;
  return inUs || inCom;
}

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

export function getCacheStatus(): {
  loaded: boolean;
  rowCount: number;
  lastFetchTime: Date | null;
  cacheTtlMs: number;
  cacheAge: number;
  isExpired: boolean;
  backgroundRefreshActive: boolean;
  nextRefreshIn: number;
} {
  const now = Date.now();
  const cacheAge = cacheTimestamp ? now - cacheTimestamp : 0;
  const nextRefreshIn = Math.max(0, CACHE_TTL_MS - cacheAge);
  return {
    loaded: wagerDataCache !== null,
    rowCount: wagerDataCache?.size || 0,
    lastFetchTime: cacheTimestamp ? new Date(cacheTimestamp) : null,
    cacheTtlMs: CACHE_TTL_MS,
    cacheAge,
    isExpired: !cacheTimestamp || cacheAge > CACHE_TTL_MS,
    backgroundRefreshActive: backgroundRefreshInterval !== null,
    nextRefreshIn,
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
