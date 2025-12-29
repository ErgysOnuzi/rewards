# LukeRewards Spins

## Overview

LukeRewards Spins is a ticket-based spin/raffle system where users earn tickets based on their wagered amount on Stake.com. The core mechanic is simple: every $1,000 wagered equals 1 ticket, and each spin costs 1 ticket. Users enter their Stake ID, the system looks up their wager data from Google Sheets, calculates available tickets, and allows them to spin for prizes. Results are WIN or LOSE with configurable odds that favor the house.

This is a standalone site separate from lukerewards.com, focused on a single-page gambling-inspired experience with a premium dark aesthetic inspired by Stake.com.

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
- **export_logs**: Audit trail of raffle exports
- **feature_toggles**: Runtime configuration settings
- **payouts**: Track paid-out winnings
- **rate_limit_logs**: Rate limit violations for abuse detection

## Admin Control Panel

### Access
Navigate to `/admin` and enter the ADMIN_PASSWORD to access the control panel.

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

### Required Environment Variables
- `DATABASE_URL` - PostgreSQL connection
- `SESSION_SECRET` - Session encryption key
- `GOOGLE_SHEETS_ID` - The spreadsheet ID for NGR data
- `ADMIN_PASSWORD` - Password for admin panel access

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
