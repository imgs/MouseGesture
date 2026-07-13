(function () {
  const f = document.getElementById('settings-frame');
  if (!f || !chrome.runtime || !chrome.runtime.getURL) return;

  const settingsLabel = chrome.i18n.getMessage('settings') || 'Settings';
  document.title = settingsLabel;
  f.title = settingsLabel;
  const uiLanguage = chrome.i18n.getUILanguage() || 'en';
  document.documentElement.lang = uiLanguage;
  document.documentElement.dir = /^(ar|fa|he|ps|ur)(-|_|$)/i.test(uiLanguage) ? 'rtl' : 'ltr';

  if (!f.src || f.src === 'about:blank') {
    f.src = chrome.runtime.getURL('popup.html') + '?options=1';
  }

  f.classList.add('settings-frame--booting');

  let frameResizeObserver = null;
  let frameMutationObserver = null;
  let frameResizeRaf = 0;

  function scheduleFrameHeightSync() {
    if (frameResizeRaf) return;
    frameResizeRaf = requestAnimationFrame(function () {
      frameResizeRaf = 0;
      try {
        const doc = f.contentDocument;
        const container = doc && doc.querySelector('.container');
        if (!doc || !container) return;
        const bounds = container.getBoundingClientRect();
        const contentHeight = Math.ceil(Math.max(
          container.scrollHeight,
          container.offsetHeight,
          bounds.bottom
        ));
        const nextHeight = Math.max(window.innerHeight || 0, contentHeight);
        const nextValue = nextHeight + 'px';
        if (f.style.height !== nextValue) f.style.height = nextValue;
      } catch (e) { /* ignore */ }
    });
  }

  function observeFrameHeight() {
    if (frameResizeObserver) frameResizeObserver.disconnect();
    if (frameMutationObserver) frameMutationObserver.disconnect();
    frameResizeObserver = null;
    frameMutationObserver = null;
    try {
      const doc = f.contentDocument;
      const container = doc && doc.querySelector('.container');
      if (!doc || !container) return;
      if (typeof ResizeObserver === 'function') {
        frameResizeObserver = new ResizeObserver(scheduleFrameHeightSync);
        frameResizeObserver.observe(container);
      }
      if (typeof MutationObserver === 'function') {
        frameMutationObserver = new MutationObserver(scheduleFrameHeightSync);
        frameMutationObserver.observe(container, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });
      }
      if (doc.fonts && doc.fonts.ready) {
        doc.fonts.ready.then(scheduleFrameHeightSync, function () {});
      }
      scheduleFrameHeightSync();
    } catch (e) { /* ignore */ }
  }

  function frameContentReady() {
    try {
      const win = f.contentWindow;
      if (!win || !win.location || !/\/popup\.html/i.test(win.location.pathname || '')) {
        return false;
      }
      const doc = f.contentDocument;
      if (!doc || !doc.documentElement) return false;
      if (doc.readyState === 'loading') return false;
      const el = doc.documentElement;
      if (el.classList.contains('ui-pending') || el.classList.contains('theme-pending')) {
        return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function showFrameWhenReady() {
    if (!frameContentReady()) {
      requestAnimationFrame(showFrameWhenReady);
      return;
    }
    requestAnimationFrame(function () {
      observeFrameHeight();
      f.classList.remove('settings-frame--booting');
    });
  }

  f.addEventListener('load', function () {
    observeFrameHeight();
    showFrameWhenReady();
  });
  window.addEventListener('resize', scheduleFrameHeightSync, { passive: true });
  setTimeout(function () {
    f.classList.remove('settings-frame--booting');
  }, 4500);
})();
