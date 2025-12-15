# Peer Country Flags Feature - Implementation Plan

## Summary

Add flag emojis (🇺🇸 🇩🇪 🇯🇵) to PeerTable showing each connected peer's country.

## Decisions

- **Display:** Flag emojis in new "Country" column (PeerTable only)
- **Database:** DB-IP Lite IPv4-only (~1MB, public domain)
- **Caching:** Store `countryCode` on `SwarmPeer` (one lookup per peer)
- **Generated code:** Checked into repo (no build-time network dependency)

## Build Process

```bash
# One-time or when updating database:
curl -o /tmp/dbip.csv.gz https://download.db-ip.com/free/dbip-country-lite-2025-12.csv.gz
pnpm run build:geoip /tmp/dbip.csv.gz

# Normal development - nothing extra needed
```

**Generated file format:**
```typescript
// ipv4-country-data.ts - ~1MB checked into repo
export const countries = ['AD','AE','AF',...] as const  // ~250 entries
export const ipv4Ranges = new Uint32Array([...])        // start IP + country index pairs
```

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/engine/src/geo/geoip.ts` | Create - `lookupCountry(ip): string \| null` |
| `packages/engine/src/geo/ipv4-country-data.ts` | Create - generated database |
| `scripts/build-geoip.ts` | Create - CSV → TS converter |
| `packages/engine/src/core/swarm.ts` | Add `countryCode: string \| null` to SwarmPeer |
| `packages/ui/src/tables/PeerTable.tsx` | Add Country column |
| `packages/ui/src/utils/country-flag.ts` | Create - `countryCodeToFlag("US") → 🇺🇸` |

## Notes

- IPv6 support deferred (no IPv6 peers seen in practice, would add ~10MB)
- DB-IP Lite is public domain, updated monthly
- Country lookup happens once when peer is discovered, cached forever
