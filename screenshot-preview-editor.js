/**
 * Screenshot preview annotation editor (canvas layers + undo).
 */
(function (global) {
  'use strict';

  function t(name, fallback) {
    try {
      const m = chrome.i18n.getMessage(name);
      return m || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function cloneInk(obj) {
    const c = { type: obj.type };
    if (obj.points) c.points = obj.points.map((p) => ({ x: p.x, y: p.y }));
    if (obj.x1 != null) {
      c.x1 = obj.x1;
      c.y1 = obj.y1;
      c.x2 = obj.x2;
      c.y2 = obj.y2;
    }
    if (obj.x != null && obj.w != null) {
      c.x = obj.x;
      c.y = obj.y;
      c.w = obj.w;
      c.h = obj.h;
    }
    if (obj.text != null) c.text = obj.text;
    if (obj.color != null) c.color = obj.color;
    if (obj.width != null) c.width = obj.width;
    if (obj.fontSize != null) c.fontSize = obj.fontSize;
    if (obj.alpha != null) c.alpha = obj.alpha;
    if (obj.n != null) c.n = obj.n;
    if (obj.radius != null) c.radius = obj.radius;
    return c;
  }

  function hexToRgba(hex, alpha) {
    const h = (hex || '#ffffff').replace('#', '');
    const full =
      h.length === 3
        ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
        : h.length >= 6
          ? h.slice(0, 6)
          : 'ffffff';
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function normalizedBox(obj) {
    const x = Math.min(obj.x, obj.x + obj.w);
    const y = Math.min(obj.y, obj.y + obj.h);
    return { x, y, w: Math.abs(obj.w), h: Math.abs(obj.h) };
  }

  /** Shift：线段仅水平/垂直 */
  function constrainLineEnd(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (Math.abs(dx) >= Math.abs(dy)) return { x: x2, y: y1 };
    return { x: x1, y: y2 };
  }

  /** Shift：矩形/裁剪等保持正方形 */
  function constrainBoxDelta(dx, dy) {
    const s = Math.max(Math.abs(dx), Math.abs(dy), 1);
    return {
      w: (dx === 0 && dy === 0 ? 1 : Math.sign(dx || 1)) * s,
      h: (dx === 0 && dy === 0 ? 1 : Math.sign(dy || 1)) * s
    };
  }

  function drawArrowHead(ctx, tipX, tipY, angle, color, width) {
    const headLen = Math.max(10, width * 3.5);
    const wingSpread = Math.PI / 7;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX - headLen * Math.cos(angle - wingSpread),
      tipY - headLen * Math.sin(angle - wingSpread)
    );
    ctx.lineTo(
      tipX - headLen * Math.cos(angle + wingSpread),
      tipY - headLen * Math.sin(angle + wingSpread)
    );
    ctx.closePath();
    ctx.fill();
  }

  function drawArrow(ctx, x1, y1, x2, y2, color, width) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = Math.max(10, width * 3.5);
    const wingSpread = Math.PI / 7;
    const shaftInset = headLen * Math.cos(wingSpread);
    const totalLen = Math.hypot(x2 - x1, y2 - y1);
    let shaftEndX = x2;
    let shaftEndY = y2;
    if (totalLen > shaftInset) {
      shaftEndX = x2 - shaftInset * Math.cos(angle);
      shaftEndY = y2 - shaftInset * Math.sin(angle);
    } else if (totalLen > 0) {
      shaftEndX = x1 + totalLen * 0.35 * Math.cos(angle);
      shaftEndY = y1 + totalLen * 0.35 * Math.sin(angle);
    }
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();
    drawArrowHead(ctx, x2, y2, angle, color, width);
  }

  function drawDoubleArrow(ctx, x1, y1, x2, y2, color, width) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = Math.max(10, width * 3.5);
    const wingSpread = Math.PI / 7;
    const inset = headLen * Math.cos(wingSpread);
    const totalLen = Math.hypot(x2 - x1, y2 - y1);
    if (totalLen <= inset * 2) {
      drawArrow(ctx, x1, y1, x2, y2, color, width);
      return;
    }
    const sx = x1 + inset * Math.cos(angle);
    const sy = y1 + inset * Math.sin(angle);
    const ex = x2 - inset * Math.cos(angle);
    const ey = y2 - inset * Math.sin(angle);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    drawArrowHead(ctx, x2, y2, angle, color, width);
    drawArrowHead(ctx, x1, y1, angle + Math.PI, color, width);
  }

  function drawCropOverlay(ctx, canvasW, canvasH, box) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.48)';
    ctx.fillRect(0, 0, canvasW, canvasH);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawInkObject(ctx, obj) {
    if (obj.type === 'pen' || obj.type === 'erase' || obj.type === 'highlighter') {
      const pts = obj.points;
      if (!pts || pts.length < 2) return;
      ctx.save();
      if (obj.type === 'erase') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else if (obj.type === 'highlighter') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = obj.alpha != null ? obj.alpha : 0.38;
        ctx.strokeStyle = obj.color;
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = obj.color;
      }
      ctx.lineWidth = obj.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.strokeStyle = obj.color;
    ctx.fillStyle = obj.color;
    ctx.lineWidth = obj.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (obj.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(obj.x1, obj.y1);
      ctx.lineTo(obj.x2, obj.y2);
      ctx.stroke();
    } else if (obj.type === 'arrow') {
      drawArrow(ctx, obj.x1, obj.y1, obj.x2, obj.y2, obj.color, obj.width);
    } else if (obj.type === 'arrow2') {
      drawDoubleArrow(ctx, obj.x1, obj.y1, obj.x2, obj.y2, obj.color, obj.width);
    } else if (obj.type === 'number') {
      const r = Math.max(12, obj.radius || obj.width * 3.5);
      ctx.fillStyle = obj.color;
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.max(11, Math.round(r * 1.05))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(obj.n), obj.x, obj.y);
    } else if (obj.type === 'rect') {
      const box = normalizedBox(obj);
      ctx.strokeRect(box.x, box.y, box.w, box.h);
    } else if (obj.type === 'roundRect') {
      const box = normalizedBox(obj);
      const rad = Math.min(box.w, box.h) * 0.22;
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, rad);
      ctx.stroke();
    } else if (obj.type === 'highlight' || obj.type === 'fillRect') {
      const box = normalizedBox(obj);
      const alpha = obj.alpha != null ? obj.alpha : obj.type === 'highlight' ? 0.28 : 0.5;
      ctx.fillStyle = hexToRgba(obj.color, alpha);
      ctx.fillRect(box.x, box.y, box.w, box.h);
    } else if (obj.type === 'ellipse') {
      const box = normalizedBox(obj);
      const rx = box.w / 2;
      const ry = box.h / 2;
      ctx.beginPath();
      ctx.ellipse(box.x + rx, box.y + ry, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (obj.type === 'fillEllipse') {
      const box = normalizedBox(obj);
      const rx = box.w / 2;
      const ry = box.h / 2;
      const alpha = obj.alpha != null ? obj.alpha : 0.5;
      ctx.fillStyle = hexToRgba(obj.color, alpha);
      ctx.beginPath();
      ctx.ellipse(box.x + rx, box.y + ry, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (obj.type === 'text') {
      ctx.font = `${obj.fontSize}px system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = obj.color;
      ctx.fillText(obj.text, obj.x, obj.y);
    }
    ctx.restore();
  }

  function applyMosaicDab(ctx, cx, cy, radius, block) {
    const r = Math.max(4, radius);
    const bs = Math.max(4, block);
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(ctx.canvas.width, Math.ceil(cx + r));
    const y1 = Math.min(ctx.canvas.height, Math.ceil(cy + r));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    let data;
    try {
      data = ctx.getImageData(x0, y0, w, h);
    } catch (e) {
      return;
    }
    const d = data.data;
    for (let by = 0; by < h; by += bs) {
      for (let bx = 0; bx < w; bx += bs) {
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let aSum = 0;
        let n = 0;
        const bh = Math.min(bs, h - by);
        const bw = Math.min(bs, w - bx);
        for (let py = 0; py < bh; py++) {
          for (let px = 0; px < bw; px++) {
            const ix = ((by + py) * w + (bx + px)) * 4;
            rSum += d[ix];
            gSum += d[ix + 1];
            bSum += d[ix + 2];
            aSum += d[ix + 3];
            n++;
          }
        }
        const rAvg = (rSum / n) | 0;
        const gAvg = (gSum / n) | 0;
        const bAvg = (bSum / n) | 0;
        const aAvg = (aSum / n) | 0;
        for (let py = 0; py < bh; py++) {
          for (let px = 0; px < bw; px++) {
            const ix = ((by + py) * w + (bx + px)) * 4;
            d[ix] = rAvg;
            d[ix + 1] = gAvg;
            d[ix + 2] = bAvg;
            d[ix + 3] = aAvg;
          }
        }
      }
    }
    ctx.putImageData(data, x0, y0);
  }

  function applyBlurDab(ctx, cx, cy, radius) {
    const r = Math.max(8, radius);
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(ctx.canvas.width, Math.ceil(cx + r));
    const y1 = Math.min(ctx.canvas.height, Math.ceil(cy + r));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    const src = document.createElement('canvas');
    src.width = w;
    src.height = h;
    src.getContext('2d').drawImage(ctx.canvas, x0, y0, w, h, 0, 0, w, h);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    const blurPx = Math.max(3, Math.round(r / 4));
    octx.filter = `blur(${blurPx}px)`;
    octx.drawImage(src, 0, 0);
    ctx.drawImage(out, x0, y0);
  }

  const MAX_HISTORY_STEPS = 100;
  const SHAPE_TOOLS = {
    rect: 1,
    ellipse: 1,
    roundRect: 1,
    highlight: 1,
    fillRect: 1,
    fillEllipse: 1,
    crop: 1
  };
  const LINE_TOOLS = { line: 1, arrow: 1, arrow2: 1 };

  function ScreenshotPreviewEditor(options) {
    this.stage = options.stage;
    this.baseCanvas = options.baseCanvas;
    this.inkCanvas = options.inkCanvas;
    this.baseCtx = this.baseCanvas.getContext('2d', { willReadFrequently: true });
    this.inkCtx = this.inkCanvas.getContext('2d', { willReadFrequently: true });
    this.onHistoryChange = options.onHistoryChange || function () {};
    this.onCropApplied = options.onCropApplied || function () {};
    this.onCropPendingChange = options.onCropPendingChange || function () {};

    this.tool = 'pen';
    /** 预览内序号标注：下一枚将使用的数字（与页面贴图编号无关） */
    this.stampCounter = 1;
    /** 用户设定的起始序号，标注逻辑用 */
    this.stampStartMin = 1;
    this.pendingCrop = null;
    this.color = options.defaultColor || '#FF9ECD';
    this.size = 4;
    this.inkObjects = [];
    this.mosaicStrokes = [];
    this.blurStrokes = [];
    this.history = [];
    this.historyIndex = -1;
    this.drawing = false;
    this.previewObj = null;
    this.imgW = 0;
    this.imgH = 0;
    this._textOverlay = null;

    this._bindPointer();
  }

  ScreenshotPreviewEditor.prototype._canvasFontSize = function () {
    return Math.max(12, Math.round(this.size * 4));
  };

  ScreenshotPreviewEditor.prototype._displayScale = function () {
    const rect = this.baseCanvas.getBoundingClientRect();
    return {
      sx: rect.width / this.imgW,
      sy: rect.height / this.imgH
    };
  };

  ScreenshotPreviewEditor.prototype._canvasToDisplay = function (canvasX, canvasY) {
    const s = this._displayScale();
    return { left: canvasX * s.sx, top: canvasY * s.sy, sx: s.sx, sy: s.sy };
  };

  ScreenshotPreviewEditor.prototype.isTextInputActive = function () {
    return !!this._textOverlay;
  };

  ScreenshotPreviewEditor.prototype.cancelTextInput = function () {
    if (!this._textOverlay) return false;
    this._removeTextOverlay();
    return true;
  };

  ScreenshotPreviewEditor.prototype.commitTextInput = function () {
    this._commitTextInput();
  };

  ScreenshotPreviewEditor.prototype._removeTextOverlay = function () {
    if (this._textOverlay && this._textOverlay.parentNode) {
      this._textOverlay.parentNode.removeChild(this._textOverlay);
    }
    this._textOverlay = null;
  };

  ScreenshotPreviewEditor.prototype._commitTextInput = function () {
    const el = this._textOverlay;
    if (!el) return;
    const text = (el.innerText || el.textContent || '').replace(/\r\n/g, '\n').trim();
    const x = Number(el.dataset.canvasX);
    const y = Number(el.dataset.canvasY);
    const fontSize = Number(el.dataset.fontSize) || this._canvasFontSize();
    const color = el.dataset.color || this.color;
    this._removeTextOverlay();
    if (!text) return;
    this.inkObjects.push({
      type: 'text',
      x,
      y,
      text,
      color,
      fontSize
    });
    this.pushHistory();
    this.redrawInk();
  };

  ScreenshotPreviewEditor.prototype.setTool = function (tool) {
    this.cancelTextInput();
    this.tool = tool;
    this.stage.classList.remove(
      'tool-eraser',
      'tool-text',
      'tool-mosaic',
      'tool-blur',
      'tool-highlighter',
      'tool-number',
      'tool-crop',
      'tool-hand'
    );
    if (tool === 'eraser') this.stage.classList.add('tool-eraser');
    if (tool === 'text') this.stage.classList.add('tool-text');
    if (tool === 'mosaic') this.stage.classList.add('tool-mosaic');
    if (tool === 'blur') this.stage.classList.add('tool-blur');
    if (tool === 'highlighter') this.stage.classList.add('tool-highlighter');
    if (tool === 'number') this.stage.classList.add('tool-number');
    if (tool === 'crop') this.stage.classList.add('tool-crop');
    if (tool === 'hand') this.stage.classList.add('tool-hand');
    if (tool !== 'crop') this.cancelPendingCrop();
  };

  ScreenshotPreviewEditor.prototype.setColor = function (c) {
    this.color = c;
  };

  ScreenshotPreviewEditor.prototype.setSize = function (n) {
    this.size = n;
  };

  ScreenshotPreviewEditor.prototype.setStampStart = function (n) {
    const v = Math.max(1, Math.min(999, Math.floor(Number(n)) || 1));
    this.stampStartMin = v;
    let maxN = 0;
    for (let i = 0; i < this.inkObjects.length; i++) {
      const o = this.inkObjects[i];
      if (o.type === 'number' && o.n > maxN) maxN = o.n;
    }
    this.stampCounter = Math.max(maxN + 1, v);
    return this.stampCounter;
  };

  ScreenshotPreviewEditor.prototype.getStampStart = function () {
    return this.stampStartMin;
  };

  ScreenshotPreviewEditor.prototype.loadImage = function (img) {
    this.imgW = img.naturalWidth;
    this.imgH = img.naturalHeight;
    this.baseCanvas.width = this.imgW;
    this.baseCanvas.height = this.imgH;
    this.inkCanvas.width = this.imgW;
    this.inkCanvas.height = this.imgH;
    this._originalCanvas = document.createElement('canvas');
    this._originalCanvas.width = this.imgW;
    this._originalCanvas.height = this.imgH;
    this._originalCanvas.getContext('2d').drawImage(img, 0, 0);
    this.inkObjects = [];
    this.mosaicStrokes = [];
    this.blurStrokes = [];
    /** 预览内序号标注：下一枚将使用的数字（与页面贴图编号无关） */
    this.stampCounter = 1;
    /** 用户设定的起始序号，标注逻辑用 */
    this.stampStartMin = 1;
    this.pendingCrop = null;
    this.onCropPendingChange(false);
    this.history = [];
    this.historyIndex = -1;
    this.redrawBaseFromEffects();
    this.pushHistory();
    this.stage.classList.add('interactive');
    this.redrawInk();
  };

  ScreenshotPreviewEditor.prototype._snapshotState = function () {
    return {
      ink: this.inkObjects.map(cloneInk),
      mosaic: this.mosaicStrokes.map((m) => ({ x: m.x, y: m.y, r: m.r, block: m.block })),
      blur: this.blurStrokes.map((b) => ({ x: b.x, y: b.y, r: b.r }))
    };
  };

  ScreenshotPreviewEditor.prototype._trimHistory = function () {
    while (this.history.length > MAX_HISTORY_STEPS) {
      if (this.history.length <= 1) break;
      this.history.splice(1, 1);
      this.historyIndex = Math.max(0, this.historyIndex - 1);
    }
  };

  ScreenshotPreviewEditor.prototype.pushHistory = function () {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(this._snapshotState());
    this._trimHistory();
    this.historyIndex = this.history.length - 1;
    this.onHistoryChange(this.canUndo(), this.canRedo());
  };

  ScreenshotPreviewEditor.prototype.hasEdits = function () {
    return (
      this.inkObjects.length > 0 ||
      this.mosaicStrokes.length > 0 ||
      this.blurStrokes.length > 0
    );
  };

  ScreenshotPreviewEditor.prototype.canReset = function () {
    return this.hasEdits() || this.historyIndex > 0 || this.canRedo();
  };

  ScreenshotPreviewEditor.prototype.canUndo = function () {
    return this.historyIndex > 0;
  };

  ScreenshotPreviewEditor.prototype.canRedo = function () {
    return this.historyIndex < this.history.length - 1;
  };

  ScreenshotPreviewEditor.prototype.restoreHistory = function (index) {
    const snap = this.history[index];
    if (!snap) return;
    this.historyIndex = index;
    this.inkObjects = snap.ink.map(cloneInk);
    this.mosaicStrokes = (snap.mosaic || []).map((m) => ({ ...m }));
    this.blurStrokes = (snap.blur || []).map((b) => ({ ...b }));
    this.redrawBaseFromEffects();
    this.redrawInk();
    this._syncStampCounter();
    this.onHistoryChange(this.canUndo(), this.canRedo());
  };

  ScreenshotPreviewEditor.prototype._syncStampCounter = function () {
    let maxN = 0;
    for (let i = 0; i < this.inkObjects.length; i++) {
      const o = this.inkObjects[i];
      if (o.type === 'number' && o.n > maxN) maxN = o.n;
    }
    this.stampCounter = Math.max(maxN + 1, this.stampStartMin);
  };

  ScreenshotPreviewEditor.prototype.undo = function () {
    if (!this.canUndo()) return;
    this.restoreHistory(this.historyIndex - 1);
  };

  ScreenshotPreviewEditor.prototype.redo = function () {
    if (!this.canRedo()) return;
    this.restoreHistory(this.historyIndex + 1);
  };

  ScreenshotPreviewEditor.prototype.resetAllEdits = function () {
    this.cancelTextInput();
    if (!this._originalCanvas || !this.canReset()) return;
    this.drawing = false;
    this.previewObj = null;
    this.inkObjects = [];
    this.mosaicStrokes = [];
    this.blurStrokes = [];
    this.stampCounter = this.stampStartMin;
    this.cancelPendingCrop();
    this.redrawBaseFromEffects();
    this.redrawInk();
    this.history = [this._snapshotState()];
    this.historyIndex = 0;
    this.onHistoryChange(this.canUndo(), this.canRedo());
  };

  ScreenshotPreviewEditor.prototype.redrawBaseFromEffects = function () {
    if (!this._originalCanvas) return;
    this.baseCtx.clearRect(0, 0, this.imgW, this.imgH);
    this.baseCtx.drawImage(this._originalCanvas, 0, 0);
    for (let i = 0; i < this.mosaicStrokes.length; i++) {
      const m = this.mosaicStrokes[i];
      applyMosaicDab(this.baseCtx, m.x, m.y, m.r, m.block);
    }
    for (let j = 0; j < this.blurStrokes.length; j++) {
      const b = this.blurStrokes[j];
      applyBlurDab(this.baseCtx, b.x, b.y, b.r);
    }
  };

  ScreenshotPreviewEditor.prototype.redrawInk = function () {
    const ctx = this.inkCtx;
    ctx.clearRect(0, 0, this.imgW, this.imgH);
    for (let i = 0; i < this.inkObjects.length; i++) drawInkObject(ctx, this.inkObjects[i]);
    if (this.previewObj) {
      if (this.previewObj.type === 'crop') {
        drawCropOverlay(ctx, this.imgW, this.imgH, normalizedBox(this.previewObj));
      } else {
        drawInkObject(ctx, this.previewObj);
      }
    } else if (this.pendingCrop) {
      drawCropOverlay(ctx, this.imgW, this.imgH, this.pendingCrop);
    }
  };

  ScreenshotPreviewEditor.prototype._coords = function (e) {
    const rect = this.baseCanvas.getBoundingClientRect();
    const sx = this.imgW / rect.width;
    const sy = this.imgH / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy
    };
  };

  ScreenshotPreviewEditor.prototype._bindPointer = function () {
    const target = this.stage;
    const down = (e) => {
      if (e.button !== 0) return;
      if (this.tool === 'hand') return;
      if (this._textOverlay && !this._textOverlay.contains(e.target)) {
        this._commitTextInput();
      }
      const p = this._coords(e);
      if (this.tool === 'text') {
        e.preventDefault();
        this._placeText(p.x, p.y);
        return;
      }
      if (this.tool === 'number') {
        e.preventDefault();
        this._placeNumber(p.x, p.y);
        return;
      }
      if (this.tool === 'crop' && this.pendingCrop) {
        e.preventDefault();
        return;
      }
      this.drawing = true;
      this.previewObj = null;
      if (this.tool === 'pen') {
        this.previewObj = { type: 'pen', points: [p], color: this.color, width: this.size };
      } else if (this.tool === 'highlighter') {
        this.previewObj = {
          type: 'highlighter',
          points: [p],
          color: this.color,
          width: Math.max(8, this.size * 2.8),
          alpha: 0.38
        };
      } else if (this.tool === 'eraser') {
        this.previewObj = { type: 'erase', points: [p], width: this._eraserRadius() };
        this._removeEffectsNear(p.x, p.y, this._eraserRadius());
      } else if (this.tool === 'mosaic') {
        this._mosaicAt(p.x, p.y);
      } else if (this.tool === 'blur') {
        this._blurAt(p.x, p.y);
      } else if (LINE_TOOLS[this.tool]) {
        this.previewObj = {
          type: this.tool,
          x1: p.x,
          y1: p.y,
          x2: p.x,
          y2: p.y,
          color: this.color,
          width: this.size
        };
      } else if (SHAPE_TOOLS[this.tool]) {
        const shape = {
          type: this.tool,
          x: p.x,
          y: p.y,
          w: 0,
          h: 0,
          color: this.color,
          width: this.size
        };
        if (this.tool === 'highlight') shape.alpha = 0.28;
        if (this.tool === 'fillRect' || this.tool === 'fillEllipse') shape.alpha = 0.5;
        this.previewObj = shape;
      }
      this.redrawInk();
      e.preventDefault();
    };
    const move = (e) => {
      if (!this.drawing) return;
      let p = this._coords(e);
      const shift = e.shiftKey;
      if (this.tool === 'mosaic') {
        this._mosaicAt(p.x, p.y);
        return;
      }
      if (this.tool === 'blur') {
        this._blurAt(p.x, p.y);
        return;
      }
      if (!this.previewObj) return;
      if (
        this.previewObj.type === 'pen' ||
        this.previewObj.type === 'erase' ||
        this.previewObj.type === 'highlighter'
      ) {
        const pts = this.previewObj.points;
        const prev = pts.length > 0 ? pts[pts.length - 1] : null;
        if (shift && prev) {
          p = constrainLineEnd(prev.x, prev.y, p.x, p.y);
        }
        pts.push(p);
        if (this.previewObj.type === 'erase') {
          if (prev) this._eraseEffectsAlongSegment(prev.x, prev.y, p.x, p.y);
          else this._removeEffectsNear(p.x, p.y, this._eraserRadius());
        }
      } else if (this.previewObj.x2 != null) {
        if (shift) p = constrainLineEnd(this.previewObj.x1, this.previewObj.y1, p.x, p.y);
        this.previewObj.x2 = p.x;
        this.previewObj.y2 = p.y;
      } else {
        let dx = p.x - this.previewObj.x;
        let dy = p.y - this.previewObj.y;
        if (shift) {
          const box = constrainBoxDelta(dx, dy);
          this.previewObj.w = box.w;
          this.previewObj.h = box.h;
        } else {
          this.previewObj.w = dx;
          this.previewObj.h = dy;
        }
      }
      this.redrawInk();
    };
    const up = () => {
      if (!this.drawing) return;
      this.drawing = false;
      if (this.tool === 'mosaic' || this.tool === 'blur') {
        this.pushHistory();
        this.previewObj = null;
        return;
      }
      if (this.previewObj) {
        const o = this.previewObj;
        if (o.type === 'pen' || o.type === 'erase' || o.type === 'highlighter') {
          if (o.points.length >= 2) this.inkObjects.push(cloneInk(o));
        } else if (LINE_TOOLS[o.type]) {
          if (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) > 2) this.inkObjects.push(cloneInk(o));
        } else if (o.type === 'crop') {
          if (Math.abs(o.w) > 8 && Math.abs(o.h) > 8) {
            this.pendingCrop = normalizedBox(o);
            this.onCropPendingChange(true);
          }
        } else if (SHAPE_TOOLS[o.type]) {
          if (Math.abs(o.w) > 2 && Math.abs(o.h) > 2) this.inkObjects.push(cloneInk(o));
        }
        if (o.type !== 'crop') this.pushHistory();
      }
      this.previewObj = null;
      this.redrawInk();
    };
    target.addEventListener('pointerdown', down);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointerleave', up);
    target.addEventListener('pointercancel', up);
  };

  ScreenshotPreviewEditor.prototype._eraserRadius = function () {
    return Math.max(4, this.size * 2);
  };

  ScreenshotPreviewEditor.prototype._removeEffectsNear = function (x, y, radius, redraw) {
    const within = (sx, sy, sr) => {
      const reach = radius + (sr || 0);
      return Math.hypot(x - sx, y - sy) <= reach;
    };
    let changed = false;
    const mosaic = [];
    for (let i = 0; i < this.mosaicStrokes.length; i++) {
      const m = this.mosaicStrokes[i];
      if (within(m.x, m.y, m.r)) changed = true;
      else mosaic.push(m);
    }
    if (changed) this.mosaicStrokes = mosaic;

    const blur = [];
    let blurHit = false;
    for (let j = 0; j < this.blurStrokes.length; j++) {
      const b = this.blurStrokes[j];
      if (within(b.x, b.y, b.r)) blurHit = true;
      else blur.push(b);
    }
    if (blurHit) {
      this.blurStrokes = blur;
      changed = true;
    }
    if (changed && redraw !== false) this.redrawBaseFromEffects();
    return changed;
  };

  ScreenshotPreviewEditor.prototype._eraseEffectsAlongSegment = function (x0, y0, x1, y1) {
    const r = this._eraserRadius();
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const step = Math.max(4, r * 0.35);
    const n = Math.max(1, Math.ceil(dist / step));
    let changed = false;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      if (this._removeEffectsNear(x, y, r, false)) changed = true;
    }
    if (changed) this.redrawBaseFromEffects();
  };

  ScreenshotPreviewEditor.prototype._mosaicAt = function (x, y) {
    const r = this.size * 3;
    const block = Math.max(6, Math.round(this.size * 1.5));
    this.mosaicStrokes.push({ x, y, r, block });
    applyMosaicDab(this.baseCtx, x, y, r, block);
  };

  ScreenshotPreviewEditor.prototype._blurAt = function (x, y) {
    const r = this.size * 4;
    this.blurStrokes.push({ x, y, r });
    applyBlurDab(this.baseCtx, x, y, r);
  };

  ScreenshotPreviewEditor.prototype._placeNumber = function (x, y) {
    const r = Math.max(14, this.size * 3.5);
    this.inkObjects.push({
      type: 'number',
      x,
      y,
      n: this.stampCounter++,
      color: this.color,
      radius: r,
      width: this.size
    });
    this.pushHistory();
    this.redrawInk();
  };

  ScreenshotPreviewEditor.prototype.cancelPendingCrop = function () {
    if (!this.pendingCrop) return;
    this.pendingCrop = null;
    this.previewObj = null;
    this.onCropPendingChange(false);
    this.redrawInk();
  };

  ScreenshotPreviewEditor.prototype.applyPendingCrop = function () {
    if (!this.pendingCrop) return false;
    const box = this.pendingCrop;
    this.pendingCrop = null;
    this.onCropPendingChange(false);
    return this._applyCropBox(box);
  };

  ScreenshotPreviewEditor.prototype._applyCropBox = function (box) {
    const x = Math.max(0, Math.min(this.imgW - 1, Math.floor(box.x)));
    const y = Math.max(0, Math.min(this.imgH - 1, Math.floor(box.y)));
    const w = Math.max(1, Math.min(this.imgW - x, Math.floor(box.w)));
    const h = Math.max(1, Math.min(this.imgH - y, Math.floor(box.h)));
    if (w < 8 || h < 8) return false;

    this.pendingCrop = null;
    this.previewObj = null;
    this.redrawInk();

    const flat = this.getFlattenedCanvas();
    const cropped = document.createElement('canvas');
    cropped.width = w;
    cropped.height = h;
    cropped.getContext('2d').drawImage(flat, x, y, w, h, 0, 0, w, h);

    this.imgW = w;
    this.imgH = h;
    this.baseCanvas.width = w;
    this.baseCanvas.height = h;
    this.inkCanvas.width = w;
    this.inkCanvas.height = h;
    this._originalCanvas = document.createElement('canvas');
    this._originalCanvas.width = w;
    this._originalCanvas.height = h;
    this._originalCanvas.getContext('2d').drawImage(cropped, 0, 0);
    this.inkObjects = [];
    this.mosaicStrokes = [];
    this.blurStrokes = [];
    this.stampCounter = this.stampStartMin;
    this.redrawBaseFromEffects();
    this.redrawInk();
    this.pushHistory();
    this.onCropApplied(w, h);
    return true;
  };

  ScreenshotPreviewEditor.prototype._placeText = function (x, y) {
    this.cancelTextInput();
    const fontSize = this._canvasFontSize();
    const pos = this._canvasToDisplay(x, y);
    const el = document.createElement('div');
    el.className = 'text-input-overlay';
    el.contentEditable = 'true';
    el.setAttribute('role', 'textbox');
    el.setAttribute('spellcheck', 'true');
    el.dataset.canvasX = String(x);
    el.dataset.canvasY = String(y);
    el.dataset.fontSize = String(fontSize);
    el.dataset.color = this.color;
    el.dataset.placeholder = t('screenshotAnnotTextPlaceholder', 'Type here…');
    el.style.left = pos.left + 'px';
    el.style.top = pos.top + 'px';
    el.style.fontSize = Math.max(12, fontSize * pos.sy) + 'px';
    el.style.color = this.color;
    el.style.borderColor = this.color;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.cancelTextInput();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._commitTextInput();
      }
    };
    const onBlur = () => {
      setTimeout(() => {
        if (this._textOverlay === el) this._commitTextInput();
      }, 120);
    };

    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
    this.stage.appendChild(el);
    this._textOverlay = el;
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  ScreenshotPreviewEditor.prototype.getFlattenedCanvas = function () {
    const out = document.createElement('canvas');
    out.width = this.imgW;
    out.height = this.imgH;
    const ctx = out.getContext('2d');
    ctx.drawImage(this.baseCanvas, 0, 0);
    ctx.drawImage(this.inkCanvas, 0, 0);
    return out;
  };

  ScreenshotPreviewEditor.prototype.getFlattenedBlob = function () {
    return new Promise((resolve, reject) => {
      this.getFlattenedCanvas().toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('to_blob_failed'))),
        'image/png',
        1
      );
    });
  };

  global.ScreenshotPreviewEditor = ScreenshotPreviewEditor;
  global.ScreenshotPreviewEditor.t = t;
})(typeof window !== 'undefined' ? window : self);
