import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ON_DEVICE_BRIEFING_PLUGIN_NAME } from './nativeOnDeviceBriefing';

const root = resolve(process.cwd());
const packageDir = 'packages/capacitor-on-device-briefing';
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const manifest = JSON.parse(read(`${packageDir}/package.json`)) as {
  private?: boolean;
  files?: string[];
  capacitor?: Record<string, unknown>;
};
const rootPackage = JSON.parse(read('package.json')) as {
  dependencies: Record<string, string>;
};
const podspec = read(`${packageDir}/GomsinlogCapacitorOnDeviceBriefing.podspec`);
const engine = read(`${packageDir}/ios/Sources/OnDeviceBriefingPlugin/OnDeviceBriefing.swift`);
const bridge = read(`${packageDir}/ios/Sources/OnDeviceBriefingPlugin/OnDeviceBriefingPlugin.swift`);
const adapter = read('src/lib/partnerBriefing/nativeOnDeviceBriefing.ts');
const podfile = read('ios/App/Podfile');
const architectureDoc = read('docs/PARTNER_BRIEFING_ARCHITECTURE.md');

describe('iOS Partner Briefing native package', () => {
  it('shares one private local Capacitor package with Android', () => {
    expect(rootPackage.dependencies['@gomsinlog/capacitor-on-device-briefing'])
      .toBe('file:packages/capacitor-on-device-briefing');
    expect(manifest.private).toBe(true);
    expect(manifest.capacitor).toEqual({
      ios: { src: 'ios' },
      android: { src: 'android' },
    });
    expect(existsSync(join(root, `${packageDir}/android`))).toBe(true);
    expect(manifest.files).toContain('ios/');
    expect(manifest.files).toContain('android/');
    expect(manifest.files).toContain('GomsinlogCapacitorOnDeviceBriefing.podspec');
  });

  it('keeps the Pod name/path and iOS 15 floor aligned', () => {
    expect(podspec).toMatch(/s\.name\s*=\s*'GomsinlogCapacitorOnDeviceBriefing'/);
    expect(podspec).toMatch(/s\.ios\.deployment_target\s*=\s*'15\.0'/);
    expect(podfile).toMatch(
      /pod 'GomsinlogCapacitorOnDeviceBriefing', :path => '\.\.\/\.\.\/packages\/capacitor-on-device-briefing'/,
    );
  });

  it('uses one exact bridge name and four exact methods', () => {
    expect(ON_DEVICE_BRIEFING_PLUGIN_NAME).toBe('GomsinlogOnDeviceBriefing');
    expect(adapter).toContain("'GomsinlogOnDeviceBriefing'");
    expect(bridge).toContain('public let jsName = "GomsinlogOnDeviceBriefing"');
    expect(bridge).toContain('@objc(GomsinlogOnDeviceBriefingPlugin)');
    const methods = [...bridge.matchAll(/CAPPluginMethod\(name: "([a-zA-Z]+)"/g)]
      .map((match) => match[1]).sort();
    const selectors = [...bridge.matchAll(/@objc func ([a-zA-Z]+)\(_ call: CAPPluginCall\)/g)]
      .map((match) => match[1]).sort();
    expect(methods).toEqual(['availability', 'cancel', 'capability', 'selectExtracts']);
    expect(selectors).toEqual(methods);
  });

  it('pins the portable envelope and closed ordinal output', () => {
    for (const [name, value] of [
      ['maxContextUtf8Bytes', 4096],
      ['responseReserveUtf8Bytes', 512],
      ['maxInputTextGraphemes', 1000],
    ] as const) {
      expect(engine).toContain(`static let ${name} = ${value}`);
      expect(bridge).toContain(`"${name}": OnDeviceBriefing.${name}`);
    }
    // promptOverheadUtf8Bytes is no longer a literal -- it is derived from the prompt
    // strings themselves -- but it still has to reach the bridge like the rest.
    expect(bridge).toContain(
      '"promptOverheadUtf8Bytes": OnDeviceBriefing.promptOverheadUtf8Bytes',
    );
    expect(engine).toContain('var groupOrdinal: Int');
    expect(engine).toContain('var itemOrdinal: Int');
    expect(engine).toContain('var candidateOrdinal: Int');
    expect(engine).toContain('var groups: [GeneratedBriefingGroup]');
    expect(engine).toContain('var choices: [GeneratedBriefingChoice]');
    expect(engine).not.toMatch(/struct GeneratedBriefing\w+\s*\{[^}]*(?:String|var text\b|recordId|userId)/);
  });

  /*
    The advertised prompt overhead must cover the prompt that is actually sent.

    `promptOverheadUtf8Bytes` was the literal 256 while the real static prompt measured
    295 bytes: 283 for the instructions (which contain a 3-byte en dash) plus 12 for the
    "Items JSON:" prefix and its newline. The JS batcher subtracts the advertised figure
    from maxContextUtf8Bytes to decide how much payload fits, so under-declaring it by 39
    bytes let the batcher build a request larger than the device had room for.

    This measures the real strings out of the Swift source. It is deliberately an
    INEQUALITY, because the Swift value rounds up to a 64-byte boundary: the advertised
    budget may be conservative, never optimistic.
  */
  describe('iOS prompt overhead covers the real static prompt', () => {
    /** The instructions literal, dedented the way Swift dedents a multi-line string. */
    function swiftInstructions(): string {
      const match = engine.match(
        /static let instructions = """\n([\s\S]*?)\n([ \t]*)"""/,
      );
      expect(match).not.toBeNull();
      const body = match![1];
      const closingIndent = match![2];
      return body
        .split('\n')
        .map((line) =>
          line.startsWith(closingIndent) ? line.slice(closingIndent.length) : line,
        )
        .join('\n');
    }

    /** The `promptItemsPrefix` literal, with its escape sequences resolved. */
    function swiftPromptPrefix(): string {
      const match = engine.match(/static let promptItemsPrefix = "([^"]*)"/);
      expect(match).not.toBeNull();
      return match![1].replace(/\\n/g, '\n').replace(/\\t/g, '\t');
    }

    const utf8 = (text: string) => new TextEncoder().encode(text).length;

    it('builds the prompt from the same two constants it budgets for', () => {
      // One source of truth: the prompt builder must use the prefix constant rather than
      // repeat the literal, or the budget below would measure a string nobody sends.
      expect(engine).toContain('promptItemsPrefix + itemsJSON');
      expect(engine).not.toContain('"Items JSON:\\n\\(itemsJSON)"');

      // And the advertised number is computed from those constants, not typed in.
      expect(engine).toContain(
        'let staticPromptBytes = instructions.utf8.count + promptItemsPrefix.utf8.count',
      );
      expect(engine).not.toMatch(/static let promptOverheadUtf8Bytes = \d+/);
    });

    it('advertises at least the real static prompt size', () => {
      const instructionsBytes = utf8(swiftInstructions());
      const prefixBytes = utf8(swiftPromptPrefix());
      const staticPromptBytes = instructionsBytes + prefixBytes;

      // Non-vacuous: the measurement really found both strings.
      expect(instructionsBytes).toBeGreaterThan(100);
      expect(prefixBytes).toBe(utf8('Items JSON:\n'));

      // Mirror of the Swift rounding, then the inequality that matters.
      const granularity = 64;
      const advertised = Math.ceil(staticPromptBytes / granularity) * granularity;

      expect(staticPromptBytes).toBeLessThanOrEqual(advertised);
      // The old literal is now provably too small, which is the whole point.
      expect(staticPromptBytes).toBeGreaterThan(256);
      // Pinned so a prompt edit that changes the bucket is visible in review.
      expect(advertised).toBe(320);

      // The envelope still leaves real room for payload.
      expect(advertised + 512).toBeLessThan(4096);
    });
  });

  it('emits version 2 grouping plan with no text or IDs across generated schemas and bridge output', () => {
    expect(engine).toContain('struct GeneratedBriefingChoice');
    expect(engine).toContain('struct GeneratedBriefingGroup');
    expect(engine).toContain('struct GeneratedBriefingPlan');
    expect(engine).not.toMatch(/struct GeneratedBriefing\w+[\s\S]*?var \w+:\s*String/);
    expect(engine).not.toMatch(/struct GeneratedBriefing\w+\s*\{[^}]*\b(?:text|recordId|userId|sourceRecordId)\b/);

    expect(bridge).toContain('"version": 2');
    expect(bridge).toContain('"groups":');
    expect(bridge).toContain('"groupOrdinal": group.groupOrdinal');
    expect(bridge).toContain('"choices": group.choices.map');
    expect(bridge).not.toContain('"version": 1');
  });

  it('runtime-gates Foundation Models and uses a fresh structured session', () => {
    expect(engine).toContain('#if canImport(FoundationModels)');
    expect(engine).toMatch(/@available\(iOS 26\.0, \*\)/);
    expect(engine).toContain('model.supportsLocale(Locale(identifier: localeIdentifier))');
    expect(engine).toContain('LanguageModelSession(model: SystemLanguageModel.default, tools: [])');
    expect(engine).toContain('generating: GeneratedBriefingPlan.self');
    expect(engine).toContain('sampling: .greedy');
    expect(engine).toContain('Task.checkCancellation()');
    expect(engine).toContain('actor OnDeviceBriefingEngine');
  });

  it('remembers a bounded cancel that arrives before actor-side request registration', () => {
    expect(engine).toContain('private static let maximumPendingCancellations = 32');
    expect(engine).toContain('private var cancelledBeforeStart: [String] = []');
    expect(engine).toContain('cancelledBeforeStart.append(requestId)');
    expect(engine).toContain('cancelledBeforeStart.removeFirst(');
    expect(engine).toContain('cancelledBeforeStart.firstIndex(of: requestId)');
    expect(engine).toContain('throw CancellationError()');

    const preCancelCheck = engine.indexOf(
      'if let cancelledIndex = cancelledBeforeStart.firstIndex(of: requestId)',
    );
    const taskCreation = engine.indexOf('let task = Task<[OnDeviceBriefingGroup], Error>');
    expect(preCancelCheck).toBeGreaterThanOrEqual(0);
    expect(preCancelCheck).toBeLessThan(taskCreation);
  });

  it('has no network, persistence, content logging, feedback, or server fallback', () => {
    const native = `${engine}\n${bridge}`;
    for (const forbidden of [
      'URLSession', 'URLRequest', 'FileManager', 'UserDefaults', 'print(', 'NSLog',
      'os_log', 'Logger(', 'logFeedbackAttachment', 'LanguageModelFeedback',
    ]) {
      expect(native, forbidden).not.toContain(forbidden);
    }
  });
  it('enforces exact top-level call keys on all iOS plugin methods matching Android', () => {
    expect(bridge).toContain('requireExactKeys(call, expected: ["locale"])');
    expect(bridge).toContain('requireExactKeys(call, expected: [])');
    expect(bridge).toContain('requireExactKeys(call, expected: ["requestId", "locale", "items"])');
    expect(bridge).toContain('requireExactKeys(call, expected: ["requestId"])');
  });
  /*
    두 native가 같은 구조 한도를 광고한다.

    한도는 언제나 강제되고 있었지만 광고되지 않아 JS가 볼 수 없었다. 이제 envelope의
    일부이므로, 어느 한쪽이 값을 바꾸면 여기서 드러나야 한다.
  */
  describe('structural capacity parity across both native providers', () => {
    const androidBridge = read(
      `${packageDir}/android/src/main/java/app/gomsinlog/ondevicebriefing/OnDeviceBriefingPlugin.kt`,
    );

    it('iOS declares and advertises both structural limits', () => {
      expect(engine).toContain('static let maxItems = 64');
      expect(engine).toContain('static let maxCandidatesPerItem = 32');
      expect(bridge).toContain('"maxItems": OnDeviceBriefing.maxItems');
      expect(bridge).toContain('"maxCandidatesPerItem": OnDeviceBriefing.maxCandidatesPerItem');
    });

    /*
      Android는 이제 모델 provider를 싣지 않는다(ML Kit는 base APK에서 제거됨).
      그래도 JS는 두 플랫폼에서 같은 envelope 모양을 받아야 하므로, Android는
      같은 키와 같은 구조 한도를 리터럴로 광고한다.
    */
    it('Android advertises the same structural limits without a model provider', () => {
      expect(androidBridge).toContain('put("maxItems", 64)');
      expect(androidBridge).toContain('put("maxCandidatesPerItem", 32)');
      expect(androidBridge).not.toContain('com.google.mlkit');
    });

    /** The envelope literal only, so unrelated `OnDeviceBriefing.` uses cannot leak in. */
    function envelopeBlock(source: string, startToken: string, endToken: string): string {
      const from = source.indexOf(startToken);
      expect(from).toBeGreaterThan(-1);
      const to = source.indexOf(endToken, from);
      expect(to).toBeGreaterThan(from);
      return source.slice(from, to);
    }

    const iosEnvelope = () => envelopeBlock(bridge, '"envelope": [', '],');
    const androidEnvelope = () =>
      envelopeBlock(androidBridge, 'val envelope = JSObject()', 'call.resolve(');

    it('both advertise the identical envelope key set', () => {
      const iosKeys = [...iosEnvelope().matchAll(/"(\w+)": OnDeviceBriefing\.\w+/g)].map(
        (m) => m[1],
      );
      const androidKeys = [
        ...androidEnvelope().matchAll(/put\("(\w+)", \d+\)/g),
      ].map((m) => m[1]);

      const expected = [
        'maxCandidatesPerItem',
        'maxContextUtf8Bytes',
        'maxInputTextGraphemes',
        'maxItems',
        'promptOverheadUtf8Bytes',
        'responseReserveUtf8Bytes',
      ];
      // Non-vacuous: the blocks really were found and really carry six keys each.
      expect(iosKeys).toHaveLength(expected.length);
      expect(androidKeys).toHaveLength(expected.length);
      expect([...iosKeys].sort()).toEqual(expected);
      expect([...androidKeys].sort()).toEqual(expected);
    });

    it('advertises exactly what each parser enforces, and nothing identifying', () => {
      // The advertised limits are the same constants the parsers guard with.
      expect(bridge).toContain('rawItems.count <= OnDeviceBriefing.maxItems');
      expect(bridge).toContain('rawCandidates.count <= OnDeviceBriefing.maxCandidatesPerItem');
      // Android가 요약을 만들지 않으므로 강제할 parser도 없다. 대신 provider가
      // 언제나 unsupported/E_UNAVAILABLE로 닫히는지 확인한다.
      expect(androidBridge).toContain('put("availability", "unsupported")');
      expect(androidBridge).toContain('BriefingErrorCode.UNAVAILABLE');

      // Capability payloads carry capacity numbers only -- no ids, dates or times.
      for (const [name, block] of [
        ['iOS', iosEnvelope()],
        ['Android', androidEnvelope()],
      ] as const) {
        expect(block.length, name).toBeGreaterThan(50);
        for (const forbidden of ['recordId', 'userId', 'coupleId', 'Date', 'http']) {
          expect(block, `${name} capability leaks ${forbidden}`).not.toContain(forbidden);
        }
      }
    });
  });

  /*
    문서가 코드와 같은 말을 하는지.

    아키텍처 문서는 Android가 ML Kit GenAI Prompt beta2로 구현됐다고 적으면서, 뒤에서는
    Gate D가 아직 SDK를 고르지 않았다고 적고 있었다. 둘 다 참일 수 없다. 이 검사는 그
    모순이 다시 생기면 잡는다.
  */
  describe('architecture doc agrees with the shipped Android provider', () => {
    it('does not claim a shipped Android model provider', () => {
      const gradle = read(`${packageDir}/android/build.gradle`);
      // 코드가 ML Kit를 싣지 않는다면 문서도 실었다고 말하면 안 된다.
      expect(gradle).not.toMatch(/com\.google\.mlkit:genai-prompt/);
      expect(architectureDoc).toMatch(/Gate D[^\n]*DEFERRED/);
    });

    it('keeps the selection rationale and the honest verification status', () => {
      for (const claim of [
        'Runtime capability detection',
        'Deterministic fallback',
        'Cancellation',
        'Server inference remains forbidden',
      ]) {
        expect(architectureDoc, `doc drops "${claim}"`).toContain(claim);
      }
      // Selecting an SDK does not turn an unrun device gate into a passed one.
      expect(architectureDoc).toContain('Still UNVERIFIED');
      expect(architectureDoc).toMatch(/no physical Android device/i);
    });
  });

});
