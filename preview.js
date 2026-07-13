/** 防止扩展更新重复注入时重复注册监听器 */
function mouseExtListenerFlag(name) {
  const G = typeof globalThis !== 'undefined' ? globalThis : window;
  const key = '__mouseExt_' + name;
  if (G[key]) return false;
  G[key] = true;
  return true;
}

const PREVIEW_SETTINGS_API = globalThis.MouseExtSettings;
const PREVIEW_STORAGE_DEFAULTS = PREVIEW_SETTINGS_API.getPreviewDefaults();

const PREVIEW_HTML_NS = 'http://www.w3.org/1999/xhtml';

function createPreviewElement(tagName) {
  const tag = String(tagName || '').toLowerCase();
  let el = null;
  try {
    el = document.createElement(tagName);
  } catch (e) {
    el = null;
  }
  if (!el || el.nodeType !== Node.ELEMENT_NODE || !el.style) {
    try {
      el = document.createElementNS(PREVIEW_HTML_NS, tagName);
    } catch (e) {
      el = null;
    }
  }
  if (!el || el.nodeType !== Node.ELEMENT_NODE || !el.style) {
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

// 检查元素是否为文本输入框
function isTextInputElement(element) {
  if (!element) return false;
  
  try {
    // 检查元素标签名
    const tagName = element.tagName?.toLowerCase();
    if (!tagName) return false;
    
    // 直接的文本输入元素
    if (tagName === 'input') {
      const inputType = (element.getAttribute('type') || '').toLowerCase();
      // 排除不是文本输入的input类型
      const nonTextTypes = ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 
                            'radio', 'range', 'reset', 'submit'];
      return !nonTextTypes.includes(inputType);
    }
    
    // 文本区域
    if (tagName === 'textarea') return true;
    
    // 可编辑内容
    if (element.isContentEditable) return true;
    
    // 富文本编辑器框架
    if (tagName === 'iframe' || tagName === 'frame') return true;
    
    // CodeMirror, Monaco, Ace等编辑器常用的类名检测 - 使用更精确的匹配
    const className = element.className || '';
    if (className && typeof className === 'string') {
      // 使用单词边界或精确的编辑器类名匹配，避免匹配到部分词
      if (className.includes('CodeMirror') || 
          className.includes('monaco-editor') || 
          className.includes('ace_editor') || 
          className.match(/\beditor\b/) || 
          className.match(/\binput\b/) ||
          // 移除对text的通用匹配，避免匹配诸如text-bold等类名
          className.match(/\bfield\b/)) {
        return true;
      }
    }
    
    // 具有可编辑角色的元素
    const role = element.getAttribute('role');
    if (role === 'textbox' || role === 'combobox' || role === 'searchbox') {
      return true;
    }
    
    // 检查是否有类似编辑器的属性
    if (element.getAttribute('contenteditable') === 'true' || 
        element.getAttribute('aria-multiline') === 'true') {
      return true;
    }
    
    // 检查输入相关的ID或name - 使用更精确的匹配
    const id = (element.id || '').toLowerCase();
    const name = (element.name || '').toLowerCase();
    if (
      id.match(/\binput\b/) || 
      id.match(/\beditor\b/) ||
      name.match(/\binput\b/) || 
      name.match(/\beditor\b/)
      // 移除对text的通用匹配
    ) {
      return true;
    }
    
    // 更全面的DOM属性检测
    if (
      element.getAttribute('autocomplete') || 
      element.getAttribute('autocorrect') || 
      element.getAttribute('autocapitalize') || 
      element.getAttribute('spellcheck') === 'true'
    ) {
      return true;
    }
    
    return false;
  } catch (error) {
    // 出错时安全返回false
    return false;
  }
}

function getInputOrTextareaSelectedText(element) {
  if (!element) return '';
  const tag = element.tagName?.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') return '';
  try {
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (start == null || end == null || start === end) return '';
    return element.value.substring(start, end).trim();
  } catch {
    return '';
  }
}

function isFormTextControl(element) {
  if (!element || element.nodeType !== 1) return false;
  const tag = element.tagName?.toLowerCase();
  if (tag === 'textarea') return true;
  if (tag !== 'input') return false;
  const inputType = (element.getAttribute('type') || '').toLowerCase();
  const nonTextTypes = ['button', 'checkbox', 'color', 'file', 'hidden', 'image',
    'radio', 'range', 'reset', 'submit'];
  return !nonTextTypes.includes(inputType);
}

function isContentEditableRoot(element) {
  if (!element || element.nodeType !== 1) return false;
  try {
    if (element.isContentEditable) return true;
    const ce = element.getAttribute('contenteditable');
    return ce === '' || ce === 'true' || ce === 'plaintext-only';
  } catch {
    return false;
  }
}

function findEditableTextRoot(from) {
  let node = from;
  while (node && node !== document.body) {
    if (node.nodeType === 1) {
      if (isFormTextControl(node)) return node;
      if (isContentEditableRoot(node)) return node;
    }
    if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
      node = node.parentElement;
      continue;
    }
    node = node.parentElement;
  }
  return null;
}

function getFocusedEditableTextRoot() {
  return findEditableTextRoot(document.activeElement);
}

function selectionAnchorWithinElement(sel, element) {
  const node = sel.anchorNode;
  if (!node || !element) return false;
  return element === node || element.contains(node);
}

function getEditableSelectedText(root) {
  if (!root) return '';
  if (isFormTextControl(root)) {
    return getInputOrTextareaSelectedText(root);
  }
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return '';
  const text = sel.toString().trim();
  if (!text || !selectionAnchorWithinElement(sel, root)) return '';
  return text;
}

function getEditableSelectionPosition(root) {
  const sel = document.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
    try {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width || rect.height) {
        return { x: rect.left + rect.width / 2, y: rect.bottom };
      }
    } catch { /* ignore */ }
  }
  const rect = root.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.bottom };
}

/** 焦点在可编辑区域且未选中文字时，不触发小窗预览 */
function shouldSuppressPreviewForTextInput() {
  const root = getFocusedEditableTextRoot();
  if (!root) return false;
  return !getEditableSelectedText(root);
}

function buildEditableSelectionPreviewData(element) {
  const root = findEditableTextRoot(element) || element;
  const selectedText = getEditableSelectedText(root);
  if (!selectedText) return null;
  return {
    text: selectedText,
    position: getEditableSelectionPosition(root),
    fromInput: true,
    editableRoot: root
  };
}

function syncTextSelectionFromFocusedInput(element) {
  const root = findEditableTextRoot(element) || getFocusedEditableTextRoot();
  if (!root) return;

  const selectionData = buildEditableSelectionPreviewData(root);
  if (!selectionData) {
    currentTextSelection = null;
    return;
  }

  currentTextSelection = selectionData;

  if (previewSettings.modifierKey === 'none' || isModifierKeyPressed) {
    startTextSelectionPreviewTimer(currentTextSelection);
  }
}

// 链接预览功能
// 实现在鼠标悬停+Ctrl键时显示链接预览窗口

// 预览状态管理
let previewSettings = {
  enabled: PREVIEW_STORAGE_DEFAULTS.previewEnabled,
  hoverDelay: PREVIEW_STORAGE_DEFAULTS.previewHoverDelay,
  modifierKey: PREVIEW_STORAGE_DEFAULTS.previewModifierKey,
  triggerMode: PREVIEW_STORAGE_DEFAULTS.previewTriggerMode,
  customKey: PREVIEW_STORAGE_DEFAULTS.previewCustomKey,
  maxPreviews: PREVIEW_STORAGE_DEFAULTS.previewMaxWindows,
  defaultWidth: PREVIEW_STORAGE_DEFAULTS.previewDefaultWidth,
  defaultHeight: PREVIEW_STORAGE_DEFAULTS.previewDefaultHeight,
  position: PREVIEW_STORAGE_DEFAULTS.previewPosition,
  searchEngine: PREVIEW_STORAGE_DEFAULTS.previewSearchEngine,
  enableTextSearchPreview: PREVIEW_STORAGE_DEFAULTS.enableTextSearchPreview,
  disabledSites: [] // 在此列表中的网站禁用小窗预览
};

const PREVIEW_DOUBLE_KEY_INTERVAL_MS = 420;
const PREVIEW_DOUBLE_KEY_ACTIVE_MS = 2500;

function clampPreviewHoverDelay(delay) {
  return PREVIEW_SETTINGS_API.clampPreviewHoverDelay(delay);
}

// 当前活动的预览窗口
const activePreviewWindows = new Map();
const activePreviewWindowUrlIndex = new Map();
const pendingPreviewWindowUrlKeys = new Set();
const recentPreviewWindowUrlKeys = new Map();
const PREVIEW_POPUP_RECENT_OPEN_SUPPRESS_MS = 1200;
// 预览计时器
let previewTimer = null;
let pendingPreviewRequest = null;
// 当前悬停的链接元素
let currentHoverElement = null;
// 当前鼠标位置
let currentMousePosition = { x: 0, y: 0, screenX: 0, screenY: 0 };
// 当前是否按下修饰键
let isModifierKeyPressed = false;
// 预览窗口计数器
let previewCounter = 0;
// 当前文本选择
let currentTextSelection = null;
// 自定义/双击触发键状态
let pressedPreviewKeys = new Set();
let doubleKeyLastPressCode = '';
let doubleKeyLastPressTime = 0;
let doubleKeyArmedUntil = 0;
let doubleKeyArmTimer = null;

function normalizePreviewModifierKey(value) {
  return PREVIEW_SETTINGS_API.normalizePreviewModifierKey(value);
}

function normalizePreviewTriggerMode(value, modifierKey) {
  return PREVIEW_SETTINGS_API.normalizePreviewTriggerMode(value, modifierKey);
}

function normalizePreviewCustomKey(value) {
  return PREVIEW_SETTINGS_API.normalizePreviewCustomKey(value);
}

function normalizePreviewSettingsState() {
  previewSettings.modifierKey = normalizePreviewModifierKey(previewSettings.modifierKey);
  previewSettings.triggerMode = normalizePreviewTriggerMode(previewSettings.triggerMode, previewSettings.modifierKey);
  previewSettings.customKey = normalizePreviewCustomKey(previewSettings.customKey);
  previewSettings.hoverDelay = clampPreviewHoverDelay(previewSettings.hoverDelay);
  previewSettings.maxPreviews = normalizePreviewMaxWindows(previewSettings.maxPreviews);
}

function normalizePreviewMaxWindows(value) {
  return PREVIEW_SETTINGS_API.normalizePreviewMaxWindows(value);
}

function getEffectiveMaxPreviews() {
  const max = normalizePreviewMaxWindows(previewSettings.maxPreviews);
  return max <= 0 ? Number.POSITIVE_INFINITY : max;
}

function normalizePreviewWindowUrlKey(url) {
  try {
    return new URL(String(url || '')).href;
  } catch (e) {
    return String(url || '').trim();
  }
}

function cleanupRecentPreviewWindowUrlKeys(now = Date.now()) {
  for (const [urlKey, timestamp] of recentPreviewWindowUrlKeys.entries()) {
    if (!timestamp || now - timestamp > PREVIEW_POPUP_RECENT_OPEN_SUPPRESS_MS) {
      recentPreviewWindowUrlKeys.delete(urlKey);
    }
  }
}

function markRecentPreviewWindowUrlKey(urlKey) {
  if (!urlKey) return;
  const now = Date.now();
  cleanupRecentPreviewWindowUrlKeys(now);
  recentPreviewWindowUrlKeys.set(urlKey, now);
}

function isRecentPreviewWindowUrlKey(urlKey) {
  if (!urlKey) return false;
  const now = Date.now();
  cleanupRecentPreviewWindowUrlKeys(now);
  const timestamp = recentPreviewWindowUrlKeys.get(urlKey);
  return !!timestamp && now - timestamp <= PREVIEW_POPUP_RECENT_OPEN_SUPPRESS_MS;
}

function cleanupClosedPreviewWindows() {
  for (const [previewId, previewData] of activePreviewWindows.entries()) {
    try {
      if (previewData && previewData.window && previewData.window.closed) {
        closePreviewWindow(previewId);
      }
    } catch (e) {
      closePreviewWindow(previewId);
    }
  }
}

function getActivePreviewByUrl(url) {
  cleanupClosedPreviewWindows();
  const urlKey = normalizePreviewWindowUrlKey(url);
  if (!urlKey) return null;
  const previewId = activePreviewWindowUrlIndex.get(urlKey);
  if (!previewId) return null;
  const previewData = activePreviewWindows.get(previewId);
  if (!previewData || !previewData.window || previewData.window.closed) {
    closePreviewWindow(previewId);
    return null;
  }
  return previewData;
}

function focusExistingPreviewWindow(previewData) {
  if (!previewData || !previewData.window || previewData.window.closed) return false;
  try {
    previewData.window.focus();
    return true;
  } catch (e) {
    return false;
  }
}

function hashPreviewWindowName(input) {
  const text = String(input || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getPreviewWindowNameForUrl(urlKey) {
  return `mouse_preview_${hashPreviewWindowName(urlKey)}`;
}

function enforcePreviewWindowLimit() {
  cleanupClosedPreviewWindows();
  const max = getEffectiveMaxPreviews();
  if (!Number.isFinite(max)) return;
  while (activePreviewWindows.size >= max) {
    const oldestId = Array.from(activePreviewWindows.keys())[0];
    if (!oldestId) break;
    closePreviewWindow(oldestId);
  }
}

function getPreviewEventCode(e) {
  return String((e && (e.code || e.key)) || '').trim().toLowerCase();
}

function getPreviewTriggerIdentityFromEvent(e) {
  const key = normalizePreviewModifierKey(previewSettings.modifierKey);
  if (key === 'custom') return getPreviewEventCode(e);
  if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return key.toLowerCase();
  return '';
}

function isStandardPreviewModifierEvent(e, key) {
  const code = String(e?.code || '').toLowerCase();
  const eventKey = String(e?.key || '').toLowerCase();
  if (key === 'Control') return eventKey === 'control' || code === 'controlleft' || code === 'controlright';
  if (key === 'Alt') return eventKey === 'alt' || code === 'altleft' || code === 'altright';
  if (key === 'Shift') return eventKey === 'shift' || code === 'shiftleft' || code === 'shiftright';
  if (key === 'Meta') return eventKey === 'meta' || code === 'metaleft' || code === 'metaright';
  return false;
}

function isStandardPreviewModifierActive(e, key) {
  if (!e) return false;
  if (key === 'Control') return !!e.ctrlKey;
  if (key === 'Alt') return !!e.altKey;
  if (key === 'Shift') return !!e.shiftKey;
  if (key === 'Meta') return !!e.metaKey;
  return false;
}

function isPreviewTriggerKeyEvent(e) {
  const key = normalizePreviewModifierKey(previewSettings.modifierKey);
  if (key === 'none') return false;
  if (key === 'custom') {
    const customKey = normalizePreviewCustomKey(previewSettings.customKey);
    return !!customKey && getPreviewEventCode(e) === customKey;
  }
  return isStandardPreviewModifierEvent(e, key);
}

function clearPreviewDoubleKeyArm() {
  doubleKeyArmedUntil = 0;
  if (doubleKeyArmTimer) {
    clearTimeout(doubleKeyArmTimer);
    doubleKeyArmTimer = null;
  }
}

function isPreviewDoubleKeyArmed() {
  if (!doubleKeyArmedUntil) return false;
  if (Date.now() <= doubleKeyArmedUntil) return true;
  clearPreviewDoubleKeyArm();
  return false;
}

function armPreviewDoubleKey() {
  const duration = Math.max(PREVIEW_DOUBLE_KEY_ACTIVE_MS, previewSettings.hoverDelay + 500);
  clearPreviewDoubleKeyArm();
  doubleKeyArmedUntil = Date.now() + duration;
  doubleKeyArmTimer = setTimeout(() => {
    doubleKeyArmedUntil = 0;
    doubleKeyArmTimer = null;
    if (isModifierKeyPressed) {
      setPreviewTriggerActive(false);
    }
  }, duration);
}

function isPreviewDoubleTriggerMode() {
  return previewSettings.modifierKey !== 'none' && previewSettings.triggerMode === 'double';
}

function isPreviewTriggerConditionActive(e) {
  const key = normalizePreviewModifierKey(previewSettings.modifierKey);
  if (key === 'none') return true;
  if (isPreviewDoubleTriggerMode()) return isPreviewDoubleKeyArmed();
  if (key === 'custom') {
    const customKey = normalizePreviewCustomKey(previewSettings.customKey);
    return !!customKey && pressedPreviewKeys.has(customKey);
  }
  return isStandardPreviewModifierActive(e, key);
}

function clearPreviewTimer(clearRequest = true) {
  if (previewTimer) {
    clearTimeout(previewTimer);
    previewTimer = null;
  }
  if (clearRequest) pendingPreviewRequest = null;
}

function isPreviewTriggerActiveNow() {
  return previewSettings.modifierKey === 'none' || isModifierKeyPressed;
}

function isCurrentTextPreviewRequest(request) {
  if (!request || request.type !== 'text' || !request.selectionData) return false;
  const expectedText = normalizePreviewTextLikeSuperDrag(request.selectionData.text);
  const currentText = normalizePreviewTextLikeSuperDrag(currentTextSelection?.text);
  return !!expectedText && expectedText === currentText;
}

function schedulePreviewRequest(request) {
  if (!request || !previewSettings.enabled || shouldSuppressPreviewForTextInput()) return;

  clearPreviewTimer();
  pendingPreviewRequest = request;
  previewTimer = setTimeout(() => {
    const activeRequest = pendingPreviewRequest;
    previewTimer = null;
    pendingPreviewRequest = null;

    if (!activeRequest || !previewSettings.enabled || isSiteInDisabledListForPreview(window.location.href)) return;
    if (!isPreviewTriggerActiveNow()) return;

    if (activeRequest.type === 'link') {
      const linkElement = activeRequest.linkElement;
      if (!linkElement || linkElement !== currentHoverElement || linkElement.isConnected === false) return;
      showLinkPreview(linkElement);
      return;
    }

    if (
      activeRequest.type === 'text' &&
      previewSettings.enableTextSearchPreview &&
      isCurrentTextPreviewRequest(activeRequest)
    ) {
      showTextSelectionPreview(activeRequest.selectionData);
    }
  }, previewSettings.hoverDelay);
}

function restartPendingPreviewTimer() {
  if (!pendingPreviewRequest) return;
  const request = pendingPreviewRequest;
  schedulePreviewRequest(request);
}

function startTextSelectionPreviewTimer(selectionData) {
  if (!selectionData || !selectionData.text) return;
  schedulePreviewRequest({
    type: 'text',
    selectionData: {
      ...selectionData,
      position: selectionData.position ? { ...selectionData.position } : null
    }
  });
}

function setPreviewTriggerActive(active) {
  const wasPressed = isModifierKeyPressed;
  isModifierKeyPressed = !!active;

  if (!wasPressed && isModifierKeyPressed) {
    if (shouldSuppressPreviewForTextInput()) {
      currentTextSelection = null;
    } else {
      if (currentHoverElement && !previewTimer && previewSettings.enabled) {
        startPreviewTimer(currentHoverElement);
      }
      if (previewSettings.enabled && previewSettings.enableTextSearchPreview) {
        tryShowTextSelectionPreviewOnModifierDown();
      }
    }
  } else if (wasPressed && !isModifierKeyPressed) {
    clearPreviewTimer();
  }
}

// 加载设置
function loadPreviewSettings() {
  try {
    chrome.storage.sync.get(PREVIEW_STORAGE_DEFAULTS, (items) => {
      // 检查chrome.runtime.lastError，可能是扩展上下文失效
      if (chrome.runtime.lastError) {
        console.log('加载预览设置错误:', chrome.runtime.lastError.message);
        // 如果是扩展上下文失效，停止进一步操作
        if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
          console.log('扩展上下文失效，预览功能将停止工作');
          return;
        }
        // 使用默认设置
        return;
      }
      
      previewSettings.enabled = items.previewEnabled;
      previewSettings.modifierKey = normalizePreviewModifierKey(items.previewModifierKey);
      previewSettings.triggerMode = normalizePreviewTriggerMode(items.previewTriggerMode, previewSettings.modifierKey);
      previewSettings.customKey = normalizePreviewCustomKey(items.previewCustomKey);
      previewSettings.hoverDelay = clampPreviewHoverDelay(items.previewHoverDelay);
      previewSettings.maxPreviews = normalizePreviewMaxWindows(items.previewMaxWindows);
      previewSettings.defaultWidth = items.previewDefaultWidth;
      previewSettings.defaultHeight = items.previewDefaultHeight;
      previewSettings.position = items.previewPosition;
      previewSettings.searchEngine = items.previewSearchEngine;
      previewSettings.enableTextSearchPreview = items.enableTextSearchPreview;
      normalizePreviewSettingsState();
      resetPreviewModifierState();
      chrome.storage.local.get({ disabledSites: [] }, (localItems) => {
        previewSettings.disabledSites = Array.isArray(localItems.disabledSites)
          ? localItems.disabledSites
          : [];
        console.log('预览设置已加载:', previewSettings);
      });
    });
  } catch (error) {
    console.log('加载预览设置异常:', error.message);
    // 出现异常时不做任何操作，使用默认设置
  }
}

// 检查修饰键是否匹配
function isModifierKeyMatch(e) {
  return isPreviewTriggerConditionActive(e);
}

// 检查当前网址是否在禁用列表（与小窗预览共用 disabledSites）
function isSiteInDisabledListForPreview(href) {
  const list = previewSettings.disabledSites;
  if (!list || !Array.isArray(list) || list.length === 0) return false;
  let h;
  try {
    const u = new URL(href);
    h = u.hostname.toLowerCase().replace(/^www\./, '');
  } catch (e) {
    h = String(href || '').toLowerCase().replace(/^www\./, '');
  }
  for (const entry of list) {
    const v = String(entry).trim().toLowerCase();
    if (!v) continue;
    let entryHost = v;
    if (v.startsWith('http://') || v.startsWith('https://')) {
      try { entryHost = new URL(v).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { entryHost = v; }
    } else {
      entryHost = v.replace(/^www\./, '');
    }
    if (h === entryHost || h.endsWith('.' + entryHost)) return true;
  }
  return false;
}

// 从鼠标/键盘事件的 modifier 标志同步修饰键（勿用全 false 的假事件轮询，否则会误清除已按下的 Shift 等）
function resetPreviewModifierState() {
  isModifierKeyPressed = false;
  pressedPreviewKeys.clear();
  doubleKeyLastPressCode = '';
  doubleKeyLastPressTime = 0;
  clearPreviewDoubleKeyArm();
  clearPreviewTimer();
}

function syncModifierKeyFromEvent(e) {
  setPreviewTriggerActive(isPreviewTriggerConditionActive(e));
}

// 初始化
let linkPreviewInitialized = false;

function initLinkPreview() {
  if (window !== window.top) return;
  if (linkPreviewInitialized) return;
  linkPreviewInitialized = true;
  try {
    loadPreviewSettings();
    
    // 监听设置变更
    try {
      if (mouseExtListenerFlag('previewStorageOnChanged')) {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        try {
          if (namespace === 'local' && changes.disabledSites) {
            previewSettings.disabledSites = changes.disabledSites.newValue || [];
          }
          if (namespace === 'sync') {
            if (changes.previewEnabled) {
              previewSettings.enabled = changes.previewEnabled.newValue;
              if (!previewSettings.enabled) resetPreviewModifierState();
            }
            let shouldResetTriggerState = false;
            if (changes.previewModifierKey) {
              previewSettings.modifierKey = normalizePreviewModifierKey(changes.previewModifierKey.newValue);
              shouldResetTriggerState = true;
            }
            if (changes.previewTriggerMode) {
              previewSettings.triggerMode = normalizePreviewTriggerMode(
                changes.previewTriggerMode.newValue,
                previewSettings.modifierKey
              );
              shouldResetTriggerState = true;
            }
            if (changes.previewCustomKey) {
              previewSettings.customKey = normalizePreviewCustomKey(changes.previewCustomKey.newValue);
              shouldResetTriggerState = true;
            }
            if (changes.previewHoverDelay) {
              previewSettings.hoverDelay = clampPreviewHoverDelay(changes.previewHoverDelay.newValue);
              restartPendingPreviewTimer();
            }
            normalizePreviewSettingsState();
            if (shouldResetTriggerState) resetPreviewModifierState();
            if (changes.previewMaxWindows) previewSettings.maxPreviews = normalizePreviewMaxWindows(changes.previewMaxWindows.newValue);
            if (changes.previewDefaultWidth) previewSettings.defaultWidth = changes.previewDefaultWidth.newValue;
            if (changes.previewDefaultHeight) previewSettings.defaultHeight = changes.previewDefaultHeight.newValue;
            if (changes.previewPosition) previewSettings.position = changes.previewPosition.newValue;
            if (changes.previewSearchEngine) previewSettings.searchEngine = changes.previewSearchEngine.newValue;
            if (changes.enableTextSearchPreview) {
              previewSettings.enableTextSearchPreview = changes.enableTextSearchPreview.newValue;
              if (!previewSettings.enableTextSearchPreview && pendingPreviewRequest?.type === 'text') {
                clearPreviewTimer();
              }
            }
            
            console.log('预览设置已更新:', previewSettings);
          }
        } catch (error) {
          console.log('处理设置变更错误:', error.message);
          // 如果是扩展上下文失效，停止监听
          if (error.message.includes('Extension context invalidated')) {
            console.log('扩展上下文失效，预览功能将停止工作');
          }
        }
      });
      }
    } catch (error) {
      console.log('添加设置变更监听器错误:', error.message);
    }
    
    // 使用事件委托注册事件监听器
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    
    // 使用事件委托处理鼠标悬停和离开事件
    document.addEventListener('mouseover', (e) => {
      try {
        // 如果预览功能被禁用，直接返回
        if (!previewSettings.enabled) return;
        
        // 如果当前网站在禁用列表，不显示小窗预览
        if (isSiteInDisabledListForPreview(window.location.href)) return;
        
        syncModifierKeyFromEvent(e);
        
        const linkElement = findLinkElement(e.target);
        if (linkElement) {
          handleMouseOver(e, linkElement);
        }
      } catch (error) {
        console.log('处理mouseover事件错误:', error.message);
        // 异常处理，避免中断用户体验
      }
    }, { passive: true });
    
    document.addEventListener('mouseout', (e) => {
      try {
        const linkElement = findLinkElement(e.target);
        if (linkElement && linkElement === currentHoverElement) {
          handleMouseOut(e, linkElement);
        }
      } catch (error) {
        console.log('处理mouseout事件错误:', error.message);
      }
    }, { passive: true });
    
    document.addEventListener('selectionchange', debounce(handleSelectionChange, 200), { passive: true });

    document.addEventListener('focusin', (e) => {
      try {
        const root = findEditableTextRoot(e.target);
        if (root) syncTextSelectionFromFocusedInput(root);
      } catch (error) {
        console.log('处理 focusin 错误:', error.message);
      }
    }, true);

    document.addEventListener('select', (e) => {
      try {
        if (!previewSettings.enabled || !previewSettings.enableTextSearchPreview) return;
        if (isFormTextControl(e.target)) {
          syncTextSelectionFromFocusedInput(e.target);
        }
      } catch (error) {
        console.log('处理 select 错误:', error.message);
      }
    }, true);
    
    // 添加窗口焦点变化处理
    window.addEventListener('blur', () => {
      try {
        resetPreviewModifierState();
      } catch (error) {
        console.log('处理窗口失焦事件错误:', error.message);
      }
    }, { passive: true });

    window.addEventListener('pagehide', () => {
      try {
        resetPreviewModifierState();
      } catch (error) {
        console.log('处理 pagehide 错误:', error.message);
      }
    }, { passive: true });
    
    // 可见性变化时重置修饰键（含网页解锁改写 document.hidden 的情况，用 visibilityState）
    document.addEventListener('visibilitychange', () => {
      try {
        if (document.visibilityState === 'hidden') {
          resetPreviewModifierState();
        }
      } catch (error) {
        console.log('处理页面可见性变更事件错误:', error.message);
      }
    }, { passive: true });
    
    console.log('链接预览功能已初始化，设置:', previewSettings);
    console.log('支持两种预览模式:');
    console.log('1. 按住修饰键并悬停在链接上');
    console.log('2. 先选中文本，再按修饰键显示搜索预览');
  } catch (error) {
    console.log('初始化链接预览功能失败:', error.message);
    // 如果是扩展上下文失效，显示特殊日志
    if (error.message && error.message.includes('Extension context invalidated')) {
      console.log('扩展上下文失效，预览功能将停止工作');
    }
  }
}

// 防抖函数，避免频繁触发事件
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// 处理鼠标移动
function handleMouseMove(e) {
  currentMousePosition.x = e.clientX;
  currentMousePosition.y = e.clientY;
  currentMousePosition.screenX = e.screenX;
  currentMousePosition.screenY = e.screenY;
  syncModifierKeyFromEvent(e);
}

function tryShowTextSelectionPreviewOnModifierDown() {
  const editableRoot = getFocusedEditableTextRoot();
  if (editableRoot) {
    const selectionData = buildEditableSelectionPreviewData(editableRoot);
    if (!selectionData) {
      currentTextSelection = null;
      return;
    }
    currentTextSelection = selectionData;
    startTextSelectionPreviewTimer(selectionData);
    return;
  }

  if (shouldSuppressPreviewForTextInput()) {
    currentTextSelection = null;
    return;
  }

  const selection = document.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (isSelectionInFormTextControl(range)) {
      currentTextSelection = null;
      return;
    }
  }

  if (!currentTextSelection || !currentTextSelection.text?.trim()) {
    currentTextSelection = null;
    return;
  }

  startTextSelectionPreviewTimer(currentTextSelection);
}

// 处理键盘按下事件
function handleKeyDown(e) {
  const eventCode = getPreviewEventCode(e);
  if (eventCode) pressedPreviewKeys.add(eventCode);

  if (isPreviewDoubleTriggerMode() && isPreviewTriggerKeyEvent(e) && !e.repeat) {
    const now = Date.now();
    const triggerIdentity = getPreviewTriggerIdentityFromEvent(e);
    if (
      triggerIdentity &&
      doubleKeyLastPressCode === triggerIdentity &&
      now - doubleKeyLastPressTime <= PREVIEW_DOUBLE_KEY_INTERVAL_MS
    ) {
      armPreviewDoubleKey();
      doubleKeyLastPressCode = '';
      doubleKeyLastPressTime = 0;
    } else {
      doubleKeyLastPressCode = triggerIdentity;
      doubleKeyLastPressTime = now;
    }
  }

  syncModifierKeyFromEvent(e);

  if (e.key === 'Escape' && activePreviewWindows.size > 0) {
    closeAllPreviewWindows();
  }
}

// 处理键盘释放事件
function handleKeyUp(e) {
  const eventCode = getPreviewEventCode(e);
  if (eventCode) pressedPreviewKeys.delete(eventCode);

  if (previewSettings.modifierKey !== 'none' && !isPreviewDoubleTriggerMode()) {
    syncModifierKeyFromEvent(e);
  }

  if (e.key === 'Escape' && activePreviewWindows.size > 0) {
    closeAllPreviewWindows();
  }
}

// 处理鼠标悬停
function handleMouseOver(e, linkElement) {
  if (e) {
    currentMousePosition.x = e.clientX;
    currentMousePosition.y = e.clientY;
    currentMousePosition.screenX = e.screenX;
    currentMousePosition.screenY = e.screenY;
  }
  currentHoverElement = linkElement;
  console.log('鼠标悬停在链接上:', linkElement.href, '修饰键状态:', isModifierKeyPressed, '预览功能状态:', previewSettings.enabled);
  
  // 如果预览功能已启用且满足条件，开始预览倒计时
  if (previewSettings.enabled && 
      !shouldSuppressPreviewForTextInput() &&
      (previewSettings.modifierKey === 'none' || isModifierKeyPressed)) {
    console.log('开始预览计时器...');
    startPreviewTimer(linkElement);
  } else {
    console.log('不满足预览条件，不启动预览');
  }
}

// 处理鼠标离开
function handleMouseOut(e, linkElement) {
  console.log('鼠标离开链接:', linkElement.href);
  // 清除当前悬停元素和计时器
  currentHoverElement = null;
  if (pendingPreviewRequest?.type === 'link' && pendingPreviewRequest.linkElement === linkElement) {
    console.log('取消预览计时器');
    clearPreviewTimer();
  }
}

// 处理文本选择变化
function handleSelectionChange(e) {
  // 如果预览功能被禁用或选中文字搜索功能被禁用，直接返回
  if (!previewSettings.enabled || !previewSettings.enableTextSearchPreview) return;

  const focusedRoot = getFocusedEditableTextRoot();
  if (focusedRoot) {
    syncTextSelectionFromFocusedInput(focusedRoot);
    return;
  }

  // 获取当前选择
  const selection = document.getSelection();
  
  // 如果有文本选择
  if (selection && selection.toString().trim()) {
    try {
      const editableFromSelection = findEditableTextRoot(selection.anchorNode);
      if (editableFromSelection && !isFormTextControl(editableFromSelection)) {
        syncTextSelectionFromFocusedInput(editableFromSelection);
        return;
      }

      // 获取选择的文本
      const selectedText = selection.toString().trim();
      
      // 如果选择的文本长度大于0，保存当前选择
      if (selectedText.length > 0) {
        // 再次检查选区内的所有元素（仅屏蔽 form input/textarea）
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (isSelectionInFormTextControl(range)) {
            currentTextSelection = null;
            return;
          }
        }
        
        // 获取选择区域的位置
        const selectionRect = selection.getRangeAt(0).getBoundingClientRect();
        
        // 存储当前文本选择和位置，但不立即显示预览
        currentTextSelection = {
          text: selectedText,
          position: {
            x: selectionRect.left + selectionRect.width / 2,
            y: selectionRect.bottom
          }
        };
        
        // 如果无需修饰键或触发条件已满足，则按配置的延迟启动预览。
        if (previewSettings.modifierKey === 'none' || isModifierKeyPressed) {
          console.log('预览触发条件已满足，启动选中文本预览计时器');
          startTextSelectionPreviewTimer(currentTextSelection);
        } else {
          console.log('已保存文本选择，等待修饰键触发预览:', selectedText);
        }
      }
    } catch (error) {
      console.error('处理文本选择时出错:', error);
    }
  } else {
    const root = getFocusedEditableTextRoot();
    if (root) {
      syncTextSelectionFromFocusedInput(root);
    } else {
      currentTextSelection = null;
    }
  }
}

// 检查选择区域是否在 form input/textarea 内（不含 contenteditable）
function isSelectionInFormTextControl(range) {
  let startElement = range.startContainer;
  while (startElement && startElement.nodeType !== Node.ELEMENT_NODE) {
    startElement = startElement.parentElement;
  }

  if (startElement && isFormTextControl(startElement)) {
    return true;
  }

  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_ELEMENT,
    null,
    false
  );

  let currentNode = walker.nextNode();
  while (currentNode) {
    if (isFormTextControl(currentNode)) {
      return true;
    }
    currentNode = walker.nextNode();
  }

  return false;
}

function stripPreviewUrlCandidate(text) {
  let value = String(text || '').trim();
  value = value.replace(/[\u200B-\u200D\uFEFF]/g, '');
  if (!value) return '';

  const wrapperPairs = [
    ['<', '>'],
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
    ['`', '`']
  ];

  let changed = true;
  while (changed && value.length > 1) {
    changed = false;
    for (const [left, right] of wrapperPairs) {
      if (value.startsWith(left) && value.endsWith(right)) {
        value = value.slice(left.length, -right.length).trim();
        changed = true;
      }
    }
  }

  // 选中句子里的链接时，经常会带上句末标点；去掉不属于 URL 的尾随标点。
  value = value.replace(/[，。；;！!、]+$/g, '');
  value = value.replace(/[.,]+$/g, '');
  value = value.replace(/[）)\]}》>]+$/g, '');
  return value.trim();
}

function isPreviewAllowedUrlProtocol(url) {
  return url && ['http:', 'https:', 'ftp:'].includes(url.protocol);
}

function isPreviewValidIpv4Host(hostname) {
  if (!hostname) return false;
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

function isPreviewLikelyDomainText(text) {
  if (!text || /\s/.test(text)) return false;
  if (/^[0-9.]+$/.test(text)) return false;
  const domainPattern = /^(?:www\.)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}(?::\d{1,5})?(?:[/?#].*)?$/;
  return domainPattern.test(text);
}

function isPreviewLikelyIpv4UrlText(text) {
  if (!text || /\s/.test(text)) return false;
  if (!/^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:[/?#].*)?$/.test(text)) return false;
  try {
    const url = new URL('https://' + text);
    if (!isPreviewValidIpv4Host(url.hostname)) return false;
    if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function normalizePreviewTextLikeSuperDrag(text) {
  return String(text || '').trim();
}

function isPreviewTextUrlLikeSuperDrag(text) {
  let value = normalizePreviewTextLikeSuperDrag(text);
  if (!value) return false;

  if (/^[0-9.]+$/.test(value)) {
    const ipParts = value.split('.');
    if (ipParts.length !== 4 || ipParts.some((part) => !part)) {
      return false;
    }
  }

  if (/^(https?|ftp):\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return isPreviewAllowedUrlProtocol(url);
    } catch (e) {
      return false;
    }
  }

  const domainRegex = /^(www\.)?[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(\.[a-zA-Z]{2,})?([/?#].*)?$/;
  return domainRegex.test(value);
}

function normalizePreviewOpenableTextUrl(text) {
  const selectedText = normalizePreviewTextLikeSuperDrag(text);
  if (!selectedText) return '';

  let candidate = stripPreviewUrlCandidate(selectedText);
  if (!candidate || /\s/.test(candidate)) return '';
  if (!isPreviewTextUrlLikeSuperDrag(candidate)) return '';

  if (!/^(https?|ftp):\/\//i.test(candidate)) {
    candidate = 'https://' + candidate;
  }

  try {
    const url = new URL(candidate);
    if (!isPreviewAllowedUrlProtocol(url)) return '';
    return url.href;
  } catch (_) {
    return '';
  }
}

function buildPreviewSearchUrlLikeSuperDrag(text) {
  const selectedText = normalizePreviewTextLikeSuperDrag(text);
  if (!selectedText) return '';
  const searchEngine = String(previewSettings.searchEngine || 'https://www.google.com/search?q={q}').trim() || 'https://www.google.com/search?q={q}';
  if (searchEngine.includes('{q}')) {
    return searchEngine.replace('{q}', encodeURIComponent(selectedText));
  }
  return `${searchEngine}${encodeURIComponent(selectedText)}`;
}

// 显示文本选择预览
function showTextSelectionPreview(selectionData) {
  if (!selectionData || !selectionData.text) return;
  const selectedText = normalizePreviewTextLikeSuperDrag(selectionData.text);
  if (!selectedText) return;

  if (!selectionData.fromInput) {
    if (shouldSuppressPreviewForTextInput()) return;

    const selection = document.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (isSelectionInFormTextControl(range)) {
        console.log('显示前检测到选择在 form 输入框内，取消预览');
        return;
      }
    }
  } else {
    const root = selectionData.editableRoot || getFocusedEditableTextRoot();
    if (!root || !getEditableSelectedText(root)) return;
  }
  
  // 创建预览窗口ID
  const openableTextUrl = normalizePreviewOpenableTextUrl(selectedText);
  const previewId = `${openableTextUrl ? 'text-url-preview' : 'search-preview'}-${Date.now()}-${previewCounter++}`;
  
  // 如果选中文字本身是链接 / IP，直接预览该地址；否则按搜索引擎搜索。
  let targetUrl = openableTextUrl;
  if (!targetUrl) {
    targetUrl = buildPreviewSearchUrlLikeSuperDrag(selectedText);
    if (!targetUrl) return;
  }
  
  const title = openableTextUrl
    ? selectedText
    : getI18nMessage('searchPrefix', 'Search: ') + selectedText;
  
  // 临时保存当前鼠标位置
  const originalMousePosition = {...currentMousePosition};
  
  // 如果是基于选择的预览，则使用选择位置
  if (selectionData.position) {
    currentMousePosition.x = selectionData.position.x;
    currentMousePosition.y = selectionData.position.y;
    const selectionScreenPoint = viewportPointToScreen(selectionData.position.x, selectionData.position.y);
    currentMousePosition.screenX = selectionScreenPoint.screenX;
    currentMousePosition.screenY = selectionScreenPoint.screenY;
  }
  
  // 创建预览窗口
  createPopupWindow(previewId, targetUrl, title);
  
  // 恢复原始鼠标位置
  currentMousePosition = originalMousePosition;
}

// 查找链接元素
function findLinkElement(element) {
  let current = element;
  
  // 检查是否在文本输入框内
  let checkElement = element;
  while (checkElement && checkElement !== document.body) {
    if (isTextInputElement(checkElement)) {
      // 如果在文本输入框内，不处理链接预览
      return null;
    }
    checkElement = checkElement.parentElement;
  }
  
  // 向上查找最近的链接元素
  while (current && current !== document.body) {
    if (current.tagName === 'A' && current.href) {
      return current;
    }
    current = current.parentElement;
  }
  
  return null;
}

// 开始预览计时器
function startPreviewTimer(linkElement) {
  if (shouldSuppressPreviewForTextInput()) return;
  schedulePreviewRequest({ type: 'link', linkElement });
}

// 显示链接预览
function showLinkPreview(linkElement) {
  // 创建预览窗口ID
  const previewId = `preview-${Date.now()}-${previewCounter++}`;
  
  // 获取链接URL和文本
  const url = linkElement.href;
  const title = linkElement.textContent.trim() || url;
  
  // 创建预览窗口
  createPopupWindow(previewId, url, title);
}

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getAvailableScreenRect() {
  const s = window.screen || {};
  const width = Math.max(100, finiteNumber(s.availWidth, finiteNumber(s.width, 1024)));
  const height = Math.max(100, finiteNumber(s.availHeight, finiteNumber(s.height, 768)));
  return {
    left: finiteNumber(s.availLeft, 0),
    top: finiteNumber(s.availTop, 0),
    width,
    height,
    right: finiteNumber(s.availLeft, 0) + width,
    bottom: finiteNumber(s.availTop, 0) + height
  };
}

function clampWindowCoordinate(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function clampPopupPosition(left, top, width, height, screenRect) {
  return {
    left: clampWindowCoordinate(left, screenRect.left, screenRect.left + Math.max(0, screenRect.width - width)),
    top: clampWindowCoordinate(top, screenRect.top, screenRect.top + Math.max(0, screenRect.height - height))
  };
}

function viewportPointToScreen(clientX, clientY) {
  const outerWidth = finiteNumber(window.outerWidth, window.innerWidth || 0);
  const outerHeight = finiteNumber(window.outerHeight, window.innerHeight || 0);
  const innerWidth = finiteNumber(window.innerWidth, 0);
  const innerHeight = finiteNumber(window.innerHeight, 0);
  const borderX = Math.max(0, (outerWidth - innerWidth) / 2);
  const browserTopChrome = Math.max(0, outerHeight - innerHeight - borderX);
  return {
    screenX: finiteNumber(window.screenX, finiteNumber(window.screenLeft, 0)) + borderX + finiteNumber(clientX, 0),
    screenY: finiteNumber(window.screenY, finiteNumber(window.screenTop, 0)) + browserTopChrome + finiteNumber(clientY, 0)
  };
}

function getPopupAnchorScreenPoint() {
  if (
    currentMousePosition &&
    Number.isFinite(currentMousePosition.screenX) &&
    Number.isFinite(currentMousePosition.screenY)
  ) {
    return {
      screenX: currentMousePosition.screenX,
      screenY: currentMousePosition.screenY
    };
  }
  return viewportPointToScreen(currentMousePosition?.x || 0, currentMousePosition?.y || 0);
}

function calculatePopupPosition(width, height) {
  const screenRect = getAvailableScreenRect();
  const margin = 16;
  let left;
  let top;

  if (previewSettings.position === 'cursor' && currentMousePosition) {
    const anchor = getPopupAnchorScreenPoint();
    left = anchor.screenX + margin;
    top = anchor.screenY + margin;

    if (left + width > screenRect.right) {
      left = anchor.screenX - width - margin;
    }
    if (top + height > screenRect.bottom) {
      top = anchor.screenY - height - margin;
    }
  } else if (previewSettings.position === 'center') {
    left = screenRect.left + (screenRect.width - width) / 2;
    top = screenRect.top + (screenRect.height - height) / 2;
  } else {
    left = screenRect.right - width - 20;
    top = screenRect.top + 20;
  }

  return clampPopupPosition(left, top, width, height, screenRect);
}

function requestExistingPreviewPopupFocus(urlKey, targetUrl, onDone) {
  if (!urlKey) {
    if (typeof onDone === 'function') onDone(false);
    return false;
  }
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      if (typeof onDone === 'function') onDone(false);
      return false;
    }
    chrome.runtime.sendMessage({
      type: '__mouseGestureFindPreviewPopup',
      urlKey,
      url: targetUrl
    }, (res) => {
      if (chrome.runtime.lastError) {
        if (typeof onDone === 'function') onDone(false);
        return;
      }
      if (typeof onDone === 'function') onDone(!!(res && res.ok && res.found));
    });
    return true;
  } catch (e) {
    if (typeof onDone === 'function') onDone(false);
    return false;
  }
}

function registerPreviewPopupWithBackground(urlKey, targetUrl, title) {
  if (!urlKey) return;
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') return;
    chrome.runtime.sendMessage({
      type: '__mouseGestureRegisterPreviewPopup',
      urlKey,
      url: targetUrl,
      title: title || ''
    }, () => {
      // Read lastError to avoid noisy unchecked-runtime-error messages when the background is reloading.
      const ignored = chrome.runtime.lastError;
    });
  } catch (e) { /* ignore */ }
}

function openPreviewPopupWindowNow(previewId, targetUrl, title, urlKey) {
  // Check max preview window count after de-duplication so repeated triggers do not close/reopen old windows.
  enforcePreviewWindowLimit();

  // Keep popup bounds inside the currently available screen area.
  const screenRect = getAvailableScreenRect();
  const requestedWidth = parseInt(previewSettings.defaultWidth, 10);
  const requestedHeight = parseInt(previewSettings.defaultHeight, 10);
  const width = Math.min(Math.max(100, Number.isFinite(requestedWidth) ? requestedWidth : 480), screenRect.width);
  const height = Math.min(Math.max(100, Number.isFinite(requestedHeight) ? requestedHeight : 640), screenRect.height);
  const { left, top } = calculatePopupPosition(width, height);
  const windowName = getPreviewWindowNameForUrl(urlKey);

  const features = [
    `width=${width}`,
    `height=${height}`,
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    'directories=no',
    'scrollbars=yes',
    'resizable=yes',
    'chrome=no'
  ].join(',');

  // Use the original browser popup window style, but with a stable name based on URL.
  const popupWindow = window.open(targetUrl, windowName, features);

  if (!popupWindow) {
    console.error('Unable to open popup window, it may be blocked by the browser. Please allow popups.');
    showBlockedPopupNotification();
    return null;
  }

  markRecentPreviewWindowUrlKey(urlKey);
  activePreviewWindows.set(windowName, {
    id: windowName,
    window: popupWindow,
    url: targetUrl,
    urlKey,
    title: title
  });
  if (urlKey) activePreviewWindowUrlIndex.set(urlKey, windowName);
  registerPreviewPopupWithBackground(urlKey, targetUrl, title);

  const checkClosedInterval = setInterval(() => {
    if (popupWindow.closed) {
      clearInterval(checkClosedInterval);
      closePreviewWindow(windowName);
    }
  }, 500);

  return popupWindow;
}

// Create popup window
function createPopupWindow(previewId, url, title) {
  // 确保URL格式正确
  let targetUrl = String(url || '').trim();
  if (!targetUrl) return null;
  try {
    targetUrl = new URL(targetUrl).href;
  } catch (e) {
    // 如果URL无效，尝试添加https://前缀
    if (!targetUrl.match(/^https?:\/\//i)) {
      targetUrl = 'https://' + targetUrl;
    }
    try {
      targetUrl = new URL(targetUrl).href;
    } catch (_) {
      return null;
    }
  }

  const urlKey = normalizePreviewWindowUrlKey(targetUrl);
  const existingPreview = getActivePreviewByUrl(targetUrl);
  if (existingPreview) {
    focusExistingPreviewWindow(existingPreview);
    return existingPreview.window;
  }
  if (isRecentPreviewWindowUrlKey(urlKey)) return null;
  if (pendingPreviewWindowUrlKeys.has(urlKey)) return null;

  pendingPreviewWindowUrlKeys.add(urlKey);
  const sent = requestExistingPreviewPopupFocus(urlKey, targetUrl, (found) => {
    if (found) {
      pendingPreviewWindowUrlKeys.delete(urlKey);
      return;
    }
    try {
      openPreviewPopupWindowNow(previewId, targetUrl, title, urlKey);
    } finally {
      pendingPreviewWindowUrlKeys.delete(urlKey);
    }
  });

  if (!sent) {
    try {
      return openPreviewPopupWindowNow(previewId, targetUrl, title, urlKey);
    } finally {
      pendingPreviewWindowUrlKeys.delete(urlKey);
    }
  }
  return null;
}

// 关闭预览窗口
function closePreviewWindow(previewId) {
  const previewData = activePreviewWindows.get(previewId);
  if (!previewData) return;
  
  // 关闭弹出窗口
  if (previewData.window && !previewData.window.closed) {
    previewData.window.close();
  }
  
  // 从活动窗口列表中移除
  activePreviewWindows.delete(previewId);
  if (previewData.urlKey && activePreviewWindowUrlIndex.get(previewData.urlKey) === previewId) {
    activePreviewWindowUrlIndex.delete(previewData.urlKey);
  }
}

// 关闭所有预览窗口
function closeAllPreviewWindows() {
  for (const [previewId, previewData] of activePreviewWindows.entries()) {
    if (previewData.window && !previewData.window.closed) {
      previewData.window.close();
    }
  }
  
  // 清空活动窗口列表
  activePreviewWindows.clear();
  activePreviewWindowUrlIndex.clear();
  pendingPreviewWindowUrlKeys.clear();
  recentPreviewWindowUrlKeys.clear();
  
  // 清除当前文本选择
  currentTextSelection = null;
}

// 显示弹出窗口被阻止的通知
function showBlockedPopupNotification() {
  if (typeof MouseExtUiHost === 'undefined') return;
  // 创建通知元素
  const notification = createPreviewElement('div');
  notification.className = 'popup-blocked-notification';
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background-color: #f44336;
    color: white;
    padding: 15px 20px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    font-family: Arial, sans-serif;
    font-size: 14px;
    z-index: 2147483647;
    max-width: 300px;
    opacity: 0;
    transition: opacity 0.3s ease-in-out;
  `;
  
  // 创建关闭按钮
  const closeButton = createPreviewElement('span');
  closeButton.innerHTML = '&times;';
  closeButton.style.cssText = `
    position: absolute;
    top: 5px;
    right: 10px;
    cursor: pointer;
    font-size: 18px;
    font-weight: bold;
  `;
  closeButton.addEventListener('click', () => {
    if (notification.parentNode) notification.parentNode.removeChild(notification);
  });
  
  // 设置通知内容
  const popupBlockedTitle = getI18nMessage('popupBlocked', 'Popup Blocked');
  const popupBlockedMessage = getI18nMessage('allowPopupsMessage', 'Please allow popups for this site to enable link preview functionality.');

  const bodyWrap = createPreviewElement('div');
  bodyWrap.style.marginRight = '20px';
  const titleEl = createPreviewElement('strong');
  titleEl.textContent = popupBlockedTitle;
  const pEl = createPreviewElement('p');
  pEl.style.margin = '5px 0 0 0';
  pEl.textContent = popupBlockedMessage;
  bodyWrap.appendChild(titleEl);
  bodyWrap.appendChild(pEl);
  notification.appendChild(bodyWrap);
  notification.appendChild(closeButton);

  if (!MouseExtUiHost.appendToNotificationsLayer(notification)) return;
  
  // 使用延迟显示以触发过渡效果
  setTimeout(() => {
    notification.style.opacity = '1';
  }, 10);
  
  // 5秒后自动隐藏
  setTimeout(() => {
    notification.style.opacity = '0';
    // 等待过渡完成后移除元素
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 5000);
}

// 由 content.js 在 DOMContentLoaded 后调用 initLinkPreview()

// 导出功能供其他模块使用
try {
  globalThis.MouseExtPreviewOpenPopup = function(url, title) {
    return createPopupWindow(`external_${Date.now()}_${Math.random().toString(36).slice(2)}`, url, title || '');
  };
} catch (e) { /* ignore */ }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initLinkPreview,
    loadPreviewSettings,
    showLinkPreview,
    closeAllPreviewWindows
  };
} 
