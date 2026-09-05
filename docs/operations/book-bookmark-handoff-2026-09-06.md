# Book bookmark handoff — proposed integration contract

Status: CONTRACT PREPARATION, NOT IMPLEMENTED. Approved Home/book intent; Book Studio owner reply received 2026-09-06. Do not treat the remote owner's report as independently verified app implementation.

The Book Studio owner reports an existing `src/lib/liveBookLibrary.ts` adapter using `get_book_library_page` / `get_book_library_records`, with server authorization and 300-second temporary photo URLs. Reuse that boundary after app-side persistence is approved and verified; this task does not edit Book Studio.

## Candidate metadata

- Separate `bookBookmarkId` and exact `recordId`; never reuse talkAbout state.
- Owner identity obtained and enforced by the authenticated server, not trusted from client input.
- Original date YYYY-MM-DD; original time and timezone where available, otherwise null rather than guessed.
- Immutable asset ID or server-validated photo reference; ordered selected record/photo IDs.
- Revision or updatedAt for revalidation, plus deletion/authorization-revocation handling.

Bookmarking only collects candidates. It does not purchase, create a book, grant partner access, or automatically choose memories. The customer explicitly selects records/photos/order in Book Studio. Content import and output independently recheck ownership, privacy, partner-consent boundaries, and applicable project entitlements. Signed URLs must not be persisted as durable identity or draft content; reacquire on authorized use. Unavailable/deleted sources must never silently be replaced with another record.

## Open work

- App-side separate bookmark storage and authorized query API remain unimplemented.
- Existing Book page RPC timezone/bookmark support is not complete according to its owner.
- No DB migration, cross-repo change, book purchase, or production action is authorized by this document itself.
- Next: bounded storage/authorization design and implementation after notebook Home prototype, with negative access tests and explicit source selection preservation.
