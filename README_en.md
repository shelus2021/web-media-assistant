# Web Media Assistant

[中文](README.md)

A Firefox media toolbox with three independently controlled features:

- Playback controls: speed, seeking shortcuts, and an on-page controller.
- Image preview: enlarge existing page images and animations on hover, including `srcset`, backgrounds, direct image links, and safe preview rules.
- Media finder: find, preview, and download media loaded by the current page.

Image preview keeps the Imagus 0.9.8.74 viewer and interactions, with generic image detection as its base. Preview rules use safe URL templates: `*` preserves source text, `%s` marks a replaced part, and every `%s` has one `[]` candidate group. When a rule matches, the pinned-view caption shows `[orig]` or `[value1][value2]`; clicking a group cycles that group independently. Rules run no scripts, fetch no resolver pages, and cannot change the original image host. Default rules cover explicit size-bearing URLs used by X / Twitter, TMDb, Pinterest, SoundCloud, Apple media images, Squarespace, Gravatar, Discord, YouTube, eBay, Google image CDN, Unsplash, GitHub avatars, Flickr, ArtStation, and Twitch avatars. Video preview is not included.

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
