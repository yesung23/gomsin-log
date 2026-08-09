# Kiro Implementation Brief — Gomsin Log Design v2.1

Implement the approved Gomsin Log product and design specifications across the actual application. This is not a cosmetic color refresh. The goal is to replace the oversized, card-heavy, AI-template-like presentation with a coherent information architecture, visual hierarchy, interaction density, and content-first record experience.

## 1. Inspect and preserve the current work first

Before editing anything:

1. Inspect the current branch, `git status`, and `git diff`.
2. Treat all existing user changes, design documents, reference assets, and in-progress work as intentional.
3. Do not discard or overwrite them with `reset`, forced checkout, stash deletion, force-push, or history rewriting.
4. If you find unexpected overlapping changes, stop that part of the work and report the exact files and conflict instead of guessing.

Read these documents in order:

1. `docs/SERVICE_OVERVIEW.md`
2. `docs/PRODUCT_PRD.md`
3. `docs/FEATURE_SPEC.md`
4. `docs/USER_FLOWS.md`
5. `docs/WIREFRAMES.md`
6. `docs/DESIGN_V2.md`
7. `docs/PRODUCT_REVIEW.md`
8. `docs/TRACEABILITY_MATRIX.md`

Visual reference:

`docs/design-references/clean-couple-ui-reference.jpg`

Do not copy the reference product's brand, characters, logo, copy, or exact screens. Use only its visual density, information hierarchy, spacing rhythm, editorial timeline grammar, low-chrome interface, and restrained color application.

When documents differ:

- Use `PRODUCT_PRD.md` and `FEATURE_SPEC.md` as the authority for product scope and behavior.
- Use the **Confirmed visual revision (2026-08-08)** in `DESIGN_V2.md` as the highest authority for visual presentation.
- Preserve the existing security, privacy, authorization, and data contracts.

## 2. Design positioning

**Intimate Editorial Utility**

Gomsin Log is not a card-heavy couple dashboard. It is a content-first relational utility that lets one partner understand the other person's real day like a carefully edited timeline, then act on shared schedule and travel decisions without wasting limited call time.

Apply these principles consistently:

- **Content-first hierarchy:** Real photos, audio, timestamps, and user-authored text must outrank generated titles, summaries, suggestions, and emotion labels.
- **Progressive disclosure:** Reveal record type first, required inputs second, and privacy/final confirmation at the appropriate step.
- **Surface economy:** Use list rows, dividers, and editorial timelines for repeated information instead of wrapping every item in a card.
- **Low-chrome interface:** Remove unnecessary nested cards, borders, shadows, gradients, pills, decorative emoji, and ornamental containers.
- **Compact readability:** Recover useful information density by reducing oversized headings, padding, card height, and empty space—not by making essential content unreadably small.
- **Visual footprint is not the hit target:** Controls may look compact, but every interactive hit target must remain at least 44 × 44 px.
- **Semantic chroma:** Coral = relationship and primary action; blue = plans; mint = completion; yellow = attention or confirmation; red = errors and destructive actions.
- **Authentic over synthetic:** Generic emotional copy and app-generated labels must never overshadow the couple's real photos, voices, and words.

## 3. Required screen outcomes

### Gomsin home

- Place a compact capture launcher at the top for text, photo/video, audio, and reaction.
- Do not use four oversized feature tiles or a long inline composer.
- Show a preview of today's real records immediately below the launcher.
- Keep D-Day as compact supporting information.
- Do not place generic AI-style emotional greetings or large generated summary cards above real content.

### Soldier home

The default hierarchy must contain only:

1. `60 seconds before the call`
2. `Your partner's day`
3. Compact military-service D-Day

Requirements:

- The briefing contains no more than three prioritized items.
- The briefing is a decision surface; `Your partner's day` is the evidence surface containing real photos, audio, and original text.
- At 390 × 844, the completion action and at least part of the partner's real records must be visible within the same initial viewport.
- Keep derived widgets available through `More` or widget management; do not delete their functionality.

### Record timeline

- Replace chat bubbles and repeated large cards with an editorial timeline.
- Reading order: date → time → media → user-authored text → author, privacy, and status metadata.
- Show two or three lines of original text in the list and the full content in detail.
- Do not create automatic titles for each record.
- Do not communicate author or privacy using color alone.
- When entering from the call briefing, scroll to and clearly highlight the relevant timeline row.

### Schedule and shared tasks

- Do not create a large card for every schedule or task.
- Use scannable chronological rows with clear time, title, type, assignee, and status.
- Keep the experience warm and lightweight rather than resembling enterprise project-management software.

### Travel planner

- Present trips and daily places as a compact itinerary.
- Make time, place name, business hours, address, confirmation status, and order easy to scan.
- Do not give every place an independent high-emphasis card.
- Preserve existing OCR, direct input, links, checklist, automatic ordering, and manual reordering behavior.
- Do not introduce a paid API or generative AI dependency.

### Onboarding, Us, Service, My, and Settings

- Apply the same type scale, spacing rhythm, semantic color model, and low-chrome list patterns.
- Emphasize one primary decision per screen.
- Visually and behaviorally separate destructive actions from ordinary save actions.
- Do not allow statistics or D-Day surfaces to dominate the core relationship context.

## 4. Design-system targets

- Spacing rhythm: 4, 8, 12, 16, 20, 24 px
- Horizontal gutter: 16–20 px at 390 px; 14–16 px at 320 px
- Control radius: approximately 12 px
- Meaningful surface radius: approximately 16 px
- Display: 26/32, weight 700
- Page title: 22/30, weight 700
- Section title: 17/24, weight 600
- Body emphasis: 16/24, weight 600
- Body: 15/22, weight 400
- Label: 13/18, weight 500
- Caption: 12/16, weight 400
- Primary CTA visual height: 48 px
- General control visual height: 40–44 px
- Bottom navigation: 56–60 px plus safe-area inset
- Maximum three elevated surfaces per screen
- Maximum one primary CTA per screen
- Maximum two prominent accent colors per screen
- Use no shadow or only a very subtle low-elevation shadow

## 5. Non-negotiable implementation constraints

- Do not arbitrarily change routes, authentication, persistence contracts, Supabase schema, RLS, authorization, or privacy behavior.
- Do not weaken private-record isolation or author-only edit/delete permissions.
- Do not remove existing functionality merely to simplify the presentation.
- Do not change production databases, Supabase settings, Vercel settings, domains, or secrets.
- Preserve dark mode, keyboard operation, visible focus states, accessible names, and reduced-motion behavior.
- Do not send record text, emotion data, addresses, or media to a new external analytics service.
- Do not introduce a new paid API or generative AI API.

## 6. Implementation and validation sequence

1. Audit every current screen against the approved documents and record the gaps.
2. Normalize shared tokens and primitives first.
3. Migrate the role-specific home screens and record timeline first.
4. Migrate schedule, travel, onboarding, Us, Service, My, and Settings using the same visual language.
5. Validate 320 × 568, 390 × 844, and 430 px mobile widths.
6. Validate light mode, dark mode, long Korean strings, text enlargement, and safe-area behavior.
7. Check for horizontal overflow, clipped CTAs, overlapping sticky/floating layers, and broken focus order.
8. Preserve existing regression tests and add focused layout, accessibility, and behavior tests where needed.
9. Run `npm run verify`.
10. Capture representative browser screenshots and compare them against the acceptance criteria in the design documents.

## 7. Definition of done

- Real user content receives visual priority over generated copy.
- Repeated records, schedules, and places are not represented as separate oversized cards.
- The first action differs appropriately between the Gomsin and Soldier roles.
- The Soldier home shows both briefing completion and part of the partner's real content in the first viewport at 390 × 844.
- There is no horizontal overflow or clipped primary action at 320 px.
- Every important interactive hit target is at least 44 × 44 px.
- Light and dark modes preserve hierarchy and contrast.
- Existing features, privacy rules, authorization, and data contracts continue to pass their tests.
- The representative screens do not look like senior mode, an enterprise dashboard, or a generic AI-generated template.

## 8. Git and PR workflow

- Work on a safe design branch that preserves the current changes.
- Commit in meaningful, reviewable units.
- Do not modify `master` directly.
- Open a pull request and confirm that all CI checks are successful and the PR is mergeable.
- Never overwrite an unexpected conflict or another contributor's change.
- Merge only when CI is green, using a merge commit rather than squash or rebase.
- Do not force-push or delete branches.

## 9. Final report

Write the final report so a non-technical product owner can understand it. Include:

1. Which screens changed and how
2. Which principles from the reference were applied
3. Whether existing features and privacy protections were preserved
4. Tests executed and their results
5. Pull request link and merge status
6. Anything that still requires manual human verification
