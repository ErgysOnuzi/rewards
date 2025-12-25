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

// Critical secrets that must be present at startup
const REQUIRED_SECRETS = [
  { key: "DATABASE_URL", description: "PostgreSQL database connection" },
  { key: "SESSION_SECRET", description: "Session encryption key" },
  { key: "ADMIN_PASSWORD", description: "Admin panel password" },
];

// Optional but recommended secrets
const RECOMMENDED_SECRETS = [
  { key: "GOOGLE_SERVICE_ACCOUNT_EMAIL", description: "Google Sheets API auth" },
  { key: "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", description: "Google Sheets API auth" },
];

export function validateConfig(): string[] {
  const errors: string[] = [];
  
  if (!config.googleSheetsId) {
    errors.push("GOOGLE_SHEETS_ID is required");
  }
  
  return errors;
}

// Validate all required secrets are present - fail hard if missing
export function validateSecrets(): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check required secrets
  for (const secret of REQUIRED_SECRETS) {
    if (!process.env[secret.key]) {
      errors.push(`Missing required secret: ${secret.key} (${secret.description})`);
    }
  }
  
  // Check recommended secrets
  for (const secret of RECOMMENDED_SECRETS) {
    if (!process.env[secret.key]) {
      warnings.push(`Missing recommended secret: ${secret.key} (${secret.description})`);
    }
  }
  
  // Validate SESSION_SECRET strength (must be at least 32 chars)
  const sessionSecret = process.env.SESSION_SECRET || "";
  if (sessionSecret && sessionSecret.length < 32) {
    errors.push("SESSION_SECRET must be at least 32 characters for security");
  }
  
  // Validate ADMIN_PASSWORD strength (must be at least 12 chars)
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  if (adminPassword && adminPassword.length < 12) {
    warnings.push("ADMIN_PASSWORD should be at least 12 characters for security");
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// Run validation at startup and fail hard if critical secrets missing
export function enforceSecurityRequirements(): void {
  const result = validateSecrets();
  
  // Log warnings
  for (const warning of result.warnings) {
    console.warn(`[SECURITY WARNING] ${warning}`);
  }
  
  // Fail hard on errors in production
  if (!result.valid) {
    for (const error of result.errors) {
      console.error(`[SECURITY ERROR] ${error}`);
    }
    
    if (process.env.NODE_ENV === "production") {
      console.error("[FATAL] Application cannot start due to missing security requirements");
      process.exit(1);
    } else {
      console.warn("[DEV MODE] Continuing despite missing secrets - DO NOT USE IN PRODUCTION");
    }
  }
  
  console.log("[SECURITY] All required secrets validated");
}
