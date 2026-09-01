import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

/// On-device rewriting of daily summary lines, and nothing else.
///
/// ## What this type is allowed to know
///
/// An ordinal index and a short line of text. It never receives a record id, a
/// user id, a date, a time or an attachment reference, because the Capacitor
/// contract does not carry them (see `src/definitions.ts`). So there is no value
/// in scope here that could identify a record, a person or a day even by
/// accident.
///
/// ## What it must never do
///
/// - Decide which moments matter. The set and the order are fixed by
///   `src/lib/dailySummary/corpus.ts` before this file is reached.
/// - Infer or assess emotion, mood, health, pain, cycle or relationship state.
///   The instructions forbid it explicitly, and the TypeScript verifier does not
///   trust the instructions: it enforces count, order, index identity and
///   length, and discards the whole batch on any violation.
/// - Persist, transmit or log anything. A fresh session per request means there
///   is no transcript to rehydrate; nothing here writes a file, opens a
///   connection, or submits feedback to Apple.
///
/// ## Logging
///
/// Nothing in this file prints. Not the input lines, not the model output, not
/// the prompt, not the error. That is deliberate: the input is a person's diary
/// summarised, and a device console copy of it is a copy of the diary.
///
/// ## Verification status
///
/// Availability gating, guided decoding and cancellation are STRUCTURAL and
/// compile-checked. Whether Apple's system model actually produces acceptable
/// Korean output is **UNVERIFIED**: it requires an Apple-Intelligence-eligible
/// physical iPhone with the model downloaded. A simulator build proves that this
/// compiles and that the bridge is wired, and proves nothing about the model.
struct OnDeviceSummaryLine {
    let index: Int
    let text: String
}

enum OnDeviceSummaryUnavailableReason: String {
    /// The framework exists in this build, but this device is below iOS 26.
    case osTooOld = "os_too_old"
    /// Compiled against an SDK without FoundationModels. A packaging fact.
    case frameworkMissing = "framework_missing"
    /// Apple Intelligence is not enabled, not eligible, or still downloading.
    case modelUnavailable = "model_unavailable"
    case localeUnsupported = "locale_unsupported"
}

enum OnDeviceSummaryError: Error {
    case unavailable(OnDeviceSummaryUnavailableReason)
    case badRequest
    /// The model returned more entries than were requested. The TypeScript
    /// verifier would reject it anyway; this keeps an unbounded array off the
    /// bridge in the first place.
    case malformedOutput
    case generationFailed
}

enum OnDeviceSummary {
    static let defaultLocaleIdentifier = "ko_KR"

    /// Mirrors `MAX_DAILY_SUMMARY_LINES` in `src/lib/dailySummary/contract.ts`.
    static let maxLines = 5

    /// Mirrors `MAX_DAILY_SUMMARY_LINE_CHARS`. Compared in UTF-16 units so the
    /// native bound is the same measurement JavaScript's `String.length` uses;
    /// grapheme counting would quietly admit lines the web side calls too long.
    static let maxLineCharacters = 40

    /// Five lines of at most forty Korean characters, plus guided-output
    /// scaffolding. Bounded because an unexpectedly verbose response is the one
    /// failure mode that costs the user a visible wait.
    static let maximumResponseTokens = 512

    /// Fact-only rewriting. Every clause here has a matching negative check on
    /// the TypeScript side, because instructions are guidance and not a control.
    static let instructions = """
    당신은 이미 만들어진 하루 기록 목록의 문장을 다듬는 편집기다.

    규칙:
    - 항목 수와 순서를 입력 그대로 유지한다. 항목을 추가·삭제·재배열하지 않는다.
    - index는 입력값을 그대로 복사한다.
    - 입력 문장에 없는 사실을 만들지 않는다. 추측·해석·조언·위로를 쓰지 않는다.
    - 감정, 기분, 건강, 통증, 생리주기, 신체 상태, 관계 상태를 추론하거나 평가하지 않는다.
    - 무엇이 더 중요한지 판단하지 않는다. 강조하거나 순서를 바꾸지 않는다.
    - 각 문장은 한국어로 40자 이내의 사실 서술이다.
    - 다듬을 것이 없으면 입력 문장을 그대로 반환한다.
    """

    /// Whether the model can run here. `nil` means it can.
    static func availability(localeIdentifier: String) -> OnDeviceSummaryUnavailableReason? {
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, *) else { return .osTooOld }
        return systemModelAvailability(localeIdentifier: localeIdentifier)
        #else
        return .frameworkMissing
        #endif
    }

    static func refine(
        localeIdentifier: String,
        items: [OnDeviceSummaryLine]
    ) async throws -> [OnDeviceSummaryLine] {
        guard !items.isEmpty, items.count <= maxLines else {
            throw OnDeviceSummaryError.badRequest
        }
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, *) else {
            throw OnDeviceSummaryError.unavailable(.osTooOld)
        }
        return try await refineWithSystemModel(localeIdentifier: localeIdentifier, items: items)
        #else
        throw OnDeviceSummaryError.unavailable(.frameworkMissing)
        #endif
    }

    /// The prompt. Index and text only — the same two fields the bridge received.
    static func prompt(for items: [OnDeviceSummaryLine]) -> String {
        let listed = items.map { "\($0.index). \($0.text)" }.joined(separator: "\n")
        return """
        다음 목록의 각 문장을 다듬어라. 항목 수와 순서를 그대로 유지하고 index를 그대로 복사하라.

        \(listed)
        """
    }
}

#if canImport(FoundationModels)

/// One rewritten line. `index` is returned as the model produced it, NOT
/// repaired here: the TypeScript verifier compares it against the requested
/// position, and silently renumbering would hide a reordering from the only
/// check that can catch it.
@available(iOS 26.0, *)
@Generable
struct RefinedSummaryLine {
    @Guide(description: "입력 항목의 index를 그대로 복사한 값")
    var index: Int

    @Guide(description: "같은 항목을 다듬은 한국어 문장. 40자 이내. 사실만.")
    var text: String
}

@available(iOS 26.0, *)
@Generable
struct RefinedSummaryLines {
    @Guide(description: "입력 항목마다 정확히 하나, 입력과 같은 순서")
    var items: [RefinedSummaryLine]
}

extension OnDeviceSummary {
    @available(iOS 26.0, *)
    static func systemModelAvailability(
        localeIdentifier: String
    ) -> OnDeviceSummaryUnavailableReason? {
        let model = SystemLanguageModel.default
        guard model.isAvailable else { return .modelUnavailable }
        guard model.supportsLocale(Locale(identifier: localeIdentifier)) else {
            return .localeUnsupported
        }
        return nil
    }

    @available(iOS 26.0, *)
    static func refineWithSystemModel(
        localeIdentifier: String,
        items: [OnDeviceSummaryLine]
    ) async throws -> [OnDeviceSummaryLine] {
        if let reason = systemModelAvailability(localeIdentifier: localeIdentifier) {
            throw OnDeviceSummaryError.unavailable(reason)
        }
        try Task.checkCancellation()

        /*
         A FRESH session for every request, with no tools.

         Not a reuse oversight. A reused session accumulates a transcript, which
         means the previous person's day is still in the context window when the
         next request runs, and a request that carries yesterday's lines is a
         request that can produce a sentence about a record the app never sent.
         No transcript is rehydrated (`init(model:tools:transcript:)` is never
         used), none is read or serialised, and no feedback attachment is logged.

         `tools: []` is explicit: a tool is a callback into app code, and this
         feature has nothing the model is allowed to reach.
         */
        let session = LanguageModelSession(model: SystemLanguageModel.default, tools: []) {
            OnDeviceSummary.instructions
        }

        // Greedy: the same lines should yield the same wording twice. A sampled
        // decode makes the summary of one unchanged day differ between two
        // openings of the same screen.
        let options = GenerationOptions(
            sampling: .greedy,
            maximumResponseTokens: OnDeviceSummary.maximumResponseTokens
        )

        let response = try await session.respond(
            to: OnDeviceSummary.prompt(for: items),
            generating: RefinedSummaryLines.self,
            options: options
        )
        try Task.checkCancellation()

        let produced = response.content.items
        guard produced.count == items.count else {
            throw OnDeviceSummaryError.malformedOutput
        }
        for (position, line) in produced.enumerated() {
            guard line.index == items[position].index else {
                throw OnDeviceSummaryError.malformedOutput
            }
            let trimmed = line.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, line.text.utf16.count <= OnDeviceSummary.maxLineCharacters else {
                throw OnDeviceSummaryError.malformedOutput
            }
        }
        return produced.map { OnDeviceSummaryLine(index: $0.index, text: $0.text) }
    }
}

#endif

/// Single-flight ownership of the model.
///
/// An actor rather than a lock because the only shared thing is "which request is
/// in flight", and it is read and written from bridge callbacks on different
/// tasks. Two overlapping requests would serialise inside the model and let the
/// older response land after the newer one, overwriting a screen that already
/// moved on; so a new request cancels the previous one before starting.
actor OnDeviceSummaryEngine {
    static let shared = OnDeviceSummaryEngine()

    private var inFlight: (requestId: String, task: Task<[OnDeviceSummaryLine], Error>)?

    /// Cancel `requestId` if it is the one in flight. A stale id is a no-op, not
    /// an error: the caller cancels on unmount without knowing whether the
    /// request already finished.
    func cancel(requestId: String) {
        guard let current = inFlight, current.requestId == requestId else { return }
        current.task.cancel()
        inFlight = nil
    }

    func refine(
        requestId: String,
        localeIdentifier: String,
        items: [OnDeviceSummaryLine]
    ) async throws -> [OnDeviceSummaryLine] {
        if let current = inFlight {
            current.task.cancel()
            inFlight = nil
        }
        if let reason = OnDeviceSummary.availability(localeIdentifier: localeIdentifier) {
            throw OnDeviceSummaryError.unavailable(reason)
        }

        let task = Task<[OnDeviceSummaryLine], Error> {
            try await OnDeviceSummary.refine(localeIdentifier: localeIdentifier, items: items)
        }
        inFlight = (requestId, task)
        defer { if inFlight?.requestId == requestId { inFlight = nil } }
        return try await task.value
    }
}
