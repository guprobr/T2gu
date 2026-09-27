# Sprite generation methods

The **Complete Method** is the historical workflow: inspect the old full sheet,
extract identity, inspect wraith layout, write a detailed custom prompt, generate
and repair, adapt a character-specific normalizer, and review the normalized sheet.

The **Lean Method** keeps identity, size and output checks while reducing repeated
agent work. Use built-in image generation; no API/CLI image-generation charges.

1. Run `python3 tools/sprite_lean.py cache NAME [NAME ...]` once per character.
   It saves a small front/back idle reference and original silhouette height.
   Repeated runs reuse the cache without decoding the old sheet. No full old-sheet
   preview is created. Cached references are snapshots; explicitly refresh them
   when the intended source design changes.
2. Inspect only `output/imagegen/NAME/references/lean-front-back.png`.
   Use the shared prompt in `tools/sprite_lean_prompt.txt`, replacing character
   identity and attack/skill details. Save the exact expanded prompt per character.
3. Make one initial built-in generation using that single reference. Preserve
   the output as `output/imagegen/NAME/NAME_generated.png`.
4. Run `python3 tools/sprite_lean.py normalize NAME`. It measures the new sheet,
   matches the cached idle height with one uniform scale, derives fixed column
   roots from idle poses, and keeps a shared ground anchor. The original assets
   are not reopened. An explicit `normalization.json` can override `scale`,
   `source_root_x`, `source_rows`, `segmentation_alpha`, `action_offsets` or per-action `select`
   indices after inspection. A stronger threshold can separate weak glow bridges;
   original edge alpha is retained around each silhouette.
   Unexpected pose counts or clipping fail instead of silently accepting damage.
5. Review the final contact sheet once. Repair significant visual defects using
   an isolated crop first; avoid a whole-sheet edit for a one-frame defect.
   Minor stylistic variations do not trigger cosmetic regeneration. Add corrected
   full-cell RGBA files through `normalization.json` entries in `repairs`
   (`row`, `column`, `file`, zero-based). They receive the same bounds checks.
   Use one scale for related repair poses; preserve the original ground contact.
6. Deliver the candidate PNG, JSON, saved prompt and validation. Retain generated
   sources and correction prompts. Do not replace installed game assets.

The output contract is unchanged: 4480×10120 RGBA, 560×1012 cells, 8 columns,
10 rows, 65 occupied cells and 15 fully transparent cells. Rows are idle, walk,
run, defend, attack, skill, hit, die, dash, jump. Front count is 3 for idle/skill/
hit/die/dash and 4 otherwise. Column 5 is always empty; backs are columns 6–8.

Checks cover layout, counts, alpha, bounds and metadata; they do not prove correct
anatomy, action semantics or smooth animation. Keep the final visual review.
Connected-component extraction assumes one connected main silhouette per pose;
detached meaningful props/effects or touching characters require inspection.

Pilot: `lara_cyber`, then `lich_king`. Record generation/repair counts in
`output/imagegen/lean-pilot.json`. Account allowance consumption is not exposed
by these local scripts, so compare dashboard readings separately; do not infer a
credit-saving percentage from runtime or image-call counts alone.

Pilot completed: both candidates passed structural checks and visual review.
Lara used one generation; lich king used one generation and one cropped repair
for two staff defects. Total: three image calls, zero full-sheet edits. The
reference cache was verified with image decoding disabled; regeneration of Lara
and the staff repair placement reproduced identical files. Next: `lizardman`.
The shared-tool setup is a one-time cost, and credit savings remain unmeasured.
