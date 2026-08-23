-- =============================================================================
-- 056_diary_pages.sql
--
-- 일기장 지면 — 사용자가 **고른 것**이 남는 자리.
--
-- ## 왜 새 테이블인가
--
-- `PRODUCT_V3` §5.5가 `우리`와 `일기장`의 경계를 이렇게 긋는다.
--
--     우리    자동으로 쌓인다   하루 칸   본다
--     일기장  내가 만든다       한 달 지면 만든다
--
-- `daily_records`에 열을 더해 표현할 수 없다. 지면은 기록 하나에 붙는 것이 아니라
-- **여러 기록을 고른 결과**이고, 고르지 않은 것도 그대로 남아야 하기 때문이다.
-- 기록에 `in_diary` 같은 플래그를 두면 지면이 기록의 속성이 되어, 같은 달의 지면을
-- 두 번 만들 수 없고 무엇을 뺐는지도 남지 않는다.
--
-- ## 왜 처음부터 봉투만 받는가
--
-- §5.5: "남는 것은 **어디에 붙였는가**이며 그것은 사용자 콘텐츠이므로 CSK 도메인이다."
--
-- 무엇을 골랐는가는 그 자체로 사용자가 한 말이다. 8월에 스무 날을 남겼는데 지면에
-- 셋만 넣었다면, 그 셋이 무엇인지는 그 커플이 그 달을 어떻게 기억하기로 했는지를
-- 말한다. 기록 id 배열을 평문 열에 두면 서버가 그것을 읽게 된다.
--
-- `daily_records`는 평문 시절을 지나왔기 때문에 `cipher_format = 0` 경로를 아직 갖고
-- 있다. **이 테이블에는 그 경로가 없다.** `content_envelope`가 `NOT NULL`이므로 평문
-- 지면은 표현될 수 없고, 그래서 나중에 write floor로 막을 필요도 없다 -- 막을 문이
-- 애초에 없다.
--
-- ## 왜 커플 도메인 하나뿐인가
--
-- 지면의 단위는 「우리의 한 달」이다(`BUSINESS_MEMORY_ROADMAP_V1` §9.2). 개인 도메인을
-- 함께 허용하면 같은 달에 두 사람이 서로 못 보는 지면을 따로 갖게 되고, 그것은 다른
-- 제품이다. 필요해지면 forward fix로 열되, 지금 열어 두고 안 쓰는 것보다 낫다 --
-- 열려 있는 값은 언젠가 누가 쓴다.
--
-- 검증: `docs/skills/migration-gate.md` §3. 운영 적용 여부는
-- `supabase/migrations/README.md`가 소유하며, 이 파일이 저장소에 있다는 사실은
-- 배포의 증거가 아니다.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.diary_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- `YYYY-MM`. 지면의 단위가 한 달이라는 사실이 열의 모양에 있어야 한다 --
  -- 자유 문자열이면 `2026-8`과 `2026-08`이 서로 다른 지면이 된다.
  month_key TEXT NOT NULL CHECK (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

  -- 고른 것과 배치. 봉투 안이라 서버는 읽지 못한다.
  content_envelope BYTEA NOT NULL
    CHECK (octet_length(content_envelope) >= 108),

  -- 봉투를 연 열쇠. `daily_records`와 같은 어휘를 쓴다.
  key_domain TEXT NOT NULL CHECK (key_domain = 'couple'),
  key_epoch BIGINT NOT NULL CHECK (key_epoch >= 1),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 한 커플의 한 달에 지면은 하나다. 둘이 각자 만들면 어느 쪽이 「우리의 한 달」인지
  -- 아무도 답할 수 없고, 상품이 되는 순간 그 질문에 답해야 한다.
  UNIQUE (couple_id, month_key)
);

COMMENT ON TABLE public.diary_pages IS
  '일기장 지면. 사용자가 고른 기록과 배치가 CSK 봉투 안에 있다. 평문 경로 없음.';
COMMENT ON COLUMN public.diary_pages.content_envelope IS
  'GLE1 봉투. 무엇을 골랐는가는 그 자체로 사용자 콘텐츠다 (PRODUCT_V3 §5.5).';

CREATE INDEX IF NOT EXISTS idx_diary_pages_couple_month
  ON public.diary_pages (couple_id, month_key DESC);

-- -------------------------------------------------------------
-- 1. 봉투 검증
-- -------------------------------------------------------------
-- `daily_records`의 검증과 같은 것을 본다. 함수를 공유하지 않는 이유는 그쪽이
-- `cipher_format = 0` 평문 경로를 먼저 처리하는데 이 테이블에는 그 경로가 없기
-- 때문이다 -- 공유하면 이 테이블에 존재하지도 않는 열을 참조하게 된다.
CREATE OR REPLACE FUNCTION public.enforce_diary_page_envelope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_header_domain SMALLINT;
  v_header_epoch BIGINT;
BEGIN
  -- `GLE1`. 봉투가 아닌 바이트열을 넣어 두고 나중에 복호화 실패로 발견하게 두지 않는다.
  IF substr(NEW.content_envelope, 1, 4) <> '\x474c4531'::BYTEA THEN
    RAISE EXCEPTION 'E2EE_ENVELOPE_MAGIC: diary page envelope is not a GLE1 envelope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF get_byte(NEW.content_envelope, 4) <> 1 THEN
    RAISE EXCEPTION 'E2EE_ENVELOPE_FORMAT: unsupported GLE1 format version %',
      get_byte(NEW.content_envelope, 4)
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- `src/crypto/domains.ts`의 wire 값: personal 1, health 2, couple 3.
  -- health를 여기서 거절하는 것이 요점이다. HRK가 CSK 자리에 서는 대체가 이 테이블에
  -- **표현될 수 없어야** 한다 (architecture V2.1 §2).
  v_header_domain := get_byte(NEW.content_envelope, 7);
  IF v_header_domain <> 3 THEN
    RAISE EXCEPTION 'E2EE_ENVELOPE_DOMAIN_MISMATCH: diary pages accept only the couple domain, header said %',
      v_header_domain
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- offset 12의 big-endian u64. 2^63을 넘는 epoch가 BIGINT 산술 중간에 넘치지 않도록
  -- NUMERIC으로 읽고 마지막에 캐스팅한다.
  v_header_epoch := (
      get_byte(NEW.content_envelope, 12)::NUMERIC * 72057594037927936
    + get_byte(NEW.content_envelope, 13)::NUMERIC * 281474976710656
    + get_byte(NEW.content_envelope, 14)::NUMERIC * 1099511627776
    + get_byte(NEW.content_envelope, 15)::NUMERIC * 4294967296
    + get_byte(NEW.content_envelope, 16)::NUMERIC * 16777216
    + get_byte(NEW.content_envelope, 17)::NUMERIC * 65536
    + get_byte(NEW.content_envelope, 18)::NUMERIC * 256
    + get_byte(NEW.content_envelope, 19)::NUMERIC
  )::BIGINT;

  IF v_header_epoch <> NEW.key_epoch THEN
    RAISE EXCEPTION 'E2EE_ENVELOPE_EPOCH_MISMATCH: envelope header epoch % contradicts key_epoch %',
      v_header_epoch, NEW.key_epoch
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 쓰는 사람은 인자가 아니라 **세션**이 정한다. `created_by`를 믿으면 남의 이름으로
  -- 지면을 만들 수 있다.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'E2EE_ACTOR_REQUIRED: a diary page needs an authenticated author'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
  ELSE
    -- 만든 사람은 바뀌지 않는다. 상대가 고쳐도 처음 만든 사람이 만든 사람이다.
    NEW.created_by := OLD.created_by;
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_diary_pages_envelope ON public.diary_pages;
CREATE TRIGGER trg_diary_pages_envelope
  BEFORE INSERT OR UPDATE ON public.diary_pages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_diary_page_envelope();

-- -------------------------------------------------------------
-- 2. RLS — 살아 있는 커플 구성원만
-- -------------------------------------------------------------
ALTER TABLE public.diary_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diary_pages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS diary_pages_select ON public.diary_pages;
CREATE POLICY diary_pages_select ON public.diary_pages
  FOR SELECT TO authenticated
  -- `get_my_active_couple_id()`가 **활성** 멤버십만 돌려주므로, 연결이 해제된 이전
  -- 파트너는 자기가 함께 만든 지면도 더 이상 읽지 못한다. 이것이 이 앱이 unlink에
  -- 대해 이미 정한 규칙이고, 지면만 예외를 두지 않는다.
  USING (couple_id = public.get_my_active_couple_id());

DROP POLICY IF EXISTS diary_pages_insert ON public.diary_pages;
CREATE POLICY diary_pages_insert ON public.diary_pages
  FOR INSERT TO authenticated
  WITH CHECK (couple_id = public.get_my_active_couple_id());

DROP POLICY IF EXISTS diary_pages_update ON public.diary_pages;
CREATE POLICY diary_pages_update ON public.diary_pages
  FOR UPDATE TO authenticated
  USING (couple_id = public.get_my_active_couple_id())
  WITH CHECK (couple_id = public.get_my_active_couple_id());

DROP POLICY IF EXISTS diary_pages_delete ON public.diary_pages;
CREATE POLICY diary_pages_delete ON public.diary_pages
  FOR DELETE TO authenticated
  USING (couple_id = public.get_my_active_couple_id());

-- -------------------------------------------------------------
-- 3. 권한
-- -------------------------------------------------------------
REVOKE ALL ON TABLE public.diary_pages FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.diary_pages TO authenticated;

REVOKE ALL ON FUNCTION public.enforce_diary_page_envelope() FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';

COMMIT;
