"use strict";

(() => {
  const t = key => chrome.i18n.getMessage(key) || key;
  const title = document.querySelector("#title");
  const status = document.querySelector("#status");
  const fileNameLabel = document.querySelector("#fileName");
  const saveButton = document.querySelector("#save");
  const shareButton = document.querySelector("#share");
  const openButton = document.querySelector("#open");
  const token = new URLSearchParams(location.search).get("token") || "";
  let downloadUrl = "";
  let fileName = "";
  let shareFile = null;
  let releaseTimer = 0;

  document.title = title.textContent = t("androidDownloadTitle");
  status.textContent = t("androidDownloadPreparing");
  saveButton.textContent = t("androidDownloadSave");
  shareButton.textContent = t("androidDownloadShare");
  openButton.textContent = t("androidDownloadOpen");

  const release = delay => {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ Message: "releaseAndroidDownload", token }, () => void chrome.runtime.lastError);
    }, delay);
  };

  chrome.runtime.sendMessage({ Message: "getAndroidDownload", token }, async response => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      status.textContent = t("androidDownloadFailed") + " " + ((response && response.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || "");
      return;
    }
    downloadUrl = response.url;
    fileName = response.fileName || "media";
    fileNameLabel.textContent = fileName;
    saveButton.disabled = false;
    openButton.disabled = false;
    status.textContent = t("androidDownloadReady");
    if (navigator.share && typeof File === "function") shareButton.hidden = false;
  });

  saveButton.addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    status.textContent = t("androidDownloadStarted");
    release(60000);
  });

  shareButton.addEventListener("click", async () => {
    if (!navigator.share || !downloadUrl) return;
    shareButton.disabled = true;
    try {
      if (!shareFile) {
        status.textContent = t("androidDownloadPreparing");
        const response = await fetch(downloadUrl);
        if (!response.ok) throw new Error("HTTP " + response.status);
        const blob = await response.blob();
        shareFile = new File([blob], fileName, { type: blob.type || "application/octet-stream" });
      }
      if (navigator.canShare && !navigator.canShare({ files: [shareFile] })) throw new Error("share unsupported");
      await navigator.share({ files: [shareFile], title: fileName });
      release(1000);
    } catch (error) {
      status.textContent = error && error.name === "AbortError" ? t("androidDownloadReady") : t("androidDownloadFailed");
    } finally {
      shareButton.disabled = false;
    }
  });

  openButton.addEventListener("click", () => {
    window.open(downloadUrl, "_blank", "noopener");
    release(5 * 60 * 1000);
  });
})();
