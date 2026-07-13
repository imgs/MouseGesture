(function () {
  'use strict';

  const titleEl = document.getElementById('title');
  const metaEl = document.getElementById('meta');
  const emptyEl = document.getElementById('empty');
  const errEl = document.getElementById('err');
  const gridEl = document.getElementById('grid');
  const btnClose = document.getElementById('btn-close');
  const btnClear = document.getElementById('btn-clear');

  function t(name, fallback) {
    try {
      const msg = chrome.i18n.getMessage(name);
      return msg || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'message_failed'));
          return;
        }
        if (!res || res.success !== true) {
          reject(new Error((res && res.error) || 'message_failed'));
          return;
        }
        resolve(res);
      });
    });
  }

  function modeLabel(mode) {
    const map = {
      viewport: t('screenshotHistoryModeViewport', 'Visible area'),
      fullpage: t('screenshotHistoryModeFullPage', 'Full page'),
      region: t('screenshotHistoryModeRegion', 'Region'),
      scroll: t('screenshotHistoryModeScroll', 'Manual scroll'),
      unknown: t('screenshotHistoryModeUnknown', 'Screenshot')
    };
    return map[mode] || map.unknown;
  }

  function formatWhen(ts) {
    try {
      return new Date(ts).toLocaleString();
    } catch (e) {
      return '';
    }
  }

  function setError(text) {
    errEl.textContent = text || '';
    errEl.hidden = !text;
  }

  function renderList(items) {
    gridEl.innerHTML = '';
    const count = items.length;
    const countMsg = chrome.i18n.getMessage('screenshotHistoryCount', [String(count)]);
    metaEl.textContent = countMsg || count + ' items';
    btnClear.disabled = count === 0;
    emptyEl.hidden = count > 0;
    gridEl.hidden = count === 0;
    if (!count) return;

    items.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'history-card';
      card.tabIndex = 0;
      card.dataset.id = item.id;

      const img = document.createElement('img');
      img.className = 'history-card__thumb';
      img.alt = '';
      img.loading = 'lazy';
      img.src = item.thumbDataUrl || '';

      const body = document.createElement('div');
      body.className = 'history-card__body';

      const time = document.createElement('p');
      time.className = 'history-card__time';
      time.textContent = formatWhen(item.created);

      const heading = document.createElement('p');
      heading.className = 'history-card__title';
      heading.textContent = item.pageTitle || modeLabel(item.mode);
      heading.title = item.pageTitle || '';

      const sub = document.createElement('p');
      sub.className = 'history-card__meta';
      sub.textContent =
        modeLabel(item.mode) +
        ' · ' +
        (item.width | 0) +
        '×' +
        (item.height | 0);

      const btnPin = document.createElement('button');
      btnPin.type = 'button';
      btnPin.className = 'history-card__pin';
      btnPin.title = t('screenshotHistoryPinToPage', 'Pin to page');
      btnPin.setAttribute('aria-label', btnPin.title);
      btnPin.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" focusable="false" aria-hidden="true"><path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/></svg>';

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'history-card__delete';
      btnDel.title = t('screenshotHistoryDelete', 'Delete');
      btnDel.setAttribute('aria-label', btnDel.title);
      btnDel.textContent = '×';

      body.appendChild(time);
      body.appendChild(heading);
      body.appendChild(sub);
      card.appendChild(img);
      card.appendChild(body);
      card.appendChild(btnPin);
      card.appendChild(btnDel);
      gridEl.appendChild(card);

      function openItem() {
        sendMessage({
          action: 'openScreenshotHistoryItem',
          id: item.id
        }).catch((e) => {
          setError(
            (e && e.message) || t('screenshotPreviewLoadFailed', 'Could not open')
          );
        });
      }

      card.addEventListener('click', (e) => {
        if (
          e.target.closest('.history-card__delete') ||
          e.target.closest('.history-card__pin')
        ) {
          return;
        }
        openItem();
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openItem();
        }
      });
      btnPin.addEventListener('click', (e) => {
        e.stopPropagation();
        setError('');
        sendMessage({ action: 'pinScreenshotHistoryItem', id: item.id }).catch(
          (err) => {
            setError(
              (err && err.message) ||
                t('screenshotHistoryPinFailed', 'Could not pin to page')
            );
          }
        );
      });
      btnDel.addEventListener('click', (e) => {
        e.stopPropagation();
        sendMessage({ action: 'removeScreenshotHistoryItem', id: item.id })
          .then(loadHistory)
          .catch((err) => {
            setError((err && err.message) || t('screenshotFailed', 'Failed'));
          });
      });
    });
  }

  function loadHistory() {
    setError('');
    return sendMessage({ action: 'listScreenshotHistory' })
      .then((res) => {
        renderList(res.items || []);
      })
      .catch((e) => {
        setError((e && e.message) || t('screenshotPreviewLoadFailed', 'Load failed'));
        renderList([]);
      });
  }

  let reloadTimer = null;
  function scheduleReloadHistory() {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      loadHistory();
    }, 120);
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.screenshotHistoryRevision) return;
      scheduleReloadHistory();
    });
  } catch (e) {
    /* ignore */
  }

  titleEl.textContent = t('screenshotHistoryTitle', 'Screenshot history');
  document.title = titleEl.textContent;
  const uiLanguage = chrome.i18n.getUILanguage() || 'en';
  document.documentElement.lang = uiLanguage;
  document.documentElement.dir = /^(ar|fa|he|ps|ur)(-|_|$)/i.test(uiLanguage) ? 'rtl' : 'ltr';
  btnClose.textContent = t('screenshotPreviewClose', 'Close');
  btnClear.textContent = t('screenshotHistoryClearAll', 'Clear all');
  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) btnRefresh.textContent = t('refresh', 'Refresh');
  emptyEl.textContent = t('screenshotHistoryEmpty', 'No screenshots yet.');

  btnClose.addEventListener('click', () => window.close());
  btnClear.addEventListener('click', () => {
    if (!confirm(t('screenshotHistoryClearConfirm', 'Delete all screenshot history?'))) {
      return;
    }
    sendMessage({ action: 'clearScreenshotHistory' })
      .then(loadHistory)
      .catch((e) => {
        setError((e && e.message) || t('screenshotFailed', 'Failed'));
      });
  });

  loadHistory();
})();
