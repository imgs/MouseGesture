/* 尽早从 sync 读取主题供 early-splash.css 上色；设置页隐藏 ui-pending，侧栏外壳仅上色不隐藏 */
(function () {
  const root = document.documentElement;
  try {
    const uiLanguage = String(chrome.i18n.getUILanguage() || 'en').replace(/_/g, '-');
    root.lang = uiLanguage;
    root.dir = /^(ar|fa|he|ps|ur)(-|$)/i.test(uiLanguage) ? 'rtl' : 'ltr';
  } catch (e) { /* ignore */ }
  try {
    const params = new URLSearchParams(location.search);
    const surface = params.get('sidepanel') === '1'
      ? 'sidepanel'
      : params.get('options') === '1'
        ? 'options'
        : params.get('detached') === '1'
          ? 'detached'
          : '';
    if (surface) root.dataset.settingsSurface = surface;
  } catch (e) { /* ignore */ }
  const isSidePanelShell = /sidepanel\.html$/i.test(location.pathname || '');
  if (!isSidePanelShell) {
    root.classList.add('ui-pending');
  }
  try {
    const cached = localStorage.getItem('mg_theme');
    if (cached === 'dark' || cached === 'light') {
      root.setAttribute('data-theme', cached);
    }
    const cachedFontSize = localStorage.getItem('mg_settings_font_size');
    if (cachedFontSize === 'small' || cachedFontSize === 'normal' || cachedFontSize === 'large') {
      root.setAttribute('data-settings-font-size', cachedFontSize);
    }
  } catch (e) { /* ignore */ }
  try {
    chrome.storage.sync.get({ theme: 'light', settingsFontSize: 'normal' }, function (items) {
      const theme = items.theme || 'light';
      const fontSize = ['small', 'normal', 'large'].includes(items.settingsFontSize)
        ? items.settingsFontSize
        : 'normal';
      root.setAttribute('data-theme', theme);
      root.setAttribute('data-settings-font-size', fontSize);
      try {
        localStorage.setItem('mg_theme', theme);
        localStorage.setItem('mg_settings_font_size', fontSize);
      } catch (e) { /* ignore */ }
    });
  } catch (e) { /* ignore */ }
})();
