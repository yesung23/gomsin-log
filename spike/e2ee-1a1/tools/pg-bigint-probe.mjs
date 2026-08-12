/**
 * SPIKE ONLY — measure how a Postgres `bigint` survives the PostgREST transport.
 *
 * PostgREST builds its response body with Postgres's own JSON aggregation, so
 * the bytes `row_to_json` / `json_agg` produce here are the bytes the API would
 * send. `@supabase/supabase-js` then calls `Response.json()`, which is
 * `JSON.parse`. Running both halves reproduces the real path without needing
 * PostgREST itself installed.
 *
 * Requires a throwaway local cluster. NEVER point this at production.
 *
 *   node spike/e2ee-1a1/tools/pg-bigint-probe.mjs
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOST = process.env.SPIKE_PG_HOST ?? '127.0.0.1';
const PORT = process.env.SPIKE_PG_PORT ?? '55432';
const USER = process.env.SPIKE_PG_USER ?? 'spike';
const DB = process.env.SPIKE_PG_DB ?? 'postgres';

if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
  throw new Error('refusing to run against a non-local host');
}

function sql(query) {
  return execFileSync(
    'psql',
    ['-h', HOST, '-p', PORT, '-U', USER, '-d', DB, '-tAc', query],
    { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } },
  ).trim();
}

const VALUES = [
  ['2^53 - 1', '9007199254740991'],
  ['2^53', '9007199254740992'],
  ['2^53 + 1', '9007199254740993'],
  ['2^63 - 1', '9223372036854775807'],
];

const serverVersion = sql('select version()');
const results = [];

for (const [label, literal] of VALUES) {
  // Exactly how PostgREST renders a row: Postgres-side JSON generation.
  const rawJson = sql(`select row_to_json(t) from (select ${literal}::bigint as v) t`);
  const aggJson = sql(`select json_agg(t) from (select ${literal}::bigint as v) t`);
  // The mitigation the architecture proposes: cast at the query boundary.
  const textJson = sql(`select row_to_json(t) from (select (${literal}::bigint)::text as v) t`);

  const parsedRaw = JSON.parse(rawJson).v;
  const parsedText = JSON.parse(textJson).v;

  results.push({
    label,
    literal,
    postgresRowToJson: rawJson,
    postgresJsonAgg: aggJson.replace(/\s+/g, ' '),
    jsonParseType: typeof parsedRaw,
    jsonParseValue: String(parsedRaw),
    exactAfterJsonParse: String(parsedRaw) === literal,
    castToTextJson: textJson,
    castToTextParsed: parsedText,
    castToTextBigInt: BigInt(parsedText).toString(),
    exactAfterCastToText: BigInt(parsedText).toString() === literal,
  });
}

const report = {
  _comment: 'SPIKE ONLY. Throwaway local cluster. No production database was contacted.',
  serverVersion,
  method:
    'psql renders the same Postgres-side JSON that PostgREST emits; JSON.parse is what supabase-js applies via Response.json().',
  results,
  conclusion: {
    directTransportExact: results.every((r) => r.exactAfterJsonParse),
    castToTextExact: results.every((r) => r.exactAfterCastToText),
  },
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors', 'generated');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'bigint-transport.json');
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify(report, null, 2));
console.log(`\nwrote ${outPath}`);
