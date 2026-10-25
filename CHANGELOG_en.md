# Changelog

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
