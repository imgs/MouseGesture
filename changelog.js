'use strict';

(function initializeChangelog() {
  const root = document.documentElement;
  const languageButtons = Array.from(document.querySelectorAll('[data-language]'));
  const languagePanels = Array.from(document.querySelectorAll('[data-language-panel]'));
  const versionElement = document.getElementById('current-version');
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let themeSetting = 'system';

  function normalizeLanguage(value) {
    return /^zh(?:[-_]|$)/i.test(String(value || '')) ? 'zh' : 'en';
  }

  function setLanguage(language) {
    const normalized = normalizeLanguage(language);
    root.lang = normalized === 'zh' ? 'zh-CN' : 'en';
    languagePanels.forEach((panel) => {
      panel.hidden = panel.dataset.languagePanel !== normalized;
    });
    languageButtons.forEach((button) => {
      button.setAttribute('aria-pressed', button.dataset.language === normalized ? 'true' : 'false');
    });
    document.querySelectorAll('[data-copy-zh][data-copy-en]').forEach((element) => {
      element.textContent = element.dataset[normalized === 'zh' ? 'copyZh' : 'copyEn'];
    });
    document.title = normalized === 'zh' ? '更新日志' : 'Changelog';
    try {
      window.sessionStorage.setItem('mouseChangelogLanguage', normalized);
    } catch (_) { /* ignore */ }
  }

  function applyTheme() {
    const dark = themeSetting === 'dark' || (themeSetting !== 'light' && media.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
  }

  languageButtons.forEach((button) => {
    button.addEventListener('click', () => setLanguage(button.dataset.language));
  });
  media.addEventListener?.('change', applyTheme);

  let savedLanguage = '';
  try {
    savedLanguage = window.sessionStorage.getItem('mouseChangelogLanguage') || '';
  } catch (_) { /* ignore */ }

  const runtime = globalThis.chrome?.runtime;
  if (runtime?.getManifest && versionElement) {
    versionElement.textContent = `v${runtime.getManifest().version}`;
  }

  const storage = globalThis.chrome?.storage;
  if (storage?.sync) {
    storage.sync.get({ language: '', theme: 'system' }, (items) => {
      themeSetting = items.theme || 'system';
      applyTheme();
      setLanguage(savedLanguage || items.language || globalThis.chrome?.i18n?.getUILanguage?.() || navigator.language);
    });
    storage.onChanged?.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes.theme) {
        themeSetting = changes.theme.newValue || 'system';
        applyTheme();
      }
    });
  } else {
    applyTheme();
    setLanguage(savedLanguage || navigator.language);
  }
})();
