# Lighter Weekly

An independent dashboard for reviewing Robinhood Lighter trading activity by campaign week. It resolves linked accounts from a wallet address, calculates eligible volume from public explorer logs, stores cumulative point snapshots locally, and creates customizable share cards.

## Features

- Wallet-based lookup with linked sub-account discovery
- Current, historical and total campaign volume
- Manual cumulative point snapshots with automatic weekly differences
- Local JSON backup and restore for saved points
- Bearish, neutral and bullish hypothetical LIT value scenarios
- Downloadable 16:9 share cards
- Weekly strategy and referral links from Smart Drop Farmer

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

Copy `.env.example` to `.env.local` and set:

```text
NEXT_PUBLIC_SITE_URL=https://your-production-domain.example
```

The active dashboard uses public Robinhood Lighter endpoints and does not require a private trading token.

## Data model and limitations

- Program activity begins on 10 August 2026 at 00:00 UTC.
- Dashboard weeks use Friday 18:00 UTC boundaries.
- Closed-week explorer responses are cached; the current period remains short-lived.
- A response marked `dataCompleteness: "partial"` reached the explorer history safety limit and must not be treated as a complete total.
- Points are entered manually and stored only in the current browser under a wallet-specific key.
- Price scenarios are hypothetical and are not financial advice or guaranteed allocations.

Point value is estimated as:

```text
(community pool in LIT / projected total program points) × estimated LIT price
```

Projected total program points are calculated from the selected campaign end month and weekly point issuance assumption.

## Quality checks

```bash
npm run lint
npm run build
npm audit --omit=dev
```

## Deployment

The app can be imported into Vercel from a GitHub repository. Set `NEXT_PUBLIC_SITE_URL` to the final HTTPS domain before the production build. Review third-party logo and illustration permissions before public or commercial distribution.

## Independence

This is an independent analytics tool. It is not an official Robinhood or Lighter product. Robinhood and Lighter names and marks belong to their respective owners.
