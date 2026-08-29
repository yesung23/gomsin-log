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

struct OnDeviceBriefingGroup: Sendable {
    let groupOrdinal: Int
    let choices: [OnDeviceBriefingChoice]
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
    static let responseReserveUtf8Bytes = 512
    static let maxInputTextGraphemes = 1000
    static let maxItems = 64
    static let maxCandidatesPerItem = 32
    static let maximumResponseTokens = 512

    /// The model instructions. Sent verbatim, and counted verbatim by
    /// `promptOverheadUtf8Bytes` below -- there is no second copy of this text.
    static let instructions = """
    Group contiguous items into groups of 2–4; use a singleton only when the request contains exactly one item. Choose one supplied candidate for every item. Return only groupOrdinal, itemOrdinal, and candidateOrdinal. Keep every item once and in order across groups. Never write text.
    """

    /// The fixed text that precedes the items JSON in every prompt.
    /// `prompt(itemsJSON:)` is the only consumer, so the prefix cannot drift from what
    /// the byte budget below accounts for.
    static let promptItemsPrefix = "Items JSON:\n"

    /// Budget reserved for everything in the prompt that is NOT the items JSON.
    ///
    /// This was the literal 256 while the real static prompt measured 295 bytes
    /// (283 for the instructions, which contain a 3-byte en dash, plus 12 for the prefix).
    /// The advertised figure is what the JS batcher subtracts from `maxContextUtf8Bytes`
    /// to decide how much payload fits, so under-declaring it let the batcher build a
    /// request 39 bytes larger than the device actually had room for.
    ///
    /// Derived from the SAME two strings the prompt is built from, so editing either one
    /// moves this number with it, and rounded UP to the next 64 bytes so the declared
    /// budget is always conservative rather than exact-to-the-byte.
    static let promptOverheadUtf8Bytes: Int = {
        let staticPromptBytes = instructions.utf8.count + promptItemsPrefix.utf8.count
        let granularity = 64
        return ((staticPromptBytes + granularity - 1) / granularity) * granularity
    }()

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
        promptItemsPrefix + itemsJSON
    }

    static func select(
        locale: String,
        items: [OnDeviceBriefingItem],
        itemsJSON: String
    ) async throws -> [OnDeviceBriefingGroup] {
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
struct GeneratedBriefingGroup {
    @Guide(description: "Sequential 0-indexed group ordinal")
    var groupOrdinal: Int

    @Guide(description: "Contiguous choices for this group, keeping request order")
    var choices: [GeneratedBriefingChoice]
}

@available(iOS 26.0, *)
@Generable
struct GeneratedBriefingPlan {
    @Guide(description: "Sequential groups covering all request items in order")
    var groups: [GeneratedBriefingGroup]
}

extension OnDeviceBriefing {
    @available(iOS 26.0, *)
    static func selectWithSystemModel(
        locale: String,
        items: [OnDeviceBriefingItem],
        itemsJSON: String
    ) async throws -> [OnDeviceBriefingGroup] {
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
            guard response.content.groups.count <= items.count else {
                throw OnDeviceBriefingError.malformedOutput
            }
            return response.content.groups.map { group in
                OnDeviceBriefingGroup(
                    groupOrdinal: group.groupOrdinal,
                    choices: group.choices.map { choice in
                        OnDeviceBriefingChoice(
                            itemOrdinal: choice.itemOrdinal,
                            candidateOrdinal: choice.candidateOrdinal
                        )
                    }
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
    private static let maximumPendingCancellations = 32

    private var inFlight: (
        requestId: String,
        task: Task<[OnDeviceBriefingGroup], Error>
    )?
    private var cancelledBeforeStart: [String] = []

    func cancel(requestId: String) {
        if let current = inFlight, current.requestId == requestId {
            current.task.cancel()
            inFlight = nil
            return
        }

        guard !cancelledBeforeStart.contains(requestId) else { return }
        cancelledBeforeStart.append(requestId)
        if cancelledBeforeStart.count > Self.maximumPendingCancellations {
            cancelledBeforeStart.removeFirst(
                cancelledBeforeStart.count - Self.maximumPendingCancellations
            )
        }
    }

    func select(
        requestId: String,
        locale: String,
        items: [OnDeviceBriefingItem],
        itemsJSON: String
    ) async throws -> [OnDeviceBriefingGroup] {
        if let cancelledIndex = cancelledBeforeStart.firstIndex(of: requestId) {
            cancelledBeforeStart.remove(at: cancelledIndex)
            throw CancellationError()
        }

        if let current = inFlight {
            current.task.cancel()
            inFlight = nil
        }
        let currentAvailability = OnDeviceBriefing.availability(locale: locale)
        guard currentAvailability == .ready else {
            throw OnDeviceBriefingError.unavailable(currentAvailability)
        }

        let task = Task<[OnDeviceBriefingGroup], Error> {
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
