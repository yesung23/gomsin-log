import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => existsSync(resolve(root, path))
  ? readFileSync(resolve(root, path), 'utf8')
  : '';

const packageJson = read('packages/capacitor-storekit/package.json');
const definitions = read('packages/capacitor-storekit/src/definitions.ts');
const pluginIndex = read('packages/capacitor-storekit/src/index.ts');
const swift = read('packages/capacitor-storekit/ios/Sources/StoreKitPlugin/StoreKitPlugin.swift');
const podspec = read('packages/capacitor-storekit/GomsinlogCapacitorStorekit.podspec');
const appPackage = read('package.json');
const podfile = read('ios/App/Podfile');
const podlock = read('ios/App/Podfile.lock');
const infoPlist = read('ios/App/App/Info.plist');
const config = read('ios/App/Config.xcconfig');
const scheme = read('ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme');
const project = read('ios/App/App.xcodeproj/project.pbxproj');
const storekitConfig = read('ios/App/StoreKitConfiguration.storekit');

describe('StoreKit Capacitor package contract', () => {
  it('ships one typed iOS-only plugin with no web purchase fallback', () => {
    expect(packageJson).toContain('"name": "@gomsinlog/capacitor-storekit"');
    expect(packageJson).toContain('"ios":');
    expect(packageJson).not.toContain('"web":');
    expect(pluginIndex).toMatch(/registerPlugin<StoreKitPlugin>\(\s*'GomsinlogStoreKit'/);
    for (const status of ['success', 'pending', 'cancelled']) {
      expect(definitions).toContain(`status: '${status}'`);
    }
    expect(appPackage).toContain('"@gomsinlog/capacitor-storekit": "file:packages/capacitor-storekit"');
  });

  it('registers matching Swift methods and verifies every StoreKit transaction', () => {
    for (const method of ['availability', 'products', 'purchase', 'sync', 'currentEntitlements', 'finish']) {
      expect(definitions, method).toContain(`${method}(`);
      expect(swift, method).toContain(`CAPPluginMethod(name: "${method}"`);
      expect(swift, method).toContain(`@objc func ${method}(`);
    }
    expect(swift).toContain('import StoreKit');
    expect(swift).toContain('Transaction.updates');
    expect(swift).toContain('Transaction.currentEntitlements');
    expect(swift).toContain('Transaction.unfinished');
    expect(swift).toContain('case .verified(let transaction)');
    expect(swift).toContain('verificationResult.jwsRepresentation');
    expect(swift).toContain('.appAccountToken(appAccountToken)');
    expect(swift).not.toContain('UserDefaults');
    expect(swift).not.toMatch(/print\s*\(/);
  });

  it('returns StoreKit display price metadata instead of a hardcoded client price', () => {
    expect(definitions).toContain('displayPrice: string');
    expect(swift).toContain('product.displayPrice');
    expect(swift).toContain('product.displayName');
    expect(swift).toContain('product.description');
  });

  it('uses a signed bundle value as the second sale gate and defaults it off', () => {
    expect(config).toMatch(/GOMSINLOG_APPLE_IAP_NATIVE_SALE_ENABLED\s*=\s*NO/);
    expect(infoPlist).toMatch(
      /<key>GomsinlogAppleIAPSaleEnabled<\/key>\s*<string>\$\(GOMSINLOG_APPLE_IAP_NATIVE_SALE_ENABLED\)<\/string>/,
    );
    expect(swift).toContain('GomsinlogAppleIAPSaleEnabled');
    expect(swift).toContain('signedSaleEnabled');
  });

  it('wires the local pod without editing the app delegate or project sources', () => {
    expect(podspec).toContain("s.name = 'GomsinlogCapacitorStorekit'");
    expect(podspec).toContain("s.ios.deployment_target = '15.0'");
    expect(podfile).toContain("pod 'GomsinlogCapacitorStorekit', :path => '../../packages/capacitor-storekit'");
    expect(podlock).toContain('GomsinlogCapacitorStorekit (0.1.0)');
    expect(project).toMatch(/com\.apple\.InAppPurchase\s*=\s*\{\s*enabled\s*=\s*1;/);
  });
});

describe('local StoreKit test catalog', () => {
  it('is selected by the shared Run scheme and is not synced to App Store Connect', () => {
    expect(scheme).toMatch(/StoreKitConfigurationFileReference\s+identifier = "\.\.\/\.\.\/\.\.\/StoreKitConfiguration\.storekit"/);
    expect(storekitConfig).toContain('"_syncWithAppStoreConnect" : false');
  });

  it('models approved product types while excluding physical books and family sharing', () => {
    const catalog = JSON.parse(storekitConfig) as {
      products: Array<{ productID: string; type: string; familyShareable: boolean }>;
      subscriptionGroups: Array<{ subscriptions: Array<{ productID: string; familyShareable: boolean }> }>;
    };
    const products = catalog.products;
    expect(products.filter((item) => item.type === 'NonConsumable')).toHaveLength(3);
    expect(products.filter((item) => item.type === 'Consumable')).toHaveLength(1);
    expect(catalog.subscriptionGroups[0]?.subscriptions).toHaveLength(2);
    expect([...products, ...catalog.subscriptionGroups[0].subscriptions].every((item) => !item.familyShareable)).toBe(true);
    expect(JSON.stringify(catalog)).not.toMatch(/physical|print|shipping|실물|배송/i);
  });
});
