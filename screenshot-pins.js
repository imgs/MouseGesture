/**
 * 将截图以可拖拽/缩放的贴纸形式固定在页面顶层，支持多个；按页面 URL 持久化。
 *
 * 贴图序号（「贴图 1、2…」）与截图预览里的「序号」标注无关：
 * 显示编号始终按当前页面上已有贴图数量从 1 连续编号。
 */
(function (global) {
  'use strict';

  if (global.__mouseScreenshotPinsLoaded) return;
  global.__mouseScreenshotPinsLoaded = true;

  const PINS_HTML_NS = 'http://www.w3.org/1999/xhtml';
  const ROOT_ID = 'mouse-screenshot-pins-root';
  const STYLE_ID = 'mouse-screenshot-pins-style';
  const PIN_CLASS = 'mouse-screenshot-pin';
  const DEFAULT_TRAIL_HEX = '#FF9ECD';
  /** 与手势默认轨迹色一致，供 CSS var 未写入前回退 */
  const DEFAULT_TRAIL_RGB = '255, 158, 205';
  const MAX_DISPLAY_W = 560;
  const MIN_DISPLAY_W = 80;
  const Z_BASE = 0;
  const CASCADE = 28;

  let pinSeq = 0;
  let zTop = Z_BASE;
  const persistTimers = new Map();
  const pinPendingSave = new Map();
  const pinSaveChains = new Map();
  const pinSaveDebounceTimers = new Map();
  const pinSaveRev = new Map();
  const pinDrainRetries = new Map();
  const MAX_PIN_DRAIN_RETRIES = 10;
  let lastRestoreScope = null;
  const PERSIST_DEBOUNCE_MS = 200;
  const PERSIST_THROTTLE_MS = 80;
  const pinDataUrlByStorageId = new Map();
  const pinWheelZoomState = new WeakMap();
  const pinControls = new WeakMap();
  const WHEEL_ZOOM_LERP = 0.2;
  const WHEEL_ZOOM_SENS = 0.0012;
  let restoreInFlight = false;
  let cachedTrailColorHex = DEFAULT_TRAIL_HEX;

  function createScreenshotPinElement(tagName) {
    const tag = String(tagName || '').toLowerCase();
    let el = null;
    try {
      el = document.createElement(tagName);
    } catch (e) {
      el = null;
    }
    if (!isScreenshotPinElementUsable(el, tag)) {
      try {
        el = document.createElementNS(PINS_HTML_NS, tagName);
      } catch (e) {
        el = null;
      }
    }
    if (!isScreenshotPinElementUsable(el, tag)) {
      try {
        const htmlDoc = document.implementation && document.implementation.createHTMLDocument
          ? document.implementation.createHTMLDocument('')
          : null;
        if (htmlDoc) {
          el = htmlDoc.createElement(tagName);
          if (document.adoptNode) el = document.adoptNode(el);
        }
      } catch (e) {
        el = null;
      }
    }
    return el;
  }

  function isScreenshotPinElementUsable(el, tag) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (tag === 'canvas') return typeof el.getContext === 'function';
    return !!el.style;
  }

  function normalizePinTrailHex(value) {
    if (value == null || typeof value !== 'string') return null;
    let s = value.trim();
    if (!s) return null;
    if (!s.startsWith('#')) s = '#' + s;
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    return '#' + h.toUpperCase();
  }

  function trailHexToRgbCssTriple(hex) {
    const h = normalizePinTrailHex(hex);
    if (!h) return null;
    const n = parseInt(h.slice(1), 16);
    return ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
  }

  function applyPinTrailThemeToRootEl(root) {
    if (!root || !root.style) return;
    const triple = trailHexToRgbCssTriple(cachedTrailColorHex) || DEFAULT_TRAIL_RGB;
    root.style.setProperty('--pin-trail-rgb', triple);
  }

  function applyPinTrailThemeFromStorageHex(hex) {
    const h = normalizePinTrailHex(hex) || DEFAULT_TRAIL_HEX;
    cachedTrailColorHex = h;
    applyPinTrailThemeToRootEl(findPinsRoot());
  }

  function removeLegacyPinsDom() {
    try {
      const legacyRoot = document.getElementById(ROOT_ID);
      if (legacyRoot && legacyRoot.getRootNode() === document) {
        legacyRoot.remove();
      }
      const legacyStyle = document.getElementById(STYLE_ID);
      if (legacyStyle && legacyStyle.getRootNode() === document) {
        legacyStyle.remove();
      }
    } catch (e) { /* ignore */ }
  }

  function findPinsRoot() {
    if (typeof MouseExtUiHost !== 'undefined') {
      return MouseExtUiHost.getElementById(ROOT_ID);
    }
    return document.getElementById(ROOT_ID);
  }

  function buildPinStylesText() {
    return [
      '#' + ROOT_ID + ' {',
      '  position: fixed; inset: 0; z-index: 0;',
      '  pointer-events: none;',
      '  overflow: visible;',
      '  --pin-trail-rgb: ' + DEFAULT_TRAIL_RGB + ';',
      '}',
      '.' + PIN_CLASS + ' {',
      '  position: absolute; pointer-events: auto;',
      '  box-sizing: border-box;',
      '  border-radius: 8px;',
      '  overflow: hidden;',
      '  background: #fff;',
      '  box-shadow: 0 10px 36px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.08);',
      '  touch-action: none;',
      '}',
      '.' + PIN_CLASS + '.is-dragging, .' + PIN_CLASS + '.is-resizing, .' + PIN_CLASS + '.is-wheel-zooming {',
      '  box-shadow: 0 14px 48px rgba(0,0,0,0.35), 0 0 0 2px rgba(var(--pin-trail-rgb), 0.55);',
      '}',
      '.' + PIN_CLASS + '.is-wheel-zooming {',
      '  will-change: width;',
      '}',
      '.' + PIN_CLASS + ' .mouse-screenshot-pin__bar {',
      '  position: absolute;',
      '  top: 0;',
      '  left: 0;',
      '  right: 0;',
      '  z-index: 2;',
      '  display: flex; align-items: center; justify-content: space-between;',
      '  gap: 6px; padding: 4px 6px;',
      '  max-height: 36px; opacity: 1; overflow: hidden;',
      '  transition: max-height 0.2s ease, opacity 0.2s ease, padding 0.2s ease;',
      '  background: linear-gradient(180deg, rgba(22,22,32,0.07), rgba(16,16,24,0.04));',
      '  backdrop-filter: saturate(130%) blur(10px);',
      '  -webkit-backdrop-filter: saturate(130%) blur(10px);',
      '  color: #f2f2f8; font: 11px/1.2 system-ui, sans-serif;',
      '  cursor: grab; user-select: none;',
      '}',
      '.' + PIN_CLASS + ':not(:hover):not(:focus-within):not(.is-dragging):not(.is-resizing):not(.is-wheel-zooming):not(.pin-bar-visible) .mouse-screenshot-pin__bar {',
      '  max-height: 0; opacity: 0; padding-top: 0; padding-bottom: 0;',
      '  pointer-events: none;',
      '}',
      '.' + PIN_CLASS + '.is-dragging .mouse-screenshot-pin__bar { cursor: grabbing; }',
      '.' + PIN_CLASS + ' .mouse-screenshot-pin__order {',
      '  flex: 0 1 auto; min-width: 0; margin-right: auto;',
      '  padding: 1px 8px; border-radius: 4px; width: fit-content; max-width: 100%;',
      '  background: rgba(var(--pin-trail-rgb), 0.58); color: #fff; font-size: 10px; font-weight: 700;',
      '  font-variant-numeric: tabular-nums; text-align: left; line-height: 1.3;',
      '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
      '  text-shadow: 0 0 1px rgba(0,0,0,0.35);',
      '}',
      '.' + PIN_CLASS + ' .mouse-screenshot-pin__zoom-tools {',
      '  display: flex; align-items: center; gap: 4px; flex-shrink: 0;',
      '}',
      '.' + PIN_CLASS + ' .mouse-screenshot-pin__zoom-level {',
      '  min-width: 2.6em; padding: 0 2px; text-align: center;',
      '  font-size: 10px; font-variant-numeric: tabular-nums;',
      '  color: rgb(var(--pin-trail-rgb)); opacity: 0.95;',
      '}',
      '.' + PIN_CLASS + ' .mouse-screenshot-pin__zoom-btn {',
      '  border: 1px solid rgba(var(--pin-trail-rgb), 0.35); border-radius: 5px; padding: 2px 7px;',
      '  font: 10px/1.2 system-ui, sans-serif; background: rgba(var(--pin-trail-rgb), 0.12);',
      '  color: rgb(var(--pin-trail-rgb)); cursor: pointer; flex-shrink: 0;',
      '}',
      '.' + PIN_CLASS + ' .mouse-screenshot-pin__zoom-btn:hover {',
      '  background: rgba(var(--pin-trail-rgb), 0.28);',
      '}',
      '.' + PIN_CLASS + ' .mouse-screenshot-pin__zoom-btn.is-active {',
      '  background: rgba(var(--pin-trail-rgb), 0.48); color: #fff; border-color: rgba(var(--pin-trail-rgb), 0.65);',
      '}',
      '.' + PIN_CLASS + ' .mouse-screenshot-pin__close {',
      '  flex: 0 0 auto; width: 22px; height: 22px; border: none; border-radius: 6px;',
      '  background: rgba(var(--pin-trail-rgb), 0.15); color: rgb(var(--pin-trail-rgb)); cursor: pointer;',
      '  font-size: 14px; line-height: 1; padding: 0;',
      '}',
      '.' + PIN_CLASS + ' .mouse-screenshot-pin__close:hover { background: rgba(var(--pin-trail-rgb), 0.45); color: #fff; }',
      '.' + PIN_CLASS + ' .mouse-screenshot-pin__img-wrap {',
      '  position: relative; background: #f4f4f8; line-height: 0; cursor: grab;',
      '}',
      '.' + PIN_CLASS + '.is-dragging .mouse-screenshot-pin__img-wrap { cursor: grabbing; }',
      '.' + PIN_CLASS + ' img {',
      '  display: block; width: 100%; height: auto; pointer-events: none;',
      '  -webkit-user-drag: none; user-drag: none;',
      '}',
      '.' + PIN_CLASS + ' .mouse-screenshot-pin__resize {',
      '  position: absolute; right: 2px; bottom: 2px; width: 14px; height: 14px;',
      '  cursor: nwse-resize; border-radius: 3px;',
      '  background: linear-gradient(135deg, transparent 50%, rgba(var(--pin-trail-rgb), 0.88) 50%);',
      '  opacity: 1;',
      '  transition: opacity 0.2s ease;',
      '}',
      '.' + PIN_CLASS + ':not(:hover):not(:focus-within):not(.is-dragging):not(.is-resizing):not(.is-wheel-zooming):not(.pin-bar-visible) .mouse-screenshot-pin__resize {',
      '  opacity: 0;',
      '  pointer-events: none;',
      '}'
    ].join('\n');
  }

  function initPinTrailColorSync() {
    if (!ensureTopFrame() || typeof chrome.storage === 'undefined' || !chrome.storage.sync) return;
    try {
      chrome.storage.sync.get({ trailColor: DEFAULT_TRAIL_HEX }, (items) => {
        if (chrome.runtime.lastError) return;
        applyPinTrailThemeFromStorageHex(items && items.trailColor);
      });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes.trailColor) return;
        applyPinTrailThemeFromStorageHex(changes.trailColor.newValue);
      });
    } catch (e) {
      /* ignore */
    }
  }

  function ensureTopFrame() {
    return global.window === global.window.top;
  }

  function getPageScopeKey() {
    try {
      return global.location.origin + global.location.pathname;
    } catch (e) {
      return global.location.href || '';
    }
  }

  function sendStorageMessage(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'storage_message_failed'));
            return;
          }
          if (!res || res.success !== true) {
            reject(new Error((res && res.error) || 'storage_message_failed'));
            return;
          }
          resolve(res);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function injectPinStyles() {
    const cssText = buildPinStylesText();
    if (typeof MouseExtUiHost !== 'undefined') {
      MouseExtUiHost.appendStyle(cssText, STYLE_ID);
      return;
    }
    if (document.getElementById(STYLE_ID)) return;
    const style = createScreenshotPinElement('style');
    style.id = STYLE_ID;
    style.textContent = cssText;
    (document.head || document.documentElement).appendChild(style);
  }

  function getRoot() {
    if (!ensureTopFrame()) return null;
    removeLegacyPinsDom();
    injectPinStyles();
    if (typeof MouseExtUiHost !== 'undefined') {
      MouseExtUiHost.ensureHost();
      MouseExtUiHost.syncHostToFullscreenLayer();
      let root = findPinsRoot();
      if (!root) {
        root = createScreenshotPinElement('div');
        root.id = ROOT_ID;
        root.className = 'mouse-screenshot-pins-root';
        root.setAttribute('aria-hidden', 'true');
        if (!MouseExtUiHost.appendToPinsLayer(root)) return null;
      }
      applyPinTrailThemeToRootEl(root);
      return root;
    }
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = createScreenshotPinElement('div');
      root.id = ROOT_ID;
      root.className = 'mouse-screenshot-pins-root';
      root.setAttribute('aria-hidden', 'true');
      (document.documentElement || document.body).appendChild(root);
    }
    applyPinTrailThemeToRootEl(root);
    return root;
  }

  function defaultPinPosition(displayW, displayH, index) {
    const vw = global.innerWidth || 800;
    const vh = global.innerHeight || 600;
    const n = typeof index === 'number' ? index : pinSeq;
    const x = Math.max(12, Math.round((vw - displayW) / 2) + (n % 5) * CASCADE);
    const y = Math.max(12, Math.round((vh - displayH) / 2) + Math.floor(n / 5) * CASCADE);
    return { x, y };
  }

  function computeDisplaySize(natW, natH, forcedDisplayW) {
    const w = Math.max(1, natW | 0);
    const h = Math.max(1, natH | 0);
    const forced = forcedDisplayW > 0 ? forcedDisplayW | 0 : 0;
    let displayW = forced > 0 ? forced : w;
    /** 仅「无已保存宽度」时用 MAX_DISPLAY_W 限制初始贴图；恢复持久化宽度时不再截断，否则大比例/1:1 刷新会变回 560px */
    if (forced <= 0 && displayW > MAX_DISPLAY_W) displayW = MAX_DISPLAY_W;
    let displayH = Math.round((h * displayW) / w);
    if (displayW < MIN_DISPLAY_W) {
      displayW = MIN_DISPLAY_W;
      displayH = Math.round((h * displayW) / w);
    }
    return { displayW, displayH, aspect: w / h };
  }

  function bringToFront(el) {
    zTop += 1;
    el.style.zIndex = String(zTop);
  }

  function removePinElement(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function nextPinId() {
    return 'pin_' + global.crypto.randomUUID();
  }

  function syncPinSeqFromId(pinId) {
    if (!pinId) return;
    const m = String(pinId).match(/(\d+)/);
    if (m) pinSeq = Math.max(pinSeq, (m[1] | 0) % 1000000);
  }

  function readPinLayoutPx(pin) {
    let x = parseFloat(pin.style.left);
    let y = parseFloat(pin.style.top);
    if (!Number.isFinite(x)) x = pin.offsetLeft;
    if (!Number.isFinite(y)) y = pin.offsetTop;
    return {
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y))
    };
  }

  function bumpSaveRev(storageId) {
    const n = (pinSaveRev.get(storageId) || 0) + 1;
    pinSaveRev.set(storageId, n);
    return n;
  }

  function readPinPersistState(pin) {
    const storageId = pin.dataset.storagePinId || '';
    const closeBtn = pin.querySelector('.mouse-screenshot-pin__close');
    const resizeEl = pin.querySelector('.mouse-screenshot-pin__resize');
    const pos = readPinLayoutPx(pin);
    return {
      id: storageId,
      x: pos.x,
      y: pos.y,
      displayW: Math.max(1, pin.offsetWidth | 0),
      width: Math.max(1, (pin.dataset.natW | 0) || 1),
      height: Math.max(1, (pin.dataset.natH | 0) || 1),
      title: '',
      pinOrder: Math.max(1, pin.dataset.pinOrder | 0),
      closeTitle: closeBtn ? closeBtn.title : '',
      resizeTitle: resizeEl ? resizeEl.title : ''
    };
  }

  function showPinSaveErrorHint() {
    try {
      const message = chrome.i18n.getMessage('screenshotHistoryPinFailed') || 'Screenshot pin save failed';
      if (typeof global.showGestureHint === 'function') {
        global.showGestureHint(message);
        return;
      }
      const host = global.MouseExtUiHost;
      if (!host || typeof host.appendToNotificationsLayer !== 'function') return;
      const note = createScreenshotPinElement('div');
      note.textContent = message;
      note.style.cssText =
        'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
        'padding:8px 14px;background:rgba(220,53,69,0.92);color:#fff;' +
        'border-radius:6px;font:13px/1.4 system-ui,sans-serif;pointer-events:none;z-index:1;';
      host.appendToNotificationsLayer(note);
      setTimeout(() => {
        try {
          note.remove();
        } catch (e) { /* ignore */ }
      }, 3500);
    } catch (e) { /* ignore */ }
  }

  function drainPinSaveQueue(storageId) {
    const prev = pinSaveChains.get(storageId) || Promise.resolve();
    const task = async () => {
      while (pinPendingSave.has(storageId)) {
        const job = pinPendingSave.get(storageId);
        if (!job || !job.pin.isConnected) {
          pinPendingSave.delete(storageId);
          pinDrainRetries.delete(storageId);
          break;
        }
        const snapRev = job.saveRev;
        const state = readPinPersistState(job.pin);
        const msg = {
          action: 'savePageScreenshotPin',
          pageScopeKey: getPageScopeKey(),
          pin: state
        };
        if (job.carryImage && job.pin.dataset.imagePersisted !== '1') {
          msg.dataUrl = job.carryImage;
        }
        try {
          await sendStorageMessage(msg);
        } catch (e) {
          const n = (pinDrainRetries.get(storageId) || 0) + 1;
          if (n < MAX_PIN_DRAIN_RETRIES) {
            pinDrainRetries.set(storageId, n);
            setTimeout(() => drainPinSaveQueue(storageId), 400 + n * 80);
          } else {
            pinDrainRetries.delete(storageId);
            pinPendingSave.delete(storageId);
            showPinSaveErrorHint();
          }
          break;
        }
        pinDrainRetries.delete(storageId);
        if (msg.dataUrl) {
          job.pin.dataset.imagePersisted = '1';
        }
        const cur = pinPendingSave.get(storageId);
        if (cur && cur.saveRev === snapRev) {
          pinPendingSave.delete(storageId);
        }
      }
    };
    const next = prev.then(task);
    pinSaveChains.set(storageId, next);
    next.finally(() => {
      if (pinSaveChains.get(storageId) === next) {
        pinSaveChains.delete(storageId);
      }
    }).catch(() => {});
    return next;
  }

  /** 仅首写或未落库成功时携带大图；不要把 dataUrl 反复塞进 runtime.sendMessage */
  function queuePinSave(pin, options) {
    if (!pin) return Promise.resolve();
    const storageId = pin.dataset.storagePinId;
    if (!storageId) return Promise.resolve();
    const opts = options || {};
    const saveRev = bumpSaveRev(storageId);
    const prev = pinPendingSave.get(storageId);

    let carryImage;
    if (opts.dataUrl != null) {
      carryImage = opts.dataUrl;
      pinDataUrlByStorageId.set(storageId, opts.dataUrl);
    } else if (
      prev &&
      prev.carryImage &&
      pin.dataset.imagePersisted !== '1'
    ) {
      carryImage = prev.carryImage;
    }

    pinPendingSave.set(storageId, { pin, saveRev, carryImage });

    if (opts.immediate) {
      const debounceId = pinSaveDebounceTimers.get(storageId);
      if (debounceId) {
        clearTimeout(debounceId);
        pinSaveDebounceTimers.delete(storageId);
      }
      return drainPinSaveQueue(storageId);
    }

    if (pinSaveDebounceTimers.has(storageId)) {
      return pinSaveChains.get(storageId) || Promise.resolve();
    }

    return new Promise((resolve) => {
      const tid = setTimeout(() => {
        pinSaveDebounceTimers.delete(storageId);
        drainPinSaveQueue(storageId).then(resolve).catch(() => resolve());
      }, PERSIST_THROTTLE_MS);
      pinSaveDebounceTimers.set(storageId, tid);
    });
  }

  function persistPinToStorage(pin, dataUrl, includeImage) {
    return queuePinSave(pin, {
      immediate: true,
      dataUrl: includeImage && dataUrl ? dataUrl : undefined
    });
  }

  function countPinsInDom() {
    const root = findPinsRoot();
    if (!root) return 0;
    return root.querySelectorAll('.' + PIN_CLASS).length;
  }

  function listPinsInDomSorted() {
    const root = findPinsRoot();
    if (!root) return [];
    const pins = Array.from(root.querySelectorAll('.' + PIN_CLASS));
    pins.sort((a, b) => (a.dataset.pinOrder | 0) - (b.dataset.pinOrder | 0));
    return pins;
  }

  /** 新贴图顺序：当前 DOM 中贴图个数 + 1（与预览内序号标注无关） */
  function getNextPinOrder() {
    return countPinsInDom() + 1;
  }

  /** 按已有贴图数量重排显示为 贴图 1、2、3… */
  function refreshAllPinOrderLabels() {
    const pins = listPinsInDomSorted();
    pins.forEach((pin, index) => {
      const num = index + 1;
      pin.dataset.pinOrder = String(num);
      const label = pin.querySelector('.mouse-screenshot-pin__order');
      const text = pinMsg(
        'screenshotPinOrderLabel',
        [String(num)],
        'Pin #' + num
      );
      if (label) label.textContent = text;
      pin.setAttribute('aria-label', text);
    });
  }

  function hasPinInDom(storageId) {
    if (!storageId) return false;
    const root = findPinsRoot();
    if (!root) return false;
    const pins = root.querySelectorAll('.' + PIN_CLASS);
    for (let i = 0; i < pins.length; i++) {
      if (pins[i].dataset.storagePinId === storageId) return true;
    }
    return false;
  }

  function clearPersistSchedulers(storageId) {
    if (!storageId) return;
    const debounceId = persistTimers.get(storageId);
    if (debounceId) {
      clearTimeout(debounceId);
      persistTimers.delete(storageId);
    }
    const layoutDebounce = pinSaveDebounceTimers.get(storageId);
    if (layoutDebounce) {
      clearTimeout(layoutDebounce);
      pinSaveDebounceTimers.delete(storageId);
    }
  }

  function flushPersistPin(pin) {
    if (!pin) return Promise.resolve();
    const storageId = pin.dataset.storagePinId;
    if (!storageId) return Promise.resolve();
    clearPersistSchedulers(storageId);
    return queuePinSave(pin, { immediate: true });
  }

  /** 页面卸载前把所有贴图的最新布局写入存储 */
  function flushAllPinLayouts() {
    return Promise.all(listPinsInDomSorted().map((pin) => flushPersistPin(pin)));
  }

  function schedulePersistPin(pin, options) {
    if (!pin) return Promise.resolve();
    const storageId = pin.dataset.storagePinId;
    if (!storageId) return Promise.resolve();
    const opts = options || {};
    if (opts.flush) {
      return flushPersistPin(pin);
    }
    if (opts.live) {
      return queuePinSave(pin, { immediate: false });
    }
    const prev = persistTimers.get(storageId);
    if (prev) clearTimeout(prev);
    return new Promise((resolve) => {
      const tid = setTimeout(() => {
        persistTimers.delete(storageId);
        flushPersistPin(pin).then(resolve).catch(() => resolve());
      }, opts.delay != null ? opts.delay : PERSIST_DEBOUNCE_MS);
      persistTimers.set(storageId, tid);
    });
  }

  function removePersistedPin(pinId) {
    if (!pinId) return;
    sendStorageMessage({
      action: 'removePageScreenshotPin',
      pageScopeKey: getPageScopeKey(),
      pinId: pinId
    }).catch(() => {});
  }

  /** 鼠标离开贴图时延迟收起顶栏，避免边缘抖动；拖拽/缩放时保持显示 */
  function setupPinBarAutoHide(pin) {
    let hideTimer = 0;
    const showBar = () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = 0;
      }
      pin.classList.add('pin-bar-visible');
    };
    const scheduleHideBar = () => {
      if (
        pin.classList.contains('is-dragging') ||
        pin.classList.contains('is-resizing') ||
        pin.classList.contains('is-wheel-zooming')
      ) {
        return;
      }
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        hideTimer = 0;
        if (!pin.matches(':hover') && !pin.contains(document.activeElement)) {
          pin.classList.remove('pin-bar-visible');
        }
      }, 120);
    };
    pin.addEventListener('mouseenter', showBar, { passive: true });
    pin.addEventListener('mouseleave', scheduleHideBar, { passive: true });
    pin.addEventListener('focusin', showBar);
    pin.addEventListener('focusout', (e) => {
      if (e.relatedTarget && pin.contains(e.relatedTarget)) return;
      scheduleHideBar();
    });
  }

  function isPinMoveExcludedTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest(
      '.mouse-screenshot-pin__close, .mouse-screenshot-pin__zoom-btn, .mouse-screenshot-pin__resize'
    );
  }

  function setupDrag(pin) {
    let drag = null;
    const onMove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      let left = drag.origLeft + dx;
      let top = drag.origTop + dy;
      const maxL = Math.max(0, (global.innerWidth || 0) - pin.offsetWidth);
      const maxT = Math.max(0, (global.innerHeight || 0) - pin.offsetHeight);
      left = Math.min(maxL, Math.max(0, left));
      top = Math.min(maxT, Math.max(0, top));
      pin.style.left = left + 'px';
      pin.style.top = top + 'px';
      schedulePersistPin(pin, { live: true });
    };
    const onUp = () => {
      if (!drag) return;
      drag = null;
      pin.classList.remove('is-dragging');
      global.removeEventListener('pointermove', onMove, true);
      global.removeEventListener('pointerup', onUp, true);
      global.removeEventListener('pointercancel', onUp, true);
      void schedulePersistPin(pin, { flush: true });
    };
    pin.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (isPinMoveExcludedTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      bringToFront(pin);
      pin.classList.add('pin-bar-visible');
      const startPos = readPinLayoutPx(pin);
      drag = {
        startX: e.clientX,
        startY: e.clientY,
        origLeft: startPos.x,
        origTop: startPos.y
      };
      pin.classList.add('is-dragging');
      try {
        pin.setPointerCapture(e.pointerId);
      } catch (err) { /* ignore */ }
      global.addEventListener('pointermove', onMove, true);
      global.addEventListener('pointerup', onUp, true);
      global.addEventListener('pointercancel', onUp, true);
    });
  }

  function pinMsg(key, substitutions, fallback) {
    try {
      if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
        const msg = chrome.i18n.getMessage(key, substitutions);
        if (msg) return msg;
      }
    } catch (e) {
      /* ignore */
    }
    return fallback;
  }

  function getPinNatW(pin) {
    return Math.max(1, (pin.dataset.natW | 0) || 1);
  }

  function getPinNatH(pin) {
    return Math.max(1, (pin.dataset.natH | 0) || 1);
  }

  function getPinAspect(pin) {
    const w = getPinNatW(pin);
    return w / Math.max(1, getPinNatH(pin));
  }

  function getPinScalePercent(pin) {
    return Math.round((pin.offsetWidth / getPinNatW(pin)) * 100);
  }

  function computePinFitDisplayWidth(pin) {
    const natW = getPinNatW(pin);
    const natH = getPinNatH(pin);
    const aspect = natW / natH;
    const vw = global.innerWidth || 800;
    const vh = global.innerHeight || 600;
    const margin = 24;
    const maxImgW = Math.max(MIN_DISPLAY_W, Math.min(MAX_DISPLAY_W, vw - margin * 2));
    const overlayReserve = 8;
    const maxImgH = Math.max(48, vh - margin * 2 - overlayReserve);
    const scale = Math.min(maxImgW / natW, maxImgH / natH, 1);
    return clampPinDisplayWidth(
      pin,
      Math.max(MIN_DISPLAY_W, Math.round(natW * scale)),
      aspect
    );
  }

  function getPinOriginalDisplayWidth(pin) {
    return Math.max(MIN_DISPLAY_W, getPinNatW(pin));
  }

  function updatePinZoomUi(pin) {
    const ctrl = pinControls.get(pin);
    if (!ctrl || !ctrl.zoomLevel) return;
    const pct = getPinScalePercent(pin);
    ctrl.zoomLevel.textContent = pinMsg(
      'screenshotPreviewZoomLevel',
      [String(pct)],
      pct + '%'
    );
    const curW = pin.offsetWidth;
    const fitW = computePinFitDisplayWidth(pin);
    const origW = getPinOriginalDisplayWidth(pin);
    if (ctrl.btnFit) {
      ctrl.btnFit.classList.toggle('is-active', Math.abs(curW - fitW) <= 2);
    }
    if (ctrl.btnOriginal) {
      ctrl.btnOriginal.classList.toggle('is-active', Math.abs(curW - origW) <= 2);
    }
  }

  function setPinDisplayWidthAnimated(pin, newW, aspect, clampOptions) {
    const w = clampPinDisplayWidth(pin, newW, aspect, clampOptions);
    const state = pinWheelZoomState.get(pin);
    const opts = clampOptions || {};
    /** 工具栏按钮：直接到位，避免 lerp 小数宽度与末帧丢失 clamp 选项 */
    if (opts.instantSnap || !state) {
      if (state) {
        if (state.animId != null) {
          cancelAnimationFrame(state.animId);
          state.animId = null;
        }
        if (state.wheelPersistTimer) {
          clearTimeout(state.wheelPersistTimer);
          state.wheelPersistTimer = null;
        }
        state.targetW = w;
        state.clampOpts = null;
        pin.classList.remove('is-wheel-zooming');
      }
      applyPinDisplayWidth(pin, w, aspect, clampOptions);
      void schedulePersistPin(pin, { flush: true });
      return;
    }
    state.targetW = w;
    state.clampOpts = clampOptions || null;
    state.lastWheelAt = Date.now();
    pin.classList.add('is-wheel-zooming');
    if (state.animId == null) {
      state.animId = requestAnimationFrame(() => runWheelZoomFrame(pin));
    }
    if (state.wheelPersistTimer) clearTimeout(state.wheelPersistTimer);
    state.wheelPersistTimer = setTimeout(() => {
      state.wheelPersistTimer = null;
      pin.classList.remove('is-wheel-zooming');
      state.targetW = pin.offsetWidth;
      state.clampOpts = null;
      updatePinZoomUi(pin);
      schedulePersistPin(pin);
    }, 320);
  }

  function setupPinZoomControls(pin, options) {
    const aspect = getPinAspect(pin);
    const zoomLevel = pin.querySelector('.mouse-screenshot-pin__zoom-level');
    const btnOriginal = pin.querySelector('.mouse-screenshot-pin__zoom-btn--original');
    const btnFit = pin.querySelector('.mouse-screenshot-pin__zoom-btn--fit');
    const zoomTools = pin.querySelector('.mouse-screenshot-pin__zoom-tools');

    pinControls.set(pin, { zoomLevel, btnFit, btnOriginal, aspect });

    const stopBubble = (e) => e.stopPropagation();
    if (zoomTools) zoomTools.addEventListener('pointerdown', stopBubble);
    if (btnFit) {
      btnFit.addEventListener('pointerdown', stopBubble);
      btnFit.addEventListener('click', (e) => {
        e.stopPropagation();
        bringToFront(pin);
        setPinDisplayWidthAnimated(pin, computePinFitDisplayWidth(pin), aspect, {
          instantSnap: true
        });
      });
    }
    if (btnOriginal) {
      btnOriginal.addEventListener('pointerdown', stopBubble);
      btnOriginal.addEventListener('click', (e) => {
        e.stopPropagation();
        bringToFront(pin);
        setPinDisplayWidthAnimated(pin, getPinOriginalDisplayWidth(pin), aspect, {
          allowFullNatural: true,
          instantSnap: true
        });
      });
    }
    updatePinZoomUi(pin);
  }

  function clampPinDisplayWidth(pin, newW, aspect, options) {
    const opts = options || {};
    const natW = getPinNatW(pin);
    let w = Math.max(MIN_DISPLAY_W, Number(newW));
    let h = Math.round(w / aspect);

    if (opts.allowFullNatural) {
      return Math.max(MIN_DISPLAY_W, Math.min(Math.round(w), natW));
    }

    const origLeft = pin.offsetLeft;
    const origTop = pin.offsetTop;
    const vw = global.innerWidth || 800;
    const vh = global.innerHeight || 600;
    const maxW = Math.max(MIN_DISPLAY_W, natW, MAX_DISPLAY_W * 2, vw - origLeft - 8);
    const maxH = Math.max(48, vh - origTop - 8);

    if (w > maxW) {
      w = maxW;
      h = Math.round(w / aspect);
    }
    if (h > maxH && w < natW - 1) {
      h = maxH;
      w = Math.round(h * aspect);
    }
    return Math.max(MIN_DISPLAY_W, Math.round(w));
  }

  function applyPinDisplayWidth(pin, newW, aspect, clampOptions) {
    pin.style.width =
      clampPinDisplayWidth(pin, newW, aspect, clampOptions) + 'px';
    updatePinZoomUi(pin);
  }

  function stopWheelZoomAnimation(pin) {
    const state = pinWheelZoomState.get(pin);
    if (!state) return;
    if (state.animId != null) {
      cancelAnimationFrame(state.animId);
      state.animId = null;
    }
  }

  function runWheelZoomFrame(pin) {
    const state = pinWheelZoomState.get(pin);
    if (!state || !pin.isConnected) {
      stopWheelZoomAnimation(pin);
      return;
    }
    const cur = pin.offsetWidth;
    const target = state.targetW;
    const diff = target - cur;
    if (Math.abs(diff) < 0.6) {
      applyPinDisplayWidth(pin, target, state.aspect, state.clampOpts);
      schedulePersistPin(pin, { live: true });
      state.animId = null;
      state.clampOpts = null;
      if (Date.now() - state.lastWheelAt > 100) {
        pin.classList.remove('is-wheel-zooming');
        schedulePersistPin(pin, { flush: true });
      } else {
        state.animId = requestAnimationFrame(() => runWheelZoomFrame(pin));
      }
      return;
    }
    applyPinDisplayWidth(
      pin,
      cur + diff * WHEEL_ZOOM_LERP,
      state.aspect,
      state.clampOpts
    );
    schedulePersistPin(pin, { live: true });
    state.animId = requestAnimationFrame(() => runWheelZoomFrame(pin));
  }

  function setupWheelZoom(pin, aspect) {
    const state = {
      aspect,
      targetW: 0,
      animId: null,
      wheelPersistTimer: null,
      lastWheelAt: 0,
      clampOpts: null
    };
    pinWheelZoomState.set(pin, state);

    pin.addEventListener(
      'wheel',
      (e) => {
        if (!pin.isConnected) return;
        e.preventDefault();
        e.stopPropagation();
        bringToFront(pin);
        if (!state.targetW) state.targetW = pin.offsetWidth;
        const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENS);
        state.targetW = clampPinDisplayWidth(pin, state.targetW * factor, aspect);
        state.lastWheelAt = Date.now();
        pin.classList.add('is-wheel-zooming');
        if (state.animId == null) {
          state.animId = requestAnimationFrame(() => runWheelZoomFrame(pin));
        }
        if (state.wheelPersistTimer) clearTimeout(state.wheelPersistTimer);
        state.wheelPersistTimer = setTimeout(() => {
          state.wheelPersistTimer = null;
          pin.classList.remove('is-wheel-zooming');
          state.targetW = pin.offsetWidth;
          updatePinZoomUi(pin);
          schedulePersistPin(pin, { flush: true });
        }, 320);
      },
      { passive: false, capture: true }
    );
  }

  function setupResize(pin, handle, aspect) {
    let resize = null;
    const onMove = (e) => {
      if (!resize) return;
      const dx = e.clientX - resize.startX;
      applyPinDisplayWidth(pin, resize.startW + dx, aspect);
      schedulePersistPin(pin, { live: true });
    };
    const onUp = () => {
      if (!resize) return;
      resize = null;
      pin.classList.remove('is-resizing');
      global.removeEventListener('pointermove', onMove, true);
      global.removeEventListener('pointerup', onUp, true);
      global.removeEventListener('pointercancel', onUp, true);
      void schedulePersistPin(pin, { flush: true });
    };
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      bringToFront(pin);
      resize = {
        startX: e.clientX,
        startY: e.clientY,
        startW: pin.offsetWidth,
        origLeft: pin.offsetLeft,
        origTop: pin.offsetTop
      };
      pin.classList.add('is-resizing');
      handle.setPointerCapture(e.pointerId);
      global.addEventListener('pointermove', onMove, true);
      global.addEventListener('pointerup', onUp, true);
      global.addEventListener('pointercancel', onUp, true);
    });
  }

  function addScreenshotPin(options) {
    if (!ensureTopFrame()) {
      return Promise.reject(new Error('need_top_frame'));
    }
    const root = getRoot();
    if (!root) return Promise.reject(new Error('no_root'));

    const dataUrl = options && options.dataUrl;
    if (!dataUrl || typeof dataUrl !== 'string') {
      return Promise.reject(new Error('no_image'));
    }

    const natW = Math.max(1, (options.width | 0) || 1);
    const natH = Math.max(1, (options.height | 0) || 1);
    const forcedW = options.displayW > 0 ? options.displayW | 0 : 0;
    const size = computeDisplaySize(natW, natH, forcedW);
    const pos =
      typeof options.x === 'number' && typeof options.y === 'number'
        ? {
            x: Math.max(0, options.x),
            y: Math.max(0, options.y)
          }
        : defaultPinPosition(size.displayW, size.displayH, countPinsInDom());

    const storageId = (options.pinId && String(options.pinId)) || nextPinId();
    syncPinSeqFromId(storageId);
    const pinDomId = 'mouse-screenshot-pin-' + ++pinSeq;
    const skipPersist = options.skipPersist === true;
    const pinOrder =
      options.pinOrder > 0 ? options.pinOrder | 0 : getNextPinOrder();

    const pin = createScreenshotPinElement('div');
    pin.className = PIN_CLASS;
    pin.dataset.pinId = pinDomId;
    pin.dataset.storagePinId = storageId;
    pin.dataset.pinOrder = String(pinOrder);
    pin.dataset.natW = String(natW);
    pin.dataset.natH = String(natH);
    pinDataUrlByStorageId.set(storageId, dataUrl);
    /** skipPersist：仅跳过首帧写入（已在 IndexedDB）；勿设 dataset，否则后续拖动无法保存 */
    if (skipPersist) {
      pin.dataset.imagePersisted = '1';
    }
    pin.style.left = pos.x + 'px';
    pin.style.top = pos.y + 'px';
    pin.style.width = size.displayW + 'px';
    bringToFront(pin);

    const bar = createScreenshotPinElement('div');
    bar.className = 'mouse-screenshot-pin__bar';
    const orderLabel = createScreenshotPinElement('span');
    orderLabel.className = 'mouse-screenshot-pin__order';
    orderLabel.textContent = '';

    const zoomTools = createScreenshotPinElement('div');
    zoomTools.className = 'mouse-screenshot-pin__zoom-tools';
    const zoomLevel = createScreenshotPinElement('span');
    zoomLevel.className = 'mouse-screenshot-pin__zoom-level';
    zoomLevel.setAttribute('aria-live', 'polite');
    const btnOriginal = createScreenshotPinElement('button');
    btnOriginal.type = 'button';
    btnOriginal.className =
      'mouse-screenshot-pin__zoom-btn mouse-screenshot-pin__zoom-btn--original';
    btnOriginal.textContent =
      options.zoomOriginalLabel ||
      pinMsg('screenshotPinZoomOriginal', null, '1:1');
    btnOriginal.title =
      options.zoomOriginalTitle ||
      pinMsg('screenshotPreviewZoomOneToOneTitle', null, 'Original size');
    const btnFit = createScreenshotPinElement('button');
    btnFit.type = 'button';
    btnFit.className = 'mouse-screenshot-pin__zoom-btn mouse-screenshot-pin__zoom-btn--fit';
    btnFit.textContent =
      options.zoomFitLabel || pinMsg('screenshotPinZoomFit', null, 'Fit');
    btnFit.title =
      options.zoomFitTitle ||
      pinMsg('screenshotPreviewZoomFitTitle', null, 'Fit to view');
    zoomTools.appendChild(zoomLevel);
    zoomTools.appendChild(btnOriginal);
    zoomTools.appendChild(btnFit);

    const btnClose = createScreenshotPinElement('button');
    btnClose.type = 'button';
    btnClose.className = 'mouse-screenshot-pin__close';
    btnClose.title = options.closeTitle || pinMsg('screenshotPinClose', null, 'Remove');
    btnClose.setAttribute('aria-label', btnClose.title);
    btnClose.textContent = '×';
    bar.appendChild(orderLabel);
    bar.appendChild(zoomTools);
    bar.appendChild(btnClose);

    const imgWrap = createScreenshotPinElement('div');
    imgWrap.className = 'mouse-screenshot-pin__img-wrap';
    const img = createScreenshotPinElement('img');
    img.alt = '';
    img.draggable = false;

    const resize = createScreenshotPinElement('span');
    resize.className = 'mouse-screenshot-pin__resize';
    resize.title = options.resizeTitle || pinMsg('screenshotPinResize', null, 'Resize');

    imgWrap.appendChild(img);
    imgWrap.appendChild(resize);
    pin.appendChild(bar);
    pin.appendChild(imgWrap);
    root.appendChild(pin);

    pin.addEventListener('pointerdown', () => bringToFront(pin));
    btnClose.addEventListener('click', (e) => {
      e.stopPropagation();
      clearPersistSchedulers(storageId);
      stopWheelZoomAnimation(pin);
      pinWheelZoomState.delete(pin);
      pinControls.delete(pin);
      pinDataUrlByStorageId.delete(storageId);
      pinSaveRev.delete(storageId);
      pinDrainRetries.delete(storageId);
      pinPendingSave.delete(storageId);
      removePersistedPin(storageId);
      removePinElement(pin);
      refreshAllPinOrderLabels();
    });
    btnClose.addEventListener('pointerdown', (e) => e.stopPropagation());
    resize.addEventListener('pointerdown', (e) => e.stopPropagation());

    setupPinBarAutoHide(pin);
    setupDrag(pin);
    setupResize(pin, resize, size.aspect);
    setupWheelZoom(pin, size.aspect);
    setupPinZoomControls(pin, options);
    refreshAllPinOrderLabels();

    return new Promise((resolve, reject) => {
      let settled = false;
      const finishOk = () => {
        if (settled) return;
        settled = true;
        updatePinZoomUi(pin);
        if (!skipPersist) {
          persistPinToStorage(pin, dataUrl, true);
        }
        resolve({ success: true, pinId: storageId });
      };
      const finishErr = () => {
        if (settled) return;
        settled = true;
        pinDataUrlByStorageId.delete(storageId);
        pinSaveRev.delete(storageId);
        pinDrainRetries.delete(storageId);
        pinPendingSave.delete(storageId);
        removePinElement(pin);
        reject(new Error('pin_image_load_failed'));
      };
      img.onload = finishOk;
      img.onerror = finishErr;
      img.src = dataUrl;
      if (img.complete && img.naturalWidth > 0) {
        finishOk();
      }
    });
  }

  function clearAllScreenshotPins() {
    if (!ensureTopFrame()) return { success: true, removed: 0 };
    const root = findPinsRoot();
    if (!root) return { success: true, removed: 0 };
    const n = root.querySelectorAll('.' + PIN_CLASS).length;
    root.innerHTML = '';
    pinDataUrlByStorageId.clear();
    pinSaveRev.clear();
    pinPendingSave.clear();
    pinDrainRetries.clear();
    pinSaveChains.clear();
    persistTimers.forEach((tid) => clearTimeout(tid));
    persistTimers.clear();
    pinSaveDebounceTimers.forEach((tid) => clearTimeout(tid));
    pinSaveDebounceTimers.clear();
    sendStorageMessage({
      action: 'clearPageScreenshotPins',
      pageScopeKey: getPageScopeKey()
    }).catch(() => {});
    return { success: true, removed: n };
  }

  function teardownPinsUi() {
    const root = findPinsRoot();
    if (root) root.innerHTML = '';
    pinDataUrlByStorageId.clear();
    pinSaveRev.clear();
    pinPendingSave.clear();
    pinDrainRetries.clear();
    pinSaveChains.clear();
    persistTimers.forEach((tid) => clearTimeout(tid));
    persistTimers.clear();
    pinSaveDebounceTimers.forEach((tid) => clearTimeout(tid));
    pinSaveDebounceTimers.clear();
    zTop = Z_BASE;
    pinSeq = 0;
  }

  function installSpaPinRestoreHooks() {
    const fire = () => {
      global.requestAnimationFrame(() => restorePagePins());
    };
    global.addEventListener('popstate', fire);
    global.addEventListener('hashchange', fire);
    const ps = history.pushState;
    const rs = history.replaceState;
    if (
      typeof ps === 'function' &&
      typeof rs === 'function' &&
      !history.__mouseScreenshotPinsHooked
    ) {
      history.pushState = function () {
        const ret = ps.apply(this, arguments);
        fire();
        return ret;
      };
      history.replaceState = function () {
        const ret = rs.apply(this, arguments);
        fire();
        return ret;
      };
      history.__mouseScreenshotPinsHooked = true;
    }
  }

  function removeScreenshotPinById(pinId) {
    if (!pinId) return { success: false };
    const root = findPinsRoot();
    const el = root
      ? root.querySelector(
          '.' + PIN_CLASS + '[data-storage-pin-id="' + pinId + '"], .' + PIN_CLASS + '[data-pin-id="' + pinId + '"]'
        )
      : null;
    if (!el) return { success: false, error: 'not_found' };
    const sid = el.dataset.storagePinId || pinId;
    clearPersistSchedulers(sid);
    pinSaveRev.delete(sid);
    pinPendingSave.delete(sid);
    pinDrainRetries.delete(sid);
    removePersistedPin(sid);
    removePinElement(el);
    refreshAllPinOrderLabels();
    return { success: true };
  }

  function restorePagePins() {
    if (!ensureTopFrame()) return;
    const scope = getPageScopeKey();
    if (!scope || scope.indexOf('chrome-extension://') === 0) return;

    if (restoreInFlight && scope === lastRestoreScope) return;

    if (lastRestoreScope != null && scope !== lastRestoreScope) {
      teardownPinsUi();
    }

    lastRestoreScope = scope;
    restoreInFlight = true;

    sendStorageMessage({ action: 'listPageScreenshotPins', pageScopeKey: scope })
      .then((res) => {
        if (getPageScopeKey() !== scope) return;
        const pins = (res && res.pins) || [];
        const jobs = [];
        pins.forEach((p, index) => {
          if (!p || !p.id || !p.dataUrl || hasPinInDom(p.id)) return;
          jobs.push(
            addScreenshotPin({
              pinId: p.id,
              pinOrder: p.pinOrder != null ? p.pinOrder : index + 1,
              dataUrl: p.dataUrl,
              width: p.width,
              height: p.height,
              x: p.x,
              y: p.y,
              displayW: p.displayW,
              title: p.title,
              closeTitle: p.closeTitle,
              resizeTitle: p.resizeTitle,
              skipPersist: true
            })
          );
        });
        return Promise.allSettled(jobs);
      })
      .then(() => {
        refreshAllPinOrderLabels();
      })
      .catch(() => {})
      .finally(() => {
        if (getPageScopeKey() === scope) {
          restoreInFlight = false;
        }
      });
  }

  function initRestore() {
    if (!ensureTopFrame()) return;
    initPinTrailColorSync();
    installSpaPinRestoreHooks();
    global.addEventListener('pagehide', () => {
      void flushAllPinLayouts();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void flushAllPinLayouts();
      } else if (document.visibilityState === 'visible') {
        restorePagePins();
      }
    });
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', restorePagePins, { once: true });
    } else {
      restorePagePins();
    }
  }

  global.MouseScreenshotPins = { addScreenshotPin };

  function isAuthorizedPinMessage(message, sender) {
    if (!sender || sender.id !== chrome.runtime.id) return false;
    const token = global.__MOUSE_PIN_MSG_TOKEN__;
    if (message._pinToken && token && message._pinToken === token) return true;
    if (sender.tab == null) {
      const u = sender.url ? String(sender.url) : '';
      return u.startsWith('chrome-extension://') || u.startsWith('moz-extension://');
    }
    return false;
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !message.action) return false;

      const pinActions = [
        'addScreenshotPin',
        'clearScreenshotPins',
        'removeScreenshotPin',
        'pingScreenshotPins'
      ];
      if (pinActions.includes(message.action)) {
        if (!isAuthorizedPinMessage(message, sender)) {
          sendResponse({ success: false, error: 'unauthorized' });
          return true;
        }
      }

      if (message.action === 'addScreenshotPin') {
        addScreenshotPin({
          dataUrl: message.dataUrl,
          width: message.width,
          height: message.height,
          x: message.x,
          y: message.y,
          title: message.title,
          closeTitle: message.closeTitle,
          resizeTitle: message.resizeTitle
        })
          .then((r) => sendResponse(r))
          .catch((e) => sendResponse({ success: false, error: (e && e.message) || 'pin_failed' }));
        return true;
      }
      if (message.action === 'clearScreenshotPins') {
        sendResponse(clearAllScreenshotPins());
        return true;
      }
      if (message.action === 'removeScreenshotPin') {
        sendResponse(removeScreenshotPinById(message.pinId));
        return true;
      }
      if (message.action === 'pingScreenshotPins') {
        sendResponse({ ready: true });
        return true;
      }
      return false;
    });
  }

  initRestore();
})(typeof window !== 'undefined' ? window : self);
