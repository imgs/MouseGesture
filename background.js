import './ext-console.js';
import './settings-common.js';
const BACKGROUND_SETTINGS_API = globalThis.MouseExtSettings;
const BACKGROUND_PREVIEW_DEFAULTS = BACKGROUND_SETTINGS_API.getPreviewDefaults();
import {
  persistPreviewImage,
  loadPreviewImage,
  removePreviewImage,
  appendPreviewImageChunk
} from './screenshot-preview-storage.js';
import {
  addScreenshotHistoryEntry,
  listScreenshotHistory,
  getScreenshotHistoryImage,
  removeScreenshotHistoryEntry,
  clearScreenshotHistory,
  trimScreenshotHistoryToLimit
} from './screenshot-history-storage.js';
import {
  listPageScreenshotPins,
  savePageScreenshotPin,
  removePageScreenshotPin,
  clearPageScreenshotPins,
  normalizePagePinScopeKey
} from './screenshot-pins-storage.js';

// 常量定义
const SPECIAL_PROTOCOLS = [
  'chrome-extension://',
  'moz-extension://',
  'chrome://',
  'edge://',
  'vivaldi://',
  'brave://',
  'opera://',
  'chrome-search://',
  'about:',
  'data:',
  'file://',
  'view-source:',
  'javascript:',
  'ftp://',
  'ws://',
  'wss://',
  'http://',
  'https://'
];

const NEW_TAB_URLS = [
  'chrome://newtab/',
  'edge://newtab/',
  'vivaldi://newtab/',
  'vivaldi://startpage/',
  'brave://newtab/',
  'opera://startpage/',
  'about:newtab',
  'chrome://new-tab-page/',
  'about:blank'
];

const IGNORED_PROTOCOLS = [
  'chrome://',
  'edge://',
  'vivaldi://',
  'brave://',
  'opera://',
  'chrome-search://',
  'devtools://',
  'about:',
  'chrome-extension://',
  'moz-extension://',
  'resource://'
];

function normalizeBrowserInternalUrl(url) {
  return String(url || '').trim().toLowerCase().replace(/\/+$/, '');
}

function isNewTabUrl(url) {
  const normalized = normalizeBrowserInternalUrl(url);
  return NEW_TAB_URLS.some((candidate) => normalizeBrowserInternalUrl(candidate) === normalized);
}

function isRestrictedBrowserUrl(url) {
  const normalized = String(url || '').trim().toLowerCase();
  return !!normalized && IGNORED_PROTOCOLS.some((protocol) => normalized.startsWith(protocol));
}


/** 预览弹窗外框最小宽度（与 openScreenshotPreview / fitPreviewWindowToImage 一致） */
const PREVIEW_WINDOW_MIN_OUTER_W = 925;

/** 按截图像素尺寸与屏幕工作区计算预览弹窗外框大小（尽量占满屏幕，减少滚动） */
function computeScreenshotPreviewWindowSize(imgW, imgH, workArea) {
  const wa =
    workArea && workArea.width > 0 && workArea.height > 0
      ? workArea
      : { width: 1920, height: 1080 };
  const PAGE_CHROME_H = 92;
  const PAGE_PAD = 16;
  const EST_FRAME_W = 12;
  const EST_FRAME_H = 36;
  const margin = 8;
  const maxOuterW = Math.max(320, wa.width - margin);
  const maxOuterH = Math.max(280, wa.height - margin);
  const maxImgW = maxOuterW - EST_FRAME_W - PAGE_PAD;
  const maxImgH = maxOuterH - EST_FRAME_H - PAGE_CHROME_H - PAGE_PAD;
  const scale = Math.min(maxImgW / imgW, maxImgH / imgH, 1);
  const displayW = Math.max(1, Math.floor(imgW * scale));
  const displayH = Math.max(1, Math.floor(imgH * scale));
  return {
    width: Math.max(
      Math.min(PREVIEW_WINDOW_MIN_OUTER_W, maxOuterW),
      Math.min(maxOuterW, displayW + PAGE_PAD + EST_FRAME_W)
    ),
    height: Math.max(
      Math.min(360, maxOuterH),
      Math.min(maxOuterH, displayH + PAGE_CHROME_H + PAGE_PAD + EST_FRAME_H)
    )
  };
}

function persistPreviewDataUrl(key, dataUrl, width, height, callback) {
  if (!key || !dataUrl) {
    callback(new Error('no_image'));
    return;
  }
  persistPreviewImage(key, dataUrl, width, height)
    .then(() => callback(null))
    .catch((err) => callback(err || new Error('preview_persist_failed')));
}

const PREVIEW_SOURCE_TAB_PREFIX = 'screenshotPreviewTab_';
const PREVIEW_SOURCE_PAGE_PREFIX = 'screenshotPreviewPage_';

function isPinTargetTabUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return !isRestrictedBrowserUrl(url);
}

/** 图钉 scope 必须来自 sender 标签页 URL，禁止跨站读写 */
function resolvePinScopeFromSender(message, sender) {
  const tabUrl = sender && sender.tab && sender.tab.url;
  if (!tabUrl || !isPinTargetTabUrl(tabUrl)) {
    return { error: 'no_tab_url' };
  }
  const scope = normalizePagePinScopeKey(tabUrl);
  const requested = message && (message.pageScopeKey || message.pageUrl);
  if (requested) {
    const normalizedRequested = normalizePagePinScopeKey(requested);
    if (normalizedRequested && normalizedRequested !== scope) {
      return { error: 'unauthorized_scope' };
    }
  }
  return { scope };
}

async function getOpenTab(tabId) {
  if (tabId == null) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab && tab.id === tabId ? tab : null;
  } catch (e) {
    return null;
  }
}

async function isTabOpen(tabId) {
  return !!(await getOpenTab(tabId));
}

async function findScreenshotHistoryTab() {
  const pageUrl = chrome.runtime.getURL('screenshot-history.html');
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: pageUrl });
  } catch (e) {
    tabs = null;
  }
  if (tabs && tabs.length > 0) {
    return tabs[0];
  }
  try {
    const wins = await chrome.windows.getAll({ populate: true });
    for (const win of wins) {
      for (const tab of win.tabs || []) {
        const u = tab.url;
        if (!u || typeof u !== 'string') continue;
        if (u === pageUrl || u.startsWith(pageUrl + '?') || u.startsWith(pageUrl + '#')) {
          return tab;
        }
      }
    }
  } catch (e) {}
  return null;
}

/** 若历史记录页已打开则聚焦该窗口并激活对应标签；成功返回 windowId，否则 null */
async function focusExistingScreenshotHistoryWindow() {
  const tab = await findScreenshotHistoryTab();
  if (!tab || tab.windowId == null) return null;
  await chrome.windows.update(tab.windowId, { focused: true });
  if (tab.id != null) {
    await chrome.tabs.update(tab.id, { active: true });
  }
  return tab.windowId;
}

async function resolveTabIdForPageUrl(pageUrl) {
  const url = pageUrl && String(pageUrl).trim();
  if (!url) return null;
  let tabs;
  try {
    tabs = await chrome.tabs.query({});
  } catch (e) {
    return null;
  }
  const candidates = tabs.filter((t) => t.id != null && isPinTargetTabUrl(t.url));
  const exact = candidates.find((t) => t.url === url);
  if (exact) return exact.id;
  try {
    const target = new URL(url);
    const scope = target.origin + target.pathname;
    const scoped = candidates.filter((t) => {
      try {
        const u = new URL(t.url);
        return u.origin + u.pathname === scope;
      } catch (e) {
        return false;
      }
    });
    if (!scoped.length) return null;
    const full = scoped.find((t) => t.url === url);
    return (full || scoped[0]).id;
  } catch (e) {
    return null;
  }
}

async function resolveFallbackBrowserTabId() {
  try {
    const tabs = await chrome.tabs.query({});
    const normal = tabs.filter((t) => t.id != null && isPinTargetTabUrl(t.url));
    if (!normal.length) return null;
    normal.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return normal[0].id;
  } catch (e) {
    return null;
  }
}

/** 当前可贴图的活动标签（预览弹窗聚焦时取各窗口 active 里最近访问的普通网页） */
async function resolveActiveBrowserTabId() {
  try {
    const normalWins = await chrome.windows.getAll({ windowTypes: ['normal'] });
    let bestId = null;
    let bestAccess = 0;
    for (const win of normalWins) {
      const tabs = await chrome.tabs.query({ active: true, windowId: win.id });
      const t = tabs[0];
      if (!t || t.id == null || !isPinTargetTabUrl(t.url)) continue;
      const access = t.lastAccessed || 0;
      if (win.focused && access >= bestAccess) {
        bestAccess = access;
        bestId = t.id;
      } else if (bestId == null || access > bestAccess) {
        bestAccess = access;
        bestId = t.id;
      }
    }
    if (bestId != null) return bestId;

    const actives = await chrome.tabs.query({ active: true });
    const pinable = actives.filter((t) => t.id != null && isPinTargetTabUrl(t.url));
    if (!pinable.length) return null;
    pinable.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return pinable[0].id;
  } catch (e) {
    return null;
  }
}

async function resolveSourceTabIdForHistoryItem(item) {
  const active = await resolveActiveBrowserTabId();
  if (active != null) return active;
  if (item && item.sourceTabId != null && (await isTabOpen(item.sourceTabId))) {
    return item.sourceTabId;
  }
  const fromUrl = await resolveTabIdForPageUrl(item && item.pageUrl);
  if (fromUrl != null) return fromUrl;
  return resolveFallbackBrowserTabId();
}
const pagePinSaveChains = new Map();

/** 仅大图写入串行；同一 pin 一条链，不同 pin 互不阻塞 */
function enqueuePagePinSave(chainKey, task) {
  const key = chainKey || '_default';
  const prev = pagePinSaveChains.get(key) || Promise.resolve();
  const next = prev.then(() => task());
  pagePinSaveChains.set(key, next);
  next.finally(() => {
    if (pagePinSaveChains.get(key) === next) {
      pagePinSaveChains.delete(key);
    }
  }).catch(() => {});
  return next;
}

function scheduleScreenshotHistoryRecord(dataUrl, opts) {
  if (!dataUrl || typeof dataUrl !== 'string') return;
  const meta = opts || {};
  if (meta.skipHistory) return;
  addScreenshotHistoryEntry({
    dataUrl,
    width: meta.width,
    height: meta.height,
    captureMode: meta.captureMode || meta.mode,
    pageUrl: meta.pageUrl,
    pageTitle: meta.pageTitle,
    sourceTabId: meta.sourceTabId
  }).catch((err) => {
    console.warn('screenshot history save failed:', (err && err.message) || err);
  });
}

function rememberPreviewSourceTab(previewKey, tabId) {
  if (!previewKey || tabId == null) return;
  const rec = {};
  rec[PREVIEW_SOURCE_TAB_PREFIX + String(previewKey)] = tabId;
  chrome.storage.session.set(rec);
}

function rememberPreviewPageUrl(previewKey, pageUrl) {
  if (!previewKey || !pageUrl) return;
  const rec = {};
  rec[PREVIEW_SOURCE_PAGE_PREFIX + String(previewKey)] = String(pageUrl);
  chrome.storage.session.set(rec);
}

async function resolvePinTargetTabId(message, sender) {
  if (isContentScriptSender(sender)) {
    return sender.tab.id;
  }
  /** 从历史/预览等扩展页发起贴图：优先落到当前浏览器里可贴图的活动标签页，而不是条目里的 sourceTabId */
  if (isExtensionPageSender(sender)) {
    const activeFirst = await resolveActiveBrowserTabId();
    if (activeFirst != null) return activeFirst;
  }
  if (message.tabId != null && (await isTabOpen(message.tabId))) {
    return message.tabId;
  }
  const previewKey = message.previewKey && String(message.previewKey);
  if (previewKey) {
    const keys = [
      PREVIEW_SOURCE_TAB_PREFIX + previewKey,
      PREVIEW_SOURCE_PAGE_PREFIX + previewKey
    ];
    const items = await chrome.storage.session.get(keys);
    const storedTab = items[keys[0]];
    if (storedTab != null && (await isTabOpen(storedTab))) return storedTab;
    const storedPage = items[keys[1]];
    const fromStoredPage = await resolveTabIdForPageUrl(storedPage);
    if (fromStoredPage != null) return fromStoredPage;
  }
  const fromMsgPage = await resolveTabIdForPageUrl(message.pageUrl);
  if (fromMsgPage != null) return fromMsgPage;
  const active = await resolveActiveBrowserTabId();
  if (active != null) return active;
  return resolveFallbackBrowserTabId();
}

const PIN_MESSAGE_OPTS = { frameId: 0 };

function getPinMessageToken() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  if (!g.__MOUSE_PIN_MSG_TOKEN__) {
    g.__MOUSE_PIN_MSG_TOKEN__ = 'mp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  }
  return g.__MOUSE_PIN_MSG_TOKEN__;
}

function pinMessagePayload(payload) {
  return Object.assign({ _pinToken: getPinMessageToken() }, payload);
}

async function injectPinMessageToken(tabId) {
  const token = getPinMessageToken();
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: (t) => { globalThis.__MOUSE_PIN_MSG_TOKEN__ = t; },
      args: [token]
    });
  } catch (e) { /* ignore */ }
}

async function ensureUiShadowHostInTopFrame(tabId) {
  try {
    const probe = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () => typeof globalThis.MouseExtUiHost !== 'undefined'
    });
    if (probe && probe[0] && probe[0].result) return;
  } catch (e) { /* inject below */ }
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ['ui-shadow-host.js']
  });
}

async function ensureScreenshotPinsScript(tabId) {
  await injectPinMessageToken(tabId);
  try {
    const probe = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: () =>
        !!(
          globalThis.MouseScreenshotPins &&
          typeof globalThis.MouseScreenshotPins.addScreenshotPin === 'function'
        )
    });
    if (probe && probe[0] && probe[0].result) return;
  } catch (e) { /* inject below */ }
  try {
    const ping = await chrome.tabs.sendMessage(
      tabId,
      pinMessagePayload({ action: 'pingScreenshotPins' }),
      PIN_MESSAGE_OPTS
    );
    if (ping && ping.ready) return;
  } catch (e) { /* inject below */ }
  await ensureUiShadowHostInTopFrame(tabId);
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ['screenshot-pins.js']
  });
  await injectPinMessageToken(tabId);
  await new Promise((r) => setTimeout(r, 120));
}

async function deliverScreenshotPinViaScript(tabId, payload) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    func: async (pinPayload) => {
      const api = globalThis.MouseScreenshotPins;
      if (!api || typeof api.addScreenshotPin !== 'function') {
        throw new Error('pins_api_missing');
      }
      return await api.addScreenshotPin(pinPayload);
    },
    args: [payload]
  });
  const row = results && results[0];
  if (!row) throw new Error('pin_script_no_result');
  if (row.error) throw row.error;
  const res = row.result;
  if (res && res.success === false) {
    throw new Error(res.error || 'pin_failed');
  }
  return res && res.success === true ? res : { success: true, pinId: res && res.pinId };
}

async function deliverScreenshotPinToTab(tabId, payload) {
  await ensureScreenshotPinsScript(tabId);
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await deliverScreenshotPinViaScript(tabId, payload);
    } catch (scriptErr) {
      lastErr = scriptErr;
      try {
        const res = await chrome.tabs.sendMessage(
          tabId,
          pinMessagePayload(Object.assign({ action: 'addScreenshotPin' }, payload)),
          PIN_MESSAGE_OPTS
        );
        if (res && res.success === false) {
          throw new Error(res.error || 'pin_failed');
        }
        return res && res.success === true ? res : { success: true, pinId: res && res.pinId };
      } catch (msgErr) {
        lastErr = msgErr;
        if (attempt < 5) {
          await new Promise((r) => setTimeout(r, 80 * (attempt + 1)));
        }
      }
    }
  }
  throw lastErr || new Error('pin_failed');
}

function openScreenshotPreviewWindowWithData(dataUrl, opts, sendResponse) {
  const imgW = Math.max(1, opts.width | 0);
  const imgH = Math.max(1, opts.height | 0);
  const key =
    (opts.key && String(opts.key)) || 'screenshotPreview_' + Date.now();
  const skipPersist = !!opts.skipPersist;
  if (opts.sourceTabId != null) {
    rememberPreviewSourceTab(key, opts.sourceTabId);
  }
  if (opts.pageUrl) {
    rememberPreviewPageUrl(key, opts.pageUrl);
  }
  if (!dataUrl || typeof dataUrl !== 'string') {
    sendResponse({ success: false, error: 'no_image' });
    return;
  }
  const launch = (workArea) => {
    const bounds = computeScreenshotPreviewWindowSize(imgW, imgH, workArea);
    const openWin = () => {
      let url =
        chrome.runtime.getURL('screenshot-preview.html') +
        '?key=' +
        encodeURIComponent(key);
      if (opts.sourceTabId != null) {
        url += '&sourceTabId=' + encodeURIComponent(String(opts.sourceTabId));
      }
      chrome.windows.create(
        {
          url,
          type: 'popup',
          width: bounds.width,
          height: bounds.height,
          focused: true
        },
        (win) => {
          if (chrome.runtime.lastError || !win) {
            removePreviewImage(key).catch(() => {});
            chrome.storage.session.remove(key);
            sendResponse({
              success: false,
              error:
                (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
                'create_failed'
            });
          } else {
            sendResponse({ success: true, windowId: win.id });
          }
        }
      );
    };
    if (skipPersist) {
      scheduleScreenshotHistoryRecord(dataUrl, {
        width: imgW,
        height: imgH,
        captureMode: opts.captureMode,
        pageUrl: opts.pageUrl,
        pageTitle: opts.pageTitle,
        skipHistory: opts.skipHistory
      });
      openWin();
      return;
    }
    persistPreviewDataUrl(key, dataUrl, imgW, imgH, (err) => {
      if (err) {
        sendResponse({
          success: false,
          error: (err && err.message) || String(err)
        });
        return;
      }
      scheduleScreenshotHistoryRecord(dataUrl, {
        width: imgW,
        height: imgH,
        captureMode: opts.captureMode,
        pageUrl: opts.pageUrl,
        pageTitle: opts.pageTitle,
        skipHistory: opts.skipHistory
      });
      openWin();
    });
  };
  if (chrome.system && chrome.system.display && chrome.system.display.getInfo) {
    chrome.system.display.getInfo((displays) => {
      const primary = displays && displays.find((d) => d.isPrimary);
      const display = primary || (displays && displays[0]);
      launch(display && display.workArea);
    });
  } else {
    try {
      chrome.windows.getLastFocused({ windowTypes: ['normal'] }, (win) => {
        if (chrome.runtime.lastError || !win) {
          launch(null);
          return;
        }
        launch({
          left: Number(win.left) || 0,
          top: Number(win.top) || 0,
          width: Math.max(320, Number(win.width) || 0),
          height: Math.max(280, Number(win.height) || 0)
        });
      });
    } catch (e) {
      launch(null);
    }
  }
}

// 全局变量定义
let lastCheckedTab = {
  id: null,
  url: null,
  time: 0,
  cooldown: 5000,
  processedUrls: new Map()
};

// 分屏视图会话跟踪：记录新窗口与原窗口及原始尺寸的对应关系
const splitViewSessions = {};
// 分屏滚动同步：tabId -> 配对 tabId
const splitScrollTabPairs = {};

function getSplitScrollPairTabId(tabId) {
  if (tabId == null) return null;
  const paired = splitScrollTabPairs[tabId];
  if (paired == null) return null;
  if (splitScrollTabPairs[paired] !== tabId) return null;
  return paired;
}

function handleSplitViewWindowClose(windowId) {
  try {
    const session = splitViewSessions[windowId];
    if (session) {
      delete splitViewSessions[windowId];
      if (session.originalTabId) delete splitScrollTabPairs[session.originalTabId];
      if (session.newTabId) delete splitScrollTabPairs[session.newTabId];

      const { originalWindowId, originalBounds } = session;
      if (originalWindowId && originalBounds) {
        chrome.windows.get(originalWindowId, (win) => {
          if (chrome.runtime.lastError || !win) return;

          const updateInfo = { focused: true };
          if (originalBounds.state === 'maximized') {
            updateInfo.state = 'maximized';
          } else {
            updateInfo.state = 'normal';
            updateInfo.left = originalBounds.left;
            updateInfo.top = originalBounds.top;
            updateInfo.width = originalBounds.width;
            updateInfo.height = originalBounds.height;
          }

          chrome.windows.update(originalWindowId, updateInfo);
        });
      }
    }

    const sessionWindowIds = Object.keys(splitViewSessions);
    for (const splitId of sessionWindowIds) {
      const s = splitViewSessions[splitId];
      if (!s || s.originalWindowId !== windowId) continue;

      const targetWindowId = parseInt(splitId, 10);
      const originalBounds = s.originalBounds;

      delete splitViewSessions[splitId];
      if (s.originalTabId) delete splitScrollTabPairs[s.originalTabId];
      if (s.newTabId) delete splitScrollTabPairs[s.newTabId];

      if (!originalBounds) continue;

      chrome.windows.get(targetWindowId, (win) => {
        if (chrome.runtime.lastError || !win) return;

        const updateInfo = { focused: true };
        if (originalBounds.state === 'maximized') {
          updateInfo.state = 'maximized';
        } else {
          updateInfo.state = 'normal';
          updateInfo.left = originalBounds.left;
          updateInfo.top = originalBounds.top;
          updateInfo.width = originalBounds.width;
          updateInfo.height = originalBounds.height;
        }

        chrome.windows.update(targetWindowId, updateInfo);
      });
    }
  } catch (e) {
    console.error('处理分屏窗口关闭恢复时出错:', e.message);
  }
}

const DETACHED_WINDOW_RESTORE_KEY = 'detachedWindowRestore';

function applyDetachedBrowserSnapshot(browserWindowId, snapshot) {
  if (browserWindowId == null || !snapshot) return;
  const st = snapshot.state;
  if (st === 'maximized' || st === 'fullscreen' || st === 'minimized') {
    chrome.windows.update(browserWindowId, { state: st });
    return;
  }
  const u = { state: 'normal' };
  if (typeof snapshot.left === 'number') u.left = snapshot.left;
  if (typeof snapshot.top === 'number') u.top = snapshot.top;
  if (typeof snapshot.width === 'number') u.width = snapshot.width;
  if (typeof snapshot.height === 'number') u.height = snapshot.height;
  chrome.windows.update(browserWindowId, u);
}

function handleDetachedSettingsWindowRestore(windowId) {
  if (!chrome.storage) return;
  const sess = chrome.storage.session;
  sess.get(DETACHED_WINDOW_RESTORE_KEY, (data) => {
    if (chrome.runtime.lastError) return;
    const rec = data[DETACHED_WINDOW_RESTORE_KEY];
    if (!rec || Number(rec.detachedWindowId) !== Number(windowId)) return;
    if (!rec.detachedInstanceId) {
      sess.remove(DETACHED_WINDOW_RESTORE_KEY);
      return;
    }
    const browserWindowId = rec.browserWindowId;
    const snapshot = rec.snapshot;
    sess.remove(DETACHED_WINDOW_RESTORE_KEY, () => {
      if (browserWindowId == null || !snapshot) return;
      chrome.windows.get(browserWindowId, (win) => {
        if (chrome.runtime.lastError || !win || win.type !== 'normal') return;
        applyDetachedBrowserSnapshot(browserWindowId, snapshot);
      });
    });
  });
}

// Firefox exposes sidebarAction.close() for the active browser window only.
// Close a sidebar in an old window by briefly activating that window, then
// restore the window the user selected. No browser window is ever removed.
function setupFirefoxSidebarFocusCleanup() {
  const ext = typeof browser !== 'undefined' ? browser : null;
  if (!ext || !ext.sidebarAction || !ext.windows) return;
  if (typeof ext.windows.onFocusChanged?.addListener !== 'function') return;
  if (typeof ext.sidebarAction.close !== 'function' ||
      typeof ext.sidebarAction.isOpen !== 'function') return;

  const windowIdNone = typeof ext.windows.WINDOW_ID_NONE === 'number'
    ? ext.windows.WINDOW_ID_NONE
    : -1;
  let lastFocusedWindowId = null;
  let focusStateReady = false;
  let cleanupInFlight = false;

  async function closeSidebarInWindow(oldWindowId, newWindowId) {
    if (cleanupInFlight || oldWindowId == null || newWindowId == null ||
        oldWindowId === newWindowId) return;
    cleanupInFlight = true;
    let oldWindowWasFocused = false;
    try {
      const open = await ext.sidebarAction.isOpen({ windowId: oldWindowId });
      if (!open) return;

      const current = typeof ext.windows.getCurrent === 'function'
        ? await ext.windows.getCurrent()
        : null;
      if (current && current.id === oldWindowId) {
        await ext.sidebarAction.close();
        return;
      }

      await ext.windows.update(oldWindowId, { focused: true });
      oldWindowWasFocused = true;
      const focusedWindow = typeof ext.windows.getCurrent === 'function'
        ? await ext.windows.getCurrent()
        : null;
      if (!focusedWindow || focusedWindow.id !== oldWindowId) return;
      await ext.sidebarAction.close();
    } catch (e) {
      // A window can disappear while focus is changing. This is harmless.
    } finally {
      if (oldWindowWasFocused) {
        try {
          await ext.windows.update(newWindowId, { focused: true });
        } catch (e) { /* ignore */ }
      }
      cleanupInFlight = false;
      lastFocusedWindowId = newWindowId;
    }
  }

  ext.windows.onFocusChanged.addListener((windowId) => {
    if (cleanupInFlight || windowId === windowIdNone || windowId == null) return;
    if (!focusStateReady) {
      focusStateReady = true;
      lastFocusedWindowId = windowId;
      return;
    }
    const previousWindowId = lastFocusedWindowId;
    lastFocusedWindowId = windowId;
    if (previousWindowId == null || previousWindowId === windowId) return;
    void closeSidebarInWindow(previousWindowId, windowId);
  });

  try {
    const getLastFocused = typeof ext.windows.getLastFocused === 'function'
      ? ext.windows.getLastFocused()
      : (typeof ext.windows.getCurrent === 'function' ? ext.windows.getCurrent() : null);
    if (getLastFocused && typeof getLastFocused.then === 'function') {
      getLastFocused.then((win) => {
        if (!focusStateReady && win && win.id != null) {
          focusStateReady = true;
          lastFocusedWindowId = win.id;
        }
      }).catch(() => {});
    }
  } catch (e) { /* ignore */ }
}

setupFirefoxSidebarFocusCleanup();

const UNLOCK_RESTRICTIONS_CSS =
  'html,body,*{' +
  '-webkit-user-select:text!important;' +
  '-moz-user-select:text!important;' +
  'user-select:text!important;' +
  '-webkit-touch-callout:default!important;' +
  '}';

function handleUnlockCssInsertRequest(message, sender, sendResponse) {
  if (!message || message.type !== '__mouseGestureInsertUnlockCss') {
    return false;
  }
  if (!isContentScriptSender(sender)) {
    sendResponse({ ok: false, error: 'unauthorized' });
    return true;
  }
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) {
    sendResponse({ ok: false, error: 'no_tab' });
    return true;
  }
  const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;

  const insertWithDetails = (details, allowRetry) => {
    try {
      chrome.scripting.insertCSS(details, () => {
        if (!chrome.runtime.lastError) {
          sendResponse({ ok: true });
          return;
        }
        if (allowRetry) {
          const retryDetails = Object.assign({}, details);
          delete retryDetails.origin;
          insertWithDetails(retryDetails, false);
          return;
        }
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      });
    } catch (e) {
      if (allowRetry) {
        const retryDetails = Object.assign({}, details);
        delete retryDetails.origin;
        insertWithDetails(retryDetails, false);
        return;
      }
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  };

  insertWithDetails({
    target: { tabId, frameIds: [frameId] },
    css: UNLOCK_RESTRICTIONS_CSS,
    origin: 'USER'
  }, true);
  return true;
}

function handleUnlockMainInjectRequest(message, sender, sendResponse) {
  if (!message || message.type !== '__mouseGestureInjectUnlockMain') {
    return false;
  }
  if (!isContentScriptSender(sender)) {
    sendResponse({ ok: false, error: 'unauthorized' });
    return true;
  }
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) {
    sendResponse({ ok: false, error: 'no_tab' });
    return true;
  }
  const pageUrl = sender.tab && sender.tab.url ? String(sender.tab.url) : '';
  const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;
  chrome.storage.sync.get({ unlockPageRestrictions: false }, (syncItems) => {
    if (chrome.runtime.lastError) {
      sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      return;
    }
    if (!syncItems || !syncItems.unlockPageRestrictions) {
      sendResponse({ ok: false, error: 'feature_disabled' });
      return;
    }
    chrome.storage.local.get({ disabledSites: [] }, (localItems) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      const disabledSites = Array.isArray(localItems.disabledSites) ? localItems.disabledSites : [];
      if (isHrefInDisabledListForUnlock(pageUrl, disabledSites)) {
        sendResponse({ ok: false, error: 'site_disabled' });
        return;
      }
      try {
        chrome.scripting.executeScript(
          {
            target: { tabId, frameIds: [frameId] },
            world: 'MAIN',
            files: ['unlock-restrictions-main.js']
          },
          () => {
            if (chrome.runtime.lastError) {
              sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ ok: true });
            }
          }
        );
      } catch (e) {
        sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
      }
    });
  });
  return true;
}

function handleUnlockSetActiveRequest(message, sender, sendResponse) {
  if (!message || message.type !== '__mouseGestureSetUnlockActive') {
    return false;
  }
  if (!isContentScriptSender(sender)) {
    sendResponse({ ok: false, error: 'unauthorized' });
    return true;
  }
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) {
    sendResponse({ ok: false, error: 'no_tab' });
    return true;
  }
  const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;
  const active = message.active !== false;
  try {
    chrome.scripting.executeScript(
      {
        target: { tabId, frameIds: [frameId] },
        world: 'MAIN',
        func: (isActive) => {
          window.__mouseGestureUnlockActive = isActive;
        },
        args: [active]
      },
      () => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true });
        }
      }
    );
  } catch (e) {
    sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
  }
  return true;
}

/** 与 unlock-restrictions-bridge.js / content.js isSiteInDisabledList 规则一致 */
function isHrefInDisabledListForUnlock(href, list) {
  if (!list || !Array.isArray(list) || list.length === 0) return false;
  let h;
  try {
    const u = new URL(href);
    h = u.hostname.toLowerCase().replace(/^www\./, '');
  } catch (e) {
    h = String(href || '').toLowerCase().replace(/^www\./, '');
  }
  for (let i = 0; i < list.length; i++) {
    const v = String(list[i]).trim().toLowerCase();
    if (!v) continue;
    let entryHost = v;
    if (v.startsWith('http://') || v.startsWith('https://')) {
      try {
        entryHost = new URL(v).hostname.toLowerCase().replace(/^www\./, '');
      } catch (_) {
        entryHost = v;
      }
    } else {
      entryHost = v.replace(/^www\./, '');
    }
    if (h === entryHost || h.endsWith('.' + entryHost)) return true;
  }
  return false;
}

let backgroundDisabledSites = [];
try {
  chrome.storage.local.get({ disabledSites: [] }, (localItems) => {
    backgroundDisabledSites = Array.isArray(localItems && localItems.disabledSites)
      ? localItems.disabledSites
      : [];
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.disabledSites) {
      backgroundDisabledSites = Array.isArray(changes.disabledSites.newValue)
        ? changes.disabledSites.newValue
        : [];
    }
  });
} catch (e) { /* ignore */ }

function isContentScriptTabDisabled(sender) {
  if (!sender || !sender.tab || !sender.tab.url) return false;
  return isHrefInDisabledListForUnlock(sender.tab.url, backgroundDisabledSites);
}

// URL标准化缓存
const urlNormalizeCache = new Map();
const MAX_CACHE_SIZE = 2000; // 增加到2000条
const CACHE_CLEANUP_THRESHOLD = 0.9; // 缓存使用率达到90%时清理

// 全局URL标准化函数（带缓存）
function normalizeUrl(inputUrl) {
  if (!inputUrl) return '';
  
  // 检查缓存
  if (urlNormalizeCache.has(inputUrl)) {
    const cacheEntry = urlNormalizeCache.get(inputUrl);
    if (typeof cacheEntry === 'string') {
      return cacheEntry;
    }
    cacheEntry.accessCount++;
    return cacheEntry.result;
  }
  
  let result;
  try {
    let urlObj;
    try {
      urlObj = new URL(inputUrl);
    } catch (e) {
      try {
        urlObj = new URL('https://' + inputUrl);
      } catch (e2) {
        result = inputUrl.toLowerCase();
        if (urlNormalizeCache.size < MAX_CACHE_SIZE) {
          urlNormalizeCache.set(inputUrl, {
            result: result,
            timestamp: Date.now(),
            accessCount: 1
          });
        }
        return result;
      }
    }
    
    let hostname = urlObj.hostname.toLowerCase();
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    
    let pathname = urlObj.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    
    // 忽略常见追踪参数
    const ignoredParams = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'msclkid', 'ref', 'source', 'ref_src', '_ga'
    ]);
    
    let cleanParams = new URLSearchParams();
    for (let [key, value] of urlObj.searchParams.entries()) {
      if (!ignoredParams.has(key.toLowerCase())) {
        cleanParams.append(key.toLowerCase(), value);
      }
    }
    
    const sortedParams = Array.from(cleanParams.entries())
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
    
    const cleanQuery = sortedParams.length > 0 
      ? '?' + sortedParams.map(([k, v]) => `${k}=${v}`).join('&') 
      : '';
    
    // 处理锚点(#)，只有当它是URL的末尾且没有实际内容时才忽略
    let hash = '';
    if (urlObj.hash && urlObj.hash !== '#') {
      hash = urlObj.hash;
    }
    
    result = `${urlObj.protocol}//${hostname}${pathname}${cleanQuery}${hash}`;
  } catch (e) {
    console.warn('URL标准化失败:', e.message);
    result = inputUrl.toLowerCase();
  }
  
  // 智能缓存管理
  if (urlNormalizeCache.size >= MAX_CACHE_SIZE) {
    // 缓存已满，清理最旧的条目
    clearOldestCacheEntries();
  }
  
  // 缓存结果
  urlNormalizeCache.set(inputUrl, {
    result: result,
    timestamp: Date.now(),
    accessCount: 1
  });
  
  return result;
}

// 清理URL标准化缓存
function clearUrlNormalizeCache() {
  urlNormalizeCache.clear();
}

// 智能清理最旧的缓存条目
function clearOldestCacheEntries() {
  const entries = Array.from(urlNormalizeCache.entries()).filter(
    ([, entry]) => entry && typeof entry !== 'string'
  );
  
  // 按访问频率和时间排序，优先保留高频访问的条目
  entries.sort((a, b) => {
    const [urlA, entryA] = a;
    const [urlB, entryB] = b;
    
    // 计算访问频率分数（访问次数 / 时间差）
    const timeA = Date.now() - entryA.timestamp;
    const timeB = Date.now() - entryB.timestamp;
    const scoreA = entryA.accessCount / Math.max(timeA, 1);
    const scoreB = entryB.accessCount / Math.max(timeB, 1);
    
    return scoreA - scoreB; // 分数低的先删除
  });
  
  // 删除最旧的25%条目
  const deleteCount = Math.floor(entries.length * 0.25);
  for (let i = 0; i < deleteCount; i++) {
    urlNormalizeCache.delete(entries[i][0]);
  }
  
  console.log(`清理了 ${deleteCount} 个最旧的缓存条目`);
}

// 检查缓存使用率并智能清理
function checkAndCleanCache() {
  const usageRatio = urlNormalizeCache.size / MAX_CACHE_SIZE;
  
  if (usageRatio >= CACHE_CLEANUP_THRESHOLD) {
    console.log(`缓存使用率 ${(usageRatio * 100).toFixed(1)}% 超过阈值，开始清理`);
    clearOldestCacheEntries();
  }
}

// 获取缓存统计信息
function getCacheStats() {
  const entries = Array.from(urlNormalizeCache.values()).filter(
    (entry) => entry && typeof entry !== 'string'
  );
  const totalAccessCount = entries.reduce((sum, entry) => sum + entry.accessCount, 0);
  const avgAccessCount = entries.length > 0 ? totalAccessCount / entries.length : 0;
  
  return {
    size: urlNormalizeCache.size,
    maxSize: MAX_CACHE_SIZE,
    usageRatio: urlNormalizeCache.size / MAX_CACHE_SIZE,
    totalAccessCount: totalAccessCount,
    avgAccessCount: avgAccessCount,
    lastCleanupTime: lastCleanupTime
  };
}

// 定期输出缓存统计（仅在开发模式下）
function logCacheStats() {
  const stats = getCacheStats();
  console.log('缓存统计:', {
    使用率: `${(stats.usageRatio * 100).toFixed(1)}%`,
    条目数: `${stats.size}/${stats.maxSize}`,
    总访问次数: stats.totalAccessCount,
    平均访问次数: stats.avgAccessCount.toFixed(2)
  });
}

// 检查标签页是否为有效标签页（非特殊页面）
function isValidTab(tab) {
  if (!tab || !tab.url) return false;
  return !isRestrictedBrowserUrl(tab.url) && !isNewTabUrl(tab.url);
}

// 批量标准化URL列表
function batchNormalizeUrls(tabs) {
  const normalizedUrls = new Map();
  
  for (const tab of tabs) {
    if (!isValidTab(tab)) continue;
    
    try {
      const normalizedUrl = normalizeUrl(tab.url);
      normalizedUrls.set(tab.id, normalizedUrl);
    } catch (e) {
      console.log(`无法处理标签页 ${tab.id} 的URL:`, e.message);
      continue;
    }
  }
  
  return normalizedUrls;
}

// Service Worker 生命周期事件
self.addEventListener('install', (event) => {
  console.log('Service Worker 安装完成');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker 激活完成');
  event.waitUntil(clients.claim());
});

// 错误处理
self.addEventListener('error', (event) => {
  console.error('Service Worker 错误:', event.message);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker 未处理的 Promise 拒绝:', event.reason);
});

// 标签页检查跟踪已移至 duplicateCheckTracker 中，基于URL的独立冷却时间

// 优化的防抖函数 - 区分不同类型的操作
function debounce(func, wait, immediate = false) {
  let timeout;
  return function(...args) {
    const context = this;
    const later = function() {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
}


// 获取当前窗口内最近访问标签页右侧的索引位置
async function getRecentTabRightIndex(windowId) {
  try {
    const query = windowId != null ? { windowId } : {};
    const tabs = await chrome.tabs.query(query);
    
    if (tabs.length === 0) return null;
    
    const sortedTabs = tabs
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    
    if (sortedTabs.length === 0) return null;
    
    const recentTab = sortedTabs[0];
    return recentTab.index + 1;
  } catch (e) {
    console.error('获取最近标签页右侧索引错误:', e.message);
    return null;
  }
}

// 统一的标签页创建函数
async function createTabWithRecentIndex(url, active = true, preferredWindowId = null) {
  try {
    const createOptions = { active };
    if (url) {
      createOptions.url = url;
    }
    
    let windowId = preferredWindowId;
    if (windowId == null) {
      try {
        const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (activeTabs.length > 0 && activeTabs[0].windowId != null) {
          windowId = activeTabs[0].windowId;
        }
      } catch (e) { /* ignore */ }
    }
    
    const recentRightIndex = await getRecentTabRightIndex(windowId);
    if (recentRightIndex !== null) {
      createOptions.index = recentRightIndex;
    }
    if (windowId != null) {
      createOptions.windowId = windowId;
    }
    
    return new Promise((resolve, reject) => {
      chrome.tabs.create(createOptions, (tab) => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError;
          console.error('创建标签页错误:', error.message);
          reject(error);
        } else {
          console.log('成功创建标签页:', tab.id);
          resolve(tab);
        }
      });
    });
  } catch (e) {
    console.error('创建标签页错误:', e.message);
    throw e;
  }
}

// 创建一个检查跟踪器，用于智能决定是否需要执行检查
const duplicateCheckTracker = {
  // 记录每个URL的上次检查时间（基于URL的独立冷却时间）
  urlChecks: new Map(),
  
  // 检查冷却时间（毫秒）
  cooldownTime: 5000,
  
  // 最大缓存大小，避免内存泄漏
  maxCacheSize: 200,
  
  // URL检查频率调整
  urlFrequency: new Map(),
  
  // 判断是否需要检查特定URL
  shouldCheck: function(tabId, url) {
    if (!url) return false;
    
    try {
      // 记录当前时间
      const now = Date.now();
      
      // 获取此URL的上次检查记录
      const lastCheck = this.urlChecks.get(url);
      
      // 获取此URL的检查频率（默认为标准冷却时间）
      let urlCooldown = this.cooldownTime;
      if (this.urlFrequency.has(url)) {
        // 如果此URL很少有重复，增加冷却时间
        const urlStats = this.urlFrequency.get(url);
        if (urlStats.duplicateRatio < 0.1) { // 重复率低于10%
          urlCooldown = this.cooldownTime * 2; // 加倍冷却时间
        } else if (urlStats.duplicateRatio > 0.5) { // 重复率高于50%
          urlCooldown = this.cooldownTime / 2; // 减半冷却时间
        }
      }
      
      // 如果有上次检查记录，且未超过冷却时间，跳过检查
      if (lastCheck && (now - lastCheck.time) < urlCooldown) {
        console.log(`URL ${url} 在冷却期内，跳过检查`);
        return false;
      }
      
      // 更新检查记录
      this.urlChecks.set(url, {
        time: now,
        tabId: tabId
      });
      
      // 清理过期缓存，避免内存持续增长
      if (this.urlChecks.size > this.maxCacheSize) {
        this.cleanup();
      }
      
      return true;
    } catch (e) {
      console.warn('检查跟踪器错误:', e.message);
      return true; // 出错时默认执行检查
    }
  },
  
  // 更新URL统计数据
  updateUrlStats: function(url, foundDuplicates) {
    try {
      if (!url) return;
      
      const stats = this.urlFrequency.get(url) || {
        checkCount: 0,
        duplicateCount: 0,
        duplicateRatio: 0
      };
      
      stats.checkCount++;
      if (foundDuplicates) stats.duplicateCount++;
      stats.duplicateRatio = stats.duplicateCount / stats.checkCount;
      
      this.urlFrequency.set(url, stats);
      
      // 限制URL统计缓存大小
      if (this.urlFrequency.size > this.maxCacheSize) {
        // 移除最早添加的项
        const oldestUrl = this.urlFrequency.keys().next().value;
        this.urlFrequency.delete(oldestUrl);
      }
    } catch (e) {
      console.warn('更新URL统计错误:', e.message);
    }
  },
  
  // 清理过期的检查记录
  cleanup: function() {
    const now = Date.now();
    const expiredTime = now - this.cooldownTime * 3; // 保留3倍冷却时间的记录
    
    // 移除过期的URL检查记录
    for (const [url, checkInfo] of this.urlChecks.entries()) {
      if (checkInfo.time < expiredTime) {
        this.urlChecks.delete(url);
      }
    }
    
    // 清理过期的URL统计记录
    for (const [url, stats] of this.urlFrequency.entries()) {
      if (stats.checkCount > 0 && stats.duplicateRatio === 0 && stats.checkCount > 10) {
        // 如果URL检查次数很多但从未重复，且检查次数超过10次，可以清理
        this.urlFrequency.delete(url);
      }
    }
  }
};

const duplicateCheckSettingsState = {
  enableDuplicateCheck: true,
  autoCloseDetectedTabs: false
};
let duplicateCheckSettingsLoadPromise = null;

function applyDuplicateCheckSettings(items) {
  if (!items) return;
  duplicateCheckSettingsState.enableDuplicateCheck = items.enableDuplicateCheck !== false;
  duplicateCheckSettingsState.autoCloseDetectedTabs = items.autoCloseDetectedTabs === true;
}

function loadDuplicateCheckSettings() {
  duplicateCheckSettingsLoadPromise = chrome.storage.sync.get({
    enableDuplicateCheck: true,
    autoCloseDetectedTabs: false
  }).then((items) => {
    applyDuplicateCheckSettings(items);
  }).catch((e) => {
    console.warn('读取重复标签检测设置失败:', e && e.message ? e.message : e);
  });
  return duplicateCheckSettingsLoadPromise;
}

async function getDuplicateCheckSettingsCached() {
  if (duplicateCheckSettingsLoadPromise) {
    try {
      await duplicateCheckSettingsLoadPromise;
    } catch (_) { /* ignore */ }
    duplicateCheckSettingsLoadPromise = null;
  }
  return duplicateCheckSettingsState;
}

loadDuplicateCheckSettings();

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'sync') return;
  if (changes.showTabCountBadge) scheduleTabCountUpdate();
  const next = {};
  let hasChange = false;
  if (changes.enableDuplicateCheck) {
    next.enableDuplicateCheck = changes.enableDuplicateCheck.newValue;
    hasChange = true;
  }
  if (changes.autoCloseDetectedTabs) {
    next.autoCloseDetectedTabs = changes.autoCloseDetectedTabs.newValue;
    hasChange = true;
  }
  if (hasChange) applyDuplicateCheckSettings(next);
});

// 优化后的标签页检查函数 - 2秒防抖，重要操作立即执行
const checkTabDuplicatesDebounced = debounce(async (tabId, isImportant = false) => {
  try {
    // 首先检查设置是否启用了重复标签页检测（使用缓存，避免每次标签激活都读 storage）
    const settings = await getDuplicateCheckSettingsCached();
    
    if (!settings.enableDuplicateCheck) {
      console.log('重复标签页检测已禁用');
      return;
    }
    
    // 首先验证标签页是否仍然存在
    try {
      const tab = await getOpenTab(tabId);
      if (!tab || !tab.url) return;
      
      // 检查URL是否在忽略列表中
      if (!notificationTracker.shouldCheckUrl(tab.url)) {
        console.log(`标签页 ${tabId} URL已被用户忽略，跳过重复检测`);
        return;
      }
      
      // 使用智能跟踪器判断是否需要检查
      if (!isImportant && !duplicateCheckTracker.shouldCheck(tabId, tab.url)) {
        console.log(`标签页 ${tabId} 跳过检查（冷却期或非重要操作）`);
        return;
      }
      
      console.log(`开始检查标签页 ${tabId} 的重复标签: ${tab.url}`);
      
      // 提取完整URL，用于通知跟踪
      let fullUrl = tab.url;
      
      // 检查是否有重复标签页
      const duplicates = await checkDuplicateTabs(tab.id, tab.url);
      
      // 更新URL统计
      duplicateCheckTracker.updateUrlStats(tab.url, duplicates.length > 0);
      
      // 如果找到重复标签页
      if (duplicates.length > 0) {
        // 检查是否启用了自动关闭重复标签功能
        if (settings.autoCloseDetectedTabs) {
          console.log(`已启用自动关闭重复标签功能，将关闭 ${duplicates.length} 个重复标签页`);
          
          try {
            // 获取重复标签的ID
            const duplicateIds = duplicates.map(tab => tab.id);
            
            // 关闭重复标签页
            await chrome.tabs.remove(duplicateIds);
            
            // 记录该URL的自动关闭操作
            if (fullUrl) {
              notificationTracker.recordResponse(fullUrl, 'autoclose', tab.url);
              console.log(`已自动关闭URL ${fullUrl} 的 ${duplicateIds.length} 个重复标签页`);
            }
            
            // 显示一个简短的成功通知
            safeTabSendMessage(tab.id, {
              action: 'showAutoCloseSuccessNotification',
              data: {
                count: duplicates.length,
                titles: duplicates.map(t => t.title || '未命名标签页').slice(0, 3)
              }
            }, true, 0);
          } catch (e) {
            console.error('自动关闭重复标签页错误:', e.message);
            // 自动关闭失败时，退回到显示通知
        notifyDuplicateTabs(tab.id, duplicates);
          }
        } else {
          // 未启用自动关闭，显示常规通知
          notifyDuplicateTabs(tab.id, duplicates);
        }
      }
    } catch (e) {
      // 如果标签页不存在，静默忽略
      if (e.message.includes('No tab with id')) {
        console.log('标签页已不存在，忽略检查:', tabId);
      } else {
        console.error('切换标签页后检查重复错误:', e.message);
      }
    }
  } catch (e) {
    console.error('标签页检查防抖函数错误:', e.message);
  }
}, 2000); // 2秒的防抖时间，比之前更短以提高响应速度

// 监听标签页激活事件
chrome.tabs.onActivated.addListener((activeInfo) => {
  recordActiveTabSwitch(activeInfo.windowId, activeInfo.tabId);
  console.log(`标签页激活事件: ${activeInfo.tabId}`);
  // 标签页被激活时，检查是否有重复
  checkTabDuplicatesDebounced(activeInfo.tabId, true); // 激活事件是重要操作，设置为true
});

// 监听标签页更新事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  console.log(`标签页更新事件: ${tabId}, status: ${changeInfo.status}, active: ${tab.active}, url: ${changeInfo.url}`);
  // 只在页面加载完成并且是当前激活的标签页时检查
  if (changeInfo.status === 'complete' && tab.active) {
    console.log(`页面加载完成，开始检查重复标签: ${tabId}`);
    checkTabDuplicatesDebounced(tabId);
  } else if (changeInfo.url && tab.active) {
    // URL变化时也检查，但使用短防抖
    console.log(`URL变化，开始检查重复标签: ${tabId}`);
    checkTabDuplicatesDebounced(tabId, true);
  }
});

// 检查与指定标签页URL相同的其他标签页
// 返回重复标签页的数组（不包括指定的标签页）
async function checkDuplicateTabs(tabId, url) {
  try {
    if (!url) return [];
    
    // 浏览器特殊页面不检查重复
    if (isRestrictedBrowserUrl(url) || isNewTabUrl(url)) {
      return [];
    }
    
    // 检查URL是否在忽略列表中 - 用户已明确选择忽略该URL的重复检测
    if (!notificationTracker.shouldCheckUrl(url)) {
      console.log(`标签页 ${tabId} URL已被用户忽略，跳过重复检测`);
      return [];
    }
    
    // 使用全局URL标准化函数
    
    // 预先规范化当前URL，避免在循环中重复处理
    const normalizedCurrentUrl = normalizeUrl(url);
    console.log('规范化当前URL:', normalizedCurrentUrl);

    // 获取所有标签页
    const tabs = await chrome.tabs.query({});
    
    // 查找URL相同但ID不同的标签页
    const duplicates = [];
    
    // 使用Map存储已处理过的URL，提高大量标签页的处理效率
    const processedUrls = new Map();
    
    // 批量处理标签页，减少重复的URL标准化
    const validTabs = tabs.filter(tab => tab.id !== tabId && isValidTab(tab));
    
    // 批量标准化URL，提高性能
    const normalizedUrls = batchNormalizeUrls(validTabs);
    
    // 查找重复标签页
    for (const tab of validTabs) {
      const normalizedTabUrl = normalizedUrls.get(tab.id);
      if (!normalizedTabUrl) continue;
      
      // 检查规范化后的URL是否匹配
      const isDuplicate = normalizedCurrentUrl === normalizedTabUrl;
      
      // 记录处理结果，以便后续查找同样URL的标签页时可以直接使用结果
      processedUrls.set(tab.url, isDuplicate);
      
      if (isDuplicate) {
        duplicates.push(tab);
      }
    }
    
    console.log(`找到 ${duplicates.length} 个重复标签页，规范化URL: ${normalizedCurrentUrl}`);
    return duplicates;
  } catch (e) {
    console.error('检查重复标签页错误:', e.message);
    return [];
  }
}

// 重复标签通知跟踪器
const notificationTracker = {
  // 通知记录 - 格式: { [domain]: { lastShown: timestamp, totalShown: number, responses: { close: number, ignore: number } } }
  notifications: {},
  // 忽略的URL - 格式: { [normalizedUrl]: timestamp }
  ignoredUrls: {},
  // 标签页特定记录 - 跟踪每个标签页的最后通知时间
  tabNotifications: new Map(),
  
  // 使用全局URL标准化函数
  normalizeUrl: normalizeUrl,
  
  // 检查URL是否应该检测重复
  shouldCheckUrl(url) {
    if (!url) return true;
    
    const normalizedUrl = this.normalizeUrl(url);
    
    // 检查URL是否在忽略列表中
    if (normalizedUrl in this.ignoredUrls) {
      // 检查是否已过期（24小时后自动过期）
      const timestamp = this.ignoredUrls[normalizedUrl];
    const now = Date.now();
    
      if (now - timestamp < 24 * 60 * 60 * 1000) { // 24小时内
        console.log(`URL ${url} 在忽略列表中，跳过检测`);
      return false;
      } else {
        // 已过期，从忽略列表中移除
        delete this.ignoredUrls[normalizedUrl];
      }
    }
    
    return true;
  },
  
  // 清理过期忽略的URL
  cleanupIgnoredUrls() {
    const now = Date.now();
    const expireTime = 24 * 60 * 60 * 1000; // 24小时
    
    Object.keys(this.ignoredUrls).forEach(url => {
      if (now - this.ignoredUrls[url] > expireTime) {
        delete this.ignoredUrls[url];
      }
    });
  },
  
  // 检查是否可以为特定标签页显示通知
  canNotify(tabId, url, count) {
    // 首先检查URL是否在忽略列表中
    if (!this.shouldCheckUrl(url)) {
      return false;
    }
    
    // 使用完整URL作为键
    const fullUrl = url;
    
    const now = Date.now();
    
    // 如果没有该URL的记录，创建一个
    if (!this.notifications[fullUrl]) {
      this.notifications[fullUrl] = {
        lastShown: 0,
        totalShown: 0,
        responses: { close: 0, ignore: 0 }
      };
    }
    
    const record = this.notifications[fullUrl];
    
    // 清理记录中的旧数据
    this.cleanup();
    
    // 标签页特定的时间检查 - 处理在标签页间切换的情况
    // 如果这个标签页之前收到过通知，有自己的冷却时间
    const tabLastNotified = this.tabNotifications.get(tabId) || 0;
    const tabCooldown = 3 * 60 * 1000; // 标签页特定冷却时间：3分钟
    
    // 域名通用冷却时间检查（降低为5分钟，更易于在切换标签页后再次收到通知）
    const domainCooldown = 5 * 60 * 1000; // 5分钟
    
    // 检查标签页特定的冷却时间
    if (now - tabLastNotified < tabCooldown) {
      // 如果有足够多的重复标签页，仍然允许显示
      if (count > 2) {
        // 当有大量重复标签页时，重写冷却时间
        console.log(`标签页 ${tabId} 有 ${count} 个重复标签，允许显示通知`);
      } else {
        console.log(`标签页 ${tabId} 通知冷却中，跳过通知`);
        return false;
      }
    }
    
    // 检查URL通用冷却时间
    if (now - record.lastShown < domainCooldown) {
      // 为URL提供的阈值判断
      if (count < 1 + Math.min(2, record.responses.close)) {
        console.log(`URL ${fullUrl} 重复标签数量未达阈值，跳过通知`);
        return false;
      }
    }
    
    // 更新记录
    record.lastShown = now;
    record.totalShown += 1;
    
    // 更新标签页特定通知时间
    this.tabNotifications.set(tabId, now);
    
    return true;
  },
  
  // 记录用户对通知的响应
  recordResponse(fullUrl, action, url) {
    if (!fullUrl) return;
    
    // 使用完整URL作为键，如果没有该URL的记录，创建一个
    if (!this.notifications[fullUrl]) {
      this.notifications[fullUrl] = {
        lastShown: Date.now(),
        totalShown: 1,
        responses: { close: 0, ignore: 0 }
      };
    }
    
    // 增加相应动作的计数
    if (action in this.notifications[fullUrl].responses) {
      this.notifications[fullUrl].responses[action] += 1;
    }
    
    // 如果是忽略操作，将URL添加到忽略列表
    if (action === 'ignore' && url) {
      const normalizedUrl = this.normalizeUrl(url);
      this.ignoredUrls[normalizedUrl] = Date.now();
      console.log(`添加URL到忽略列表: ${url} (标准化为: ${normalizedUrl})`);
      
      // 保存到session存储
      this.saveIgnoredUrls();
    }
    
    // 保存通知记录
    this.save();
  },
  
  // 清理超过24小时的通知记录
  cleanup() {
    const now = Date.now();
    const expiryTime = 24 * 60 * 60 * 1000; // 24小时
    
    // 清理通知记录
    Object.keys(this.notifications).forEach(domain => {
      const record = this.notifications[domain];
      if (now - record.lastShown > expiryTime) {
        delete this.notifications[domain];
      }
    });
    
    // 清理忽略的URL列表
    this.cleanupIgnoredUrls();
  },
  
  // 清理已关闭标签页的记录
  cleanupTabNotifications(closedTabId) {
    if (closedTabId && this.tabNotifications.has(closedTabId)) {
      // 删除指定的标签页记录
      this.tabNotifications.delete(closedTabId);
      console.log(`清理标签页 ${closedTabId} 的通知记录`);
    } else if (!closedTabId) {
      // 定期清理：检查所有标签页是否仍然有效
      chrome.tabs.query({}, tabs => {
        const existingTabIds = new Set(tabs.map(tab => tab.id));
        
        // 找出并删除不再存在的标签页记录
        for (const tabId of this.tabNotifications.keys()) {
          if (!existingTabIds.has(tabId)) {
            this.tabNotifications.delete(tabId);
            console.log(`清理已关闭标签页 ${tabId} 的记录`);
          }
        }
      });
    }
  },
  
  // 保存通知记录到storage
  save() {
    chrome.storage.local.set({ notificationRecord: this.notifications }, () => {
      if (chrome.runtime.lastError) {
        console.error('保存通知记录错误:', chrome.runtime.lastError.message);
      }
    });
  },
  
  // 保存忽略的URL到storage
  saveIgnoredUrls() {
    chrome.storage.session.set({ ignoredUrls: this.ignoredUrls }, () => {
      if (chrome.runtime.lastError) {
        console.error('保存忽略URL列表错误:', chrome.runtime.lastError.message);
      }
    });
  },
  
  // 从storage加载通知记录
  load() {
    chrome.storage.local.get({ notificationRecord: {} }, (result) => {
      if (chrome.runtime.lastError) {
        console.error('加载通知记录错误:', chrome.runtime.lastError.message);
        return;
      }
      this.notifications = result.notificationRecord || {};
      chrome.storage.session.get({ ignoredUrls: {} }, (sessionResult) => {
        if (chrome.runtime.lastError) {
          console.error('加载忽略URL列表错误:', chrome.runtime.lastError.message);
          return;
        }
        this.ignoredUrls = sessionResult.ignoredUrls || {};
        this.cleanupIgnoredUrls();
      });
    });
  }
};

// 初始化通知跟踪器
notificationTracker.load();

// 通知用户有重复标签页
function notifyDuplicateTabs(tabId, duplicates) {
  if (!duplicates || duplicates.length === 0) return;
  
  try {
    const count = duplicates.length;
    const duplicateIds = duplicates.map(tab => tab.id);
    
    // 获取当前标签页信息用于URL检查
    chrome.tabs.get(tabId, async (tab) => {
      if (chrome.runtime.lastError) {
        console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
        return;
      }
      
      if (!tab || !tab.url) return;
      
      // 提取域名用于跟踪
      let domain = '';
      try {
        domain = new URL(tab.url).hostname;
      } catch (e) {
        // 忽略无效URL
      }
      
      // 检查是否可以为该URL显示通知
      if (!notificationTracker.canNotify(tabId, tab.url, count)) {
        console.log('已对此URL显示过通知，暂不重复显示');
        return;
      }
      
      // 获取语言设置
      const settings = await chrome.storage.sync.get({ language: 'en' });
      const currentLang = settings.language || 'en';
      const isEnglish = currentLang === 'en' || currentLang.startsWith('en');
      
      // 创建通知ID
      const notificationId = `duplicate-tabs-${tabId}-${Date.now()}`;
      
      // 增强的通知数据，包含更多信息
      const notificationData = {
          tabId: tabId,
          duplicateIds: duplicateIds,
        domain: domain,
        tabUrl: tab.url, // 添加标签页URL
        timestamp: Date.now(),
        duplicates: duplicates.map(dupTab => ({
          id: dupTab.id,
          url: dupTab.url,
          title: dupTab.title || '未命名标签页',
          favicon: dupTab.favIconUrl || ''
        }))
      };
      
      // 存储通知相关信息以便后续处理
      chrome.storage.local.set({
        [notificationId]: notificationData
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('保存重复标签页信息错误:', chrome.runtime.lastError.message);
          return;
        }
        
        // 使用改进的安全发送消息函数
        safeTabSendMessage(tabId, {
          action: 'showDuplicateTabsNotification',
          data: {
            count: count,
            notificationId: notificationId,
            domain: domain,
            tabUrl: tab.url,
            duplicateUrls: duplicates.map(tab => tab.url),
            title: duplicates[0].title || '未命名标签页',
            // 只发送前3个标题，避免数据过大
            titles: duplicates.slice(0, 3).map(t => t.title || chrome.i18n.getMessage('untitledTab') || (isEnglish ? 'Untitled tab' : '未命名标签页'))
          }
        }, true, 0);  // 仅主框架显示页面内通知
      });
    });
  } catch (e) {
    console.error('创建重复标签页通知错误:', e.message);
  }
}

// 检查是否存在空白新标签页
// 如果存在，激活该标签页并返回true，否则返回false
async function checkAndActivateEmptyTab(preferredWindowId = null) {
  try {
    const query = preferredWindowId != null ? { windowId: preferredWindowId } : {};
    const tabs = await chrome.tabs.query(query);
    
    // 查找符合条件的标签页
    for (const tab of tabs) {
      // 跳过没有URL的标签页
      if (!tab.url) continue;
      
      // 检查是否是新标签页
      if (isNewTabUrl(tab.url)) {
        console.log('找到空白新标签页，ID:', tab.id);
        
        // 激活找到的标签页
        await chrome.tabs.update(tab.id, { active: true });
        
        // 将窗口置于前台
        if (tab.windowId) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        
        return true; // 表示找到并激活了空白标签页
      }
    }
    
    // 未找到空白新标签页
    console.log('未找到空白新标签页');
    return false;
  } catch (e) {
    console.error('检查空白标签页错误:', e.message);
    return false;
  }
}

// 检查URL是否已在现有标签页中打开
// 如果找到匹配的标签页，则激活该标签页并返回true
// 如果未找到匹配的标签页，则返回false
async function checkAndActivateExistingTab(url, preferredWindowId = null) {
  try {
    // 如果URL为空，可能是想打开新标签页
    if (!url) {
      return await checkAndActivateEmptyTab(preferredWindowId);
    }
    
    // 特殊情况：如果请求打开的是新标签页
    if (isNewTabUrl(url)) {
      return await checkAndActivateEmptyTab(preferredWindowId);
    }
    
    // 规范化URL以确保一致的比较
    // 只移除URL末尾的空片段标识符（#）
    const normalizedUrl = new URL(url);
    if (normalizedUrl.hash === '#') {
      normalizedUrl.hash = '';
    }
    const urlToFind = normalizedUrl.toString();
    
    console.log('检查是否存在相同URL的标签页:', urlToFind);
    
    const query = preferredWindowId != null ? { windowId: preferredWindowId } : {};
    const tabs = await chrome.tabs.query(query);
    
    // 查找具有相同URL的标签页
    for (const tab of tabs) {
      // 跳过没有URL的标签页
      if (!tab.url) continue;
      
      // 规范化标签页的URL
      const tabNormalizedUrl = new URL(tab.url);
      if (tabNormalizedUrl.hash === '#') {
        tabNormalizedUrl.hash = '';
      }
      const tabUrl = tabNormalizedUrl.toString();
      
      // 检查URL是否匹配
      if (tabUrl === urlToFind) {
        console.log('找到相同URL的标签页，ID:', tab.id);
        
        // 激活找到的标签页
        await chrome.tabs.update(tab.id, { active: true });
        
        // 将窗口置于前台
        if (tab.windowId) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        
        return true; // 表示找到并激活了现有标签页
      }
    }
    
    // 未找到匹配的标签页
    console.log('未找到相同URL的标签页');
    return false;
  } catch (e) {
    console.error('检查现有标签页错误:', e.message);
    return false; // 出错时返回false，允许创建新标签页
  }
}

// 优化内存使用的函数
function optimizeMemoryUsage() {
  try {
    // 清理通知跟踪器
    notificationTracker.cleanup();
    
    // 智能清理URL标准化缓存
    checkAndCleanCache();
    
    // 清理URL缓存
    if (lastCheckedTab.processedUrls && lastCheckedTab.processedUrls.size > 100) {
      lastCheckedTab.processedUrls.clear();
    }
    
    // 清理URL频率数据，只保留最近访问的URL
    if (duplicateCheckTracker && duplicateCheckTracker.urlFrequency) {
      const urls = Array.from(duplicateCheckTracker.urlFrequency.entries());
      if (urls.length > 50) {
        // 只保留最近使用的50个URL
        urls.sort((a, b) => {
          const lastTimeA = a[1].lastTime || 0;
          const lastTimeB = b[1].lastTime || 0;
          return lastTimeB - lastTimeA;
        });
        
        // 创建新的Map
        const newMap = new Map();
        urls.slice(0, 50).forEach(([url, stats]) => {
          newMap.set(url, stats);
        });
        
        duplicateCheckTracker.urlFrequency = newMap;
      }
    }
    
    // 清理 URL 检查缓存
    if (duplicateCheckTracker && duplicateCheckTracker.urlChecks) {
      duplicateCheckTracker.cleanup();
    }
    
    // 清理存储中的旧通知数据
    chrome.storage.local.get(null, (items) => {
      const now = Date.now();
      const keysToRemove = [];
      
      for (const key in items) {
        // 只处理重复标签页通知数据
        if (key.startsWith('duplicate-tabs-')) {
          const data = items[key];
          
          // 删除超过1小时的通知数据
          if (data.timestamp && (now - data.timestamp) > 3600000) {
            keysToRemove.push(key);
          }
        }
      }
      
      if (keysToRemove.length > 0) {
        chrome.storage.local.remove(keysToRemove, () => {
          console.log(`已清理 ${keysToRemove.length} 条过期通知数据`);
        });
      }
    });
  } catch (e) {
    console.warn('内存优化错误:', e.message);
  }
}

let lastCleanupTime = Date.now();

// 智能打开标签页 - 如果标签页已存在则跳转，否则创建新标签页
async function smartCreateTab(url, active = true, preferredWindowId = null) {
  try {
    // 如果URL为空，说明是打开空白新标签页
    if (!url || typeof url !== 'string') {
      console.log('尝试打开空白新标签页');
      
      // 尝试查找并激活现有的空白标签页
      const existingEmptyTabActivated = await checkAndActivateEmptyTab(preferredWindowId);
      
      // 如果没有找到空白标签页，则创建一个
      if (!existingEmptyTabActivated) {
        console.log('创建新的空白标签页');
        try {
          await createTabWithRecentIndex(null, true, preferredWindowId);
        } catch (e) {
          console.error('创建空白标签页错误:', e.message);
        }
      }
      
      return;
    }
    
    // 对于非空URL，执行标准处理
    try {
      // 检查是否是特殊协议URL
      const hasSpecialProtocol = SPECIAL_PROTOCOLS.some(protocol => url.toLowerCase().startsWith(protocol));
      
      // 如果不是特殊协议URL，则添加https://
      if (!hasSpecialProtocol) {
        url = 'https://' + url;
      }
      
      // 特殊处理扩展 URL 中的双斜杠问题（Chrome / Firefox）
      if (url.startsWith('chrome-extension://')) {
        url = url.replace(/chrome-extension:\/\/([^\/]*)\/\//, 'chrome-extension://$1/');
        console.log('处理后的扩展URL:', url);
      } else if (url.startsWith('moz-extension://')) {
        url = url.replace(/moz-extension:\/\/([^\/]*)\/\//, 'moz-extension://$1/');
        console.log('处理后的扩展URL:', url);
      }
      
      // 特殊处理新标签页的情况
      if (isNewTabUrl(url)) {
        return await checkAndActivateEmptyTab(preferredWindowId) || (async () => {
          try {
            return await createTabWithRecentIndex(null, true, preferredWindowId);
          } catch (e) {
            console.error('创建新标签页错误:', e.message);
            return null;
          }
        })();
      }
      
      new URL(url); // 验证URL格式
    } catch (e) {
      console.error('URL格式无效:', url, e.message);
      return;
    }
    
    // 首先检查该URL是否已在现有标签页中打开
    const existingTabActivated = await checkAndActivateExistingTab(url, preferredWindowId);
    
    // 如果已经激活了现有标签页，就不需要创建新标签页
    if (existingTabActivated) {
      console.log('已跳转到现有标签页，不创建新标签页');
      return;
    }
    
    // 新增: 自动关闭重复标签功能
    // 获取设置
    const settings = await chrome.storage.sync.get({
      enableDuplicateCheck: true,
      autoCloseDetectedTabs: false, // 默认不自动关闭
      smartTabHandling: true // 智能打开标签页
    });
    
    // 如果启用了自动关闭重复标签
    if (settings.enableDuplicateCheck && settings.autoCloseDetectedTabs) {
      try {
        // 先检查是否有重复标签
        const allTabs = await chrome.tabs.query({});
        
        // 使用全局URL标准化函数
        
        const normalizedUrl = normalizeUrl(url);
        const potentialDuplicates = [];
        
        // 查找潜在的重复标签
        const validTabs = allTabs.filter(isValidTab);
        const normalizedUrls = batchNormalizeUrls(validTabs);
        
        for (const tab of validTabs) {
          const normalizedTabUrl = normalizedUrls.get(tab.id);
          if (normalizedTabUrl && normalizedUrl === normalizedTabUrl) {
            potentialDuplicates.push(tab);
          }
        }
        
        // 找到重复标签，关闭它们，只保留一个并激活它
        if (potentialDuplicates.length > 0) {
          const tabToKeep = potentialDuplicates[0];
          
          // 关闭其他重复标签
          if (potentialDuplicates.length > 1) {
            const tabIdsToRemove = potentialDuplicates.slice(1).map(tab => tab.id);
            await chrome.tabs.remove(tabIdsToRemove);
            console.log(`自动关闭了 ${tabIdsToRemove.length} 个重复标签页`);
          }
          
          // 激活保留的标签
          await chrome.tabs.update(tabToKeep.id, { active: true });
          
          // 如果该标签页在不同窗口，则聚焦该窗口
          if (tabToKeep.windowId) {
            await chrome.windows.update(tabToKeep.windowId, { focused: true });
          }
          
          console.log('已激活现有标签页，不创建新标签页');
          return;
        }
      } catch (e) {
        console.warn('自动关闭重复标签检查错误:', e.message);
        // 错误时继续正常创建标签
      }
    }
    
    // 未找到现有标签页，创建新标签页
    console.log('创建新标签页:', url);
    try {
      const tab = await createTabWithRecentIndex(url, active, preferredWindowId);
      console.log('成功创建新标签页:', tab.id);
      
      // 添加延迟，确保标签页加载完成再检查重复
      // 由于onActivated和onUpdated事件会自动触发检查，这里延长到2秒检查以避免频繁重复检查
      setTimeout(async () => {
          try {
            const openedTabId = tab.id;
            const currentTab = await getOpenTab(openedTabId);
            if (!currentTab || !currentTab.url) return;

            // 获取当前打开的标签页
            // 检查该标签页是否已在冷却期内
            const now = Date.now();
            if (lastCheckedTab.id === openedTabId &&
                lastCheckedTab.url === currentTab.url &&
                (now - lastCheckedTab.time) < lastCheckedTab.cooldown) {
              console.log(`新创建标签页 ${openedTabId} 已在其他事件中检查过，跳过检查`);
              return;
            }

            // 更新最近检查记录
            lastCheckedTab = {
              id: openedTabId,
              url: currentTab.url,
              time: now,
              cooldown: lastCheckedTab.cooldown,
              processedUrls: lastCheckedTab.processedUrls
            };

            // 检查是否有重复标签页
            const duplicates = await checkDuplicateTabs(openedTabId, currentTab.url);

            // 如果找到重复标签页，显示通知
            if (duplicates.length > 0) {
              notifyDuplicateTabs(openedTabId, duplicates);
            }
          } catch (e) {
            if (e.message && e.message.includes('No tab with id')) return;
            console.error('标签页打开后检查重复错误:', e.message);
          }
        }, 2000);
    } catch (e) {
      console.error('创建新标签页错误:', e.message);
    }
  } catch (e) {
    console.error('智能创建标签页错误:', e.message);
  }
}

/**
 * Firefox 中 chrome.tabs.goBack/goForward 常返回 undefined（非 Promise），对返回值 .catch 会同步抛错，
 * 导航从未执行，内容脚本仍显示「前进/后退」提示。优先使用 browser.tabs，并仅在返回 Promise 时 .catch。
 */
/** 按倍数调整当前标签页缩放（Chrome tabs API / Firefox Promise） */
function adjustTabZoom(tabId, multiplier) {
  if (tabId == null || !multiplier || multiplier <= 0) return;
  const MIN = 0.25;
  const MAX = 5;
  const applyZoom = (z) => {
    const cur = typeof z === 'number' && !Number.isNaN(z) ? z : 1;
    let next = cur * multiplier;
    next = multiplier > 1 ? Math.min(MAX, next) : Math.max(MIN, next);
    next = Math.round(next * 100) / 100;
    try {
      let ret = null;
      if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.setZoom === 'function') {
        ret = chrome.tabs.setZoom(tabId, next);
      } else if (typeof browser !== 'undefined' && browser.tabs && typeof browser.tabs.setZoom === 'function') {
        ret = browser.tabs.setZoom(tabId, next);
      }
      if (ret != null && typeof ret.then === 'function') ret.catch(() => {});
    } catch (_) { /* ignore */ }
  };
  if (typeof browser !== 'undefined' && browser.tabs && typeof browser.tabs.getZoom === 'function') {
    const p = browser.tabs.getZoom(tabId);
    if (p != null && typeof p.then === 'function') {
      p.then(applyZoom).catch(() => {});
      return;
    }
  }
  if (typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs.getZoom === 'function') {
    chrome.tabs.getZoom(tabId, (z) => {
      if (chrome.runtime.lastError) return;
      applyZoom(z);
    });
  }
}

function invokeTabsHistoryNavigation(tabId, direction) {
  const operation = direction === 'back' ? 'back' : 'forward';
  const method = direction === 'back' ? 'goBack' : 'goForward';
  const tabsApi =
    typeof browser !== 'undefined' && browser.tabs && typeof browser.tabs[method] === 'function'
      ? browser.tabs
      : typeof chrome !== 'undefined' && chrome.tabs && typeof chrome.tabs[method] === 'function'
        ? chrome.tabs
        : null;
  if (!tabsApi) return;

  function notifyFailure(msg) {
    if (tabId == null) return;
    try {
      chrome.tabs.sendMessage(tabId, {
        action: 'navigationFailed',
        operation: operation,
        error: msg || ''
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  try {
    const ret = tabId != null ? tabsApi[method](tabId) : tabsApi[method]();
    if (ret != null && typeof ret.then === 'function') {
      ret.catch(function (err) {
        notifyFailure(err && err.message ? err.message : String(err));
      });
    }
  } catch (e) {
    notifyFailure(e && e.message ? e.message : String(e));
  }
}

const EXTENSION_PAGE_ONLY_ACTIONS = new Set([
  'listScreenshotHistory',
  'getScreenshotHistoryItem',
  'removeScreenshotHistoryItem',
  'clearScreenshotHistory',
  'trimScreenshotHistory',
  // openScreenshotHistory：popup / 预览页 / 网页快捷键(content) 均需能打开历史窗口
  'openScreenshotHistoryItem',
  'pinScreenshotHistoryItem',
  // 截图预览 / 历史页（扩展页，含 type:popup 时带 sender.tab）
  'pinScreenshotToPage',
  'screenshotPinUpload',
  'screenshotPinChunk',
  'getScreenshotPreview',
  'clearScreenshotPreview'
]);

function isTrustedExtensionSender(sender) {
  return !!(sender && sender.id === chrome.runtime.id);
}

function getSenderDocumentUrl(sender) {
  if (!sender) return '';
  if (sender.url) return String(sender.url);
  if (sender.tab && sender.tab.url) return String(sender.tab.url);
  return '';
}

function isExtensionPageSender(sender) {
  if (!isTrustedExtensionSender(sender)) return false;
  const url = getSenderDocumentUrl(sender);
  if (!url) return false;
  const base = chrome.runtime.getURL('');
  if (url.startsWith(base)) return true;
  try {
    const u = new URL(url);
    const baseOrigin = new URL(base).origin;
    return (
      (u.protocol === 'chrome-extension:' || u.protocol === 'moz-extension:') &&
      u.origin === baseOrigin
    );
  } catch (e) {
    return false;
  }
}

function isContentScriptSender(sender) {
  if (!isTrustedExtensionSender(sender)) return false;
  if (sender.tab == null || typeof sender.tab.id !== 'number') return false;
  return !isExtensionPageSender(sender);
}

function isTopFrameSender(sender) {
  if (!sender || !sender.tab) return false;
  const frameId = sender.frameId;
  return frameId == null || frameId === 0;
}

const previewPopupRegistry = new Map();

function normalizePreviewPopupUrlKey(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).href;
  } catch (e) {
    return raw;
  }
}

function removePreviewPopupRegistryByTabId(tabId) {
  if (tabId == null) return;
  for (const [urlKey, record] of previewPopupRegistry.entries()) {
    if (record && record.tabId === tabId) {
      previewPopupRegistry.delete(urlKey);
    }
  }
}

function removePreviewPopupRegistryByWindowId(windowId) {
  if (windowId == null) return;
  for (const [urlKey, record] of previewPopupRegistry.entries()) {
    if (record && record.windowId === windowId) {
      previewPopupRegistry.delete(urlKey);
    }
  }
}

function makePreviewPopupRecord(urlKey, tab, win, extra = {}) {
  if (!urlKey || !tab || typeof tab.id !== 'number') return null;
  return {
    urlKey,
    url: normalizePreviewPopupUrlKey(tab.url || extra.url || urlKey),
    tabId: tab.id,
    windowId: typeof tab.windowId === 'number' ? tab.windowId : (win && win.id),
    title: extra.title || tab.title || '',
    windowType: win && win.type ? win.type : '',
    lastAccess: Date.now()
  };
}

function storePreviewPopupRecord(record) {
  if (!record || !record.urlKey || typeof record.tabId !== 'number') return null;
  previewPopupRegistry.set(record.urlKey, record);
  return record;
}

function getRegisteredPreviewPopupRecord(urlKey, callback) {
  const record = previewPopupRegistry.get(urlKey);
  if (!record || typeof record.tabId !== 'number') {
    callback(null);
    return;
  }
  chrome.tabs.get(record.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || normalizePreviewPopupUrlKey(tab.url || record.url) !== urlKey) {
      previewPopupRegistry.delete(urlKey);
      callback(null);
      return;
    }
    record.url = normalizePreviewPopupUrlKey(tab.url || record.url);
    record.windowId = typeof tab.windowId === 'number' ? tab.windowId : record.windowId;
    record.title = tab.title || record.title || '';
    callback(record);
  });
}

function queryPreviewPopupCandidate(urlKey, sender, callback) {
  const sourceTabId = sender && sender.tab && typeof sender.tab.id === 'number'
    ? sender.tab.id
    : null;
  chrome.windows.getAll({ populate: true }, (windows) => {
    if (chrome.runtime.lastError || !Array.isArray(windows)) {
      callback(null);
      return;
    }

    const candidates = [];
    for (const win of windows) {
      const tabs = Array.isArray(win && win.tabs) ? win.tabs : [];
      for (const tab of tabs) {
        if (!tab || typeof tab.id !== 'number' || tab.id === sourceTabId) continue;
        if (normalizePreviewPopupUrlKey(tab.url) !== urlKey) continue;
        let score = 0;
        if (win && win.focused) score += 100;
        if (win && win.type === 'popup') score += 50;
        if (tabs.length === 1) score += 20;
        if (tab.active) score += 10;
        candidates.push({ score, win, tab });
      }
    }

    if (!candidates.length) {
      callback(null);
      return;
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    callback(storePreviewPopupRecord(makePreviewPopupRecord(urlKey, best.tab, best.win)));
  });
}

function findPreviewPopupRecord(urlKey, sender, callback) {
  getRegisteredPreviewPopupRecord(urlKey, (record) => {
    if (record) {
      callback(record);
      return;
    }
    queryPreviewPopupCandidate(urlKey, sender, callback);
  });
}

function focusPreviewPopupRecord(record, sendResponse) {
  if (!record || typeof record.windowId !== 'number') {
    sendResponse({ ok: true, found: false });
    return;
  }
  chrome.windows.update(record.windowId, { focused: true }, () => {
    if (chrome.runtime.lastError) {
      removePreviewPopupRegistryByWindowId(record.windowId);
      sendResponse({ ok: true, found: false });
      return;
    }
    const finish = () => {
      record.lastAccess = Date.now();
      previewPopupRegistry.set(record.urlKey, record);
      sendResponse({
        ok: true,
        found: true,
        tabId: record.tabId,
        windowId: record.windowId
      });
    };
    if (typeof record.tabId !== 'number') {
      finish();
      return;
    }
    chrome.tabs.update(record.tabId, { active: true }, () => {
      if (chrome.runtime.lastError) {
        removePreviewPopupRegistryByTabId(record.tabId);
        sendResponse({ ok: true, found: false });
        return;
      }
      finish();
    });
  });
}

function handlePreviewFindPopupRequest(message, sender, sendResponse) {
  if (!message || message.type !== '__mouseGestureFindPreviewPopup') {
    return false;
  }
  if (!isContentScriptSender(sender)) {
    sendResponse({ ok: false, error: 'unauthorized' });
    return true;
  }
  const urlKey = normalizePreviewPopupUrlKey(message.urlKey || message.url);
  if (!urlKey) {
    sendResponse({ ok: false, error: 'invalid_url' });
    return true;
  }
  findPreviewPopupRecord(urlKey, sender, (record) => {
    if (!record) {
      sendResponse({ ok: true, found: false });
      return;
    }
    focusPreviewPopupRecord(record, sendResponse);
  });
  return true;
}

function handlePreviewRegisterPopupRequest(message, sender, sendResponse) {
  if (!message || message.type !== '__mouseGestureRegisterPreviewPopup') {
    return false;
  }
  if (!isContentScriptSender(sender)) {
    sendResponse({ ok: false, error: 'unauthorized' });
    return true;
  }
  const urlKey = normalizePreviewPopupUrlKey(message.urlKey || message.url);
  if (!urlKey) {
    sendResponse({ ok: false, error: 'invalid_url' });
    return true;
  }
  const finish = (record) => {
    if (record) {
      record.title = message.title || record.title || '';
      record.lastAccess = Date.now();
      previewPopupRegistry.set(urlKey, record);
    }
    sendResponse({
      ok: true,
      registered: !!record,
      tabId: record && record.tabId,
      windowId: record && record.windowId
    });
  };
  queryPreviewPopupCandidate(urlKey, sender, (record) => {
    if (record) {
      finish(record);
      return;
    }
    setTimeout(() => {
      queryPreviewPopupCandidate(urlKey, sender, finish);
    }, 150);
  });
  return true;
}

const TOP_FRAME_REQUIRED_ACTIONS = new Set([
  'goBack',
  'goForward',
  'closeTab',
  'reopenClosedTab',
  'openNewTab',
  'refresh',
  'forceRefresh',
  'switchToLeftTab',
  'switchToRightTab',
  'switchToPreviousActiveTab',
  'goToParentUrl',
  'goToRootUrl',
  'stopLoading',
  'closeAllTabs',
  'newWindow',
  'newInPrivateWindow',
  'closeOtherTabs',
  'closeTabsToRight',
  'closeTabsToLeft',
  'reloadAllTabs',
  'stopLoadingAllTabs',
  'togglePinTab',
  'toggleMuteTab',
  'muteOtherTabs',
  'toggleFullscreen',
  'toggleMaximize',
  'minimizeWindow',
  'zoomIn',
  'zoomOut',
  'openInNewTab',
  'closeDuplicateTabs',
  'ignoreDuplicateTabs',
  'listPageScreenshotPins',
  'savePageScreenshotPin',
  'removePageScreenshotPin',
  'clearPageScreenshotPins',
  'splitViewScroll',
  'captureVisibleTab',
  'recordScreenshotHistory',
  'openScreenshotPreview',
  'screenshotPreviewUpload',
  'screenshotPreviewChunk',
  'superDrag',
  'openTabInBackground',
  'downloadUrl'
]);

/** 仅 top frame，iframe 不可凭 cross-frame token 绕过 */
const TOP_FRAME_STRICT_ACTIONS = new Set([
  'captureVisibleTab',
  'recordScreenshotHistory',
  'openScreenshotPreview',
  'screenshotPreviewUpload',
  'screenshotPreviewChunk',
  'screenshotOverlayHide',
  'screenshotOverlayShow',
  'listPageScreenshotPins',
  'savePageScreenshotPin',
  'removePageScreenshotPin',
  'clearPageScreenshotPins'
]);

const CONTENT_SCRIPT_LEASE_ACTIONS = new Set([
  'acquireScreenshotCaptureLease',
  'releaseScreenshotCaptureLease',
  'acquireSuperDragLease',
  'clearCrossFrameSession',
  'requestCrossFrameSession',
  'getContentContext'
]);

/** iframe 凭 cross-frame token 可调用以下 action（滚动/导航/拖拽/截图；不含 closeTab 等破坏性操作） */
const CROSS_FRAME_IFRAME_ALLOWED_ACTIONS = new Set([
  'scrollUp',
  'scrollDown',
  'scrollLeft',
  'scrollRight',
  'scrollToTop',
  'scrollToBottom',
  'scrollToLeft',
  'scrollToRight',
  'goBack',
  'goForward',
  'tryNavigateToNextPageInMainFrame',
  'superDrag',
  'openTabInBackground',
  'downloadUrl',
  'acquireSuperDragLease',
  'acquireScreenshotCaptureLease',
  'releaseScreenshotCaptureLease',
  'captureRegionFromIframe',
  'clearCrossFrameSession',
  'splitViewScroll',
  'gestureCompleteHandoffRequest',
  'gestureHintFromIframe',
  'superDragCompassFromIframe',
  'superDragCompassHide',
  'closeTab',
  'reopenClosedTab',
  'openNewTab',
  'refresh',
  'forceRefresh',
  'switchToLeftTab',
  'switchToRightTab',
  'switchToPreviousActiveTab',
  'goToParentUrl',
  'goToRootUrl',
  'stopLoading',
  'togglePinTab',
  'toggleMuteTab',
  'toggleFullscreen',
  'zoomIn',
  'zoomOut',
  'openInNewTab',
  'relayTopFrameGestureAction'
]);

const SCREENSHOT_HOTKEY_RELAY_MODES = new Set(['regionPick', 'viewport', 'fullPage', 'scrolling']);

function isAllowedHttpUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function isAllowedScreenshotDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return false;
  return /^data:image\/(png|jpe?g|webp|gif|bmp);/i.test(dataUrl);
}

function screenshotLeaseKey(tabId, frameId) {
  return String(tabId) + ':' + String(frameId != null ? frameId : 0);
}

function senderFrameId(sender) {
  return sender && typeof sender.frameId === 'number' ? sender.frameId : 0;
}

const screenshotCaptureLeases = new Map();
const SCREENSHOT_LEASE_MS = 120000;
const SCREENSHOT_LEASE_MAX_CAPTURES = 16;

function randomLeaseToken(prefix) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return prefix + Date.now() + '_' + hex;
}

function issueScreenshotCaptureLease(tabId, frameId) {
  const token = randomLeaseToken('sc_');
  screenshotCaptureLeases.set(screenshotLeaseKey(tabId, frameId), {
    token,
    expiresAt: Date.now() + SCREENSHOT_LEASE_MS,
    captureCount: 0
  });
  return token;
}

function validateScreenshotCaptureLease(tabId, frameId, token) {
  if (tabId == null || !token) return false;
  const lease = screenshotCaptureLeases.get(screenshotLeaseKey(tabId, frameId));
  if (!lease || lease.token !== token || Date.now() > lease.expiresAt) return false;
  if ((lease.captureCount || 0) >= SCREENSHOT_LEASE_MAX_CAPTURES) return false;
  return true;
}

function touchScreenshotCaptureLease(tabId, frameId, token) {
  if (!validateScreenshotCaptureLease(tabId, frameId, token)) return false;
  const key = screenshotLeaseKey(tabId, frameId);
  const lease = screenshotCaptureLeases.get(key);
  if (!lease) return false;
  lease.captureCount = (lease.captureCount || 0) + 1;
  if (lease.captureCount >= SCREENSHOT_LEASE_MAX_CAPTURES) {
    screenshotCaptureLeases.delete(key);
    return true;
  }
  lease.expiresAt = Date.now() + SCREENSHOT_LEASE_MS;
  return true;
}

function clearScreenshotCaptureLease(tabId, frameId, token) {
  const key = screenshotLeaseKey(tabId, frameId);
  const lease = screenshotCaptureLeases.get(key);
  if (lease && lease.token === token) {
    screenshotCaptureLeases.delete(key);
  }
}

const crossFrameSessions = new Map();
const CROSS_FRAME_SESSION_MS = 45000;

function crossFrameSessionKey(tabId, frameId) {
  return String(tabId) + ':cf:' + String(frameId != null ? frameId : 0);
}

function registerCrossFrameSession(tabId, frameId, token) {
  if (tabId == null || !token) return;
  crossFrameSessions.set(crossFrameSessionKey(tabId, frameId), {
    token,
    expiresAt: Date.now() + CROSS_FRAME_SESSION_MS
  });
}

function validateCrossFrameSession(tabId, frameId, token) {
  if (tabId == null || !token) return false;
  const key = crossFrameSessionKey(tabId, frameId);
  const row = crossFrameSessions.get(key);
  if (!row || row.token !== token || Date.now() > row.expiresAt) {
    return false;
  }
  row.expiresAt = Date.now() + CROSS_FRAME_SESSION_MS;
  return true;
}

function clearCrossFrameSession(tabId, frameId, token) {
  const key = crossFrameSessionKey(tabId, frameId);
  const row = crossFrameSessions.get(key);
  if (row && row.token === token) {
    crossFrameSessions.delete(key);
  }
}

function requireCrossFrameForward(sender, message) {
  if (isTopFrameSender(sender)) return true;
  const tabId = sender.tab && sender.tab.id;
  const frameId = senderFrameId(sender);
  const token = message && message._crossFrameToken;
  if (!validateCrossFrameSession(tabId, frameId, token)) return false;
  const action = message && message.action;
  if (action && !CROSS_FRAME_IFRAME_ALLOWED_ACTIONS.has(action)) return false;
  return true;
}

const superDragLeases = new Map();
const SUPER_DRAG_LEASE_MS = 60000;

function superDragLeaseKey(tabId, frameId) {
  return String(tabId) + ':sd:' + String(frameId != null ? frameId : 0);
}

function issueSuperDragLease(tabId, frameId, sessionId) {
  const fid = frameId != null ? frameId : 0;
  const token = randomLeaseToken('sd_');
  superDragLeases.set(superDragLeaseKey(tabId, fid), {
    token,
    frameId: fid,
    sessionId: sessionId || '',
    expiresAt: Date.now() + SUPER_DRAG_LEASE_MS
  });
  return token;
}

function consumeSuperDragLease(tabId, sender, token, sessionId) {
  if (tabId == null || !token || !sessionId) return false;
  const frameId = senderFrameId(sender);
  const lease = superDragLeases.get(superDragLeaseKey(tabId, frameId));
  if (
    !lease ||
    lease.token !== token ||
    lease.frameId !== frameId ||
    lease.sessionId !== sessionId ||
    Date.now() > lease.expiresAt
  ) {
    return false;
  }
  superDragLeases.delete(superDragLeaseKey(tabId, frameId));
  return true;
}

const LEASE_RATE_WINDOW_MS = 60000;
const SCREENSHOT_LEASE_MAX_PER_WINDOW = 24;
const SUPER_DRAG_LEASE_MAX_PER_WINDOW = 48;
const screenshotLeaseRate = new Map();
const superDragLeaseRate = new Map();

function canAcquireLease(rateMap, tabId, maxPerWindow) {
  const now = Date.now();
  let row = rateMap.get(tabId);
  if (!row || now - row.start > LEASE_RATE_WINDOW_MS) {
    row = { count: 0, start: now };
  }
  if (row.count >= maxPerWindow) return false;
  row.count += 1;
  rateMap.set(tabId, row);
  return true;
}

function requireScreenshotLeaseFromContentScript(sender, message, sendResponse) {
  if (!isContentScriptSender(sender)) return true;
  const tabId = sender.tab && sender.tab.id;
  const frameId = senderFrameId(sender);
  if (!validateScreenshotCaptureLease(tabId, frameId, message._screenshotLease)) {
    sendResponse({ success: false, error: 'no_screenshot_lease' });
    return false;
  }
  return true;
}

function authorizeRuntimeMessage(message, sender, sendResponse) {
  const action = message && message.action;
  if (!action) {
    sendResponse({ success: false, error: 'unauthorized' });
    return false;
  }
  if (action === 'ping' || action === 'checkExtensionValid') {
    if (!isTrustedExtensionSender(sender)) {
      sendResponse({ success: false, error: 'unauthorized' });
      return false;
    }
    return true;
  }
  if (action === 'openScreenshotHistory') {
    if (isExtensionPageSender(sender) || isContentScriptSender(sender)) {
      return true;
    }
    sendResponse({ success: false, error: 'unauthorized' });
    return false;
  }
  if (
    action === 'screenshotOverlayHide' ||
    action === 'screenshotOverlayShow' ||
    action === 'captureRegionFromIframe' ||
    action === 'requestCrossFrameSession'
  ) {
    if (!isContentScriptSender(sender)) {
      sendResponse({ success: false, error: 'unauthorized' });
      return false;
    }
    if (isContentScriptTabDisabled(sender)) {
      sendResponse({ success: false, error: 'site_disabled' });
      return false;
    }
    return true;
  }
  if (EXTENSION_PAGE_ONLY_ACTIONS.has(action)) {
    if (!isExtensionPageSender(sender)) {
      sendResponse({ success: false, error: 'unauthorized' });
      return false;
    }
    return true;
  }
  if (!isContentScriptSender(sender)) {
    sendResponse({ success: false, error: 'unauthorized' });
    return false;
  }
  if (isContentScriptTabDisabled(sender)) {
    sendResponse({ success: false, error: 'site_disabled' });
    return false;
  }
  if (CONTENT_SCRIPT_LEASE_ACTIONS.has(action)) {
    return true;
  }
  if (TOP_FRAME_STRICT_ACTIONS.has(action) && !isTopFrameSender(sender)) {
    sendResponse({ success: false, error: 'top_frame_required' });
    return false;
  }
  if (TOP_FRAME_REQUIRED_ACTIONS.has(action) && !isTopFrameSender(sender)) {
    if (!requireCrossFrameForward(sender, message)) {
      sendResponse({ success: false, error: 'no_cross_frame_session' });
      return false;
    }
  }
  return true;
}

function handleCloseDuplicateTabs(message, sender, sendResponse) {
  const notificationId = message.notificationId;

  chrome.storage.local.get([notificationId], async (result) => {
    if (!result || !result[notificationId]) {
      sendResponse({ success: false, error: '未找到通知数据' });
      return;
    }

    const { tabId, duplicateIds, domain } = result[notificationId];
    if (sender.tab && tabId != null && sender.tab.id !== tabId) {
      sendResponse({ success: false, error: 'unauthorized' });
      return;
    }

    if (domain) {
      notificationTracker.recordResponse(domain, 'close', null);
    }

    try {
      const validTabs = [];
      for (const id of duplicateIds) {
        try {
          await chrome.tabs.get(id);
          validTabs.push(id);
        } catch (e) {
          console.log(`标签页 ${id} 已不存在，忽略关闭`);
        }
      }

      if (validTabs.length > 0) {
        await chrome.tabs.remove(validTabs);
      }

      try {
        await chrome.tabs.get(tabId);
        await chrome.tabs.update(tabId, { active: true });
      } catch (e) {
        console.log(`当前标签页 ${tabId} 已不存在，忽略激活`);
      }

      chrome.storage.local.remove(notificationId);
      sendResponse({ success: true });
    } catch (e) {
      console.error('关闭重复标签页错误:', e.message);
      sendResponse({ success: false, error: e.message });
    }
  });
}

function handleIgnoreDuplicateTabs(message, sender, sendResponse) {
  const notificationId = message.notificationId;

  chrome.storage.local.get([notificationId], (result) => {
    if (!result || !result[notificationId]) {
      sendResponse({ success: false, error: '未找到通知数据' });
      return;
    }

    const { tabId } = result[notificationId];
    if (sender.tab && tabId != null && sender.tab.id !== tabId) {
      sendResponse({ success: false, error: 'unauthorized' });
      return;
    }

    const { domain, duplicates } = result[notificationId];

    let url = null;
    if (result[notificationId].tabUrl) {
      url = result[notificationId].tabUrl;
    } else if (duplicates && duplicates.length > 0) {
      url = duplicates[0].url;
    }

    if (domain) {
      notificationTracker.recordResponse(domain, 'ignore', url);
    }

    chrome.storage.local.remove(notificationId);

    sendResponse({ success: true });
  });
}

// 监听来自内容脚本的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (handleUnlockCssInsertRequest(message, sender, sendResponse)) {
    return true;
  }
  if (handleUnlockMainInjectRequest(message, sender, sendResponse)) {
    return true;
  }
  if (handleUnlockSetActiveRequest(message, sender, sendResponse)) {
    return true;
  }
  if (handlePreviewFindPopupRequest(message, sender, sendResponse)) {
    return true;
  }
  if (handlePreviewRegisterPopupRequest(message, sender, sendResponse)) {
    return true;
  }
  if (!authorizeRuntimeMessage(message, sender, sendResponse)) {
    return false;
  }
  const tabId = sender.tab ? sender.tab.id : null;
  
  try {
    if (typeof globalThis !== 'undefined' && globalThis.__MOUSE_EXT_CONSOLE_ENABLED__) {
      const a = message && message.action;
      console.log('mouse ext msg:', a, 'tab', tabId);
    }

    switch (message.action) {
      case 'ping':
      case 'checkExtensionValid':
        // 简单的 ping / 有效性检查
        sendResponse({ success: true, message: 'pong' });
        break;

      case 'getContentContext':
        sendResponse({
          success: true,
          tabId: sender.tab && sender.tab.id,
          frameId: senderFrameId(sender),
          tabUrl: (sender.tab && sender.tab.url) || ''
        });
        return true;

      case 'gestureCompleteHandoffRequest':
        if (!isContentScriptSender(sender)) {
          sendResponse({ success: false, error: 'unauthorized' });
          return true;
        }
        if (
          !isTopFrameSender(sender) &&
          !requireCrossFrameForward(sender, message)
        ) {
          sendResponse({ success: false, error: 'no_cross_frame_session' });
          return true;
        }
        safeTabSendMessage(tabId, { action: 'gestureCompleteHandoffRequest' }, true, 0).then(() => {
          sendResponse({ success: true });
        });
        return true;

      case 'relayTopFrameGestureAction': {
        if (!isContentScriptSender(sender) || isTopFrameSender(sender)) {
          sendResponse({ success: false, error: 'invalid_forward' });
          return true;
        }
        if (!requireCrossFrameForward(sender, message)) {
          sendResponse({ success: false, error: 'no_cross_frame_session' });
          return true;
        }
        const gestureAction = message.gestureAction && String(message.gestureAction);
        if (!gestureAction) {
          sendResponse({ success: false, error: 'invalid_action' });
          return true;
        }
        safeTabSendMessage(
          tabId,
          {
            action: 'executeRelayedGestureAction',
            gestureAction,
            gesturePayload: message.gesturePayload
          },
          false,
          0
        ).then((resp) => {
          sendResponse(resp && typeof resp === 'object' ? resp : { success: !!resp });
        });
        return true;
      }

      case 'runScreenshotHotkeyInMainFrame': {
        if (!isContentScriptSender(sender) || isTopFrameSender(sender)) {
          sendResponse({ success: false, error: 'invalid_forward' });
          return true;
        }
        const mode = message.mode && String(message.mode);
        if (!SCREENSHOT_HOTKEY_RELAY_MODES.has(mode)) {
          sendResponse({ success: false, error: 'invalid_mode' });
          return true;
        }
        safeTabSendMessage(
          tabId,
          {
            action: 'runScreenshotByModeFromIframeHotkey',
            mode,
            _sourceFrameId: senderFrameId(sender),
            _sourceUrl: sender.url || ''
          },
          true,
          0
        ).then((resp) => {
          sendResponse(resp && typeof resp === 'object' ? resp : { success: !!resp });
        });
        return true;
      }
        
      case 'goBack':
        invokeTabsHistoryNavigation(tabId, 'back');
        break;
        
      case 'goForward':
        invokeTabsHistoryNavigation(tabId, 'forward');
        break;
        
      case 'gestureTrailFromIframe': {
        const trailType = message.data && message.data.type;
        if (trailType === 'init' || trailType === 'update' || trailType === 'end') {
          if (!isContentScriptSender(sender) || isTopFrameSender(sender)) {
            sendResponse({ success: false, error: 'invalid_forward' });
            return true;
          }
          safeTabSendMessage(
            tabId,
            {
              action: 'gestureTrailFromIframe',
              data: message.data,
              _fromFrameId: senderFrameId(sender),
              _sourceUrl: sender.url || ''
            },
            false,
            0
          );
          sendResponse({ success: true });
          return true;
        }
        if (!requireCrossFrameForward(sender, message)) {
          sendResponse({ success: false, error: 'no_cross_frame_session' });
          return true;
        }
        safeTabSendMessage(
          tabId,
          {
            action: 'gestureTrailFromIframe',
            data: message.data,
            _crossFrameToken: message._crossFrameToken,
            _fromFrameId: senderFrameId(sender),
            _sourceUrl: sender.url || ''
          },
          false,
          0
        );
        sendResponse({ success: true });
        return true;
      }
        
      case 'gestureHintFromIframe':
        if (!isContentScriptSender(sender) || isTopFrameSender(sender)) {
          sendResponse({ success: false, error: 'invalid_forward' });
          return true;
        }
        if (!requireCrossFrameForward(sender, message)) {
          sendResponse({ success: false, error: 'no_cross_frame_session' });
          return true;
        }
        safeTabSendMessage(
          tabId,
          {
            action: 'gestureHintFromIframe',
            data: message.data,
            _crossFrameToken: message._crossFrameToken,
            _fromFrameId: senderFrameId(sender)
          },
          false,
          0
        );
        sendResponse({ success: true });
        return true;

      case 'superDragCompassFromIframe':
        if (!isContentScriptSender(sender) || isTopFrameSender(sender)) {
          sendResponse({ success: false, error: 'invalid_forward' });
          return true;
        }
        if (!requireCrossFrameForward(sender, message)) {
          sendResponse({ success: false, error: 'no_cross_frame_session' });
          return true;
        }
        safeTabSendMessage(
          tabId,
          {
            action: 'superDragCompassFromIframe',
            data: message.data,
            _crossFrameToken: message._crossFrameToken,
            _fromFrameId: senderFrameId(sender)
          },
          false,
          0
        );
        sendResponse({ success: true });
        return true;

      case 'superDragCompassHide':
        if (!isTopFrameSender(sender) && !requireCrossFrameForward(sender, message)) {
          sendResponse({ success: false, error: 'no_cross_frame_session' });
          return true;
        }
        safeTabSendMessage(tabId, { action: 'superDragCompassHide' }, false, 0);
        sendResponse({ success: true });
        return true;

      case 'tryNavigateToNextPageInMainFrame':
        if (!requireCrossFrameForward(sender, message)) {
          sendResponse({ success: false, error: 'no_cross_frame_session' });
          return true;
        }
        safeTabSendMessage(tabId, { action: 'tryNavigateToNextPage' }, false, 0);
        sendResponse({ success: true });
        return true;

      case 'getScreenshotPreview': {
        const previewKey = message.key && String(message.key);
        if (!previewKey) {
          sendResponse({ success: false, error: 'no_key' });
          return true;
        }
        loadPreviewImage(previewKey)
          .then((dataUrl) => {
            if (dataUrl) {
              sendResponse({ success: true, dataUrl });
              return;
            }
            chrome.storage.session.get(previewKey, (items) => {
              const url = items && items[previewKey];
              sendResponse({ success: !!url, dataUrl: url || '' });
            });
          })
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'load_failed'
            });
          });
        return true;
      }

      case 'clearScreenshotPreview': {
        const clearKey = message.key && String(message.key);
        if (clearKey && clearKey.indexOf('screenshotHist_') !== 0) {
          removePreviewImage(clearKey).catch(() => {});
          chrome.storage.session.remove(clearKey);
        }
        sendResponse({ success: true });
        return true;
      }

      case 'screenshotPreviewUpload': {
        if (!requireScreenshotLeaseFromContentScript(sender, message, sendResponse)) {
          return true;
        }
        const uploadKey = message.key && String(message.key);
        const uploadUrl = typeof message.dataUrl === 'string' ? message.dataUrl : '';
        if (!uploadKey || !uploadUrl) {
          sendResponse({ success: false, error: 'no_image' });
          return true;
        }
        if (isContentScriptSender(sender) && !isAllowedScreenshotDataUrl(uploadUrl)) {
          sendResponse({ success: false, error: 'invalid_image' });
          return true;
        }
        const uploadW = Math.max(1, message.width | 0);
        const uploadH = Math.max(1, message.height | 0);
        persistPreviewImage(uploadKey, uploadUrl, uploadW, uploadH)
          .then(() => {
            openScreenshotPreviewWindowWithData(uploadUrl, {
              key: uploadKey,
              width: uploadW,
              height: uploadH,
              skipPersist: true,
              sourceTabId: sender.tab && sender.tab.id,
              captureMode: message.captureMode,
              pageUrl: message.pageUrl,
              pageTitle: message.pageTitle
            }, sendResponse);
          })
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'preview_persist_failed'
            });
          });
        return true;
      }

      case 'screenshotPreviewChunk': {
        if (!requireScreenshotLeaseFromContentScript(sender, message, sendResponse)) {
          return true;
        }
        appendPreviewImageChunk(message)
          .then((result) => {
            if (!result.complete) {
              sendResponse({ success: true });
              return;
            }
            const chunkKey = message.key && String(message.key);
            openScreenshotPreviewWindowWithData(result.dataUrl, {
              key: chunkKey,
              width: result.width,
              height: result.height,
              skipPersist: true,
              sourceTabId: sender.tab && sender.tab.id,
              captureMode: message.captureMode,
              pageUrl: message.pageUrl,
              pageTitle: message.pageTitle
            }, sendResponse);
          })
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'invalid_chunk'
            });
          });
        return true;
      }

      case 'openScreenshotPreview': {
        const previewSourceTabId =
          message.sourceTabId != null
            ? message.sourceTabId
            : sender.tab && sender.tab.id;
        if (isContentScriptSender(sender)) {
          const previewFrameId = senderFrameId(sender);
          if (!validateScreenshotCaptureLease(previewSourceTabId, previewFrameId, message._screenshotLease)) {
            sendResponse({ success: false, error: 'no_screenshot_lease' });
            return true;
          }
        }
        if (message.dataUrl && typeof message.dataUrl === 'string') {
          if (!isAllowedScreenshotDataUrl(message.dataUrl)) {
            sendResponse({ success: false, error: 'invalid_image' });
            return true;
          }
        }
        const previewMeta = {
          captureMode: message.captureMode,
          pageUrl: message.pageUrl,
          pageTitle: message.pageTitle,
          skipHistory: message.skipHistory === true
        };
        if (message.dataUrl && typeof message.dataUrl === 'string') {
          openScreenshotPreviewWindowWithData(message.dataUrl, {
            key: message.key,
            width: message.width,
            height: message.height,
            sourceTabId: previewSourceTabId,
            ...previewMeta
          }, sendResponse);
        } else if (message.key) {
          const loadKey = String(message.key);
          const openFromHistory = loadKey.indexOf('screenshotHist_') === 0;
          const openOpts = {
            key: loadKey,
            width: message.width,
            height: message.height,
            sourceTabId: previewSourceTabId,
            skipPersist: openFromHistory,
            ...previewMeta,
            skipHistory: openFromHistory || previewMeta.skipHistory
          };
          loadPreviewImage(loadKey)
            .then((idbUrl) => {
              if (idbUrl) {
                openScreenshotPreviewWindowWithData(idbUrl, openOpts, sendResponse);
                return;
              }
              chrome.storage.session.get(loadKey, (items) => {
                const dataUrl = items && items[loadKey];
                if (!dataUrl) {
                  sendResponse({ success: false, error: 'no_image' });
                  return;
                }
                openScreenshotPreviewWindowWithData(dataUrl, openOpts, sendResponse);
              });
            })
            .catch(() => {
              sendResponse({ success: false, error: 'load_failed' });
            });
        } else {
          sendResponse({ success: false, error: 'no_image' });
        }
        return true;
      }

      case 'recordScreenshotHistory': {
        const histTabId = sender.tab && sender.tab.id;
        const histFrameId = senderFrameId(sender);
        const histUrl = typeof message.dataUrl === 'string' ? message.dataUrl : '';
        if (!isAllowedScreenshotDataUrl(histUrl)) {
          sendResponse({ success: false, error: 'invalid_image' });
          return true;
        }
        if (!validateScreenshotCaptureLease(histTabId, histFrameId, message._screenshotLease)) {
          sendResponse({ success: false, error: 'no_screenshot_lease' });
          return true;
        }
        addScreenshotHistoryEntry({
          dataUrl: histUrl,
          width: message.width,
          height: message.height,
          captureMode: message.captureMode,
          pageUrl: message.pageUrl,
          pageTitle: message.pageTitle,
          sourceTabId: isContentScriptSender(sender)
            ? sender.tab && sender.tab.id
            : message.sourceTabId != null
              ? message.sourceTabId
              : sender.tab && sender.tab.id
        })
          .then((r) => sendResponse(r && r.skipped ? { success: true, skipped: true } : { success: true }))
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'history_failed'
            });
          });
        return true;
      }

      case 'listScreenshotHistory': {
        listScreenshotHistory(message.limit)
          .then((items) => sendResponse({ success: true, items }))
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'list_failed'
            });
          });
        return true;
      }

      case 'getScreenshotHistoryItem': {
        getScreenshotHistoryImage(message.id)
          .then((item) => {
            if (!item) {
              sendResponse({ success: false, error: 'not_found' });
              return;
            }
            sendResponse({ success: true, item });
          })
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'load_failed'
            });
          });
        return true;
      }

      case 'removeScreenshotHistoryItem': {
        removeScreenshotHistoryEntry(message.id)
          .then(() => sendResponse({ success: true }))
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'remove_failed'
            });
          });
        return true;
      }

      case 'clearScreenshotHistory': {
        clearScreenshotHistory()
          .then(() => sendResponse({ success: true }))
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'clear_failed'
            });
          });
        return true;
      }

      case 'trimScreenshotHistory': {
        trimScreenshotHistoryToLimit(message.maxCount)
          .then((r) => sendResponse(r || { success: true }))
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'trim_failed'
            });
          });
        return true;
      }

      case 'openScreenshotHistoryItem': {
        const histId = message.id && String(message.id);
        if (!histId) {
          sendResponse({ success: false, error: 'no_id' });
          return true;
        }
        getScreenshotHistoryImage(histId)
          .then(async (item) => {
            if (!item || !item.dataUrl) {
              sendResponse({ success: false, error: 'no_image' });
              return;
            }
            const previewKey = item.imageKey;
            const sourceTabId = await resolveSourceTabIdForHistoryItem(item);
            const sessionPatch = {};
            sessionPatch[previewKey] = item.dataUrl;
            chrome.storage.session.set(sessionPatch, () => {
              openScreenshotPreviewWindowWithData(
                item.dataUrl,
                {
                  key: previewKey,
                  width: item.width,
                  height: item.height,
                  skipPersist: true,
                  skipHistory: true,
                  sourceTabId: sourceTabId != null ? sourceTabId : undefined,
                  pageUrl: item.pageUrl,
                  pageTitle: item.pageTitle
                },
                sendResponse
              );
            });
          })
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'load_failed'
            });
          });
        return true;
      }

      case 'pinScreenshotHistoryItem': {
        const histId = message.id && String(message.id);
        if (!histId) {
          sendResponse({ success: false, error: 'no_id' });
          return true;
        }
        getScreenshotHistoryImage(histId)
          .then(async (item) => {
            if (!item || !item.dataUrl) {
              sendResponse({ success: false, error: 'no_image' });
              return;
            }
            const tabId = await resolvePinTargetTabId(
              { pageUrl: item.pageUrl || '' },
              sender
            );
            if (tabId == null) {
              sendResponse({ success: false, error: 'no_tab' });
              return;
            }
            const result = await deliverScreenshotPinToTab(tabId, {
              dataUrl: item.dataUrl,
              width: item.width,
              height: item.height
            });
            sendResponse(result || { success: true });
          })
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'pin_failed'
            });
          });
        return true;
      }

      case 'openScreenshotHistory': {
        const historyUrl = chrome.runtime.getURL('screenshot-history.html');
        (async () => {
          try {
            const existingWinId = await focusExistingScreenshotHistoryWindow();
            if (existingWinId != null) {
              sendResponse({
                success: true,
                windowId: existingWinId,
                focusedExisting: true
              });
              return;
            }
          } catch (e) {}
          chrome.windows.create(
            {
              url: historyUrl,
              type: 'popup',
              width: 920,
              height: 680,
              focused: true
            },
            (win) => {
              if (chrome.runtime.lastError || !win) {
                sendResponse({
                  success: false,
                  error:
                    (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
                    'create_failed'
                });
              } else {
                sendResponse({ success: true, windowId: win.id });
              }
            }
          );
        })();
        return true;
      }

      case 'screenshotPinUpload': {
        const pinKey = message.key && String(message.key);
        const pinUrl = typeof message.dataUrl === 'string' ? message.dataUrl : '';
        if (!pinKey || !pinUrl || !isAllowedScreenshotDataUrl(pinUrl)) {
          sendResponse({ success: false, error: pinKey ? 'invalid_image' : 'no_image' });
          return true;
        }
        persistPreviewImage(
          pinKey,
          pinUrl,
          Math.max(1, message.width | 0),
          Math.max(1, message.height | 0)
        )
          .then(() => sendResponse({ success: true, key: pinKey }))
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'pin_persist_failed'
            });
          });
        return true;
      }

      case 'screenshotPinChunk': {
        appendPreviewImageChunk(message)
          .then(async (result) => {
            if (!result.complete) {
              sendResponse({ success: true });
              return;
            }
            const tabId = await resolvePinTargetTabId(message, sender);
            if (tabId == null) {
              sendResponse({ success: false, error: 'no_tab' });
              return;
            }
            const pinResult = await deliverScreenshotPinToTab(tabId, {
              dataUrl: result.dataUrl,
              width: result.width,
              height: result.height,
              title: message.title,
              closeTitle: message.closeTitle,
              resizeTitle: message.resizeTitle
            });
            sendResponse(pinResult || { success: true });
          })
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'invalid_chunk'
            });
          });
        return true;
      }

      case 'listPageScreenshotPins': {
        const resolved = resolvePinScopeFromSender(message, sender);
        if (resolved.error) {
          sendResponse({ success: false, error: resolved.error });
          return true;
        }
        listPageScreenshotPins(resolved.scope)
          .then((pins) => sendResponse({ success: true, pins, pageScopeKey: resolved.scope }))
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'list_pins_failed'
            });
          });
        return true;
      }

      case 'savePageScreenshotPin': {
        const resolved = resolvePinScopeFromSender(message, sender);
        if (resolved.error) {
          sendResponse({ success: false, error: resolved.error });
          return true;
        }
        if (message.dataUrl && !isAllowedScreenshotDataUrl(message.dataUrl)) {
          sendResponse({ success: false, error: 'invalid_image' });
          return true;
        }
        const scope = resolved.scope;
        const pinId = message.pin && message.pin.id;
        const runSave = () => savePageScreenshotPin(scope, message.pin, message.dataUrl);
        const savePromise = enqueuePagePinSave(scope + '::' + pinId, runSave);
        savePromise
          .then((r) => sendResponse(r || { success: true }))
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'save_pin_failed'
            });
          });
        return true;
      }

      case 'removePageScreenshotPin': {
        const resolved = resolvePinScopeFromSender(message, sender);
        if (resolved.error) {
          sendResponse({ success: false, error: resolved.error });
          return true;
        }
        removePageScreenshotPin(resolved.scope, message.pinId)
          .then(() => sendResponse({ success: true }))
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'remove_pin_failed'
            });
          });
        return true;
      }

      case 'clearPageScreenshotPins': {
        const resolved = resolvePinScopeFromSender(message, sender);
        if (resolved.error) {
          sendResponse({ success: false, error: resolved.error });
          return true;
        }
        clearPageScreenshotPins(resolved.scope)
          .then(() => sendResponse({ success: true }))
          .catch((err) => {
            sendResponse({
              success: false,
              error: (err && err.message) || 'clear_pins_failed'
            });
          });
        return true;
      }

      case 'pinScreenshotToPage': {
        (async () => {
          try {
            const tabId = await resolvePinTargetTabId(message, sender);
            if (tabId == null) {
              sendResponse({ success: false, error: 'no_tab' });
              return;
            }
            let dataUrl = typeof message.dataUrl === 'string' ? message.dataUrl : '';
            const imageKey = message.key && String(message.key);
            if (!dataUrl && imageKey) {
              dataUrl = await loadPreviewImage(imageKey);
            }
            if (!dataUrl) {
              sendResponse({ success: false, error: 'no_image' });
              return;
            }
            if (!isAllowedScreenshotDataUrl(dataUrl)) {
              sendResponse({ success: false, error: 'invalid_image' });
              return;
            }
            const result = await deliverScreenshotPinToTab(tabId, {
              dataUrl,
              width: message.width,
              height: message.height,
              x: message.x,
              y: message.y,
              title: message.title,
              closeTitle: message.closeTitle,
              resizeTitle: message.resizeTitle
            });
            sendResponse(result || { success: true });
          } catch (err) {
            sendResponse({
              success: false,
              error: (err && err.message) || 'pin_failed'
            });
          }
        })();
        return true;
      }

      case 'registerCrossFrameSession': {
        sendResponse({ success: false, error: 'use_requestCrossFrameSession' });
        return true;
      }

      case 'requestCrossFrameSession': {
        const cfTabId = sender.tab && sender.tab.id;
        const cfToken = message.token && String(message.token);
        if (cfTabId == null || !cfToken) {
          sendResponse({ success: false, error: 'invalid_session' });
          return true;
        }
        if (isTopFrameSender(sender)) {
          registerCrossFrameSession(cfTabId, 0, cfToken);
          sendResponse({ success: true });
          return true;
        }
        const childFrameId = senderFrameId(sender);
        safeTabSendMessage(
          cfTabId,
          {
            action: 'vouchCrossFrameSessionRequest',
            token: cfToken,
            childFrameId
          },
          true,
          0
        ).then((topResp) => {
          if (!topResp || topResp.success !== true) {
            sendResponse({
              success: false,
              error: (topResp && topResp.error) || 'vouch_denied'
            });
            return;
          }
          registerCrossFrameSession(cfTabId, childFrameId, cfToken);
          sendResponse({ success: true });
        });
        return true;
      }

      case 'clearCrossFrameSession': {
        const cfTabId = sender.tab && sender.tab.id;
        const cfToken = message.token && String(message.token);
        const cfFrameId =
          message.childFrameId != null ? Number(message.childFrameId) : senderFrameId(sender);
        if (cfTabId != null && cfToken) {
          clearCrossFrameSession(cfTabId, cfFrameId, cfToken);
        }
        sendResponse({ success: true });
        return true;
      }

      case 'acquireScreenshotCaptureLease': {
        const leaseTabId = sender.tab && sender.tab.id;
        const leaseFrameId = senderFrameId(sender);
        if (leaseTabId == null) {
          sendResponse({ success: false, error: 'no_tab' });
          return true;
        }
        if (!isTopFrameSender(sender) && !requireCrossFrameForward(sender, message)) {
          sendResponse({ success: false, error: 'no_cross_frame_session' });
          return true;
        }
        const leaseKey = screenshotLeaseKey(leaseTabId, leaseFrameId);
        const existing = screenshotCaptureLeases.get(leaseKey);
        if (message.prefetch === true) {
          if (existing && Date.now() < existing.expiresAt) {
            sendResponse({ success: true, token: existing.token });
            return true;
          }
          if (!canAcquireLease(screenshotLeaseRate, leaseTabId + ':pf', SCREENSHOT_LEASE_MAX_PER_WINDOW)) {
            sendResponse({ success: false, error: 'lease_rate_limited' });
            return true;
          }
          sendResponse({ success: true, token: issueScreenshotCaptureLease(leaseTabId, leaseFrameId) });
          return true;
        }
        if (!canAcquireLease(screenshotLeaseRate, leaseTabId, SCREENSHOT_LEASE_MAX_PER_WINDOW)) {
          sendResponse({ success: false, error: 'lease_rate_limited' });
          return true;
        }
        sendResponse({ success: true, token: issueScreenshotCaptureLease(leaseTabId, leaseFrameId) });
        return true;
      }

      case 'releaseScreenshotCaptureLease': {
        const releaseTabId = sender.tab && sender.tab.id;
        if (releaseTabId != null && message.token) {
          clearScreenshotCaptureLease(releaseTabId, senderFrameId(sender), message.token);
        }
        sendResponse({ success: true });
        return true;
      }

      case 'acquireSuperDragLease': {
        const dragTabId = sender.tab && sender.tab.id;
        const dragSessionId = message._superDragSessionId && String(message._superDragSessionId);
        if (dragTabId == null) {
          sendResponse({ success: false, error: 'no_tab' });
          return true;
        }
        if (!dragSessionId) {
          sendResponse({ success: false, error: 'no_drag_session' });
          return true;
        }
        if (!isTopFrameSender(sender) && !requireCrossFrameForward(sender, message)) {
          sendResponse({ success: false, error: 'no_cross_frame_session' });
          return true;
        }
        if (!canAcquireLease(superDragLeaseRate, dragTabId, SUPER_DRAG_LEASE_MAX_PER_WINDOW)) {
          sendResponse({ success: false, error: 'lease_rate_limited' });
          return true;
        }
        sendResponse({
          success: true,
          token: issueSuperDragLease(dragTabId, senderFrameId(sender), dragSessionId)
        });
        return true;
      }

      case 'captureVisibleTab': {
        const captureTabId = sender.tab && sender.tab.id;
        const captureFrameId = senderFrameId(sender);
        if (!validateScreenshotCaptureLease(captureTabId, captureFrameId, message._screenshotLease)) {
          sendResponse({ success: false, error: 'no_screenshot_lease' });
          break;
        }
        const wid = sender.tab && sender.tab.windowId;
        if (wid == null) {
          sendResponse({ success: false, error: 'no_window' });
          break;
        }
        chrome.tabs.captureVisibleTab(wid, { format: 'png' }, (dataUrl) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            touchScreenshotCaptureLease(captureTabId, captureFrameId, message._screenshotLease);
            sendResponse({ success: true, dataUrl: dataUrl || '' });
          }
        });
        return true;
      }

      case 'captureRegionFromIframe': {
        if (!requireCrossFrameForward(sender, message)) {
          sendResponse({ success: false, error: 'no_cross_frame_session' });
          return true;
        }
        const captureFromFrameId = senderFrameId(sender);
        safeTabSendMessage(
          tabId,
          {
            action: 'runCaptureRegionFromIframe',
            points: message.points,
            trailPad: message.trailPad,
            iframeLocal: message.iframeLocal !== false,
            _sourceFrameId: captureFromFrameId,
            _sourceUrl: sender.url || '',
            _crossFrameToken: message._crossFrameToken
          },
          true,
          0
        ).then((topResp) => {
          sendResponse(
            topResp && typeof topResp === 'object'
              ? topResp
              : { success: !!topResp, error: topResp ? undefined : 'capture_failed' }
          );
        });
        return true;
      }

      case 'screenshotOverlayHide':
        safeTabSendMessage(tabId, { action: 'screenshotOverlayHideInternal' }, true);
        sendResponse({ success: true });
        return true;

      case 'screenshotOverlayShow':
        safeTabSendMessage(tabId, { action: 'screenshotOverlayShowInternal' }, true);
        sendResponse({ success: true });
        return true;
        
      case 'scrollUp':
      case 'scrollDown':
      case 'scrollLeft':
      case 'scrollRight':
      case 'scrollToTop':
      case 'scrollToBottom':
        if (!isTopFrameSender(sender) && !requireCrossFrameForward(sender, message)) {
          sendResponse({ success: false, error: 'no_cross_frame_session' });
          return true;
        }
        {
          const scrollAction = message.action;
          const scrollPayload =
            scrollAction === 'scrollUp' ||
            scrollAction === 'scrollDown' ||
            scrollAction === 'scrollLeft' ||
            scrollAction === 'scrollRight'
              ? { action: scrollAction, distance: message.distance || 100 }
              : { action: scrollAction };
          safeTabSendMessage(tabId, scrollPayload, false, 0).then((resp) => {
            sendResponse(resp && typeof resp === 'object' ? resp : { success: !!resp });
          });
        }
        return true;
        
      case 'closeTab':
        // 关闭当前标签页
        chrome.tabs.remove(tabId);
        break;
        
      case 'reopenClosedTab': {
        const preferWindowId = sender.tab && sender.tab.windowId;
        chrome.sessions.getRecentlyClosed({ maxResults: 25 }, function(sessions) {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          if (!sessions || !sessions.length) {
            sendResponse({ success: false, error: 'no_closed_tab' });
            return;
          }
          let target = null;
          if (preferWindowId != null) {
            for (let i = 0; i < sessions.length; i++) {
              const s = sessions[i];
              if (s.tab && s.tab.windowId === preferWindowId && s.sessionId) {
                target = s;
                break;
              }
            }
          }
          if (!target) {
            for (let i = 0; i < sessions.length; i++) {
              const s = sessions[i];
              if (s.tab && s.sessionId) {
                target = s;
                break;
              }
            }
          }
          const finishRestore = (restored) => {
            sendResponse({
              success: !chrome.runtime.lastError && restored != null,
              error: chrome.runtime.lastError && chrome.runtime.lastError.message
            });
          };
          if (target && target.sessionId) {
            chrome.sessions.restore(target.sessionId, finishRestore);
          } else {
            chrome.sessions.restore(finishRestore);
          }
        });
        return true;
      }
        
      case 'openNewTab':
        // 打开空白新标签页 - 也进行检查是否已有空白标签页
        smartCreateTab(null, true, sender.tab && sender.tab.windowId != null ? sender.tab.windowId : null);
        break;
        
      case 'refresh':
        // 刷新当前页面
        chrome.tabs.reload(tabId);
        break;
        
      case 'forceRefresh':
        // 强制刷新当前页面（忽略缓存）
        chrome.tabs.reload(tabId, { bypassCache: true });
        break;
        
      case 'switchToLeftTab':
        switchToAdjacentTab(tabId, -1, sender.tab && sender.tab.windowId);
        break;
        
      case 'switchToRightTab':
        switchToAdjacentTab(tabId, 1, sender.tab && sender.tab.windowId);
        break;

      case 'switchToPreviousActiveTab':
        switchToPreviousActiveTab(tabId, sender.tab && sender.tab.windowId);
        break;

      case 'goToParentUrl':
      case 'goToRootUrl': {
        const targetUrl = message.url && String(message.url);
        if (isAllowedHttpUrl(targetUrl)) {
          chrome.tabs.update(tabId, { url: targetUrl });
        }
        break;
      }
        
      case 'stopLoading':
        // 停止加载（仅主框架）
        chrome.scripting.executeScript({
          target: { tabId: tabId, frameIds: [0] },
          func: () => { window.stop(); }
        }).then(result => {
          console.log('页面加载已停止');
        }).catch(error => {
          console.error('停止页面加载时出错:', error.message);
          safeTabSendMessage(tabId, { action: 'stopLoadingInternal' }, false, 0);
        });
        break;
        
      case 'closeAllTabs':
        closeAllTabs(tabId, sender.tab && sender.tab.windowId);
        break;
        
      case 'newWindow':
        // 省略 URL，让 Chrome / Edge / Vivaldi / Firefox 各自打开原生新标签页。
        chrome.windows.create({ focused: true });
        break;
        
      case 'newInPrivateWindow':
        // 新建隐私窗口
        chrome.windows.create({ incognito: true, focused: true });
        break;
        
      case 'closeOtherTabs':
        // 关闭其他标签页
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
            const tabsToClose = tabs.filter(t => t.id !== tabId);
            if (tabsToClose.length > 0) {
              chrome.tabs.remove(tabsToClose.map(t => t.id));
            }
          });
        });
        break;
        
      case 'closeTabsToRight':
        // 关闭右侧标签页
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
            const currentTabIndex = tabs.findIndex(t => t.id === tabId);
            const tabsToClose = tabs.filter((t, index) => index > currentTabIndex);
            if (tabsToClose.length > 0) {
              chrome.tabs.remove(tabsToClose.map(t => t.id));
            }
          });
        });
        break;
        
      case 'zoomIn':
        adjustTabZoom(tabId, 1.1);
        break;

      case 'zoomOut':
        adjustTabZoom(tabId, 1 / 1.1);
        break;

      case 'toggleFullscreen':
        // 切换全屏
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.windows.get(tab.windowId, (window) => {
            if (chrome.runtime.lastError) {
              console.log('获取窗口信息错误:', chrome.runtime.lastError.message);
              return;
            }
            chrome.windows.update(tab.windowId, {
              state: window.state === 'fullscreen' ? 'normal' : 'fullscreen'
            });
          });
        });
        break;
        
      case 'closeTabsToLeft':
        // 关闭左侧标签页
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
            const currentTabIndex = tabs.findIndex(t => t.id === tabId);
            const tabsToClose = tabs.filter((t, index) => index < currentTabIndex);
            if (tabsToClose.length > 0) {
              chrome.tabs.remove(tabsToClose.map(t => t.id));
            }
          });
        });
        break;
        
      case 'reloadAllTabs':
        // 全部重新加载
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
            tabs.forEach(t => {
              // 跳过特殊页面（如chrome://页面）
              if (t.url && !isRestrictedBrowserUrl(t.url)) {
                chrome.tabs.reload(t.id);
              }
            });
          });
        });
        break;

      case 'stopLoadingAllTabs': {
        // 停止当前窗口内所有可注入页面的标签页载入
        const canStopLoadingUrl = (u) => !!u && !isRestrictedBrowserUrl(u);
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError || !tab) return;
          chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
            if (chrome.runtime.lastError || !tabs) return;
            tabs.forEach((t) => {
              const u = t.url || t.pendingUrl || '';
              if (!t.id || !canStopLoadingUrl(u)) return;
              chrome.scripting.executeScript({
                target: { tabId: t.id },
                func: () => { window.stop(); }
              }).catch(() => {
                safeTabSendMessage(t.id, { action: 'stopLoadingInternal' });
              });
            });
          });
        });
        break;
      }
        
      case 'togglePinTab':
        // 固定/取消固定标签页
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.tabs.update(tabId, { pinned: !tab.pinned });
        });
        break;
        
      case 'toggleMuteTab':
        // 静音/取消静音标签页
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.tabs.update(tabId, { muted: !tab.mutedInfo.muted });
        });
        break;
        
      case 'muteOtherTabs':
        // 静音其他标签页
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
            tabs.forEach(t => {
              if (t.id !== tabId) {
                chrome.tabs.update(t.id, { muted: true });
              }
            });
          });
        });
        break;
        
      case 'toggleMaximize':
        // 最大化/还原窗口
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.windows.get(tab.windowId, (window) => {
            if (chrome.runtime.lastError) {
              console.log('获取窗口信息错误:', chrome.runtime.lastError.message);
              return;
            }
            chrome.windows.update(tab.windowId, {
              state: window.state === 'maximized' ? 'normal' : 'maximized'
            });
          });
        });
        break;
        
      case 'minimizeWindow':
        // 最小化窗口
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.windows.update(tab.windowId, { state: 'minimized' });
        });
        break;
        
      case 'superDrag':
        if (
          !consumeSuperDragLease(
            sender.tab && sender.tab.id,
            sender,
            message._superDragLease,
            message._superDragSessionId
          )
        ) {
          sendResponse({ success: false, error: 'no_super_drag_lease' });
          return true;
        }
        handleSuperDrag(message, sender)
          .then((ok) => sendResponse({ success: ok !== false }))
          .catch(() => sendResponse({ success: false, error: 'super_drag_failed' }));
        return true;
      
      // 在后台打开标签页（须携带 superDrag lease，供遗留调用；拖拽应走 superDrag）
      case 'openTabInBackground':
        if (
          !consumeSuperDragLease(
            sender.tab && sender.tab.id,
            sender,
            message._superDragLease,
            message._superDragSessionId
          )
        ) {
          sendResponse({ success: false, error: 'no_super_drag_lease' });
          return true;
        }
        if (!message.url || !isAllowedHttpUrl(message.url)) {
          sendResponse({ success: false, error: 'invalid_url' });
          return true;
        }
        smartCreateTab(message.url, false, sender.tab && sender.tab.windowId != null ? sender.tab.windowId : null);
        sendResponse({ success: true });
        return true;

      // 拖拽图片或可下载文件时自动下载（须携带 superDrag lease）
      case 'downloadUrl':
        if (
          !consumeSuperDragLease(
            sender.tab && sender.tab.id,
            sender,
            message._superDragLease,
            message._superDragSessionId
          )
        ) {
          sendResponse({ success: false, error: 'no_super_drag_lease' });
          return true;
        }
        if (message.url && isAllowedHttpUrl(message.url)) {
          try {
            chrome.downloads.download({ url: message.url }, (downloadId) => {
              if (chrome.runtime.lastError) {
                console.warn('下载失败:', chrome.runtime.lastError.message);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
              } else {
                sendResponse({ success: true });
              }
            });
          } catch (e) {
            console.warn('下载请求异常:', e.message);
            sendResponse({ success: false, error: e.message });
          }
        } else {
          sendResponse({ success: false, error: 'URL 为空' });
        }
        return true; // 异步响应
        
      case 'openInNewTab':
        if (!message.url || !isAllowedHttpUrl(message.url)) {
          sendResponse({ success: false, error: 'invalid_url' });
          return true;
        }
        // 使用统一的标签页创建函数
        createTabWithRecentIndex(
          message.url,
          true,
          sender.tab && sender.tab.windowId != null ? sender.tab.windowId : null
        )
          .then(() => {
            sendResponse({ success: true });
          })
          .catch(e => {
            console.error('在新标签页中打开URL错误:', e.message);
            sendResponse({ success: false, error: e.message });
          });
        return true;
        
      case 'scrollToLeft':
        if (!isTopFrameSender(sender) && !requireCrossFrameForward(sender, message)) {
          sendResponse({ success: false, error: 'no_cross_frame_session' });
          return true;
        }
        safeTabSendMessage(sender.tab.id, { action: 'scrollToLeft' }, false, 0).then((resp) => {
          sendResponse(resp || { success: true });
        });
        return true;

      case 'scrollToRight':
        if (!isTopFrameSender(sender) && !requireCrossFrameForward(sender, message)) {
          sendResponse({ success: false, error: 'no_cross_frame_session' });
          return true;
        }
        safeTabSendMessage(sender.tab.id, { action: 'scrollToRight' }, false, 0).then((resp) => {
          sendResponse(resp || { success: true });
        });
        return true;

      case 'splitViewScroll':
        // 分屏滚动同步：纵向 + 横向比例转发给配对标签页
        {
          const fromTabId = sender?.tab?.id;
          const pairedTabId = fromTabId != null ? getSplitScrollPairTabId(fromTabId) : null;
          const hasY = message.scrollRatio != null;
          const hasX = message.scrollRatioX != null;
          if (pairedTabId != null && (hasY || hasX)) {
            const ry = hasY ? Number(message.scrollRatio) : null;
            const rx = hasX ? Number(message.scrollRatioX) : null;
            const validY = ry != null && ry >= 0 && ry <= 1;
            const validX = rx != null && rx >= 0 && rx <= 1;
            if (validY || validX) {
              chrome.tabs.sendMessage(pairedTabId, {
                action: 'syncScrollTo',
                scrollRatio: validY ? ry : undefined,
                scrollRatioX: validX ? rx : undefined
              }, { frameId: 0 });
            }
          }
        }
        sendResponse({ success: true });
        return true;

      case 'closeDuplicateTabs':
        handleCloseDuplicateTabs(message, sender, sendResponse);
        return true;

      case 'ignoreDuplicateTabs':
        handleIgnoreDuplicateTabs(message, sender, sendResponse);
        return true;

      default:
        console.log('未知消息类型:', message.action);
        sendResponse({ success: false, error: '未知消息类型' });
        return true;
    }
    
    // 如果没有在case中发送响应，这里发送默认响应
    if (
      message.action !== 'ping' &&
      message.action !== 'superDrag' &&
      message.action !== 'captureVisibleTab' &&
      message.action !== 'openScreenshotPreview' &&
      message.action !== 'getScreenshotPreview' &&
      message.action !== 'screenshotPreviewUpload' &&
      message.action !== 'screenshotPreviewChunk' &&
      message.action !== 'screenshotPinUpload' &&
      message.action !== 'pinScreenshotToPage' &&
      message.action !== 'screenshotPinChunk' &&
      message.action !== 'recordScreenshotHistory' &&
      message.action !== 'listScreenshotHistory' &&
      message.action !== 'getScreenshotHistoryItem' &&
      message.action !== 'removeScreenshotHistoryItem' &&
      message.action !== 'clearScreenshotHistory' &&
      message.action !== 'trimScreenshotHistory' &&
      message.action !== 'openScreenshotHistory' &&
      message.action !== 'openScreenshotHistoryItem' &&
      message.action !== 'pinScreenshotHistoryItem' &&
      message.action !== 'listPageScreenshotPins' &&
      message.action !== 'savePageScreenshotPin' &&
      message.action !== 'removePageScreenshotPin' &&
      message.action !== 'clearPageScreenshotPins' &&
      message.action !== 'closeDuplicateTabs' &&
      message.action !== 'ignoreDuplicateTabs' &&
      message.action !== 'acquireScreenshotCaptureLease' &&
      message.action !== 'releaseScreenshotCaptureLease' &&
      message.action !== 'acquireSuperDragLease' &&
      message.action !== 'requestCrossFrameSession' &&
      message.action !== 'captureRegionFromIframe' &&
      message.action !== 'screenshotOverlayHide' &&
      message.action !== 'screenshotOverlayShow' &&
      message.action !== 'getContentContext' &&
      message.action !== 'gestureCompleteHandoffRequest' &&
      message.action !== 'relayTopFrameGestureAction' &&
      message.action !== 'gestureHintFromIframe' &&
      message.action !== 'superDragCompassFromIframe' &&
      message.action !== 'superDragCompassHide' &&
      message.action !== 'gestureTrailFromIframe' &&
      message.action !== 'tryNavigateToNextPageInMainFrame' &&
      message.action !== 'reopenClosedTab' &&
      message.action !== 'scrollUp' &&
      message.action !== 'scrollDown' &&
      message.action !== 'scrollLeft' &&
      message.action !== 'scrollRight' &&
      message.action !== 'scrollToTop' &&
      message.action !== 'scrollToBottom' &&
      message.action !== 'scrollToLeft' &&
      message.action !== 'scrollToRight'
    ) {
      sendResponse({ success: true });
    }
  } catch (e) {
    console.error('处理消息错误:', e.message);
    sendResponse({ success: false, error: e.message });
  }
  
  return true;
});

// 安全地向标签页发送消息
// frameId: 可选，0=主框架。不传则发送到所有 frame
function safeTabSendMessage(tabId, message, silent = false, frameId = null) {
  if (!tabId) return Promise.resolve(false);
  
  return new Promise((resolve) => {
    try {
      // 首先检查标签页是否有效
      chrome.tabs.get(tabId, (tab) => {
        // 如果标签页不存在
        if (chrome.runtime.lastError) {
          if (!silent) {
            console.log('目标标签页不存在:', chrome.runtime.lastError.message);
          }
          resolve(false);
          return;
        }
        
        // 检查URL是否是Chrome内部页面
        if (tab.url && isRestrictedBrowserUrl(tab.url)) {
          if (!silent) {
            console.log('无法向Chrome内部页面发送消息:', tab.url);
          }
          resolve(false);
          return;
        }
        
        // 然后尝试发送消息
        const callback = (response) => {
          if (chrome.runtime.lastError) {
            if (!silent) {
              console.log('发送消息时出错:', chrome.runtime.lastError.message);
            }
            resolve(false);
          } else {
            resolve(response || true);
          }
        };
        if (frameId !== null && frameId !== undefined) {
          chrome.tabs.sendMessage(tabId, message, { frameId }, callback);
        } else {
          chrome.tabs.sendMessage(tabId, message, callback);
        }
      });
    } catch (e) {
      if (!silent) {
        console.error('向标签页发送消息异常:', e.message);
      }
      resolve(false);
    }
  });
}

// 切换到相邻标签页
// windowId -> [tabId, tabId, ...]  按访问时间倒序，最近访问的在最前
const tabHistoryByWindow = new Map();
// windowId -> targetTabId。只忽略“切换到上一个活动标签页”本次程序触发的目标激活，
// 防止把目标标签重新移动到历史栈顶部，否则连续触发时会在两个标签之间来回跳。
const previousActiveSwitchTargetByWindow = new Map();

function normalizePreviousActiveHistory(history, openTabIds = null) {
  const normalized = [];
  const seen = new Set();
  const source = Array.isArray(history) ? history : [];

  for (const tabId of source) {
    if (tabId == null || seen.has(tabId)) continue;
    if (openTabIds && !openTabIds.has(tabId)) continue;
    seen.add(tabId);
    normalized.push(tabId);
    if (normalized.length >= 99) break;
  }

  return normalized;
}

function recordActiveTabSwitch(windowId, tabId) {
  if (windowId == null || tabId == null) return;

  // 如果是“上一个活动标签页”动作触发的目标激活，保持历史栈原顺序。
  const pendingTargetTabId = previousActiveSwitchTargetByWindow.get(windowId);
  if (pendingTargetTabId != null) {
    previousActiveSwitchTargetByWindow.delete(windowId);
    if (pendingTargetTabId === tabId) {
      return;
    }
  }

  let history = normalizePreviousActiveHistory(tabHistoryByWindow.get(windowId));

  // 如果栈顶已经是当前标签，忽略
  if (history[0] === tabId) {
    tabHistoryByWindow.set(windowId, history);
    return;
  }

  // 将新标签移到最前面（MRU）。如果已存在，先移除旧位置避免重复
  const idx = history.indexOf(tabId);
  if (idx !== -1) {
    history.splice(idx, 1);
  }
  history.unshift(tabId);

  // 限制历史长度，防止无限增长
  if (history.length > 99) {
    history = history.slice(0, 99);
  }

  tabHistoryByWindow.set(windowId, history);
}

function purgePreviousActiveTabReference(tabId) {
  if (tabId == null) return;
  for (const [winId, history] of tabHistoryByWindow.entries()) {
    const filtered = history.filter((id) => id !== tabId);
    if (filtered.length !== history.length) {
      tabHistoryByWindow.set(winId, filtered);
    }
    if (previousActiveSwitchTargetByWindow.get(winId) === tabId) {
      previousActiveSwitchTargetByWindow.delete(winId);
    }
  }
}

function switchToPreviousActiveTab(currentTabId, windowId) {
  (async () => {
    try {
      let winId = windowId;

      if (winId == null || currentTabId == null) {
        let tab = currentTabId != null ? await getOpenTab(currentTabId) : null;
        if (!tab) {
          const activeTabs = await chrome.tabs.query(
            winId != null
              ? { windowId: winId, active: true }
              : { active: true, lastFocusedWindow: true }
          );
          tab = activeTabs && activeTabs[0];
        }
        if (!tab || tab.id == null || tab.windowId == null) return;
        currentTabId = tab.id;
        winId = tab.windowId;
      }

      const tabs = await chrome.tabs.query({ windowId: winId });
      const openTabIds = new Set(tabs.map((tab) => tab.id).filter((id) => id != null));
      if (!openTabIds.has(currentTabId)) return;

      let history = normalizePreviousActiveHistory(tabHistoryByWindow.get(winId), openTabIds);
      const tabsByLastAccessed = tabs
        .filter((tab) => tab && tab.id != null)
        .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
        .map((tab) => tab.id);

      // Service Worker 重启或首次使用时，内存历史可能为空/不完整。
      // 用浏览器 lastAccessed 做一次快照，然后在后续程序切换中保持该快照顺序不变。
      if (history.length === 0 || !history.includes(currentTabId) || (history.length < 2 && tabsByLastAccessed.length > history.length)) {
        const bootstrapped = [];
        bootstrapped.push(currentTabId);
        for (const tabId of tabsByLastAccessed) {
          if (!bootstrapped.includes(tabId)) bootstrapped.push(tabId);
        }
        for (const tabId of history) {
          if (!bootstrapped.includes(tabId)) bootstrapped.push(tabId);
        }
        history = bootstrapped.slice(0, 99);
      }

      const findOlderTarget = () => {
        const currentIdx = history.indexOf(currentTabId);
        if (currentIdx === -1) return null;
        for (let i = currentIdx + 1; i < history.length; i++) {
          const candidateTabId = history[i];
          if (candidateTabId !== currentTabId && openTabIds.has(candidateTabId)) {
            return candidateTabId;
          }
        }
        return null;
      };

      // 在历史中找到当前标签的位置，然后往后（时间更早的方向）找第一个不同的标签
      let targetTabId = findOlderTarget();

      // 如果现有历史已经走到末尾，但浏览器快照里还有未合并的标签，
      // 只追加到末尾继续找，不重新排序，避免又跳回刚离开的标签。
      if (targetTabId == null && history.length < tabsByLastAccessed.length) {
        const seen = new Set(history);
        for (const tabId of tabsByLastAccessed) {
          if (!seen.has(tabId)) {
            history.push(tabId);
            seen.add(tabId);
          }
        }
        history = history.slice(0, 99);
        targetTabId = findOlderTarget();
      }

      tabHistoryByWindow.set(winId, history);
      if (targetTabId == null) return;

      // 只忽略即将激活的目标标签；如果期间用户切到了别的标签，仍按真实用户行为记录。
      previousActiveSwitchTargetByWindow.set(winId, targetTabId);
      try {
        await chrome.tabs.update(targetTabId, { active: true });
      } catch (e) {
        if (previousActiveSwitchTargetByWindow.get(winId) === targetTabId) {
          previousActiveSwitchTargetByWindow.delete(winId);
        }
        throw e;
      }
    } catch (e) {
      console.error('切换到上一个活动标签页错误:', e.message);
    }
  })();
}

function switchToAdjacentTab(currentTabId, offset, windowId) {
  (async () => {
    try {
      let winId = windowId;
      if (winId == null) {
        const tab = await chrome.tabs.get(currentTabId);
        winId = tab.windowId;
      }
      const tabs = await chrome.tabs.query({ windowId: winId });
      if (tabs.length <= 1) return;

      let currentIndex = -1;
      for (let i = 0; i < tabs.length; i++) {
        if (tabs[i].id === currentTabId) {
          currentIndex = i;
          break;
        }
      }
      if (currentIndex === -1) return;

      let targetIndex = (currentIndex + offset) % tabs.length;
      if (targetIndex < 0) targetIndex = tabs.length - 1;

      const targetTabId = tabs[targetIndex].id;
      await chrome.tabs.update(targetTabId, { active: true });
    } catch (e) {
      console.error('切换标签页错误:', e.message);
    }
  })();
}

// 关闭所有标签页（保留当前标签页）
function closeAllTabs(currentTabId, windowId) {
  (async () => {
    try {
      let winId = windowId;
      if (winId == null) {
        const tab = await chrome.tabs.get(currentTabId);
        winId = tab.windowId;
      }
      const tabs = await chrome.tabs.query({ windowId: winId });
      const toRemove = tabs.filter((t) => t.id !== currentTabId).map((t) => t.id);
      if (toRemove.length > 0) {
        await chrome.tabs.remove(toRemove);
      }
    } catch (e) {
      console.error('关闭所有标签页错误:', e.message);
    }
  })();
}

const DEFAULT_DRAG_SEARCH_ENGINE = 'https://www.google.com/search?q={q}';

function resolveDragSearchEngineUrl(settings, direction) {
  const keyByDir = {
    up: 'dragUpSearchEngine',
    upRight: 'dragUpRightSearchEngine',
    right: 'dragRightSearchEngine',
    downRight: 'dragDownRightSearchEngine',
    down: 'dragDownSearchEngine',
    downLeft: 'dragDownLeftSearchEngine',
    left: 'dragLeftSearchEngine',
    upLeft: 'dragUpLeftSearchEngine'
  };
  const key = keyByDir[direction];
  let perDir = '';
  if (key && settings[key] != null) perDir = String(settings[key]).trim();
  const fallback = (settings.dragSearchEngine && String(settings.dragSearchEngine).trim()) || DEFAULT_DRAG_SEARCH_ENGINE;
  return perDir || fallback;
}

// 处理超级拖拽
function handleSuperDrag(message, sender) {
  return new Promise((resolve) => {
    try {
      const sourceWindowId = sender?.tab?.windowId;
      const sourceTabId = sender?.tab?.id;

      chrome.storage.sync.get({
        dragSearchEngine: DEFAULT_DRAG_SEARCH_ENGINE,
        dragUpSearchEngine: '',
        dragUpRightSearchEngine: '',
        dragRightSearchEngine: '',
        dragDownRightSearchEngine: '',
        dragDownSearchEngine: '',
        dragDownLeftSearchEngine: '',
        dragLeftSearchEngine: '',
        dragUpLeftSearchEngine: ''
      }, (settings) => {
        try {
          const validDirs = new Set(['up', 'upRight', 'right', 'downRight', 'down', 'downLeft', 'left', 'upLeft']);
          const dragDirection = validDirs.has(message.dragDirection) ? message.dragDirection : 'up';
          let searchEngineUrl = resolveDragSearchEngineUrl(settings, dragDirection);

          let openInForeground;
          if (message.actionType) {
            openInForeground = message.actionType === 'foreground';
          } else {
            openInForeground = false;
          }

          const actionType = message.actionType || (openInForeground ? 'foreground' : 'background');
          const splitDirectionMap = { splitLeft: 'left', splitRight: 'right', splitUp: 'up', splitDown: 'down' };
          const splitDirection = splitDirectionMap[actionType];
          if (actionType === 'popupView') {
            // Popup View must be opened from the content script via window.open so it keeps the
            // same browser small-window behavior as the normal popup-view feature.
            resolve(false);
            return;
          }

          const openInIncognito = (targetUrl) => {
            if (!isAllowedHttpUrl(targetUrl)) {
              resolve(false);
              return;
            }
            chrome.windows.create({ url: targetUrl, incognito: true }, (win) => {
              if (chrome.runtime.lastError) {
                smartCreateTab(targetUrl, true, sourceWindowId);
              }
              resolve(true);
            });
          };

          if (message.type === 'text') {
            const finalSearchUrl = searchEngineUrl.replace('{q}', encodeURIComponent(message.text));
            if (!isAllowedHttpUrl(finalSearchUrl)) {
              resolve(false);
              return;
            }
            if (actionType === 'incognito') {
              openInIncognito(finalSearchUrl);
              return;
            }
            if (splitDirection) {
              openUrlInSplitView(finalSearchUrl, splitDirection, sourceWindowId, sourceTabId);
            } else if (openInForeground) {
              smartCreateTab(finalSearchUrl, true, sourceWindowId);
            } else {
              smartCreateTab(finalSearchUrl, false, sourceWindowId);
            }
            resolve(true);
            return;
          }

          if (!message.url || typeof message.url !== 'string') {
            resolve(false);
            return;
          }

          let url = message.url;
          try {
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
              url = 'https://' + url;
            }
            if (!isAllowedHttpUrl(url)) {
              resolve(false);
              return;
            }

            if (message.type === 'link' || message.type === 'image') {
              if (actionType === 'download') {
                if (!isAllowedHttpUrl(message.url)) {
                  resolve(false);
                  return;
                }
                try {
                  chrome.downloads.download({ url }, () => {
                    resolve(!chrome.runtime.lastError);
                  });
                } catch (e) {
                  resolve(false);
                }
                return;
              }
              if (actionType === 'incognito') {
                openInIncognito(url);
                return;
              }
              if (splitDirection) {
                openUrlInSplitView(url, splitDirection, sourceWindowId, sourceTabId);
              } else {
                smartCreateTab(url, openInForeground, sourceWindowId);
              }
              resolve(true);
              return;
            }
            resolve(false);
          } catch (e) {
            resolve(false);
          }
        } catch (e) {
          resolve(false);
        }
      });
    } catch (e) {
      resolve(false);
    }
  });
}

// 在新窗口中打开URL并进行简单的分屏布局
// sourceWindowId: 可选，拖拽来源窗口 ID（优先使用，避免 service worker 下 getCurrent 返回错误窗口）
// sourceTabId: 可选，拖拽来源标签页 ID，用于分屏滚动同步
function openUrlInSplitView(url, direction, sourceWindowId, sourceTabId) {
  const getWindow = (cb) => {
    if (sourceWindowId) {
      chrome.windows.get(sourceWindowId, cb);
    } else {
      chrome.windows.getLastFocused({ windowTypes: ['normal'] }, cb);
    }
  };

  try {
    getWindow((currentWindow) => {
      if (chrome.runtime.lastError || !currentWindow) {
        console.error('获取窗口信息错误:', chrome.runtime.lastError?.message);
        smartCreateTab(url, true, sourceWindowId);
        return;
      }

      try {
        const isFullscreen = currentWindow.state === 'fullscreen';
        // 使用 Math.floor 确保整数，各平台尺寸一致
        const totalWidth = Math.floor(currentWindow.width || 1200);
        const totalHeight = Math.floor(currentWindow.height || 800);
        const baseLeft = Math.floor(currentWindow.left ?? 0);
        const baseTop = Math.floor(currentWindow.top ?? 0);

        // 最小半宽/半高，适配 Linux 小屏及 macOS 高 DPI（Chrome 窗口最小约 100px）
        const MIN_HALF = 200;
        const halfWidth = Math.max(Math.floor(totalWidth / 2), MIN_HALF);
        const halfHeight = Math.max(Math.floor(totalHeight / 2), MIN_HALF);
        // 另一侧尺寸，避免奇偶误差导致缝隙
        const otherWidth = totalWidth - halfWidth;
        const otherHeight = totalHeight - halfHeight;

        const originalBounds = {
          left: baseLeft,
          top: baseTop,
          width: totalWidth,
          height: totalHeight,
          state: currentWindow.state || 'normal'
        };

        let currentRect, newRect;
        if (direction === 'left' || direction === 'right') {
          if (direction === 'right') {
            currentRect = { left: baseLeft, top: baseTop, width: halfWidth, height: totalHeight };
            newRect = { left: baseLeft + halfWidth, top: baseTop, width: otherWidth, height: totalHeight };
          } else {
            currentRect = { left: baseLeft + otherWidth, top: baseTop, width: otherWidth, height: totalHeight };
            newRect = { left: baseLeft, top: baseTop, width: halfWidth, height: totalHeight };
          }
        } else if (direction === 'up' || direction === 'down') {
          if (direction === 'down') {
            currentRect = { left: baseLeft, top: baseTop, width: totalWidth, height: halfHeight };
            newRect = { left: baseLeft, top: baseTop + halfHeight, width: totalWidth, height: otherHeight };
          } else {
            currentRect = { left: baseLeft, top: baseTop + otherHeight, width: totalWidth, height: otherHeight };
            newRect = { left: baseLeft, top: baseTop, width: totalWidth, height: halfHeight };
          }
        } else {
          smartCreateTab(url, true, sourceWindowId);
          return;
        }

        // Linux/macOS 上 create 的 left/top 常被忽略，改为先创建再 update 设置位置
        const createNewWindow = (rect) => {
          chrome.windows.create({
            url,
            type: 'normal',
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            focused: true
          }, (createdWindow) => {
            if (chrome.runtime.lastError) {
              smartCreateTab(url, true, sourceWindowId);
              return;
            }
            const applyBounds = (retryCount = 0) => {
              chrome.windows.update(createdWindow.id, {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                focused: true
              }, () => {
                if (chrome.runtime.lastError && retryCount < 3) {
                  // Linux/macOS 窗口管理器可能延迟就绪，重试
                  setTimeout(() => applyBounds(retryCount + 1), 80 * (retryCount + 1));
                }
              });
            };
            // 延迟后 update，确保窗口已创建完成（Linux/macOS/Wayland 需要）
            setTimeout(() => applyBounds(0), 80);
            splitViewSessions[createdWindow.id] = {
              originalWindowId: currentWindow.id,
              originalBounds,
              originalTabId: sourceTabId,
              newTabId: null
            };
            // 获取新窗口的标签页并建立滚动同步配对
            if (sourceTabId) {
              chrome.tabs.query({ windowId: createdWindow.id }, (tabs) => {
                const newTabId = tabs[0]?.id;
                if (newTabId) {
                  splitViewSessions[createdWindow.id].newTabId = newTabId;
                  chrome.storage.sync.get({ enableSplitScrollSync: false }, (s) => {
                    if (s.enableSplitScrollSync) {
                      splitScrollTabPairs[sourceTabId] = newTabId;
                      splitScrollTabPairs[newTabId] = sourceTabId;
                    }
                  });
                }
              });
            }
          });
        };

        const applyCurrentBounds = (retryCount = 0) => {
          chrome.windows.update(currentWindow.id, {
            left: currentRect.left,
            top: currentRect.top,
            width: currentRect.width,
            height: currentRect.height
          }, () => {
            if (chrome.runtime.lastError) {
              if (retryCount < 3) {
                setTimeout(() => applyCurrentBounds(retryCount + 1), 100 * (retryCount + 1));
                return;
              }
              smartCreateTab(url, true, sourceWindowId);
              return;
            }
            createNewWindow(newRect);
          });
        };

        const needsNormalState = currentWindow.state && currentWindow.state !== 'normal';
        if (needsNormalState) {
          chrome.windows.update(currentWindow.id, { state: 'normal' }, () => {
            if (chrome.runtime.lastError) {
              smartCreateTab(url, true, sourceWindowId);
              return;
            }
            // macOS fullscreen spaces and Linux/Wayland need time before accepting bounds.
            setTimeout(() => applyCurrentBounds(0), isFullscreen ? 260 : 120);
          });
          return;
        }

        applyCurrentBounds(0);
      } catch (e) {
        console.error('计算分屏窗口大小/位置时出错:', e.message);
        smartCreateTab(url, true, sourceWindowId);
      }
    });
  } catch (e) {
    console.error('openUrlInSplitView 执行错误:', e.message);
    smartCreateTab(url, true, sourceWindowId);
  }
}

// 初始化预览设置
function initPreviewSettings() {
  // 从存储中加载预览设置
  chrome.storage.sync.get(BACKGROUND_PREVIEW_DEFAULTS, (items) => {
    // 检查items是否为有效对象
    if (!items || typeof items !== 'object') {
      console.error('预览设置加载失败: items无效');
      // 初始化默认设置
      chrome.storage.sync.set(BACKGROUND_PREVIEW_DEFAULTS);
      return;
    }
    
    // 如果没有设置，则初始化
    const needsInit = items.previewEnabled === undefined;
    if (needsInit) {
      console.log('初始化预览设置...');
      chrome.storage.sync.set(BACKGROUND_PREVIEW_DEFAULTS, () => {
        if (chrome.runtime.lastError) {
          console.error('初始化预览设置失败:', chrome.runtime.lastError.message);
        } else {
          console.log('预览设置初始化成功');
        }
      });
    } else {
      console.log('预览设置已加载');
    }
  });
}

// 在扩展启动时初始化预览设置
initPreviewSettings();

const BACKGROUND_HOUSEKEEPING_ALARM = 'mouseExtBackgroundHousekeeping';

chrome.alarms.get(BACKGROUND_HOUSEKEEPING_ALARM, (alarm) => {
  if (!alarm) {
    chrome.alarms.create(BACKGROUND_HOUSEKEEPING_ALARM, {
      delayInMinutes: 15,
      periodInMinutes: 15
    });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || alarm.name !== BACKGROUND_HOUSEKEEPING_ALARM) return;
  duplicateCheckTracker.cleanup();
  notificationTracker.cleanup();
  notificationTracker.cleanupTabNotifications();
  notificationTracker.save();
  notificationTracker.saveIgnoredUrls();
  optimizeMemoryUsage();
  lastCleanupTime = Date.now();
  logCacheStats();
});

// 标签页数量统计防抖
let tabCountUpdateTimeout = null;

// 更新扩展图标徽章显示标签页数量
async function updateTabCountBadge() {
  try {
    // 检查设置是否启用标签页数量徽章
    const settings = await chrome.storage.sync.get({ showTabCountBadge: true });
    
    if (!settings.showTabCountBadge) {
      // 如果设置中禁用了徽章显示，清除徽章
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    
    const tabs = await chrome.tabs.query({});
    const tabCount = tabs.length;
    
    // 设置徽章文本
    if (tabCount > 0) {
      await chrome.action.setBadgeText({ text: tabCount.toString() });
      await chrome.action.setBadgeBackgroundColor({ color: '#ff6b6b' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
    
    console.log(`标签页数量: ${tabCount}`);
  } catch (error) {
    console.error('更新标签页数量徽章失败:', error.message);
  }
}

// 防抖更新标签页数量
function debouncedUpdateTabCount() {
  if (tabCountUpdateTimeout) {
    clearTimeout(tabCountUpdateTimeout);
  }
  
  tabCountUpdateTimeout = setTimeout(() => {
    updateTabCountBadge();
  }, 100); // 100ms防抖延迟
}

// 扩展安装或更新时的处理
chrome.runtime.onInstalled.addListener((details) => {
  try {
    if (details.reason === 'install') {
      // 首次安装 - 直接使用 chrome.tabs.create 打开欢迎页面
      const welcomeUrl = chrome.runtime.getURL('welcome.html');
      console.log('欢迎页面URL:', welcomeUrl);
      
      // 使用统一的标签页创建函数
      createTabWithRecentIndex(welcomeUrl, true)
        .then(tab => {
          console.log('成功创建欢迎页面:', tab.id);
          // 更新标签页数量
          updateTabCountBadge();
        })
        .catch(e => {
          console.error('创建欢迎页面错误:', e.message);
        });
    }
    
    // 初始化时更新标签页数量
    updateTabCountBadge();
  } catch (e) {
    console.error('扩展安装/更新处理错误:', e.message);
  }
}); 

// 监听标签页创建
chrome.tabs.onCreated.addListener((tab) => {
  console.log('标签页创建:', tab.id);
  debouncedUpdateTabCount();
});

// 监听标签页移除
chrome.tabs.onRemoved.addListener((tabId) => {
  purgePreviousActiveTabReference(tabId);
  removePreviewPopupRegistryByTabId(tabId);
  notificationTracker.cleanupTabNotifications(tabId);
  console.log('标签页移除:', tabId);
  debouncedUpdateTabCount();
});

// 监听标签页更新（包括URL变化）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 只在标签页状态变为complete时更新，避免频繁更新
  if (changeInfo.status === 'complete') {
    console.log('标签页更新完成:', tabId);
    debouncedUpdateTabCount();
  }
});

// 监听标签页激活
chrome.tabs.onActivated.addListener((activeInfo) => {
  console.log('标签页激活:', activeInfo.tabId);
  debouncedUpdateTabCount();
});

// 监听窗口创建
chrome.windows.onCreated.addListener((window) => {
  console.log('窗口创建:', window.id);
  debouncedUpdateTabCount();
});

// 监听窗口移除
chrome.windows.onRemoved.addListener((windowId) => {
  handleDetachedSettingsWindowRestore(windowId);
  removePreviewPopupRegistryByWindowId(windowId);
  console.log('窗口移除:', windowId);
  debouncedUpdateTabCount();
  handleSplitViewWindowClose(windowId);
});
