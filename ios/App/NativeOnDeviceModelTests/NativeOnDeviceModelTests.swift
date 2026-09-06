import Foundation
import XCTest
#if canImport(FoundationModels)
import FoundationModels
#endif

final class NativeOnDeviceModelTests: XCTestCase {
    // This XCTest bundle is hosted by ModelTestHost.app, a UIKit-only process.
    // It exercises engine source directly and does not load the Capacitor app.
    private let summaryLocale = "ko_KR"
    private let briefingLocale = "ko"

    func testSummaryAvailabilityIsReadyOnThisDevice() {
        XCTAssertTrue(requireSummaryAvailability())
    }

    func testBriefingAvailabilityIsReadyOnThisDevice() {
        XCTAssertTrue(requireBriefingAvailability())
    }

    func testSummaryKeepsKoreanSuffixIdentityAndInputOrder() async throws {
        guard requireSummaryAvailability() else { return }

        let input = dailyLines(startingAt: 0, count: 5)
        let output = try await diagnoseSummaryBatch(
            requestId: "summary-korean-order",
            localeIdentifier: summaryLocale,
            items: input,
            runStartedAt: ProcessInfo.processInfo.systemUptime,
        )

        assertSummaryIdentity(output, against: input)
    }

    func testSummaryCompletesTwentySyntheticLinesWithinWholeDayBudget() async throws {
        guard requireSummaryAvailability() else { return }

        let input = dailyLines(startingAt: 0, count: 20)
        let startedAt = ProcessInfo.processInfo.systemUptime
        var completed = 0
        var suffixValid = 0
        defer {
            attachSyntheticJSON("summary-whole-day-total", [
                "requestedCount": input.count,
                "returnedCount": completed,
                "suffixValidCount": suffixValid,
                "elapsedSeconds": ProcessInfo.processInfo.systemUptime - startedAt,
                "budgetSeconds": 4,
            ])
        }

        for batchOffset in stride(from: 0, to: input.count, by: 5) {
            let batch = Array(input[batchOffset..<(batchOffset + 5)])
            let output = try await diagnoseSummaryBatch(
                requestId: "summary-whole-day-\(batchOffset / 5)",
                localeIdentifier: summaryLocale,
                items: batch,
                runStartedAt: startedAt,
            )
            assertSummaryIdentity(output, against: batch)
            completed += output.count
            suffixValid += summarySuffixValidCount(output, against: batch)
        }

        let elapsed = ProcessInfo.processInfo.systemUptime - startedAt
        let formattedElapsed = String(format: "%.3f", elapsed)
        print("[NativeOnDeviceModelTests] summary native returned=\(completed)/20 suffixValid=\(suffixValid) elapsedSeconds=\(formattedElapsed)")
        XCTAssertEqual(completed, 20)
        XCTAssertLessThanOrEqual(elapsed, 4, "Whole-day native summary exceeded the app's 4-second budget")
    }

    func testBriefingSelectsOnlyExactSyntheticCandidatesWithinBudget() async throws {
        guard requireBriefingAvailability() else { return }

        let items = briefingItems()
        let inputJSON = try briefingJSON(items)
        let startedAt = ProcessInfo.processInfo.systemUptime
        let groups: [OnDeviceBriefingGroup]
        do {
            groups = try await OnDeviceBriefingEngine.shared.select(
                requestId: "briefing-korean-candidates",
                locale: briefingLocale,
                items: items,
                itemsJSON: inputJSON,
            )
        } catch {
            attachSyntheticJSON("briefing-korean-candidates-error", [
                "requestId": "briefing-korean-candidates",
                "itemsJSON": inputJSON,
                "elapsedSeconds": ProcessInfo.processInfo.systemUptime - startedAt,
                "returnedCount": 0,
                "errorCode": diagnosticErrorCode(error),
            ])
            throw error
        }
        let elapsed = ProcessInfo.processInfo.systemUptime - startedAt
        let rawGroups: [[String: Any]] = groups.map { group in
            [
                "groupOrdinal": group.groupOrdinal,
                "choices": group.choices.map { choice in
                    ["itemOrdinal": choice.itemOrdinal, "candidateOrdinal": choice.candidateOrdinal]
                },
            ]
        }
        let bounds: [[String: Any]] = groups.flatMap { group in
            group.choices.map { choice in
                let itemInBounds = items.indices.contains(choice.itemOrdinal)
                let candidateInBounds = itemInBounds
                    && items[choice.itemOrdinal].candidates.indices.contains(choice.candidateOrdinal)
                return [
                    "itemOrdinal": choice.itemOrdinal,
                    "candidateOrdinal": choice.candidateOrdinal,
                    "itemInBounds": itemInBounds,
                    "candidateInBounds": candidateInBounds,
                ]
            }
        }
        attachSyntheticJSON("briefing-korean-candidates-output", [
            "requestId": "briefing-korean-candidates",
            "itemsJSON": inputJSON,
            "groups": rawGroups,
            "groupSizes": groups.map { $0.choices.count },
            "bounds": bounds,
            "returnedCount": groups.reduce(0) { $0 + $1.choices.count },
            "elapsedSeconds": elapsed,
            "budgetSeconds": 5,
        ])

        var selectedItemOrdinals: [Int] = []
        for (groupIndex, group) in groups.enumerated() {
            XCTAssertEqual(group.groupOrdinal, groupIndex)
            XCTAssertTrue((2...4).contains(group.choices.count))
            for choice in group.choices {
                XCTAssertTrue(items.indices.contains(choice.itemOrdinal))
                guard items.indices.contains(choice.itemOrdinal) else { continue }
                let candidates = items[choice.itemOrdinal].candidates
                XCTAssertTrue(candidates.indices.contains(choice.candidateOrdinal))
                guard candidates.indices.contains(choice.candidateOrdinal) else { continue }
                // The only selected text is resolved locally from our fixed candidate
                // array. The native response itself contains ordinals, never text.
                XCTAssertFalse(candidates[choice.candidateOrdinal].text.isEmpty)
                selectedItemOrdinals.append(choice.itemOrdinal)
            }
        }

        let formattedElapsed = String(format: "%.3f", elapsed)
        print("[NativeOnDeviceModelTests] briefing native returned=\(selectedItemOrdinals.count)/\(items.count) elapsedSeconds=\(formattedElapsed)")
        XCTAssertEqual(selectedItemOrdinals, Array(items.indices))
        XCTAssertLessThanOrEqual(elapsed, 5, "Native briefing exceeded the app's 5-second budget")
    }

    func testSummaryCancellationBeforeEngineStartDoesNotGenerate() async {
        let requestId = "summary-pre-cancelled"
        await OnDeviceSummaryEngine.shared.cancel(requestId: requestId)

        do {
            _ = try await OnDeviceSummaryEngine.shared.refine(
                requestId: requestId,
                localeIdentifier: summaryLocale,
                items: dailyLines(startingAt: 0, count: 1),
            )
            XCTFail("A pre-cancelled summary request generated a result")
        } catch is CancellationError {
            // Expected: this is a real actor cancellation path, not a mock.
        } catch {
            XCTFail("Expected CancellationError, got \(error)")
        }
    }

    func testBriefingCancellationBeforeEngineStartDoesNotGenerate() async throws {
        let requestId = "briefing-pre-cancelled"
        let items = briefingItems()
        await OnDeviceBriefingEngine.shared.cancel(requestId: requestId)

        do {
            _ = try await OnDeviceBriefingEngine.shared.select(
                requestId: requestId,
                locale: briefingLocale,
                items: items,
                itemsJSON: try briefingJSON(items),
            )
            XCTFail("A pre-cancelled briefing request generated a result")
        } catch is CancellationError {
            // Expected: this is a real actor cancellation path, not a mock.
        } catch {
            XCTFail("Expected CancellationError, got \(error)")
        }
    }

    // Only the fixed fixtures in this file reach these diagnostics. No app data,
    // transcript, localized error description, or engine logging is accessed.
    private func diagnoseSummaryBatch(
        requestId: String,
        localeIdentifier: String,
        items: [OnDeviceSummaryLine],
        runStartedAt: TimeInterval
    ) async throws -> [OnDeviceSummaryLine] {
        let batchStartedAt = ProcessInfo.processInfo.systemUptime
        var diagnostic: [String: Any] = [
            "requestId": requestId,
            "input": items.map { ["index": $0.index, "text": $0.text] as [String: Any] },
            "returnedCount": 0,
            "suffixValidCount": 0,
        ]
        defer { attachSyntheticJSON(requestId, diagnostic) }
        do {
            let output = try await OnDeviceSummaryEngine.shared.refine(
                requestId: requestId, localeIdentifier: localeIdentifier, items: items
            )
            let finishedAt = ProcessInfo.processInfo.systemUptime
            diagnostic["batchElapsedSeconds"] = finishedAt - batchStartedAt
            diagnostic["runElapsedSeconds"] = finishedAt - runStartedAt
            diagnostic["output"] = output.map { ["index": $0.index, "text": $0.text] as [String: Any] }
            diagnostic["returnedCount"] = output.count
            diagnostic["suffixValidCount"] = summarySuffixValidCount(output, against: items)
            diagnostic["checks"] = output.enumerated().map { position, line -> [String: Any] in
                let excerpt = line.text.trimmingCharacters(in: .whitespacesAndNewlines)
                let inBounds = items.indices.contains(position)
                return [
                    "position": position,
                    "index": line.index,
                    "indexMatches": inBounds && line.index == items[position].index,
                    "suffixMatches": inBounds && items[position].text.hasSuffix(excerpt),
                    "matchingSourceCount": items.filter { $0.text.hasSuffix(excerpt) }.count,
                    "utf16Count": excerpt.utf16.count,
                ]
            }
            return output
        } catch {
            let finishedAt = ProcessInfo.processInfo.systemUptime
            diagnostic["batchElapsedSeconds"] = finishedAt - batchStartedAt
            diagnostic["runElapsedSeconds"] = finishedAt - runStartedAt
            diagnostic["errorCode"] = diagnosticErrorCode(error)
            throw error
        }
    }

    private func summarySuffixValidCount(
        _ output: [OnDeviceSummaryLine], against input: [OnDeviceSummaryLine]
    ) -> Int {
        output.enumerated().filter { position, line in
            let excerpt = line.text.trimmingCharacters(in: .whitespacesAndNewlines)
            return input.indices.contains(position) && !excerpt.isEmpty
                && input[position].text.hasSuffix(excerpt)
        }.count
    }

    private func diagnosticErrorCode(_ error: Error) -> String {
        if error is CancellationError { return "cancelled" }
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), let generationError = error as? LanguageModelSession.GenerationError {
            switch generationError {
            case .rateLimited: return "rateLimited"
            case .concurrentRequests: return "concurrentRequests"
            default: return "foundationModelsGenerationError"
            }
        }
        #endif
        if let briefingError = error as? OnDeviceBriefingError {
            switch briefingError {
            case .quota: return "rateLimited"
            case .busy: return "concurrentRequests"
            case .unavailable: return "unavailable"
            case .badRequest: return "badRequest"
            case .malformedOutput: return "malformedOutput"
            case .nativeFailure: return "nativeFailure"
            }
        }
        if let summaryError = error as? OnDeviceSummaryError {
            switch summaryError {
            case .unavailable: return "unavailable"
            case .badRequest: return "badRequest"
            case .malformedOutput: return "malformedOutput"
            case .generationFailed: return "generationFailed"
            }
        }
        return "unclassifiedError"
    }

    private func attachSyntheticJSON(_ name: String, _ fields: [String: Any]) {
        var payload = fields
        payload["fixtureSet"] = "fixed-korean-native-model-v1"
        payload["schemaVersion"] = 1
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
              data.count <= 65_536 else {
            XCTFail("Synthetic diagnostic JSON invalid or exceeds 64 KiB; not attached")
            return
        }
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "synthetic-\(name).json"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func requireSummaryAvailability() -> Bool {
        guard let reason = OnDeviceSummary.availability(localeIdentifier: summaryLocale) else {
            return true
        }
        XCTFail("On-device summary is unavailable: \(reason.rawValue)")
        return false
    }

    private func requireBriefingAvailability() -> Bool {
        let availability = OnDeviceBriefing.availability(locale: briefingLocale)
        guard availability == .ready else {
            XCTFail("On-device briefing is unavailable: \(availability.rawValue)")
            return false
        }
        return true
    }

    private func dailyLines(startingAt start: Int, count: Int) -> [OnDeviceSummaryLine] {
        let lines = (start..<(start + count)).map { index in
            let text = "가상 검증 기록 \(index + 1)번입니다. 실제 사용자와 무관한 반복 가능한 한국어 시험 문장입니다. \(dailyTerminalSentences[index % dailyTerminalSentences.count])"
            XCTAssertGreaterThan(text.utf16.count, OnDeviceSummary.maxExcerptCharacters)
            XCTAssertLessThanOrEqual(text.utf16.count, OnDeviceSummary.maxSourceCharacters)
            return OnDeviceSummaryLine(index: index % 5, text: text)
        }
        return lines
    }

    private func assertSummaryIdentity(
        _ output: [OnDeviceSummaryLine],
        against input: [OnDeviceSummaryLine],
    ) {
        XCTAssertEqual(output.count, input.count)
        for (position, line) in output.enumerated() where position < input.count {
            let excerpt = line.text.trimmingCharacters(in: .whitespacesAndNewlines)
            XCTAssertEqual(line.index, input[position].index)
            XCTAssertTrue(input[position].text.hasSuffix(excerpt))
            XCTAssertEqual(
                input.filter { $0.text.hasSuffix(excerpt) }.count,
                1,
                "A returned suffix must identify exactly one synthetic source line",
            )
            XCTAssertGreaterThanOrEqual(excerpt.utf16.count, 8)
            XCTAssertLessThanOrEqual(excerpt.utf16.count, OnDeviceSummary.maxExcerptCharacters)
        }
    }

    private var dailyTerminalSentences: [String] {
        [
            "바다색 종이비행기를 접었습니다.",
            "노란 단추를 세 번 세었습니다.",
            "작은 연필로 별표를 그렸습니다.",
            "창가의 가상 화분에 물을 주었습니다.",
            "하늘색 타이머를 멈추었습니다.",
            "보라색 책갈피를 끼웠습니다.",
            "둥근 자석을 상자에 넣었습니다.",
            "은색 스티커를 공책에 붙였습니다.",
            "초록 종에 짧은 선을 그었습니다.",
            "주황색 컵을 선반에 놓았습니다.",
            "검은 연필심을 새것으로 바꾸었습니다.",
            "흰 조약돌을 접시 위에 올렸습니다.",
            "분홍 종이를 반으로 접었습니다.",
            "갈색 끈을 느슨하게 묶었습니다.",
            "회색 상자 뚜껑을 닫았습니다.",
            "청록 메모지에 점을 찍었습니다.",
            "금색 클립을 한쪽에 모았습니다.",
            "남색 봉투를 조심히 펼쳤습니다.",
            "연두 스탬프를 종이에 눌렀습니다.",
            "자주색 실을 매듭으로 마무리했습니다.",
        ]
    }

    private func briefingItems() -> [OnDeviceBriefingItem] {
        (0..<5).map { itemOrdinal in
            OnDeviceBriefingItem(
                itemOrdinal: itemOrdinal,
                candidates: [
                    OnDeviceBriefingCandidate(
                        candidateOrdinal: 0,
                        text: "가상 브리핑 \(itemOrdinal + 1)번의 첫 번째 한국어 후보입니다.",
                    ),
                    OnDeviceBriefingCandidate(
                        candidateOrdinal: 1,
                        text: "가상 브리핑 \(itemOrdinal + 1)번의 두 번째 한국어 후보입니다.",
                    ),
                ],
            )
        }
    }

    private func briefingJSON(_ items: [OnDeviceBriefingItem]) throws -> String {
        let wire: [[String: Any]] = items.map { item in
            [
                "itemOrdinal": item.itemOrdinal,
                "candidates": item.candidates.map { candidate in
                    [
                        "candidateOrdinal": candidate.candidateOrdinal,
                        "text": candidate.text,
                    ]
                },
            ]
        }
        let data = try JSONSerialization.data(withJSONObject: wire)
        guard let json = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "NativeOnDeviceModelTests", code: 1)
        }
        XCTAssertLessThanOrEqual(
            data.count + OnDeviceBriefing.promptOverheadUtf8Bytes + OnDeviceBriefing.responseReserveUtf8Bytes,
            OnDeviceBriefing.maxContextUtf8Bytes,
        )
        return json
    }
}
