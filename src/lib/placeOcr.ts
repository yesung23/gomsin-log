export interface ExtractedPlace {
  title: string;
  address: string;
  businessHours: string;
  rawText: string;
}

const UI_NOISE = /^(네이버\s*지도|네이버|지도|저장\s*공유|저장|공유|출발|도착|거리뷰|리뷰|사진|메뉴|홈|검색|길찾기)$/;
const ADDRESS_HINT = /(특별시|광역시|특별자치|[가-힣]+[도시군구읍면동])\s|([가-힣0-9]+(로|길)\s*\d)/;
const HOURS_HINT = /(영업|운영|매일|휴무|라스트\s*오더|브레이크|\d{1,2}:\d{2}\s*[~-]\s*\d{1,2}:\d{2})/i;

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
  const worker = await createWorker('kor', OEM.LSTM_ONLY, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/tesseract-core-lstm.wasm.js',
    langPath: '/ocr',
    workerBlobURL: false,
    logger: (message) => {
      if (message.status === 'recognizing text') onProgress?.(message.progress);
    },
  });
  try {
    const result = await worker.recognize(image);
    return extractPlaceFromOcr(result.data.text);
  } finally {
    await worker.terminate();
  }
}
