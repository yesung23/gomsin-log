/**
 * A small structural model of the migration SQL, for tests.
 *
 * The migration "contract" tests used to be `toContain` greps over the raw file,
 * which pass for a semantically broken edit as long as the substrings survive and
 * fail for a harmless reformat. There is no Postgres in CI or in this sandbox, so
 * a real database assertion is out of reach here (that stays a staging gate) --
 * but the SHAPE of the DDL can be parsed instead of pattern-matched, which is
 * what this module does:
 *
 *  - comments and dollar-quoted bodies are handled explicitly, so a rule spelled
 *    out in prose in a header comment can never satisfy an assertion about
 *    executable SQL;
 *  - a function definition becomes a record (signature, return type, language,
 *    volatility, security, search_path, body);
 *  - GRANT/REVOKE statements are replayed in file order onto Postgres's actual
 *    default (EXECUTE to PUBLIC at creation), so a test can ask "can `anon`
 *    execute this?" instead of grepping for a GRANT line;
 *  - the keys a `jsonb_build_object` return payload actually emits can be
 *    compared against the client parser that consumes them.
 *
 * It is deliberately NOT a general SQL parser. It understands the dialect these
 * 17 files are written in and throws rather than guessing.
 */

export type FunctionSecurity = 'DEFINER' | 'INVOKER';
export type FunctionVolatility = 'VOLATILE' | 'STABLE' | 'IMMUTABLE';

export type SqlFunctionDefinition = {
  /** `public.get_partner_profile` */
  qualifiedName: string;
  /** Declared argument list, verbatim per argument, e.g. `['p_role TEXT']`. */
  args: string[];
  /** Argument TYPES only, upper-cased: `['UUID[]', 'INTEGER[]']`. */
  argTypes: string[];
  /** `public.get_partner_profile()` — the form DROP/GRANT statements must use. */
  signature: string;
  /** Verbatim return clause, e.g. `JSONB` or `TABLE (display_name TEXT, ...)`. */
  returns: string;
  /** Column names when the function `RETURNS TABLE`, otherwise `[]`. */
  returnColumns: string[];
  language: string;
  security: FunctionSecurity;
  volatility: FunctionVolatility;
  /** `['public', 'pg_temp']`, or `null` when the function does not pin one. */
  searchPath: string[] | null;
  /** Whether the header used `CREATE OR REPLACE`. */
  orReplace: boolean;
  /** The dollar-quoted body, without the quoting tags. */
  body: string;
  /** Offset of the `CREATE` keyword in the comment-stripped SQL. */
  index: number;
};

/**
 * Remove `--` comments without touching anything inside a string or a
 * dollar-quoted body -- a function body may legitimately contain `--`.
 */
export function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  let dollarTag: string | null = null;
  let quote: "'" | '"' | null = null;

  while (i < sql.length) {
    const rest = sql.slice(i);

    if (dollarTag) {
      if (rest.startsWith(dollarTag)) {
        out += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      out += sql[i];
      i += 1;
      continue;
    }

    if (quote) {
      out += sql[i];
      if (sql[i] === quote) quote = null;
      i += 1;
      continue;
    }

    const dollarOpen = /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollarOpen) {
      dollarTag = dollarOpen[0];
      out += dollarTag;
      i += dollarTag.length;
      continue;
    }

    if (sql[i] === "'" || sql[i] === '"') {
      quote = sql[i] as "'" | '"';
      out += sql[i];
      i += 1;
      continue;
    }

    if (rest.startsWith('--')) {
      const newline = sql.indexOf('\n', i);
      if (newline === -1) break;
      i = newline; // keep the newline itself
      continue;
    }

    out += sql[i];
    i += 1;
  }

  return out;
}

/** Split a parenthesised list on top-level commas. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * `p_item_ids UUID[]` -> `UUID[]`; `TEXT` -> `TEXT`.
 *
 * A DEFAULT clause is stripped, because it is not part of the identity Postgres
 * uses for a function -- `GRANT ... ON FUNCTION f(UUID, UUID[])` addresses a
 * function declared `f(p_id UUID, p_ids UUID[] DEFAULT '{}')`.
 */
function argType(arg: string): string {
  const words = arg.trim().replace(/\s+(DEFAULT\s|=)[\s\S]*$/i, '').split(/\s+/);
  const withoutMode = words[0].toUpperCase() === 'OUT' || words[0].toUpperCase() === 'INOUT'
    ? words.slice(1)
    : words;
  return (withoutMode.length > 1 ? withoutMode.slice(1).join(' ') : withoutMode[0]).toUpperCase();
}

/**
 * Parse every `CREATE [OR REPLACE] FUNCTION ... AS $tag$ ... $tag$` in a file.
 *
 * Comments are stripped first, so a create shown as an example inside a header
 * comment or a commented rollback block is invisible here -- which is the point.
 */
export function parseFunctionDefinitions(sql: string): SqlFunctionDefinition[] {
  const executable = stripSqlComments(sql);
  const definitions: SqlFunctionDefinition[] = [];
  const header = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z_][\w.]*)\s*\(/gi;

  let match: RegExpExecArray | null;
  while ((match = header.exec(executable)) !== null) {
    const start = match.index;
    const orReplace = Boolean(match[1]);
    const qualifiedName = match[2];

    // Argument list: balanced from the paren the header ended on.
    let depth = 1;
    let cursor = header.lastIndex;
    while (cursor < executable.length && depth > 0) {
      if (executable[cursor] === '(') depth += 1;
      if (executable[cursor] === ')') depth -= 1;
      cursor += 1;
    }
    if (depth !== 0) throw new Error(`Unbalanced argument list for ${qualifiedName}`);
    const rawArgs = executable.slice(header.lastIndex, cursor - 1);

    // Everything between the argument list and the body is the option clause.
    const bodyTag = /AS\s+(\$[A-Za-z_]*\$)/i.exec(executable.slice(cursor));
    if (!bodyTag) throw new Error(`No dollar-quoted body for ${qualifiedName}`);
    const clauses = executable.slice(cursor, cursor + bodyTag.index);
    const tag = bodyTag[1];
    const bodyStart = cursor + (bodyTag.index ?? 0) + bodyTag[0].length;
    const bodyEnd = executable.indexOf(tag, bodyStart);
    if (bodyEnd === -1) throw new Error(`Unterminated body for ${qualifiedName}`);

    const returnsMatch = /RETURNS\s+(TABLE\s*\([\s\S]*?\)|SETOF\s+[\w.]+|[\w.]+(?:\[\])?)/i
      .exec(clauses);
    const returns = returnsMatch ? returnsMatch[1].replace(/\s+/g, ' ').trim() : '';
    const tableColumns = /^TABLE\s*\(([\s\S]*)\)$/i.exec(returns);

    const searchPathMatch = /SET\s+search_path\s*=\s*([^\n]+)/i.exec(clauses);
    const args = splitTopLevel(rawArgs);

    definitions.push({
      qualifiedName,
      args,
      argTypes: args.map(argType),
      signature: `${qualifiedName}(${args.map(argType).join(', ')})`,
      returns,
      returnColumns: tableColumns
        ? splitTopLevel(tableColumns[1]).map((column) => column.trim().split(/\s+/)[0])
        : [],
      language: (/LANGUAGE\s+(\w+)/i.exec(clauses)?.[1] ?? '').toLowerCase(),
      security: /SECURITY\s+DEFINER/i.test(clauses) ? 'DEFINER' : 'INVOKER',
      volatility: (/\b(STABLE|IMMUTABLE|VOLATILE)\b/i.exec(clauses)?.[1].toUpperCase()
        ?? 'VOLATILE') as FunctionVolatility,
      searchPath: searchPathMatch
        ? searchPathMatch[1].split(',').map((entry) => entry.trim()).filter(Boolean)
        : null,
      orReplace,
      body: executable.slice(bodyStart, bodyEnd),
      index: start,
    });

    header.lastIndex = bodyEnd + tag.length;
  }

  return definitions;
}

export type ExecutePrivileges = {
  /** Whether EXECUTE is currently held by PUBLIC (Postgres's creation default). */
  publicHolds: boolean;
  /** Roles explicitly holding EXECUTE. */
  roles: Set<string>;
  /**
   * How many CREATE/GRANT/REVOKE statements actually addressed this signature.
   *
   * Zero means the signature was never mentioned -- which for a function that is
   * supposed to exist means the test is asserting nothing, so callers check it.
   */
  statementsApplied: number;
};

/** Can `role` execute the function, directly or through PUBLIC? */
export function canExecute(privileges: ExecutePrivileges, role: string): boolean {
  return privileges.publicHolds || privileges.roles.has(role.toLowerCase());
}

/**
 * Replay every GRANT/REVOKE for one function signature, in file order.
 *
 * Starts from Postgres's real default: creating a function grants EXECUTE to
 * PUBLIC. That default is the whole reason `REVOKE ... FROM PUBLIC` has to be
 * there, so a model that started empty would call an unsafe migration safe.
 *
 * Signature matching is normalised on whitespace and case, so
 * `public.f(UUID, TEXT)` and `public.f(uuid,text)` are the same object.
 */
export function executePrivileges(sql: string, signature: string): ExecutePrivileges {
  const executable = stripSqlComments(sql);
  const normalise = (value: string) => value.replace(/\s+/g, '').toLowerCase();
  const target = normalise(signature);
  const privileges: ExecutePrivileges = {
    publicHolds: false,
    roles: new Set(),
    statementsApplied: 0,
  };

  const statements = executable.split(';');
  for (const statement of statements) {
    const text = statement.trim();
    if (!text) continue;

    const create = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z_][\w.]*)\s*\(([^)]*)\)/i
      .exec(text);
    if (create) {
      const created = normalise(
        `${create[1]}(${splitTopLevel(create[2]).map(argType).join(',')})`,
      );
      // A create (or a drop+create) resets the privileges to the default.
      if (created === target) {
        privileges.publicHolds = true;
        privileges.roles.clear();
        privileges.statementsApplied += 1;
      }
      continue;
    }

    const grant = /^(GRANT|REVOKE)\s+([\s\S]+?)\s+ON\s+FUNCTION\s+([A-Za-z_][\w.]*\s*\([^)]*\))\s+(TO|FROM)\s+([\s\S]+)$/i
      .exec(text);
    if (!grant) continue;
    const [, verb, privilegeList, onSignature, , roleList] = grant;
    const onName = /^([A-Za-z_][\w.]*)\s*\(([^)]*)\)$/.exec(onSignature.trim());
    if (!onName) continue;
    const on = normalise(`${onName[1]}(${splitTopLevel(onName[2]).map(argType).join(',')})`);
    if (on !== target) continue;

    const privilege = privilegeList.trim().toUpperCase();
    if (!/^(ALL|ALL PRIVILEGES|EXECUTE)$/.test(privilege)) continue;
    privileges.statementsApplied += 1;

    for (const rawRole of roleList.split(',')) {
      const role = rawRole.trim().toLowerCase().replace(/^role\s+/, '');
      if (!role) continue;
      if (verb.toUpperCase() === 'GRANT') {
        if (role === 'public') privileges.publicHolds = true;
        else privileges.roles.add(role);
      } else {
        if (role === 'public') privileges.publicHolds = false;
        else privileges.roles.delete(role);
      }
    }
  }

  return privileges;
}

/** Every `NOTIFY channel[, 'payload']` in executable SQL, in order. */
export function parseNotifies(sql: string): Array<{ channel: string; payload: string | null }> {
  const executable = stripSqlComments(sql);
  const notifies: Array<{ channel: string; payload: string | null }> = [];
  const pattern = /NOTIFY\s+([A-Za-z_]\w*)\s*(?:,\s*'([^']*)')?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(executable)) !== null) {
    notifies.push({ channel: match[1], payload: match[2] ?? null });
  }
  return notifies;
}

/**
 * The keys a `jsonb_build_object(...)` call emits.
 *
 * Used to compare a function's real return payload against the hand-written
 * client parser that consumes it, instead of trusting a mock to agree with both.
 */
export function jsonbObjectKeys(body: string): string[][] {
  const keys: string[][] = [];
  const pattern = /jsonb_build_object\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    let depth = 1;
    let cursor = pattern.lastIndex;
    while (cursor < body.length && depth > 0) {
      if (body[cursor] === '(') depth += 1;
      if (body[cursor] === ')') depth -= 1;
      cursor += 1;
    }
    const inner = body.slice(pattern.lastIndex, cursor - 1);
    const entries = splitTopLevel(inner);
    const objectKeys: string[] = [];
    for (let index = 0; index < entries.length; index += 2) {
      const key = /^'([^']*)'$/.exec(entries[index].trim());
      if (key) objectKeys.push(key[1]);
    }
    keys.push(objectKeys);
    pattern.lastIndex = cursor;
  }
  return keys;
}

/** Statement-level view of executable SQL, for ordering assertions. */
export function executableStatements(sql: string): string[] {
  return stripSqlComments(sql)
    .split(';')
    .map((statement) => statement.trim().replace(/\s+/g, ' '))
    .filter((statement) => statement.length > 0);
}
