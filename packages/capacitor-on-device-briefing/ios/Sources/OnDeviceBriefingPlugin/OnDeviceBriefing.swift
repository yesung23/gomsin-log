import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

struct OnDeviceBriefingCandidate: Sendable {
    let candidateOrdinal: Int
    let text: String
}

struct OnDeviceBriefingItem: Sendable {
    let itemOrdinal: Int
    let candidates: [OnDeviceBriefingCandidate]
}

struct OnDeviceBriefingChoice: Sendable {
    let itemOrdinal: Int
    let candidateOrdinal: Int
}

enum OnDeviceBriefingAvailability: String {
    case ready
    case unsupported
    case modelUnavailable = "model_unavailable"
    case preparing
    case localeUnsupported = "locale_unsupported"
}

enum OnDeviceBriefingError: Error {
    case unavailable(OnDeviceBriefingAvailability)
    case badRequest
    case malformedOutput
    case busy
    case quota
    case nativeFailure
}

enum OnDeviceBriefing {
    static let maxContextUtf8Bytes = 4096
    static let promptOverheadUtf8Bytes = 256
    static let responseReserveUtf8Bytes = 512
    static let maxInputTextGraphemes = 1000
    static let maxItems = 64
    static let maxCandidatesPerItem = 32
    static let maximumResponseTokens = 512

    static let instructions = """
    Choose one supplied candidate for every item. Return only itemOrdinal and candidateOrdinal. Keep every item once and in order. Never write text.
    """

    static func localeIdentifier(for locale: String) -> String? {
        switch locale {
        case "ko": return "ko_KR"
        case "en": return "en_US"
        default: return nil
        }
    }

    static func availability(locale: String) -> OnDeviceBriefingAvailability {
        guard let localeIdentifier = localeIdentifier(for: locale) else {
            return .localeUnsupported
        }
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, *) else { return .unsupported }
        let model = SystemLanguageModel.default
        switch model.availability {
        case .available:
            return model.supportsLocale(Locale(identifier: localeIdentifier))
                ? .ready
                : .localeUnsupported
        case .unavailable(.modelNotReady):
            return .preparing
        case .unavailable(.deviceNotEligible),
             .unavailable(.appleIntelligenceNotEnabled):
            return .modelUnavailable
        @unknown default:
            return .modelUnavailable
        }
        #else
        return .unsupported
        #endif
    }

    static func prompt(itemsJSON: String) -> String {
        "Items JSON:\n\(itemsJSON)"
    }

    static func select(
        locale: String,
        items: [OnDeviceBriefingItem],
        itemsJSON: String
    ) async throws -> [OnDeviceBriefingChoice] {
        guard !items.isEmpty, items.count <= maxItems else {
            throw OnDeviceBriefingError.badRequest
        }
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, *) else {
            throw OnDeviceBriefingError.unavailable(.unsupported)
        }
        return try await selectWithSystemModel(
            locale: locale,
            items: items,
            itemsJSON: itemsJSON
        )
        #else
        throw OnDeviceBriefingError.unavailable(.unsupported)
        #endif
    }
}

#if canImport(FoundationModels)

@available(iOS 26.0, *)
@Generable
struct GeneratedBriefingChoice {
    @Guide(description: "Copy an itemOrdinal from the request")
    var itemOrdinal: Int

    @Guide(description: "Choose one candidateOrdinal supplied for that item")
    var candidateOrdinal: Int
}

@available(iOS 26.0, *)
@Generable
struct GeneratedBriefingPlan {
    @Guide(description: "Exactly one choice for each request item, in request order")
    var choices: [GeneratedBriefingChoice]
}

extension OnDeviceBriefing {
    @available(iOS 26.0, *)
    static func selectWithSystemModel(
        locale: String,
        items: [OnDeviceBriefingItem],
        itemsJSON: String
    ) async throws -> [OnDeviceBriefingChoice] {
        let currentAvailability = availability(locale: locale)
        guard currentAvailability == .ready else {
            throw OnDeviceBriefingError.unavailable(currentAvailability)
        }
        try Task.checkCancellation()

        let session = LanguageModelSession(model: SystemLanguageModel.default, tools: []) {
            instructions
        }
        let options = GenerationOptions(
            sampling: .greedy,
            maximumResponseTokens: maximumResponseTokens
        )

        do {
            let response = try await session.respond(
                to: prompt(itemsJSON: itemsJSON),
                generating: GeneratedBriefingPlan.self,
                options: options
            )
            try Task.checkCancellation()
            guard response.content.choices.count <= items.count else {
                throw OnDeviceBriefingError.malformedOutput
            }
            return response.content.choices.map {
                OnDeviceBriefingChoice(
                    itemOrdinal: $0.itemOrdinal,
                    candidateOrdinal: $0.candidateOrdinal
                )
            }
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as OnDeviceBriefingError {
            throw error
        } catch let error as LanguageModelSession.GenerationError {
            switch error {
            case .rateLimited:
                throw OnDeviceBriefingError.quota
            case .concurrentRequests:
                throw OnDeviceBriefingError.busy
            case .unsupportedLanguageOrLocale:
                throw OnDeviceBriefingError.unavailable(.localeUnsupported)
            case .exceededContextWindowSize,
                 .guardrailViolation,
                 .unsupportedGuide,
                 .decodingFailure,
                 .refusal:
                throw OnDeviceBriefingError.malformedOutput
            case .assetsUnavailable:
                throw OnDeviceBriefingError.unavailable(.preparing)
            @unknown default:
                throw OnDeviceBriefingError.nativeFailure
            }
        } catch {
            throw OnDeviceBriefingError.nativeFailure
        }
    }
}

#endif

actor OnDeviceBriefingEngine {
    static let shared = OnDeviceBriefingEngine()

    private var inFlight: (
        requestId: String,
        task: Task<[OnDeviceBriefingChoice], Error>
    )?

    func cancel(requestId: String) {
        guard let current = inFlight, current.requestId == requestId else { return }
        current.task.cancel()
        inFlight = nil
    }

    func select(
        requestId: String,
        locale: String,
        items: [OnDeviceBriefingItem],
        itemsJSON: String
    ) async throws -> [OnDeviceBriefingChoice] {
        if let current = inFlight {
            current.task.cancel()
            inFlight = nil
        }
        let currentAvailability = OnDeviceBriefing.availability(locale: locale)
        guard currentAvailability == .ready else {
            throw OnDeviceBriefingError.unavailable(currentAvailability)
        }

        let task = Task<[OnDeviceBriefingChoice], Error> {
            try await OnDeviceBriefing.select(
                locale: locale,
                items: items,
                itemsJSON: itemsJSON
            )
        }
        inFlight = (requestId, task)
        defer {
            if inFlight?.requestId == requestId {
                inFlight = nil
            }
        }
        return try await task.value
    }
}
