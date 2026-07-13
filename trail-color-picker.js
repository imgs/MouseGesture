/**
 * 轨迹/标注颜色拾取面板（预设、HEX、最近色、可选吸管）
 */
(function (global) {
  'use strict';

  /** 手势轨迹 / 标注常用预设（5×2，共 10 色）；首色为默认轨迹色 */
  const DEFAULT_PRESETS = [
    '#FF9ECD',
    '#FF6B6B',
    '#FF8E53',
    '#FFD93D',
    '#6BCB77',
    '#26C6DA',
    '#4D96FF',
    '#9B59B6',
    '#E91E63',
    '#37474F'
  ];

  const DEFAULT_TRAIL_COLOR = DEFAULT_PRESETS[0];

  const RECENT_KEY = 'trailColorRecent';
  const RECENT_MAX = 10;

  function msg(name, fallback) {
    try {
      const m = chrome.i18n.getMessage(name);
      return m || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function normalizeHex(value) {
    if (!value || typeof value !== 'string') return null;
    let s = value.trim();
    if (!s.startsWith('#')) s = '#' + s;
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      return (
        '#' +
        s[1] + s[1] +
        s[2] + s[2] +
        s[3] + s[3]
      ).toUpperCase();
    }
    return null;
  }

  function readRecent(callback) {
    try {
      chrome.storage.local.get({ [RECENT_KEY]: [] }, (items) => {
        const list = Array.isArray(items[RECENT_KEY]) ? items[RECENT_KEY] : [];
        callback(
          list
            .map(normalizeHex)
            .filter(Boolean)
            .slice(0, RECENT_MAX)
        );
      });
    } catch (e) {
      callback([]);
    }
  }

  function pushRecent(hex) {
    const color = normalizeHex(hex);
    if (!color) return;
    readRecent((list) => {
      const next = [color, ...list.filter((c) => c !== color)].slice(0, RECENT_MAX);
      try {
        chrome.storage.local.set({ [RECENT_KEY]: next });
      } catch (e) { /* ignore */ }
    });
  }

  /**
   * @param {HTMLElement} mountEl
   * @param {object} opts
   * @param {string} [opts.initialColor]
   * @param {string[]} [opts.presets]
   * @param {boolean} [opts.showEyedropper]
   * @param {boolean} [opts.showSyncToTrail]
   * @param {boolean} [opts.syncToTrailDefault]
   * @param {(hex: string, meta: { fromEyedropper?: boolean, syncTrail?: boolean }) => void} [opts.onChange]
   * @param {(clientX: number, clientY: number) => string|null} [opts.sampleColorAt]
   * @param {(clientX: number, clientY: number) => { centerHex: string|null, size: number, colors: (string|null)[] }|null} [opts.sampleMagnifierAt]
   * @param {(active: boolean) => void} [opts.onEyedropperActiveChange]
   */
  function mount(mountEl, opts) {
    opts = opts || {};
    const presets = (opts.presets && opts.presets.length) ? opts.presets.map(normalizeHex).filter(Boolean) : DEFAULT_PRESETS.slice();
    let current = normalizeHex(opts.initialColor) || presets[0] || '#FF9ECD';
    let panelOpen = false;
    let eyedropperActive = false;
    let recent = [];
    const MAG_CELL_DEFAULT = 10;
    const MAG_CELL_MIN = 6;
    const MAG_CELL_MAX = 36;
    const MAG_CELL_STEP = 2;
    let magCellPx = MAG_CELL_DEFAULT;
    let magnifierUi = null;
    let reticleUi = null;
    let magnifierRaf = 0;
    let magnifierPending = null;

    function getMagZoomPercent() {
      return Math.round((magCellPx / MAG_CELL_DEFAULT) * 100);
    }

    function clampMagCellPx(v) {
      return Math.max(MAG_CELL_MIN, Math.min(MAG_CELL_MAX, v));
    }

    function updateMagnifierZoomLabel() {
      if (!magnifierUi || !magnifierUi.zoomEl) return;
      magnifierUi.zoomEl.textContent = getMagZoomPercent() + '%';
    }

    const root = document.createElement('div');
    root.className = 'trail-color-picker';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'trail-color-trigger';
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    const swatch = document.createElement('span');
    swatch.className = 'trail-color-swatch';
    trigger.appendChild(swatch);

    const panel = document.createElement('div');
    panel.className = 'trail-color-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', msg('trailColor', 'Trail color'));

    const presetTitle = document.createElement('p');
    presetTitle.className = 'trail-color-section-title';
    presetTitle.textContent = msg('trailColorPickerPresets', 'Presets');
    panel.appendChild(presetTitle);

    const presetGrid = document.createElement('div');
    presetGrid.className = 'trail-color-presets';
    panel.appendChild(presetGrid);

    const recentTitle = document.createElement('p');
    recentTitle.className = 'trail-color-section-title';
    recentTitle.textContent = msg('trailColorPickerRecent', 'Recent');
    panel.appendChild(recentTitle);

    const recentGrid = document.createElement('div');
    recentGrid.className = 'trail-color-recent';
    recentGrid.hidden = true;
    panel.appendChild(recentGrid);

    const customRow = document.createElement('div');
    customRow.className = 'trail-color-custom';
    const nativeInput = document.createElement('input');
    nativeInput.type = 'color';
    nativeInput.className = 'trail-color-native';
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'trail-color-hex';
    hexInput.maxLength = 7;
    hexInput.spellcheck = false;
    hexInput.autocomplete = 'off';
    hexInput.placeholder = '#RRGGBB';
    customRow.appendChild(nativeInput);
    customRow.appendChild(hexInput);
    panel.appendChild(customRow);

    const actions = document.createElement('div');
    actions.className = 'trail-color-actions';
    let eyedropBtn = null;
    if (opts.showEyedropper && typeof opts.sampleColorAt === 'function') {
      eyedropBtn = document.createElement('button');
      eyedropBtn.type = 'button';
      eyedropBtn.className = 'trail-color-action-btn';
      eyedropBtn.textContent = msg('trailColorPickerEyedropper', 'Pick from image');
      actions.appendChild(eyedropBtn);
    }
    if (actions.childElementCount) panel.appendChild(actions);

    let syncLabel = null;
    let syncCheckbox = null;
    if (opts.showSyncToTrail) {
      syncLabel = document.createElement('label');
      syncLabel.className = 'trail-color-sync';
      syncCheckbox = document.createElement('input');
      syncCheckbox.type = 'checkbox';
      syncCheckbox.checked = opts.syncToTrailDefault === true;
      syncLabel.appendChild(syncCheckbox);
      syncLabel.appendChild(
        document.createTextNode(msg('trailColorPickerSyncTrail', 'Save as trail color'))
      );
      panel.appendChild(syncLabel);
    }

    root.appendChild(trigger);
    root.appendChild(panel);
    mountEl.innerHTML = '';
    mountEl.appendChild(root);

    function updateSwatch(hex) {
      swatch.style.backgroundColor = hex;
      trigger.title = hex;
    }

    function highlightPresets(hex) {
      root.querySelectorAll('.trail-color-preset').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.color === hex);
      });
    }

    function buildPresetButtons(container, colors) {
      container.innerHTML = '';
      colors.forEach((hex) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'trail-color-preset';
        btn.dataset.color = hex;
        btn.style.backgroundColor = hex;
        btn.title = hex;
        btn.addEventListener('click', () => applyColor(hex, { fromPreset: true }));
        container.appendChild(btn);
      });
    }

    function renderPresets() {
      buildPresetButtons(presetGrid, presets);
      highlightPresets(current);
    }

    function renderRecent() {
      if (!recent.length) {
        recentGrid.hidden = true;
        recentTitle.hidden = true;
        return;
      }
      recentTitle.hidden = false;
      recentGrid.hidden = false;
      buildPresetButtons(recentGrid, recent);
      highlightPresets(current);
    }

    function syncInputs(hex) {
      current = hex;
      updateSwatch(hex);
      if (nativeInput.value !== hex) nativeInput.value = hex;
      /* 正在编辑 HEX 时不改写输入框，避免打断输入 */
      if (document.activeElement !== hexInput && hexInput.value !== hex) {
        hexInput.value = hex;
      }
      hexInput.classList.remove('invalid');
      highlightPresets(hex);
    }

    /** 输入过程中仅预览色块，不提交、不改写 HEX 文本 */
    function previewHexInput() {
      const raw = hexInput.value;
      const n = normalizeHex(raw);
      if (n) {
        hexInput.classList.remove('invalid');
        updateSwatch(n);
        highlightPresets(n);
        return;
      }
      if (raw.length >= 4) hexInput.classList.add('invalid');
      else hexInput.classList.remove('invalid');
    }

    function emitChange(hex, extra) {
      if (opts.onChange) {
        opts.onChange(hex, {
          syncTrail: syncCheckbox ? syncCheckbox.checked : true,
          ...(extra || {})
        });
      }
    }

    function applyColor(hex, meta) {
      meta = meta || {};
      const normalized = normalizeHex(hex);
      if (!normalized) return;
      syncInputs(normalized);
      pushRecent(normalized);
      readRecent((list) => {
        recent = list;
        renderRecent();
      });
      emitChange(normalized, meta);
      if (!meta.keepPanelOpen && (meta.fromPreset || meta.fromEyedropper || meta.closePanel)) {
        setPanelOpen(false);
      }
    }

    let ignoreOutsideUntil = 0;

    function isPickerTarget(target) {
      if (!target || !(target instanceof Node)) return false;
      return root.contains(target) || panel.contains(target);
    }

    const VIEWPORT_EDGE_PAD = 10;

    function getFloatingPanelMaxSize() {
      const pad = VIEWPORT_EDGE_PAD;
      return {
        maxW: Math.max(160, window.innerWidth - pad * 2),
        maxH: Math.max(160, window.innerHeight - pad * 2)
      };
    }

    function applyFloatingPanelBounds() {
      const { maxW, maxH } = getFloatingPanelMaxSize();
      panel.style.transform = 'none';
      panel.style.maxWidth = maxW + 'px';
      panel.style.maxHeight = maxH + 'px';
    }

    function clearFloatingPanelBounds() {
      panel.style.transform = '';
      panel.style.maxWidth = '';
      panel.style.maxHeight = '';
    }

    function positionFloatingPanel() {
      const rect = trigger.getBoundingClientRect();
      const gap = 6;
      const pad = VIEWPORT_EDGE_PAD;
      const { maxW, maxH } = getFloatingPanelMaxSize();
      panel.hidden = false;
      applyFloatingPanelBounds();
      const panelW = Math.min(panel.offsetWidth || 196, maxW);
      const panelH = Math.min(panel.offsetHeight || 220, maxH);
      let top = rect.bottom + gap;
      let left = rect.left;
      if (top + panelH > window.innerHeight - pad) {
        top = Math.max(pad, rect.top - panelH - gap);
      }
      left = Math.max(pad, Math.min(left, window.innerWidth - panelW - pad));
      top = Math.max(pad, Math.min(top, window.innerHeight - panelH - pad));
      panel.style.top = top + 'px';
      panel.style.left = left + 'px';
      panel.style.bottom = '';
      /* 浮动层只用 inline top/left；align-up 的 bottom 会与 fixed 定位冲突 */
      panel.classList.remove('align-up');
    }

    function setPanelOpen(open) {
      panelOpen = open;
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        panel.classList.add('is-floating');
        if (panel.parentNode !== document.body) {
          document.body.appendChild(panel);
        }
        panel.hidden = false;
        positionFloatingPanel();
        requestAnimationFrame(() => {
          if (!panelOpen) return;
          positionFloatingPanel();
        });
        ignoreOutsideUntil = Date.now() + 320;
      } else {
        panel.hidden = true;
        panel.classList.remove('is-floating', 'align-up');
        panel.style.top = '';
        panel.style.left = '';
        panel.style.bottom = '';
        clearFloatingPanelBounds();
        if (panel.parentNode !== root) {
          root.appendChild(panel);
        }
      }
    }

    function ensureReticleUi() {
      if (reticleUi || typeof opts.sampleMagnifierAt !== 'function') return reticleUi;
      const el = document.createElement('div');
      el.className = 'trail-color-eyedropper-reticle';
      el.setAttribute('role', 'presentation');
      const hLine = document.createElement('div');
      hLine.className = 'trail-color-reticle-h';
      const vLine = document.createElement('div');
      vLine.className = 'trail-color-reticle-v';
      const dot = document.createElement('div');
      dot.className = 'trail-color-reticle-dot';
      el.appendChild(hLine);
      el.appendChild(vLine);
      el.appendChild(dot);
      document.body.appendChild(el);
      reticleUi = { el };
      return reticleUi;
    }

    function updateReticle(clientX, clientY) {
      const ui = ensureReticleUi();
      if (!ui) return;
      ui.el.style.setProperty('--rx', clientX + 'px');
      ui.el.style.setProperty('--ry', clientY + 'px');
      ui.el.classList.add('is-visible');
    }

    function hideReticle() {
      if (reticleUi) reticleUi.el.classList.remove('is-visible');
    }

    function destroyReticleUi() {
      hideReticle();
      if (reticleUi && reticleUi.el.parentNode) {
        reticleUi.el.parentNode.removeChild(reticleUi.el);
      }
      reticleUi = null;
    }

    function ensureMagnifierUi() {
      if (magnifierUi || typeof opts.sampleMagnifierAt !== 'function') return magnifierUi;
      const el = document.createElement('div');
      el.className = 'trail-color-magnifier';
      el.setAttribute('role', 'presentation');
      el.hidden = true;
      const wrap = document.createElement('div');
      wrap.className = 'trail-color-magnifier-view';
      const gridCanvas = document.createElement('canvas');
      gridCanvas.className = 'trail-color-magnifier-canvas';
      const zoomEl = document.createElement('div');
      zoomEl.className = 'trail-color-magnifier-zoom';
      zoomEl.textContent = getMagZoomPercent() + '%';
      const hexEl = document.createElement('div');
      hexEl.className = 'trail-color-magnifier-hex';
      wrap.appendChild(gridCanvas);
      el.appendChild(zoomEl);
      el.appendChild(wrap);
      el.appendChild(hexEl);
      document.body.appendChild(el);
      magnifierUi = {
        el,
        wrap,
        gridCanvas,
        zoomEl,
        hexEl,
        ctx: gridCanvas.getContext('2d')
      };
      return magnifierUi;
    }

    function hideMagnifier() {
      if (magnifierUi) magnifierUi.el.hidden = true;
      magnifierPending = null;
      if (magnifierRaf) {
        cancelAnimationFrame(magnifierRaf);
        magnifierRaf = 0;
      }
    }

    function destroyMagnifierUi() {
      hideMagnifier();
      destroyReticleUi();
      if (magnifierUi && magnifierUi.el.parentNode) {
        magnifierUi.el.parentNode.removeChild(magnifierUi.el);
      }
      magnifierUi = null;
    }

    /** 倍镜中心格对准采样点（与十字准线交点一致） */
    function positionMagnifier(clientX, clientY) {
      if (!magnifierUi) return;
      const el = magnifierUi.el;
      const wrap = magnifierUi.wrap;
      const canvas = magnifierUi.gridCanvas;
      const pad = 8;
      el.hidden = false;
      const canvasW = canvas.offsetWidth || canvas.width;
      const canvasH = canvas.offsetHeight || canvas.height;
      const centerOffsetX = wrap.offsetLeft + canvasW / 2;
      const centerOffsetY = wrap.offsetTop + canvasH / 2;
      let left = clientX - centerOffsetX;
      let top = clientY - centerOffsetY;
      const w = el.offsetWidth || 130;
      const h = el.offsetHeight || 150;
      left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
      top = Math.max(pad, Math.min(top, window.innerHeight - h - pad));
      el.style.left = left + 'px';
      el.style.top = top + 'px';
    }

    function drawMagnifierGrid(data, clientX, clientY) {
      const ui = ensureMagnifierUi();
      if (!ui) return;
      const size = data.size || 11;
      const cell = magCellPx;
      const canvasPx = size * cell;
      if (ui.gridCanvas.width !== canvasPx) {
        ui.gridCanvas.width = canvasPx;
        ui.gridCanvas.height = canvasPx;
      }
      const ctx = ui.ctx;
      const center = Math.floor(size / 2);
      const colors = data.colors || [];
      for (let gy = 0; gy < size; gy++) {
        for (let gx = 0; gx < size; gx++) {
          const hex = colors[gy * size + gx];
          const x = gx * cell;
          const y = gy * cell;
          if (hex) {
            ctx.fillStyle = hex;
            ctx.fillRect(x, y, cell, cell);
          } else {
            ctx.fillStyle = (gx + gy) % 2 ? '#2e2e3a' : '#22222c';
            ctx.fillRect(x, y, cell, cell);
          }
          if (gx === center && gy === center) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
            ctx.strokeStyle = 'rgba(0,0,0,0.85)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
          }
        }
      }
      const mid = center * cell + cell / 2;
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(mid, 0);
      ctx.lineTo(mid, canvasPx);
      ctx.moveTo(0, mid);
      ctx.lineTo(canvasPx, mid);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mid, 0);
      ctx.lineTo(mid, canvasPx);
      ctx.moveTo(0, mid);
      ctx.lineTo(canvasPx, mid);
      ctx.stroke();
      ctx.restore();
      ui.hexEl.textContent = data.centerHex || '—';
      updateMagnifierZoomLabel();
      ui.el.hidden = false;
      positionMagnifier(clientX, clientY);
    }

    function updateMagnifier(clientX, clientY) {
      if (!eyedropperActive || typeof opts.sampleMagnifierAt !== 'function') {
        hideMagnifier();
        return;
      }
      const data = opts.sampleMagnifierAt(clientX, clientY);
      if (!data) {
        hideMagnifier();
        return;
      }
      drawMagnifierGrid(data, clientX, clientY);
    }

    function scheduleMagnifierUpdate(clientX, clientY) {
      magnifierPending = { x: clientX, y: clientY };
      if (magnifierRaf) return;
      magnifierRaf = requestAnimationFrame(() => {
        magnifierRaf = 0;
        if (!magnifierPending) return;
        updateMagnifier(magnifierPending.x, magnifierPending.y);
      });
    }

    function setEyedropperActive(active) {
      eyedropperActive = active;
      if (active) {
        magCellPx = MAG_CELL_DEFAULT;
        updateMagnifierZoomLabel();
      } else {
        hideMagnifier();
        hideReticle();
      }
      if (eyedropBtn) {
        eyedropBtn.classList.toggle('active', active);
        eyedropBtn.textContent = active
          ? msg('trailColorPickerEyedropperActive', 'Click to pick · Wheel zoom')
          : msg('trailColorPickerEyedropper', 'Pick from image');
      }
      if (opts.onEyedropperActiveChange) opts.onEyedropperActiveChange(active);
    }

    trigger.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (root.classList.contains('is-disabled')) return;
      setPanelOpen(!panelOpen);
    });

    nativeInput.addEventListener('input', () => {
      applyColor(nativeInput.value, { keepPanelOpen: true });
    });
    nativeInput.addEventListener('change', () => {
      applyColor(nativeInput.value, { closePanel: true });
    });

    hexInput.addEventListener('input', previewHexInput);

    hexInput.addEventListener('blur', () => {
      const n = normalizeHex(hexInput.value);
      if (n) applyColor(n, { closePanel: true });
      else {
        hexInput.value = current;
        updateSwatch(current);
        highlightPresets(current);
      }
      hexInput.classList.remove('invalid');
    });

    hexInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        hexInput.blur();
        setPanelOpen(false);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setPanelOpen(false);
      }
    });

    if (eyedropBtn) {
      eyedropBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setEyedropperActive(!eyedropperActive);
        if (eyedropperActive) setPanelOpen(false);
      });
    }

    if (syncCheckbox) {
      syncCheckbox.addEventListener('change', () => {
        emitChange(current, {
          syncToggle: true,
          syncTrail: syncCheckbox.checked
        });
      });
    }

    function trySampleEyedropperAt(clientX, clientY) {
      if (!eyedropperActive || !opts.sampleColorAt) return false;
      const hex = opts.sampleColorAt(clientX, clientY);
      if (!hex) return false;
      applyColor(hex, { fromEyedropper: true });
      setEyedropperActive(false);
      setPanelOpen(false);
      return true;
    }

    function onDocumentPointerDown(e) {
      if (Date.now() < ignoreOutsideUntil) return;
      if (isPickerTarget(e.target)) return;

      if (eyedropperActive) {
        if (e.button === 0 && trySampleEyedropperAt(e.clientX, e.clientY)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      if (!panelOpen) return;
      setPanelOpen(false);
    }

    function onDocumentPointerMove(e) {
      if (!eyedropperActive) return;
      updateReticle(e.clientX, e.clientY);
      scheduleMagnifierUpdate(e.clientX, e.clientY);
    }

    function onDocumentKeyDown(e) {
      if (!eyedropperActive) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setEyedropperActive(false);
      }
    }

    function onDocumentWheel(e) {
      if (!eyedropperActive || typeof opts.sampleMagnifierAt !== 'function') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const delta = e.deltaY > 0 ? -MAG_CELL_STEP : MAG_CELL_STEP;
      const next = clampMagCellPx(magCellPx + delta);
      if (next === magCellPx) return;
      magCellPx = next;
      updateMagnifierZoomLabel();
      if (magnifierPending) {
        updateMagnifier(magnifierPending.x, magnifierPending.y);
      }
    }

    function onWindowResize() {
      if (panelOpen) positionFloatingPanel();
      if (eyedropperActive && magnifierPending) {
        updateMagnifier(magnifierPending.x, magnifierPending.y);
      }
    }

    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('pointermove', onDocumentPointerMove, true);
    document.addEventListener('wheel', onDocumentWheel, { capture: true, passive: false });
    document.addEventListener('keydown', onDocumentKeyDown, true);
    window.addEventListener('resize', onWindowResize);

    readRecent((list) => {
      recent = list;
      renderRecent();
    });
    renderPresets();
    syncInputs(current);

    return {
      getValue() {
        return current;
      },
      setValue(hex) {
        const n = normalizeHex(hex);
        if (n) syncInputs(n);
      },
      setDisabled(disabled) {
        root.classList.toggle('is-disabled', !!disabled);
        trigger.disabled = !!disabled;
        if (disabled) {
          setPanelOpen(false);
          setEyedropperActive(false);
        }
      },
      isEyedropperActive() {
        return eyedropperActive;
      },
      closePanel() {
        setPanelOpen(false);
        setEyedropperActive(false);
      },
      destroy() {
        document.removeEventListener('pointerdown', onDocumentPointerDown, true);
        document.removeEventListener('pointermove', onDocumentPointerMove, true);
        document.removeEventListener('wheel', onDocumentWheel, true);
        document.removeEventListener('keydown', onDocumentKeyDown, true);
        window.removeEventListener('resize', onWindowResize);
        setPanelOpen(false);
        destroyMagnifierUi();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  global.TrailColorPicker = {
    normalizeHex,
    mount,
    DEFAULT_PRESETS,
    DEFAULT_TRAIL_COLOR
  };
})(typeof window !== 'undefined' ? window : globalThis);
