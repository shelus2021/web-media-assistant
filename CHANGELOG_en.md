# Changelog

## 0.2.1 - 2026-11-10

- Enabled media discovery by default, covered common media, image, and PDF extensions, and retained disabled `m4s` and `ts` segment blockers.
- Applied the same name sorting, duplicate validation, append-at-end behavior, and compact layout to extension and media-type rules.
- Moved finder rules to a dedicated subpage where extension and media-type lists expand with the page.
- Disabled `svg` by default; preview rules are sorted by name when displayed and saved, with case-insensitive duplicate-name validation.
- Simplified the pinning settings label and assigned transform and sizing shortcuts to `1` through `5`.
- Removed the unused HTML insertion helper.

## 0.2.0 - 2026-10-25

Compared with 0.1.39:

- Replaced legacy script-based preview rules with safe local URL templates and 18 built-in rules for common sites.
- Added `%s` and `[]` candidate groups; pinned-image captions can display and cycle candidate values while updating actual dimensions.
- Rebuilt preview-rule management with search, clear, expand, double-click rename, custom delete confirmation, and default restoration.
- Simplified preview options and shortcuts by removing obsolete or duplicate actions and updating the default keys.
- Improved caption layout, centering, spacing, shadows, and candidate-group sizing; caption visibility now applies only to the current preview.
- Tuned mouse-wheel and touchpad zoom and fixed abrupt scaling, uneven speed, and positional drift.
- Fixed reopening the same image immediately after closing a preview.
- Improved previewable-target indicators with the system zoom cursor and an animation-tracking blue dashed outline with white backing.
- Restored the previous popup page when reopened within 10 seconds and unified the media-rule expand control.
- Strengthened media-setting validation, partial-response size calculation, iframe initialization, privacy text, and third-party notices.
