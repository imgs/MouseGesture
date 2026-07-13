/**
 * 手势滚动：容器识别 + 执行（与 content.js 手势状态通过 bindContext 注入）
 */
(function (global) {
  'use strict';

  let ctx = null;
  let cachedScrollContainer = null;
  let cachedScrollContainerKey = '';

  /** 滚动算法统一常量 */
  const SCROLL_CONFIG = {
    PAGE_FRACTION: 0.92,
    MAX_PAGE_FRACTION: 1.5,
    TRAP_MAX_RANGE_RATIO: 0.2,
    EMBED_COVERAGE: 0.5,
    PAGE_DOMINANCE_RATIO: 1.8,
    EDGE_EPSILON: 2,
    /** interactive 后短窗口内仍用 fastMode（仅 loading 级重探测） */
    INTERACTIVE_FAST_MS: 1200,
    FRAME_SHELL_RANGE_RATIO: 0.4,
    FRAME_SHELL_VIEWPORT_RATIO: 0.5
  };

  /** 手势进行中锁定的滚动容器，避免松手时再扫 DOM */
  const gestureScrollLock = {
    active: false,
    fastMode: false,
    byAxis: { y: null, x: null }
  };

  let interactiveSinceMs = 0;

  function initDocumentLoadWatcher() {
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
      interactiveSinceMs = performance.now();
    }
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'interactive') {
        interactiveSinceMs = performance.now();
      }
    });
  }
  initDocumentLoadWatcher();

  function clearGestureScrollLock() {
    gestureScrollLock.active = false;
    gestureScrollLock.fastMode = false;
    gestureScrollLock.byAxis.y = null;
    gestureScrollLock.byAxis.x = null;
  }

  function shouldDeferHeavyScrollProbe() {
    return document.readyState === 'loading';
  }

  /** 仅 loading + interactive 初期使用 fastMode，complete 后恢复局部滚动 */
  function shouldUseFastGestureScrollMode() {
    if (document.readyState === 'loading') return true;
    if (document.readyState === 'interactive' && interactiveSinceMs > 0) {
      return performance.now() - interactiveSinceMs < SCROLL_CONFIG.INTERACTIVE_FAST_MS;
    }
    return false;
  }

  function getDefaultPageFraction() {
    return SCROLL_CONFIG.PAGE_FRACTION;
  }

  /** 将 iframe 传来的 distance 转为与 scrollPageByAxis 一致的 fraction */
  function resolveScrollFraction(distance, axis, explicitFraction) {
    if (typeof explicitFraction === 'number' && explicitFraction > 0) {
      return Math.min(explicitFraction, SCROLL_CONFIG.MAX_PAGE_FRACTION);
    }
    if (typeof distance === 'number' && distance > 0) {
      const span = getViewportSpan(axis);
      return Math.min(distance / Math.max(span, 1), SCROLL_CONFIG.MAX_PAGE_FRACTION);
    }
    return SCROLL_CONFIG.PAGE_FRACTION;
  }

  function isExplicitListScrollContainer(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === 'UL' || tag === 'OL' || tag === 'DL') return true;
    const role = el.getAttribute('role');
    return role === 'listbox' || role === 'list' || role === 'grid' || role === 'tree';
  }

  function hasExplicitOverflowScroll(el, axis = 'y') {
    if (!el || el.nodeType !== 1) return false;
    try {
      const vertical = axis === 'y';
      const style = window.getComputedStyle(el);
      const overflow = vertical ? style.overflowY : style.overflowX;
      return /(auto|scroll|overlay)/.test(overflow);
    } catch {
      return false;
    }
  }

  /** overflow scroll/auto 列表且手势点在容器内：锁定时不回退整页 */
  function isProtectedGestureScrollLockTarget(el, axis) {
    if (!el || !canScroll(el, axis)) return false;
    if (!hasExplicitOverflowScroll(el, axis)) return false;
    if (!isExplicitListScrollContainer(el)) return false;
    const pt = getScrollAnchorPoint();
    return elementContainsPoint(el, pt.x, pt.y);
  }

  /** 锁定路径 embed 判断：需媒体壳层特征，不单凭页面可滚余量更大 */
  function isLikelyEmbedShellForLock(el, axis) {
    if (!el || isRootScrollElement(el)) return false;
    if (isProtectedGestureScrollLockTarget(el, axis)) return false;
    if (isEmbedMediaElement(el)) return true;
    const elMax = getElementMaxScroll(el, axis);
    if (elMax < SCROLL_CONFIG.EDGE_EPSILON) return false;
    if (!isEmbedDominatedContainer(el, axis)) return false;
    const pageMax = getPageRootScrollRange(axis);
    if (pageMax > elMax * SCROLL_CONFIG.PAGE_DOMINANCE_RATIO && pageMax > 120) return true;
    return getScrollRangeRatio(el, axis) < SCROLL_CONFIG.TRAP_MAX_RANGE_RATIO;
  }

  function getGestureStartElementLight() {
    const gestureComposedPath = getComposedPath();
    if (gestureComposedPath && gestureComposedPath.length) {
      for (const node of gestureComposedPath) {
        if (node && node.nodeType === 1 && !isExtensionUiNode(node)) return node;
      }
    }
    const pt = getScrollAnchorPoint();
    return deepElementFromPoint(pt.x, pt.y, document);
  }

  /** 手势开始时一次性锁定滚动目标（轻量路径，不遍历媒体/阴影树） */
  function lockGestureScrollTargets() {
    clearGestureScrollLock();
    gestureScrollLock.active = true;
    gestureScrollLock.fastMode = shouldUseFastGestureScrollMode();
    const root = getDocumentScrollRoot();

    if (gestureScrollLock.fastMode) {
      gestureScrollLock.byAxis.y = root;
      gestureScrollLock.byAxis.x = root;
      return;
    }

    const path = getComposedPath();
    const startEl = getGestureStartElementLight();
    for (const axis of ['y', 'x']) {
      let target = findInnermostScrollableInPath(path, axis);
      if (!target && startEl) {
        target = getNearestScrollable(startEl, axis);
      }
      if (!target || !canScroll(target, axis) || isLikelyEmbedShellForLock(target, axis)) {
        target = root;
      }
      gestureScrollLock.byAxis[axis] = target;
    }
  }

  /** 松手前轻量校验锁定容器是否仍可滚；失效则回退 root */
  function revalidateGestureScrollLock(axis, direction) {
    if (!gestureScrollLock.active) return;
    const root = getDocumentScrollRoot();
    for (const ax of ['y', 'x']) {
      let locked = gestureScrollLock.byAxis[ax];
      const dir = ax === axis ? direction : 0;
      const valid =
        locked &&
        locked.isConnected &&
        canScroll(locked, ax) &&
        (dir === 0 || canScrollInDirection(locked, ax, dir));
      if (!valid) {
        if (dir !== 0 && canScrollInDirection(root, ax, dir)) {
          gestureScrollLock.byAxis[ax] = root;
        } else {
          gestureScrollLock.byAxis[ax] = root;
        }
      }
    }
  }

  function isGestureScrollContext(options) {
    return !!(options && options.gestureScroll) || gestureScrollLock.active;
  }

  function getNativeScrollBehavior() {
    return smoothEnabled() ? 'smooth' : 'instant';
  }

  function bindContext(context) {
    ctx = context;
  }

  function clearContainerCache() {
    cachedScrollContainer = null;
    cachedScrollContainerKey = '';
    clearGestureScrollLock();
  }

  function smoothEnabled() {
    return ctx && typeof ctx.getEnableSmoothScroll === 'function'
      ? !!ctx.getEnableSmoothScroll()
      : false;
  }

  function isExtensionUiNode(el) {
    if (!el || el.nodeType !== 1) return false;
    if (ctx && typeof ctx.isExtensionUiNode === 'function') {
      return ctx.isExtensionUiNode(el);
    }
    try {
      const host = document.getElementById('mouse-ext-ui-host');
      if (host && (el === host || host.contains(el))) return true;
    } catch { /* ignore */ }
    return false;
  }

  function getGesturePoints() {
    return ctx && ctx.getGesturePoints ? ctx.getGesturePoints() : null;
  }

  function getComposedPath() {
    return ctx && ctx.getComposedPath ? ctx.getComposedPath() : null;
  }

  function getIframePathHints() {
    return ctx && ctx.getIframePathHints ? ctx.getIframePathHints() : null;
  }

  function getIframeScrollAnchor() {
    return ctx && ctx.getIframeScrollAnchor ? ctx.getIframeScrollAnchor() : null;
  }

  function getScrollAnchorPoint() {
    const gesturePoints = getGesturePoints();
    if (gesturePoints && gesturePoints.length > 0) {
      return { x: gesturePoints[0].x, y: gesturePoints[0].y };
    }
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  }

  function getDocumentScrollRoot() {
    return document.scrollingElement || document.documentElement;
  }

  function isRootScrollElement(el) {
    const root = document.scrollingElement;
    return el === document.documentElement || el === document.body || el === root;
  }

  function getRootScrollRange(axis = 'y') {
    const vertical = axis === 'y';
    const body = document.body || document.documentElement;
    if (vertical) {
      const scrollHeight = Math.max(
        document.documentElement.scrollHeight,
        body.scrollHeight || 0
      );
      return Math.max(0, scrollHeight - window.innerHeight);
    }
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      body.scrollWidth || 0
    );
    return Math.max(0, scrollWidth - window.innerWidth);
  }

  function getElementScrollPos(el, axis = 'y') {
    if (isRootScrollElement(el)) {
      const body = document.body || document.documentElement;
      return axis === 'y'
        ? (window.scrollY ?? document.documentElement.scrollTop ?? body.scrollTop ?? 0)
        : (window.scrollX ?? document.documentElement.scrollLeft ?? body.scrollLeft ?? 0);
    }
    return axis === 'y' ? el.scrollTop : el.scrollLeft;
  }

  function getElementMaxScroll(el, axis = 'y') {
    if (isRootScrollElement(el)) {
      return getRootScrollRange(axis);
    }
    const vertical = axis === 'y';
    const scrollSize = vertical ? el.scrollHeight : el.scrollWidth;
    const clientSize = vertical ? el.clientHeight : el.clientWidth;
    return Math.max(0, scrollSize - clientSize);
  }

  function getElementClientSize(el, axis = 'y') {
    if (isRootScrollElement(el)) {
      return axis === 'y' ? window.innerHeight : window.innerWidth;
    }
    return axis === 'y' ? el.clientHeight : el.clientWidth;
  }

  function canScroll(el, axis = 'y') {
    if (!el || el.nodeType !== 1) return false;
    try {
      const vertical = axis === 'y';
      if (isRootScrollElement(el)) {
        return getElementMaxScroll(el, axis) > 2;
      }
      const style = window.getComputedStyle(el);
      const overflow = vertical ? style.overflowY : style.overflowX;
      const hasRange = vertical
        ? el.scrollHeight > el.clientHeight + 1
        : el.scrollWidth > el.clientWidth + 1;
      if (!hasRange) return false;
      return /(auto|scroll|overlay)/.test(overflow);
    } catch {
      return false;
    }
  }

  function canScrollInDirection(el, axis, direction) {
    if (!canScroll(el, axis)) return false;
    const pos = getElementScrollPos(el, axis);
    const max = getElementMaxScroll(el, axis);
    if (direction < 0) return pos > 2;
    if (direction > 0) return pos < max - 2;
    return max > 2;
  }

  function isElementScrollable(element, axis = 'y') {
    return canScroll(element, axis);
  }

  /** 相对视口的可滚余量；过小则更像嵌入壳层误报 scroll，而非用户意图的滚动区 */
  function scrollTrapMaxRangeRatio() {
    return SCROLL_CONFIG.TRAP_MAX_RANGE_RATIO;
  }
  /** 容器可视面积中被嵌入媒体 surface 占用的比例 */
  function scrollTrapEmbedCoverage() {
    return SCROLL_CONFIG.EMBED_COVERAGE;
  }
  /** 页面 root 可滚余量相对局部容器足够大时，判定手势应滚页面 */
  function pageScrollDominanceRatio() {
    return SCROLL_CONFIG.PAGE_DOMINANCE_RATIO;
  }

  function isEmbedMediaElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    return tag === 'IFRAME' || tag === 'VIDEO' || tag === 'EMBED' || tag === 'OBJECT';
  }

  function isMediaLikeSurfaceElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === 'IFRAME' || tag === 'VIDEO' || tag === 'EMBED' || tag === 'OBJECT' || tag === 'AUDIO' || tag === 'CANVAS') {
      return true;
    }
    if (tag === 'IMG') {
      try {
        const rect = el.getBoundingClientRect();
        const vp = window.innerWidth * window.innerHeight;
        return rect.width * rect.height >= vp * 0.12;
      } catch {
        return false;
      }
    }
    return false;
  }

  function walkElementTree(root, visit) {
    if (!root) return;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || node.nodeType !== 1) continue;
      visit(node);
      if (node.shadowRoot) {
        for (let i = node.shadowRoot.children.length - 1; i >= 0; i--) {
          stack.push(node.shadowRoot.children[i]);
        }
      }
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
  }

  function getViewportSpan(axis = 'y') {
    return axis === 'y' ? window.innerHeight : window.innerWidth;
  }

  function getScrollRangeRatio(el, axis = 'y') {
    const span = getViewportSpan(axis);
    if (span < 1) return 0;
    return getElementMaxScroll(el, axis) / span;
  }

  function getPageRootScrollRange(axis = 'y') {
    return getElementMaxScroll(getDocumentScrollRoot(), axis);
  }

  function getRectIntersectionArea(a, b) {
    const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return w * h;
  }

  /** 容器 client 区域内媒体 surface 占比（含 shadow 内 canvas/video 等），0~1 */
  function getMediaLikeCoverage(container) {
    if (!container || container.nodeType !== 1) return 0;
    if (isEmbedMediaElement(container) || isMediaLikeSurfaceElement(container)) return 1;

    const clientW = container.clientWidth;
    const clientH = container.clientHeight;
    if (clientW < 8 || clientH < 8) return 0;

    let mediaArea = 0;
    try {
      const containerRect = container.getBoundingClientRect();
      walkElementTree(container, (el) => {
        if (!isMediaLikeSurfaceElement(el) && !isEmbedMediaElement(el)) return;
        const rect = el.getBoundingClientRect();
        if (rect.width < 32 || rect.height < 32) return;
        mediaArea += getRectIntersectionArea(rect, containerRect);
      });
    } catch {
      return 0;
    }
    return Math.min(1, mediaArea / (clientW * clientH));
  }

  function isEmbedDominatedContainer(el, axis = 'y') {
    if (!el || el.nodeType !== 1 || isRootScrollElement(el)) return false;
    return getMediaLikeCoverage(el) >= scrollTrapEmbedCoverage();
  }

  function isMediaShellAtGesturePoint() {
    let el = getGestureStartElement();
    while (el) {
      if (isMediaLikeSurfaceElement(el) || isEmbedMediaElement(el)) return true;
      el = getParentNodeAcrossShadow(el);
    }
    return false;
  }

  /** 是否存在比当前容器更有滚动价值的祖先（避免误伤唯一可滚区域） */
  function hasMeaningfulScrollAncestor(el, axis = 'y') {
    const elMax = getElementMaxScroll(el, axis);
    for (let node = getParentNodeAcrossShadow(el); node; node = getParentNodeAcrossShadow(node)) {
      if (!canScroll(node, axis)) continue;
      const nodeMax = getElementMaxScroll(node, axis);
      if (nodeMax < 2) continue;
      if (isRootScrollElement(node)) return true;
      if (getScrollRangeRatio(node, axis) >= scrollTrapMaxRangeRatio()) return true;
      if (nodeMax >= elMax * 2 && nodeMax > 80) return true;
    }
    const root = getDocumentScrollRoot();
    return el !== root && el !== document.body && getElementMaxScroll(root, axis) >= 2;
  }

  /** 页面级滚动明显大于局部嵌入盒 → 手势更可能意图滚页面 */
  function shouldPreferPageScrollOver(el, axis = 'y') {
    if (!el || isRootScrollElement(el) || !isEmbedDominatedContainer(el, axis)) return false;
    const elMax = getElementMaxScroll(el, axis);
    const pageMax = getPageRootScrollRange(axis);
    if (pageMax > elMax * pageScrollDominanceRatio() && pageMax > 120) return true;
    if (getScrollRangeRatio(el, axis) < scrollTrapMaxRangeRatio() && pageMax > elMax) return true;
    return false;
  }

  /**
   * 嵌入媒体外包的可滚动壳层：内部主要是 iframe/video/canvas 等，
   * 且外层页面/祖先存在明显更大的可滚余量。
   */
  function isEmbedHostScrollTrap(el, axis = 'y') {
    if (!el || el.nodeType !== 1 || isRootScrollElement(el)) return false;
    if (!canScroll(el, axis) || getElementMaxScroll(el, axis) < 2) return false;
    if (!isEmbedDominatedContainer(el, axis)) return false;
    if (!hasMeaningfulScrollAncestor(el, axis)) return false;
    if (shouldPreferPageScrollOver(el, axis)) return true;
    return getScrollRangeRatio(el, axis) < scrollTrapMaxRangeRatio();
  }

  /** 子 frame 是否主要是嵌入媒体壳（本地几乎无可滚内容，应委托父页） */
  function isEmbedShellFrameDocument() {
    if (window === window.top) return false;
    const root = getDocumentScrollRoot();
    const body = document.body;
    const probe = body && body !== root ? body : root;
    if (!probe) return false;

    const rootRange = getScrollRangeRatio(root, 'y');
    const coverage = getMediaLikeCoverage(probe);

    if (isMediaShellAtGesturePoint() && rootRange < 0.45) return true;
    if (coverage >= scrollTrapEmbedCoverage() && rootRange < scrollTrapMaxRangeRatio()) return true;
    if (coverage >= scrollTrapEmbedCoverage() && rootRange < 0.45) return true;
    return false;
  }

  function shouldDelegateNestedFrameScroll(axis, direction) {
    if (window === window.top) return false;
    if (!isMediaShellAtGesturePoint()) return false;

    const target = findScrollableContainer(axis, direction);
    if (isEmbedHostScrollTrap(target, axis)) return true;

    const targetMax = getElementMaxScroll(target, axis);
    const frameMax = getPageRootScrollRange(axis);
    const targetRatio = getScrollRangeRatio(target, axis);

    if (targetRatio < SCROLL_CONFIG.FRAME_SHELL_RANGE_RATIO && frameMax < getViewportSpan(axis) * SCROLL_CONFIG.FRAME_SHELL_VIEWPORT_RATIO) return true;
    if (isEmbedDominatedContainer(target, axis) && frameMax <= targetMax * 1.25) return true;
    return false;
  }

  function getParentNodeAcrossShadow(node) {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    if (root instanceof ShadowRoot) return root.host;
    return null;
  }

  function getNearestScrollable(el, axis = 'y') {
    for (let node = el; node; node = getParentNodeAcrossShadow(node)) {
      if (node === document.documentElement) {
        if (canScroll(node, axis)) return node;
        break;
      }
      if (canScroll(node, axis)) return node;
    }
    return null;
  }

  function deepElementFromPoint(x, y, root) {
    root = root || document;
    let hits = [];
    try {
      if (typeof root.elementsFromPoint === 'function') {
        hits = root.elementsFromPoint(x, y);
      } else {
        const single = root.elementFromPoint(x, y);
        if (single) hits = [single];
      }
    } catch {
      return null;
    }

    for (const hit of hits) {
      if (!hit || hit.nodeType !== 1) continue;
      if (isExtensionUiNode(hit)) continue;
      if (hit.shadowRoot) {
        const inner = deepElementFromPoint(x, y, hit.shadowRoot);
        if (inner) return inner;
      }
      return hit;
    }
    return null;
  }

  function deepElementFromPointPierceFrames(x, y, root, depth) {
    if (depth > 4) return null;
    const el = deepElementFromPoint(x, y, root);
    if (!el) return null;
    if (el.tagName === 'IFRAME') {
      let doc;
      try {
        doc = el.contentDocument;
      } catch {
        return el;
      }
      if (doc) {
        const rect = el.getBoundingClientRect();
        const inner = deepElementFromPointPierceFrames(
          x - rect.left,
          y - rect.top,
          doc,
          depth + 1
        );
        if (inner) return inner;
      }
    }
    return el;
  }

  function getGestureStartElement() {
    const pt = getScrollAnchorPoint();
    const gestureComposedPath = getComposedPath();
    if (gestureComposedPath && gestureComposedPath.length) {
      for (const node of gestureComposedPath) {
        if (node && node.nodeType === 1 && !isExtensionUiNode(node)) return node;
      }
    }
    return deepElementFromPointPierceFrames(pt.x, pt.y, document, 0);
  }

  function serializeComposedPathForMessage(path) {
    if (!path || !path.length) return null;
    const hints = [];
    for (const node of path) {
      if (!node || node.nodeType !== 1) continue;
      if (node === document.documentElement || node === document.body) continue;
      hints.push({
        t: node.tagName || '',
        i: node.id || '',
        c: typeof node.className === 'string'
          ? node.className.split(/\s+/).filter(Boolean).slice(0, 4).join(' ')
          : ''
      });
      if (hints.length >= 24) break;
    }
    return hints.length ? hints : null;
  }

  function resolveTargetFromPathHints(root, hints) {
    if (!root || !hints || !hints.length) return null;
    for (const hint of hints) {
      if (!hint.t) continue;
      let el = null;
      try {
        const tag = hint.t.toLowerCase();
        if (hint.i && root.getElementById) {
          el = root.getElementById(hint.i);
          if (el && el.tagName !== hint.t) el = null;
        }
        if (!el && hint.i) {
          el = root.querySelector(tag + '#' + CSS.escape(hint.i));
        }
        if (!el && hint.c) {
          const cls = hint.c.split(/\s+/).filter(Boolean)[0];
          if (cls) {
            const list = root.querySelectorAll(tag + '.' + CSS.escape(cls));
            el = list[0] || null;
          }
        }
        if (!el) {
          const list = root.querySelectorAll(tag);
          el = list[0] || null;
        }
      } catch {
        el = null;
      }
      if (el && !isExtensionUiNode(el)) return el;
    }
    return null;
  }

  function findIframeAtPoint(x, y) {
    let node = deepElementFromPointPierceFrames(x, y, document, 0);
    while (node) {
      if (node.tagName === 'IFRAME') return node;
      node = node.parentElement;
    }
    return null;
  }

  function findScrollableInIframeContext(viewportPt, axis = 'y') {
    const iframeGestureComposedPathHints = getIframePathHints();
    if (!iframeGestureComposedPathHints || window !== window.top) return null;
    const iframe = findIframeAtPoint(viewportPt.x, viewportPt.y);
    if (!iframe) return null;
    let doc;
    try {
      doc = iframe.contentDocument;
    } catch {
      return null;
    }
    if (!doc) return null;
    const rect = iframe.getBoundingClientRect();
    const iframeGestureScrollAnchor = getIframeScrollAnchor();
    const localPt = iframeGestureScrollAnchor || {
      x: viewportPt.x - rect.left,
      y: viewportPt.y - rect.top
    };
    let target = resolveTargetFromPathHints(doc, iframeGestureComposedPathHints);
    if (!target) target = deepElementFromPoint(localPt.x, localPt.y, doc);
    if (!target) return null;
    const iframeScroll = getNearestScrollable(target, axis);
    if (iframeScroll && isEmbedHostScrollTrap(iframeScroll, axis)) return null;
    return iframeScroll;
  }

  function findInnermostScrollableInPath(path, axis = 'y') {
    if (!path || !path.length) return null;
    for (const node of path) {
      if (!node || node.nodeType !== 1 || isExtensionUiNode(node)) continue;
      if (canScroll(node, axis) && getElementMaxScroll(node, axis) >= 2) {
        if (!isEmbedHostScrollTrap(node, axis)) return node;
      }
    }
    return null;
  }

  function resolveGestureScrollChain(axis = 'y') {
    const pt = getScrollAnchorPoint();
    const startEl = getGestureStartElement();
    const gestureComposedPath = getComposedPath();
    const chain = [];
    const seen = new Set();
    const add = (node) => {
      if (!node || node.nodeType !== 1 || seen.has(node)) return;
      if (!canScroll(node, axis)) return;
      seen.add(node);
      chain.push(node);
    };

    if (gestureComposedPath) {
      for (const node of gestureComposedPath) add(node);
    }
    if (startEl) {
      for (let node = startEl; node; node = getParentNodeAcrossShadow(node)) {
        add(node);
        if (node === document.documentElement || node === document.body) break;
      }
    }
    if (window === window.top && getIframePathHints()) {
      const iframeScroll = findScrollableInIframeContext(pt, axis);
      if (iframeScroll && canScroll(iframeScroll, axis)) {
        const idx = chain.indexOf(iframeScroll);
        if (idx > 0) {
          chain.splice(idx, 1);
          chain.unshift(iframeScroll);
        } else if (idx < 0) {
          chain.unshift(iframeScroll);
          seen.add(iframeScroll);
        }
      }
    }
    const root = getDocumentScrollRoot();
    add(root);
    if (document.body && document.body !== root) add(document.body);
    return chain;
  }

  function getVisibleViewportArea(el) {
    try {
      const rect = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
      const h = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      return w * h;
    } catch {
      return 0;
    }
  }

  function elementContainsPoint(el, x, y) {
    try {
      const rect = el.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    } catch {
      return false;
    }
  }

  function pickFallbackScrollContainer(chain, axis = 'y') {
    const root = getDocumentScrollRoot();
    const minVisible = window.innerWidth * window.innerHeight * 0.05;
    let best = root;
    let bestVisible = -1;
    for (const el of chain) {
      if (getElementMaxScroll(el, axis) < 2) continue;
      const visible = getVisibleViewportArea(el);
      if (visible < minVisible && !isRootScrollElement(el)) continue;
      if (visible > bestVisible) {
        bestVisible = visible;
        best = el;
      }
    }
    return best;
  }

  function pickInnermostScrollContainer(chain, axis = 'y') {
    const inner = findInnermostScrollableInPath(getComposedPath(), axis);
    if (inner) return inner;

    const pt = getScrollAnchorPoint();
    for (const el of chain) {
      if (isRootScrollElement(el)) continue;
      if (getElementMaxScroll(el, axis) < 2) continue;
      if (isEmbedHostScrollTrap(el, axis)) continue;
      if (elementContainsPoint(el, pt.x, pt.y)) return el;
    }
    return pickFallbackScrollContainer(chain, axis);
  }

  /** 从手势起点向上 walk，跳过该方向已无余量的容器 */
  function walkScrollTargetFromPoint(axis, direction) {
    let el = getGestureStartElement();
    while (el) {
      if (canScrollInDirection(el, axis, direction) && !isEmbedHostScrollTrap(el, axis)) {
        return el;
      }
      if (isRootScrollElement(el)) break;
      el = getParentNodeAcrossShadow(el);
    }
    return null;
  }

  function pickDirectionalScrollContainer(chain, axis, direction) {
    if (direction === 0) return pickInnermostScrollContainer(chain, axis);
    for (const el of chain) {
      if (!canScrollInDirection(el, axis, direction)) continue;
      if (isEmbedHostScrollTrap(el, axis)) continue;
      return el;
    }
    const walked = walkScrollTargetFromPoint(axis, direction);
    if (walked) return walked;
    return getDocumentScrollRoot();
  }

  function findNextScrollContainerInChain(chain, current, axis, direction) {
    let passed = false;
    for (const el of chain) {
      if (el === current) {
        passed = true;
        continue;
      }
      if (passed && canScrollInDirection(el, axis, direction) && !isEmbedHostScrollTrap(el, axis)) {
      return el;
    }
    }
    return null;
  }

  function findScrollableContainer(axis = 'y', direction = 0, options = {}) {
    const forceRoot = options.forceRoot === true;
    if (forceRoot) return getDocumentScrollRoot();

    if (gestureScrollLock.active) {
      const locked = gestureScrollLock.byAxis[axis] || getDocumentScrollRoot();
      if (locked.isConnected && (direction === 0 || canScrollInDirection(locked, axis, direction))) {
        return locked;
      }
      return getDocumentScrollRoot();
    }

    const pt = getScrollAnchorPoint();
    const key = Math.round(pt.x) + ',' + Math.round(pt.y) + ',' + axis + ',' + direction;
    if (cachedScrollContainerKey === key && cachedScrollContainer && cachedScrollContainer.isConnected) {
      if (direction === 0 || canScrollInDirection(cachedScrollContainer, axis, direction)) {
        return cachedScrollContainer;
      }
    }

    const chain = resolveGestureScrollChain(axis);
    const result = pickDirectionalScrollContainer(chain, axis, direction);

    cachedScrollContainerKey = key;
    cachedScrollContainer = result;
    return result;
  }

  /** 当前帧内是否还能在本地完成该方向滚动（iframe 委托主框架前判断） */
  function isLocalScrollFeasible(axis, direction) {
    const target = findScrollableContainer(axis, direction);
    return canScrollInDirection(target, axis, direction);
  }

  function shouldScrollIframeLocally(axis, direction) {
    if (shouldUseFastGestureScrollMode()) return false;
    if (shouldDeferHeavyScrollProbe()) return false;
    if (isEmbedShellFrameDocument()) return false;
    if (shouldDelegateNestedFrameScroll(axis, direction)) return false;
    if (!isLocalScrollFeasible(axis, direction)) return false;
    const target = findScrollableContainer(axis, direction);
    return !isEmbedHostScrollTrap(target, axis);
  }

  function trackNativeSmoothScroll(el, axis) {
    if (!ctx || typeof ctx.beginGestureScrollSession !== 'function') return;
    const isRoot = isRootScrollElement(el);
    ctx.beginGestureScrollSession(isRoot ? window : el, axis);
  }

  function applyScrollBy(scrollContainer, amount, axis) {
    const behavior = getNativeScrollBehavior();
    if (behavior === 'smooth') trackNativeSmoothScroll(scrollContainer, axis);
    const scrollOptions = axis === 'x'
      ? { left: amount, behavior }
      : { top: amount, behavior };
    if (isRootScrollElement(scrollContainer)) window.scrollBy(scrollOptions);
    else scrollContainer.scrollBy(scrollOptions);
  }

  function scrollElementTo(el, value, axis) {
    if (!el) return;
    const isRoot = isRootScrollElement(el);
    const scrollEl = isRoot ? getDocumentScrollRoot() : el;
    const behavior = getNativeScrollBehavior();
    if (behavior === 'smooth') trackNativeSmoothScroll(el, axis);
    const scrollOptions = axis === 'x'
      ? { left: value, behavior }
      : { top: value, behavior };
    if (isRoot) window.scrollTo(scrollOptions);
    else scrollEl.scrollTo(scrollOptions);
  }

  function scrollByOnElement(el, amount, axis, options = {}) {
    if (!el) return;
    const direction = amount > 0 ? 1 : -1;
    const scrollPos = getElementScrollPos(el, axis);
    const maxScroll = getElementMaxScroll(el, axis);
    const target = direction > 0
      ? Math.min(maxScroll, scrollPos + Math.abs(amount))
      : Math.max(0, scrollPos - Math.abs(amount));
    if (Math.abs(target - scrollPos) < 2) {
      if (isGestureScrollContext(options)) {
        if (!isRootScrollElement(el)) {
          scrollByOnElement(getDocumentScrollRoot(), amount, axis, options);
        }
        return;
      }
      const chain = resolveGestureScrollChain(axis);
      const next = findNextScrollContainerInChain(chain, el, axis, direction);
      if (next) {
        scrollByOnElement(next, amount, axis, options);
        return;
      }
      if (!isRootScrollElement(el)) {
        scrollByOnElement(getDocumentScrollRoot(), amount, axis, options);
        return;
      }
      if (Math.abs(amount) >= 2) {
        applyScrollBy(getDocumentScrollRoot(), amount, axis);
      }
      return;
    }
    applyScrollBy(el, amount, axis);
  }

  function scrollPageByAxisOnElement(el, axis, direction, fraction, options = {}) {
    const pageFraction = resolveScrollFraction(null, axis, fraction);
    const scrollPos = getElementScrollPos(el, axis);
    const maxScroll = getElementMaxScroll(el, axis);
    const distance = Math.round(getElementClientSize(el, axis) * pageFraction);
    const target = direction < 0
      ? Math.max(0, scrollPos - distance)
      : Math.min(maxScroll, scrollPos + distance);

    if (Math.abs(target - scrollPos) < 2) {
      if (isGestureScrollContext(options)) {
        if (!isRootScrollElement(el)) {
          scrollPageByAxisOnElement(getDocumentScrollRoot(), axis, direction, fraction, options);
        }
        return;
      }
      const chain = resolveGestureScrollChain(axis);
      const next = findNextScrollContainerInChain(chain, el, axis, direction);
      if (next) {
        scrollPageByAxisOnElement(next, axis, direction, fraction, options);
        return;
      }
      const root = getDocumentScrollRoot();
      if (!isRootScrollElement(el)) {
        scrollPageByAxisOnElement(root, axis, direction, fraction, options);
        return;
      }
      const fallbackAmount = Math.round((axis === 'y' ? window.innerHeight : window.innerWidth) * pageFraction);
      const fallbackTarget = direction < 0
        ? Math.max(0, scrollPos - fallbackAmount)
        : Math.min(getRootScrollRange(axis), scrollPos + fallbackAmount);
      if (Math.abs(fallbackTarget - scrollPos) >= 2) {
        scrollElementTo(root, fallbackTarget, axis);
      }
      return;
    }
    scrollElementTo(el, target, axis);
  }

  function scrollPageByAxis(axis, direction, fraction, options = {}) {
    revalidateGestureScrollLock(axis, direction);
    const pageFraction = resolveScrollFraction(null, axis, fraction);
    try {
      const el = findScrollableContainer(axis, direction, options) || document.documentElement;
      scrollPageByAxisOnElement(el, axis, direction, pageFraction, options);
    } catch (error) {
      console.log('scrollPageByAxis error:', error.message);
      const root = getDocumentScrollRoot();
      const amount =
        Math.round(getViewportSpan(axis) * pageFraction) * (direction < 0 ? -1 : 1);
      const target = getElementScrollPos(root, axis) + amount;
      scrollElementTo(root, target, axis);
    }
  }

  function scrollToExtremity(axis, toTop, options = {}) {
    revalidateGestureScrollLock(axis, toTop ? -1 : 1);
    try {
      const root = getDocumentScrollRoot();
      let target;
      if (options.forceRoot) {
        target = root;
      } else if (gestureScrollLock.active) {
        target = gestureScrollLock.byAxis[axis] || root;
      } else {
        const chain = resolveGestureScrollChain(axis);
        target = chain.length ? pickInnermostScrollContainer(chain, axis) : root;
      }
      if (!target) return;
      scrollElementTo(target, toTop ? 0 : getElementMaxScroll(target, axis), axis);
    } catch (error) {
      console.log('scrollToExtremity error:', error.message);
      const root = getDocumentScrollRoot();
      scrollElementTo(root, toTop ? 0 : getElementMaxScroll(root, axis), axis);
    }
  }

  function scrollToPosition(position) {
    try {
      const root = getDocumentScrollRoot();
      const numericPosition = Number(position);
      if (!Number.isFinite(numericPosition)) return false;
      const target = Math.max(0, Math.min(getElementMaxScroll(root, 'y'), numericPosition));
      scrollElementTo(root, target, 'y');
      return true;
    } catch (error) {
      console.log('滚动到指定位置时出错:', error.message);
      return false;
    }
  }

  /** iframe / background 委托与 top 本地统一：按 scrollPageByAxis + forceRoot 执行 */
  function performPageScrollAction(action, opts = {}) {
    const map = {
      scrollUp: ['y', -1],
      scrollDown: ['y', 1],
      scrollLeft: ['x', -1],
      scrollRight: ['x', 1]
    };
    const pair = map[action];
    if (!pair) return false;
    const root = getDocumentScrollRoot();
    const axis = pair[0];
    const direction = pair[1];
    const before = getElementScrollPos(root, axis);
    const maxScroll = getElementMaxScroll(root, axis);
    const atEdge =
      (direction < 0 && before <= 2) || (direction > 0 && before >= maxScroll - 2);
    const fraction = resolveScrollFraction(opts.distance, axis, opts.fraction);
    scrollPageByAxis(
      axis,
      direction,
      fraction,
      Object.assign({ forceRoot: true }, opts)
    );
    return !atEdge;
  }

  function performScroll(distance, options = {}) {
    try {
      if (options.forceRoot) {
        const direction = distance > 0 ? 1 : -1;
        scrollPageByAxis('y', direction, resolveScrollFraction(Math.abs(distance), 'y'), options);
        return true;
      }
      const direction = distance > 0 ? 1 : -1;
      const scrollAmount = Math.abs(distance) * direction;
      const scrollContainer = findScrollableContainer('y', direction, options);
      scrollByOnElement(scrollContainer, scrollAmount, 'y', options);
      return true;
    } catch (error) {
      console.log('执行滚动时出错:', error.message);
      try {
        const root = getDocumentScrollRoot();
        scrollByOnElement(root, distance, 'y', options);
        return true;
      } catch (e) {
        return false;
      }
    }
  }

  function performHorizontalScroll(distance, options = {}) {
    try {
      if (options.forceRoot) {
        const direction = distance > 0 ? 1 : -1;
        scrollPageByAxis('x', direction, resolveScrollFraction(Math.abs(distance), 'x'), options);
        return true;
      }
      const direction = distance > 0 ? 1 : -1;
      const scrollAmount = Math.abs(distance) * direction;
      const scrollContainer = findScrollableContainer('x', direction, options);
      scrollByOnElement(scrollContainer, scrollAmount, 'x', options);
      return true;
    } catch (error) {
      console.log('执行水平滚动时出错:', error.message);
      try {
        const root = getDocumentScrollRoot();
        scrollByOnElement(root, distance, 'x', options);
        return true;
      } catch (e) {
        return false;
      }
    }
  }

  global.MouseScrollGesture = {
    bindContext,
    clearContainerCache,
    lockGestureScrollTargets,
    getDefaultPageFraction,
    performPageScrollAction,
    resolveScrollFraction,
    SCROLL_CONFIG,
    serializeComposedPathForMessage,
    findScrollableContainer,
    isLocalScrollFeasible,
    shouldScrollIframeLocally,
    scrollPageByAxis,
    scrollToExtremity,
    scrollToPosition,
    performScroll,
    performHorizontalScroll,
    canScroll,
    isElementScrollable
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
