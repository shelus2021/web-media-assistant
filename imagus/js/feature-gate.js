"use strict";

// Replace Imagus' legacy grants list with this extension's global preview switch.
(function installImagePreviewGate() {
  var listen = Port.listen;
  Port.listen = function (listener) {
    return listen.call(Port, function (message, sender, sendResponse) {
      if (!message || message.cmd !== "hello") return listener(message, sender, sendResponse);
      chrome.storage.sync.get({ imagePreviewEnabled: true }, function (settings) {
        if (settings.imagePreviewEnabled === false) {
          sendResponse({ cmd: "hello", prefs: null });
          return;
        }
        listener(message, sender, sendResponse);
      });
      return true;
    });
  };
})();
