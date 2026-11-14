# Changelog

## 0.3.18 - 2026-11-14

- Fixed concurrent page-load callbacks bypassing URL deduplication and the cache limit. Asynchronous work remains bounded, while each tab retains the latest 500 media records and evicts the oldest record when a new one arrives; late callbacks from a previous navigation are discarded.
- Rolling eviction skips records involved in an active HLS conversion, Android save, or Firefox download. If all 500 records are downloading, every download record is retained and the new discovery is not added.
- Coalesced media-cache persistence to at most one strictly serialized write every two seconds, avoiding repeated full-cache clones and overlapping `storage.local` writes during resource bursts.
- Limited the temporary Referer cache to 5,000 entries, bounded stored URL/source/title lengths, and stopped storing the redundant parsed-URL fields previously used only for deduplication.
- Disabling media retrieval now releases all tabs' runtime caches and pending requests instead of clearing only the current tab; tab reload and removal also release their reserved capacity.

## 0.3.17 - 2026-11-11

- Fixed a white flash on desktop and mobile image-preview activation caused by the legacy light preview container and opaque loader background appearing before the image was painted; preview-container and loader appearance are now fixed transparent internals, and legacy hidden style fields are no longer read from or written to storage.
- Slightly widened the pinned-preview shadow from 5 px to a semi-transparent 7 px blur with a 1 px spread for a clearer image boundary.

## 0.3.16 - 2026-11-11

- Fixed dynamically added media recreating playback controls after the feature was disabled, released per-media attribute observers when controllers are removed, and gave each controller its own temporary-visibility timer on multi-media pages.
- Made the Android download page read the complete file only after the user chooses system sharing, avoiding a large-file memory spike during ordinary saves.
- Kept media discovery deduplication active and capped each tab at 1,000 cached results to prevent unbounded growth and repeated extension-storage writes on long-running pages.
- Preserved and switched HLS `EXT-X-MAP` initialization sections per segment, supported key rotation that reuses the same key URL, and limited Referer injection to background requests made by the extension.
- Added data-type and window-source validation to image-preview cross-frame messages so malformed or same-page forged messages cannot disrupt the viewer.
- Allowed real images larger than 70% of both viewport dimensions and direct-image pages to enter preview detection, and added timeout cleanup when exceptionally large images never finish decoding.
- Restored the missing English release notes for versions 0.3.2 through 0.3.6.

## 0.3.15 - 2026-11-11

- Optimized mobile pinch and rotation after switching a pinned preview back to its high-resolution original variant by coalescing pointer updates into one layout and transform per animation frame and committing the final frame before release.

## 0.3.14 - 2026-11-11

- Fixed mobile controller buttons retaining their highlight after a tap; hover styles now apply only when a hover-capable fine pointer is available, while touch keeps transient active feedback.

## 0.3.13 - 2026-11-11

- Made the mobile playback controller start collapsed with only the speed box visible; tapping the speed box expands or collapses the buttons while desktop display and hover behavior remain unchanged.
- Automatically collapses the expanded mobile controller after 5 seconds of inactivity; button clicks, touches, and dragging restart the timer, while manual collapse cancels it.

## 0.3.12 - 2026-11-11

- Fixed tapping a rule candidate in a pinned mobile preview caption closing the preview; candidates now switch the image source, other caption areas keep the preview open, and only tapping the image itself dismisses it.
- Fixed desktop playback-controller buttons not responding to clicks; pointer capture and drag styling now begin only after movement exceeds 2 px, preserving normal clicks while retaining drag-from-anywhere behavior.

## 0.3.11 - 2026-11-11

- Completed a mobile long-press event-flow review: compatibility-event suppression now activates only for confirmed previewable targets, distinguishes touch-generated mouse events from real mouse input, and stabilizes pinned-image single-tap dismissal and two-finger gesture release.

## 0.3.10 - 2026-11-11

- Limited mobile touch dismissal to cases where the loader or preview is actually visible, restoring first and subsequent long-press previews while retaining click-through prevention when closing.
- Switched touch dismissal to a normal reset to avoid the desktop mouse re-arm delay, suppressed compatibility mouse events that could instantly close a newly opened preview, and ensured `pointercancel` cleans up the active gesture.
- Started loading immediately when the 360 ms touch long press is recognized instead of adding the default 300 ms mouse-hover delay.
- Suppressed the native long-press menu only after confirming a previewable target, identified compatibility mouse events by Firefox touch source and coordinates to preserve real mouse input, and made a pinned-image single-tap dismissal explicit while excluding pointers involved in the two-finger pin gesture.

## 0.3.9 - 2026-11-11

- Fixed stale or premature preview state being mistaken for a dismissal gesture, which could prevent the first or a subsequent touch long press from opening a preview.

## 0.3.8 - 2026-11-11

- Fixed touch events and the synthesized click passing through to underlying page content when an Android long-press preview was dismissed by tapping outside the preview image.

## 0.3.7 - 2026-11-11

- Fixed the Android preview-rules header not covering the full row and the search clear button overflowing to the right because its touch target exceeded the grid column.
- Made the preview-rules search row stick below the header on both desktop and mobile, while aligning it and the media finder filter row with the actual mobile header height so their top edges are no longer obscured.
- Tightened touch rotation snapping from ±7° to ±5° and reduced the release range from ±13° to ±10° to avoid snapping too early.

## 0.3.6 - 2026-11-11

- Fixed synthesized clicks passing through to page content after dismissing an enlarged Android preview by tapping the image.
- Increased the Android long-press movement tolerance from 12 px to 18 px while retaining the 360 ms recognition time and the existing close-tap threshold.
- Routed each PointerEvent by its actual input type so touch gestures continue working with a connected mouse while real mouse input keeps the configured desktop behavior.
- Added two-finger rotation for pinned touch previews with hysteresis-based snapping near 0°, 90°, 180°, and 270°, while retaining pinch zoom.
- Simplified the settings section title to “Activation” and added a regular-weight touch gesture hint.
- Added an automatic caption style as the default so caption colors follow the browser or system color scheme.
- Moved image dimensions and rule candidate display options above caption text display.

## 0.3.5 - 2026-11-11

- Allowed an unpinned Android long-press preview to be dismissed by tapping the enlarged image while retaining outside-tap dismissal and pinned two-finger interaction.

## 0.3.4 - 2026-11-11

- Fixed the bottom corners of the collapsed speed box losing their rounded shape when the Android playback controller was positioned vertically on the right.

## 0.3.3 - 2026-11-11

- Improved Android playback-controller dragging and fixed a horizontal-to-vertical flash when reopening a collapsed controller on the right.
- Prevented the native Android long-press menu from taking over image previews and added one-finger panning plus two-finger zoom after pinning.
- Moved Android media saving to an extension confirmation page, activated its new tab when possible, and retained a clear reopen action when activation fails.

## 0.3.2 - 2026-11-11

- Allowed the playback controller to be dragged from its entire surface with mouse or touch, and added mobile speed-box tapping to collapse or expand the buttons.
- Added two-finger tap pinning for enlarged Android images while retaining desktop right-click pinning.
- Kept direct image and media downloads available while an HLS merge is active and added fallback when custom download request headers are rejected.
- Added bounded HLS segment prefetching to reduce sequential waits while limiting mobile memory use.

## 0.3.1 - 2026-11-11

- Removed the media results list's independent scroll area so results now use the popup's main content scroller.
- Kept the filter and sort row pinned directly below the media finder header without exposing the rules card above it.
- Unified image and video previews with a transparent background, fixed height, and preserved aspect ratio to prevent stretching or a full-width black area.
- Made the popup follow the browser or system color-scheme preference in Firefox desktop and Android, with dark styling for backgrounds, cards, lists, forms, and status controls.
- Changed the display name from “Web Media Assistant” to “Media Assistant” while keeping the extension ID unchanged.

## 0.3.0 - 2026-11-11

- Declared support for Firefox for Android 142.0 and later.
- Added touch-and-hold image previews, touch dragging for playback controls, and a responsive popup with safe-area handling while preserving existing desktop mouse and keyboard interactions.

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
