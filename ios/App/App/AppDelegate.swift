import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        excludeLocalDataFromBackup()
        return true
    }

    /// iOS 27 refuses to launch apps built with the current SDK unless they
    /// adopt the scene life cycle. The named configuration is declared in
    /// Info.plist and keeps the existing Main storyboard / Capacitor bridge.
    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        return UISceneConfiguration(
            name: "Default Configuration",
            sessionRole: connectingSceneSession.role
        )
    }

    /// Keep local diary and session data out of iCloud and encrypted device backups.
    ///
    /// On iOS everything under `Library/` except `Caches/` is backed up by
    /// default, and that is where the data we least want copied lives:
    ///
    ///   * `Library/WebKit` -- WKWebView's website data store, which holds the
    ///     `localStorage` the app writes: the Supabase session token and the
    ///     device preferences and any IndexedDB outbox entries awaiting sync.
    ///   * `Library/Cookies` and `Library/HTTPStorages` -- the cookie and
    ///     credential stores backing the same WKWebView.
    ///   * `Library/kvstore` -- Capacitor's own file-backed key/value store
    ///     (node_modules/@capacitor/ios/Capacitor/Capacitor/KeyValueStore.swift).
    ///
    /// This is the iOS counterpart of `android:allowBackup="false"` plus the
    /// `<device-transfer>` exclusions in
    /// `android/app/src/main/res/xml/data_extraction_rules.xml`: a backup of the
    /// phone must not be a plaintext copy of a private diary. The user loses
    /// nothing -- signing in again re-syncs from Supabase.
    ///
    /// `isExcludedFromBackup` is a directory attribute, so it has to be set
    /// before WebKit populates the directory, which is why it runs here rather
    /// than lazily. Failures are logged and non-fatal: a missing exclusion is a
    /// privacy regression, not a reason to refuse to launch.
    private func excludeLocalDataFromBackup() {
        let fileManager = FileManager.default
        guard let library = try? fileManager.url(
            for: .libraryDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ) else {
            CAPLog.print("⚡️ [gomsinlog] Library directory unavailable; backup exclusion skipped.")
            return
        }

        for name in ["WebKit", "Cookies", "HTTPStorages", "kvstore"] {
            var directory = library.appendingPathComponent(name, isDirectory: true)
            do {
                try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                try directory.setResourceValues(values)
            } catch {
                CAPLog.print("⚡️ [gomsinlog] Could not exclude Library/\(name) from backup: \(error)")
            }
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    /// The APNs token, handed to the plugin that is waiting for it.
    ///
    /// Without these two methods iOS push cannot work at all, and it fails in the
    /// worst available way: silently. UIKit delivers the device token to the app
    /// delegate and nowhere else, and `PushNotificationsPlugin` learns of it only
    /// by observing `.capacitorDidRegisterForRemoteNotifications`
    /// (node_modules/@capacitor/push-notifications/.../PushNotificationsPlugin.swift).
    /// `CAPApplicationDelegateProxy` does not forward remote-notification
    /// callbacks -- it handles `openURL` and universal links -- so an app delegate
    /// that omits these bridges every registration into a void.
    ///
    /// What that looked like: `register()` resolves, the token arrives here and is
    /// dropped, neither the `registration` nor the `registrationError` listener in
    /// `src/lib/pushNotifications.ts` ever fires, and the ten-second timeout wins.
    /// The app reports "failed" with no reason, forever, on every iOS device --
    /// and no credential, entitlement or physical device would have fixed it,
    /// because the token never reaches the JavaScript layer to be stored.
    ///
    /// `nativeConfig.test.ts` pins both methods so the next AppDelegate edit
    /// cannot quietly drop them again.
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken
        )
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Posted rather than swallowed: the JavaScript side turns this into a
        // named refusal, and a refusal a user can be told about is worth more
        // than a ten-second wait that ends in nothing.
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
