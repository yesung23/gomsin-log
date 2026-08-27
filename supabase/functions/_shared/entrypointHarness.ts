const FUNCTION_PORT = 8000;

export function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

export function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`assertion failed: ${message} (got ${a}, expected ${e})`);
}

export type SeenRequest = {
  path: string;
  method: string;
  apikey: string | null;
  authorization: string | null;
  body: string | null;
};

/** A local stub HTTP server representing Supabase backend endpoints. */
export function startSupabaseStub(
  customHandler?: (req: Request) => Response | Promise<Response>,
): {
  base: string;
  seen: SeenRequest[];
  stop: () => Promise<void>;
} {
  const seen: SeenRequest[] = [];
  const server = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen: () => {} },
    async (incoming) => {
      const url = new URL(incoming.url);
      const bodyText = incoming.method !== 'GET' && incoming.method !== 'HEAD' ? await incoming.text() : null;
      seen.push({
        path: url.pathname,
        method: incoming.method,
        apikey: incoming.headers.get('apikey'),
        authorization: incoming.headers.get('authorization'),
        body: bodyText,
      });
      if (customHandler) {
        return customHandler(incoming);
      }
      return new Response(JSON.stringify({ message: 'invalid token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  );
  return {
    base: `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`,
    seen,
    stop: () => server.shutdown(),
  };
}

/** Spawn a function entrypoint subprocess and probe until ready. */
export async function startEntrypoint(
  entrypointUrl: URL,
  env: Record<string, string>,
  probeOptions?: { method?: string; headers?: HeadersInit; path?: string },
): Promise<{
  origin: string;
  stop: () => Promise<void>;
}> {
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      'run', '--allow-net', '--allow-env', '--quiet',
      entrypointUrl.href,
    ],
    env: { ...env, NO_COLOR: '1' },
    stdout: 'piped',
    stderr: 'piped',
  });
  const child = command.spawn();
  const origin = `http://127.0.0.1:${FUNCTION_PORT}`;
  const targetPath = probeOptions?.path ?? '';

  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
    try {
      const probe = await fetch(`${origin}${targetPath}`, {
        method: probeOptions?.method ?? 'OPTIONS',
        headers: probeOptions?.headers,
      });
      await probe.text();
      ready = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const stop = async () => {
    try {
      child.kill('SIGKILL');
    } catch { /* already gone */ }
    await child.output();
    // Give the OS a moment to release the port before the next test binds it.
    await new Promise((resolve) => setTimeout(resolve, 250));
  };

  if (!ready) {
    const output = await child.output();
    const stderr = new TextDecoder().decode(output.stderr);
    throw new Error(`the entrypoint subprocess never became ready:\n${stderr}`);
  }
  return { origin, stop };
}
