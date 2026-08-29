export interface ExtractedPlace {
  title: string;
  address: string;
  businessHours: string;
  /**
   * The place panel's own category words (`카페,디저트`, `국수`, `치킨,닭강정`).
   * Empty when the panel was not found.
   */
  categoryHint: string;
  /**
   * Derived from `categoryHint` when the panel was found, and from the whole
   * capture only as a last resort. Reading the whole capture is what made a
   * neighbouring `게스트하우스` map label classify a noodle shop as lodging.
   */
  category: InferredPlaceCategory;
  rawText: string;
}

export type InferredPlaceCategory = 'activity' | 'food' | 'lodging' | 'transport';

const OCR_TIMEOUT_MS = 45_000;

function progressForStatus(status: string, progress: number): number | null {
  switch (status) {
    case 'loading tesseract core': return 0.05 + progress * 0.15;
    case 'loading language traineddata': return 0.2 + progress * 0.2;
    case 'initializing tesseract': return 0.4 + progress * 0.15;
    case 'recognizing text': return 0.55 + progress * 0.45;
    default: return null;
  }
}

async function rejectAfter<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('사진 인식 시간이 초과됐어요.')), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const UI_NOISE = /^(네이버\s*지도|네이버|지도|저장\s*공유|저장|공유|출발|도착|거리뷰|리뷰|사진|메뉴|홈|검색|길찾기|전화|주문|배달|줄서기|테이블링|알림받기|쿠폰|길찾기)$/;
const ADDRESS_HINT = /(특별시|광역시|특별자치|[가-힣]+[도시군구읍면동])\s|([가-힣0-9]+(로|길)\s*\d)/;
const HOURS_HINT = /(영업|운영|매일|휴무|라스트\s*오더|라스트오더|브레이크|\d{1,2}:\d{2}\s*[~-]\s*\d{1,2}:\d{2})/i;

/**
 * Naver's action row recognises as one mangled line rather than one word per
 * line -- `출발   목공유  % 전화 (> 알림받기` and `출발 때주문. 배달 . [옥공유` are
 * verbatim tesseract output from the committed fixtures. An anchored
 * single-word `UI_NOISE` test can never match those, so a line carrying two or
 * more of these controls is dropped as chrome. Every token below appears in a
 * fixture; `place+` is deliberately absent because OCR never produced it.
 */
const ACTION_TOKENS = ['출발', '도착', '공유', '전화', '알림받기', '줄서기', '테이블링', '주문', '배달', '길찾기', '저장'];
/** Certification/promotion rows that sit between the panel and the buttons. */
const BADGE_NOISE = /(식약처\s*지정|식품안심업소|현장대기\s*준비중|줄서는식당|맛있는녀석들)/;

/**
 * The place panel's summary line: category words, an optional rating, then a
 * review count. It is the one structurally reliable landmark in a real capture,
 * and the place name is the line directly above it.
 */
const PANEL_ANCHOR = /리뷰\s*[\d,]{1,9}\s*만?/;
const REGION_ONLY = /(?:^|[\sㆍ·])((?:서울|부산|대구|인천|광주|대전|울산|세종|제주|경기|강원|충북|충남|전북|전남|경북|경남)(?:특별시|광역시|특별자치시|특별자치도|도)?\s+[가-힣]{1,8}(?:시|군|구))(?![가-힣])/;
const STREET_HINT = /[가-힣0-9]+(로|길)\s*\d/;

function isActionRow(line: string): boolean {
  return ACTION_TOKENS.filter((token) => line.includes(token)).length >= 2;
}

/**
 * Trim the icons Naver draws beside the place name.
 *
 * Measured, not guessed: the fixture title rows are `도토리가든 안국점 픈`,
 * `신라제면 안국점 6             . ×` and `8680치킨 신길대방점              으 ×`.
 * The share/close glyph marks the end of the name, and what trails it is a
 * one-character or digits-only misread of an icon. A leading run of digits
 * fused to Hangul is the brand logo (`8680치킨` is the BBQ mark) -- no Korean
 * place name starts that way, and dropping it keeps the branch name the user
 * needs in order to recognise the row.
 */
function cleanTitle(line: string): string {
  const beforeIcon = line.split(/[×✕✖]/)[0];
  const tokens = beforeIcon.split(/\s+/).filter(Boolean);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (/^[\d.,]+$/.test(last) || /^[^가-힣a-zA-Z0-9]+$/.test(last) || last.length === 1) {
      tokens.pop();
      continue;
    }
    break;
  }
  return tokens.join(' ').replace(/^\d{2,}(?=[가-힣])/, '').trim();
}

/** `9.71<ㅁㆍ 서울 종로구 ㅠ` carries a region; a full street line carries more. */
function cleanAddress(line: string): string {
  if (STREET_HINT.test(line)) return line.trim();
  const region = REGION_ONLY.exec(line);
  return region ? region[1].replace(/\s+/g, ' ').trim() : '';
}

/** Naver's `·` separator recognises as the Hangul letter araea. */
function normalizeSeparators(line: string): string {
  return line.replace(/\s*ㆍ\s*/g, ' · ').replace(/\s+/g, ' ').trim();
}

/**
 * Pick a useful default without pretending OCR can make a perfect decision.
 * The result is deliberately conservative: a wrong guess is harmless because
 * the newly-created itinerary row opens the ordinary editor when tapped.
 */
export function inferPlaceCategory(text: string): InferredPlaceCategory {
  const normalized = text.replace(/\s+/g, ' ').toLowerCase();
  if (/(호텔|모텔|펜션|리조트|게스트하우스|호스텔|숙박|숙소|hotel|resort|hostel)/.test(normalized)) {
    return 'lodging';
  }
  if (/(공항|버스터미널|여객터미널|기차역|지하철역|환승센터|주차장|렌터카|렌트카|ktx|srt)/.test(normalized)) {
    return 'transport';
  }
  // 국수 · 치킨 · 닭강정 come from the committed fixtures' own category rows,
  // which the previous list did not cover at all.
  if (/(음식점|식당|맛집|카페|커피|베이커리|디저트|브런치|레스토랑|메뉴|국수|치킨|닭강정|닥강정|분식|고기|초밥|파스타|피자|restaurant|cafe|bakery)/.test(normalized)) {
    return 'food';
  }
  return 'activity';
}

export function extractPlaceFromOcr(text: string): ExtractedPlace {
  const lines = text.split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 2 && !UI_NOISE.test(line) && !isActionRow(line) && !BADGE_NOISE.test(line));

  const anchor = lines.findIndex((line) => PANEL_ANCHOR.test(line));
  if (anchor > 0) {
    // Read the panel only. Everything above it is the map, which recognises as
    // noise that happens to sit earlier in the text than the place name.
    const panel = lines.slice(anchor, anchor + 6);
    const title = cleanTitle(lines[anchor - 1]);
    const categoryHint = lines[anchor].split(/[ㆍ·]/)[0].replace(/리뷰.*$/, '').trim();
    const addressLine = panel.find((line) => cleanAddress(line)) || '';
    const hours = panel.filter((line) => HOURS_HINT.test(line))
      .map(normalizeSeparators).slice(0, 3).join('\n');
    if (title) {
      return {
        title,
        address: cleanAddress(addressLine),
        businessHours: hours,
        categoryHint,
        category: inferPlaceCategory(categoryHint || text),
        rawText: text.trim(),
      };
    }
  }

  const address = lines.find((line) => ADDRESS_HINT.test(line)) || '';
  const hours = lines.filter((line) => HOURS_HINT.test(line)).slice(0, 3).join('\n');
  const title = lines.find((line) => (
    line !== address
    && !HOURS_HINT.test(line)
    && !/^\d+(\.\d+)?\s*(km|m|분)$/.test(line)
    && line.length <= 60
  )) || '';
  return {
    title,
    address,
    businessHours: hours,
    categoryHint: '',
    category: inferPlaceCategory(text),
    rawText: text.trim(),
  };
}

export async function recognizePlaceScreenshot(
  image: File,
  onProgress?: (progress: number) => void,
): Promise<ExtractedPlace> {
  const { createWorker, OEM } = await import('tesseract.js');
  onProgress?.(0.02);
  const worker = await rejectAfter(
    createWorker('kor', OEM.LSTM_ONLY, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr/tesseract-core-lstm.wasm.js',
      langPath: '/ocr',
      workerBlobURL: false,
      logger: (message) => {
        const progress = progressForStatus(message.status, message.progress);
        if (progress !== null) onProgress?.(progress);
      },
    }),
    OCR_TIMEOUT_MS,
  );
  try {
    const result = await rejectAfter(worker.recognize(image), OCR_TIMEOUT_MS);
    onProgress?.(1);
    return extractPlaceFromOcr(result.data.text);
  } finally {
    await worker.terminate();
  }
}
