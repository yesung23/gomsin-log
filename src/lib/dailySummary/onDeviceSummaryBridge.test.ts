import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ON_DEVICE_SUMMARY_BATCH_SIZE,
  MAX_DAILY_SUMMARY_LINE_CHARS,
} from '@/lib/dailySummary/contract';
import { ON_DEVICE_SUMMARY_PLUGIN_NAME } from '@/lib/dailySummary/nativeOnDeviceSummary';

/**
 * 브리지 양쪽이 같은 계약을 말하는지 **소스에서** 확인한다.
 *
 * jsName과 `@objc` 선택자, `pluginMethods` 목록이 어긋나면 실패는 오직 실기기 런타임에서만
 * 나타난다. 이 저장소가 가장 느리게 반복할 수 있는 자리다. 그래서 `nativeDeviceKeysBridge.test.ts`가
 * 하는 것과 같은 방식으로 세 목록을 소스에서 뽑아 비교한다.
 *
 * ## 이 테스트가 증명하지 않는 것
 *
 * 모델이 동작한다는 것. 여기서 확인하는 것은 문자열과 구조뿐이고, Foundation Models의 실제
 * 동작은 Apple Intelligence 지원 실기기에서만 확인할 수 있다. **UNVERIFIED**로 남는다.
 */

const repoRoot = resolve(process.cwd());
const PACKAGE_DIR = 'packages/capacitor-on-device-summary';

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

const manifest = JSON.parse(read(`${PACKAGE_DIR}/package.json`)) as {
  name: string;
  private?: boolean;
  files?: string[];
  capacitor?: Record<string, unknown>;
};
const podspec = read(`${PACKAGE_DIR}/GomsinlogCapacitorOnDeviceSummary.podspec`);
const jsPlugin = read(`${PACKAGE_DIR}/src/index.ts`);
const definitions = read(`${PACKAGE_DIR}/src/definitions.ts`);
const swiftBridge = read(`${PACKAGE_DIR}/ios/Sources/OnDeviceSummaryPlugin/OnDeviceSummaryPlugin.swift`);
const swiftEngine = read(`${PACKAGE_DIR}/ios/Sources/OnDeviceSummaryPlugin/OnDeviceSummary.swift`);

/**
 * 코드만 남긴 Swift.
 *
 * 이 파일들은 **무엇이 의도적으로 없는지**를 이름을 불러 가며 설명한다("no transcript is
 * rehydrated", "no attachment reference"). 그래서 원문에 대고 부재를 주장하면 실제 선언이
 * 아니라 그 설명에서 실패한다. `nativeConfig.test.ts`가 XML 주석에 대해 하는 것과 같은
 * 이유로, 부재는 코드에 대해서만 확인한다.
 */
function withoutSwiftComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

const bridgeCode = withoutSwiftComments(swiftBridge);
const engineCode = withoutSwiftComments(swiftEngine);
const swiftCode = `${bridgeCode}\n${engineCode}`;
const rootPackage = JSON.parse(read('package.json')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const iosPodfile = read('ios/App/Podfile');
const podfileLock = read('ios/App/Podfile.lock');

describe('패키징: iOS 전용 로컬 플러그인 하나', () => {
  it('루트 package.json이 로컬 경로로만 참조한다', () => {
    expect(rootPackage.dependencies['@gomsinlog/capacitor-on-device-summary'])
      .toBe('file:packages/capacitor-on-device-summary');
    expect(rootPackage.devDependencies['@gomsinlog/capacitor-on-device-summary']).toBeUndefined();
    expect(manifest.private).toBe(true);
  });

  it('capacitor 필드에 ios만 있다 -- Android 구현이 없다', () => {
    expect(manifest.capacitor).toEqual({ ios: { src: 'ios' } });
    // `cap sync android`가 이 패키지를 보지 못하게 하는 것이 이 한 줄이다.
    expect(manifest.capacitor).not.toHaveProperty('android');
    expect(existsSync(join(repoRoot, `${PACKAGE_DIR}/android`))).toBe(false);
  });

  it('Android 프로젝트에 등록되지 않았다', () => {
    const androidSettings = read('android/capacitor.settings.gradle');
    const androidBuild = read('android/app/capacitor.build.gradle');
    expect(androidSettings).not.toContain('capacitor-on-device-summary');
    expect(androidBuild).not.toContain('capacitor-on-device-summary');
  });

  it('podspec 이름과 Podfile·Podfile.lock이 일치한다', () => {
    expect(podspec).toMatch(/s\.name\s*=\s*'GomsinlogCapacitorOnDeviceSummary'/);
    expect(iosPodfile).toMatch(
      /pod 'GomsinlogCapacitorOnDeviceSummary', :path => '\.\.\/\.\.\/packages\/capacitor-on-device-summary'/,
    );
    expect(podfileLock).toContain('GomsinlogCapacitorOnDeviceSummary:');
    expect(manifest.files).toContain('GomsinlogCapacitorOnDeviceSummary.podspec');
  });

  it('Podfile과 on-device-summary podspec이 15.0으로 정렬되었고 FoundationModels는 canImport/@available iOS26 runtime gate다', () => {
    // Xcode 27 경고 remediation에 따라 배포 대상 floor는 iOS 15.0으로 정렬되었고 FoundationModels는 canImport/@available iOS26 runtime gate 계약을 따른다.
    expect(podspec).toMatch(/s\.ios\.deployment_target\s*=\s*'15\.0'/);
    expect(iosPodfile).toMatch(/platform :ios, '15\.0'/);
    expect(swiftEngine).toContain('#if canImport(FoundationModels)');
    expect(swiftEngine).toMatch(/@available\(iOS 26\.0, \*\)/);
  });
});

describe('브리지 이름이 세 곳에서 같다', () => {
  it('TypeScript registerPlugin · Swift jsName · 어댑터 상수', () => {
    expect(ON_DEVICE_SUMMARY_PLUGIN_NAME).toBe('GomsinlogOnDeviceSummary');
    expect(jsPlugin).toMatch(
      /registerPlugin<OnDeviceSummaryPlugin>\(\s*'GomsinlogOnDeviceSummary',?\s*\)/,
    );
    expect(swiftBridge).toMatch(/public let jsName = "GomsinlogOnDeviceSummary"/);
    expect(swiftBridge).toMatch(/@objc\(GomsinlogOnDeviceSummaryPlugin\)/);
  });

  it('pluginMethods · @objc 선택자 · TypeScript 인터페이스가 같은 세 메서드다', () => {
    const expected = ['availability', 'refineLines', 'cancel'];

    const declared = [...swiftBridge.matchAll(/CAPPluginMethod\(name: "([a-zA-Z]+)"/g)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...expected].sort());

    const selectors = [...swiftBridge.matchAll(/@objc func ([a-zA-Z]+)\(_ call: CAPPluginCall\)/g)]
      .map((m) => m[1]);
    expect(selectors.sort()).toEqual([...expected].sort());

    for (const method of expected) expect(definitions).toContain(`${method}(options`);
  });

  it('메서드가 셋뿐이다 -- 늘리는 것은 계약 변경이다', () => {
    expect([...swiftBridge.matchAll(/CAPPluginMethod\(/g)]).toHaveLength(3);
  });
});

describe('Swift 소스가 계약을 어길 수 없는 모양이다', () => {
  it('native 입력은 120, 생성된 excerpt는 40 UTF-16 단위로 각각 검증한다', () => {
    expect(swiftEngine).toContain('maxSourceCharacters = 120');
    expect(swiftEngine).toContain('maxExcerptCharacters = 40');
    expect(swiftBridge).toContain('maxSourceCharacters');
    expect(swiftEngine).toContain('maxExcerptCharacters');
  });

  it('native bridge도 각 item의 key를 index와 text 두 개로 고정한다', () => {
    expect(swiftBridge).toContain('Set(entry.keys) == Set(["index", "text"])');
    expect(swiftBridge).toContain('items entry must contain only index and text');
  });

  it('fractional number나 JSON boolean을 ordinal index로 축소 변환하지 않는다', () => {
    expect(swiftBridge).toContain('CFGetTypeID(indexNumber) != CFBooleanGetTypeID()');
    expect(swiftBridge).toContain('indexNumber.doubleValue == Double(parsed.count)');
    expect(swiftBridge).not.toContain('.intValue');
  });

  it('prompt와 Guide가 exact contiguous source excerpt를 요구하고 rewriting/inference를 금지한다', () => {
    expect(swiftEngine).toContain('정확한 원문 연속 부분 문자열');
    expect(swiftEngine).toContain('원문을 다시 쓰거나 추론하지 않는다');
    expect(swiftEngine).toContain('문맥을 덧붙이지 않는다');
    expect(swiftEngine).toContain('8~38 UTF-16 단위');
    expect(swiftEngine).toContain('단어, 이모지, 결합문자의 중간');
  });

  it('FoundationModels를 canImport와 @available로만 만진다', () => {
    expect(swiftEngine).toContain('#if canImport(FoundationModels)');
    expect(swiftEngine).toMatch(/@available\(iOS 26\.0, \*\)/);
    /*
      모든 `import FoundationModels`가 canImport 게이트 뒤에 있어야 한다. 게이트 밖의 import는
      프레임워크 없는 SDK에서 컴파일을 깨뜨리고, 그것은 iOS 15 배포 대상을 유지한다는 계약을
      깨는 것과 같다.
    */
    const guardAt = engineCode.indexOf('#if canImport(FoundationModels)');
    expect(guardAt).toBeGreaterThan(-1);
    const importPositions = [...engineCode.matchAll(/^\s*import FoundationModels\s*$/gm)]
      .map((match) => match.index ?? -1);
    expect(importPositions.length).toBeGreaterThan(0);
    for (const position of importPositions) expect(position).toBeGreaterThan(guardAt);
    // 브리지 쪽은 프레임워크를 아예 만지지 않는다.
    expect(bridgeCode).not.toContain('FoundationModels');
  });

  it('SystemLanguageModel.availability의 세 원인과 로케일을 각각 구분한다', () => {
    expect(swiftEngine).toContain('SystemLanguageModel.default');
    expect(swiftEngine).toMatch(/switch model\.availability/);
    expect(swiftEngine).toContain('case .deviceNotEligible');
    expect(swiftEngine).toContain('case .appleIntelligenceNotEnabled');
    expect(swiftEngine).toContain('case .modelNotReady');
    expect(swiftEngine).toContain('device_not_eligible');
    expect(swiftEngine).toContain('apple_intelligence_disabled');
    expect(swiftEngine).toContain('model_not_ready');
    expect(swiftEngine).not.toMatch(/model\.isAvailable/);
    expect(swiftEngine).toMatch(/model\.supportsLocale\(Locale\(identifier: localeIdentifier\)\)/);
    expect(swiftEngine).toContain('"ko_KR"');
  });

  it('native generation은 40 UTF-16 단위를 넘는 긴 문장 1~5개만 받는다', () => {
    expect(swiftEngine).toContain('items.count <= maxLines');
    expect(swiftEngine).toContain('$0.text.utf16.count > maxExcerptCharacters');
  });

  it('요청마다 새 세션을 만들고 도구를 주지 않는다', () => {
    expect(engineCode).toMatch(/LanguageModelSession\(model: SystemLanguageModel\.default, tools: \[\]\)/);
    // 세션을 재사용하지 않으므로 저장할 세션도 없다.
    expect(engineCode).not.toMatch(/(?:var|let)\s+\w*[sS]ession\w*\s*:/);
    // transcript를 되살리거나 읽거나 직렬화하지 않는다.
    expect(engineCode).not.toContain('transcript');
    // Apple에 피드백을 제출하지 않는다.
    expect(swiftCode).not.toContain('logFeedbackAttachment');
    expect(swiftCode).not.toContain('LanguageModelFeedback');
  });

  it('guided output · greedy · 응답 토큰 상한을 쓴다', () => {
    expect(swiftEngine).toContain('@Generable');
    expect(swiftEngine).toMatch(/generating: RefinedSummaryLines\.self/);
    expect(swiftEngine).toMatch(/sampling: \.greedy/);
    expect(swiftEngine).toMatch(/maximumResponseTokens: OnDeviceSummary\.maximumResponseTokens/);
  });

  it('native에서도 count · index order · empty text · 40자 상한을 즉시 거부한다', () => {
    expect(swiftEngine).toContain('guard produced.count == items.count');
    expect(swiftEngine).toContain('guard line.index == items[position].index');
    expect(swiftEngine).toContain('trimmingCharacters(in: .whitespacesAndNewlines)');
    expect(swiftEngine).toContain('line.text.utf16.count <= OnDeviceSummary.maxExcerptCharacters');
  });

  it('취소를 requestId 단위로 다루고 single-flight를 유지한다', () => {
    expect(swiftEngine).toContain('actor OnDeviceSummaryEngine');
    expect(swiftEngine).toMatch(/func cancel\(requestId: String\)/);
    expect(swiftEngine).toMatch(/(?:guard|if) let current = inFlight, current\.requestId == requestId/);
    expect(swiftEngine).toMatch(/Task\.checkCancellation\(\)/);
    expect(swiftBridge).toMatch(/OnDeviceSummaryEngine\.shared\.cancel\(requestId: requestId\)/);
  });

  it('actor 등록 전 취소를 bounded exact requestId로 기억하고 시작 전에 소비한다', () => {
    expect(swiftEngine).toContain('private static let maximumPendingCancellations = 32');
    expect(swiftEngine).toContain('private var cancelledBeforeStart: [String] = []');
    expect(swiftEngine).toContain('guard !cancelledBeforeStart.contains(requestId) else { return }');
    expect(swiftEngine).toContain('cancelledBeforeStart.append(requestId)');
    expect(swiftEngine).toContain('cancelledBeforeStart.removeFirst(');
    expect(swiftEngine).toContain('cancelledBeforeStart.firstIndex(of: requestId)');
    expect(swiftEngine).toContain('throw CancellationError()');

    const refineStart = engineCode.indexOf('func refine(\n        requestId: String');
    const preCancelCheck = engineCode.indexOf(
      'if let cancelledIndex = cancelledBeforeStart.firstIndex(of: requestId)',
      refineStart,
    );
    const competingFlightCancellation = engineCode.indexOf('if let current = inFlight {', refineStart);
    const availabilityCheck = engineCode.indexOf('OnDeviceSummary.availability(', refineStart);
    const taskCreation = engineCode.indexOf('let task = Task<[OnDeviceSummaryLine], Error>', refineStart);

    expect(refineStart).toBeGreaterThanOrEqual(0);
    expect(preCancelCheck).toBeGreaterThan(refineStart);
    // A의 pending cancel은 A만 소비하고 즉시 끝나야 이미 실행 중인 B를 취소하지 않는다.
    expect(preCancelCheck).toBeLessThan(competingFlightCancellation);
    expect(preCancelCheck).toBeLessThan(availabilityCheck);
    expect(preCancelCheck).toBeLessThan(taskCreation);
  });

  it('입력·출력을 로그하지 않는다', () => {
    for (const forbidden of ['print(', 'NSLog', 'os_log', 'Logger(', 'debugPrint', 'dump(']) {
      expect(swiftCode, forbidden).not.toContain(forbidden);
    }
  });

  it('네트워크도 저장도 하지 않는다', () => {
    for (const forbidden of [
      'URLSession', 'URLRequest', 'FileManager', 'NSFileManager',
      'write(to', 'Data(contentsOf', 'NSCoding', 'PropertyListSerialization',
    ]) {
      expect(swiftCode, forbidden).not.toContain(forbidden);
    }
  });

  it('실패는 콘텐츠 없는 안정 코드로만 나간다', () => {
    const codes = [...bridgeCode.matchAll(/"(E_[A-Z_]+)"/g)].map((m) => m[1]);
    expect([...new Set(codes)].sort())
      .toEqual(['E_BAD_REQUEST', 'E_CANCELLED', 'E_ON_DEVICE_SUMMARY', 'E_UNAVAILABLE']);

    /*
      reject 인자에 문자열 보간이 없어야 한다.

      `\(...)`는 콘텐츠가 오류 메시지로 새어 나가는 유일한 문법적 경로다. 단어를 금지하는
      것보다 이쪽이 정확하다 -- "items must be an array"는 `items`라는 단어를 담지만 사용자
      콘텐츠는 담지 않는다.
    */
    const rejects = [...bridgeCode.matchAll(/call\.reject\(([^\n]*)\)/g)].map((m) => m[1]);
    expect(rejects.length).toBeGreaterThan(0);
    for (const argument of rejects) {
      expect(argument, argument).not.toContain('\\(');
    }
    // 하나뿐인 예외: 가용성 사유는 고정된 enum rawValue다.
    const messageInterpolations = [...bridgeCode.matchAll(/return "[^"]*\\\(([^)]*)\)/g)]
      .map((m) => m[1]);
    expect(messageInterpolations).toEqual(['reason.rawValue']);
  });

  it('경계 상한이 TypeScript 상한과 같은 숫자다', () => {
    expect(swiftEngine).toContain(`static let maxLines = ${ON_DEVICE_SUMMARY_BATCH_SIZE}`);
    expect(swiftEngine).toContain(`static let maxExcerptCharacters = ${MAX_DAILY_SUMMARY_LINE_CHARS}`);
  });

  it('payload에 식별자를 받을 자리가 없다', () => {
    // 브리지가 읽는 키는 requestId·locale·items·index·text뿐이다.
    const readKeys = [...bridgeCode.matchAll(/(?:call\.getString|call\.getArray)\("([a-zA-Z]+)"\)/g)]
      .map((m) => m[1]);
    expect([...new Set(readKeys)].sort()).toEqual(['items', 'locale', 'requestId']);
    const entryKeys = [...bridgeCode.matchAll(/entry\["([a-zA-Z]+)"\]/g)].map((m) => m[1]);
    expect([...new Set(entryKeys)].sort()).toEqual(['index', 'text']);
    for (const forbidden of ['recordId', 'userId', 'coupleId', 'attachment', 'emotion', 'cycle']) {
      expect(swiftCode, forbidden).not.toContain(forbidden);
    }
  });
});

describe('감정·건강 추론을 지시문에서 명시적으로 금지한다', () => {
  it('지시문이 감정·건강·주기·관계 판단을 금지한다', () => {
    for (const forbidden of ['감정', '건강', '통증', '생리주기', '관계 상태']) {
      expect(swiftEngine, forbidden).toContain(forbidden);
    }
    expect(swiftEngine).toContain('추론하거나 평가하지 않는다');
    expect(swiftEngine).toContain('무엇이 더 중요한지 판단하지 않는다');
    expect(swiftEngine).toContain('추가·삭제·재배열하지 않는다');
  });

  it('그러나 지시문에 의존하지 않는다 -- JS 검증이 별도로 존재한다', () => {
    const verifier = read('src/lib/dailySummary/verify.ts');
    for (const rejection of ['count_mismatch', 'reordered', 'index_out_of_range', 'duplicate_index', 'text_too_long']) {
      expect(verifier, rejection).toContain(rejection);
    }
  });
});
