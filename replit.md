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
- **demo_users**: Demo user accounts with stake_id, wagered_amount, period_label
- **spin_logs**: Audit trail of all free ticket spins
- **guaranteed_wins**: Demo mode: guaranteed wins at specific spin numbers
- **user_wallets**: User wallet balances (winnings)
- **user_spin_balances**: Per-tier spin balances for each user
- **withdrawal_requests**: Pending/processed withdrawal requests
- **wallet_transactions**: Audit trail of all wallet transactions

## External Dependencies

### Google Sheets Integration (Optional)
- **Purpose**: Primary data store for wager data and spin logs (production mode)
- **Library**: `googleapis` package with Sheets API v4
- **Authentication**: Service account credentials via environment variables
- **Demo Mode**: Works without Google Sheets using PostgreSQL database

### Required Environment Variables
- `DATABASE_URL` - PostgreSQL connection (required for all modes)
- `SESSION_SECRET` - Session encryption key

### Optional Environment Variables (Google Sheets Mode)
- `GOOGLE_SHEETS_ID` - The spreadsheet ID to read/write
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Service account email for auth
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` - Private key (newlines as `\n`)
- `WAGER_SHEET_NAME` - Tab name for wager data (default: "WAGER_DATA")
- `SPIN_LOG_SHEET_NAME` - Tab name for spin logs (default: "SPIN_LOG")

### Configurable Options
- `WIN_PROBABILITY` - Decimal win chance (default: 0.01 = 1%)
- `PRIZE_VALUE` - Base prize value in dollars (default: 5)
- `RATE_LIMIT_PER_IP_PER_HOUR` - Request limit per IP (default: 30)

### Demo Users
In demo mode (no Google Sheets), the following users are seeded:
- **ergys**: $10,000 wagered, wins on 2nd spin
- **luke**: $20,000 wagered, wins on 13th spin
- **demo**: $5,000 wagered, random wins based on probability
