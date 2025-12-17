# LukeRewards Spins

## Overview

LukeRewards Spins is a ticket-based spin/raffle system where users earn tickets based on their wagered amount on Stake.com. The core mechanic is simple: every $1,000 wagered equals 1 ticket, and each spin costs 1 ticket. Users enter their Stake ID, the system looks up their wager data from Google Sheets, calculates available tickets, and allows them to spin for prizes. Results are WIN or LOSE with configurable odds that favor the house.

This is a standalone site separate from lukerewards.com, focused on a single-page gambling-inspired experience with a premium dark aesthetic inspired by Stake.com.

## User Preferences

Preferred communication style: Simple, everyday language.

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
- **API Pattern**: REST API with POST endpoints at `/api/lookup` and `/api/spin`
- **Validation**: Zod schemas shared between client and server in `shared/schema.ts`
- **Security Features**:
  - IP-based rate limiting (configurable, default 30 requests/hour)
  - IP hashing for privacy in logs
  - Request ID tracking for spin audit trail

### Data Flow
1. User enters Stake ID → POST `/api/lookup` → Returns ticket balance
2. User clicks spin → POST `/api/spin` → Determines result, logs to sheet, returns outcome
3. Ticket calculation: `floor(wagered_amount / 1000)`
4. Tickets used calculated from spin log count, not stored separately

### Code Organization
```
client/src/           # React frontend
  components/         # UI components (HeroSection, SpinWheel, etc.)
  components/ui/      # shadcn/ui base components
  pages/              # Page components (Home, not-found)
  hooks/              # Custom React hooks
  lib/                # Utilities (queryClient, utils)
server/               # Express backend
  lib/                # Server utilities (sheets, config, rateLimit, hash)
  routes.ts           # API route handlers
  storage.ts          # In-memory storage (users - currently unused)
shared/               # Shared code between client/server
  schema.ts           # Zod schemas and TypeScript types
```

## External Dependencies

### Google Sheets Integration
- **Purpose**: Primary data store for wager data and spin logs
- **Library**: `googleapis` package with Sheets API v4
- **Authentication**: Service account credentials via environment variables
- **Sheet Structure**:
  - Tab `WAGER_DATA`: Read-only source of stake_id, wagered_amount, period_label
  - Tab `SPIN_LOG`: Append-only log of all spins with full audit trail

### Required Environment Variables
- `DATABASE_URL` - PostgreSQL connection (for Drizzle, though sheets are primary store)
- `GOOGLE_SHEETS_ID` - The spreadsheet ID to read/write
- `GOOGLE_SERVICE_ACCOUNT_EMAIL` - Service account email for auth
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` - Private key (newlines as `\n`)
- `WAGER_SHEET_NAME` - Tab name for wager data (default: "WAGER_DATA")
- `SPIN_LOG_SHEET_NAME` - Tab name for spin logs (default: "SPIN_LOG")
- `WIN_PROBABILITY` - Decimal win chance (default: 0.01 = 1%)
- `PRIZE_LABEL` - Prize description shown on win (default: "$5 Stake Tip")
- `RATE_LIMIT_PER_IP_PER_HOUR` - Request limit per IP (default: 30)

### Database
- **ORM**: Drizzle ORM configured for PostgreSQL
- **Current Usage**: Schema exists but Google Sheets is the primary data source
- **Schema Location**: `shared/schema.ts` contains both Zod schemas and type definitions