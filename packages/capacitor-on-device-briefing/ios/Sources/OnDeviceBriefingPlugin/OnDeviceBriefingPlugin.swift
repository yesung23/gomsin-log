import Foundation
import Capacitor

@objc(GomsinlogOnDeviceBriefingPlugin)
public class GomsinlogOnDeviceBriefingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GomsinlogOnDeviceBriefingPlugin"
    public let jsName = "GomsinlogOnDeviceBriefing"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "selectExtracts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    ]

    @objc func availability(_ call: CAPPluginCall) {
        guard requireExactKeys(call, expected: ["locale"]) else {
            reject(call, error: .badRequest)
            return
        }
        let locale = call.getString("locale") ?? ""
        call.resolve([
            "availability": OnDeviceBriefing.availability(locale: locale).rawValue,
        ])
    }

    @objc func capability(_ call: CAPPluginCall) {
        guard requireExactKeys(call, expected: []) else {
            reject(call, error: .badRequest)
            return
        }
        call.resolve([
            "envelope": [
                "maxContextUtf8Bytes": OnDeviceBriefing.maxContextUtf8Bytes,
                "promptOverheadUtf8Bytes": OnDeviceBriefing.promptOverheadUtf8Bytes,
                "responseReserveUtf8Bytes": OnDeviceBriefing.responseReserveUtf8Bytes,
                "maxInputTextGraphemes": OnDeviceBriefing.maxInputTextGraphemes,
                // Structural limits this parser already enforces below. Advertised so the
                // JS batcher stops building requests this plugin will reject outright:
                // a record segmenting into 33 candidates was accepted by JS and refused
                // here, and the couple got deterministic output on a capable device.
                "maxItems": OnDeviceBriefing.maxItems,
                "maxCandidatesPerItem": OnDeviceBriefing.maxCandidatesPerItem,
            ],
        ])
    }

    @objc func selectExtracts(_ call: CAPPluginCall) {
        guard requireExactKeys(call, expected: ["requestId", "locale", "items"]) else {
            reject(call, error: .badRequest)
            return
        }
        guard let requestId = call.getString("requestId"),
              !requestId.isEmpty,
              requestId.utf8.count <= 128,
              let locale = call.getString("locale"),
              OnDeviceBriefing.localeIdentifier(for: locale) != nil,
              let parsed = parseItems(call) else {
            reject(call, error: .badRequest)
            return
        }

        Task {
            do {
                let groups = try await OnDeviceBriefingEngine.shared.select(
                    requestId: requestId,
                    locale: locale,
                    items: parsed.items,
                    itemsJSON: parsed.json
                )
                call.resolve([
                    "requestId": requestId,
                    "output": [
                        "version": 2,
                        "groups": groups.map { group in
                            [
                                "groupOrdinal": group.groupOrdinal,
                                "choices": group.choices.map { choice in
                                    [
                                        "itemOrdinal": choice.itemOrdinal,
                                        "candidateOrdinal": choice.candidateOrdinal,
                                    ]
                                },
                            ]
                        },
                    ],
                ])
            } catch is CancellationError {
                call.reject("on-device briefing was cancelled", "E_CANCELLED")
            } catch let error as OnDeviceBriefingError {
                reject(call, error: error)
            } catch {
                call.reject("on-device briefing failed", "E_NATIVE")
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        guard requireExactKeys(call, expected: ["requestId"]) else {
            reject(call, error: .badRequest)
            return
        }
        guard let requestId = call.getString("requestId"),
              !requestId.isEmpty,
              requestId.utf8.count <= 128 else {
            reject(call, error: .badRequest)
            return
        }
        Task {
            await OnDeviceBriefingEngine.shared.cancel(requestId: requestId)
            call.resolve([:])
        }
    }

    private func parseItems(
        _ call: CAPPluginCall
    ) -> (items: [OnDeviceBriefingItem], json: String)? {
        guard let rawItems = call.getArray("items"),
              !rawItems.isEmpty,
              rawItems.count <= OnDeviceBriefing.maxItems else {
            return nil
        }

        var parsed: [OnDeviceBriefingItem] = []
        var jsonItems: [[String: Any]] = []
        var totalGraphemes = 0

        for rawItem in rawItems {
            guard let entry = rawItem as? [String: Any],
                  Set(entry.keys) == Set(["itemOrdinal", "candidates"]),
                  let itemOrdinal = exactInteger(entry["itemOrdinal"]),
                  itemOrdinal == parsed.count,
                  let rawCandidates = entry["candidates"] as? [Any],
                  !rawCandidates.isEmpty,
                  rawCandidates.count <= OnDeviceBriefing.maxCandidatesPerItem else {
                return nil
            }

            var candidates: [OnDeviceBriefingCandidate] = []
            var jsonCandidates: [[String: Any]] = []
            for rawCandidate in rawCandidates {
                guard let candidate = rawCandidate as? [String: Any],
                      Set(candidate.keys) == Set(["candidateOrdinal", "text"]),
                      let candidateOrdinal = exactInteger(candidate["candidateOrdinal"]),
                      candidateOrdinal == candidates.count,
                      let text = candidate["text"] as? String,
                      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    return nil
                }
                totalGraphemes += text.count
                guard totalGraphemes <= OnDeviceBriefing.maxInputTextGraphemes else {
                    return nil
                }
                candidates.append(.init(candidateOrdinal: candidateOrdinal, text: text))
                jsonCandidates.append([
                    "candidateOrdinal": candidateOrdinal,
                    "text": text,
                ])
            }

            parsed.append(.init(itemOrdinal: itemOrdinal, candidates: candidates))
            jsonItems.append([
                "itemOrdinal": itemOrdinal,
                "candidates": jsonCandidates,
            ])
        }

        guard JSONSerialization.isValidJSONObject(jsonItems),
              let data = try? JSONSerialization.data(withJSONObject: jsonItems),
              data.count + OnDeviceBriefing.promptOverheadUtf8Bytes
                  + OnDeviceBriefing.responseReserveUtf8Bytes
                  <= OnDeviceBriefing.maxContextUtf8Bytes,
              let json = String(data: data, encoding: .utf8) else {
            return nil
        }
        return (parsed, json)
    }

    private func requireExactKeys(_ call: CAPPluginCall, expected: Set<String>) -> Bool {
        let actualKeys = Set(call.options.keys.compactMap { $0 as? String })
        return actualKeys == expected
    }

    private func exactInteger(_ value: Any?) -> Int? {
        if value is Bool { return nil }
        if let integer = value as? Int { return integer >= 0 ? integer : nil }
        guard let number = value as? NSNumber else { return nil }
        let integer = number.intValue
        return integer >= 0 && number.doubleValue == Double(integer) ? integer : nil
    }

    private func reject(_ call: CAPPluginCall, error: OnDeviceBriefingError) {
        switch error {
        case .unavailable:
            call.reject("on-device briefing unavailable", "E_UNAVAILABLE")
        case .badRequest:
            call.reject("request is outside the contract", "E_BAD_REQUEST")
        case .malformedOutput:
            call.reject("on-device briefing returned an unusable shape", "E_MALFORMED")
        case .busy:
            call.reject("on-device briefing is busy", "E_BUSY")
        case .quota:
            call.reject("on-device briefing quota unavailable", "E_QUOTA")
        case .nativeFailure:
            call.reject("on-device briefing failed", "E_NATIVE")
        }
    }
}
