(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const key = params.get('key') || '';
  const sourceTabIdParam = parseInt(params.get('sourceTabId') || '', 10);
  const sourceTabId = Number.isFinite(sourceTabIdParam) && sourceTabIdParam > 0 ? sourceTabIdParam : null;
  const errEl = document.getElementById('err');
  const metaEl = document.getElementById('meta');
  const titleEl = document.getElementById('title');
  const btnClose = document.getElementById('btn-close');
  const btnViewHistory = document.getElementById('btn-view-history');
  const btnCopy = document.getElementById('btn-copy');
  const btnPin = document.getElementById('btn-pin');
  const btnSave = document.getElementById('btn-save');
  const btnReset = document.getElementById('btn-reset');
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  const historyStepsEl = document.getElementById('history-steps');
  const zoomLevelEl = document.getElementById('zoom-level');
  const btnZoomFit = document.getElementById('btn-zoom-fit');
  const btnZoomOne = document.getElementById('btn-zoom-1');
  const toolbar = document.getElementById('toolbar');
  const viewport = document.getElementById('viewport');
  const stageWrap = document.getElementById('stage-wrap');
  const stage = document.getElementById('stage');
  const baseCanvas = document.getElementById('canvas-base');
  const inkCanvas = document.getElementById('canvas-ink');
  const strokeColorPickerMount = document.getElementById('stroke-color-picker-mount');
  const strokeSize = document.getElementById('stroke-size');
  const sizeLabel = document.getElementById('size-label');
  const sizeValue = document.getElementById('size-value');
  const toolBtns = document.querySelectorAll('.tool-btn');
  const cropActions = document.getElementById('crop-actions');
  const btnCropApply = document.getElementById('btn-crop-apply');
  const btnCropCancel = document.getElementById('btn-crop-cancel');
  const stampStartWrap = document.getElementById('stamp-start-wrap');
  const stampStartLabel = document.getElementById('stamp-start-label');
  const stampStartInput = document.getElementById('stamp-start');

  const t = window.ScreenshotPreviewEditor
    ? window.ScreenshotPreviewEditor.t
    : (name, fb) => fb;

  let editor = null;
  let strokeColorPickerApi = null;
  const DEFAULT_TRAIL_COLOR = '#FF9ECD';
  const ZOOM_MIN = 0.08;
  const ZOOM_MAX = 12;
  const WHEEL_ZOOM_IN = 1.12;
  const WHEEL_ZOOM_OUT = 1 / WHEEL_ZOOM_IN;
  /** 与 background.js computeScreenshotPreviewWindowSize 最小宽度一致 */
  const PREVIEW_WINDOW_MIN_OUTER_W = 925;

  let imageNaturalW = 0;
  let imageNaturalH = 0;
  let displayScale = 1;
  /** @type {'fit'|'oneone'|'custom'} */
  let zoomMode = 'fit';
  let fitResizeTimer = null;
  let panState = null;

  function normalizeHexColor(value) {
    if (!value || typeof value !== 'string') return null;
    const s = value.trim();
    if (!/^#/.test(s)) return null;
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    }
    return null;
  }

  function getTrailColorFromSettings(callback) {
    try {
      chrome.storage.sync.get({ trailColor: DEFAULT_TRAIL_COLOR }, (items) => {
        callback(normalizeHexColor(items && items.trailColor) || DEFAULT_TRAIL_COLOR);
      });
    } catch (e) {
      callback(DEFAULT_TRAIL_COLOR);
    }
  }

  function applyAnnotColorUi(hex) {
    const color = normalizeHexColor(hex) || DEFAULT_TRAIL_COLOR;
    document.documentElement.style.setProperty('--stroke-color', color);
    if (strokeColorPickerApi) strokeColorPickerApi.setValue(color);
    return color;
  }

  function persistTrailColor(hex) {
    const color = normalizeHexColor(hex);
    if (!color) return;
    try {
      chrome.storage.sync.set({ trailColor: color });
    } catch (e) { /* ignore */ }
  }

  /** 预览改色；syncTrail 为 true 时写回全局轨迹颜色 */
  function setPreviewStrokeColor(hex, opts) {
    const color = applyAnnotColorUi(hex);
    if (editor) editor.setColor(color);
    if (!opts || opts.syncTrail !== false) {
      persistTrailColor(color);
    }
    return color;
  }

  function rgbaToHex(r, g, b) {
    return (
      '#' +
      [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
    );
  }

  const EYEDROPPER_GRID = 11;
  const EYEDROPPER_RADIUS = (EYEDROPPER_GRID - 1) >> 1;
  const eyedropperCtxFallback = { base: null, ink: null };

  function getEyedropperContexts() {
    if (editor && editor.baseCtx && editor.inkCtx) {
      return { base: editor.baseCtx, ink: editor.inkCtx };
    }
    if (baseCanvas && !eyedropperCtxFallback.base) {
      eyedropperCtxFallback.base = baseCanvas.getContext('2d', {
        willReadFrequently: true
      });
    }
    if (inkCanvas && !eyedropperCtxFallback.ink) {
      eyedropperCtxFallback.ink = inkCanvas.getContext('2d', {
        willReadFrequently: true
      });
    }
    return eyedropperCtxFallback;
  }

  function rgbaToHexFromPixel(px) {
    if (!px || px.a < 8) return null;
    return rgbaToHex(px.r, px.g, px.b);
  }

  function normalizeSampledHex(raw) {
    return raw && window.TrailColorPicker
      ? window.TrailColorPicker.normalizeHex(raw)
      : null;
  }

  /** 读取与画布相交的矩形区域（单次 getImageData） */
  function readCanvasRegion(ctx, canvas, x0, y0, w, h) {
    if (!ctx || !canvas || canvas.width < 1 || canvas.height < 1) return null;
    const cx0 = Math.max(0, x0);
    const cy0 = Math.max(0, y0);
    const cx1 = Math.min(canvas.width, x0 + w);
    const cy1 = Math.min(canvas.height, y0 + h);
    const rw = cx1 - cx0;
    const rh = cy1 - cy0;
    if (rw < 1 || rh < 1) return null;
    try {
      const imageData = ctx.getImageData(cx0, cy0, rw, rh);
      return {
        data: imageData.data,
        w: rw,
        h: rh,
        x0: cx0,
        y0: cy0
      };
    } catch (e) {
      return null;
    }
  }

  function getPixelFromRegion(region, cx, cy) {
    if (!region) return null;
    const lx = cx - region.x0;
    const ly = cy - region.y0;
    if (lx < 0 || ly < 0 || lx >= region.w || ly >= region.h) return null;
    const i = (ly * region.w + lx) * 4;
    const d = region.data;
    return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
  }

  function compositeHexFromRegions(baseRegion, inkRegion, cx, cy) {
    const inkPx = getPixelFromRegion(inkRegion, cx, cy);
    if (inkPx && inkPx.a >= 8) {
      return normalizeSampledHex(rgbaToHexFromPixel(inkPx));
    }
    const basePx = getPixelFromRegion(baseRegion, cx, cy);
    return normalizeSampledHex(rgbaToHexFromPixel(basePx));
  }

  function mapClientToCanvasPixel(clientX, clientY) {
    if (!baseCanvas) return null;
    const cw = baseCanvas.width;
    const ch = baseCanvas.height;
    if (cw < 1 || ch < 1) return null;
    const rect = baseCanvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }
    const x = Math.floor(((clientX - rect.left) / rect.width) * cw);
    const y = Math.floor(((clientY - rect.top) / rect.height) * ch);
    if (x < 0 || y < 0 || x >= cw || y >= ch) return null;
    return { x, y, cw, ch };
  }

  function sampleColorFromPreviewCanvas(clientX, clientY) {
    const pos = mapClientToCanvasPixel(clientX, clientY);
    if (!pos) return null;
    const ctxs = getEyedropperContexts();
    const inkRegion = readCanvasRegion(ctxs.ink, inkCanvas, pos.x, pos.y, 1, 1);
    const baseRegion = readCanvasRegion(ctxs.base, baseCanvas, pos.x, pos.y, 1, 1);
    return compositeHexFromRegions(baseRegion, inkRegion, pos.x, pos.y);
  }

  function sampleMagnifierFromPreviewCanvas(clientX, clientY) {
    const pos = mapClientToCanvasPixel(clientX, clientY);
    if (!pos) return null;
    const ctxs = getEyedropperContexts();
    const x0 = pos.x - EYEDROPPER_RADIUS;
    const y0 = pos.y - EYEDROPPER_RADIUS;
    const inkRegion = readCanvasRegion(
      ctxs.ink,
      inkCanvas,
      x0,
      y0,
      EYEDROPPER_GRID,
      EYEDROPPER_GRID
    );
    const baseRegion = readCanvasRegion(
      ctxs.base,
      baseCanvas,
      x0,
      y0,
      EYEDROPPER_GRID,
      EYEDROPPER_GRID
    );
    const colors = [];
    let centerHex = null;
    for (let gy = 0; gy < EYEDROPPER_GRID; gy++) {
      for (let gx = 0; gx < EYEDROPPER_GRID; gx++) {
        const cx = pos.x + (gx - EYEDROPPER_RADIUS);
        const cy = pos.y + (gy - EYEDROPPER_RADIUS);
        if (cx < 0 || cy < 0 || cx >= pos.cw || cy >= pos.ch) {
          colors.push(null);
          continue;
        }
        const hex = compositeHexFromRegions(baseRegion, inkRegion, cx, cy);
        colors.push(hex);
        if (gx === EYEDROPPER_RADIUS && gy === EYEDROPPER_RADIUS) {
          centerHex = hex;
        }
      }
    }
    return {
      centerHex: centerHex || sampleColorFromPreviewCanvas(clientX, clientY),
      size: EYEDROPPER_GRID,
      colors
    };
  }

  function updateSizeSliderFill() {
    if (!strokeSize) return;
    const min = Number(strokeSize.min) || 1;
    const max = Number(strokeSize.max) || 48;
    const val = Number(strokeSize.value);
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
    strokeSize.style.setProperty('--range-pct', pct + '%');
  }

  if (strokeColorPickerMount && window.TrailColorPicker) {
    if (strokeColorPickerMount.getAttribute('data-i18n-title')) {
      strokeColorPickerMount.title = t(
        strokeColorPickerMount.getAttribute('data-i18n-title'),
        'Trail color'
      );
    }
    strokeColorPickerApi = window.TrailColorPicker.mount(strokeColorPickerMount, {
      initialColor: DEFAULT_TRAIL_COLOR,
      showEyedropper: true,
      showSyncToTrail: true,
      syncToTrailDefault: false,
      sampleColorAt: sampleColorFromPreviewCanvas,
      sampleMagnifierAt: sampleMagnifierFromPreviewCanvas,
      onChange(hex, meta) {
        setPreviewStrokeColor(hex, { syncTrail: meta.syncTrail !== false });
      },
      onEyedropperActiveChange(active) {
        if (viewport) viewport.classList.toggle('eyedropper-mode', !!active);
      }
    });
  }

  getTrailColorFromSettings((hex) => {
    setPreviewStrokeColor(hex, { syncTrail: false });
    updateSizeSliderFill();
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes.trailColor) return;
      setPreviewStrokeColor(changes.trailColor.newValue, { syncTrail: false });
    });
  } catch (e) { /* ignore */ }

  titleEl.textContent = t('screenshotPreviewTitle', 'Screenshot preview');
  document.title = titleEl.textContent;
  const uiLanguage = chrome.i18n.getUILanguage() || 'en';
  document.documentElement.lang = uiLanguage;
  document.documentElement.dir = /^(ar|fa|he|ps|ur)(-|_|$)/i.test(uiLanguage) ? 'rtl' : 'ltr';
  btnClose.textContent = t('screenshotPreviewClose', 'Close');
  if (btnViewHistory) {
    btnViewHistory.textContent = t('screenshotHistoryView', 'View history');
  }
  btnCopy.textContent = t('screenshotPreviewCopyAgain', 'Copy');
  if (btnPin) {
    btnPin.textContent = t('screenshotPreviewPinToPage', 'Pin to page');
    const pinTitle = btnPin.getAttribute('data-i18n-title');
    btnPin.title = t(pinTitle || 'screenshotPreviewPinToPage', 'Pin screenshot on the page');
  }
  btnSave.textContent = t('screenshotPreviewSave', 'Save as file');
  if (btnReset) {
    const resetKey = btnReset.getAttribute('data-i18n-title');
    btnReset.title = t(resetKey || 'screenshotAnnotResetAll', 'Reset all edits');
  }
  btnUndo.title = t('screenshotAnnotUndo', 'Undo');
  btnRedo.title = t('screenshotAnnotRedo', 'Redo');
  if (sizeLabel) sizeLabel.textContent = t('screenshotAnnotSize', 'Size');
  if (btnZoomFit) {
    btnZoomFit.textContent = t('screenshotPreviewZoomFit', 'Fit');
    btnZoomFit.title = t('screenshotPreviewZoomFitTitle', 'Fit image to window');
  }
  if (btnZoomOne) {
    btnZoomOne.textContent = t('screenshotPreviewZoomOneToOne', '1:1');
    btnZoomOne.title = t(
      'screenshotPreviewZoomOneToOneTitle',
      'Actual size (one screen pixel per image pixel)'
    );
  }
  if (btnCropApply) {
    btnCropApply.textContent = t('screenshotAnnotCropApply', 'Apply crop');
  }
  if (btnCropCancel) {
    btnCropCancel.textContent = t('screenshotAnnotCropCancel', 'Cancel');
  }
  if (stampStartLabel) {
    stampStartLabel.textContent = t('screenshotAnnotStampStart', 'Start #');
  }

  /* 预览「序号」工具：画布标注用，与页面「贴图 N」编号无关（见 screenshot-pins.js） */

  function formatStampStartInputTitle() {
    if (!editor) return '';
    const next = editor.stampCounter;
    try {
      const msg = chrome.i18n.getMessage('screenshotAnnotStampNext', [String(next)]);
      if (msg) return msg;
    } catch (e) { /* ignore */ }
    return 'Next #' + next;
  }

  function syncStampStartInputDisplay() {
    if (!editor || !stampStartInput) return;
    stampStartInput.value = String(editor.getStampStart());
    if (stampStartWrap) {
      stampStartWrap.title = formatStampStartInputTitle();
    }
  }

  function updateStampStartVisibility(tool) {
    if (!stampStartWrap) return;
    const show = tool === 'number';
    stampStartWrap.hidden = !show;
    if (show) syncStampStartInputDisplay();
  }

  function syncStampStartFromInput() {
    if (!editor || !stampStartInput) return;
    editor.setStampStart(stampStartInput.value);
    syncStampStartInputDisplay();
  }

  function isHandToolActive() {
    return editor && editor.tool === 'hand';
  }

  function updatePanToolCursor() {
    if (!viewport) return;
    viewport.classList.toggle('pan-tool', isHandToolActive());
    if (!isHandToolActive()) viewport.classList.remove('pan-dragging');
  }

  function endViewportPan(e) {
    if (!panState) return;
    if (e && e.pointerId != null && panState.id !== e.pointerId) return;
    panState = null;
    if (viewport) viewport.classList.remove('pan-dragging');
  }

  function updateSizeValueDisplay() {
    if (sizeValue && strokeSize) sizeValue.textContent = strokeSize.value;
    updateSizeSliderFill();
  }
  updateSizeValueDisplay();

  toolBtns.forEach((btn) => {
    const k = btn.getAttribute('data-i18n-title');
    if (k) btn.title = t(k, btn.title || '');
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    const key = element.getAttribute('data-i18n-aria-label');
    if (key) element.setAttribute('aria-label', t(key, element.getAttribute('aria-label') || ''));
  });

  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
    stageWrap.hidden = true;
    toolbar.hidden = true;
  }

  function cleanupStorage() {
    if (!key || key.indexOf('screenshotHist_') === 0) return;
    try {
      chrome.runtime.sendMessage({ action: 'clearScreenshotPreview', key });
    } catch (e) { /* ignore */ }
  }

  function loadPreviewImageDataUrl(storageKey, onDone) {
    let attempt = 0;
    const maxAttempts = 40;

    function tryLoad() {
      attempt += 1;
      try {
        chrome.runtime.sendMessage(
          { action: 'getScreenshotPreview', key: storageKey },
          (res) => {
            if (chrome.runtime.lastError) {
              if (attempt < maxAttempts) {
                setTimeout(tryLoad, 100);
                return;
              }
              onDone(null);
              return;
            }
            if (res && res.success && res.dataUrl) {
              onDone(res.dataUrl);
              return;
            }
            if (res && res.error === 'unauthorized') {
              onDone(null);
              return;
            }
            if (attempt < maxAttempts) {
              setTimeout(tryLoad, 150);
              return;
            }
            onDone(null);
          }
        );
      } catch (e) {
        onDone(null);
      }
    }

    tryLoad();
  }

  function formatHistorySteps(current, total) {
    try {
      const msg = chrome.i18n.getMessage('screenshotAnnotStepCount', [
        String(current),
        String(total)
      ]);
      if (msg) return msg;
    } catch (e) { /* ignore */ }
    return current + ' / ' + total;
  }

  function updateHistoryStepDisplay() {
    if (!historyStepsEl || !editor || !editor.history) return;
    const current = Math.max(0, editor.historyIndex);
    const total = Math.max(0, editor.history.length - 1);
    historyStepsEl.textContent = formatHistorySteps(current, total);
    historyStepsEl.title = t(
      'screenshotAnnotStepCountTitle',
      'Edit steps applied / total edit steps (0 means original image)'
    );
  }

  function updateHistoryButtons(canUndo, canRedo) {
    const canReset = editor && typeof editor.canReset === 'function' ? editor.canReset() : canUndo;
    if (btnReset) btnReset.disabled = !canReset;
    btnUndo.disabled = !canUndo;
    btnRedo.disabled = !canRedo;
    updateHistoryStepDisplay();
    if (stampStartWrap && !stampStartWrap.hidden) {
      syncStampStartInputDisplay();
    }
  }

  function applyPreviewCanvasDisplaySize(displayW, displayH) {
    const w = displayW + 'px';
    const h = displayH + 'px';
    baseCanvas.style.width = w;
    baseCanvas.style.height = h;
    inkCanvas.style.width = w;
    inkCanvas.style.height = h;
  }

  function clampDisplayScale(scale) {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
  }

  function updateZoomLevelDisplay() {
    if (!zoomLevelEl) return;
    const pct = Math.round(displayScale * 100);
    zoomLevelEl.textContent = pct + '%';
    try {
      const msg = chrome.i18n.getMessage('screenshotPreviewZoomLevel', [String(pct)]);
      zoomLevelEl.title = msg || pct + '%';
    } catch (e) {
      zoomLevelEl.title = pct + '%';
    }
    if (btnZoomFit) btnZoomFit.classList.toggle('active', zoomMode === 'fit');
    if (btnZoomOne) btnZoomOne.classList.toggle('active', zoomMode === 'oneone');
  }

  function applyDisplayScale(scale) {
    if (imageNaturalW < 1 || imageNaturalH < 1) return;
    displayScale = clampDisplayScale(scale);
    const displayW = Math.max(1, Math.round(imageNaturalW * displayScale));
    const displayH = Math.max(1, Math.round(imageNaturalH * displayScale));
    applyPreviewCanvasDisplaySize(displayW, displayH);
    updateZoomLevelDisplay();
  }

  function getPreviewMeasureOpts(useInner) {
    const topBar = document.querySelector('.top-bar');
    const vpPad = 16;
    const margin = 8;
    const topBarH = topBar ? topBar.offsetHeight : 42;
    const toolbarH = toolbar && !toolbar.hidden ? toolbar.offsetHeight : 0;
    const frameW = Math.max(0, window.outerWidth - window.innerWidth);
    const frameH = Math.max(0, window.outerHeight - window.innerHeight);
    const availW =
      window.screen && window.screen.availWidth ? window.screen.availWidth : 1920;
    const availH =
      window.screen && window.screen.availHeight ? window.screen.availHeight : 1080;
    return {
      topBarH,
      toolbarH,
      vpPad,
      margin,
      availW,
      availH,
      frameW,
      frameH,
      useInner: !!useInner
    };
  }

  function getFitDisplayScale() {
    if (imageNaturalW < 1 || imageNaturalH < 1) return 1;
    const size = measurePreviewDisplaySize(
      imageNaturalW,
      imageNaturalH,
      getPreviewMeasureOpts(true)
    );
    return size.displayW / imageNaturalW;
  }

  function zoomAtPoint(clientX, clientY, nextScale) {
    if (!viewport || imageNaturalW < 1) return;
    const vpRect = viewport.getBoundingClientRect();
    const oldW = stageWrap.offsetWidth;
    const oldH = stageWrap.offsetHeight;
    const ratioX =
      oldW > 0 ? (viewport.scrollLeft + clientX - vpRect.left) / oldW : 0.5;
    const ratioY =
      oldH > 0 ? (viewport.scrollTop + clientY - vpRect.top) / oldH : 0.5;
    zoomMode = 'custom';
    applyDisplayScale(nextScale);
    const newW = stageWrap.offsetWidth;
    const newH = stageWrap.offsetHeight;
    viewport.scrollLeft = Math.max(0, ratioX * newW - (clientX - vpRect.left));
    viewport.scrollTop = Math.max(0, ratioY * newH - (clientY - vpRect.top));
  }

  function setZoomToFit(resizeWindow) {
    zoomMode = 'fit';
    applyDisplayScale(getFitDisplayScale());
    if (resizeWindow) fitPreviewWindowToImage(false);
  }

  function setZoomToOneToOne() {
    zoomMode = 'oneone';
    applyDisplayScale(1);
    if (viewport) {
      viewport.scrollLeft = Math.max(0, (stageWrap.offsetWidth - viewport.clientWidth) / 2);
      viewport.scrollTop = Math.max(0, (stageWrap.offsetHeight - viewport.clientHeight) / 2);
    }
  }

  function measurePreviewDisplaySize(naturalW, naturalH, opts) {
    const topBarH = opts.topBarH;
    const toolbarH = opts.toolbarH;
    const vpPad = opts.vpPad;
    const margin = opts.margin;
    const availW = opts.availW;
    const availH = opts.availH;
    const frameW = opts.frameW;
    const frameH = opts.frameH;
    let maxImgW;
    let maxImgH;
    if (opts.useInner && window.innerWidth > 0 && window.innerHeight > 0) {
      maxImgW = window.innerWidth - vpPad;
      maxImgH = window.innerHeight - topBarH - toolbarH - vpPad;
    } else {
      maxImgW = availW - margin - frameW - vpPad;
      maxImgH = availH - margin - frameH - topBarH - toolbarH - vpPad;
    }
    const scale = Math.min(maxImgW / naturalW, maxImgH / naturalH, 1);
    return {
      displayW: Math.max(1, Math.floor(naturalW * scale)),
      displayH: Math.max(1, Math.floor(naturalH * scale))
    };
  }

  function fitPreviewWindowToImage(initialOpen) {
    if (imageNaturalW < 1 || imageNaturalH < 1) return;
    const measureOpts = getPreviewMeasureOpts(false);
    const vpPad = measureOpts.vpPad;
    const margin = measureOpts.margin;

    if (initialOpen !== false) {
      zoomMode = 'fit';
      applyDisplayScale(getFitDisplayScale());
    }

    const displayW = Math.max(1, Math.round(imageNaturalW * displayScale));
    const displayH = Math.max(1, Math.round(imageNaturalH * displayScale));
    const clientW = displayW + vpPad;
    const clientH = measureOpts.topBarH + measureOpts.toolbarH + vpPad + displayH;
    const outerW = Math.min(
      measureOpts.availW - margin,
      Math.max(PREVIEW_WINDOW_MIN_OUTER_W, clientW + measureOpts.frameW)
    );
    const outerH = Math.min(
      measureOpts.availH - margin,
      Math.max(360, clientH + measureOpts.frameH)
    );

    chrome.windows.getCurrent((win) => {
      if (chrome.runtime.lastError || !win || win.id == null) return;
      chrome.windows.update(win.id, { width: outerW, height: outerH }, () => {
        if (initialOpen === false) return;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (zoomMode === 'fit') {
              applyDisplayScale(getFitDisplayScale());
            }
          });
        });
      });
    });
  }

  function initEditor(img) {
    getTrailColorFromSettings((defaultColor) => {
      const color = normalizeHexColor(defaultColor) || DEFAULT_TRAIL_COLOR;
      editor = new window.ScreenshotPreviewEditor({
        stage,
        baseCanvas,
        inkCanvas,
        defaultColor: color,
        onHistoryChange: updateHistoryButtons,
        onCropApplied: (w, h) => {
          imageNaturalW = w;
          imageNaturalH = h;
          metaEl.textContent = `${w} × ${h}`;
          zoomMode = 'fit';
          requestAnimationFrame(() => fitPreviewWindowToImage(true));
        },
        onCropPendingChange: (pending) => {
          if (cropActions) cropActions.hidden = !pending;
        }
      });
      applyAnnotColorUi(color);
      editor.loadImage(img);
      if (stampStartInput) stampStartInput.value = '1';
      imageNaturalW = img.naturalWidth;
      imageNaturalH = img.naturalHeight;
      metaEl.textContent = `${imageNaturalW} × ${imageNaturalH}`;
      stageWrap.hidden = false;
      toolbar.hidden = false;
      btnCopy.hidden = false;
      if (btnPin) btnPin.hidden = false;
      btnSave.hidden = false;
      updateZoomLevelDisplay();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitPreviewWindowToImage(true);
        });
      });
    });
  }

  function screenshotFilename() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `screenshot-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
  }

  function flashButton(btn, okMsg, errMsg, defaultMsg) {
    const prev = btn.textContent;
    btn.textContent = okMsg;
    setTimeout(() => {
      btn.textContent = defaultMsg || prev;
    }, 1500);
  }

  btnClose.addEventListener('click', () => window.close());

  if (btnViewHistory) {
    btnViewHistory.addEventListener('click', () => {
      try {
        chrome.runtime.sendMessage({ action: 'openScreenshotHistory' }, () => {
          void chrome.runtime.lastError;
        });
      } catch (e) { /* ignore */ }
    });
  }

  if (btnZoomFit) {
    btnZoomFit.addEventListener('click', () => setZoomToFit(true));
  }
  if (btnZoomOne) {
    btnZoomOne.addEventListener('click', () => setZoomToOneToOne());
  }

  if (btnCropApply) {
    btnCropApply.addEventListener('click', () => {
      if (editor) editor.applyPendingCrop();
    });
  }
  if (btnCropCancel) {
    btnCropCancel.addEventListener('click', () => {
      if (editor) editor.cancelPendingCrop();
    });
  }

  if (viewport) {
    viewport.addEventListener(
      'pointerdown',
      (e) => {
        if (!isHandToolActive() || e.button !== 0) return;
        if (stageWrap && stageWrap.hidden) return;
        panState = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          scrollLeft: viewport.scrollLeft,
          scrollTop: viewport.scrollTop
        };
        viewport.classList.add('pan-dragging');
        try {
          viewport.setPointerCapture(e.pointerId);
        } catch (err) { /* ignore */ }
        e.preventDefault();
      },
      true
    );
    viewport.addEventListener(
      'pointermove',
      (e) => {
        if (!panState || panState.id !== e.pointerId) return;
        viewport.scrollLeft = panState.scrollLeft - (e.clientX - panState.x);
        viewport.scrollTop = panState.scrollTop - (e.clientY - panState.y);
        e.preventDefault();
      },
      true
    );
    viewport.addEventListener('pointerup', endViewportPan, true);
    viewport.addEventListener('pointercancel', endViewportPan, true);

    viewport.addEventListener(
      'wheel',
      (e) => {
        if (!editor || !stageWrap || stageWrap.hidden) return;
        e.preventDefault();
        if (isHandToolActive()) {
          viewport.scrollTop += e.deltaY;
          viewport.scrollLeft += e.deltaX;
          return;
        }
        const factor = e.deltaY > 0 ? WHEEL_ZOOM_OUT : WHEEL_ZOOM_IN;
        zoomAtPoint(e.clientX, e.clientY, displayScale * factor);
      },
      { passive: false }
    );
  }

  window.addEventListener('resize', () => {
    if (zoomMode !== 'fit' || imageNaturalW < 1) return;
    clearTimeout(fitResizeTimer);
    fitResizeTimer = setTimeout(() => {
      applyDisplayScale(getFitDisplayScale());
    }, 120);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (editor && editor.cancelTextInput()) return;
      window.close();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (editor) editor.undo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      if (editor) editor.redo();
    }
    if (e.key === '1' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = (e.target && e.target.tagName) || '';
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !(e.target && e.target.isContentEditable)) {
        e.preventDefault();
        setZoomToOneToOne();
      }
    }
    if (e.key === '0' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = (e.target && e.target.tagName) || '';
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !(e.target && e.target.isContentEditable)) {
        e.preventDefault();
        setZoomToFit(false);
      }
    }
    if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const tag = (e.target && e.target.tagName) || '';
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !(e.target && e.target.isContentEditable)) {
        const handBtn = document.querySelector('.tool-btn[data-tool="hand"]');
        if (handBtn) handBtn.click();
      }
    }
  });

  btnReset.addEventListener('click', () => editor && editor.resetAllEdits());
  btnUndo.addEventListener('click', () => editor && editor.undo());
  btnRedo.addEventListener('click', () => editor && editor.redo());

  toolBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      toolBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const tool = btn.getAttribute('data-tool');
      if (editor) editor.setTool(tool);
      updateStampStartVisibility(tool);
      updatePanToolCursor();
    });
  });

  if (stampStartInput) {
    stampStartInput.addEventListener('change', syncStampStartFromInput);
    stampStartInput.addEventListener('input', syncStampStartFromInput);
  }

  strokeSize.addEventListener('input', () => {
    updateSizeValueDisplay();
    if (editor) editor.setSize(Number(strokeSize.value));
  });

  btnCopy.addEventListener('click', async () => {
    if (!editor) return;
    if (editor.isTextInputActive()) editor.commitTextInput();
    try {
      const blob = await editor.getFlattenedBlob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      flashButton(
        btnCopy,
        t('screenshotCopied', 'Copied'),
        t('screenshotFailed', 'Failed'),
        t('screenshotPreviewCopyAgain', 'Copy')
      );
    } catch (e) {
      flashButton(
        btnCopy,
        t('screenshotFailed', 'Failed'),
        t('screenshotFailed', 'Failed'),
        t('screenshotPreviewCopyAgain', 'Copy')
      );
    }
  });

  const PIN_INLINE_MAX = 768 * 1024;
  const PIN_CHUNK_CHARS = 500000;

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('read_failed'));
      reader.readAsDataURL(blob);
    });
  }

  function sendRuntimeMessage(msg) {
    return new Promise((resolve, reject) => {
      try {
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
      } catch (e) {
        reject(e);
      }
    });
  }

  function uploadPinDataUrlChunked(pinKey, dataUrl, width, height) {
    const total = Math.ceil(dataUrl.length / PIN_CHUNK_CHARS);
    let chain = Promise.resolve();
    for (let i = 0; i < total; i++) {
      const idx = i;
      chain = chain.then(() =>
        sendRuntimeMessage({
          action: 'screenshotPinChunk',
          key: pinKey,
          previewKey: key,
          index: idx,
          total,
          chunk: dataUrl.slice(idx * PIN_CHUNK_CHARS, (idx + 1) * PIN_CHUNK_CHARS),
          width: idx === 0 ? width : 0,
          height: idx === 0 ? height : 0,
          closeTitle: t('screenshotPinClose', 'Remove pin'),
          resizeTitle: t('screenshotPinResize', 'Resize')
        })
      );
    }
    return chain;
  }

  async function pinFlattenedScreenshotToPage() {
    if (!editor) throw new Error('no_editor');
    if (editor.isTextInputActive()) editor.commitTextInput();
    const blob = await editor.getFlattenedBlob();
    const dataUrl = await blobToDataUrl(blob);
    const width = imageNaturalW || editor.getNaturalWidth?.() || 1;
    const height = imageNaturalH || editor.getNaturalHeight?.() || 1;
    const pinMeta = {
      previewKey: key,
      tabId: sourceTabId,
      width,
      height,
      closeTitle: t('screenshotPinClose', 'Remove pin'),
      resizeTitle: t('screenshotPinResize', 'Resize')
    };
    if (dataUrl.length <= PIN_INLINE_MAX) {
      await sendRuntimeMessage(
        Object.assign({ action: 'pinScreenshotToPage', dataUrl }, pinMeta)
      );
      return;
    }
    const pinKey = 'screenshotPin_' + Date.now();
    if (dataUrl.length <= PIN_INLINE_MAX * 12) {
      await sendRuntimeMessage(
        Object.assign(
          { action: 'screenshotPinUpload', key: pinKey, dataUrl },
          pinMeta
        )
      );
      await sendRuntimeMessage(
        Object.assign({ action: 'pinScreenshotToPage', key: pinKey }, pinMeta)
      );
      return;
    }
    await uploadPinDataUrlChunked(pinKey, dataUrl, width, height);
  }

  if (btnPin) {
    btnPin.addEventListener('click', async () => {
      const defaultLabel = t('screenshotPreviewPinToPage', 'Pin to page');
      const pinningLabel = t('screenshotPreviewPinning', 'Pinning…');
      btnPin.disabled = true;
      btnPin.textContent = pinningLabel;
      try {
        await pinFlattenedScreenshotToPage();
        flashButton(
          btnPin,
          t('screenshotPreviewPinned', 'Pinned'),
          t('screenshotFailed', 'Failed'),
          defaultLabel
        );
      } catch (e) {
        btnPin.textContent = t('screenshotFailed', 'Failed');
        setTimeout(() => {
          btnPin.textContent = defaultLabel;
        }, 1500);
      } finally {
        btnPin.disabled = false;
      }
    });
  }

  btnSave.addEventListener('click', async () => {
    if (!editor) return;
    if (editor.isTextInputActive()) editor.commitTextInput();
    const defaultLabel = t('screenshotPreviewSave', 'Save as file');
    try {
      const blob = await editor.getFlattenedBlob();
      const url = URL.createObjectURL(blob);
      const filename = screenshotFilename();
      await new Promise((resolve, reject) => {
        chrome.downloads.download(
          { url, filename, saveAs: true },
          (downloadId) => {
            if (chrome.runtime.lastError || downloadId === undefined) {
              URL.revokeObjectURL(url);
              reject(new Error(chrome.runtime.lastError?.message || 'download_failed'));
              return;
            }
            setTimeout(() => URL.revokeObjectURL(url), 120000);
            resolve(downloadId);
          }
        );
      });
      flashButton(btnSave, t('screenshotPreviewSaved', 'Saved'), t('screenshotFailed', 'Failed'), defaultLabel);
    } catch (e) {
      flashButton(btnSave, t('screenshotFailed', 'Failed'), t('screenshotFailed', 'Failed'), defaultLabel);
    }
  });

  if (!key) {
    showError(t('screenshotPreviewLoadFailed', 'Preview unavailable'));
    return;
  }

  loadPreviewImageDataUrl(key, (dataUrl) => {
    if (!dataUrl) {
      showError(t('screenshotPreviewLoadFailed', 'Preview unavailable'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (!window.ScreenshotPreviewEditor) {
        showError(t('screenshotPreviewLoadFailed', 'Preview unavailable'));
        return;
      }
      initEditor(img);
    };
    img.onerror = () => showError(t('screenshotPreviewLoadFailed', 'Preview unavailable'));
    img.src = dataUrl;
  });

  window.addEventListener('beforeunload', cleanupStorage);
})();
