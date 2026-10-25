"use strict";

var prefs_;

function readImagusDefaults(callback) {
  var request = new XMLHttpRequest();
  request.overrideMimeType("application/json;charset=utf-8");
  request.open("GET", new URL("imagus/defaults.jsn", document.baseURI).href, true);
  request.onload = function () { callback(JSON.parse(request.responseText)); };
  request.send(null);
}

function normalizeImagusPrefs(defaults, stored, sent) {
  var next = {};
  Object.keys(defaults).forEach(function (section) {
    var source = sent[section] !== undefined ? sent[section] : stored[section];
    if (Array.isArray(defaults[section])) {
      next[section] = Array.isArray(source) ? source : defaults[section];
      return;
    }
    if (!source || typeof source !== "object" || Array.isArray(source)) source = defaults[section];
    next[section] = {};
    Object.keys(defaults[section]).forEach(function (key) {
      next[section][key] = source[key] === undefined || typeof source[key] !== typeof defaults[section][key]
        ? defaults[section][key]
        : source[key];
    });
  });
  var idle = next.hz.hideIdleCursor;
  if (idle !== null && (!Number.isInteger(idle) || idle < 0)) next.hz.hideIdleCursor = defaults.hz.hideIdleCursor;
  return next;
}

function updatePrefs(sent, callback) {
  sent = sent || {};
  readImagusDefaults(function (defaults) {
    cfg.get(Object.keys(defaults), function (stored) {
      prefs_ = normalizeImagusPrefs(defaults, stored, sent);
      cfg.set({ hz: prefs_.hz, keys: prefs_.keys, urlRules: prefs_.urlRules }, function () {
        if (typeof callback === "function") callback();
      });
    });
  });
}

function onMessage(message, sender, sendResponse) {
  var envelope = Port.parse_msg(message, sender, sendResponse);
  if (!message || !message.cmd) return false;
  switch (message.cmd) {
    case "hello":
      if (!prefs_) {
        updatePrefs({}, function () {
          envelope.postMessage({ cmd: "hello", prefs: { hz: prefs_.hz, keys: prefs_.keys, urlRules: prefs_.urlRules } });
        });
        return true;
      }
      envelope.postMessage({ cmd: "hello", prefs: { hz: prefs_.hz, keys: prefs_.keys, urlRules: prefs_.urlRules } });
      return false;
    case "savePrefs":
      updatePrefs(message.prefs, function () { envelope.postMessage({ ok: true }); });
      return true;
    case "download":
      if (typeof window.saveURI === "function") {
        window.saveURI({ url: message.url, priorityExt: message.priorityExt, ext: message.ext, isPrivate: envelope.isPrivate });
      }
      return false;
    case "open":
      (Array.isArray(message.url) ? message.url : [message.url]).forEach(function (url) {
        if (!url || typeof url !== "string") return;
        var params = { url: url, active: !message.nf };
        if (sender && sender.tab && sender.tab.id) params.openerTabId = sender.tab.id;
        try { Tabs.create(params); }
        catch (_) { delete params.openerTabId; Tabs.create(params); }
      });
      return false;
    default:
      return false;
  }
}

Port.listen(onMessage);
document.title = ":: " + app.name + " ::";
cfg.remove("sieve");
cfg.get("version", function (items) {
  if (!items.version || items.version.current !== app.version) cfg.set({ version: { current: app.version } });
  updatePrefs();
});
