/**
 * 隔离世界：读取开关并向页面主世界注入 unlock-restrictions-main.js
 * 与「禁用网站列表」联动：列表中的域名不注入。
 */
(function () {
  const G = typeof globalThis !== 'undefined' ? globalThis : window;
  if (G.__mouseUnlockBridgeLoaded) return;
  G.__mouseUnlockBridgeLoaded = true;

  const STORAGE_KEY = 'unlockPageRestrictions';
  let bridgeTabUrl = '';
  let bridgeTabUrlReady = false;
  let pendingInjectAfterContext = false;

  /** 与 content.js isSiteInDisabledList 规则一致 */
  function isHrefInDisabledList(href, list) {
    if (!list || !Array.isArray(list) || list.length === 0 || !href) return false;
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

  function clearInjectedFlag() {
    try {
      const root = document.documentElement;
      if (root) root.removeAttribute('data-mouse-unlock-main-injected');
    } catch (e) { /* ignore */ }
  }

  function setUnlockActive(active) {
    try {
      if (!chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') return;
      chrome.runtime.sendMessage(
        { type: '__mouseGestureSetUnlockActive', active: !!active },
        () => {}
      );
    } catch (e) { /* ignore */ }
  }

  function ensureUnlockCssInserted(onDone) {
    try {
      const root = document.documentElement;
      if (!root || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
        if (typeof onDone === 'function') onDone();
        return;
      }
      if (root.getAttribute('data-mouse-unlock-css-inserted') === '1') {
        if (typeof onDone === 'function') onDone();
        return;
      }
      chrome.runtime.sendMessage({ type: '__mouseGestureInsertUnlockCss' }, (res) => {
        if (!chrome.runtime.lastError && res && res.ok) {
          try {
            root.setAttribute('data-mouse-unlock-css-inserted', '1');
          } catch (e) { /* ignore */ }
        }
        if (typeof onDone === 'function') onDone();
      });
    } catch (e) {
      if (typeof onDone === 'function') onDone();
    }
  }

  function initBridgeTabUrl(onReady) {
    try {
      if (!chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
        if (typeof onReady === 'function') onReady();
        return;
      }
      chrome.runtime.sendMessage({ action: 'getContentContext' }, (res) => {
        if (!chrome.runtime.lastError && res && res.success && res.tabUrl) {
          bridgeTabUrl = String(res.tabUrl);
        }
        bridgeTabUrlReady = true;
        if (typeof onReady === 'function') onReady();
      });
    } catch (e) {
      bridgeTabUrlReady = true;
      if (typeof onReady === 'function') onReady();
    }
  }

  function injectMain() {
    try {
      const root = document.documentElement;
      if (!root) return;
      if (root.getAttribute('data-mouse-unlock-main-injected') === '1') {
        ensureUnlockCssInserted();
        setUnlockActive(true);
        return;
      }

      if (!chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
        return;
      }

      ensureUnlockCssInserted(() => {
        chrome.runtime.sendMessage({ type: '__mouseGestureInjectUnlockMain' }, (res) => {
          if (chrome.runtime.lastError) return;
          if (res && res.ok) {
            try {
              root.setAttribute('data-mouse-unlock-main-injected', '1');
            } catch (e) { /* ignore */ }
          }
        });
      });
    } catch (e) { /* ignore */ }
  }

  function tryInject(unlockOn, disabledSites) {
    if (!unlockOn) {
      clearInjectedFlag();
      setUnlockActive(false);
      return;
    }
    if (isHrefInDisabledList(window.location.href, disabledSites)) {
      clearInjectedFlag();
      setUnlockActive(false);
      return;
    }
    if (bridgeTabUrl && isHrefInDisabledList(bridgeTabUrl, disabledSites)) {
      clearInjectedFlag();
      setUnlockActive(false);
      return;
    }
    injectMain();
  }

  function readAndInject() {
    try {
      chrome.storage.sync.get({ [STORAGE_KEY]: false }, function (syncItems) {
        if (chrome.runtime.lastError) return;
        chrome.storage.local.get({ disabledSites: [] }, function (localItems) {
          if (chrome.runtime.lastError) return;
          const disabledSites = Array.isArray(localItems.disabledSites) ? localItems.disabledSites : [];
          const run = () => tryInject(!!syncItems[STORAGE_KEY], disabledSites);
          if (bridgeTabUrlReady) {
            run();
          } else {
            pendingInjectAfterContext = true;
            initBridgeTabUrl(() => {
              pendingInjectAfterContext = false;
              run();
            });
          }
        });
      });
    } catch (e) { /* ignore */ }
  }

  initBridgeTabUrl(() => {
    if (pendingInjectAfterContext) readAndInject();
  });
  readAndInject();

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'sync' && Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) {
        readAndInject();
        return;
      }
      if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, 'disabledSites')) {
        readAndInject();
      }
    });
  } catch (e) { /* ignore */ }
})();
