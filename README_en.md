# Media Assistant

[中文](README.md)

A Firefox media toolbox for both desktop and mobile, with three independently controlled features:

- Playback controls: speed, seeking shortcuts, and an on-page controller.
- Image preview: quickly enlarge or pin page images and animations, including `srcset`, backgrounds, direct image links, and safe URL preview rules.
- Media finder: find, preview, and download media loaded by the current page.

Firefox desktop and Firefox for Android 142.0 or later are supported. Mouse input keeps the existing hover, right-click, activation settings, and keyboard shortcuts, while touch or pen input always uses the mobile gestures even when a mouse is also connected. On Android touchscreens, press and hold an image to preview it; tap the enlarged image or elsewhere on the page to close an unpinned preview, or tap the enlarged image with two fingers at once to pin it. A pinned image can be panned with one finger and pinched or rotated with two; rotation snaps near 0°, 90°, 180°, and 270°. The playback controller can be dragged by holding anywhere on it with either touch or mouse; on mobile, tapping the speed number switches between number-only and expanded-button views. Android downloads use an extension file-save page that hands the prepared file to the browser or system share sheet. HLS downloads use bounded segment concurrency, but downloads and large-file merging can still use significant memory, so practical limits depend on the device.

Image preview is based on parts of the Imagus 0.9.8.74 codebase, but its viewer, rule management, and mouse and touch interactions have been reworked for this extension. Desktop users can preview on hover, pin with right-click, and use mouse controls. Mobile users can press and hold to preview, tap to close, tap with two fingers to pin, then drag, pinch, or rotate a pinned image. Preview rules use restricted URL templates that switch available image variants only within the original image host; they run no scripts and fetch no resolver pages. A practical rule set is included and can be reviewed, enabled, disabled, reordered, or extended in settings. Video preview is not included.

## Download

[Install from Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/web-media-assistant/)

## Changelog

[View release notes](CHANGELOG_en.md)

## Preview

| Extension menu | Playback controls | Image preview | Media finder |
| --- | --- | --- | --- |
| <img src="screenshots/1.png" alt="Extension menu" width="100%"> | <img src="screenshots/2.png" alt="Playback controls" width="100%"> | <img src="screenshots/3.png" alt="Image preview" width="100%"> | <img src="screenshots/4.png" alt="Media finder" width="100%"> |

## License

Original integration code, settings UI, and UI design created for this project are available under the MIT License. Third-party code keeps its original terms; see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Imagus-derived files are outside the MIT grant.
