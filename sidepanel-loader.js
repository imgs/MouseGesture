(function () {
  const f = document.getElementById('settings-frame');
  if (!f || !chrome.runtime || !chrome.runtime.getURL) return;

  const settingsLabel = chrome.i18n.getMessage('settings') || 'Settings';
  document.title = settingsLabel;
  f.title = settingsLabel;
  const uiLanguage = chrome.i18n.getUILanguage() || 'en';
  document.documentElement.lang = uiLanguage;
  document.documentElement.dir = /^(ar|fa|he|ps|ur)(-|_|$)/i.test(uiLanguage) ? 'rtl' : 'ltr';

  const CLOSE_TYPE = '__mouseGestureCloseSidePanel__';

  /** 侧栏只使用专用 API 关闭；失败时保留侧栏，不调用通用窗口关闭。 */
  function closeExtensionSidePanel() {
    try {
      const ext = typeof browser !== 'undefined' ? browser : chrome;
      const sidebar = ext && ext.sidebarAction;
      if (sidebar && typeof sidebar.close === 'function') {
        const result = sidebar.close();
        if (result && typeof result.catch === 'function') result.catch(function () {});
        return;
      }
      const sp = ext && ext.sidePanel;
      if (sp && typeof sp.close === 'function') {
        chrome.windows.getCurrent(function (win) {
          if (!chrome.runtime.lastError && win && win.id != null) {
            sp.close({ windowId: win.id }).then(
              function () {},
              function () {}
            );
          }
        });
        return;
      }
    } catch (e) { /* ignore */ }
  }

  window.addEventListener('message', function (ev) {
    try {
      if (ev.source !== f.contentWindow) return;
      if (!ev.data || ev.data.type !== CLOSE_TYPE) return;
      closeExtensionSidePanel();
    } catch (e) { /* ignore */ }
  });

  /* src 已在 sidepanel.html 中静态指定，避免 JS 赋值前空 iframe 白屏 */
  if (!f.src || f.src === 'about:blank') {
    f.src = chrome.runtime.getURL('popup.html') + '?sidepanel=1';
  }

  /** 子页去掉 ui-pending 后再显示 iframe，避免加载期中间白块 */
  f.classList.add('settings-frame--booting');

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
      f.classList.remove('settings-frame--booting');
    });
  }

  f.addEventListener('load', showFrameWhenReady);
  setTimeout(function () {
    f.classList.remove('settings-frame--booting');
  }, 4500);
})();
