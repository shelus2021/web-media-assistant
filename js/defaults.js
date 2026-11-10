"use strict";

var PLAYBACK_DEFAULTS = {
  enabled: true,
  startHidden: false,
  rememberSpeed: false,
  forceLastSavedSpeed: false,
  audioBoolean: true,
  controllerOpacity: 0.5,
  mediaRetrievalEnabled: true,
  imagePreviewEnabled: true,
  keyBindings: [
    { action: "display", key: 72, value: 0, force: true, predefined: true },
    { action: "slower", key: 83, value: 0.1, force: true, predefined: true },
    { action: "faster", key: 87, value: 0.1, force: true, predefined: true },
    { action: "rewind", key: 65, value: 5, force: true, predefined: true },
    { action: "advance", key: 68, value: 5, force: true, predefined: true },
    { action: "reset", key: 82, value: 1, force: true, predefined: true },
    { action: "fast", key: 86, value: 1.5, force: true, predefined: true }
  ]
};

var MEDIA_RETRIEVAL_DEFAULTS = {
  Ext: [
    "aac", "avif", "bmp", "flv", "gif", "jpeg", "jpg", "m3u8", "m4a", "m4s", "mkv", "mov", "mp3", "mp4", "mpd", "ogg", "pdf", "png", "svg", "ts", "wav", "webm", "webp"
  ].map(function (ext) { return { ext: ext, size: 0, state: ext !== "m4s" && ext !== "svg" && ext !== "ts" }; }),
  Type: [
    "application/dash+xml", "application/m4s", "application/mpegurl", "application/octet-stream-m3u8", "application/ogg", "application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/*", "video/*"
  ].map(function (type) { return { type: type, size: 0, state: true }; })
};
