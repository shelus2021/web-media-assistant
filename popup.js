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
  localizeDocument();
  let settings;
  let currentTabId = -1;
  let captureItems = [];
  let captureSortMode = "default";
  let captureRules = { Ext: [], Type: [] };
  let hlsLoader;
  let imagePreviewDefaults;
  let imagePreviewPrefs;
  let imagePreviewRuleDefaults;
  let imagePreviewRuleEntries = [];
  let imagePreviewRulesLoaded = false;
  let imagePreviewRuleSort = "nameAsc";
  let statusResetTimer;
  let currentPopupPanel = "mainMenu";
  const activeDownloadStates = new Set(["starting", "loading", "downloading", "saving", "cancelling"]);
  const hlsDownloadStates = new Map();
  const hlsQualityOptions = new Map();
  const imageShortcutDefinitions = [
    ["hz_preload", "imageKeyPreload"], ["hz_hiRes", "imageKeyHighResolution"], ["hz_fullZm", "imageKeyFullZoom"],
    ["hz_caption", "imageKeyCaption"], ["hz_open", "imageKeyOpen"],
    ["flipH", "imageKeyFlipHorizontal"], ["flipV", "imageKeyFlipVertical"],
    ["rotL", "imageKeyRotateLeft"], ["rotR", "imageKeyRotateRight"], ["mOrig", "imageKeyNaturalSize"],
    ["mFit", "imageKeyAutoFit"], ["mFitW", "imageKeyFitWidth"], ["mFitH", "imageKeyFitHeight"]
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
    const storedPromise = new Promise(resolve => chrome.storage.local.get(["hz", "keys"], resolve));
    return Promise.all([defaultsPromise, storedPromise]).then(([defaults, stored]) => {
      imagePreviewPrefs = {
        hz: parseImagusStored(stored.hz, defaults.hz),
        keys: parseImagusStored(stored.keys, defaults.keys)
      };
      if (![2, 4].includes(Number(imagePreviewPrefs.hz.placement))) imagePreviewPrefs.hz.placement = 4;
      renderImagePreviewSettings();
      renderImagePreviewShortcuts();
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
    const noKeyRequired = $("#imageActivationKey").value === "0";
    $("#imageActivationLead").classList.toggle("hidden", noKeyRequired);
    $("#imageActivationMode").classList.toggle("hidden", noKeyRequired);
    const showDelay = !noKeyRequired && $("#imageActivationMode").value === "1";
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
      if (normalized && input.dataset.imagusKey !== "hz_preload") {
        const identity = normalized.toLocaleUpperCase();
        if (usedKeys.has(identity)) throw new Error(t("duplicateShortcutKey", normalized));
        usedKeys.add(identity);
      }
      next.keys[input.dataset.imagusKey] = normalized;
    });
    return next;
  }
  function parsePreviewRuleCollection(value) {
    if (typeof value === "string") {
      try { value = JSON.parse(value); } catch (_) { return null; }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const rules = {};
    const stringFields = new Set(["link", "url", "res", "img", "to", "note"]);
    const bitFields = new Set(["ci", "dc", "loop"]);
    for (const [name, rule] of Object.entries(value)) {
      if (!name.trim() || !rule || typeof rule !== "object" || Array.isArray(rule)) return null;
      for (const [key, fieldValue] of Object.entries(rule)) {
        if (stringFields.has(key)) {
          if (typeof fieldValue !== "string") return null;
        } else if (bitFields.has(key)) {
          if (!Number.isInteger(fieldValue) || fieldValue < 0 || fieldValue > 3) return null;
        } else if (key === "useimg" || key === "off") {
          if (fieldValue !== 0 && fieldValue !== 1) return null;
        } else return null;
      }
      rules[name] = cloneJson(rule);
    }
    return rules;
  }
  function rulesToEntries(rules, times = {}) {
    return Object.entries(rules).map(([name, rule]) => ({
      name,
      rule: cloneJson(rule),
      modifiedAt: Number.isFinite(times[name]) && times[name] >= 0 ? times[name] : 0
    }));
  }
  function loadImagePreviewRules() {
    if (imagePreviewRulesLoaded) {
      renderImagePreviewRules();
      return Promise.resolve();
    }
    const defaultsPromise = imagePreviewRuleDefaults
      ? Promise.resolve(imagePreviewRuleDefaults)
      : fetch(chrome.runtime.getURL("imagus/sieve.jsn")).then(response => {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      }).then(rules => {
        imagePreviewRuleDefaults = rules;
        return rules;
      });
    const storedPromise = new Promise(resolve => chrome.storage.local.get(["sieve", "imagePreviewRuleSort", "imagePreviewRuleTimes"], resolve));
    return Promise.all([defaultsPromise, storedPromise]).then(([defaults, stored]) => {
      const storedRules = parsePreviewRuleCollection(stored.sieve);
      const allowedSorts = new Set(["nameAsc", "nameDesc", "timeAsc", "timeDesc"]);
      imagePreviewRuleSort = allowedSorts.has(stored.imagePreviewRuleSort) ? stored.imagePreviewRuleSort : "nameAsc";
      $("#imagePreviewRuleSort").value = imagePreviewRuleSort;
      const times = stored.imagePreviewRuleTimes && typeof stored.imagePreviewRuleTimes === "object" && !Array.isArray(stored.imagePreviewRuleTimes)
        ? stored.imagePreviewRuleTimes : {};
      imagePreviewRuleEntries = rulesToEntries(storedRules || defaults, times);
      imagePreviewRulesLoaded = true;
      renderImagePreviewRules();
    }).catch(error => setStatus(t("imageRulesLoadFailed", error.message), true));
  }
  function updatePreviewRuleCount(visible) {
    $("#imagePreviewRuleCount").textContent = t("previewRuleCount", [visible, imagePreviewRuleEntries.length]);
  }
  function touchPreviewRule(entry) {
    entry.modifiedAt = Date.now();
  }
  function setPreviewRuleBit(rule, key, bit, checked) {
    const value = Number(rule[key]) || 0;
    const next = checked ? value | bit : value & ~bit;
    if (next) rule[key] = next;
    else delete rule[key];
  }
  function createPreviewRuleCheckbox(labelText, checked, onChange) {
    const label = document.createElement("label");
    label.className = "preview-rule-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    const text = document.createElement("span");
    text.textContent = labelText;
    label.append(input, text);
    return label;
  }
  function createPreviewRuleTextField(entry, field, labelKey, multiline = false) {
    const label = document.createElement("label");
    label.className = "preview-rule-field";
    const caption = document.createElement("span");
    caption.textContent = t(labelKey);
    const input = document.createElement(multiline ? "textarea" : "input");
    if (!multiline) input.type = "text";
    else input.rows = 3;
    input.value = typeof entry.rule[field] === "string" ? entry.rule[field] : "";
    input.addEventListener("input", () => {
      if (input.value) entry.rule[field] = input.value;
      else delete entry.rule[field];
      touchPreviewRule(entry);
    });
    label.append(caption, input);
    return label;
  }
  function createPreviewRuleEditor(entry, titleNode) {
    const editor = document.createElement("div");
    editor.className = "preview-rule-editor hidden";
    const nameLabel = document.createElement("label");
    nameLabel.className = "preview-rule-field";
    const nameCaption = document.createElement("span");
    nameCaption.textContent = t("previewRuleName");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = entry.name;
    nameInput.addEventListener("input", () => {
      entry.name = nameInput.value;
      touchPreviewRule(entry);
      titleNode.textContent = nameInput.value.trim() || t("unnamedPreviewRule");
    });
    nameLabel.append(nameCaption, nameInput);
    editor.appendChild(nameLabel);
    const flags = document.createElement("div");
    flags.className = "preview-rule-flags";
    flags.append(
      createPreviewRuleCheckbox(t("previewRuleUseImage"), Boolean(entry.rule.useimg), checked => {
        if (checked) entry.rule.useimg = 1; else delete entry.rule.useimg;
        touchPreviewRule(entry);
      }),
      createPreviewRuleCheckbox(t("previewRuleLinkCaseInsensitive"), Boolean((Number(entry.rule.ci) || 0) & 1), checked => { setPreviewRuleBit(entry.rule, "ci", 1, checked); touchPreviewRule(entry); }),
      createPreviewRuleCheckbox(t("previewRuleImageCaseInsensitive"), Boolean((Number(entry.rule.ci) || 0) & 2), checked => { setPreviewRuleBit(entry.rule, "ci", 2, checked); touchPreviewRule(entry); }),
      createPreviewRuleCheckbox(t("previewRuleLinkDecode"), Boolean((Number(entry.rule.dc) || 0) & 1), checked => { setPreviewRuleBit(entry.rule, "dc", 1, checked); touchPreviewRule(entry); }),
      createPreviewRuleCheckbox(t("previewRuleImageDecode"), Boolean((Number(entry.rule.dc) || 0) & 2), checked => { setPreviewRuleBit(entry.rule, "dc", 2, checked); touchPreviewRule(entry); }),
      createPreviewRuleCheckbox(t("previewRuleLinkLoop"), Boolean((Number(entry.rule.loop) || 0) & 1), checked => { setPreviewRuleBit(entry.rule, "loop", 1, checked); touchPreviewRule(entry); }),
      createPreviewRuleCheckbox(t("previewRuleImageLoop"), Boolean((Number(entry.rule.loop) || 0) & 2), checked => { setPreviewRuleBit(entry.rule, "loop", 2, checked); touchPreviewRule(entry); })
    );
    editor.appendChild(flags);
    [
      ["link", "previewRuleLink", false], ["url", "previewRuleUrl", true],
      ["res", "previewRuleResponse", true], ["img", "previewRuleImage", false],
      ["to", "previewRuleTo", true], ["note", "previewRuleNote", true]
    ].forEach(([field, labelKey, multiline]) => editor.appendChild(createPreviewRuleTextField(entry, field, labelKey, multiline)));
    return editor;
  }
  function renderImagePreviewRules() {
    if (!imagePreviewRulesLoaded) return;
    const root = $("#imagePreviewRuleList");
    const query = $("#imagePreviewRuleSearch").value.trim().toLocaleLowerCase();
    root.textContent = "";
    const fragment = document.createDocumentFragment();
    const displayedEntries = imagePreviewRuleEntries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => !query || entry.name.toLocaleLowerCase().includes(query) || String(entry.rule.note || "").toLocaleLowerCase().includes(query));
    const compareNames = (left, right) => left.entry.name.localeCompare(right.entry.name, undefined, { numeric: true, sensitivity: "base" });
    displayedEntries.sort((left, right) => {
      if (imagePreviewRuleSort === "nameAsc") return compareNames(left, right) || left.index - right.index;
      if (imagePreviewRuleSort === "nameDesc") return -compareNames(left, right) || left.index - right.index;
      if (imagePreviewRuleSort === "timeAsc") return left.entry.modifiedAt - right.entry.modifiedAt || left.index - right.index;
      return right.entry.modifiedAt - left.entry.modifiedAt || left.index - right.index;
    });
    const visible = displayedEntries.length;
    displayedEntries.forEach(({ entry, index }) => {
      const item = document.createElement("div");
      item.className = "preview-rule-item";
      const header = document.createElement("div");
      header.className = "preview-rule-item-header";
      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = !entry.rule.off;
      enabled.title = t("previewRuleEnabled");
      enabled.addEventListener("change", () => {
        if (enabled.checked) delete entry.rule.off; else entry.rule.off = 1;
        touchPreviewRule(entry);
        item.classList.toggle("disabled", !enabled.checked);
      });
      const title = document.createElement("button");
      title.type = "button";
      title.className = "preview-rule-name";
      title.textContent = entry.name || t("unnamedPreviewRule");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "preview-rule-mini preview-rule-delete";
      remove.textContent = "×";
      remove.title = t("removePreviewRule");
      remove.addEventListener("click", () => {
        imagePreviewRuleEntries.splice(index, 1);
        renderImagePreviewRules();
      });
      header.append(enabled, title, remove);
      const editor = createPreviewRuleEditor(entry, title);
      title.addEventListener("click", () => editor.classList.toggle("hidden"));
      item.classList.toggle("disabled", !enabled.checked);
      item.append(header, editor);
      fragment.appendChild(item);
    });
    root.appendChild(fragment);
    if (!visible) {
      const empty = document.createElement("p");
      empty.className = "capture-empty";
      empty.textContent = t("noPreviewRules");
      root.appendChild(empty);
    }
    updatePreviewRuleCount(visible);
  }
  function previewRulesObject() {
    const output = {};
    for (const entry of imagePreviewRuleEntries) {
      const name = entry.name.trim();
      if (!name) throw new Error(t("previewRuleNameRequired"));
      if (Object.prototype.hasOwnProperty.call(output, name)) throw new Error(t("previewRuleNameDuplicate", name));
      output[name] = cloneJson(entry.rule);
    }
    return output;
  }
  function persistImagePreviewRules(message) {
    let rules;
    try { rules = previewRulesObject(); }
    catch (error) { setStatus(error.message, true); return; }
    const times = {};
    imagePreviewRuleEntries.forEach(entry => { times[entry.name.trim()] = entry.modifiedAt; });
    chrome.runtime.sendMessage({ cmd: "savePrefs", prefs: { sieve: rules } }, response => {
      if (chrome.runtime.lastError || !response || response.ok !== true) {
        setStatus(t("saveFailed", chrome.runtime.lastError ? chrome.runtime.lastError.message : t("unknown")), true);
        return;
      }
      chrome.storage.local.set({ imagePreviewRuleTimes: times }, () => {
        if (chrome.runtime.lastError) {
          setStatus(t("saveFailed", chrome.runtime.lastError.message), true);
          return;
        }
        setStatus(message);
        notifyImagePreviewContent();
      });
    });
  }
  function importImagePreviewRules(value) {
    const imported = parsePreviewRuleCollection(value);
    if (!imported) throw new Error(t("invalidPreviewRules"));
    const importedAt = Date.now();
    if ($("#imagePreviewRuleImportMode").value === "replace") {
      imagePreviewRuleEntries = rulesToEntries(imported);
      imagePreviewRuleEntries.forEach(entry => { entry.modifiedAt = importedAt; });
    } else {
      const positions = new Map(imagePreviewRuleEntries.map((entry, index) => [entry.name, index]));
      Object.entries(imported).forEach(([name, rule]) => {
        if (positions.has(name)) imagePreviewRuleEntries[positions.get(name)] = { name, rule: cloneJson(rule), modifiedAt: importedAt };
        else imagePreviewRuleEntries.push({ name, rule: cloneJson(rule), modifiedAt: importedAt });
      });
    }
    $("#imagePreviewRuleSearch").value = "";
    renderImagePreviewRules();
    setStatus(t("previewRulesImported"));
  }
  function exportImagePreviewRules() {
    let rules;
    try { rules = previewRulesObject(); }
    catch (error) { setStatus(error.message, true); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(rules, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "web-media-assistant-preview-rules.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(t("previewRulesExported"));
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
  function confirmMemoryMerge(message) {
    return new Promise(resolve => {
      const overlay = document.createElement("div");
      overlay.className = "confirm-overlay";
      const dialog = document.createElement("div");
      dialog.className = "confirm-dialog";
      dialog.setAttribute("role", "alertdialog");
      dialog.setAttribute("aria-modal", "true");
      const title = document.createElement("strong");
      title.className = "confirm-title";
      title.textContent = t("memoryWarningTitle");
      const body = document.createElement("p");
      body.className = "confirm-message";
      body.textContent = message;
      const actions = document.createElement("div");
      actions.className = "confirm-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "confirm-cancel";
      cancel.textContent = t("cancelDownload");
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "confirm-continue";
      confirm.textContent = t("continueDownload");
      actions.append(cancel, confirm);
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
      confirm.addEventListener("click", () => finish(true));
      overlay.addEventListener("click", event => {
        if (event.target === overlay) finish(false);
      });
      document.addEventListener("keydown", handleKeydown, true);
      document.body.appendChild(overlay);
      confirm.focus();
    });
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
      if (hasActiveDownload() && response.panel && response.panel !== "mainMenu") openPage(response.panel);
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
  function updateValueState(row) { const action = $(".action", row).value; const fixed = Object.prototype.hasOwnProperty.call(FIXED, action); $(".value", row).disabled = fixed; if (fixed) $(".value", row).value = FIXED[action]; }
  function renderShortcuts() {
    const root = $("#shortcutRows"); const fragment = document.createDocumentFragment(); root.textContent = "";
    settings.keyBindings.forEach((item, index) => {
      const row = document.createElement("div"); row.className = "shortcut-row"; row.dataset.index = index;
      const action = document.createElement("select"); action.className = "action";
      Object.entries(ACTIONS).forEach(([value, label]) => { const option = document.createElement("option"); option.value = value; option.textContent = label; action.appendChild(option); });
      const keyInput = document.createElement("input"); keyInput.className = "key"; keyInput.type = "text"; keyInput.placeholder = t("keyPlaceholder");
      const value = document.createElement("input"); value.className = "value"; value.type = "number"; value.step = "0.01";
      const forceLabel = document.createElement("label"); forceLabel.className = "force-label";
      const force = document.createElement("input"); force.className = "force"; force.type = "checkbox"; forceLabel.append(force, document.createTextNode(" " + t("exclusive")));
      const remove = document.createElement("button"); remove.className = "remove"; remove.type = "button"; remove.title = t("delete"); remove.textContent = "×";
      row.append(action, keyInput, value, forceLabel, remove);
      $(".action", row).value = item.action; const key = $(".key", row); key.dataset.code = Number.isInteger(item.key) && item.key > 0 ? item.key : ""; key.value = keyName(item.key);
      $(".value", row).value = item.value ?? ""; $(".force", row).checked = item.force === true || item.force === "true"; updateValueState(row); fragment.appendChild(row);
    });
    root.appendChild(fragment);
  }
  function readShortcuts() {
    const result = [];
    const usedKeys = new Set();
    let valid = true;
    document.querySelectorAll(".shortcut-row").forEach((row) => {
      const action = $(".action", row).value;
      const key = Number($(".key", row).dataset.code);
      const normalizedKey = Number.isInteger(key) && key > 0 ? key : null;
      const input = $(".value", row);
      const fixed = Object.prototype.hasOwnProperty.call(FIXED, action);
      const value = fixed ? FIXED[action] : Number(input.value);
      if (normalizedKey && usedKeys.has(normalizedKey)) throw new Error(t("duplicateShortcutKey", keyName(normalizedKey)));
      if (normalizedKey) usedKeys.add(normalizedKey);
      if (normalizedKey && ((!fixed && (!Number.isFinite(value) || value <= 0)) || (action === "fast" && (value < MIN_RATE || value > MAX_RATE)))) valid = false;
      result.push({ action, key: normalizedKey, value: Number.isFinite(value) ? value : 0, force: $(".force", row).checked, predefined: false });
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
    if (panelId === "imagePreviewSettingsPanel" || panelId === "imagePreviewShortcutsPanel") loadImagePreviewPrefs();
    if (panelId === "imagePreviewRulesPanel") loadImagePreviewRules();
  }
  function openMainMenu() {
    document.querySelectorAll(".subpage").forEach((page) => page.classList.add("hidden"));
    $("#mainMenu").classList.remove("hidden");
    currentPopupPanel = "mainMenu";
    chrome.runtime.sendMessage({ Message: "setHlsPopupPanel", panel: "mainMenu" }, () => void chrome.runtime.lastError);
    $(".content").scrollTop = 0;
    document.querySelectorAll("#captureList audio, #captureList video").forEach((media) => media.pause());
  }
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
    if (event.target.closest(".remove")) { event.target.closest(".shortcut-row").remove(); }
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
  $("#imageActivationKey").addEventListener("change", updateActivationDelayVisibility);
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
  $("#imagePreviewRuleSearch").addEventListener("input", renderImagePreviewRules);
  $("#imagePreviewRuleSort").addEventListener("change", event => {
    imagePreviewRuleSort = event.target.value;
    chrome.storage.local.set({ imagePreviewRuleSort }, () => {
      if (chrome.runtime.lastError) setStatus(t("saveFailed", chrome.runtime.lastError.message), true);
    });
    renderImagePreviewRules();
  });
  $("#addImagePreviewRule").addEventListener("click", () => {
    let number = 1;
    const names = new Set(imagePreviewRuleEntries.map(entry => entry.name));
    let name = t("newPreviewRule", number);
    while (names.has(name)) name = t("newPreviewRule", ++number);
    imagePreviewRuleEntries.unshift({ name, rule: {}, modifiedAt: Date.now() });
    $("#imagePreviewRuleSearch").value = "";
    renderImagePreviewRules();
    $("#imagePreviewRuleList").scrollTop = 0;
  });
  $("#importImagePreviewRulesText").addEventListener("click", () => {
    try { importImagePreviewRules($("#imagePreviewRuleImportText").value.trim()); }
    catch (error) { setStatus(error.message, true); }
  });
  $("#imagePreviewRuleFile").addEventListener("change", event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setStatus(t("previewRulesFileTooLarge"), true);
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setStatus(t("previewRulesReadFailed"), true);
    reader.onload = () => {
      try { importImagePreviewRules(String(reader.result || "")); }
      catch (error) { setStatus(error.message, true); }
      event.target.value = "";
    };
    reader.readAsText(file);
  });
  $("#exportImagePreviewRules").addEventListener("click", exportImagePreviewRules);
  $("#saveImagePreviewRules").addEventListener("click", () => persistImagePreviewRules(t("previewRulesSaved")));
  $("#resetImagePreviewRules").addEventListener("click", () => {
    if (!imagePreviewRuleDefaults) return;
    imagePreviewRuleEntries = rulesToEntries(imagePreviewRuleDefaults);
    const resetAt = Date.now();
    imagePreviewRuleEntries.forEach(entry => { entry.modifiedAt = resetAt; });
    $("#imagePreviewRuleSearch").value = "";
    renderImagePreviewRules();
    persistImagePreviewRules(t("previewRulesReset"));
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
  $("#addShortcut").addEventListener("click", () => { settings.keyBindings.push({ action: "faster", key: null, value: 0.1, force: false }); renderShortcuts(); });
  $("#shortcutRows").addEventListener("change", (event) => { const row = event.target.closest(".shortcut-row"); if (row && event.target.classList.contains("action")) updateValueState(row); });
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
    const normalized = Array.isArray(bindings) && bindings.length ? bindings.map((item) => ({ ...item })) : defaults;
    if (!normalized.some((item) => item.action === "display")) {
      normalized.unshift({ ...defaults.find((item) => item.action === "display") });
    }
    return normalized;
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
      const missingDisplay = !Array.isArray(stored.keyBindings) || !stored.keyBindings.some((item) => item.action === "display");
      if (missingDisplay) {
        stored.keyBindings = normalizeKeyBindings(stored.keyBindings);
        chrome.storage.sync.set({ keyBindings: stored.keyBindings });
      }
      applyStored(stored);
      chrome.storage.local.set(stored);
    });
  });
});
