# LukeRewards Spins - Design Guidelines

## Design Approach
**Reference-Based Approach**: Drawing inspiration from Stake.com's premium gambling aesthetic combined with modern dashboard clarity. The design emphasizes trust, excitement, and transparency while maintaining a sophisticated, uncluttered interface.

## Core Design Principles
1. **Premium Dark Aesthetic**: Convey exclusivity and focus through a dark, clean interface
2. **Stake Brand Alignment**: Green accent colors for CTAs and success states
3. **Transparency & Trust**: Clear display of all ticket calculations and odds
4. **Minimal Distraction**: Single-page layout with focused user journey
5. **Anticipation & Reveal**: Build excitement through deliberate animation timing

## Typography System

**Font Stack**: 
- Primary: 'Inter' or 'DM Sans' via Google Fonts (clean, modern, excellent readability)
- Monospace: 'JetBrains Mono' for numerical displays (tickets, amounts)

**Type Scale**:
- Hero Title: text-5xl md:text-6xl font-bold
- Section Headings: text-2xl md:text-3xl font-semibold
- Card Titles: text-xl font-semibold
- Body Text: text-base
- Labels/Meta: text-sm
- Small Print: text-xs

## Layout System

**Spacing Primitives**: Use Tailwind units of 4, 6, 8, 12, 16, 24
- Consistent padding: p-6, p-8, p-12
- Section spacing: space-y-8, space-y-12
- Component gaps: gap-4, gap-6

**Container Structure**:
- Max-width container: max-w-4xl mx-auto
- Card components: rounded-xl with consistent padding
- Single-column focused layout (no multi-column complexity)

## Component Library

### Hero Section
- Centered layout with clear hierarchy
- Title: "LukeRewards Spins" (large, bold)
- Subtitle: Explain ticket mechanics clearly
- Disclaimer: "Odds favor the house" in subtle text
- Vertical spacing: py-16 md:py-24

### Stake ID Input Card
- Prominent card with elevated appearance
- Input field with clear label "Enter Your Stake ID"
- "Check Tickets" button (green accent, full-width on mobile)
- Form validation feedback inline

### Ticket Status Panel
- Reveals after successful lookup
- Grid layout displaying:
  - Wagered Amount (large monospace numbers)
  - Total Tickets (visual emphasis)
  - Used Tickets
  - Remaining Tickets (highlighted if > 0)
  - Period Label (subtle)
- Clear visual hierarchy separating metrics

### Spin Panel
- Central focus when tickets available
- "Spin 1 Ticket" button (large, green, disabled state when no tickets)
- Wheel/spinner animation area (2-3 second duration)
- Result display area:
  - LOSE: Neutral message, encourage next spin
  - WIN: Celebratory styling, display prize label prominently

### Spin Result States
- **Loading**: Spinner/wheel animation centered, anticipation-building
- **Lose**: Clean message, no dramatic effects, maintain dignity
- **Win**: Bold celebration, clear prize label display, green accent highlights

### Footer
- Simple, unobtrusive
- Disclaimer text about data updates (every 12-24 hours)
- Prize payout note
- Minimal padding: py-8

## Visual Treatment Notes

**Card Aesthetics**:
- Subtle borders or elevated shadows (not both)
- Consistent corner radius: rounded-xl
- Inner padding: p-6 or p-8

**Button Hierarchy**:
- Primary Action (Spin, Check): Green accent, solid fill
- Disabled State: Reduced opacity, clear visual feedback
- Hover states: Subtle brightness increase

**Status Indicators**:
- Tickets Available: Green accent
- No Tickets: Muted gray
- Active Spin: Animated state

**Animations** (minimal, purposeful):
- Spin wheel: 2-3 second rotation/animation
- Result reveal: Simple fade-in or scale effect
- Ticket counter updates: Smooth number transitions
- No background animations or distracting effects

## Accessibility
- Clear focus states on all interactive elements
- Adequate contrast ratios for dark theme
- Screen reader labels for spin status
- Disabled button states clearly communicated

## Layout Flow (Single Page)
1. **Hero** (centered, py-16 md:py-24)
2. **Stake ID Input Card** (max-w-md mx-auto, prominent)
3. **Ticket Status Panel** (appears after lookup, max-w-2xl mx-auto)
4. **Spin Panel** (central focus, max-w-md mx-auto)
5. **Footer** (full-width, minimal, py-8)

Vertical spacing between sections: space-y-12 or space-y-16

## Images
**No hero background image needed** - keep the dark, clean aesthetic without visual clutter. The focus is on functionality and clear information hierarchy.

If desired, small decorative elements (chip icons, ticket icons) can be added as inline SVG icons from Heroicons, but should remain minimal and purposeful.