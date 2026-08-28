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

describe('iOS Partner Briefing native package', () => {
  it('is one private iOS-only local Capacitor package', () => {
    expect(rootPackage.dependencies['@gomsinlog/capacitor-on-device-briefing'])
      .toBe('file:packages/capacitor-on-device-briefing');
    expect(manifest.private).toBe(true);
    expect(manifest.capacitor).toEqual({ ios: { src: 'ios' } });
    expect(existsSync(join(root, `${packageDir}/android`))).toBe(false);
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
      ['promptOverheadUtf8Bytes', 256],
      ['responseReserveUtf8Bytes', 512],
      ['maxInputTextGraphemes', 1000],
    ] as const) {
      expect(engine).toContain(`static let ${name} = ${value}`);
      expect(bridge).toContain(`"${name}": OnDeviceBriefing.${name}`);
    }
    expect(engine).toContain('var itemOrdinal: Int');
    expect(engine).toContain('var candidateOrdinal: Int');
    expect(engine).not.toMatch(/GeneratedBriefing(?:Choice|Plan)[\s\S]*var text:/);
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

  it('has no network, persistence, content logging, feedback, or server fallback', () => {
    const native = `${engine}\n${bridge}`;
    for (const forbidden of [
      'URLSession', 'URLRequest', 'FileManager', 'UserDefaults', 'print(', 'NSLog',
      'os_log', 'Logger(', 'logFeedbackAttachment', 'LanguageModelFeedback',
    ]) {
      expect(native, forbidden).not.toContain(forbidden);
    }
  });
});
