# E2EE Phase 1A-1 — Platform / Interoperability Spike

**TEST ONLY. NOT PRODUCTION CODE. NOT WIRED INTO THE APPLICATION.**

Nothing in this directory is imported by `src/`, built by `npm run build`, or run by
`npm run test`. It exists to establish real platform facts before Phase 1A-3 writes
production cryptography.

- Every private key here is a fixed throwaway **TEST ONLY** value or generated at runtime
  inside a test process. None protects anything.
- No file here reads production data, Supabase, or user content.
- The `glk2.ts` codec is an **experimental** implementation of the V2.1 envelope written to
  produce cross-platform evidence. It is deliberately not production-shaped and must be
  rewritten from the specification in Phase 1A-3.

## Run

```bash
npx vitest run --config spike/e2ee-1a1/vitest.spike.config.ts
```

## Layout

| Path | Purpose |
|---|---|
| `src/bytes.ts` | hex/base64/concat + `DataView` BigInt u64 helpers |
| `src/ecdsaFormat.ts` | strict DER ↔ P-1363 codec (Part B) |
| `src/glk2.ts` | experimental GLK2 envelope codec (Part G) |
| `tests/` | executable Parts A, B, F, G, H |
| `tools/` | vector generation, Postgres probe, media baseline |
| `vectors/` | frozen shared test vectors for iOS/Android to consume later |
| `web/` | browser harness for Part E (key persistence) |

Report: `docs/E2EE_1A1_SPIKE_REPORT.md`
