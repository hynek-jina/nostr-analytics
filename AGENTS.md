# Nostr Analytics

Internal payment analytics dashboard for Linky payment telemetry.

## Commands

```bash
bun install         # Install dependencies
bun run dev         # Start the analytics dashboard in dev mode
bun run build       # Production build
bun run preview     # Preview production build
bun run check-code  # Run typecheck, eslint, and prettier across the workspace
```

IMPORTANT: Run `bun run check-code` after changes. Fix any remaining issues and re-run until it passes.

## Structure

- `apps/analytics-dashboard/` - React + Vite single-page dashboard for reading Linky payment telemetry from a Nostr collector inbox
- Package manager is **Bun**
- SLIP-39 login reuses `@linky/core/identity` from the local Linky checkout via a file dependency, so dashboard derivation matches Linky exactly

## Architecture

- No router; the dashboard is a single page with local React state
- Login accepts a SLIP-39 seed, derives the same Nostr account as Linky, and uses that keypair to read the account inbox from Nostr relays
- Relay discovery first checks the signed-in account relay list (`kind: 10002`) and falls back to Linky's default relays
- Telemetry ingestion reads gift wraps (`kind: 1059`), unwraps them locally, keeps only inner `kind: 24134` payment telemetry events, validates payloads with runtime guards, and ignores malformed data
- Aggregation for charting and summaries is done with pure helper functions in memory

## Maintaining This File

Keep this file current when commands, structure, or dashboard ingestion behavior changes.
