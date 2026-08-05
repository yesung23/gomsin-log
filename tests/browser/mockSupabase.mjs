/**
 * 브라우저 테스트용 Supabase 목 백엔드.
 *
 * 실제 Supabase의 HTTP 표면(PostgREST / Auth / Storage / Edge Functions)을
 * 형태 그대로 흉내내어 프로덕션 번들이 코드 수정 없이 동작하도록 합니다.
 * - PostgREST: Accept 헤더가 vnd.pgrst.object+json이면 단일 객체, 아니면 배열
 * - 없는 행 + 단일 조회 → 406 + PGRST116 (supabase-js가 maybeSingle에서 null로 처리)
 */

export const MOCK_ORIGIN = 'https://mock.supabase.test';
export const PROJECT_REF = 'mock';
export const AUTH_STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

// 1x1 투명 PNG
export const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

export function makeSession(userId, email = 'creator@example.test') {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    access_token: `mock-access-${userId}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: nowSec + 3600,
    refresh_token: `mock-refresh-${userId}`,
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: new Date(nowSec * 1000).toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: new Date(nowSec * 1000).toISOString(),
      updated_at: new Date(nowSec * 1000).toISOString(),
    },
  };
}

/**
 * 목 데이터베이스. 시나리오별로 필요한 부분만 덮어씁니다.
 */
export function makeDb(overrides = {}) {
  return {
    userId: 'user-a',
    coupleId: '11111111-1111-4111-8111-111111111111',
    profiles: {},
    coupleMembers: [],
    couples: {},
    partnerProfile: [],
    contactPreferences: null,
    dailyRecords: [],
    events: [],
    trips: [],
    // 동작 스위치
    uploadShouldFail: false,
    attachUpdateShouldFail: false,
    // 기록용
    calls: [],
    storageObjects: [],
    storageRemoved: [],
    ...overrides,
  };
}

function json(body, status = 200, headers = {}) {
  return {
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*', ...headers },
    body: JSON.stringify(body),
  };
}

function wantsSingle(request) {
  const accept = request.headers()['accept'] || '';
  return accept.includes('vnd.pgrst.object+json');
}

function notFoundSingle() {
  return json(
    {
      code: 'PGRST116',
      details: 'The result contains 0 rows',
      hint: null,
      message: 'JSON object requested, multiple (or no) rows returned',
    },
    406,
  );
}

function respondRows(request, rows) {
  if (wantsSingle(request)) {
    if (rows.length === 0) return notFoundSingle();
    return json(rows[0]);
  }
  return json(rows);
}

/**
 * page.route 핸들러를 만듭니다.
 */
export function createSupabaseRouter(db) {
  return async (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    db.calls.push(`${method} ${path}${url.search ? '?' + url.search.slice(1) : ''}`);

    if (method === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        },
        body: '',
      });
    }

    // ---------------- Auth ----------------
    if (path === '/auth/v1/user') {
      const session = makeSession(db.userId);
      return route.fulfill(json(session.user));
    }
    if (path === '/auth/v1/token') {
      return route.fulfill(json(makeSession(db.userId)));
    }
    if (path === '/auth/v1/otp' || path === '/auth/v1/magiclink') {
      return route.fulfill(json({}));
    }
    if (path === '/auth/v1/logout') {
      return route.fulfill({ status: 204, body: '' });
    }

    // ---------------- Edge Functions ----------------
    if (path === '/functions/v1/create-media-signed-url') {
      return route.fulfill(json({ signedUrl: TINY_PNG_DATA_URL, expiresIn: 600 }));
    }

    // ---------------- Storage ----------------
    if (path.startsWith('/storage/v1/object/')) {
      const objectPath = path.replace('/storage/v1/object/couple-media/', '');
      if (method === 'POST' || method === 'PUT') {
        if (db.uploadShouldFail) {
          return route.fulfill(
            json(
              {
                statusCode: '403',
                error: 'Unauthorized',
                message: 'new row violates row-level security policy',
              },
              403,
            ),
          );
        }
        db.storageObjects.push(objectPath);
        return route.fulfill(json({ Id: 'obj-1', Key: `couple-media/${objectPath}` }));
      }
      if (method === 'DELETE') {
        let body = {};
        try {
          body = JSON.parse(request.postData() || '{}');
        } catch {
          /* ignore */
        }
        const prefixes = body.prefixes || [];
        db.storageRemoved.push(...prefixes);
        db.storageObjects = db.storageObjects.filter((o) => !prefixes.includes(o));
        return route.fulfill(json(prefixes.map((p) => ({ name: p }))));
      }
    }
    if (path.startsWith('/storage/v1/list/')) {
      return route.fulfill(json(db.storageObjects.map((o) => ({ name: o.split('/').pop() }))));
    }

    // ---------------- PostgREST RPC ----------------
    if (path.startsWith('/rest/v1/rpc/')) {
      const fn = path.replace('/rest/v1/rpc/', '');
      switch (fn) {
        case 'create_couple_and_invitation':
          return route.fulfill(json(db.coupleId));
        case 'consume_invitation':
          return route.fulfill(json(db.coupleId));
        case 'get_partner_profile':
          return route.fulfill(json(db.partnerProfile));
        case 'disconnect_couple':
          return route.fulfill(json(null));
        default:
          return route.fulfill(json(null));
      }
    }

    // ---------------- PostgREST tables ----------------
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '');

      if (method === 'GET') {
        switch (table) {
          case 'profiles':
            return route.fulfill(respondRows(request, db.profiles ? [db.profiles] : []));
          case 'couple_members':
            return route.fulfill(respondRows(request, db.coupleMembers));
          case 'couples':
            return route.fulfill(respondRows(request, db.couples ? [db.couples] : []));
          case 'contact_preferences':
            return route.fulfill(
              respondRows(request, db.contactPreferences ? [db.contactPreferences] : []),
            );
          case 'daily_records':
            return route.fulfill(respondRows(request, db.dailyRecords));
          case 'events':
            return route.fulfill(respondRows(request, db.events));
          case 'trips':
            return route.fulfill(respondRows(request, db.trips));
          default:
            return route.fulfill(respondRows(request, []));
        }
      }

      // upsert / insert / update
      if (method === 'POST' || method === 'PATCH') {
        let payload = {};
        try {
          payload = JSON.parse(request.postData() || '{}');
        } catch {
          /* ignore */
        }
        const rows = Array.isArray(payload) ? payload : [payload];

        if (table === 'daily_records') {
          const hasAttachments = rows.some(
            (r) => Array.isArray(r.attachments) && r.attachments.length > 0,
          );
          if (hasAttachments && db.attachUpdateShouldFail) {
            return route.fulfill(
              json(
                {
                  code: '42501',
                  message: 'new row violates row-level security policy for table "daily_records"',
                },
                403,
              ),
            );
          }
          for (const r of rows) {
            const idx = db.dailyRecords.findIndex((x) => x.id === r.id);
            if (idx >= 0) db.dailyRecords[idx] = { ...db.dailyRecords[idx], ...r };
            else db.dailyRecords.push(r);
          }
          return route.fulfill(respondRows(request, rows));
        }

        if (table === 'couples') {
          db.couples = { ...db.couples, ...rows[0] };
          return route.fulfill(respondRows(request, [db.couples]));
        }

        return route.fulfill(respondRows(request, rows));
      }

      if (method === 'DELETE') {
        return route.fulfill(json([]));
      }
    }

    // 그 외(realtime 등)는 조용히 실패시킵니다.
    return route.fulfill(json({}, 200));
  };
}
