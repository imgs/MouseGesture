(function initMouseExtSettings(global) {
  'use strict';

  if (!global || global.MouseExtSettings) return;

  const previewDefaults = Object.freeze({
    previewEnabled: true,
    previewHoverDelay: 200,
    previewModifierKey: 'Shift',
    previewTriggerMode: 'double',
    previewCustomKey: '',
    previewMaxWindows: 20,
    previewDefaultWidth: 480,
    previewDefaultHeight: 640,
    previewPosition: 'cursor',
    previewSearchEngine: 'https://www.google.com/search?q={q}',
    enableTextSearchPreview: true
  });

  const uiDefaults = Object.freeze({
    settingsFontSize: 'normal'
  });

  const contentDefaults = Object.freeze({
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
    theme: 'light',
    language: 'en_US',
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
    ...previewDefaults,
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
    screenshotHotkeyOpenHistory: 'alt+digit6',
    screenshotHotkeyRegion: 'alt+digit7',
    screenshotHotkeyViewport: 'alt+digit8',
    screenshotHotkeyFullPage: 'alt+digit9',
    screenshotHotkeyScrolling: 'alt+digit0'
  });

  const contentSettingKeys = new Set(Object.keys(contentDefaults));

  function normalizePreviewModifierKey(value) {
    const key = String(value || '').trim();
    return ['Control', 'Alt', 'Shift', 'Meta', 'custom', 'none'].includes(key) ? key : previewDefaults.previewModifierKey;
  }

  function normalizePreviewTriggerMode(value, modifierKey) {
    if (normalizePreviewModifierKey(modifierKey) === 'none') return 'hold';
    return String(value || '').trim() === 'hold' ? 'hold' : previewDefaults.previewTriggerMode;
  }

  function normalizePreviewCustomKey(value) {
    const key = String(value || '').trim().toLowerCase();
    if (!key) return '';
    return /^[a-z0-9]+[a-z0-9_-]*$/i.test(key) ? key : '';
  }

  function clampPreviewHoverDelay(value) {
    const parsed = parseInt(value, 10);
    const delay = Number.isFinite(parsed) ? parsed : previewDefaults.previewHoverDelay;
    const clamped = Math.min(5000, Math.max(100, delay));
    return Math.round(clamped / 50) * 50;
  }

  function normalizePreviewMaxWindows(value) {
    if (String(value ?? '').trim().toLowerCase() === 'unlimited') return 0;
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return previewDefaults.previewMaxWindows;
    return parsed <= 0 ? 0 : parsed;
  }

  function getPreviewDefaults() {
    return { ...previewDefaults };
  }

  function getUiDefaults() {
    return { ...uiDefaults };
  }

  function getContentDefaults(overrides) {
    return Object.assign({}, contentDefaults, overrides || {});
  }

  function getUiLanguage() {
    try {
      return String(chrome.i18n.getUILanguage() || 'en').replace(/_/g, '-');
    } catch (e) {
      return 'en';
    }
  }

  function isRtlLanguage(language) {
    return /^(ar|fa|he|ps|ur)(-|$)/i.test(String(language || '').replace(/_/g, '-'));
  }

  function applyDocumentLocale(language) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const locale = String(language || getUiLanguage()).replace(/_/g, '-');
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtlLanguage(locale) ? 'rtl' : 'ltr';
  }

  function buildContentSyncPatch(changes) {
    const patch = {};
    if (!changes || typeof changes !== 'object') return patch;
    Object.keys(changes).forEach((key) => {
      if (!contentSettingKeys.has(key)) return;
      const change = changes[key];
      if (!change) return;
      patch[key] = change.newValue === undefined ? contentDefaults[key] : change.newValue;
    });
    return patch;
  }

  global.MouseExtSettings = Object.freeze({
    getPreviewDefaults,
    getUiDefaults,
    getContentDefaults,
    getUiLanguage,
    isRtlLanguage,
    applyDocumentLocale,
    buildContentSyncPatch,
    normalizePreviewModifierKey,
    normalizePreviewTriggerMode,
    normalizePreviewCustomKey,
    clampPreviewHoverDelay,
    normalizePreviewMaxWindows
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
