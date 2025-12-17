export const config = {
  googleSheetsId: process.env.GOOGLE_SHEETS_ID || "",
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "",
  googleServiceAccountPrivateKey: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  wagerSheetName: process.env.WAGER_SHEET_NAME || "WAGER_DATA",
  spinLogSheetName: process.env.SPIN_LOG_SHEET_NAME || "SPIN_LOG",
  winProbability: parseFloat(process.env.WIN_PROBABILITY || "0.01"),
  prizeLabel: process.env.PRIZE_LABEL || "$5 Stake Tip",
  rateLimitPerIpPerHour: parseInt(process.env.RATE_LIMIT_PER_IP_PER_HOUR || "30", 10),
  siteName: process.env.SITE_NAME || "LukeRewards Spins",
};

export function validateConfig(): string[] {
  const errors: string[] = [];
  
  if (!config.googleSheetsId) {
    errors.push("GOOGLE_SHEETS_ID is required");
  }
  if (!config.googleServiceAccountEmail) {
    errors.push("GOOGLE_SERVICE_ACCOUNT_EMAIL is required");
  }
  if (!config.googleServiceAccountPrivateKey) {
    errors.push("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is required");
  }
  
  return errors;
}
