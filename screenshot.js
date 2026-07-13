/**
 * 截图模块：通过 background 的 captureVisibleTab 取图，在页面内合成后写入剪贴板。
 * 依赖：content 脚本环境中已加载 chrome.* API；手势轨迹坐标为顶层视口 client 坐标（由 content.js 转换后传入）。
 *
 * 能力说明：
 * - 轨迹选区：对当前可视区域截图后按轨迹点轴对齐包围盒裁剪；边距含轨迹线宽一半（与 options.trailPad 或默认 4px），覆盖实际笔划占用的区域。
 * - 可视 / 整屏视口：单帧当前标签可见区域（浏览器视口内容，非 OS 桌面）。
 * - 整页：自动分屏滚动拼接（重叠裁切，减轻漏截）。
 * - 滚动截屏：用户手动滚动页面，再次按快捷键或 Esc/Enter 结束并拼接。
 * - 按键选区：快捷键拖选矩形，松手后由 content 识别链接或截图（resolve { points }）。
 *
 * 限制：chrome://、部分扩展页等无法 capture；剪贴板写入依赖页面权限与用户手势上下文，少数站点可能失败。
 */
(function (global) {
  'use strict';

  const SCREENSHOT_HTML_NS = 'http://www.w3.org/1999/xhtml';

  function createScreenshotElement(tagName) {
    const tag = String(tagName || '').toLowerCase();
    let el = null;
    try {
      el = document.createElement(tagName);
    } catch (e) {
      el = null;
    }
    if (!isScreenshotElementUsable(el, tag)) {
      try {
        el = document.createElementNS(SCREENSHOT_HTML_NS, tagName);
      } catch (e) {
        el = null;
      }
    }
    if (!isScreenshotElementUsable(el, tag)) {
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

  function isScreenshotElementUsable(el, tag) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (tag === 'canvas') return typeof el.getContext === 'function';
    return !!el.style;
  }

  function nextFrames(n) {
    const k = Math.max(1, n | 0);
    let p = Promise.resolve();
    for (let i = 0; i < k; i++) {
      p = p.then(() => new Promise((r) => requestAnimationFrame(r)));
    }
    return p;
  }

  const OVERLAY_HIDE_EVENT = 'mouse-screenshot-hide-overlays';
  const OVERLAY_SHOW_EVENT = 'mouse-screenshot-show-overlays';
  const SCROLLBAR_HIDE_STYLE_ID = 'mouse-screenshot-hide-scrollbars-style';
  let screenshotCaptureSessionDepth = 0;
  let screenshotCaptureLeaseToken = null;
  let screenshotCaptureLeasePromise = null;
  /** beginScreenshotCaptureSession 已等待绘制后，下一次 capture 可跳过重复 wait */
  let screenshotSessionPaintPrimed = false;

  function sendScreenshotLeaseMessage(payload, isRetry) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          Object.assign({}, payload, screenshotLeaseFields()),
          (res) => {
            const le = chrome.runtime.lastError;
            if (le) {
              reject(new Error(le.message || 'lease_message_failed'));
              return;
            }
            if (!res || res.success !== true) {
              const errCode = res && res.error;
              if (!isRetry && errCode === 'no_screenshot_lease') {
                screenshotCaptureLeaseToken = null;
                acquireScreenshotCaptureLease({ force: true })
                  .then(() => sendScreenshotLeaseMessage(payload, true).then(resolve).catch(reject))
                  .catch(reject);
                return;
              }
              reject(new Error(errCode || 'lease_message_failed'));
              return;
            }
            resolve(res);
          }
        );
      } catch (e) {
        reject(e);
      }
    });
  }

  function acquireScreenshotCaptureLease(options) {
    const opts = options || {};
    if (screenshotCaptureLeaseToken && !opts.force) {
      return Promise.resolve(screenshotCaptureLeaseToken);
    }
    if (screenshotCaptureLeasePromise && !opts.force) {
      return screenshotCaptureLeasePromise;
    }
    screenshotCaptureLeasePromise = new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          { action: 'acquireScreenshotCaptureLease', prefetch: opts.prefetch === true },
          (resp) => {
          screenshotCaptureLeasePromise = null;
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'lease_failed'));
            return;
          }
          if (!resp || !resp.success || !resp.token) {
            reject(new Error((resp && resp.error) || 'lease_failed'));
            return;
          }
          screenshotCaptureLeaseToken = resp.token;
          resolve(resp.token);
        });
      } catch (e) {
        screenshotCaptureLeasePromise = null;
        reject(e);
      }
    });
    return screenshotCaptureLeasePromise;
  }

  function releaseScreenshotCaptureLease() {
    const token = screenshotCaptureLeaseToken;
    screenshotCaptureLeaseToken = null;
    if (!token) return;
    const send = () => {
      try {
        chrome.runtime.sendMessage({ action: 'releaseScreenshotCaptureLease', token }, () => {});
      } catch (e) { /* ignore */ }
    };
    global.requestIdleCallback(send, { timeout: 400 });
  }

  /** 在用户按下截图快捷键/手势前预取 lease，减少首帧等待（独立限流桶 :pf） */
  function prefetchCaptureLease() {
    if (screenshotCaptureLeaseToken || screenshotCaptureLeasePromise) return;
    acquireScreenshotCaptureLease({ prefetch: true }).catch(() => {});
  }

  function getScreenshotOverlayNonce() {
    return null;
  }

  function screenshotLeaseFields() {
    return screenshotCaptureLeaseToken
      ? { _screenshotLease: screenshotCaptureLeaseToken }
      : {};
  }

  function getScreenshotTargetDocument() {
    if (global.window !== global.window.top) {
      return document;
    }
    try {
      return (global.top && global.top.document) || document;
    } catch (e) {
      return document;
    }
  }

  /**
   * captureVisibleTab 尺寸对应浏览器标签顶层视口；content 里选区坐标已换算为 top 的 client 坐标，
   * 若在 iframe 内调用本模块，须用 top 的 innerWidth/Height 做 CSS→设备像素映射（如嵌入式播放器）。
   */
  function getTabViewportCssSize() {
    try {
      const tw = global.top;
      if (tw && typeof tw.innerWidth === 'number' && typeof tw.innerHeight === 'number') {
        return { w: tw.innerWidth, h: tw.innerHeight };
      }
    } catch (e) {
      /* cross-origin top */
    }
    return { w: global.innerWidth, h: global.innerHeight };
  }

  /**
   * 子 frame：将 captureVisibleTab 整页图裁到当前 iframe 在标签视口中的区域。
   * 顶层 frame：crop 为 null，坐标系为标签视口。
   */
  function getScreenshotCaptureFrameContext() {
    const tab = getTabViewportCssSize();
    const ctx = {
      tabViewW: tab.w,
      tabViewH: tab.h,
      crop: null,
      viewW: tab.w,
      viewH: tab.h
    };
    try {
      if (global.window !== global.window.top && global.frameElement) {
        const rect = global.frameElement.getBoundingClientRect();
        const x = Math.max(0, rect.left);
        const y = Math.max(0, rect.top);
        const w = Math.max(1, Math.min(rect.width, tab.w - x));
        const h = Math.max(1, Math.min(rect.height, tab.h - y));
        if (w >= 8 && h >= 8) {
          ctx.crop = { x, y, w, h };
          ctx.viewW = global.innerWidth;
          ctx.viewH = global.innerHeight;
        }
      }
    } catch (e) {
      /* 跨域 iframe 无法读取 frameElement */
    }
    return ctx;
  }

  function getFrameCropDeviceRect(img, frameCtx) {
    if (!frameCtx || !frameCtx.crop) {
      return {
        x: 0,
        y: 0,
        w: img.naturalWidth,
        h: img.naturalHeight
      };
    }
    return cssRectToDeviceRect(
      frameCtx.crop,
      img.naturalWidth,
      img.naturalHeight,
      frameCtx.tabViewW,
      frameCtx.tabViewH
    );
  }

  function cropLoadedImageToFrameCanvas(img, frameCtx) {
    const dr = getFrameCropDeviceRect(img, frameCtx);
    const out = createScreenshotElement('canvas');
    out.width = dr.w;
    out.height = dr.h;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, dr.x, dr.y, dr.w, dr.h, 0, 0, dr.w, dr.h);
    return out;
  }

  function captureVisibleCroppedCanvas() {
    const frameCtx = getScreenshotCaptureFrameContext();
    return captureVisibleForScreenshot()
      .then(loadImageFromDataUrl)
      .then((img) => cropLoadedImageToFrameCanvas(img, frameCtx));
  }

  /** 截图期间隐藏页面滚动条（避免 captureVisibleTab 拍到滚动条） */
  function injectScreenshotScrollbarHideStyle() {
    const doc = getScreenshotTargetDocument();
    if (doc.getElementById(SCROLLBAR_HIDE_STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = SCROLLBAR_HIDE_STYLE_ID;
    style.textContent = [
      'html, body, * {',
      '  scrollbar-width: none !important;',
      '  -ms-overflow-style: none !important;',
      '}'
    ].join('\n');
    (doc.head || doc.documentElement).appendChild(style);
  }

  function removeScreenshotScrollbarHideStyle() {
    const doc = getScreenshotTargetDocument();
    const el = doc.getElementById(SCROLLBAR_HIDE_STYLE_ID);
    if (el) el.remove();
  }

  /** 整次截图流程只隐藏/恢复一次，避免长图拼接时滚动条反复闪现 */
  function beginScreenshotCaptureSession() {
    screenshotCaptureSessionDepth += 1;
    if (screenshotCaptureSessionDepth > 1) {
      return waitForPaint(1, { settleMs: 24 });
    }
    return acquireScreenshotCaptureLease()
      .catch((err) => {
        screenshotCaptureSessionDepth -= 1;
        throw err;
      })
      .then(() => {
        dispatchScreenshotOverlayEvent(OVERLAY_HIDE_EVENT);
        injectScreenshotScrollbarHideStyle();
        return waitForPaint(2, { settleMs: 36, primeCapture: true });
      });
  }

  function endScreenshotCaptureSession() {
    if (screenshotCaptureSessionDepth <= 0) return;
    screenshotCaptureSessionDepth -= 1;
    if (screenshotCaptureSessionDepth > 0) return;
    screenshotSessionPaintPrimed = false;
    releaseScreenshotCaptureLease();
    removeScreenshotScrollbarHideStyle();
    dispatchScreenshotOverlayEvent(OVERLAY_SHOW_EVENT);
  }

  function runInScreenshotCaptureSession(work) {
    return beginScreenshotCaptureSession()
      .then(() => Promise.resolve(work()))
      .finally(() => {
        endScreenshotCaptureSession();
      });
  }

  function dispatchScreenshotOverlayEvent(name) {
    try {
      const action = name === OVERLAY_HIDE_EVENT ? 'screenshotOverlayHide' : 'screenshotOverlayShow';
      chrome.runtime.sendMessage({ action }, () => {});
    } catch (e) { /* ignore */ }
  }

  /** 单次可见区域抓取（需在 beginScreenshotCaptureSession 会话内调用） */
  function captureVisibleForScreenshot() {
    if (screenshotSessionPaintPrimed) {
      screenshotSessionPaintPrimed = false;
      return captureVisibleDataUrl();
    }
    return waitForPaint(1, { settleMs: 32, primeCapture: true }).then(() => captureVisibleDataUrl());
  }

  function captureVisibleDataUrl(isRetry) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          Object.assign({ action: 'captureVisibleTab' }, screenshotLeaseFields()),
          (resp) => {
          const le = chrome.runtime.lastError;
          if (le) {
            reject(new Error(le.message));
            return;
          }
          if (!resp || !resp.success || !resp.dataUrl) {
            const errCode = resp && resp.error;
            if (!isRetry && errCode === 'no_screenshot_lease') {
              screenshotCaptureLeaseToken = null;
              acquireScreenshotCaptureLease({ force: true })
                .then(() => captureVisibleDataUrl(true).then(resolve).catch(reject))
                .catch(reject);
              return;
            }
            reject(new Error(errCode || 'capture_failed'));
            return;
          }
          resolve(resp.dataUrl);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image_load_failed'));
      img.src = dataUrl;
    });
  }

  function dataUrlToCanvas(dataUrl) {
    return loadImageFromDataUrl(dataUrl).then((img) => {
      const c = createScreenshotElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return c;
    });
  }

  function bboxFromPoints(points, pad) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const x = p.x;
      const y = p.y;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const p = typeof pad === 'number' ? pad : 4;
    minX = Math.floor(minX - p);
    minY = Math.floor(minY - p);
    maxX = Math.ceil(maxX + p);
    maxY = Math.ceil(maxY + p);
    return {
      x: minX,
      y: minY,
      w: Math.max(1, maxX - minX),
      h: Math.max(1, maxY - minY)
    };
  }

  function clampRectToViewport(rect, viewW, viewH) {
    const x1 = Math.max(0, Math.min(rect.x, viewW - 1));
    const y1 = Math.max(0, Math.min(rect.y, viewH - 1));
    const x2 = Math.max(x1 + 1, Math.min(rect.x + rect.w, viewW));
    const y2 = Math.max(y1 + 1, Math.min(rect.y + rect.h, viewH));
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function cssRectToDeviceRect(rect, imgW, imgH, viewW, viewH) {
    const sx = imgW / Math.max(1, viewW);
    const sy = imgH / Math.max(1, viewH);
    return {
      x: Math.max(0, Math.floor(rect.x * sx)),
      y: Math.max(0, Math.floor(rect.y * sy)),
      w: Math.min(imgW, Math.ceil(rect.w * sx)),
      h: Math.min(imgH, Math.ceil(rect.h * sy))
    };
  }

  let shouldShowScreenshotPreview = () => true;
  let shouldCopyScreenshotToClipboard = () => false;
  /** 与弹窗「Save screenshot history」一致；关闭预览+剪贴板时仍可依此写入历史 */
  let shouldSaveScreenshotHistory = () => true;

  function setScreenshotPreviewChecker(fn) {
    shouldShowScreenshotPreview = typeof fn === 'function' ? fn : () => true;
  }

  function setScreenshotClipboardChecker(fn) {
    shouldCopyScreenshotToClipboard = typeof fn === 'function' ? fn : () => false;
  }

  function setScreenshotHistoryChecker(fn) {
    shouldSaveScreenshotHistory = typeof fn === 'function' ? fn : () => true;
  }

  const PREVIEW_TRANSFER_MAX_BYTES = 8 * 1024 * 1024;
  const PREVIEW_MAX_SIDE = 16384;
  const PREVIEW_INLINE_MAX = 768 * 1024;
  const PREVIEW_CHUNK_CHARS = 500000;

  function drawCanvasScaled(source, destW, destH) {
    const c = createScreenshotElement('canvas');
    c.width = Math.max(1, destW);
    c.height = Math.max(1, destH);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  /** 预览传输：优先无损 PNG（IndexedDB），仅在过大时再缩放或 JPEG */
  function buildPreviewTransfer(canvas) {
    const w = canvas.width;
    const h = canvas.height;
    if (w < 1 || h < 1) return null;

    const tryPng = (target) => {
      try {
        return target.toDataURL('image/png');
      } catch (e) {
        return null;
      }
    };

    const tryJpeg = (target, q) => {
      try {
        return target.toDataURL('image/jpeg', q);
      } catch (e) {
        return null;
      }
    };

    const fitSize = (url, tw, th) => {
      if (url && url.length <= PREVIEW_TRANSFER_MAX_BYTES) {
        return { dataUrl: url, width: tw, height: th };
      }
      return null;
    };

    let png = tryPng(canvas);
    let hit = fitSize(png, w, h);
    if (hit) return hit;

    let src = canvas;
    const maxSide = Math.max(w, h);
    if (maxSide > PREVIEW_MAX_SIDE) {
      const scale = PREVIEW_MAX_SIDE / maxSide;
      src = drawCanvasScaled(canvas, Math.floor(w * scale), Math.floor(h * scale));
      png = tryPng(src);
      hit = fitSize(png, src.width, src.height);
      if (hit) return hit;
    }

    const qualities = [0.92, 0.88, 0.82, 0.76, 0.66];
    for (const q of qualities) {
      const url = tryJpeg(src, q);
      hit = fitSize(url, src.width, src.height);
      if (hit) return hit;
    }

    for (let scale = 0.85; scale >= 0.4; scale *= 0.88) {
      const smaller = drawCanvasScaled(
        src,
        Math.max(1, Math.floor(src.width * scale)),
        Math.max(1, Math.floor(src.height * scale))
      );
      png = tryPng(smaller);
      hit = fitSize(png, smaller.width, smaller.height);
      if (hit) return hit;
      for (const q of qualities) {
        const url = tryJpeg(smaller, q);
        hit = fitSize(url, smaller.width, smaller.height);
        if (hit) return hit;
      }
    }
    return null;
  }

  function getScreenshotCaptureMeta(mode) {
    return {
      captureMode: mode || 'unknown',
      pageUrl: global.location && global.location.href ? String(global.location.href) : '',
      pageTitle: global.document && global.document.title ? String(global.document.title) : ''
    };
  }

  function sendRecordScreenshotHistoryMessage(payload) {
    return sendScreenshotLeaseMessage(Object.assign({ action: 'recordScreenshotHistory' }, payload));
  }

  function recordScreenshotHistoryFromCanvas(canvas, mode) {
    const transfer = buildPreviewTransfer(canvas);
    if (!transfer || !transfer.dataUrl) return Promise.resolve();
    return sendRecordScreenshotHistoryMessage(
      Object.assign(
        {
          dataUrl: transfer.dataUrl,
          width: transfer.width,
          height: transfer.height
        },
        getScreenshotCaptureMeta(mode)
      )
    ).catch(() => {});
  }

  function sendOpenScreenshotPreviewMessage(payload) {
    return sendScreenshotLeaseMessage(Object.assign({ action: 'openScreenshotPreview' }, payload));
  }

  function sendPreviewUploadMessage(msg) {
    return sendScreenshotLeaseMessage(msg);
  }

  function uploadPreviewDataUrlChunked(key, dataUrl, width, height, meta) {
    const metaFields = meta || {};
    const total = Math.ceil(dataUrl.length / PREVIEW_CHUNK_CHARS);
    let chain = Promise.resolve();
    for (let i = 0; i < total; i++) {
      const idx = i;
      chain = chain.then(() =>
        sendPreviewUploadMessage(
          Object.assign(
            {
              action: 'screenshotPreviewChunk',
              key,
              index: idx,
              total,
              chunk: dataUrl.slice(idx * PREVIEW_CHUNK_CHARS, (idx + 1) * PREVIEW_CHUNK_CHARS),
              width: idx === 0 ? width : 0,
              height: idx === 0 ? height : 0
            },
            metaFields
          )
        )
      );
    }
    return chain;
  }

  function openScreenshotPreviewWindow(canvas, mode) {
    /* 预览由 background 打开，iframe 内也需可走通（嵌入播放器上轨迹截图多在子 frame 完成） */
    if (!shouldShowScreenshotPreview()) return Promise.resolve();
    const transfer = buildPreviewTransfer(canvas);
    if (!transfer || !transfer.dataUrl) {
      return Promise.reject(new Error('preview_data_url_failed'));
    }
    const storageKey = 'screenshotPreview_' + Date.now();
    const base = Object.assign(
      {
        key: storageKey,
        width: transfer.width,
        height: transfer.height
      },
      getScreenshotCaptureMeta(mode)
    );
    if (transfer.dataUrl.length <= PREVIEW_INLINE_MAX) {
      return sendOpenScreenshotPreviewMessage(
        Object.assign({ dataUrl: transfer.dataUrl }, base)
      );
    }
    if (transfer.dataUrl.length <= PREVIEW_TRANSFER_MAX_BYTES) {
      return sendPreviewUploadMessage(
        Object.assign(
          { action: 'screenshotPreviewUpload', dataUrl: transfer.dataUrl },
          base
        )
      );
    }
    return uploadPreviewDataUrlChunked(
      storageKey,
      transfer.dataUrl,
      transfer.width,
      transfer.height,
      getScreenshotCaptureMeta(mode)
    );
  }

  function copyCanvasToClipboard(canvas, options) {
    const opts = options || {};
    const captureMode = opts.mode || 'unknown';
    const wantPreview =
      opts.showPreview !== false && shouldShowScreenshotPreview();
    const wantCopy =
      opts.copy !== false && shouldCopyScreenshotToClipboard();
    const wantHistory =
      opts.history !== false && shouldSaveScreenshotHistory();

    if (!wantCopy && !wantPreview && !wantHistory) {
      return Promise.resolve();
    }

    /** 开启预览时 background 在 openScreenshotPreviewWindowWithData 里已写历史，避免双份 */
    const historyP =
      wantPreview || !wantHistory
        ? Promise.resolve()
        : recordScreenshotHistoryFromCanvas(canvas, captureMode);

    if (!wantCopy) {
      const tasks = [historyP];
      if (wantPreview) {
        tasks.push(openScreenshotPreviewWindow(canvas, captureMode));
      }
      return Promise.all(tasks).then(() => {});
    }

    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            const fin = wantPreview
              ? openScreenshotPreviewWindow(canvas, captureMode).catch(() => {})
              : Promise.resolve();
            Promise.all([historyP, fin]).then(() => resolve());
            return;
          }
          const previewP = wantPreview
            ? openScreenshotPreviewWindow(canvas, captureMode).catch(() => {})
            : Promise.resolve();
          let copyP = Promise.resolve();
          try {
            if (
              typeof ClipboardItem === 'function' &&
              navigator.clipboard &&
              typeof navigator.clipboard.write === 'function'
            ) {
              const item = new ClipboardItem({ 'image/png': blob });
              copyP = navigator.clipboard.write([item]).catch(() => {});
            }
          } catch (e) { /* clipboard image writing is optional */ }
          Promise.all([historyP, previewP, copyP]).then(() => resolve());
        },
        'image/png',
        0.92
      );
    });
  }

  /**
   * 当前可视区域一帧截图 → 剪贴板
   */
  function captureViewportToClipboard() {
    return runInScreenshotCaptureSession(() =>
      captureVisibleCroppedCanvas().then((canvas) =>
        copyCanvasToClipboard(canvas, { mode: 'viewport' })
      )
    );
  }

  /**
   * 根据手势轨迹点的实际绘制区域（点集包围盒 + 边距）裁剪当前可视截图 → 剪贴板（点坐标为顶层视口 CSS 像素）
   * @param {Array<{x:number,y:number}>} points
   * @param {{ trailPad?: number }} [options] trailPad：轨迹线半宽等额外边距（CSS 像素），默认 4
   */
  function captureRegionFromPoints(points, options) {
    if (!points || points.length < 2) {
      return Promise.reject(new Error('need_trail_points'));
    }
    const frameCtx = getScreenshotCaptureFrameContext();
    const viewW = frameCtx.tabViewW;
    const viewH = frameCtx.tabViewH;
    const pad =
      options && typeof options.trailPad === 'number' && !Number.isNaN(options.trailPad)
        ? Math.max(0, options.trailPad)
        : 4;
    const cssBox = clampRectToViewport(bboxFromPoints(points, pad), viewW, viewH);
    return runInScreenshotCaptureSession(() =>
      captureVisibleForScreenshot()
        .then(loadImageFromDataUrl)
        .then((img) => {
          const dr = cssRectToDeviceRect(cssBox, img.naturalWidth, img.naturalHeight, viewW, viewH);
          const out = createScreenshotElement('canvas');
          out.width = dr.w;
          out.height = dr.h;
          const ctx = out.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, dr.x, dr.y, dr.w, dr.h, 0, 0, dr.w, dr.h);
          return copyCanvasToClipboard(out, { mode: 'region' });
        })
    );
  }

  const STITCH_OVERLAP = 0.12;
  const MANUAL_SCROLL_MIN_DELTA = 12;

  let manualScrollSession = null;

  function getScrollRootForScreenshot() {
    const docEl = document.scrollingElement || document.documentElement;
    const docScrollable = docEl.scrollHeight > docEl.clientHeight + 2;
    if (docScrollable && docEl.scrollHeight > global.innerHeight + 2) {
      return docEl;
    }
    let best = null;
    let maxArea = 0;
    const vw = global.innerWidth;
    try {
      const nodes = document.querySelectorAll('div, main, section, article');
      for (let i = 0; i < nodes.length && i < 400; i++) {
        const el = nodes[i];
        if (!el || el === document.body) continue;
        const sh = el.scrollHeight;
        const ch = el.clientHeight;
        if (sh <= ch + 2) continue;
        const st = global.getComputedStyle(el);
        const oy = st.overflowY;
        if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') continue;
        const rect = el.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area < maxArea) continue;
        const centerOff = Math.abs((rect.left + rect.right) / 2 - vw / 2);
        if (centerOff > vw * 0.35) continue;
        maxArea = area;
        best = el;
      }
    } catch (e) { /* ignore */ }
    return best || docEl;
  }

  function waitForPaint(frames, options) {
    const opts = options || {};
    const delayMs = typeof opts.settleMs === 'number' ? opts.settleMs : 80;
    const n = Math.max(0, frames | 0);
    const frameWait = n > 0 ? nextFrames(n) : Promise.resolve();
    return frameWait.then(
      () =>
        new Promise((r) => {
          if (delayMs <= 0) {
            r();
            return;
          }
          global.setTimeout(r, delayMs);
        })
    ).then(() => {
      if (opts.primeCapture) {
        screenshotSessionPaintPrimed = true;
      }
    });
  }

  function scrollRootTo(scrollEl, x, y) {
    const options = { left: x, top: y, behavior: 'instant' };
    const root = document.scrollingElement || document.documentElement;
    if (scrollEl === root || scrollEl === document.documentElement || scrollEl === document.body) {
      global.scrollTo(options);
    } else {
      scrollEl.scrollTo(options);
    }
  }

  function computeStitchScrollPositions(scrollEl, viewH) {
    const totalH = Math.max(scrollEl.scrollHeight, viewH);
    const maxScrollY = Math.max(0, totalH - viewH);
    if (maxScrollY <= 0) return [0];
    const step = Math.max(1, Math.floor(viewH * (1 - STITCH_OVERLAP)));
    const ys = [0];
    let y = 0;
    while (y < maxScrollY - 1) {
      y = Math.min(y + step, maxScrollY);
      if (y > ys[ys.length - 1]) ys.push(y);
    }
    if (ys[ys.length - 1] !== maxScrollY) ys.push(maxScrollY);
    return ys;
  }

  /** @returns {Promise<{canvas: HTMLCanvasElement, scrollEl: Element, saveX: number, saveY: number}>} */
  function captureStitchedScrollPage(scrollEl, saveX, saveY) {
    const frameCtx = getScreenshotCaptureFrameContext();
    const viewH = global.innerHeight;
    const positions = computeStitchScrollPositions(scrollEl, viewH);
    const out = createScreenshotElement('canvas');
    let ctx = out.getContext('2d');
    let ratioY = null;
    let outW = 0;
    let destY = 0;
    let cropDr = null;

    const totalH = Math.max(scrollEl.scrollHeight, viewH);
    const pageHeightDevice = () => Math.ceil(totalH * ratioY);

    const chain = positions.reduce(
      (prev, pos, index) =>
        prev.then(async () => {
          scrollRootTo(scrollEl, saveX, pos);
          await waitForPaint(index === 0 ? 3 : 2, { settleMs: 56, primeCapture: true });
          const img = await loadImageFromDataUrl(await captureVisibleForScreenshot());
          if (cropDr == null) {
            cropDr = getFrameCropDeviceRect(img, frameCtx);
          }
          if (ratioY == null) {
            ratioY = cropDr.h / Math.max(1, viewH);
            outW = cropDr.w;
            out.width = outW;
            out.height = Math.max(pageHeightDevice(), cropDr.h);
            ctx = out.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, out.width, out.height);
          }
          const prevPos = index > 0 ? positions[index - 1] : 0;
          const deltaCss = Math.max(0, pos - prevPos);
          const overlapCss = index === 0 ? 0 : Math.max(0, viewH - deltaCss);
          const overlapDevice = Math.round(overlapCss * ratioY);
          let sliceH = Math.max(1, cropDr.h - overlapDevice);
          const remaining = pageHeightDevice() - destY;
          if (remaining <= 0) return;
          sliceH = Math.min(sliceH, remaining);
          const neededH = destY + sliceH;
          if (neededH > out.height) {
            const newH = neededH + Math.ceil(viewH * ratioY);
            const grown = createScreenshotElement('canvas');
            grown.width = outW;
            grown.height = newH;
            const gctx = grown.getContext('2d');
            if (out.width > 0 && out.height > 0) {
              gctx.drawImage(out, 0, 0);
            }
            out.width = outW;
            out.height = newH;
            ctx = out.getContext('2d');
            ctx.drawImage(grown, 0, 0);
          }
          ctx.drawImage(
            img,
            cropDr.x,
            cropDr.y + overlapDevice,
            cropDr.w,
            sliceH,
            0,
            destY,
            outW,
            sliceH
          );
          destY += sliceH;
        }),
      Promise.resolve()
    );

    return chain.then(() => {
      const pageEnd = Math.ceil(totalH * (ratioY || 1));
      const finalH = Math.min(Math.max(1, destY), pageEnd);
      const trimmed = createScreenshotElement('canvas');
      trimmed.width = outW;
      trimmed.height = finalH;
      trimmed
        .getContext('2d')
        .drawImage(out, 0, 0, outW, Math.min(finalH, out.height), 0, 0, outW, finalH);
      return { canvas: trimmed, scrollEl, saveX, saveY };
    });
  }

  function captureFullPageToClipboard() {
    const scrollEl = getScrollRootForScreenshot();
    const saveX = scrollEl.scrollLeft;
    const saveY = scrollEl.scrollTop;
    return runInScreenshotCaptureSession(() =>
      captureStitchedScrollPage(scrollEl, saveX, saveY)
        .then(({ canvas, saveX: sx, saveY: sy }) => {
          scrollRootTo(scrollEl, sx, sy);
          return copyCanvasToClipboard(canvas, { mode: 'fullpage' });
        })
        .catch((e) => {
          scrollRootTo(scrollEl, saveX, saveY);
          throw e;
        })
    );
  }

  function removeManualScrollOverlay(overlay) {
    const el = overlay || findManualScrollCaptureBar();
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function findManualScrollCaptureBar() {
    let bar = null;
    if (typeof MouseExtUiHost !== 'undefined') {
      bar = MouseExtUiHost.getElementById('mouse-gesture-scroll-capture-bar');
    }
    if (!bar) {
      bar = document.getElementById('mouse-gesture-scroll-capture-bar');
    }
    return bar;
  }

  function detachManualScrollListeners(session, onScroll, onKeyDown) {
    if (session && session.scrollEl) {
      session.scrollEl.removeEventListener('scroll', onScroll, true);
    }
    global.removeEventListener('scroll', onScroll, true);
    global.removeEventListener('keydown', onKeyDown, true);
  }

  function createManualScrollOverlay(getMessage) {
    const bar = createScreenshotElement('div');
    bar.id = 'mouse-gesture-scroll-capture-bar';
    bar.setAttribute('role', 'status');
    bar.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1;' +
      'max-width:min(92vw,520px);padding:10px 16px;border-radius:10px;font:13px/1.45 system-ui,sans-serif;' +
      'color:#fff;background:rgba(20,20,36,0.92);box-shadow:0 8px 28px rgba(0,0,0,0.35);' +
      'border:1px solid rgba(255,107,107,0.45);text-align:center;';
    const msgFn =
      typeof getMessage === 'function'
        ? getMessage
        : () => 'Scroll the page, then press the shortcut again or Esc to finish';
    bar.textContent = msgFn('screenshotScrollCaptureActive');
    if (typeof MouseExtUiHost !== 'undefined') {
      if (!MouseExtUiHost.appendToScreenshotLayer(bar)) {
        (document.documentElement || document.body).appendChild(bar);
      }
    } else {
      (document.documentElement || document.body).appendChild(bar);
    }
    return bar;
  }

  /**
   * 开始手动滚动截屏（用户滚动，调用 finishManualScrollCapture 结束）
   * @param {{ getMessage?: (key: string) => string }} [options]
   */
  function startManualScrollCapture(options) {
    if (manualScrollSession) {
      return Promise.reject(new Error('already_active'));
    }
    if (regionPickerSession) {
      return Promise.reject(new Error('region_picker_active'));
    }
    const frameCtx = getScreenshotCaptureFrameContext();
    const scrollEl = getScrollRootForScreenshot();
    const saveX = scrollEl.scrollLeft;
    const saveY = scrollEl.scrollTop;
    const viewH = global.innerHeight;
    const slices = [];
    let ratioY = null;
    let outW = 0;
    let cropDr = null;
    let lastCaptureScrollY = saveY;
    let captureBusy = false;

    async function appendSlice() {
      if (captureBusy) return;
      captureBusy = true;
      const bar = findManualScrollCaptureBar();
      const barVis = bar ? bar.style.visibility : '';
      if (bar) bar.style.visibility = 'hidden';
      try {
        await waitForPaint(2, { settleMs: 40, primeCapture: true });
        const img = await loadImageFromDataUrl(await captureVisibleForScreenshot());
        if (cropDr == null) {
          cropDr = getFrameCropDeviceRect(img, frameCtx);
        }
        const scrollY = scrollEl.scrollTop;
        if (ratioY == null) {
          ratioY = cropDr.h / Math.max(1, viewH);
          outW = cropDr.w;
          slices.push({ img, cropDr, srcY: 0, sliceH: cropDr.h, scrollY });
          lastCaptureScrollY = scrollY;
          return;
        }
        const delta = scrollY - lastCaptureScrollY;
        if (delta < MANUAL_SCROLL_MIN_DELTA) return;
        const overlapCss = Math.max(0, viewH - delta);
        const srcY = Math.min(cropDr.h - 1, Math.round(overlapCss * ratioY));
        const sliceH = Math.max(1, cropDr.h - srcY);
        slices.push({ img, cropDr, srcY, sliceH, scrollY });
        lastCaptureScrollY = scrollY;
      } finally {
        if (bar) bar.style.visibility = barVis || 'visible';
        captureBusy = false;
      }
    }

    function buildCanvasFromSlices() {
      if (!slices.length) return null;
      let totalH = 0;
      for (let i = 0; i < slices.length; i++) totalH += slices[i].sliceH;
      const out = createScreenshotElement('canvas');
      out.width = outW || slices[0].img.naturalWidth;
      out.height = Math.max(1, totalH);
      const ctx = out.getContext('2d');
      let destY = 0;
      for (let i = 0; i < slices.length; i++) {
        const s = slices[i];
        const dr = s.cropDr;
        ctx.drawImage(
          s.img,
          dr.x,
          dr.y + s.srcY,
          dr.w,
          s.sliceH,
          0,
          destY,
          out.width,
          s.sliceH
        );
        destY += s.sliceH;
      }
      return out;
    }

    let scrollDebounce = null;
    function onScroll() {
      if (scrollDebounce) clearTimeout(scrollDebounce);
      scrollDebounce = global.setTimeout(() => {
        scrollDebounce = null;
        appendSlice();
      }, 180);
    }

    function onKeyDown(e) {
      if (!manualScrollSession) return;
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finishManualScrollCapture().catch(() => {});
      }
    }

    const getMessage = options && options.getMessage;
    const onComplete = options && options.onComplete;

    scrollEl.addEventListener('scroll', onScroll, { passive: true, capture: true });
    global.addEventListener('scroll', onScroll, true);
    global.addEventListener('keydown', onKeyDown, true);

    manualScrollSession = {
      onComplete,
      scrollEl,
      saveX,
      saveY,
      overlay: null,
      finish: async () => {
        if (!manualScrollSession) return Promise.reject(new Error('not_active'));
        const session = manualScrollSession;
        manualScrollSession = null;
        detachManualScrollListeners(session, onScroll, onKeyDown);
        if (scrollDebounce) clearTimeout(scrollDebounce);
        removeManualScrollOverlay(session.overlay);
        try {
          await appendSlice();
          const canvas = buildCanvasFromSlices();
          if (!canvas) throw new Error('no_slices');
          scrollRootTo(session.scrollEl, session.saveX, session.saveY);
          await copyCanvasToClipboard(canvas, { mode: 'scroll' });
          if (typeof session.onComplete === 'function') session.onComplete(null);
        } catch (e) {
          scrollRootTo(session.scrollEl, session.saveX, session.saveY);
          if (typeof session.onComplete === 'function') {
            session.onComplete(e);
            return;
          }
          throw e;
        } finally {
          endScreenshotCaptureSession();
        }
      },
      cancel: () => {
        const session = manualScrollSession;
        manualScrollSession = null;
        detachManualScrollListeners({ scrollEl }, onScroll, onKeyDown);
        if (scrollDebounce) clearTimeout(scrollDebounce);
        removeManualScrollOverlay(session && session.overlay);
        scrollRootTo(scrollEl, saveX, saveY);
        endScreenshotCaptureSession();
        return Promise.resolve();
      }
    };

    return beginScreenshotCaptureSession()
      .then(() => appendSlice())
      .then(() => {
        if (manualScrollSession) {
          manualScrollSession.overlay = createManualScrollOverlay(getMessage);
        }
      })
      .catch((e) => {
        endScreenshotCaptureSession();
        manualScrollSession = null;
        throw e;
      });
  }

  function finishManualScrollCapture() {
    if (!manualScrollSession) return Promise.reject(new Error('not_active'));
    return manualScrollSession.finish();
  }

  function cancelManualScrollCapture() {
    if (!manualScrollSession) return Promise.resolve();
    return manualScrollSession.cancel();
  }

  function isManualScrollCaptureActive() {
    return !!manualScrollSession;
  }

  const REGION_PICK_MIN_SIZE = 8;
  let regionPickerSession = null;

  function removeRegionPickerOverlay(root) {
    const el = root || (regionPickerSession && regionPickerSession.root);
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
      return;
    }
    if (typeof MouseExtUiHost !== 'undefined') {
      MouseExtUiHost.removeElementById('mouse-screenshot-region-picker');
    }
  }

  function mountRegionPickerOverlay(root) {
    if (typeof MouseExtUiHost !== 'undefined') {
      MouseExtUiHost.removeElementById('mouse-screenshot-region-picker');
      if (MouseExtUiHost.appendToModalsLayer(root)) return;
    }
    (document.documentElement || document.body).appendChild(root);
  }

  function createRegionPickerOverlay(getMessage) {
    const root = createScreenshotElement('div');
    root.id = 'mouse-screenshot-region-picker';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.style.cssText =
      'position:fixed;inset:0;cursor:crosshair;touch-action:none;user-select:none;z-index:2147483646;';

    const shade = createScreenshotElement('div');
    shade.style.cssText =
      'position:absolute;inset:0;background:rgba(0,0,0,0.35);pointer-events:none;';
    root.appendChild(shade);

    const sel = createScreenshotElement('div');
    sel.className = 'mouse-screenshot-region-picker__sel';
    sel.style.cssText =
      'position:absolute;box-sizing:border-box;border:2px solid #ff6b6b;' +
      'background:rgba(255,107,107,0.12);box-shadow:0 0 0 9999px rgba(0,0,0,0.35);' +
      'display:none;pointer-events:none;';
    root.appendChild(sel);

    const bar = createScreenshotElement('div');
    bar.className = 'mouse-screenshot-region-picker__hint';
    bar.setAttribute('role', 'status');
    bar.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1;' +
      'max-width:min(92vw,520px);padding:10px 16px;border-radius:10px;font:13px/1.45 system-ui,sans-serif;' +
      'color:#fff;background:rgba(20,20,36,0.92);box-shadow:0 8px 28px rgba(0,0,0,0.35);' +
      'border:1px solid rgba(255,107,107,0.45);text-align:center;';
    const msgFn =
      typeof getMessage === 'function'
        ? getMessage
        : () => 'Drag to select a region. Esc to cancel.';
    bar.textContent = msgFn('screenshotRegionPickHint');
    root.appendChild(bar);

    mountRegionPickerOverlay(root);
    return { root, sel, bar };
  }

  function rectPointsFromViewportBox(x1, y1, x2, y2) {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    return [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom }
    ];
  }

  /**
   * 快捷键触发的矩形选区截图（顶层 frame）
   * @param {{ getMessage?: (key: string) => string }} [options]
   */
  function startRegionPickerCapture(options) {
    if (regionPickerSession) {
      return Promise.reject(new Error('already_active'));
    }
    if (manualScrollSession) {
      return Promise.reject(new Error('scroll_active'));
    }

    const getMessage =
      options && typeof options.getMessage === 'function' ? options.getMessage : () => '';

    return new Promise((resolve, reject) => {
      const ui = createRegionPickerOverlay(getMessage);
      let startX = 0;
      let startY = 0;
      let dragging = false;
      let finished = false;

      function updateSelectionBox(x1, y1, x2, y2) {
        const left = Math.min(x1, x2);
        const top = Math.min(y1, y2);
        const w = Math.abs(x2 - x1);
        const h = Math.abs(y2 - y1);
        ui.sel.style.display = w > 0 && h > 0 ? 'block' : 'none';
        ui.sel.style.left = left + 'px';
        ui.sel.style.top = top + 'px';
        ui.sel.style.width = w + 'px';
        ui.sel.style.height = h + 'px';
      }

      function detachListeners() {
        ui.root.removeEventListener('pointerdown', onPointerDown, true);
        ui.root.removeEventListener('pointermove', onPointerMove, true);
        ui.root.removeEventListener('pointerup', onPointerUp, true);
        ui.root.removeEventListener('pointercancel', onPointerUp, true);
        global.removeEventListener('keydown', onKeyDown, true);
      }

      function cleanup() {
        detachListeners();
        removeRegionPickerOverlay(ui.root);
        regionPickerSession = null;
      }

      function cancelPicker() {
        if (finished) return;
        finished = true;
        cleanup();
        reject(new Error('cancelled'));
      }

      function onKeyDown(e) {
        if (!regionPickerSession || finished) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
          }
          cancelPicker();
        }
      }

      function onPointerDown(e) {
        if (finished || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        try {
          ui.root.setPointerCapture(e.pointerId);
        } catch (err) { /* ignore */ }
        updateSelectionBox(startX, startY, startX, startY);
      }

      function onPointerMove(e) {
        if (!dragging || finished) return;
        e.preventDefault();
        updateSelectionBox(startX, startY, e.clientX, e.clientY);
      }

      function onPointerUp(e) {
        if (!dragging || finished) return;
        dragging = false;
        e.preventDefault();
        try {
          if (ui.root.hasPointerCapture(e.pointerId)) {
            ui.root.releasePointerCapture(e.pointerId);
          }
        } catch (err) { /* ignore */ }

        const w = Math.abs(e.clientX - startX);
        const h = Math.abs(e.clientY - startY);
        if (w < REGION_PICK_MIN_SIZE || h < REGION_PICK_MIN_SIZE) {
          ui.bar.textContent = getMessage('screenshotRegionTooSmall') || 'Selection too small';
          ui.sel.style.display = 'none';
          return;
        }

        finished = true;
        const points = rectPointsFromViewportBox(startX, startY, e.clientX, e.clientY);
        cleanup();
        resolve({ points });
      }

      ui.root.addEventListener('pointerdown', onPointerDown, true);
      ui.root.addEventListener('pointermove', onPointerMove, true);
      ui.root.addEventListener('pointerup', onPointerUp, true);
      ui.root.addEventListener('pointercancel', onPointerUp, true);
      global.addEventListener('keydown', onKeyDown, true);

      regionPickerSession = { root: ui.root, cancel: cancelPicker };
    });
  }

  function cancelRegionPickerCapture() {
    if (!regionPickerSession) return Promise.resolve();
    regionPickerSession.cancel();
    return Promise.resolve();
  }

  function isRegionPickerCaptureActive() {
    return !!regionPickerSession;
  }

  global.MouseScreenshot = {
    captureViewportToClipboard,
    captureRegionFromPoints,
    captureFullPageToClipboard,
    startManualScrollCapture,
    finishManualScrollCapture,
    cancelManualScrollCapture,
    isManualScrollCaptureActive,
    startRegionPickerCapture,
    cancelRegionPickerCapture,
    isRegionPickerCaptureActive,
    prefetchCaptureLease,
    getScreenshotOverlayNonce,
    setScreenshotPreviewChecker,
    setScreenshotClipboardChecker,
    setScreenshotHistoryChecker
  };
})(typeof window !== 'undefined' ? window : self);
