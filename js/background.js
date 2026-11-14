const OTHER_PAGE_LIMIT = 100;
const REFERER_DATA_LIMIT = 5000;
const MEDIA_URL_LIMIT = 32768;
const pendingMediaByTab = new Map();
const tabMediaGenerations = new Map();
const activeMediaDownloadCounts = new Map();
const mediaDownloadIds = new Map();
let mediaEpoch = 0;

function lockMediaDownload(url) {
    if (typeof url != "string" || !url) { return; }
    activeMediaDownloadCounts.set(url, (activeMediaDownloadCounts.get(url) || 0) + 1);
}

function unlockMediaDownload(url) {
    const count = activeMediaDownloadCounts.get(url) || 0;
    if (count <= 1) { activeMediaDownloadCounts.delete(url); }
    else { activeMediaDownloadCounts.set(url, count - 1); }
}

function trackMediaBrowserDownload(url, downloadId) {
    if (typeof url != "string" || !url || !Number.isInteger(downloadId) || mediaDownloadIds.has(downloadId)) { return false; }
    mediaDownloadIds.set(downloadId, url);
    lockMediaDownload(url);
    return true;
}

chrome.downloads.onChanged.addListener(function (delta) {
    if (!delta || !mediaDownloadIds.has(delta.id)) { return; }
    const state = delta.state && delta.state.current;
    if (!state && !delta.error) { return; }
    if (state && state != "complete" && state != "interrupted") { return; }
    const url = mediaDownloadIds.get(delta.id);
    mediaDownloadIds.delete(delta.id);
    unlockMediaDownload(url);
});

chrome.alarms.create("nowClear", { when: Date.now() + 3000 });  // 3秒后清理立即清理一次
chrome.alarms.create("clear", { periodInMinutes: 60 }); // 60分钟清理一次冗余数据
chrome.alarms.onAlarm.addListener(function (alarm) {
    alarm.name == "clear" && clearRedundant();
    alarm.name == "nowClear" && clearRedundant();
});

// 保存Referer
chrome.webRequest.onSendHeaders.addListener(
    function (data) {
        if (!mediaRetrievalEnabled()) { return; }
        let referer = getReferer(data);
        if (referer) {
            const requestKey = "requestId" + data.requestId;
            if (!refererData.has(requestKey) && refererData.size >= REFERER_DATA_LIMIT) {
                refererData.delete(refererData.keys().next().value);
            }
            refererData.set(requestKey, { value: referer.slice(0, 4096), tabId: data.tabId });
        }
    }, { urls: ["<all_urls>"] }, ['requestHeaders',
        chrome.webRequest.OnBeforeSendHeadersOptions.EXTRA_HEADERS].filter(Boolean)
);
// onResponseStarted 浏览器接收到第一个字节触发，保证有更多信息判断资源类型
chrome.webRequest.onResponseStarted.addListener(
    function (data) {
        try {
            const requestKey = "requestId" + data.requestId;
            const refererEntry = refererData.get(requestKey);
            if (refererEntry) {
                data.referer = refererEntry.value;
                refererData.delete(requestKey);
            }
            findMedia(data);
        } catch (e) { console.log(e, data); }
    }, { urls: ["<all_urls>"] }, ["responseHeaders"]
);
// 删除失败的refererData
chrome.webRequest.onErrorOccurred.addListener(
    function (data) {
        refererData.delete("requestId" + data.requestId);
    }, { urls: ["<all_urls>"] }
);

function findMedia(data, retryCount = 0) {
    // 等待后台配置和缓存初始化完成。
    if (!G || !G.initSyncComplete || G.tabId == undefined || cacheData.init) {
        if (retryCount < 5) setTimeout(() => findMedia(data, retryCount + 1), 233);
        return;
    }
    if (!mediaRetrievalEnabled()) { return; }
    if (typeof data.url != "string" || data.url.length > MEDIA_URL_LIMIT) { return; }
    // 屏蔽特殊页面发起的资源
    if (data.initiator != "null" &&
        data.initiator != undefined &&
        isSpecialPage(data.initiator)) { return; }
    if (data.originUrl &&
        isSpecialPage(data.originUrl)) { return; }
    // 屏蔽特殊页面的资源
    if (isSpecialPage(data.url)) { return; }
    let urlParsing = new URL(data.url);
    // 去掉会导致同一 Google Video 资源重复出现的范围参数。
    if (urlParsing.host.includes("googlevideo.com")) {
        data.url = data.url.replace(reYoutube, "");
        urlParsing = new URL(data.url);
    }

    let [name, ext] = fileNameParse(urlParsing.pathname);

    const header = getResponseHeadersValue(data);
    // 通过视频范围计算完整视频大小
    if (header["range"]) {
        const size = header["range"].match(reRange);
        if (size) {
            const responseSize = Number(header["size"]);
            const rangeLength = Number(size[2]) - Number(size[1]) + 1;
            const totalSize = Number(size[3]);
            if (Number.isFinite(responseSize) && responseSize >= 0 && rangeLength > 0 && totalSize > 0) {
                header["size"] = Math.round(responseSize * totalSize / rangeLength);
            }
        }
    }

    //检查后缀
    let filter = false;
    if (!filter && ext != undefined) {
        filter = CheckExtension(ext, header["size"]);
        if (filter == "break") { return; }
    }

    //检查类型
    if (!filter && header["type"] != undefined) {
        filter = CheckType(header["type"], header["size"]);
        if (filter == "break") { return; }
    }

    //查找附件
    if (!filter && header["attachment"] != undefined) {
        const res = header["attachment"].match(reFilename);
        if (res && res[1]) {
            [name, ext] = fileNameParse(decodeURIComponent(res[1]));
            filter = CheckExtension(ext, 0);
            if (filter == "break") { return; }
        }
    }

    //放过类型为media的资源
    if (data.type == "media") {
        filter = true;
    }

    if (!filter) { return; }

    const findId = data.tabId == -1 ? G.tabId : data.tabId;
    if (!Number.isInteger(findId) || findId < 0) { return; }
    const items = Array.isArray(cacheData[findId]) ? cacheData[findId] : (cacheData[findId] = []);
    let pending = pendingMediaByTab.get(findId);
    if (!pending) {
        pending = new Set();
        pendingMediaByTab.set(findId, pending);
    }
    // 异步处理数量保持有界；已完成记录达到上限后改为滚动淘汰最早条目。
    if (pending.size >= TAB_MEDIA_LIMIT) { return; }
    const mediaKey = data.url;
    if (pending.has(mediaKey) || items.some(item => item && item.url === mediaKey)) { return; }
    pending.add(mediaKey);
    const requestEpoch = mediaEpoch;
    const requestGeneration = tabMediaGenerations.get(findId) || 0;
    chrome.tabs.get(data.tabId == -1 ? G.tabId : data.tabId, async function (webInfo) {
        try {
            if (chrome.runtime.lastError || !mediaRetrievalEnabled()) { return; }
            if (requestEpoch !== mediaEpoch || requestGeneration !== (tabMediaGenerations.get(findId) || 0)) { return; }
            const info = {
                name: String(name || "").slice(0, 512),
                url: data.url,
                size: header["size"],
                ext: ext,
                type: data.mime ?? header["type"],
                tabId: data.tabId,
                initiator: typeof data.initiator == "string" ? data.initiator.slice(0, 4096) : data.initiator,
                referer: typeof data.referer == "string" ? data.referer.slice(0, 4096) : data.referer,
                incognito: Boolean(data.incognito)
            };
            // 幽灵资源 查源
            if (info.tabId == -1 && info.referer) {
                if (webInfo?.url == info.referer) {
                    info.tabId = webInfo.id;
                } else {
                    const newWebInfo = await new Promise(resolve => {
                        chrome.tabs.query({ url: info.referer }, tabs => resolve(chrome.runtime.lastError ? [] : tabs));
                    });
                    if (newWebInfo.length > 0) {
                        webInfo = newWebInfo[0];
                        info.tabId = newWebInfo[0].id;
                    }
                }
            }
            if (!mediaRetrievalEnabled() || requestEpoch !== mediaEpoch || requestGeneration !== (tabMediaGenerations.get(findId) || 0)) { return; }
            if (!Number.isInteger(info.tabId) || info.tabId < 0) { return; }
            const targetItems = Array.isArray(cacheData[info.tabId]) ? cacheData[info.tabId] : (cacheData[info.tabId] = []);
            if (targetItems.some(item => item && item.url === info.url)) { return; }
            // 不存在 initiator 和 referer 使用web url代替initiator
            if (info.initiator == undefined || info.initiator == "null") {
                info.initiator = info.referer ?? webInfo?.url;
            }
            info.title = String(webInfo?.title ?? "NULL").slice(0, 512);
            if (!makeRoomForMediaItem(targetItems)) { return; }
            targetItems.push(info);
            persistMediaData();
            refreshIcon(info.tabId);
            chrome.runtime.sendMessage(info, function () {
                if (chrome.runtime.lastError) { return; }
            });
        } finally {
            releasePendingMedia(findId, mediaKey);
        }
    });
}

function makeRoomForMediaItem(items) {
    while (items.length >= TAB_MEDIA_LIMIT) {
        const removableIndex = items.findIndex(item => !item || !activeMediaDownloadCounts.has(item.url));
        if (removableIndex < 0) { return false; }
        items.splice(removableIndex, 1);
    }
    return true;
}

function releasePendingMedia(tabId, mediaKey) {
    const pending = pendingMediaByTab.get(tabId);
    if (!pending) { return; }
    pending.delete(mediaKey);
    if (!pending.size) { pendingMediaByTab.delete(tabId); }
}

function resetTabMediaState(tabId) {
    tabMediaGenerations.set(tabId, (tabMediaGenerations.get(tabId) || 0) + 1);
    pendingMediaByTab.delete(tabId);
    delete cacheData[tabId];
}

function clearAllMediaData() {
    mediaEpoch++;
    cacheData = {};
    pendingMediaByTab.clear();
    refererData.clear();
    persistMediaData();
}

// 接收弹窗发出的媒体数据读取与清理请求。
chrome.runtime.onMessage.addListener(function (Message, _sender, sendResponse) {
    if (Message.Message == "trackMediaDownload") {
        sendResponse({ ok: trackMediaBrowserDownload(Message.url, Message.downloadId) });
        return false;
    }
    if (Message.Message == "getMediaData") {
        sendResponse({ ok: true, items: cacheData[Message.tabId] || [] });
        return false;
    }
    if (Message.Message == "clearData" && Message.type) {
        if (Message.all) {
            clearAllMediaData();
        } else {
            resetTabMediaState(Message.tabId);
        }
        persistMediaData();
        SetIcon({ tabId: Message.tabId });
        clearRedundant();
        sendResponse("OK");
        return true;
    }
    return false;
});
//切换标签，更新全局变量G.tabId 更新图标
chrome.tabs.onActivated.addListener(function (activeInfo) {
    G.tabId = activeInfo.tabId;
    if (cacheData[G.tabId] !== undefined) {
        SetIcon({ number: cacheData[G.tabId].length, tabId: G.tabId });
        return;
    }
    SetIcon({ tabId: G.tabId });
});

// 标签更新 清除数据
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
    if (changeInfo.status == "loading") {
        resetTabMediaState(tabId);
        persistMediaData();
        SetIcon({ tabId: tabId });
    }
});
// 标签关闭 清除数据
chrome.tabs.onRemoved.addListener(function (tabId) {
    // 清理缓存数据
    resetTabMediaState(tabId);
    persistMediaData();
    for (const [requestId, entry] of refererData) {
        if (entry.tabId === tabId) { refererData.delete(requestId); }
    }
});

//检查扩展名以及大小限制
function CheckExtension(ext, size) {
    const Ext = G.Ext.get(ext);
    if (!Ext) { return false; }
    if (!Ext.state) { return "break"; }
    if (Ext.size != 0 && size != undefined && size <= Ext.size * 1024) { return "break"; }
    return true;
}
//检查类型以及大小限制
function CheckType(dataType, dataSize) {
    for (let key in G.Type) {
        let TypeSplit = dataType.split("/");
        let OptionSplit = G.Type[key].type.split("/");
        if (OptionSplit[0] == TypeSplit[0] && (OptionSplit[1] == TypeSplit[1] || OptionSplit[1] == "*")) {
            if (G.Type[key].size != 0 && dataSize != undefined && dataSize <= G.Type[key].size * 1024) {
                return "break";
            }
            return G.Type[key].state ? true : "break";
        }
    }
    return false;
}

// 获取文件名 后缀
function fileNameParse(pathname) {
    let fileName = decodeURI(pathname.split("/").pop());
    let ext = fileName.split(".");
    ext = ext.length == 1 ? undefined : ext.pop().toLowerCase();
    return [fileName, ext ? ext : undefined];
}
//获取Header属性的值
function getResponseHeadersValue(data) {
    let header = {};
    if (data.responseHeaders == undefined || data.responseHeaders.length == 0) { return header; }
    for (let item of data.responseHeaders) {
        switch (item.name.toLowerCase()) {
            case "content-length": header["size"] = item.value; break;
            case "content-type": header["type"] = item.value.split(";")[0].toLowerCase(); break;
            case "content-disposition": header["attachment"] = item.value; break;
            case "content-range": header["range"] = item.value; break;
        }
    }
    return header;
}
function getReferer(data) {
    if (data.requestHeaders == undefined || data.requestHeaders.length == 0) { return false; }
    for (let item of data.requestHeaders) {
        if (item.name.toLowerCase() == "referer") {
            return item.value;
        }
    }
    return false;
}
function refreshIcon(tabId) {
    if (tabId != -1) {
        cacheData[tabId] && SetIcon({ number: cacheData[tabId].length, tabId: tabId });
    } else {
        SetIcon({ tips: true, number: cacheData[-1]?.length || 0 });
        //自动清理幽灵数据
        if (cacheData[-1] && cacheData[-1].length > OTHER_PAGE_LIMIT) {
            delete cacheData[-1];
            persistMediaData();
            SetIcon({ tips: false });
        }
    }
}
//设置扩展图标
function SetIcon(obj) {
    if (obj.tips != undefined) {
        chrome.browserAction.setTitle({ title: obj.tips ? extensionMessage("browserTitleOther", obj.number || 0) : extensionMessage("browserTitleCurrent", 0) });
    } else if (obj.number == 0 || obj.number == undefined) {
        chrome.browserAction.setTitle({ title: extensionMessage("browserTitleCurrent", 0), tabId: obj.tabId }, function () { if (chrome.runtime.lastError) { return; } });
    } else {
        chrome.browserAction.setTitle({ title: extensionMessage("browserTitleCurrent", obj.number), tabId: obj.tabId }, function () { if (chrome.runtime.lastError) { return; } });
    }
}

function mediaRetrievalEnabled() {
    return G.mediaRetrievalEnabled === true;
}

// 判断特殊页面
function isSpecialPage(url) {
    if (!url || url == "null") { return true; }
    return !(url.startsWith("http://") || url.startsWith("https://") || url.startsWith("blob:"));
}

// 测试
// chrome.storage.local.get(function (data) { console.log(data.MediaData) });
// chrome.declarativeNetRequest.getSessionRules(function (rules) { console.log(rules); });
// chrome.tabs.query({}, function (tabs) { for (let item of tabs) { console.log(item.id); } });
