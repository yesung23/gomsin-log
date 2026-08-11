/**
 * PART H — 64-bit database transport.
 *
 * The JSON.parse half is asserted here so the finding is a permanent regression
 * test that needs no database. The Postgres half was measured by
 * `tools/pg-bigint-probe.mjs` against a throwaway local cluster and frozen into
 * `vectors/generated/bigint-transport.json`; this file re-checks that recording
 * for internal consistency.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const probePath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'vectors',
  'generated',
  'bigint-transport.json',
);

const BOUNDARIES = [
  ['2^53 - 1', '9007199254740991'],
  ['2^53', '9007199254740992'],
  ['2^53 + 1', '9007199254740993'],
  ['2^63 - 1', '9223372036854775807'],
] as const;

describe('H1 JSON.parse on a bare JSON number', () => {
  it('is exact at or below 2^53 and lossy above it', () => {
    const observed = BOUNDARIES.map(([label, literal]) => {
      const parsed = JSON.parse(`{"v":${literal}}`).v;
      return { label, literal, exact: String(parsed) === literal, parsed: String(parsed) };
    });

    expect(observed.find((o) => o.label === '2^53 - 1')?.exact).toBe(true);
    expect(observed.find((o) => o.label === '2^53')?.exact).toBe(true);

    // The two cases that matter. Note there is no error and no warning: the
    // value is silently rewritten, which is why the architecture forbids
    // Number for epoch, content_revision and membership_revision.
    const plusOne = observed.find((o) => o.label === '2^53 + 1');
    expect(plusOne?.exact).toBe(false);
    expect(plusOne?.parsed).toBe('9007199254740992');

    const max = observed.find((o) => o.label === '2^63 - 1');
    expect(max?.exact).toBe(false);
    expect(max?.parsed).toBe('9223372036854776000');
  });

  it('is exact for every boundary when the column is cast to text', () => {
    for (const [label, literal] of BOUNDARIES) {
      const parsed = JSON.parse(`{"v":"${literal}"}`).v;
      expect(typeof parsed, label).toBe('string');
      expect(BigInt(parsed).toString(), label).toBe(literal);
    }
  });

  it('refuses to accept an unsafe number as a protocol value', () => {
    // The guard a repository layer must apply if it ever sees a JSON number.
    const readExactU64 = (value: unknown): bigint => {
      if (typeof value === 'string') return BigInt(value);
      if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) {
          throw new RangeError('64-bit value arrived as an unsafe JSON number; select it as text');
        }
        return BigInt(value);
      }
      throw new TypeError('unsupported 64-bit representation');
    };

    expect(readExactU64('9223372036854775807')).toBe(9223372036854775807n);
    expect(readExactU64(42)).toBe(42n);
    expect(() => readExactU64(JSON.parse('{"v":9223372036854775807}').v)).toThrow(RangeError);
    expect(() => readExactU64(null)).toThrow(TypeError);
  });
});

describe('H2 recorded Postgres probe', () => {
  it('was executed and shows direct transport lossy, cast-to-text exact', () => {
    expect(existsSync(probePath), 'probe output missing; run tools/pg-bigint-probe.mjs').toBe(true);
    const probe = JSON.parse(readFileSync(probePath, 'utf8'));

    expect(probe.serverVersion).toMatch(/PostgreSQL/);
    expect(probe.results).toHaveLength(4);

    // Postgres itself emits full precision; the loss happens in the JS parser.
    const max = probe.results.find((r: { label: string }) => r.label === '2^63 - 1');
    expect(max.postgresRowToJson).toBe('{"v":9223372036854775807}');
    expect(max.exactAfterJsonParse).toBe(false);
    expect(max.exactAfterCastToText).toBe(true);

    expect(probe.conclusion.directTransportExact).toBe(false);
    expect(probe.conclusion.castToTextExact).toBe(true);
  });
});
