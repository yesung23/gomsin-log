import { describe, expect, it } from 'vitest';
import * as serviceWorkerManifest from '../../build/serviceWorkerManifest';

const {
  collectOfflineCriticalAssetUrls,
  serviceWorkerCloseBundleHook,
} = serviceWorkerManifest;

type DeriveServiceWorkerBuildId = (input: {
  artifacts: ReadonlyArray<{ fileName: string; contents: string }>;
  serviceWorkerTemplate: string;
  manifestAssetUrls: readonly string[];
}) => string;

describe('service-worker offline critical route closure', () => {
  it('includes Home and Onboarding with their static imports but not unrelated lazy routes', () => {
    const bundle = {
      'assets/HomePage-home.js': {
        type: 'chunk' as const,
        fileName: 'assets/HomePage-home.js',
        facadeModuleId: '/repo/src/pages/HomePage.tsx',
        imports: ['assets/vendor-react.js', 'assets/home-shared.js'],
        dynamicImports: ['assets/RecordMediaGallery-media.js'],
      },
      'assets/OnboardingPage-onboarding.js': {
        type: 'chunk' as const,
        fileName: 'assets/OnboardingPage-onboarding.js',
        facadeModuleId: '/repo/src/pages/OnboardingPage.tsx',
        imports: ['assets/vendor-react.js'],
        dynamicImports: [],
        referencedFiles: ['assets/onboarding-mark.svg'],
      },
      'assets/home-shared.js': {
        type: 'chunk' as const,
        fileName: 'assets/home-shared.js',
        facadeModuleId: null,
        imports: ['assets/vendor-react.js'],
        dynamicImports: [],
      },
      'assets/vendor-react.js': {
        type: 'chunk' as const,
        fileName: 'assets/vendor-react.js',
        facadeModuleId: null,
        imports: [],
        dynamicImports: [],
      },
      'assets/RecordMediaGallery-media.js': {
        type: 'chunk' as const,
        fileName: 'assets/RecordMediaGallery-media.js',
        facadeModuleId: '/repo/src/components/media/RecordMediaGallery.tsx',
        imports: [],
        dynamicImports: [],
      },
      'assets/RecordPage-record.js': {
        type: 'chunk' as const,
        fileName: 'assets/RecordPage-record.js',
        facadeModuleId: '/repo/src/pages/RecordPage.tsx',
        imports: ['assets/vendor-react.js'],
        dynamicImports: [],
      },
      'assets/onboarding-mark.svg': {
        type: 'asset' as const,
        fileName: 'assets/onboarding-mark.svg',
      },
    };

    expect(collectOfflineCriticalAssetUrls(bundle)).toEqual([
      '/assets/HomePage-home.js',
      '/assets/OnboardingPage-onboarding.js',
      '/assets/home-shared.js',
      '/assets/vendor-react.js',
    ]);
  });

  it('fails the build if either critical route is missing from the Rollup graph', () => {
    expect(() => collectOfflineCriticalAssetUrls({})).toThrow(/HomePage\.tsx/);
  });
});

describe('service-worker post-build mutation ordering', () => {
  it('waits for normal closeBundle hooks before hashing their output', () => {
    const handler = () => undefined;

    expect(serviceWorkerCloseBundleHook(handler)).toMatchObject({
      order: 'post',
      sequential: true,
      handler,
    });
  });
});

describe('service-worker cache namespace inputs', () => {
  it('changes for template-only and manifest-only changes with identical dist artifacts', () => {
    const deriveServiceWorkerBuildId = (
      serviceWorkerManifest as Partial<{
        deriveServiceWorkerBuildId: DeriveServiceWorkerBuildId;
      }>
    ).deriveServiceWorkerBuildId;
    expect(deriveServiceWorkerBuildId).toBeTypeOf('function');
    if (!deriveServiceWorkerBuildId) return;

    const artifacts = [
      { fileName: 'assets/app-abc.js', contents: 'console.log("app")' },
      { fileName: 'index.html', contents: '<script src="/assets/app-abc.js"></script>' },
    ];
    const serviceWorkerTemplate = [
      "const CACHE_NAME = 'gomsinlog-app-shell-__BUILD_ID__';",
      'const BUILD_ASSETS = [/* __BUILD_ASSETS__ */];',
    ].join('\n');
    const manifestAssetUrls = ['/assets/app-abc.js', '/assets/vendor-def.js'];

    const baseline = deriveServiceWorkerBuildId({
      artifacts,
      serviceWorkerTemplate,
      manifestAssetUrls,
    });
    const templateOnlyChange = deriveServiceWorkerBuildId({
      artifacts,
      serviceWorkerTemplate: `${serviceWorkerTemplate}\n// security fix`,
      manifestAssetUrls,
    });
    const manifestOnlyChange = deriveServiceWorkerBuildId({
      artifacts,
      serviceWorkerTemplate,
      manifestAssetUrls: ['/assets/app-abc.js', '/assets/home-ghi.js'],
    });
    const artifactOnlyChange = deriveServiceWorkerBuildId({
      artifacts: [
        { fileName: 'assets/app-abc.js', contents: 'console.log("fixed app")' },
        artifacts[1],
      ],
      serviceWorkerTemplate,
      manifestAssetUrls,
    });
    const reorderedManifest = deriveServiceWorkerBuildId({
      artifacts,
      serviceWorkerTemplate,
      manifestAssetUrls: [...manifestAssetUrls].reverse(),
    });

    expect(templateOnlyChange).not.toBe(baseline);
    expect(manifestOnlyChange).not.toBe(baseline);
    expect(artifactOnlyChange).not.toBe(baseline);
    expect(reorderedManifest).toBe(baseline);
  });
});
