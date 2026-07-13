/**
 * 页面主世界注入：解除复制/粘贴/右键/选中/可见性与焦点类限制。
 * 由 unlock-restrictions-bridge.js 注入；每帧 / 每 iframe 独立运行。
 * 可通过 window.__mouseGestureUnlockActive = false 软关闭（保留补丁，恢复原始行为）。
 */
(function () {
  try {
    if (window.__mouseGestureUnlockRestrictions) {
      window.__mouseGestureUnlockActive = true;
      return;
    }
    window.__mouseGestureUnlockRestrictions = true;
    window.__mouseGestureUnlockActive = true;
  } catch (e) {
    return;
  }

  const ATTR_HANDLERS = [
    'oncopy', 'oncut', 'onpaste', 'oncontextmenu', 'onselectstart', 'ondragstart'
  ];
  const hookedIframes = new WeakSet();

  function injectStyle(doc) {
    // 样式由隔离世界通过 chrome.scripting.insertCSS 注入，避免在页面 MAIN world
    // 创建 <style> 或写入 textContent 时触发站点 CSP: style-src 'self' / 禁止 inline style。
    try {
      if (doc && doc.documentElement) {
        doc.documentElement.setAttribute('data-mouse-unlock-style-managed', 'extension-css');
      }
    } catch (e) { /* ignore */ }
  }

  function clearNodeHandlers(el) {
    if (!el || el.nodeType !== 1) return;
    if (!window.__mouseGestureUnlockActive) return;
    try {
      for (let i = 0; i < ATTR_HANDLERS.length; i++) {
        const a = ATTR_HANDLERS[i];
        try {
          el[a] = null;
        } catch (err) { /* ignore */ }
        try {
          el.removeAttribute(a);
        } catch (err2) { /* ignore */ }
      }
      const st = el.style;
      if (st) {
        if (st.userSelect === 'none' || st.webkitUserSelect === 'none') {
          st.removeProperty('user-select');
          st.removeProperty('-webkit-user-select');
        }
      }
    } catch (e) { /* ignore */ }
  }

  function walkAndUnlock(root) {
    if (!root || !window.__mouseGestureUnlockActive) return;
    try {
      clearNodeHandlers(root);
      const tree = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (let i = 0; i < tree.length; i++) {
        const n = tree[i];
        clearNodeHandlers(n);
        const sr = n.shadowRoot;
        if (sr) walkAndUnlock(sr);
      }
    } catch (e) { /* cross-origin shadow etc. */ }
  }

  function hookIframe(iframe) {
    if (!iframe || iframe.tagName !== 'IFRAME') return;
    if (hookedIframes.has(iframe)) return;
    hookedIframes.add(iframe);
    const run = () => {
      if (!window.__mouseGestureUnlockActive) return;
      try {
        const d = iframe.contentDocument;
        if (d) {
          injectStyle(d);
          walkAndUnlock(d);
        }
      } catch (e) { /* cross-origin */ }
    };
    try {
      iframe.addEventListener('load', run);
    } catch (e) { /* ignore */ }
    run();
  }

  function scanIframes(root) {
    if (!root || !root.querySelectorAll) return;
    let list;
    try {
      list = root.querySelectorAll('iframe');
    } catch (e) {
      return;
    }
    for (let i = 0; i < list.length; i++) hookIframe(list[i]);
  }

  function targetIsContentEditable(ev) {
    try {
      let el = ev.target;
      if (!el) return false;
      if (el.nodeType === 3) el = el.parentElement;
      return !!(el && typeof el.isContentEditable === 'boolean' && el.isContentEditable);
    } catch (err) {
      return false;
    }
  }

  try {
    const origPD = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function () {
      if (!window.__mouseGestureUnlockActive) {
        return origPD.call(this);
      }
      const t = this.type;
      if ((t === 'paste' || t === 'cut') && targetIsContentEditable(this)) {
        return origPD.call(this);
      }
      if (
        t === 'contextmenu' ||
        t === 'copy' ||
        t === 'paste' ||
        t === 'cut' ||
        t === 'selectstart' ||
        t === 'dragstart'
      ) {
        return;
      }
      return origPD.call(this);
    };
  } catch (e) { /* ignore */ }

  try {
    const origAE = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (!window.__mouseGestureUnlockActive) {
        return origAE.call(this, type, listener, options);
      }
      const tn = String(type).toLowerCase();
      if (tn === 'visibilitychange' || tn === 'webkitvisibilitychange') {
        if (this === document) return;
      }
      if (
        tn === 'blur' ||
        tn === 'focus' ||
        tn === 'pagehide' ||
        tn === 'freeze' ||
        tn === 'unload' ||
        tn === 'beforeunload'
      ) {
        if (
          this === window ||
          this === globalThis ||
          this === document ||
          this === document.body ||
          this === document.documentElement
        ) return;
      }
      return origAE.call(this, type, listener, options);
    };
  } catch (e) { /* ignore */ }

  try {
    const origHiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    const origVisibilityDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(Document.prototype, 'hidden', {
      configurable: true,
      enumerable: true,
      get: function () {
        if (!window.__mouseGestureUnlockActive) {
          try {
            return origHiddenDesc && origHiddenDesc.get
              ? origHiddenDesc.get.call(this)
              : false;
          } catch (e) {
            return false;
          }
        }
        return false;
      }
    });
  } catch (e) { /* ignore */ }
  try {
    Object.defineProperty(Document.prototype, 'visibilityState', {
      configurable: true,
      enumerable: true,
      get: function () {
        if (!window.__mouseGestureUnlockActive) {
          try {
            return origVisibilityDesc && origVisibilityDesc.get
              ? origVisibilityDesc.get.call(this)
              : 'visible';
          } catch (e) {
            return 'visible';
          }
        }
        return 'visible';
      }
    });
  } catch (e) { /* ignore */ }

  try {
    const odp = Object.defineProperty;
    Object.defineProperty = function (obj, prop, desc) {
      if (window.__mouseGestureUnlockActive) {
        try {
          if (obj === document && (prop === 'hidden' || prop === 'visibilityState')) {
            return obj;
          }
        } catch (e2) { /* ignore */ }
      }
      return odp.call(this, obj, prop, desc);
    };
  } catch (e) { /* ignore */ }

  injectStyle(document);
  walkAndUnlock(document.documentElement);
  scanIframes(document);

  try {
    const mo = new MutationObserver((mutations) => {
      if (!window.__mouseGestureUnlockActive) return;
      for (let m = 0; m < mutations.length; m++) {
        const mu = mutations[m];
        if (mu.type === 'childList') {
          for (let i = 0; i < mu.addedNodes.length; i++) {
            const n = mu.addedNodes[i];
            if (n.nodeType === 1) {
              clearNodeHandlers(n);
              walkAndUnlock(n);
              if (n.tagName === 'IFRAME') hookIframe(n);
              scanIframes(n);
              const sr = n.shadowRoot;
              if (sr) {
                injectStyle(sr.ownerDocument);
                walkAndUnlock(sr);
                scanIframes(sr);
              }
            }
          }
        } else if (mu.type === 'attributes' && mu.target && mu.target.nodeType === 1) {
          clearNodeHandlers(mu.target);
        }
      }
    });
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ATTR_HANDLERS
    });
  } catch (e) { /* ignore */ }

  try {
    document.addEventListener('DOMContentLoaded', () => {
      walkAndUnlock(document.documentElement);
      scanIframes(document);
    });
  } catch (e) { /* ignore */ }
})();
