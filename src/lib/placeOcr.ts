export interface ExtractedPlace {
  title: string;
  address: string;
  businessHours: string;
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

const UI_NOISE = /^(네이버\s*지도|네이버|지도|저장\s*공유|저장|공유|출발|도착|거리뷰|리뷰|사진|메뉴|홈|검색|길찾기)$/;
const ADDRESS_HINT = /(특별시|광역시|특별자치|[가-힣]+[도시군구읍면동])\s|([가-힣0-9]+(로|길)\s*\d)/;
const HOURS_HINT = /(영업|운영|매일|휴무|라스트\s*오더|브레이크|\d{1,2}:\d{2}\s*[~-]\s*\d{1,2}:\d{2})/i;

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
  if (/(음식점|식당|맛집|카페|커피|베이커리|디저트|브런치|레스토랑|메뉴|restaurant|cafe|bakery)/.test(normalized)) {
    return 'food';
  }
  return 'activity';
}

export function extractPlaceFromOcr(text: string): ExtractedPlace {
  const lines = text.split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 2 && !UI_NOISE.test(line));
  const address = lines.find((line) => ADDRESS_HINT.test(line)) || '';
  const hours = lines.filter((line) => HOURS_HINT.test(line)).slice(0, 3).join('\n');
  const title = lines.find((line) => (
    line !== address
    && !HOURS_HINT.test(line)
    && !/^\d+(\.\d+)?\s*(km|m|분)$/.test(line)
    && line.length <= 60
  )) || '';
  return { title, address, businessHours: hours, rawText: text.trim() };
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
