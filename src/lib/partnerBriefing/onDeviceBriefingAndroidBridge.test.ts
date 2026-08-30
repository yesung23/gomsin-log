import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ON_DEVICE_BRIEFING_PLUGIN_NAME } from './nativeOnDeviceBriefing';

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
const engineKt = read(`${packageDir}/android/src/main/java/app/gomsinlog/ondevicebriefing/OnDeviceBriefingEngine.kt`);
const adapter = read('src/lib/partnerBriefing/nativeOnDeviceBriefing.ts');

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

  it('uses the official ML Kit Prompt API dependency and official package imports', () => {
    expect(buildGradle).toContain("implementation 'com.google.mlkit:genai-prompt:1.0.0-beta2'");
    expect(buildGradle).toContain("implementation project(':capacitor-android')");
    expect(buildGradle).not.toMatch(/ksp/i);
    expect(buildGradle).not.toMatch(/structured-output/i);
    expect(buildGradle).not.toMatch(/androidx\.genai/i);

    // Official common package classes
    expect(engineKt).toContain('import com.google.mlkit.genai.common.FeatureStatus');
    expect(engineKt).toContain('import com.google.mlkit.genai.common.GenAiException');
    expect(engineKt).not.toContain('import com.google.mlkit.genai.prompt.DownloadStatus');
    expect(engineKt).not.toContain('import com.google.mlkit.genai.prompt.FeatureStatus');
    expect(engineKt).not.toContain('import com.google.mlkit.genai.prompt.GenAiException');
  });

  it('uses actual beta2 GenerativeModel methods and builds an explicit GenerateContentRequest via TextPart constructor', () => {
    expect(engineKt).toContain('model.checkStatus()');
    expect(engineKt).toContain('.download().collect { }');
    expect(engineKt).toContain('model.generateContent(request)');
    expect(engineKt).toContain('response.candidates.firstOrNull()?.text');
    expect(engineKt).not.toContain('checkFeatureStatus');
    expect(engineKt).not.toContain('downloadFeature');
    expect(engineKt).not.toMatch(/response\.text\b/);

    // Explicit Builder(TextPart)
    expect(engineKt).toContain('GenerateContentRequest.Builder(TextPart(promptText))');
    expect(engineKt).not.toMatch(/GenerateContentRequest\.Builder\(\)/);
    expect(engineKt).not.toContain('addPart');

    expect(engineKt).toContain('temperature = 0f');
    expect(engineKt).toContain('seed = 0');
    expect(engineKt).toContain('topK = 1');
    expect(engineKt).toContain('candidateCount = 1');
    expect(engineKt).toContain('maxOutputTokens = OnDeviceBriefing.MAXIMUM_RESPONSE_TOKENS');
  });

  it('uses android.icu.text.BreakIterator for accurate grapheme segmentation and avoids java.text', () => {
    expect(engineKt).toContain('import android.icu.text.BreakIterator');
    expect(engineKt).not.toContain('import java.text.BreakIterator');
    expect(engineKt).toContain('BreakIterator.getCharacterInstance()');
    expect(pluginKt).not.toContain('import android.icu.text.BreakIterator');
  });

  it('validates candidate text as strict String and bounds rawOutput size before JSON parse', () => {
    expect(pluginKt).toContain('candidateObj.opt("text")');
    expect(pluginKt).toContain('rawText !is String');
    expect(pluginKt).not.toContain('optString("text")');

    expect(engineKt).toContain('rawOutput.toByteArray(Charsets.UTF_8).size > OnDeviceBriefing.RESPONSE_RESERVE_UTF8_BYTES');
    expect(engineKt).toContain('ACTUAL_PROMPT_OVERHEAD_UTF8_BYTES <= PROMPT_OVERHEAD_UTF8_BYTES');
  });

  it('switches GenAiException strictly on actual errorCode constants and rejects nonexistent constants', () => {
    expect(engineKt).toContain('when (e.errorCode)');
    // Real constants
    for (const realConst of [
      'GenAiException.ErrorCode.BUSY',
      'GenAiException.ErrorCode.PER_APP_BATTERY_USE_QUOTA_EXCEEDED',
      'GenAiException.ErrorCode.CANCELLED',
      'GenAiException.ErrorCode.REQUEST_PROCESSING_ERROR',
      'GenAiException.ErrorCode.RESPONSE_PROCESSING_ERROR',
      'GenAiException.ErrorCode.REQUEST_TOO_LARGE',
      'GenAiException.ErrorCode.REQUEST_TOO_SMALL',
      'GenAiException.ErrorCode.RESPONSE_GENERATION_ERROR',
      'GenAiException.ErrorCode.INVALID_INPUT_IMAGE',
      'GenAiException.ErrorCode.CACHE_PROCESSING_ERROR',
      'GenAiException.ErrorCode.NOT_AVAILABLE',
      'GenAiException.ErrorCode.NEEDS_SYSTEM_UPDATE',
      'GenAiException.ErrorCode.AICORE_INCOMPATIBLE',
      'GenAiException.ErrorCode.NOT_ENOUGH_DISK_SPACE',
      'GenAiException.ErrorCode.BACKGROUND_USE_BLOCKED',
    ]) {
      expect(engineKt).toContain(realConst);
    }

    // Nonexistent constants must NOT exist in engine
    for (const nonExistent of [
      'RESPONSE_TOO_LARGE',
      'PROCESSING_ERROR',
      'OUTPUT_PARSE_ERROR',
      'PROMPT_BLOCKED',
      'SAFETY_BLOCKED',
      'DOWNLOAD_FAILED',
    ]) {
      expect(engineKt).not.toContain(`GenAiException.ErrorCode.${nonExistent}`);
    }

    // Never inspect e.message or raw exception strings
    expect(engineKt).not.toMatch(/e\.message/);
    expect(engineKt).not.toMatch(/e\.javaClass/);
  });

  it('enforces exact version=2, groups, and strict JSONTokener end-of-input check', () => {
    expect(engineKt).toContain('val tokener = JSONTokener(rawOutput)');
    expect(engineKt).toContain('tokener.nextClean()');
    expect(engineKt).toContain('topKeys != setOf("version", "groups")');
    expect(engineKt).toContain('(versionVal as Number).toInt() != 2');
    expect(engineKt).toContain('groupKeys != setOf("groupOrdinal", "choices")');
    expect(engineKt).toContain('choiceKeys != setOf("itemOrdinal", "candidateOrdinal")');
  });

  it('owns engine lifecycle per plugin instance and registers the Deferred before bridge launch', () => {
    expect(pluginKt).toContain('private val pluginScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)');
    expect(pluginKt).toContain('private val engine by lazy { OnDeviceBriefingEngine(pluginScope, context) }');
    expect(pluginKt).toContain('engine.cancelAll()');
    expect(pluginKt).toContain('pluginScope.cancel()');

    // Cancellation race safety: one Deferred owns completion and is registered before it starts.
    expect(engineKt).not.toContain('CompletableDeferred<List<BriefingGroup>>');
    expect(engineKt).toContain('scope.async(start = CoroutineStart.LAZY)');
    expect(engineKt).toContain('inFlight.putIfAbsent(requestId, deferred)');
    expect(engineKt).toContain('deferred.start()');
    expect(engineKt.indexOf('inFlight.putIfAbsent(requestId, deferred)'))
      .toBeLessThan(engineKt.indexOf('deferred.start()'));
    expect(pluginKt).toContain('engine.startSelect(');
    expect(pluginKt).toContain('val groups = deferred.await()');
    expect(pluginKt).toMatch(
      /val deferred = try \{[\s\S]*engine\.startSelect\([\s\S]*pluginScope\.launch \{[\s\S]*val groups = deferred\.await\(\)/,
    );
    expect(engineKt.match(/catch \(e: CancellationException\) \{\s*throw e\s*\}/g)?.length)
      .toBeGreaterThanOrEqual(3);
  });

  it('maintains minSdk 23 floor with overrideLibrary and runtime-gates API 26 before parsing', () => {
    expect(buildGradle).toMatch(/minSdk\s+23/);
    expect(buildGradle).toMatch(/compileSdk\s+35/);
    expect(buildGradle).toMatch(/targetSdk\s+35/);
    expect(androidManifest).toContain(
      '<uses-sdk tools:overrideLibrary="com.google.mlkit.genai.prompt,com.google.mlkit.genai.common" />',
    );

    expect(pluginKt).toContain('OnDeviceBriefingAvailability.UNSUPPORTED.value');
    expect(pluginKt).toMatch(/selectExtracts\([\s\S]*?Build\.VERSION\.SDK_INT < Build\.VERSION_CODES\.O[\s\S]*?reject\(call, BriefingErrorCode\.UNAVAILABLE\)[\s\S]*?parseItems/);
  });

  it('enforces exact top-level call keys on all plugin methods', () => {
    expect(pluginKt).toContain('keys != setOf("locale")');
    expect(pluginKt).toContain('keys.isNotEmpty()');
    expect(pluginKt).toContain('keys != setOf("requestId", "locale", "items")');
    expect(pluginKt).toContain('keys != setOf("requestId")');
  });

  it('matches the exact Capacitor plugin name and bridge methods across Kotlin, Swift, and TS', () => {
    expect(ON_DEVICE_BRIEFING_PLUGIN_NAME).toBe('GomsinlogOnDeviceBriefing');
    expect(adapter).toContain("'GomsinlogOnDeviceBriefing'");
    expect(pluginKt).toContain('@CapacitorPlugin(name = "GomsinlogOnDeviceBriefing")');
    const annotated = [...pluginKt.matchAll(/@PluginMethod\s+fun ([a-zA-Z]+)\(/g)]
      .map((match) => match[1])
      .sort();
    expect(annotated).toEqual(['availability', 'cancel', 'capability', 'selectExtracts']);
  });

  it('declares the portable envelope and ordinal-only response contract', () => {
    for (const [name, value] of [
      ['MAX_CONTEXT_UTF8_BYTES', 4096],
      ['PROMPT_OVERHEAD_UTF8_BYTES', 512],
      ['RESPONSE_RESERVE_UTF8_BYTES', 1024],
      ['MAX_INPUT_TEXT_GRAPHEMES', 1000],
    ] as const) {
      expect(engineKt).toContain(`const val ${name} = ${value}`);
    }
    expect(engineKt).toContain('val groupOrdinal: Int');
    expect(engineKt).toContain('val itemOrdinal: Int');
    expect(engineKt).toContain('val candidateOrdinal: Int');
    expect(pluginKt).toContain('put("version", 2)');
    expect(pluginKt).toContain('put("groupOrdinal", group.groupOrdinal)');
    expect(pluginKt).toContain('put("itemOrdinal", choice.itemOrdinal)');
    expect(pluginKt).toContain('put("candidateOrdinal", choice.candidateOrdinal)');
  });

  it('validates request shapes strictly and prevents prompt injection of private metadata', () => {
    const combined = `${pluginKt}\n${engineKt}`;
    for (const forbidden of [
      'recordId',
      'userId',
      'coupleId',
      'privateKey',
      'authToken',
      'sessionToken',
      'cookie',
    ]) {
      expect(combined, `must not reference ${forbidden}`).not.toContain(forbidden);
    }
    expect(pluginKt).toContain('itemOrdinal != i');
    expect(pluginKt).toContain('candidateOrdinal != c');
    expect(engineKt).toContain('itemOrdinal >= items.size');
    expect(engineKt).toContain('candidateOrdinal >= candidateCount');
  });

  it('strictly isolates errors to fixed bridge error codes and never logs raw exception text', () => {
    const combined = `${pluginKt}\n${engineKt}`;
    for (const forbidden of [
      'Log.d(',
      'Log.i(',
      'Log.w(',
      'Log.e(',
      'println(',
      'System.out',
      'System.err',
      'printStackTrace(',
    ]) {
      expect(combined, `must not use ${forbidden}`).not.toContain(forbidden);
    }
    for (const code of [
      'E_UNAVAILABLE',
      'E_BAD_REQUEST',
      'E_MALFORMED',
      'E_BUSY',
      'E_QUOTA',
      'E_CANCELLED',
      'E_NATIVE',
    ]) {
      expect(combined).toContain(code);
    }
  });

  it('has no external network client or local disk persistence APIs', () => {
    const combined = `${pluginKt}\n${engineKt}`;
    for (const forbidden of [
      'HttpURLConnection',
      'OkHttpClient',
      'HttpClient',
      'URLSession',
      'SharedPreferences',
      'getSharedPreferences',
      'openFileOutput',
      'SQLiteDatabase',
      'Room',
    ]) {
      expect(combined, `must not use ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('isolates API24+ ICU BreakIterator and API26+ ML Kit classes behind class-loader safe boundaries so Plugin can load on API23-25', () => {
    // OnDeviceBriefingPlugin is instantiated at app launch on all Android versions (minSdk 23).
    // Direct imports of android.icu or ML Kit classes in Plugin class cause NoClassDefFoundError/VerifyError on API 23-25.
    expect(pluginKt).not.toContain('import android.icu');
    expect(pluginKt).not.toContain('import com.google.mlkit');
    expect(pluginKt).not.toContain('BreakIterator.getCharacterInstance()');
    expect(pluginKt).toMatch(/Build\.VERSION\.SDK_INT < Build\.VERSION_CODES\.O/);
    expect(pluginKt).toMatch(/Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.O/);
  });

  it('guards automatic model download to verified unmetered active networks (ConnectivityManager.isActiveNetworkMetered) and fails closed', () => {
    expect(engineKt).toContain('import android.net.ConnectivityManager');
    expect(engineKt).toContain('fun isUnmeteredActiveNetwork(): Boolean');
    expect(engineKt).toContain('cm.isActiveNetworkMetered');
    expect(engineKt).toContain('!isMetered');

    // Prove DOWNLOADABLE branch gates triggerDownload behind isUnmeteredActiveNetwork()
    expect(engineKt).toMatch(
      /FeatureStatus\.DOWNLOADABLE\s*->\s*\{\s*if\s*\(isUnmeteredActiveNetwork\(\)\)\s*\{\s*triggerDownload\(\)\s*\}\s*OnDeviceBriefingAvailability\.PREPARING\s*\}/,
    );

    // Prove fail-closed handling on metered, missing context, or exceptions
    expect(engineKt).toMatch(/val ctx = context \?: return false/);
    expect(engineKt).toMatch(/val cm = ctx\.getSystemService\(Context\.CONNECTIVITY_SERVICE\) as\? ConnectivityManager/);
    expect(engineKt).toMatch(/cm\.activeNetwork \?: return false/);
    expect(engineKt).toMatch(/catch \(_: Throwable\) \{\s*false\s*\}/);
    expect(pluginKt).toContain('OnDeviceBriefingEngine(pluginScope, context)');
  });
});
