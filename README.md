# Nostr Analytics

Internal payment analytics dashboard for Linky payment telemetry.

## Run

```bash
bun install
bun run dev
```

## Checks

```bash
bun run check-code
```

## Notes

- Login uses the collector account SLIP-39 seed.
- Identity derivation reuses the vendored `@linky/core/identity` workspace package.
- Telemetry is read from Nostr gift wraps and visualized in a single-page dashboard.
- Reads go to `wss://nostr.linky.fit` plus Linky's public default relays and any relays the collector advertises; each relay is paged so relay caps cannot truncate the window.
- Every fetched report is archived in an Evolu database owned by a key derived from the same seed, synced through `wss://evolu.linky.fit` by default (`VITE_EVOLU_SERVER_URLS` overrides it). Reports stay visible after relays drop the wraps, and logging in on another browser restores the archive.
