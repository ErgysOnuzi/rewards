# LukeRewards Spins

## Overview

LukeRewards Spins is a ticket-based spin/raffle system where users earn tickets based on their wagered amount on Stake.com. The core mechanic is simple: every $1,000 wagered equals 1 ticket, and each spin costs 1 ticket. Users register with username/password, verify their Stake account by uploading bet screenshots for admin review, and can then spin for prizes. Results are WIN or LOSE with configurable odds that favor the house.

This is a standalone site separate from lukerewards.com, focused on a single-page gambling-inspired experience with a premium dark aesthetic inspired by Stake.com.

## Authentication & Verification System

### Custom User Authentication
- **Registration**: Users create accounts with username/password (bcrypt 12 salt rounds)
- **Login**: Session-based authentication stored in PostgreSQL sessions table
- **Routes**: /login, /register, /verify pages with form validation

### Screenshot-Based Verification
Instead of automatic bet ID lookup, users upload screenshots showing their Stake username:
1. User registers account → Status: "Unverified"
2. User uploads screenshot on /verify page → Status: "Pending"
3. Admin reviews screenshot in admin panel → Status: "Verified" or "Rejected"

### Admin Verification Panel (3 Queues)
- **Unverified**: Users who registered but never submitted verification
- **Pending**: Users with screenshots awaiting admin review (with preview)
- **Verified**: Users approved by admin

### File Upload
- Screenshots stored in `uploads/verification/` directory
- Served via `/uploads` static route
- Max file size: 10MB
- Allowed types: JPEG, PNG, GIF, WebP

## User Preferences

Preferred communication style: Simple, everyday language.

## Tiered Spin System

### Spin Tiers (Balanced for House Edge)
Math: $100k wagered = 100 bronze = 50 silver = 10 gold
Expected payout is equal across all tiers (house never loses on tier upgrades)

- **Bronze**: $5 prize, 1% win rate, costs $5 to purchase
- **Silver**: $25 prize, 0.4% win rate, costs $25 to purchase  
- **Gold**: $100 prize, 0.5% win rate, costs $100 to purchase

### Tier Conversion Rates
- 2 Bronze spins = 1 Silver spin
- 5 Silver spins = 1 Gold spin

### Spin Sources
1. **Free Tickets**: Earned from wagering ($1,000 wagered = 1 free bronze spin)
2. **Purchased Spins**: Can be bought with wallet balance (from winnings)
3. **Converted Spins**: Trade up lower tier spins for higher tier spins

### Wallet System
- Users accumulate winnings in a wallet balance
- Wallet can be used to purchase additional spins
- Users can request withdrawals to their Stake account
- Withdrawals require admin approval before processing

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript, using Vite as the build tool
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state, local React state for UI
- **UI Components**: shadcn/ui component library with Radix UI primitives
- **Styling**: Tailwind CSS with custom CSS variables for theming (dark mode by default)
- **Design System**: Premium dark aesthetic with green accent colors, following Stake.com inspiration per design_guidelines.md

### Backend Architecture
- **Runtime**: Node.js with Express
- **API Pattern**: REST API with endpoints:
  - `/api/lookup` - Get user ticket/wallet/spin balance info
  - `/api/spin` - Execute a spin (supports tier parameter)
  - `/api/spins/convert` - Convert spins between tiers
  - `/api/spins/purchase` - Buy spins with wallet balance
  - `/api/wallet/withdraw` - Request withdrawal to Stake account
  - `/api/admin/logs` - Admin: View spin logs
  - `/api/admin/withdrawals` - Admin: View/process withdrawals
- **Validation**: Zod schemas shared between client and server in `shared/schema.ts`
- **Security Features**:
  - IP-based rate limiting (configurable, default 30 requests/hour)
  - IP hashing for privacy in logs
  - Request ID tracking for spin audit trail
  - Google Sheet IDs hidden from API responses (only shows "configured" status)
  - `maskUsername()` utility available for masking player names (first 2 + last 2 chars)

### Data Flow
1. User enters Stake ID → POST `/api/lookup` → Returns ticket balance, wallet, spin balances
2. User clicks spin → POST `/api/spin` → Determines result, updates wallet, returns outcome
3. Free ticket calculation: `floor(wagered_amount / 1000)`
4. Purchased/converted spins stored in user_spin_balances table
5. Winnings credited to user_wallets table
6. Withdrawals tracked in withdrawal_requests table

### Code Organization
```
client/src/           # React frontend
  components/         # UI components (HeroSection, SpinWheel, TicketStatus, etc.)
  components/ui/      # shadcn/ui base components
  pages/              # Page components (Home, Admin, not-found)
  hooks/              # Custom React hooks
  lib/                # Utilities (queryClient, utils)
server/               # Express backend
  lib/                # Server utilities (sheets, config, rateLimit, hash)
  routes.ts           # API route handlers
  db.ts               # Database connection
  storage.ts          # In-memory storage (currently unused)
shared/               # Shared code between client/server
  schema.ts           # Zod schemas, Drizzle tables, and TypeScript types
```

## Database Schema

### Tables
- **spin_logs**: Audit trail of all free ticket spins
- **user_wallets**: User wallet balances (winnings)
- **user_spin_balances**: Per-tier spin balances for each user
- **withdrawal_requests**: Pending/processed withdrawal requests
- **wallet_transactions**: Audit trail of all wallet transactions
- **user_flags**: Blacklist/allowlist/disputed user flags
- **admin_sessions**: Admin authentication sessions
- **admin_credentials**: Encrypted admin username and bcrypt password hash
- **export_logs**: Audit trail of raffle exports
- **feature_toggles**: Runtime configuration settings
- **payouts**: Track paid-out winnings
- **rate_limit_logs**: Rate limit violations for abuse detection

## Admin Control Panel

### Access
Navigate to `/admin` and enter admin credentials (username: "Lukerewards", password: your ADMIN_PASSWORD) to access the control panel.

### Admin Authentication Security
- **Initial Setup**: On first login, credentials from ADMIN_PASSWORD env var are stored in database
- **Database Storage**: Username is AES-encrypted, password is bcrypt-hashed (12 rounds)
- **After Setup**: ADMIN_PASSWORD env var is no longer required (credentials stored in admin_credentials table)
- **Rate Limiting**: 5 login attempts per 15 minutes per IP

### Features
1. **Data Status**: Monitor Google Sheets cache status, row counts, duplicates, refresh cache manually
2. **User Lookup**: Search for any Stake ID to view wager data, local stats, wallet, spin balances, flags, and transaction history
3. **User Flags**: Blacklist/allowlist/dispute users with notes - affects raffle eligibility
4. **Abuse Monitor**: View top spinners per hour, detect IP anomalies (same IP using multiple Stake IDs)
5. **Withdrawals**: Approve/reject withdrawal requests from users
6. **Export**: Generate raffle CSVs with campaign/week labels, preview summaries, view export history
7. **Toggles**: Runtime feature toggles for win rates, enable/disable spins globally
8. **Spins Log**: Real-time view of recent spin activity

## External Dependencies

### Google Sheets Integration (Required)
- **Purpose**: Primary data store for wager data and spin logs
- **Library**: `googleapis` package with Sheets API v4
- **Authentication**: Replit OAuth integration for Google Sheets

### Dual Sheet System
- **NGR Sheet**: Used for user lookup and displaying lifetime wagered amount
- **Weighted Sheets (2026)**: Domain-specific sheets for ticket calculation (.us and .com)
  - Tab name: "Top Wager" with columns "User_name" and "Wagered"
  - Tickets are calculated from weighted wagers when available, falling back to NGR data
- **Data Display**: Shows both lifetime wagered (NGR) and 2026 wagered (weighted) when they differ

### Daily Bonus Spin
- Free spin available once every 24 hours for registered users
- 1 in 500 chance (0.2%) to win $5
- Tracked via user_state table (lastBonusSpinAt field)
- **Requirement**: Users must have $1,000+ wagered in current week (from NGR sheet's Wagered_Weekly column) to claim bonus

### Referral System
- **Referral Codes**: Each user gets a unique 8-character alphanumeric code on registration
- **Sharing**: Users can share their referral link (e.g., `/register?ref=ABC12345`)
- **Tracking**: When a referred user registers with a code, a referral record is created with "pending" status
- **Qualification**: When the referred user hits $1,000 weekly wager, the referrer earns $2 bonus
- **Bonus**: $2 (200 cents) credited to referrer's wallet as a wallet transaction
- **Tables**: 
  - `users.referral_code` - Unique code for each user
  - `users.referred_by` - User ID of referrer
  - `referrals` - Tracks referrer/referred relationships and bonus status
- **Endpoint**: GET `/api/referrals` - Returns user's referral stats

### Demo Spin (No Login Required)
- Available to visitors without creating an account
- Shows the full spinning animation and experience
- Same 0.2% win chance as daily bonus
- Encourages visitors to register for real prizes
- Endpoint: POST `/api/spin/demo`

## Admin Activity Logging

All admin panel actions are logged to the `admin_activity_logs` table:
- **Login/logout**: Admin session events
- **User verification**: Approvals and rejections
- **Withdrawal processing**: Approvals and rejections
- **User flags**: Blacklist/allowlist/disputed changes
- **Feature toggles**: Runtime configuration changes
- **Cache refresh**: Manual data refresh
- **Raffle export**: Export generation
- **User deletion**: Account removal
- **Manual backups**: Triggered backup creation

View logs via admin panel or `/api/admin/activity-logs` endpoint.

## Automated Backups

Database backups run automatically every 12 hours:
- **Schedule**: Every 12 hours starting 1 minute after server start
- **Retention**: 7 days (14 backup files maximum)
- **Location**: `./backups/` directory with timestamped filenames
- **Format**: pg_dump SQL format
- **Admin endpoints**:
  - `GET /api/admin/backup-status` - View backup status and history
  - `POST /api/admin/backup/create` - Trigger manual backup

Backup logs stored in `backup_logs` table for audit trail.

### Required Environment Variables
- `DATABASE_URL` - PostgreSQL connection
- `SESSION_SECRET` - Session encryption key (min 32 chars, also used for encryption key derivation)
- `GOOGLE_SHEETS_ID` - The spreadsheet ID for NGR data
- `ADMIN_PASSWORD` - Password for admin panel (only needed for initial setup, then stored encrypted in database)

### Optional Environment Variables
- `WAGER_SHEET_NAME` - Tab name for wager data (default: "Affiliate NGR Summary")
- `SPIN_LOG_SHEET_NAME` - Tab name for spin logs (default: "SPIN_LOG")
- `WEIGHTED_SHEETS_US` - Spreadsheet ID for .us domain weighted wagers
- `WEIGHTED_SHEETS_COM` - Spreadsheet ID for .com domain weighted wagers
- `WEIGHTED_SHEET_NAME` - Tab name for weighted data (default: "Sheet1")

### Configurable Options
- `WIN_PROBABILITY` - Decimal win chance (default: 0.01 = 1%)
- `PRIZE_VALUE` - Base prize value in dollars (default: 5)
- `RATE_LIMIT_PER_IP_PER_HOUR` - Request limit per IP (default: 30)
