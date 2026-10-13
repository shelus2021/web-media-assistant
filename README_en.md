# Web Media Assistant

[中文](README.md)

A Firefox media toolbox with three independently controlled features:

- Playback controls: speed, seeking shortcuts, and an on-page controller.
- Image preview: hover previews for images and animations, with editable import/export rules.
- Media finder: find, preview, and download media loaded by the current page.

Image preview is based on Imagus 0.9.8.74. Its defaults come from `Imagus-conf.json`, and all 318 site resolver rules are retained. Video preview is not included.

## Preview

| Extension menu | Playback controls | Image preview | Media finder |
| --- | --- | --- | --- |
| <img src="screenshots/1.png" alt="Extension menu" width="100%"> | <img src="screenshots/2.png" alt="Playback controls" width="100%"> | <img src="screenshots/3.png" alt="Image preview" width="100%"> | <img src="screenshots/4.png" alt="Media finder" width="100%"> |

## Installation

Open `about:debugging#/runtime/this-firefox` in Firefox, choose “Load Temporary Add-on,” and select this directory's `manifest.json`. Unsigned XPI files generally cannot be installed permanently in standard Firefox releases.

## License

Original integration code, settings UI, and UI design created for this project are available under the MIT License. Third-party code keeps its original terms; see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Imagus-derived files are outside the MIT grant.
