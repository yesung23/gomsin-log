import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ON_DEVICE_BRIEFING_PLUGIN_NAME } from './nativeOnDeviceBriefing';

/*
  Android는 이 릴리스에서 **모델 provider를 싣지 않는다.**

  ML Kit GenAI Prompt는 공식적으로 API 26을 요구하는데 이 앱은 minSdk 23이다. 예전 구현은
  `tools:overrideLibrary` 로 그 요구를 우회해서, API 23–25 기기에서는 런타임 guard보다
  먼저 클래스가 로드될 수 있었다 — 즉 요약이 조용히 fallback 되는 게 아니라 앱이 시작조차
  못 할 수 있었다. Google Play가 범위에 들어오기 전까지 base APK에서 ML Kit를 빼고,
  Android는 deterministic exact-source 경로만 쓴다.

  그래서 이 파일이 지키는 것은 "Kotlin이 좋은 요약을 만드는가"가 아니라 다음 두 가지다.

  1. ML Kit·AICore·overrideLibrary가 **다시 들어오지 않는다.**
  2. JS 계약은 그대로다 — 같은 plugin 이름, 같은 4개 메서드, 같은 envelope 키,
     그리고 언제나 fail-closed.
*/

const root = resolve(process.cwd());
const packageDir = 'packages/capacitor-on-device-briefing';
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const manifest = JSON.parse(read(`${packageDir}/package.json`)) as {
  private?: boolean;
  files?: string[];
  capacitor?: Record<string, { src: string }>;
};
const rootPackage = JSON.parse(read('package.json')) as {
  dependencies: Record<string, string>;
};
const buildGradle = read(`${packageDir}/android/build.gradle`);
const androidManifest = read(`${packageDir}/android/src/main/AndroidManifest.xml`);
const pluginKt = read(`${packageDir}/android/src/main/java/app/gomsinlog/ondevicebriefing/OnDeviceBriefingPlugin.kt`);
const adapter = read('src/lib/partnerBriefing/nativeOnDeviceBriefing.ts');

const androidSourceDir = `${packageDir}/android/src/main/java/app/gomsinlog/ondevicebriefing`;

describe('Android Partner Briefing native package contract', () => {
  it('is wired as a dual-platform local Capacitor package in manifest and files', () => {
    expect(rootPackage.dependencies['@gomsinlog/capacitor-on-device-briefing'])
      .toBe('file:packages/capacitor-on-device-briefing');
    expect(manifest.private).toBe(true);
    expect(manifest.capacitor).toEqual({
      ios: { src: 'ios' },
      android: { src: 'android' },
    });
    expect(existsSync(join(root, `${packageDir}/android`))).toBe(true);
    expect(manifest.files).toContain('android/');
    expect(manifest.files).toContain('ios/');
    expect(manifest.files).toContain('GomsinlogCapacitorOnDeviceBriefing.podspec');
  });

  /*
    되돌림 방지가 이 파일의 핵심이다.

    ML Kit 좌표 하나만 검사하면 `genai-summarization` 같은 형제 artifact로 조용히
    돌아올 수 있으므로 계열 전체를 막는다.
  */
  it('ships no Android GenAI model dependency in the base module', () => {
    expect(buildGradle).not.toMatch(/com\.google\.mlkit/);
    expect(buildGradle).not.toMatch(/genai/i);
    expect(buildGradle).not.toMatch(/aicore/i);
    expect(buildGradle).toContain("implementation project(':capacitor-android')");
  });

  it('never re-enables the manifest minSdk override that let ML Kit load below API 26', () => {
    expect(androidManifest).not.toContain('overrideLibrary');
    expect(androidManifest).not.toMatch(/com\.google\.mlkit/);
    expect(androidManifest).not.toMatch(/AICore|aicore/);
  });

  it('keeps the minSdk 23 install floor the override was bypassing', () => {
    expect(buildGradle).toMatch(/minSdk\s+23/);
    expect(buildGradle).toMatch(/compileSdk\s+35/);
    expect(buildGradle).toMatch(/targetSdk\s+35/);
  });

  /*
    Plugin 클래스는 minSdk 23 기기에서 앱 시작 시 인스턴스화된다. API 24+/26+ 클래스를
    직접 import 하면 그 자체로 VerifyError/NoClassDefFoundError가 될 수 있다.
  */
  it('imports nothing that cannot load on API 23', () => {
    expect(pluginKt).not.toContain('import android.icu');
    expect(pluginKt).not.toContain('import com.google.mlkit');
    expect(pluginKt).not.toContain('BreakIterator');
  });

  it('carries no Kotlin model engine any more', () => {
    expect(existsSync(join(root, `${androidSourceDir}/OnDeviceBriefingEngine.kt`))).toBe(false);
  });

  it('matches the exact Capacitor plugin name and bridge methods across Kotlin and TS', () => {
    expect(ON_DEVICE_BRIEFING_PLUGIN_NAME).toBe('GomsinlogOnDeviceBriefing');
    expect(adapter).toContain("'GomsinlogOnDeviceBriefing'");
    expect(pluginKt).toContain('@CapacitorPlugin(name = "GomsinlogOnDeviceBriefing")');
    const annotated = [...pluginKt.matchAll(/@PluginMethod\s+fun ([a-zA-Z]+)\(/g)]
      .map((match) => match[1])
      .sort();
    expect(annotated).toEqual(['availability', 'cancel', 'capability', 'selectExtracts']);
  });

  /*
    가장 중요한 동작 계약: 사용 불가를 **거짓 성공이 아니라** unsupported 로 답한다.
    JS는 이 신호를 보고 deterministic exact-source 경로를 쓴다.
  */
  it('answers unsupported and refuses to generate instead of returning empty output', () => {
    expect(pluginKt).toContain('put("availability", "unsupported")');
    expect(pluginKt).toMatch(/fun selectExtracts\(call: PluginCall\) \{\s*reject\(call, BriefingErrorCode\.UNAVAILABLE\)/);
    expect(pluginKt).toContain('E_UNAVAILABLE');
    expect(pluginKt).toContain('E_BAD_REQUEST');
  });

  it('still advertises the structural envelope JS reads on both platforms', () => {
    for (const key of [
      'maxContextUtf8Bytes',
      'promptOverheadUtf8Bytes',
      'responseReserveUtf8Bytes',
      'maxInputTextGraphemes',
      'maxItems',
      'maxCandidatesPerItem',
    ]) {
      expect(pluginKt, `envelope drops ${key}`).toContain(`put("${key}"`);
    }
    expect(pluginKt).toContain('put("maxItems", 64)');
    expect(pluginKt).toContain('put("maxCandidatesPerItem", 32)');
  });

  it('enforces exact top-level call keys on every plugin method', () => {
    expect(pluginKt).toContain('setOf("locale")');
    expect(pluginKt).toContain('setOf("requestId")');
    expect(pluginKt).toContain('call.data.keys().hasNext()');
  });

  it('bounds the cancel request id and resolves an unknown cancel without side effects', () => {
    expect(pluginKt).toContain('requestId.toByteArray(Charsets.UTF_8).size > 128');
    expect(pluginKt).toContain('call.resolve(JSObject())');
  });

  it('references no record, user, couple or credential identifier', () => {
    for (const forbidden of [
      'recordId',
      'userId',
      'coupleId',
      'privateKey',
      'authToken',
      'sessionToken',
      'cookie',
    ]) {
      expect(pluginKt, `must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('never logs and never opens a network or persistence path', () => {
    for (const forbidden of [
      'Log.d(',
      'Log.i(',
      'Log.w(',
      'Log.e(',
      'println(',
      'System.out',
      'System.err',
      'printStackTrace(',
      'HttpURLConnection',
      'OkHttpClient',
      'HttpClient',
      'SharedPreferences',
      'getSharedPreferences',
      'openFileOutput',
      'SQLiteDatabase',
    ]) {
      expect(pluginKt, `must not use ${forbidden}`).not.toContain(forbidden);
    }
  });
});
