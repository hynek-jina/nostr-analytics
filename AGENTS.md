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
- SLIP-39 login reuses the vendored `@linky/core/identity` workspace package, matching Linky's derivation paths and identity logic

## Architecture

- No router; the dashboard is a single page with local React state
- Login accepts a SLIP-39 seed, derives the same Nostr account as Linky, and uses that keypair to read the account inbox from Nostr relays
- Relay discovery always queries the default relays (`wss://nostr.linky.fit` first, then Linky's public defaults) plus whatever the signed-in account advertises as inbox relays (`kind: 10050`) or read relays (`kind: 10002`). Linky clients write to their own write relays and the public relays no longer retain this account's gift wraps, so the Linky relay must stay in the default list
- Telemetry ingestion pages each relay backwards with `until` (500 per page) over a 45-day window, verifies wrap signatures, unwraps gift wraps (`kind: 1059`) locally, keeps only inner `kind: 24134` payment telemetry events, validates payloads with runtime guards, normalizes `appHost`, and ignores malformed data
- Every fetched report is upserted into an Evolu archive (`src/lib/telemetryStore.ts`, table `paymentTelemetryEvent`, row id derived from the report id) so reports survive relay retention limits. The archive owner is a BIP-85 owner derived from the SLIP-39 master secret at `m/83696968'/39'/0'/24'/100'/0'` (role `analytics` in the vendored identity package; Linky itself uses indexes 1'–7'). Default sync server is `wss://evolu.linky.fit`, overridable with a comma-separated `VITE_EVOLU_SERVER_URLS`
- The dashboard renders the union of archived rows and the latest fetch (newer `createdAtSec` wins per report id); the localStorage session snapshot still caches the last fetch for instant hydration
- Aggregation for charting and summaries is done with pure helper functions in memory
- `@evolu/sqlite-wasm` carries the same OPFS locking patch as Linky (`patches/`), applied by Bun via `patchedDependencies`

## Maintaining This File

Keep this file current when commands, structure, or dashboard ingestion behavior changes.
