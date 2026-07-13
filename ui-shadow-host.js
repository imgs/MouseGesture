/**
 * Unified Shadow DOM host for extension page overlays.
 * Exposes global MouseExtUiHost (loaded before other content scripts).
 */
(function (global) {
  'use strict';

  const HOST_ID = 'mouse-ext-ui-host';
  const HOST_PAGE_STYLE_ID = 'mouse-ext-ui-host-page-style';
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const LAYER_IDS = {
    gesture: 'mouse-ext-layer-gesture',
    compass: 'mouse-ext-layer-compass',
    screenshot: 'mouse-ext-layer-screenshot',
    notifications: 'mouse-ext-layer-notifications',
    panels: 'mouse-ext-layer-panels',
    pins: 'mouse-ext-layer-pins',
    modals: 'mouse-ext-layer-modals',
    hints: 'mouse-ext-layer-hints',
    preview: 'mouse-ext-layer-preview'
  };

  const hostShadowRoots = new WeakMap();
  let currentHost = null;
  let currentShadowRoot = null;
  let currentLanguage = '';
  let currentDirection = '';
  let idleRemoveTimer = 0;
  let layerObserver = null;
  const HOST_IDLE_REMOVE_DELAY_MS = 900;

  function createHostElement(tagName) {
    const tag = String(tagName || '').toLowerCase();
    let el = null;
    try {
      el = document.createElement(tagName);
    } catch (e) {
      el = null;
    }
    if (!el || !el.style || (tag === 'div' && typeof el.attachShadow !== 'function')) {
      try {
        el = document.createElementNS(HTML_NS, tagName);
      } catch (e) {
        el = null;
      }
    }
    if (!el || !el.style || (tag === 'div' && typeof el.attachShadow !== 'function')) {
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

  function canAppendToFullscreenEl(el) {
    try {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
      const tag = el.tagName;
      if (
        tag === 'VIDEO' ||
        tag === 'AUDIO' ||
        tag === 'IMG' ||
        tag === 'IFRAME' ||
        tag === 'OBJECT' ||
        tag === 'EMBED'
      ) {
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function getMountParent() {
    const fs = document.fullscreenElement;
    if (canAppendToFullscreenEl(fs)) return fs;
    return document.documentElement;
  }

  function applyImportantStyle(el, styles) {
    if (!el || !el.style) return;
    Object.keys(styles).forEach((name) => {
      try {
        el.style.setProperty(name, styles[name], 'important');
      } catch (e) { /* ignore */ }
    });
  }

  function applyHostAttributes(host, usePopover = true) {
    if (!host) return;
    host.id = HOST_ID;
    host.setAttribute('aria-hidden', 'true');
    if (usePopover && typeof host.showPopover === 'function') {
      host.setAttribute('popover', 'manual');
    } else {
      host.removeAttribute('popover');
    }
    host.setAttribute('data-mouse-ext-top-layer-host', 'true');
    host.setAttribute('lang', currentLanguage || document.documentElement?.lang || navigator.language || 'en-US');
    host.setAttribute('dir', currentDirection || document.documentElement?.dir || document.dir || 'ltr');
    applyImportantStyle(host, {
      position: 'fixed',
      top: '0px',
      left: '0px',
      width: '100%',
      height: '100%',
      'max-width': 'none',
      'max-height': 'none',
      margin: '0px',
      padding: '0px',
      border: '0px',
      outline: '0px',
      background: 'transparent',
      overflow: 'visible',
      opacity: '1',
      display: 'block',
      'box-sizing': 'border-box',
      'pointer-events': 'none',
      'z-index': '2147483647'
    });
  }

  function setLocale(language) {
    const locale = String(language || navigator.language || 'en-US').replace(/_/g, '-');
    currentLanguage = locale;
    currentDirection = /^(ar|fa|he|ps|ur)(-|$)/i.test(locale) ? 'rtl' : 'ltr';
    const host = document.getElementById(HOST_ID);
    if (host) {
      host.setAttribute('lang', currentLanguage);
      host.setAttribute('dir', currentDirection);
    }
  }

  function ensureDocumentHostStyle() {
    try {
      if (document.getElementById(HOST_PAGE_STYLE_ID)) return;
      const style = createHostElement('style');
      if (!style) return;
      style.id = HOST_PAGE_STYLE_ID;
      style.textContent = [
        `#${HOST_ID} {`,
        '  position: fixed !important;',
        '  top: 0 !important;',
        '  left: 0 !important;',
        '  width: 100% !important;',
        '  height: 100% !important;',
        '  max-width: none !important;',
        '  max-height: none !important;',
        '  margin: 0 !important;',
        '  padding: 0 !important;',
        '  border: 0 !important;',
        '  outline: 0 !important;',
        '  background: transparent !important;',
        '  overflow: visible !important;',
        '  opacity: 1 !important;',
        '  display: block !important;',
        '  pointer-events: none !important;',
        '  z-index: 2147483647 !important;',
        '}',
        `#${HOST_ID}::backdrop {`,
        '  background: transparent !important;',
        '  pointer-events: none !important;',
        '}',
        `#${HOST_ID}:popover-open {`,
        '  display: block !important;',
        '}'
      ].join('\n');
      const parent = document.head || document.documentElement;
      if (parent) parent.appendChild(style);
    } catch (e) { /* ignore */ }
  }

  function buildBaseStyles() {
    const style = createHostElement('style');
    if (!style) return null;
    style.id = 'mouse-ext-ui-base-style';
    style.textContent = [
      ':host {',
      '  all: initial;',
      '  position: fixed !important;',
      '  top: 0 !important;',
      '  left: 0 !important;',
      '  width: 100% !important;',
      '  height: 100% !important;',
      '  margin: 0 !important;',
      '  padding: 0 !important;',
      '  border: 0 !important;',
      '  background: transparent !important;',
      '  overflow: visible !important;',
      '  z-index: 2147483647 !important;',
      '  pointer-events: none !important;',
      '}',
      '.mouse-ext-layer {',
      '  position: fixed;',
      '  inset: 0;',
      '  pointer-events: none;',
      '}',
      '#mouse-gesture-trail-canvas {',
      '  position: fixed;',
      '  top: 0;',
      '  left: 0;',
      '  display: block;',
      '  pointer-events: none;',
      '}',
      '#mouse-gesture-notification-container {',
      '  pointer-events: auto;',
      '}',
      '#mouse-gesture-notification-container .url-list,',
      '#mouse-trail-region-chooser__list {',
      '  scrollbar-color: rgba(255,255,255,0.2) transparent;',
      '  scrollbar-width: thin;',
      '}',
      '#mouseGestureDebugPanel {',
      '  pointer-events: auto;',
      '}',
      '.popup-blocked-notification {',
      '  pointer-events: auto;',
      '}',
      '#mouse-screenshot-region-picker,',
      '#mouse-trail-region-chooser {',
      '  pointer-events: auto;',
      '}',
      '#mouse-gesture-hint {',
      '  pointer-events: none;',
      '}',
      '#mouse-image-preview {',
      '  position: fixed;',
      '  pointer-events: none;',
      '  display: none;',
      '  background-color: transparent;',
      '  padding: 0;',
      '  border-radius: 0;',
      '  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);',
      '  transition: opacity 0.2s ease-in-out;',
      '  opacity: 0;',
      '  border: none;',
      '  overflow: hidden;',
      '}',
      '#mouse-image-preview img {',
      '  display: block;',
      '  object-fit: contain;',
      '  border: none;',
      '  max-width: 100%;',
      '  max-height: 100%;',
      '  pointer-events: none;',
      '}',
      '#mouse-screenshot-pins-root {',
      '  pointer-events: none;',
      '}',
      '#mouse-gesture-scroll-capture-bar {',
      '  pointer-events: none;',
      '  visibility: visible;',
      '}',
      '.mouse-screenshot-region-picker__hint {',
      '  pointer-events: none;',
      '}'
    ].join('\n');
    return style;
  }

  function getStoredShadowRoot(host) {
    if (!host) return null;
    return host.shadowRoot || host.__mouseExtUiShadowRoot || hostShadowRoots.get(host) || (host === currentHost ? currentShadowRoot : null);
  }

  function getExistingHost() {
    return currentHost && currentHost.isConnected ? currentHost : document.getElementById(HOST_ID);
  }

  function getExistingShadowRoot() {
    const host = getExistingHost();
    return getStoredShadowRoot(host);
  }

  function getExistingLayer(name) {
    const shadow = getExistingShadowRoot();
    if (!shadow) return null;
    const id = LAYER_IDS[name];
    return id ? shadow.getElementById(id) : null;
  }

  function clearIdleRemoveTimer() {
    if (idleRemoveTimer) {
      clearTimeout(idleRemoveTimer);
      idleRemoveTimer = 0;
    }
  }

  function isInactiveOverlayElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
    if (el.hidden) return true;
    const display = el.style && el.style.display;
    const visibility = el.style && el.style.visibility;
    const opacity = el.style && el.style.opacity;
    if (display === 'none' || visibility === 'hidden') return true;
    if (el.id === 'mouse-image-preview' && (display === 'none' || opacity === '0')) return true;
    if (el.id === 'mouse-gesture-hint' && opacity === '0') return true;
    if (el.id === 'mouseGestureDebugPanel' && display === 'none') return true;
    if (el.id === 'mouse-super-drag-compass' && !el.classList.contains('sd-compass-ready')) return true;
    if (el.id === 'mouse-screenshot-pins-root' && el.children.length === 0) return true;
    return false;
  }

  function isActiveOverlayElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (isInactiveOverlayElement(el)) return false;
    return true;
  }

  function hasActiveLayerContent(shadow) {
    if (!shadow) return false;
    const keys = Object.keys(LAYER_IDS);
    for (let i = 0; i < keys.length; i++) {
      const layer = shadow.getElementById(LAYER_IDS[keys[i]]);
      if (!layer) continue;
      for (let j = 0; j < layer.children.length; j++) {
        if (isActiveOverlayElement(layer.children[j])) return true;
      }
    }
    return false;
  }

  function removeDocumentHostStyleIfIdle() {
    try {
      const style = document.getElementById(HOST_PAGE_STYLE_ID);
      if (style && !document.getElementById(HOST_ID)) style.remove();
    } catch (e) { /* ignore */ }
  }

  function disconnectLayerObserver() {
    if (layerObserver) {
      try {
        layerObserver.disconnect();
      } catch (e) { /* ignore */ }
      layerObserver = null;
    }
  }

  function scheduleIdleHostRemoval() {
    clearIdleRemoveTimer();
    idleRemoveTimer = setTimeout(() => {
      idleRemoveTimer = 0;
      const host = getExistingHost();
      const shadow = getStoredShadowRoot(host);
      if (!host || !shadow || hasActiveLayerContent(shadow)) return;
      removeHost(host);
      removeDocumentHostStyleIfIdle();
    }, HOST_IDLE_REMOVE_DELAY_MS);
  }

  function syncIdleHostRemovalState() {
    const shadow = getExistingShadowRoot();
    if (!shadow) {
      clearIdleRemoveTimer();
      return;
    }
    if (hasActiveLayerContent(shadow)) {
      clearIdleRemoveTimer();
    } else {
      scheduleIdleHostRemoval();
    }
  }

  function ensureLayerObserver(shadow) {
    if (!shadow) return;
    if (layerObserver) {
      try {
        layerObserver.disconnect();
      } catch (e) { /* ignore */ }
    }
    layerObserver = new MutationObserver(() => syncIdleHostRemovalState());
    try {
      layerObserver.observe(shadow, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden']
      });
    } catch (e) {
      layerObserver = null;
    }
  }

  function isHostPopoverOpen(host) {
    if (!host || !host.matches) return false;
    try {
      return host.matches(':popover-open');
    } catch (e) {
      return false;
    }
  }

  function hideHostPopover(host) {
    if (!host || typeof host.hidePopover !== 'function') return;
    try {
      if (isHostPopoverOpen(host)) host.hidePopover();
    } catch (e) { /* ignore */ }
  }

  function ensureHostTopLayer(host, forceRaise) {
    if (!host || typeof host.showPopover !== 'function') return false;
    if (!host.isConnected) return false;
    try {
      applyHostAttributes(host);
      // showPopover() only raises the host when it transitions into the top layer.
      // Hide+show is used when explicitly requested so overlays can stay above
      // webpage top-layer popovers/dialogs created after our host.
      if (forceRaise && isHostPopoverOpen(host)) {
        host.hidePopover();
      }
      if (!isHostPopoverOpen(host)) {
        host.showPopover();
      }
      applyHostAttributes(host);
      return isHostPopoverOpen(host);
    } catch (e) {
      try {
        host.removeAttribute('popover');
      } catch (e2) { /* ignore */ }
      applyHostAttributes(host, false);
      return false;
    }
  }

  function mountHost(host, options) {
    if (!host) return;
    ensureDocumentHostStyle();
    applyHostAttributes(host);
    const parent = getMountParent();
    if (!parent) return;
    // 宿主节点固定挂到当前挂载容器的最后，普通页面即 <html> 的最底部。
    // 若已在同一父级但后面还有兄弟节点，也重新 appendChild 以保持 Elements 结构靠后。
    const needsMove = host.parentNode !== parent || host.nextSibling;
    if (needsMove) {
      hideHostPopover(host);
      parent.appendChild(host);
    }
    ensureHostTopLayer(host, !!(options && options.forceRaise));
  }

  function ensureLayers(shadow) {
    if (!shadow) return;
    Object.keys(LAYER_IDS).forEach((key) => {
      const id = LAYER_IDS[key];
      if (shadow.getElementById(id)) return;
      const layer = createHostElement('div');
      if (!layer) return;
      layer.id = id;
      layer.className = 'mouse-ext-layer';
      shadow.appendChild(layer);
    });
    syncLayerOrder(shadow);
  }

  function syncLayerOrder(shadow) {
    if (!shadow) return;
    const keys = Object.keys(LAYER_IDS);
    for (let i = 0; i < keys.length; i++) {
      const layer = shadow.getElementById(LAYER_IDS[keys[i]]);
      if (layer) shadow.appendChild(layer);
    }
  }

  function createHost() {
    clearIdleRemoveTimer();
    const host = createHostElement('div');
    if (!host || typeof host.attachShadow !== 'function') return null;
    applyHostAttributes(host);
    let shadow = null;
    try {
      shadow = host.attachShadow({ mode: 'closed' });
    } catch (e) {
      return null;
    }
    hostShadowRoots.set(host, shadow);
    try {
      host.__mouseExtUiShadowRoot = shadow;
    } catch (e) { /* ignore */ }
    currentHost = host;
    currentShadowRoot = shadow;
    const baseStyle = buildBaseStyles();
    if (baseStyle) shadow.appendChild(baseStyle);

    Object.keys(LAYER_IDS).forEach((key) => {
      const layer = createHostElement('div');
      if (!layer) return;
      layer.id = LAYER_IDS[key];
      layer.className = 'mouse-ext-layer';
      shadow.appendChild(layer);
    });
    ensureLayerObserver(shadow);

    return host;
  }

  function removeHost(host) {
    if (!host) return;
    clearIdleRemoveTimer();
    disconnectLayerObserver();
    hideHostPopover(host);
    try {
      host.remove();
    } catch (e) { /* ignore */ }
    if (currentHost === host) {
      currentHost = null;
      currentShadowRoot = null;
    }
  }

  function ensureHost(options) {
    ensureDocumentHostStyle();
    let host = document.getElementById(HOST_ID);
    let shadow = getStoredShadowRoot(host);
    if (host && shadow) {
      currentHost = host;
      currentShadowRoot = shadow;
      applyHostAttributes(host);
      ensureLayers(shadow);
      ensureLayerObserver(shadow);
      mountHost(host, options);
      syncIdleHostRemovalState();
      return host;
    }
    if (host) {
      removeHost(host);
      host = null;
      shadow = null;
    }

    host = createHost();
    const parent = getMountParent();
    if (parent) {
      mountHost(host, options);
      syncIdleHostRemovalState();
    } else if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        mountHost(host, options);
        syncIdleHostRemovalState();
      }, { once: true });
    } else {
      setTimeout(() => {
        mountHost(host, options);
        syncIdleHostRemovalState();
      }, 100);
    }
    return host;
  }

  function getShadowRoot() {
    const host = ensureHost();
    return getStoredShadowRoot(host);
  }

  function getLayer(name) {
    const shadow = getShadowRoot();
    if (!shadow) return null;
    const id = LAYER_IDS[name];
    return id ? shadow.getElementById(id) : null;
  }

  function getElementById(id) {
    const shadow = getExistingShadowRoot();
    return shadow ? shadow.getElementById(id) : null;
  }

  function removeElementById(id) {
    const el = getElementById(id);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    syncIdleHostRemovalState();
  }

  function appendStyle(cssText, styleId) {
    const shadow = getShadowRoot();
    if (!shadow) return;
    if (styleId && shadow.getElementById(styleId)) return;
    const style = createHostElement('style');
    if (!style) return;
    if (styleId) style.id = styleId;
    style.textContent = cssText;
    shadow.appendChild(style);
  }

  function removeGestureTrailCanvases() {
    const layer = getExistingLayer('gesture');
    if (!layer) return;
    layer.querySelectorAll('canvas').forEach((canvas) => {
      try {
        canvas.remove();
      } catch (e) { /* ignore */ }
    });
    syncIdleHostRemovalState();
  }

  function getGestureTrailCanvas() {
    return getElementById('mouse-gesture-trail-canvas');
  }

  function raiseHostToTopLayer() {
    const host = ensureHost({ forceRaise: true });
    return ensureHostTopLayer(host, true);
  }

  function appendToLayer(layerName, element) {
    if (!element) return false;
    clearIdleRemoveTimer();
    ensureHost({ forceRaise: true });
    syncHostToFullscreenLayer({ forceRaise: true });
    const layer = getLayer(layerName);
    if (!layer) return false;
    layer.appendChild(element);
    syncIdleHostRemovalState();
    return true;
  }

  function appendToGestureLayer(element) {
    return appendToLayer('gesture', element);
  }

  function appendToCompassLayer(element) {
    return appendToLayer('compass', element);
  }

  function appendToNotificationsLayer(element) {
    return appendToLayer('notifications', element);
  }

  function appendToPanelsLayer(element) {
    return appendToLayer('panels', element);
  }

  function appendToScreenshotLayer(element) {
    return appendToLayer('screenshot', element);
  }

  function appendToHintsLayer(element) {
    return appendToLayer('hints', element);
  }

  function appendToPreviewLayer(element) {
    return appendToLayer('preview', element);
  }

  function appendToModalsLayer(element) {
    return appendToLayer('modals', element);
  }

  function appendToPinsLayer(element) {
    return appendToLayer('pins', element);
  }

  function syncHostToFullscreenLayer(options) {
    const host = document.getElementById(HOST_ID);
    if (host) mountHost(host, options);
  }

  global.MouseExtUiHost = {
    HOST_ID,
    setLocale,
    canAppendToFullscreenEl,
    getMountParent,
    ensureHost,
    getShadowRoot,
    getLayer,
    getElementById,
    removeElementById,
    getGestureTrailCanvas,
    removeGestureTrailCanvases,
    appendStyle,
    appendToGestureLayer,
    appendToCompassLayer,
    appendToNotificationsLayer,
    appendToPanelsLayer,
    appendToScreenshotLayer,
    appendToHintsLayer,
    appendToPreviewLayer,
    appendToModalsLayer,
    appendToPinsLayer,
    syncHostToFullscreenLayer,
    raiseHostToTopLayer,
    mountHost
  };

  try {
    document.addEventListener('fullscreenchange', () => syncHostToFullscreenLayer({ forceRaise: true }));
  } catch (e) { /* ignore */ }
})(typeof globalThis !== 'undefined' ? globalThis : window);
