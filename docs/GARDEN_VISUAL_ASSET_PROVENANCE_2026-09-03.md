# Garden Tree Visual Asset Provenance — 2026-09-03

Status: LOCAL ASSET RECORD

Application checkpoint: `a96b0c4`

Production: NOT APPLIED

Legal uniqueness / trademark clearance: UNVERIFIED

## Purpose

The previous crop-composite tree was rejected because stretched fragments and alpha seams did not meet a commercial visual bar. The replacement is an original four-stage tree family generated for GomsinLog and rendered as one complete transparent asset per stage.

## Generation record

- Tool: OpenAI image generation tool available in the Codex workspace.
- Intent: entirely original four-stage central tree family for a warm Korean stationery garden; colored-pencil and light-watercolor texture; no copied characters, branded objects, text, logo, or watermark.
- Style reference boundary: `paper-pair-v1.webp` was used only to match warmth, line softness, and paper-craft mood. The tree prompt explicitly prohibited copying its characters or third-party expression.
- First output: rejected because the apparent checkerboard was baked into RGB pixels and the file lacked usable transparency.
- Accepted source: a background-extraction edit preserving the four generated trees while creating real RGBA transparency.
- Accepted source file at generation time: `/Users/han-yejun/.codex/generated_images/01a060f9-25f4-7f40-b66d-4234bae7921f/exec-0ecf1838-e92c-4ed5-9929-9bf9a46f2722.png`
- Accepted source properties: 1254×1254, 8-bit RGBA, non-interlaced, SHA-256 `a3b95bc0a73a4e54fba237cc19a68529bfcbab0c4c60fa30ba4d203943b70e70`.

The absolute generation path is provenance evidence for this workstation, not a deployment dependency. Runtime uses only the committed derivatives below.

## Mechanical derivatives

The accepted atlas was losslessly cropped and encoded as alpha-preserving WebP with `sharp`. No generative edit was made after the accepted source.

| Stage | Source crop `(left, top, width, height)` | Runtime file | SHA-256 |
|---|---:|---|---|
| 1 | `140, 300, 370, 280` | `src/assets/garden/garden-tree-stage-1-v1.webp` | `2bede6e90d41283bd4c0770325bf98b09c0f4111a73f8d5f1b6214a769ac04d3` |
| 2 | `710, 30, 470, 550` | `src/assets/garden/garden-tree-stage-2-v1.webp` | `b4545ca7d6cc65e8ed83c0e1cb9174c0e90933310f19ccf024211d9babf53de9` |
| 3 | `50, 595, 560, 615` | `src/assets/garden/garden-tree-stage-3-v1.webp` | `0d179c00d3f09cf690a70b7c1ae587d74a2ad05081df6d60a2967507f7def5fd` |
| 4 | `620, 585, 634, 625` | `src/assets/garden/garden-tree-stage-4-v1.webp` | `e184c7936cdfbf1fdfc8014ad0034a68701f8771139285d8670aacd8e8c1114b` |

`companionGardenAsset.test.ts` pins these hashes so accidental replacement or recompression fails review.

## Verification and limits

- CODE/TEST CONFIRMED: each runtime file has alpha, each stage renders exactly one complete image, and crop-fragment/clip composition is absent.
- BROWSER CONFIRMED locally: all four stages showed rooted trees without checkerboard, seam, static-character contamination, or viewport clipping in the captured 390px matrix.
- CODE/TEST CONFIRMED: daily visual height is non-decreasing through day 730, including the stage-3 to stage-4 transition at 320px and 390px.
- UNVERIFIED: physical-iPhone color, memory, energy, and VoiceOver behavior after this asset change.
- UNVERIFIED: independent legal determination that generated expression is unique enough for every jurisdiction. No third-party logo or recognizable branded property was observed, but this technical record is not legal clearance.
- Separate external gate: the historical character sheet and its accessories have their own rights/provenance requirement; this document does not establish those rights.
