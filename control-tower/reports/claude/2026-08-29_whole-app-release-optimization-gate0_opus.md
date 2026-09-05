# Whole-App Release Optimization — GATE 0 (read-only audit) + native environment closure

## Verdict

`GATE 0 SUBSTANTIALLY COMPLETE — NO CODE MODIFIED — MERGE HELD`

- Worktree: `/Users/han-yejun/Desktop/곰신로그-partner-briefing`
- Branch: `codex/partner-briefing`
- HEAD: `15a7a7933d37e95907fd8f5d609fbb9e4f1e1cd2` (unchanged, start == end)
- `origin/master`: `b7d59ace34fd6cd8ec63078e8c19b3a7b5406aa3`
- Main checkout `/Users/han-yejun/Desktop/곰신로그` (`codex/profile-post-composer` @ `a536f9b`): **untouched**

No commit, push, merge, deploy, Supabase mutation, Apple/Vercel change, or TestFlight upload was
performed. **Zero repository source files were modified.** Only this report and the `WORK_LOG.md`
entry are new.

---

## 1. What this session actually closed

The prior Partner Briefing report listed Android compile, Android environment, and physical-device
runtime as UNVERIFIED. Three of those are now closed with real artifacts.

### 1.1 Android SDK + compile gate — CLOSED (PASS)

The host had **no** Android SDK, no `sdkmanager`, no `adb`, no Android Studio; only Oracle JDK 21.

Installed from official Google sources, with the user's explicit consent for `android-sdk-license`
(the licence is a contract between the user and Google; it was **not** auto-accepted on their behalf
until they said so):

| Component | Version |
|---|---|
| `cmdline-tools` | 21.0 |
| `platform-tools` | 37.0.1 |
| `platforms;android-35` | 2 |
| `build-tools;35.0.0` | 35.0.0 |
| `emulator` | 37.1.11 |
| `system-images;android-24;google_apis;arm64-v8a` | 29 |
| `system-images;android-26;google_apis;arm64-v8a` | 3 |

`android/local.properties` was written with `sdk.dir` and confirmed ignored
(`android/.gitignore:31`, root `.gitignore:46`); `git status` does not list it.

Gate command, run exactly as specified:

```
./gradlew :gomsinlog-capacitor-on-device-briefing:compileDebugKotlin :app:assembleDebug --stacktrace
```

**BUILD SUCCESSFUL**, 152 actionable tasks. Artifacts verified as genuine, not cached-empty:

- `android/app/build/outputs/apk/debug/app-debug.apk` — 16,747,717 bytes
- plugin Kotlin classes compiled under `packages/capacitor-on-device-briefing/android/build/tmp/kotlin-classes/debug/`
- `com.google.mlkit:genai-prompt:1.0.0-beta2` really resolved from Google Maven
  (`~/.gradle/caches/.../genai-prompt-1.0.0-beta2.aar`) — the dependency is a real, official artifact

### 1.2 minSdk floor survives the ML Kit merge — VERIFIED

The ML Kit AAR declares `minSdkVersion=26`. The app ships **23**:

- merged manifest `uses-sdk android:minSdkVersion="23"`
- `aapt2 dump badging app-debug.apk` → `minSdkVersion:'23'`, `targetSdkVersion:'35'`

So the API 23–25 install path is intact at the manifest level.

### 1.3 Physical iPhone — build, sign, install, launch, runtime console — CLOSED (PASS)

Device: iPhone 16 Pro (`iPhone17,1`), iOS 27.0, UDID `00008140-000171663AE3001C`.

Signing was available and correct (the two keychain identities are exactly the two certificates
embedded in the team profile; `OU=CB3WLY278W` is the team, `844X94VBRZ` is only the CN suffix):

- Signing Identity: `Apple Development: yesung han (844X94VBRZ)`
- Provisioning Profile: `iOS Team Provisioning Profile: app.gomsinlog` (`f20f69b8…`), team `CB3WLY278W`,
  provisions this exact device, valid to 2027-08-27

Executed:

1. `VITE_PARTNER_BRIEFING_ENABLED=true npm run build` → PASS (built in 2.66s)
2. `npx cap sync ios` → PASS, 6 plugins incl. `@gomsinlog/capacitor-on-device-briefing`
3. `xcodebuild -destination 'id=00008140-…' -allowProvisioningUpdates DEVELOPMENT_TEAM=CB3WLY278W`
   → `** BUILD SUCCEEDED **`
4. `xcrun devicectl device install app` → installed, bundleID `app.gomsinlog`
5. `xcrun devicectl device process launch --console` → **app ran on the physical device**

Entitlements in the built binary: `application-identifier CB3WLY278W.app.gomsinlog`,
`com.apple.developer.default-data-protection = NSFileProtectionComplete`, `get-task-allow` (debug).

**Runtime console from the physical device** (this is the highest-value evidence of the session):

```
⚡️  Loading app at capacitor://localhost...
⚡️  JS Eval error JavaScript 예외가 발생했습니다
⚡️  WebView loaded
⚡️  [warn] Capacitor plugin "GomsinlogDeviceKeys" already registered. Cannot register plugins twice.
⚡️  To Native -> GomsinlogDeviceKeys lckHas → {"present":true}
⚡️  To Native -> PushNotifications checkPermissions → {"receive":"granted"}
⚡️  To Native -> PushNotifications register
⚡️  TO JS {"error":"...유효한 'aps-environment' 인타이틀먼트 문자열을 찾을 수 없습니다."}
⚡️  [warn] [gomsinlog] Clearing the delivery flag failed: Could not find the function
    public.clear_my_unseen without parameters in the schema cache
```

This positively confirms, on real hardware:

- the app loads the **local bundle** (`capacitor://localhost`), not an external website — GATE 1 item
- the WebView loads; no black screen
- the first-party device-keys plugin works (`lckHas → {"present":true}`)
- push registration **fails** because `aps-environment` is absent, while permission is already granted
- `clear_my_unseen` is absent from the live PostgREST schema cache as of 2026-08-29

---

## 2. Live baseline (re-measured this session, not trusted from the prior report)

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test` | **279 files / 4,205 tests PASS** (159.63s) |
| `npm run verify:native` | 4 files / **106 tests PASS** |
| `npm run test:phase0` | PASS |
| `npm run test:e2e:partner-briefing` | **2/2 PASS** (12.3s) |
| `npm run build` (flag ON) | PASS |
| `npx cap sync ios` | PASS, 6 plugins |
| unsigned Simulator build | previously PASS; **device** build now also PASS |

Bundle baseline (GATE 5 starting point). Capacitor serves from disk, so **raw** parse cost is the
startup driver, not gzip:

| Eager asset | raw | gzip |
|---|---|---|
| `index-*.js` | 437,978 | 133,596 |
| `index-*.css` | 326,607 | 66,437 |
| `vendor-supabase` | 218,463 | 56,933 |
| `vendor-react` | 50,447 | 17,855 |
| `vendor-icons` | 41,822 | 8,661 |
| **eager total** | **1,075,317 (1.05 MB)** | **283,482 (277 KB)** |

Routes are already code-split (`RecordPage`, `StoryRoute`, `SettingsPage`, …), `manualChunks`
separates vendors, and `failOnEmptyChunks()` fails the build on a dead chunk entry. GATE 5's
"route lazy loading" item is therefore already satisfied.

---

## 3. Findings I verified myself (evidence-backed, independent of the audit fleet)

### 3.1 P2 — the Android permission gate proves a file that is not the artifact

`src/lib/nativeConfig.test.ts:68` reads `android/app/src/main/AndroidManifest.xml`, and
`:316` asserts *"the permission set is exactly what the code proves"* — an EXACT set of three.
`android/app/src/test/java/app/gomsinlog/NativeConfigTest.java:50` parses **the same source file**.

The shipped APK carries **seven**:

```
INTERNET, ACCESS_NETWORK_STATE, POST_NOTIFICATIONS,
com.google.android.apps.aicore.service.BIND_SERVICE,   <-- new, from the ML Kit AAR
WAKE_LOCK, com.google.android.c2dm.permission.RECEIVE,
app.gomsinlog.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION
```

plus a `<queries><package android:name="com.google.android.aicore"/></queries>` entry.

The design explicitly relies on "two independent witnesses"; they are independent *implementations*
of the **same blind spot**. Neither can see a library-merged permission — which is exactly the change
this branch introduces. Play Console shows the merged set.

Minimal fix: rescope both assertions to what they truly prove ("the app's OWN manifest declares
exactly these"), and enumerate the expected library-merged additions with their source, so drift is
visible.

### 3.2 P2 — `App.entitlements` contradicts the repository's own test suite

`ios/App/App/App.entitlements`, under DELIBERATELY ABSENT ENTITLEMENTS → `keychain-access-groups`:

> "The app never touches the Keychain."

`src/lib/iosPrivacyManifest.test.ts:155` asserts the opposite and names the file:

> `it('only the first-party device-key plugin touches the Keychain')`
> → expects hits to equal `packages/capacitor-device-keys/ios/Sources/DeviceKeysPlugin/DeviceKeys.swift`

`DeviceKeys.swift` / `LocalKeys.swift` use `kSecClassGenericPassword`, `kSecClassKey`, `SecItemAdd`,
`SecItemCopyMatching`, `SecAccessControlCreateWithFlags`, and Secure Enclave with an explicit
"fall back to a software Keychain key".

The **conclusion** (do not declare `keychain-access-groups`) remains correct; the stated **reason** is
false, and it hides where E2EE device keys actually live — directly relevant to the GATE 3
"Keychain unavailable / recovery" item.

Minimal fix: correct the comment to state that Keychain use is confined to the first-party plugin
under the app's default access group, and that declaring a shared group would expose those keys.

### 3.3 P2 — notification permission is requested but can never be honoured

Runtime-confirmed above. `aps-environment` is deliberately absent (documented in `App.entitlements`),
and the server side is also unavailable: `supabase/migrations/README.md` records the entire 048–055
push chain and 066 as NOT APPLIED, with `send-push` not deployed. Both halves are intentional and
documented; the **product** consequence is not addressed: the app asks for, and receives, a permission
it cannot act on. This is a release scheduling decision for the owner, not a code defect.

### 3.4 P3 — `registerPlugin('GomsinlogDeviceKeys')` is called twice

`src/crypto/keystore/index.ts:51` (`getDeviceKeyPort`) and `:69` (`getLocalKeyPort`) each call
`registerPlugin<NativeDeviceKeysPlugin>('GomsinlogDeviceKeys')`. The two memoisation caches
(`cached`, `cachedLocal`) are separate, so both run when both ports are used, producing the native
warning observed on the device. Functionally harmless — `lckHas` returned `{"present":true}`.

Minimal fix: one module-level memoised accessor used by both.

### 3.5 P3 — migration ledger lacks a 2026-08-29 datapoint

`clear_my_unseen` absent from the live schema cache, observed on the physical device today. This
**corroborates** the existing ledger entry rather than contradicting it; worth recording as a dated
live observation.

---

## 4. Corrections I had to make to my own conclusions

Recorded because each one changed the reported severity or an architectural claim.

### 4.1 "P0 — remote Supabase is ~20 migrations behind" → **wrong, downgraded to P3**

`supabase/migrations/README.md` is the authoritative ledger and already documents this precisely:
`048` → "신규 / 어디에도 미적용"; `066` → "원격 적용 상태: NOT APPLIED … 명시적으로 보류";
`067` → "원격 적용 상태: APPLIED (2026-08-28)". Tally: 34 explicitly-unapplied entries, 4 applied.

Three errors in my original claim: it is documented rather than unknown; it is a deliberate hold
rather than a defect; and my "remote ≤ 047" inference was wrong because 067 **is** applied, so the
applied set is intentionally non-contiguous. The app also carries a deliberate `PGRST202`/`PGRST205`
tolerance layer (`src/lib/serverErrors.ts`, 7 call sites, e.g. `sync.ts:305`, `cycle.ts:1115`)
specifically so a lagging remote degrades gracefully.

### 4.2 "API 23–25 never loads ML Kit classes" → **too strong; the manifest path was missed**

What I proved from the shipped dex is correct and stands:

- `OnDeviceBriefingPlugin` instance fields are only `engine$delegate : Lkotlin/Lazy;` and
  `pluginScope : Lkotlinx/coroutines/CoroutineScope;` — no `OnDeviceBriefingEngine`-typed field
- **0** `com/google/mlkit` references inside `OnDeviceBriefingPlugin` (non-vacuous: the block is
  87,464 chars and contains 21 `OnDeviceBriefingEngine` references, and both classes were asserted
  present before the absence check)
- ML Kit appears in exactly 3 classes, all `OnDeviceBriefingEngine*`
- all six `engine` access sites are behind `Build.VERSION.SDK_INT` guards: `:52`←`:43`, `:113`←`:81`,
  `:259`←via `parseItems` ← `:106`←`:81`, `:182`←`:181`, `:189`←`:188`; `capability()` is unguarded
  but touches only `const val` constants on a separate ML-Kit-free class

But the conclusion I drew from it was wrong. The shipped APK manifest contains:

```xml
<provider android:name="com.google.mlkit.common.internal.MlKitInitProvider"
          android:authorities="app.gomsinlog.mlkitinitprovider"
          android:exported="false" android:initOrder="99" />
```

Android instantiates every declared `ContentProvider` during application startup, **before**
`Application.onCreate`, on **every** API level including 23–25. So ML Kit common classes **are**
loaded at process start, by a path entirely outside the plugin.

`docs/PARTNER_BRIEFING_ARCHITECTURE.md:189` states pre-26 devices "gracefully fall back to
deterministic mode **without crashing or loading ML Kit classes**". The "loading ML Kit classes" half
of that sentence is **contradicted by the shipped manifest**. Whether it *crashes* on API 23–25 is
still unknown and needs a real boot.

### 4.3 "IPHONE RECONNECTED" → false positive from my own monitor

`grep "00008140.*available"` matches `unavailable`. The device was never reconnected. Corrected the
pattern; reported at the time.

---

## 5. Audit fleet output — RAISED, NOT CONFIRMED

A 12-dimension read-only audit ran; **11 dimensions returned** before it was stopped for wrap-up
(`supabase-rls` did not return). The adversarial verification stage was still running: only **1**
verdict was recorded. **Therefore every finding below is UNVERIFIED and must be triaged before any
of it is treated as real.** They are recorded here as leads with file:line, not as defects.

Raw data: `scratchpad/audit-findings.json`. Run id `wf_04720e6f-d7b`.

Privacy / E2EE / record protection returned **0 findings** (clean).

| Dim | Sev | Lead | Location |
|---|---|---|---|
| GATE 4 briefing | P0 | Postgres `TIME` "HH:mm:ss" fails the strict time validator → whole corpus fails closed for couples with legacy plaintext records | `src/lib/partnerBriefing/normalize.ts:118` |
| GATE 2 auth | P1 | Every foreground re-runs full account hydration; an offline foreground wipes loaded records onto a dead-end error page | `src/lib/store.tsx:1216` |
| GATE 3 records | P1 | 나만 보기 profile post (and every post made before pairing) vanishes from the grid after a success toast | `src/features/us/SharedProfile.tsx:358` |
| GATE 2 couple | P1 | Partner story loses BOTH briefing and legacy cover when `partnerUserId` is unbound | `src/features/story/StoryRoute.tsx:110` |
| GATE 2 couple | P1 | Profile-slice realtime refresh permanently erases `profile.couple.partnerUserId`, no re-bind path | `src/lib/store.tsx:1814` |
| GATE 4 briefing | P1 | Cover removed by the flag rather than by the briefing existing → fail-closed paths leave no first screen | `src/features/story/StoryRoute.tsx:110` |
| GATE 7 release | P1 | Pre-login terms/privacy links open Safari at `https://localhost` and dead-end; consent docs unreachable | `src/pages/OnboardingPage.tsx:1044` |
| GATE 7 release | P1 | `aps-environment` absent while the app registers for push (matches §3.3) | `ios/App/App/App.entitlements:36` |
| GATE 5 perf | P1 | N+1: one uncached `scope_keys` query per encrypted record on every refresh | `src/app/e2ee/runtime.ts:226` |
| GATE 5 perf | P1 | Every foreground refetches/re-decrypts/re-signs the whole record history; overlapping foregrounds stack | `src/lib/records.ts:255` |
| GATE 6 ux | P1 | Story viewer + call mode draw headers under the iOS notch; close button collides with system chrome | `src/features/story/StoryViewer.tsx:192` |
| GATE 6 ux | P1 | 2–4 identically named "원본 보기" buttons per grouped item — nothing says which sentence each opens | `src/components/widgets/PartnerBriefingCard.tsx:198` |
| GATE 4 android | P2 | Opening the partner's Story silently starts an unconsented on-device model download | `…/OnDeviceBriefingEngine.kt:152` |
| GATE 4 android | P3 | `MlKitInitProvider` runs at every process start on every API level (see §4.2 — **I confirmed this one**) | `…/android/build.gradle:26` |
| GATE 4 briefing | P2 | `night` period wraps midnight → night section renders above morning | `src/lib/partnerBriefing/pipeline.ts:513` |
| GATE 4 briefing/iOS/android | P2/P3 | `maxInputTextGraphemes` means per-record in TS but per-request in **both** native parsers → batches hard-rejected, silent deterministic fallback | `pipeline.ts:379`, `OnDeviceBriefingPlugin.swift:144` |
| GATE 4 iOS | P2 | Verifier throws `TypeError` instead of fail-closing on excess choices → kills refinement for the whole run | `src/lib/partnerBriefing/verify.ts:503` |
| GATE 4 iOS | P3 | `promptOverheadUtf8Bytes` declares 256 but the rewritten instructions cost 295 bytes | `OnDeviceBriefing.swift:46` |
| GATE 2 auth | P2/P3 | Unbounded splash wait; logout escape gated on the broken network; sign-in with no buttons if the GoTrue probe stalls | `store.tsx:426,3791`, `supabase.ts:63` |
| GATE 3 records | P2/P3 | Dropped realtime channel strands a private caption; composer retry duplicates a record; unguarded `crypto.randomUUID` | `SharedProfile.tsx:138`, `ComposePage.tsx:287`, `store.tsx:2500,2793` |
| GATE 1 startup | P3 | Consumed OAuth callback URL replayed on in-app reload → false "login failed" toast | `src/lib/deepLinks.ts:201` |
| GATE 2 couple | P3 | Partner-day receipt (former partner's record ids) survives unlink, sign-out and account deletion | `src/lib/store.tsx:3740` |
| GATE 6 ux | P3 | "N개 더 보기" promises the full remaining count but reveals 20 | `PartnerBriefingCard.tsx:241` |
| GATE 7 release | P2 | Store-submission checklist builds without the release flag → production legal-identity guard never runs | `docs/kiro/NATIVE_RELEASE_GUIDE.md:331` |

One audit note requires correction before use: the Android agent reported
`src/lib/partnerBriefing/onDeviceBriefingAndroidBridge.ts` "DOES NOT EXIST; only its test does".
That is accurate — the shared adapter is `nativeOnDeviceBriefing.ts`.

---

## 6. Verified healthy — hypotheses raised and then killed by evidence

Recorded so they are not re-investigated:

- **`NSPrivacyAccessedAPITypes` empty is correct.** `iosPrivacyManifest.test.ts` scans the actual
  Swift sources plus the pods named in `ios/App/Podfile` for every symbol in the five
  required-reason categories, and asserts emptiness matches that measurement.
- **Missing `NSPhotoLibraryUsageDescription` is correct.** Media is picked with web
  `<input type="file">`, which WKWebView routes to the out-of-process PHPicker/UIDocumentPicker.
  No `PHPhotoLibrary` / `UIImagePickerController` anywhere in native sources. `Info.plist:90`
  documents exactly this.
- **Missing `com.apple.developer.applesignin` is correct.** `signInWithApple()` calls
  `startOAuth('apple')` — the same Supabase web OAuth path as Google. Nothing calls
  `ASAuthorizationAppleIDProvider`.
- **GATE 4 "Compression, not Selection" holds.** `pipeline.test.ts:503` at 30/100/300 records under a
  forced small envelope asserts exact ordered equality of every source id in both the overview and
  the flattened hierarchy, *and* `allResultItems.length < count`, *and* `callHistory.length > 1`.
  It would fail on any Top-N loss and on any absence of compression. Non-vacuous.
- **In-app account deletion exists** (`store.tsx:3809`, `deleteAccountFromDB`,
  `supabase/functions/delete-account/`, retry UI in `App.tsx`). Whether the edge function is
  *deployed* is a separate, unverified question.
- **Capacitor config is clean for GATE 1**: no `server.url`, so no external-website failure mode;
  `webContentsDebuggingEnabled: false` on both platforms.

---

## 7. Not done / blocked / unverified

| Item | State | Reason |
|---|---|---|
| API 23–25 emulator boot | **BLOCKED** | Emulator demands 7,372.80 MB for userdata; host has ~3.6 GB free (disk 99% full, 187 GB used). `-partition-size` and `config.ini disk.dataPartition.size` overrides were both ignored. |
| Whether ML Kit init crashes on API 23–25 | **UNVERIFIED** | Follows directly from the blocked emulator; §4.2 makes this the most important open question. |
| Physical Samsung / Android device | **NOT PERFORMED** | No Android device connected (`system_profiler` shows none). |
| iPhone cold-start timing | **BLOCKED** | Device went to `unavailable` mid-measurement (CoreDeviceError 4016). Needs reconnect + unlock. |
| In-app iPhone UX (login, couple, records, briefing) | **NOT PERFORMED** | Requires manual interaction; `webContentsDebuggingEnabled: false` also prevents Safari Web Inspector attachment. |
| `supabase-rls` audit dimension | **NOT RETURNED** | Workflow stopped for wrap-up before it completed. |
| Adversarial verification of the 35 audit leads | **NOT COMPLETE** | 1 verdict recorded. §5 is unverified. |
| Remote Supabase / Vercel / Apple / TestFlight | **UNCHANGED** | Out of scope by instruction; nothing touched. |

Host side effects to be aware of: the Android SDK install added ~7.9 GB to a disk that was already
near capacity. `~/Library/Android/sdk` can be removed to reclaim it. `.env` was copied into this
worktree at the user's direction; it is ignored by `.gitignore:23` and absent from `git status`.

---

## 8. Recommended next order of work

1. **Triage §5 before building anything.** 35 leads, essentially unverified. The three that would
   change the release most if real: the `normalize.ts:118` P0 (briefing dead for legacy-plaintext
   couples), `OnboardingPage.tsx:1044` (required consent docs unreachable on iOS), and
   `store.tsx:1216` (offline foreground ejects the user).
2. **Settle §4.2** — boot API 24 once disk allows, and either fix
   `PARTNER_BRIEFING_ARCHITECTURE.md:189` or suppress the provider via
   `tools:node="remove"` if pre-26 loading proves unsafe.
3. **GATE 1** — the §3.4 duplicate `registerPlugin` is a safe first change.
4. **GATE 7** — §3.1 and §3.2 are documentation/test-accuracy fixes with no runtime risk.
5. Push (§3.3) is an owner scheduling decision, not an engineering fix.

## Rollback

Nothing to roll back in the repository: no source file was modified, and HEAD is unchanged.
Host-level changes are confined to `~/Library/Android/sdk`, `android/local.properties` (ignored),
and the copied `.env` (ignored) — all removable without touching the repository.
