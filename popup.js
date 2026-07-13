// 配置常量 - 消除硬编码问题
/** 须与 popup.css :root 中 --settings-ui-content-width / --settings-ui-pad-x 数值一致 */
const SETTINGS_LAYOUT = {
  CONTENT_WIDTH_PX: 484,
};

function detachedSettingsWindowOuterWidthPx() {
  return SETTINGS_LAYOUT.CONTENT_WIDTH_PX;
}

const CONFIG = {
  STATUS_MESSAGE_DURATION: 3000,
  FADE_DURATION: 300,
  DEBOUNCE_DELAY: 180,
  WHEEL_STEP: 1,
  MAX_PREVIEW_DELAY: 5000,
  PREVIEW_MAX_WINDOWS_LIMIT_MAX: 50,
  PREVIEW_MAX_WINDOWS_UNLIMITED_SLIDER_VALUE: 51,
  LOADING_ANIMATION_INTERVAL: 300,
  RESET_BUTTON_DISABLE_DURATION: 2000,
  /** 鼠标悬停在滑块设置行上多久后，才允许滚轮改数值（避免滚动设置页时误调） */
  WHEEL_ARM_HOVER_MS: 1500,
  DISABLED_SITES_MAX_ENTRIES: 200,
  DISABLED_SITES_MAX_ENTRY_LEN: 256
};

const POPUP_SETTINGS_API = globalThis.MouseExtSettings;
const POPUP_PREVIEW_DEFAULTS = POPUP_SETTINGS_API.getPreviewDefaults();
const POPUP_UI_DEFAULTS = POPUP_SETTINGS_API.getUiDefaults();

function normalizeDisabledSitesList(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || '')
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean);
  return raw
    .slice(0, CONFIG.DISABLED_SITES_MAX_ENTRIES)
    .map((s) => String(s).slice(0, CONFIG.DISABLED_SITES_MAX_ENTRY_LEN));
}

function cleanDisabledSiteHost(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\*\./, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '')
    .slice(0, CONFIG.DISABLED_SITES_MAX_ENTRY_LEN);
}

function extractDisabledSiteEntry(input) {
  const value = String(input || '').trim();
  if (!value) return '';
  const compact = value.replace(/\s+/g, '');
  const urlCandidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(compact)
    ? compact
    : compact.startsWith('//')
      ? `https:${compact}`
      : `https://${compact}`;
  try {
    const url = new URL(urlCandidate);
    const host = cleanDisabledSiteHost(url.hostname);
    if (host) return host;
  } catch (e) { /* fall back to manual cleanup */ }

  const withoutScheme = compact
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^\/\//, '');
  const hostPart = withoutScheme
    .split(/[/?#]/)[0]
    .split('@')
    .pop()
    .replace(/:\d+$/, '');
  return cleanDisabledSiteHost(hostPart || compact);
}

function getDisabledSiteCompareKey(entry) {
  return extractDisabledSiteEntry(entry);
}

function getDisabledSitesTextarea() {
  return document.getElementById('disabled-sites-list');
}

function getDisabledSitesListFromUi() {
  const el = getDisabledSitesTextarea();
  return normalizeDisabledSitesList(el ? el.value : '');
}

function setDisabledSitesListUi(list, shouldRender = true) {
  const normalized = normalizeDisabledSitesList(list);
  const el = getDisabledSitesTextarea();
  if (el) el.value = normalized.join('\n');
  if (shouldRender) renderDisabledSitesList(normalized);
  return normalized;
}

function renderDisabledSitesList(list = null) {
  const container = document.getElementById('disabled-sites-list-display');
  if (!container) return;
  const sites = normalizeDisabledSitesList(list == null ? getDisabledSitesListFromUi() : list);
  container.textContent = '';

  if (!sites.length) {
    const empty = document.createElement('div');
    empty.className = 'disabled-sites-empty';
    empty.textContent = getI18nMessage('disabledSitesEmpty', 'No disabled sites yet.');
    container.appendChild(empty);
    return;
  }

  const removeLabel = getI18nMessage('removeDisabledSite', 'Remove this site');
  sites.forEach((site, index) => {
    const row = document.createElement('div');
    row.className = 'disabled-site-row';
    row.setAttribute('role', 'listitem');

    const text = document.createElement('span');
    text.className = 'disabled-site-row__text';
    text.textContent = site;
    text.title = site;

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'disabled-site-remove';
    removeButton.dataset.index = String(index);
    removeButton.textContent = '';
    removeButton.title = removeLabel;
    removeButton.setAttribute('aria-label', `${removeLabel}: ${site}`);

    row.appendChild(text);
    row.appendChild(removeButton);
    container.appendChild(row);
  });
}

function addDisabledSiteEntry(input, options = {}) {
  const entry = extractDisabledSiteEntry(input);
  if (!entry) {
    showSectionSaveStatus(
      'customized-save-status',
      options.invalidMessageKey || 'disabledSiteInvalid',
      true
    );
    return false;
  }

  const list = getDisabledSitesListFromUi();
  const key = getDisabledSiteCompareKey(entry);
  const exists = list.some((site) => getDisabledSiteCompareKey(site) === key);
  if (exists) {
    showSectionSaveStatus('customized-save-status', 'disabledSiteAlreadyExists', true);
    return false;
  }

  if (list.length >= CONFIG.DISABLED_SITES_MAX_ENTRIES) {
    showSectionSaveStatus('customized-save-status', 'disabledSitesLimitReached', true);
    return false;
  }

  list.push(entry);
  setDisabledSitesListUi(list, true);
  saveSettingsImmediate({ sectionSaveStatusId: 'customized-save-status' });
  return true;
}

function removeDisabledSiteAtIndex(index) {
  const list = getDisabledSitesListFromUi();
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return false;
  list.splice(index, 1);
  setDisabledSitesListUi(list, true);
  saveSettingsImmediate({ sectionSaveStatusId: 'customized-save-status' });
  return true;
}

function getCurrentTabDomainForDisabledSites(callback) {
  if (!chrome.tabs || typeof chrome.tabs.query !== 'function') {
    callback('');
    return;
  }

  function domainFromTab(tab) {
    const url = tabVisibleUrl(tab);
    if (!url || tabUrlLooksLikeOurExtensionSettings(url)) return '';
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      return cleanDisabledSiteHost(parsed.hostname);
    } catch (e) {
      return '';
    }
  }

  function callbackFromTabs(tabs) {
    const list = Array.isArray(tabs) ? tabs : [];
    const active = list.find((tab) => tab && tab.active);
    const candidate = active || list.slice().sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    callback(domainFromTab(candidate));
  }

  function fallbackLastFocusedWindow() {
    if (!chrome.windows || typeof chrome.windows.getLastFocused !== 'function') {
      chrome.tabs.query({}, (tabs) => {
        if (chrome.runtime.lastError) {
          callback('');
          return;
        }
        callbackFromTabs(
          (tabs || []).filter((tab) => {
            const url = tabVisibleUrl(tab);
            return url && !tabUrlLooksLikeOurExtensionSettings(url);
          })
        );
      });
      return;
    }
    chrome.windows.getLastFocused({ windowTypes: ['normal'] }, (win) => {
      if (chrome.runtime.lastError || !win || win.id == null) {
        callback('');
        return;
      }
      chrome.tabs.query({ windowId: win.id }, (tabs) => {
        if (chrome.runtime.lastError) {
          callback('');
          return;
        }
        callbackFromTabs(tabs);
      });
    });
  }

  function queryActiveLastFocused() {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        fallbackLastFocusedWindow();
        return;
      }
      const domain = domainFromTab(tabs && tabs[0]);
      if (domain) {
        callback(domain);
        return;
      }
      fallbackLastFocusedWindow();
    });
  }

  const inDetachedSettings =
    typeof document !== 'undefined' &&
    document.body &&
    document.body.classList.contains('detached-popup');

  if (!inDetachedSettings) {
    queryActiveLastFocused();
    return;
  }

  try {
    chrome.windows.getCurrent((currentWin) => {
      if (chrome.runtime.lastError || !currentWin || currentWin.id == null) {
        queryActiveLastFocused();
        return;
      }
      const sess = chrome.storage.session;
      sess.get(DETACHED_WINDOW_SESSION_KEY, (data) => {
        if (chrome.runtime.lastError) {
          queryActiveLastFocused();
          return;
        }
        const rec = data && data[DETACHED_WINDOW_SESSION_KEY];
        if (rec && rec.detachedWindowId === currentWin.id && rec.browserActiveTabId != null) {
          chrome.tabs.get(rec.browserActiveTabId, (tab) => {
            const domain = chrome.runtime.lastError ? '' : domainFromTab(tab);
            if (domain) {
              callback(domain);
              return;
            }
            if (rec.browserWindowId != null) {
              chrome.tabs.query({ active: true, windowId: rec.browserWindowId }, (tabs) => {
                const fallbackDomain = chrome.runtime.lastError ? '' : domainFromTab(tabs && tabs[0]);
                if (fallbackDomain) {
                  callback(fallbackDomain);
                  return;
                }
                fallbackLastFocusedWindow();
              });
              return;
            }
            fallbackLastFocusedWindow();
          });
          return;
        }
        queryActiveLastFocused();
      });
    });
  } catch (e) {
    queryActiveLastFocused();
  }
}

function addCurrentTabDomainToDisabledSites() {
  const button = document.getElementById('add-current-disabled-site');
  if (button) button.disabled = true;
  getCurrentTabDomainForDisabledSites((domain) => {
    if (button) button.disabled = false;
    if (!domain) {
      showSectionSaveStatus('customized-save-status', 'currentSiteUnsupported', true);
      return;
    }
    addDisabledSiteEntry(domain, { invalidMessageKey: 'currentSiteUnsupported' });
  });
}

function persistSettingsToStorage(settings, onComplete) {
  const disabledSites = normalizeDisabledSitesList(settings.disabledSites);
  const syncPayload = Object.assign({}, settings);
  delete syncPayload.disabledSites;
  const done = typeof onComplete === 'function' ? onComplete : handleSaveResponse;
  chrome.storage.local.set({ disabledSites }, () => {
    chrome.storage.sync.set(syncPayload, done);
  });
}

function loadSettingsData(defaults, callback) {
  let syncItems = null;
  let localItems = null;

  function finishWhenReady() {
    if (!syncItems || !localItems) return;
    const items = Object.assign({}, syncItems);
    items.disabledSites = Array.isArray(localItems.disabledSites) ? localItems.disabledSites : [];
    callback(items);
  }

  chrome.storage.sync.get(defaults, (items) => {
    syncItems = items || defaults;
    finishWhenReady();
  });
  chrome.storage.local.get({ disabledSites: [] }, (items) => {
    localItems = items || { disabledSites: [] };
    finishWhenReady();
  });
}

/** 与 background.js 中 DETACHED_WINDOW_RESTORE_KEY 一致，用于独立设置窗关联主浏览器窗口 */
const DETACHED_WINDOW_SESSION_KEY = 'detachedWindowRestore';

/** 防止连点/双击打开多个独立设置窗（create 很快完成时第二下 click 会在解锁之后才派发） */
let detachedSettingsWindowOpenInFlight = false;
let detachedSettingsOpenCooldownTimer = 0;
const DETACHED_SETTINGS_OPEN_COOLDOWN_MS = 750;

function releaseDetachedSettingsOpenLock(immediate) {
  if (detachedSettingsOpenCooldownTimer) {
    clearTimeout(detachedSettingsOpenCooldownTimer);
    detachedSettingsOpenCooldownTimer = 0;
  }
  if (immediate) {
    detachedSettingsWindowOpenInFlight = false;
    return;
  }
  detachedSettingsOpenCooldownTimer = setTimeout(function () {
    detachedSettingsOpenCooldownTimer = 0;
    detachedSettingsWindowOpenInFlight = false;
  }, DETACHED_SETTINGS_OPEN_COOLDOWN_MS);
}

// 公共工具类 - 消除代码重复
const CommonUtils = {
  // 防抖函数
  debounce(func, wait) {
    let timeout;
    function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        timeout = null;
        func.apply(this, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    }
    executedFunction.cancel = () => {
      if (timeout) clearTimeout(timeout);
      timeout = null;
    };
    return executedFunction;
  },

  // 统一的DOM元素获取
  getElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      console.warn(`Element with id "${id}" not found`);
    }
    return element;
  },

  // 统一的事件监听器添加
  addChangeListener(selector, callback, statusId = null) {
    const element = this.getElement(selector);
    if (element) {
      element.addEventListener('change', function(event) {
        callback(event);
        if (statusId) {
          showSectionSaveStatus(statusId, 'settingsSaved');
        }
      });
    }
  },

  // 统一的输入事件监听器
  addInputListener(selector, valueSelector, callback = null) {
    const element = this.getElement(selector);
    const valueElement = this.getElement(valueSelector);
    
    if (element && valueElement) {
      element.addEventListener('input', function() {
        valueElement.textContent = this.value;
        if (callback) callback();
      });
    }
  },

  // 统一的设置保存
  saveSettings() {
    persistSettingsToStorage(getSettingsSnapshot());
  },

  // 统一的错误处理
  handleError(error, context = 'Unknown') {
    console.error(`Error in ${context}:`, error.message);
    showStatusMessage('saveError', true);
  }
};

/** storage.sync.set 成功后的统一收尾（可选在对应分区显示「已保存」） */
function finalizeSave(sectionSaveStatusId) {
  if (chrome.runtime.lastError) {
    CommonUtils.handleError(chrome.runtime.lastError, 'saveSettings');
    return;
  }
  showStatusMessage('settingsSaved');
  if (sectionSaveStatusId) {
    showSectionSaveStatus(sectionSaveStatusId, 'settingsSaved');
  }
}

// 统一的保存响应处理
function handleSaveResponse() {
  finalizeSave(null);
}

// 默认设置
const defaultSettings = {
  enableGesture: true,
  showGestureTrail: true,
  showGestureHint: true,
  trailColor: '#FF9ECD',
  trailWidth: 3,
  enableSuperDrag: true,
  superDragCompassPosition: 'compassHub',
  enableDragTextSearch: true,
  enableSplitScrollSync: false,
  autoDownloadOnDragFile: false,
  enableImageDrag: true,
  enableImagePreview: false,
  enableImagePreviewEnhanced: false,
  enableDuplicateCheck: true,
  autoCloseDetectedTabs: false,
  enableSmoothScroll: true,
  enableDebugPanel: false,
  showTabCountBadge: true,
  unlockPageRestrictions: false,
  language: getBrowserLanguage(), // 自动获取浏览器语言
  theme: 'light',
  ...POPUP_UI_DEFAULTS,
  
  // 超级拖拽方向自定义默认值
  dragUpAction: 'background',
  dragUpRightAction: 'foreground',
  dragRightAction: 'background',
  dragDownRightAction: 'foreground',
  dragDownAction: 'background',
  dragDownLeftAction: 'popupView',
  dragLeftAction: 'background',
  dragUpLeftAction: 'splitLeft',
  // 超级拖拽搜索引擎URL
  dragSearchEngine: 'https://www.google.com/search?q={q}',
  dragUpSearchEngine: '',
  dragUpRightSearchEngine: '',
  dragRightSearchEngine: '',
  dragDownRightSearchEngine: '',
  dragDownSearchEngine: '',
  dragDownLeftSearchEngine: '',
  dragLeftSearchEngine: '',
  dragUpLeftSearchEngine: '',
  
  // 小窗视图的默认设置
  ...POPUP_PREVIEW_DEFAULTS,
  
  // 手势动作自定义设置
  gestureLeftAction: 'goBack',
  gestureRightAction: 'forward',
  gestureUpAction: 'scrollUp',
  gestureDownAction: 'scrollDown',
  gestureDownThenRightAction: 'closeTab',
  gestureLeftThenUpAction: 'reopenClosedTab',
  gestureRightThenUpAction: 'openNewTab',
  gestureRightThenDownAction: 'refresh',
  gestureUpThenLeftAction: 'switchToLeftTab',
  gestureUpThenRightAction: 'switchToRightTab',
  gestureDownThenLeftAction: 'stopLoading',
  gestureLeftThenDownAction: 'forceRefresh',
  gestureUpThenDownAction: 'scrollToBottom',
  gestureDownThenUpAction: 'scrollToTop',
  gestureLeftThenRightAction: 'closeTab',
  gestureRightThenLeftAction: 'reopenClosedTab',
  gestureRightHoldWheelUpAction: 'scrollToTop',
  gestureRightHoldWheelDownAction: 'scrollToBottom',
  gestureLeftHoldWheelUpAction: 'noAction',
  gestureLeftHoldWheelDownAction: 'noAction',
  gestureRightHoldLeftClickAction: 'noAction',
  gestureLeftHoldRightClickAction: 'noAction',
  enableScreenshotFeature: true,
  enableScreenshotTrailCapture: false,
  enableScreenshotClipboard: false,
  enableScreenshotPreview: true,
  enableScreenshotHistory: true,
  screenshotHistoryMaxCount: 50,
  screenshotHotkeyOpenHistory: 'alt+digit6',
  screenshotHotkeyRegion: 'alt+digit7',
  screenshotHotkeyViewport: 'alt+digit8',
  screenshotHotkeyFullPage: 'alt+digit9',
  screenshotHotkeyScrolling: 'alt+digit0',
  disabledSites: []
};

const SCREENSHOT_HISTORY_UNLIMITED = 0;
const SCREENSHOT_HISTORY_MIN_COUNT = 1;
const SCREENSHOT_HISTORY_MAX_COUNT = 200;

function clampScreenshotHistoryMaxCountUI(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return resetConfig.screenshotHistoryMaxCount;
  if (v === SCREENSHOT_HISTORY_UNLIMITED) return SCREENSHOT_HISTORY_UNLIMITED;
  return Math.min(
    SCREENSHOT_HISTORY_MAX_COUNT,
    Math.max(SCREENSHOT_HISTORY_MIN_COUNT, v)
  );
}

function formatScreenshotHistoryMaxCountLabel(count) {
  if (count === SCREENSHOT_HISTORY_UNLIMITED) {
    return chrome.i18n.getMessage('screenshotHistoryUnlimited') || 'Unlimited';
  }
  return String(count);
}

function applyScreenshotHistoryMaxCountUI(count) {
  const c = clampScreenshotHistoryMaxCountUI(count);
  const range = document.getElementById('screenshot-history-max-count');
  const valueEl = document.getElementById('screenshot-history-max-count-value');
  if (range) range.value = String(c);
  if (valueEl) valueEl.textContent = formatScreenshotHistoryMaxCountLabel(c);
  return c;
}

function updateScreenshotHistoryMaxCountDisplay() {
  const range = document.getElementById('screenshot-history-max-count');
  const valueEl = document.getElementById('screenshot-history-max-count-value');
  if (!range || !valueEl) return;
  const c = clampScreenshotHistoryMaxCountUI(range.value);
  valueEl.textContent = formatScreenshotHistoryMaxCountLabel(c);
}

function trimScreenshotHistoryToStoredLimit() {
  const max = applyScreenshotHistoryMaxCountUI(
    document.getElementById('screenshot-history-max-count')?.value
  );
  if (max === SCREENSHOT_HISTORY_UNLIMITED) return;
  chrome.runtime.sendMessage({ action: 'trimScreenshotHistory', maxCount: max }, () => {
    if (chrome.runtime.lastError) {
      CommonUtils.handleError(chrome.runtime.lastError, 'trimScreenshotHistory');
    }
  });
}

const SCREENSHOT_HOTKEY_FIELD_IDS = [
  { id: 'screenshot-hotkey-open-history', storageKey: 'screenshotHotkeyOpenHistory' },
  { id: 'screenshot-hotkey-region', storageKey: 'screenshotHotkeyRegion' },
  { id: 'screenshot-hotkey-viewport', storageKey: 'screenshotHotkeyViewport' },
  { id: 'screenshot-hotkey-fullpage', storageKey: 'screenshotHotkeyFullPage' },
  { id: 'screenshot-hotkey-scrolling', storageKey: 'screenshotHotkeyScrolling' }
];

function isScreenshotModifierCode(code) {
  return /^(alt|control|ctrl|shift|meta|os)(left|right)?$/i.test(String(code || '').toLowerCase());
}

function isScreenshotFnKeyCode(code) {
  return /^f([1-9]|1[0-2])$/i.test(String(code || '').toLowerCase());
}

function isScreenshotLetterDigitCode(code) {
  const c = String(code || '').toLowerCase();
  return /^key[a-z]$/.test(c) || /^digit\d$/.test(c);
}

/** 存储串是否合法（过滤 alt+altleft 等误录） */
function isValidScreenshotHotkeyStorage(storageStr) {
  const str = storageStr == null ? '' : String(storageStr).trim();
  if (!str) return true;
  const segs = str.toLowerCase().split('+').map((x) => x.trim()).filter(Boolean);
  if (!segs.length) return false;
  const modSet = new Set(['ctrl', 'control', 'alt', 'shift', 'meta']);
  const normCode = (seg) => {
    const s = seg.toLowerCase();
    if (/^[a-z]$/.test(s)) return 'key' + s;
    if (/^\d$/.test(s)) return 'digit' + s;
    return s;
  };
  if (segs.length === 1) {
    return isScreenshotFnKeyCode(normCode(segs[0]));
  }
  const code = normCode(segs[segs.length - 1]);
  if (isScreenshotModifierCode(code)) return false;
  if (!isScreenshotFnKeyCode(code) && !isScreenshotLetterDigitCode(code)) return false;
  const mods = segs.slice(0, -1);
  if (isScreenshotLetterDigitCode(code)) {
    return mods.some((m) => modSet.has(m));
  }
  return true;
}

function isValidScreenshotHotkeyRecording(e) {
  if (!e || e.repeat) return false;
  if (e.key === 'Escape') return false;
  if (e.code === 'Tab') return false;
  const code = String(e.code || '').toLowerCase();
  if (isScreenshotModifierCode(code)) return false;
  if (isScreenshotFnKeyCode(code)) return true;
  if (isScreenshotLetterDigitCode(code)) {
    return !!(e.ctrlKey || e.altKey || e.metaKey);
  }
  return false;
}

function formatScreenshotHotkeyStorage(e) {
  if (!isValidScreenshotHotkeyRecording(e) || !e.code) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  if (e.metaKey) parts.push('meta');
  parts.push(String(e.code).toLowerCase());
  const storage = parts.join('+');
  return isValidScreenshotHotkeyStorage(storage) ? storage : null;
}

/** 将存储用 code 段转为界面显示（去掉 Key/Digit 前缀） */
function screenshotHotkeyCodeSegmentToDisplay(seg) {
  const s = String(seg || '').toLowerCase();
  const keyLetter = s.match(/^key([a-z])$/);
  if (keyLetter) return keyLetter[1];
  const digit = s.match(/^digit(\d)$/);
  if (digit) return digit[1];
  const numpad = s.match(/^numpad(\d)$/);
  if (numpad) return numpad[1];
  return s;
}

/** 存储串 ctrl+shift+keyv → 显示 ctrl+shift+v */
function formatScreenshotHotkeyDisplay(storageStr) {
  const str = storageStr == null ? '' : String(storageStr).trim();
  if (!str) return '';
  const segs = str.split('+').map((x) => x.trim()).filter(Boolean);
  if (!segs.length) return '';
  const modSet = new Set(['ctrl', 'control', 'alt', 'shift', 'meta']);
  let mods;
  let keySeg;
  if (segs.length === 1 && modSet.has(segs[0].toLowerCase())) {
    mods = [];
    keySeg = segs[0];
  } else {
    mods = segs.slice(0, -1);
    keySeg = segs[segs.length - 1];
  }
  const key = screenshotHotkeyCodeSegmentToDisplay(keySeg);
  if (mods.length) return mods.join('+') + '+' + key;
  return key;
}

function normalizePreviewModifierKey(value) {
  return POPUP_SETTINGS_API.normalizePreviewModifierKey(value);
}

function normalizePreviewTriggerMode(value, modifierKey) {
  return POPUP_SETTINGS_API.normalizePreviewTriggerMode(value, modifierKey);
}

function normalizePreviewCustomKey(value) {
  return POPUP_SETTINGS_API.normalizePreviewCustomKey(value);
}

function previewCustomKeyDisplay(storageKey) {
  const key = normalizePreviewCustomKey(storageKey);
  if (!key) return '';
  if (key === 'space') return 'space';
  if (key === 'escape') return 'esc';
  return screenshotHotkeyCodeSegmentToDisplay(key);
}

function getPreviewCustomKeyInputStorage() {
  const el = document.getElementById('preview-custom-key');
  if (!el) return '';
  return normalizePreviewCustomKey(el.dataset.previewKeyCode || el.value || '');
}

function setPreviewCustomKeyInputValue(storageKey) {
  const el = document.getElementById('preview-custom-key');
  if (!el) return;
  const normalized = normalizePreviewCustomKey(storageKey);
  el.dataset.previewKeyCode = normalized;
  el.value = previewCustomKeyDisplay(normalized);
}

function isPreviewCustomKeyRecordingEvent(e) {
  if (!e || e.repeat) return false;
  if (e.key === 'Escape' || e.code === 'Tab') return false;
  const code = String(e.code || e.key || '').toLowerCase();
  if (!code) return false;
  return !isScreenshotModifierCode(code);
}

function previewCustomKeyStorageFromEvent(e) {
  if (!isPreviewCustomKeyRecordingEvent(e)) return '';
  return normalizePreviewCustomKey(e.code || e.key || '');
}

function normalizePreviewMaxWindowsStorage(value) {
  const raw = String(value ?? '').trim();
  if (/^unlimited$/i.test(raw)) return 0;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultSettings.previewMaxWindows;
  if (n <= 0 || n >= CONFIG.PREVIEW_MAX_WINDOWS_UNLIMITED_SLIDER_VALUE) return 0;
  return Math.min(CONFIG.PREVIEW_MAX_WINDOWS_LIMIT_MAX, Math.max(1, n));
}

function previewMaxWindowsSliderValue(storageValue) {
  const normalized = normalizePreviewMaxWindowsStorage(storageValue);
  return normalized === 0
    ? CONFIG.PREVIEW_MAX_WINDOWS_UNLIMITED_SLIDER_VALUE
    : normalized;
}

function previewMaxWindowsDisplayFromSlider(sliderValue) {
  const n = parseInt(sliderValue, 10);
  if (Number.isFinite(n) && n >= CONFIG.PREVIEW_MAX_WINDOWS_UNLIMITED_SLIDER_VALUE) {
    return getI18nMessage('unlimited', 'Unlimited');
  }
  const storageValue = normalizePreviewMaxWindowsStorage(sliderValue);
  return storageValue === 0 ? getI18nMessage('unlimited', 'Unlimited') : String(storageValue);
}

function setPreviewMaxWindowsInputValue(storageValue) {
  const slider = document.getElementById('preview-max-windows');
  const valueEl = document.getElementById('preview-max-windows-value');
  if (!slider || !valueEl) return;
  slider.max = String(CONFIG.PREVIEW_MAX_WINDOWS_UNLIMITED_SLIDER_VALUE);
  slider.value = String(previewMaxWindowsSliderValue(storageValue));
  valueEl.textContent = previewMaxWindowsDisplayFromSlider(slider.value);
}

function updatePreviewMaxWindowsDisplay() {
  const slider = document.getElementById('preview-max-windows');
  const valueEl = document.getElementById('preview-max-windows-value');
  if (!slider || !valueEl) return;
  slider.max = String(CONFIG.PREVIEW_MAX_WINDOWS_UNLIMITED_SLIDER_VALUE);
  valueEl.textContent = previewMaxWindowsDisplayFromSlider(slider.value);
}

function getPreviewMaxWindowsStorageValue() {
  const slider = document.getElementById('preview-max-windows');
  return normalizePreviewMaxWindowsStorage(slider ? slider.value : defaultSettings.previewMaxWindows);
}

/** 录制过程中根据当前按键状态生成预览（含仅修饰键） */
function formatScreenshotHotkeyPreviewFromEvent(e) {
  if (!e || e.key === 'Escape' || e.code === 'Tab') return '';
  const parts = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  if (e.metaKey) parts.push('meta');
  const code = String(e.code || '').toLowerCase();
  if (code && !isScreenshotModifierCode(code)) {
    parts.push(code);
  }
  if (!parts.length) return '';
  return formatScreenshotHotkeyDisplay(parts.join('+'));
}

function restoreScreenshotHotkeyInputDisplay(el) {
  if (!el) return;
  const saved = el.dataset.hotkeyStorage;
  if (saved) {
    el.value = formatScreenshotHotkeyDisplay(saved);
  } else {
    el.value = '';
  }
}

function getScreenshotHotkeyPlaceholder() {
  return getI18nMessage('screenshotHotkeyPlaceholder', 'Click to set shortcut');
}

function updateScreenshotHotkeyPlaceholders() {
  const ph = getScreenshotHotkeyPlaceholder();
  SCREENSHOT_HOTKEY_FIELD_IDS.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (el) el.placeholder = ph;
  });
}

function setScreenshotHotkeyInputValue(el, storageStr) {
  if (!el) return;
  const code = storageStr != null && storageStr !== '' ? String(storageStr).trim() : '';
  if (code) {
    el.dataset.hotkeyStorage = code;
    el.value = formatScreenshotHotkeyDisplay(code);
  } else {
    delete el.dataset.hotkeyStorage;
    el.value = '';
  }
}

function getScreenshotHotkeyInputStorage(el) {
  if (!el) return '';
  const fromData = el.dataset.hotkeyStorage;
  let v = fromData != null && fromData !== '' ? fromData.trim() : String(el.value || '').trim();
  if (v && !isValidScreenshotHotkeyStorage(v)) return '';
  return v;
}

function dedupeScreenshotHotkeys(activeId, storageStr) {
  if (!storageStr) return;
  SCREENSHOT_HOTKEY_FIELD_IDS.forEach(({ id }) => {
    if (id === activeId) return;
    const el = document.getElementById(id);
    if (el && getScreenshotHotkeyInputStorage(el) === storageStr) {
      setScreenshotHotkeyInputValue(el, '');
    }
  });
}

function applyScreenshotHotkeyInputsFromItems(items) {
  SCREENSHOT_HOTKEY_FIELD_IDS.forEach(({ id, storageKey }) => {
    const el = document.getElementById(id);
    if (!el) return;
    let v = items[storageKey];
    v = v != null && v !== '' ? String(v).trim() : '';
    if (v && !isValidScreenshotHotkeyStorage(v)) v = '';
    setScreenshotHotkeyInputValue(el, v);
  });
}

let screenshotHotkeyInputsBound = false;

function initScreenshotHotkeyInputs() {
  if (screenshotHotkeyInputsBound) return;
  screenshotHotkeyInputsBound = true;
  updateScreenshotHotkeyPlaceholders();
  SCREENSHOT_HOTKEY_FIELD_IDS.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('focus', () => {
      el.classList.add('screenshot-hotkey-recording');
    });
    el.addEventListener('blur', () => {
      el.classList.remove('screenshot-hotkey-recording');
      restoreScreenshotHotkeyInputDisplay(el);
    });
    el.addEventListener('keydown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        setScreenshotHotkeyInputValue(el, '');
        saveSettings();
        showSectionSaveStatus('screenshot-save-status', 'settingsSaved');
        el.blur();
        return;
      }
      const preview = formatScreenshotHotkeyPreviewFromEvent(ev);
      if (preview) el.value = preview;
      const formatted = formatScreenshotHotkeyStorage(ev);
      if (!formatted) return;
      setScreenshotHotkeyInputValue(el, formatted);
      dedupeScreenshotHotkeys(id, formatted);
      saveSettings();
      showSectionSaveStatus('screenshot-save-status', 'settingsSaved');
    });
    el.addEventListener('keyup', (ev) => {
      if (document.activeElement !== el) return;
      if (formatScreenshotHotkeyStorage(ev)) return;
      const preview = formatScreenshotHotkeyPreviewFromEvent(ev);
      if (preview) {
        el.value = preview;
      } else {
        restoreScreenshotHotkeyInputDisplay(el);
      }
    });
  });
}

const DRAG_SEARCH_SLOT_TO_KEY = {
  default: 'dragSearchEngine',
  up: 'dragUpSearchEngine',
  upRight: 'dragUpRightSearchEngine',
  right: 'dragRightSearchEngine',
  downRight: 'dragDownRightSearchEngine',
  down: 'dragDownSearchEngine',
  downLeft: 'dragDownLeftSearchEngine',
  left: 'dragLeftSearchEngine',
  upLeft: 'dragUpLeftSearchEngine'
};

let dragSearchEngineCache = {
  dragSearchEngine: defaultSettings.dragSearchEngine,
  dragUpSearchEngine: '',
  dragUpRightSearchEngine: '',
  dragRightSearchEngine: '',
  dragDownRightSearchEngine: '',
  dragDownSearchEngine: '',
  dragDownLeftSearchEngine: '',
  dragLeftSearchEngine: '',
  dragUpLeftSearchEngine: ''
};

let lastDragSearchSlot = 'default';

function applyDragSearchEngineFromItems(items) {
  dragSearchEngineCache.dragSearchEngine = items.dragSearchEngine != null ? String(items.dragSearchEngine) : defaultSettings.dragSearchEngine;
  dragSearchEngineCache.dragUpSearchEngine = items.dragUpSearchEngine != null ? String(items.dragUpSearchEngine) : '';
  dragSearchEngineCache.dragUpRightSearchEngine = items.dragUpRightSearchEngine != null ? String(items.dragUpRightSearchEngine) : '';
  dragSearchEngineCache.dragRightSearchEngine = items.dragRightSearchEngine != null ? String(items.dragRightSearchEngine) : '';
  dragSearchEngineCache.dragDownRightSearchEngine = items.dragDownRightSearchEngine != null ? String(items.dragDownRightSearchEngine) : '';
  dragSearchEngineCache.dragDownSearchEngine = items.dragDownSearchEngine != null ? String(items.dragDownSearchEngine) : '';
  dragSearchEngineCache.dragDownLeftSearchEngine = items.dragDownLeftSearchEngine != null ? String(items.dragDownLeftSearchEngine) : '';
  dragSearchEngineCache.dragLeftSearchEngine = items.dragLeftSearchEngine != null ? String(items.dragLeftSearchEngine) : '';
  dragSearchEngineCache.dragUpLeftSearchEngine = items.dragUpLeftSearchEngine != null ? String(items.dragUpLeftSearchEngine) : '';
}

function flushDragSearchEngineInputToCache() {
  const slotEl = document.getElementById('drag-search-engine-slot');
  const inputEl = document.getElementById('drag-search-engine');
  if (!slotEl || !inputEl) return;
  const key = DRAG_SEARCH_SLOT_TO_KEY[slotEl.value];
  if (key) dragSearchEngineCache[key] = inputEl.value;
}

function refreshDragSearchEngineInputFromCache() {
  const slotEl = document.getElementById('drag-search-engine-slot');
  const inputEl = document.getElementById('drag-search-engine');
  if (!slotEl || !inputEl) return;
  const key = DRAG_SEARCH_SLOT_TO_KEY[slotEl.value];
  if (key) inputEl.value = dragSearchEngineCache[key] != null ? dragSearchEngineCache[key] : '';
}

function onDragSearchEngineInput() {
  flushDragSearchEngineInputToCache();
}

function onDragSearchSlotChanged() {
  const slotEl = document.getElementById('drag-search-engine-slot');
  const inputEl = document.getElementById('drag-search-engine');
  if (!slotEl || !inputEl) return;
  const prevKey = DRAG_SEARCH_SLOT_TO_KEY[lastDragSearchSlot];
  if (prevKey) dragSearchEngineCache[prevKey] = inputEl.value;
  lastDragSearchSlot = slotEl.value;
  refreshDragSearchEngineInputFromCache();
}

/** 点击示例中的 URL 文本：按当前语言包填入对应「搜索引擎 URL」输入框并保存 */
function setupSearchEngineExampleClickFill() {
  document.querySelectorAll('.search-engine-examples[data-search-example-target]').forEach((wrap) => {
    const targetId = wrap.getAttribute('data-search-example-target');
    if (!targetId) return;

    function applyExampleUrl(span) {
      const i18nKey = span.getAttribute('data-i18n');
      if (!i18nKey || !i18nKey.endsWith('Url')) return;
      const url = getI18nMessage(i18nKey, span.textContent).trim();
      if (!url) return;
      const input = document.getElementById(targetId);
      if (!input) return;
      input.value = url;
      if (targetId === 'drag-search-engine') {
        onDragSearchEngineInput();
      }
      const sectionStatusId =
        targetId === 'drag-search-engine'
          ? 'superdrag-save-status'
          : targetId === 'preview-search-engine'
            ? 'preview-save-status'
            : null;
      saveSettingsImmediate(sectionStatusId ? { sectionSaveStatusId: sectionStatusId } : undefined);
      input.focus();
      try {
        input.select();
      } catch (e) { /* ignore */ }
    }

    wrap.addEventListener('click', (e) => {
      const span = e.target.closest('.search-example-url');
      if (!span || !wrap.contains(span)) return;
      e.preventDefault();
      applyExampleUrl(span);
    });

    wrap.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const span = e.target.closest('.search-example-url');
      if (!span || !wrap.contains(span)) return;
      e.preventDefault();
      applyExampleUrl(span);
    });
  });
}

// 获取浏览器语言
function getBrowserLanguage() {
  const browserLang = POPUP_SETTINGS_API.getUiLanguage().toLowerCase().replace(/-/g, '_');
  
  // 支持的语言列表及其对应的locale映射
  const languageMap = {
    'zh_cn': 'zh_CN',
    'zh_tw': 'zh_TW',
    'zh_hk': 'zh_TW',
    'zh_mo': 'zh_TW',
    'zh': 'zh_CN',
    'en_us': 'en_US',
    'es': 'es',
    'fr': 'fr',
    'de': 'de',
    'pt_br': 'pt_BR',
    'pt': 'pt_BR',
    'ru': 'ru',
    'ko': 'ko',
    'hi': 'hi',
    'ar': 'ar',
    'bn': 'bn',
    'ja': 'ja',
    'id': 'id',
    'th': 'th',
    'vi': 'vi',
    'sw': 'sw',
    'tr': 'tr',
    'ur': 'ur',
    'nl': 'nl',
    'it': 'it',
    'uk': 'uk',
    'pl': 'pl',
    'cs': 'cs',
    'da': 'da',
    'sv': 'sv',
    'no': 'no',
    'fi': 'fi',
    'et': 'et'
  };
  
  // 精确匹配完整locale
  if (languageMap[browserLang]) {
    return languageMap[browserLang];
  }
  
  // 匹配语言代码前缀
  const langPrefix = browserLang.split('_')[0];
  if (languageMap[langPrefix]) {
    return languageMap[langPrefix];
  }
  
  // 默认使用英文
  return 'en_US';
}

// 获取i18n消息
function getI18nMessage(messageName, fallback = '') {
  try {
    const message = chrome.i18n.getMessage(messageName);
    return message || fallback;
  } catch (error) {
    console.error('Failed to get i18n message:', error.message);
    return fallback;
  }
}

let unlockOffDialogEscapeHandler = null;

function closeUnlockOffReloadDialog() {
  const root = document.getElementById('unlock-off-dialog');
  if (!root) return;
  const active = document.activeElement;
  if (active && root.contains(active)) {
    if (typeof active.blur === 'function') active.blur();
  }
  root.classList.remove('popup-modal--open');
  root.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (unlockOffDialogEscapeHandler) {
    document.removeEventListener('keydown', unlockOffDialogEscapeHandler);
    unlockOffDialogEscapeHandler = null;
  }
}

function openUnlockOffReloadDialog() {
  const root = document.getElementById('unlock-off-dialog');
  if (!root) return;
  root.classList.add('popup-modal--open');
  root.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  unlockOffDialogEscapeHandler = function(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeUnlockOffReloadDialog();
    }
  };
  document.addEventListener('keydown', unlockOffDialogEscapeHandler);
  const reloadBtn = document.getElementById('unlock-off-dialog-reload');
  if (reloadBtn) reloadBtn.focus();
}

/** 标签可展示的 URL（Firefox 等对扩展页可能不给 `url` 而只给 `pendingUrl`） */
function tabVisibleUrl(tab) {
  if (!tab) return '';
  const u = tab.url || tab.pendingUrl || '';
  return typeof u === 'string' ? u : '';
}

/** 是否为本扩展的设置页（弹窗 / 侧栏），避免「刷新当前标签」误刷新设置 UI（Firefox 独立窗下常见） */
function tabUrlLooksLikeOurExtensionSettings(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const id = chrome.runtime.id;
    if (!id) return false;
    const extPrefixChrome = 'chrome-extension://' + id + '/';
    const extPrefixMoz = 'moz-extension://' + id + '/';
    if (!url.startsWith(extPrefixChrome) && !url.startsWith(extPrefixMoz)) return false;
    return /\/(popup\.html|sidepanel\.html|options\.html)(\?|#|$)/.test(url);
  } catch (e) {
    return false;
  }
}

function createDetachedSettingsInstanceId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch (e) { /* use timestamp fallback */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function tabUrlMatchesDetachedSettingsInstance(url, instanceId) {
  if (!url || !instanceId) return false;
  try {
    const expected = new URL(chrome.runtime.getURL('popup.html'));
    const actual = new URL(url);
    return actual.origin === expected.origin &&
      actual.pathname === expected.pathname &&
      actual.searchParams.get('detached') === '1' &&
      actual.searchParams.get('instance') === String(instanceId);
  } catch (e) {
    return false;
  }
}

function reloadActiveTabForUnlockOff() {
  try {
    function reloadTabById(tabId) {
      if (tabId != null) chrome.tabs.reload(tabId);
    }

    /** 在指定窗口内刷新：优先活动标签；若活动标签是本扩展设置页则改选同窗口内第一个非设置页标签（无可见 URL 的标签跳过，避免 Firefox 下误刷新扩展页） */
    function reloadSensibleTabInWindow(windowId, onExhausted) {
      if (windowId == null) {
        if (onExhausted) onExhausted();
        return;
      }
      chrome.tabs.query({ windowId: windowId }, function(tabs) {
        if (chrome.runtime.lastError || !tabs || !tabs.length) {
          if (onExhausted) onExhausted();
          return;
        }
        function isSafeWebTab(t) {
          if (!t || t.id == null) return false;
          const u = tabVisibleUrl(t);
          if (!u) return false;
          return !tabUrlLooksLikeOurExtensionSettings(u);
        }
        const active = tabs.find((t) => t.active);
        if (active && isSafeWebTab(active)) {
          reloadTabById(active.id);
          return;
        }
        const fallback = tabs.find((t) => isSafeWebTab(t));
        if (fallback) {
          reloadTabById(fallback.id);
          return;
        }
        if (onExhausted) onExhausted();
      });
    }

    function reloadLastFocusedNormalWindow() {
      if (!chrome.windows || typeof chrome.windows.getLastFocused !== 'function') {
        reloadFallbackAnyBrowsableTab();
        return;
      }
      chrome.windows.getLastFocused({ windowTypes: ['normal'] }, function(win) {
        if (chrome.runtime.lastError || !win || win.id == null) {
          reloadFallbackAnyBrowsableTab();
          return;
        }
        reloadSensibleTabInWindow(win.id, reloadFallbackAnyBrowsableTab);
      });
    }

    /** 无窗口 API 或会话丢失时：在全部标签中找一个最近访问的非本扩展设置页（必须有可见 URL） */
    function reloadFallbackAnyBrowsableTab() {
      chrome.tabs.query({}, function(tabs) {
        if (chrome.runtime.lastError || !tabs || !tabs.length) return;
        const candidates = tabs.filter((t) => {
          if (t.id == null) return false;
          const u = tabVisibleUrl(t);
          if (!u) return false;
          return !tabUrlLooksLikeOurExtensionSettings(u);
        });
        if (!candidates.length) return;
        candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        reloadTabById(candidates[0].id);
      });
    }

    const inDetachedSettings =
      typeof document !== 'undefined' &&
      document.body &&
      document.body.classList.contains('detached-popup');

    if (!inDetachedSettings) {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, function(tabs) {
        if (chrome.runtime.lastError) {
          reloadLastFocusedNormalWindow();
          return;
        }
        const t = tabs && tabs[0];
        const u = t && tabVisibleUrl(t);
        if (t && t.id != null && u && !tabUrlLooksLikeOurExtensionSettings(u)) {
          reloadTabById(t.id);
          return;
        }
        reloadLastFocusedNormalWindow();
      });
      return;
    }

    chrome.windows.getCurrent(function(currentWin) {
      if (chrome.runtime.lastError || !currentWin || currentWin.id == null) {
        reloadLastFocusedNormalWindow();
        return;
      }
      const sess = chrome.storage.session;
      sess.get(DETACHED_WINDOW_SESSION_KEY, function(data) {
        if (chrome.runtime.lastError) {
          reloadLastFocusedNormalWindow();
          return;
        }
        const rec = data && data[DETACHED_WINDOW_SESSION_KEY];

        function fallbackDetachedWithoutStoredTab() {
          if (rec && rec.detachedWindowId === currentWin.id && rec.browserWindowId != null) {
            chrome.windows.get(rec.browserWindowId, function() {
              if (chrome.runtime.lastError) {
                reloadLastFocusedNormalWindow();
                return;
              }
              reloadSensibleTabInWindow(rec.browserWindowId, reloadLastFocusedNormalWindow);
            });
          } else {
            reloadLastFocusedNormalWindow();
          }
        }

        if (rec && rec.detachedWindowId === currentWin.id && rec.browserActiveTabId != null) {
          chrome.tabs.get(rec.browserActiveTabId, function(tab) {
            if (chrome.runtime.lastError || !tab || tab.id == null) {
              fallbackDetachedWithoutStoredTab();
              return;
            }
            const u = tabVisibleUrl(tab);
            if (u && tabUrlLooksLikeOurExtensionSettings(u)) {
              fallbackDetachedWithoutStoredTab();
              return;
            }
            reloadTabById(tab.id);
          });
          return;
        }

        fallbackDetachedWithoutStoredTab();
      });
    });
  } catch (e) { /* ignore */ }
}

// DOM 元素
let enableGestureCheckbox = null;
let gestureTrailCheckbox = null;
let gestureHintCheckbox = null;
let trailColorInput = null;
let trailColorPickerApi = null;
let trailWidthInput = null;
let trailWidthValue = null;
let superDragCheckbox = null;
let imagePreviewCheckbox = null;
let duplicateCheckCheckbox = null;
let autoCloseDuplicatesCheckbox = null;
let saveStatus = null;
let resetButton = null;
let exportButton = null;
let importButton = null;
let importFileInput = null;
let themeToggle = null;
let debugEnabledState = false; // 调试面板开关状态（无需复选框）

// 内置手势副标题：合成 title（操作说明 + 展开/收起）
function updateBuiltInGesturesSubtitleTitle() {
  const el = document.getElementById('built-in-gestures-subtitle-toggle');
  const list = document.getElementById('built-in-gestures-list');
  if (!el || !list) return;
  const base = getI18nMessage('rightButtonHint', '');
  const expanded = list.classList.contains('gesture-list--expanded');
  const action = expanded
    ? getI18nMessage('builtInGesturesListCollapseHint', 'Click to collapse list')
    : getI18nMessage('builtInGesturesListExpandHint', 'Click to expand full list');
  el.title = [base, action].filter(Boolean).join(' \u00b7 ');
}

function revealUiPending() {
  document.documentElement.classList.remove('ui-pending', 'theme-pending');
}

// 更新界面文本
const localizedSelects = new WeakSet();
const localizationBoundSelects = new WeakSet();

function localizeOption(option) {
  if (!option) return;
  const key = option.getAttribute('data-i18n');
  if (key) option.textContent = getI18nMessage(key, option.textContent);
}

function localizeSelectedOptions() {
  document.querySelectorAll('select').forEach((select) => {
    localizeOption(select.selectedOptions && select.selectedOptions[0]);
  });
}

function localizeSelectOptions(select) {
  if (!select || localizedSelects.has(select)) return;
  select.querySelectorAll('option[data-i18n]').forEach(localizeOption);
  localizedSelects.add(select);
}

function setupLazySelectLocalization() {
  document.querySelectorAll('select').forEach((select) => {
    localizeOption(select.selectedOptions && select.selectedOptions[0]);
    if (localizationBoundSelects.has(select)) return;
    localizationBoundSelects.add(select);
    select.addEventListener('pointerdown', () => localizeSelectOptions(select), { once: true });
    select.addEventListener('focus', () => localizeSelectOptions(select), { once: true });
  });
}

function updateUIText() {
  POPUP_SETTINGS_API.applyDocumentLocale();
  document.title = getI18nMessage('title', document.title);
  document.querySelectorAll('[data-i18n]:not(option)').forEach(element => {
    const key = element.getAttribute('data-i18n');
    element.textContent = getI18nMessage(key, element.textContent);
  });
  
  // 更新按钮的title属性
  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    const key = element.getAttribute('data-i18n-title');
    element.title = getI18nMessage(key, element.title);
  });

  document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
    const key = element.getAttribute('data-i18n-aria-label');
    const msg = getI18nMessage(key, element.getAttribute('aria-label') || '');
    element.setAttribute('aria-label', msg);
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    element.placeholder = getI18nMessage(key, element.placeholder || '');
  });

  setupLazySelectLocalization();

  updateBuiltInGesturesSubtitleTitle();
  updateScreenshotHotkeyPlaceholders();
  updatePreviewMaxWindowsDisplay();
  renderDisabledSitesList();
  updateSettingsFontSizeControl();
  if (themeToggle) {
    updateThemeToggleIcon(document.documentElement.getAttribute('data-theme') || 'light');
  }
  revealUiPending();
}

function detachedBrowserSnapshot(win) {
  return {
    state: win.state || 'normal',
    left: win.left,
    top: win.top,
    width: win.width,
    height: win.height
  };
}

function restoreDetachedBrowserLayout(browserWindowId, snapshot) {
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

/** 记录独立设置窗：含主窗口 ID / 布局快照；**browserActiveTabId** 供「解锁后刷新当前标签」在 Firefox 等环境下精确指向网页标签 */
function persistDetachedWindowRestore(browserWindowId, detachedWindowId, snapshot, browserActiveTabId, instanceId) {
  try {
    if (!chrome.storage) return;
    const rec = {
      detachedWindowId,
      detachedInstanceId: String(instanceId || ''),
      createdAt: Date.now()
    };
    if (browserWindowId != null) rec.browserWindowId = browserWindowId;
    if (snapshot != null) rec.snapshot = snapshot;
    if (browserActiveTabId != null) rec.browserActiveTabId = browserActiveTabId;
    chrome.storage.session.set({ detachedWindowRestore: rec });
  } catch (e) { /* ignore */ }
}

/**
 * 解析应配合独立设置窗缩放的「主浏览器窗口」。
 * Firefox 下从工具栏 popup 调用 `windows.getCurrent` 常拿不到普通浏览器窗口，需回退到 lastFocused 标签 / 最近普通窗。
 */
function resolveHostBrowserWindowForDetach(callback) {
  function tryLastFocusedNormal() {
    if (!chrome.windows || typeof chrome.windows.getLastFocused !== 'function') {
      callback(null, null);
      return;
    }
    chrome.windows.getLastFocused({ windowTypes: ['normal'] }, function(w) {
      if (chrome.runtime.lastError || !w || w.id == null) {
        callback(null, null);
        return;
      }
      callback(w.id, w);
    });
  }

  function tryFromDetachedRestoreRecord(onMiss) {
    try {
      if (!chrome.storage || !chrome.windows || typeof chrome.windows.get !== 'function') {
        onMiss();
        return;
      }
      const sess = chrome.storage.session;
      sess.get(DETACHED_WINDOW_SESSION_KEY, function(data) {
        if (chrome.runtime.lastError) {
          onMiss();
          return;
        }
        const rec = data && data[DETACHED_WINDOW_SESSION_KEY];
        if (!rec || rec.browserWindowId == null) {
          onMiss();
          return;
        }
        chrome.windows.get(rec.browserWindowId, function(w) {
          if (chrome.runtime.lastError || !w || w.id == null || w.type === 'popup') {
            onMiss();
            return;
          }
          callback(w.id, w);
        });
      });
    } catch (e) {
      onMiss();
    }
  }

  function tryFromActiveTabLastFocusedWindow() {
    if (!chrome.tabs || typeof chrome.tabs.query !== 'function') {
      tryLastFocusedNormal();
      return;
    }
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, function(tabs) {
      const t = tabs && tabs[0];
      if (!t || t.windowId == null) {
        tryLastFocusedNormal();
        return;
      }
      chrome.windows.get(t.windowId, function(w2) {
        if (chrome.runtime.lastError || !w2 || w2.id == null || w2.type === 'popup') {
          tryLastFocusedNormal();
          return;
        }
        callback(w2.id, w2);
      });
    });
  }

  if (!chrome.windows || typeof chrome.windows.getCurrent !== 'function') {
    tryFromActiveTabLastFocusedWindow();
    return;
  }
  chrome.windows.getCurrent(function(win) {
    if (!chrome.runtime.lastError && win && win.id != null && win.type !== 'popup') {
      callback(win.id, win);
      return;
    }
    if (!chrome.runtime.lastError && win && win.type === 'popup') {
      tryFromDetachedRestoreRecord(tryFromActiveTabLastFocusedWindow);
      return;
    }
    tryFromActiveTabLastFocusedWindow();
  });
}

/** 打开浏览器原生侧栏：Chromium sidePanel，Firefox sidebarAction。 */
function tryOpenSidePanelSettings(browserWinId) {
  try {
    const ext = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
    if (!ext) return Promise.resolve(false);
    const sp = ext['sidePanel'];
    if (sp && typeof sp['open'] === 'function') {
      return (async () => {
        try {
          const setOpts = sp['setOptions'];
          if (typeof setOpts === 'function') {
            await setOpts.call(sp, { enabled: true, path: 'sidepanel.html' });
          }
          await sp['open'].call(sp, { windowId: browserWinId });
          return true;
        } catch (e) {
          return false;
        }
      })();
    }

    const sidebar = ext['sidebarAction'];
    if (!sidebar || typeof sidebar['open'] !== 'function') return Promise.resolve(false);
    try {
      const result = sidebar['open'].call(sidebar);
      return Promise.resolve(result).then(() => true, () => false);
    } catch (e) {
      return Promise.resolve(false);
    }
  } catch (e) {
    return Promise.resolve(false);
  }
}

const CLOSE_SIDE_PANEL_MSG = { type: '__mouseGestureCloseSidePanel__' };

/** 从侧边栏 iframe 内切换成功后通知 sidepanel.html 使用专用 API 关闭侧栏。 */
function maybeCloseSidePanelHost() {
  try {
    if (!document.body.classList.contains('sidepanel-settings')) return false;
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(CLOSE_SIDE_PANEL_MSG, '*');
      return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}

/** 工具栏 extension popup 内点击「分离弹窗 / 独立窗口」后自动收起 popup（分离窗与侧栏内嵌页不关闭自身） */
function closeToolbarPopupAfterDetach() {
  // Only the browser action popup may close itself. Never close an embedded
  // sidebar document or a normal extension page/window by URL coincidence.
  if (!document.body || document.body.classList.contains('detached-popup')) return;
  if (document.body.classList.contains('sidepanel-settings')) return;
  if (document.body.classList.contains('options-settings')) return;
  if (window.parent !== window) return;
  if (!/\/popup\.html$/i.test(window.location.pathname || '')) return;
  try {
    const params = new URLSearchParams(window.location.search || '');
    if (params.has('sidepanel') || params.has('detached') || params.has('options')) return;
  } catch (e) { return; }
  try {
    window.close();
  } catch (e) { /* ignore */ }
}

function isOptionsSettingsMode() {
  return !!(document.body && document.body.classList.contains('options-settings'));
}

function isDetachedSettingsWindowMode() {
  return !!(document.body && document.body.classList.contains('detached-window-settings'));
}

function isOptionsSettingsTab(tab) {
  if (!tab) return false;
  const optionsUrl = chrome.runtime.getURL('options.html');
  const url = tab.url || tab.pendingUrl || '';
  return url === optionsUrl || url.startsWith(optionsUrl + '?') || url.startsWith(optionsUrl + '#');
}

function isDetachedSettingsDocument() {
  try {
    const url = new URL(window.location.href);
    return /\/popup\.html$/i.test(url.pathname) &&
      url.searchParams.get('detached') === '1' &&
      !!url.searchParams.get('instance');
  } catch (e) {
    return false;
  }
}

function closeCurrentOptionsTabAfterSwitch() {
  if (!isOptionsSettingsMode()) return;
  try {
    const ext = typeof browser !== 'undefined' ? browser : null;
    if (ext && ext.tabs && typeof ext.tabs.getCurrent === 'function') {
      Promise.resolve(ext.tabs.getCurrent()).then(function(tab) {
        if (!isOptionsSettingsTab(tab) || tab.id == null || typeof ext.tabs.remove !== 'function') return undefined;
        // Removing the last tab can close the entire Firefox browser window.
        if (typeof ext.tabs.query !== 'function' || tab.windowId == null) return undefined;
        return Promise.resolve(ext.tabs.query({ windowId: tab.windowId })).then(function(tabs) {
          if (Array.isArray(tabs) && tabs.length > 1) return ext.tabs.remove(tab.id);
          return undefined;
        });
      }).catch(function() {});
      return;
    }
  } catch (e) { /* use chrome callback fallback */ }
  try {
    if (chrome.tabs && typeof chrome.tabs.getCurrent === 'function') {
      chrome.tabs.getCurrent(function(tab) {
        if (chrome.runtime.lastError || !isOptionsSettingsTab(tab) || tab.id == null || !chrome.tabs.remove) return;
        if (tab.windowId == null || typeof chrome.tabs.query !== 'function') return;
        chrome.tabs.query({ windowId: tab.windowId }, function(tabs) {
          if (!chrome.runtime.lastError && Array.isArray(tabs) && tabs.length > 1) {
            chrome.tabs.remove(tab.id);
          }
        });
      });
      return;
    }
  } catch (e) { /* ignore */ }
}

function closeCurrentDetachedWindowAfterSwitch() {
  if (!isDetachedSettingsWindowMode() || !isDetachedSettingsDocument()) return;
  try {
    const ext = typeof browser !== 'undefined' ? browser : null;
    if (ext && ext.windows && typeof ext.windows.getCurrent === 'function') {
      Promise.resolve(ext.windows.getCurrent()).then(function(win) {
        if (win && win.id != null && win.type === 'popup' && typeof ext.windows.remove === 'function') {
          return ext.windows.remove(win.id);
        }
        return undefined;
      }).catch(function() {});
      return;
    }
  } catch (e) { /* use chrome callback fallback */ }
  try {
    if (chrome.windows && typeof chrome.windows.getCurrent === 'function' && typeof chrome.windows.remove === 'function') {
      chrome.windows.getCurrent(function(win) {
        if (!chrome.runtime.lastError && win && win.id != null && win.type === 'popup') {
          chrome.windows.remove(win.id);
        }
      });
      return;
    }
  } catch (e) { /* ignore */ }
}

function closeExistingDetachedSettingsWindow(keepWindowId) {
  try {
    if (!chrome.storage) return;
    const sess = chrome.storage.session;
    sess.get(DETACHED_WINDOW_SESSION_KEY, function(data) {
      if (chrome.runtime.lastError) return;
      const rec = data && data[DETACHED_WINDOW_SESSION_KEY];
      const wid = rec && rec.detachedWindowId;
      if (wid == null || (keepWindowId != null && Number(wid) === Number(keepWindowId))) return;
      if (!rec.detachedInstanceId) {
        clearDetachedRestoreRecordIfMatches(rec);
        return;
      }
      getSettingsWindow(wid, true, function(win) {
        const tabs = win && Array.isArray(win.tabs) ? win.tabs : [];
        const verified = !!(
          win &&
          win.type === 'popup' &&
          tabs.some(function(tab) {
            return tabUrlMatchesDetachedSettingsInstance(tabVisibleUrl(tab), rec.detachedInstanceId);
          })
        );
        if (!verified) {
          clearDetachedRestoreRecordIfMatches(rec);
          return;
        }
        removeSettingsWindow(wid, function() {
          /* background.js 会在已验证的独立设置窗口关闭后恢复主窗口布局并清理记录 */
        });
      });
    });
  } catch (e) { /* ignore */ }
}

function closeExistingOptionsTabs(keepTabId) {
  try {
    if (!chrome.tabs || typeof chrome.tabs.query !== 'function' || typeof chrome.tabs.remove !== 'function') return;
    const optionsUrl = chrome.runtime.getURL('options.html');
    chrome.tabs.query({}, function(tabs) {
      if (chrome.runtime.lastError || !Array.isArray(tabs)) return;
      const tabCountByWindow = new Map();
      const optionTabsByWindow = new Map();
      tabs.forEach(function(tab) {
        if (!tab || tab.windowId == null) return;
        tabCountByWindow.set(tab.windowId, (tabCountByWindow.get(tab.windowId) || 0) + 1);
        const u = tab.url || '';
        if (u === optionsUrl || u.startsWith(optionsUrl + '?') || u.startsWith(optionsUrl + '#')) {
          const list = optionTabsByWindow.get(tab.windowId) || [];
          list.push(tab);
          optionTabsByWindow.set(tab.windowId, list);
        }
      });
      const protectedOptionIds = new Set();
      optionTabsByWindow.forEach(function(optionTabs, windowId) {
        if (optionTabs.length < tabCountByWindow.get(windowId)) return;
        const preferred = optionTabs.find(function(tab) {
          return keepTabId != null && Number(tab.id) === Number(keepTabId);
        }) || optionTabs[0];
        if (preferred && preferred.id != null) protectedOptionIds.add(preferred.id);
      });
      const ids = tabs
        .filter(function(tab) {
          if (!tab || tab.id == null || (keepTabId != null && Number(tab.id) === Number(keepTabId))) {
            return false;
          }
          // Never remove every tab in a browser window.
          if (protectedOptionIds.has(tab.id)) return false;
          const u = tab.url || '';
          return u === optionsUrl || u.startsWith(optionsUrl + '?') || u.startsWith(optionsUrl + '#');
        })
        .map(function(tab) { return tab.id; });
      if (ids.length) chrome.tabs.remove(ids);
    });
  } catch (e) { /* ignore */ }
}

function closeSidePanelForDetachedRestoreWindow() {
  try {
    if (!chrome.storage) return;
    const sess = chrome.storage.session;
    sess.get(DETACHED_WINDOW_SESSION_KEY, function(data) {
      if (chrome.runtime.lastError) return;
      const rec = data && data[DETACHED_WINDOW_SESSION_KEY];
      if (rec && rec.browserWindowId != null) {
        closeExtensionSidePanelForBrowserWindow(rec.browserWindowId);
      }
    });
  } catch (e) { /* ignore */ }
}

function closePreviousSettingsSurfaceAfterSwitch(targetMode, options) {
  const opts = options || {};

  if (targetMode !== 'sidepanel') {
    const closedViaHost = maybeCloseSidePanelHost();
    if (!closedViaHost) {
      closeExtensionSidePanelForBrowserWindow(opts.browserWindowId != null ? opts.browserWindowId : null);
      const ext = typeof browser !== 'undefined' ? browser : null;
      if (!(ext && ext.sidebarAction)) {
        closeSidePanelForDetachedRestoreWindow();
      }
    }
  }

  if (targetMode !== 'detached') {
    if (isDetachedSettingsWindowMode()) {
      closeCurrentDetachedWindowAfterSwitch();
    } else {
      closeExistingDetachedSettingsWindow(opts.keepDetachedWindowId);
    }
  }

  if (targetMode !== 'options') {
    if (isOptionsSettingsMode()) {
      closeCurrentOptionsTabAfterSwitch();
    } else {
      closeExistingOptionsTabs(opts.keepOptionsTabId);
    }
  }

  closeToolbarPopupAfterDetach();
}

function queryTabsForSettings(query, callback) {
  try {
    const ext = typeof browser !== 'undefined' ? browser : null;
    if (ext && ext.tabs && typeof ext.tabs.query === 'function') {
      Promise.resolve(ext.tabs.query(query)).then(
        function(tabs) { callback(Array.isArray(tabs) ? tabs : []); },
        function() { callback([]); }
      );
      return;
    }
  } catch (e) { /* use chrome callback fallback */ }
  try {
    chrome.tabs.query(query, function(tabs) {
      callback(chrome.runtime.lastError || !Array.isArray(tabs) ? [] : tabs);
    });
  } catch (e) {
    callback([]);
  }
}

function getSettingsWindow(windowId, populate, callback) {
  const getInfo = populate ? { populate: true } : {};
  try {
    const ext = typeof browser !== 'undefined' ? browser : null;
    if (ext && ext.windows && typeof ext.windows.get === 'function') {
      Promise.resolve(ext.windows.get(windowId, getInfo)).then(
        function(win) { callback(win || null); },
        function() { callback(null); }
      );
      return;
    }
  } catch (e) { /* use chrome callback fallback */ }
  try {
    chrome.windows.get(windowId, getInfo, function(win) {
      callback(chrome.runtime.lastError ? null : (win || null));
    });
  } catch (e) {
    callback(null);
  }
}

function removeSettingsWindow(windowId, callback) {
  const done = typeof callback === 'function' ? callback : function() {};
  getSettingsWindow(windowId, false, function(win) {
    // Never remove a normal browser window through the detached-window path.
    if (!win || win.type !== 'popup') {
      done(false);
      return;
    }
    try {
      const ext = typeof browser !== 'undefined' ? browser : null;
      if (ext && ext.windows && typeof ext.windows.remove === 'function') {
        Promise.resolve(ext.windows.remove(windowId)).then(
          function() { done(true); },
          function() { done(false); }
        );
        return;
      }
    } catch (e) { /* use chrome callback fallback */ }
    try {
      chrome.windows.remove(windowId, function() {
        done(!chrome.runtime.lastError);
      });
    } catch (e) {
      done(false);
    }
  });
}

function clearDetachedRestoreRecordIfMatches(expectedRecord) {
  try {
    if (!chrome.storage || !expectedRecord) return;
    const sess = chrome.storage.session;
    sess.get(DETACHED_WINDOW_SESSION_KEY, function(data) {
      if (chrome.runtime.lastError) return;
      const current = data && data[DETACHED_WINDOW_SESSION_KEY];
      if (!current ||
          Number(current.detachedWindowId) !== Number(expectedRecord.detachedWindowId) ||
          String(current.detachedInstanceId || '') !== String(expectedRecord.detachedInstanceId || '')) {
        return;
      }
      sess.remove(DETACHED_WINDOW_SESSION_KEY, function() {});
    });
  } catch (e) { /* ignore */ }
}

function createSettingsWindow(createData, callback) {
  try {
    const ext = typeof browser !== 'undefined' ? browser : null;
    if (ext && ext.windows && typeof ext.windows.create === 'function') {
      Promise.resolve(ext.windows.create(createData)).then(
        function(win) { callback(win || null); },
        function() { callback(null); }
      );
      return;
    }
  } catch (e) { /* use chrome callback fallback */ }
  try {
    chrome.windows.create(createData, function(win) {
      callback(chrome.runtime.lastError ? null : (win || null));
    });
  } catch (e) {
    callback(null);
  }
}

function updateSettingsWindow(windowId, updateData, callback) {
  try {
    const ext = typeof browser !== 'undefined' ? browser : null;
    if (ext && ext.windows && typeof ext.windows.update === 'function') {
      Promise.resolve(ext.windows.update(windowId, updateData)).then(
        function(win) { callback(true, win || null); },
        function() { callback(false, null); }
      );
      return;
    }
  } catch (e) { /* use chrome callback fallback */ }
  try {
    chrome.windows.update(windowId, updateData, function(win) {
      callback(!chrome.runtime.lastError, win || null);
    });
  } catch (e) {
    callback(false, null);
  }
}

function openOptionsPage() {
  const optionsUrl = chrome.runtime.getURL('options.html');
  let settled = false;

  function finishOpened(tab) {
    if (settled) return;
    settled = true;
    closePreviousSettingsSurfaceAfterSwitch('options', {
      keepOptionsTabId: tab && tab.id != null ? tab.id : null
    });
  }

  function fallbackOpenOptionsTab() {
    if (settled) return;
    try {
      if (chrome.tabs && typeof chrome.tabs.create === 'function') {
        chrome.tabs.create({ url: optionsUrl, active: true }, function (tab) {
          finishOpened(tab);
        });
        return;
      }
    } catch (e) { /* ignore */ }
    try {
      window.open(optionsUrl, '_blank', 'noopener');
    } catch (e) { /* ignore */ }
    finishOpened();
  }

  try {
    const ext = typeof browser !== 'undefined' ? browser : null;
    if (ext && ext.runtime && typeof ext.runtime.openOptionsPage === 'function') {
      Promise.resolve(ext.runtime.openOptionsPage()).then(
        function() { finishOpened(); },
        fallbackOpenOptionsTab
      );
      return;
    }
  } catch (e) { /* use chrome callback fallback */ }

  try {
    if (chrome.runtime && typeof chrome.runtime.openOptionsPage === 'function') {
      chrome.runtime.openOptionsPage(function () {
        if (chrome.runtime.lastError) {
          fallbackOpenOptionsTab();
          return;
        }
        finishOpened();
      });
      return;
    }
  } catch (e) { /* ignore */ }

  fallbackOpenOptionsTab();
}

/**
 * 关闭指定浏览器窗口中本扩展的侧栏（工具栏 popup 无父 frame，必须直接调 API）。
 * browserWindowId 为 null 时用 windows.getCurrent。需 Chrome 141+ 的 sidePanel.close。
 */
function closeExtensionSidePanelForBrowserWindow(browserWindowId) {
  try {
    const ext = typeof browser !== 'undefined' ? browser : typeof chrome !== 'undefined' ? chrome : null;
    const sp = ext && ext['sidePanel'];
    if (sp && typeof sp['close'] === 'function') {
      function doClose(wid) {
        if (wid == null) return;
        const result = sp['close'].call(sp, { windowId: wid });
        if (result && typeof result.catch === 'function') result.catch(function () {});
      }
      if (browserWindowId != null) {
        doClose(browserWindowId);
        return;
      }
      if (!chrome.windows || typeof chrome.windows.getCurrent !== 'function') return;
      chrome.windows.getCurrent(function (win) {
        if (chrome.runtime.lastError || !win || win.id == null) return;
        doClose(win.id);
      });
      return;
    }

    const sidebar = ext && ext['sidebarAction'];
    if (!sidebar || typeof sidebar['close'] !== 'function') return;
    const result = sidebar['close'].call(sidebar);
    if (result && typeof result.catch === 'function') result.catch(function () {});
  } catch (e) { /* ignore */ }
}

/** 无侧边栏或过旧浏览器：独立窗口 + 主窗口尺寸（关闭独立窗时由 background 恢复） */
function openDetachedSettingsWindowFallback() {
  if (detachedSettingsWindowOpenInFlight) return;
  detachedSettingsWindowOpenInFlight = true;
  if (!isDetachedSettingsWindowMode()) {
    closeExistingDetachedSettingsWindow(null);
  }

  const detachedInstanceId = createDetachedSettingsInstanceId();
  const url = chrome.runtime.getURL('popup.html') +
    '?detached=1&instance=' + encodeURIComponent(detachedInstanceId);
  const margin = 16;
  const popupWidth = detachedSettingsWindowOuterWidthPx();
  let al = 0;
  let at = 0;
  let aw = 1280;
  let ah = 800;
  try {
    al = typeof screen.availLeft === 'number' ? screen.availLeft : 0;
    at = typeof screen.availTop === 'number' ? screen.availTop : 0;
    aw = typeof screen.availWidth === 'number' ? screen.availWidth : (screen.width || 1280);
    ah = typeof screen.availHeight === 'number' ? screen.availHeight : (screen.height || 800);
  } catch (e) { /* ignore */ }

  const workH = Math.max(200, ah - 2 * margin);
  const popupHeight = workH;
  const popupTop = at + margin;
  const popupLeft = al + aw - popupWidth - margin;
  const browserLeft = al + margin;
  const browserTop = at + margin;
  const browserWidth = Math.max(320, aw - popupWidth - 3 * margin);
  const browserHeight = workH;

  function createDetachedPopupOnly() {
    queryTabsForSettings({ active: true, lastFocusedWindow: true }, (qtabs) => {
      let browserActiveTabId = null;
      const qt = qtabs && qtabs[0];
      const qu = qt && tabVisibleUrl(qt);
      if (qt && qt.id != null && qu && !tabUrlLooksLikeOurExtensionSettings(qu)) {
        browserActiveTabId = qt.id;
      }
      createSettingsWindow(
        {
          url,
          type: 'popup',
          width: popupWidth,
          height: popupHeight,
          left: Math.round(popupLeft),
          top: Math.round(popupTop),
          focused: true
        },
        (detachedWin) => {
          if (!detachedWin || detachedWin.id == null) {
            releaseDetachedSettingsOpenLock(true);
            return;
          }
          releaseDetachedSettingsOpenLock(false);
          if (browserActiveTabId != null) {
            persistDetachedWindowRestore(null, detachedWin.id, null, browserActiveTabId, detachedInstanceId);
          }
          closePreviousSettingsSurfaceAfterSwitch('detached', {
            keepDetachedWindowId: detachedWin.id
          });
          if (isDetachedSettingsWindowMode()) {
            closeCurrentDetachedWindowAfterSwitch();
          }
        }
      );
    });
  }

  function runDetachWithMainBrowserWindow(browserId, win) {
    const snapshot = detachedBrowserSnapshot(win);
    updateSettingsWindow(
      browserId,
      {
        state: 'normal',
        left: Math.round(browserLeft),
        top: Math.round(browserTop),
        width: Math.round(browserWidth),
        height: Math.round(browserHeight)
      },
      (updated) => {
        if (!updated) {
          releaseDetachedSettingsOpenLock(true);
          return;
        }
        createSettingsWindow(
          {
            url,
            type: 'popup',
            width: popupWidth,
            height: popupHeight,
            left: Math.round(popupLeft),
            top: Math.round(popupTop),
            focused: true
          },
          (detachedWin) => {
            if (!detachedWin || detachedWin.id == null) {
              restoreDetachedBrowserLayout(browserId, snapshot);
              releaseDetachedSettingsOpenLock(true);
              return;
            }
            releaseDetachedSettingsOpenLock(false);
            queryTabsForSettings({ active: true, windowId: browserId }, (tabs) => {
              const at = tabs && tabs[0];
              const tid = at && at.id != null ? at.id : null;
              persistDetachedWindowRestore(browserId, detachedWin.id, snapshot, tid, detachedInstanceId);
              closePreviousSettingsSurfaceAfterSwitch('detached', {
                keepDetachedWindowId: detachedWin.id,
                browserWindowId: browserId
              });
              if (isDetachedSettingsWindowMode()) {
                closeCurrentDetachedWindowAfterSwitch();
              }
            });
          }
        );
      }
    );
  }

  try {
    resolveHostBrowserWindowForDetach(function(browserId, win) {
      if (browserId == null || !win) {
        createDetachedPopupOnly();
        return;
      }
      runDetachWithMainBrowserWindow(browserId, win);
    });
  } catch (e) {
    createDetachedPopupOnly();
  }
}

/** 优先侧边栏打开设置；失败则回退独立窗口 */
function openDetachedSettingsWindow() {
  const ext = typeof browser !== 'undefined' ? browser : null;
  if (ext && ext.sidebarAction && typeof ext.sidebarAction.open === 'function') {
    tryOpenSidePanelSettings(null).then((ok) => {
      if (ok) {
        closePreviousSettingsSurfaceAfterSwitch('sidepanel', {});
      } else {
        openDetachedSettingsWindowFallback();
      }
    });
    return;
  }
  if (!chrome.windows || typeof chrome.windows.getCurrent !== 'function') {
    openDetachedSettingsWindowFallback();
    return;
  }
  function openSidePanelOrFallback(browserWinId) {
    if (browserWinId == null) {
      openDetachedSettingsWindowFallback();
      return;
    }
    tryOpenSidePanelSettings(browserWinId).then((ok) => {
      if (ok) {
        closePreviousSettingsSurfaceAfterSwitch('sidepanel', { browserWindowId: browserWinId });
        return;
      }
      openDetachedSettingsWindowFallback();
    });
  }
  chrome.windows.getCurrent((win) => {
    if (chrome.runtime.lastError || !win || win.id == null) {
      openDetachedSettingsWindowFallback();
      return;
    }
    if (win.type === 'popup') {
      resolveHostBrowserWindowForDetach(function(browserId) {
        openSidePanelOrFallback(browserId);
      });
      return;
    }
    openSidePanelOrFallback(win.id);
  });
}

function updateThemeToggleIcon(theme) {
  if (!themeToggle) return;
  const moon = themeToggle.querySelector('.header-theme-icon--moon');
  const sun = themeToggle.querySelector('.header-theme-icon--sun');
  if (!moon || !sun) return;
  const isDark = theme === 'dark';
  moon.toggleAttribute('hidden', isDark);
  sun.toggleAttribute('hidden', !isDark);
}

function applyThemeInstant(theme) {
  const root = document.documentElement;
  root.classList.add('theme-switching');
  root.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('mg_theme', theme);
  } catch (e) { /* ignore */ }
  updateThemeToggleIcon(theme);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('theme-switching');
    });
  });
}

// 切换主题
function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';

  applyThemeInstant(newTheme);

  chrome.storage.sync.set({ theme: newTheme }, () => {
    if (chrome.runtime.lastError) {
      console.log('Save theme setting error:', chrome.runtime.lastError.message);
      showStatusMessage('saveError', true);
      return;
    }
    console.log('Theme switched and saved as:', newTheme);
  });
}

const SETTINGS_FONT_SIZE_LEVELS = Object.freeze({
  small: 90,
  normal: 100,
  large: 115
});

function normalizeSettingsFontSize(value) {
  return Object.prototype.hasOwnProperty.call(SETTINGS_FONT_SIZE_LEVELS, value)
    ? value
    : POPUP_UI_DEFAULTS.settingsFontSize;
}

function updateSettingsFontSizeControl() {
  const value = normalizeSettingsFontSize(
    document.documentElement.getAttribute('data-settings-font-size')
  );
  const button = document.getElementById('settings-font-size-btn');
  const popover = document.getElementById('settings-font-size-popover');
  const baseLabel = getI18nMessage('settingsFontSize', 'Settings font size');
  const percent = SETTINGS_FONT_SIZE_LEVELS[value];
  if (button) {
    const label = `${baseLabel}: ${percent}%`;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.dataset.settingsFontSizeValue = value;
  }
  if (popover) {
    popover.setAttribute('aria-label', baseLabel);
    popover.querySelectorAll('[data-settings-font-size-option]').forEach((option) => {
      const optionValue = normalizeSettingsFontSize(option.dataset.settingsFontSizeOption);
      const selected = optionValue === value;
      option.classList.toggle('settings-font-size-option--selected', selected);
      option.setAttribute('aria-pressed', selected ? 'true' : 'false');
      const optionLabel = `${baseLabel}: ${SETTINGS_FONT_SIZE_LEVELS[optionValue]}%`;
      option.title = optionLabel;
      option.setAttribute('aria-label', optionLabel);
    });
  }
}

function applySettingsFontSize(value) {
  const normalized = normalizeSettingsFontSize(value);
  document.documentElement.setAttribute('data-settings-font-size', normalized);
  try {
    localStorage.setItem('mg_settings_font_size', normalized);
  } catch (e) { /* ignore */ }
  updateSettingsFontSizeControl();
  return normalized;
}

function setSettingsFontSizePopoverOpen(open, focusSelected = false) {
  const button = document.getElementById('settings-font-size-btn');
  const popover = document.getElementById('settings-font-size-popover');
  if (!button || !popover) return;
  const visible = !!open;
  popover.classList.toggle('settings-font-size-popover--visible', visible);
  popover.setAttribute('aria-hidden', visible ? 'false' : 'true');
  button.setAttribute('aria-expanded', visible ? 'true' : 'false');
  if (visible && focusSelected) {
    const selected = popover.querySelector('.settings-font-size-option--selected');
    if (selected) selected.focus();
  }
}

function setupSettingsFontSizeControl() {
  const button = document.getElementById('settings-font-size-btn');
  const popover = document.getElementById('settings-font-size-popover');
  if (!button || !popover) return;

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const open = button.getAttribute('aria-expanded') !== 'true';
    setSettingsFontSizePopoverOpen(open, open);
  });

  popover.addEventListener('click', (event) => {
    const option = event.target.closest('[data-settings-font-size-option]');
    if (!option || !popover.contains(option)) return;
    event.preventDefault();
    event.stopPropagation();
    const value = applySettingsFontSize(option.dataset.settingsFontSizeOption);
    setSettingsFontSizePopoverOpen(false);
    button.focus();
    chrome.storage.sync.set({ settingsFontSize: value }, () => {
      if (chrome.runtime.lastError) showStatusMessage('saveError', true);
    });
  });

  popover.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const options = Array.from(popover.querySelectorAll('[data-settings-font-size-option]'));
    const index = Math.max(0, options.indexOf(document.activeElement));
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    options[(index + direction + options.length) % options.length].focus();
    event.preventDefault();
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.font-size-control')) setSettingsFontSizePopoverOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
      setSettingsFontSizePopoverOpen(false);
      button.focus();
    }
  });
  updateSettingsFontSizeControl();
}

// 隐藏/显示控制按钮
function toggleControlButtonsVisibility(hide = true) {
  if (exportButton) exportButton.style.display = hide ? 'none' : '';
  if (importButton) importButton.style.display = hide ? 'none' : '';
  if (resetButton) resetButton.style.display = hide ? 'none' : '';
}

// 显示状态消息
function showStatusMessage(messageKey, isError = false) {
  // 使用saveStatus元素显示状态消息
  const message = getI18nMessage(messageKey, messageKey);
  saveStatus.textContent = message;
  saveStatus.style.color = isError ? '#F44336' : '#4CAF50'; // 红色表示错误，绿色表示成功
  saveStatus.classList.add('show');
  
  // 隐藏导入、导出、重设按钮（使用 visibility 避免布局抖动）
  toggleControlButtonsVisibility(true);
  
  // 使用配置常量替代硬编码
  setTimeout(() => {
    saveStatus.classList.remove('show');
    // 恢复默认颜色并清空文本内容
    setTimeout(() => {
      saveStatus.style.color = '#4CAF50';
      saveStatus.textContent = '';
      
      // 恢复显示导入、导出、重设按钮
      toggleControlButtonsVisibility(false);
    }, CONFIG.FADE_DURATION);
  }, CONFIG.STATUS_MESSAGE_DURATION);
}

/** 区块标题右侧：与「副标题」一起在保存提示显示时淡出、结束后恢复（与 .operation-hint 相同节奏） */
function getSectionSaveStatusSuppressElements(statusContainer) {
  if (!statusContainer) return [];
  return Array.from(
    statusContainer.querySelectorAll('.operation-hint, .screenshot-header-view-history, .disabled-site-add-current')
  );
}

function setSectionHeaderSuppressHidden(suppressElements, hidden) {
  for (let i = 0; i < suppressElements.length; i++) {
    const el = suppressElements[i];
    if (hidden) {
      el.style.opacity = '0';
      if (el.tagName === 'BUTTON') {
        el.style.pointerEvents = 'none';
      }
      continue;
    }
    if (el.classList.contains('operation-hint')) {
      el.style.opacity = '0.9';
    } else {
      el.style.opacity = '';
    }
    if (el.tagName === 'BUTTON') {
      el.style.pointerEvents = '';
    }
  }
}

// 显示区域特定的保存状态
function showSectionSaveStatus(sectionId, messageKey, isError = false) {
  const statusElement = document.getElementById(sectionId);
  if (!statusElement) return;
  
  const statusContainer = statusElement.closest('.status-container');
  const suppressElements = getSectionSaveStatusSuppressElements(statusContainer);
  
  const message = getI18nMessage(messageKey, messageKey);
  statusElement.textContent = message;
  statusElement.style.color = isError ? '#F44336' : '#4CAF50';
  statusElement.classList.add('show');
  
  setSectionHeaderSuppressHidden(suppressElements, true);
  
  // 隐藏导入、导出、重设按钮（使用 visibility 避免布局抖动）
  toggleControlButtonsVisibility(true);
  
  // 使用配置常量替代硬编码
  setTimeout(() => {
    statusElement.classList.remove('show');
    // 恢复默认颜色并清空文本内容
    setTimeout(() => {
      statusElement.style.color = '#4CAF50';
      statusElement.textContent = '';
      setSectionHeaderSuppressHidden(suppressElements, false);
      // 恢复显示导入、导出、重设按钮
      toggleControlButtonsVisibility(false);
    }, CONFIG.FADE_DURATION);
  }, CONFIG.STATUS_MESSAGE_DURATION - 1000); // 区域消息显示时间稍短
}

// 设置按钮状态
function setButtonState(button, isLoading, isDisabled = false, successMessage = null) {
  button.disabled = isLoading || isDisabled;
  
  if (isLoading) {
    button.classList.add('loading');

    if (!button._savedContentFragment) {
      const frag = document.createDocumentFragment();
      while (button.firstChild) {
        frag.appendChild(button.firstChild);
      }
      button._savedContentFragment = frag;
    }
    button.replaceChildren();
    const loadingSpan = document.createElement('span');
    loadingSpan.className = 'loading-dots';
    loadingSpan.textContent = '...';
    button.appendChild(loadingSpan);
    
    // 为防止内存泄漏，确保只有一个动画定时器在运行
    if (button._loadingInterval) {
      clearInterval(button._loadingInterval);
    }
    
    // 创建加载动画
    let dots = 0;
    button._loadingInterval = setInterval(() => {
      dots = (dots + 1) % 4;
      const dotsText = '.'.repeat(dots);
      button.querySelector('.loading-dots').textContent = dotsText;
    }, CONFIG.LOADING_ANIMATION_INTERVAL);
  } else {
    button.classList.remove('loading');
    
    // 清除加载动画
    if (button._loadingInterval) {
      clearInterval(button._loadingInterval);
      button._loadingInterval = null;
    }
    
    if (button._savedContentFragment) {
      button.replaceChildren();
      button.appendChild(button._savedContentFragment);
      button._savedContentFragment = null;
    }
    
    // 如果成功，使用saveStatus显示成功消息
    if (successMessage) {
      saveStatus.textContent = successMessage;
      saveStatus.style.color = '#4CAF50';
      saveStatus.classList.add('show');
      
      // 隐藏导入、导出、重设按钮（使用 visibility 避免布局抖动）
      toggleControlButtonsVisibility(true);
      
      // 使用配置常量替代硬编码
      setTimeout(() => {
        saveStatus.classList.remove('show');
        // 恢复默认颜色并清空文本内容
        setTimeout(() => {
          saveStatus.style.color = '#4CAF50';
          saveStatus.textContent = '';
          // 恢复显示导入、导出、重设按钮
          toggleControlButtonsVisibility(false);
        }, CONFIG.FADE_DURATION);
      }, CONFIG.STATUS_MESSAGE_DURATION - 1000);
    }
  }
}

function toggleSettingDisabledOption(el, disabled) {
  if (!el) return;
  el.classList.toggle('disabled-option', !!disabled);
}

function updateScreenshotFeatureControls() {
  const enableGesture = enableGestureCheckbox && enableGestureCheckbox.checked === true;
  const enableShotEl = document.getElementById('enable-screenshot-feature');
  const trailShotEl = document.getElementById('enable-screenshot-trail');
  const shotOn = enableGesture && enableShotEl && enableShotEl.checked === true;
  const screenshotSection = document.getElementById('screenshot-feature');

  if (enableShotEl) {
    enableShotEl.disabled = !enableGesture;
  }
  toggleSettingDisabledOption(enableShotEl && enableShotEl.closest('.setting-item'), !enableGesture);

  if (trailShotEl) {
    trailShotEl.disabled = !shotOn;
  }
  const clipboardShotEl = document.getElementById('enable-screenshot-clipboard');
  if (clipboardShotEl) {
    clipboardShotEl.disabled = !shotOn;
  }
  const previewShotEl = document.getElementById('enable-screenshot-preview');
  if (previewShotEl) {
    previewShotEl.disabled = !shotOn;
  }
  const historyShotEl = document.getElementById('enable-screenshot-history');
  if (historyShotEl) {
    historyShotEl.disabled = !shotOn;
  }
  /* View history 独立于「启用截图」，未开截图时仍可打开历史窗口 */
  const historyBtn = document.getElementById('btn-screenshot-history');
  if (historyBtn) {
    historyBtn.disabled = false;
  }
  const historyMaxRow = document.getElementById('screenshot-history-max-count-row');
  const historyMaxEl = document.getElementById('screenshot-history-max-count');
  const historyMaxHint = screenshotSection && screenshotSection.querySelector('.screenshot-history-max-hint');
  const historyOn = shotOn && historyShotEl && historyShotEl.checked;
  if (historyMaxEl) {
    historyMaxEl.disabled = !historyOn;
  }
  toggleSettingDisabledOption(historyMaxRow, !historyOn);
  if (historyMaxHint) {
    historyMaxHint.style.display = shotOn ? '' : 'none';
    toggleSettingDisabledOption(historyMaxHint, !historyOn);
  }

  const subOptionRows = screenshotSection
    ? screenshotSection.querySelectorAll(
        '#enable-screenshot-trail, #enable-screenshot-clipboard, #enable-screenshot-preview, #enable-screenshot-history'
      )
    : [];
  subOptionRows.forEach((input) => {
    toggleSettingDisabledOption(input.closest('.setting-item'), !shotOn);
  });

  const hotkeysBlock = screenshotSection && screenshotSection.querySelector('.screenshot-hotkeys');
  toggleSettingDisabledOption(hotkeysBlock, !shotOn);

  const historyHotkeyRow = document.getElementById('screenshot-hotkey-open-history-row');
  if (historyHotkeyRow) {
    toggleSettingDisabledOption(historyHotkeyRow, !shotOn);
  }

  const hintsBlock = screenshotSection && screenshotSection.querySelector('.screenshot-hotkeys-hints');
  if (hintsBlock) {
    hintsBlock.style.display = shotOn ? '' : 'none';
    toggleSettingDisabledOption(hintsBlock, !shotOn);
  }

  SCREENSHOT_HOTKEY_FIELD_IDS.forEach(({ id }) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !shotOn;
  });
}

// 加载设置
function loadSettings() {
  try {
    loadSettingsData({
      enableGesture: true, // 默认值，仅在首次安装时使用
      showGestureTrail: true,
      showGestureHint: true,
      trailColor: '#FF9ECD',
      trailWidth: 3,
      enableSuperDrag: true,
      superDragCompassPosition: 'compassHub',
      enableDragTextSearch: true,
      enableSplitScrollSync: false,
      autoDownloadOnDragFile: false,
      enableImageDrag: true,
      enableImagePreview: false,
      enableImagePreviewEnhanced: false,
      enableDuplicateCheck: true,
      autoCloseDetectedTabs: false,
      enableSmoothScroll: true,
      enableDebugPanel: false,
      showTabCountBadge: true,
      unlockPageRestrictions: false,
      language: getBrowserLanguage(),
      theme: 'light', // 明确指定默认主题为light
      ...POPUP_UI_DEFAULTS,
      
      // 超级拖拽方向自定义默认值
      dragUpAction: 'background',
      dragUpRightAction: 'foreground',
      dragRightAction: 'background',
      dragDownRightAction: 'foreground',
      dragDownAction: 'background',
      dragDownLeftAction: 'popupView',
      dragLeftAction: 'background',
      dragUpLeftAction: 'splitLeft',
      dragSearchEngine: 'https://www.google.com/search?q={q}',
      dragUpSearchEngine: '',
      dragUpRightSearchEngine: '',
      dragRightSearchEngine: '',
      dragDownRightSearchEngine: '',
      dragDownSearchEngine: '',
      dragDownLeftSearchEngine: '',
      dragLeftSearchEngine: '',
      dragUpLeftSearchEngine: '',
      
      // 链接预览设置
      ...POPUP_PREVIEW_DEFAULTS,
      
      // 手势动作自定义设置
      gestureLeftAction: 'goBack',
      gestureRightAction: 'forward',
      gestureUpAction: 'scrollUp',
      gestureDownAction: 'scrollDown',
      gestureDownThenRightAction: 'closeTab',
      gestureLeftThenUpAction: 'reopenClosedTab',
      gestureRightThenUpAction: 'openNewTab',
      gestureRightThenDownAction: 'refresh',
      gestureUpThenLeftAction: 'switchToLeftTab',
      gestureUpThenRightAction: 'switchToRightTab',
      gestureDownThenLeftAction: 'stopLoading',
      gestureLeftThenDownAction: 'forceRefresh',
      gestureUpThenDownAction: 'scrollToBottom',
      gestureDownThenUpAction: 'scrollToTop',
      gestureLeftThenRightAction: 'closeTab',
      gestureRightThenLeftAction: 'reopenClosedTab',
      gestureRightHoldWheelUpAction: 'scrollToTop',
      gestureRightHoldWheelDownAction: 'scrollToBottom',
      gestureLeftHoldWheelUpAction: 'noAction',
      gestureLeftHoldWheelDownAction: 'noAction',
      gestureRightHoldLeftClickAction: 'noAction',
      gestureLeftHoldRightClickAction: 'noAction',
      enableScreenshotFeature: true,
      enableScreenshotTrailCapture: false,
      enableScreenshotClipboard: false,
      enableScreenshotPreview: true,
      enableScreenshotHistory: true,
      screenshotHistoryMaxCount: 50,
      screenshotHotkeyOpenHistory: 'alt+digit6',
      screenshotHotkeyRegion: 'alt+digit7',
      screenshotHotkeyViewport: 'alt+digit8',
      screenshotHotkeyFullPage: 'alt+digit9',
      screenshotHotkeyScrolling: 'alt+digit0'
    }, function(items) {
      // 应用鼠标手势设置
      document.getElementById('enable-gesture').checked = items.enableGesture; // 从存储中读取真实状态
      document.getElementById('gesture-trail').checked = items.showGestureTrail;
      document.getElementById('gesture-hint').checked = items.showGestureHint;
      const trailHex = items.trailColor || '#FF9ECD';
      document.getElementById('trail-color').value = trailHex;
      if (trailColorPickerApi) trailColorPickerApi.setValue(trailHex);
      document.getElementById('trail-width').value = items.trailWidth;
      document.getElementById('trail-width-value').textContent = items.trailWidth;
      document.getElementById('super-drag').checked = items.enableSuperDrag;
      document.getElementById('drag-text-search').checked = items.enableDragTextSearch;
      const splitScrollEl = document.getElementById('split-scroll-sync');
      if (splitScrollEl) splitScrollEl.checked = items.enableSplitScrollSync === true;
      document.getElementById('auto-download-on-drag-file').checked = !!items.autoDownloadOnDragFile;
      const imageDragEl = document.getElementById('image-drag');
      if (imageDragEl) imageDragEl.checked = items.enableImageDrag !== false;
      document.getElementById('image-preview').checked = items.enableImagePreview;
      const enhancedEl = document.getElementById('image-preview-enhanced');
      if (enhancedEl) enhancedEl.checked = !!items.enableImagePreviewEnhanced;
      document.getElementById('duplicate-check').checked = items.enableDuplicateCheck;
      document.getElementById('auto-close-duplicates').checked = items.autoCloseDetectedTabs;
      document.getElementById('smooth-scroll').checked = items.enableSmoothScroll;
      document.getElementById('show-tab-count-badge').checked = items.showTabCountBadge;
      const unlockEl = document.getElementById('unlock-page-restrictions');
      if (unlockEl) unlockEl.checked = !!items.unlockPageRestrictions;
      
      // 调试面板状态（不使用复选框，使用内存状态+图标透明度）
      debugEnabledState = !!items.enableDebugPanel;
      const debugIcon = document.getElementById('enable-debug-panel-icon');
      if (debugIcon) {
        debugIcon.style.opacity = debugEnabledState ? '1' : '0.25';
      }
      
      // 应用超级拖拽方向自定义
      const compassPosEl = document.getElementById('super-drag-compass-position');
      if (compassPosEl) {
        const pos = items.superDragCompassPosition || 'compassHub';
        compassPosEl.value = [
          'compassAbove',
          'compassRight',
          'compassBelow',
          'compassLeft',
          'compassHub',
          'compassScreenCenter',
          'compassScreenTop',
          'compassScreenRight',
          'compassScreenBottom',
          'compassScreenLeft',
          'compassHidden'
        ].includes(pos)
          ? pos
          : 'compassHub';
      }
      document.getElementById('drag-up-action').value = items.dragUpAction || 'background';
      document.getElementById('drag-up-right-action').value = items.dragUpRightAction || 'foreground';
      document.getElementById('drag-right-action').value = items.dragRightAction || 'background';
      document.getElementById('drag-down-right-action').value = items.dragDownRightAction || 'foreground';
      document.getElementById('drag-down-action').value = items.dragDownAction || 'background';
      document.getElementById('drag-down-left-action').value = items.dragDownLeftAction || 'popupView';
      document.getElementById('drag-left-action').value = items.dragLeftAction || 'background';
      document.getElementById('drag-up-left-action').value = items.dragUpLeftAction || 'splitLeft';
      applyDragSearchEngineFromItems(items);
      lastDragSearchSlot = 'default';
      const dragSearchSlotEl = document.getElementById('drag-search-engine-slot');
      if (dragSearchSlotEl) dragSearchSlotEl.value = 'default';
      refreshDragSearchEngineInputFromCache();
      
      // 应用链接预览设置
      document.getElementById('preview-enabled').checked = items.previewEnabled;
      const previewModifier = normalizePreviewModifierKey(items.previewModifierKey);
      const previewTriggerMode = normalizePreviewTriggerMode(items.previewTriggerMode, previewModifier);
      document.getElementById('preview-modifier-key').value = previewModifier;
      const previewTriggerModeEl = document.getElementById('preview-trigger-mode');
      if (previewTriggerModeEl) previewTriggerModeEl.value = previewTriggerMode;
      setPreviewCustomKeyInputValue(items.previewCustomKey || '');
      const previewDelayClamped = clampPreviewHoverDelay(
        items.previewHoverDelay,
        previewModifier,
        previewTriggerMode
      );
      document.getElementById('preview-hover-delay').value = previewDelayClamped;
      document.getElementById('preview-hover-delay-value').textContent =
        String(previewDelayClamped);
      setPreviewMaxWindowsInputValue(items.previewMaxWindows);
      document.getElementById('preview-width').value = items.previewDefaultWidth;
      document.getElementById('preview-width-value').textContent = items.previewDefaultWidth;
      document.getElementById('preview-height').value = items.previewDefaultHeight;
      document.getElementById('preview-height-value').textContent = items.previewDefaultHeight;
      document.getElementById('preview-position').value = items.previewPosition;
      document.getElementById('preview-search-engine').value = items.previewSearchEngine;
      document.getElementById('text-search-preview').checked = items.enableTextSearchPreview;
      
      // 应用手势动作自定义设置
      document.getElementById('gesture-left-action').value = items.gestureLeftAction || 'goBack';
      document.getElementById('gesture-right-action').value = items.gestureRightAction || 'forward';
      document.getElementById('gesture-up-action').value = items.gestureUpAction || 'scrollUp';
      document.getElementById('gesture-down-action').value = items.gestureDownAction || 'scrollDown';
      document.getElementById('gesture-downThenRight-action').value = items.gestureDownThenRightAction || 'closeTab';
      document.getElementById('gesture-leftThenUp-action').value = items.gestureLeftThenUpAction || 'reopenClosedTab';
      document.getElementById('gesture-rightThenUp-action').value = items.gestureRightThenUpAction || 'openNewTab';
      document.getElementById('gesture-rightThenDown-action').value = items.gestureRightThenDownAction || 'refresh';
      document.getElementById('gesture-upThenLeft-action').value = items.gestureUpThenLeftAction || 'switchToLeftTab';
      document.getElementById('gesture-upThenRight-action').value = items.gestureUpThenRightAction || 'switchToRightTab';
      document.getElementById('gesture-downThenLeft-action').value = items.gestureDownThenLeftAction || 'stopLoading';
      document.getElementById('gesture-leftThenDown-action').value = items.gestureLeftThenDownAction || 'forceRefresh';
      document.getElementById('gesture-upThenDown-action').value = items.gestureUpThenDownAction || 'scrollToBottom';
      document.getElementById('gesture-downThenUp-action').value = items.gestureDownThenUpAction || 'scrollToTop';
      document.getElementById('gesture-leftThenRight-action').value = items.gestureLeftThenRightAction || 'closeTab';
      document.getElementById('gesture-rightThenLeft-action').value = items.gestureRightThenLeftAction || 'reopenClosedTab';
      document.getElementById('gesture-rightHoldWheelUp-action').value = items.gestureRightHoldWheelUpAction || 'scrollToTop';
      document.getElementById('gesture-rightHoldWheelDown-action').value = items.gestureRightHoldWheelDownAction || 'scrollToBottom';
      document.getElementById('gesture-leftHoldWheelUp-action').value = items.gestureLeftHoldWheelUpAction || 'noAction';
      document.getElementById('gesture-leftHoldWheelDown-action').value = items.gestureLeftHoldWheelDownAction || 'noAction';
      document.getElementById('gesture-rightHoldLeftClick-action').value = items.gestureRightHoldLeftClickAction || 'noAction';
      document.getElementById('gesture-leftHoldRightClick-action').value = items.gestureLeftHoldRightClickAction || 'noAction';
      
      const enableShotEl = document.getElementById('enable-screenshot-feature');
      if (enableShotEl) enableShotEl.checked = !!items.enableScreenshotFeature;
      const enableTrailShotEl = document.getElementById('enable-screenshot-trail');
      if (enableTrailShotEl) enableTrailShotEl.checked = !!items.enableScreenshotTrailCapture;
      const enableClipboardShotEl = document.getElementById('enable-screenshot-clipboard');
      if (enableClipboardShotEl) enableClipboardShotEl.checked = items.enableScreenshotClipboard === true;
      const enablePreviewShotEl = document.getElementById('enable-screenshot-preview');
      if (enablePreviewShotEl) enablePreviewShotEl.checked = items.enableScreenshotPreview !== false;
      const enableHistoryShotEl = document.getElementById('enable-screenshot-history');
      if (enableHistoryShotEl) enableHistoryShotEl.checked = items.enableScreenshotHistory !== false;
      applyScreenshotHistoryMaxCountUI(items.screenshotHistoryMaxCount);
      applyScreenshotHotkeyInputsFromItems(items);
      
      // 自定义行为：禁用网站列表
      setDisabledSitesListUi(items.disabledSites || [], true);
      
      // 根据触发按键设置调整小窗延迟范围
      updatePreviewTriggerControls();
      updatePreviewDelayRange(previewModifier, previewTriggerMode);
      
      // 应用主题设置 - 确保使用明确加载的主题值
      const theme = items.theme || 'light';
      const root = document.documentElement;
      if (root.getAttribute('data-theme') !== theme) {
        applyThemeInstant(theme);
      } else if (themeToggle) {
        updateThemeToggleIcon(theme);
      }
      applySettingsFontSize(items.settingsFontSize);
      
      localizeSelectedOptions();
      
      // 根据鼠标手势是否启用来设置相关选项的禁用状态
      updateGestureRelatedOptions(items.enableGesture);
      
      // 根据重复标签检测是否启用来设置自动关闭选项的禁用状态
      updateDuplicateTabOptions(items.enableDuplicateCheck);
      
      // 根据超级拖拽是否启用来设置相关选项的禁用状态
      updateSuperDragRelatedOptions(items.enableSuperDrag);
      
      // 根据图片预览是否启用来设置增强选项的禁用状态
      updateImagePreviewRelatedOptions(items.enableImagePreview);
      
      // 根据链接预览是否启用来设置相关选项的禁用状态
      updatePreviewRelatedOptions(items.previewEnabled);

      console.log('设置加载完成，鼠标手势状态:', items.enableGesture);
    });
  } catch (e) {
    console.error('加载设置发生错误:', e.message);
    showStatusMessage('loadError', true);
    revealUiPending();
  }
}

// 更新与手势相关的选项的启用/禁用状态
function updateGestureRelatedOptions(enableGesture) {
  // 设置相关DOM元素的禁用状态
  gestureTrailCheckbox.disabled = !enableGesture;
  gestureHintCheckbox.disabled = !enableGesture;
  if (trailColorPickerApi) trailColorPickerApi.setDisabled(!enableGesture);
  else if (trailColorInput) trailColorInput.disabled = !enableGesture;
  trailWidthInput.disabled = !enableGesture;
  
  // 更新视觉反馈
  const gestureRelatedOptions = [
    gestureTrailCheckbox.parentElement,
    gestureHintCheckbox.parentElement,
    document.getElementById('trail-color-setting-row') || trailColorInput.parentElement,
    trailWidthInput.parentElement
  ];
  
  gestureRelatedOptions.forEach(element => {
    if (enableGesture) {
      element.classList.remove('disabled-option');
      element.classList.remove('no-hover-effect'); // 移除禁用悬停效果类
    } else {
      element.classList.add('disabled-option');
      element.classList.add('no-hover-effect'); // 添加禁用悬停效果类
    }
  });
  
  // 记录状态变化 - 用于调试
  console.log('手势相关选项状态已更新, 启用状态:', enableGesture);
  updateScreenshotFeatureControls();
}

// 更新与重复标签检测相关的选项的启用/禁用状态
function updateDuplicateTabOptions(enableDuplicateCheck) {
  autoCloseDuplicatesCheckbox.disabled = !enableDuplicateCheck;
  
  // 更新视觉反馈
  if (enableDuplicateCheck) {
    autoCloseDuplicatesCheckbox.parentElement.style.opacity = '1';
    autoCloseDuplicatesCheckbox.parentElement.classList.remove('no-hover-effect'); // 移除禁用悬停效果类
  } else {
    autoCloseDuplicatesCheckbox.parentElement.style.opacity = '0.6';
    autoCloseDuplicatesCheckbox.parentElement.classList.add('no-hover-effect'); // 添加禁用悬停效果类
  }
}

// 更新与图片预览相关的选项的启用/禁用状态
function updateImagePreviewRelatedOptions(enableImagePreview) {
  const enhancedEl = document.getElementById('image-preview-enhanced');
  if (!enhancedEl) return;
  enhancedEl.disabled = !enableImagePreview;
  if (enableImagePreview) {
    enhancedEl.parentElement.style.opacity = '1';
    enhancedEl.parentElement.classList.remove('no-hover-effect');
  } else {
    enhancedEl.checked = false;
    enhancedEl.parentElement.style.opacity = '0.6';
    enhancedEl.parentElement.classList.add('no-hover-effect');
  }
}

// 更新与超级拖拽相关的选项的启用/禁用状态
function updateSuperDragRelatedOptions(enableSuperDrag) {
  const dragTextSearchCheckbox = document.getElementById('drag-text-search');
  const imageDragCheckbox = document.getElementById('image-drag');
  const autoDownloadOnDragFileCheckbox = document.getElementById('auto-download-on-drag-file');
  dragTextSearchCheckbox.disabled = !enableSuperDrag;
  if (imageDragCheckbox) imageDragCheckbox.disabled = !enableSuperDrag;
  if (autoDownloadOnDragFileCheckbox) autoDownloadOnDragFileCheckbox.disabled = !enableSuperDrag;
  
  // 更新视觉反馈
  [dragTextSearchCheckbox, imageDragCheckbox, autoDownloadOnDragFileCheckbox].forEach((checkbox) => {
    if (!checkbox || !checkbox.parentElement) return;
    if (enableSuperDrag) {
      checkbox.parentElement.style.opacity = '1';
      checkbox.parentElement.classList.remove('no-hover-effect'); // 移除禁用悬停效果类
    } else {
      checkbox.parentElement.style.opacity = '0.6';
      checkbox.parentElement.classList.add('no-hover-effect'); // 添加禁用悬停效果类
    }
  });
  updateSplitScrollSyncState();
}

// 当任一拖拽方向选择分屏时启用「分屏同步滚动」，否则置灰
function updateSplitScrollSyncState() {
  const splitValues = ['splitLeft', 'splitRight', 'splitUp', 'splitDown'];
  const hasSplit = [
    'drag-up-action', 'drag-up-right-action', 'drag-right-action', 'drag-down-right-action',
    'drag-down-action', 'drag-down-left-action', 'drag-left-action', 'drag-up-left-action'
  ].some((id) => splitValues.includes(document.getElementById(id)?.value));
  const enableSuperDrag = document.getElementById('super-drag')?.checked;
  const splitScrollEl = document.getElementById('split-scroll-sync');
  if (!splitScrollEl) return;
  const enabled = !!enableSuperDrag && hasSplit;
  splitScrollEl.disabled = !enabled;
  const parent = splitScrollEl.closest('.setting-item');
  if (parent) {
    parent.style.opacity = enabled ? '1' : '0.6';
    /* 勿用 no-hover-effect：其样式含 .no-hover-effect ~ .search-engine-examples，会误关下方示例区动效 */
    parent.classList.toggle('split-scroll-sync-disabled', !enabled);
  }
}

// 更新与小窗视图相关的选项的启用/禁用状态
function updatePreviewRelatedOptions(enablePreview) {
  // 获取所有相关的设置项元素
  const textSearchPreview = document.getElementById('text-search-preview');
  const previewModifierKey = document.getElementById('preview-modifier-key');
  const previewTriggerMode = document.getElementById('preview-trigger-mode');
  const previewCustomKey = document.getElementById('preview-custom-key');
  const previewHoverDelay = document.getElementById('preview-hover-delay');
  const previewMaxWindows = document.getElementById('preview-max-windows');
  const previewWidth = document.getElementById('preview-width');
  const previewHeight = document.getElementById('preview-height');
  const previewPosition = document.getElementById('preview-position');
  const previewSearchEngine = document.getElementById('preview-search-engine');
  
  // 设置禁用状态
  textSearchPreview.disabled = !enablePreview;
  previewModifierKey.disabled = !enablePreview;
  if (previewTriggerMode) previewTriggerMode.disabled = !enablePreview || previewModifierKey.value === 'none';
  if (previewCustomKey) previewCustomKey.disabled = !enablePreview || previewModifierKey.value !== 'custom';
  previewHoverDelay.disabled = !enablePreview;
  previewMaxWindows.disabled = !enablePreview;
  previewWidth.disabled = !enablePreview;
  previewHeight.disabled = !enablePreview;
  previewPosition.disabled = !enablePreview;
  previewSearchEngine.disabled = !enablePreview;
  
  // 更新视觉反馈
  const previewRelatedOptions = [
    textSearchPreview.parentElement,
    previewModifierKey.parentElement,
    previewTriggerMode && previewTriggerMode.parentElement,
    previewCustomKey && previewCustomKey.parentElement,
    previewHoverDelay.parentElement,
    previewMaxWindows.parentElement,
    previewWidth.parentElement,
    previewHeight.parentElement,
    previewPosition.parentElement,
    previewSearchEngine.parentElement
  ];
  
  previewRelatedOptions.filter(Boolean).forEach(element => {
    if (enablePreview) {
      element.style.opacity = '1';
      element.classList.remove('no-hover-effect'); // 移除禁用悬停效果类
    } else {
      element.style.opacity = '0.6';
      element.classList.add('no-hover-effect'); // 添加禁用悬停效果类
    }
  });
  
  // 如果小窗视图已启用，还需要检查文字搜索是否启用来确定搜索引擎URL的状态
  if (enablePreview) {
    updateTextSearchPreviewOptions(textSearchPreview.checked);
  }
  updatePreviewTriggerControls();
}

// 更新选中文字搜索相关选项的启用/禁用状态
function updateTextSearchPreviewOptions(enableTextSearch) {
  const previewSearchEngine = document.getElementById('preview-search-engine');
  
  // 只有当小窗视图启用时，这个函数才有效
  if (document.getElementById('preview-enabled').checked) {
    // 设置搜索引擎URL的禁用状态
    previewSearchEngine.disabled = !enableTextSearch;
    
    // 更新视觉反馈
    if (enableTextSearch) {
      previewSearchEngine.parentElement.style.opacity = '1';
      previewSearchEngine.parentElement.classList.remove('no-hover-effect'); // 移除禁用悬停效果类
    } else {
      previewSearchEngine.parentElement.style.opacity = '0.6';
      previewSearchEngine.parentElement.classList.add('no-hover-effect'); // 添加禁用悬停效果类
    }
  }
}

// 为所有滑块设置项添加鼠标滚轮控制
function setupRangeWheelControl() {
  // 获取所有range类型的输入元素
  const rangeInputs = document.querySelectorAll('input[type="range"]');
  
  // 获取当前语言
  const currentLang = getBrowserLanguage();
  
  rangeInputs.forEach(rangeInput => {
    const parent = rangeInput.parentElement;
    const valueDisplay = document.getElementById(`${rangeInput.id}-value`);
    const step = parseInt(rangeInput.step) || 1;
    let wheelArmed = false;
    let armTimer = null;

    function disarmWheel() {
      wheelArmed = false;
      if (armTimer != null) {
        clearTimeout(armTimer);
        armTimer = null;
      }
    }

    parent.addEventListener('mouseenter', function () {
      disarmWheel();
      armTimer = setTimeout(function () {
        armTimer = null;
        wheelArmed = true;
      }, CONFIG.WHEEL_ARM_HOVER_MS);
    });

    parent.addEventListener('mouseleave', disarmWheel);

    parent.addEventListener(
      'wheel',
      function (event) {
        if (rangeInput.disabled || parent.classList.contains('no-hover-effect')) {
          return;
        }
        if (!wheelArmed) {
          return;
        }
        event.preventDefault();

        let currentValue = parseInt(rangeInput.value, 10);
        if (event.deltaY < 0) {
          currentValue = Math.min(parseInt(rangeInput.max, 10), currentValue + step);
        } else {
          currentValue = Math.max(parseInt(rangeInput.min, 10), currentValue - step);
        }

        rangeInput.value = currentValue;
        if (valueDisplay) {
          valueDisplay.textContent = currentValue;
        }
        const changeEvent = new Event('change', { bubbles: true });
        rangeInput.dispatchEvent(changeEvent);

        rangeInput.classList.add('wheel-adjusted');
        setTimeout(() => {
          rangeInput.classList.remove('wheel-adjusted');
        }, 200);
      },
      { passive: false }
    );

    parent.setAttribute('title', getI18nMessage('wheelTip'));
  });
  
  // 更新延迟范围提示（如果需要）
  updateDelayTitleForLanguage(currentLang);
}

function clampPreviewHoverDelay(delay, modifierKey, triggerMode) {
  return POPUP_SETTINGS_API.clampPreviewHoverDelay(delay);
}

function updatePreviewTriggerControls() {
  const previewEnabled = document.getElementById('preview-enabled')?.checked !== false;
  const modifierEl = document.getElementById('preview-modifier-key');
  const modeEl = document.getElementById('preview-trigger-mode');
  const customRow = document.getElementById('preview-custom-key-row');
  const customEl = document.getElementById('preview-custom-key');
  if (!modifierEl) return;

  const modifierKey = normalizePreviewModifierKey(modifierEl.value);
  if (modifierEl.value !== modifierKey) modifierEl.value = modifierKey;
  const mode = normalizePreviewTriggerMode(modeEl ? modeEl.value : defaultSettings.previewTriggerMode, modifierKey);
  if (modeEl && modeEl.value !== mode) modeEl.value = mode;

  if (modeEl) {
    modeEl.disabled = !previewEnabled || modifierKey === 'none';
    if (modeEl.parentElement) {
      const disabled = !previewEnabled || modifierKey === 'none';
      modeEl.parentElement.style.opacity = disabled ? '0.6' : '1';
      modeEl.parentElement.classList.toggle('no-hover-effect', disabled);
    }
  }

  const customDisabled = !previewEnabled || modifierKey !== 'custom';
  if (customEl) customEl.disabled = customDisabled;
  if (customRow) {
    customRow.style.display = modifierKey === 'custom' ? '' : 'none';
    customRow.style.opacity = customDisabled ? '0.6' : '1';
    customRow.classList.toggle('no-hover-effect', customDisabled);
  }
}

// 根据触发按键的选择调整小窗延迟的范围
function updatePreviewDelayRange(modifierKey, triggerMode) {
  const previewHoverDelay = document.getElementById('preview-hover-delay');
  const previewHoverDelayValue = document.getElementById('preview-hover-delay-value');
  if (!previewHoverDelay || !previewHoverDelayValue) return;
  const delayParent = previewHoverDelay.parentElement;
  previewHoverDelay.max = CONFIG.MAX_PREVIEW_DELAY.toString();
  const normalizedModifierKey = normalizePreviewModifierKey(modifierKey);
  const normalizedTriggerMode = normalizePreviewTriggerMode(triggerMode, normalizedModifierKey);
  const clamped = clampPreviewHoverDelay(previewHoverDelay.value, normalizedModifierKey, normalizedTriggerMode);
  if (String(previewHoverDelay.value) !== String(clamped)) {
    previewHoverDelay.value = String(clamped);
    previewHoverDelayValue.textContent = String(clamped);
  }
  if (delayParent) {
    delayParent.setAttribute(
      'title',
      normalizedModifierKey === 'none'
        ? getI18nMessage('wheelTip')
        : getI18nMessage('modifierKeyDelayTip')
    );
  }
  updatePreviewTriggerControls();
}

// 根据语言更新延迟提示
function updateDelayTitleForLanguage(lang) {
  const previewHoverDelay = document.getElementById('preview-hover-delay');
  const modifierKey = document.getElementById('preview-modifier-key')?.value || defaultSettings.previewModifierKey;
  const triggerMode = document.getElementById('preview-trigger-mode')?.value || defaultSettings.previewTriggerMode;
  
  if (previewHoverDelay) {
    updatePreviewDelayRange(modifierKey, triggerMode);
  }
}

// 获取当前设置快照
function getSettingsSnapshot() {
  flushDragSearchEngineInputToCache();
  return {
    enableGesture: enableGestureCheckbox.checked,
    showGestureTrail: gestureTrailCheckbox.checked,
    showGestureHint: gestureHintCheckbox.checked,
    trailColor: trailColorPickerApi
      ? trailColorPickerApi.getValue()
      : trailColorInput
        ? trailColorInput.value
        : '#FF9ECD',
    trailWidth: parseInt(trailWidthInput.value),
    enableSuperDrag: superDragCheckbox.checked,
    superDragCompassPosition:
      document.getElementById('super-drag-compass-position')?.value || 'compassHub',
    enableDragTextSearch: document.getElementById('drag-text-search').checked,
    enableSplitScrollSync: document.getElementById('split-scroll-sync')?.checked === true,
    autoDownloadOnDragFile: document.getElementById('auto-download-on-drag-file').checked,
    enableImageDrag: document.getElementById('image-drag')?.checked !== false,
    enableImagePreview: imagePreviewCheckbox.checked,
    enableImagePreviewEnhanced: document.getElementById('image-preview-enhanced')?.checked === true,
    enableDuplicateCheck: duplicateCheckCheckbox.checked,
    autoCloseDetectedTabs: autoCloseDuplicatesCheckbox.checked,
    enableSmoothScroll: document.getElementById('smooth-scroll').checked,
    showTabCountBadge: document.getElementById('show-tab-count-badge').checked,
    unlockPageRestrictions: document.getElementById('unlock-page-restrictions')?.checked === true,
    language: getBrowserLanguage(),
    theme: document.documentElement.getAttribute('data-theme') || 'light',
    settingsFontSize: normalizeSettingsFontSize(
      document.documentElement.getAttribute('data-settings-font-size')
    ),
    enableDebugPanel: debugEnabledState,
    // 超级拖拽方向自定义
    dragUpAction: document.getElementById('drag-up-action').value,
    dragUpRightAction: document.getElementById('drag-up-right-action').value,
    dragRightAction: document.getElementById('drag-right-action').value,
    dragDownRightAction: document.getElementById('drag-down-right-action').value,
    dragDownAction: document.getElementById('drag-down-action').value,
    dragDownLeftAction: document.getElementById('drag-down-left-action').value,
    dragLeftAction: document.getElementById('drag-left-action').value,
    dragUpLeftAction: document.getElementById('drag-up-left-action').value,
    dragSearchEngine: dragSearchEngineCache.dragSearchEngine,
    dragUpSearchEngine: dragSearchEngineCache.dragUpSearchEngine,
    dragUpRightSearchEngine: dragSearchEngineCache.dragUpRightSearchEngine,
    dragRightSearchEngine: dragSearchEngineCache.dragRightSearchEngine,
    dragDownRightSearchEngine: dragSearchEngineCache.dragDownRightSearchEngine,
    dragDownSearchEngine: dragSearchEngineCache.dragDownSearchEngine,
    dragDownLeftSearchEngine: dragSearchEngineCache.dragDownLeftSearchEngine,
    dragLeftSearchEngine: dragSearchEngineCache.dragLeftSearchEngine,
    dragUpLeftSearchEngine: dragSearchEngineCache.dragUpLeftSearchEngine,
    // 小窗视图设置
    previewEnabled: document.getElementById('preview-enabled').checked,
    previewHoverDelay: clampPreviewHoverDelay(
      document.getElementById('preview-hover-delay').value,
      document.getElementById('preview-modifier-key').value,
      document.getElementById('preview-trigger-mode')?.value || defaultSettings.previewTriggerMode
    ),
    previewModifierKey: normalizePreviewModifierKey(document.getElementById('preview-modifier-key').value),
    previewTriggerMode: normalizePreviewTriggerMode(
      document.getElementById('preview-trigger-mode')?.value || defaultSettings.previewTriggerMode,
      document.getElementById('preview-modifier-key').value
    ),
    previewCustomKey: getPreviewCustomKeyInputStorage(),
    previewMaxWindows: getPreviewMaxWindowsStorageValue(),
    previewDefaultWidth: parseInt(document.getElementById('preview-width').value),
    previewDefaultHeight: parseInt(document.getElementById('preview-height').value),
    previewPosition: document.getElementById('preview-position').value,
    previewSearchEngine: document.getElementById('preview-search-engine').value,
    enableTextSearchPreview: document.getElementById('text-search-preview').checked,
    // 手势动作自定义设置
    gestureLeftAction: document.getElementById('gesture-left-action').value,
    gestureRightAction: document.getElementById('gesture-right-action').value,
    gestureUpAction: document.getElementById('gesture-up-action').value,
    gestureDownAction: document.getElementById('gesture-down-action').value,
    gestureDownThenRightAction: document.getElementById('gesture-downThenRight-action').value,
    gestureLeftThenUpAction: document.getElementById('gesture-leftThenUp-action').value,
    gestureRightThenUpAction: document.getElementById('gesture-rightThenUp-action').value,
    gestureRightThenDownAction: document.getElementById('gesture-rightThenDown-action').value,
    gestureUpThenLeftAction: document.getElementById('gesture-upThenLeft-action').value,
    gestureUpThenRightAction: document.getElementById('gesture-upThenRight-action').value,
    gestureDownThenLeftAction: document.getElementById('gesture-downThenLeft-action').value,
    gestureLeftThenDownAction: document.getElementById('gesture-leftThenDown-action').value,
    gestureUpThenDownAction: document.getElementById('gesture-upThenDown-action').value,
    gestureDownThenUpAction: document.getElementById('gesture-downThenUp-action').value,
    gestureLeftThenRightAction: document.getElementById('gesture-leftThenRight-action').value,
    gestureRightThenLeftAction: document.getElementById('gesture-rightThenLeft-action').value,
    gestureRightHoldWheelUpAction: document.getElementById('gesture-rightHoldWheelUp-action').value,
    gestureRightHoldWheelDownAction: document.getElementById('gesture-rightHoldWheelDown-action').value,
    gestureLeftHoldWheelUpAction: document.getElementById('gesture-leftHoldWheelUp-action').value,
    gestureLeftHoldWheelDownAction: document.getElementById('gesture-leftHoldWheelDown-action').value,
    gestureRightHoldLeftClickAction: document.getElementById('gesture-rightHoldLeftClick-action').value,
    gestureLeftHoldRightClickAction: document.getElementById('gesture-leftHoldRightClick-action').value,
    enableScreenshotFeature: document.getElementById('enable-screenshot-feature')?.checked === true,
    enableScreenshotTrailCapture:
      document.getElementById('enable-screenshot-trail')?.checked === true,
    enableScreenshotClipboard:
      document.getElementById('enable-screenshot-clipboard')?.checked === true,
    enableScreenshotPreview: document.getElementById('enable-screenshot-preview')?.checked !== false,
    enableScreenshotHistory: document.getElementById('enable-screenshot-history')?.checked !== false,
    screenshotHistoryMaxCount: clampScreenshotHistoryMaxCountUI(
      document.getElementById('screenshot-history-max-count')?.value
    ),
    screenshotHotkeyOpenHistory: getScreenshotHotkeyInputStorage(document.getElementById('screenshot-hotkey-open-history')),
    screenshotHotkeyRegion: getScreenshotHotkeyInputStorage(document.getElementById('screenshot-hotkey-region')),
    screenshotHotkeyViewport: getScreenshotHotkeyInputStorage(document.getElementById('screenshot-hotkey-viewport')),
    screenshotHotkeyFullPage: getScreenshotHotkeyInputStorage(document.getElementById('screenshot-hotkey-fullpage')),
    screenshotHotkeyScrolling: getScreenshotHotkeyInputStorage(document.getElementById('screenshot-hotkey-scrolling')),
    disabledSites: normalizeDisabledSitesList(
      (document.getElementById('disabled-sites-list')?.value || '')
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  };
}

// 防抖保存设置 - 性能优化
const debouncedSaveSettings = CommonUtils.debounce(() => {
  try {
    persistSettingsToStorage(getSettingsSnapshot());
  } catch (e) {
    CommonUtils.handleError(e, 'saveSettings');
  }
}, CONFIG.DEBOUNCE_DELAY);

// 保存设置
function saveSettings(event = null) {
  saveSettingsImmediate();
}

function saveSettingsDebounced() {
  debouncedSaveSettings();
}

// 立即保存设置（用于需要立即保存的场景）
// options.sectionSaveStatusId：可选，在对应区块标题旁显示「设置已保存」（如 superdrag-save-status）
function saveSettingsImmediate(options) {
  const sectionId = options && options.sectionSaveStatusId ? options.sectionSaveStatusId : null;
  try {
    debouncedSaveSettings.cancel();
    persistSettingsToStorage(getSettingsSnapshot(), () => finalizeSave(sectionId));
  } catch (e) {
    CommonUtils.handleError(e, 'saveSettings');
  }
}

// 重置设置
function resetSettings() {
  try {
    // 获取当前语言
    let currentLang = getBrowserLanguage();
    
    // 显示重置进行中状态
    resetButton.disabled = true;
    saveStatus.textContent = getI18nMessage('resetting');
    saveStatus.style.color = '#FFA500'; // 橙色，表示进行中
    saveStatus.classList.add('show');
    
    // 隐藏导入、导出、重设按钮（使用 visibility 避免布局抖动）
    toggleControlButtonsVisibility(true);
    
    // 创建一个深拷贝的默认设置对象
    const resetConfig = structuredClone(defaultSettings);
    
    // 不再保留当前语言设置，使用浏览器默认语言 (默认设置中已经包含)
    // 注意：只保留主题设置，方便用户体验
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    resetConfig.theme = currentTheme;
    
    const resetDisabledSites = normalizeDisabledSitesList(resetConfig.disabledSites);
    delete resetConfig.disabledSites;

    chrome.storage.local.set({ disabledSites: resetDisabledSites }, () => {
    chrome.storage.sync.set(resetConfig, () => {
      if (chrome.runtime.lastError) {
        console.log('重置设置错误:', chrome.runtime.lastError.message);
        resetButton.disabled = false;
        saveStatus.textContent = getI18nMessage('resetError');
        saveStatus.style.color = '#F44336'; // 红色，表示错误
        // 保持按钮隐藏状态，等待消息消失后恢复
        setTimeout(() => {
          saveStatus.classList.remove('show');
          setTimeout(() => {
            saveStatus.style.color = '#4CAF50';
            saveStatus.textContent = '';
            toggleControlButtonsVisibility(false);
          }, CONFIG.FADE_DURATION);
        }, CONFIG.STATUS_MESSAGE_DURATION);
        return;
      }
      
      // 加载默认设置到界面
      loadSettings();
      
      // 立即更新界面上的值，不等待加载
      document.getElementById('preview-enabled').checked = resetConfig.previewEnabled;
      document.getElementById('preview-modifier-key').value = resetConfig.previewModifierKey;
      document.getElementById('preview-trigger-mode').value = resetConfig.previewTriggerMode;
      setPreviewCustomKeyInputValue(resetConfig.previewCustomKey);
      document.getElementById('preview-hover-delay').value = resetConfig.previewHoverDelay;
      document.getElementById('preview-hover-delay-value').textContent = resetConfig.previewHoverDelay;
      setPreviewMaxWindowsInputValue(resetConfig.previewMaxWindows);
      document.getElementById('preview-width').value = resetConfig.previewDefaultWidth;
      document.getElementById('preview-width-value').textContent = resetConfig.previewDefaultWidth;
      document.getElementById('preview-height').value = resetConfig.previewDefaultHeight;
      document.getElementById('preview-height-value').textContent = resetConfig.previewDefaultHeight;
      document.getElementById('preview-position').value = resetConfig.previewPosition;
      document.getElementById('preview-search-engine').value = resetConfig.previewSearchEngine;
      document.getElementById('text-search-preview').checked = resetConfig.enableTextSearchPreview;
      // 更新调试面板状态
      debugEnabledState = resetConfig.enableDebugPanel;
      const debugIcon = document.getElementById('enable-debug-panel-icon');
      if (debugIcon) {
        debugIcon.style.opacity = debugEnabledState ? '1' : '0.25';
      }
      
      // 更新标签页数量徽章设置
      document.getElementById('show-tab-count-badge').checked = resetConfig.showTabCountBadge;
      const unlockReset = document.getElementById('unlock-page-restrictions');
      if (unlockReset) unlockReset.checked = !!resetConfig.unlockPageRestrictions;
      applyScreenshotHotkeyInputsFromItems(resetConfig);
      updatePreviewTriggerControls();
      updatePreviewDelayRange(resetConfig.previewModifierKey, resetConfig.previewTriggerMode);
      
      // 显示重置成功状态
      resetButton.disabled = false;
      
      // 获取重置后的语言进行提示
      const browserLang = getBrowserLanguage();
      saveStatus.textContent = getI18nMessage('settingsReset');
      saveStatus.style.color = '#4CAF50'; // 绿色，表示成功
      
      // 更新UI语言
      updateUIText();
      
      // 使用配置常量恢复原始状态
      setTimeout(() => {
        saveStatus.classList.remove('show');
        setTimeout(() => {
          saveStatus.style.color = '#4CAF50'; // 恢复默认颜色
          saveStatus.textContent = '';
          // 恢复显示导入、导出、重设按钮
          toggleControlButtonsVisibility(false);
        }, CONFIG.FADE_DURATION);
      }, CONFIG.RESET_BUTTON_DISABLE_DURATION);
    });
    });
  } catch (e) {
    console.log('重置设置异常:', e.message);
    resetButton.disabled = false;
    saveStatus.classList.remove('show');
    // 恢复显示按钮
    toggleControlButtonsVisibility(false);
  }
}

// 导出设置到 JSON 文件
function exportSettings() {
  try {
    const exportData = {
      version: chrome.runtime.getManifest().version,
      exportDate: new Date().toISOString(),
      settings: getSettingsSnapshot()
    };
      
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mouse-gesture-settings-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showStatusMessage('exportSuccess');
  } catch (e) {
    console.error('导出设置错误:', e.message);
    showStatusMessage('exportError', true);
  }
}

// 处理导入文件选择
async function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const importData = JSON.parse(await file.text());
    if (!importData.settings || typeof importData.settings !== 'object') {
      showStatusMessage('importError', true);
      return;
    }
    importSettings(importData.settings);
  } catch (error) {
    console.error('解析导入文件错误:', error.message);
    showStatusMessage('importError', true);
  }
  // 清空文件输入，允许重复选择同一文件
  event.target.value = '';
}

// 导入设置
function importSettings(settings) {
  try {
    const validSettings = {};
    const allowedKeys = Object.keys(defaultSettings);

    for (const key of allowedKeys) {
      if (key in settings) {
        validSettings[key] = settings[key];
      }
    }
    
    const disabledSites = normalizeDisabledSitesList(validSettings.disabledSites);
    delete validSettings.disabledSites;

    chrome.storage.local.set({ disabledSites }, () => {
      chrome.storage.sync.set(validSettings, () => {
      if (chrome.runtime.lastError) {
        showStatusMessage('importError', true);
        return;
      }
      loadSettings();
      
      showStatusMessage('importSuccess');
      });
    });
  } catch (e) {
    console.error('导入设置错误:', e.message);
    showStatusMessage('importError', true);
  }
}

// 更新轨迹宽度显示
function updateTrailWidthValue() {
  trailWidthValue.textContent = trailWidthInput.value;
}

// 显示扩展版本号
function displayExtensionVersion() {
  const versionInfo = document.getElementById('version-info');
  // 从manifest获取版本号
  const manifest = chrome.runtime.getManifest();
  if (versionInfo && manifest) {
    versionInfo.replaceChildren();
    const link = document.createElement('a');
    link.href = chrome.runtime.getURL('changelog.html');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `更新日志 / Changelog v${manifest.version}`);
    const img = document.createElement('img');
    img.src = 'images/icon16.png';
    img.className = 'footer-icon';
    img.alt = 'icon';
    link.appendChild(img);
    link.appendChild(document.createTextNode(` v${manifest.version}`));
    versionInfo.appendChild(link);
  }
}

function setupVersionChangelogPopover() {
  const trigger = document.getElementById('version-info');
  if (!trigger || trigger.classList.contains('version-changelog-ready')) return;

  const popover = document.createElement('div');
  popover.className = 'version-changelog-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', '更新日志 / Changelog');
  popover.setAttribute('aria-hidden', 'true');
  document.body.appendChild(popover);
  trigger.classList.add('version-changelog-ready');

  let frame = null;
  let hideTimer = 0;

  function ensureFrame() {
    if (frame) return;
    frame = document.createElement('iframe');
    frame.className = 'version-changelog-frame';
    frame.title = '更新日志 / Changelog';
    frame.src = chrome.runtime.getURL('changelog.html?embedded=1');
    popover.appendChild(frame);
  }

  function positionPopover() {
    const triggerRect = trigger.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const gap = 8;
    const viewportPadding = 8;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
    const centeredLeft = triggerRect.left + (triggerRect.width - width) / 2;
    const left = Math.min(maxLeft, Math.max(viewportPadding, centeredLeft));
    const above = triggerRect.top - height - gap;
    const below = triggerRect.bottom + gap;
    const top = above >= viewportPadding
      ? above
      : Math.min(Math.max(viewportPadding, below), Math.max(viewportPadding, window.innerHeight - height - viewportPadding));

    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function showPopover() {
    window.clearTimeout(hideTimer);
    ensureFrame();
    popover.classList.add('version-changelog-popover--visible');
    popover.setAttribute('aria-hidden', 'false');
    window.requestAnimationFrame(positionPopover);
  }

  function hidePopover() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      popover.classList.remove('version-changelog-popover--visible');
      popover.setAttribute('aria-hidden', 'true');
    }, 120);
  }

  trigger.addEventListener('mouseenter', showPopover);
  trigger.addEventListener('focusin', showPopover);
  trigger.addEventListener('mouseleave', hidePopover);
  trigger.addEventListener('focusout', hidePopover);
  popover.addEventListener('mouseenter', () => window.clearTimeout(hideTimer));
  popover.addEventListener('mouseleave', hidePopover);
  window.addEventListener('resize', positionPopover);
  window.addEventListener('scroll', positionPopover, true);
}

function setupRewardQrcodePopover() {
  const popover = document.getElementById('reward-qrcode-popover');
  if (!popover) return;

  const triggers = [
    document.querySelector('.header h1 a'),
    document.querySelector('.header-button.like-button'),
    document.querySelector('.header-button.kofi-button')
  ].filter(Boolean);

  if (!triggers.length) return;

  let activeTrigger = null;
  let hideTimer = 0;
  const margin = 8;
  const gap = 8;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function positionPopover(trigger) {
    if (!trigger || !popover) return;
    const rect = trigger.getBoundingClientRect();
    const popoverRect = popover.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    let top = rect.bottom + gap;
    if (top + popoverRect.height + margin > viewportHeight) {
      top = rect.top - popoverRect.height - gap;
    }
    top = clamp(top, margin, viewportHeight - popoverRect.height - margin);

    let left = rect.left + rect.width / 2 - popoverRect.width / 2;
    left = clamp(left, margin, viewportWidth - popoverRect.width - margin);

    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function showPopover(trigger) {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
    activeTrigger = trigger;
    popover.classList.add('reward-qrcode-popover--visible');
    popover.setAttribute('aria-hidden', 'false');
    positionPopover(trigger);
    requestAnimationFrame(() => positionPopover(trigger));
  }

  function hidePopover() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      activeTrigger = null;
      popover.classList.remove('reward-qrcode-popover--visible');
      popover.setAttribute('aria-hidden', 'true');
    }, 80);
  }

  triggers.forEach((trigger) => {
    trigger.classList.add('reward-qrcode-trigger');
    trigger.addEventListener('mouseenter', () => showPopover(trigger));
    trigger.addEventListener('focus', () => showPopover(trigger));
    trigger.addEventListener('mouseleave', hidePopover);
    trigger.addEventListener('blur', hidePopover);
  });

  window.addEventListener('resize', () => {
    if (activeTrigger) positionPopover(activeTrigger);
  });
  window.addEventListener('scroll', () => {
    if (activeTrigger) positionPopover(activeTrigger);
  }, true);
}

// 初始化界面和事件监听
document.addEventListener('DOMContentLoaded', function() {
  try {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('sidepanel') === '1') {
      document.body.classList.add('detached-popup', 'sidepanel-settings');
    } else if (qs.get('options') === '1') {
      document.body.classList.add('detached-popup', 'options-settings');
    } else if (qs.get('detached') === '1') {
      document.body.classList.add('detached-popup', 'detached-window-settings');
    }
  } catch (e) { /* ignore */ }

  // 初始化DOM元素引用
  enableGestureCheckbox = document.getElementById('enable-gesture');
  gestureTrailCheckbox = document.getElementById('gesture-trail');
  gestureHintCheckbox = document.getElementById('gesture-hint');
  trailColorInput = document.getElementById('trail-color');
  const trailColorMount = document.getElementById('trail-color-picker-mount');
  if (trailColorMount && window.TrailColorPicker) {
    trailColorPickerApi = window.TrailColorPicker.mount(trailColorMount, {
      initialColor: trailColorInput ? trailColorInput.value : '#FF9ECD',
      onChange(hex) {
        if (trailColorInput) trailColorInput.value = hex;
        saveSettingsImmediate();
    }
  });
  updatePreviewTriggerControls();
}
  trailWidthInput = document.getElementById('trail-width');
  trailWidthValue = document.getElementById('trail-width-value');
  superDragCheckbox = document.getElementById('super-drag');
  imagePreviewCheckbox = document.getElementById('image-preview');
  duplicateCheckCheckbox = document.getElementById('duplicate-check');
  autoCloseDuplicatesCheckbox = document.getElementById('auto-close-duplicates');
  saveStatus = document.getElementById('save-status');
  resetButton = document.getElementById('reset-btn');
  exportButton = document.getElementById('export-btn');
  importButton = document.getElementById('import-btn');
  importFileInput = document.createElement('input');
  importFileInput.type = 'file';
  importFileInput.accept = '.json';
  importFileInput.style.display = 'none';
  document.body.appendChild(importFileInput);
  themeToggle = document.getElementById('theme-toggle');
  setupSettingsFontSizeControl();

  // Text direction must follow the locale used by chrome.i18n. Localize before
  // asynchronous settings reads so the popup can paint immediately.
  updateUIText();

  // 加载设置
  loadSettings();
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      if (changes.trailColor) {
        const hex = changes.trailColor.newValue;
        if (hex && typeof hex === 'string') {
          if (trailColorInput) trailColorInput.value = hex;
          if (trailColorPickerApi) trailColorPickerApi.setValue(hex);
        }
      }
      if (changes.settingsFontSize) {
        applySettingsFontSize(changes.settingsFontSize.newValue);
      }
    });
  } catch (e) { /* ignore */ }

  initScreenshotHotkeyInputs();

  // 显示扩展版本号
  displayExtensionVersion();
  setupVersionChangelogPopover();
  setupRewardQrcodePopover();
  
  // 设置滑块的鼠标滚轮控制
  setupRangeWheelControl();

  // 添加事件监听器
  // 鼠标手势开关 - 添加即时更新UI状态的逻辑
  enableGestureCheckbox.addEventListener('change', function() {
    // 更新相关选项的启用/禁用状态
    updateGestureRelatedOptions(this.checked);
    
    // 立即保存设置
    saveSettings();
    
    // 记录状态变化 - 用于调试
    console.log('鼠标手势开关状态已更改为:', this.checked);
  });

  // 使用公共函数重构事件监听器
  CommonUtils.addChangeListener('gesture-trail', saveSettings);
  CommonUtils.addChangeListener('gesture-hint', saveSettings);
  
  CommonUtils.addInputListener('trail-width', 'trail-width-value', () => {
    updateTrailWidthValue();
    saveSettingsDebounced();
  });
  
  // 轨迹宽度设置需要立即保存
  document.getElementById('trail-width').addEventListener('change', function() {
    saveSettingsImmediate();
  });
  
  // 超级拖拽开关 - 需要特殊处理
  superDragCheckbox.addEventListener('change', function() {
    updateSuperDragRelatedOptions(this.checked);
    saveSettingsImmediate(); // 立即保存
  });
  CommonUtils.addChangeListener('image-drag', saveSettingsImmediate);
  
  // 图片预览设置需要立即保存
  document.getElementById('image-preview').addEventListener('change', function() {
    updateImagePreviewRelatedOptions(this.checked);
    saveSettingsImmediate();
  });
  const imagePreviewEnhancedEl = document.getElementById('image-preview-enhanced');
  if (imagePreviewEnhancedEl) {
    imagePreviewEnhancedEl.addEventListener('change', function() {
      saveSettingsImmediate();
    });
  }
  
  CommonUtils.addChangeListener('drag-text-search', saveSettings);
  CommonUtils.addChangeListener('auto-download-on-drag-file', saveSettings);
  
  // 重复标签检测开关 - 需要特殊处理
  duplicateCheckCheckbox.addEventListener('change', function() {
    updateDuplicateTabOptions(this.checked);
    saveSettingsImmediate(); // 立即保存
  });
  
  CommonUtils.addChangeListener('auto-close-duplicates', saveSettings);
  
  // 自定义行为：禁用网站列表
  const addCurrentDisabledSiteBtn = document.getElementById('add-current-disabled-site');
  if (addCurrentDisabledSiteBtn) {
    addCurrentDisabledSiteBtn.addEventListener('click', addCurrentTabDomainToDisabledSites);
  }
  const addDisabledSiteBtn = document.getElementById('add-disabled-site');
  const disabledSiteInputEl = document.getElementById('disabled-site-input');
  if (addDisabledSiteBtn && disabledSiteInputEl) {
    addDisabledSiteBtn.addEventListener('click', function() {
      if (addDisabledSiteEntry(disabledSiteInputEl.value)) {
        disabledSiteInputEl.value = '';
        disabledSiteInputEl.focus();
      }
    });
    disabledSiteInputEl.addEventListener('keydown', function(e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (addDisabledSiteEntry(disabledSiteInputEl.value)) {
        disabledSiteInputEl.value = '';
      }
    });
  }
  const disabledSitesDisplayEl = document.getElementById('disabled-sites-list-display');
  if (disabledSitesDisplayEl) {
    disabledSitesDisplayEl.addEventListener('click', function(e) {
      const removeButton = e.target && e.target.closest
        ? e.target.closest('.disabled-site-remove')
        : null;
      if (!removeButton || !disabledSitesDisplayEl.contains(removeButton)) return;
      const index = Number.parseInt(removeButton.dataset.index || '-1', 10);
      removeDisabledSiteAtIndex(index);
    });
  }
  const disabledSitesListEl = document.getElementById('disabled-sites-list');
  if (disabledSitesListEl) {
    disabledSitesListEl.addEventListener('change', function() {
      setDisabledSitesListUi(disabledSitesListEl.value, true);
      saveSettingsImmediate({ sectionSaveStatusId: 'customized-save-status' });
    });
  }
  
  // 平滑滚动设置需要立即保存
  document.getElementById('smooth-scroll').addEventListener('change', function() {
    saveSettingsImmediate();
  });
  
  // 标签页数量徽章设置需要立即保存
  document.getElementById('show-tab-count-badge').addEventListener('change', function() {
    saveSettingsImmediate();
  });
  const unlockDialogRoot = document.getElementById('unlock-off-dialog');
  if (unlockDialogRoot) {
    const backdrop = unlockDialogRoot.querySelector('.popup-modal__backdrop');
    if (backdrop) backdrop.addEventListener('click', closeUnlockOffReloadDialog);
    const notNowBtn = document.getElementById('unlock-off-dialog-not-now');
    if (notNowBtn) notNowBtn.addEventListener('click', closeUnlockOffReloadDialog);
    const reloadUnlockBtn = document.getElementById('unlock-off-dialog-reload');
    if (reloadUnlockBtn) {
      reloadUnlockBtn.addEventListener('click', function() {
        closeUnlockOffReloadDialog();
        reloadActiveTabForUnlockOff();
      });
    }
  }
  const unlockRestrictionsEl = document.getElementById('unlock-page-restrictions');
  if (unlockRestrictionsEl) {
    unlockRestrictionsEl.addEventListener('change', function() {
      saveSettingsImmediate();
      if (!this.checked) {
        const body = getI18nMessage('unlockPageRestrictionsOffReloadConfirm');
        if (body) openUnlockOffReloadDialog();
      }
    });
  }
  const debugIcon = document.getElementById('enable-debug-panel-icon');
  if (debugIcon) {
    debugIcon.addEventListener('click', function() {
      debugEnabledState = !debugEnabledState;
      // 视觉状态
      debugIcon.style.opacity = debugEnabledState ? '1' : '0.25';
      saveSettings();
      showSectionSaveStatus('preview-save-status', 'settingsSaved');
    });
  }
  
  resetButton.addEventListener('click', resetSettings);
  if (exportButton) {
    exportButton.addEventListener('click', exportSettings);
  }
  if (importButton) {
    importButton.addEventListener('click', () => importFileInput.click());
  }
  importFileInput.addEventListener('change', handleImportFile);
  themeToggle.addEventListener('click', toggleTheme);

  const openOptionsPageBtn = document.getElementById('open-options-page-btn');
  if (openOptionsPageBtn) {
    openOptionsPageBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.detail > 1) return;
      openOptionsPage();
    });
  }

  const detachPopupBtn = document.getElementById('detach-popup-btn');
  if (detachPopupBtn) {
    detachPopupBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.detail > 1) return;
      openDetachedSettingsWindow();
    });
  }
  const openDetachedWindowBtn = document.getElementById('open-detached-window-btn');
  if (openDetachedWindowBtn) {
    openDetachedWindowBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.detail > 1) return;
      openDetachedSettingsWindowFallback();
    });
  }
  
  // 小窗视图设置相关的事件监听器 - 使用公共函数重构
  document.getElementById('preview-enabled').addEventListener('change', function() {
    updatePreviewRelatedOptions(this.checked);
    saveSettingsImmediate(); // 立即保存
    showSectionSaveStatus('preview-save-status', 'settingsSaved');
  });
  
  // 修改触发按键的事件处理函数
  document.getElementById('preview-modifier-key').addEventListener('change', function() {
    const modifierKey = normalizePreviewModifierKey(this.value);
    this.value = modifierKey;
    const triggerModeEl = document.getElementById('preview-trigger-mode');
    const triggerMode = normalizePreviewTriggerMode(
      triggerModeEl ? triggerModeEl.value : defaultSettings.previewTriggerMode,
      modifierKey
    );
    if (triggerModeEl) triggerModeEl.value = triggerMode;
    updatePreviewTriggerControls();
    updatePreviewDelayRange(modifierKey, triggerMode);
    saveSettingsImmediate(); // 立即保存
    showSectionSaveStatus('preview-save-status', 'settingsSaved');
  });

  const previewTriggerModeEl = document.getElementById('preview-trigger-mode');
  if (previewTriggerModeEl) {
    previewTriggerModeEl.addEventListener('change', function() {
      const modifierKey = normalizePreviewModifierKey(document.getElementById('preview-modifier-key')?.value);
      this.value = normalizePreviewTriggerMode(this.value, modifierKey);
      updatePreviewTriggerControls();
      updatePreviewDelayRange(modifierKey, this.value);
      saveSettingsImmediate();
      showSectionSaveStatus('preview-save-status', 'settingsSaved');
    });
  }

  const previewCustomKeyEl = document.getElementById('preview-custom-key');
  if (previewCustomKeyEl) {
    previewCustomKeyEl.addEventListener('focus', function() {
      this.classList.add('preview-hotkey-recording');
      this.placeholder = getI18nMessage('previewCustomKeyTitle');
    });
    previewCustomKeyEl.addEventListener('blur', function() {
      this.classList.remove('preview-hotkey-recording');
      this.placeholder = getI18nMessage('previewCustomKeyPlaceholder');
      setPreviewCustomKeyInputValue(getPreviewCustomKeyInputStorage());
    });
    previewCustomKeyEl.addEventListener('keydown', function(e) {
      if (e.code === 'Tab') return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setPreviewCustomKeyInputValue('');
        saveSettingsImmediate();
        showSectionSaveStatus('preview-save-status', 'settingsSaved');
        return;
      }

      const storageKey = previewCustomKeyStorageFromEvent(e);
      if (!storageKey) return;
      setPreviewCustomKeyInputValue(storageKey);
      saveSettingsImmediate();
      showSectionSaveStatus('preview-save-status', 'settingsSaved');
      this.blur();
    });
  }
  
  // 使用公共函数重构输入和变化事件
  CommonUtils.addInputListener('preview-hover-delay', 'preview-hover-delay-value', saveSettingsDebounced);
  CommonUtils.addChangeListener('preview-hover-delay', saveSettings, 'preview-save-status');
  const previewMaxWindowsEl = document.getElementById('preview-max-windows');
  if (previewMaxWindowsEl) {
    previewMaxWindowsEl.addEventListener('input', () => {
      updatePreviewMaxWindowsDisplay();
      saveSettingsDebounced();
    });
    previewMaxWindowsEl.addEventListener('change', function() {
      updatePreviewMaxWindowsDisplay();
      saveSettings();
      showSectionSaveStatus('preview-save-status', 'settingsSaved');
    });
  }
  CommonUtils.addInputListener('preview-width', 'preview-width-value', saveSettingsDebounced);
  CommonUtils.addChangeListener('preview-width', saveSettings, 'preview-save-status');
  CommonUtils.addInputListener('preview-height', 'preview-height-value', saveSettingsDebounced);
  CommonUtils.addChangeListener('preview-height', saveSettings, 'preview-save-status');
  CommonUtils.addChangeListener('preview-position', saveSettings, 'preview-save-status');
  CommonUtils.addChangeListener('preview-search-engine', saveSettings, 'preview-save-status');
  document.getElementById('preview-search-engine')?.addEventListener('input', saveSettingsDebounced);
  
  // 为选中文字搜索复选框添加更新UI的事件处理
  document.getElementById('text-search-preview').addEventListener('change', function() {
    updateTextSearchPreviewOptions(this.checked);
    saveSettingsImmediate(); // 立即保存
    showSectionSaveStatus('preview-save-status', 'settingsSaved');
  });
  
  // 为超级拖拽方向设置添加事件监听器 - 使用公共函数重构
  const superDragSelectors = [
    'drag-up-action', 'drag-up-right-action', 'drag-right-action', 'drag-down-right-action',
    'drag-down-action', 'drag-down-left-action', 'drag-left-action', 'drag-up-left-action',
    'split-scroll-sync', 'super-drag-compass-position'
  ];
  const dragDirectionSelectors = [
    'drag-up-action', 'drag-up-right-action', 'drag-right-action', 'drag-down-right-action',
    'drag-down-action', 'drag-down-left-action', 'drag-left-action', 'drag-up-left-action'
  ];
  superDragSelectors.forEach(selector => {
    CommonUtils.addChangeListener(selector, (e) => {
      if (dragDirectionSelectors.includes(selector)) updateSplitScrollSyncState();
      saveSettings(e);
    }, 'superdrag-save-status');
  });

  // 仅切换「编辑项」：更新缓存与输入框，需静默保存但不弹分区「已保存」（不是提交新 URL）
  CommonUtils.addChangeListener('drag-search-engine-slot', (e) => {
    onDragSearchSlotChanged();
    saveSettings(e);
  });

  const dragSearchEngineInputEl = document.getElementById('drag-search-engine');
  if (dragSearchEngineInputEl) {
    dragSearchEngineInputEl.addEventListener('input', () => {
      onDragSearchEngineInput();
      saveSettingsDebounced();
    });
    dragSearchEngineInputEl.addEventListener('change', () => {
      onDragSearchEngineInput();
      saveSettingsImmediate();
    });
  }

  setupSearchEngineExampleClickFill();
  
  // 为手势动作选择下拉框添加事件监听器 - 使用公共函数重构
  const gestureActionSelectors = [
    'gesture-left-action', 'gesture-right-action', 'gesture-up-action', 'gesture-down-action',
    'gesture-downThenRight-action', 'gesture-leftThenUp-action', 'gesture-rightThenUp-action',
    'gesture-rightThenDown-action', 'gesture-upThenLeft-action', 'gesture-upThenRight-action',
    'gesture-downThenLeft-action', 'gesture-leftThenDown-action', 'gesture-upThenDown-action',
    'gesture-downThenUp-action', 'gesture-leftThenRight-action', 'gesture-rightThenLeft-action',
    'gesture-rightHoldWheelUp-action', 'gesture-rightHoldWheelDown-action',
    'gesture-leftHoldWheelUp-action', 'gesture-leftHoldWheelDown-action',
    'gesture-rightHoldLeftClick-action',
    'gesture-leftHoldRightClick-action'
  ];
  gestureActionSelectors.forEach(selector => {
    CommonUtils.addChangeListener(selector, saveSettings, 'gesture-save-status');
  });

  CommonUtils.addChangeListener('enable-screenshot-feature', () => {
    updateScreenshotFeatureControls();
    saveSettings();
  }, 'screenshot-save-status');
  CommonUtils.addChangeListener('enable-screenshot-trail', saveSettings, 'screenshot-save-status');
  CommonUtils.addChangeListener('enable-screenshot-clipboard', saveSettings, 'screenshot-save-status');
  CommonUtils.addChangeListener('enable-screenshot-preview', saveSettings, 'screenshot-save-status');
  CommonUtils.addChangeListener('enable-screenshot-history', () => {
    updateScreenshotFeatureControls();
    saveSettings();
  }, 'screenshot-save-status');
  const historyMaxRange = document.getElementById('screenshot-history-max-count');
  if (historyMaxRange) {
    historyMaxRange.addEventListener('input', () => {
      updateScreenshotHistoryMaxCountDisplay();
      saveSettingsDebounced();
    });
  }
  CommonUtils.addChangeListener('screenshot-history-max-count', () => {
    saveSettings();
    trimScreenshotHistoryToStoredLimit();
  }, 'screenshot-save-status');

  const btnScreenshotHistory = document.getElementById('btn-screenshot-history');
  if (btnScreenshotHistory) {
    btnScreenshotHistory.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openScreenshotHistory' }, () => {
        if (chrome.runtime.lastError) {
          CommonUtils.handleError(chrome.runtime.lastError, 'openScreenshotHistory');
        }
      });
    });
  }

  const builtInGesturesSubtitle = document.getElementById('built-in-gestures-subtitle-toggle');
  const builtInGesturesList = document.getElementById('built-in-gestures-list');
  if (builtInGesturesSubtitle && builtInGesturesList) {
    const toggleBuiltInGesturesList = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const expanded = builtInGesturesList.classList.toggle('gesture-list--expanded');
      builtInGesturesSubtitle.classList.toggle('operation-hint--expanded', expanded);
      builtInGesturesSubtitle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      updateBuiltInGesturesSubtitleTitle();
    };
    builtInGesturesSubtitle.setAttribute('aria-expanded', 'false');
    builtInGesturesSubtitle.setAttribute('role', 'button');
    builtInGesturesSubtitle.setAttribute('tabindex', '0');
    builtInGesturesSubtitle.addEventListener('click', toggleBuiltInGesturesList);
    builtInGesturesSubtitle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        toggleBuiltInGesturesList(e);
      }
    });
    updateBuiltInGesturesSubtitleTitle();
  }

  // 快速定位功能 - 点击标题进行快速定位
  const sections = [
    { id: 'settings-feature', nameKey: 'settings' },
    { id: 'customized-behavior-feature', nameKey: 'customizedBehavior' },
    { id: 'gesture-actions-feature', nameKey: 'builtInGestures' },
    { id: 'super-drag-feature', nameKey: 'superDragFeature' },
    { id: 'link-preview-feature', nameKey: 'linkPreview' },
    { id: 'screenshot-feature', nameKey: 'screenshotFeature' }
  ];

  // 为所有h2标题添加点击事件
  const sectionHeaders = document.querySelectorAll('h2');
  sectionHeaders.forEach(header => {
    // 添加悬停提示
    header.addEventListener('mouseenter', function() {
      const currentSection = this.closest('.section');
      if (!currentSection) return;
      
      const currentSectionId = currentSection.id;
      const currentIndex = sections.findIndex(section => section.id === currentSectionId);
      
      if (currentIndex === -1) return;
      
      const nextIndex = (currentIndex + 1) % sections.length;
      const prevIndex = currentIndex === 0 ? sections.length - 1 : currentIndex - 1;
      const nextSection = sections[nextIndex];
      const prevSection = sections[prevIndex];
      
      // 使用国际化系统获取翻译
      const tooltipMessage = getI18nMessage('quickNavTooltip', 'quickNavTooltip');
      const nextSectionName = getI18nMessage(nextSection.nameKey, nextSection.nameKey);
      const prevSectionName = getI18nMessage(prevSection.nameKey, prevSection.nameKey);
      this.title = tooltipMessage.replace('{next}', nextSectionName).replace('{prev}', prevSectionName);
    });

    // 移除悬停提示
    header.addEventListener('mouseleave', function() {
      this.title = '';
    });

    // 左键点击 - 正向定位
    header.addEventListener('click', function(e) {
      e.preventDefault();
      
      // 找到当前点击的section
      const currentSection = this.closest('.section');
      if (!currentSection) return;
      
      const currentSectionId = currentSection.id;
      const currentIndex = sections.findIndex(section => section.id === currentSectionId);
      
      if (currentIndex === -1) return;
      
      // 计算下一个section的索引
      const nextIndex = (currentIndex + 1) % sections.length;
      const nextSection = sections[nextIndex];
      const targetElement = document.getElementById(nextSection.id);
      
      if (targetElement) {
        // 平滑滚动到目标位置
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });

    // 右键点击 - 反向定位
    header.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      
      // 找到当前点击的section
      const currentSection = this.closest('.section');
      if (!currentSection) return;
      
      const currentSectionId = currentSection.id;
      const currentIndex = sections.findIndex(section => section.id === currentSectionId);
      
      if (currentIndex === -1) return;
      
      // 计算上一个section的索引
      const prevIndex = currentIndex === 0 ? sections.length - 1 : currentIndex - 1;
      const prevSection = sections[prevIndex];
      const targetElement = document.getElementById(prevSection.id);
      
      if (targetElement) {
        // 平滑滚动到目标位置
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
}); 
