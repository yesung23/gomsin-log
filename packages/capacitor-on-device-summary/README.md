# @gomsinlog/capacitor-on-device-summary

iOS-only, on-device rewriting of daily summary lines that the app has **already
computed deterministically**.

## What crosses the bridge

An ordinal `index` and a whitespace-collapsed line of `text`, 40 characters or
fewer. Nothing else — no `recordId`, no `userId`, no date, no time, no attachment
reference. The TypeScript side rejoins the returned index to the original record
id itself, so the model cannot make a summary line point at a different record.

## What the model is not allowed to do

Add, drop or reorder items; return an index outside the request; repeat an index;
exceed the line-length bound; or infer emotion, mood, health, pain, cycle or
relationship state. The instructions say so, and
`src/lib/dailySummary/verify.ts` does not trust the instructions: it checks count,
order, index identity and length, and discards the whole batch on any violation.
A discarded batch means the screen keeps the deterministic text it already had.

## Why there is no Android or web implementation

Foundation Models is an Apple-platform API. An Android or web path would be a
different engine wearing the same name, and "which engine actually ran?" would
stop being answerable. `package.json` declares only `capacitor.ios`, so
`cap sync android` never sees this package, and the TypeScript adapter requires
`getPlatform() === 'ios'` before it will call anything.

## No network, no storage, no logging

A fresh `LanguageModelSession` per request, no tools, no transcript rehydration
or serialisation, no feedback attachment, and no `print` of input or output
anywhere in the Swift sources.

## Deployment target

iOS 14.0, unchanged from the app. FoundationModels is reached through
`#if canImport(FoundationModels)` plus `@available(iOS 26.0, *)`; raising the
floor would drop iOS 14–17 devices to buy nothing, since those devices fall back
to the deterministic rules either way.

## Verification status

Compilation, bridge wiring, availability gating and the cancellation path are
structural and checkable in CI and on a simulator.

**Actual model behaviour is UNVERIFIED.** A simulator does not run Apple
Intelligence, so a successful simulator build is evidence of compilation and
wiring only. Confirming that the system model is reachable, that it supports
`ko_KR` on the device in question, and that its output survives verification
requires an Apple-Intelligence-eligible physical iPhone.
