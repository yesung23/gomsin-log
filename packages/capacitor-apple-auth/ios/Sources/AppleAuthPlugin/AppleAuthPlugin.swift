import AuthenticationServices
import Capacitor
import Foundation
import UIKit

@objc(GomsinlogAppleAuthPlugin)
public final class GomsinlogAppleAuthPlugin: CAPPlugin, CAPBridgedPlugin,
    ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "GomsinlogAppleAuthPlugin"
    public let jsName = "GomsinlogAppleAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCredentialState", returnType: CAPPluginReturnPromise),
    ]

    private static let hashedNonceLength = 64
    private static let maxStateBytes = 128
    private static let maxIdentityTokenBytes = 16_384
    private static let maxAuthorizationCodeBytes = 4_096
    private static let maxUserIdBytes = 512
    private static let maxNameComponentBytes = 256
    private static let maxFormattedNameBytes = 512

    // Accessed only on the main queue. Retaining one call and controller is the
    // native backstop against two authorization sheets or two delivered tokens.
    private var activeCall: CAPPluginCall?
    private var activeState: String?
    private var activeController: ASAuthorizationController?
    private weak var presentationWindow: UIWindow?

    @objc func authorize(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.beginAuthorization(call)
        }
    }

    @objc func getCredentialState(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.readCredentialState(call)
        }
    }

    private func readCredentialState(_ call: CAPPluginCall) {
        guard requireExactKeys(call, expected: ["userId"]),
              let userId = call.getString("userId"),
              isBoundedNonempty(userId, maxBytes: Self.maxUserIdBytes) else {
            call.reject("request is outside the contract", "E_BAD_REQUEST")
            return
        }

        ASAuthorizationAppleIDProvider().getCredentialState(forUserID: userId) { state, error in
            DispatchQueue.main.async {
                guard error == nil else {
                    call.reject("credential state is unavailable", "E_CREDENTIAL_STATE")
                    return
                }
                let value: String
                switch state {
                case .authorized: value = "authorized"
                case .revoked: value = "revoked"
                case .notFound: value = "not_found"
                case .transferred: value = "transferred"
                @unknown default: value = "unknown"
                }
                call.resolve(["state": value])
            }
        }
    }

    private func beginAuthorization(_ call: CAPPluginCall) {
        // Capacitor's native bridge prints the response body before returning it
        // to JS when logging is enabled. Do not produce credentials in that build.
        guard bridge?.config.loggingEnabled == false, !CAPLog.enableLogging else {
            call.reject("credential transport requires disabled bridge logging", "E_LOGGING_ENABLED")
            return
        }
        guard activeCall == nil else {
            call.reject("an Apple authorization is already active", "E_BUSY")
            return
        }
        guard requireExactKeys(call, expected: ["hashedNonce", "state"]),
              let hashedNonce = call.getString("hashedNonce"),
              isLowercaseSha256Hex(hashedNonce),
              let state = call.getString("state"),
              isBoundedNonempty(state, maxBytes: Self.maxStateBytes),
              let window = bridge?.viewController?.view.window else {
            call.reject("request is outside the contract", "E_BAD_REQUEST")
            return
        }

        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = hashedNonce
        request.state = state

        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        activeCall = call
        activeState = state
        activeController = controller
        presentationWindow = window
        controller.performRequests()
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        // `beginAuthorization` refuses to start without this window. The fallback
        // only satisfies the protocol if UIKit tears the validated window down
        // between request creation and presentation.
        presentationWindow ?? UIWindow(frame: .zero)
    }

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization
    ) {
        guard let active = takeActiveAuthorization(controller) else { return }
        guard bridge?.config.loggingEnabled == false, !CAPLog.enableLogging else {
            active.call.reject("credential transport requires disabled bridge logging", "E_LOGGING_ENABLED")
            return
        }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let returnedState = credential.state,
              returnedState == active.state else {
            active.call.reject("authorization state did not match", "E_STATE_MISMATCH")
            return
        }
        guard let identityToken = boundedUtf8(
                  credential.identityToken,
                  maxBytes: Self.maxIdentityTokenBytes
              ),
              let authorizationCode = boundedUtf8(
                  credential.authorizationCode,
                  maxBytes: Self.maxAuthorizationCodeBytes
              ),
              isBoundedNonempty(credential.user, maxBytes: Self.maxUserIdBytes),
              let fullName = boundedFullName(credential.fullName) else {
            active.call.reject("authorization response was unusable", "E_MALFORMED_RESPONSE")
            return
        }

        var result: [String: Any] = [
            "status": "success",
            "identityToken": identityToken,
            "authorizationCode": authorizationCode,
            "userId": credential.user,
            "state": returnedState,
        ]
        result["fullName"] = fullName ?? NSNull()
        active.call.resolve(result)
    }

    public func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error
    ) {
        guard let active = takeActiveAuthorization(controller) else { return }
        guard bridge?.config.loggingEnabled == false, !CAPLog.enableLogging else {
            active.call.reject("credential transport requires disabled bridge logging", "E_LOGGING_ENABLED")
            return
        }
        let nsError = error as NSError
        if nsError.domain == ASAuthorizationError.errorDomain,
           nsError.code == ASAuthorizationError.canceled.rawValue {
            active.call.resolve([
                "status": "cancelled",
                "state": active.state,
            ])
            return
        }
        active.call.reject("Apple authorization failed", "E_AUTHORIZATION")
    }

    private func takeActiveAuthorization(_ controller: ASAuthorizationController) -> (call: CAPPluginCall, state: String)? {
        guard controller === activeController,
              let call = activeCall, let state = activeState else { return nil }
        activeCall = nil
        activeState = nil
        activeController = nil
        presentationWindow = nil
        return (call, state)
    }

    private func boundedFullName(_ components: PersonNameComponents?) -> [String: String]?? {
        guard let components else { return .some(nil) }
        let values: [(String, String?)] = [
            ("namePrefix", components.namePrefix),
            ("givenName", components.givenName),
            ("middleName", components.middleName),
            ("familyName", components.familyName),
            ("nameSuffix", components.nameSuffix),
            ("nickname", components.nickname),
        ]
        var result: [String: String] = [:]
        for (key, value) in values {
            guard let value else { continue }
            if value.isEmpty { continue }
            guard value.utf8.count <= Self.maxNameComponentBytes else {
                return nil
            }
            result[key] = value
        }
        let formatted = PersonNameComponentsFormatter.localizedString(
            from: components,
            style: .default,
            options: []
        )
        if !formatted.isEmpty {
            guard formatted.utf8.count <= Self.maxFormattedNameBytes else { return nil }
            result["formatted"] = formatted
        }
        return .some(result.isEmpty ? nil : result)
    }

    private func boundedUtf8(_ data: Data?, maxBytes: Int) -> String? {
        guard let data,
              !data.isEmpty,
              data.count <= maxBytes,
              let value = String(data: data, encoding: .utf8),
              isBoundedNonempty(value, maxBytes: maxBytes) else {
            return nil
        }
        return value
    }

    private func requireExactKeys(_ call: CAPPluginCall, expected: Set<String>) -> Bool {
        Set(call.options.keys.compactMap { $0 as? String }) == expected
    }

    private func isLowercaseSha256Hex(_ value: String) -> Bool {
        value.utf8.count == Self.hashedNonceLength && value.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (97...102).contains(byte)
        }
    }

    private func isBoundedNonempty(_ value: String, maxBytes: Int) -> Bool {
        !value.isEmpty && value.utf8.count <= maxBytes
    }
}
