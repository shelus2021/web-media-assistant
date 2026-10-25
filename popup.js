"use strict";

const MIN_RATE = 0.07;
const MAX_RATE = 16;
const MEMORY_MERGE_PEAK_MULTIPLIER = 3;
const SEPARATE_TRACK_WARNING_BYTES = 512 * 1024 * 1024;
const t = extensionMessage;
const ACTIONS = { display: t("actionDisplay"), slower: t("actionSlower"), faster: t("actionFaster"), rewind: t("actionRewind"), advance: t("actionAdvance"), reset: t("actionReset"), fast: t("actionFast") };
const FIXED = { display: 0, reset: 1 };
const DEFAULTS = PLAYBACK_DEFAULTS;
const CAPTURE_DEFAULTS = MEDIA_RETRIEVAL_DEFAULTS;

document.addEventListener("DOMContentLoaded", () => {
  const popupSessionPort = chrome.runtime.connect({ name: "wma-popup-session" });
  popupSessionPort.onDisconnect.addListener(() => {});
  localizeDocument();
  let settings;
  let currentTabId = -1;
  let captureItems = [];
  let captureSortMode = "default";
  let captureRules = { Ext: [], Type: [] };
  let hlsLoader;
  let imagePreviewDefaults;
  let imagePreviewPrefs;
  let statusResetTimer;
  let currentPopupPanel = "mainMenu";
  const activeDownloadStates = new Set(["starting", "loading", "downloading", "saving", "cancelling"]);
  const hlsDownloadStates = new Map();
  const hlsQualityOptions = new Map();
  const imageShortcutDefinitions = [
    ["hz_fullZm", "imageKeyFullZoom"],
    ["hz_caption", "imageKeyCaption"], ["hz_open", "imageKeyOpen"],
    ["flipH", "imageKeyFlipHorizontal"], ["flipV", "imageKeyFlipVertical"],
    ["rotL", "imageKeyRotateLeft"], ["mOrig", "imageKeyNaturalSize"],
    ["mFitH", "imageKeyFitHeight"]
  ];
  const $ = (selector, root = document) => root.querySelector(selector);
  const cloneDefaults = () => ({ ...DEFAULTS, keyBindings: DEFAULTS.keyBindings.map((item) => ({ ...item })) });
  const keyName = (code) => ({ 32: "Space", 37: "Left", 38: "Up", 39: "Right", 40: "Down" }[code] || (code ? String.fromCharCode(code) : ""));
  const siteIsEnabled = () => Boolean(settings.enabled);
  const captureIsEnabled = () => Boolean(settings.mediaRetrievalEnabled);
  const imagePreviewIsEnabled = () => Boolean(settings.imagePreviewEnabled);
  const enabledLabel = (enabled) => t(enabled ? "statusEnabled" : "statusDisabled");
  const setStatus = (message, error = false, persistent = false) => {
    clearTimeout(statusResetTimer);
    const node = $("#status");
    node.textContent = message;
    node.classList.toggle("error", error);
    if (!persistent) statusResetTimer = setTimeout(() => siteStatus(), 500);
  };
  const siteStatus = () => setStatus("", false, true);

  function renderGeneral() {
    $("#enabled").checked = siteIsEnabled();
    renderCaptureToggle();
    renderImagePreviewToggle();
    ["startHidden", "rememberSpeed", "forceLastSavedSpeed", "audioBoolean"].forEach((id) => { $("#" + id).checked = Boolean(settings[id]); });
    const opacity = Number(settings.controllerOpacity); $("#controllerOpacity").value = Number.isFinite(opacity) && opacity >= 0 && opacity <= 1 ? opacity : 0.5;
  }
  function renderCaptureToggle() {
    const toggle = $("#captureEnabled");
    toggle.checked = captureIsEnabled();
    toggle.disabled = false;
    toggle.closest("label").title = t("toggleMediaCapture");
  }
  function renderImagePreviewToggle() {
    $("#imagePreviewEnabled").checked = imagePreviewIsEnabled();
  }
  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function parseImagusStored(value, fallback) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch (_) { value = null; }
    }
    const result = { ...fallback };
    if (!value || typeof value !== "object") return result;
    Object.keys(fallback).forEach(key => {
      const storedValue = value[key];
      const defaultValue = fallback[key];
      if (key === "hideIdleCursor" && storedValue === null) {
        result[key] = null;
      } else if (typeof storedValue === typeof defaultValue && Array.isArray(storedValue) === Array.isArray(defaultValue)) {
        result[key] = storedValue;
      }
    });
    return result;
  }
  function parseImagusArrayStored(value, fallback) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch (_) { value = null; }
    }
    return cloneJson(Array.isArray(value) ? value : fallback);
  }
  function loadImagePreviewPrefs() {
    const defaultsPromise = imagePreviewDefaults
      ? Promise.resolve(imagePreviewDefaults)
      : fetch(chrome.runtime.getURL("imagus/defaults.jsn")).then(response => {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      }).then(defaults => {
        imagePreviewDefaults = defaults;
        return defaults;
      });
    const storedPromise = new Promise(resolve => chrome.storage.local.get(["hz", "keys", "urlRules"], resolve));
    return Promise.all([defaultsPromise, storedPromise]).then(([defaults, stored]) => {
      imagePreviewPrefs = {
        hz: parseImagusStored(stored.hz, defaults.hz),
        keys: parseImagusStored(stored.keys, defaults.keys),
        urlRules: parseImagusArrayStored(stored.urlRules, defaults.urlRules)
      };
      if (![2, 4].includes(Number(imagePreviewPrefs.hz.placement))) imagePreviewPrefs.hz.placement = 4;
      renderImagePreviewSettings();
      renderImagePreviewShortcuts();
      renderImagePreviewRules();
    }).catch(error => setStatus(t("imageSettingsLoadFailed", error.message), true));
  }
  function renderImagePreviewSettings() {
    if (!imagePreviewPrefs) return;
    document.querySelectorAll("#imagePreviewSettingsPanel [data-imagus-section]").forEach(control => {
      const section = control.dataset.imagusSection;
      const key = control.dataset.imagusKey;
      const value = imagePreviewPrefs[section] && imagePreviewPrefs[section][key];
      if (control.type === "checkbox") control.checked = Boolean(value);
      else if (key === "hideIdleCursor" && value === null) control.value = "";
      else control.value = value == null ? "" : String(value);
    });
    updateActivationDelayVisibility();
  }
  function updateActivationDelayVisibility() {
    const showDelay = $("#imageActivationMode").value === "1";
    document.querySelectorAll(".activation-delay-setting").forEach(control => control.classList.toggle("hidden", !showDelay));
  }
  function renderImagePreviewShortcuts() {
    if (!imagePreviewPrefs) return;
    $("#imageDisableShortcutsInInput").checked = Boolean(imagePreviewPrefs.hz.scOffInInput);
    const root = $("#imageShortcutRows");
    root.textContent = "";
    const fragment = document.createDocumentFragment();
    imageShortcutDefinitions.forEach(([key, labelKey]) => {
      const row = document.createElement("label");
      row.className = "image-shortcut-row";
      const label = document.createElement("span");
      label.textContent = t(labelKey);
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 12;
      input.dataset.imagusKey = key;
      input.value = imagePreviewPrefs.keys[key] || "";
      row.append(label, input);
      fragment.appendChild(row);
    });
    root.appendChild(fragment);
  }
  function setPreviewUrlRuleExpanded(row, expanded) {
    const details = $(".preview-url-rule-details", row);
    const toggle = $(".preview-url-rule-toggle", row);
    if (!details || !toggle) return;
    row.classList.toggle("is-expanded", expanded);
    details.hidden = !expanded;
    toggle.textContent = expanded ? "▾" : "▸";
    toggle.title = t(expanded ? "collapsePreviewRule" : "expandPreviewRule");
    toggle.setAttribute("aria-label", toggle.title);
    toggle.setAttribute("aria-expanded", String(expanded));
  }
  function setPreviewRuleNameEditing(input, editing) {
    if (!input) return;
    input.readOnly = !editing;
    input.classList.toggle("is-editing", editing);
    input.title = t(editing ? "finishPreviewRuleNameEdit" : "editPreviewRuleName");
    if (editing) {
      input.focus();
    }
  }
  function createPreviewUrlRuleRow(rule = {}, expanded = false) {
    const row = document.createElement("div");
    row.className = "preview-url-rule";
    const header = document.createElement("div");
    header.className = "preview-url-rule-header";
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = rule.enabled !== false;
    enabled.dataset.ruleField = "enabled";
    enabled.title = t("previewRuleEnabled");
    const name = document.createElement("input");
    name.type = "text";
    name.maxLength = 80;
    name.value = typeof rule.name === "string" ? rule.name : "";
    name.placeholder = t("previewRuleName");
    name.dataset.ruleField = "name";
    setPreviewRuleNameEditing(name, false);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "preview-url-rule-toggle";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "preview-url-rule-remove";
    remove.textContent = "×";
    remove.title = t("removePreviewRule");
    header.append(enabled, name, toggle, remove);
    row.appendChild(header);
    const details = document.createElement("div");
    details.className = "preview-url-rule-details";
    const valueGroups = Array.isArray(rule.values) && rule.values.every(group => Array.isArray(group)) ? rule.values : [];
    const displayedValues = valueGroups.map(group => `[${group.join(",")}]`).join("");
    const fields = [
      ["pattern", "previewRulePattern", typeof rule.pattern === "string" ? rule.pattern : "", "*://pbs.twimg.com/media/*?*name=%s*"],
      ["values", "previewRuleValues", displayedValues, "[orig,large]"]
    ];
    for (const [key, labelKey, value, placeholder] of fields) {
      const label = document.createElement("label");
      label.className = "preview-url-rule-field";
      const caption = document.createElement("span");
      caption.textContent = t(labelKey);
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = key === "values" ? 640 : 1000;
      input.value = value;
      input.placeholder = placeholder;
      input.dataset.ruleField = key;
      label.append(caption, input);
      details.appendChild(label);
    }
    row.appendChild(details);
    setPreviewUrlRuleExpanded(row, expanded);
    return row;
  }
  function applyPreviewUrlRuleFilter() {
    const root = $("#imagePreviewRuleList");
    const searchValue = $("#imagePreviewRuleSearch").value;
    const query = searchValue.trim().toLocaleLowerCase();
    $("#clearImagePreviewRuleSearch").disabled = !searchValue;
    const rows = [...root.querySelectorAll(".preview-url-rule")];
    let visibleCount = 0;
    rows.forEach(row => {
      const name = row.querySelector('[data-rule-field="name"]').value.toLocaleLowerCase();
      const pattern = row.querySelector('[data-rule-field="pattern"]').value.toLocaleLowerCase();
      const visible = !query || name.includes(query) || pattern.includes(query);
      row.hidden = !visible;
      if (visible) visibleCount += 1;
    });
    const previousEmpty = $(".preview-rule-search-empty", root);
    if (previousEmpty) previousEmpty.remove();
    if (query && rows.length && !visibleCount) {
      const empty = document.createElement("p");
      empty.className = "capture-empty preview-rule-search-empty";
      empty.textContent = t("noPreviewRuleMatches");
      root.appendChild(empty);
    }
  }
  function renderImagePreviewRules() {
    if (!imagePreviewPrefs) return;
    const root = $("#imagePreviewRuleList");
    root.textContent = "";
    const rules = Array.isArray(imagePreviewPrefs.urlRules) ? imagePreviewPrefs.urlRules : [];
    if (!rules.length) {
      const empty = document.createElement("p");
      empty.className = "capture-empty";
      empty.textContent = t("noPreviewRules");
      root.appendChild(empty);
      return;
    }
    rules.forEach(rule => root.appendChild(createPreviewUrlRuleRow(rule)));
    applyPreviewUrlRuleFilter();
  }
  function readImagePreviewRules() {
    const rules = [];
    document.querySelectorAll("#imagePreviewRuleList .preview-url-rule").forEach(row => {
      const value = key => row.querySelector(`[data-rule-field="${key}"]`).value.trim();
      const name = value("name");
      const pattern = value("pattern");
      const placeholderCount = (pattern.match(/%s/g) || []).length;
      const rawValues = value("values");
      if (!name || !pattern || !rawValues) throw new Error(t("previewRuleRequired"));
      if (!placeholderCount || placeholderCount > 6) throw new Error(t("previewRulePatternInvalid"));
      const matches = [...rawValues.matchAll(/\[([^\]]*)\]/g)];
      if (matches.map(match => match[0]).join("").replace(/\s+/g, "") !== rawValues.replace(/\s+/g, "") || matches.length !== placeholderCount) {
        throw new Error(t("previewRuleGroupsInvalid"));
      }
      const groups = matches.map(match => [...new Set(match[1].split(/[,\n]+/).map(item => item.trim()).filter(Boolean))]);
      const combinationCount = groups.reduce((total, group) => total * group.length, 1);
      if (groups.some(group => !group.length || group.length > 6) || groups.flat().some(item => item.length > 100) || combinationCount > 216) {
        throw new Error(t("previewRuleValuesInvalid"));
      }
      rules.push({ enabled: row.querySelector('[data-rule-field="enabled"]').checked, name, pattern, values: groups });
    });
    return rules;
  }
  function notifyImagePreviewContent() {
    const message = { cmd: "wmaImagePreviewState", enabled: imagePreviewIsEnabled() };
    chrome.tabs.query({}, tabs => tabs.forEach(tab => {
      if (!Number.isInteger(tab.id)) return;
      chrome.tabs.sendMessage(tab.id, message, () => void chrome.runtime.lastError);
    }));
  }
  function persistImagePreviewPrefs(nextPrefs, message) {
    imagePreviewPrefs = nextPrefs;
    chrome.runtime.sendMessage({ cmd: "savePrefs", prefs: nextPrefs }, response => {
      if (chrome.runtime.lastError || !response || response.ok !== true) {
        return setStatus(t("saveFailed", chrome.runtime.lastError ? chrome.runtime.lastError.message : t("unknown")), true);
      }
      setStatus(message);
      notifyImagePreviewContent();
    });
  }
  function readImagePreviewSettings() {
    const next = cloneJson(imagePreviewPrefs);
    const controls = document.querySelectorAll("#imagePreviewSettingsPanel [data-imagus-section]");
    for (const control of controls) {
      const section = control.dataset.imagusSection;
      const key = control.dataset.imagusKey;
      if (control.type === "checkbox") {
        next[section][key] = control.checked;
      } else if (control.dataset.imagusType === "number") {
        if (key === "hideIdleCursor") {
          const rawValue = control.value.trim();
          if (rawValue === "") {
            next[section][key] = null;
            continue;
          }
          const cursorDelay = Number(rawValue);
          if (!Number.isInteger(cursorDelay) || cursorDelay < 0) {
            throw new Error(t("imageHideCursorInvalid"));
          }
          control.value = String(cursorDelay);
          next[section][key] = cursorDelay;
          continue;
        }
        // Imagus parses numeric fields itself and clamps them to min/max. Native
        // constraint validation is intentionally not used for these legacy fields.
        let value = Number.parseFloat(control.value);
        if (!Number.isFinite(value)) {
          value = Number(imagePreviewDefaults?.[section]?.[key]);
        }
        if (!Number.isFinite(value)) {
          value = Number(imagePreviewPrefs?.[section]?.[key]);
        }
        if (control.hasAttribute("min")) value = Math.max(Number(control.min), value);
        if (control.hasAttribute("max")) value = Math.min(Number(control.max), value);
        control.value = String(value);
        next[section][key] = value;
      } else {
        next[section][key] = control.value;
      }
    }
    return next;
  }
  function readImagePreviewShortcuts() {
    const next = cloneJson(imagePreviewPrefs);
    next.hz.scOffInInput = $("#imageDisableShortcutsInInput").checked;
    const usedKeys = new Set();
    document.querySelectorAll("#imageShortcutRows [data-imagus-key]").forEach(input => {
      const value = input.value.trim();
      const normalized = value.length === 1 ? value.toUpperCase() : value;
      if (normalized) {
        const identity = normalized.toLocaleUpperCase();
        if (usedKeys.has(identity)) throw new Error(t("duplicateShortcutKey", normalized));
        usedKeys.add(identity);
      }
      next.keys[input.dataset.imagusKey] = normalized;
    });
    return next;
  }
  function renderCapture() {
    renderCaptureToggle();
    if (!captureIsEnabled()) {
      captureItems = [];
      renderCaptureList();
      $("#captureCardSummary").textContent = t("captureStopped");
      return;
    }
    chrome.runtime.sendMessage({ Message: "getMediaData", tabId: currentTabId }, (response) => {
      if (chrome.runtime.lastError) captureItems = [];
      else captureItems = response && Array.isArray(response.items) ? response.items : [];
      renderCaptureList();
    });
  }
  function captureFileName(item, index) {
    let name = item.name || "";
    if (!name && item.url) {
      try { name = decodeURIComponent(new URL(item.url).pathname.split("/").pop()); } catch (_) {}
    }
    if (!name) name = "media-" + (index + 1);
    if (item.ext && !name.toLowerCase().endsWith("." + String(item.ext).toLowerCase())) {
      name += "." + item.ext;
    }
    return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 180);
  }
  function captureSize(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return t("unknownSize");
    if (bytes < 1024) return Math.round(bytes) + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
    return (bytes / 1024 / 1024 / 1024).toFixed(1) + " GB";
  }
  function shouldWarnForMemoryMerge(estimatedSize) {
    const bytes = Number(estimatedSize);
    return !Number.isFinite(bytes) || bytes <= 0 || bytes > SEPARATE_TRACK_WARNING_BYTES;
  }
  function showConfirmDialog(titleText, message, confirmText, confirmClass = "confirm-continue") {
    return new Promise(resolve => {
      const overlay = document.createElement("div");
      overlay.className = "confirm-overlay";
      const dialog = document.createElement("div");
      dialog.className = "confirm-dialog";
      dialog.setAttribute("role", "alertdialog");
      dialog.setAttribute("aria-modal", "true");
      const title = document.createElement("strong");
      title.className = "confirm-title";
      title.textContent = titleText;
      const body = document.createElement("p");
      body.className = "confirm-message";
      body.textContent = message;
      const actions = document.createElement("div");
      actions.className = "confirm-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "confirm-cancel";
      cancel.textContent = t("cancelDownload");
      const confirmButton = document.createElement("button");
      confirmButton.type = "button";
      confirmButton.className = confirmClass;
      confirmButton.textContent = confirmText;
      actions.append(cancel, confirmButton);
      dialog.append(title, body, actions);
      overlay.appendChild(dialog);
      const finish = accepted => {
        document.removeEventListener("keydown", handleKeydown, true);
        overlay.remove();
        resolve(accepted);
      };
      const handleKeydown = event => {
        if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      };
      cancel.addEventListener("click", () => finish(false));
      confirmButton.addEventListener("click", () => finish(true));
      overlay.addEventListener("click", event => {
        if (event.target === overlay) finish(false);
      });
      document.addEventListener("keydown", handleKeydown, true);
      document.body.appendChild(overlay);
      confirmButton.focus();
    });
  }
  function confirmMemoryMerge(message) {
    return showConfirmDialog(t("memoryWarningTitle"), message, t("continueDownload"));
  }
  function captureFormat(item) {
    let format = String(item && item.ext || "").trim().replace(/^\./, "");
    if (!format && item && item.url) {
      try {
        const name = new URL(item.url).pathname.split("/").pop() || "";
        const match = name.match(/\.([a-z0-9]{1,10})$/i);
        if (match) format = match[1];
      } catch (_) {}
    }
    if (!format && item && item.type) {
      const subtype = String(item.type).split("/")[1];
      if (subtype) format = subtype.split(/[;+]/)[0];
    }
    return format && format.toLowerCase() !== "octet-stream" ? format.toUpperCase() : t("unknownFormat");
  }
  function isHlsItem(item) {
    const ext = String(item && item.ext || "").toLowerCase();
    const type = String(item && item.type || "").toLowerCase();
    const url = String(item && item.url || "");
    return ext === "m3u8" || /(?:^|[.\/])m3u8(?:$|[?#])/i.test(url) || type.includes("mpegurl") || type.includes("m3u8");
  }
  function hasActiveDownload() {
    return [...hlsDownloadStates.values()].some(state => state && activeDownloadStates.has(state.state));
  }
  function renderHlsDownloadPanel(panel, item) {
    panel.textContent = "";
    const statusPanel = $(".capture-download-status-panel", panel.parentElement);
    if (statusPanel) statusPanel.textContent = "";
    const state = hlsDownloadStates.get(item.url);
    const variants = hlsQualityOptions.get(item.url);
    if (statusPanel && state && state.message) {
      const status = document.createElement("span");
      status.className = "capture-download-status" + (state.state === "error" ? " error" : "");
      status.textContent = state.message;
      statusPanel.appendChild(status);
      if (state.jobId && ["starting", "loading", "downloading"].includes(state.state)) {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "capture-download-cancel";
        cancel.dataset.cancelHls = state.jobId;
        cancel.textContent = t("cancelDownload");
        cancel.title = t("cancelDownload");
        statusPanel.appendChild(cancel);
      }
    }
    if (!variants || !variants.length) return;
    const downloadLocked = hasActiveDownload();
    const choices = document.createElement("div");
    choices.className = "capture-quality-list";
    variants.forEach((variant, qualityIndex) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "capture-quality";
      button.dataset.hlsQuality = qualityIndex;
      button.textContent = variant.label;
      button.title = !variant.supported
        ? variant.reason
        : (downloadLocked ? t("downloadAlreadyRunning") : t(variant.direct ? "downloadFile" : "downloadQuality"));
      button.disabled = !variant.supported || downloadLocked;
      choices.appendChild(button);
    });
    panel.appendChild(choices);
  }
  function refreshAllHlsDownloadPanels() {
    document.querySelectorAll(".capture-item").forEach(details => {
      const item = captureItems[Number(details.dataset.index)];
      const panel = $(".capture-download-panel", details);
      if (!item) return;
      const state = hlsDownloadStates.get(item.url);
      details.classList.toggle("download-active", Boolean(state && activeDownloadStates.has(state.state)));
      if (panel) renderHlsDownloadPanel(panel, item);
    });
    updatePinnedDownloadItem();
  }
  function updatePinnedDownloadItem() {
    const root = $("#captureList");
    if (!root) return;
    const previous = $(".capture-download-pin", root);
    const details = $(".capture-item.download-active", root);
    const summary = details && $(":scope > summary", details);
    if (!details || !summary || root.scrollHeight <= root.clientHeight) {
      if (previous) previous.remove();
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const summaryRect = summary.getBoundingClientRect();
    let side = "";
    if (summaryRect.bottom <= rootRect.top) side = "top";
    else if (summaryRect.top >= rootRect.bottom) side = "bottom";
    if (!side) {
      if (previous) previous.remove();
      return;
    }
    const index = Number(details.dataset.index);
    const item = captureItems[index];
    if (!item) {
      if (previous) previous.remove();
      return;
    }
    if (previous && previous.dataset.index === String(index) && previous.classList.contains(side)) {
      previous.style.top = Math.max(0, root.scrollTop + (side === "bottom" ? root.clientHeight - previous.offsetHeight : 0)) + "px";
      return;
    }
    if (previous) previous.remove();
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "capture-download-pin " + side;
    pin.dataset.index = index;
    pin.title = captureFileName(item, index);
    const label = document.createElement("span");
    label.className = "capture-download-pin-name";
    label.textContent = pin.title;
    const spinner = document.createElement("span");
    spinner.className = "capture-download-spinner";
    spinner.setAttribute("aria-hidden", "true");
    pin.append(label, spinner);
    root.appendChild(pin);
    const pinHeight = pin.offsetHeight;
    pin.style.top = Math.max(0, root.scrollTop + (side === "bottom" ? root.clientHeight - pinHeight : 0)) + "px";
    pin.addEventListener("click", () => {
      const targetTop = details.offsetTop - Math.max(0, (root.clientHeight - summary.offsetHeight) / 2);
      root.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
      details.open = true;
    });
  }
  function setHlsDownloadState(sourceUrl, state, open = false) {
    if (state) hlsDownloadStates.set(sourceUrl, state); else hlsDownloadStates.delete(sourceUrl);
    refreshAllHlsDownloadPanels();
    if (open) {
      document.querySelectorAll(".capture-item").forEach(details => {
        const item = captureItems[Number(details.dataset.index)];
        if (item && item.url === sourceUrl) details.open = true;
      });
    }
  }
  function sendRuntimeMessage(message, callback) {
    chrome.runtime.sendMessage(message, response => {
      const error = chrome.runtime.lastError;
      callback(error ? { ok: false, error: error.message } : (response || { ok: false, error: t("noBackgroundResponse") }));
    });
  }
  function restoreHlsDownloadStates() {
    sendRuntimeMessage({ Message: "getHlsDownloadJobs" }, response => {
      if (!response.ok || !Array.isArray(response.jobs)) return;
      response.jobs.forEach(job => {
        if (!job || !job.sourceUrl) return;
        hlsDownloadStates.set(job.sourceUrl, {
          state: job.state,
          jobId: job.jobId,
          message: job.message || "",
          completed: job.completed || 0,
          total: job.total || 0
        });
      });
      refreshAllHlsDownloadPanels();
      if (response.panel && response.panel !== "mainMenu") openPage(response.panel);
    });
  }
  function updateCaptureSummary(visibleCount, query = "") {
    $("#captureCardSummary").textContent = captureItems.length
      ? t(query ? "captureSummaryFiltered" : "captureSummary", query ? [captureItems.length, visibleCount] : captureItems.length)
      : t("noMediaFound");
  }
  function createCaptureItem(item, index) {
    const details = document.createElement("details");
    details.className = "capture-item";
    details.dataset.index = index;
    const summary = document.createElement("summary");
    const name = document.createElement("button");
    name.type = "button";
    name.className = "capture-name";
    const nameText = document.createElement("span");
    nameText.className = "capture-name-text";
    nameText.textContent = captureFileName(item, index);
    const spinner = document.createElement("span");
    spinner.className = "capture-download-spinner";
    spinner.setAttribute("aria-hidden", "true");
    name.append(nameText, spinner);
    name.title = String(item.url || "");
    const size = document.createElement("span");
    size.className = "capture-size";
    size.textContent = captureSize(item.size);
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "capture-copy";
    copy.title = t("copyLinkTitle");
    copy.setAttribute("aria-label", t("copyLinkTitle"));
    copy.disabled = !item.url;
    summary.append(name, size, copy);
    const detail = document.createElement("div");
    detail.className = "capture-detail";
    const url = document.createElement("a");
    url.className = "capture-url";
    url.href = String(item.url || "");
    url.target = "_blank";
    url.rel = "noopener";
    url.textContent = url.href;
    url.title = url.textContent;
    detail.appendChild(url);
    const statusPanel = document.createElement("div");
    statusPanel.className = "capture-download-status-panel";
    detail.appendChild(statusPanel);
    const downloadPanel = document.createElement("div");
    downloadPanel.className = "capture-download-panel";
    detail.appendChild(downloadPanel);
    details.append(summary, detail);
    renderHlsDownloadPanel(downloadPanel, item);
    const state = hlsDownloadStates.get(item.url);
    details.classList.toggle("download-active", Boolean(state && activeDownloadStates.has(state.state)));
    return details;
  }
  function disposeCapturePreviews(root) {
    root.querySelectorAll(".capture-item").forEach(details => {
      if (details._captureHls) details._captureHls.destroy();
      const preview = $(".capture-preview", details);
      if (preview && typeof preview.pause === "function") preview.pause();
    });
  }
  function renderCaptureList() {
    const root = $("#captureList");
    const query = $("#captureFilter").value.trim().toLowerCase();
    const fragment = document.createDocumentFragment();
    disposeCapturePreviews(root);
    root.textContent = "";
    const visible = captureItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        const text = [item.name, item.title, item.ext, item.type, item.url].filter(Boolean).join(" ").toLowerCase();
        return !query || text.includes(query);
      });
    if (captureSortMode === "name") {
      visible.sort((a, b) => captureFileName(a.item, a.index).localeCompare(captureFileName(b.item, b.index), chrome.i18n.getUILanguage(), { numeric: true, sensitivity: "base" }) || a.index - b.index);
    } else if (captureSortMode === "size") {
      visible.sort((a, b) => (Number(b.item.size) || -1) - (Number(a.item.size) || -1) || a.index - b.index);
    }
    updateCaptureSummary(visible.length, query);
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "capture-empty";
      empty.textContent = t(query && captureItems.length ? "noMatchingMedia" : "playMediaHint");
      root.appendChild(empty);
      return;
    }
    visible.forEach(({ item, index }) => {
      const details = createCaptureItem(item, index);
      fragment.appendChild(details);
    });
    root.appendChild(fragment);
    updatePinnedDownloadItem();
  }
  function loadHlsLibrary() {
    if (typeof Hls !== "undefined") return Promise.resolve(Hls);
    if (hlsLoader) return hlsLoader;
    hlsLoader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "lib/hls.min.js";
      script.onload = () => typeof Hls !== "undefined" ? resolve(Hls) : reject(new Error(t("hlsLibraryFailed")));
      script.onerror = () => reject(new Error(t("hlsLibraryFailed")));
      document.head.appendChild(script);
    });
    return hlsLoader;
  }
  function showPreviewError(detail, message) {
    if (detail.querySelector(".capture-preview-error")) return;
    const node = document.createElement("span");
    node.className = "capture-preview-error";
    node.textContent = message;
    detail.appendChild(node);
  }
  function mountCapturePreview(details) {
    const detail = $(".capture-detail", details);
    if (!detail || detail.querySelector(".capture-preview")) return;
    const item = captureItems[Number(details.dataset.index)];
    if (!item || !item.url) return;
    const type = String(item.type || "").toLowerCase();
    const ext = String(item.ext || "").toLowerCase();
    const isHls = isHlsItem(item);
    let preview;
    if (type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) {
      preview = document.createElement("img");
      preview.alt = captureFileName(item, Number(details.dataset.index));
    } else if (type.startsWith("audio/") || ["mp3", "wav", "m4a", "aac", "ogg", "wma"].includes(ext)) {
      preview = document.createElement("audio");
      preview.controls = true;
      preview.preload = "metadata";
    } else {
      preview = document.createElement("video");
      preview.controls = true;
      preview.preload = "metadata";
    }
    preview.className = "capture-preview";
    detail.insertBefore(preview, $(".capture-download-panel", detail));
    if (!isHls || !(preview instanceof HTMLVideoElement)) return void (preview.src = item.url);
    if (preview.canPlayType("application/vnd.apple.mpegurl")) return void (preview.src = item.url);
    loadHlsLibrary().then((HlsClass) => {
      if (!details.isConnected || !HlsClass.isSupported()) {
        showPreviewError(detail, t("hlsUnsupported"));
        return;
      }
      const hls = new HlsClass({ enableWorker: false });
      details._captureHls = hls;
      hls.loadSource(item.url);
      hls.attachMedia(preview);
      hls.on(HlsClass.Events.ERROR, (_event, data) => {
        if (data && data.fatal) showPreviewError(detail, t("hlsPreviewFailed"));
      });
    }).catch((error) => showPreviewError(detail, error.message));
  }
  function cloneCaptureDefaults() {
    return {
      Ext: CAPTURE_DEFAULTS.Ext.map((item) => ({ ...item })),
      Type: CAPTURE_DEFAULTS.Type.map((item) => ({ ...item }))
    };
  }
  function setCaptureRulesStatus(message, error = false) {
    if (message) setStatus(message, error);
  }
  function createRuleRow(kind, item = {}) {
    const row = document.createElement("div");
    row.className = "rule-row";
    row.dataset.kind = kind;
    const state = document.createElement("input");
    state.type = "checkbox";
    state.className = "rule-state";
    state.checked = item.state !== false;
    const value = document.createElement("input");
    value.type = "text";
    value.className = "rule-value";
    value.placeholder = kind === "Ext" ? "mp4" : "video/*";
    value.value = String(kind === "Ext" ? (item.ext || "") : (item.type || ""));
    const size = document.createElement("input");
    size.type = "number";
    size.className = "rule-size";
    size.min = "0";
    size.step = "1";
    size.placeholder = "0";
    size.value = Number(item.size) > 0 ? String(item.size) : "";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "rule-remove";
    remove.title = t("delete");
    remove.textContent = "×";
    row.append(state, value, size, remove);
    return row;
  }
  function renderRuleRows(kind) {
    const root = $(kind === "Ext" ? "#extensionRules" : "#typeRules");
    root.textContent = "";
    const fragment = document.createDocumentFragment();
    captureRules[kind].forEach((item) => fragment.appendChild(createRuleRow(kind, item)));
    root.appendChild(fragment);
  }
  function renderCaptureRules() {
    chrome.storage.sync.get(CAPTURE_DEFAULTS, (items) => {
      const defaults = cloneCaptureDefaults();
      captureRules = {
        Ext: Array.isArray(items.Ext) ? items.Ext.map((item) => ({ ...item })) : defaults.Ext,
        Type: Array.isArray(items.Type) ? items.Type.map((item) => ({ ...item })) : defaults.Type
      };
      renderRuleRows("Ext");
      renderRuleRows("Type");
      setCaptureRulesStatus("");
    });
  }
  function readRuleRows(kind) {
    const root = $(kind === "Ext" ? "#extensionRules" : "#typeRules");
    const rows = [];
    const seen = new Set();
    root.querySelectorAll(".rule-row").forEach((row) => {
      const value = $(".rule-value", row).value.trim().toLowerCase();
      if (!value) return;
      const normalizedValue = kind === "Ext" ? value.replace(/^\./, "") : value;
      if (!normalizedValue) throw new Error(t("mediaRuleValueError"));
      if (seen.has(normalizedValue)) throw new Error(t("duplicateMediaRule", normalizedValue));
      seen.add(normalizedValue);
      const sizeText = $(".rule-size", row).value.trim();
      const size = sizeText === "" ? 0 : Number(sizeText);
      if (!Number.isFinite(size) || size < 0) throw new Error(t("minimumSizeError"));
      if (kind === "Type" && !/^[^\s/]+\/[^\s/]+$/.test(value)) throw new Error(t("mediaTypeFormatError"));
      rows.push(kind === "Ext"
        ? { ext: normalizedValue, size, state: $(".rule-state", row).checked }
        : { type: normalizedValue, size, state: $(".rule-state", row).checked });
    });
    return rows;
  }
  function updateValueState(row) { const action = row.dataset.action; const fixed = Object.prototype.hasOwnProperty.call(FIXED, action); $(".value", row).disabled = fixed; if (fixed) $(".value", row).value = FIXED[action]; }
  function renderShortcuts() {
    const root = $("#shortcutRows"); const fragment = document.createDocumentFragment(); root.textContent = "";
    DEFAULTS.keyBindings.forEach((defaultItem, index) => {
      const item = settings.keyBindings.find((binding) => binding.action === defaultItem.action) || { ...defaultItem, key: null };
      const row = document.createElement("div"); row.className = "shortcut-row"; row.dataset.index = index; row.dataset.action = defaultItem.action;
      const action = document.createElement("span"); action.className = "shortcut-action"; action.textContent = ACTIONS[defaultItem.action];
      const keyInput = document.createElement("input"); keyInput.className = "key"; keyInput.type = "text"; keyInput.placeholder = t("keyPlaceholder");
      const value = document.createElement("input"); value.className = "value"; value.type = "number"; value.step = "0.01";
      const forceLabel = document.createElement("label"); forceLabel.className = "force-label";
      const force = document.createElement("input"); force.className = "force"; force.type = "checkbox"; forceLabel.append(force, document.createTextNode(" " + t("exclusive")));
      row.append(action, keyInput, value, forceLabel);
      const key = $(".key", row); key.dataset.code = Number.isInteger(item.key) && item.key > 0 ? item.key : ""; key.value = keyName(item.key);
      $(".value", row).value = item.value ?? ""; $(".force", row).checked = item.force === true || item.force === "true"; updateValueState(row); fragment.appendChild(row);
    });
    root.appendChild(fragment);
  }
  function readShortcuts() {
    const result = [];
    const usedKeys = new Set();
    let valid = true;
    document.querySelectorAll(".shortcut-row").forEach((row) => {
      const action = row.dataset.action;
      const key = Number($(".key", row).dataset.code);
      const normalizedKey = Number.isInteger(key) && key > 0 ? key : null;
      const input = $(".value", row);
      const fixed = Object.prototype.hasOwnProperty.call(FIXED, action);
      const value = fixed ? FIXED[action] : Number(input.value);
      if (normalizedKey && usedKeys.has(normalizedKey)) throw new Error(t("duplicateShortcutKey", keyName(normalizedKey)));
      if (normalizedKey) usedKeys.add(normalizedKey);
      if (normalizedKey && ((!fixed && (!Number.isFinite(value) || value <= 0)) || (action === "fast" && (value < MIN_RATE || value > MAX_RATE)))) valid = false;
      result.push({ action, key: normalizedKey, value: Number.isFinite(value) ? value : 0, force: $(".force", row).checked, predefined: true });
    });
    if (!valid) throw new Error(t("invalidShortcut"));
    return result;
  }
  function save(patch, message, complete) {
    settings = { ...settings, ...patch };
    setStatus(message);
    chrome.storage.local.set(settings);
    chrome.storage.sync.set(patch, () => {
      if (chrome.runtime.lastError) return setStatus(t("saveFailed", chrome.runtime.lastError.message), true);
      if (typeof complete === "function") complete();
    });
  }
  // Paint the popup immediately; sync storage can take a noticeable amount of time.
  settings = cloneDefaults();
  renderGeneral();
  renderShortcuts();
  siteStatus();
  function openPage(panelId) {
    const panel = $("#" + panelId);
    if (!panel) return;
    $("#mainMenu").classList.add("hidden");
    document.querySelectorAll(".subpage").forEach((page) => page.classList.toggle("hidden", page !== panel));
    currentPopupPanel = panelId;
    chrome.runtime.sendMessage({ Message: "setHlsPopupPanel", panel: panelId }, () => void chrome.runtime.lastError);
    $(".content").scrollTop = 0;
    if (panelId === "capturePanel") {
      renderCapture();
      renderCaptureRules();
    }
    if (panelId === "imagePreviewPanel") renderImagePreviewToggle();
    if (["imagePreviewSettingsPanel", "imagePreviewRulesPanel", "imagePreviewShortcutsPanel"].includes(panelId)) loadImagePreviewPrefs();
  }
  function openMainMenu() {
    document.querySelectorAll(".subpage").forEach((page) => page.classList.add("hidden"));
    $("#mainMenu").classList.remove("hidden");
    currentPopupPanel = "mainMenu";
    chrome.runtime.sendMessage({ Message: "setHlsPopupPanel", panel: "mainMenu" }, () => void chrome.runtime.lastError);
    $(".content").scrollTop = 0;
    document.querySelectorAll("#captureList audio, #captureList video").forEach((media) => media.pause());
  }
  const captureRulesBox = $(".rules-box");
  const captureRulesSummary = $(".rules-summary", captureRulesBox);
  const captureRulesToggle = $("#captureRulesToggle");
  const updateCaptureRulesToggle = () => {
    const expanded = captureRulesBox.open;
    const label = t(expanded ? "collapsePreviewRule" : "expandPreviewRule");
    captureRulesToggle.title = label;
    captureRulesToggle.setAttribute("aria-label", label);
    captureRulesToggle.setAttribute("aria-expanded", String(expanded));
  };
  captureRulesSummary.addEventListener("click", (event) => event.preventDefault());
  captureRulesToggle.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    captureRulesBox.open = !captureRulesBox.open;
    updateCaptureRulesToggle();
  });
  captureRulesBox.addEventListener("toggle", updateCaptureRulesToggle);
  updateCaptureRulesToggle();
  document.addEventListener("click", (event) => {
    const entry = event.target.closest("[data-page]");
    if (entry) {
      event.preventDefault();
      openPage(entry.dataset.page);
      return;
    }
    if (event.target.closest("[data-back]")) {
      event.preventDefault();
      const destination = event.target.closest("[data-back]").dataset.back;
      if (destination && destination !== "mainMenu") openPage(destination);
      else openMainMenu();
      return;
    }
  });
  $("#enabled").addEventListener("change", () => {
    const enabled = $("#enabled").checked;
    save({ enabled }, t("playbackStatus", enabledLabel(enabled)));
  });
  $("#captureEnabled").addEventListener("change", () => {
    const enabled = $("#captureEnabled").checked;
    const complete = () => {
      renderCapture();
      if (!enabled && currentTabId >= 0) {
        chrome.runtime.sendMessage({ Message: "clearData", type: true, tabId: currentTabId }, () => void chrome.runtime.lastError);
      }
    };
    save({ mediaRetrievalEnabled: enabled }, t("mediaCaptureStatus", enabledLabel(enabled)), complete);
  });
  $("#imagePreviewEnabled").addEventListener("change", () => {
    const enabled = $("#imagePreviewEnabled").checked;
    save({ imagePreviewEnabled: enabled }, t("imagePreviewStatus", enabledLabel(enabled)), notifyImagePreviewContent);
  });
  $("#saveImagePreviewSettings").addEventListener("click", () => {
    try { persistImagePreviewPrefs(readImagePreviewSettings(), t("imageSettingsSaved")); }
    catch (error) { setStatus(error.message, true); }
  });
  $("#imageActivationMode").addEventListener("change", updateActivationDelayVisibility);
  $("#resetImagePreviewSettings").addEventListener("click", () => {
    if (!imagePreviewDefaults || !imagePreviewPrefs) return;
    const next = cloneJson(imagePreviewPrefs);
    const scOffInInput = next.hz.scOffInInput;
    next.hz = cloneJson(imagePreviewDefaults.hz);
    next.hz.scOffInInput = scOffInInput;
    imagePreviewPrefs = next;
    renderImagePreviewSettings();
    persistImagePreviewPrefs(next, t("imageSettingsReset"));
  });
  $("#saveImagePreviewShortcuts").addEventListener("click", () => {
    try { persistImagePreviewPrefs(readImagePreviewShortcuts(), t("imageShortcutsSaved")); }
    catch (error) { setStatus(error.message, true); }
  });
  $("#resetImagePreviewShortcuts").addEventListener("click", () => {
    if (!imagePreviewDefaults || !imagePreviewPrefs) return;
    const next = cloneJson(imagePreviewPrefs);
    next.keys = cloneJson(imagePreviewDefaults.keys);
    next.hz.scOffInInput = imagePreviewDefaults.hz.scOffInInput;
    imagePreviewPrefs = next;
    renderImagePreviewShortcuts();
    persistImagePreviewPrefs(next, t("imageShortcutsReset"));
  });
  $("#imagePreviewRuleList").addEventListener("click", async event => {
    const toggle = event.target.closest(".preview-url-rule-toggle");
    if (toggle) {
      const row = toggle.closest(".preview-url-rule");
      setPreviewUrlRuleExpanded(row, !row.classList.contains("is-expanded"));
      return;
    }
    const remove = event.target.closest(".preview-url-rule-remove");
    if (!remove) return;
    if (!await showConfirmDialog(t("removePreviewRule"), t("confirmRemovePreviewRule"), t("deletePreviewRule"), "confirm-delete")) return;
    const root = $("#imagePreviewRuleList");
    remove.closest(".preview-url-rule").remove();
    if (!root.querySelector(".preview-url-rule")) {
      root.querySelectorAll(".capture-empty").forEach(empty => empty.remove());
      const empty = document.createElement("p");
      empty.className = "capture-empty";
      empty.textContent = t("noPreviewRules");
      root.appendChild(empty);
    } else applyPreviewUrlRuleFilter();
  });
  $("#imagePreviewRuleList").addEventListener("dblclick", event => {
    const name = event.target.closest('[data-rule-field="name"]');
    if (name) setPreviewRuleNameEditing(name, true);
  });
  $("#imagePreviewRuleList").addEventListener("focusout", event => {
    if (event.target.matches('[data-rule-field="name"]')) setPreviewRuleNameEditing(event.target, false);
  });
  $("#imagePreviewRuleList").addEventListener("keydown", event => {
    if (!event.target.matches('[data-rule-field="name"]') || event.target.readOnly) return;
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      event.target.blur();
    }
  });
  $("#imagePreviewRuleSearch").addEventListener("input", applyPreviewUrlRuleFilter);
  $("#clearImagePreviewRuleSearch").addEventListener("click", () => {
    const search = $("#imagePreviewRuleSearch");
    search.value = "";
    applyPreviewUrlRuleFilter();
    search.focus();
  });
  $("#addImagePreviewRule").addEventListener("click", () => {
    const root = $("#imagePreviewRuleList");
    $("#imagePreviewRuleSearch").value = "";
    root.querySelectorAll(".capture-empty").forEach(empty => empty.remove());
    const row = createPreviewUrlRuleRow({ enabled: true }, true);
    root.appendChild(row);
    applyPreviewUrlRuleFilter();
    setPreviewRuleNameEditing(row.querySelector('[data-rule-field="name"]'), true);
    root.scrollTop = root.scrollHeight;
  });
  $("#saveImagePreviewRules").addEventListener("click", () => {
    if (!imagePreviewPrefs) return;
    try {
      const next = cloneJson(imagePreviewPrefs);
      next.urlRules = readImagePreviewRules();
      persistImagePreviewPrefs(next, t("previewRulesSaved"));
    } catch (error) { setStatus(error.message, true); }
  });
  $("#resetImagePreviewRules").addEventListener("click", () => {
    if (!imagePreviewDefaults || !imagePreviewPrefs) return;
    const next = cloneJson(imagePreviewPrefs);
    next.urlRules = cloneJson(imagePreviewDefaults.urlRules);
    imagePreviewPrefs = next;
    renderImagePreviewRules();
    persistImagePreviewPrefs(next, t("previewRulesReset"));
  });
  $("#saveGeneral").addEventListener("click", () => { const opacity = Number($("#controllerOpacity").value); if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) return setStatus(t("opacityError"), true); save({ startHidden: $("#startHidden").checked, rememberSpeed: $("#rememberSpeed").checked, forceLastSavedSpeed: $("#forceLastSavedSpeed").checked, audioBoolean: $("#audioBoolean").checked, controllerOpacity: opacity }, t("playbackSaved")); });
  $("#saveShortcuts").addEventListener("click", () => { try { save({ keyBindings: readShortcuts() }, t("shortcutsSaved")); } catch (error) { setStatus(error.message, true); } });
  $("#resetShortcuts").addEventListener("click", () => { const keyBindings = cloneDefaults().keyBindings; settings.keyBindings = keyBindings; renderShortcuts(); save({ keyBindings }, t("shortcutsReset")); });
  $("#resetGeneral").addEventListener("click", () => { const defaults = cloneDefaults(); const patch = { startHidden: defaults.startHidden, rememberSpeed: defaults.rememberSpeed, forceLastSavedSpeed: defaults.forceLastSavedSpeed, audioBoolean: defaults.audioBoolean, controllerOpacity: defaults.controllerOpacity }; settings = { ...settings, ...patch }; renderGeneral(); save(patch, t("playbackReset")); });
  $("#captureFilter").addEventListener("input", renderCaptureList);
  $("#captureList").addEventListener("scroll", updatePinnedDownloadItem, { passive: true });
  $("#captureSort").addEventListener("click", () => {
    const nextMode = { default: "name", name: "size", size: "default" };
    const labels = { default: t("sortDefault"), name: t("sortName"), size: t("sortSize") };
    captureSortMode = nextMode[captureSortMode];
    $("#captureSort").textContent = labels[captureSortMode];
    $("#captureSort").title = t("sortTitle", labels[captureSortMode]);
    renderCaptureList();
  });
  function startHlsDownload(item, playlistUrl, index, audioUrl = "", estimatedSize = 0) {
    setHlsDownloadState(item.url, { state: "starting", message: t("creatingFullDownload") }, true);
    sendRuntimeMessage({
      Message: "startHlsDownload",
      sourceUrl: item.url,
      url: playlistUrl,
      audioUrl,
      estimatedSize,
      allowMemoryMerge: Boolean(audioUrl),
      popupPanel: currentPopupPanel,
      referer: item.referer || item.initiator || "",
      fileName: captureFileName(item, index)
    }, response => {
      if (!response.ok) {
        setHlsDownloadState(item.url, { state: "error", message: t("downloadFailed", response.error) }, true);
        return;
      }
      setHlsDownloadState(item.url, { state: "loading", jobId: response.jobId, message: t("readingPlaylist") }, true);
    });
  }
  function prepareHlsDownload(item, index) {
    const cached = hlsQualityOptions.get(item.url);
    if (cached && cached.length) {
      setHlsDownloadState(item.url, { state: "choice", message: t("chooseDownload") }, true);
      return;
    }
    setHlsDownloadState(item.url, { state: "probing", message: t("readingQualities") }, true);
    sendRuntimeMessage({ Message: "probeHls", url: item.url, referer: item.referer || item.initiator || "" }, response => {
      if (!response.ok) {
        setHlsDownloadState(item.url, { state: "error", message: t("qualityReadFailed", response.error) }, true);
        return;
      }
      if (!response.variants || !response.variants.length) return setHlsDownloadState(item.url, { state: "error", message: t("noDownloadOptions") }, true);
      hlsQualityOptions.set(item.url, response.variants);
      const usable = response.variants.some(variant => variant.supported);
      setHlsDownloadState(item.url, {
        state: usable ? "choice" : "error",
        message: usable ? t("chooseDownload") : (response.variants[0].reason || t("noDownloadQuality"))
      }, true);
    });
  }
  function prepareDirectDownload(item) {
    hlsQualityOptions.set(item.url, [{
      direct: true,
      supported: true,
      url: item.url,
      label: captureFormat(item) + " · " + captureSize(item.size)
    }]);
    setHlsDownloadState(item.url, { state: "choice", message: t("chooseDownload") }, true);
  }
  function startDirectDownload(item, index) {
    setHlsDownloadState(item.url, { state: "starting", message: t("creatingDownload") }, true);
    const downloadOptions = {
      url: item.url,
      filename: captureFileName(item, index),
      saveAs: false
    };
    const referer = String(item.referer || item.initiator || "");
    if (/^https?:\/\//i.test(referer)) {
      downloadOptions.headers = [{ name: "Referer", value: referer }];
    }
    chrome.downloads.download(downloadOptions, () => {
      const error = chrome.runtime.lastError;
      const message = error
        ? t("downloadFailed", error.message)
        : t(downloadOptions.headers ? "downloadWithReferer" : "downloadStarted");
      setHlsDownloadState(item.url, { state: error ? "error" : "complete", message }, true);
      setStatus(message, Boolean(error));
    });
  }
  function prepareItemDownload(item, index) {
    const state = hlsDownloadStates.get(item.url);
    if (state && ["probing", "starting", "loading", "downloading", "saving", "cancelling"].includes(state.state)) return;
    if (isHlsItem(item)) prepareHlsDownload(item, index);
    else prepareDirectDownload(item);
  }
  async function copyCaptureUrl(url) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(url);
      return;
    }
    const input = document.createElement("textarea");
    input.value = url;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    let copied = false;
    try {
      input.select();
      copied = document.execCommand("copy");
    } finally {
      input.remove();
    }
    if (!copied) throw new Error("copy failed");
  }
  function cancelHlsDownload(event) {
    const cancelDownload = event.target.closest("[data-cancel-hls]");
    if (!cancelDownload) return false;
    event.preventDefault();
    event.stopPropagation();
    const details = cancelDownload.closest(".capture-item");
    const item = details && captureItems[Number(details.dataset.index)];
    const jobId = cancelDownload.dataset.cancelHls;
    if (!item || !jobId) return true;
    const previous = hlsDownloadStates.get(item.url) || {};
    setHlsDownloadState(item.url, { ...previous, state: "cancelling", message: t("cancellingDownload") }, false);
    sendRuntimeMessage({ Message: "cancelHlsDownload", jobId }, response => {
      if (!response.ok) restoreHlsDownloadStates();
    });
    return true;
  }
  $("#captureList").addEventListener("pointerdown", cancelHlsDownload);
  $("#captureList").addEventListener("click", async (event) => {
    if (event.target.closest("[data-cancel-hls]")) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const copy = event.target.closest(".capture-copy");
    if (copy) {
      event.preventDefault();
      event.stopPropagation();
      const details = copy.closest(".capture-item");
      const item = details && captureItems[Number(details.dataset.index)];
      if (!item || !item.url) return;
      copyCaptureUrl(String(item.url)).then(() => {
        setStatus(t("linkCopied"));
      }).catch(() => {
        setStatus(t("copyFailed"), true);
      });
      return;
    }
    const quality = event.target.closest("[data-hls-quality]");
    if (quality) {
      event.preventDefault();
      event.stopPropagation();
      const details = quality.closest(".capture-item");
      const index = Number(details.dataset.index);
      const item = captureItems[index];
      const variants = item && hlsQualityOptions.get(item.url);
      const variant = variants && variants[Number(quality.dataset.hlsQuality)];
      if (item && variant && variant.supported) {
        if (variant.direct) startDirectDownload(item, index);
        else {
          if (variant.audioUrl && shouldWarnForMemoryMerge(variant.estimatedSize)) {
            const estimatedSize = Number(variant.estimatedSize) || 0;
            const estimatedPeak = estimatedSize * MEMORY_MERGE_PEAK_MULTIPLIER;
            const message = t("separateTrackMemoryWarning", [captureSize(estimatedSize), captureSize(estimatedPeak)]);
            if (!await confirmMemoryMerge(message)) return;
          }
          startHlsDownload(item, variant.url, index, variant.audioUrl || "", variant.estimatedSize || 0);
        }
      }
      return;
    }
    const summary = event.target.closest(".capture-item > summary");
    if (summary) {
      event.preventDefault();
      const name = event.target.closest(".capture-name");
      if (name) summary.parentElement.open = !summary.parentElement.open;
    }
  });
  $("#captureList").addEventListener("toggle", (event) => {
    if (!event.target.matches(".capture-item")) return;
    if (event.target.open) {
      const index = Number(event.target.dataset.index);
      const item = captureItems[index];
      if (item && item.url) prepareItemDownload(item, index);
      mountCapturePreview(event.target);
      requestAnimationFrame(updatePinnedDownloadItem);
      return;
    }
    const preview = $(".capture-preview", event.target);
    if (preview && typeof preview.pause === "function") preview.pause();
    requestAnimationFrame(updatePinnedDownloadItem);
  }, true);
  $("#capturePanel").addEventListener("click", (event) => {
    const remove = event.target.closest(".rule-remove");
    if (remove) {
      remove.closest(".rule-row").remove();
      setCaptureRulesStatus(t("notSaved"));
      return;
    }
    const add = event.target.closest("[data-add-rule]");
    if (!add) return;
    const kind = add.dataset.addRule;
    const root = $(kind === "Ext" ? "#extensionRules" : "#typeRules");
    root.appendChild(createRuleRow(kind));
    root.scrollTop = root.scrollHeight;
    setCaptureRulesStatus(t("notSaved"));
  });
  $("#saveCaptureRules").addEventListener("click", () => {
    try {
      const Ext = readRuleRows("Ext");
      const Type = readRuleRows("Type");
      chrome.storage.sync.set({ Ext, Type }, () => {
        if (chrome.runtime.lastError) return setCaptureRulesStatus(t("saveFailed", chrome.runtime.lastError.message), true);
        captureRules = { Ext, Type };
        setCaptureRulesStatus(t("captureRulesSaved"));
      });
    } catch (error) {
      setCaptureRulesStatus(error.message, true);
    }
  });
  $("#resetCaptureRules").addEventListener("click", () => {
    captureRules = cloneCaptureDefaults();
    renderRuleRows("Ext");
    renderRuleRows("Type");
    chrome.storage.sync.set({ Ext: captureRules.Ext, Type: captureRules.Type }, () => {
      setCaptureRulesStatus(chrome.runtime.lastError ? t("restoreFailed", chrome.runtime.lastError.message) : t("captureRulesReset"), Boolean(chrome.runtime.lastError));
    });
  });
  $("#shortcutRows").addEventListener("keydown", (event) => { if (!event.target.classList.contains("key")) return; event.preventDefault(); if (["Backspace", "Delete", "Escape"].includes(event.key)) { event.target.value = ""; event.target.dataset.code = ""; return; } const code = event.keyCode || event.which; if (code) { event.target.dataset.code = code; event.target.value = keyName(code); } });
  $("#imageShortcutRows").addEventListener("keydown", (event) => {
    if (!event.target.matches("[data-imagus-key]")) return;
    event.preventDefault();
    if (["Backspace", "Delete", "Escape"].includes(event.key)) {
      event.target.value = "";
      return;
    }
    const specialKeys = { " ": "Space", Tab: "Tab", Enter: "Enter", ArrowLeft: "Left", ArrowUp: "Up", ArrowRight: "Right", ArrowDown: "Down" };
    const value = specialKeys[event.key] || (event.key.length === 1 ? event.key.toUpperCase() : "");
    if (value) event.target.value = value;
  });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    currentTabId = tabs[0] && Number.isInteger(tabs[0].id) ? tabs[0].id : -1;
    renderGeneral();
    renderCapture();
    siteStatus();
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.Message === "hlsDownloadProgress" && message.sourceUrl) {
      const previous = hlsDownloadStates.get(message.sourceUrl) || {};
      const next = { ...previous, state: message.state, jobId: message.jobId, message: message.message || "", completed: message.completed || 0, total: message.total || 0 };
      setHlsDownloadState(message.sourceUrl, next, false);
      if (message.state === "complete") setStatus(message.message || t("completeMp4Started"));
      if (message.state === "error") setStatus(message.message || t("m3u8DownloadFailed"), true);
      return;
    }
    if (!message || message.tabId !== currentTabId || !message.url || !captureIsEnabled()) return;
    if (captureItems.some((item) => item.url === message.url)) return;
    const index = captureItems.length;
    captureItems.push(message);
    const query = $("#captureFilter").value.trim().toLowerCase();
    if (captureSortMode === "default" && !query) {
      const root = $("#captureList");
      const empty = $(".capture-empty", root);
      if (empty) empty.remove();
      root.appendChild(createCaptureItem(message, index));
      updateCaptureSummary(captureItems.length);
      return;
    }
    renderCaptureList();
  });
  restoreHlsDownloadStates();
  const normalizeKeyBindings = (bindings) => {
    const defaults = cloneDefaults().keyBindings;
    if (!Array.isArray(bindings) || !bindings.length) return defaults;
    return defaults.map((defaultItem) => {
      const stored = bindings.find((item) => item && item.action === defaultItem.action);
      if (!stored) return { ...defaultItem, key: null };
      const key = Number(stored.key);
      const value = Number(stored.value);
      return {
        ...defaultItem,
        key: Number.isInteger(key) && key > 0 ? key : null,
        value: Number.isFinite(value) ? value : defaultItem.value,
        force: stored.force === true || stored.force === "true"
      };
    });
  };
  const applyStored = (stored) => {
    settings = { ...cloneDefaults(), ...stored, keyBindings: normalizeKeyBindings(stored.keyBindings) };
    renderGeneral();
    renderShortcuts();
    renderCapture();
    siteStatus();
  };
  chrome.storage.local.get(DEFAULTS, (cached) => {
    if (!chrome.runtime.lastError && cached && cached.keyBindings) applyStored(cached);
    chrome.storage.sync.get(DEFAULTS, (stored) => {
      if (chrome.runtime.lastError) { if (!cached || !cached.keyBindings) setStatus(enabledLabel(settings.enabled)); return; }
      const normalizedKeyBindings = normalizeKeyBindings(stored.keyBindings);
      if (JSON.stringify(stored.keyBindings) !== JSON.stringify(normalizedKeyBindings)) {
        stored.keyBindings = normalizedKeyBindings;
        chrome.storage.sync.set({ keyBindings: stored.keyBindings });
      }
      applyStored(stored);
      chrome.storage.local.set(stored);
    });
  });
});
