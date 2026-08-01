import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleDeleteAccountRequest } from './handler.ts';

/**
 * Thin Deno entrypoint.
 *
 * All request handling lives in `handler.ts` so it can be exercised by the test
 * suite; this file only injects the platform-specific pieces (`Deno.env` and the
 * service-role client).
 */
Deno.serve((request) => handleDeleteAccountRequest(request, {
  env: (key) => Deno.env.get(key),
  createAdmin: (url, serviceRoleKey) => createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }),
}));
