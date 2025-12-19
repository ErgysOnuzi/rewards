export const config = {
  googleSheetsId: process.env.GOOGLE_SHEETS_ID || "",
  wagerSheetName: process.env.WAGER_SHEET_NAME || "Affiliate NGR Summary",
  spinLogSheetName: process.env.SPIN_LOG_SHEET_NAME || "SPIN_LOG",
  winProbability: parseFloat(process.env.WIN_PROBABILITY || "0.01"),
  prizeLabel: process.env.PRIZE_LABEL || "$5 Stake Tip",
  prizeValue: parseInt(process.env.PRIZE_VALUE || "5", 10),
  rateLimitPerIpPerHour: parseInt(process.env.RATE_LIMIT_PER_IP_PER_HOUR || "30", 10),
  siteName: process.env.SITE_NAME || "LukeRewards Spins",
};

export function validateConfig(): string[] {
  const errors: string[] = [];
  
  if (!config.googleSheetsId) {
    errors.push("GOOGLE_SHEETS_ID is required");
  }
  
  return errors;
}
