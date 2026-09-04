import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFunctionDefinitions } from '@/test/sqlModel';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/077_apple_iap_server_ledger.sql',
);
const obsoleteMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/073_apple_iap_server_ledger.sql',
);

let migration = '';
try {
  migration = readFileSync(migrationPath, 'utf8');
} catch {
  // A missing migration is the intended RED state for this contract test.
}

function definition(signature: string) {
  const found = parseFunctionDefinitions(migration)
    .find((candidate) => candidate.signature.toLowerCase() === signature.toLowerCase());
  expect(found, `${signature} must be defined by migration 077`).toBeDefined();
  return found!;
}

function expectDeletionLockBeforeAuthorityReads(signature: string) {
  const body = definition(signature).body;
  const lockAt = body.indexOf('pg_advisory_xact_lock');
  const pendingAt = body.indexOf('is_account_deletion_pending');
  const bindingAt = body.search(
    /(?:FROM|INTO|UPDATE)\s+iap_private\.apple_account_bindings/i,
  );

  expect(lockAt, `${signature} must take the account-deletion lock`).toBeGreaterThanOrEqual(0);
  expect(body).toMatch(/hashtextextended\([^)]*15013\)/i);
  expect(pendingAt, `${signature} must recheck deletion after locking`).toBeGreaterThan(lockAt);
  if (bindingAt >= 0) {
    expect(bindingAt, `${signature} must not inspect the binding before locking`).toBeGreaterThan(lockAt);
  }
}

type ParenthesizedSql = {
  body: string;
  bodyStart: number;
  bodyEnd: number;
  closeAt: number;
};

function readParenthesizedSql(source: string, openAt: number): ParenthesizedSql {
  if (source[openAt] !== '(') throw new Error('expected an opening parenthesis');

  let depth = 0;
  let inString = false;
  for (let index = openAt; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (character === "'" && source[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        inString = false;
      }
      continue;
    }
    if (character === "'") {
      inString = true;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return {
          body: source.slice(openAt + 1, index),
          bodyStart: openAt + 1,
          bodyEnd: index,
          closeAt: index,
        };
      }
      if (depth < 0) break;
    }
  }
  throw new Error('unterminated parenthesized SQL expression');
}

type SqlQuoteState = {
  delimiter: "'" | '"';
  backslashEscapes: boolean;
};

type SqlQuoteStart = SqlQuoteState & {
  length: number;
};

function isSqlIdentifierCharacter(character: string | undefined) {
  return character !== undefined && /[A-Za-z0-9_$\u0080-\uFFFF]/.test(character);
}

function sqlQuoteStartAt(sql: string, index: number): SqlQuoteStart | null {
  const character = sql[index];
  const atTokenBoundary = index === 0 || !isSqlIdentifierCharacter(sql[index - 1]);

  if (atTokenBoundary && (character === 'U' || character === 'u') && sql[index + 1] === '&') {
    const delimiter = sql[index + 2];
    if (delimiter === "'" || delimiter === '"') {
      return { delimiter, backslashEscapes: false, length: 3 };
    }
  }
  if (atTokenBoundary && (character === 'E' || character === 'e') && sql[index + 1] === "'") {
    return { delimiter: "'", backslashEscapes: true, length: 2 };
  }
  if (
    atTokenBoundary
    && (character === 'N' || character === 'n'
      || character === 'B' || character === 'b'
      || character === 'X' || character === 'x')
    && sql[index + 1] === "'"
  ) {
    return { delimiter: "'", backslashEscapes: false, length: 2 };
  }
  if (character === "'" || character === '"') {
    return { delimiter: character, backslashEscapes: false, length: 1 };
  }
  return null;
}

function maskSqlForStructuralSearch(sql: string) {
  const commentOnly = sql.split('');
  const structural = sql.split('');
  let index = 0;
  let quote: SqlQuoteState | null = null;
  let dollarTag: string | null = null;
  let lineComment = false;
  let blockCommentDepth = 0;
  const mask = (target: string[], at: number, length = 1) => {
    for (let offset = 0; offset < length; offset += 1) {
      if (target[at + offset] !== '\n' && target[at + offset] !== '\r') {
        target[at + offset] = ' ';
      }
    }
  };
  const maskComment = (at: number, length = 1) => {
    mask(commentOnly, at, length);
    mask(structural, at, length);
  };

  while (index < sql.length) {
    if (lineComment) {
      if (sql[index] === '\n' || sql[index] === '\r') {
        lineComment = false;
      } else {
        maskComment(index);
      }
      index += 1;
      continue;
    }
    if (blockCommentDepth > 0) {
      if (sql.startsWith('/*', index)) {
        maskComment(index, 2);
        blockCommentDepth += 1;
        index += 2;
      } else if (sql.startsWith('*/', index)) {
        maskComment(index, 2);
        blockCommentDepth -= 1;
        index += 2;
      } else {
        maskComment(index);
        index += 1;
      }
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        mask(structural, index, dollarTag.length);
        index += dollarTag.length;
        dollarTag = null;
      } else {
        mask(structural, index);
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (quote.backslashEscapes && sql[index] === '\\') {
        let runEnd = index;
        while (sql[runEnd] === '\\') runEnd += 1;
        const runLength = runEnd - index;
        mask(structural, index, runLength);
        if (runLength % 2 === 1 && runEnd < sql.length) {
          mask(structural, runEnd);
          index = runEnd + 1;
        } else {
          index = runEnd;
        }
      } else if (sql[index] === quote.delimiter && sql[index + 1] === quote.delimiter) {
        mask(structural, index, 2);
        index += 2;
      } else {
        mask(structural, index);
        if (sql[index] === quote.delimiter) quote = null;
        index += 1;
      }
      continue;
    }

    const dollarOpen = (index === 0 || !isSqlIdentifierCharacter(sql[index - 1]))
      ? /^\$(?:[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*)?\$/.exec(sql.slice(index))
      : null;
    if (dollarOpen) {
      dollarTag = dollarOpen[0];
      mask(structural, index, dollarTag.length);
      index += dollarTag.length;
    } else if (sql.startsWith('--', index)) {
      maskComment(index, 2);
      lineComment = true;
      index += 2;
    } else if (sql.startsWith('/*', index)) {
      maskComment(index, 2);
      blockCommentDepth = 1;
      index += 2;
    } else {
      const quoteStart = sqlQuoteStartAt(sql, index);
      if (quoteStart) {
        quote = {
          delimiter: quoteStart.delimiter,
          backslashEscapes: quoteStart.backslashEscapes,
        };
        mask(structural, index, quoteStart.length);
        index += quoteStart.length;
      } else {
        index += 1;
      }
    }
  }
  return {
    commentOnlySql: commentOnly.join(''),
    structuralSql: structural.join(''),
  };
}

function maskSqlComments(sql: string) {
  return maskSqlForStructuralSearch(sql).commentOnlySql;
}

function extractLedgerRowFamilyCheck(sql: string) {
  const { commentOnlySql, structuralSql } = maskSqlForStructuralSearch(sql);
  const tableMarkers = [...structuralSql.matchAll(
    /CREATE\s+TABLE\s+iap_private\.export_credit_ledger\b/gi,
  )];
  if (tableMarkers.length !== 1) {
    throw new Error('active export_credit_ledger table definition is missing or ambiguous');
  }

  const tableMarker = tableMarkers[0];
  const afterTableMarker = (tableMarker.index ?? 0) + tableMarker[0].length;
  const tableOpenAt = structuralSql.indexOf('(', afterTableMarker);
  if (tableOpenAt < 0 || structuralSql.slice(afterTableMarker, tableOpenAt).trim() !== '') {
    throw new Error('export_credit_ledger table has no column list');
  }
  const table = readParenthesizedSql(structuralSql, tableOpenAt);
  const constraintMarkers = [...table.body.matchAll(
    /CONSTRAINT\s+export_credit_ledger_row_family_check\s+CHECK\b/gi,
  )];
  if (constraintMarkers.length !== 1) {
    throw new Error('active named ledger row-family CHECK is missing or ambiguous');
  }

  const marker = constraintMarkers[0];
  const constraintStart = table.bodyStart + (marker.index ?? 0);
  const afterMarker = constraintStart + marker[0].length;
  const openAt = structuralSql.indexOf('(', afterMarker);
  if (openAt < 0 || structuralSql.slice(afterMarker, openAt).trim() !== '') {
    throw new Error('named ledger row-family CHECK has no expression');
  }
  const structuralCheck = readParenthesizedSql(structuralSql, openAt);
  return {
    ...structuralCheck,
    body: commentOnlySql.slice(structuralCheck.bodyStart, structuralCheck.bodyEnd),
    constraintStart,
  };
}

function splitTopLevelOrBranches(expression: string) {
  const branches: string[] = [];
  let branchStart = 0;
  let depth = 0;
  let inString = false;

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    if (inString) {
      if (character === "'" && expression[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        inString = false;
      }
      continue;
    }
    if (character === "'") {
      inString = true;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;

    const isTopLevelOr = depth === 0
      && expression.slice(index, index + 2).toUpperCase() === 'OR'
      && !/[A-Za-z0-9_]/.test(expression[index - 1] ?? '')
      && !/[A-Za-z0-9_]/.test(expression[index + 2] ?? '');
    if (isTopLevelOr) {
      branches.push(expression.slice(branchStart, index).trim());
      index += 1;
      branchStart = index + 1;
    }
  }
  if (depth !== 0 || inString) throw new Error('malformed ledger row-family CHECK');
  branches.push(expression.slice(branchStart).trim());
  return branches;
}

function unwrapLedgerBranch(branch: string) {
  const trimmed = branch.trim();
  const parsed = readParenthesizedSql(trimmed, 0);
  if (parsed.closeAt !== trimmed.length - 1) {
    throw new Error('ledger row-family branch is not locally parenthesized');
  }
  return parsed.body;
}

function ledgerRowFamilyBranches(sql: string) {
  const check = extractLedgerRowFamilyCheck(sql);
  return splitTopLevelOrBranches(check.body);
}

function ledgerRowFamilyPredicates(sql: string) {
  const families = new Map<string, string[]>();
  for (const branch of ledgerRowFamilyBranches(sql)) {
    const terms = unwrapLedgerBranch(branch)
      .split(/\s+AND\s+/i)
      .map((term) => term.replace(/\s+/g, ' ').trim().toLowerCase());
    const discriminator = /^entry_kind\s*=\s*'([^']+)'$/i.exec(terms[0]);
    if (!discriminator) throw new Error('ledger row-family branch has no entry_kind discriminator');
    if (families.has(discriminator[1])) throw new Error(`duplicate ${discriminator[1]} ledger branch`);
    families.set(discriminator[1], terms.slice(1));
  }
  return families;
}

const expectedLedgerRowFamilyPredicates: Record<string, string[]> = {
  purchase_grant: ['transaction_id is not null', 'event_signed_at is not null', 'reservation_id is null', 'amount > 0'],
  refund_reclaim: ['transaction_id is not null', 'event_signed_at is not null', 'reservation_id is null', 'amount < 0'],
  refund_reversed_grant: ['transaction_id is not null', 'event_signed_at is not null', 'reservation_id is null', 'amount > 0'],
  reserve: ['transaction_id is null', 'event_signed_at is null', 'reservation_id is not null', 'amount < 0'],
  commit: ['transaction_id is null', 'event_signed_at is null', 'reservation_id is not null', 'amount = 0'],
  release: ['transaction_id is null', 'event_signed_at is null', 'reservation_id is not null', 'amount > 0'],
  account_deletion: ['transaction_id is null', 'event_signed_at is null', 'reservation_id is not null', 'amount > 0'],
  refund_forced_release: ['transaction_id is not null', 'event_signed_at is not null', 'reservation_id is not null', 'amount > 0'],
  revoke_forced_release: ['transaction_id is not null', 'event_signed_at is not null', 'reservation_id is not null', 'amount > 0'],
};

function expectLedgerRowFamilyCheck(sql: string) {
  const actual = ledgerRowFamilyPredicates(sql);
  expect([...actual.keys()].sort()).toEqual(Object.keys(expectedLedgerRowFamilyPredicates).sort());
  for (const [entryKind, expectedPredicates] of Object.entries(expectedLedgerRowFamilyPredicates)) {
    expect([...(actual.get(entryKind) ?? [])].sort(), `${entryKind} ledger branch predicates`)
      .toEqual([...expectedPredicates].sort());
  }
}

function mutatePurchaseGrantBranch(transform: (branch: string) => string) {
  const check = extractLedgerRowFamilyCheck(migration);
  const branches = splitTopLevelOrBranches(check.body);
  const purchaseBranch = branches.find((branch) => (
    /^entry_kind\s*=\s*'purchase_grant'$/i.test(
      unwrapLedgerBranch(branch).split(/\s+AND\s+/i)[0].trim(),
    )
  ));
  if (!purchaseBranch) throw new Error('purchase_grant ledger branch is missing');

  const branchAt = check.body.indexOf(purchaseBranch);
  const mutatedCheck = check.body.slice(0, branchAt)
    + transform(purchaseBranch)
    + check.body.slice(branchAt + purchaseBranch.length);
  return migration.slice(0, check.bodyStart)
    + mutatedCheck
    + migration.slice(check.bodyEnd);
}

function commentOutLedgerRowFamilyCheck(sql: string, style: 'block' | 'line') {
  const check = extractLedgerRowFamilyCheck(sql);
  const commaAt = sql.lastIndexOf(',', check.constraintStart);
  if (commaAt < 0 || sql.slice(commaAt + 1, check.constraintStart).trim() !== '') {
    throw new Error('ledger row-family CHECK is not a table constraint');
  }
  const clause = sql.slice(commaAt, check.closeAt + 1);
  const commentedClause = style === 'block'
    ? `/*${clause}*/`
    : clause.split('\n').map((line) => `-- ${line}`).join('\n');
  return sql.slice(0, commaAt) + commentedClause + sql.slice(check.closeAt + 1);
}

function replaceLedgerRowFamilyConstraint(sql: string, replacement: string) {
  const check = extractLedgerRowFamilyCheck(sql);
  const commaAt = sql.lastIndexOf(',', check.constraintStart);
  if (commaAt < 0 || sql.slice(commaAt + 1, check.constraintStart).trim() !== '') {
    throw new Error('ledger row-family CHECK is not a table constraint');
  }
  return sql.slice(0, commaAt) + replacement + sql.slice(check.closeAt + 1);
}

function quotedSqlDecoys(body: string) {
  return [
    { name: 'ordinary string', quoted: `'${body}'`, tableElement: `, quoted_check_decoy TEXT DEFAULT '${body}'` },
    { name: 'N string', quoted: `N'${body}'`, tableElement: `, quoted_check_decoy TEXT DEFAULT N'${body}'` },
    { name: 'B string', quoted: `B'${body}'`, tableElement: `, quoted_check_decoy TEXT DEFAULT B'${body}'` },
    { name: 'X string', quoted: `X'${body}'`, tableElement: `, quoted_check_decoy TEXT DEFAULT X'${body}'` },
    { name: 'E string', quoted: `E'${body}'`, tableElement: `, quoted_check_decoy TEXT DEFAULT E'${body}'` },
    { name: 'e string', quoted: `e'${body}'`, tableElement: `, quoted_check_decoy TEXT DEFAULT e'${body}'` },
    { name: 'U& string', quoted: `U&'${body}'`, tableElement: `, quoted_check_decoy TEXT DEFAULT U&'${body}'` },
    { name: 'quoted identifier', quoted: `"${body}"`, tableElement: `, "${body}" TEXT` },
    { name: 'U& quoted identifier', quoted: `U&"${body}"`, tableElement: `, U&"${body}" TEXT` },
    { name: 'dollar body', quoted: `$$${body}$$`, tableElement: `, quoted_check_decoy TEXT DEFAULT $$${body}$$` },
    { name: 'tagged dollar body', quoted: `$quoted$${body}$quoted$`, tableElement: `, quoted_check_decoy TEXT DEFAULT $quoted$${body}$quoted$` },
    { name: 'Unicode-tagged dollar body', quoted: `$인용$${body}$인용$`, tableElement: `, quoted_check_decoy TEXT DEFAULT $인용$${body}$인용$` },
  ];
}

describe('migration 077 Apple IAP account-deletion fencing', () => {
  it('uses one unique forward migration number after relationship and write fencing', () => {
    expect(migration).not.toBe('');
    expect(existsSync(obsoleteMigrationPath)).toBe(false);
    expect(migration).toContain('-- 077_apple_iap_server_ledger.sql');
  });

  it('serializes every authenticated account-bound authority path before deletion checks', () => {
    for (const signature of [
      'public.iap_prepare_purchase(text, text)',
      'public.iap_get_state(text)',
      'public.iap_export_credit_reserve(text, bigint, uuid)',
      'public.iap_export_credit_commit(uuid)',
      'public.iap_export_credit_release(uuid)',
    ]) {
      expectDeletionLockBeforeAuthorityReads(signature);
    }
  });

  it('serializes verified server transactions before binding or deletion authority is read', () => {
    expectDeletionLockBeforeAuthorityReads(
      'public.iap_apply_verified_transaction(uuid, text, text, text, text, text, text, text, bigint, bigint, bigint, bigint, text, text, uuid, uuid)',
    );
  });

  it('binds IAP tombstoning to the exact deletion attempt and terminal relational phase', () => {
    const prepare = definition('public.iap_prepare_account_deletion_v2(uuid, uuid)');
    expect(prepare.body).toContain('lock_account_deletion_attempt_v2');
    expect(prepare.body).toContain('p_attempt_id');
    expect(prepare.body).toMatch(/v_phase\s+IS DISTINCT FROM\s+'solo_cleanup_complete'/i);
    expect(parseFunctionDefinitions(migration).some((candidate) => (
      candidate.signature.toLowerCase() === 'public.iap_prepare_account_deletion(uuid)'
    ))).toBe(false);
  });

  it('keeps the exact-attempt tombstone RPC service-role only', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.iap_prepare_account_deletion_v2\(UUID, UUID\)\s+FROM PUBLIC, anon, authenticated, service_role/i,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.iap_prepare_account_deletion_v2\(UUID, UUID\) TO service_role/i,
    );
  });
});

describe('migration 077 Apple IAP reservation-aware refund accounting', () => {
  it('keys repeatable transaction ledger events by signed event time', () => {
    expect(migration).toMatch(/event_signed_at\s+TIMESTAMPTZ/i);
    expect(migration).toMatch(
      /ON iap_private\.export_credit_ledger\s*\(\s*environment, transaction_id, entry_kind, event_signed_at\s*\)\s*WHERE transaction_id IS NOT NULL\s+AND reservation_id IS NULL/i,
    );
    expect(migration).not.toMatch(/COALESCE\(reservation_id/i);
  });

  it('makes each ledger row family fail closed on identity and amount shape', () => {
    expectLedgerRowFamilyCheck(migration);
  });

  it('rejects purchase_grant branch mutations without borrowing later branch conditions', () => {
    const missingTransactionIdentity = mutatePurchaseGrantBranch((branch) => (
      branch.replace(/\s+AND transaction_id IS NOT NULL/i, '')
    ));
    const wrongAmountSign = mutatePurchaseGrantBranch((branch) => (
      branch.replace(/amount\s*>\s*0/i, 'amount < 0')
    ));
    const unchangedLaterBranches = ledgerRowFamilyBranches(migration).slice(1);

    expect(missingTransactionIdentity).not.toBe(migration);
    expect(wrongAmountSign).not.toBe(migration);
    expect(ledgerRowFamilyBranches(missingTransactionIdentity).slice(1))
      .toEqual(unchangedLaterBranches);
    expect(ledgerRowFamilyBranches(wrongAmountSign).slice(1))
      .toEqual(unchangedLaterBranches);
    expect(() => expectLedgerRowFamilyCheck(missingTransactionIdentity)).toThrow();
    expect(() => expectLedgerRowFamilyCheck(wrongAmountSign)).toThrow();
  });

  it('rejects a named row-family CHECK that survives only inside SQL comments', () => {
    const blockCommentedCheck = commentOutLedgerRowFamilyCheck(migration, 'block');
    const lineCommentedCheck = commentOutLedgerRowFamilyCheck(migration, 'line');
    const activeCheck = extractLedgerRowFamilyCheck(migration);
    const outsideTableDecoy = `${blockCommentedCheck}
CREATE TABLE iap_private.ledger_check_decoy (
  amount BIGINT,
  CONSTRAINT export_credit_ledger_row_family_check CHECK (${activeCheck.body})
);`;

    expect(blockCommentedCheck).toContain('/*,\n  CONSTRAINT export_credit_ledger_row_family_check');
    expect(lineCommentedCheck).toContain('-- ,\n--   CONSTRAINT export_credit_ledger_row_family_check');
    expect(() => expectLedgerRowFamilyCheck(blockCommentedCheck)).toThrow();
    expect(() => expectLedgerRowFamilyCheck(lineCommentedCheck)).toThrow();
    expect(() => expectLedgerRowFamilyCheck(outsideTableDecoy)).toThrow();
  });

  it('rejects target structure hidden inside nested block comments', () => {
    const nestedCommentDecoy = `/* outer
  CREATE TABLE iap_private.export_credit_ledger (
    /* nested CONSTRAINT export_credit_ledger_row_family_check CHECK (TRUE) */
  )
*/`;

    expect(() => extractLedgerRowFamilyCheck(nestedCommentDecoy)).toThrow();
  });

  it('preserves comment tokens inside quoted SQL text', () => {
    const quotedCommentTokens = "SELECT '-- line', '/* block */', \"-- identifier\", $$/* dollar */$$;";

    expect(maskSqlComments(quotedCommentTokens)).toBe(quotedCommentTokens);
  });

  it('rejects a complete target table appearing only inside quoted bodies', () => {
    const decoyTable = `CREATE TABLE iap_private.export_credit_ledger (
  CONSTRAINT export_credit_ledger_row_family_check CHECK (TRUE)
)`;

    for (const decoy of quotedSqlDecoys(decoyTable)) {
      expect(
        () => extractLedgerRowFamilyCheck(`SELECT ${decoy.quoted};`),
        `${decoy.name} must not supply the target table`,
      ).toThrow();
    }
  });

  it('rejects a named CHECK appearing only inside quoted table elements', () => {
    const decoyConstraint = 'CONSTRAINT export_credit_ledger_row_family_check CHECK (TRUE)';

    for (const decoy of quotedSqlDecoys(decoyConstraint)) {
      const quotedConstraintDecoy = replaceLedgerRowFamilyConstraint(
        migration,
        decoy.tableElement,
      );
      expect(
        () => extractLedgerRowFamilyCheck(quotedConstraintDecoy),
        `${decoy.name} must not supply the named CHECK`,
      ).toThrow();
    }
  });

  it('honors E/e escape-string backslash parity and doubled quotes', () => {
    const decoyTable = `CREATE TABLE iap_private.export_credit_ledger (
  CONSTRAINT export_credit_ledger_row_family_check CHECK (TRUE)
)`;

    for (const prefix of ['E', 'e']) {
      const oddBackslashDecoy = `SELECT ${prefix}'prefix\\' ${decoyTable}';`;
      const doubledQuoteDecoy = `SELECT ${prefix}'prefix'' ${decoyTable}';`;
      const evenBackslashThenActiveTable = `SELECT ${prefix}'prefix\\\\';
${decoyTable};`;

      expect(() => extractLedgerRowFamilyCheck(oddBackslashDecoy)).toThrow();
      expect(() => extractLedgerRowFamilyCheck(doubledQuoteDecoy)).toThrow();
      expect(() => extractLedgerRowFamilyCheck(evenBackslashThenActiveTable)).not.toThrow();
    }
  });

  it('does not erase dollar fragments that are part of PostgreSQL identifiers', () => {
    const malformedTableNames = [
      migration.replace(
        'CREATE TABLE iap_private.export_credit_ledger (',
        'CREATE TABLE iap_private.export_credit_ledger$tag$$tag$ (',
      ),
      migration.replace(
        'CREATE TABLE iap_private.export_credit_ledger (',
        'CREATE TABLE iap_private.export_credit_ledger$태그$$태그$ (',
      ),
    ];
    const malformedConstraintNames = [
      migration.replace(
        'CONSTRAINT export_credit_ledger_row_family_check CHECK',
        'CONSTRAINT export_credit_ledger_row_family_check$tag$$tag$ CHECK',
      ),
      migration.replace(
        'CONSTRAINT export_credit_ledger_row_family_check CHECK',
        'CONSTRAINT export_credit_ledger_row_family_check$태그$$태그$ CHECK',
      ),
    ];
    const activeTable = `CREATE TABLE iap_private.export_credit_ledger (
  CONSTRAINT export_credit_ledger_row_family_check CHECK (TRUE)
)`;

    for (const malformed of [...malformedTableNames, ...malformedConstraintNames]) {
      expect(() => extractLedgerRowFamilyCheck(malformed)).toThrow();
    }
    expect(() => extractLedgerRowFamilyCheck(`SELECT foo$tag$;\n${activeTable};`)).not.toThrow();
  });

  it('does not mistake an E suffix inside a Unicode identifier for an escape string', () => {
    const activeTable = `CREATE TABLE iap_private.export_credit_ledger (
  CONSTRAINT export_credit_ledger_row_family_check CHECK (TRUE)
)`;

    expect(() => extractLedgerRowFamilyCheck(`SELECT 타입e'abc\\';\n${activeTable};`)).not.toThrow();
  });

  it('captures pre-mutation transaction state and limits forced releases to active reversals', () => {
    const apply = definition(
      'public.iap_apply_verified_transaction(uuid, text, text, text, text, text, text, text, bigint, bigint, bigint, bigint, text, text, uuid, uuid)',
    ).body;

    expect(apply).toMatch(/v_had_existing\s*:=\s*FOUND/i);
    expect(apply).toMatch(/v_previous_status\s*=\s*'active'/i);
    expect(apply).toMatch(/v_effective_event_kind\s+IN\s*\('refund', 'revoke'\)/i);
  });

  it('row-locks same-account environment reservations in deterministic newest-first order', () => {
    const apply = definition(
      'public.iap_apply_verified_transaction(uuid, text, text, text, text, text, text, text, bigint, bigint, bigint, bigint, text, text, uuid, uuid)',
    ).body;

    expect(apply).toMatch(/r\.billing_account_id\s*=\s*v_binding\.billing_account_id/i);
    expect(apply).toMatch(/r\.environment\s*=\s*p_environment/i);
    expect(apply).toMatch(/r\.status\s*=\s*'reserved'/i);
    expect(apply).toMatch(/ORDER BY r\.created_at DESC, r\.reservation_id DESC\s+FOR UPDATE/i);
    expect(apply).toContain("'refund_forced_release'");
    expect(apply).toContain("'revoke_forced_release'");
  });

  it('does not conceal a negative raw ledger balance with GREATEST', () => {
    expect(migration).not.toMatch(
      /GREATEST\s*\(\s*iap_private\.credit_balance/i,
    );
  });
});
