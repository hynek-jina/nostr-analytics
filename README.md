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
