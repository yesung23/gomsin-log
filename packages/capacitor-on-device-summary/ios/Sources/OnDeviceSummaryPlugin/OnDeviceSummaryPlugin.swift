import Foundation
import CoreFoundation
import Capacitor

/// The Capacitor bridge for `OnDeviceSummary`.
///
/// This class is a TRANSLATION LAYER. It validates what crosses the JSON
/// boundary, delegates to `OnDeviceSummaryEngine`, and turns failures into a
/// bounded code. It makes no decision about which moments are summarised and it
/// never rewrites text itself.
///
/// ## Input validation is a contract check, not defensive noise
///
/// The web side promises exactly three things about `items`: two fields per
/// entry, indices that are `0..n-1` in ascending order, and source text within
/// the 120-UTF-16-unit bound. All three are re-checked here. Generated excerpts
/// have a separate 40-unit bound. If the bridge accepted a looser payload, a
/// future caller could send a longer source or an arbitrary index and the only
/// evidence would be in the model's output.
///
/// ## Logging
///
/// Nothing here logs. Not the items, not the prompt, not the result, not the
/// error text. Rejections carry a stable code and a fixed message with no
/// content in it, which is what lets the TypeScript side report a failure reason
/// without ever having a user sentence in an error path.
///
/// ## Registration
///
/// `CAPBridgedPlugin` is the Swift-only registration path Capacitor 7 uses, so
/// there is no Objective-C `.m` macro file. `jsName` must match the name
/// `registerPlugin<OnDeviceSummaryPlugin>('GomsinlogOnDeviceSummary')` uses, and
/// each `pluginMethod` name must match an `@objc` selector below — a mismatch
/// fails only at runtime, which is why `src/lib/dailySummary/onDeviceSummaryBridge.test.ts`
/// compares the three lists.
///
/// ## Verification status
///
/// Compilation and bridge wiring are checkable here. Whether Apple's on-device
/// model runs and what it produces is **UNVERIFIED**: it needs an
/// Apple-Intelligence-eligible physical iPhone, and a simulator is not one.
@objc(GomsinlogOnDeviceSummaryPlugin)
public class GomsinlogOnDeviceSummaryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GomsinlogOnDeviceSummaryPlugin"
    public let jsName = "GomsinlogOnDeviceSummary"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "refineLines", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    ]

    // MARK: - Availability

    /// Resolves rather than rejects. "Unavailable" is an ordinary answer here,
    /// and the caller's response to it is identical either way.
    @objc func availability(_ call: CAPPluginCall) {
        let locale = call.getString("locale") ?? OnDeviceSummary.defaultLocaleIdentifier
        if let reason = OnDeviceSummary.availability(localeIdentifier: locale) {
            call.resolve(["available": false, "reason": reason.rawValue])
        } else {
            call.resolve(["available": true, "reason": "ready"])
        }
    }

    // MARK: - Refinement

    @objc func refineLines(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId"), !requestId.isEmpty else {
            call.reject("requestId must be a non-empty string", "E_BAD_REQUEST")
            return
        }
        let locale = call.getString("locale") ?? OnDeviceSummary.defaultLocaleIdentifier
        guard let items = parseItems(call) else { return }

        Task {
            do {
                let refined = try await OnDeviceSummaryEngine.shared.refine(
                    requestId: requestId,
                    localeIdentifier: locale,
                    items: items
                )
                call.resolve([
                    "requestId": requestId,
                    "items": refined.map { ["index": $0.index, "text": $0.text] },
                ])
            } catch is CancellationError {
                call.reject("on-device summary was cancelled", "E_CANCELLED")
            } catch let error as OnDeviceSummaryError {
                call.reject(Self.message(for: error), Self.code(for: error))
            } catch {
                // A framework error's text could carry arbitrary detail, so only
                // a fixed string crosses the boundary.
                call.reject("on-device summary did not produce a result", "E_ON_DEVICE_SUMMARY")
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId"), !requestId.isEmpty else {
            call.reject("requestId must be a non-empty string", "E_BAD_REQUEST")
            return
        }
        Task {
            await OnDeviceSummaryEngine.shared.cancel(requestId: requestId)
            call.resolve([:])
        }
    }

    // MARK: - Boundary helpers

    /// The three promises the web side makes about `items`, re-checked. Source
    /// text is bounded at 120 UTF-16 units; the generated excerpt has its own
    /// 40-unit bound in the Foundation Models path.
    ///
    /// Rejects the call and returns `nil` on any violation, naming WHICH promise
    /// broke in a message that contains no user text.
    private func parseItems(_ call: CAPPluginCall) -> [OnDeviceSummaryLine]? {
        guard let raw = call.getArray("items") else {
            call.reject("items must be an array", "E_BAD_REQUEST")
            return nil
        }
        guard !raw.isEmpty, raw.count <= OnDeviceSummary.maxLines else {
            call.reject("items count is outside the contract", "E_BAD_REQUEST")
            return nil
        }

        var parsed: [OnDeviceSummaryLine] = []
        for element in raw {
            guard let entry = element as? [String: Any] else {
                call.reject("items entry must be an object", "E_BAD_REQUEST")
                return nil
            }
            guard Set(entry.keys) == Set(["index", "text"]) else {
                call.reject("items entry must contain only index and text", "E_BAD_REQUEST")
                return nil
            }
            // JSON numbers arrive as NSNumber. Compare the exact numeric value
            // instead of using `intValue`, which would silently turn 0.5 into 0.
            // CFBoolean is also an NSNumber subclass, so reject it explicitly.
            guard let indexNumber = entry["index"] as? NSNumber,
                  CFGetTypeID(indexNumber) != CFBooleanGetTypeID(),
                  indexNumber.doubleValue == Double(parsed.count),
                  let text = entry["text"] as? String else {
                call.reject("items entry must carry index and text", "E_BAD_REQUEST")
                return nil
            }
            let index = parsed.count
            guard !text.isEmpty, text.utf16.count <= OnDeviceSummary.maxSourceCharacters else {
                call.reject("items text is outside the length contract", "E_BAD_REQUEST")
                return nil
            }
            parsed.append(OnDeviceSummaryLine(index: index, text: text))
        }
        return parsed
    }

    private static func code(for error: OnDeviceSummaryError) -> String {
        switch error {
        case .unavailable: return "E_UNAVAILABLE"
        case .badRequest: return "E_BAD_REQUEST"
        case .malformedOutput, .generationFailed: return "E_ON_DEVICE_SUMMARY"
        }
    }

    /// Fixed strings only. The reason code is bounded and carries no content.
    private static func message(for error: OnDeviceSummaryError) -> String {
        switch error {
        case .unavailable(let reason): return "on-device summary unavailable: \(reason.rawValue)"
        case .badRequest: return "request is outside the contract"
        case .malformedOutput: return "on-device summary returned an unusable shape"
        case .generationFailed: return "on-device summary did not produce a result"
        }
    }
}
