import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * `PrivacyInfo.xcprivacy` declares an EMPTY `NSPrivacyAccessedAPITypes`, and this
 * is the measurement that entitles it to.
 *
 * Apple's required-reason API list is not something to guess at from a blog post:
 * declaring a reason the binary does not use is as much a review finding as
 * omitting one it does. So instead of trusting the comment in the manifest, this
 * suite scans the ACTUAL iOS source that ends up in the binary -- the one
 * first-party Swift file plus the four pods named in ios/App/Podfile -- for every
 * symbol in the five required-reason categories.
 *
 * If a plugin that touches UserDefaults, file timestamps, boot time, disk space
 * or active keyboards is ever installed, this fails and names the file, which is
 * the moment to add the declaration with its reason code.
 *
 * Categories and codes, for whoever has to update the manifest:
 *   NSPrivacyAccessedAPICategoryUserDefaults        CA92.1
 *   NSPrivacyAccessedAPICategoryFileTimestamp       C617.1 / 0A2A.1 / 3B52.1
 *   NSPrivacyAccessedAPICategorySystemBootTime      35F9.1 / 8FFB.1 / 3D61.1
 *   NSPrivacyAccessedAPICategoryDiskSpace           E174.1 / 85F4.1 / 7D9E.1
 *   NSPrivacyAccessedAPICategoryActiveKeyboards     3EC4.1 / 54BD.1
 */

const repoRoot = resolve(process.cwd());

/**
 * The complete iOS compile surface.
 *
 * Derived from ios/App/Podfile rather than hard-coded, so adding a pod line
 * without adding it here is impossible.
 */
function podSourceRoots(): string[] {
  const podfile = readFileSync(join(repoRoot, 'ios/App/Podfile'), 'utf8');
  const paths = [...podfile.matchAll(/pod '[^']+', :path => '([^']+)'/g)].map((m) =>
    // Podfile paths are relative to ios/App.
    m[1].replace(/^\.\.\/\.\.\//, ''),
  );
  return [...new Set(paths)];
}

const SOURCE_EXTENSIONS = /\.(swift|m|mm|h|c|cc|cpp)$/;

function sourceFiles(root: string): string[] {
  const absolute = join(repoRoot, root);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return SOURCE_EXTENSIONS.test(root) ? [root] : [];
  const out: string[] = [];
  for (const entry of readdirSync(absolute)) {
    // Vendored test fixtures are not compiled into the app.
    if (entry === 'Tests' || entry === 'node_modules' || entry === '.git') continue;
    out.push(...sourceFiles(`${root}/${entry}`));
  }
  return out;
}

/**
 * Symbols that put an app in each required-reason category.
 *
 * Word-boundary matched so `stat` does not fire on `state` and `ProcessInfo`
 * does not fire on a comment about processing.
 */
const REQUIRED_REASON_SYMBOLS: Record<string, string[]> = {
  'UserDefaults (CA92.1)': ['UserDefaults', 'NSUserDefaults', 'standardUserDefaults'],
  'File timestamp (C617.1)': [
    'creationDate',
    'modificationDate',
    'contentModificationDate',
    'attributesOfItem',
    'fileAttributes',
    'getattrlist',
    'getattrlistbulk',
    'fgetattrlist',
    'stat',
    'fstat',
    'lstat',
    'fstatat',
    'NSFileCreationDate',
    'NSFileModificationDate',
  ],
  'System boot time (35F9.1)': ['systemUptime', 'mach_absolute_time', 'mach_continuous_time'],
  'Disk space (E174.1)': [
    'volumeAvailableCapacity',
    'volumeAvailableCapacityForImportantUsage',
    'volumeAvailableCapacityForOpportunisticUsage',
    'systemFreeSize',
    'systemSize',
    'statfs',
    'fstatfs',
    'statvfs',
    'NSFileSystemFreeSize',
  ],
  'Active keyboards (3EC4.1)': ['activeInputModes'],
};

const roots = ['ios/App/App/AppDelegate.swift', ...podSourceRoots()];
const files = roots.flatMap(sourceFiles);
const corpus = files.map((file) => ({
  file,
  text: readFileSync(join(repoRoot, file), 'utf8'),
}));

describe('the iOS required-reason API scan that the privacy manifest rests on', () => {
  it('scans a real, non-trivial corpus (a silently empty scan would prove nothing)', () => {
    expect(roots).toContain('ios/App/App/AppDelegate.swift');
    expect(roots).toContain('node_modules/@capacitor/ios');
    expect(roots).toContain('node_modules/@capacitor/app');
    expect(roots).toContain('node_modules/@capacitor/browser');
    expect(files.length).toBeGreaterThan(20);
    // Sanity: the scanner can find something that IS there.
    expect(corpus.some(({ text }) => /WKWebView/.test(text))).toBe(true);
  });

  it.each(Object.entries(REQUIRED_REASON_SYMBOLS))(
    'finds no %s symbol anywhere in the compile surface',
    (_category, symbols) => {
      const hits: string[] = [];
      for (const { file, text } of corpus) {
        for (const symbol of symbols) {
          if (new RegExp(`\\b${symbol}\\b`).test(text)) hits.push(`${file}: ${symbol}`);
        }
      }
      expect(hits).toEqual([]);
    },
  );

  it('therefore declares NSPrivacyAccessedAPITypes empty, matching the measurement', () => {
    const manifest = readFileSync(join(repoRoot, 'ios/App/App/PrivacyInfo.xcprivacy'), 'utf8');
    expect(manifest).toMatch(/<key>NSPrivacyAccessedAPITypes<\/key>\s*<array\/>/);
    expect(manifest).not.toContain('NSPrivacyAccessedAPITypeReasons');
  });

  it('agrees with the privacy manifests the pods ship themselves', () => {
    const podManifests = [
      'node_modules/@capacitor/ios/Capacitor/Capacitor/PrivacyInfo.xcprivacy',
      'node_modules/@capacitor/ios/CapacitorCordova/CapacitorCordova/PrivacyInfo.xcprivacy',
    ];
    for (const relative of podManifests) {
      const text = readFileSync(join(repoRoot, relative), 'utf8');
      expect(text, relative).toMatch(/<key>NSPrivacyAccessedAPITypes<\/key>\s*<array\/>/);
      expect(text, relative).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
    }
  });
});

describe('the Keychain capability is measured, not assumed', () => {
  it('only the first-party device-key plugin touches the Keychain', () => {
    const hits = corpus
      .filter(({ text }) => /\bSecItem(Add|Copy|Update|Delete)\b|\bkSecClass\b|\bKeychain\b/.test(text))
      .map(({ file }) => file);
    expect(hits).toEqual([
      'packages/capacitor-device-keys/ios/Sources/DeviceKeysPlugin/DeviceKeys.swift',
      'packages/capacitor-device-keys/ios/Sources/DeviceKeysPlugin/LocalKeys.swift',
    ]);
  });

  it('and no access group is declared, so nothing could share one', () => {
    const entitlements = readFileSync(join(repoRoot, 'ios/App/App/App.entitlements'), 'utf8');
    // Comments stripped: the file documents the absence by naming the key.
    expect(entitlements.replace(/<!--[\s\S]*?-->/g, '')).not.toContain('keychain-access-groups');
  });
});

describe('no analytics, advertising or attribution SDK reached the iOS graph', () => {
  it('finds no AdSupport, AppTrackingTransparency or IDFA symbol', () => {
    const hits: string[] = [];
    for (const { file, text } of corpus) {
      for (const symbol of [
        'ASIdentifierManager',
        'advertisingIdentifier',
        'ATTrackingManager',
        'AppTrackingTransparency',
        'AdSupport',
        'SKAdNetwork',
      ]) {
        if (new RegExp(`\\b${symbol}\\b`).test(text)) hits.push(`${file}: ${symbol}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
