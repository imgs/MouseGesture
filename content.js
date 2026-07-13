/** 防止扩展更新重复注入时重复注册监听器 */
function mouseExtListenerFlag(name) {
  const G = typeof globalThis !== 'undefined' ? globalThis : window;
  const key = '__mouseExt_' + name;
  if (G[key]) return false;
  G[key] = true;
  return true;
}

const CONTENT_SETTINGS_API = globalThis.MouseExtSettings;

function syncMouseExtUiLocale() {
  try {
    if (typeof MouseExtUiHost !== 'undefined' && typeof MouseExtUiHost.setLocale === 'function') {
      MouseExtUiHost.setLocale(settings && settings.language ? settings.language : getBrowserLanguage());
    }
  } catch (e) { /* ignore */ }
}

function isTrustedUserEvent(e) {
  return !!(e && e.isTrusted === true);
}

const MOUSE_EXT_HTML_NS = 'http://www.w3.org/1999/xhtml';

function createMouseExtElement(tagName, options) {
  const tag = String(tagName || '').toLowerCase();
  let el = null;
  try {
    el = document.createElement(tagName, options);
  } catch (e) {
    el = null;
  }
  if (!isMouseExtHtmlElementUsable(el, tag)) {
    try {
      el = document.createElementNS(MOUSE_EXT_HTML_NS, tagName);
    } catch (e) {
      el = null;
    }
  }
  if (!isMouseExtHtmlElementUsable(el, tag)) {
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

function isMouseExtHtmlElementUsable(el, tag) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  if (tag === 'canvas') return typeof el.getContext === 'function' && !!el.style;
  return !!el.style;
}

function setMouseExtStyle(el, name, value, priority = '') {
  if (!el || !el.style) return false;
  try {
    if (priority && typeof el.style.setProperty === 'function') {
      const cssName = String(name).replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
      el.style.setProperty(cssName, value, priority);
    } else {
      el.style[name] = value;
    }
    return true;
  } catch (e) {
    return false;
  }
}

function setMouseExtStyles(el, styles, priority = '') {
  if (!el || !el.style || !styles) return false;
  Object.keys(styles).forEach((name) => setMouseExtStyle(el, name, styles[name], priority));
  return true;
}

// 性能优化工具函数
function debounce(func, wait, immediate = false) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      timeout = null;
      if (!immediate) func.apply(this, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(this, args);
  };
}

function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// 缓存DOM查询结果
const domCache = new Map();
function cachedQuerySelector(selector) {
  if (domCache.has(selector)) {
    return domCache.get(selector);
  }
  const element = document.querySelector(selector);
  if (element) {
    domCache.set(selector, element);
    
    // 限制缓存大小，防止内存泄漏
    if (domCache.size > CONFIG.CACHE_MAX_SIZE) {
      const firstKey = domCache.keys().next().value;
      domCache.delete(firstKey);
    }
  }
  return element;
}

// 内存管理和事件监听器清理
const eventListeners = new Map();

function addManagedEventListener(element, event, handler, options = {}) {
  const key = `${element.constructor.name}_${event}_${handler.name || 'anonymous'}`;
  
  // 如果已存在相同的监听器，先移除
  if (eventListeners.has(key)) {
    const { elem, evt, hdlr } = eventListeners.get(key);
    elem.removeEventListener(evt, hdlr, options);
  }
  
  // 添加新的监听器
  element.addEventListener(event, handler, options);
  eventListeners.set(key, { elem: element, evt: event, hdlr: handler, opts: options });
}

function removeManagedEventListener(element, event, handler) {
  const key = `${element.constructor.name}_${event}_${handler.name || 'anonymous'}`;
  if (eventListeners.has(key)) {
    element.removeEventListener(event, handler);
    eventListeners.delete(key);
  }
}

function cleanupAllEventListeners() {
  stopAllGestureStateWatchers();
  for (const [key, { elem, evt, hdlr, opts }] of eventListeners) {
    try {
      elem.removeEventListener(evt, hdlr, opts);
    } catch (e) {
      console.warn('清理事件监听器失败:', e);
    }
  }
  eventListeners.clear();
  domCache.clear();
}

// 页面卸载时清理资源
if (mouseExtListenerFlag('beforeunloadCleanup')) {
  window.addEventListener('beforeunload', cleanupAllEventListeners);
  window.addEventListener('pagehide', cleanupAllEventListeners);
}

// 监听页面可见性变化，处理标签切换时的手势轨迹清理
if (mouseExtListenerFlag('visibilityGestureCleanup')) {
document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    // 页面变为不可见时（标签切换），立即清理手势轨迹
    if (isGestureInProgress) {
      resetGestureState();
    }
    clearGestureCanvas();
  }
});
}

// 监听窗口焦点变化，处理窗口切换时的手势轨迹清理
if (mouseExtListenerFlag('windowBlurGestureCleanup')) {
window.addEventListener('blur', function() {
  dismissTrailRegionChooser();
  // 窗口失去焦点时，清理手势轨迹
  if (isGestureInProgress) {
    resetGestureState();
  }
  clearGestureCanvas();
});
}

// 监听窗口获得焦点，重新初始化手势画布
if (mouseExtListenerFlag('windowFocusGestureInit')) {
window.addEventListener('focus', function() {
  // 窗口获得焦点时，如果需要显示轨迹，重新初始化画布
  if (settings.showGestureTrail && !gestureCanvas) {
    initGestureCanvas();
  }
});
}

// 公共函数 - 消除代码重复
const CommonUtils = {
  // 统一的URL验证函数
  isValidLink(link) {
    return link && link.href && !link.href.toLowerCase().startsWith('javascript:');
  },
  
  // 统一的元素可见性检查
  isElementVisible(element) {
    return element && element.offsetWidth > 0 && element.offsetHeight > 0;
  },
  
  // 统一的安全执行函数
  safeExecute(fn, context = 'Unknown', fallbackValue = null) {
    try {
      return fn();
    } catch (error) {
      console.warn(`Error in ${context}:`, error.message);
      return fallbackValue;
    }
  },
  
  // 统一的DOM操作函数
  safeRemoveElement(element) {
    if (element && element.parentNode) {
      try {
        element.parentNode.removeChild(element);
        return true;
      } catch (e) {
        console.warn('移除元素失败:', e);
        return false;
      }
    }
    return false;
  },
  
  // 统一的延迟执行函数
  delayedExecute(fn, delay = CONFIG.NAVIGATION_DELAY, context = 'Unknown') {
    return setTimeout(() => {
      this.safeExecute(fn, context);
    }, delay);
  },
  
  // 统一的元素查找函数
  findElementWithValidation(selectors, validator = this.isElementVisible) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && validator(element)) {
        return element;
      }
    }
    return null;
  },
  
  // 统一的事件处理函数
  createDebouncedHandler(handler, delay = CONFIG.PERFORMANCE_THROTTLE) {
    return debounce(handler, delay);
  },
  
  // 统一的URL标准化函数
  normalizeUrl(url) {
    if (!url) return '';
    try {
      const urlObj = new URL(url);
      return urlObj.origin + urlObj.pathname + urlObj.search;
    } catch (e) {
      return url.toLowerCase().trim();
    }
  }
};

// ===== 原生手势滚动会话 =====

const GESTURE_NATIVE_SCROLL_END_MS = 800;
const gestureScrollSession = {
  active: false,
  nativeTarget: null,
  nativeAxis: 'y',
  pageSmoothOverrides: [],
  endTimer: null,
  scrollEndHandler: null,
  scrollEndEl: null,
  wheelAttached: false
};

function attachGestureScrollWheelCancel() {
  if (gestureScrollSession.wheelAttached) return;
  window.addEventListener('wheel', handleWheelCancelGestureScroll, { capture: true, passive: true });
  gestureScrollSession.wheelAttached = true;
}

function detachGestureScrollWheelCancel() {
  if (!gestureScrollSession.wheelAttached) return;
  window.removeEventListener('wheel', handleWheelCancelGestureScroll, { capture: true });
  gestureScrollSession.wheelAttached = false;
}

function handleWheelCancelGestureScroll() {
  if (gestureScrollSession.active) cancelActiveGestureScroll();
}

function clearGestureScrollEndTimer() {
  if (gestureScrollSession.endTimer) {
    clearTimeout(gestureScrollSession.endTimer);
    gestureScrollSession.endTimer = null;
  }
}

function clearGestureScrollEndListener() {
  if (gestureScrollSession.scrollEndEl && gestureScrollSession.scrollEndHandler) {
    gestureScrollSession.scrollEndEl.removeEventListener('scrollend', gestureScrollSession.scrollEndHandler);
  }
  gestureScrollSession.scrollEndEl = null;
  gestureScrollSession.scrollEndHandler = null;
}

function freezeNativeSmoothScroll(target, axis) {
  if (!target) return;
  const isWindow = target === window
    || target === document.documentElement
    || target === document.body;
  if (axis === 'x') {
    const x = isWindow ? (window.scrollX ?? document.documentElement.scrollLeft ?? 0) : target.scrollLeft;
    if (isWindow) window.scrollTo({ left: x, top: window.scrollY ?? 0, behavior: 'instant' });
    else target.scrollTo({ left: x, top: target.scrollTop, behavior: 'instant' });
  } else {
    const y = isWindow ? (window.scrollY ?? document.documentElement.scrollTop ?? 0) : target.scrollTop;
    if (isWindow) window.scrollTo({ top: y, left: window.scrollX ?? 0, behavior: 'instant' });
    else target.scrollTo({ top: y, left: target.scrollLeft, behavior: 'instant' });
  }
}

function getPageSmoothScrollOverrideElements(target) {
  const rootScroll = target === window
    || target === document.documentElement
    || target === document.body
    || target === document.scrollingElement;
  const candidates = rootScroll
    ? [document.documentElement, document.body, document.scrollingElement]
    : [target];
  return candidates.filter((element, index) => (
    element
    && element.nodeType === 1
    && candidates.indexOf(element) === index
    && element.style
  ));
}

function disablePageSmoothScroll(target) {
  return getPageSmoothScrollOverrideElements(target).map((element) => {
    const value = element.style.getPropertyValue('scroll-behavior');
    const priority = element.style.getPropertyPriority('scroll-behavior');
    element.style.setProperty('scroll-behavior', 'auto', 'important');
    return { element, value, priority };
  });
}

function restorePageSmoothScroll(overrides) {
  for (const override of overrides || []) {
    const { element, value, priority } = override;
    if (!element || !element.style) continue;
    const currentValue = element.style.getPropertyValue('scroll-behavior');
    const currentPriority = element.style.getPropertyPriority('scroll-behavior');
    if (currentValue !== 'auto' || currentPriority !== 'important') continue;
    if (value) element.style.setProperty('scroll-behavior', value, priority);
    else element.style.removeProperty('scroll-behavior');
  }
}

function cancelActiveGestureScroll() {
  if (!gestureScrollSession.active) {
    if (gestureScrollSession.pageSmoothOverrides.length) {
      restorePageSmoothScroll(gestureScrollSession.pageSmoothOverrides);
      gestureScrollSession.pageSmoothOverrides = [];
    }
    return;
  }

  clearGestureScrollEndTimer();
  clearGestureScrollEndListener();

  if (gestureScrollSession.nativeTarget) {
    freezeNativeSmoothScroll(gestureScrollSession.nativeTarget, gestureScrollSession.nativeAxis);
  }
  restorePageSmoothScroll(gestureScrollSession.pageSmoothOverrides);

  gestureScrollSession.active = false;
  gestureScrollSession.nativeTarget = null;
  gestureScrollSession.nativeAxis = 'y';
  gestureScrollSession.pageSmoothOverrides = [];
  detachGestureScrollWheelCancel();
}

function endGestureScrollSession() {
  clearGestureScrollEndTimer();
  clearGestureScrollEndListener();
  restorePageSmoothScroll(gestureScrollSession.pageSmoothOverrides);
  gestureScrollSession.active = false;
  gestureScrollSession.nativeTarget = null;
  gestureScrollSession.nativeAxis = 'y';
  gestureScrollSession.pageSmoothOverrides = [];
  detachGestureScrollWheelCancel();
}

function scheduleNativeScrollSessionEnd() {
  clearGestureScrollEndTimer();
  gestureScrollSession.endTimer = setTimeout(endGestureScrollSession, GESTURE_NATIVE_SCROLL_END_MS);
}

function watchNativeScrollEnd(target) {
  const el = (!target || target === window) ? window : target;
  clearGestureScrollEndListener();
  if ('onscrollend' in window) {
    const onEnd = () => {
      if (gestureScrollSession.active) endGestureScrollSession();
    };
    gestureScrollSession.scrollEndEl = el;
    gestureScrollSession.scrollEndHandler = onEnd;
    el.addEventListener('scrollend', onEnd, { passive: true, once: true });
    return;
  }
  scheduleNativeScrollSessionEnd();
}

function beginGestureScrollSession(nativeTarget, nativeAxis) {
  cancelActiveGestureScroll();
  gestureScrollSession.active = true;
  gestureScrollSession.nativeTarget = nativeTarget || window;
  gestureScrollSession.nativeAxis = nativeAxis || 'y';
  gestureScrollSession.pageSmoothOverrides = disablePageSmoothScroll(
    gestureScrollSession.nativeTarget
  );
  attachGestureScrollWheelCancel();
  watchNativeScrollEnd(gestureScrollSession.nativeTarget);
}

function getDesktopPlatformToken() {
  const uaDataPlatform = navigator.userAgentData && navigator.userAgentData.platform;
  return String(uaDataPlatform || navigator.platform || navigator.userAgent || '').toLowerCase();
}

const desktopPlatformToken = getDesktopPlatformToken();
const isMacOS = desktopPlatformToken.includes('mac');
const isAndroidOS = desktopPlatformToken.includes('android');
const isLinuxOS = !isAndroidOS && desktopPlatformToken.includes('linux');

// 检查元素是否为文本输入框
function isTextInputElement(element) {
  if (!element) return false;
  
  try {
    // 检查元素标签名
    const tagName = element.tagName?.toLowerCase();
    if (!tagName) return false;
    
    // 直接的文本输入元素
    if (tagName === 'input') {
      const inputType = (element.getAttribute('type') || '').toLowerCase();
      // 排除不是文本输入的input类型
      const nonTextTypes = ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 
                            'radio', 'range', 'reset', 'submit'];
      return !nonTextTypes.includes(inputType);
    }
    
    // 文本区域
    if (tagName === 'textarea') return true;
    
    // 可编辑内容
    if (element.isContentEditable) return true;
    
    // 具有可编辑角色的元素
    const role = element.getAttribute('role');
    if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return true;
    
    // 检查contenteditable属性
    if (element.getAttribute('contenteditable') === 'true') return true;
    
    return false;
  } catch (error) {
    // 出错时安全返回false
    return false;
  }
}

/** 页面可点击控件（按钮、链接、表单等），合成图片拖拽不应抢占其 pointer/click */
function isPageFunctionalControlElement(element) {
  if (!element || element.nodeType !== 1) return false;
  try {
    if (isTextInputElement(element)) return true;
    if (element.closest('[contenteditable="true"]')) return true;
    if (element.closest('a[href]')) return true;
    const tag = element.tagName;
    if (tag === 'IMG' || tag === 'VIDEO' || tag === 'PICTURE') return false;
    return !!element.closest(
      'button, input, select, textarea, summary, label[for], [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [role="option"]'
    );
  } catch (e) {
    return false;
  }
}

/** 图片超级拖拽：仅在实际可编辑控件上放弃；链接包裹/透明层覆盖的图片仍允许 */
function shouldBlockImageSuperDragForTarget(target) {
  if (!target || target.nodeType !== 1) return false;
  try {
    if (isTextInputElement(target)) return true;
    if (target.closest && target.closest('[contenteditable="true"]')) return true;
    return false;
  } catch (e) {
    return false;
  }
}

function shouldForceDraggableForImage(imgEl) {
  if (!settings?.enableImageDrag) return false;
  if (!imgEl || imgEl.tagName !== 'IMG') return false;
  if (shouldBlockImageSuperDragForTarget(imgEl)) return false;
  // 轮播组件通常故意设置 draggable="false" 来保证滑动体验；
  // 不在轮播内强行改回 true，图片超级拖拽交给 pointer 合成兜底。
  if (getImageDragCarouselContext(imgEl)) return false;
  const src = getImageElementUrl(imgEl);
  return !!(src && !src.startsWith('data:'));
}

const IMAGE_DRAG_CAROUSEL_SELECTOR = [
  '.glide',
  '.glide__track',
  '.glide__slides',
  '.glide__slide',
  '.swiper',
  '.swiper-container',
  '.swiper-wrapper',
  '.swiper-slide',
  '.slick-slider',
  '.slick-list',
  '.slick-track',
  '.slick-slide',
  '.splide',
  '.splide__track',
  '.splide__list',
  '.splide__slide',
  '.owl-carousel',
  '.owl-stage',
  '.owl-item',
  '.flickity-enabled',
  '.flickity-slider',
  '.keen-slider',
  '.keen-slider__slide',
  '.embla',
  '.embla__container',
  '.embla__slide',
  '.carousel',
  '.slider',
  '.slides',
  '.slide',
  '[data-glide-el]',
  '[data-swiper]',
  '[data-slick]',
  '[aria-roledescription="carousel"]'
].join(',');

const IMAGE_DRAG_CAROUSEL_AXIS_RE = /\b(vertical|y-axis|axis-y|swiper-vertical|splide--ttb)\b/i;
const IMAGE_DRAG_CAROUSEL_HORIZONTAL_AXIS_RE = /\b(horizontal|x-axis|axis-x|swiper-horizontal|splide--ltr|splide--rtl)\b/i;
const IMAGE_DRAG_CAROUSEL_CLASS_RE = /\b(glide(?:__track|__slides?|__slide)?|swiper-container(?:-[\w-]+)?|swiper-wrapper|swiper-slide|swiper-horizontal|swiper-vertical|slick-(?:slider|list|track|slide)|splide(?:__track|__list|__slide)?|owl-carousel|owl-stage|owl-item|flickity-enabled|flickity-slider|keen-slider(?:__slide)?|embla(?:__container|__slide)?|carousel|slider|slides?|slide)\b/i;

function getCarouselClassText(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
  return [
    el.className && typeof el.className === 'string' ? el.className : '',
    el.id || '',
    el.getAttribute?.('data-glide-el') || '',
    el.getAttribute?.('data-swiper') || '',
    el.getAttribute?.('data-slick') || '',
    el.getAttribute?.('aria-roledescription') || ''
  ].join(' ');
}

function getCarouselDirectSlideCount(track) {
  if (!track || !track.children) return 0;
  let count = 0;
  const children = track.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const text = getCarouselClassText(child);
    if (/\b(glide__slide|swiper-slide|slick-slide|splide__slide|owl-item|keen-slider__slide|embla__slide|slide)\b/i.test(text)) {
      count++;
    }
  }
  return count;
}

function isCarouselTrackScrollable(root, track, axis) {
  try {
    const viewport = root || track;
    if (!viewport || !track) return true;
    if (axis === 'vertical') {
      return (track.scrollHeight || 0) > (viewport.clientHeight || track.clientHeight || 0) + 8;
    }
    return (track.scrollWidth || 0) > (viewport.clientWidth || track.clientWidth || 0) + 8;
  } catch (_) {
    return true;
  }
}

function canCarouselActuallySwipe(root, track, axis) {
  const slideCount = getCarouselDirectSlideCount(track);
  const scrollable = isCarouselTrackScrollable(root, track, axis);
  // 只有一个直接 slide 且没有溢出时，不应按“可滑动轮播”让出横向拖拽。
  if (slideCount <= 1 && !scrollable) return false;
  return true;
}

function getAncestorPagingAxis(startElement) {
  let el = startElement?.parentElement || null;
  let depth = 0;
  while (el && el !== document.body && depth < 10) {
    const directionText = [
      getCarouselClassText(el),
      el.getAttribute?.('data-direction') || '',
      el.getAttribute?.('data-orientation') || ''
    ].join(' ');
    if (IMAGE_DRAG_CAROUSEL_AXIS_RE.test(directionText)) return 'vertical';
    if (IMAGE_DRAG_CAROUSEL_HORIZONTAL_AXIS_RE.test(directionText)) return 'horizontal';
    try {
      const style = window.getComputedStyle(el);
      const snapType = String(style.scrollSnapType || '').toLowerCase();
      if (/\by\b|block/.test(snapType)) return 'vertical';
      if (/\bx\b|inline/.test(snapType)) return 'horizontal';
    } catch (_) { /* ignore */ }
    el = el.parentElement;
    depth++;
  }
  return '';
}

function getImageDragCarouselContext(target) {
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return null;
  try {
    let el = target;
    let depth = 0;
    let matched = null;
    let fallbackMatched = null;
    while (el && el !== document.body && depth < 10) {
      const text = getCarouselClassText(el);
      if (el.matches && el.matches(IMAGE_DRAG_CAROUSEL_SELECTOR)) {
        matched = el;
        break;
      }
      if (!fallbackMatched && IMAGE_DRAG_CAROUSEL_CLASS_RE.test(text)) {
        fallbackMatched = el;
      }
      el = el.parentElement;
      depth++;
    }
    matched = matched || fallbackMatched;
    if (!matched) return null;

    const root = matched.closest?.(
      '.glide, .swiper, .swiper-container, .slick-slider, .splide, .owl-carousel, .flickity-enabled, .keen-slider, .embla, .carousel, .slider, [aria-roledescription="carousel"]'
    ) || matched;
    const track = matched.closest?.(
      '.glide__slides, .swiper-wrapper, .slick-track, .splide__list, .owl-stage, .flickity-slider, .keen-slider, .embla__container'
    ) || matched;
    const axisText = [
      root.className && typeof root.className === 'string' ? root.className : '',
      track.className && typeof track.className === 'string' ? track.className : '',
      root.getAttribute?.('data-direction') || '',
      track.getAttribute?.('data-direction') || ''
    ].join(' ');
    let axis = IMAGE_DRAG_CAROUSEL_AXIS_RE.test(axisText) ? 'vertical' : 'horizontal';
    try {
      if (track.scrollHeight > track.clientHeight * 1.4 && track.scrollWidth <= track.clientWidth * 1.2) {
        axis = 'vertical';
      }
    } catch (_) { /* ignore */ }
    const canSwipe = canCarouselActuallySwipe(root, track, axis);
    const rectElement = root || matched;
    const rect = rectElement.getBoundingClientRect ? rectElement.getBoundingClientRect() : null;
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const isFullViewportSurface = !!(
      rect &&
      rect.width >= viewportWidth * 0.68 &&
      rect.height >= viewportHeight * 0.68
    );
    const ancestorPagingAxis = getAncestorPagingAxis(root);
    const crossAxisPaging = isFullViewportSurface || (
      (axis === 'horizontal' && ancestorPagingAxis === 'vertical') ||
      (axis === 'vertical' && ancestorPagingAxis === 'horizontal')
    );
    return {
      root,
      track,
      axis,
      canSwipe,
      crossAxisPaging,
      rectElement,
      startRect: rect ? {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      } : null
    };
  } catch (_) {
    return null;
  }
}

function isPointOutsideCarouselRect(carouselInfo, clientX, clientY, margin = 10) {
  const rect = carouselInfo?.startRect;
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  return clientX < rect.left - margin ||
    clientX > rect.right + margin ||
    clientY < rect.top - margin ||
    clientY > rect.bottom + margin;
}

function getCarouselImageDragIntent(info, currentX, currentY) {
  const carouselInfo = info?.carouselInfo;
  if (!carouselInfo) return 'image';
  if (carouselInfo.canSwipe === false) return 'image';
  const dx = currentX - info.startX;
  const dy = currentY - info.startY;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const distance = Math.sqrt(dx * dx + dy * dy);
  const imageStartPriority = info.imageStartPriority === true;
  const startGate = imageStartPriority
    ? Math.max(5, dragDistanceThreshold)
    : Math.max(12, dragDistanceThreshold * 2);
  if (distance < startGate) return 'wait';

  const axis = carouselInfo.axis || 'horizontal';
  const alongAxis = axis === 'vertical'
    ? ay >= Math.max(10, ax * 1.18)
    : ax >= Math.max(10, ay * 1.18);
  const crossAxis = axis === 'vertical'
    ? ax >= Math.max(14, ay * 0.62)
    : ay >= Math.max(14, ax * 0.62);
  const outsideCarousel = isPointOutsideCarouselRect(carouselInfo, currentX, currentY, 10);

  const crossAxisPageSwipe = carouselInfo.crossAxisPaging === true && crossAxis;

  // A full-screen carousel can be nested in page navigation on the other axis.
  // Fast movement stays with the relevant page/carousel axis; a slower,
  // deliberate pull gets the image drag.
  if (imageStartPriority && (alongAxis || crossAxisPageSwipe) && !outsideCarousel) {
    const now = typeof performance !== 'undefined' && performance.now
      ? performance.now()
      : Date.now();
    const rawStartedAt = Number(info.startedAt);
    const startedAt = Number.isFinite(rawStartedAt) ? rawStartedAt : now;
    const elapsed = Math.max(1, now - startedAt);
    const speed = distance / elapsed;
    if (elapsed >= 70 && speed <= 0.9) return 'image';
    if (distance >= 18 && speed >= 1.05) return 'carousel';
    return 'wait';
  }

  // 轮播图优先：沿轮播轴滑动时交还给页面，不捕获 pointer，不阻止默认行为。
  if (alongAxis && !outsideCarousel) return 'carousel';
  // 明显离开轮播区域或非分页跨轴拖动，才进入图片超级拖拽。
  if (outsideCarousel || crossAxis) return 'image';
  return 'wait';
}

function getEventComposedPath(e) {
  try {
    return e.composedPath();
  } catch (_) {
    return [];
  }
}

function isImageLikeElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = (el.tagName || '').toUpperCase();
  return tag === 'IMG' ||
    tag === 'PICTURE' ||
    tag === 'VIDEO' ||
    (tag === 'IMAGE' && el.namespaceURI && /svg/i.test(el.namespaceURI));
}

function eventPathContainsElement(e, targetEl) {
  if (!targetEl || targetEl.nodeType !== Node.ELEMENT_NODE) return false;
  const path = getEventComposedPath(e);
  if (path && path.includes(targetEl)) return true;
  let el = e?.target;
  while (el && el !== document.body) {
    if (el === targetEl) return true;
    el = el.parentElement;
  }
  return false;
}

function getImageDragSourceElement(found, fallback) {
  const imgEl = found?.imgElement;
  if (imgEl && imgEl.nodeType === Node.ELEMENT_NODE) return imgEl;
  return fallback && fallback.nodeType === Node.ELEMENT_NODE ? fallback : null;
}

function isDirectImageDragCandidateFromEvent(e, found) {
  if (!found) return false;
  if (found.previewConfirmed === true) return true;
  const source = String(found.source || '');
  if (/^(direct-img|picture-img|svg-image|video-poster)$/i.test(source)) return true;
  if (isImageLikeElement(e?.target)) return true;
  return eventPathContainsElement(e, found.imgElement);
}

function isVisualImageDragStart(e, found) {
  if (isDirectImageDragCandidateFromEvent(e, found)) return true;
  const img = found?.imgElement;
  if (!img || img.nodeType !== Node.ELEMENT_NODE || img.tagName !== 'IMG') return false;
  try {
    return isPointInElementRect(img, e.clientX, e.clientY, 2);
  } catch (_) {
    return false;
  }
}

function rememberImagePreviewDragCandidate(e, candidate, imgElement) {
  if (!settings?.enableImagePreview || !settings.enableImagePreviewEnhanced) return;
  const sourceImage = candidate?.imgElement || imgElement || null;
  const url = candidate?.url || getImageElementUrl(sourceImage) || sourceImage?.src || '';
  if (!url || String(url).startsWith('data:')) return;
  imagePreviewDragCandidateCache = {
    candidate: Object.assign({}, candidate || {}, {
      url,
      imgElement: sourceImage,
      source: candidate?.source || 'enhanced-preview',
      previewConfirmed: true
    }),
    triggerElement: e?.target || null,
    clientX: Number(e?.clientX) || 0,
    clientY: Number(e?.clientY) || 0,
    timestamp: Date.now()
  };
}

function getImagePreviewDragCandidate(e) {
  if (!settings?.enableImagePreview || !settings.enableImagePreviewEnhanced) return null;
  const cached = imagePreviewDragCandidateCache;
  if (!cached || Date.now() - cached.timestamp > IMAGE_PREVIEW_DRAG_CANDIDATE_TTL_MS) {
    imagePreviewDragCandidateCache = null;
    return null;
  }
  const x = Number(e?.clientX) || 0;
  const y = Number(e?.clientY) || 0;
  const target = e?.target;
  const trigger = cached.triggerElement;
  const image = cached.candidate?.imgElement;
  const nearPreviewPoint = Math.hypot(x - cached.clientX, y - cached.clientY) <= 48;
  let sameVisualRegion = nearPreviewPoint;
  try {
    if (!sameVisualRegion && trigger && target) {
      sameVisualRegion = trigger === target || trigger.contains?.(target) || target.contains?.(trigger);
    }
    if (!sameVisualRegion && image?.nodeType === Node.ELEMENT_NODE) {
      sameVisualRegion = isPointInElementRect(image, x, y, 2);
    }
  } catch (_) { /* ignore */ }
  return sameVisualRegion ? cached.candidate : null;
}

function resolveImageCandidateForDrag(e) {
  if (!settings?.enableImageDrag || !e) return null;
  return getImagePreviewDragCandidate(e) ||
    findImageForPreview(e.target, e.clientX, e.clientY, true, { forDrag: true });
}

function sameImageDragUrl(a, b) {
  if (!a || !b) return false;
  const sa = String(a);
  const sb = String(b);
  if (sa === sb) return true;
  try {
    return new URL(sa, document.baseURI).href === new URL(sb, document.baseURI).href;
  } catch (_) {
    return false;
  }
}

function getTextNodeNearCaretRange(range) {
  if (!range) return null;
  const node = range.startContainer;
  const offset = Math.max(0, Number(range.startOffset) || 0);
  if (node && node.nodeType === Node.TEXT_NODE) {
    return { node, offset };
  }
  const children = node && node.childNodes;
  if (!children || !children.length) return null;
  const direct = children[offset] || children[Math.max(0, offset - 1)];
  if (!direct) return null;
  if (direct.nodeType === Node.TEXT_NODE) {
    return { node: direct, offset: 0 };
  }
  try {
    const walker = document.createTreeWalker(direct, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode();
    return textNode ? { node: textNode, offset: 0 } : null;
  } catch (_) {
    return null;
  }
}

function getCaretRangeAtPoint(clientX, clientY) {
  try {
    if (typeof document.caretRangeFromPoint === 'function') {
      return document.caretRangeFromPoint(clientX, clientY);
    }
    if (typeof document.caretPositionFromPoint === 'function') {
      const pos = document.caretPositionFromPoint(clientX, clientY);
      if (!pos || !pos.offsetNode) return null;
      const range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      return range;
    }
  } catch (_) { /* ignore */ }
  return null;
}

function isTextNodeSelectableForImageDrag(textNode) {
  if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return false;
  const parent = textNode.parentElement;
  if (!parent || !parent.isConnected) return false;
  const tag = (parent.tagName || '').toUpperCase();
  if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|CANVAS)$/.test(tag)) return false;
  try {
    const style = getComputedStyle(parent);
    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;
    const userSelect = String(style.userSelect || style.webkitUserSelect || '').toLowerCase();
    if (userSelect === 'none') return false;
  } catch (_) { /* ignore */ }
  return true;
}

function findNonWhitespaceTextOffset(text, offset) {
  if (!text || !text.trim()) return -1;
  const length = text.length;
  let start = Math.min(Math.max(0, offset), Math.max(0, length - 1));
  if (!/\s/.test(text[start] || '')) return start;
  for (let radius = 1; radius <= 4; radius++) {
    const left = start - radius;
    if (left >= 0 && !/\s/.test(text[left])) return left;
    const right = start + radius;
    if (right < length && !/\s/.test(text[right])) return right;
  }
  return text.search(/\S/);
}

function isPointerOnSelectableTextAtPoint(clientX, clientY) {
  const x = Number(clientX);
  const y = Number(clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  const range = getCaretRangeAtPoint(x, y);
  const textInfo = getTextNodeNearCaretRange(range);
  const textNode = textInfo?.node;
  if (!isTextNodeSelectableForImageDrag(textNode)) return false;

  const text = textNode.nodeValue || '';
  const offset = findNonWhitespaceTextOffset(text, textInfo.offset);
  if (offset < 0) return false;

  try {
    const charRange = document.createRange();
    charRange.setStart(textNode, offset);
    charRange.setEnd(textNode, Math.min(offset + 1, text.length));
    const rects = charRange.getClientRects ? charRange.getClientRects() : [];
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      if (
        x >= rect.left - 8 &&
        x <= rect.right + 8 &&
        y >= rect.top - 6 &&
        y <= rect.bottom + 6
      ) {
        return true;
      }
    }
  } catch (_) { /* fallback below */ }

  const parent = textNode.parentElement;
  return !!(parent && isPointInElementRect(parent, x, y, 1) && text.trim());
}

function isNonLinkFunctionalControlForImageDrag(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  try {
    if (isTextInputElement(element)) return true;
    if (element.closest('[contenteditable="true"]')) return true;
    if (isImageLikeElement(element)) return false;
    return !!element.closest(
      'button, input, select, textarea, summary, label[for], [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="combobox"], [role="option"]'
    );
  } catch (_) {
    return false;
  }
}

function shouldPreferNativeLinkDragOverImage(e, found, carouselInfo) {
  const link = findSuperDragLinkFromEvent(e);
  if (!link) return false;
  const directImage = isDirectImageDragCandidateFromEvent(e, found);
  // 轮播内很多 slide 本身就是链接：文字区域按链接处理；直接从图片发起仍按图片处理。
  if (carouselInfo) return !directImage;
  // 非轮播：直接从 IMG/VIDEO/SVG image 发起时仍按图片处理；文字链接和背景层链接按链接处理。
  if (directImage) return false;
  const pointer = getDragPointerClient(e);
  if (isPointerOnSelectableTextAtPoint(pointer.clientX, pointer.clientY)) return true;
  const target = e?.target;
  if (target && target.nodeType === Node.ELEMENT_NODE && link.contains(target)) {
    const tag = (target.tagName || '').toUpperCase();
    if (/^(A|SPAN|P|B|I|EM|STRONG|SMALL|H1|H2|H3|H4|H5|H6|DIV)$/.test(tag) &&
        (target.textContent || '').trim()) {
      return true;
    }
  }
  return false;
}

function shouldArmPotentialImageDrag(e, found) {
  if (!settings?.enableImageDrag) return false;
  if (!found || !found.url || String(found.url).startsWith('data:')) return false;
  if (!e || e.button !== 0) return false;
  const target = e.target;
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return false;
  if (shouldBlockImageSuperDragForTarget(target)) return false;
  if (potentialDragEditable || potentialDragSelection) return false;

  if (found.previewConfirmed !== true) {
    try {
      if (getPageSelectedTextAtPointer(e.clientX, e.clientY)) return false;
    } catch (_) { /* ignore */ }
  }

  const directImage = isDirectImageDragCandidateFromEvent(e, found);
  const sourceElement = getImageDragSourceElement(found, target);
  const carouselInfo = getImageDragCarouselContext(sourceElement || target);

  if (shouldPreferNativeLinkDragOverImage(e, found, carouselInfo)) return false;

  if (!directImage) {
    if (isNonLinkFunctionalControlForImageDrag(target)) return false;
    if (isPointerOnSelectableTextAtPoint(e.clientX, e.clientY)) return false;
  }

  return true;
}

function isNativeImageDragStartForPotentialImage(e, info) {
  if (!info || !info.url || !e) return false;
  if (shouldBlockImageSuperDragForTarget(e.target)) return false;

  const pointer = getDragPointerClient(e);
  const found = settings?.enableImageDrag
    ? resolveImageCandidateForDrag({
        target: e.target,
        clientX: pointer.clientX,
        clientY: pointer.clientY
      })
    : null;

  if (shouldPreferNativeLinkDragOverImage(e, found, info.carouselInfo)) return false;
  try {
    if (getPageSelectedTextAtPointer(pointer.clientX, pointer.clientY)) return false;
  } catch (_) { /* ignore */ }

  if (found && sameImageDragUrl(found.url, info.url)) return true;
  if (info.img && eventPathContainsElement(e, info.img)) return true;
  return false;
}

function shouldLetCarouselHandleNativeImageDragStart(e, info) {
  if (!info?.carouselInfo) return false;
  if (!isNativeImageDragStartForPotentialImage(e, info)) return false;
  const pointer = getDragPointerClient(e);
  const intent = getCarouselImageDragIntent(info, pointer.clientX, pointer.clientY);
  return intent !== 'image';
}

/** 临时 draggable=true，mouseup/dragend 后恢复 */
function applySuperDragDraggableFix(el) {
  if (!el || el.getAttribute?.('draggable') !== 'false') return false;
  if (el.hasAttribute('data-superdrag-draggable-fix')) return false;
  el.setAttribute('data-superdrag-draggable-prev', el.getAttribute('draggable') || 'false');
  el.setAttribute('draggable', 'true');
  el.setAttribute('data-superdrag-draggable-fix', 'true');
  return true;
}

function scheduleSuperDragDraggableRestore() {
  window.addEventListener('mouseup', restoreSuperDragLinkDraggable, true);
  window.addEventListener('dragend', restoreSuperDragLinkDraggable, true);
}

/** mousedown/pointerdown：临时启用 draggable=false 的链接/选区/图片，便于原生 HTML5 拖拽 */
function prepareSuperDragNativeDraggable(e) {
  if (!isTrustedUserEvent(e)) return;
  if (e.button !== 0) return;
  if (!isSuperDragFeatureEnabled()) return;

  let target = e.target;
  let depth = 0;
  let hasModified = false;

  while (target && target !== document.body && depth < 5) {
    if (target.getAttribute && target.getAttribute('draggable') === 'false') {
      let shouldForce = false;
      if (target.tagName === 'A' && (target.href || target.getAttribute('href'))) {
        if (!target.querySelector('input, textarea, select, button')) {
          shouldForce = true;
        }
      } else if (target.tagName === 'IMG') {
        shouldForce = shouldForceDraggableForImage(target);
      } else {
        try {
          const selectedTextAtPointer = getPageSelectedTextAtPointer(e.clientX, e.clientY);
          if (selectedTextAtPointer) {
            shouldForce = true;
          }
        } catch (_) { /* ignore */ }
      }
      if (shouldForce && applySuperDragDraggableFix(target)) {
        hasModified = true;
      }
    }
    target = target.parentElement;
    depth++;
  }

  if (!hasModified && settings.enableImageDrag && !shouldBlockImageSuperDragForTarget(e.target)) {
    const found = resolveImageCandidateForDrag(e);
    const imgEl = found?.imgElement?.tagName === 'IMG' ? found.imgElement : null;
    if (imgEl && shouldForceDraggableForImage(imgEl) && applySuperDragDraggableFix(imgEl)) {
      hasModified = true;
    }
  }

  if (hasModified) {
    scheduleSuperDragDraggableRestore();
  }
}

function beginPotentialImageSuperDrag(e, found) {
  if (!settings?.enableImageDrag) return false;
  if (!found || !found.url || found.url.startsWith('data:')) return false;
  const imgEl = found.imgElement;
  const url = (imgEl && imgEl.tagName === 'IMG')
    ? (getImageElementUrl(imgEl) || found.url)
    : found.url;
  if (!url || url.startsWith('data:')) return false;
  const carouselInfo = getImageDragCarouselContext(imgEl || e.target);
  potentialDragImage = {
    img: imgEl,
    url,
    startX: e.clientX,
    startY: e.clientY,
    carouselInfo,
    imageStartPriority: isVisualImageDragStart(e, found),
    startedAt: typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now(),
    dragging: false,
    direction: ''
  };
  hideImagePreview(true);
  return true;
}

// 鼠标手势状态
let isGestureInProgress = false;
let gesturePoints = [];
let gestureComposedPath = null;
let gestureStartX = 0;
let gestureSessionStartTime = 0;
let gestureStartY = 0;
let gestureCanvas = null;
let gestureContext = null;
let minGestureDistance = 6; // 手势最小总距离；越低越灵敏
let isRightMouseDown = false; // 跟踪右键是否按下
let gesturePointerId = null; // 当前手势的 pointerId，用于 setPointerCapture
let iframeGesturePoints = []; // 主框架缓存的 iframe 轨迹点，用于指针移入主框架时延续绘制
let iframeGestureComposedPathHints = null; // iframe 传来的 composedPath 序列化快照
let iframeGestureScrollAnchor = null; // 手势起点（iframe 内坐标）
let lastIframeTrailTime = 0;
let gestureRecognizeRafId = 0;
let gestureTrailDrawRafId = 0;
let gestureTrailDrawnPointCount = 0;
let lastGestureRecognizeTime = 0;
let lastGestureRecognizePointCount = 0;
const GESTURE_RECOGNIZE_MIN_INTERVAL_MS = 40;
const GESTURE_RECOGNIZE_MIN_POINT_DELTA = 6;
const TRAIL_REGION_SCREENSHOT_CHECK_INTERVAL_MS = 160;
const TRAIL_REGION_SCREENSHOT_CHECK_POINT_DELTA = 12;
let trailRegionScreenshotCheckCache = null;
let iframeTrailForwardRafId = 0;
let iframeTrailForwardPending = null;
let iframeTrailEndNotified = false;
let iframeTrailGeneration = 0;
/** iframe：本会话是否已向 top 发送过轨迹（首包强制 init，避免多点首帧被当成 update 丢弃） */
let iframeTrailForwardStarted = false;
/** top frame：已关闭的 iframe 轨迹 generation（丢弃 stale update） */
let topIframeTrailClosedGen = -1;
let topIframeTrailStaleTimer = 0;

const GESTURE_TRAIL_DPR_MAX = 2;
const GESTURE_TRAIL_MIN_POINT_DISTANCE = 0.45;
const GESTURE_TRAIL_SMOOTH_DISTANCE = 28;
const GESTURE_TRAIL_SMOOTH_ALPHA_MIN = 0.36;
const GESTURE_TRAIL_SMOOTH_ALPHA_MAX = 0.86;
const GESTURE_TRAIL_CURVE_CONTROL = 0.16;
const GESTURE_TRAIL_CURVE_MAX_HANDLE_RATIO = 0.42;

function cancelTopIframeTrailStaleCleanup() {
  if (topIframeTrailStaleTimer) {
    clearTimeout(topIframeTrailStaleTimer);
    topIframeTrailStaleTimer = 0;
  }
}

function scheduleTopIframeTrailStaleCleanup() {
  if (window !== window.top) return;
  cancelTopIframeTrailStaleCleanup();
  topIframeTrailStaleTimer = setTimeout(() => {
    topIframeTrailStaleTimer = 0;
    if (isGestureInProgress && isRightMouseDown) {
      scheduleTopIframeTrailStaleCleanup();
      return;
    }
    if (!isGestureCanvasLive() && iframeGesturePoints.length === 0) return;
    if (lastIframeTrailTime > 0 && Date.now() - lastIframeTrailTime < IFRAME_TOP_TRAIL_CONTINUE_MS) {
      scheduleTopIframeTrailStaleCleanup();
      return;
    }
    iframeGesturePoints = [];
    iframeGestureComposedPathHints = null;
    iframeGestureScrollAnchor = null;
    lastIframeTrailTime = 0;
    crossFrameGestureSourceFrameUrl = null;
    if (!(isGestureInProgress && isRightMouseDown)) {
      disposeGestureTrailCanvas();
    }
  }, 900);
}

function getGesturePerfNow() {
  return performance.now();
}

function resetGestureRecognitionPerfState() {
  if (gestureRecognizeRafId) {
    cancelAnimationFrame(gestureRecognizeRafId);
    gestureRecognizeRafId = 0;
  }
  lastGestureRecognizeTime = 0;
  lastGestureRecognizePointCount = 0;
}

function resetTrailRegionScreenshotCheckCache() {
  trailRegionScreenshotCheckCache = null;
}

function shouldRunGestureRecognitionFrame() {
  const pointCount = gesturePoints ? gesturePoints.length : 0;
  const now = getGesturePerfNow();
  if (
    lastGestureRecognizeTime > 0 &&
    now - lastGestureRecognizeTime < GESTURE_RECOGNIZE_MIN_INTERVAL_MS &&
    pointCount - lastGestureRecognizePointCount < GESTURE_RECOGNIZE_MIN_POINT_DELTA
  ) {
    return false;
  }
  lastGestureRecognizeTime = now;
  lastGestureRecognizePointCount = pointCount;
  return true;
}

function resetGestureTrailDrawState() {
  if (gestureTrailDrawRafId) {
    cancelAnimationFrame(gestureTrailDrawRafId);
    gestureTrailDrawRafId = 0;
  }
  gestureTrailDrawnPointCount = 0;
}

function cancelPendingIframeTrailForward() {
  if (iframeTrailForwardRafId) {
    cancelAnimationFrame(iframeTrailForwardRafId);
    iframeTrailForwardRafId = 0;
  }
  iframeTrailForwardPending = null;
}

function notifyIframeTrailEndToTop(forcedFields) {
  if (window === window.top) return;
  if (iframeTrailEndNotified) return;
  if (!iframeTrailForwardStarted && !gestureOverlayUsesIframeDocumentFullscreen()) return;
  iframeTrailEndNotified = true;
  iframeTrailForwardStarted = false;
  const closedTrailGen = iframeTrailGeneration;
  iframeTrailGeneration++;
  cancelPendingIframeTrailForward();
  const fields =
    forcedFields ||
    (crossFrameSessionToken ? { _crossFrameToken: crossFrameSessionToken } : {});
  safeSendMessageSilent(
    Object.assign(
      { action: 'gestureTrailFromIframe', data: { type: 'end', closedTrailGen } },
      fields
    )
  );
}

function sendIframeTrailPayload(payload, gen) {
  if (!payload || gen !== iframeTrailGeneration) return;
  safeSendMessageSilent(
    Object.assign(
      { action: 'gestureTrailFromIframe', data: Object.assign({ trailGen: gen }, payload) },
      crossFrameSessionFields()
    )
  );
}

function scheduleIframeTrailForward(data) {
  if (data && data.type === 'end') {
    notifyIframeTrailEndToTop();
    return;
  }
  const gen = iframeTrailGeneration;
  iframeTrailForwardPending = data;
  if (iframeTrailForwardRafId) return;
  iframeTrailForwardRafId = requestAnimationFrame(() => {
    iframeTrailForwardRafId = 0;
    const payload = iframeTrailForwardPending;
    iframeTrailForwardPending = null;
    if (!payload || gen !== iframeTrailGeneration) return;
    if (payload.type === 'init') {
      beginCrossFrameSession();
    }
    sendIframeTrailPayload(payload, gen);
  });
}
let minMovementToStartGesture = 2; // 启动手势的最小移动阈值，越低越容易开始识别
let angleThreshold = 1.0; // 主轴与副轴比例阈值；越高越要求横/竖方向明确
let smoothingFactor = 0.25; // 识别前平滑强度，过滤短抖动同时保留明显拐点
let minDirectionSegmentLength = 5; // 最小有效方向段长度，越低越容易识别短手势
let directionChangeThreshold = 0.35; // 方向变化阈值，越高越倾向忽略短方向抖动
let minGestureComplexity = 3; // 方向复杂度阈值，超过后更倾向视为乱画
let settingsLoaded = false; // storage 合并完成前不启用超级拖拽，避免默认设置误触发
let settings = CONTENT_SETTINGS_API.getContentDefaults({ language: 'en_US' });
let isExtensionValid = true; // 跟踪扩展上下文是否有效
let extensionValidityCheckTimer = null;

function isExtensionContextInvalidatedError(error) {
  const msg = typeof error === 'string' ? error : (error && error.message) || '';
  return msg.includes('Extension context invalidated');
}

function markExtensionInvalidated() {
  isExtensionValid = false;
  if (extensionValidityCheckTimer != null) {
    clearInterval(extensionValidityCheckTimer);
    extensionValidityCheckTimer = null;
  }
}

let isSplitScrollSyncing = false; // 分屏滚动同步中，避免反馈循环
let isProgrammaticScrollToEnd = false; // 程序化滚动执行中，忽略配对窗口回传的 syncScrollTo 避免中断
let gestureHint = null; // 用于存储手势提示元素

// 分屏同步时，程序化滚动前调用，屏蔽反馈循环；滚动完成后调用 endProgrammaticScrollGuard 并发送最终比例
function startProgrammaticScrollGuard() {
  if (settings?.enableSplitScrollSync) {
    isSplitScrollSyncing = true;
    isProgrammaticScrollToEnd = true;
  }
}
/** @param {number|undefined} finalRatioY 纵向比例 0–1；省略则从 DOM 读取 */
/** @param {number|undefined} finalRatioX 横向比例 0–1；省略则从 DOM 读取 */
function endProgrammaticScrollGuard(finalRatioY, finalRatioX) {
  if (!settings?.enableSplitScrollSync) return;
  setTimeout(() => {
    isSplitScrollSyncing = false;
    isProgrammaticScrollToEnd = false;
    const el = document.scrollingElement || document.documentElement;
    const maxY = Math.max(0, el.scrollHeight - el.clientHeight);
    const maxX = Math.max(0, el.scrollWidth - el.clientWidth);
    let ratioY = finalRatioY;
    if (typeof ratioY !== 'number' || ratioY < 0 || ratioY > 1) {
      ratioY = maxY > 0 ? el.scrollTop / maxY : 0;
    }
    let ratioX = finalRatioX;
    if (typeof ratioX !== 'number' || ratioX < 0 || ratioX > 1) {
      ratioX = maxX > 0 ? el.scrollLeft / maxX : 0;
    }
    chrome.runtime.sendMessage({
      action: 'splitViewScroll',
      scrollRatio: ratioY,
      scrollRatioX: ratioX
    }).catch(() => {});
  }, 480);
}
let lastGestureEndTime = 0; // 添加一个变量来记录手势结束时间
/** Mac/Linux 双击右键窗口会按实际点击节奏在此范围内自适应 */
const MAC_LINUX_DOUBLE_RIGHT_CLICK_MIN_MS = 480;
const MAC_LINUX_DOUBLE_RIGHT_CLICK_MAX_MS = 760;
/** pointerup 后紧跟的 contextmenu 属于同一次轻点，不应被误判为第二次轻点 */
const MAC_LINUX_CONTEXTMENU_SAME_TAP_MS = 220;
/** 第二次轻点已在 pointerup 阶段识别时，允许随后到来的 contextmenu 通过 */
const MAC_LINUX_CONTEXTMENU_ALLOW_ARM_MS = 480;
/** 双击右键必须落在同一小范围内，避免两次普通右键被合并 */
const MAC_LINUX_DOUBLE_RIGHT_CLICK_MAX_MOVE = 20;
/** 触摸板轻点抖动容差：轨迹包围盒边长小于此值视为「单击」而非拖动手势 */
const MAC_LINUX_SIMPLE_RIGHT_CLICK_MAX_MOVE = 12;
/** Mac/Linux 单击右键时间戳，供双击右键弹出菜单检测（与 lastGestureEndTime 分离，避免 pointerup 清零） */
let lastMacLinuxRightClickTime = 0;
let lastMacLinuxRightPointerUpTime = 0;
let lastMacLinuxRightPointerUpX = 0;
let lastMacLinuxRightPointerUpY = 0;
let lastMacLinuxContextMenuTime = 0;
let macLinuxDoubleRightClickMenuArmedUntil = 0;
let macLinuxDoubleRightClickArmTimer = 0;
let macLinuxSimpleRightClickResetTimer = 0;
/** 当前右键按压只记录一次，避免 pointerup/contextmenu 重复计数 */
let macLinuxCurrentRightPress = null;
let macLinuxAdaptiveDoubleRightClickMs = isMacOS ? 720 : 680;
let macLinuxMenuAllowedAt = 0;
let macLinuxMenuAllowedX = 0;
let macLinuxMenuAllowedY = 0;
/** handleContextMenu 判定为双击右键时置位，供 gesturePreventDefault 放行（其在 documentElement 上后执行） */
let macLinuxAllowContextMenu = false;
let rightHoldGestureEndTime = 0; // 按住右键+滚轮/左键，或按住左键+右键 手势结束时间，需更长阻止窗口（500ms）
/** 按住左键+滚轮缩放时抑制页面文字被选中（至左键松开） */
let leftHoldWheelSelectGuardActive = false;
let leftHoldWheelSelectGuardPrevHtmlUserSelect = '';
let leftHoldWheelSelectGuardPrevBodyUserSelect = '';
let imagePreview = null; // 用于存储图片预览元素
let imagePreviewHideTimer = 0;
let lastEnhancedImageLookupTime = 0; // 增强图片查找节流
let imagePreviewDeferredRafId = 0; // 延迟查找的 rAF ID
const IMAGE_PREVIEW_DRAG_CANDIDATE_TTL_MS = 1500;
let imagePreviewDragCandidateCache = null;

// 跨帧手势状态缓存（按 tab 隔离）：手势在主框架开始、在 iframe 内结束时，iframe 需获知手势状态以阻止右键菜单
const GESTURE_STORAGE_KEY_PREFIX = 'mouseGestureCrossFrameState:';
let contentTabId = null;
let contentTabUrl = '';
let contentFrameId = 0;
/** top frame：当前活跃跨 frame 手势来源 frameId（0=主框架） */
let crossFrameGestureSourceFrameId = null;
/** top frame：活跃跨 frame 手势来源 frame 文档 URL（用于精确定位 iframe 元素） */
let crossFrameGestureSourceFrameUrl = null;
/** top frame：frameId -> iframe 元素缓存（跨域 iframe 无法直接比对 contentWindow） */
const iframeRectCacheByFrameId = new Map();
const IFRAME_RECT_CACHE_MAX = 32;

function trimIframeRectCache() {
  while (iframeRectCacheByFrameId.size > IFRAME_RECT_CACHE_MAX) {
    const firstKey = iframeRectCacheByFrameId.keys().next().value;
    if (firstKey === undefined) break;
    iframeRectCacheByFrameId.delete(firstKey);
  }
}
let cachedGestureState = { gestureActive: false, lastGestureEndTime: 0, sourceFrameId: 0 };
let gestureStatePollTimer = null;
let crossFrameWatchTimer = null;
let crossFrameStorageListenerReady = false;

function getSuperDragStorageKey() {
  return contentTabId != null ? SUPER_DRAG_STORAGE_KEY_PREFIX + contentTabId : null;
}

function isGestureFeatureAllowedHere() {
  if (!settings || !settings.enableGesture) return false;
  if (isSiteInDisabledList(window.location.href)) return false;
  return true;
}

function isGesturePointerButtonsActive(e) {
  if (!e) return isRightMouseDown;
  if (e.buttons === 2) return true;
  if (isMacOS && e.ctrlKey && (e.buttons & 1)) return true;
  return false;
}

function tryBootstrapTopGestureFromIframePoints() {
  if (window !== window.top) return false;
  if (iframeGesturePoints.length < 2) return false;
  if (!isGestureFeatureAllowedHere()) return false;
  if (!isGestureInProgress) {
    isGestureInProgress = true;
    isRightMouseDown = true;
    gesturePoints = iframeGesturePoints.map((p) => ({ x: p.x, y: p.y }));
    gestureStartX = gesturePoints[0].x;
    gestureStartY = gesturePoints[0].y;
    initGestureCanvas();
  }
  return true;
}

function getGestureStorageKey() {
  return contentTabId != null ? GESTURE_STORAGE_KEY_PREFIX + contentTabId : null;
}

function initContentContext(callback) {
  if (contentTabId != null) {
    if (typeof callback === 'function') callback();
    return;
  }
  if (!isExtensionValid) {
    if (typeof callback === 'function') callback();
    return;
  }
  try {
    chrome.runtime.sendMessage({ action: 'getContentContext' }, (response) => {
      if (chrome.runtime.lastError) {
        if (typeof callback === 'function') callback();
        return;
      }
      if (response && response.success && response.tabId != null) {
        contentTabId = response.tabId;
        contentFrameId = response.frameId != null ? response.frameId : 0;
        contentTabUrl = response.tabUrl ? String(response.tabUrl) : '';
      }
      if (typeof callback === 'function') callback();
    });
  } catch (e) {
    if (typeof callback === 'function') callback();
  }
}

function isVideoLikeHost() {
  const h = window.location.hostname.toLowerCase();
  return /youtube|youtu\.be|bilibili|b23\.tv|vimeo|dailymotion|twitch|douyin|tiktok|iqiyi|youku|v\.qq|netflix|nicovideo|hulu/.test(
    h
  );
}

function isEmbedGestureContext() {
  return window !== window.top || isVideoLikeHost();
}

function getGestureContextMenuThreshold() {
  if (isVideoLikeHost()) return 450;
  if (window !== window.top) return 400;
  return 200;
}

function getPreventDefaultReleaseDelay() {
  if (isVideoLikeHost()) return 450;
  if (window !== window.top) return 400;
  return 280;
}

function getRecentGestureEndTime() {
  return Math.max(lastGestureEndTime || 0, cachedGestureState.lastGestureEndTime || 0);
}

function scheduleReleaseGesturePreventDefault() {
  if (preventDefaultTimeout) clearTimeout(preventDefaultTimeout);
  preventDefaultTimeout = setTimeout(
    disableGesturePreventDefault,
    getPreventDefaultReleaseDelay()
  );
}

function applyGestureStorageSnapshot(data) {
  if (!data) return;
  const wasActive = cachedGestureState.gestureActive;
  cachedGestureState.gestureActive = !!data.gestureActive;
  cachedGestureState.lastGestureEndTime = data.lastGestureEndTime || 0;
  cachedGestureState.sourceFrameId = data.sourceFrameId != null ? data.sourceFrameId : 0;
  if (window === window.top && data.gestureActive) {
    crossFrameGestureSourceFrameId = cachedGestureState.sourceFrameId;
  }
  if (data.gestureActive) {
    enableGesturePreventDefault();
    if (window !== window.top || (data.sourceFrameId != null && data.sourceFrameId !== 0)) {
      startCrossFrameGestureWatch();
    }
  } else if (wasActive || data.lastGestureEndTime) {
    if (window === window.top && wasActive) {
      if (!isGestureInProgress) {
        disposeGestureTrailCanvas();
      }
    }
    if (window !== window.top) startCrossFrameGestureWatch();
    scheduleReleaseGesturePreventDefault();
  }
}

function startCrossFrameGestureWatch() {
  if (crossFrameWatchTimer) return;
  enableGesturePreventDefault();
  syncGestureStateFromStorage();
  crossFrameWatchTimer = setInterval(() => {
    syncGestureStateFromStorage();
    if (!cachedGestureState.gestureActive) {
      const end = cachedGestureState.lastGestureEndTime;
      if (!end || Date.now() - end > getGestureContextMenuThreshold()) {
        stopCrossFrameGestureWatch();
      }
    }
  }, 50);
}

function stopCrossFrameGestureWatch() {
  if (crossFrameWatchTimer) {
    clearInterval(crossFrameWatchTimer);
    crossFrameWatchTimer = null;
  }
}

function initCrossFrameGestureStorageListener() {
  if (crossFrameStorageListenerReady) return;
  crossFrameStorageListenerReady = true;
  initContentContext(() => {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        const key = getGestureStorageKey();
        if (!key || !changes[key]) return;
        applyGestureStorageSnapshot(changes[key].newValue);
      });
      syncGestureStateFromStorage();
    } catch (e) {
      console.log('跨帧手势 storage 监听失败:', e.message);
    }
  });
}

function syncGestureStateToStorage(gestureActive, lastEndTime, sourceFrameId) {
  initContentContext(() => {
    const key = getGestureStorageKey();
    if (!key) return;
    const src =
      sourceFrameId != null
        ? sourceFrameId
        : window !== window.top
          ? contentFrameId
          : 0;
    if (gestureActive) {
      if (window === window.top) crossFrameGestureSourceFrameId = src;
    } else if (!lastEndTime) {
      if (window === window.top) crossFrameGestureSourceFrameId = null;
    }
    try {
      chrome.storage.local.set({
        [key]: {
          gestureActive: !!gestureActive,
          lastGestureEndTime: lastEndTime || 0,
          sourceFrameId: src
        }
      });
    } catch (e) {
      console.log('同步手势状态到 storage 失败:', e.message);
    }
  });
}

function syncGestureStateFromStorage() {
  initContentContext(() => {
    const key = getGestureStorageKey();
    if (!key) return;
    try {
      chrome.storage.local.get([key], (result) => {
        const data = result && result[key];
        if (data) {
          const wasActive = cachedGestureState.gestureActive;
          cachedGestureState.gestureActive = !!data.gestureActive;
          cachedGestureState.lastGestureEndTime = data.lastGestureEndTime || 0;
          cachedGestureState.sourceFrameId = data.sourceFrameId != null ? data.sourceFrameId : 0;
          if (window === window.top && data.gestureActive) {
            crossFrameGestureSourceFrameId = cachedGestureState.sourceFrameId;
          }
          if (cachedGestureState.gestureActive) {
            enableGesturePreventDefault();
          } else if (wasActive) {
            scheduleReleaseGesturePreventDefault();
          }
          if (
            wasActive &&
            !cachedGestureState.gestureActive &&
            (isRightMouseDown || isGestureInProgress || gesturePoints.length > 0)
          ) {
            const iframeLocalActive =
              window !== window.top && isRightMouseDown && isGestureInProgress;
            const endTs = cachedGestureState.lastGestureEndTime || 0;
            const staleEndForSession =
              iframeLocalActive &&
              !cachedGestureState.gestureActive &&
              endTs > 0 &&
              endTs < gestureSessionStartTime;
            if (staleEndForSession) {
              // storage 尚未反映本次 iframe 手势
            } else if (!(iframeLocalActive && endTs < gestureSessionStartTime)) {
              isRightMouseDown = false;
              isGestureInProgress = false;
              releaseGesturePointerCapture();
              resetGestureState();
              clearGestureCanvas();
            }
          }
        }
      });
    } catch (e) {
      console.log('从 storage 读取手势状态失败:', e.message);
    }
  });
}

// 动态 preventDefault：仅在手势进行时阻止 contextmenu，减少对页面干扰
const PREVENT_DEFAULT_WAIT_MS = 200;
const PREVENT_DEFAULT_WAIT_MS_YOUTUBE = 380; // 视频播放器需更长窗口
let preventDefaultTimeout = null;
let gesturePreventDefaultActive = false;

function enableGesturePreventDefault() {
  if (preventDefaultTimeout) {
    clearTimeout(preventDefaultTimeout);
    preventDefaultTimeout = null;
  }
  if (gesturePreventDefaultActive) return;
  gesturePreventDefaultActive = true;
  const opts = { capture: true };
  document.documentElement.addEventListener('contextmenu', gesturePreventDefault, opts);
  // 仅阻止 contextmenu，不阻止 click/auxclick，避免误拦用户后续左键点击
}

function disableGesturePreventDefault() {
  preventDefaultTimeout = null;
  if (!gesturePreventDefaultActive) return;
  gesturePreventDefaultActive = false;
  const opts = { capture: true };
  document.documentElement.removeEventListener('contextmenu', gesturePreventDefault, opts);
}

function gesturePreventDefault(e) {
  // 仅在手势进行中或刚结束时阻止，lastGestureEndTime 仅在真实手势时设置，简单右键不阻止
  if (!e.isTrusted) return;
  if (macLinuxAllowContextMenu) {
    macLinuxAllowContextMenu = false;
    return;
  }
  if (cachedGestureState.gestureActive) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  // 右键按下期间也阻止，避免视频播放器等在 contextmenu 前就触发菜单
  if (isRightMouseDown) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  // 按住右键+滚轮/左键：需 500ms 阻止窗口，因松开顺序可能导致 contextmenu 较晚触发
  if (rightHoldGestureEndTime > 0 && (Date.now() - rightHoldGestureEndTime < 500)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  const threshold = getGestureContextMenuThreshold();
  const endTs = getRecentGestureEndTime();
  if (endTs > 0 && Date.now() - endTs < threshold) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function startGestureStatePolling() {
  if (gestureStatePollTimer) return;
  syncGestureStateFromStorage();
  gestureStatePollTimer = setInterval(() => {
    if (!isRightMouseDown && !isGestureInProgress) {
      stopGestureStatePolling();
      return;
    }
    syncGestureStateFromStorage();
  }, 80);
}

function stopGestureStatePolling() {
  if (gestureStatePollTimer) {
    clearInterval(gestureStatePollTimer);
    gestureStatePollTimer = null;
  }
}

function stopAllGestureStateWatchers() {
  stopGestureStatePolling();
  stopCrossFrameGestureWatch();
}

// setPointerCapture：跨元素/边界时仍能收到 pointer 事件
function captureGesturePointer(pointerId) {
  try {
    if (pointerId != null && document.documentElement.setPointerCapture) {
      document.documentElement.setPointerCapture(pointerId);
      gesturePointerId = pointerId;
    }
  } catch (e) {
    console.log('setPointerCapture 失败:', e.message);
  }
}

function releaseGesturePointerCapture() {
  try {
    if (gesturePointerId != null && document.documentElement.releasePointerCapture) {
      document.documentElement.releasePointerCapture(gesturePointerId);
    }
  } catch (e) {
    // 忽略，可能已释放
  }
  gesturePointerId = null;
}

function captureSuperDragPointer(pointerId) {
  try {
    if (pointerId != null && document.documentElement.setPointerCapture) {
      document.documentElement.setPointerCapture(pointerId);
      superDragPointerId = pointerId;
    }
  } catch (e) {
    console.log('超级拖拽 setPointerCapture 失败:', e.message);
  }
}

function releaseSuperDragPointerCapture() {
  try {
    if (superDragPointerId != null && document.documentElement.releasePointerCapture) {
      document.documentElement.releasePointerCapture(superDragPointerId);
    }
  } catch (e) {
    // 忽略，可能已释放
  }
  superDragPointerId = null;
}

function ensureSuperDragPointerCaptured(pointerId) {
  if (superDragPointerId == null && pointerId != null) {
    captureSuperDragPointer(pointerId);
  }
}

function isSuperDragFeatureEnabled() {
  if (!settingsLoaded || !isExtensionValid) return false;
  if (!settings?.enableSuperDrag) return false;
  return !isSiteInDisabledList(window.location.href);
}

function isEventTargetOnLink(e) {
  let el = e?.target;
  while (el && el !== document.body) {
    if (el.tagName === 'A') {
      const href = el.href || el.getAttribute?.('href');
      if (href && !String(href).toLowerCase().startsWith('javascript:')) return true;
    }
    el = el.parentElement;
  }
  return false;
}

const SUPER_DRAG_NAV_SUPPRESS_MS = 900;

function markSuperDragNavigationSuppressed(ms = SUPER_DRAG_NAV_SUPPRESS_MS) {
  suppressSuperDragNavigationUntil = Date.now() + ms;
}

function markPointerSyntheticSuperDragExecuted() {
  pointerSyntheticSuperDragExecutedAt = Date.now();
}

function wasPointerSyntheticSuperDragExecutedRecently(ms = 800) {
  return Date.now() - pointerSyntheticSuperDragExecutedAt < ms;
}

function preventSyntheticSuperDragSelection(e) {
  try {
    e.preventDefault();
    e.stopPropagation();
  } catch (_) { /* ignore */ }
}

function clearPageSelectionForSyntheticSuperDrag() {
  try {
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount) sel.removeAllRanges();
  } catch (_) { /* ignore */ }
}

function enableSyntheticSuperDragSelectionGuard(clearExisting = true) {
  if (clearExisting) clearPageSelectionForSyntheticSuperDrag();
  if (syntheticSuperDragSelectionGuardActive) return;
  syntheticSuperDragSelectionGuardActive = true;
  const html = document.documentElement;
  const body = document.body;
  try {
    syntheticSuperDragPrevHtmlUserSelect = html?.style?.userSelect || '';
    syntheticSuperDragPrevHtmlWebkitUserSelect = html?.style?.webkitUserSelect || '';
    syntheticSuperDragPrevBodyUserSelect = body?.style?.userSelect || '';
    syntheticSuperDragPrevBodyWebkitUserSelect = body?.style?.webkitUserSelect || '';
    if (html && html.style) {
      html.style.userSelect = 'none';
      html.style.webkitUserSelect = 'none';
    }
    if (body && body.style) {
      body.style.userSelect = 'none';
      body.style.webkitUserSelect = 'none';
    }
  } catch (_) { /* ignore */ }
  try {
    document.addEventListener('selectstart', preventSyntheticSuperDragSelection, { capture: true });
  } catch (_) { /* ignore */ }
}

function disableSyntheticSuperDragSelectionGuard() {
  if (!syntheticSuperDragSelectionGuardActive) return;
  syntheticSuperDragSelectionGuardActive = false;
  const html = document.documentElement;
  const body = document.body;
  try {
    if (html && html.style) {
      html.style.userSelect = syntheticSuperDragPrevHtmlUserSelect;
      html.style.webkitUserSelect = syntheticSuperDragPrevHtmlWebkitUserSelect;
    }
    if (body && body.style) {
      body.style.userSelect = syntheticSuperDragPrevBodyUserSelect;
      body.style.webkitUserSelect = syntheticSuperDragPrevBodyWebkitUserSelect;
    }
  } catch (_) { /* ignore */ }
  try {
    document.removeEventListener('selectstart', preventSyntheticSuperDragSelection, true);
  } catch (_) { /* ignore */ }
  syntheticSuperDragPrevHtmlUserSelect = '';
  syntheticSuperDragPrevBodyUserSelect = '';
  syntheticSuperDragPrevHtmlWebkitUserSelect = '';
  syntheticSuperDragPrevBodyWebkitUserSelect = '';
}

function handleSuperDragNavigationSuppress(e) {
  if (!isTrustedUserEvent(e)) return;
  if (Date.now() > suppressSuperDragNavigationUntil) return;
  const type = e.type || '';
  if (type === 'auxclick' && e.button !== 1) return;
  if ((type === 'click' || type === 'mousedown' || type === 'mouseup') && e.button !== 0) return;
  if (!isEventTargetOnLink(e)) return;
  e.preventDefault();
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === 'function') {
    e.stopImmediatePropagation();
  }
}

// N 卡检测缓存：为兼容 HDR/RTX VSR，N 卡时自动使用简化手势提示（无 backdrop-filter）
const NVIDIA_GPU_STORAGE_KEY = 'mouse_isNvidiaGpu';
let isNvidiaGpuCached = null;

function publishNvidiaGpuResult(value) {
  isNvidiaGpuCached = !!value;
  if (window === window.top) {
    try { window.__mouseIsNvidiaGpu = isNvidiaGpuCached; } catch (_) {}
  }
  try {
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ [NVIDIA_GPU_STORAGE_KEY]: isNvidiaGpuCached });
    }
  } catch (_) {}
}

function releaseWebGlProbe(gl, canvas) {
  try {
    const loseExt = gl.getExtension('WEBGL_lose_context');
    if (loseExt) loseExt.loseContext();
  } catch (_) {}
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch (_) {}
}

function readNvidiaGpuFromTopFrame() {
  try {
    if (window.top !== window && typeof window.top.__mouseIsNvidiaGpu === 'boolean') {
      isNvidiaGpuCached = window.top.__mouseIsNvidiaGpu;
      return true;
    }
  } catch (_) {}
  return false;
}

function probeNvidiaGpuInTopFrame() {
  if (window !== window.top || isNvidiaGpuCached !== null) return;
  try {
    const canvas = createMouseExtElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      publishNvidiaGpuResult(false);
      return;
    }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
    publishNvidiaGpuResult(/nvidia/i.test(renderer));
    releaseWebGlProbe(gl, canvas);
  } catch (e) {
    publishNvidiaGpuResult(false);
  }
}

function initNvidiaGpuDetection() {
  if (readNvidiaGpuFromTopFrame()) return;
  try {
    if (!chrome?.storage?.local) {
      if (window === window.top) probeNvidiaGpuInTopFrame();
      return;
    }
    chrome.storage.local.get({ [NVIDIA_GPU_STORAGE_KEY]: null }, (items) => {
      if (chrome.runtime.lastError) {
        if (window === window.top) probeNvidiaGpuInTopFrame();
        return;
      }
      const stored = items[NVIDIA_GPU_STORAGE_KEY];
      if (stored !== null && stored !== undefined) {
        publishNvidiaGpuResult(stored);
        return;
      }
      probeNvidiaGpuInTopFrame();
    });
  } catch (_) {
    if (window === window.top) probeNvidiaGpuInTopFrame();
  }
}

function isNvidiaGpu() {
  if (isNvidiaGpuCached !== null) return isNvidiaGpuCached;
  if (readNvidiaGpuFromTopFrame()) return isNvidiaGpuCached;
  // 子 frame 不创建 WebGL，避免 all_frames 注入时在多 iframe 页面耗尽上下文
  if (window !== window.top) return false;
  probeNvidiaGpuInTopFrame();
  return isNvidiaGpuCached === null ? false : isNvidiaGpuCached;
}

// 添加提示节流相关变量
let lastHintTime = 0;
let lastHintAction = '';
let hintThrottleDelay = 300; // 提示节流延迟（毫秒）
const NEXT_PAGE_SUCCESS_KEY = '_mg_lastNextPageSuccessTime'; // 翻页成功时间戳，用于抑制迟到的 noNextPage

// 添加导航错误翻译
function getNavigationErrorTranslations() {
  return {
    noForwardPage: getI18nMessage('noForwardPage', 'No forward page available'),
    noBackPage: getI18nMessage('noBackPage', 'No back page available'),
    navigationFailed: getI18nMessage('navigationFailed', 'Navigation failed'),
    tryingNextPage: getI18nMessage('tryingNextPage', 'Trying next page...'),
    nextPageSuccess: getI18nMessage('nextPageSuccess', 'Navigate to next page'),
    noNextPage: getI18nMessage('noNextPage', 'No next page link found')
  };
}

// 手势动作翻译
let cachedGestureTranslations = null;

function getGestureTranslations() {
  if (cachedGestureTranslations) return cachedGestureTranslations;
  cachedGestureTranslations = {
    'back': getI18nMessage('back', 'Back'),
    'forward': getI18nMessage('forward', 'Forward'),
    'scrollUp': getI18nMessage('scrollUp', 'Scroll Up'),
    'scrollDown': getI18nMessage('scrollDown', 'Scroll Down'),
    'scrollLeft': getI18nMessage('scrollLeft', 'Scroll Left'),
    'scrollRight': getI18nMessage('scrollRight', 'Scroll Right'),
    'forceRefresh': getI18nMessage('forceRefresh', 'Force Refresh'),
    'closeTab': getI18nMessage('closeTab', 'Close Tab'),
    'reopenTab': getI18nMessage('reopenTab', 'Reopen Closed Tab'),
    'newTab': getI18nMessage('newTab', 'New Tab'),
    'refresh': getI18nMessage('refresh', 'Refresh'),
    'prevTab': getI18nMessage('prevTab', 'Previous Tab'),
    'nextTab': getI18nMessage('nextTab', 'Next Tab'),
    'previousActiveTab': getI18nMessage('previousActiveTab', 'Previous Active Tab'),
    'goToParentUrl': getI18nMessage('goToParentUrl', 'Parent URL'),
    'goToRootUrl': getI18nMessage('goToRootUrl', 'Root URL'),
    'stopLoading': getI18nMessage('stopLoading', 'Stop Loading'),
    'closeAllTabs': getI18nMessage('closeAllTabs', 'Close All Tabs'),
    'scrollToBottom': getI18nMessage('scrollToBottom', 'Scroll to Bottom'),
    'scrollToTop': getI18nMessage('scrollToTop', 'Scroll to Top'),
    'scrollToLeft': getI18nMessage('scrollToLeft', 'Scroll to Left Edge'),
    'scrollToRight': getI18nMessage('scrollToRight', 'Scroll to Right Edge'),
    'invalidGesture': getI18nMessage('invalidGesture', 'Invalid Gesture'),
    'closeOtherTabs': getI18nMessage('closeOtherTabs', 'Close Other Tabs'),
    'closeTabsToRight': getI18nMessage('closeTabsToRight', 'Close Tabs to Right'),
    'closeTabsToLeft': getI18nMessage('closeTabsToLeft', 'Close Tabs to Left'),
    'reloadAllTabs': getI18nMessage('reloadAllTabs', 'Reload All Tabs'),
    'stopLoadingAllTabs': getI18nMessage('stopLoadingAllTabs', 'Stop All Tabs Loading'),
    'screenshotRegion': getI18nMessage('screenshotRegion', 'Screenshot: trail region'),
    'screenshotRegionOrLink': getI18nMessage(
      'screenshotRegionOrLink',
      'Screenshot or open link in new tab'
    ),
    'togglePinTab': getI18nMessage('togglePinTab', 'Pin/Unpin Tab'),
    'toggleMuteTab': getI18nMessage('toggleMuteTab', 'Mute/Unmute Tab'),
    'muteOtherTabs': getI18nMessage('muteOtherTabs', 'Mute Other Tabs'),
    'toggleMaximize': getI18nMessage('toggleMaximize', 'Maximize/Restore Window'),
    'minimizeWindow': getI18nMessage('minimizeWindow', 'Minimize Window'),
    'toggleFullscreen': getI18nMessage('toggleFullscreen', 'Toggle Fullscreen'),
    'zoomIn': getI18nMessage('zoomIn', 'Zoom In'),
    'zoomOut': getI18nMessage('zoomOut', 'Zoom Out'),
    'newWindow': getI18nMessage('newWindow', 'New Window'),
    'newInPrivateWindow': getI18nMessage('newInPrivateWindow', 'New Private Window')
  };
  return cachedGestureTranslations;
}

const GESTURE_ACTION_HINT_TRANSLATION_KEY = {
  newWindow: 'newWindow',
  newInPrivateWindow: 'newInPrivateWindow',
  goBack: 'back',
  forward: 'forward',
  scrollUp: 'scrollUp',
  scrollDown: 'scrollDown',
  scrollLeft: 'scrollLeft',
  scrollRight: 'scrollRight',
  closeTab: 'closeTab',
  reopenClosedTab: 'reopenTab',
  openNewTab: 'newTab',
  refresh: 'refresh',
  forceRefresh: 'forceRefresh',
  switchToLeftTab: 'prevTab',
  switchToRightTab: 'nextTab',
  switchToPreviousActiveTab: 'previousActiveTab',
  goToParentUrl: 'goToParentUrl',
  goToRootUrl: 'goToRootUrl',
  stopLoading: 'stopLoading',
  closeAllTabs: 'closeAllTabs',
  scrollToBottom: 'scrollToBottom',
  scrollToTop: 'scrollToTop',
  closeOtherTabs: 'closeOtherTabs',
  closeTabsToRight: 'closeTabsToRight',
  closeTabsToLeft: 'closeTabsToLeft',
  reloadAllTabs: 'reloadAllTabs',
  stopLoadingAllTabs: 'stopLoadingAllTabs',
  togglePinTab: 'togglePinTab',
  toggleMuteTab: 'toggleMuteTab',
  muteOtherTabs: 'muteOtherTabs',
  toggleMaximize: 'toggleMaximize',
  minimizeWindow: 'minimizeWindow',
  toggleFullscreen: 'toggleFullscreen',
  zoomIn: 'zoomIn',
  zoomOut: 'zoomOut',
  scrollToLeft: 'scrollToLeft',
  scrollToRight: 'scrollToRight'
};

function getGestureActionHintText(action) {
  if (!action || action === 'noAction') return '';
  const key = GESTURE_ACTION_HINT_TRANSLATION_KEY[action];
  if (!key) return '';
  return getGestureTranslations()[key] || getI18nMessage(key, action);
}

const GESTURE_SCROLL_ACTIONS = new Set([
  'scrollUp',
  'scrollDown',
  'scrollLeft',
  'scrollRight',
  'scrollToTop',
  'scrollToBottom',
  'scrollToLeft',
  'scrollToRight'
]);

function isGestureScrollAction(action) {
  return GESTURE_SCROLL_ACTIONS.has(action);
}

// 记录拖拽信息的变量
let dragInfo = {
  startX: 0,
  startY: 0,
  direction: '',
  target: null,
  url: '',
  text: '',
  type: '' // 'link', 'image', 'text'
};

// 添加拖拽与点击区分所需的变量
let potentialDragImage = null; // 合成拖拽：透明层覆盖下的图片
let potentialDragLink = null; // 合成拖拽：页面/轮播脚本阻止原生 dragstart 时的链接兜底
let potentialDragEditable = null; // 合成拖拽：contenteditable/input 内选中文本外拖
let potentialDragSelection = null; // 页面选中文本：原生 drag 失败时（Bing 等）才走 pointer 合成超级拖拽
let superDragPointerId = null; // 超级拖拽 pointer 捕获
let suppressSuperDragNavigationUntil = 0; // 合成拖拽完成后阻止链接误跳转
let pointerSyntheticSuperDragExecutedAt = 0; // pointer 合成拖拽已执行，避免 dragend 重复开页
let lastEditableSuperDragFinishAt = 0; // 输入框/可编辑区拖拽收尾去重（pointerup 与 dragend）
let editableSuperDragSessionSynced = false; // 可编辑区 HTML5 拖拽：离开源框后再同步 session，避免框内拖放闪罗盘
let syntheticSuperDragSelectionGuardActive = false; // 图片/链接合成拖拽期间抑制页面误选中
let syntheticSuperDragPrevHtmlUserSelect = '';
let syntheticSuperDragPrevBodyUserSelect = '';
let syntheticSuperDragPrevHtmlWebkitUserSelect = '';
let syntheticSuperDragPrevBodyWebkitUserSelect = '';
let mouseDownPosition = { x: 0, y: 0 }; // 鼠标按下的位置
let mouseCurrentPosition = { x: 0, y: 0 }; // 当前鼠标位置
let dragDistanceThreshold = 5; // 判断为拖拽的最小像素距离（罗盘方向）
let superDragCompassEl = null; // 超级拖拽八向示意图
let superDragCompassPlacedKey = ''; // 当前拖拽会话是否已定位（避免 caption 变高时每帧重算导致晃动）
let superDragCompassForwardRafId = 0; // iframe 转发罗盘位置时按帧合并，避免高频 runtime 消息
let pendingSuperDragCompassForward = null;
let lastSuperDragSessionDirectionWritten = '';
let lastSuperDragSessionDirectionWriteAt = 0;
let lastLockedSuperDragDirection = ''; // 松手前最后一帧有效八向，dragend 优先使用
const SUPER_DRAG_SESSION_DIRECTION_SYNC_MS = 50;
const SUPER_DRAG_COMPASS_POSITIONS = [
  'compassAbove',
  'compassRight',
  'compassBelow',
  'compassLeft',
  'compassHub',
  'compassScreenCenter',
  'compassScreenTop',
  'compassScreenRight',
  'compassScreenBottom',
  'compassScreenLeft',
  'compassHidden'
];
const SUPER_DRAG_COMPASS_DRAG_GAP = 20;
const SUPER_DRAG_STORAGE_KEY_PREFIX = 'mouseSuperDragCrossFrameSession:';
const IFRAME_TOP_TRAIL_CONTINUE_MS = 2000;
let cachedSuperDragSession = { active: false, startX: 0, startY: 0, type: '', mode: '', direction: '' };
let superDragStorageListenerReady = false;

// 全局变量用于跟踪重复标签页通知
let tabNotification = null;
// 记录上次尝试的下一页链接
let lastTriedNextPageLink = null;

// 显示重复标签页通知（仅顶层 frame，避免 all_frames 注入导致 iframe 内重复弹出）
function showDuplicateTabsNotification(data) {
  try {
    if (window !== window.top) return;
    if (typeof MouseExtUiHost === 'undefined') return;
    MouseExtUiHost.removeElementById('mouse-gesture-notification-container');
    
    // 文本翻译
    const texts = {
      title: getI18nMessage('duplicateTabsDetected', [data.count.toString()], 
          `Found ${data.count} duplicate tab${data.count > 1 ? 's' : ''}`),
      moreTabs: getI18nMessage('moreTabsHidden', [`${data.titles.length - 5}`], 
          `...and ${data.titles.length - 5} more pages`),
      noUrl: getI18nMessage('duplicateTab', 'Duplicate tab'),
      closeBtn: getI18nMessage('closeBtn', 'Close Duplicates'),
      ignoreBtn: getI18nMessage('ignoreBtn', 'Ignore')
    };
    
    // 创建通知容器
    const container = createMouseExtElement('div');
    container.id = 'mouse-gesture-notification-container';
    container.style.position = 'fixed';
    container.style.bottom = '28px';
    container.style.left = '50%';
    container.style.transform = 'translateX(-50%)';
    container.style.zIndex = '2147483647';
    container.style.transition = 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    container.style.opacity = '0';
    container.style.filter = 'drop-shadow(0 8px 20px rgba(0, 0, 0, 0.15))';
    container.style.maxWidth = '420px';
    container.style.width = 'calc(100% - 40px)';
    container.style.boxSizing = 'border-box';
    container.style.padding = '0';
    container.style.margin = '0';
    container.style.border = 'none';
    container.style.background = 'none';
    
    // 创建通知框 - 使用现代化渐变背景
    const notification = createMouseExtElement('div');
    notification.style.background = 'linear-gradient(135deg, rgba(55, 55, 80, 0.92) 0%, rgba(40, 40, 65, 0.94) 100%)';
    notification.style.color = '#ffffff';
    notification.style.padding = '16px 22px';
    notification.style.borderRadius = '16px';
    notification.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.18), inset 0 1px 2px rgba(255, 255, 255, 0.1)';
    notification.style.display = 'flex';
    notification.style.alignItems = 'flex-start';
    notification.style.backdropFilter = 'blur(12px)';
    notification.style.webkitBackdropFilter = 'blur(12px)';
    notification.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    notification.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    notification.style.boxSizing = 'border-box';
    notification.style.width = '100%';
    notification.style.margin = '0';
    
    // 创建一个更可爱的图标 - 缩小尺寸
    const icon = createMouseExtElement('div');
    // 使用更可爱的表情符号组合
    icon.innerHTML = '🔍✨';
    icon.style.fontSize = '18px';
    icon.style.marginInlineEnd = '12px';
    icon.style.marginTop = '2px';
    icon.style.display = 'flex';
    icon.style.alignItems = 'center';
    icon.style.justifyContent = 'center';
    icon.style.width = '32px';
    icon.style.height = '32px';
    icon.style.minWidth = '32px';
    icon.style.minHeight = '32px';
    icon.style.borderRadius = '10px';
    icon.style.background = 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.05) 100%)';
    icon.style.boxShadow = 'inset 0 1px 1px rgba(255, 255, 255, 0.1)';
    icon.style.flexShrink = '0';
    
    // 信息容器
    const content = createMouseExtElement('div');
    content.style.flexGrow = '1';
    content.style.flexShrink = '1';
    content.style.minWidth = '0';
    content.style.boxSizing = 'border-box';
    
    // 消息标题 - 更时尚的字体和样式
    const title = createMouseExtElement('div');
    title.textContent = texts.title;
    title.style.fontWeight = '600';
    title.style.fontSize = '15px';
    title.style.marginBottom = '8px';
    title.style.letterSpacing = '0.3px';
    title.style.color = '#FFFFFF';
    title.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.1)';
    title.style.boxSizing = 'border-box';
    title.style.width = '100%';
    title.style.padding = '0';
    
    // 创建URL列表容器
    const urlListContainer = createMouseExtElement('div');
    urlListContainer.style.fontSize = '13px';
    urlListContainer.style.lineHeight = '1.5';
    urlListContainer.style.color = '#f0f0f5';
    urlListContainer.style.opacity = '0.85';
    urlListContainer.style.maxHeight = '90px';
    urlListContainer.style.overflow = 'auto';
    urlListContainer.style.marginBottom = '4px';
    urlListContainer.style.paddingInlineEnd = '4px';
    urlListContainer.style.scrollbarWidth = 'thin';
    urlListContainer.style.scrollbarColor = 'rgba(255,255,255,0.2) transparent';
    urlListContainer.style.boxSizing = 'border-box';
    urlListContainer.style.width = '100%';
    urlListContainer.classList.add('url-list');
    
    // 显示URL标题，每行一个
    if (data.titles && data.titles.length > 0) {
      // 最多显示5个URL
      const maxUrlsToShow = 5;
      const titlesToShow = data.titles.slice(0, maxUrlsToShow);
      
      titlesToShow.forEach((titleText, index) => {
        const urlItem = createMouseExtElement('div');
        urlItem.style.cssText = `
          display: flex !important;
          align-items: center !important;
          margin-bottom: 4px !important;
          box-sizing: border-box !important;
          width: 100% !important;
          padding: 0 !important;
        `;
        
        // 添加小圆点作为前缀
        const bullet = createMouseExtElement('span');
        bullet.textContent = '•';
        bullet.style.cssText = `
          color: #FF82A9 !important;
          margin-inline-end: 6px !important;
          font-size: 16px !important;
          line-height: 1 !important;
          flex-shrink: 0 !important;
        `;
        
        // URL标题容器，添加文本截断
        const urlTitle = createMouseExtElement('span');
        urlTitle.textContent = titleText;
        urlTitle.style.cssText = `
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: ellipsis !important;
          max-width: 300px !important;
          display: block !important;
          flex-grow: 1 !important;
          flex-shrink: 1 !important;
          min-width: 0 !important;
          box-sizing: border-box !important;
        `;
        
        urlItem.appendChild(bullet);
        urlItem.appendChild(urlTitle);
        urlListContainer.appendChild(urlItem);
      });
      
      // 如果有更多URL没有显示，添加提示
      if (data.titles.length > maxUrlsToShow) {
        const moreUrls = createMouseExtElement('div');
        moreUrls.textContent = texts.moreTabs;
        moreUrls.style.cssText = `
          font-size: 12px !important;
          font-style: italic !important;
          opacity: 0.7 !important;
          margin-top: 2px !important;
          padding-inline-start: 12px !important;
          box-sizing: border-box !important;
          width: 100% !important;
        `;
        urlListContainer.appendChild(moreUrls);
      }
    } else {
      const noUrlMessage = createMouseExtElement('div');
      noUrlMessage.textContent = data.title || texts.noUrl;
      noUrlMessage.style.cssText = `
        font-style: italic !important;
        box-sizing: border-box !important;
        width: 100% !important;
        padding: 0 !important;
      `;
      urlListContainer.appendChild(noUrlMessage);
    }
    
    // 按钮容器 - 更美观的布局
    const buttons = createMouseExtElement('div');
    buttons.style.display = 'flex';
    buttons.style.marginTop = '14px';
    buttons.style.gap = '10px';
    buttons.style.justifyContent = 'flex-end';
    buttons.style.boxSizing = 'border-box';
    buttons.style.width = '100%';
    buttons.style.padding = '0';
    
    // 忽略按钮 - 半透明+玻璃效果
    const ignoreBtn = createMouseExtElement('button');
    ignoreBtn.textContent = texts.ignoreBtn;
    ignoreBtn.style.background = 'rgba(255, 255, 255, 0.12)';
    ignoreBtn.style.backdropFilter = 'blur(5px)';
    ignoreBtn.style.webkitBackdropFilter = 'blur(5px)';
    ignoreBtn.style.color = 'white';
    ignoreBtn.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    ignoreBtn.style.padding = '8px 16px';
    ignoreBtn.style.borderRadius = '20px';
    ignoreBtn.style.cursor = 'pointer';
    ignoreBtn.style.fontSize = '13px';
    ignoreBtn.style.fontWeight = '500';
    ignoreBtn.style.transition = 'all 0.2s ease';
    ignoreBtn.style.transform = 'translateY(0)';
    ignoreBtn.style.fontFamily = 'inherit';
    ignoreBtn.style.margin = '0';
    ignoreBtn.style.minWidth = 'auto';
    ignoreBtn.style.minHeight = 'auto';
    ignoreBtn.style.lineHeight = 'normal';
    ignoreBtn.style.outline = 'none';
    
    // 修复鼠标悬停样式问题
    ignoreBtn.addEventListener('mouseover', () => {
      ignoreBtn.style.background = 'rgba(255, 255, 255, 0.2)';
      ignoreBtn.style.transform = 'translateY(-2px)';
    });
    
    ignoreBtn.addEventListener('mouseout', () => {
      ignoreBtn.style.background = 'rgba(255, 255, 255, 0.12)';
      ignoreBtn.style.transform = 'translateY(0)';
    });
    
    ignoreBtn.onclick = () => {
      ignoreDuplicateTabs(data.notificationId);
      if (container.parentNode) container.parentNode.removeChild(container);
    };
    
    // 关闭重复标签按钮 - 渐变粉红色
    const closeBtn = createMouseExtElement('button');
    closeBtn.textContent = texts.closeBtn;
    closeBtn.style.background = 'linear-gradient(to right, #FF5E8A, #FF82A9)';
    closeBtn.style.color = 'white';
    closeBtn.style.border = 'none';
    closeBtn.style.padding = '8px 16px';
    closeBtn.style.borderRadius = '20px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '13px';
    closeBtn.style.fontWeight = '600';
    closeBtn.style.letterSpacing = '0.3px';
    closeBtn.style.boxShadow = '0 4px 12px rgba(255, 94, 138, 0.25)';
    closeBtn.style.transition = 'all 0.2s ease';
    closeBtn.style.transform = 'translateY(0)';
    closeBtn.style.fontFamily = 'inherit';
    closeBtn.style.margin = '0';
    closeBtn.style.minWidth = 'auto';
    closeBtn.style.minHeight = 'auto';
    closeBtn.style.lineHeight = 'normal';
    closeBtn.style.outline = 'none';
    
    // 修复鼠标悬停样式问题
    closeBtn.addEventListener('mouseover', () => {
      closeBtn.style.transform = 'translateY(-2px)';
      closeBtn.style.boxShadow = '0 6px 16px rgba(255, 94, 138, 0.35)';
      closeBtn.style.background = 'linear-gradient(to right, #FF5183, #FF78A1)';
    });
    
    closeBtn.addEventListener('mouseout', () => {
      closeBtn.style.transform = 'translateY(0)';
      closeBtn.style.boxShadow = '0 4px 12px rgba(255, 94, 138, 0.25)';
      closeBtn.style.background = 'linear-gradient(to right, #FF5E8A, #FF82A9)';
    });
    
    closeBtn.onclick = () => {
      closeDuplicateTabs(data.notificationId);
      if (container.parentNode) container.parentNode.removeChild(container);
    };
    
    // 组装通知
    content.appendChild(title);
    content.appendChild(urlListContainer);
    content.appendChild(buttons);
    buttons.appendChild(ignoreBtn);
    buttons.appendChild(closeBtn);
    notification.appendChild(icon);
    notification.appendChild(content);
    container.appendChild(notification);

    if (!MouseExtUiHost.appendToNotificationsLayer(container)) return;
    
    // 淡入效果 - 带有轻微的弹性效果
  setTimeout(() => {
      container.style.opacity = '1';
      container.style.transform = 'translate(-50%, -5px)';
      
      // 稍后恢复正常位置，产生弹性效果
      setTimeout(() => {
        container.style.transform = 'translate(-50%, 0)';
      }, 180);
    }, 10);
    
    // 8秒后自动淡出（时间延长）
    setTimeout(() => {
      try {
        container.style.opacity = '0';
        container.style.transform = 'translate(-50%, 10px)';
        setTimeout(() => {
          try {
            if (container.parentNode) {
              container.parentNode.removeChild(container);
            }
          } catch (e) {
            console.log('自动关闭通知错误:', e.message);
          }
        }, 400);
      } catch (e) {
        console.log('通知淡出效果错误:', e.message);
      }
    }, 8000);
  } catch (e) {
    console.error('显示重复标签页通知错误:', e.message);
  }
}

// 关闭重复标签页
function closeDuplicateTabs(notificationId) {
  try {
    console.log('关闭重复标签页:', notificationId);
    chrome.runtime.sendMessage({
      action: 'closeDuplicateTabs',
      notificationId: notificationId
    }, response => {
      if (chrome.runtime.lastError) {
        console.error('发送关闭请求错误:', chrome.runtime.lastError.message);
        return;
      }
      
      console.log('关闭重复标签页响应:', response);
    });
  } catch (e) {
    console.error('关闭重复标签页错误:', e.message);
  }
}

// 忽略重复标签页通知
function ignoreDuplicateTabs(notificationId) {
  try {
    console.log('忽略重复标签页通知:', notificationId);
    chrome.runtime.sendMessage({
      action: 'ignoreDuplicateTabs',
      notificationId: notificationId
    }, response => {
      if (chrome.runtime.lastError) {
        console.error('发送忽略请求错误:', chrome.runtime.lastError.message);
        return;
      }
      
      console.log('忽略重复标签页响应:', response);
    });
  } catch (e) {
    console.error('忽略重复标签页错误:', e.message);
  }
}

// 检查文本是否是有效的URL
function isValidUrl(text) {
  // 简单URL格式验证
  if (!text) return false;
  
  // 去除首尾空格
  text = text.trim();
  
  // 先检查是否是纯数字或带小数点的数字（排除IP地址格式）
  // 这将匹配如 8.8, 8.8.8, 1.23.45 等纯数字和小数
  if (/^[0-9.]+$/.test(text)) {
    // 检查是否是可能的IP地址格式（4段式IP地址如 8.8.8.8）
    const ipParts = text.split('.');
    // 如果不是4段式IP地址，且看起来像是小数，则不视为URL
    if (ipParts.length !== 4 || ipParts.some(part => !part)) {
      return false;
    }
  }
  
  // 如果已经包含协议，直接验证
  if (text.startsWith('http://') || text.startsWith('https://') || text.startsWith('ftp://')) {
    try {
      new URL(text);
      return true;
    } catch (e) {
      return false;
    }
  }
  
  // 检查常见域名格式
  const domainRegex = /^(www\.)?[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(\.[a-zA-Z]{2,})?([\/\?#].*)?$/;
  return domainRegex.test(text);
}

// 安全地发送单向消息（不等待响应），扩展失效时静默失败，不抛出
function safeSendMessageSilent(message) {
  if (!isExtensionValid) return;
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch (e) {
    if (e?.message?.includes('Extension context invalidated')) isExtensionValid = false;
  }
}

/** 超级拖拽：先领取一次性 lease，再发送 superDrag（须处于 trusted 拖拽 session） */
let superDragSessionId = null;

function beginSuperDragSession() {
  superDragSessionId = 'sds_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  lastLockedSuperDragDirection = '';
  if (window !== window.top) beginCrossFrameSession();
  return superDragSessionId;
}

function endSuperDragSession() {
  superDragSessionId = null;
}

function sendSuperDragMessage(payload, onDone) {
  const sessionId = superDragSessionId;
  if (!isExtensionValid || !sessionId) {
    if (typeof onDone === 'function') onDone();
    return;
  }
  const crossFields = window !== window.top ? crossFrameSessionFields() : {};
  try {
    chrome.runtime.sendMessage(
      Object.assign({ action: 'acquireSuperDragLease', _superDragSessionId: sessionId }, crossFields),
      (leaseResp) => {
      if (chrome.runtime.lastError || !leaseResp || !leaseResp.success || !leaseResp.token) {
        if (typeof onDone === 'function') onDone();
        return;
      }
      chrome.runtime.sendMessage(
        Object.assign(
          { _superDragLease: leaseResp.token, _superDragSessionId: sessionId },
          payload,
          crossFields
        ),
        () => {
          if (chrome.runtime.lastError && chrome.runtime.lastError.message.includes('Extension context invalidated')) {
            isExtensionValid = false;
          }
          if (typeof onDone === 'function') onDone();
        }
      );
    });
  } catch (e) {
    if (e?.message?.includes('Extension context invalidated')) isExtensionValid = false;
    if (typeof onDone === 'function') onDone();
  }
}

/** iframe 手势跨 frame 会话 token（由 top frame 担保后 background 校验） */
let crossFrameSessionToken = null;
let crossFrameSessionReady = false;
let crossFrameSessionWaiters = [];
let crossFrameSessionPending = false;
let crossFrameSessionRetryCount = 0;
let crossFrameSessionRetryTimer = 0;

function beginCrossFrameSession() {
  if (window === window.top) return null;
  if (crossFrameSessionToken && crossFrameSessionReady) return crossFrameSessionToken;

  const requestSession = () => {
    if (crossFrameSessionReady || crossFrameSessionPending || !crossFrameSessionToken) return;
    if (crossFrameSessionRetryCount >= 30) return;
    crossFrameSessionPending = true;
    try {
      chrome.runtime.sendMessage(
        { action: 'requestCrossFrameSession', token: crossFrameSessionToken },
        (response) => {
          crossFrameSessionPending = false;
          crossFrameSessionReady = !!(response && response.success === true);
          if (!crossFrameSessionReady && (isGestureInProgress || isRightMouseDown)) {
            crossFrameSessionRetryCount++;
            if (crossFrameSessionRetryTimer) clearTimeout(crossFrameSessionRetryTimer);
            crossFrameSessionRetryTimer = setTimeout(requestSession, 40);
            return;
          }
          crossFrameSessionRetryCount = 0;
          if (crossFrameSessionRetryTimer) {
            clearTimeout(crossFrameSessionRetryTimer);
            crossFrameSessionRetryTimer = 0;
          }
          if (crossFrameSessionReady && isGestureInProgress) {
            syncGestureStateToStorage(true, 0, contentFrameId);
          }
          const waiters = crossFrameSessionWaiters.splice(0);
          waiters.forEach((fn) => fn(crossFrameSessionReady));
        }
      );
    } catch (e) {
      crossFrameSessionPending = false;
      crossFrameSessionReady = false;
      const waiters = crossFrameSessionWaiters.splice(0);
      waiters.forEach((fn) => fn(false));
    }
  };

  const bootstrapSession = () => {
    requestSession();
  };

  if (!crossFrameSessionToken) {
    crossFrameSessionToken = 'cf_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    crossFrameSessionReady = false;
    initContentContext(bootstrapSession);
  } else if (!crossFrameSessionReady) {
    initContentContext(requestSession);
  }

  return crossFrameSessionToken;
}

function whenCrossFrameSessionReady(fn) {
  if (window === window.top) {
    fn(true);
    return;
  }
  if (crossFrameSessionReady) {
    fn(true);
    return;
  }
  beginCrossFrameSession();
  crossFrameSessionWaiters.push(fn);
}

function endCrossFrameSession() {
  if (!crossFrameSessionToken) return;
  const token = crossFrameSessionToken;
  crossFrameSessionToken = null;
  crossFrameSessionReady = false;
  crossFrameSessionPending = false;
  const waiters = crossFrameSessionWaiters.splice(0);
  crossFrameSessionWaiters = [];
  waiters.forEach((fn) => {
    try {
      fn(false);
    } catch (e) { /* ignore */ }
  });
  safeSendMessageSilent(
    Object.assign({ action: 'clearCrossFrameSession', token, childFrameId: contentFrameId })
  );
}

function crossFrameSessionFields() {
  return crossFrameSessionToken ? { _crossFrameToken: crossFrameSessionToken } : {};
}

/** iframe 内向后端发手势 action，等待 cross-frame session 就绪 */
function sendGestureAction(message, onDone) {
  if (window === window.top) {
    safeSendMessage(message).then((resp) => {
      if (typeof onDone === 'function') onDone(resp);
    });
    return;
  }
  whenCrossFrameSessionReady((ready) => {
    if (!ready) {
      if (typeof onDone === 'function') onDone({ success: false, error: 'no_cross_frame_session' });
      return;
    }
    safeSendMessage(Object.assign({}, message, crossFrameSessionFields())).then((resp) => {
      if (typeof onDone === 'function') onDone(resp);
    });
  });
}

/** iframe 内向 top 转发 UI 类单向消息（罗盘等），须等 cross-frame session */
function sendCrossFrameSilent(message) {
  if (window === window.top) {
    safeSendMessageSilent(message);
    return;
  }
  whenCrossFrameSessionReady((ready) => {
    if (!ready) return;
    safeSendMessageSilent(Object.assign({}, message, crossFrameSessionFields()));
  });
}

/** 后台/跨 frame 动作完成后才 reset，避免与 in-flight 消息重叠 */
const IFRAME_TOP_RELAY_ACTIONS = new Set([
  'closeAllTabs',
  'closeOtherTabs',
  'closeTabsToRight',
  'closeTabsToLeft',
  'reloadAllTabs',
  'stopLoadingAllTabs',
  'muteOtherTabs',
  'newWindow',
  'newInPrivateWindow',
  'toggleMaximize',
  'minimizeWindow'
]);

function deferResetAfterBackgroundAction(message, resetGestureAfterAction, immediate) {
  const finish = () => resetGestureAfterAction(immediate === true);
  if (
    window !== window.top &&
    message &&
    message.action &&
    IFRAME_TOP_RELAY_ACTIONS.has(message.action)
  ) {
    safeSendMessageWhenSessionReady({
      action: 'relayTopFrameGestureAction',
      gestureAction: message.action,
      gesturePayload: message
    }).then(() => finish());
    return;
  }
  sendGestureAction(message, finish);
}

function safeSendMessageWhenSessionReady(message) {
  if (window === window.top) return safeSendMessage(message);
  return new Promise((resolve) => {
    whenCrossFrameSessionReady((ready) => {
      if (!ready) {
        resolve({ success: false, error: 'no_cross_frame_session' });
        return;
      }
      safeSendMessage(message).then(resolve);
    });
  });
}

// 安全地发送消息到扩展
function safeSendMessage(message) {
  if (!isExtensionValid) return Promise.resolve({success: false, error: 'Extension context invalidated'});
  
  let outbound = message;
  if (window !== window.top && message && message.action) {
    outbound = Object.assign({}, message, crossFrameSessionFields());
  }

  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(outbound, (response) => {
        if (chrome.runtime.lastError) {
          console.log('消息发送错误:', chrome.runtime.lastError.message);
          if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
            isExtensionValid = false;
          }
          resolve({success: false, error: chrome.runtime.lastError.message});
        } else {
          resolve(response || {success: true});
        }
      });
    } catch (e) {
      console.log('发送消息异常:', e.message);
      if (e.message.includes('Extension context invalidated')) {
        isExtensionValid = false;
      }
      resolve({success: false, error: e.message});
    }
  });
}

function isHostInDisabledList(href, list) {
  if (!list || !Array.isArray(list) || list.length === 0 || !href) return false;
  let h;
  try {
    const u = new URL(href);
    h = u.hostname.toLowerCase().replace(/^www\./, '');
  } catch (e) {
    h = String(href || '').toLowerCase().replace(/^www\./, '');
  }
  for (const entry of list) {
    const v = String(entry).trim().toLowerCase();
    if (!v) continue;
    let entryHost = v;
    if (v.startsWith('http://') || v.startsWith('https://')) {
      try { entryHost = new URL(v).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { entryHost = v; }
    } else {
      entryHost = v.replace(/^www\./, '');
    }
    if (h === entryHost || h.endsWith('.' + entryHost)) return true;
  }
  return false;
}

const disabledSiteCheckCache = {
  href: '',
  contentTabUrl: '',
  listRef: null,
  listLength: -1,
  result: false
};

// 检查当前网址是否在禁用列表（禁用鼠标手势、超级拖拽、小窗预览、网页解锁注入）
function isSiteInDisabledList(href) {
  const list = settings && Array.isArray(settings.disabledSites) ? settings.disabledSites : [];
  const normalizedHref = href || '';
  if (
    disabledSiteCheckCache.href === normalizedHref &&
    disabledSiteCheckCache.contentTabUrl === contentTabUrl &&
    disabledSiteCheckCache.listRef === list &&
    disabledSiteCheckCache.listLength === list.length
  ) {
    return disabledSiteCheckCache.result;
  }

  const result =
    isHostInDisabledList(normalizedHref, list) ||
    (window !== window.top && contentTabUrl && isHostInDisabledList(contentTabUrl, list));

  disabledSiteCheckCache.href = normalizedHref;
  disabledSiteCheckCache.contentTabUrl = contentTabUrl;
  disabledSiteCheckCache.listRef = list;
  disabledSiteCheckCache.listLength = list.length;
  disabledSiteCheckCache.result = !!result;
  return !!result;
}

function mergeDisabledSitesFromLocalIntoSettings(loadedSettings, onDone) {
  chrome.storage.local.get({ disabledSites: [] }, (localItems) => {
    loadedSettings.disabledSites = !chrome.runtime.lastError && Array.isArray(localItems.disabledSites)
      ? localItems.disabledSites
      : [];
    Object.assign(settings, loadedSettings);
    settingsLoaded = true;
    syncMouseExtUiLocale();
    invalidateScreenshotHotkeyCache();
    syncScreenshotCheckers();
    applyDebugPanelSetting();
    if (!settings.enableGesture) {
      clearGestureCanvas();
      resetGestureState();
    }
    if (typeof onDone === 'function') onDone();
  });
}

// 加载设置（onDone 在从 storage 合并完成后调用，供消息回调等异步场景使用）
function loadSettings(onDone) {
  if (!isExtensionValid) {
    settingsLoaded = true;
    if (typeof onDone === 'function') onDone();
    return;
  }
  
  try {
    chrome.storage.sync.get(
      CONTENT_SETTINGS_API.getContentDefaults({ language: getBrowserLanguage() }),
      (loadedSettings) => {
      if (chrome.runtime.lastError) {
        console.log('加载设置错误:', chrome.runtime.lastError.message);
        settingsLoaded = true;
        if (typeof onDone === 'function') onDone();
        return;
      }

      mergeDisabledSitesFromLocalIntoSettings(loadedSettings, onDone);
      }
    );
  } catch (e) {
    console.log('加载设置异常:', e.message);
    if (e.message.includes('Extension context invalidated')) {
      isExtensionValid = false;
    }
    settingsLoaded = true;
    if (typeof onDone === 'function') onDone();
  }
}

let contentSettingsSyncListenerReady = false;

function applyContentSettingsPatch(changes, area) {
  if (!changes || !settings) return;

  if (area === 'local') {
    if (changes.disabledSites) {
      settings.disabledSites = Array.isArray(changes.disabledSites.newValue)
        ? changes.disabledSites.newValue
        : [];
    }
    return;
  }
  if (area !== 'sync') return;

  const patch = CONTENT_SETTINGS_API.buildContentSyncPatch(changes);
  const changedKeys = Object.keys(patch);
  if (!changedKeys.length) return;

  const oldLanguage = settings.language;
  Object.assign(settings, patch);
  settingsLoaded = true;
  syncMouseExtUiLocale();

  if (changedKeys.some((key) => key.startsWith('screenshotHotkey'))) {
    invalidateScreenshotHotkeyCache();
  }
  if (changedKeys.some((key) => key.startsWith('enableScreenshot'))) {
    syncScreenshotCheckers();
  }
  if (changedKeys.includes('enableDebugPanel')) {
    applyDebugPanelSetting();
  }
  if (changedKeys.includes('enableGesture') && !settings.enableGesture) {
    clearGestureCanvas();
    resetGestureState();
  }
  if (changedKeys.includes('showGestureTrail') && !settings.showGestureTrail) {
    clearGestureCanvas();
  }
  if (changedKeys.includes('showGestureHint') && !settings.showGestureHint) {
    removeGestureHintElement();
  }
  if (changedKeys.includes('enableSuperDrag') && !settings.enableSuperDrag) {
    resetDragInfo();
  }
  if (changedKeys.includes('enableImagePreview') && !settings.enableImagePreview) {
    hideImagePreview(true);
  }
  if (changedKeys.includes('trailColor') || changedKeys.includes('trailWidth')) {
    updateGestureCanvasSettings();
  }
  if (changedKeys.includes('language') && oldLanguage && oldLanguage !== settings.language) {
    lastHintAction = '';
    removeGestureHintElement();
  }
}

function initContentSettingsSyncListener() {
  if (contentSettingsSyncListenerReady) return;
  contentSettingsSyncListenerReady = true;
  try {
    chrome.storage.onChanged.addListener(applyContentSettingsPatch);
  } catch (e) {
    console.log('设置增量同步监听失败:', e.message);
  }
}

// 获取浏览器语言
function getBrowserLanguage() {
  let browserLang = 'en';
  try {
    browserLang = chrome.i18n.getUILanguage() || navigator.language || 'en';
  } catch (e) {
    browserLang = navigator.language || 'en';
  }
  browserLang = String(browserLang).toLowerCase().replace(/-/g, '_');
  
  // 支持的语言列表及其对应的locale映射
  const languageMap = {
    'zh_cn': 'zh_CN',
    'zh_tw': 'zh_TW',
    'zh_hk': 'zh_TW',
    'zh_mo': 'zh_TW',
    'zh': 'zh_CN',
    'en_us': 'en_US',
    'en': 'en_US',
    'es': 'es',
    'fr': 'fr',
    'de': 'de',
    'pt_br': 'pt_BR',
    'pt': 'pt_BR',
    'ru': 'ru',
    'ko': 'ko',
    'hi': 'hi',
    'ar': 'ar',
    'bn': 'bn',
    'ja': 'ja',
    'id': 'id',
    'th': 'th',
    'vi': 'vi',
    'sw': 'sw',
    'tr': 'tr',
    'ur': 'ur',
    'nl': 'nl',
    'it': 'it',
    'uk': 'uk',
    'pl': 'pl',
    'cs': 'cs',
    'da': 'da',
    'sv': 'sv',
    'no': 'no',
    'fi': 'fi',
    'et': 'et'
  };
  
  // 精确匹配完整locale
  if (languageMap[browserLang]) {
    return languageMap[browserLang];
  }
  
  // 匹配语言代码前缀
  const langPrefix = browserLang.split('_')[0];
  if (languageMap[langPrefix]) {
    return languageMap[langPrefix];
  }
  
  // 默认使用英文
  return 'en_US';
}

// 获取i18n消息
function getI18nMessage(messageName, substitutionsOrFallback = '', fallback = '') {
  let substitutions = [];
  let actualFallback = '';

  if (Array.isArray(substitutionsOrFallback)) {
    substitutions = substitutionsOrFallback;
    actualFallback = fallback;
  } else {
    actualFallback = substitutionsOrFallback;
  }

  if (!isExtensionValid) {
    return actualFallback;
  }

  try {
    const message = chrome.i18n.getMessage(messageName, substitutions);
    return message || actualFallback;
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      markExtensionInvalidated();
      return actualFallback;
    }
    console.error('获取i18n消息失败:', error.message);
    return actualFallback;
  }
}

// 重置手势状态
function resetGestureState() {
  notifyIframeTrailEndToTop();
  isRightMouseDown = false;
  isGestureInProgress = false;
  gesturePoints = [];
  gestureComposedPath = null;
  lastHintAction = '';
  iframeGesturePoints = [];
  iframeGestureComposedPathHints = null;
  iframeGestureScrollAnchor = null;
  lastIframeTrailTime = 0;
  trailRegionLinksHintForGesture = false;
  resetGestureRecognitionPerfState();
  resetGestureTrailDrawState();
  resetTrailRegionScreenshotCheckCache();
  if (typeof MouseScrollGesture !== 'undefined') {
    MouseScrollGesture.clearContainerCache();
  }
  releaseGesturePointerCapture();
  stopAllGestureStateWatchers();
  endCrossFrameSession();
}

// 手势动作执行后的重置函数
function resetGestureAfterAction(immediate = false) {
  const flush = () => {
    disposeGestureTrailCanvas();
    resetGestureState();
  };
  if (immediate) {
    flush();
  } else {
    notifyIframeTrailEndToTop();
    setTimeout(flush, 100);
  }
}

function clearGestureTrailPixelsOnly() {
  try {
    if (gestureCanvas && gestureContext && gestureCanvas.width > 0 && gestureCanvas.height > 0) {
      gestureContext.clearRect(0, 0, gestureCanvas.width, gestureCanvas.height);
    }
  } catch (_) { /* ignore */ }
}

function resetGestureAfterScrollAction() {
  // 滚动动作最容易被“松手后清理 DOM/Shadow/Canvas”阻塞首帧。
  // 先只清空轨迹像素，让滚动命令尽快进入下一帧；真正移除节点和清状态延后两帧。
  notifyIframeTrailEndToTop();
  clearGestureTrailPixelsOnly();

  const flush = () => {
    // 如果用户马上开始了下一次手势，避免旧的延迟清理误删新会话状态。
    if (isGestureInProgress || isRightMouseDown) return;
    disposeGestureTrailCanvas();
    resetGestureState();
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      requestAnimationFrame(flush);
    });
  } else {
    setTimeout(flush, 32);
  }
}

function canVouchCrossFrameSession(requestedChildFrameId) {
  if (window !== window.top) return false;
  const childId = requestedChildFrameId != null ? Number(requestedChildFrameId) : null;
  const localActive =
    isGestureInProgress || isRightMouseDown || isSuperDragTrackingActive();
  if (localActive) {
    if (childId == null) return true;
    if (crossFrameGestureSourceFrameId != null) {
      return childId === crossFrameGestureSourceFrameId;
    }
    if (
      cachedGestureState.sourceFrameId != null &&
      Number(cachedGestureState.sourceFrameId) === childId
    ) {
      return true;
    }
    // top 已开始手势，iframe trail init 可能尚未到达
    if (isGestureInProgress || isRightMouseDown) return true;
    return childId === 0;
  }
  if (
    childId != null &&
    cachedGestureState.gestureActive &&
    Number(cachedGestureState.sourceFrameId) === childId
  ) {
    return true;
  }
  if (
    childId != null &&
    crossFrameGestureSourceFrameId != null &&
    childId === crossFrameGestureSourceFrameId
  ) {
    return true;
  }
  return false;
}

// 全屏时仅 fullscreenElement 子树处于顶层，轨迹/提示须挂在其下方可显示（如 bilibili 网页全屏/全屏播放器）
function canAppendGestureOverlayToFullscreenEl(el) {
  try {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = el.tagName;
    if (tag === 'VIDEO' || tag === 'AUDIO' || tag === 'IMG' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'EMBED') return false;
    return true;
  } catch (e) {
    return false;
  }
}

// 子 frame 内调用全屏 API 时（如 live.bilibili.com 嵌入的直播播放器），父页无法叠画布在其上，须在 iframe 文档内本地绘制
function gestureOverlayUsesIframeDocumentFullscreen() {
  return window !== window.top &&
    !!document.fullscreenElement &&
    canAppendGestureOverlayToFullscreenEl(document.fullscreenElement);
}

function getGestureCanvasMountParent() {
  const fs = document.fullscreenElement;
  if (canAppendGestureOverlayToFullscreenEl(fs)) return fs;
  return document.documentElement;
}

function getGestureHintMountParent() {
  const fs = document.fullscreenElement;
  if (canAppendGestureOverlayToFullscreenEl(fs)) return fs;
  return document.body;
}

function mountGestureCanvasOnParent(canvas, parent) {
  if (!canvas || !parent || typeof parent.appendChild !== 'function') return false;
  try {
    if (parent === document.documentElement) {
      // 挂到 html 结构底部，避免重复插到最前面造成 Elements 面板跳动。
      parent.appendChild(canvas);
    } else {
      parent.appendChild(canvas);
    }
    return true;
  } catch (e) {
    try {
      const fallback = document.body || document.documentElement;
      if (fallback && fallback !== parent) {
        fallback.appendChild(canvas);
        return true;
      }
    } catch (e2) { /* ignore */ }
  }
  return false;
}

function syncGestureOverlaysToFullscreenLayer() {
  try {
    if (typeof MouseExtUiHost !== 'undefined') {
      MouseExtUiHost.syncHostToFullscreenLayer();
    }
    if (window !== window.top) {
      const useLocal = gestureOverlayUsesIframeDocumentFullscreen();
      if (useLocal && settings?.showGestureTrail) {
        notifyIframeTrailEndToTop();
        if (!gestureCanvas) initGestureCanvas();
      } else if (!useLocal && gestureCanvas) {
        disposeGestureTrailCanvas();
      }
    }
    if (gestureCanvas && settings?.showGestureTrail) {
      resizeGestureCanvasToViewport(gestureCanvas);
      if (gestureContext && gesturePoints && gesturePoints.length > 1) {
        redrawGestureTrail();
      }
    }
  } catch (e) {}
}

// 创建用于显示手势轨迹的画布
function disposeGestureTrailCanvas() {
  resetGestureTrailDrawState();
  if (window === window.top) {
    cancelTopIframeTrailStaleCleanup();
  }
  if (typeof MouseExtUiHost !== 'undefined') {
    MouseExtUiHost.removeGestureTrailCanvases();
  } else if (gestureCanvas?.parentNode) {
    try {
      gestureCanvas.parentNode.removeChild(gestureCanvas);
    } catch (e) { /* ignore */ }
  }
  gestureCanvas = null;
  gestureContext = null;
}

function isGestureCanvasLive() {
  return !!(gestureCanvas && gestureCanvas.isConnected);
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getGestureTrailDevicePixelRatio() {
  const dpr = Number(window.devicePixelRatio) || 1;
  return clampNumber(dpr, 1, GESTURE_TRAIL_DPR_MAX);
}

function resizeGestureCanvasToViewport(canvas) {
  if (!canvas) return false;
  const cssWidth = Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 1));
  const cssHeight = Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 1));
  const dpr = getGestureTrailDevicePixelRatio();
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
  let changed = false;
  try {
    if ('width' in canvas && canvas.width !== pixelWidth) {
      canvas.width = pixelWidth;
      changed = true;
    }
    if ('height' in canvas && canvas.height !== pixelHeight) {
      canvas.height = pixelHeight;
      changed = true;
    }
    const cssWidthText = `${cssWidth}px`;
    const cssHeightText = `${cssHeight}px`;
    if (canvas.style) {
      if (canvas.style.width !== cssWidthText) canvas.style.width = cssWidthText;
      if (canvas.style.height !== cssHeightText) canvas.style.height = cssHeightText;
    }
    if (canvas.dataset) {
      canvas.dataset.mouseExtDpr = String(dpr);
    } else if (typeof canvas.setAttribute === 'function') {
      canvas.setAttribute('data-mouse-ext-dpr', String(dpr));
    }
  } catch (e) {
    return false;
  }
  return changed;
}

function isUsableGestureCanvas(canvas) {
  return !!(
    canvas &&
    canvas.nodeType === Node.ELEMENT_NODE &&
    canvas.tagName === 'CANVAS' &&
    canvas.style &&
    typeof canvas.getContext === 'function'
  );
}

function setGestureCanvasStyle(canvas, name, value) {
  if (!canvas || !canvas.style) return false;
  try {
    canvas.style[name] = value;
    return true;
  } catch (e) {
    return false;
  }
}

function applyGestureCanvasBaseStyles(canvas, includePosition) {
  if (!canvas) return;
  if (includePosition) {
    setGestureCanvasStyle(canvas, 'position', 'fixed');
    setGestureCanvasStyle(canvas, 'top', '0');
    setGestureCanvasStyle(canvas, 'left', '0');
    setGestureCanvasStyle(canvas, 'zIndex', '2147483647');
  }
  setGestureCanvasStyle(canvas, 'display', 'block');
  setGestureCanvasStyle(canvas, 'pointerEvents', 'none');
}

function createGestureCanvas() {
  if (typeof MouseExtUiHost !== 'undefined') {
    MouseExtUiHost.ensureHost();
    MouseExtUiHost.syncHostToFullscreenLayer();
    const existing = MouseExtUiHost.getGestureTrailCanvas();
    if (isUsableGestureCanvas(existing)) {
      resizeGestureCanvasToViewport(existing);
      applyGestureCanvasBaseStyles(existing, false);
      return existing;
    } else if (existing && typeof existing.remove === 'function') {
      try {
        existing.remove();
      } catch (e) { /* ignore */ }
    }
    const canvas = createMouseExtElement('canvas');
    canvas.id = 'mouse-gesture-trail-canvas';
    resizeGestureCanvasToViewport(canvas);
    applyGestureCanvasBaseStyles(canvas, true);
    if (!MouseExtUiHost.appendToGestureLayer(canvas)) {
      const root = getGestureCanvasMountParent() || document.body || document.documentElement;
      if (root) mountGestureCanvasOnParent(canvas, root);
    }
    return canvas;
  }

  const canvas = createMouseExtElement('canvas');
  canvas.id = 'mouse-gesture-trail-canvas';
  resizeGestureCanvasToViewport(canvas);
  applyGestureCanvasBaseStyles(canvas, true);

  const root = getGestureCanvasMountParent();
  if (root) {
    mountGestureCanvasOnParent(canvas, root);
  } else if (document.body) {
    document.body.insertBefore(canvas, document.body.firstChild);
  }

  return canvas;
}

// 初始化手势画布
function initGestureCanvas() {
  disposeGestureTrailCanvas();
  
  // 如果不显示手势轨迹，只初始化手势点数组
  if (!settings.showGestureTrail) {
    gestureCanvas = null;
    gestureContext = null;
    return;
  }
  
  // 手势在 iframe 内时默认由主框架绘制；iframe 内网页全屏时父页无法叠层，改为本文档内绘制
  if (window !== window.top && !gestureOverlayUsesIframeDocumentFullscreen()) {
    gestureCanvas = null;
    gestureContext = null;
    return;
  }
  
  gestureCanvas = createGestureCanvas();
  if (!isUsableGestureCanvas(gestureCanvas)) {
    gestureCanvas = null;
    gestureContext = null;
    return;
  }
  gestureContext = gestureCanvas.getContext('2d');
  if (!gestureContext) {
    gestureCanvas = null;
    gestureContext = null;
    return;
  }
  applyGestureTrailContextStyles(gestureContext);
  gestureTrailDrawnPointCount = 0;
}

// 清除手势画布
function clearGestureCanvas() {
  if (window !== window.top) {
    if (
      !iframeTrailEndNotified &&
      (iframeTrailForwardStarted || isGestureInProgress || gesturePoints.length > 1)
    ) {
      notifyIframeTrailEndToTop();
    }
  }
  disposeGestureTrailCanvas();
}

// 设置 canvas 宽高会重置 2D 上下文，须在 resize 之后调用
function applyGestureTrailContextStyles(ctx) {
  if (!ctx) return;
  const canvas = ctx.canvas;
  let scale = 1;
  try {
    const rect = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    if (rect && rect.width > 0 && canvas.width > 0) {
      scale = canvas.width / rect.width;
    }
  } catch (e) {
    scale = Number(canvas?.dataset?.mouseExtDpr) || 1;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.strokeStyle = settings?.trailColor || '#FF0000';
  ctx.lineWidth = (settings?.trailWidth || 3) * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
}

// 将视口坐标转换为画布坐标，兼容 B 站屏幕适配等 transform:scale 导致的错位
function viewportToCanvasCoords(canvas, clientX, clientY) {
  if (!canvas || !canvas.getBoundingClientRect) return { x: clientX, y: clientY };
  try {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: clientX, y: clientY };
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  } catch (e) {
    return { x: clientX, y: clientY };
  }
}

function getCanvasViewportTransform(canvas) {
  if (!canvas || !canvas.getBoundingClientRect) {
    return { left: 0, top: 0, scaleX: 1, scaleY: 1 };
  }
  try {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { left: 0, top: 0, scaleX: 1, scaleY: 1 };
    }
    return {
      left: rect.left,
      top: rect.top,
      scaleX: canvas.width / rect.width,
      scaleY: canvas.height / rect.height
    };
  } catch (e) {
    return { left: 0, top: 0, scaleX: 1, scaleY: 1 };
  }
}

function viewportToCanvasCoordsWithTransform(transform, clientX, clientY) {
  if (!transform) return { x: clientX, y: clientY };
  return {
    x: (clientX - transform.left) * transform.scaleX,
    y: (clientY - transform.top) * transform.scaleY
  };
}

function pointDistance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pushDistinctTrailPoint(points, point, minDistance, force = false) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
  const last = points[points.length - 1];
  if (!last) {
    points.push({ x: point.x, y: point.y });
  } else if (force && pointDistance(last, point) < minDistance) {
    points[points.length - 1] = { x: point.x, y: point.y };
  } else if (force || pointDistance(last, point) >= minDistance) {
    points.push({ x: point.x, y: point.y });
  }
}

function buildSmoothedGestureTrailPoints(sourcePoints, transform) {
  if (!sourcePoints || sourcePoints.length === 0) return [];

  const raw = [];
  const minDistance = Math.max(
    GESTURE_TRAIL_MIN_POINT_DISTANCE,
    (settings?.trailWidth || 3) * (Number(gestureCanvas?.dataset?.mouseExtDpr) || 1) * 0.12
  );

  for (let i = 0; i < sourcePoints.length; i++) {
    const p = sourcePoints[i];
    const canvasPoint = viewportToCanvasCoordsWithTransform(transform, p.x, p.y);
    pushDistinctTrailPoint(raw, canvasPoint, minDistance, i === sourcePoints.length - 1);
  }

  if (raw.length <= 2) return raw;

  const smoothingStrength = clampNumber(Number(smoothingFactor) || 0, 0, 1);
  const alphaShift = (0.2 - smoothingStrength) * 0.45;
  const alphaMin = clampNumber(GESTURE_TRAIL_SMOOTH_ALPHA_MIN + alphaShift, 0.18, 0.9);
  const alphaMax = clampNumber(GESTURE_TRAIL_SMOOTH_ALPHA_MAX + alphaShift * 0.5, 0.45, 0.98);
  const smoothDistance = Math.max(
    8,
    GESTURE_TRAIL_SMOOTH_DISTANCE * (1 + (smoothingStrength - 0.2) * 1.2)
  );

  const smoothed = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const prev = smoothed[smoothed.length - 1];
    const current = raw[i];
    const distance = pointDistance(prev, current);
    let alpha = clampNumber(
      distance / smoothDistance,
      alphaMin,
      alphaMax
    );

    // 急转弯时提高跟随系数，减少视觉拖尾；微抖动时保持更强滤波。
    if (i > 1 && i < raw.length - 1) {
      const before = raw[i - 1];
      const after = raw[i + 1];
      const v1x = current.x - before.x;
      const v1y = current.y - before.y;
      const v2x = after.x - current.x;
      const v2y = after.y - current.y;
      const len1 = Math.hypot(v1x, v1y);
      const len2 = Math.hypot(v2x, v2y);
      if (len1 > 0.001 && len2 > 0.001) {
        const cos = (v1x * v2x + v1y * v2y) / (len1 * len2);
        if (cos < 0.35) alpha = Math.max(alpha, 0.72);
      }
    }

    smoothed.push({
      x: prev.x + (current.x - prev.x) * alpha,
      y: prev.y + (current.y - prev.y) * alpha
    });
  }

  // 末端固定到真实鼠标位置，避免滤波造成光标后方拖拽感。
  smoothed[smoothed.length - 1] = raw[raw.length - 1];
  return smoothed;
}

function clampBezierHandle(anchor, control, segmentLength) {
  const maxLen = Math.max(1, segmentLength * GESTURE_TRAIL_CURVE_MAX_HANDLE_RATIO);
  const dx = control.x - anchor.x;
  const dy = control.y - anchor.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len <= maxLen || len === 0) return control;
  const scale = maxLen / len;
  return {
    x: anchor.x + dx * scale,
    y: anchor.y + dy * scale
  };
}

function strokeSmoothGestureTrailPath(ctx, sourcePoints, transform) {
  if (!ctx || !sourcePoints || sourcePoints.length < 2) return false;
  const points = buildSmoothedGestureTrailPoints(sourcePoints, transform);
  if (points.length < 2) return false;

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
    return true;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const segmentLength = pointDistance(p1, p2);
    let cp1 = {
      x: p1.x + (p2.x - p0.x) * GESTURE_TRAIL_CURVE_CONTROL,
      y: p1.y + (p2.y - p0.y) * GESTURE_TRAIL_CURVE_CONTROL
    };
    let cp2 = {
      x: p2.x - (p3.x - p1.x) * GESTURE_TRAIL_CURVE_CONTROL,
      y: p2.y - (p3.y - p1.y) * GESTURE_TRAIL_CURVE_CONTROL
    };
    cp1 = clampBezierHandle(p1, cp1, segmentLength);
    cp2 = clampBezierHandle(p2, cp2, segmentLength);
    ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, p2.x, p2.y);
  }

  ctx.stroke();
  return true;
}

// 将 iframe 内的 client 坐标转换为顶层窗口的 client 坐标，使轨迹跨 frame 连续
// 返回 { x, y, needsConversion }：跨域 iframe 时 needsConversion 为 true，需主框架用 iframeRect 转换
function toTopWindowClientCoords(clientX, clientY) {
  let x = clientX, y = clientY;
  let w = window;
  let needsConversion = false;
  while (w !== w.top) {
    try {
      const fe = w.frameElement;
      if (!fe) {
        needsConversion = true; // 跨域 iframe，无法访问 frameElement
        break;
      }
      const rect = fe.getBoundingClientRect();
      x += rect.left;
      y += rect.top;
      w = w.parent;
    } catch (e) {
      needsConversion = true;
      break;
    }
  }
  return { x, y, needsConversion };
}

function normalizeFrameUrl(u) {
  if (!u) return '';
  try {
    const url = new URL(u, document.baseURI);
    const path = url.pathname.replace(/\/$/, '') || '/';
    return url.origin + path + url.search;
  } catch (e) {
    return String(u);
  }
}

function urlsRoughlyMatch(a, b) {
  if (!a || !b) return false;
  const na = normalizeFrameUrl(a);
  const nb = normalizeFrameUrl(b);
  if (na === nb) return true;
  return na.startsWith(nb) || nb.startsWith(na);
}

function findIframeElementForFrameSource(sourceUrl, hintPoints) {
  function searchInDoc(doc) {
    const iframes = Array.from(doc.querySelectorAll('iframe, frame'));
    let deepest = null;
    let deepestArea = Infinity;
    for (const iframe of iframes) {
      const rect = iframe.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      let matched = false;
      try {
        if (iframe.contentWindow && urlsRoughlyMatch(iframe.contentWindow.location.href, sourceUrl)) {
          matched = true;
        }
      } catch (e) { /* cross-origin */ }
      if (!matched) {
        const src = iframe.getAttribute('src') || iframe.src || '';
        if (urlsRoughlyMatch(src, sourceUrl)) matched = true;
      }
      if (matched) {
        const area = rect.width * rect.height;
        if (!deepest || area < deepestArea) {
          deepest = iframe;
          deepestArea = area;
        }
      }
      try {
        const innerDoc = iframe.contentDocument;
        if (innerDoc) {
          const inner = searchInDoc(innerDoc);
          if (inner) return inner;
        }
      } catch (e) { /* ignore */ }
    }
    return deepest;
  }
  let el = searchInDoc(document);
  if (el || !hintPoints || !hintPoints.length) return el;
  // URL 未命中时：用轨迹质心落在哪个 iframe 内来推断（支持手势跨出 iframe 边界）
  let cx = 0;
  let cy = 0;
  for (const p of hintPoints) {
    cx += p.x;
    cy += p.y;
  }
  cx /= hintPoints.length;
  cy /= hintPoints.length;
  const iframes = Array.from(document.querySelectorAll('iframe, frame'));
  let best = null;
  let bestArea = Infinity;
  for (const iframe of iframes) {
    try {
      const rect = iframe.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (cx >= 0 && cx <= rect.width && cy >= 0 && cy <= rect.height) {
        const area = rect.width * rect.height;
        if (!best || area < bestArea) {
          best = iframe;
          bestArea = area;
        }
      }
    } catch (e) { /* ignore */ }
  }
  return best || el;
}

function offsetPointsByIframeRect(points, iframeEl) {
  const rect = iframeEl.getBoundingClientRect();
  return points.map((p) => ({ x: rect.left + p.x, y: rect.top + p.y }));
}

function convertIframeLocalPointsWithSource(points, sourceFrameId, sourceUrl) {
  if (!points || !points.length) return points;
  let el = null;
  if (sourceFrameId != null && iframeRectCacheByFrameId.has(sourceFrameId)) {
    const cached = iframeRectCacheByFrameId.get(sourceFrameId);
    if (cached && cached.element && cached.element.isConnected) {
      el = cached.element;
    } else if (sourceFrameId != null) {
      iframeRectCacheByFrameId.delete(sourceFrameId);
    }
  }
  if (!el && sourceUrl) el = findIframeElementForFrameSource(sourceUrl, points);
  if (!el && sourceFrameId != null) el = findIframeElementForFrameSource(null, points);
  if (el) {
    if (sourceFrameId != null) {
      iframeRectCacheByFrameId.set(sourceFrameId, { element: el, url: sourceUrl || '' });
      trimIframeRectCache();
    }
    return offsetPointsByIframeRect(points, el);
  }
  return convertIframeCoordsToViewport(points);
}

// 主框架：将跨域 iframe 的坐标转换为视口坐标（查找包含该点的 iframe，多个时取面积最小的即最内层）
function convertIframeLocalPointsToTopViewport(points, sourceFrameId, sourceUrl) {
  if (!points || !points.length) return points;
  const frameId =
    sourceFrameId != null ? sourceFrameId : crossFrameGestureSourceFrameId;
  const url = sourceUrl || crossFrameGestureSourceFrameUrl;
  if (frameId != null || url) {
    return convertIframeLocalPointsWithSource(points, frameId, url);
  }
  const iframes = Array.from(document.querySelectorAll('iframe, frame'));
  let best = null;
  for (let i = 0; i < iframes.length; i++) {
    const iframe = iframes[i];
    try {
      const rect = iframe.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const mapped = points.map((p) => ({ x: rect.left + p.x, y: rect.top + p.y }));
      const allVisible = mapped.every(
        (p) =>
          p.x >= -4 &&
          p.y >= -4 &&
          p.x <= window.innerWidth + 4 &&
          p.y <= window.innerHeight + 4
      );
      if (!allVisible) continue;
      const area = rect.width * rect.height;
      if (!best || area < best.area) best = { area, mapped };
    } catch (e) { /* ignore */ }
  }
  return best ? best.mapped : convertIframeCoordsToViewport(points);
}

function convertIframeCoordsToViewport(points) {
  if (!points || points.length === 0) return points;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    minX = Math.min(minX, points[i].x);
    minY = Math.min(minY, points[i].y);
    maxX = Math.max(maxX, points[i].x);
    maxY = Math.max(maxY, points[i].y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const iframes = Array.from(document.querySelectorAll('iframe, frame'));
  let best = null;
  for (let i = 0; i < iframes.length; i++) {
    const iframe = iframes[i];
    try {
      const rect = iframe.getBoundingClientRect();
      if (
        cx >= 0 &&
        cx <= rect.width &&
        cy >= 0 &&
        cy <= rect.height &&
        rect.width > 0 &&
        rect.height > 0
      ) {
        const area = rect.width * rect.height;
        if (!best || area < best.area) best = { rect, area };
      }
    } catch (e) { /* ignore */ }
  }
  if (best) {
    return points.map((pt) => ({ x: best.rect.left + pt.x, y: best.rect.top + pt.y }));
  }
  return points;
}

/** 将当前手势轨迹转为顶层视口 client 坐标，供截图选区使用 */
function getGestureTrailViewportPointsForScreenshot() {
  if (!gesturePoints || gesturePoints.length < 2) return [];
  if (window !== window.top) {
    return gesturePoints.map((p) => ({ x: p.x, y: p.y }));
  }
  const converted = gesturePoints.map((p) => toTopWindowClientCoords(p.x, p.y));
  let pts = converted.map((c) => ({ x: c.x, y: c.y }));
  if (converted.some((c) => c.needsConversion)) {
    pts = convertIframeLocalPointsWithSource(
      pts,
      crossFrameGestureSourceFrameId,
      crossFrameGestureSourceFrameUrl
    );
  }
  return pts;
}

/** 线段 (a-b) 与 (c-d) 相交（含共线重叠），用于检测轨迹自交 */
function _gestureSegOrient(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function _gestureOnSegment(px, py, qx, qy, rx, ry) {
  return (
    px >= Math.min(qx, rx) - 1e-6 &&
    px <= Math.max(qx, rx) + 1e-6 &&
    py >= Math.min(qy, ry) - 1e-6 &&
    py <= Math.max(qy, ry) + 1e-6
  );
}

function gestureSegmentsIntersect(a, b, c, d) {
  const o1 = _gestureSegOrient(a.x, a.y, b.x, b.y, c.x, c.y);
  const o2 = _gestureSegOrient(a.x, a.y, b.x, b.y, d.x, d.y);
  const o3 = _gestureSegOrient(c.x, c.y, d.x, d.y, a.x, a.y);
  const o4 = _gestureSegOrient(c.x, c.y, d.x, d.y, b.x, b.y);
  const eps = 1e-6;
  if (Math.abs(o1) < eps && _gestureOnSegment(c.x, c.y, a.x, a.y, b.x, b.y)) return true;
  if (Math.abs(o2) < eps && _gestureOnSegment(d.x, d.y, a.x, a.y, b.x, b.y)) return true;
  if (Math.abs(o3) < eps && _gestureOnSegment(a.x, a.y, c.x, c.y, d.x, d.y)) return true;
  if (Math.abs(o4) < eps && _gestureOnSegment(b.x, b.y, c.x, c.y, d.x, d.y)) return true;
  return o1 * o2 < -eps && o3 * o4 < -eps;
}

const SCREENSHOT_TRAIL_MIN_POINTS = 8;
const SCREENSHOT_TRAIL_MIN_AREA = 48 * 48;
const SCREENSHOT_TRAIL_MIN_DIMENSION = 28;
const SCREENSHOT_TRAIL_LOOP_CLOSE_PX = 14;
/** 闭合/自交合计超过此次数视为乱画，不触发轨迹选区截图 */
const SCREENSHOT_TRAIL_MAX_CROSSINGS = 3;
const SCREENSHOT_TRAIL_MAX_RAW_CROSSINGS = 4;
const SCREENSHOT_TRAIL_COMPACT_STEP_PX = 6;
const SCREENSHOT_TRAIL_MAX_TEST_POINTS = 140;
const SCREENSHOT_TRAIL_MAX_PATH_PERIMETER_RATIO = 3.15;
const SCREENSHOT_TRAIL_MAX_DIRECTION_CHANGES = 24;
const SCREENSHOT_TRAIL_MAX_REVERSALS = 8;

function gestureTrailBoundingArea(points) {
  if (!points || points.length < 2) return 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
}

function getGestureTrailScreenshotStats(points) {
  const stats = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    width: 0,
    height: 0,
    area: 0,
    diagonal: 0,
    perimeter: 0,
    totalDistance: 0,
    startEndDistance: 0,
    directionChanges: 0,
    reversals: 0
  };
  if (!points || points.length < 2) return stats;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    stats.minX = Math.min(stats.minX, p.x);
    stats.minY = Math.min(stats.minY, p.y);
    stats.maxX = Math.max(stats.maxX, p.x);
    stats.maxY = Math.max(stats.maxY, p.y);
  }
  stats.width = Math.max(0, stats.maxX - stats.minX);
  stats.height = Math.max(0, stats.maxY - stats.minY);
  stats.area = stats.width * stats.height;
  stats.diagonal = Math.hypot(stats.width, stats.height);
  stats.perimeter = Math.max(1, 2 * (stats.width + stats.height));
  stats.startEndDistance = Math.hypot(
    points[points.length - 1].x - points[0].x,
    points[points.length - 1].y - points[0].y
  );

  let prevAngle = null;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const dist = Math.hypot(dx, dy);
    if (dist < 3) continue;
    stats.totalDistance += dist;
    const angle = Math.atan2(dy, dx);
    if (prevAngle != null) {
      let delta = Math.abs(angle - prevAngle);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      if (delta > 0.95) stats.directionChanges++;
      if (delta > 2.35) stats.reversals++;
    }
    prevAngle = angle;
  }

  return stats;
}

function compactGestureTrailPointsForScreenshot(points) {
  if (!points || points.length <= 2) return points || [];
  const minStep = Math.max(4, Math.min(12, SCREENSHOT_TRAIL_COMPACT_STEP_PX));
  const compact = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minStep) {
      compact.push(p);
      last = p;
    }
  }
  const tail = points[points.length - 1];
  if (compact[compact.length - 1] !== tail) compact.push(tail);

  if (compact.length <= SCREENSHOT_TRAIL_MAX_TEST_POINTS) return compact;
  const sampled = [];
  const step = (compact.length - 1) / (SCREENSHOT_TRAIL_MAX_TEST_POINTS - 1);
  for (let i = 0; i < SCREENSHOT_TRAIL_MAX_TEST_POINTS; i++) {
    sampled.push(compact[Math.round(i * step)]);
  }
  return sampled;
}

/** 统计首尾闭合（计 1）与非邻线段相交次数，用于区分单圈选区与乱画 */
function countGestureTrailScreenshotCrossings(testPts, maxCount = Infinity) {
  const n = testPts.length;
  let count = 0;
  const p0 = testPts[0];
  const pLast = testPts[n - 1];
  if (Math.hypot(p0.x - pLast.x, p0.y - pLast.y) <= SCREENSHOT_TRAIL_LOOP_CLOSE_PX) {
    count += 1;
    if (count > maxCount) return count;
  }
  for (let i = 0; i < n - 1; i++) {
    const a = testPts[i];
    const b = testPts[i + 1];
    for (let j = i + 3; j < n - 1; j++) {
      const c = testPts[j];
      const d = testPts[j + 1];
      if (gestureSegmentsIntersect(a, b, c, d)) {
        count += 1;
        if (count > maxCount) return count;
      }
    }
  }
  return count;
}

function isGestureTrailScribbleLikeForScreenshot(stats, compactPts, rawCrossings) {
  if (!stats || stats.area < SCREENSHOT_TRAIL_MIN_AREA) return true;
  if (stats.width < SCREENSHOT_TRAIL_MIN_DIMENSION || stats.height < SCREENSHOT_TRAIL_MIN_DIMENSION) {
    return true;
  }
  if (rawCrossings > SCREENSHOT_TRAIL_MAX_RAW_CROSSINGS) return true;

  const pathPerimeterRatio = stats.totalDistance / Math.max(1, stats.perimeter);
  const changeRatio = compactPts && compactPts.length > 2
    ? stats.directionChanges / Math.max(1, compactPts.length - 2)
    : 0;

  if (pathPerimeterRatio > SCREENSHOT_TRAIL_MAX_PATH_PERIMETER_RATIO) return true;
  if (stats.directionChanges > SCREENSHOT_TRAIL_MAX_DIRECTION_CHANGES && pathPerimeterRatio > 1.75) return true;
  if (stats.reversals > SCREENSHOT_TRAIL_MAX_REVERSALS && pathPerimeterRatio > 1.35) return true;
  if (changeRatio > 0.58 && pathPerimeterRatio > 1.55) return true;

  return false;
}

/**
 * 轨迹存在重合：首尾闭合或两非邻边相交。开启截图时用于用当前轨迹作为选区（不依赖手势动作绑定）。
 * 使用简化后的点并校验包围面积；闭合/自交过多则视为乱画，不截图。
 */
function gestureTrailHasSelfIntersectionForScreenshot(points) {
  if (!points || points.length < SCREENSHOT_TRAIL_MIN_POINTS) return false;
  const simplified = simplifyGesturePoints(points);
  if (simplified && simplified.some((p) => p && p.isScribbling)) return false;
  const testPts =
    simplified && simplified.length >= 4 ? simplified : points;
  if (testPts.length < 6) return false;
  const metricTestPts = testPts.length > SCREENSHOT_TRAIL_MAX_TEST_POINTS
    ? compactGestureTrailPointsForScreenshot(testPts)
    : testPts;
  if (metricTestPts.length < 6) return false;
  const compactPts = compactGestureTrailPointsForScreenshot(points);
  const stats = getGestureTrailScreenshotStats(compactPts);
  if (stats.area < SCREENSHOT_TRAIL_MIN_AREA) return false;
  if (stats.width < SCREENSHOT_TRAIL_MIN_DIMENSION || stats.height < SCREENSHOT_TRAIL_MIN_DIMENSION) return false;

  const crossings = countGestureTrailScreenshotCrossings(
    metricTestPts,
    SCREENSHOT_TRAIL_MAX_CROSSINGS
  );
  const rawCrossings = countGestureTrailScreenshotCrossings(
    compactPts,
    SCREENSHOT_TRAIL_MAX_RAW_CROSSINGS
  );
  if (crossings < 1 && rawCrossings < 1) return false;
  if (crossings > SCREENSHOT_TRAIL_MAX_CROSSINGS) return false;
  if (isGestureTrailScribbleLikeForScreenshot(stats, compactPts, rawCrossings)) return false;
  return true;
}

/** 轨迹选区截图：自交成立，且不与已识别并绑定了动作的手势冲突 */
function shouldTriggerTrailRegionScreenshot(points, gestureName, options = {}) {
  const pointCount = points && points.length ? points.length : 0;
  if (!isScreenshotTrailCaptureEnabled() || pointCount < SCREENSHOT_TRAIL_MIN_POINTS) {
    trailRegionScreenshotCheckCache = {
      pointCount,
      gestureName: gestureName || '',
      value: false,
      checkedAt: getGesturePerfNow()
    };
    return false;
  }

  const now = getGesturePerfNow();
  const force = options && options.force === true;
  const cache = trailRegionScreenshotCheckCache;
  if (
    !force &&
    cache &&
    cache.gestureName === (gestureName || '') &&
    now - cache.checkedAt < TRAIL_REGION_SCREENSHOT_CHECK_INTERVAL_MS &&
    pointCount - cache.pointCount < TRAIL_REGION_SCREENSHOT_CHECK_POINT_DELTA
  ) {
    return cache.value;
  }

  let result = false;
  if (gestureTrailHasSelfIntersectionForScreenshot(points)) {
    result = true;
    if (gestureName) {
      const action = getCustomGestureAction(gestureName);
      if (action && action !== 'noAction') {
        result = false;
      }
    }
  }

  trailRegionScreenshotCheckCache = {
    pointCount,
    gestureName: gestureName || '',
    value: result,
    checkedAt: now
  };
  return result;
}

const TRAIL_REGION_LINK_DETECT_LIMIT = 48;
const TRAIL_REGION_LINK_OPEN_LIMIT = 12;
const TRAIL_REGION_LINK_SCAN_LIMIT = 1800;
let trailRegionChooserSession = null;
let lastTrailRegionLinkHintAt = 0;
let trailRegionLinksHintForGesture = false;

function getTrailPointsForLinkDetection() {
  if (window === window.top) {
    return getGestureTrailViewportPointsForScreenshot();
  }
  if (!gesturePoints || gesturePoints.length < 2) return [];
  return gesturePoints.map((p) => ({ x: p.x, y: p.y }));
}

function trailRegionPadFromSettings() {
  const tw = settings && settings.trailWidth != null ? Number(settings.trailWidth) : 3;
  return Math.max(4, Math.ceil((Number.isFinite(tw) ? tw : 3) / 2));
}

function trailRegionViewportBoxFromPoints(points) {
  if (!points || points.length < 2) return null;
  const pad = trailRegionPadFromSettings();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x1 = Math.max(0, Math.floor(minX - pad));
  const y1 = Math.max(0, Math.floor(minY - pad));
  const x2 = Math.min(window.innerWidth, Math.ceil(maxX + pad));
  const y2 = Math.min(window.innerHeight, Math.ceil(maxY + pad));
  if (x2 - x1 < 4 || y2 - y1 < 4) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function trailRegionRectIntersectsBox(rect, box) {
  return !(
    rect.right < box.x ||
    rect.left > box.x + box.w ||
    rect.bottom < box.y ||
    rect.top > box.y + box.h
  );
}

function trailRegionBoxBounds(box) {
  if (!box) return null;
  return {
    left: box.x,
    top: box.y,
    right: box.x + box.w,
    bottom: box.y + box.h,
    width: box.w,
    height: box.h,
    area: Math.max(1, box.w * box.h)
  };
}

function trailRegionRectBoxOverlap(rect, box) {
  const b = trailRegionBoxBounds(box);
  if (!rect || !b) return null;
  const width = Number(rect.width != null ? rect.width : rect.right - rect.left);
  const height = Number(rect.height != null ? rect.height : rect.bottom - rect.top);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const left = Math.max(rect.left, b.left);
  const top = Math.max(rect.top, b.top);
  const right = Math.min(rect.right, b.right);
  const bottom = Math.min(rect.bottom, b.bottom);
  const overlapW = right - left;
  const overlapH = bottom - top;
  if (overlapW <= 0 || overlapH <= 0) return null;
  const rectArea = Math.max(1, width * height);
  const area = overlapW * overlapH;
  const cx = rect.left + width / 2;
  const cy = rect.top + height / 2;
  return {
    left,
    top,
    right,
    bottom,
    width: overlapW,
    height: overlapH,
    area,
    rectArea,
    boxArea: b.area,
    rectRatio: area / rectArea,
    boxRatio: area / b.area,
    centerInside:
      cx >= b.left &&
      cx <= b.right &&
      cy >= b.top &&
      cy <= b.bottom
  };
}

function isTrailRegionOpenableUrl(href) {
  if (!href || typeof href !== 'string') return false;
  const lower = href.trim().toLowerCase();
  if (!lower || lower.startsWith('javascript:')) return false;
  try {
    const u = new URL(href, document.baseURI || window.location.href);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

/** 由点集计算视口包围盒（可选轨迹边距） */
function viewportBoxFromPointsExact(points) {
  if (!points || points.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x1 = Math.max(0, Math.floor(minX));
  const y1 = Math.max(0, Math.floor(minY));
  const x2 = Math.min(window.innerWidth, Math.ceil(maxX));
  const y2 = Math.min(window.innerHeight, Math.ceil(maxY));
  if (x2 - x1 < 4 || y2 - y1 < 4) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** 在视口矩形内采样 elementsFromPoint，避免全页 a[href] 扫描 */
function collectLinksFromBoxSamples(box) {
  const candidates = new Map();
  if (!box || box.w <= 0 || box.h <= 0) return candidates;
  const addCandidate = (link) => {
    if (!link) return;
    candidates.set(link, (candidates.get(link) || 0) + 1);
  };
  const cols = Math.max(3, Math.min(8, Math.ceil(box.w / 72)));
  const rows = Math.max(3, Math.min(8, Math.ceil(box.h / 56)));
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = box.x + ((col + 0.5) / cols) * box.w;
      const y = box.y + ((row + 0.5) / rows) * box.h;
      let stack;
      try {
        stack = document.elementsFromPoint(x, y);
      } catch (e) {
        continue;
      }
      for (let i = 0; i < stack.length; i++) {
        const node = stack[i];
        if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
        const tag = node.tagName;
        if (tag === 'A' || tag === 'AREA') {
          addCandidate(node);
          continue;
        }
        if (typeof node.closest === 'function') {
          const link = node.closest('a[href], area[href]');
          if (link) addCandidate(link);
        }
      }
    }
  }
  return candidates;
}

function getTrailRegionLinkRects(el) {
  const rects = [];
  if (!el) return rects;
  try {
    const list = typeof el.getClientRects === 'function' ? el.getClientRects() : null;
    if (list && list.length) {
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (!r || r.width <= 0 || r.height <= 0) continue;
        if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) continue;
        rects.push(r);
      }
    }
  } catch (e) { /* ignore */ }
  if (!rects.length) {
    try {
      const r = el.getBoundingClientRect();
      if (r && (r.width > 0 || r.height > 0)) rects.push(r);
    } catch (e) { /* ignore */ }
  }
  return rects;
}

function isTrailRegionLinkVisible(el, rects) {
  if (!el) return false;
  if (!rects || !rects.length) return false;
  try {
    const style = window.getComputedStyle(el);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
  } catch (e) { /* ignore */ }
  return true;
}

function resolveTrailRegionLinkUrl(el) {
  if (!el) return '';
  const directHref =
    el.href && typeof el.href === 'object' && 'baseVal' in el.href
      ? el.href.baseVal
      : el.href;
  const rawHref =
    directHref ||
    (typeof el.getAttribute === 'function' ? el.getAttribute('href') : '') ||
    '';
  if (!rawHref) return '';
  try {
    return new URL(rawHref, document.baseURI || window.location.href).href;
  } catch (e) {
    return '';
  }
}

function getTrailRegionLinkLabel(el, url) {
  if (!el) return url;
  const parts = [
    el.getAttribute && el.getAttribute('aria-label'),
    el.getAttribute && el.getAttribute('title'),
    el.innerText,
    el.textContent,
    (() => {
      try {
        const img = el.querySelector && el.querySelector('img[alt]');
        return img ? img.getAttribute('alt') : '';
      } catch (e) {
        return '';
      }
    })()
  ];
  for (let i = 0; i < parts.length; i++) {
    const label = String(parts[i] || '').replace(/\s+/g, ' ').trim();
    if (label) return label.slice(0, 120);
  }
  return url;
}

function computeTrailRegionLinkHit(el, box, sampleHits, rects) {
  const hits = Number(sampleHits) || 0;
  let best = null;
  const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);

  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    const overlap = trailRegionRectBoxOverlap(rect, box);
    if (!overlap) continue;

    const isHugeRect =
      overlap.rectArea > viewportArea * 0.35 ||
      (rect.width > window.innerWidth * 0.9 && rect.height > 120);
    const enoughPixelHit = overlap.width >= 4 && overlap.height >= 4 && overlap.area >= 24;
    const enoughTextLineHit =
      overlap.width >= Math.min(24, Math.max(6, rect.width * 0.22)) &&
      overlap.height >= Math.min(12, Math.max(4, rect.height * 0.35));

    // 采样命中、中心点在选区内、或可见片段有足够重叠均视为命中。
    // 大面积卡片/整页透明链接若未被采样命中，不因边缘擦到选区而误报。
    const accepted =
      hits > 0 ||
      overlap.centerInside ||
      (!isHugeRect && (
        overlap.rectRatio >= 0.12 ||
        (overlap.boxRatio >= 0.08 && enoughPixelHit) ||
        enoughTextLineHit
      ));
    if (!accepted) continue;

    let score = overlap.rectRatio * 220 + overlap.boxRatio * 120 + Math.min(80, overlap.area / 18);
    if (hits > 0) score += 600 + hits * 20;
    if (overlap.centerInside) score += 260;
    if (isHugeRect && hits === 0) score -= 180;

    if (!best || score > best.score) {
      best = {
        score,
        top: overlap.top,
        left: overlap.left,
        area: overlap.area
      };
    }
  }

  return best;
}

function collectTrailRegionLinkScanNodes(sampled, options = {}) {
  const nodes = [];
  const seen = new Set();
  const sampledOnly = !!(options && options.sampledOnly);
  if (sampled && sampled.size) {
    sampled.forEach((_hits, el) => {
      if (el && !seen.has(el)) {
        seen.add(el);
        nodes.push(el);
      }
    });
  }
  if (sampledOnly) return nodes;
  try {
    const all = document.querySelectorAll('a[href], area[href]');
    for (let i = 0; i < all.length && nodes.length < TRAIL_REGION_LINK_SCAN_LIMIT; i++) {
      const el = all[i];
      if (!el || seen.has(el)) continue;
      seen.add(el);
      nodes.push(el);
    }
  } catch (e) { /* ignore */ }
  return nodes;
}

/** 检测视口矩形内可打开的 http(s) 链接（按可见片段与选区的真实重叠识别） */
function findLinksInViewportBox(box, options = {}) {
  if (!box || box.w < 4 || box.h < 4) return [];
  const opts = options || {};
  const limit = Math.max(1, Math.min(TRAIL_REGION_LINK_DETECT_LIMIT, Number(opts.limit) || TRAIL_REGION_LINK_DETECT_LIMIT));
  const records = new Map();
  let order = 0;
  const sampled = collectLinksFromBoxSamples(box);
  const nodes = collectTrailRegionLinkScanNodes(sampled, opts);

  const processLink = (el) => {
    if (!el || records.size >= limit) return;
    const url = resolveTrailRegionLinkUrl(el);
    if (!isTrailRegionOpenableUrl(url)) return;
    const rects = getTrailRegionLinkRects(el);
    if (!isTrailRegionLinkVisible(el, rects)) return;
    const hit = computeTrailRegionLinkHit(el, box, sampled.get(el) || 0, rects);
    if (!hit) return;
    const label = opts.skipLabels ? url : getTrailRegionLinkLabel(el, url);
    const prev = records.get(url);
    const item = {
      url,
      label,
      _score: hit.score,
      _top: hit.top,
      _left: hit.left,
      _order: order++
    };
    if (!prev || item._score > prev._score) {
      records.set(url, item);
    }
  };

  for (let i = 0; i < nodes.length; i++) {
    processLink(nodes[i]);
    if (records.size >= limit && opts.sampledOnly) break;
  }

  return Array.from(records.values())
    .sort((a, b) => {
      const dy = a._top - b._top;
      if (Math.abs(dy) > 4) return dy;
      const dx = a._left - b._left;
      if (Math.abs(dx) > 4) return dx;
      return b._score - a._score || a._order - b._order;
    })
    .slice(0, limit)
    .map((item) => ({
      url: item.url,
      label: item.label
    }));
}

/** 检测轨迹/矩形选区包围盒内链接 */
function findLinksInTrailRegion(points, options = {}) {
  const box = trailRegionViewportBoxFromPoints(points);
  return findLinksInViewportBox(box, options);
}

function findLinksInRegionPoints(points, useTrailPad, options = {}) {
  const box = useTrailPad
    ? trailRegionViewportBoxFromPoints(points)
    : viewportBoxFromPointsExact(points);
  return findLinksInViewportBox(box, options);
}

function dismissTrailRegionChooser() {
  if (!trailRegionChooserSession) return;
  const s = trailRegionChooserSession;
  trailRegionChooserSession = null;
  if (s.resizeCleanup) {
    try {
      s.resizeCleanup();
    } catch (e) { /* ignore */ }
  }
  if (s.onKeyDown) {
    document.removeEventListener('keydown', s.onKeyDown, true);
  }
  if (s.root && s.root.parentNode) {
    s.root.parentNode.removeChild(s.root);
  } else if (typeof MouseExtUiHost !== 'undefined') {
    MouseExtUiHost.removeElementById('mouse-trail-region-chooser');
  }
}

const TRAIL_REGION_CHOOSER_MIN_W = 280;
const TRAIL_REGION_CHOOSER_MIN_H = 200;
const TRAIL_REGION_CHOOSER_EDGE_HIT = 8;

function clampTrailRegionChooserRect(left, top, width, height) {
  const pad = 8;
  const maxW = Math.max(TRAIL_REGION_CHOOSER_MIN_W, window.innerWidth - pad * 2);
  const maxH = Math.max(TRAIL_REGION_CHOOSER_MIN_H, window.innerHeight - pad * 2);
  let w = Math.max(TRAIL_REGION_CHOOSER_MIN_W, Math.min(maxW, width));
  let h = Math.max(TRAIL_REGION_CHOOSER_MIN_H, Math.min(maxH, height));
  let l = left;
  let t = top;
  if (l + w > window.innerWidth - pad) l = window.innerWidth - pad - w;
  if (t + h > window.innerHeight - pad) t = window.innerHeight - pad - h;
  if (l < pad) l = pad;
  if (t < pad) t = pad;
  return { l, t, w, h };
}

function applyTrailRegionChooserPanelRect(panel, left, top, width, height) {
  const r = clampTrailRegionChooserRect(left, top, width, height);
  panel.style.left = Math.round(r.l) + 'px';
  panel.style.top = Math.round(r.t) + 'px';
  panel.style.width = Math.round(r.w) + 'px';
  panel.style.height = Math.round(r.h) + 'px';
}

function initTrailRegionChooserPanelLayout(panel) {
  const w = Math.min(Math.max(TRAIL_REGION_CHOOSER_MIN_W, window.innerWidth * 0.92), 440);
  const h = Math.min(Math.max(TRAIL_REGION_CHOOSER_MIN_H, window.innerHeight * 0.42), 360);
  const l = (window.innerWidth - w) / 2;
  const t = Math.max(8, window.innerHeight - h - 72);
  panel.style.position = 'fixed';
  panel.style.boxSizing = 'border-box';
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  panel.style.overflow = 'hidden';
  panel.style.zIndex = '1';
  panel.style.margin = '0';
  panel.style.maxWidth = 'none';
  panel.style.maxHeight = 'none';
  applyTrailRegionChooserPanelRect(panel, l, t, w, h);
}

function attachTrailRegionChooserResizers(panel) {
  const edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
  const cursors = {
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    ne: 'nesw-resize',
    nw: 'nwse-resize',
    se: 'nwse-resize',
    sw: 'nesw-resize'
  };
  let active = null;

  const stopDrag = () => {
    active = null;
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerUp, true);
  };

  const onPointerMove = (e) => {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - active.startX;
    const dy = e.clientY - active.startY;
    let l = active.startL;
    let t = active.startT;
    let w = active.startW;
    let h = active.startH;
    const edge = active.edge;
    if (edge.includes('e')) w = active.startW + dx;
    if (edge.includes('w')) {
      w = active.startW - dx;
      l = active.startL + dx;
    }
    if (edge.includes('s')) h = active.startH + dy;
    if (edge.includes('n')) {
      h = active.startH - dy;
      t = active.startT + dy;
    }
    applyTrailRegionChooserPanelRect(panel, l, t, w, h);
  };

  const onPointerUp = () => {
    stopDrag();
  };

  const hit = TRAIL_REGION_CHOOSER_EDGE_HIT;
  const corner = Math.max(hit, 12);

  edges.forEach((edge) => {
    const handle = createMouseExtElement('div');
    handle.className = 'mouse-trail-region-chooser__resize-handle';
    handle.dataset.edge = edge;
    handle.setAttribute('aria-hidden', 'true');
    const base =
      'position:absolute;z-index:3;touch-action:none;box-sizing:border-box;' +
      'background:transparent;';
    let extra = '';
    if (edge === 'n') {
      extra = `top:0;left:${corner}px;right:${corner}px;height:${hit}px;cursor:${cursors.n};`;
    } else if (edge === 's') {
      extra = `bottom:0;left:${corner}px;right:${corner}px;height:${hit}px;cursor:${cursors.s};`;
    } else if (edge === 'e') {
      extra = `right:0;top:${corner}px;bottom:${corner}px;width:${hit}px;cursor:${cursors.e};`;
    } else if (edge === 'w') {
      extra = `left:0;top:${corner}px;bottom:${corner}px;width:${hit}px;cursor:${cursors.w};`;
    } else if (edge === 'ne') {
      extra = `top:0;right:0;width:${corner}px;height:${corner}px;cursor:${cursors.ne};`;
    } else if (edge === 'nw') {
      extra = `top:0;left:0;width:${corner}px;height:${corner}px;cursor:${cursors.nw};`;
    } else if (edge === 'se') {
      extra = `bottom:0;right:0;width:${corner}px;height:${corner}px;cursor:${cursors.se};`;
    } else if (edge === 'sw') {
      extra = `bottom:0;left:0;width:${corner}px;height:${corner}px;cursor:${cursors.sw};`;
    }
    handle.style.cssText = base + extra;

    handle.addEventListener(
      'pointerdown',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = panel.getBoundingClientRect();
        active = {
          edge,
          startX: e.clientX,
          startY: e.clientY,
          startL: rect.left,
          startT: rect.top,
          startW: rect.width,
          startH: rect.height
        };
        document.addEventListener('pointermove', onPointerMove, true);
        document.addEventListener('pointerup', onPointerUp, true);
        document.addEventListener('pointercancel', onPointerUp, true);
      },
      true
    );
    panel.appendChild(handle);
  });

  return () => {
    stopDrag();
    panel.querySelectorAll('.mouse-trail-region-chooser__resize-handle').forEach((el) => {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  };
}

function copyPlainTextToClipboard(text) {
  if (!text) return Promise.resolve(false);
  const value = String(text);

  function legacyCopy() {
    const active = document.activeElement;
    const selection = window.getSelection ? window.getSelection() : null;
    const savedRanges = [];
    if (selection) {
      for (let i = 0; i < selection.rangeCount; i += 1) {
        savedRanges.push(selection.getRangeAt(i).cloneRange());
      }
    }

    const textarea = createMouseExtElement('textarea');
    if (!textarea || !textarea.style) return false;
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.inset = '0 auto auto -9999px';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    (document.documentElement || document.body).appendChild(textarea);

    let copied = false;
    try {
      textarea.focus({ preventScroll: true });
      textarea.select();
      copied = document.execCommand('copy') === true;
    } catch (e) {
      copied = false;
    } finally {
      textarea.remove();
      if (selection) {
        try {
          selection.removeAllRanges();
          savedRanges.forEach((range) => selection.addRange(range));
        } catch (e) { /* ignore */ }
      }
      if (active && typeof active.focus === 'function') {
        try { active.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }
    }
    return copied;
  }

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(value).then(() => true, () => legacyCopy());
    }
  } catch (e) { /* use legacy copy below */ }
  return Promise.resolve(legacyCopy());
}

function formatTrailRegionLinksForCopy(selected) {
  if (!selected || !selected.length) return '';
  return selected
    .map((item) => {
      if (!item || !item.url) return '';
      const url = String(item.url).trim();
      if (!url) return '';
      const label = item.label ? String(item.label).trim() : '';
      if (label && label !== url) {
        return label + '\n' + url;
      }
      return url;
    })
    .filter(Boolean)
    .join('\n\n');
}

function showTrailRegionActionChooser(links, handlers) {
  dismissTrailRegionChooser();
  if (typeof MouseExtUiHost === 'undefined') {
    handlers.onScreenshot();
    return;
  }
  MouseExtUiHost.removeElementById('mouse-trail-region-chooser');

  const root = createMouseExtElement('div');
  root.id = 'mouse-trail-region-chooser';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.style.cssText = 'position:fixed;inset:0;';

  const panel = createMouseExtElement('div');
  panel.className = 'mouse-trail-region-chooser__panel';
  panel.style.cssText =
    'padding:14px 16px;border-radius:12px;font:13px/1.45 system-ui,sans-serif;' +
    'color:#fff;background:rgba(20,20,36,0.94);box-shadow:0 10px 32px rgba(0,0,0,0.4);' +
    'border:1px solid rgba(255,107,107,0.5);position:relative;';
  initTrailRegionChooserPanelLayout(panel);

  const title = createMouseExtElement('div');
  title.style.cssText = 'flex-shrink:0;font-weight:600;margin-bottom:8px;';
  title.textContent = getI18nMessage(
    'trailRegionChooseTitle',
    'Links in selection — screenshot or open'
  );
  panel.appendChild(title);

  const countLine = createMouseExtElement('div');
  countLine.style.cssText = 'flex-shrink:0;opacity:0.88;margin-bottom:8px;font-size:12px;';
  countLine.textContent =
    links.length === 1
      ? getI18nMessage('trailRegionLinkSingle', '1 link in region')
      : getI18nMessage('trailRegionLinkMultiple', '{count} links in region').replace(
          '{count}',
          String(links.length)
        );
  panel.appendChild(countLine);

  const listWrap = createMouseExtElement('div');
  listWrap.className = 'mouse-trail-region-chooser__list';
  listWrap.style.cssText =
    'flex:1;min-height:72px;overflow:auto;margin-bottom:10px;padding:6px 8px;' +
    'scrollbar-width:thin;scrollbar-color:rgba(255,255,255,0.2) transparent;' +
    'border-radius:8px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.08);';

  const checkboxes = [];

  const selectAllRow = createMouseExtElement('label');
  selectAllRow.style.cssText =
    'display:flex;align-items:center;gap:8px;padding:6px 4px;margin-bottom:4px;' +
    'font-size:12px;font-weight:600;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.1);';
  const selectAllCb = createMouseExtElement('input');
  selectAllCb.type = 'checkbox';
  selectAllCb.checked = true;
  selectAllCb.style.cssText = 'width:15px;height:15px;flex-shrink:0;cursor:pointer;accent-color:#ff6b6b;';
  const selectAllText = createMouseExtElement('span');
  selectAllText.textContent = getI18nMessage('trailRegionSelectAll', 'Select all');
  selectAllRow.appendChild(selectAllCb);
  selectAllRow.appendChild(selectAllText);
  listWrap.appendChild(selectAllRow);

  const syncSelectAllState = () => {
    const total = checkboxes.length;
    const checked = checkboxes.filter((c) => c.checked).length;
    selectAllCb.indeterminate = checked > 0 && checked < total;
    selectAllCb.checked = total > 0 && checked === total;
    updateActionButtonLabels();
  };

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const row = createMouseExtElement('label');
    row.style.cssText =
      'display:flex;align-items:flex-start;gap:8px;padding:6px 4px;cursor:pointer;' +
      'border-radius:6px;font-size:12px;line-height:1.4;';
    row.addEventListener('mouseenter', () => {
      row.style.background = 'rgba(255,255,255,0.06)';
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = 'transparent';
    });

    const cb = createMouseExtElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.index = String(i);
    cb.style.cssText = 'width:15px;height:15px;margin-top:2px;flex-shrink:0;cursor:pointer;accent-color:#ff6b6b;';
    checkboxes.push(cb);

    const textWrap = createMouseExtElement('span');
    textWrap.style.cssText = 'min-width:0;flex:1;';
    const titleEl = createMouseExtElement('span');
    titleEl.style.cssText = 'display:block;color:#f2f2f8;word-break:break-word;';
    titleEl.textContent = link.label || link.url;
    const urlEl = createMouseExtElement('span');
    urlEl.style.cssText = 'display:block;margin-top:2px;font-size:11px;opacity:0.65;word-break:break-all;';
    urlEl.textContent = link.url;
    textWrap.appendChild(titleEl);
    if (link.label && link.label !== link.url) {
      textWrap.appendChild(urlEl);
    }

    cb.addEventListener('change', syncSelectAllState);
    row.appendChild(cb);
    row.appendChild(textWrap);
    listWrap.appendChild(row);
  }

  selectAllCb.addEventListener('change', () => {
    const on = selectAllCb.checked;
    for (let j = 0; j < checkboxes.length; j++) {
      checkboxes[j].checked = on;
    }
    selectAllCb.indeterminate = false;
    updateActionButtonLabels();
  });

  panel.appendChild(listWrap);

  const btnRow = createMouseExtElement('div');
  btnRow.style.cssText = 'flex-shrink:0;display:flex;flex-wrap:wrap;gap:8px;';

  const mkBtn = (text, primary) => {
    const b = createMouseExtElement('button');
    b.type = 'button';
    b.textContent = text;
    const motion =
      'transition:transform 0.2s ease,box-shadow 0.2s ease,background 0.2s ease,border-color 0.2s ease;';
    if (primary) {
      b.style.cssText =
        'flex:1 1 auto;min-width:120px;padding:8px 12px;border-radius:8px;border:none;cursor:pointer;' +
        'font:inherit;font-weight:600;color:#fff;' +
        'background:linear-gradient(135deg,#ff6b6b,#ee5a5a);' +
        'box-shadow:0 2px 8px rgba(255,107,107,0.35);' +
        motion;
      b.addEventListener('mouseenter', () => {
        if (b.disabled) return;
        b.style.transform = 'translateY(-2px)';
        b.style.boxShadow = '0 6px 16px rgba(255,107,107,0.45)';
        b.style.background = 'linear-gradient(135deg,#ff7a7a,#f06565)';
      });
      b.addEventListener('mouseleave', () => {
        b.style.transform = '';
        b.style.boxShadow = '0 2px 8px rgba(255,107,107,0.35)';
        b.style.background = 'linear-gradient(135deg,#ff6b6b,#ee5a5a)';
      });
    } else {
      b.style.cssText =
        'flex:1 1 auto;min-width:120px;padding:8px 12px;border-radius:8px;' +
        'border:1px solid rgba(255,255,255,0.1);cursor:pointer;' +
        'font:inherit;font-weight:600;color:#e8e8f0;background:rgba(255,255,255,0.12);' +
        motion;
      b.addEventListener('mouseenter', () => {
        if (b.disabled) return;
        b.style.transform = 'translateY(-2px)';
        b.style.background = 'rgba(255,255,255,0.2)';
        b.style.borderColor = 'rgba(255,255,255,0.22)';
        b.style.boxShadow = '0 4px 12px rgba(0,0,0,0.22)';
      });
      b.addEventListener('mouseleave', () => {
        b.style.transform = '';
        b.style.background = 'rgba(255,255,255,0.12)';
        b.style.borderColor = 'rgba(255,255,255,0.1)';
        b.style.boxShadow = '';
      });
    }
    return b;
  };

  const shotLabel = getI18nMessage('trailRegionActionScreenshot', 'Screenshot (S)');
  const btnShot = mkBtn(shotLabel, true);
  const btnCopy = mkBtn('', false);
  const btnOpen = mkBtn('', false);

  const setSecondaryBtnDisabled = (btn, disabled) => {
    btn.disabled = disabled;
    btn.style.opacity = disabled ? '0.45' : '1';
    btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
    if (disabled) {
      btn.style.transform = '';
      btn.style.boxShadow = '';
      btn.style.background = 'rgba(255,255,255,0.12)';
      btn.style.borderColor = 'rgba(255,255,255,0.1)';
    }
  };

  const updateActionButtonLabels = () => {
    const n = checkboxes.filter((c) => c.checked).length;
    if (n === 0) {
      btnOpen.textContent = getI18nMessage('trailRegionActionOpenNone', 'Open selected (O)');
      btnCopy.textContent = getI18nMessage('trailRegionActionCopyNone', 'Copy (C)');
      setSecondaryBtnDisabled(btnOpen, true);
      setSecondaryBtnDisabled(btnCopy, true);
      return;
    }
    setSecondaryBtnDisabled(btnOpen, false);
    setSecondaryBtnDisabled(btnCopy, false);
    btnCopy.textContent =
      n === 1
        ? getI18nMessage('trailRegionActionCopy', 'Copy (C)')
        : getI18nMessage('trailRegionActionCopySelected', 'Copy {n} (C)').replace(
            '{n}',
            String(n)
          );
    if (n === 1) {
      btnOpen.textContent = getI18nMessage('trailRegionActionOpenLink', 'Open in new tab (O)');
    } else {
      btnOpen.textContent = getI18nMessage('trailRegionActionOpenSelected', 'Open {n} in new tabs (O)').replace(
        '{n}',
        String(n)
      );
    }
  };
  updateActionButtonLabels();

  const getSelectedLinks = () => {
    const out = [];
    for (let i = 0; i < checkboxes.length; i++) {
      if (checkboxes[i].checked) out.push(links[i]);
    }
    return out;
  };

  const copySelectedTrailLinks = () => {
    const selected = getSelectedLinks();
    if (!selected.length) {
      showGestureHint(getI18nMessage('trailRegionNoLinkSelected', 'Select at least one link'));
      return;
    }
    copyPlainTextToClipboard(formatTrailRegionLinksForCopy(selected)).then((ok) => {
      showGestureHint(
        ok
          ? getI18nMessage('copiedToClipboard', 'Copied to clipboard')
          : getI18nMessage('trailRegionCopyFailed', 'Copy failed')
      );
    });
  };

  btnRow.appendChild(btnShot);
  btnRow.appendChild(btnCopy);
  btnRow.appendChild(btnOpen);
  panel.appendChild(btnRow);

  const hint = createMouseExtElement('div');
  hint.style.cssText =
    'flex-shrink:0;margin-top:10px;font-size:11px;opacity:0.65;text-align:center;';
  hint.textContent = getI18nMessage(
    'trailRegionChooseHint',
    'Esc to cancel · check links to copy/open · drag edges to resize'
  );
  panel.appendChild(hint);

  const finish = (which) => {
    if (which === 'open') {
      const selected = getSelectedLinks();
      if (!selected.length) {
        showGestureHint(getI18nMessage('trailRegionNoLinkSelected', 'Select at least one link'));
        return;
      }
      dismissTrailRegionChooser();
      handlers.onOpenLinks(selected);
      return;
    }
    dismissTrailRegionChooser();
    if (which === 'screenshot') handlers.onScreenshot();
    else if (handlers.onCancel) handlers.onCancel();
  };

  root.appendChild(panel);
  if (!MouseExtUiHost.appendToModalsLayer(root)) {
    handlers.onScreenshot();
    return;
  }
  panel.addEventListener('click', (e) => e.stopPropagation());
  root.addEventListener('click', (e) => {
    if (e.target === root) finish('cancel');
  });

  btnShot.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    finish('screenshot');
  });
  btnCopy.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    copySelectedTrailLinks();
  });
  btnOpen.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    finish('open');
  });

  const onKeyDown = (e) => {
    if (!trailRegionChooserSession) return;
    const k = e.key && e.key.toLowerCase();
    if (k === 'escape') {
      e.preventDefault();
      e.stopPropagation();
      finish('cancel');
      return;
    }
    if (k === 's') {
      e.preventDefault();
      e.stopPropagation();
      finish('screenshot');
      return;
    }
    if (k === 'c') {
      e.preventDefault();
      e.stopPropagation();
      copySelectedTrailLinks();
      return;
    }
    if (k === 'o') {
      e.preventDefault();
      e.stopPropagation();
      finish('open');
    }
  };

  document.addEventListener('keydown', onKeyDown, true);
  const resizeCleanup = attachTrailRegionChooserResizers(panel);
  trailRegionChooserSession = { root, panel, onKeyDown, resizeCleanup };
}

function openTrailRegionLinksInNewTabs(links) {
  if (!links || !links.length) return;
  const list = links.slice(0, TRAIL_REGION_LINK_OPEN_LIMIT);
  list.forEach((item) => {
    if (!item || !isTrailRegionOpenableUrl(item.url)) return;
    safeSendMessage({ action: 'openInNewTab', url: item.url }).catch(() => {});
  });
  if (links.length > TRAIL_REGION_LINK_OPEN_LIMIT) {
    showGestureHint(
      getI18nMessage('trailRegionLinksTruncated', 'Opened first {n} links').replace(
        '{n}',
        String(TRAIL_REGION_LINK_OPEN_LIMIT)
      )
    );
  } else {
    showGestureHint(
      links.length === 1
        ? getI18nMessage('trailRegionLinkOpened', 'Link opened in new tab')
        : getI18nMessage('trailRegionLinksOpened', 'Links opened in new tabs')
    );
  }
}

function completeRegionScreenshotWithPoints(points, resetGestureAfterAction, options) {
  const opts = options || {};
  if (!points || points.length < 2) {
    showGestureHint(getI18nMessage('screenshotNeedTrail', 'Draw a trail to select region'));
    if (typeof resetGestureAfterAction === 'function') resetGestureAfterAction();
    return;
  }
  const links = findLinksInRegionPoints(points, opts.useTrailPadForLinks !== false);
  const captureTrailPad =
    opts.captureTrailPad != null
      ? opts.captureTrailPad
      : opts.useTrailPadForLinks !== false
        ? trailRegionPadFromSettings()
        : 0;

  const MS = typeof window !== 'undefined' ? window.MouseScreenshot : null;

  const runShot = () => {
    if (window !== window.top) {
      (async () => {
        try {
          const resp = await safeSendMessageWhenSessionReady({
            action: 'captureRegionFromIframe',
            points,
            trailPad: captureTrailPad,
            iframeLocal: true
          });
          if (resp && resp.success === true) {
            showScreenshotSuccessHint();
          } else {
            showGestureHint(getI18nMessage('screenshotFailed', 'Screenshot failed'));
          }
        } catch (e) {
          showGestureHint(getI18nMessage('screenshotFailed', 'Screenshot failed'));
        }
        if (typeof resetGestureAfterAction === 'function') resetGestureAfterAction();
      })();
      return;
    }
    if (!MS || !MS.captureRegionFromPoints) {
      showGestureHint(getI18nMessage('screenshotUnavailable', 'Screenshot unavailable'));
      if (typeof resetGestureAfterAction === 'function') resetGestureAfterAction();
      return;
    }
    (async () => {
      try {
        await MS.captureRegionFromPoints(points, { trailPad: captureTrailPad });
        showScreenshotSuccessHint();
      } catch (e) {
        showGestureHint(getI18nMessage('screenshotFailed', 'Screenshot failed'));
      }
      if (typeof resetGestureAfterAction === 'function') resetGestureAfterAction();
    })();
  };

  if (links.length > 0) {
    showTrailRegionActionChooser(links, {
      onScreenshot: runShot,
      onOpenLinks: (selectedLinks) => {
        openTrailRegionLinksInNewTabs(selectedLinks);
        if (typeof resetGestureAfterAction === 'function') resetGestureAfterAction();
      },
      onCancel: () => {
        if (typeof resetGestureAfterAction === 'function') resetGestureAfterAction();
      }
    });
    return;
  }
  runShot();
}

function completeTrailRegionGesture(resetGestureAfterAction) {
  const viewportPts = getGestureTrailViewportPointsForScreenshot();
  completeRegionScreenshotWithPoints(viewportPts, resetGestureAfterAction, {
    useTrailPadForLinks: true,
    captureTrailPad: trailRegionPadFromSettings()
  });
}

/** 矩形选区在 iframe 内为 frame 坐标，截图裁剪须用标签视口坐标 */
function convertScreenshotPointsToTabViewport(points) {
  if (!points || !points.length || window === window.top) return points;
  try {
    const fe = window.frameElement;
    if (!fe) return points;
    const rect = fe.getBoundingClientRect();
    return points.map((p) => ({ x: p.x + rect.left, y: p.y + rect.top }));
  } catch (e) {
    return points;
  }
}

function completeRegionPickGesture(points, resetGestureAfterAction) {
  completeRegionScreenshotWithPoints(
    convertScreenshotPointsToTabViewport(points),
    resetGestureAfterAction,
    {
      useTrailPadForLinks: false,
      captureTrailPad: 0
    }
  );
}

function trailRegionHintTextForPoints(points, gestureName) {
  if (!shouldTriggerTrailRegionScreenshot(points, gestureName)) {
    return getGestureTranslations().screenshotRegion;
  }
  const now = Date.now();
  if (now - lastTrailRegionLinkHintAt >= 400) {
    lastTrailRegionLinkHintAt = now;
    // 手势过程中只做采样命中检测，避免每 400ms 全量扫描页面链接；松手完成时再做完整识别。
    if (findLinksInTrailRegion(getTrailPointsForLinkDetection(), { sampledOnly: true, skipLabels: true, limit: 1 }).length) {
      trailRegionLinksHintForGesture = true;
    }
  }
  return trailRegionLinksHintForGesture
    ? getGestureTranslations().screenshotRegionOrLink
    : getGestureTranslations().screenshotRegion;
}

function scheduleGestureTrailDraw() {
  if (gestureTrailDrawRafId) return;
  gestureTrailDrawRafId = requestAnimationFrame(() => {
    gestureTrailDrawRafId = 0;
    drawGestureTrailIncremental();
  });
}

function drawGestureTrailIncremental() {
  if (!settings?.showGestureTrail) return;

  // iframe 内：默认发到主框架；iframe 内全屏时在本文档绘制（父页 canvas 无法盖住全屏 iframe）
  if (window !== window.top) {
    if (!gestureOverlayUsesIframeDocumentFullscreen()) {
      const points = gesturePoints.map((p) => ({ x: p.x, y: p.y }));
      const type = iframeTrailForwardStarted ? 'update' : 'init';
      iframeTrailForwardStarted = true;
      const data = { type, points, iframeLocal: true };
      if (type === 'init') {
        data.scrollContext = {
          anchor: { x: gesturePoints[0].x, y: gesturePoints[0].y },
          pathHints: serializeComposedPathForMessage(gestureComposedPath)
        };
      }
      scheduleIframeTrailForward(data);
      return;
    }
    if (!gestureCanvas || !gestureContext) {
      initGestureCanvas();
    }
  }

  if (!gestureContext) return;

  try {
    if (gesturePoints.length < 2) return;
    if (!gestureCanvas || !gestureCanvas.isConnected) {
      initGestureCanvas();
      if (!gestureContext) return;
    }

    applyGestureTrailContextStyles(gestureContext);
    gestureContext.clearRect(0, 0, gestureCanvas.width, gestureCanvas.height);
    const transform = getCanvasViewportTransform(gestureCanvas);
    strokeSmoothGestureTrailPath(gestureContext, gesturePoints, transform);
    gestureTrailDrawnPointCount = gesturePoints.length;
  } catch (e) {
    console.log('增量绘制手势错误:', e.message);
  }
}

// 修改绘制手势轨迹的函数
function drawGesture(x, y) {
  gesturePoints.push({ x: x, y: y });
  scheduleGestureTrailDraw();
}

// 仅重绘轨迹，不添加点（用于 resize / iframe 同步等需要完整重绘的场景）
function redrawGestureTrail() {
  if (!settings?.showGestureTrail) return;

  // iframe 内：默认发到主框架；iframe 内全屏时在本文档绘制（父页 canvas 无法盖住全屏 iframe）
  if (window !== window.top) {
    if (!gestureOverlayUsesIframeDocumentFullscreen()) {
      const points = gesturePoints.map((p) => ({ x: p.x, y: p.y }));
      const type = iframeTrailForwardStarted ? 'update' : 'init';
      iframeTrailForwardStarted = true;
      const data = { type, points, iframeLocal: true };
      if (type === 'init') {
        data.scrollContext = {
          anchor: { x: gesturePoints[0].x, y: gesturePoints[0].y },
          pathHints: serializeComposedPathForMessage(gestureComposedPath)
        };
      }
      scheduleIframeTrailForward(data);
      return;
    }
    if (!gestureCanvas || !gestureContext) {
      initGestureCanvas();
    }
  }

  if (!gestureContext) return;

  try {
    if (gesturePoints.length < 2) return;

    gestureContext.clearRect(0, 0, gestureCanvas.width, gestureCanvas.height);
    const transform = getCanvasViewportTransform(gestureCanvas);
    applyGestureTrailContextStyles(gestureContext);
    strokeSmoothGestureTrailPath(gestureContext, gesturePoints, transform);
    gestureTrailDrawnPointCount = gesturePoints.length;
  } catch (e) {
    console.log('绘制手势错误:', e.message);
  }
}

// 简化手势点，去除冗余点
function smoothGesturePointsForRecognition(points) {
  if (!points || points.length < 4) return points;
  const strength = clampNumber(Number(smoothingFactor) || 0, 0, 1);
  if (strength <= 0.01) return points;

  // smoothingFactor 越高，识别前的微抖过滤越强；保留首尾点，避免手势整体方向被拖偏。
  const alpha = clampNumber(1 - strength * 0.62, 0.28, 0.95);
  const smoothed = [{ x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = smoothed[smoothed.length - 1];
    const p = points[i];
    smoothed.push({
      x: prev.x + (p.x - prev.x) * alpha,
      y: prev.y + (p.y - prev.y) * alpha
    });
  }
  const last = points[points.length - 1];
  smoothed.push({ x: last.x, y: last.y });
  return smoothed;
}

const GESTURE_RECOGNITION_MAX_SOURCE_POINTS = 220;

function compactGesturePointsForRecognition(points) {
  if (!points || points.length <= GESTURE_RECOGNITION_MAX_SOURCE_POINTS) return points;
  const compact = [points[0]];
  let last = points[0];
  const minStep = Math.max(2.5, Math.min(8, Number(minDirectionSegmentLength) * 0.55 || 3));
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minStep) {
      compact.push(p);
      last = p;
    }
  }
  const tail = points[points.length - 1];
  if (compact[compact.length - 1] !== tail) compact.push(tail);
  if (compact.length <= GESTURE_RECOGNITION_MAX_SOURCE_POINTS) return compact;

  const sampled = [];
  const step = (compact.length - 1) / (GESTURE_RECOGNITION_MAX_SOURCE_POINTS - 1);
  for (let i = 0; i < GESTURE_RECOGNITION_MAX_SOURCE_POINTS; i++) {
    sampled.push(compact[Math.round(i * step)]);
  }
  return sampled;
}

function simplifyGesturePoints(points) {
  if (points.length <= 2) return points;
  const sourcePoints = compactGesturePointsForRecognition(points);
  const recognitionPoints = smoothGesturePointsForRecognition(sourcePoints);
  
  // 进一步应用Douglas-Peucker算法简化曲线
  const simplified = [];
  
  // 计算点到直线的距离
  const lineDistance = (p, a, b) => {
    const d1 = Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
    if (d1 === 0) return Math.sqrt(Math.pow(p.x - a.x, 2) + Math.pow(p.y - a.y, 2));
    
    const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (d1 * d1);
    
    if (t < 0) return Math.sqrt(Math.pow(p.x - a.x, 2) + Math.pow(p.y - a.y, 2));
    if (t > 1) return Math.sqrt(Math.pow(p.x - b.x, 2) + Math.pow(p.y - b.y, 2));
    
    return Math.sqrt(
      Math.pow(p.x - (a.x + t * (b.x - a.x)), 2) + 
      Math.pow(p.y - (a.y + t * (b.y - a.y)), 2)
    );
  };
  
  // Douglas-Peucker递归实现
  const douglasPeucker = (start, end, epsilon, pointList) => {
    let maxDist = 0;
    let maxDistIndex = 0;
    
    for (let i = start + 1; i < end; i++) {
      const dist = lineDistance(recognitionPoints[i], recognitionPoints[start], recognitionPoints[end]);
      if (dist > maxDist) {
        maxDist = dist;
        maxDistIndex = i;
      }
    }
    
    // 如果最大距离大于阈值，则继续递归简化
    if (maxDist > epsilon) {
      // 分治简化曲线
      const leftResults = douglasPeucker(start, maxDistIndex, epsilon, pointList);
      // 不重复添加中间点
      const rightResults = douglasPeucker(maxDistIndex, end, epsilon, pointList);
      
      return leftResults.concat(rightResults.slice(1));
    } else {
      // 如果所有点都足够接近直线，则只保留端点
      return [recognitionPoints[start], recognitionPoints[end]];
    }
  };
  
  // 检测手势是否有乱画模式
  const detectScribbling = (pts) => {
    if (pts.length < 10) return false;
    
    // 计算路径的总长度
    let totalLength = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i-1].x;
      const dy = pts[i].y - pts[i-1].y;
      totalLength += Math.sqrt(dx*dx + dy*dy);
    }
    
    // 计算起点到终点的直线距离
    const startToEndDistance = Math.sqrt(
      Math.pow(pts[pts.length-1].x - pts[0].x, 2) + 
      Math.pow(pts[pts.length-1].y - pts[0].y, 2)
    );
    
    // 进一步放宽乱画判定比例，从3.0增加到3.5
    const scribblingThreshold = 3.5;
    
    // 检测重复模式的存在
    let hasRepetitivePattern = false;
    
    // 检测方法1：计算点之间的方向变化
    let directionChanges = 0;
    let consistentDirectionRuns = 0;
    
    for (let i = 2; i < pts.length; i++) {
      const dx1 = pts[i-1].x - pts[i-2].x;
      const dy1 = pts[i-1].y - pts[i-2].y;
      const dx2 = pts[i].x - pts[i-1].x;
      const dy2 = pts[i].y - pts[i-1].y;
      
      // 计算两段线段的夹角
      const dot = dx1 * dx2 + dy1 * dy2;
      const mag1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const mag2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      
      if (mag1 > 0 && mag2 > 0) {
        const cosTheta = dot / (mag1 * mag2);
        
        // 方向变化大于60度视为方向变化
        if (cosTheta < 0.5) {
          directionChanges++;
        } else if (cosTheta > 0.9) {
          // 相同方向的持续运行
          consistentDirectionRuns++;
        }
      }
    }
    
    // 检测方法2：基于起点-终点距离与点数量的比例
    const pointDensity = pts.length / startToEndDistance;
    
    // 如果符合以下条件之一，可能是有意的重复模式而非乱画：
    // 1. 起点到终点距离适中，且方向变化有规律性
    // 2. 点密度适中（太高则可能是乱画）
    // 3. 有明显的连续相同方向运行
    if ((startToEndDistance > 80 && directionChanges >= 2 && directionChanges <= 8) ||
        (pointDensity < 0.4 && startToEndDistance > 40) ||
        (consistentDirectionRuns > pts.length / 5)) {
      hasRepetitivePattern = true;
    }
    
    // 如果是明显的Z字形或N字形模式（常见的重复轨迹），特殊处理
    if (directionChanges >= 3 && 
        directionChanges <= 6 && 
        startToEndDistance > 50 &&
        totalLength / startToEndDistance < 4.5) {
      hasRepetitivePattern = true;
    }
    
    // 只有当同时满足：1.长度比例超过阈值 2.不是明显的重复模式 3.起点终点距离较近，才判断为乱画
    return (totalLength > startToEndDistance * scribblingThreshold) && 
           !hasRepetitivePattern && 
           startToEndDistance < 120;
  };
  
  // 如果检测到乱画模式，并且合理的距离内有大量点，则可能是用户在乱画
  const isScribbling = detectScribbling(points);
  if (isScribbling && points.length > 15) {
    // 为乱画返回一个特殊标记，后续处理中会进一步判断
    // 添加乱画第一个点和最后一个点
    simplified.push(points[0]);
    simplified.push({x: points[points.length-1].x, y: points[points.length-1].y, isScribbling: true});
    return simplified;
  }
  
  // 执行Douglas-Peucker算法，epsilon值控制简化程度
  // 较小的值会保留更多的点，较大的值会简化得更厉害
  const recognitionSmoothingStrength = clampNumber(Number(smoothingFactor) || 0, 0, 1);
  const epsilon = minDirectionSegmentLength * (0.5 + recognitionSmoothingStrength * 0.75); // 使用方向段长度和平滑因子共同控制简化强度
  return douglasPeucker(0, recognitionPoints.length - 1, epsilon, []);
}

// 调试信息面板相关变量
let debugPanel = null; // 调试信息面板元素
let isDebugPanelVisible = false; // 跟踪调试面板显示状态
let lastDebugInfo = {}; // 存储最近一次手势的调试信息
let enableDebugPanelSetting = false; // 从设置控制是否允许显示调试面板
let enableExtConsoleLogSetting = false; // 控制台日志开关（sync 跨标签页）
let debugGestureConfigSaveTimer = 0;
let debugPanelRefreshRafId = 0;
let lastDebugLiveInfoBuildTime = 0;
let pendingDebugConfigImportButton = null;
const DEBUG_PANEL_LIVE_INFO_INTERVAL_MS = 55;
const DEBUG_GESTURE_CONFIG_SAVE_DELAY_MS = 300;

const DEBUG_GESTURE_CONFIG_STORAGE_KEY = 'debugGestureConfig';
const DEBUG_GESTURE_PARAM_DEFS = [
  { key: 'angleThreshold', get: () => angleThreshold, set: (v) => { angleThreshold = v; }, min: 0.2, max: 2.8, step: 0.05, precision: 2 },
  { key: 'directionChangeThreshold', get: () => directionChangeThreshold, set: (v) => { directionChangeThreshold = v; }, min: 0.05, max: 1, step: 0.05, precision: 2 },
  { key: 'minGestureDistance', get: () => minGestureDistance, set: (v) => { minGestureDistance = v; }, min: 1, max: 100, step: 1, precision: 0 },
  { key: 'minDirectionSegmentLength', get: () => minDirectionSegmentLength, set: (v) => { minDirectionSegmentLength = v; }, min: 1, max: 80, step: 1, precision: 0 },
  { key: 'minGestureComplexity', get: () => minGestureComplexity, set: (v) => { minGestureComplexity = v; }, min: 1, max: 20, step: 1, precision: 0 },
  { key: 'minMovementToStartGesture', get: () => minMovementToStartGesture, set: (v) => { minMovementToStartGesture = v; }, min: 0, max: 30, step: 1, precision: 0 },
  { key: 'smoothingFactor', get: () => smoothingFactor, set: (v) => { smoothingFactor = v; }, min: 0, max: 1, step: 0.05, precision: 2 }
];

function getDebugGestureDefaultConfig() {
  return {
    angleThreshold: 1.0,
    directionChangeThreshold: 0.35,
    minGestureDistance: 6,
    minDirectionSegmentLength: 5,
    minGestureComplexity: 3,
    minMovementToStartGesture: 2,
    smoothingFactor: 0.25
  };
}

function getDebugGestureParamDef(key) {
  return DEBUG_GESTURE_PARAM_DEFS.find((def) => def.key === key) || null;
}

function normalizeDebugGestureConfig(input) {
  const src = input && typeof input === 'object' ? input : {};
  const defaults = getDebugGestureDefaultConfig();
  const normalized = {};
  DEBUG_GESTURE_PARAM_DEFS.forEach((def) => {
    const fallback = defaults[def.key];
    const raw = src[def.key];
    let value = Number(raw);
    if (!Number.isFinite(value)) value = fallback;
    value = Math.min(def.max, Math.max(def.min, value));
    if (def.precision === 0) {
      value = Math.round(value);
    } else {
      const m = Math.pow(10, def.precision);
      value = Math.round(value * m) / m;
    }
    normalized[def.key] = value;
  });
  return normalized;
}

function getDebugGestureConfigSnapshot() {
  const snapshot = {};
  DEBUG_GESTURE_PARAM_DEFS.forEach((def) => {
    snapshot[def.key] = def.get();
  });
  return normalizeDebugGestureConfig(snapshot);
}

function applyDebugGestureConfig(config, options = {}) {
  const normalized = normalizeDebugGestureConfig(config);
  DEBUG_GESTURE_PARAM_DEFS.forEach((def) => {
    def.set(normalized[def.key]);
  });
  if (!options.skipUiSync) {
    syncDebugGestureSettingsUI();
  }
  if (isDebugPanelVisible && debugPanel && !options.skipPanelUpdate) {
    updateDebugPanel();
  }
  return normalized;
}

function persistDebugGestureConfig(config, options = {}) {
  const normalized = applyDebugGestureConfig(config, {
    skipUiSync: options.skipUiSync,
    skipPanelUpdate: options.skipPanelUpdate
  });
  const doSave = () => {
    try {
      if (chrome && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.set({ [DEBUG_GESTURE_CONFIG_STORAGE_KEY]: normalized }, () => {
          if (chrome.runtime.lastError) {
            showDebugMessage(getDebugPanelText('debugSettingsSaveFailed'), false);
            if (typeof options.onError === 'function') options.onError(chrome.runtime.lastError);
          } else if (!options.silent) {
            showDebugMessage(getDebugPanelText('debugSettingsSaved'), true);
          }
          if (!chrome.runtime.lastError && typeof options.onSaved === 'function') {
            options.onSaved(normalized);
          }
        });
      } else if (typeof options.onSaved === 'function') {
        options.onSaved(normalized);
      }
    } catch (e) {
      showDebugMessage(getDebugPanelText('debugSettingsSaveFailed'), false);
      if (typeof options.onError === 'function') options.onError(e);
    }
  };

  if (options.immediate) {
    if (debugGestureConfigSaveTimer) {
      clearTimeout(debugGestureConfigSaveTimer);
      debugGestureConfigSaveTimer = 0;
    }
    doSave();
    return normalized;
  }

  if (debugGestureConfigSaveTimer) clearTimeout(debugGestureConfigSaveTimer);
  debugGestureConfigSaveTimer = setTimeout(() => {
    debugGestureConfigSaveTimer = 0;
    doSave();
  }, DEBUG_GESTURE_CONFIG_SAVE_DELAY_MS);
  return normalized;
}

function applyExtConsoleLogSetting(enabled) {
  enableExtConsoleLogSetting = !!enabled;
  const G = typeof globalThis !== 'undefined' ? globalThis : window;
  if (typeof G.__MOUSE_EXT_APPLY_CONSOLE__ === 'function') {
    G.__MOUSE_EXT_APPLY_CONSOLE__(enableExtConsoleLogSetting);
  }
  syncDebugPanelConsoleToggleUI();
}

function paintDebugConsoleToggle(toggle) {
  if (!toggle) return;
  const wrap = toggle.closest('[data-debug-console-switch]');
  if (!wrap) return;
  const slider = wrap.querySelector('[data-debug-console-slider]');
  const knob = wrap.querySelector('[data-debug-console-knob]');
  const on = !!toggle.checked;
  if (slider) {
    slider.style.background = on ? 'rgba(100, 200, 235, 0.85)' : 'rgba(100, 116, 139, 0.55)';
    slider.style.boxShadow = on ? '0 0 0 1px rgba(100, 200, 235, 0.18)' : 'none';
  }
  if (knob) {
    knob.style.transform = on ? 'translateX(18px)' : 'translateX(0)';
    knob.style.background = on ? '#ffffff' : '#e2e8f0';
  }
}

function syncDebugPanelConsoleToggleUI() {
  if (!debugPanel) return;
  const toggle = debugPanel.querySelector('#mouseDebugConsoleLogToggle');
  if (toggle) {
    toggle.checked = enableExtConsoleLogSetting;
    const wrap = toggle.closest('[data-debug-console-switch]');
    if (wrap) wrap.setAttribute('aria-checked', enableExtConsoleLogSetting ? 'true' : 'false');
    paintDebugConsoleToggle(toggle);
  }
}

function persistExtConsoleLogSetting(enabled) {
  applyExtConsoleLogSetting(enabled);
  try {
    if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ enableExtConsoleLog: enableExtConsoleLogSetting });
    }
  } catch (e) {}
}

// 初始化调试面板开关设置并监听变化
try {
  if (chrome && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({
      enableDebugPanel: false,
      enableExtConsoleLog: false,
      [DEBUG_GESTURE_CONFIG_STORAGE_KEY]: getDebugGestureDefaultConfig()
    }, (items) => {
      enableDebugPanelSetting = !!items.enableDebugPanel;
      applyDebugGestureConfig(items[DEBUG_GESTURE_CONFIG_STORAGE_KEY], { skipPanelUpdate: true });
      applyExtConsoleLogSetting(!!items.enableExtConsoleLog);
      applyDebugPanelSetting();
      if (!enableDebugPanelSetting && isDebugPanelVisible) {
        toggleDebugPanel();
      }
    });
    chrome.storage.onChanged.addListener((changes, namespace) => {
      try {
        if (namespace !== 'sync') return;
        if (changes.enableDebugPanel) {
          enableDebugPanelSetting = !!changes.enableDebugPanel.newValue;
          applyDebugPanelSetting();
          if (!enableDebugPanelSetting && isDebugPanelVisible) {
            toggleDebugPanel();
          }
        }
        if (changes.enableExtConsoleLog) {
          applyExtConsoleLogSetting(!!changes.enableExtConsoleLog.newValue);
        }
        if (changes[DEBUG_GESTURE_CONFIG_STORAGE_KEY]) {
          const editingDebugInput = !!(
            debugPanel &&
            document.activeElement &&
            debugPanel.contains(document.activeElement) &&
            document.activeElement.matches('[data-debug-config-key]')
          );
          applyDebugGestureConfig(changes[DEBUG_GESTURE_CONFIG_STORAGE_KEY].newValue, {
            skipPanelUpdate: editingDebugInput
          });
        }
      } catch (e) {}
    });
  }
} catch (e) {}

function isDebugPanelInfoEnabled() {
  return !!(isDebugPanelVisible || (settings && settings.enableDebugPanel));
}

function isDebugPanelConfigInputFocused() {
  return !!(
    debugPanel &&
    document.activeElement &&
    debugPanel.contains(document.activeElement) &&
    document.activeElement.matches('[data-debug-config-key]')
  );
}

function requestDebugPanelContentRefresh() {
  if (!isDebugPanelVisible || !debugPanel || isDebugPanelConfigInputFocused()) return;
  if (debugPanelRefreshRafId) return;
  debugPanelRefreshRafId = requestAnimationFrame(() => {
    debugPanelRefreshRafId = 0;
    if (isDebugPanelVisible && debugPanel && !isDebugPanelConfigInputFocused()) {
      updateDebugPanel({ liveOnly: true });
    }
  });
}

function computeGesturePathDistance(points) {
  if (!points || points.length < 2) return 0;
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    distance += Math.sqrt(dx * dx + dy * dy);
  }
  return distance;
}

function buildLiveGestureDebugInfo(status, extraPoint) {
  const points = Array.isArray(gesturePoints) ? gesturePoints.slice() : [];
  if (
    extraPoint &&
    Number.isFinite(extraPoint.x) &&
    Number.isFinite(extraPoint.y)
  ) {
    const last = points[points.length - 1];
    if (!last || Math.abs(last.x - extraPoint.x) > 0.01 || Math.abs(last.y - extraPoint.y) > 0.01) {
      points.push({ x: extraPoint.x, y: extraPoint.y });
    }
  }

  let simplifiedPoints = points;
  try {
    simplifiedPoints = points.length > 1 ? simplifyGesturePoints(points) : points.slice();
  } catch (e) {
    simplifiedPoints = points.slice();
  }

  const originalDirections = [];
  const directionDistances = [];
  let totalDistance = 0;
  const recognitionCfg = getGestureRecognitionConfig();
  if (simplifiedPoints.length >= 2 && !(simplifiedPoints.length === 2 && simplifiedPoints[1].isScribbling)) {
    for (let i = 1; i < simplifiedPoints.length; i++) {
      const prev = simplifiedPoints[i - 1];
      const curr = simplifiedPoints[i];
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      totalDistance += distance;
      if (distance < recognitionCfg.microSegmentMin) continue;
      const dir = getAxisDirectionForGestureSegment(dx, dy, recognitionCfg.angleRatio);
      if (dir) {
        originalDirections.push(dir);
        directionDistances.push(Math.round(distance));
      }
    }
  } else {
    totalDistance = computeGesturePathDistance(points);
  }

  let resolvedStatus = status;
  if (!resolvedStatus) {
    if (points.length < 2) resolvedStatus = 'pendingGesture';
    else if (totalDistance < recognitionCfg.minTotalDistance) resolvedStatus = 'notEnoughMovement';
    else if (!originalDirections.length) resolvedStatus = 'noDirectionDetected';
    else resolvedStatus = 'trackingGesture';
  }

  return {
    timestamp: new Date().toLocaleTimeString(),
    status: resolvedStatus,
    pointsCount: points.length,
    simplifiedPointsCount: simplifiedPoints ? simplifiedPoints.length : 0,
    totalDistance: Math.round(totalDistance),
    originalDirections,
    directionDistances,
    hasRepetitivePattern: !!(simplifiedPoints.length === 2 && simplifiedPoints[1].isScribbling),
    repeatingPattern: '',
    mergedDirections: originalDirections.slice(),
    finalGesture: '',
    similarity: 0
  };
}

function updateLiveGestureDebugInfo(status, extraPoint, options = {}) {
  if (!isDebugPanelInfoEnabled()) return;
  const now = Date.now();
  if (!options.immediate && now - lastDebugLiveInfoBuildTime < DEBUG_PANEL_LIVE_INFO_INTERVAL_MS) {
    return;
  }
  lastDebugLiveInfoBuildTime = now;
  lastDebugInfo = buildLiveGestureDebugInfo(status, extraPoint);
  requestDebugPanelContentRefresh();
}

// 添加调试信息收集函数
function collectDebugInfo(originalDirections, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                          repeatingPattern, mergedDirections, finalGesture, similarity, directionDistances, status) {
  if (!isDebugPanelVisible && !(settings && settings.enableDebugPanel)) {
    return;
  }
  // 收集所有调试信息
  lastDebugInfo = {
    timestamp: new Date().toLocaleTimeString(),
    status: status || (finalGesture ? 'recognizedGestureStatus' : 'invalidGestureStatus'),
    pointsCount: gesturePoints.length,
    simplifiedPointsCount: simplifiedPoints ? simplifiedPoints.length : 0,
    totalDistance: Math.round(totalDistance),
    originalDirections: originalDirections ? [...originalDirections] : [],
    directionDistances: directionDistances ? [...directionDistances] : [], // 添加方向距离
    hasRepetitivePattern: hasRepetitivePattern,
    repeatingPattern: repeatingPattern,
    mergedDirections: mergedDirections ? [...mergedDirections] : [],
    finalGesture: finalGesture,
    similarity: similarity ? Math.round(similarity * 100) / 100 : 0
  };
  
  // 如果调试面板可见，更新显示
  requestDebugPanelContentRefresh();
}

// 获取调试面板翻译文本
function getDebugPanelText(key) {
  const msgKey = 'debug' + key.charAt(0).toUpperCase() + key.slice(1);
  const fallbacks = {
    consoleLog: 'Console logs',
    panelTitle: 'Gesture Debug',
    copyButton: 'Copy',
    debugSettings: 'Debug settings',
    debugSettingsHint: 'Changes are applied and saved in real time.',
    exportConfig: 'Export',
    importConfig: 'Import',
    resetConfig: 'Reset',
    debugSettingsSaved: 'Saved',
    debugSettingsSaveFailed: 'Save failed',
    debugSettingsImportSuccess: 'Imported',
    debugSettingsImportFailed: 'Import failed',
    debugSettingsExportFailed: 'Export failed',
    debugSettingsReset: 'Reset',
    angleThresholdHelp: 'Controls how strictly movement is classified as horizontal or vertical. Higher values require a straighter direction and reduce diagonal misfires.',
    directionChangeThresholdHelp: 'Controls how aggressively short direction changes are ignored. Higher values filter jitter; lower values make turns easier to detect.',
    minGestureDistanceHelp: 'Minimum total movement distance required before a gesture can be recognized. Increase it to reduce accidental triggers.',
    minDirectionSegmentLengthHelp: 'Minimum effective direction-run length. Increase it to ignore short hand-release jitter; decrease it only if gestures feel too hard to trigger.',
    minGestureComplexityHelp: 'Maximum meaningful direction complexity tolerated before a path is treated as scribbling or invalid. Lower values reject messy paths earlier.',
    minMovementToStartGesture: 'Min movement to start',
    minMovementToStartGestureHelp: 'Pointer must move at least this many pixels after pressing the button before gesture tracking starts, reducing right-click and touchpad jitter.',
    smoothingFactor: 'Smoothing factor',
    smoothingFactorHelp: 'Controls trail and recognition smoothing. Higher values reduce jitter but may soften sharp turns; lower values respond faster.',
    consoleLogHelp: 'Enable detailed extension logs in the DevTools console for troubleshooting.',
    currentGestureStatus: 'Current status',
    pendingGesture: 'Pointer down',
    waitingForMovement: 'Waiting for movement',
    trackingGesture: 'Tracking',
    recognizedGestureStatus: 'Recognized',
    invalidGestureStatus: 'Not matched yet',
    notEnoughPoints: 'Not enough points',
    notEnoughMovement: 'Not enough movement',
    noDirectionDetected: 'No clear direction',
    scribblingGesture: 'Scribbling detected',
    tooComplexGesture: 'Too complex',
    releasedGesture: 'Released'
  };
  return getI18nMessage(msgKey, fallbacks[key] || key);
}

function escapeDebugHtmlAttribute(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return ch;
    }
  });
}

function escapeDebugHtmlText(value) {
  return String(value == null ? '' : value).replace(/[&<>]/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      default: return ch;
    }
  });
}

function getDebugParamHelpText(key) {
  return getDebugPanelText(`${key}Help`);
}

function getDebugStatusText(status) {
  return getDebugPanelText(status || 'waitingForGestureData');
}

function getDebugStatusColor(status) {
  if (status === 'recognizedGestureStatus') return '#4ade80';
  if (status === 'trackingGesture') return '#64c8eb';
  if (status === 'pendingGesture' || status === 'waitingForMovement') return '#fbbf24';
  if (status === 'releasedGesture') return '#94a3b8';
  return '#f87171';
}

function createDebugPanelButton(text, title) {
  const btn = createMouseExtElement('button');
  btn.type = 'button';
  btn.textContent = text;
  if (title) btn.title = title;
  btn.style.cssText = `
    border: 1px solid rgba(100, 200, 235, 0.35);
    background: rgba(30, 41, 59, 0.72);
    color: #c4e8ff;
    border-radius: 7px;
    padding: 4px 9px;
    min-height: 24px;
    font-size: 11px;
    line-height: 1.25;
    cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
  `;
  btn.onmouseover = () => {
    btn.style.background = 'rgba(59, 130, 246, 0.25)';
    btn.style.borderColor = 'rgba(100, 200, 235, 0.65)';
    btn.style.transform = 'translateY(-1px)';
  };
  btn.onmouseout = () => {
    btn.style.background = 'rgba(30, 41, 59, 0.72)';
    btn.style.borderColor = 'rgba(100, 200, 235, 0.35)';
    btn.style.transform = 'translateY(0)';
  };
  return btn;
}

function isDebugSavedFlashing(el) {
  return !!(el && el.dataset && el.dataset.debugSavedFlash === 'true');
}

function restoreDebugSavedElement(el, type) {
  if (!el || !el.style) return;
  if (el.dataset) delete el.dataset.debugSavedFlash;
  if (type === 'button') {
    el.style.background = 'rgba(30, 41, 59, 0.72)';
    el.style.borderColor = 'rgba(100, 200, 235, 0.35)';
    el.style.boxShadow = 'none';
    el.style.color = '#c4e8ff';
    el.style.transform = 'translateY(0)';
    return;
  }
  const focused = document.activeElement === el;
  el.style.borderColor = focused ? 'rgba(100, 200, 235, 0.85)' : 'rgba(148, 163, 184, 0.35)';
  el.style.boxShadow = focused ? '0 0 0 1px rgba(100, 200, 235, 0.25)' : 'none';
  el.style.background = focused ? 'rgba(15, 23, 42, 0.96)' : 'rgba(15, 23, 42, 0.85)';
  el.style.color = '#e2e8f0';
}

function flashDebugSavedElement(el, type = 'input') {
  if (!el || !el.style) return;
  if (el._mouseExtSavedFlashTimer) {
    clearTimeout(el._mouseExtSavedFlashTimer);
    el._mouseExtSavedFlashTimer = 0;
  }
  if (el.dataset) el.dataset.debugSavedFlash = 'true';
  if (type === 'button') {
    el.style.borderColor = 'rgba(74, 222, 128, 0.95)';
    el.style.background = 'rgba(34, 197, 94, 0.24)';
    el.style.boxShadow = '0 0 0 1px rgba(74, 222, 128, 0.28)';
    el.style.color = '#bbf7d0';
  } else {
    el.style.borderColor = 'rgba(74, 222, 128, 0.95)';
    el.style.boxShadow = '0 0 0 1px rgba(74, 222, 128, 0.42), 0 0 16px rgba(34, 197, 94, 0.24)';
    el.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.92), rgba(22, 163, 74, 0.82))';
    el.style.color = '#f0fdf4';
  }
  el._mouseExtSavedFlashTimer = setTimeout(() => {
    el._mouseExtSavedFlashTimer = 0;
    restoreDebugSavedElement(el, type);
  }, 1050);
}

function flashDebugConfigInput(input) {
  flashDebugSavedElement(input, 'input');
}

function flashAllDebugConfigInputs() {
  if (!debugPanel) return;
  debugPanel.querySelectorAll('[data-debug-config-key]').forEach((input) => {
    flashDebugConfigInput(input);
  });
}

function flashDebugActionButton(buttonOrAction) {
  if (!debugPanel) return;
  const button = typeof buttonOrAction === 'string'
    ? debugPanel.querySelector(`[data-debug-action="${buttonOrAction}"]`)
    : buttonOrAction;
  flashDebugSavedElement(button, 'button');
}

function applyDebugPanelButtonEffects(btn) {
  if (!btn) return;
  btn.style.transition = 'background 0.2s ease, border-color 0.2s ease, transform 0.2s ease, color 0.2s ease';
  btn.onmouseover = () => {
    if (isDebugSavedFlashing(btn)) return;
    btn.style.background = 'rgba(59, 130, 246, 0.25)';
    btn.style.borderColor = 'rgba(100, 200, 235, 0.65)';
    btn.style.transform = 'translateY(-1px)';
    btn.style.color = '#e0f2fe';
  };
  btn.onmouseout = () => {
    if (isDebugSavedFlashing(btn)) return;
    btn.style.background = 'rgba(30, 41, 59, 0.72)';
    btn.style.borderColor = 'rgba(100, 200, 235, 0.35)';
    btn.style.transform = 'translateY(0)';
    btn.style.color = '#c4e8ff';
  };
}

function applyDebugConfigInputEffects(input) {
  if (!input) return;
  input.style.textAlign = 'center';
  input.style.transition = 'border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease, color 0.2s ease';
  input.addEventListener('focus', () => {
    if (isDebugSavedFlashing(input)) return;
    input.style.borderColor = 'rgba(100, 200, 235, 0.85)';
    input.style.boxShadow = '0 0 0 1px rgba(100, 200, 235, 0.25)';
    input.style.background = 'rgba(15, 23, 42, 0.96)';
  });
  input.addEventListener('blur', () => {
    if (isDebugSavedFlashing(input)) return;
    input.style.borderColor = 'rgba(148, 163, 184, 0.35)';
    input.style.boxShadow = 'none';
    input.style.background = 'rgba(15, 23, 42, 0.85)';
  });
  input.addEventListener('mouseenter', () => {
    if (!isDebugSavedFlashing(input) && document.activeElement !== input) {
      input.style.borderColor = 'rgba(100, 200, 235, 0.58)';
    }
  });
  input.addEventListener('mouseleave', () => {
    if (!isDebugSavedFlashing(input) && document.activeElement !== input) {
      input.style.borderColor = 'rgba(148, 163, 184, 0.35)';
    }
  });
}

function applyDebugStepperButtonEffects(btn) {
  if (!btn) return;
  const baseBg = 'rgba(30, 41, 59, 0.82)';
  const hoverBg = 'rgba(59, 130, 246, 0.38)';
  btn.style.transition = 'background 0.16s ease, color 0.16s ease, transform 0.16s ease';
  btn.addEventListener('mouseenter', () => {
    btn.style.background = hoverBg;
    btn.style.color = '#e0f2fe';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = baseBg;
    btn.style.color = '#c4e8ff';
    btn.style.transform = 'translateY(0)';
  });
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    btn.style.transform = 'scale(0.96)';
  });
  btn.addEventListener('mouseup', () => {
    btn.style.transform = 'translateY(0)';
  });
}

function getDebugConfigInputValue(def) {
  const el = debugPanel && debugPanel.querySelector(`[data-debug-config-key="${def.key}"]`);
  if (!el) return def.get();
  const raw = String(el.value || '').trim();
  if (raw === '') return def.get();
  const value = Number(raw);
  return Number.isFinite(value) ? value : def.get();
}

function readDebugGestureConfigFromInputs() {
  const cfg = {};
  DEBUG_GESTURE_PARAM_DEFS.forEach((def) => {
    cfg[def.key] = getDebugConfigInputValue(def);
  });
  return normalizeDebugGestureConfig(cfg);
}

function syncDebugGestureSettingsUI() {
  if (!debugPanel) return;
  DEBUG_GESTURE_PARAM_DEFS.forEach((def) => {
    const input = debugPanel.querySelector(`[data-debug-config-key="${def.key}"]`);
    const valueLabel = debugPanel.querySelector(`[data-debug-config-value="${def.key}"]`);
    const value = def.get();
    if (input && document.activeElement !== input) {
      input.value = String(value);
    }
    if (valueLabel) {
      valueLabel.textContent = String(value);
    }
  });
}

function onDebugGestureConfigInput() {
  const input = (arguments[0] && arguments[0].currentTarget) || this;
  if (input) {
    const raw = String(input.value || '').trim();
    if (raw === '' || !Number.isFinite(Number(raw))) return;
  }
  const normalized = persistDebugGestureConfig(readDebugGestureConfigFromInputs(), {
    silent: true,
    skipUiSync: true,
    skipPanelUpdate: true,
    onSaved: () => flashDebugConfigInput(input)
  });
  DEBUG_GESTURE_PARAM_DEFS.forEach((def) => {
    const valueLabel = debugPanel && debugPanel.querySelector(`[data-debug-config-value="${def.key}"]`);
    if (valueLabel) valueLabel.textContent = String(normalized[def.key]);
  });
}

function commitDebugGestureConfigInputs(activeInput, options = {}) {
  const normalized = persistDebugGestureConfig(readDebugGestureConfigFromInputs(), {
    immediate: options.immediate !== false,
    silent: true,
    skipPanelUpdate: true,
    onSaved: () => flashDebugConfigInput(activeInput)
  });
  if (activeInput && activeInput.dataset) {
    const key = activeInput.dataset.debugConfigKey;
    if (key && normalized[key] != null) activeInput.value = String(normalized[key]);
  }
  syncDebugGestureSettingsUI();
  return normalized;
}

function adjustDebugConfigInput(input, direction) {
  if (!input) return;
  const key = input.dataset.debugConfigKey;
  const def = getDebugGestureParamDef(key);
  if (!def) return;
  const raw = Number(input.value);
  const base = Number.isFinite(raw) ? raw : def.get();
  const delta = (direction === 'down' ? -1 : 1) * def.step;
  const cfg = readDebugGestureConfigFromInputs();
  cfg[key] = base + delta;
  const normalized = persistDebugGestureConfig(cfg, {
    immediate: false,
    silent: true,
    skipPanelUpdate: true,
    onSaved: () => flashDebugConfigInput(input)
  });
  input.value = String(normalized[key]);
  syncDebugGestureSettingsUI();
  try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
}

function exportDebugGestureConfig(sourceButton) {
  try {
    const data = {
      type: 'mouse-gesture-debug-config',
      version: 1,
      exportDate: new Date().toISOString(),
      debugGestureConfig: getDebugGestureConfigSnapshot(),
      enableExtConsoleLog: enableExtConsoleLogSetting
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = createMouseExtElement('a');
    a.href = url;
    a.download = `mouse-gesture-debug-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.style.display = 'none';
    document.documentElement.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
    flashDebugActionButton(sourceButton || 'export');
  } catch (e) {
    showDebugMessage(getDebugPanelText('debugSettingsExportFailed'), false);
  }
}

function importDebugGestureConfigFromText(text, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error('invalid_json');
  }
  const source = parsed && parsed.debugGestureConfig ? parsed.debugGestureConfig : parsed;
  const normalized = normalizeDebugGestureConfig(source);
  persistDebugGestureConfig(normalized, {
    immediate: true,
    silent: true,
    skipPanelUpdate: true,
    onSaved: () => {
      flashDebugActionButton(options.sourceButton || 'import');
      flashAllDebugConfigInputs();
    }
  });
  if (parsed && typeof parsed.enableExtConsoleLog === 'boolean') {
    persistExtConsoleLogSetting(parsed.enableExtConsoleLog);
  }
  syncDebugGestureSettingsUI();
}

async function importDebugGestureConfigFile(file, options = {}) {
  if (!file) return;
  try {
    importDebugGestureConfigFromText(await file.text(), options);
  } catch (e) {
    showDebugMessage(getDebugPanelText('debugSettingsImportFailed'), false);
  }
}

function resetDebugGestureConfig(sourceButton) {
  const normalized = persistDebugGestureConfig(getDebugGestureDefaultConfig(), {
    immediate: true,
    silent: true,
    skipPanelUpdate: true,
    onSaved: () => {
      flashDebugActionButton(sourceButton || 'reset');
      flashAllDebugConfigInputs();
    }
  });
  syncDebugGestureSettingsUI();
  return normalized;
}

function createDebugGestureSettingsEditor() {
  const box = createMouseExtElement('div');
  box.id = 'mouseGestureDebugSettings';
  box.style.cssText = `
    margin-bottom: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid rgba(102, 126, 234, 0.15);
  `;

  const top = createMouseExtElement('div');
  top.style.cssText = `
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  `;

  const heading = createMouseExtElement('div');
  heading.textContent = getDebugPanelText('debugSettings');
  heading.style.cssText = `
    color: #a78bfa;
    font-weight: 600;
    font-size: 11px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  `;

  const buttons = createMouseExtElement('div');
  buttons.style.cssText = 'display: flex; gap: 5px; align-items: center; flex-wrap: wrap; justify-content: flex-end;';
  const exportBtn = createDebugPanelButton(getDebugPanelText('exportConfig'));
  const importBtn = createDebugPanelButton(getDebugPanelText('importConfig'));
  const resetBtn = createDebugPanelButton(getDebugPanelText('resetConfig'));
  const importInput = createMouseExtElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json,.json';
  importInput.style.display = 'none';

  exportBtn.addEventListener('click', exportDebugGestureConfig);
  importBtn.addEventListener('click', () => importInput.click());
  resetBtn.addEventListener('click', resetDebugGestureConfig);
  importInput.addEventListener('change', () => {
    const file = importInput.files && importInput.files[0];
    importDebugGestureConfigFile(file);
    importInput.value = '';
  });

  buttons.appendChild(exportBtn);
  buttons.appendChild(importBtn);
  buttons.appendChild(resetBtn);
  buttons.appendChild(importInput);
  top.appendChild(heading);
  top.appendChild(buttons);
  box.appendChild(top);

  const hint = createMouseExtElement('div');
  hint.textContent = getDebugPanelText('debugSettingsHint');
  hint.style.cssText = 'color: #94a3b8; font-size: 10px; margin-bottom: 8px;';
  box.appendChild(hint);

  const grid = createMouseExtElement('div');
  grid.style.cssText = `
    display: grid;
    grid-template-columns: minmax(0, 1fr) 88px 38px;
    gap: 6px 8px;
    align-items: center;
  `;

  DEBUG_GESTURE_PARAM_DEFS.forEach((def) => {
    const label = createMouseExtElement('label');
    label.textContent = getDebugPanelText(def.key);
    label.setAttribute('for', `mouseDebugConfig_${def.key}`);
    label.style.cssText = 'color: #93c5fd; font-size: 11px; line-height: 1.2;';

    const input = createMouseExtElement('input');
    input.type = 'number';
    input.id = `mouseDebugConfig_${def.key}`;
    input.dataset.debugConfigKey = def.key;
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    input.value = String(def.get());
    input.style.cssText = `
      width: 100%;
      box-sizing: border-box;
      background: rgba(15, 23, 42, 0.85);
      color: #e2e8f0;
      border: 1px solid rgba(148, 163, 184, 0.35);
      border-radius: 5px;
      padding: 3px 5px;
      font-size: 11px;
      outline: none;
    `;
    input.addEventListener('input', onDebugGestureConfigInput);
    input.addEventListener('change', () => {
      const normalized = persistDebugGestureConfig(readDebugGestureConfigFromInputs(), {
        immediate: true,
        silent: true,
        skipPanelUpdate: true,
        onSaved: () => flashDebugConfigInput(input)
      });
      input.value = String(normalized[def.key]);
      syncDebugGestureSettingsUI();
    });

    const value = createMouseExtElement('span');
    value.dataset.debugConfigValue = def.key;
    value.textContent = String(def.get());
    value.style.cssText = 'color: #cbd5e1; font-size: 10px; text-align: end;';

    grid.appendChild(label);
    grid.appendChild(input);
    grid.appendChild(value);
  });

  box.appendChild(grid);
  return box;
}

// 初始化调试面板
function initDebugPanel() {
  if (typeof MouseExtUiHost === 'undefined') return;
  // 如果已经存在，先移除
  if (debugPanel && debugPanel.isConnected) {
    debugPanel.remove();
  }
  
  // 创建新的调试面板
  debugPanel = createMouseExtElement('div');
  debugPanel.id = 'mouseGestureDebugPanel';
  debugPanel.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    width: 390px;
    max-height: 80vh;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,0.2) transparent;
    background-color: rgba(20, 20, 36, 0.92);
    color: #e2e8f0;
    border: 1px solid rgba(102, 126, 234, 0.4);
    border-radius: 8px;
    padding: 12px;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.5;
    z-index: 2147483647;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3), 0 0 15px rgba(102, 126, 234, 0.15);
    letter-spacing: 0.3px;
  `;
  debugPanel.style.right = 'auto';
  debugPanel.style.insetInlineEnd = '10px';
  
  // 添加标题和关闭按钮
  const header = createMouseExtElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(102, 126, 234, 0.25);
    padding-bottom: 8px;
    margin-bottom: 12px;
  `;
  
  const title = createMouseExtElement('div');
  title.textContent = getDebugPanelText('panelTitle');
  title.style.cssText = `
    font-weight: 600;
    background: linear-gradient(120deg, #a5b4fc, #64c8eb);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    text-shadow: 0px 1px 1px rgba(0, 0, 0, 0.1);
    font-size: 13px;
  `;
  
  const controls = createMouseExtElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '8px';
  
  const copyButton = createMouseExtElement('button');
  copyButton.textContent = '📋';
  copyButton.title = getDebugPanelText('copyButton');
  copyButton.style.cssText = `
    background: none;
    border: none;
    color: #64c8eb;
    font-size: 16px;
    cursor: pointer;
    padding: 0 5px;
    transition: transform 0.2s ease, color 0.2s ease;
  `;
  copyButton.onmouseover = () => {
    copyButton.style.transform = 'scale(1.1)';
    copyButton.style.color = '#a5b4fc';
  };
  copyButton.onmouseout = () => {
    copyButton.style.transform = 'scale(1)';
    copyButton.style.color = '#64c8eb';
  };
  copyButton.onclick = copyDebugInfo;
  
  const closeButton = createMouseExtElement('button');
  closeButton.textContent = '×';
  closeButton.style.cssText = `
    background: none;
    border: none;
    color: #fc8181;
    font-size: 18px;
    cursor: pointer;
    padding: 0 5px;
    transition: transform 0.2s ease, color 0.2s ease;
  `;
  closeButton.onmouseover = () => {
    closeButton.style.transform = 'scale(1.1)';
    closeButton.style.color = '#f56565';
  };
  closeButton.onmouseout = () => {
    closeButton.style.transform = 'scale(1)';
    closeButton.style.color = '#fc8181';
  };
  closeButton.onclick = toggleDebugPanel;
  
  controls.appendChild(copyButton);
  controls.appendChild(closeButton);
  
  header.appendChild(title);
  header.appendChild(controls);
  debugPanel.appendChild(header);

  // 添加内容区域
  const content = createMouseExtElement('div');
  content.id = 'mouseGestureDebugContent';
  debugPanel.appendChild(content);
  
  // 添加消息提示区域
  const messageArea = createMouseExtElement('div');
  messageArea.id = 'mouseGestureDebugMessage';
  messageArea.style.cssText = `
    margin-top: 10px;
    padding: 5px;
    border-radius: 6px;
    text-align: center;
    font-weight: bold;
    opacity: 0;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    display: none;
    font-size: 11px;
  `;
  debugPanel.appendChild(messageArea);
  
  if (!MouseExtUiHost.appendToPanelsLayer(debugPanel)) return;
  
  // 更新显示
  updateDebugPanel();
}

// 根据设置显示/隐藏调试面板
function applyDebugPanelSetting() {
  try {
    if (!enableDebugPanelSetting) {
      // 关闭面板并阻止显示
      if (isDebugPanelVisible) {
        toggleDebugPanel();
      }
      return;
    }
    // 设置允许时不主动打开，仅当用户通过快捷键或按钮触发
  } catch (e) {}
}

// 复制调试信息
async function copyDebugInfo() {
  // 如果没有调试信息，直接返回
  if (!lastDebugInfo || Object.keys(lastDebugInfo).length === 0) {
    showDebugMessage(getDebugPanelText('waitingForGestureData'), false);
    return;
  }
  
  // 格式化调试信息为纯文本
  const textInfo = formatDebugInfoForCopy(currentLang);
  
  const success = await copyPlainTextToClipboard(textInfo);
  showDebugMessage(
    getDebugPanelText(success ? 'copySuccess' : 'copyFailed'),
    success
  );
}

// 格式化调试信息为纯文本格式
function formatDebugInfoForCopy(lang) {
  // 使用i18n获取方向文本
  const dirs = {
    left: getI18nMessage('left'),
    right: getI18nMessage('right'),
    up: getI18nMessage('up'),
    down: getI18nMessage('down')
  };
  
  let result = `===== ${getDebugPanelText('panelTitle')} =====\n`;
  result += `${getDebugPanelText('latestGestureInfo')} (${lastDebugInfo.timestamp})\n\n`;
  if (lastDebugInfo.status) {
    result += `${getDebugPanelText('currentGestureStatus')}: ${getDebugStatusText(lastDebugInfo.status)}\n\n`;
  }
  
  // 系统设置
  result += `${getDebugPanelText('systemSettings')}:\n`;
  result += `- ${getDebugPanelText('angleThreshold')}: ${angleThreshold}\n`;
  result += `- ${getDebugPanelText('directionChangeThreshold')}: ${directionChangeThreshold}\n`;
  result += `- ${getDebugPanelText('minGestureDistance')}: ${minGestureDistance}\n`;
  result += `- ${getDebugPanelText('minDirectionSegmentLength')}: ${minDirectionSegmentLength}\n`;
  result += `- ${getDebugPanelText('minGestureComplexity')}: ${minGestureComplexity}\n`;
  result += `- ${getDebugPanelText('minMovementToStartGesture')}: ${minMovementToStartGesture}\n`;
  result += `- ${getDebugPanelText('smoothingFactor')}: ${smoothingFactor}\n`;
  result += `- ${getDebugPanelText('consoleLog')}: ${enableExtConsoleLogSetting ? getDebugPanelText('yes') : getDebugPanelText('no')}\n\n`;
  
  // 手势信息
  result += `${getDebugPanelText('points')}: ${lastDebugInfo.pointsCount} → ${lastDebugInfo.simplifiedPointsCount} (${getDebugPanelText('simplifiedAfter')})\n`;
  result += `${getDebugPanelText('totalDistance')}: ${lastDebugInfo.totalDistance}px\n\n`;
  
  // 方向识别
  result += `${getDebugPanelText('directionRecognition')}:\n`;
  if (lastDebugInfo.originalDirections && lastDebugInfo.originalDirections.length > 0) {
    const original = lastDebugInfo.originalDirections.map((d, i) => {
      const dirName = dirs[d] || d;
      // 添加距离信息
      const distance = lastDebugInfo.directionDistances && lastDebugInfo.directionDistances[i] 
        ? `(${lastDebugInfo.directionDistances[i]}px)` 
        : '';
      return `${dirName}${distance}`;
    }).join(' → ');
    result += `- ${getDebugPanelText('originalDirections')}: ${original}\n`;
  } else {
    result += `- ${getDebugPanelText('originalDirections')}: ${getDebugPanelText('none')}\n`;
  }
  result += `- ${getDebugPanelText('repetitivePatternDetected')}: ${lastDebugInfo.hasRepetitivePattern ? getDebugPanelText('yes') : getDebugPanelText('no')}\n`;
  result += `- ${getDebugPanelText('repetitivePatternType')}: ${lastDebugInfo.repeatingPattern || getDebugPanelText('none')}\n\n`;
  
  // 方向合并
  result += `${getDebugPanelText('directionMerging')}:\n`;
  if (lastDebugInfo.mergedDirections && lastDebugInfo.mergedDirections.length > 0) {
    const merged = lastDebugInfo.mergedDirections.map(d => dirs[d] || d).join(' → ');
    result += `- ${getDebugPanelText('mergedDirections')}: ${merged}\n`;
  } else {
    result += `- ${getDebugPanelText('mergedDirections')}: ${getDebugPanelText('none')}\n`;
  }
  result += '\n';
  
  // 最终结果
  result += `${getDebugPanelText('finalResult')}:\n`;
  result += `- ${getDebugPanelText('recognizedGesture')}: ${lastDebugInfo.finalGesture || getDebugPanelText('invalidGesture')}\n`;
  result += `- ${getDebugPanelText('similarity')}: ${lastDebugInfo.similarity}\n`;
  
  return result;
}

// 显示消息提示
function showDebugMessage(message, isSuccess) {
  if (!debugPanel) return;
  const messageArea = debugPanel.querySelector('#mouseGestureDebugMessage');
  if (!messageArea) return;
  
  // 设置消息样式
  messageArea.style.backgroundColor = isSuccess ? 'rgba(52, 211, 153, 0.15)' : 'rgba(248, 113, 113, 0.15)';
  messageArea.style.color = isSuccess ? '#4ade80' : '#f87171';
  messageArea.style.border = `1px solid ${isSuccess ? 'rgba(52, 211, 153, 0.3)' : 'rgba(248, 113, 113, 0.3)'}`;
  messageArea.style.display = 'block';
  messageArea.style.padding = '6px';
  messageArea.textContent = message;
  
  // 显示消息
  setTimeout(() => {
    messageArea.style.opacity = '1';
    messageArea.style.transform = 'translateY(0)';
  }, 10);
  
  // 3秒后淡出
  setTimeout(() => {
    messageArea.style.opacity = '0';
    messageArea.style.transform = 'translateY(-5px)';
    setTimeout(() => {
      messageArea.style.display = 'none';
    }, 300);
  }, 3000);
}

function debugGestureSystemSettingsRowsHtml() {
  const paramRows = DEBUG_GESTURE_PARAM_DEFS.map((def) => {
    const labelText = getDebugPanelText(def.key);
    const helpText = getDebugParamHelpText(def.key);
    const helpAttr = escapeDebugHtmlAttribute(helpText);
    const labelAttr = escapeDebugHtmlAttribute(labelText);
    const labelHtml = escapeDebugHtmlText(labelText);
    return `
    <label for="mouseDebugConfig_${def.key}" title="${helpAttr}" style="color: #93c5fd; line-height: 1.2; cursor: help;">
      ${labelHtml}:
    </label>
    <div data-debug-number-wrap="${def.key}" style="
      position: relative;
      width: 112px;
      height: 28px;
      justify-self: end;
      box-sizing: border-box;
    " title="${helpAttr}">
      <input
        type="text"
        inputmode="decimal"
        autocomplete="off"
        spellcheck="false"
        id="mouseDebugConfig_${def.key}"
        data-debug-config-key="${def.key}"
        data-debug-min="${def.min}"
        data-debug-max="${def.max}"
        data-debug-step="${def.step}"
        value="${def.get()}"
        title="${helpAttr}"
        style="
          width: 112px;
          height: 28px;
          line-height: 28px;
          box-sizing: border-box;
          background: rgba(15, 23, 42, 0.88);
          color: #e2e8f0;
          border: 1px solid rgba(148, 163, 184, 0.42);
          border-radius: 8px;
          padding: 4px 24px;
          font-size: 12px;
          font-weight: 600;
          text-align: center;
          outline: none;
          letter-spacing: 0.2px;
          transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
        "
      >
      <div style="
        position: absolute;
        top: 2px;
        right: 2px;
        bottom: 2px;
        width: 20px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border-left: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 0 6px 6px 0;
      ">
        <button type="button" tabindex="-1" data-debug-step-key="${def.key}" data-debug-step-dir="up" aria-label="Increase ${labelAttr}" title="${helpAttr}" style="
          flex: 1;
          min-height: 0;
          border: 0;
          border-bottom: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(30, 41, 59, 0.82);
          color: #c4e8ff;
          padding: 0;
          margin: 0;
          font-size: 11px;
          line-height: 1;
          font-weight: 700;
          cursor: pointer;
        ">+</button>
        <button type="button" tabindex="-1" data-debug-step-key="${def.key}" data-debug-step-dir="down" aria-label="Decrease ${labelAttr}" title="${helpAttr}" style="
          flex: 1;
          min-height: 0;
          border: 0;
          background: rgba(30, 41, 59, 0.82);
          color: #c4e8ff;
          padding: 0;
          margin: 0;
          font-size: 12px;
          line-height: 1;
          font-weight: 700;
          cursor: pointer;
        ">-</button>
      </div>
    </div>
  `;
  }).join('');
  const consoleHelpAttr = escapeDebugHtmlAttribute(getDebugParamHelpText('consoleLog'));
  const consoleLabelHtml = escapeDebugHtmlText(getDebugPanelText('consoleLog'));
  const consoleRow = `
    <label for="mouseDebugConsoleLogToggle" title="${consoleHelpAttr}" style="color: #93c5fd; line-height: 1.2; cursor: help; user-select: none;">
      ${consoleLabelHtml}:
    </label>
    <div
      data-debug-console-switch="true"
      role="switch"
      aria-checked="${enableExtConsoleLogSetting ? 'true' : 'false'}"
      tabindex="0"
      title="${consoleHelpAttr}"
      style="
        position: relative;
        width: 42px;
        height: 24px;
        justify-self: end;
        flex-shrink: 0;
        cursor: pointer;
        outline: none;
      "
    >
      <input
        type="checkbox"
        id="mouseDebugConsoleLogToggle"
        tabindex="-1"
        ${enableExtConsoleLogSetting ? 'checked' : ''}
        title="${consoleHelpAttr}"
        style="
          position: absolute;
          inset: 0;
          z-index: 2;
          width: 100%;
          height: 100%;
          margin: 0;
          padding: 0;
          opacity: 0;
          cursor: pointer;
        "
      >
      <span data-debug-console-slider="true" style="
        position: absolute;
        inset: 0;
        z-index: 1;
        pointer-events: none;
        background: ${enableExtConsoleLogSetting ? 'rgba(100, 200, 235, 0.85)' : 'rgba(100, 116, 139, 0.55)'};
        border-radius: 999px;
        transition: background 0.2s ease, box-shadow 0.2s ease;
      ">
        <span data-debug-console-knob="true" style="
          position: absolute;
          width: 18px;
          height: 18px;
          left: 3px;
          top: 3px;
          background: ${enableExtConsoleLogSetting ? '#ffffff' : '#e2e8f0'};
          border-radius: 50%;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.28);
          transform: ${enableExtConsoleLogSetting ? 'translateX(18px)' : 'translateX(0)'};
          transition: transform 0.2s ease, background 0.2s ease;
        "></span>
      </span>
    </div>
  `;
  return paramRows + consoleRow;
}

function bindDebugPanelContentControls(content) {
  if (!content) return;
  content.querySelectorAll('[data-debug-config-key]').forEach((input) => {
    applyDebugConfigInputEffects(input);
    input.addEventListener('input', onDebugGestureConfigInput);
    input.addEventListener('change', () => {
      commitDebugGestureConfigInputs(input, { immediate: true, silent: true });
    });
    input.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      adjustDebugConfigInput(input, e.deltaY > 0 ? 'down' : 'up');
    }, { passive: false });
  });

  content.querySelectorAll('[data-debug-step-dir]').forEach((btn) => {
    applyDebugStepperButtonEffects(btn);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = btn.dataset.debugStepKey;
      const input = content.querySelector(`[data-debug-config-key="${key}"]`);
      adjustDebugConfigInput(input, btn.dataset.debugStepDir);
    });
  });

  const consoleToggle = content.querySelector('#mouseDebugConsoleLogToggle');
  const consoleSwitch = content.querySelector('[data-debug-console-switch]');
  if (consoleToggle) {
    consoleToggle.checked = enableExtConsoleLogSetting;
    paintDebugConsoleToggle(consoleToggle);
    consoleToggle.addEventListener('change', () => {
      persistExtConsoleLogSetting(consoleToggle.checked);
      paintDebugConsoleToggle(consoleToggle);
      if (consoleSwitch) {
        consoleSwitch.setAttribute('aria-checked', consoleToggle.checked ? 'true' : 'false');
      }
      const native = globalThis.__MOUSE_EXT_NATIVE_CONSOLE__;
      if (native && native.log) {
        native.log('[Mouse] console log ' + (consoleToggle.checked ? 'on' : 'off'));
      }
    });
  }
  if (consoleSwitch && consoleToggle) {
    consoleSwitch.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      consoleToggle.checked = !consoleToggle.checked;
      consoleToggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    consoleSwitch.addEventListener('mouseenter', () => {
      const slider = consoleSwitch.querySelector('[data-debug-console-slider]');
      if (slider) slider.style.boxShadow = '0 0 0 2px rgba(100, 200, 235, 0.14)';
    });
    consoleSwitch.addEventListener('mouseleave', () => {
      paintDebugConsoleToggle(consoleToggle);
    });
  }

  const importInput = content.querySelector('#mouseDebugConfigImportFile');
  content.querySelectorAll('[data-debug-action]').forEach((btn) => {
    applyDebugPanelButtonEffects(btn);
    btn.addEventListener('click', () => {
      const action = btn.dataset.debugAction;
      if (action === 'export') {
        exportDebugGestureConfig(btn);
      } else if (action === 'import') {
        pendingDebugConfigImportButton = btn;
        if (importInput) importInput.click();
      } else if (action === 'reset') {
        resetDebugGestureConfig(btn);
      }
    });
  });

  if (importInput) {
    importInput.addEventListener('change', () => {
      const file = importInput.files && importInput.files[0];
      importDebugGestureConfigFile(file, { sourceButton: pendingDebugConfigImportButton });
      pendingDebugConfigImportButton = null;
      importInput.value = '';
    });
  }
}

// 更新调试面板内容
function debugSystemSettingsHtml() {
  const debugActionButtonStyle = 'border: 1px solid rgba(100, 200, 235, 0.35); background: rgba(30, 41, 59, 0.72); color: #c4e8ff; border-radius: 7px; padding: 4px 9px; min-height: 24px; font-size: 11px; line-height: 1.2; cursor: pointer; box-sizing: border-box;';
  return `
    <div id="mouseDebugSystemSettings" style="margin-bottom: 12px;">
      <div style="
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 6px;
        border-bottom: 1px dashed rgba(167, 139, 250, 0.2);
        padding-bottom: 3px;
      ">
        <div style="
          color: #a78bfa;
          font-weight: 600;
          font-size: 11px;
          letter-spacing: 0.5px;
          text-transform: uppercase;
        ">${getDebugPanelText('systemSettings')}</div>
        <div style="display: flex; gap: 6px; align-items: center; justify-content: flex-end;">
          <button type="button" data-debug-action="export" style="${debugActionButtonStyle}">${getDebugPanelText('exportConfig')}</button>
          <button type="button" data-debug-action="import" style="${debugActionButtonStyle}">${getDebugPanelText('importConfig')}</button>
          <button type="button" data-debug-action="reset" style="${debugActionButtonStyle}">${getDebugPanelText('resetConfig')}</button>
          <input type="file" id="mouseDebugConfigImportFile" accept="application/json,.json" style="display: none;">
        </div>
      </div>
      <div style="color: #94a3b8; font-size: 10px; margin-bottom: 8px;">${getDebugPanelText('debugSettingsHint')}</div>
      <div style="display: grid; grid-template-columns: minmax(0, 1fr) 118px; gap: 8px 12px; padding-inline-start: 4px; align-items: center;">
        ${debugGestureSystemSettingsRowsHtml()}
      </div>
    </div>
  `;
}

function debugGestureInfoHtml() {
  if (!(lastDebugInfo && Object.keys(lastDebugInfo).length > 0)) {
    return `<div style="color: #94a3b8; font-style: italic; text-align: center; padding: 20px 0;">${getDebugPanelText('waitingForGestureData')}</div>`;
  }

  return `
    <div style="
      color: #4cc2ff;
      margin-bottom: 6px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      border-bottom: 1px dashed rgba(76, 194, 255, 0.2);
      padding-bottom: 3px;
    ">
      <span>${getDebugPanelText('latestGestureInfo')}</span>
      <span style="color: #94a3b8; font-size: 10px; font-weight: normal;">${lastDebugInfo.timestamp}</span>
    </div>
    <div style="margin-bottom: 12px; padding-inline-start: 4px;">
      <div style="margin-bottom: 4px;">
        <span style="color: #93c5fd;">${getDebugPanelText('currentGestureStatus')}:</span>
        <span style="color: ${getDebugStatusColor(lastDebugInfo.status)}; font-weight: 600;">${getDebugStatusText(lastDebugInfo.status)}</span>
      </div>
      <div style="margin-bottom: 4px;">
        <span style="color: #93c5fd;">${getDebugPanelText('points')}:</span>
        <span style="color: #e2e8f0;">${lastDebugInfo.pointsCount}</span>
        <span style="color: #64748b;">?</span>
        <span style="color: #4ade80;">${lastDebugInfo.simplifiedPointsCount}</span>
        <span style="color: #94a3b8; font-style: italic; font-size: 11px;">(${getDebugPanelText('simplifiedAfter')})</span>
      </div>
      <div>
        <span style="color: #93c5fd;">${getDebugPanelText('totalDistance')}:</span>
        <span style="color: #e2e8f0;">${lastDebugInfo.totalDistance}px</span>
      </div>
    </div>

    <div style="margin-bottom: 12px;">
      <div style="
        color: #fbbf24;
        margin-bottom: 6px;
        font-weight: 600;
        font-size: 11px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        border-bottom: 1px dashed rgba(251, 191, 36, 0.2);
        padding-bottom: 3px;
      ">${getDebugPanelText('directionRecognition')}</div>
      <div style="margin-bottom: 8px; padding-inline-start: 4px;">
        <div style="margin-bottom: 4px;">
          <div style="color: #93c5fd;">${getDebugPanelText('originalDirections')}:</div>
          <div style="margin-inline-start: 4px;">${formatDirections(lastDebugInfo.originalDirections, getBrowserLanguage(), lastDebugInfo.directionDistances)}</div>
        </div>
        <div style="margin-bottom: 4px;">
          <span style="color: #93c5fd;">${getDebugPanelText('repetitivePatternDetected')}:</span>
          <span style="color: ${lastDebugInfo.hasRepetitivePattern ? '#4ade80' : '#94a3b8'}">
            ${lastDebugInfo.hasRepetitivePattern ? getDebugPanelText('yes') : getDebugPanelText('no')}
          </span>
        </div>
        <div>
          <span style="color: #93c5fd;">${getDebugPanelText('repetitivePatternType')}:</span>
          <span style="color: ${lastDebugInfo.repeatingPattern ? '#4ade80' : '#94a3b8'}">
            ${lastDebugInfo.repeatingPattern || getDebugPanelText('none')}
          </span>
        </div>
      </div>
    </div>

    <div style="margin-bottom: 12px;">
      <div style="
        color: #34d399;
        margin-bottom: 6px;
        font-weight: 600;
        font-size: 11px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        border-bottom: 1px dashed rgba(52, 211, 153, 0.2);
        padding-bottom: 3px;
      ">${getDebugPanelText('directionMerging')}</div>
      <div style="padding-inline-start: 4px;">
        <div style="color: #93c5fd; margin-bottom: 2px;">${getDebugPanelText('mergedDirections')}:</div>
        <div style="margin-inline-start: 4px;">${formatDirections(lastDebugInfo.mergedDirections, getBrowserLanguage(), lastDebugInfo.directionDistances)}</div>
      </div>
    </div>

    <div>
      <div style="
        color: #f472b6;
        margin-bottom: 6px;
        font-weight: 600;
        font-size: 11px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        border-bottom: 1px dashed rgba(244, 114, 182, 0.2);
        padding-bottom: 3px;
      ">${getDebugPanelText('finalResult')}</div>
      <div style="padding-inline-start: 4px;">
        <div style="margin-bottom: 4px;">
          <span style="color: #93c5fd;">${getDebugPanelText('recognizedGesture')}:</span>
          <span style="
            color: ${lastDebugInfo.finalGesture ? '#4ade80' : '#f87171'};
            font-weight: ${lastDebugInfo.finalGesture ? '600' : 'normal'};
          ">
            ${lastDebugInfo.finalGesture || getDebugPanelText('invalidGesture')}
          </span>
        </div>
        <div>
          <span style="color: #93c5fd;">${getDebugPanelText('similarity')}:</span>
          <span style="
            color: ${getColorForSimilarity(lastDebugInfo.similarity)};
            font-weight: ${lastDebugInfo.similarity > 0.9 ? '600' : 'normal'};
          ">
            ${lastDebugInfo.similarity}
          </span>
        </div>
      </div>
    </div>
  `;
}

function replaceDebugPanelHtml(target, html) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  target.replaceChildren(...Array.from(parsed.body.childNodes));
}

// 更新调试面板内容
function updateDebugPanel(options = {}) {
  try {
    if (!debugPanel) return;
    const content = debugPanel.querySelector('#mouseGestureDebugContent');
    if (!content) return;

    if (options.liveOnly) {
      const gestureInfo = content.querySelector('#mouseDebugGestureInfo');
      if (gestureInfo) {
        replaceDebugPanelHtml(gestureInfo, debugGestureInfoHtml());
        return;
      }
    }

    replaceDebugPanelHtml(content, `
      ${debugSystemSettingsHtml()}
      <div id="mouseDebugGestureInfo">${debugGestureInfoHtml()}</div>
    `);
    bindDebugPanelContentControls(content);
  } catch (e) {
    console.error('更新调试面板失败:', e.message);
  }
}

// 根据相似度值返回颜色
function getColorForSimilarity(similarity) {
  if (similarity >= 0.9) return '#4ade80'; // 绿色 - 很好
  if (similarity >= 0.8) return '#fbbf24'; // 黄色 - 一般
  if (similarity >= 0.7) return '#fb923c'; // 橙色 - 较差
  return '#f87171'; // 红色 - 很差
}

// 格式化方向数组，添加彩色显示
function formatDirections(directions, lang, distances) {
  if (!directions || directions.length === 0) {
    return `<span style="color: #94a3b8; font-style: italic;">${getDebugPanelText('none')}</span>`;
  }
  
  // 方向颜色映射
  const directionColors = {
    'left': '#60a5fa',  // 蓝色
    'right': '#f472b6', // 粉色
    'up': '#34d399',    // 绿色
    'down': '#fbbf24'   // 黄色
  };
  
  // 方向图标映射
  const directionIcons = {
    'left': '←',
    'right': '→',
    'up': '↑',
    'down': '↓'
  };
  
  // 构建方向显示
  let result = '';
  for (let i = 0; i < directions.length; i++) {
    const direction = directions[i];
    // 使用i18n获取方向名称
    const directionName = getI18nMessage(direction, direction);
    const color = directionColors[direction] || '#94a3b8';
    const icon = directionIcons[direction] || '•';
    
    // 添加方向距离信息
    const distanceInfo = distances && distances[i] ? ` <span style="color: #94a3b8; font-size: 10px;">(${distances[i]}px)</span>` : '';
    
    result += `<span style="color: ${color}; font-weight: 600;">${icon} ${directionName}${distanceInfo}</span>`;
    
    // 添加箭头分隔符，但不在最后一个方向后添加
    if (i < directions.length - 1) {
      result += ` <span style="color: #64748b;">→</span> `;
    }
  }
  
  return result;
}

// 切换调试面板显示状态
function toggleDebugPanel() {
  isDebugPanelVisible = !isDebugPanelVisible;
  
  // 保存面板显示状态到localStorage
  try {
    localStorage.setItem('mouseGestureDebugPanelVisible', isDebugPanelVisible ? 'true' : 'false');
  } catch (e) {
    console.log('保存调试面板状态错误:', e.message);
  }
  
  if (isDebugPanelVisible) {
    if (!debugPanel || !debugPanel.isConnected) {
      initDebugPanel();
    } else {
      debugPanel.style.display = 'block';
      updateDebugPanel();
    }
  } else if (debugPanel) {
    debugPanel.style.display = 'none';
  }
}

// 添加快捷键监听（截图快捷键优先；与 Alt+D 调试面板共用捕获阶段）
document.addEventListener('keydown', function(e) {
  if (handleOpenScreenshotHistoryHotkeyDown(e)) {
    return;
  }
  if (handleScreenshotHotkeyDown(e)) {
    return;
  }
  // 按下Alt+D组合键切换调试面板
  if (e.altKey && (e.key === 'd' || e.key === 'D')) {
    // 仅在启用调试面板功能时拦截；关闭时允许浏览器默认行为
    if (enableDebugPanelSetting) {
      toggleDebugPanel();
      e.preventDefault();
    }
  }
}, true);

// 手势识别算法
// 采用方向段识别，并结合轨迹平滑、简化和距离校验降低误触发。
// 处理流程：点位平滑 + Douglas-Peucker 简化 + 方向段校验。
const GESTURE_VALID_PATTERNS = new Set([
  'left', 'right', 'up', 'down',
  'down then right', 'left then up', 'right then up',
  'right then down', 'up then left', 'up then right',
  'down then left', 'left then down', 'up then down',
  'down then up', 'left then right', 'right then left'
]);

const GESTURE_DANGEROUS_ACTIONS = new Set([
  'closeTab',
  'closeAllTabs',
  'closeOtherTabs',
  'closeTabsToRight',
  'closeTabsToLeft',
  'forceRefresh',
  'reloadAllTabs',
  'stopLoadingAllTabs'
]);

function getEffectiveMinMovementToStartGesture() {
  const configured = Number(minMovementToStartGesture);
  return Math.max(0, Number.isFinite(configured) ? configured : 0);
}

function getGestureRecognitionConfig() {
  const configuredMinTotal = Number(minGestureDistance);
  const configuredSegment = Number(minDirectionSegmentLength);
  const configuredAngle = Number(angleThreshold);
  const configuredChange = Number(directionChangeThreshold);
  const effectiveMinTotal = Math.max(1, Number.isFinite(configuredMinTotal) ? configuredMinTotal : 6);
  const effectiveSegment = Math.max(1, Number.isFinite(configuredSegment) ? configuredSegment : 5);
  return {
    // 小于 1 时更偏灵敏：使用主轴方向；大于 1 时更偏严格：要求主轴优势更明显。
    angleRatio: clampNumber(Number.isFinite(configuredAngle) ? configuredAngle : 1.0, 0.2, 2.8),
    minTotalDistance: effectiveMinTotal,
    singleTotalDistance: Math.max(effectiveMinTotal, effectiveSegment),
    multiTotalDistance: Math.max(effectiveMinTotal, effectiveSegment * 2),
    segmentMin: effectiveSegment,
    microSegmentMin: Math.max(1, Math.min(6, effectiveSegment * 0.45)),
    directionChangeThreshold: clampNumber(Number.isFinite(configuredChange) ? configuredChange : 0.35, 0.05, 1),
    maxDirectionRuns: clampNumber(Number(minGestureComplexity) || 3, 1, 20),
    singleStraightnessMin: 0.62,
    turnDominanceMin: 0.55,
    turnLegRatioMin: 0.14,
    turnBalanceMin: 0.16
  };
}

function computeGestureRecognitionMetrics(points) {
  const metrics = {
    totalDistance: 0,
    endDistance: 0,
    width: 0,
    height: 0,
    diagonal: 0,
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
    pointCount: points ? points.length : 0
  };
  if (!points || points.length === 0) return metrics;
  metrics.minX = metrics.maxX = points[0].x;
  metrics.minY = metrics.maxY = points[0].y;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    metrics.totalDistance += Math.hypot(curr.x - prev.x, curr.y - prev.y);
    metrics.minX = Math.min(metrics.minX, curr.x);
    metrics.maxX = Math.max(metrics.maxX, curr.x);
    metrics.minY = Math.min(metrics.minY, curr.y);
    metrics.maxY = Math.max(metrics.maxY, curr.y);
  }
  const first = points[0];
  const last = points[points.length - 1];
  metrics.endDistance = Math.hypot(last.x - first.x, last.y - first.y);
  metrics.width = metrics.maxX - metrics.minX;
  metrics.height = metrics.maxY - metrics.minY;
  metrics.diagonal = Math.hypot(metrics.width, metrics.height);
  return metrics;
}

function getAxisDirectionForGestureSegment(dx, dy, angleRatio) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const ratio = clampNumber(Number(angleRatio) || 1, 0.2, 2.8);
  if (ax < 0.01 && ay < 0.01) return '';
  if (ax >= ay) {
    return ax >= ay * ratio ? (dx > 0 ? 'right' : 'left') : '';
  }
  if (ay >= ax * ratio) return dy > 0 ? 'down' : 'up';
  return '';
}

function areOppositeGestureDirections(a, b) {
  return (
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left') ||
    (a === 'up' && b === 'down') ||
    (a === 'down' && b === 'up')
  );
}

function pushGestureDirectionRun(runs, dir, distance, fromIndex, toIndex) {
  if (!dir || distance <= 0) return;
  const last = runs[runs.length - 1];
  if (last && last.dir === dir) {
    last.distance += distance;
    last.toIndex = toIndex;
    return;
  }
  runs.push({ dir, distance, fromIndex, toIndex });
}

function mergeAdjacentGestureRuns(runs) {
  const merged = [];
  for (const run of runs || []) {
    if (!run || !run.dir || run.distance <= 0) continue;
    pushGestureDirectionRun(merged, run.dir, run.distance, run.fromIndex, run.toIndex);
  }
  return merged;
}

function buildGestureDirectionRuns(points, cfg) {
  const directions = [];
  const directionDistances = [];
  const runs = [];
  let classifiedDistance = 0;
  let ambiguousDistance = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const distance = Math.hypot(dx, dy);
    if (distance < cfg.microSegmentMin) continue;

    const dir = getAxisDirectionForGestureSegment(dx, dy, cfg.angleRatio);
    if (!dir) {
      ambiguousDistance += distance;
      continue;
    }

    classifiedDistance += distance;
    directions.push(dir);
    directionDistances.push(Math.round(distance));
    pushGestureDirectionRun(runs, dir, distance, i - 1, i);
  }

  return {
    directions,
    directionDistances,
    runs: mergeAdjacentGestureRuns(runs),
    classifiedDistance,
    ambiguousDistance
  };
}

function filterGestureDirectionRuns(runs, totalDistance, cfg) {
  if (!runs || runs.length === 0) return [];
  const merged = mergeAdjacentGestureRuns(runs);
  const maxRunDistance = Math.max(...merged.map((run) => run.distance));
  const minKeepDistance = Math.max(
    cfg.segmentMin,
    Math.min(30, totalDistance * 0.13),
    maxRunDistance * cfg.directionChangeThreshold * 0.72
  );

  let filtered = merged.filter((run) => run.distance >= minKeepDistance);
  if (!filtered.length && maxRunDistance >= cfg.segmentMin) {
    const maxRun = merged.find((run) => run.distance === maxRunDistance);
    filtered = maxRun ? [maxRun] : [];
  }

  filtered = mergeAdjacentGestureRuns(filtered);

  // 过滤按下/松开瞬间产生的极短边缘方向段。
  if (filtered.length > 1) {
    const edgeMin = Math.max(cfg.segmentMin, totalDistance * 0.16);
    filtered = filtered.filter((run, index) => {
      const edge = index === 0 || index === filtered.length - 1;
      return !edge || run.distance >= edgeMin;
    });
    filtered = mergeAdjacentGestureRuns(filtered);
  }

  return filtered;
}

function hasAlternatingGesturePattern(directions) {
  if (!directions || directions.length < 4) return { has: false, pattern: '' };
  let alternatingPairs = 0;
  let firstPattern = '';
  for (let i = 0; i + 2 < directions.length; i++) {
    if (directions[i] === directions[i + 2] && directions[i] !== directions[i + 1]) {
      alternatingPairs++;
      if (!firstPattern) firstPattern = `${directions[i]}-${directions[i + 1]}`;
    }
  }
  return { has: alternatingPairs >= 2, pattern: firstPattern };
}

function countSignificantGestureRuns(runs, totalDistance, cfg) {
  if (!runs || !runs.length) return 0;
  const minDistance = Math.max(cfg.segmentMin, Math.min(36, totalDistance * 0.08));
  return runs.reduce((count, run) => count + (run.distance >= minDistance ? 1 : 0), 0);
}

function isDangerousGestureCandidate(gesture) {
  const action = getCustomGestureAction(gesture);
  return !!(action && GESTURE_DANGEROUS_ACTIONS.has(action));
}

function validateGestureCandidate(candidate, runs, metrics, cfg) {
  if (!candidate || !GESTURE_VALID_PATTERNS.has(candidate)) {
    return { ok: false, status: 'invalidGestureStatus', similarity: 0 };
  }

  const runDistance = runs.reduce((sum, run) => sum + run.distance, 0);
  const dominance = metrics.totalDistance > 0 ? runDistance / metrics.totalDistance : 0;
  const isDangerous = isDangerousGestureCandidate(candidate);

  if (runs.length === 1) {
    const run = runs[0];
    const straightness = metrics.totalDistance > 0 ? metrics.endDistance / metrics.totalDistance : 0;
    const requiredTotal = isDangerous ? Math.max(24, cfg.singleTotalDistance * 1.35) : cfg.singleTotalDistance;
    if (metrics.totalDistance < requiredTotal || metrics.endDistance < requiredTotal * 0.72) {
      return { ok: false, status: 'notEnoughMovement', similarity: straightness };
    }
    if (straightness < cfg.singleStraightnessMin || dominance < (isDangerous ? 0.66 : 0.64)) {
      return { ok: false, status: 'invalidGestureStatus', similarity: straightness };
    }
    if (run.distance < Math.max(cfg.segmentMin, requiredTotal * 0.68)) {
      return { ok: false, status: 'notEnoughMovement', similarity: straightness };
    }
    return { ok: true, status: 'recognizedGestureStatus', similarity: Math.min(1, straightness * 0.85 + dominance * 0.15) };
  }

  if (runs.length === 2) {
    const minLeg = Math.min(runs[0].distance, runs[1].distance);
    const maxLeg = Math.max(runs[0].distance, runs[1].distance);
    const legBalance = maxLeg > 0 ? minLeg / maxLeg : 0;
    const opposite = areOppositeGestureDirections(runs[0].dir, runs[1].dir);
    const minTotal = isDangerous ? Math.max(32, cfg.multiTotalDistance * 1.18) : cfg.multiTotalDistance;
    const minLegDistance = Math.max(
      cfg.segmentMin,
      metrics.totalDistance * cfg.turnLegRatioMin,
      opposite ? 10 : 8,
      isDangerous ? 12 : 0
    );

    if (metrics.totalDistance < minTotal || minLeg < minLegDistance) {
      return { ok: false, status: 'notEnoughMovement', similarity: legBalance };
    }
    if (dominance < (isDangerous ? 0.64 : cfg.turnDominanceMin)) {
      return { ok: false, status: 'tooComplexGesture', similarity: dominance };
    }
    if (legBalance < (isDangerous ? 0.24 : cfg.turnBalanceMin)) {
      return { ok: false, status: 'invalidGestureStatus', similarity: legBalance };
    }
    return { ok: true, status: 'recognizedGestureStatus', similarity: Math.min(1, dominance * 0.62 + legBalance * 0.38) };
  }

  return { ok: false, status: runs.length > cfg.maxDirectionRuns ? 'tooComplexGesture' : 'invalidGestureStatus', similarity: 0 };
}

function recognizeGesture() {
  if (gesturePoints.length < 2) {
    updateLiveGestureDebugInfo('notEnoughPoints', null, { immediate: true });
    return '';
  }

  const cfg = getGestureRecognitionConfig();
  const rawMetrics = computeGestureRecognitionMetrics(gesturePoints);
  if (rawMetrics.totalDistance < cfg.minTotalDistance) {
    collectDebugInfo([], gesturePoints.slice(0, 2), rawMetrics.totalDistance, false,
                    '', [], '', 0, [], 'notEnoughMovement');
    return '';
  }

  const simplifiedPoints = simplifyGesturePoints(gesturePoints);
  if (!simplifiedPoints || simplifiedPoints.length < 2) {
    collectDebugInfo([], simplifiedPoints || [], rawMetrics.totalDistance, false,
                    '', [], '', 0, [], 'notEnoughPoints');
    return '';
  }

  if (simplifiedPoints.length === 2 && simplifiedPoints[1].isScribbling) {
    collectDebugInfo([], simplifiedPoints, rawMetrics.totalDistance, true,
                    'scribbling', [], '', 0, [], 'scribblingGesture');
    return '';
  }

  const analysis = buildGestureDirectionRuns(simplifiedPoints, cfg);
  const alternating = hasAlternatingGesturePattern(analysis.directions);
  if (!analysis.directions.length || analysis.classifiedDistance < cfg.segmentMin) {
    collectDebugInfo(analysis.directions, simplifiedPoints, rawMetrics.totalDistance, alternating.has,
                    alternating.pattern, [], '', 0, analysis.directionDistances, 'noDirectionDetected');
    return '';
  }

  const filteredRuns = filterGestureDirectionRuns(analysis.runs, rawMetrics.totalDistance, cfg);
  const mergedDirections = filteredRuns.map((run) => run.dir);
  const significantRawRunCount = countSignificantGestureRuns(analysis.runs, rawMetrics.totalDistance, cfg);

  // 乱画或重复折返不再折叠成 closeTab / scrollToTop 等有效手势。
  if (
    filteredRuns.length > 2 ||
    significantRawRunCount > cfg.maxDirectionRuns ||
    (alternating.has && significantRawRunCount >= Math.max(3, cfg.maxDirectionRuns - 1))
  ) {
    collectDebugInfo(analysis.directions, simplifiedPoints, rawMetrics.totalDistance, alternating.has,
                    alternating.pattern, mergedDirections, '', 0, analysis.directionDistances, 'tooComplexGesture');
    return '';
  }

  const candidate = mergedDirections.join(' then ');
  const validation = validateGestureCandidate(candidate, filteredRuns, rawMetrics, cfg);
  if (!validation.ok) {
    collectDebugInfo(analysis.directions, simplifiedPoints, rawMetrics.totalDistance, alternating.has,
                    alternating.pattern, mergedDirections, '', validation.similarity || 0,
                    analysis.directionDistances, validation.status);
    return '';
  }

  collectDebugInfo(analysis.directions, simplifiedPoints, rawMetrics.totalDistance, alternating.has,
                  alternating.pattern, mergedDirections, candidate, validation.similarity || 1,
                  analysis.directionDistances, validation.status);
  return candidate;
}

// 手势提示
// 显示手势提示
/** 手势执行后的提示：绘制阶段已显示则跳过，避免松手时提示重播盖住滚动 */
function notifyGestureActionHint(actionText) {
  if (!settings.showGestureHint) return;
  if (!actionText) return;
  if (gestureHint && gestureHint.isConnected && lastHintAction === actionText) {
    return;
  }
  showGestureHint(actionText);
}

function clearGestureHintTimers(hint) {
  if (!hint) return;
  if (hint.fadeOutTimer) {
    clearTimeout(hint.fadeOutTimer);
    hint.fadeOutTimer = null;
  }
  if (hint.fadeRemoveTimer) {
    clearTimeout(hint.fadeRemoveTimer);
    hint.fadeRemoveTimer = null;
  }
}

function removeGestureHintElement(hint = gestureHint) {
  if (!hint) return;
  clearGestureHintTimers(hint);
  clearGestureHintContentAnimation(hint);
  try {
    if (hint.isConnected && hint.parentNode) {
      hint.parentNode.removeChild(hint);
    }
  } catch (e) {
    console.log('移除提示元素错误:', e.message);
  }
  if (gestureHint === hint) {
    gestureHint = null;
  }
}

function getGestureHintDisplayDuration(isInvalidGesture, isScrollAction) {
  if (isInvalidGesture) return 350;
  if (isScrollAction) return 1000;
  return 800;
}

function getGestureHintChild(hint, role, fallbackIndex) {
  if (!hint) return null;
  return (
    hint.querySelector(`[data-mouse-gesture-hint-role="${role}"]`) ||
    hint.children[fallbackIndex] ||
    null
  );
}

function clearGestureHintContentAnimation(hint) {
  if (!hint) return;
  if (hint.contentUpdateRaf) {
    cancelAnimationFrame(hint.contentUpdateRaf);
    hint.contentUpdateRaf = 0;
  }
  if (hint.contentUpdateRaf2) {
    cancelAnimationFrame(hint.contentUpdateRaf2);
    hint.contentUpdateRaf2 = 0;
  }
}

function applyGestureHintLayout(hint, icon, text) {
  if (!hint) return;

  // 统一用 flex/gap 和固定图标盒模型，避免不同字体/emoji 的基线差异导致看起来不居中。
  hint.style.display = 'inline-flex';
  hint.style.alignItems = 'center';
  hint.style.justifyContent = 'center';
  hint.style.gap = '6px';
  hint.style.boxSizing = 'border-box';
  hint.style.minHeight = '38px';
  hint.style.paddingBlock = '4px';
  hint.style.paddingInlineStart = '4px';
  hint.style.paddingInlineEnd = '12px';
  hint.style.lineHeight = '1';

  if (icon) {
    icon.style.display = 'inline-flex';
    icon.style.alignItems = 'center';
    icon.style.justifyContent = 'center';
    icon.style.flex = '0 0 28px';
    icon.style.width = '28px';
    icon.style.height = '28px';
    icon.style.minWidth = '28px';
    icon.style.minHeight = '28px';
    icon.style.boxSizing = 'border-box';
    icon.style.margin = '0';
    icon.style.padding = '0';
    icon.style.lineHeight = '1';
    icon.style.textAlign = 'center';
    icon.style.verticalAlign = 'middle';
    icon.style.fontFamily = '"Segoe UI Symbol", "Apple Color Emoji", "Segoe UI Emoji", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  }

  if (text) {
    text.style.display = 'inline-flex';
    text.style.alignItems = 'center';
    text.style.justifyContent = 'center';
    text.style.minHeight = '28px';
    text.style.boxSizing = 'border-box';
    text.style.margin = '0';
    text.style.padding = '0';
    text.style.lineHeight = '1.2';
    text.style.verticalAlign = 'middle';
    text.style.textAlign = 'center';
  }
}

function applyGestureHintTheme(hint, icon, text, useSimplifiedHint, isLightHint) {
  if (!hint) return;
  applyGestureHintLayout(hint, icon, text);
  if (isLightHint) {
    hint.style.backgroundColor = useSimplifiedHint ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.65)';
    hint.style.border = '1px solid rgba(0, 0, 0, 0.02)';
    hint.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.04)';
    if (text) {
      text.style.color = 'rgba(0, 0, 0, 0.85)';
      text.style.textShadow = '0 1px 2px rgba(255, 255, 255, 0.4)';
    }
    if (icon) {
      icon.style.backgroundColor = 'rgba(0, 0, 0, 0.03)';
      icon.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.08)';
    }
  } else {
    hint.style.backgroundColor = useSimplifiedHint ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.35)';
    hint.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    hint.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.15), 0 2px 6px rgba(0, 0, 0, 0.1)';
    if (text) {
      text.style.color = 'rgba(255, 255, 255, 0.95)';
      text.style.textShadow = '0 1px 3px rgba(0, 0, 0, 0.4)';
    }
    if (icon) {
      icon.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
      icon.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.06)';
    }
  }

  if (useSimplifiedHint) {
    hint.style.backdropFilter = 'none';
    hint.style.webkitBackdropFilter = 'none';
  } else {
    hint.style.backdropFilter = 'blur(8px)';
    hint.style.webkitBackdropFilter = 'blur(8px)';
  }
}

function updateReusableGestureHint(hint, options) {
  const icon = getGestureHintChild(hint, 'icon', 0);
  const text = getGestureHintChild(hint, 'text', 1);
  const shouldAnimateContent = hint.dataset.mouseGestureHintAction !== options.actionText;
  clearGestureHintContentAnimation(hint);
  applyGestureHintTheme(hint, icon, text, options.useSimplifiedHint, options.isLightHint);

  if (!shouldAnimateContent) {
    if (icon) {
      icon.textContent = options.iconText;
      icon.style.color = options.iconColor;
      icon.style.opacity = '1';
      icon.style.transform = 'scale(1)';
    }
    if (text) {
      text.textContent = options.actionText;
      text.style.opacity = '1';
      text.style.transform = 'translateY(0)';
    }
    hint.style.opacity = '1';
    hint.style.transform = 'translateX(-50%) translateY(0)';
    hint.dataset.mouseGestureHintAction = options.actionText;
    return;
  }

  if (icon) {
    icon.style.transition = 'none';
    icon.textContent = options.iconText;
    icon.style.color = options.iconColor;
    icon.style.opacity = '0';
    icon.style.transform = 'scale(0.55)';
  }
  if (text) {
    text.style.transition = 'none';
    text.textContent = options.actionText;
    text.style.opacity = '0';
    text.style.transform = 'translateY(8px)';
  }
  hint.style.opacity = '1';
  hint.style.transform = 'translateX(-50%) translateY(0)';
  hint.dataset.mouseGestureHintAction = options.actionText;

  hint.contentUpdateRaf = requestAnimationFrame(() => {
    hint.contentUpdateRaf = 0;
    if (gestureHint !== hint || !hint.isConnected) return;
    if (icon) {
      icon.style.transition = 'transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.18s ease, background-color 0.3s ease';
    }
    if (text) {
      text.style.transition = 'opacity 0.2s ease, transform 0.2s ease, color 0.3s ease';
      text.style.transitionDelay = '0.03s';
    }
    hint.contentUpdateRaf2 = requestAnimationFrame(() => {
      hint.contentUpdateRaf2 = 0;
      if (gestureHint !== hint || !hint.isConnected) return;
      if (icon) {
        icon.style.opacity = '1';
        icon.style.transform = 'scale(1)';
      }
      if (text) {
        text.style.opacity = '1';
        text.style.transform = 'translateY(0)';
      }
    });
  });
}

function scheduleGestureHintFadeOut(hint, displayDuration) {
  if (!hint) return;
  clearGestureHintTimers(hint);
  hint.fadeOutTimer = setTimeout(() => {
    hint.fadeOutTimer = null;
    if (gestureHint !== hint || !hint.isConnected) return;
    hint.style.opacity = '0';
    hint.style.transform = 'translateX(-50%) translateY(20px)';

    hint.fadeRemoveTimer = setTimeout(() => {
      hint.fadeRemoveTimer = null;
      if (gestureHint !== hint || !hint.isConnected) return;
      removeGestureHintElement(hint);
    }, 300);
  }, displayDuration);
}

function showGestureHint(action) {
  if (!settings.showGestureHint) return;
  if (typeof MouseExtUiHost === 'undefined') return;
  // iframe 内默认转发到主框架；iframe 内全屏时在本地显示（与轨迹同一文档）
  if (window !== window.top && !gestureOverlayUsesIframeDocumentFullscreen()) {
    sendCrossFrameSilent({ action: 'gestureHintFromIframe', data: { action } });
    return;
  }
  
  // 获取当前语言设置
  let currentLang = getBrowserLanguage();
  
  // 检查是否需要节流
  const currentTime = Date.now();
  if (currentTime - lastHintTime < hintThrottleDelay && action === lastHintAction) {
    return;
  }
  
  // 更新最后提示时间和动作
  lastHintTime = currentTime;
  lastHintAction = action;
  
  // 如果提示元素存在，后面直接复用它，只更新图标和文字，避免动作变化时反复弹出新提示。
  const reusableGestureHint = gestureHint && gestureHint.isConnected ? gestureHint : null;
  if (gestureHint && !gestureHint.isConnected) {
    clearGestureHintTimers(gestureHint);
    gestureHint = null;
  }
  
  // 获取动作显示文本
  let actionText = action;
  let actionKey = '';
  
  // 通过翻译键反向查找动作类型
  for (const key in getGestureTranslations()) {
    if (getGestureTranslations()[key] === action) {
      actionKey = key;
      break;
    }
  }

  // 如果找不到actionKey，可能是因为语言刚切换，尝试从其他语言翻译
  if (!actionKey) {
    for (const key in getGestureTranslations()) {
      if (getGestureTranslations()[key] === action || (getGestureTranslations().zh && getGestureTranslations().zh[key] === action)) {
        actionKey = key;
        if (getGestureTranslations()[currentLang] && getGestureTranslations()[currentLang][actionKey]) {
          actionText = getGestureTranslations()[currentLang][actionKey];
        }
        break;
      }
    }
  }
  
  // 检查是否是无效手势提示
  const isInvalidGesture = actionKey === 'invalidGesture';
  
  const isScrollAction = actionKey === 'scrollUp' || actionKey === 'scrollDown' ||
    actionKey === 'scrollLeft' || actionKey === 'scrollRight';
  
  // 映射动作到图标字符
  let iconText = '';
  let iconColor = '#ffffff';
  
  // 首先尝试通过动作键匹配
  switch (actionKey) {
    case 'back':
    case 'goBack':
      iconText = '←';
      iconColor = '#4dabf7';
      break;
    case 'forward':
      iconText = '→';
      iconColor = '#4dabf7';
      break;
    case 'scrollUp':
      iconText = '↑';
      iconColor = '#63e6be';
      break;
    case 'scrollDown':
      iconText = '↓';
      iconColor = '#63e6be';
      break;
    case 'scrollLeft':
      iconText = '←';
      iconColor = '#63e6be';
      break;
    case 'scrollRight':
      iconText = '→';
      iconColor = '#63e6be';
      break;
    case 'closeTab':
      iconText = '×';
      iconColor = '#ff6b6b';
      break;
    case 'reopenTab':
    case 'reopenClosedTab':
      iconText = '↺';
      iconColor = '#94d3a2';
      break;
    case 'newTab':
    case 'openNewTab':
      iconText = '+';
      iconColor = '#a9e34b';
      break;
    case 'refresh':
      iconText = '↻';
      iconColor = '#94d3a2';
      break;
    case 'forceRefresh':
      iconText = '↻';
      iconColor = '#ff6b6b';
      break;
    case 'prevTab':
    case 'switchToLeftTab':
      iconText = '◀';
      iconColor = '#74c0fc';
      break;
    case 'nextTab':
    case 'switchToRightTab':
      iconText = '▶';
      iconColor = '#74c0fc';
      break;
    case 'previousActiveTab':
    case 'switchToPreviousActiveTab':
      iconText = '⇄';
      iconColor = '#74c0fc';
      break;
    case 'goToParentUrl':
      iconText = '↰';
      iconColor = '#4dabf7';
      break;
    case 'goToRootUrl':
      iconText = '⌂';
      iconColor = '#4dabf7';
      break;
    case 'stopLoading':
      iconText = '⏹';
      iconColor = '#ffa94d';
      break;
    case 'closeAllTabs':
      iconText = '⊠';
      iconColor = '#ff8787';
      break;
    case 'scrollToBottom':
      iconText = '⤓';
      iconColor = '#63e6be';
      break;
    case 'scrollToTop':
      iconText = '⤒';
      iconColor = '#63e6be';
      break;
    case 'invalidGesture':
      iconText = '!';
      iconColor = '#ff6b6b';
      break;
    case 'newWindow':
      iconText = '⊞';
      iconColor = '#a9e34b';
      break;
    case 'newInPrivateWindow':
      iconText = '👁';
      iconColor = '#845ef7';
      break;
    case 'closeOtherTabs':
      iconText = '⊟';
      iconColor = '#ff8787';
      break;
    case 'closeTabsToRight':
      iconText = '⊟';
      iconColor = '#ff8787';
      break;
    case 'closeTabsToLeft':
      iconText = '⊟';
      iconColor = '#ff8787';
      break;
    case 'reloadAllTabs':
      iconText = '↻';
      iconColor = '#94d3a2';
      break;
    case 'stopLoadingAllTabs':
      iconText = '⏹';
      iconColor = '#fd7e14';
      break;
    case 'togglePinTab':
      iconText = '🔒';
      iconColor = '#94d3a2';
      break;
    case 'toggleMuteTab':
      iconText = '🔊';
      iconColor = '#94d3a2';
      break;
    case 'muteOtherTabs':
      iconText = '🔊';
      iconColor = '#ff8787';
      break;
    case 'toggleMaximize':
      iconText = '⛶';
      iconColor = '#ff8787';
      break;
    case 'minimizeWindow':
      iconText = '⛶';
      iconColor = '#ff8787';
      break;
    case 'toggleFullscreen':
      iconText = '⛶';
      iconColor = '#74c0fc';
      break;
    case 'zoomIn':
      iconText = '+';
      iconColor = '#ffd43b';
      break;
    case 'zoomOut':
      iconText = '−';
      iconColor = '#ffd43b';
      break;
    case 'scrollToLeft':
      iconText = '⇤';
      iconColor = '#63e6be';
      break;
    case 'scrollToRight':
      iconText = '⇥';
      iconColor = '#63e6be';
      break;
    default:
      iconText = '•';
      iconColor = '#ffffff';
  }

  const useSimplifiedHint = isNvidiaGpu();
  const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const pageBgColor = document.body ? window.getComputedStyle(document.body).backgroundColor : 'rgb(0, 0, 0)';
  const isLightBg = isLightBackground(pageBgColor);
  const isLightHint = isLightBg && !isDarkMode;

  if (reusableGestureHint) {
    updateReusableGestureHint(reusableGestureHint, {
      iconText,
      iconColor,
      actionText,
      useSimplifiedHint,
      isLightHint
    });
    scheduleGestureHintFadeOut(
      reusableGestureHint,
      getGestureHintDisplayDuration(isInvalidGesture, isScrollAction)
    );
    return;
  }
  
  // 创建新的提示元素
  gestureHint = createMouseExtElement('div');
  if (!gestureHint || !gestureHint.style) {
    gestureHint = null;
    return;
  }
  gestureHint.id = 'mouse-gesture-hint';
  
  // 设置基本样式
  gestureHint.style.position = 'fixed';
  gestureHint.style.left = '50%';
  gestureHint.style.bottom = '100px';
  gestureHint.style.transform = 'translateX(-50%) translateY(20px)';
  // N 卡时自动简化样式（无 backdrop-filter）以兼容 HDR/RTX VSR
  gestureHint.style.backgroundColor = useSimplifiedHint ? 'rgba(0, 0, 0, 0.7)' : 'rgba(0, 0, 0, 0.35)';
  gestureHint.style.color = 'white';
  gestureHint.style.padding = '5px 10px 5px 4px'; 
  gestureHint.style.borderRadius = '22px';
  gestureHint.style.fontSize = '13px';
  gestureHint.style.fontWeight = '500';
  gestureHint.style.zIndex = '2147483647';
  gestureHint.style.pointerEvents = 'none';
  // 优化阴影效果 - 减轻阴影
  gestureHint.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.15), 0 2px 6px rgba(0, 0, 0, 0.1)'; // 进一步减轻阴影
  // N 卡时不用 backdrop-filter，避免 HDR/RTX VSR 失效
  if (!useSimplifiedHint) {
  gestureHint.style.backdropFilter = 'blur(8px)'; // 从16px降低到8px
  gestureHint.style.webkitBackdropFilter = 'blur(8px)'; // 从16px降低到8px
  }
  // 增加边框透明度
  gestureHint.style.border = '1px solid rgba(255, 255, 255, 0.08)'; // 从0.15降低到0.08，使边框颜色更淡
  // 添加过渡效果
  gestureHint.style.transition = 'opacity 0.3s ease, transform 0.3s ease, background-color 0.3s ease, border-color 0.3s ease'; // 添加border-color过渡
  // 添加字体
  gestureHint.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  // 文字阴影加强，增强在亮背景上的可读性
  gestureHint.style.textShadow = '0 1px 3px rgba(0, 0, 0, 0.35)'; // 从0.3增加到0.35
  // 显示为弹性盒子
  gestureHint.style.display = 'flex';
  gestureHint.style.alignItems = 'center';
  gestureHint.style.justifyContent = 'flex-start';
  gestureHint.style.width = 'auto';
  gestureHint.style.height = 'auto';
  gestureHint.style.margin = '0';
  gestureHint.style.opacity = '0';
  
  // 创建图标和文本容器
  const icon = createMouseExtElement('span');
  if (!icon || !icon.style) {
    gestureHint = null;
    return;
  }
  icon.dataset.mouseGestureHintRole = 'icon';
  icon.style.marginInlineEnd = '6px';
  icon.style.fontSize = '16px';
  icon.style.display = 'inline-flex';
  icon.style.justifyContent = 'center';
  icon.style.alignItems = 'center';
  icon.style.width = '28px';
  icon.style.height = '28px';
  icon.style.borderRadius = '50%';
  icon.style.backgroundColor = 'rgba(255, 255, 255, 0.04)'; // 从0.06降低到0.04，进一步增加圆圈透明度
  icon.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.06)'; // 减轻阴影
  icon.style.transform = 'scale(0)';
  icon.style.transition = 'transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275), background-color 0.3s ease'; // 添加背景色过渡
  icon.style.textShadow = '0 1px 3px rgba(0, 0, 0, 0.3)';
  icon.style.fontWeight = 'bold';
  icon.textContent = iconText;
  icon.style.color = iconColor;
  gestureHint.appendChild(icon);
  
  const text = createMouseExtElement('span');
  if (!text || !text.style) {
    gestureHint = null;
    return;
  }
  text.dataset.mouseGestureHintRole = 'text';
  text.style.verticalAlign = 'middle';
  text.style.opacity = '0';
  text.style.transform = 'translateY(8px)';
  text.style.transition = 'opacity 0.2s ease, transform 0.2s ease, color 0.3s ease';
  text.style.transitionDelay = '0.05s';
  // 根据背景透明度调整文字颜色为更亮的白色
  text.style.color = 'rgba(255, 255, 255, 0.95)'; // 略微调暗，以适应更透明的背景
  text.style.fontSize = '13px';
  text.style.fontWeight = '500';
  text.style.display = 'inline-block';
  // 加强文字阴影
  text.style.textShadow = '0 1px 3px rgba(0, 0, 0, 0.4)'; // 从0.3增加到0.4，增强对比度
  text.style.whiteSpace = 'nowrap';
  text.style.lineHeight = '1.4';
  text.textContent = actionText;
  gestureHint.appendChild(text);
  applyGestureHintLayout(gestureHint, icon, text);

  // 如果是亮色背景，调整提示框样式
  if (isLightHint) {
    gestureHint.style.backgroundColor = useSimplifiedHint ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.65)';
    gestureHint.style.border = '1px solid rgba(0, 0, 0, 0.02)'; // 从0.04降低到0.02，进一步减淡边框颜色
    gestureHint.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.04)'; // 减轻阴影
    text.style.color = 'rgba(0, 0, 0, 0.85)';
    text.style.textShadow = '0 1px 2px rgba(255, 255, 255, 0.4)';
    // 为亮色背景调整图标圆圈样式
    icon.style.backgroundColor = 'rgba(0, 0, 0, 0.03)'; // 从0.04降低到0.03，增加透明度
    icon.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.08)'; // 减轻阴影
  }
  
  // 添加到 Shadow DOM 最顶层 hints 层（位于 modals 之上，避免被选区/链接面板遮挡）
  if (!MouseExtUiHost.appendToHintsLayer(gestureHint)) return;
  
  // 重置淡出定时器
  if (gestureHint.fadeOutTimer) {
    clearTimeout(gestureHint.fadeOutTimer);
  }
  
  // 使用requestAnimationFrame在下一帧渲染前设置不透明度，确保过渡效果生效
  requestAnimationFrame(() => {
    // 检查元素是否仍然存在于DOM中
    if (gestureHint && gestureHint.isConnected) {
      gestureHint.style.opacity = '1';
      gestureHint.style.transform = 'translateX(-50%) translateY(0)';
      
      // 等DOM更新后再添加子元素动画
      requestAnimationFrame(() => {
        // 再次检查所有元素是否仍然存在
        if (gestureHint && gestureHint.isConnected && 
            icon && text) {
          icon.style.transform = 'scale(1)';
          text.style.opacity = '1';
          text.style.transform = 'translateY(0)';
        }
      });
    }
  });
  
  scheduleGestureHintFadeOut(
    gestureHint,
    getGestureHintDisplayDuration(isInvalidGesture, isScrollAction)
  );
}

/** 截图时隐藏的 Shadow 层（保留 screenshot 层，供手动滚动提示条显示） */
const SCREENSHOT_OVERLAY_HIDE_LAYERS = [
  'gesture',
  'compass',
  'notifications',
  'panels',
  'modals',
  'pins',
  'hints',
  'preview'
];
let screenshotOverlayHideDepth = 0;
let screenshotOverlaySaved = null;

function collectScreenshotOverlayElements(doc) {
  const list = [];
  const seen = new Set();
  const push = (el) => {
    if (!el || !el.isConnected || seen.has(el)) return;
    seen.add(el);
    list.push({
      el,
      display: el.style.display,
      visibility: el.style.visibility
    });
  };
  if (doc === document && typeof MouseExtUiHost !== 'undefined') {
    MouseExtUiHost.ensureHost();
    for (let i = 0; i < SCREENSHOT_OVERLAY_HIDE_LAYERS.length; i++) {
      push(MouseExtUiHost.getLayer(SCREENSHOT_OVERLAY_HIDE_LAYERS[i]));
    }
  } else if (doc === document) {
    push(doc.getElementById('mouse-ext-ui-host'));
  }
  return list;
}

function hideExtensionOverlaysForScreenshot() {
  screenshotOverlayHideDepth += 1;
  if (screenshotOverlayHideDepth > 1) return;
  screenshotOverlaySaved = collectScreenshotOverlayElements(document);
  for (let i = 0; i < screenshotOverlaySaved.length; i++) {
    screenshotOverlaySaved[i].el.style.visibility = 'hidden';
  }
}

function restoreExtensionOverlaysAfterScreenshot() {
  if (screenshotOverlayHideDepth <= 0) return;
  screenshotOverlayHideDepth -= 1;
  if (screenshotOverlayHideDepth > 0) return;
  const saved = screenshotOverlaySaved || [];
  for (let i = 0; i < saved.length; i++) {
    const item = saved[i];
    if (item.el && item.el.isConnected) {
      item.el.style.display = item.display || '';
      item.el.style.visibility = item.visibility || '';
    }
  }
  screenshotOverlaySaved = null;
}

// 截图 overlay 由 screenshot.js 经 background 转发，避免 DOM 事件被页面脚本伪造
function isLightBackground(color) {
  try {
    // 如果颜色是rgba格式
    if (color.startsWith('rgba')) {
      const parts = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)/);
      if (parts) {
        const r = parseInt(parts[1], 10);
        const g = parseInt(parts[2], 10);
        const b = parseInt(parts[3], 10);
        // 计算亮度 (HSP式)
        const brightness = Math.sqrt(0.299 * r * r + 0.587 * g * g + 0.114 * b * b);
        return brightness > 127.5; // 如果亮度大于127.5认为是亮色背景
      }
    } 
    // 如果颜色是rgb格式
    else if (color.startsWith('rgb')) {
      const parts = color.match(/rgb?\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (parts) {
        const r = parseInt(parts[1], 10);
        const g = parseInt(parts[2], 10);
        const b = parseInt(parts[3], 10);
        // 计算亮度 (HSP式)
        const brightness = Math.sqrt(0.299 * r * r + 0.587 * g * g + 0.114 * b * b);
        return brightness > 127.5; // 如果亮度大于127.5认为是亮色背景
      }
    }
    // 默认假设是暗色背景
    return false;
  } catch (e) {
    console.error(getI18nMessage('errorDetectBackgroundColor'), e.message);
    return false; // 出错时默认使用暗色主题
  }
}

// 执行自定义手势动作
function isGestureNavigableHttpUrl(href) {
  try {
    const u = new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function getGestureNavigationHref() {
  try {
    if (window.top && window.top.location && window.top.location.href) {
      return window.top.location.href;
    }
  } catch (e) { /* cross-origin iframe */ }
  return window.location.href;
}

function computeParentPageUrl(href) {
  if (!isGestureNavigableHttpUrl(href)) return null;
  try {
    const u = new URL(href);
    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    segments.pop();
    u.pathname = segments.length ? '/' + segments.join('/') + '/' : '/';
    u.search = '';
    u.hash = '';
    return u.href;
  } catch (e) {
    return null;
  }
}

function computeRootPageUrl(href) {
  if (!isGestureNavigableHttpUrl(href)) return null;
  try {
    const u = new URL(href);
    if (u.pathname === '/' && !u.search && !u.hash) return null;
    u.pathname = '/';
    u.search = '';
    u.hash = '';
    return u.href;
  } catch (e) {
    return null;
  }
}

// 获取自定义手势动作
const GESTURE_TO_SETTING_KEY = {
  'left': 'gestureLeftAction',
  'right': 'gestureRightAction',
  'up': 'gestureUpAction',
  'down': 'gestureDownAction',
  'down then right': 'gestureDownThenRightAction',
  'left then up': 'gestureLeftThenUpAction',
  'right then up': 'gestureRightThenUpAction',
  'right then down': 'gestureRightThenDownAction',
  'up then left': 'gestureUpThenLeftAction',
  'up then right': 'gestureUpThenRightAction',
  'down then left': 'gestureDownThenLeftAction',
  'left then down': 'gestureLeftThenDownAction',
  'up then down': 'gestureUpThenDownAction',
  'down then up': 'gestureDownThenUpAction',
  'left then right': 'gestureLeftThenRightAction',
  'right then left': 'gestureRightThenLeftAction'
};

function getCustomGestureAction(gesture) {
  const settingKey = GESTURE_TO_SETTING_KEY[gesture];
  if (!settingKey) return null;
  
  // 从设置中获取自定义动作
  return settings[settingKey] || null;
}

function isScreenshotTrailCaptureEnabled() {
  return !!(
    settings &&
    settings.enableScreenshotFeature &&
    settings.enableScreenshotTrailCapture &&
    !isSiteInDisabledList(window.location.href)
  );
}

function syncScreenshotPreviewChecker() {
  if (typeof window === 'undefined' || !window.MouseScreenshot) return;
  const MS = window.MouseScreenshot;
  if (typeof MS.setScreenshotPreviewChecker !== 'function') return;
  MS.setScreenshotPreviewChecker(
    () =>
      !!(
        settings &&
        settings.enableScreenshotFeature &&
        settings.enableScreenshotPreview !== false
      )
  );
}

function syncScreenshotClipboardChecker() {
  if (typeof window === 'undefined' || !window.MouseScreenshot) return;
  const MS = window.MouseScreenshot;
  if (typeof MS.setScreenshotClipboardChecker !== 'function') return;
  MS.setScreenshotClipboardChecker(
    () =>
      !!(
        settings &&
        settings.enableScreenshotFeature &&
        settings.enableScreenshotClipboard !== false
      )
  );
}

function syncScreenshotHistoryChecker() {
  if (typeof window === 'undefined' || !window.MouseScreenshot) return;
  const MS = window.MouseScreenshot;
  if (typeof MS.setScreenshotHistoryChecker !== 'function') return;
  MS.setScreenshotHistoryChecker(
    () =>
      !!(
        settings &&
        settings.enableScreenshotFeature &&
        settings.enableScreenshotHistory !== false
      )
  );
}

function syncScreenshotCheckers() {
  syncScreenshotPreviewChecker();
  syncScreenshotClipboardChecker();
  syncScreenshotHistoryChecker();
}

function showScreenshotSuccessHint() {
  if (!settings || !settings.enableScreenshotFeature) return;
  if (settings.enableScreenshotClipboard === true) {
    showGestureHint(getI18nMessage('screenshotCopied', 'Screenshot copied to clipboard'));
    return;
  }
  /* 已开启预览时由预览窗口反馈，不再显示「截图完成」避免误以为未打开预览 */
  if (settings.enableScreenshotPreview !== false) return;
  showGestureHint(getI18nMessage('screenshotDone', 'Screenshot ready'));
}

function shouldIgnoreScreenshotHotkeyTarget(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  try {
    if (el.closest && el.closest('[contenteditable="true"]')) return true;
    if (typeof el.isContentEditable === 'boolean' && el.isContentEditable) return true;
  } catch (err) { /* ignore */ }
  return false;
}

function isScreenshotFunctionKeyCode(code) {
  return /^f([1-9]|1[0-2])$/.test(String(code || '').toLowerCase());
}

function isScreenshotModifierKeyCode(code) {
  return /^(alt|control|ctrl|shift|meta|os)(left|right)?$/i.test(String(code || '').toLowerCase());
}

function isScreenshotLetterDigitKeyCode(code) {
  const t = String(code || '').toLowerCase();
  return /^key[a-z]$/.test(t) || /^digit\d$/.test(t);
}

function normalizeScreenshotHotkeyCodeToken(token) {
  const t = String(token || '').toLowerCase();
  if (/^key[a-z]$/.test(t) || /^digit\d$/.test(t) || isScreenshotFunctionKeyCode(t)) return t;
  if (/^[a-z]$/.test(t)) return 'key' + t;
  if (/^\d$/.test(t)) return 'digit' + t;
  return t;
}

let cachedScreenshotHotkeyBindings = null;
let cachedScreenshotHistoryHotkeySpec = null;

function invalidateScreenshotHotkeyCache() {
  cachedScreenshotHotkeyBindings = null;
  cachedScreenshotHistoryHotkeySpec = null;
  if (!settings) return;
  cachedScreenshotHistoryHotkeySpec = parseScreenshotHotkeyStorage(settings.screenshotHotkeyOpenHistory);
  const pairs = [
    [settings.screenshotHotkeyRegion, 'regionPick'],
    [settings.screenshotHotkeyViewport, 'viewport'],
    [settings.screenshotHotkeyFullPage, 'fullPage'],
    [settings.screenshotHotkeyScrolling, 'scrolling']
  ];
  const bindings = [];
  for (let i = 0; i < pairs.length; i++) {
    const spec = parseScreenshotHotkeyStorage(pairs[i][0]);
    if (spec) bindings.push({ spec, mode: pairs[i][1] });
  }
  bindings.sort((a, b) => (b.spec.fnKeyOnly ? 1 : 0) - (a.spec.fnKeyOnly ? 1 : 0));
  cachedScreenshotHotkeyBindings = bindings;
}

function parseScreenshotHotkeyStorage(s) {
  if (s == null) return null;
  const str = String(s).trim();
  if (!str) return null;
  const segs = str.toLowerCase().split('+').map((x) => x.trim()).filter(Boolean);
  if (segs.length < 1) return null;
  if (segs.length === 1) {
    const code = normalizeScreenshotHotkeyCodeToken(segs[0]);
    if (!isScreenshotFunctionKeyCode(code)) return null;
    return { ctrl: false, alt: false, shift: false, meta: false, code, fnKeyOnly: true };
  }
  const code = normalizeScreenshotHotkeyCodeToken(segs[segs.length - 1]);
  if (isScreenshotModifierKeyCode(code)) return null;
  if (!isScreenshotFunctionKeyCode(code) && !isScreenshotLetterDigitKeyCode(code)) return null;
  const hasCtrl = segs.includes('ctrl') || segs.includes('control');
  const hasAlt = segs.includes('alt');
  const hasShift = segs.includes('shift');
  const hasMeta = segs.includes('meta');
  if (isScreenshotLetterDigitKeyCode(code) && !hasCtrl && !hasAlt && !hasMeta) {
    return null;
  }
  return {
    ctrl: hasCtrl,
    alt: hasAlt,
    shift: hasShift,
    meta: hasMeta,
    code,
    fnKeyOnly:
      isScreenshotFunctionKeyCode(code) && !hasCtrl && !hasAlt && !hasShift && !hasMeta
  };
}

function eventMatchesScreenshotHotkey(e, spec) {
  if (!spec || !e) return false;
  if (e.repeat) return false;
  const got = (e.code || '').toLowerCase();
  if (got !== spec.code) return false;
  if (!!e.ctrlKey !== !!spec.ctrl) return false;
  if (!!e.altKey !== !!spec.alt) return false;
  if (!!e.shiftKey !== !!spec.shift) return false;
  if (!!e.metaKey !== !!spec.meta) return false;
  return true;
}

const SCREENSHOT_HOTKEY_RELAY_MODES = new Set(['regionPick', 'viewport', 'fullPage', 'scrolling']);

function consumeScreenshotHotkeyEvent(e) {
  if (!e) return;
  e.preventDefault();
  e.stopPropagation();
  if (typeof e.stopImmediatePropagation === 'function') {
    e.stopImmediatePropagation();
  }
}

function relayScreenshotHotkeyToMainFrame(mode) {
  if (!SCREENSHOT_HOTKEY_RELAY_MODES.has(mode)) {
    return;
  }
  safeSendMessage({ action: 'runScreenshotHotkeyInMainFrame', mode }).catch(() => {});
}

/** 打开截图历史窗口快捷键（需启用截图，与区块热键一致） */
function handleOpenScreenshotHistoryHotkeyDown(e) {
  if (!e.isTrusted) return false;
  if (!isExtensionValid || !settings || !settings.enableScreenshotFeature) return false;
  if (isSiteInDisabledList(window.location.href)) return false;
  if (shouldIgnoreScreenshotHotkeyTarget(e.target)) return false;
  const spec = cachedScreenshotHistoryHotkeySpec != null
    ? cachedScreenshotHistoryHotkeySpec
    : parseScreenshotHotkeyStorage(settings.screenshotHotkeyOpenHistory);
  if (!spec || !eventMatchesScreenshotHotkey(e, spec)) return false;
  consumeScreenshotHotkeyEvent(e);
  try {
    chrome.runtime.sendMessage({ action: 'openScreenshotHistory' }, () => {});
  } catch (err) {
    /* ignore */
  }
  return true;
}

/** 与 popup 存储格式一致；单独 F1–F12 优先匹配并拦截浏览器默认行为 */
function handleScreenshotHotkeyDown(e) {
  if (!e.isTrusted) return false;
  if (!isExtensionValid || !settings || !settings.enableScreenshotFeature) return false;
  if (isSiteInDisabledList(window.location.href)) return false;
  const isTopFrame = window === window.top;
  const MS = typeof window !== 'undefined' ? window.MouseScreenshot : null;
  if (isTopFrame && !MS) return false;
  if (isTopFrame) {
    if (
      typeof MS.isRegionPickerCaptureActive === 'function' &&
      MS.isRegionPickerCaptureActive()
    ) {
      return false;
    }
  }
  if (shouldIgnoreScreenshotHotkeyTarget(e.target)) return false;
  let bindings = cachedScreenshotHotkeyBindings;
  if (!bindings) {
    const pairs = [
      [settings.screenshotHotkeyRegion, 'regionPick'],
      [settings.screenshotHotkeyViewport, 'viewport'],
      [settings.screenshotHotkeyFullPage, 'fullPage'],
      [settings.screenshotHotkeyScrolling, 'scrolling']
    ];
    bindings = [];
    for (let i = 0; i < pairs.length; i++) {
      const spec = parseScreenshotHotkeyStorage(pairs[i][0]);
      if (spec) bindings.push({ spec, mode: pairs[i][1] });
    }
    bindings.sort((a, b) => (b.spec.fnKeyOnly ? 1 : 0) - (a.spec.fnKeyOnly ? 1 : 0));
    cachedScreenshotHotkeyBindings = bindings;
  }
  for (let i = 0; i < bindings.length; i++) {
    const { spec, mode } = bindings[i];
    if (eventMatchesScreenshotHotkey(e, spec)) {
      consumeScreenshotHotkeyEvent(e);
      if (!isTopFrame) {
        relayScreenshotHotkeyToMainFrame(mode);
        return true;
      }
      const noopReset = () => {};
      runScreenshotByMode(mode, noopReset);
      return true;
    }
  }
  return false;
}

function runScreenshotByMode(mode, resetGestureAfterAction, regionPointsSnapshot) {
  if (isSiteInDisabledList(window.location.href)) {
    if (typeof resetGestureAfterAction === 'function') resetGestureAfterAction();
    return;
  }
  const MS = typeof window !== 'undefined' ? window.MouseScreenshot : null;
  if (MS && typeof MS.prefetchCaptureLease === 'function') {
    MS.prefetchCaptureLease();
  }
  if (mode === 'regionPick') {
    if (!MS || !MS.startRegionPickerCapture) {
      showGestureHint(getI18nMessage('screenshotUnavailable', 'Screenshot unavailable'));
      resetGestureAfterAction();
      return;
    }
    (async () => {
      try {
        const pickResult = await MS.startRegionPickerCapture({
          getMessage: (key) => getI18nMessage(key, key)
        });
        const pts = pickResult && pickResult.points;
        completeRegionPickGesture(pts, resetGestureAfterAction);
      } catch (e) {
        if (e && e.message === 'cancelled') return;
        if (e && e.message === 'already_active') return;
        showGestureHint(getI18nMessage('screenshotFailed', 'Screenshot failed'));
        resetGestureAfterAction();
      }
    })();
    return;
  }
  if (mode === 'region') {
    const pts =
      regionPointsSnapshot && regionPointsSnapshot.length >= 2
        ? regionPointsSnapshot
        : getGestureTrailViewportPointsForScreenshot();
    completeRegionScreenshotWithPoints(pts, resetGestureAfterAction, {
      useTrailPadForLinks: true,
      captureTrailPad: trailRegionPadFromSettings()
    });
    return;
  }
  if (mode === 'viewport') {
    if (!MS) {
      showGestureHint(getI18nMessage('screenshotUnavailable', 'Screenshot unavailable'));
      resetGestureAfterAction();
      return;
    }
    (async () => {
      try {
        await MS.captureViewportToClipboard();
        showScreenshotSuccessHint();
      } catch (e) {
        showGestureHint(getI18nMessage('screenshotFailed', 'Screenshot failed'));
      }
      resetGestureAfterAction();
    })();
    return;
  }
  if (mode === 'scrolling') {
    if (!MS) {
      showGestureHint(getI18nMessage('screenshotUnavailable', 'Screenshot unavailable'));
      resetGestureAfterAction();
      return;
    }
    (async () => {
      const showScrollCopied = () => showScreenshotSuccessHint();
      const showScrollFailed = () =>
        showGestureHint(getI18nMessage('screenshotFailed', 'Screenshot failed'));
      try {
        if (MS.isManualScrollCaptureActive && MS.isManualScrollCaptureActive()) {
          await MS.finishManualScrollCapture();
        } else if (MS.startManualScrollCapture) {
          await MS.startManualScrollCapture({
            getMessage: (key) => getI18nMessage(key, key),
            onComplete: (err) => {
              if (err) showScrollFailed();
              else showScrollCopied();
            }
          });
        } else {
          throw new Error('scroll_capture_unavailable');
        }
      } catch (e) {
        if (MS.cancelManualScrollCapture) await MS.cancelManualScrollCapture().catch(() => {});
        showScrollFailed();
      }
      resetGestureAfterAction();
    })();
    return;
  }
  if (mode === 'fullPage') {
    if (!MS) {
      showGestureHint(getI18nMessage('screenshotUnavailable', 'Screenshot unavailable'));
      resetGestureAfterAction();
      return;
    }
    (async () => {
      try {
        await MS.captureFullPageToClipboard();
        showScreenshotSuccessHint();
      } catch (e) {
        showGestureHint(getI18nMessage('screenshotFailed', 'Screenshot failed'));
      }
      resetGestureAfterAction();
    })();
  }
}

function executeGestureAction(gesture) {
  if (!isExtensionValid) return null;

  const customAction = getCustomGestureAction(gesture);
  if (!customAction || customAction === 'noAction') {
    return customAction || null;
  }
  const isScrollAction = isGestureScrollAction(customAction);

  const onGestureActionDone = () => {
    isGestureInProgress = false;
    lastGestureEndTime = Date.now();
    const isYouTube = window.location.hostname.includes('youtube.com');
    if (isYouTube) {
      isRightMouseDown = false;
    }
    if (isScrollAction) {
      resetGestureAfterScrollAction();
    } else {
      resetGestureAfterAction(true);
    }
  };

  executeCustomGestureAction(customAction, gesture, onGestureActionDone);
  return customAction;
}

/** 手势 pointerup 收尾：识别并执行动作（含轨迹截图） */
function finalizeActiveGestureRecognition() {
  if (!settings || !settings.enableGesture) return;
  if (!isGestureInProgress && gesturePoints.length < 2) return;

  isGestureInProgress = false;
  if (!lastGestureEndTime) {
    lastGestureEndTime = Date.now();
  }
  cachedGestureState.gestureActive = false;
  cachedGestureState.lastGestureEndTime = lastGestureEndTime;
  syncGestureStateToStorage(false, lastGestureEndTime);

  const resetAfterTrailShot = () => {
    resetGestureAfterAction(true);
  };

  const finalGesture = recognizeGesture();
  const trailIntersectShot = shouldTriggerTrailRegionScreenshot(gesturePoints, finalGesture, { force: true });

  if (trailIntersectShot) {
    clearGestureCanvas();
    completeTrailRegionGesture(resetAfterTrailShot);
    return;
  }

  if (finalGesture) {
    const action = executeGestureAction(finalGesture);
    if (!isGestureScrollAction(action)) {
      clearGestureCanvas();
      resetGestureState();
    }
  } else {
    clearGestureCanvas();
    resetGestureState();
  }
}

// 执行自定义手势动作
function executeCustomGestureAction(action, gesture, resetGestureAfterAction) {
  switch (action) {
    case 'scrollUp': {
      if (window !== window.top) {
        if (shouldScrollIframeLocally('y', -1)) {
          scrollPageByAxis('y', -1);
          notifyGestureActionHint(getGestureTranslations().scrollUp);
          resetGestureAfterAction(true);
        } else {
          const scrollDistance = getGesturePageScrollDistance('y');
          notifyGestureActionHint(getGestureTranslations().scrollUp);
          deferResetAfterBackgroundAction(
            { action: 'scrollUp', distance: scrollDistance },
            resetGestureAfterAction,
            true
          );
        }
        break;
      }
      scrollPageByAxis('y', -1);
      notifyGestureActionHint(getGestureTranslations().scrollUp);
      resetGestureAfterAction(true);
      break;
    }
    case 'scrollDown': {
      if (window !== window.top) {
        if (shouldScrollIframeLocally('y', 1)) {
          scrollPageByAxis('y', 1);
          notifyGestureActionHint(getGestureTranslations().scrollDown);
          resetGestureAfterAction(true);
        } else {
          const scrollDistance = getGesturePageScrollDistance('y');
          notifyGestureActionHint(getGestureTranslations().scrollDown);
          deferResetAfterBackgroundAction(
            { action: 'scrollDown', distance: scrollDistance },
            resetGestureAfterAction,
            true
          );
        }
        break;
      }
      scrollPageByAxis('y', 1);
      notifyGestureActionHint(getGestureTranslations().scrollDown);
      resetGestureAfterAction(true);
      break;
    }
    case 'scrollToTop': {
      if (window !== window.top) {
        if (shouldScrollIframeLocally('y', -1)) {
          scrollToExtremity('y', true);
          notifyGestureActionHint(getGestureTranslations().scrollToTop);
          resetGestureAfterAction(true);
        } else {
          notifyGestureActionHint(getGestureTranslations().scrollToTop);
          deferResetAfterBackgroundAction({ action: 'scrollToTop' }, resetGestureAfterAction, true);
        }
        break;
      }
      scrollToExtremity('y', true);
      notifyGestureActionHint(getGestureTranslations().scrollToTop);
      resetGestureAfterAction(true);
      break;
    }
    case 'scrollToBottom': {
      if (window !== window.top) {
        if (shouldScrollIframeLocally('y', 1)) {
          scrollToExtremity('y', false);
          notifyGestureActionHint(getGestureTranslations().scrollToBottom);
          resetGestureAfterAction(true);
        } else {
          notifyGestureActionHint(getGestureTranslations().scrollToBottom);
          deferResetAfterBackgroundAction({ action: 'scrollToBottom' }, resetGestureAfterAction, true);
        }
        break;
      }
      scrollToExtremity('y', false);
      notifyGestureActionHint(getGestureTranslations().scrollToBottom);
      resetGestureAfterAction(true);
      break;
    }
    case 'newWindow':
      notifyGestureActionHint(getGestureTranslations().newWindow);
      deferResetAfterBackgroundAction({ action: 'newWindow' }, resetGestureAfterAction);
      break;
    case 'newInPrivateWindow':
      notifyGestureActionHint(getGestureTranslations().newInPrivateWindow);
      deferResetAfterBackgroundAction({ action: 'newInPrivateWindow' }, resetGestureAfterAction);
      break;
    case 'goBack':
      notifyGestureActionHint(getGestureTranslations().back);
      deferResetAfterBackgroundAction({ action: 'goBack' }, resetGestureAfterAction);
      break;
    case 'forward':
      notifyGestureActionHint(getGestureTranslations().forward);
      deferResetAfterBackgroundAction({ action: 'goForward' }, resetGestureAfterAction);
      break;
    case 'scrollLeft': {
      if (window !== window.top) {
        if (shouldScrollIframeLocally('x', -1)) {
          scrollPageByAxis('x', -1);
          notifyGestureActionHint(getGestureTranslations().scrollLeft);
          resetGestureAfterAction(true);
        } else {
          const scrollDistance = getGesturePageScrollDistance('x');
          notifyGestureActionHint(getGestureTranslations().scrollLeft);
          deferResetAfterBackgroundAction(
            { action: 'scrollLeft', distance: scrollDistance },
            resetGestureAfterAction,
            true
          );
        }
        break;
      }
      scrollPageByAxis('x', -1);
      notifyGestureActionHint(getGestureTranslations().scrollLeft);
      resetGestureAfterAction(true);
      break;
    }
    case 'scrollRight': {
      if (window !== window.top) {
        if (shouldScrollIframeLocally('x', 1)) {
          scrollPageByAxis('x', 1);
          notifyGestureActionHint(getGestureTranslations().scrollRight);
          resetGestureAfterAction(true);
        } else {
          const scrollDistance = getGesturePageScrollDistance('x');
          notifyGestureActionHint(getGestureTranslations().scrollRight);
          deferResetAfterBackgroundAction(
            { action: 'scrollRight', distance: scrollDistance },
            resetGestureAfterAction,
            true
          );
        }
        break;
      }
      scrollPageByAxis('x', 1);
      notifyGestureActionHint(getGestureTranslations().scrollRight);
      resetGestureAfterAction(true);
      break;
    }
    case 'forceRefresh':
      notifyGestureActionHint(getGestureTranslations().forceRefresh);
      deferResetAfterBackgroundAction({ action: 'forceRefresh' }, resetGestureAfterAction);
      break;
    case 'closeTab':
      notifyGestureActionHint(getGestureTranslations().closeTab);
      deferResetAfterBackgroundAction({ action: 'closeTab' }, resetGestureAfterAction);
      break;
    case 'reopenClosedTab':
      notifyGestureActionHint(getGestureTranslations().reopenTab);
      deferResetAfterBackgroundAction({ action: 'reopenClosedTab' }, resetGestureAfterAction);
      break;
    case 'openNewTab':
      notifyGestureActionHint(getGestureTranslations().newTab);
      deferResetAfterBackgroundAction({ action: 'openNewTab' }, resetGestureAfterAction);
      break;
    case 'refresh':
      notifyGestureActionHint(getGestureTranslations().refresh);
      deferResetAfterBackgroundAction({ action: 'refresh' }, resetGestureAfterAction);
      break;
    case 'switchToLeftTab':
      notifyGestureActionHint(getGestureTranslations().prevTab);
      deferResetAfterBackgroundAction({ action: 'switchToLeftTab' }, resetGestureAfterAction);
      break;
    case 'switchToRightTab':
      notifyGestureActionHint(getGestureTranslations().nextTab);
      deferResetAfterBackgroundAction({ action: 'switchToRightTab' }, resetGestureAfterAction);
      break;
    case 'switchToPreviousActiveTab':
      notifyGestureActionHint(getGestureTranslations().previousActiveTab);
      deferResetAfterBackgroundAction({ action: 'switchToPreviousActiveTab' }, resetGestureAfterAction);
      break;
    case 'goToParentUrl': {
      const parentUrl = computeParentPageUrl(getGestureNavigationHref());
      if (parentUrl) {
        notifyGestureActionHint(getGestureTranslations().goToParentUrl);
        deferResetAfterBackgroundAction({ action: 'goToParentUrl', url: parentUrl }, resetGestureAfterAction);
      } else {
        resetGestureAfterAction(true);
      }
      break;
    }
    case 'goToRootUrl': {
      const rootUrl = computeRootPageUrl(getGestureNavigationHref());
      if (rootUrl) {
        notifyGestureActionHint(getGestureTranslations().goToRootUrl);
        deferResetAfterBackgroundAction({ action: 'goToRootUrl', url: rootUrl }, resetGestureAfterAction);
      } else {
        resetGestureAfterAction(true);
      }
      break;
    }
    case 'stopLoading':
      notifyGestureActionHint(getGestureTranslations().stopLoading);
      deferResetAfterBackgroundAction({ action: 'stopLoading' }, resetGestureAfterAction);
      break;
    case 'closeAllTabs':
      notifyGestureActionHint(getGestureTranslations().closeAllTabs);
      deferResetAfterBackgroundAction({ action: 'closeAllTabs' }, resetGestureAfterAction);
      break;
    case 'closeOtherTabs':
      notifyGestureActionHint(getGestureTranslations().closeOtherTabs);
      deferResetAfterBackgroundAction({ action: 'closeOtherTabs' }, resetGestureAfterAction);
      break;
    case 'closeTabsToRight':
      notifyGestureActionHint(getGestureTranslations().closeTabsToRight);
      deferResetAfterBackgroundAction({ action: 'closeTabsToRight' }, resetGestureAfterAction);
      break;
    case 'toggleFullscreen':
      notifyGestureActionHint(getGestureTranslations().toggleFullscreen);
      deferResetAfterBackgroundAction({ action: 'toggleFullscreen' }, resetGestureAfterAction);
      break;
    case 'closeTabsToLeft':
      notifyGestureActionHint(getGestureTranslations().closeTabsToLeft);
      deferResetAfterBackgroundAction({ action: 'closeTabsToLeft' }, resetGestureAfterAction);
      break;
    case 'reloadAllTabs':
      notifyGestureActionHint(getGestureTranslations().reloadAllTabs);
      deferResetAfterBackgroundAction({ action: 'reloadAllTabs' }, resetGestureAfterAction);
      break;
    case 'stopLoadingAllTabs':
      notifyGestureActionHint(getGestureTranslations().stopLoadingAllTabs);
      deferResetAfterBackgroundAction({ action: 'stopLoadingAllTabs' }, resetGestureAfterAction);
      break;
    case 'togglePinTab':
      notifyGestureActionHint(getGestureTranslations().togglePinTab);
      deferResetAfterBackgroundAction({ action: 'togglePinTab' }, resetGestureAfterAction);
      break;
    case 'toggleMuteTab':
      notifyGestureActionHint(getGestureTranslations().toggleMuteTab);
      deferResetAfterBackgroundAction({ action: 'toggleMuteTab' }, resetGestureAfterAction);
      break;
    case 'muteOtherTabs':
      notifyGestureActionHint(getGestureTranslations().muteOtherTabs);
      deferResetAfterBackgroundAction({ action: 'muteOtherTabs' }, resetGestureAfterAction);
      break;
    case 'toggleMaximize':
      notifyGestureActionHint(getGestureTranslations().toggleMaximize);
      deferResetAfterBackgroundAction({ action: 'toggleMaximize' }, resetGestureAfterAction);
      break;
    case 'minimizeWindow':
      notifyGestureActionHint(getGestureTranslations().minimizeWindow);
      deferResetAfterBackgroundAction({ action: 'minimizeWindow' }, resetGestureAfterAction);
      break;
    case 'zoomIn':
      notifyGestureActionHint(getGestureTranslations().zoomIn);
      deferResetAfterBackgroundAction({ action: 'zoomIn' }, resetGestureAfterAction);
      break;
    case 'zoomOut':
      notifyGestureActionHint(getGestureTranslations().zoomOut);
      deferResetAfterBackgroundAction({ action: 'zoomOut' }, resetGestureAfterAction);
      break;
    case 'scrollToLeft': {
      if (window !== window.top) {
        notifyGestureActionHint(getGestureTranslations().scrollToLeft);
        deferResetAfterBackgroundAction({ action: 'scrollToLeft' }, resetGestureAfterAction, true);
      } else {
        scrollToExtremity('x', true);
        notifyGestureActionHint(getGestureTranslations().scrollToLeft);
        resetGestureAfterAction(true);
      }
      break;
    }
    case 'scrollToRight': {
      if (window !== window.top) {
        notifyGestureActionHint(getGestureTranslations().scrollToRight);
        deferResetAfterBackgroundAction({ action: 'scrollToRight' }, resetGestureAfterAction, true);
      } else {
        scrollToExtremity('x', false);
        notifyGestureActionHint(getGestureTranslations().scrollToRight);
        resetGestureAfterAction(true);
      }
      break;
    }
    default:
      resetGestureAfterAction(true);
      break;
  }
}

// 使用 Pointer Events，支持 getCoalescedEvents 与 setPointerCapture
// 鼠标/触控按下事件处理（pointerdown 统一处理）
function handlePointerDown(e) {
  try {
    if (!isTrustedUserEvent(e)) return;
    // 仅处理鼠标类型，避免触控板误触
    if (e.pointerType && e.pointerType !== 'mouse') return;
    
    mouseDownPosition = { x: e.clientX, y: e.clientY };
    mouseCurrentPosition = { x: e.clientX, y: e.clientY };
    
    // 左键：超级拖拽
    if (e.button === 0) {
      potentialDragImage = null;
      potentialDragLink = null;
      potentialDragEditable = null;
      potentialDragSelection = null;

      const superDragAllowed = isSuperDragFeatureEnabled();

      if (superDragAllowed) {
        prepareSuperDragNativeDraggable(e);
        beginPotentialEditableTextDrag(e);

        if (!potentialDragEditable && !isTextInputElement(e.target)) {
          // 有选区时优先文字（含链接上的部分选中）；链接走 HTML5 dragstart
          beginPotentialSelectionTextDrag(e);

          // 链接/图片都先做 pointer 候选：原生 dragstart 成功则自动让位，失败时兜底为超级拖拽。
          if (!potentialDragSelection) {
            const imageCandidate = settings.enableImageDrag && !shouldBlockImageSuperDragForTarget(e.target)
              ? resolveImageCandidateForDrag(e)
              : null;
            const imageTakesPriority = shouldArmPotentialImageDrag(e, imageCandidate);

            if (!imageTakesPriority) {
              beginPotentialLinkDrag(e, imageCandidate);
            }
            if (!potentialDragLink && imageTakesPriority) {
              beginPotentialImageSuperDrag(e, imageCandidate);
            }
          }
        }
      }

      // 仅在真正开始拖拽时再 capture pointer，避免 pointerdown 抢占导致按钮无法点击
    }
    
    // 右键或 Mac Ctrl+左键：手势
    const isMacRightClick = isMacOS && e.button === 0 && e.ctrlKey;
    if (e.button !== 2 && !isMacRightClick) return;
    
    if (!isExtensionValid) {
      checkExtensionValidity();
      return;
    }
    if (!settings || !settings.enableGesture) return;
    if (isSiteInDisabledList(window.location.href)) return;

    const pointerDownTime = Date.now();
    beginMacLinuxRightPress(e, pointerDownTime);
    if (isGestureInProgress && !isRightMouseDown && !cachedGestureState.gestureActive) {
      isGestureInProgress = false;
      releaseGesturePointerCapture();
      resetGestureState();
      clearGestureCanvas();
    }
    
    isRightMouseDown = true;
    gestureSessionStartTime = pointerDownTime;
    iframeTrailEndNotified = false;
    iframeTrailForwardStarted = false;
    cancelPendingIframeTrailForward();
    crossFrameSessionRetryCount = 0;
    if (crossFrameSessionRetryTimer) {
      clearTimeout(crossFrameSessionRetryTimer);
      crossFrameSessionRetryTimer = 0;
    }
    if (window !== window.top) {
      beginCrossFrameSession();
    }
    startGestureStatePolling();
    gesturePointerId = e.pointerId;
    // 不在 pointerdown 时设置 gestureActive，避免简单右键被误拦；仅在手势真正开始（超过阈值）时设置
    gestureStartX = e.clientX;
    gestureStartY = e.clientY;
    gesturePoints = [{ x: e.clientX, y: e.clientY }];
    gestureComposedPath = e.composedPath().slice();
    resetGestureRecognitionPerfState();
    resetGestureTrailDrawState();
    resetTrailRegionScreenshotCheckCache();
    updateLiveGestureDebugInfo('pendingGesture', null, { immediate: true });
    trailRegionLinksHintForGesture = false;
    enableGesturePreventDefault();
  } catch (err) {
    console.log('处理 pointerdown 失败:', err.message);
    isRightMouseDown = false;
  }
}

// getCoalescedEvents：高刷新率下插值点，轨迹更平滑
function handlePointerMove(e) {
  try {
    if (!isTrustedUserEvent(e)) return;
    if (e.pointerType && e.pointerType !== 'mouse') return;
    
    mouseCurrentPosition = { x: e.clientX, y: e.clientY };
    const primaryButtonActive = (e.buttons & 1) === 1;
    const hasPotentialSuperDrag =
      !!(potentialDragImage || potentialDragLink || potentialDragEditable || potentialDragSelection || cachedSuperDragSession.active);
    const canContinueIframeTrail =
      window === window.top &&
      iframeGesturePoints.length > 0 &&
      isGesturePointerButtonsActive(e) &&
      (Date.now() - lastIframeTrailTime) < IFRAME_TOP_TRAIL_CONTINUE_MS;

    if (!primaryButtonActive && !isRightMouseDown && !hasPotentialSuperDrag && !canContinueIframeTrail) {
      return;
    }
    
    // 合成图片拖拽：检测移动距离与方向
    if (potentialDragImage && (e.buttons & 1)) {
      if (dragInfo.type) {
        potentialDragImage = null;
      } else {
      const dx = mouseCurrentPosition.x - potentialDragImage.startX;
      const dy = mouseCurrentPosition.y - potentialDragImage.startY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (!potentialDragImage.dragging && potentialDragImage.carouselInfo) {
        const intent = getCarouselImageDragIntent(
          potentialDragImage,
          mouseCurrentPosition.x,
          mouseCurrentPosition.y
        );
        if (intent === 'carousel') {
          // 沿轮播轴移动时交给页面原生轮播，不清掉候选；
          // 如果用户随后明显跨轴或拖出轮播区域，仍可切换为图片超级拖拽。
          potentialDragImage.carouselYielding = true;
          hideSuperDragCompass();
          clearSuperDragSessionStorage();
          return;
        }
        if (intent === 'wait') {
          return;
        }
        potentialDragImage.carouselYielding = false;
      }
      if (!potentialDragImage.dragging && distance >= dragDistanceThreshold) {
        potentialDragImage.dragging = true;
        beginSuperDragSession();
        ensureSuperDragPointerCaptured(e.pointerId);
        enableSyntheticSuperDragSelectionGuard(true);
        markSuperDragNavigationSuppressed();
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch (_) { /* ignore */ }
        const sp = clientToSuperDragViewport(
          potentialDragImage.startX,
          potentialDragImage.startY
        );
        potentialDragImage.viewportStartX = sp.x;
        potentialDragImage.viewportStartY = sp.y;
        applySuperDragSessionSnapshot({
          active: true,
          startX: sp.x,
          startY: sp.y,
          type: 'image',
          mode: 'pointerImage'
        });
        try {
          writeSuperDragStorage(cachedSuperDragSession);
        } catch (err) {
          console.log('超级拖拽跨帧状态同步失败:', err.message);
        }
      }
      if (potentialDragImage.dragging) {
        try {
          e.preventDefault();
          e.stopPropagation();
        } catch (_) { /* ignore */ }
        const cur = clientToSuperDragViewport(
          mouseCurrentPosition.x,
          mouseCurrentPosition.y
        );
        potentialDragImage.direction = computeSuperDragDirection(
          cur.x - potentialDragImage.viewportStartX,
          cur.y - potentialDragImage.viewportStartY
        );
        processSuperDragCompassMove(
          potentialDragImage.viewportStartX,
          potentialDragImage.viewportStartY,
          cur.x,
          cur.y,
          'image'
        );
      }
      }
    } else if (
      cachedSuperDragSession.active &&
      cachedSuperDragSession.mode === 'pointerImage' &&
      (e.buttons & 1)
    ) {
      const cur = clientToSuperDragViewport(e.clientX, e.clientY);
      processSuperDragCompassMove(
        cachedSuperDragSession.startX,
        cachedSuperDragSession.startY,
        cur.x,
        cur.y,
        'image'
      );
    }

    if (potentialDragLink && (e.buttons & 1)) {
      if (dragInfo.type) {
        cancelPotentialLinkSuperDrag();
      } else {
        const dx = mouseCurrentPosition.x - potentialDragLink.startX;
        const dy = mouseCurrentPosition.y - potentialDragLink.startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (!potentialDragLink.dragging && potentialDragLink.carouselInfo) {
          const intent = getCarouselImageDragIntent(
            potentialDragLink,
            mouseCurrentPosition.x,
            mouseCurrentPosition.y
          );
          if (intent === 'carousel') {
            potentialDragLink.carouselYielding = true;
            hideSuperDragCompass();
            clearSuperDragSessionStorage();
            return;
          }
          if (intent === 'wait') {
            return;
          }
          potentialDragLink.carouselYielding = false;
        }
        if (!potentialDragLink.dragging && distance >= dragDistanceThreshold && !dragInfo.type) {
          enableSyntheticSuperDragSelectionGuard(true);
          markSuperDragNavigationSuppressed();
          if (!potentialDragLink.nativeDragDeadline) {
            potentialDragLink.nativeDragDeadline = Date.now() + 80;
            return;
          }
          if (Date.now() < potentialDragLink.nativeDragDeadline) {
            return;
          }
          potentialDragLink.dragging = true;
          beginSuperDragSession();
          ensureSuperDragPointerCaptured(e.pointerId);
          try {
            e.preventDefault();
            e.stopPropagation();
          } catch (_) { /* ignore */ }
          const sp = clientToSuperDragViewport(
            potentialDragLink.startX,
            potentialDragLink.startY
          );
          potentialDragLink.viewportStartX = sp.x;
          potentialDragLink.viewportStartY = sp.y;
          applySuperDragSessionSnapshot({
            active: true,
            startX: sp.x,
            startY: sp.y,
            type: 'link',
            mode: 'pointerLink',
            url: potentialDragLink.url,
            text: potentialDragLink.text
          });
          try {
            writeSuperDragStorage(cachedSuperDragSession);
          } catch (err) {
            console.log('超级拖拽跨帧状态同步失败:', err.message);
          }
        }
        if (potentialDragLink.dragging) {
          try {
            e.preventDefault();
            e.stopPropagation();
          } catch (_) { /* ignore */ }
          const cur = clientToSuperDragViewport(
            mouseCurrentPosition.x,
            mouseCurrentPosition.y
          );
          potentialDragLink.direction = computeSuperDragDirection(
            cur.x - potentialDragLink.viewportStartX,
            cur.y - potentialDragLink.viewportStartY
          );
          processSuperDragCompassMove(
            potentialDragLink.viewportStartX,
            potentialDragLink.viewportStartY,
            cur.x,
            cur.y,
            'link'
          );
        }
      }
    } else if (
      cachedSuperDragSession.active &&
      cachedSuperDragSession.mode === 'pointerLink' &&
      (e.buttons & 1)
    ) {
      const cur = clientToSuperDragViewport(e.clientX, e.clientY);
      processSuperDragCompassMove(
        cachedSuperDragSession.startX,
        cachedSuperDragSession.startY,
        cur.x,
        cur.y,
        'link'
      );
    }

    if (potentialDragEditable && (e.buttons & 1)) {
      if (dragInfo.type && dragInfo.editableSource) {
        if (potentialDragEditable.dragging) {
          potentialDragEditable.dragging = false;
          hideSuperDragCompass();
          clearSuperDragSessionStorage();
        }
        potentialDragEditable = null;
        return;
      }
      const pointer = { clientX: mouseCurrentPosition.x, clientY: mouseCurrentPosition.y };
      const overOtherDrop = resolveNativeDropTarget(e);
      const sourceRoot = potentialDragEditable.root;
      if (overOtherDrop && sourceRoot && overOtherDrop !== sourceRoot) {
        if (potentialDragEditable.dragging) {
          potentialDragEditable.dragging = false;
          hideSuperDragCompass();
          clearSuperDragSessionStorage();
        }
        return;
      }
      const dx = mouseCurrentPosition.x - potentialDragEditable.startX;
      const dy = mouseCurrentPosition.y - potentialDragEditable.startY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const stillInSource = isPointerWithinEditableSourceRect(pointer, sourceRoot);
      if (potentialDragEditable.dragging && stillInSource) {
        potentialDragEditable.dragging = false;
        hideSuperDragCompass();
        clearSuperDragSessionStorage();
        return;
      }
      if (!potentialDragEditable.dragging && distance >= dragDistanceThreshold && !dragInfo.type) {
        if (!stillInSource) {
          potentialDragEditable.dragging = true;
          beginSuperDragSession();
          ensureSuperDragPointerCaptured(e.pointerId);
          const sp = clientToSuperDragViewport(
            potentialDragEditable.startX,
            potentialDragEditable.startY
          );
          potentialDragEditable.viewportStartX = sp.x;
          potentialDragEditable.viewportStartY = sp.y;
          applySuperDragSessionSnapshot({
            active: true,
            startX: sp.x,
            startY: sp.y,
            type: 'text',
            mode: 'pointerEditable'
          });
          try {
            writeSuperDragStorage(cachedSuperDragSession);
          } catch (err) {
            console.log('超级拖拽跨帧状态同步失败:', err.message);
          }
        }
      }
      if (potentialDragEditable.dragging && !stillInSource) {
        const cur = clientToSuperDragViewport(
          mouseCurrentPosition.x,
          mouseCurrentPosition.y
        );
        potentialDragEditable.direction = computeSuperDragDirection(
          cur.x - potentialDragEditable.viewportStartX,
          cur.y - potentialDragEditable.viewportStartY
        );
        processSuperDragCompassMove(
          potentialDragEditable.viewportStartX,
          potentialDragEditable.viewportStartY,
          cur.x,
          cur.y,
          'text',
          pointer,
          potentialDragEditable.root
        );
      }
    } else if (
      cachedSuperDragSession.active &&
      cachedSuperDragSession.mode === 'pointerEditable' &&
      (e.buttons & 1)
    ) {
      const pointer = { clientX: e.clientX, clientY: e.clientY };
      const source = getActiveEditableDragSource();
      if (source && isPointerWithinEditableSourceRect(pointer, source)) {
        applySuperDragCompassHide();
        return;
      }
      const cur = clientToSuperDragViewport(e.clientX, e.clientY);
      processSuperDragCompassMove(
        cachedSuperDragSession.startX,
        cachedSuperDragSession.startY,
        cur.x,
        cur.y,
        'text',
        pointer,
        source
      );
    }

    if (potentialDragSelection && (e.buttons & 1)) {
      if (dragInfo.type) {
        cancelPotentialSelectionSuperDrag();
        return;
      }
      if (resolveNativeDropTarget(e)) {
        if (potentialDragSelection.dragging) {
          potentialDragSelection.dragging = false;
          hideSuperDragCompass();
          clearSuperDragSessionStorage();
        }
        return;
      }
      const dx = mouseCurrentPosition.x - potentialDragSelection.startX;
      const dy = mouseCurrentPosition.y - potentialDragSelection.startY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      // 等待原生 dragstart；未触发时（如 Bing）再启用 pointer 合成超级拖拽
      if (!potentialDragSelection.dragging && distance >= dragDistanceThreshold && !dragInfo.type) {
        if (!potentialDragSelection.nativeDragDeadline) {
          potentialDragSelection.nativeDragDeadline = Date.now() + 80;
        } else if (Date.now() >= potentialDragSelection.nativeDragDeadline) {
          potentialDragSelection.dragging = true;
          beginSuperDragSession();
          ensureSuperDragPointerCaptured(e.pointerId);
          markSuperDragNavigationSuppressed();
          const sp = clientToSuperDragViewport(
            potentialDragSelection.startX,
            potentialDragSelection.startY
          );
          potentialDragSelection.viewportStartX = sp.x;
          potentialDragSelection.viewportStartY = sp.y;
          applySuperDragSessionSnapshot({
            active: true,
            startX: sp.x,
            startY: sp.y,
            type: 'text',
            mode: 'pointerSelection'
          });
          try {
            writeSuperDragStorage(cachedSuperDragSession);
          } catch (err) {
            console.log('超级拖拽跨帧状态同步失败:', err.message);
          }
        }
      }
      if (potentialDragSelection.dragging) {
        e.preventDefault();
        const cur = clientToSuperDragViewport(
          mouseCurrentPosition.x,
          mouseCurrentPosition.y
        );
        potentialDragSelection.direction = computeSuperDragDirection(
          cur.x - potentialDragSelection.viewportStartX,
          cur.y - potentialDragSelection.viewportStartY
        );
        processSuperDragCompassMove(
          potentialDragSelection.viewportStartX,
          potentialDragSelection.viewportStartY,
          cur.x,
          cur.y,
          'text'
        );
      }
    } else if (
      cachedSuperDragSession.active &&
      cachedSuperDragSession.mode === 'pointerSelection' &&
      (e.buttons & 1)
    ) {
      const cur = clientToSuperDragViewport(e.clientX, e.clientY);
      processSuperDragCompassMove(
        cachedSuperDragSession.startX,
        cachedSuperDragSession.startY,
        cur.x,
        cur.y,
        'text'
      );
    }
    
    // 手势在 iframe 内开始、指针移入主框架时延续轨迹（iframe 不再收到 pointermove）
    const topTrailContinuation = canContinueIframeTrail;

    if (topTrailContinuation) {
      if (!isGestureInProgress) {
        isGestureInProgress = true;
        isRightMouseDown = true;
        gesturePointerId = e.pointerId;
        gesturePoints = iframeGesturePoints.map((p) => ({ x: p.x, y: p.y }));
        gestureStartX = gesturePoints[0].x;
        gestureStartY = gesturePoints[0].y;
        initGestureCanvas();
        captureGesturePointer(gesturePointerId);
        if (typeof MouseScrollGesture !== 'undefined') {
          MouseScrollGesture.lockGestureScrollTargets();
        }
      }
      lastIframeTrailTime = Date.now();
    }

    if (!isRightMouseDown) return;
    if (gesturePointerId != null && e.pointerId !== gesturePointerId) return; // 仅处理当前手势的 pointer
    if (!isExtensionValid) {
      checkExtensionValidity();
      return;
    }
    if (!settings || !settings.enableGesture) return;
    
    // getCoalescedEvents：高刷新率显示器下返回插值点，轨迹更细腻
    const coalesced = e.getCoalescedEvents && e.getCoalescedEvents();
    const coalescedEvents = (coalesced && coalesced.length > 0) ? coalesced : [e];
    const lastEv = coalescedEvents[coalescedEvents.length - 1];
    const viewportX = lastEv.clientX;
    const viewportY = lastEv.clientY;
    
    const dx = viewportX - gestureStartX;
    const dy = viewportY - gestureStartY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const startMovementThreshold = getEffectiveMinMovementToStartGesture();

    if (!isGestureInProgress) {
      updateLiveGestureDebugInfo(
        distance >= startMovementThreshold ? 'trackingGesture' : 'waitingForMovement',
        { x: viewportX, y: viewportY }
      );
    }

    if (!isGestureInProgress && distance >= startMovementThreshold) {
      isGestureInProgress = true;
      iframeTrailEndNotified = false;
      if (window !== window.top) {
        beginCrossFrameSession();
        syncGestureStateToStorage(true, 0, contentFrameId);
      } else {
        syncGestureStateToStorage(true, 0);
      }
      if (typeof MouseScrollGesture !== 'undefined') {
        MouseScrollGesture.lockGestureScrollTargets();
      }
      initGestureCanvas();
      if (isEmbedGestureContext()) startCrossFrameGestureWatch();
      captureGesturePointer(gesturePointerId);
    }
    
    if (isGestureInProgress) {
      // 批量添加点后只重绘一次，避免每点全量重绘导致卡顿
      for (const ev of coalescedEvents) {
        gesturePoints.push({ x: ev.clientX, y: ev.clientY });
      }
      scheduleGestureTrailDraw();
      updateLiveGestureDebugInfo('trackingGesture');
      
      if (!gestureRecognizeRafId) {
        gestureRecognizeRafId = requestAnimationFrame(() => {
          gestureRecognizeRafId = 0;
          if (!isGestureInProgress) return;
          if (!shouldRunGestureRecognitionFrame()) return;
      // Live gesture recognition and hint update
      const currentGesture = recognizeGesture();
      if (currentGesture) {
        const trailIntersectShot = shouldTriggerTrailRegionScreenshot(
          gesturePoints,
          currentGesture
        );

        let actionText = '';
        if (trailIntersectShot) {
          actionText = trailRegionHintTextForPoints(gesturePoints, currentGesture);
        } else {
          const customAction = getCustomGestureAction(currentGesture);
          actionText = getGestureActionHintText(customAction);
          if (!actionText) {
            lastHintAction = '';
            removeGestureHintElement();
            return;
          }
        }

        // Only refresh the hint when the displayed action changes
        if (actionText && actionText !== lastHintAction) {
          showGestureHint(actionText);
        }
      } else if (gesturePoints.length >= 2) {
        // 计算手势总距离
        let totalDistance = 0;
        for (let i = 1; i < gesturePoints.length; i++) {
          const dx = gesturePoints[i].x - gesturePoints[i-1].x;
          const dy = gesturePoints[i].y - gesturePoints[i-1].y;
          totalDistance += Math.sqrt(dx * dx + dy * dy);
        }
        
        // 只有当总距离达到最小手势距离要求时才显示无效手势提示
        // 并且确保手势仍在进行中（防止在动作执行后的微小鼠标移动触发无效手势提示）
        if (totalDistance >= getGestureRecognitionConfig().minTotalDistance && isGestureInProgress) {
          // 无效手势显示
          const currentLang = settings.language || 'zh';
          const invalidText = getGestureTranslations().invalidGesture;
          
          // 只有当上一个提示不是无效手势时才显示
          if (lastHintAction !== invalidText) {
            showGestureHint(invalidText);
          }
        }
        // 如果距离不足，则不显示任何提示
      }
        });
      }
    }
  } catch (err) {
    console.log('处理 pointermove 失败:', err.message);
    disableSyntheticSuperDragSelectionGuard();
    isRightMouseDown = false;
    isGestureInProgress = false;
    releaseGesturePointerCapture();
    resetGestureState();
    clearGestureCanvas();
  }
}

// 执行合成图片拖拽动作（与 handleDragEnd 中 image 类型逻辑一致）
function executeSyntheticImageDrag(info) {
  if (!info || !info.dragging || !info.url) return;
  if (!info.direction && lastLockedSuperDragDirection) {
    info.direction = lastLockedSuperDragDirection;
  }
  if (!info.direction) return;
  markPointerSyntheticSuperDragExecuted();
  const actionType = getEffectiveSuperDragActionForDirection(info.direction, 'image', info.url);
  if (actionType === 'none') return;
  if (actionType === 'download') {
    markSuperDragNavigationSuppressed();
    sendSuperDragMessage({
      action: 'superDrag',
      type: 'image',
      url: info.url,
      actionType: 'download'
    });
    return;
  }
  if (actionType === 'copy') {
    copyPlainTextToClipboard(info.url).then((ok) => {
      if (ok) showGestureHint(getI18nMessage('copiedToClipboard', 'Copied to clipboard'));
    });
    return;
  }
  markSuperDragNavigationSuppressed();
  if (actionType === 'popupView') {
    openSuperDragPayloadInPopupView({ type: 'image', url: info.url, title: info.text || info.url });
    return;
  }
  const isSplitView = ['splitLeft', 'splitRight', 'splitUp', 'splitDown'].includes(actionType);
  if (isSplitView) {
    sendSuperDragMessage({ action: 'superDrag', type: 'image', url: info.url, actionType });
  } else if (actionType === 'incognito') {
    sendSuperDragMessage({ action: 'superDrag', type: 'image', url: info.url, actionType: 'incognito' });
  } else if (actionType === 'foreground') {
    window.open(info.url, '_blank', 'noopener');
  } else if (actionType === 'background') {
    sendSuperDragMessage({ action: 'superDrag', type: 'image', url: info.url, actionType: 'background' });
  }
}

function executeSyntheticLinkDrag(info) {
  if (!info || !info.dragging || !info.url) return;
  if (!info.direction && lastLockedSuperDragDirection) {
    info.direction = lastLockedSuperDragDirection;
  }
  if (!info.direction) return;
  markPointerSyntheticSuperDragExecuted();
  const actionType = getEffectiveSuperDragActionForDirection(info.direction, 'link', info.url);
  if (actionType === 'none') return;

  if (actionType === 'download') {
    markSuperDragNavigationSuppressed();
    sendSuperDragMessage({
      action: 'superDrag',
      type: 'link',
      url: info.url,
      actionType: 'download'
    });
    return;
  }

  if (actionType === 'copy') {
    copyPlainTextToClipboard(info.url).then((ok) => {
      if (ok) showGestureHint(getI18nMessage('copiedToClipboard', 'Copied to clipboard'));
    });
    return;
  }

  markSuperDragNavigationSuppressed();
  const isSplitView = ['splitLeft', 'splitRight', 'splitUp', 'splitDown'].includes(actionType);
  if (actionType === 'popupView') {
    openSuperDragPayloadInPopupView({ type: 'link', url: info.url, title: info.text || info.url });
  } else if (isSplitView) {
    sendSuperDragMessage({ action: 'superDrag', type: 'link', url: info.url, actionType });
  } else if (actionType === 'incognito') {
    sendSuperDragMessage({ action: 'superDrag', type: 'link', url: info.url, actionType: 'incognito' });
  } else if (actionType === 'foreground') {
    window.open(info.url, '_blank', 'noopener');
  } else if (actionType === 'background') {
    sendSuperDragMessage({ action: 'superDrag', type: 'link', url: info.url, actionType: 'background' });
  }
}

function executeSyntheticTextDrag(info) {
  if (!info || !info.dragging || !info.text) return;
  if (!info.direction && lastLockedSuperDragDirection) {
    info.direction = lastLockedSuperDragDirection;
  }
  if (!info.direction) return;
  markPointerSyntheticSuperDragExecuted();
  const actionType = getEffectiveSuperDragActionForDirection(info.direction, 'text', '');
  if (actionType === 'none') return;

  let dragType = 'text';
  let dragText = info.text;
  let dragUrl = '';
  if (isValidUrl(info.text)) {
    dragType = 'link';
    dragUrl = info.text;
    if (!dragUrl.startsWith('http://') && !dragUrl.startsWith('https://') && !dragUrl.startsWith('ftp://')) {
      dragUrl = 'https://' + dragUrl;
    }
  }

  if (actionType === 'copy') {
    const toCopy = dragType === 'link' ? dragUrl : dragText;
    copyPlainTextToClipboard(toCopy).then((ok) => {
      if (ok) showGestureHint(getI18nMessage('copiedToClipboard', 'Copied to clipboard'));
    });
    return;
  }

  const isSplitView = ['splitLeft', 'splitRight', 'splitUp', 'splitDown'].includes(actionType);
  if (dragType === 'link') {
    markSuperDragNavigationSuppressed();
    if (actionType === 'popupView') {
      openSuperDragPayloadInPopupView({ type: 'link', url: dragUrl, title: dragText || dragUrl });
    } else if (isSplitView) {
      sendSuperDragMessage({ action: 'superDrag', type: 'link', url: dragUrl, actionType });
    } else if (actionType === 'incognito') {
      sendSuperDragMessage({ action: 'superDrag', type: 'link', url: dragUrl, actionType: 'incognito' });
    } else if (actionType === 'foreground') {
      window.open(dragUrl, '_blank', 'noopener');
    } else if (actionType === 'background') {
      sendSuperDragMessage({ action: 'superDrag', type: 'link', url: dragUrl, actionType: 'background' });
    }
    return;
  }

  if (settings.enableDragTextSearch) {
    markSuperDragNavigationSuppressed();
    if (actionType === 'popupView') {
      openSuperDragPayloadInPopupView({
        type: 'text',
        text: dragText,
        dragDirection: info.direction
      });
    } else {
      sendSuperDragMessage({
        action: 'superDrag',
        type: 'text',
        text: dragText,
        actionType,
        dragDirection: info.direction
      });
    }
  }
}

// pointerup 释放时统一处理
function handlePointerUp(e) {
  try {
    if (!isTrustedUserEvent(e)) return;
    if (e.pointerType && e.pointerType !== 'mouse') return;
    
    // 左键释放：合成图片/文字拖拽（链接走 HTML5 dragend）
    if (e.button === 0 && potentialDragImage) {
      if (potentialDragImage.dragging) {
        executeSyntheticImageDrag(potentialDragImage);
      }
      hideSuperDragCompass();
      clearSuperDragSessionStorage();
      potentialDragImage = null;
    }

    if (e.button === 0 && potentialDragLink) {
      if (potentialDragLink.dragging) {
        executeSyntheticLinkDrag(potentialDragLink);
      }
      hideSuperDragCompass();
      clearSuperDragSessionStorage();
      potentialDragLink = null;
    }

    if (e.button === 0 && potentialDragEditable) {
      tryFinishEditableTextDrag(e);
      hideSuperDragCompass();
      clearSuperDragSessionStorage();
      potentialDragEditable = null;
    } else if (e.button === 0 && dragInfo.type === 'text' && dragInfo.editableSource) {
      // HTML5 可编辑区拖拽：收尾交给 dragend，避免与原生 drop 竞态
      hideSuperDragCompass();
    }

    if (e.button === 0 && potentialDragSelection) {
      const dropTarget = resolveNativeDropTarget(e);
      const moved = hasPotentialSelectionDragMoved(e, potentialDragSelection);
      if (dropTarget && moved && potentialDragSelection.text) {
        e.preventDefault();
        e.stopPropagation();
        insertTextIntoNativeDropTarget(dropTarget, potentialDragSelection.text);
      } else if (
        potentialDragSelection.dragging &&
        potentialDragSelection.direction &&
        !dropTarget &&
        !dragInfo.type
      ) {
        e.preventDefault();
        e.stopPropagation();
        markSuperDragNavigationSuppressed();
        executeSyntheticTextDrag(potentialDragSelection);
      }
      hideSuperDragCompass();
      clearSuperDragSessionStorage();
      potentialDragSelection = null;
    }

    if (e.button === 0) {
      releaseSuperDragPointerCapture();
      disableSyntheticSuperDragSelectionGuard();
    }
    
    const isMacRightClick = isMacOS && e.button === 0 && e.ctrlKey;
    if (e.button !== 2 && e.button !== undefined && !isMacRightClick) return;
    const localOwnsPointer = gesturePointerId == null || e.pointerId === gesturePointerId;
    const recentEnd = getRecentGestureEndTime();
    const crossFrameHandoff =
      !isGestureInProgress &&
      (cachedGestureState.gestureActive ||
        (window !== window.top &&
          recentEnd > 0 &&
          Date.now() - recentEnd < getGestureContextMenuThreshold()));
    if (!localOwnsPointer && !isGestureInProgress && !crossFrameHandoff) return;

    isRightMouseDown = false;
    // 真实手势收尾前保持 gestureActive，避免 storage 轮询误判为跨帧取消并提前 reset
    if (isGestureInProgress) {
      const endNow = Date.now();
      lastGestureEndTime = endNow;
      cachedGestureState.lastGestureEndTime = endNow;
    } else if (crossFrameHandoff) {
      const topHadActiveGesture = !!cachedGestureState.gestureActive;
      const endNow = Date.now();
      lastGestureEndTime = endNow;
      cachedGestureState.gestureActive = false;
      cachedGestureState.lastGestureEndTime = endNow;
      syncGestureStateToStorage(false, endNow);
      scheduleReleaseGesturePreventDefault();
      releaseGesturePointerCapture();
      if (!settings || !settings.enableGesture) return;
      if (window !== window.top && topHadActiveGesture) {
        sendCrossFrameSilent({ action: 'gestureCompleteHandoffRequest' });
      }
      if (window === window.top && iframeGesturePoints.length >= 2) {
        tryBootstrapTopGestureFromIframePoints();
        finalizeActiveGestureRecognition();
      } else {
        clearGestureCanvas();
      }
      return;
    } else if (window === window.top) {
      // lastMacLinuxRightClickTime 不在此清零，供 Mac/Linux 双击右键检测
      lastGestureEndTime = 0;
      cachedGestureState.gestureActive = false;
      cachedGestureState.lastGestureEndTime = 0;
      syncGestureStateToStorage(false, 0);
    } else {
      releaseGesturePointerCapture();
      syncGestureStateToStorage(false, lastGestureEndTime || Date.now());
      clearGestureCanvas();
      return;
    }
    scheduleReleaseGesturePreventDefault();
    releaseGesturePointerCapture();

    // 检查鼠标手势功能是否启用
    if (!settings || !settings.enableGesture) {
      return;
    }
    
    // Mac/Linux 简单右键：lastGestureEndTime 在 handleContextMenu 中设置，此处不设，避免事件顺序导致首次单击被误判为双击
    if ((isMacOS || isLinuxOS) && !isGestureInProgress) {
      if (isMacLinuxSimpleRightClickIntent()) {
        rememberMacLinuxRightPointerUp(e, Date.now());
        syncGestureStateToStorage(false, 0);
        updateLiveGestureDebugInfo('releasedGesture', { x: e.clientX, y: e.clientY }, { immediate: true });
        resetGestureState();
        return;
      }
    }
    
    // 如果不是手势，则清除状态
    if (!isGestureInProgress) {
      updateLiveGestureDebugInfo('releasedGesture', { x: e.clientX, y: e.clientY }, { immediate: true });
      resetGestureState();
      return;
    }

    finalizeActiveGestureRecognition();
  } catch (err) {
    console.log('处理 pointerup 失败:', err.message);
    disableSyntheticSuperDragSelectionGuard();
    isGestureInProgress = false;
    releaseGesturePointerCapture();
    resetGestureState();
    clearGestureCanvas();
  }
}

// 超级拖拽：输入框/可编辑区相关辅助
function findNativeTextDragSource(element) {
  let el = element;
  let depth = 0;
  while (el && el !== document.body && depth < 10) {
    if (isTextInputElement(el)) return el;
    el = el.parentElement;
    depth++;
  }
  return null;
}

function findLinkElementFromTarget(element) {
  let el = element;
  let depth = 0;
  while (el && el !== document.body && depth < 12) {
    if (el.tagName === 'A' && el.href) return el;
    el = el.parentElement;
    depth++;
  }
  return null;
}

function resolveNativeDropTarget(e) {
  const seen = new Set();
  const candidates = [];

  function add(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE || seen.has(el)) return;
    seen.add(el);
    candidates.push(el);
  }

  if (e && typeof e.composedPath === 'function') {
    for (const node of e.composedPath()) add(node);
  }
  try {
    if (e && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      let el = document.elementFromPoint(e.clientX, e.clientY);
      while (el && el !== document.documentElement) {
        add(el);
        el = el.parentElement;
      }
    }
  } catch (err) { /* ignore */ }
  if (e && e.target && e.target.nodeType === Node.ELEMENT_NODE) {
    let el = e.target;
    while (el && el !== document.body) {
      add(el);
      el = el.parentElement;
    }
  }

  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    if (findLinkElementFromTarget(el)) continue;
    const inputSource = findInputOrTextareaSource(el);
    if (inputSource) return inputSource;
    const editable = findContentEditableDropTarget(el);
    if (editable) return editable;
  }
  return null;
}

function insertTextIntoNativeDropTarget(target, text) {
  if (!target || !text) return false;
  try {
    target.focus({ preventScroll: true });
  } catch (err) {
    try { target.focus(); } catch (_) { /* ignore */ }
  }

  const tag = target.tagName ? target.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea') {
    try {
      const start = target.selectionStart != null ? target.selectionStart : target.value.length;
      const end = target.selectionEnd != null ? target.selectionEnd : target.value.length;
      const before = target.value.slice(0, start);
      const after = target.value.slice(end);
      target.value = before + text + after;
      const pos = start + text.length;
      target.setSelectionRange(pos, pos);
      try {
        target.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data: text,
          inputType: 'insertFromDrop'
        }));
      } catch (_) {
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (err) {
      try {
        target.value = text;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      } catch (_) { /* ignore */ }
    }
  }

  if (target.isContentEditable) {
    try {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(target);
        range.collapse(false);
        sel.addRange(range);
      }
      if (document.execCommand('insertText', false, text)) {
        try {
          target.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            data: text,
            inputType: 'insertFromDrop'
          }));
        } catch (_) {
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return true;
      }
    } catch (err) { /* ignore */ }
  }
  return false;
}

function hasPotentialSelectionDragMoved(e, info) {
  if (!info || !e) return false;
  const dx = e.clientX - info.startX;
  const dy = e.clientY - info.startY;
  return Math.sqrt(dx * dx + dy * dy) >= dragDistanceThreshold;
}

function lockSuperDragDirection(direction) {
  if (direction) lastLockedSuperDragDirection = direction;
}

function computeEditableDragDirectionFromEvent(info, e) {
  if (lastLockedSuperDragDirection) return lastLockedSuperDragDirection;
  if (!info || !e) return '';
  let startX = info.viewportStartX;
  let startY = info.viewportStartY;
  if (startX == null || startY == null) {
    const sp = clientToSuperDragViewport(info.startX, info.startY);
    startX = sp.x;
    startY = sp.y;
  }
  const pointer = getDragPointerClient(e);
  const cur = clientToSuperDragViewport(pointer.clientX, pointer.clientY);
  const dx = cur.x - startX;
  const dy = cur.y - startY;
  if (Math.sqrt(dx * dx + dy * dy) < dragDistanceThreshold) return '';
  return computeSuperDragDirection(dx, dy);
}

function buildEditableDragFinishInfo() {
  if (potentialDragEditable) return potentialDragEditable;
  if (dragInfo.type === 'text' && dragInfo.editableSource && dragInfo.text) {
    return {
      root: dragInfo.editableSource,
      text: dragInfo.text,
      startX: dragInfo.clientStartX || dragInfo.startX,
      startY: dragInfo.clientStartY || dragInfo.startY,
      viewportStartX: dragInfo.startX,
      viewportStartY: dragInfo.startY,
      direction: dragInfo.direction || lastLockedSuperDragDirection || cachedSuperDragSession.direction || '',
      dragging: true,
      fromHtml5Drag: true
    };
  }
  return null;
}

function isPointerWithinEditableSourceRect(pointerClient, editableSource) {
  if (!pointerClient || typeof pointerClient.clientX !== 'number') return false;
  if (!editableSource || !editableSource.isConnected) return false;
  try {
    const rect = editableSource.getBoundingClientRect();
    const x = pointerClient.clientX;
    const y = pointerClient.clientY;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  } catch (err) {
    return false;
  }
}

/** drag/dragover 偶发 (0,0) 坐标时用 pointermove 缓存位置 */
function getDragPointerClient(event) {
  const x = event?.clientX;
  const y = event?.clientY;
  if (typeof x === 'number' && typeof y === 'number') {
    const type = event.type || '';
    if ((type === 'drag' || type === 'dragover' || type === 'dragend') && x === 0 && y === 0) {
      return { clientX: mouseCurrentPosition.x, clientY: mouseCurrentPosition.y };
    }
    return { clientX: x, clientY: y };
  }
  return { clientX: mouseCurrentPosition.x, clientY: mouseCurrentPosition.y };
}

function syncEditableSuperDragSessionIfOutsideSource(pointerClient) {
  if (editableSuperDragSessionSynced || !dragInfo.editableSource || !dragInfo.type) return;
  if (isPointerWithinEditableSourceRect(pointerClient, dragInfo.editableSource)) return;
  editableSuperDragSessionSynced = true;
  syncSuperDragSessionToStorage();
}

function isEditableDropBackIntoSource(pointer, sourceRoot, dropTarget) {
  if (!sourceRoot || !dropTarget || dropTarget !== sourceRoot) return false;
  return isPointerWithinEditableSourceRect(pointer, sourceRoot);
}

function tryFinishEditableTextDrag(e) {
  const now = Date.now();
  if (now - lastEditableSuperDragFinishAt < 350) return false;

  const info = buildEditableDragFinishInfo();
  if (!info || !info.text) return false;

  const moved = info.fromHtml5Drag || hasPotentialSelectionDragMoved(e, info);
  if (!moved) return false;

  const dropTarget = resolveNativeDropTarget(e);
  const sourceRoot = info.root;

  if (dropTarget && sourceRoot && dropTarget !== sourceRoot) {
    // HTML5 框间拖放由浏览器原生 drop 处理，避免与 pointerup/dragend 双写
    if (info.fromHtml5Drag) return false;
    insertTextIntoNativeDropTarget(dropTarget, info.text);
    lastEditableSuperDragFinishAt = now;
    markPointerSyntheticSuperDragExecuted();
    return true;
  }
  if (isEditableDropBackIntoSource(e, sourceRoot, dropTarget)) return false;

  const direction =
    info.direction ||
    cachedSuperDragSession.direction ||
    computeEditableDragDirectionFromEvent(info, e);
  if (!direction) return false;

  info.dragging = true;
  info.direction = direction;
  executeSyntheticTextDrag(info);
  lastEditableSuperDragFinishAt = now;
  return true;
}

function resolveSuperDragDirectionFromDragEvent(e) {
  if (lastLockedSuperDragDirection) return lastLockedSuperDragDirection;
  if (dragInfo.direction) return dragInfo.direction;
  if (cachedSuperDragSession.direction) return cachedSuperDragSession.direction;
  if (dragInfo.startX == null || dragInfo.startY == null) return '';
  const pointer = getDragPointerClient(e);
  const cur = clientToSuperDragViewport(pointer.clientX, pointer.clientY);
  const dx = cur.x - dragInfo.startX;
  const dy = cur.y - dragInfo.startY;
  if (Math.sqrt(dx * dx + dy * dy) < dragDistanceThreshold) return '';
  return computeSuperDragDirection(dx, dy);
}

function ensureDragInfoDirectionFromEvent(e) {
  const direction = resolveSuperDragDirectionFromDragEvent(e);
  if (direction) dragInfo.direction = direction;
  return dragInfo.direction || '';
}

function findInputOrTextareaSource(element) {
  const source = findNativeTextDragSource(element);
  if (!source || !source.tagName) return null;
  const tag = source.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' ? source : null;
}

/** 排除 Discuz 等把只读列表包在 contenteditable 外层的情况，保留 ChatGPT 等真实编辑区 */
function isLikelyReadOnlyContentEditableWrapper(el) {
  if (!el || !el.isContentEditable) return false;
  try {
    if (document.activeElement === el || el.contains(document.activeElement)) return false;
    const role = el.getAttribute && el.getAttribute('role');
    if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return false;
    if (el.getAttribute && el.getAttribute('aria-multiline') === 'true') return false;
    if (el.querySelector && el.querySelector('.kmlist, .kmtit, #threadlist, tbody#threadlist')) {
      return true;
    }
    const links = el.querySelectorAll ? el.querySelectorAll('a[href]') : [];
    if (links.length > 15 && el.clientHeight > 300) return true;
  } catch (err) { /* ignore */ }
  return false;
}

function findContentEditableDropTarget(element) {
  let el = element;
  let depth = 0;
  while (el && el !== document.body && depth < 12) {
    if (findLinkElementFromTarget(el)) return null;
    if (el.isContentEditable && !isLikelyReadOnlyContentEditableWrapper(el)) {
      return el;
    }
    el = el.parentElement;
    depth++;
  }
  return null;
}

function getInputOrTextareaSelectedText(element) {
  if (!element || !element.tagName) return '';
  const tag = element.tagName.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') return '';
  try {
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (start == null || end == null || start === end) return '';
    return element.value.substring(start, end);
  } catch (err) {
    return '';
  }
}

function getContentEditableSelectedText(root) {
  if (!root) return '';
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return '';
  const text = sel.toString();
  if (!text || !text.trim()) return '';
  const node = sel.anchorNode;
  if (!node) return '';
  try {
    if (root.contains(node)) return text;
  } catch (err) { /* ignore */ }
  return '';
}

function getEditableDragSelectedText(root) {
  if (!root || !root.tagName) return '';
  const tag = root.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    return getInputOrTextareaSelectedText(root);
  }
  return getContentEditableSelectedText(root);
}

function getEditableDragTextWithCache(root, cache) {
  let text = getEditableDragSelectedText(root);
  if (text && text.trim()) return text.trim();
  if (!cache || cache.root !== root) return '';
  if (cache.text) return cache.text;
  const tag = root.tagName ? root.tagName.toLowerCase() : '';
  if (
    (tag === 'input' || tag === 'textarea') &&
    cache.selectionStart != null &&
    cache.selectionEnd != null &&
    cache.selectionStart !== cache.selectionEnd
  ) {
    try {
      return root.value.substring(cache.selectionStart, cache.selectionEnd).trim();
    } catch (err) { /* ignore */ }
  }
  return '';
}

function findEditableDragRootFromEvent(e) {
  const seen = new Set();
  const candidates = [];

  function add(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE || seen.has(node)) return;
    seen.add(node);
    candidates.push(node);
  }

  if (e && typeof e.composedPath === 'function') {
    for (const node of e.composedPath()) add(node);
  }
  if (e && e.target) add(e.target);
  try {
    const active = document.activeElement;
    if (active && active.nodeType === Node.ELEMENT_NODE) add(active);
  } catch (err) { /* ignore */ }

  for (let i = 0; i < candidates.length; i++) {
    const input = findInputOrTextareaSource(candidates[i]);
    if (input) return input;
    const editable = findContentEditableDropTarget(candidates[i]);
    if (editable) return editable;
  }
  return null;
}

function beginPotentialEditableTextDrag(e) {
  if (!isSuperDragFeatureEnabled()) return;

  const editableRoot = findEditableDragRootFromEvent(e);
  if (!editableRoot) return;

  const text = getEditableDragSelectedText(editableRoot);
  if (!text || !text.trim()) return;

  const tag = editableRoot.tagName ? editableRoot.tagName.toLowerCase() : '';
  let selectionStart = null;
  let selectionEnd = null;
  if (tag === 'input' || tag === 'textarea') {
    try {
      selectionStart = editableRoot.selectionStart;
      selectionEnd = editableRoot.selectionEnd;
    } catch (err) { /* ignore */ }
  }

  const sp = clientToSuperDragViewport(e.clientX, e.clientY);
  potentialDragEditable = {
    root: editableRoot,
    text: text.trim(),
    selectionStart,
    selectionEnd,
    startX: e.clientX,
    startY: e.clientY,
    viewportStartX: sp.x,
    viewportStartY: sp.y,
    dragging: false,
    direction: ''
  };
}

function setupEditableTextDragInfo(viewportStart, target, selectedText, editableSource, clientStart) {
  dragInfo = {
    startX: viewportStart.x,
    startY: viewportStart.y,
    clientStartX: clientStart?.x ?? 0,
    clientStartY: clientStart?.y ?? 0,
    target: target,
    type: 'text',
    url: '',
    text: selectedText,
    image: '',
    direction: '',
    time: Date.now(),
    savedSelection: selectedText,
    editableSource: editableSource || null
  };
  if (isValidUrl(selectedText)) {
    let url = selectedText;
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('ftp://')) {
      url = 'https://' + url;
    }
    dragInfo.type = 'link';
    dragInfo.url = url;
    dragInfo.text = selectedText;
  }
}

function isSuperDragTrackingActive() {
  return !!(dragInfo.type || cachedSuperDragSession.active);
}

function markSuperDragDataTransfer(dataTransfer, kind) {
  if (!dataTransfer) return;
  try {
    dataTransfer.effectAllowed = kind === 'link' ? 'copyLink' : 'copyMove';
  } catch (err) { /* ignore */ }
}

function resolveSuperDragLinkUrl(linkEl) {
  if (!linkEl || linkEl.tagName !== 'A') return '';
  const rawHref = linkEl.getAttribute('href');
  if (!rawHref || rawHref.toLowerCase().startsWith('javascript:')) return '';
  try {
    return new URL(rawHref, document.baseURI).href;
  } catch (_) {
    return linkEl.href || rawHref;
  }
}

function restoreSuperDragLinkDraggable() {
  window.removeEventListener('mouseup', restoreSuperDragLinkDraggable, true);
  window.removeEventListener('dragend', restoreSuperDragLinkDraggable, true);
  document.querySelectorAll('[data-superdrag-draggable-fix="true"]').forEach((el) => {
    const prev = el.getAttribute('data-superdrag-draggable-prev');
    if (prev === 'false') {
      el.setAttribute('draggable', 'false');
    } else if (prev != null && prev !== '') {
      el.setAttribute('draggable', prev);
    } else {
      el.removeAttribute('draggable');
    }
    el.removeAttribute('data-superdrag-draggable-prev');
    el.removeAttribute('data-superdrag-draggable-fix');
  });
}

function handleSuperDragLinkMouseDown(e) {
  prepareSuperDragNativeDraggable(e);
}

function findSuperDragLinkFromEvent(e) {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : null;
  if (path && path.length) {
    for (let i = 0; i < path.length; i++) {
      const node = path[i];
      if (!node || node.nodeType !== Node.ELEMENT_NODE || node.tagName !== 'A') continue;
      const href = node.href || node.getAttribute('href');
      if (href && !String(href).toLowerCase().startsWith('javascript:')) {
        return node;
      }
    }
  }
  let el = e.target;
  while (el && el !== document.body) {
    if (el.tagName === 'A') {
      const href = el.href || el.getAttribute('href');
      if (href && !String(href).toLowerCase().startsWith('javascript:')) {
        return el;
      }
    }
    el = el.parentElement;
  }
  return null;
}

function isPointInSelection(clientX, clientY, selection) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  const x = Number(clientX);
  const y = Number(clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const tolerance = 3;
  try {
    let sawVisibleRect = false;
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      const rects = range.getClientRects ? range.getClientRects() : [];
      for (let j = 0; j < rects.length; j++) {
        const rect = rects[j];
        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
        sawVisibleRect = true;
        if (
          x >= rect.left - tolerance &&
          x <= rect.right + tolerance &&
          y >= rect.top - tolerance &&
          y <= rect.bottom + tolerance
        ) {
          return true;
        }
      }
      if (!rects.length && typeof range.getBoundingClientRect === 'function') {
        const rect = range.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          sawVisibleRect = true;
          if (
            x >= rect.left - tolerance &&
            x <= rect.right + tolerance &&
            y >= rect.top - tolerance &&
            y <= rect.bottom + tolerance
          ) {
            return true;
          }
        }
      }
    }
    // 如果选区有可见矩形但鼠标不在矩形内，直接判定为非选区拖拽；
    // 避免页面保留了旧选区时，在空白处也触发超级拖拽。
    if (sawVisibleRect) return false;
  } catch (err) { /* fall through to caret fallback */ }

  try {
    let caret = null;
    if (typeof document.caretRangeFromPoint === 'function') {
      caret = document.caretRangeFromPoint(x, y);
    } else if (typeof document.caretPositionFromPoint === 'function') {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        caret = document.createRange();
        caret.setStart(pos.offsetNode, pos.offset);
        caret.collapse(true);
      }
    }
    if (!caret) return false;
    for (let i = 0; i < selection.rangeCount; i++) {
      const range = selection.getRangeAt(i);
      if (typeof range.comparePoint === 'function') {
        const inside = range.comparePoint(caret.startContainer, caret.startOffset) === 0;
        if (inside) return true;
      }
    }
  } catch (err) { /* ignore */ }
  return false;
}

function getPageSelectedTextAtPointer(clientX, clientY) {
  try {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return '';
    const text = sel.toString().trim();
    if (!text) return '';
    if (!isPointInSelection(clientX, clientY, sel)) return '';
    return text;
  } catch (err) {
    return '';
  }
}

function cancelPotentialSelectionSuperDrag() {
  if (!potentialDragSelection) return;
  if (potentialDragSelection.dragging) {
    hideSuperDragCompass();
    clearSuperDragSessionStorage();
  }
  potentialDragSelection = null;
}

function cancelPotentialLinkSuperDrag() {
  if (!potentialDragLink) return;
  if (potentialDragLink.dragging) {
    hideSuperDragCompass();
    clearSuperDragSessionStorage();
  }
  potentialDragLink = null;
}

function beginPotentialSelectionTextDrag(e) {
  if (!isSuperDragFeatureEnabled()) return;
  if (isTextInputElement(e.target)) return;

  const inputSource = findInputOrTextareaSource(e.target);
  const editableRoot = inputSource || findContentEditableDropTarget(e.target);
  if (editableRoot) return;

  const text = getPageSelectedTextAtPointer(e.clientX, e.clientY);
  if (!text) return;

  potentialDragSelection = {
    text,
    startX: e.clientX,
    startY: e.clientY,
    dragging: false,
    direction: '',
    nativeDragDeadline: 0
  };
}

function beginPotentialLinkDrag(e, imagePriorityCandidate = null) {
  if (!isSuperDragFeatureEnabled()) return false;
  if (!e || e.button !== 0) return false;
  if (isTextInputElement(e.target)) return false;
  const inputSource = findInputOrTextareaSource(e.target);
  const editableRoot = inputSource || findContentEditableDropTarget(e.target);
  if (editableRoot) return false;
  if (getPageSelectedTextAtPointer(e.clientX, e.clientY)) return false;

  const link = findSuperDragLinkFromEvent(e);
  const url = resolveSuperDragLinkUrl(link);
  if (!link || !url) return false;

  // 图片拖拽开启时，直接从图片发起的动作交给图片拖拽；链接兜底只处理链接文字/覆盖层。
  if (
    settings?.enableImageDrag &&
    imagePriorityCandidate &&
    shouldArmPotentialImageDrag(e, imagePriorityCandidate)
  ) {
    return false;
  }

  const sp = clientToSuperDragViewport(e.clientX, e.clientY);
  const text = (link.textContent || link.getAttribute('title') || link.getAttribute('aria-label') || url).trim();
  potentialDragLink = {
    link,
    url,
    text: text || url,
    startX: e.clientX,
    startY: e.clientY,
    viewportStartX: sp.x,
    viewportStartY: sp.y,
    carouselInfo: getImageDragCarouselContext(link),
    dragging: false,
    direction: '',
    nativeDragDeadline: 0,
    carouselYielding: false
  };
  return true;
}

function isNativeDraggableElement(element) {
  let el = element;
  let depth = 0;
  while (el && el !== document.body && depth < 12) {
    try {
      if (el.getAttribute && el.getAttribute('draggable') === 'true') {
        if (el.hasAttribute('data-superdrag-draggable-fix')) {
          el = el.parentElement;
          depth++;
          continue;
        }
        return true;
      }
    } catch (err) { /* ignore */ }
    el = el.parentElement;
    depth++;
  }
  return false;
}

// 超级拖拽功能 - 处理拖拽开始
function handleDragStart(e) {
  if (!isTrustedUserEvent(e)) return;
  if (!isSuperDragFeatureEnabled()) return;
  beginSuperDragSession();

  // pointer 合成可编辑区拖拽已启动时，忽略迟到的 dragstart（勿 resetDragInfo，保留 pointer 状态）
  if (
    potentialDragEditable?.dragging ||
    cachedSuperDragSession.mode === 'pointerEditable'
  ) {
    try {
      e.preventDefault();
    } catch (err) { /* ignore */ }
    return;
  }

  // 直接 IMG 或轮播图中的图片可能被页面脚本阻止原生 dragstart；
  // pointer 合成图片拖拽已经启动时，忽略迟到的原生 dragstart，保留合成拖拽状态。
  if (potentialDragImage?.dragging || cachedSuperDragSession.mode === 'pointerImage') {
    try {
      e.preventDefault();
    } catch (err) { /* ignore */ }
    return;
  }
  if (potentialDragLink?.dragging || cachedSuperDragSession.mode === 'pointerLink') {
    try {
      e.preventDefault();
    } catch (err) { /* ignore */ }
    return;
  }
  if (shouldLetCarouselHandleNativeImageDragStart(e, potentialDragImage)) {
    try {
      e.preventDefault();
    } catch (err) { /* ignore */ }
    return;
  }

  const dragRoot = findEditableDragRootFromEvent(e);

  // contenteditable 内选中后外拖：跟踪超级拖拽，不改写 dataTransfer（保留原生拖放）
  if (dragRoot && dragRoot.isContentEditable) {
    const editableText = getEditableDragTextWithCache(dragRoot, potentialDragEditable);
    if (!editableText) {
      resetDragInfo();
      return;
    }
    const dragStartViewport = clientToSuperDragViewport(e.clientX, e.clientY);
    setupEditableTextDragInfo(dragStartViewport, e.target, editableText, dragRoot, {
      x: e.clientX,
      y: e.clientY
    });
    potentialDragEditable = null;
    markSuperDragDataTransfer(e.dataTransfer, dragInfo.type === 'link' ? 'link' : 'text');
    editableSuperDragSessionSynced = false;
    return;
  }

  const dragStartViewport = clientToSuperDragViewport(e.clientX, e.clientY);

  // input/textarea 内选中后拖出：跟踪超级拖拽，但不改写 dataTransfer（保留浏览器默认 payload，框间拖放仍走原生）
  if (dragRoot && dragRoot.tagName &&
      (dragRoot.tagName === 'INPUT' || dragRoot.tagName === 'TEXTAREA')) {
    const inputText = getEditableDragTextWithCache(dragRoot, potentialDragEditable);
    if (!inputText) {
      resetDragInfo();
      return;
    }
    setupEditableTextDragInfo(dragStartViewport, e.target, inputText, dragRoot, {
      x: e.clientX,
      y: e.clientY
    });
    potentialDragEditable = null;
    markSuperDragDataTransfer(e.dataTransfer, 'text');
    editableSuperDragSessionSynced = false;
    return;
  }

  // 初始化拖拽操作信息
  dragInfo = {
    startX: dragStartViewport.x,
    startY: dragStartViewport.y,
    target: e.target,
    type: '',
    url: '',
    text: '',
    image: '',
    direction: '',
    time: Date.now(),
    savedSelection: null
  };

  // 只有拖拽起点确实落在可见选区内时才按“选中文本”处理。
  const dragStartClient = getDragPointerClient(e);
  const selectedText = getPageSelectedTextAtPointer(
    dragStartClient.clientX,
    dragStartClient.clientY
  );
  
  // 如果有选中文本，则优先使用文本拖拽，无论是否在链接上
  if (selectedText) {
    // 原生 HTML5 拖拽优先：可拖到输入框等；pointer 合成仅作 Bing 等 dragstart 被拦截时的兜底
    potentialDragSelection = null;

    dragInfo.type = 'text';
    dragInfo.text = selectedText;
    
    // 保存用户选择，防止Linux和macOS上拖拽时失去焦点
    if (isLinuxOS || isMacOS) {
      dragInfo.savedSelection = selectedText;
    }
    
    // 检查选中的文本是否为链接
    if (isValidUrl(selectedText)) {
      let url = selectedText;
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('ftp://')) {
        url = 'https://' + url;
      }
      dragInfo.type = 'link';
      dragInfo.url = url;
      dragInfo.text = selectedText;
    }
    
    e.dataTransfer.setData('text/plain', selectedText);
    markSuperDragDataTransfer(e.dataTransfer, dragInfo.type === 'link' ? 'link' : 'text');
    syncSuperDragSessionToStorage();
    potentialDragEditable = null;
    potentialDragLink = null;
    return;
  }
  
  // 检查拖拽目标是否为图片（含增强模式：透明层、background-image、父级查找）
  const imageFound = settings.enableImageDrag
    ? resolveImageCandidateForDrag({
        target: e.target,
        clientX: dragStartClient.clientX,
        clientY: dragStartClient.clientY
      })
    : null;
  if (imageFound) {
    const imageCarouselInfo = getImageDragCarouselContext(getImageDragSourceElement(imageFound, e.target));
    if (shouldPreferNativeLinkDragOverImage(e, imageFound, imageCarouselInfo)) {
      potentialDragImage = null;
    } else {
      if (shouldBlockImageSuperDragForTarget(e.target)) {
        resetDragInfo();
        return;
      }
      potentialDragImage = null;
      potentialDragLink = null;
      enableSyntheticSuperDragSelectionGuard(true);
      dragInfo.type = 'image';
      dragInfo.url = imageFound.url;
      if (imageFound.imgElement && imageFound.imgElement.alt) {
        dragInfo.text = imageFound.imgElement.alt;
      }
      e.dataTransfer.setData('text/plain', imageFound.url);
      markSuperDragDataTransfer(e.dataTransfer, 'link');
      syncSuperDragSessionToStorage();
      return;
    }
  }
  
  // 检查拖拽目标是否为链接或位于链接内
  let linkElement = findSuperDragLinkFromEvent(e);
  if (!linkElement) {
    linkElement = e.target;
    while (linkElement && linkElement.tagName !== 'A' && linkElement !== document.body) {
      linkElement = linkElement.parentElement;
    }
  }

  if (linkElement && linkElement.tagName === 'A') {
    const url = resolveSuperDragLinkUrl(linkElement);
    if (!url) {
      resetDragInfo();
      return;
    }
    // 拖拽开始于链接元素
    dragInfo.type = 'link';
    dragInfo.url = url;
    
    // 如果链接有文本内容，也保存下来
    dragInfo.text = linkElement.textContent.trim() || dragInfo.url;
    
    e.dataTransfer.setData('text/plain', dragInfo.url);
    markSuperDragDataTransfer(e.dataTransfer, 'link');
    syncSuperDragSessionToStorage();
    potentialDragLink = null;
    return;
  }

  // 无选区、非链接/图片时不接管，避免破坏页面原生拖拽
  resetDragInfo();
}

/** 根据位移得到超级拖拽 8 向（屏幕坐标 y 向下为正） */
function computeSuperDragDirection(dx, dy) {
  if (dx === 0 && dy === 0) return '';
  const deg = Math.atan2(dy, dx) * (180 / Math.PI);
  const a = deg >= 0 ? deg : deg + 360;
  const sector = Math.floor((a + 22.5) / 45) % 8;
  const order = ['right', 'downRight', 'down', 'downLeft', 'left', 'upLeft', 'up', 'upRight'];
  return order[sector];
}

const SUPER_DRAG_DIR_I18N = {
  up: 'dragUp',
  upRight: 'dragUpRight',
  right: 'dragRight',
  downRight: 'dragDownRight',
  down: 'dragDown',
  downLeft: 'dragDownLeft',
  left: 'dragLeft',
  upLeft: 'dragUpLeft'
};

const SUPER_DRAG_COMPASS_LAYOUT = [
  { dir: 'upLeft', sym: '↖' },
  { dir: 'up', sym: '↑' },
  { dir: 'upRight', sym: '↗' },
  { dir: 'left', sym: '←' },
  { dir: null, sym: '' },
  { dir: 'right', sym: '→' },
  { dir: 'downLeft', sym: '↙' },
  { dir: 'down', sym: '↓' },
  { dir: 'downRight', sym: '↘' }
];

function getSuperDragActionForDirection(dir) {
  const map = {
    up: settings.dragUpAction,
    upRight: settings.dragUpRightAction,
    right: settings.dragRightAction,
    downRight: settings.dragDownRightAction,
    down: settings.dragDownAction,
    downLeft: settings.dragDownLeftAction,
    left: settings.dragLeftAction,
    upLeft: settings.dragUpLeftAction
  };
  return map[dir] || 'background';
}

function shouldAutoDownloadSuperDragPayload(contentType, url) {
  return !!(
    settings &&
    settings.autoDownloadOnDragFile &&
    url &&
    (contentType === 'image' || (contentType === 'link' && isDownloadableFileUrl(url)))
  );
}

function getSuperDragCompassPayloadUrl(contentType) {
  if (contentType === 'image') {
    return (
      dragInfo.url ||
      potentialDragImage?.url ||
      cachedSuperDragSession.url ||
      ''
    );
  }
  if (contentType === 'link') {
    return dragInfo.url || cachedSuperDragSession.url || '';
  }
  return '';
}

function getEffectiveSuperDragActionForDirection(dir, contentType, url) {
  if (shouldAutoDownloadSuperDragPayload(contentType, url)) return 'download';
  return getSuperDragActionForDirection(dir);
}

function getSuperDragActionLabel(actionType) {
  if (!actionType || actionType === 'none') {
    return getI18nMessage('noAction', 'No action');
  }
  const keyByAction = {
    foreground: 'foregroundAction',
    background: 'backgroundAction',
    popupView: 'popupViewAction',
    incognito: 'incognitoAction',
    copy: 'copyAction',
    download: 'downloadAction',
    splitLeft: 'splitViewLeft',
    splitRight: 'splitViewRight',
    splitUp: 'splitViewUp',
    splitDown: 'splitViewDown'
  };
  const key = keyByAction[actionType];
  return key ? getI18nMessage(key, actionType === 'download' ? 'Download' : actionType) : actionType;
}


const SUPER_DRAG_POPUP_RECENT_OPEN_SUPPRESS_MS = 1200;
const superDragPopupPendingUrlKeys = new Set();
const superDragPopupRecentUrlKeys = new Map();
const superDragPopupActiveWindows = new Map();
const superDragPopupUrlIndex = new Map();

function normalizeSuperDragPopupUrl(rawUrl) {
  let url = String(rawUrl || '').trim();
  if (!url) return '';
  try {
    return new URL(url).href;
  } catch (e) {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      url = 'https://' + url;
    }
    try {
      return new URL(url).href;
    } catch (_) {
      return '';
    }
  }
}

function normalizeSuperDragPopupUrlKey(url) {
  try {
    return new URL(String(url || '')).href;
  } catch (e) {
    return String(url || '').trim();
  }
}

function hashSuperDragPopupWindowName(input) {
  const text = String(input || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getSuperDragPopupWindowName(urlKey) {
  return `mouse_preview_${hashSuperDragPopupWindowName(urlKey)}`;
}

function cleanupRecentSuperDragPopupUrlKeys(now = Date.now()) {
  for (const [urlKey, timestamp] of superDragPopupRecentUrlKeys.entries()) {
    if (!timestamp || now - timestamp > SUPER_DRAG_POPUP_RECENT_OPEN_SUPPRESS_MS) {
      superDragPopupRecentUrlKeys.delete(urlKey);
    }
  }
}

function markRecentSuperDragPopupUrlKey(urlKey) {
  if (!urlKey) return;
  const now = Date.now();
  cleanupRecentSuperDragPopupUrlKeys(now);
  superDragPopupRecentUrlKeys.set(urlKey, now);
}

function isRecentSuperDragPopupUrlKey(urlKey) {
  if (!urlKey) return false;
  const now = Date.now();
  cleanupRecentSuperDragPopupUrlKeys(now);
  const timestamp = superDragPopupRecentUrlKeys.get(urlKey);
  return !!timestamp && now - timestamp <= SUPER_DRAG_POPUP_RECENT_OPEN_SUPPRESS_MS;
}

function cleanupClosedSuperDragPopupWindows() {
  for (const [windowName, record] of superDragPopupActiveWindows.entries()) {
    try {
      if (record && record.window && record.window.closed) {
        superDragPopupActiveWindows.delete(windowName);
        if (record.urlKey && superDragPopupUrlIndex.get(record.urlKey) === windowName) {
          superDragPopupUrlIndex.delete(record.urlKey);
        }
      }
    } catch (e) {
      superDragPopupActiveWindows.delete(windowName);
    }
  }
}

function getActiveSuperDragPopupByUrl(url) {
  cleanupClosedSuperDragPopupWindows();
  const urlKey = normalizeSuperDragPopupUrlKey(url);
  const windowName = superDragPopupUrlIndex.get(urlKey);
  if (!windowName) return null;
  const record = superDragPopupActiveWindows.get(windowName);
  if (!record || !record.window || record.window.closed) return null;
  return record;
}

function getSuperDragPopupEffectiveMaxWindows() {
  const raw = settings && settings.previewMaxWindows != null ? settings.previewMaxWindows : 20;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return Number.POSITIVE_INFINITY;
  return n;
}

function enforceSuperDragPopupWindowLimit() {
  cleanupClosedSuperDragPopupWindows();
  const max = getSuperDragPopupEffectiveMaxWindows();
  if (!Number.isFinite(max)) return;
  while (superDragPopupActiveWindows.size >= max) {
    const oldest = superDragPopupActiveWindows.keys().next().value;
    if (!oldest) break;
    const record = superDragPopupActiveWindows.get(oldest);
    try {
      if (record && record.window && !record.window.closed) record.window.close();
    } catch (e) { /* ignore */ }
    superDragPopupActiveWindows.delete(oldest);
    if (record && record.urlKey && superDragPopupUrlIndex.get(record.urlKey) === oldest) {
      superDragPopupUrlIndex.delete(record.urlKey);
    }
  }
}

function getSuperDragPopupScreenRect() {
  const left = Number.isFinite(window.screen?.availLeft) ? window.screen.availLeft : 0;
  const top = Number.isFinite(window.screen?.availTop) ? window.screen.availTop : 0;
  const width = Math.max(100, Number.isFinite(window.screen?.availWidth) ? window.screen.availWidth : (window.screen?.width || 1280));
  const height = Math.max(100, Number.isFinite(window.screen?.availHeight) ? window.screen.availHeight : (window.screen?.height || 720));
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function clampSuperDragPopupPosition(left, top, width, height, screenRect) {
  return {
    left: Math.min(Math.max(left, screenRect.left), Math.max(screenRect.left, screenRect.right - width)),
    top: Math.min(Math.max(top, screenRect.top), Math.max(screenRect.top, screenRect.bottom - height))
  };
}

function getSuperDragPopupAnchorScreenPoint() {
  const browserTopChrome = Math.max(0, (window.outerHeight || window.innerHeight || 0) - (window.innerHeight || 0));
  const browserLeftChrome = Math.max(0, ((window.outerWidth || window.innerWidth || 0) - (window.innerWidth || 0)) / 2);
  return {
    screenX: (Number.isFinite(window.screenX) ? window.screenX : (window.screenLeft || 0)) + browserLeftChrome + (mouseCurrentPosition?.x || 0),
    screenY: (Number.isFinite(window.screenY) ? window.screenY : (window.screenTop || 0)) + browserTopChrome + (mouseCurrentPosition?.y || 0)
  };
}

function calculateSuperDragPopupPosition(width, height) {
  const screenRect = getSuperDragPopupScreenRect();
  const margin = 16;
  const position = settings?.previewPosition || 'cursor';
  let left;
  let top;
  if (position === 'center') {
    left = screenRect.left + (screenRect.width - width) / 2;
    top = screenRect.top + (screenRect.height - height) / 2;
  } else if (position === 'corner') {
    left = screenRect.right - width - 20;
    top = screenRect.top + 20;
  } else {
    const anchor = getSuperDragPopupAnchorScreenPoint();
    left = anchor.screenX + margin;
    top = anchor.screenY + margin;
    if (left + width > screenRect.right) left = anchor.screenX - width - margin;
    if (top + height > screenRect.bottom) top = anchor.screenY - height - margin;
  }
  return clampSuperDragPopupPosition(left, top, width, height, screenRect);
}

function requestExistingSuperDragPopupFocus(urlKey, targetUrl, onDone) {
  if (!urlKey || !isExtensionValid) {
    if (typeof onDone === 'function') onDone(false);
    return false;
  }
  try {
    chrome.runtime.sendMessage({
      type: '__mouseGestureFindPreviewPopup',
      urlKey,
      url: targetUrl
    }, (res) => {
      if (chrome.runtime.lastError) {
        if (chrome.runtime.lastError.message && chrome.runtime.lastError.message.includes('Extension context invalidated')) {
          isExtensionValid = false;
        }
        if (typeof onDone === 'function') onDone(false);
        return;
      }
      if (typeof onDone === 'function') onDone(!!(res && res.ok && res.found));
    });
    return true;
  } catch (e) {
    if (e?.message?.includes('Extension context invalidated')) isExtensionValid = false;
    if (typeof onDone === 'function') onDone(false);
    return false;
  }
}

function registerSuperDragPopupWithBackground(urlKey, targetUrl, title) {
  if (!urlKey || !isExtensionValid) return;
  try {
    chrome.runtime.sendMessage({
      type: '__mouseGestureRegisterPreviewPopup',
      urlKey,
      url: targetUrl,
      title: title || ''
    }, () => {
      const ignored = chrome.runtime.lastError;
      if (ignored && ignored.message && ignored.message.includes('Extension context invalidated')) {
        isExtensionValid = false;
      }
    });
  } catch (e) {
    if (e?.message?.includes('Extension context invalidated')) isExtensionValid = false;
  }
}

function openSuperDragPopupWindowNow(targetUrl, title, urlKey) {
  enforceSuperDragPopupWindowLimit();
  const screenRect = getSuperDragPopupScreenRect();
  const requestedWidth = parseInt(settings?.previewDefaultWidth, 10);
  const requestedHeight = parseInt(settings?.previewDefaultHeight, 10);
  const width = Math.min(Math.max(100, Number.isFinite(requestedWidth) ? requestedWidth : 480), screenRect.width);
  const height = Math.min(Math.max(100, Number.isFinite(requestedHeight) ? requestedHeight : 640), screenRect.height);
  const { left, top } = calculateSuperDragPopupPosition(width, height);
  const windowName = getSuperDragPopupWindowName(urlKey);
  const features = [
    `width=${width}`,
    `height=${height}`,
    `left=${Math.round(left)}`,
    `top=${Math.round(top)}`,
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
    'directories=no',
    'scrollbars=yes',
    'resizable=yes',
    'chrome=no'
  ].join(',');

  const popupWindow = window.open(targetUrl, windowName, features);
  if (!popupWindow) {
    showGestureHint(getI18nMessage('popupBlocked', 'Popup Blocked'));
    return null;
  }

  markRecentSuperDragPopupUrlKey(urlKey);
  superDragPopupActiveWindows.set(windowName, { window: popupWindow, url: targetUrl, urlKey, title: title || '' });
  if (urlKey) superDragPopupUrlIndex.set(urlKey, windowName);
  registerSuperDragPopupWithBackground(urlKey, targetUrl, title);
  const timer = setInterval(() => {
    try {
      if (popupWindow.closed) {
        clearInterval(timer);
        superDragPopupActiveWindows.delete(windowName);
        if (urlKey && superDragPopupUrlIndex.get(urlKey) === windowName) {
          superDragPopupUrlIndex.delete(urlKey);
        }
      }
    } catch (e) {
      clearInterval(timer);
      superDragPopupActiveWindows.delete(windowName);
    }
  }, 500);
  return popupWindow;
}

function openUrlInSuperDragPopupView(url, title = '') {
  const targetUrl = normalizeSuperDragPopupUrl(url);
  if (!targetUrl) return false;

  try {
    if (typeof globalThis.MouseExtPreviewOpenPopup === 'function') {
      globalThis.MouseExtPreviewOpenPopup(targetUrl, title || targetUrl);
      return true;
    }
  } catch (e) { /* fallback below */ }

  const urlKey = normalizeSuperDragPopupUrlKey(targetUrl);
  const existing = getActiveSuperDragPopupByUrl(targetUrl);
  if (existing) {
    try { existing.window.focus(); } catch (e) { /* ignore */ }
    return true;
  }
  if (isRecentSuperDragPopupUrlKey(urlKey) || superDragPopupPendingUrlKeys.has(urlKey)) return true;

  superDragPopupPendingUrlKeys.add(urlKey);
  const sent = requestExistingSuperDragPopupFocus(urlKey, targetUrl, (found) => {
    if (found) {
      superDragPopupPendingUrlKeys.delete(urlKey);
      return;
    }
    try {
      openSuperDragPopupWindowNow(targetUrl, title || targetUrl, urlKey);
    } finally {
      superDragPopupPendingUrlKeys.delete(urlKey);
    }
  });

  if (!sent) {
    try {
      openSuperDragPopupWindowNow(targetUrl, title || targetUrl, urlKey);
    } finally {
      superDragPopupPendingUrlKeys.delete(urlKey);
    }
  }
  return true;
}

function resolveSuperDragSearchEngineUrl(direction) {
  const keyByDir = {
    up: 'dragUpSearchEngine',
    upRight: 'dragUpRightSearchEngine',
    right: 'dragRightSearchEngine',
    downRight: 'dragDownRightSearchEngine',
    down: 'dragDownSearchEngine',
    downLeft: 'dragDownLeftSearchEngine',
    left: 'dragLeftSearchEngine',
    upLeft: 'dragUpLeftSearchEngine'
  };
  const key = keyByDir[direction];
  const perDir = key && settings?.[key] != null ? String(settings[key]).trim() : '';
  const fallback = (settings?.dragSearchEngine && String(settings.dragSearchEngine).trim()) || 'https://www.google.com/search?q={q}';
  return perDir || fallback;
}

function buildSuperDragSearchUrl(text, direction) {
  const q = String(text || '').trim();
  if (!q) return '';
  const engine = resolveSuperDragSearchEngineUrl(direction);
  if (!engine) return '';
  if (engine.includes('{q}')) {
    return engine.replace('{q}', encodeURIComponent(q));
  }
  try {
    const u = new URL(engine);
    u.searchParams.set('q', q);
    return u.href;
  } catch (e) {
    const sep = engine.includes('?') ? '&' : '?';
    return engine + sep + 'q=' + encodeURIComponent(q);
  }
}

function openSuperDragPayloadInPopupView(payload) {
  if (!payload) return false;
  if (payload.type === 'text') {
    const searchUrl = buildSuperDragSearchUrl(payload.text, payload.dragDirection);
    return openUrlInSuperDragPopupView(searchUrl, payload.text || searchUrl);
  }
  return openUrlInSuperDragPopupView(payload.url, payload.title || payload.text || payload.url);
}

function ensureSuperDragCompassStyles() {
  if (typeof MouseExtUiHost === 'undefined') return;
  MouseExtUiHost.appendStyle(
    `
#mouse-super-drag-compass {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 1;
  pointer-events: none;
  user-select: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  filter: drop-shadow(0 6px 18px rgba(0,0,0,0.35));
  visibility: hidden;
  transition: none !important;
}
#mouse-super-drag-compass.sd-compass-ready {
  visibility: visible;
}
#mouse-super-drag-compass .sd-compass-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 6px 8px 8px;
  border-radius: 12px;
  background: rgba(12, 12, 20, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
#mouse-super-drag-compass .sd-grid-wrap {
  position: relative;
  width: fit-content;
}
#mouse-super-drag-compass .sd-compass-grid {
  display: grid;
  grid-template-columns: repeat(3, 26px);
  grid-template-rows: repeat(3, 26px);
  gap: 2px;
  justify-items: center;
  align-items: center;
}
#mouse-super-drag-compass .sd-hub-cell {
  background: transparent !important;
  box-shadow: none !important;
  transform: none !important;
}
#mouse-super-drag-compass .sd-dir {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.55);
  transition: background 0.12s ease, color 0.12s ease, transform 0.12s ease;
}
#mouse-super-drag-compass .sd-dir.active {
  background: rgba(255, 107, 107, 0.88);
  color: #fff;
  transform: scale(1.08);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
}
#mouse-super-drag-compass .sd-hub {
  position: relative;
  z-index: 2;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.35);
  box-shadow: 0 0 0 2px rgba(255, 107, 107, 0.45);
}
#mouse-super-drag-compass .sd-vector {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 2px;
  margin-top: -1px;
  transform-origin: 0 50%;
  background: linear-gradient(90deg, rgba(255, 107, 107, 0.2), rgba(255, 107, 107, 0.95));
  border-radius: 1px;
  opacity: 0;
  z-index: 1;
  pointer-events: none;
  transition: opacity 0.1s ease;
}
#mouse-super-drag-compass .sd-vector.visible {
  opacity: 1;
}
#mouse-super-drag-compass .sd-caption {
  margin-top: 6px;
  text-align: center;
  font-size: 11px;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.92);
  max-width: 140px;
  min-height: 28px;
}
#mouse-super-drag-compass .sd-action-name {
  display: block;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.62);
  margin-top: 1px;
}
`,
    'mouse-super-drag-compass-style'
  );
}

function clientToSuperDragViewport(clientX, clientY) {
  const c = toTopWindowClientCoords(clientX, clientY);
  let x = c.x;
  let y = c.y;
  if (window === window.top && c.needsConversion) {
    const pts = convertIframeLocalPointsWithSource(
      [{ x, y }],
      crossFrameGestureSourceFrameId,
      crossFrameGestureSourceFrameUrl
    );
    if (pts && pts[0]) {
      x = pts[0].x;
      y = pts[0].y;
    }
  }
  return { x, y };
}

function applySuperDragSessionSnapshot(data) {
  if (!data) return;
  cachedSuperDragSession = {
    active: !!data.active,
    startX: data.startX || 0,
    startY: data.startY || 0,
    type: data.type || '',
    mode: data.mode || '',
    direction: data.direction || '',
    url: data.url || '',
    text: data.text || ''
  };
}

function syncSuperDragSessionToStorage(extra) {
  const payload = Object.assign(
    {
      active: true,
      startX: dragInfo.startX,
      startY: dragInfo.startY,
      type: dragInfo.type,
      mode: 'html5drag'
    },
    extra || {}
  );
  applySuperDragSessionSnapshot(payload);
  try {
    writeSuperDragStorage(payload);
  } catch (e) {
    console.log('超级拖拽跨帧状态同步失败:', e.message);
  }
}

function clearSuperDragSessionStorage() {
  applySuperDragSessionSnapshot({ active: false });
  lastSuperDragSessionDirectionWritten = '';
  lastSuperDragSessionDirectionWriteAt = 0;
  try {
    writeSuperDragStorage({ active: false });
  } catch (e) {
    console.log('超级拖拽跨帧状态清除失败:', e.message);
  }
}

function writeSuperDragStorage(payload) {
  const key = getSuperDragStorageKey();
  if (!key) return;
  try {
    chrome.storage.local.set({ [key]: payload });
  } catch (e) {
    console.log('超级拖拽跨帧状态同步失败:', e.message);
  }
}

function initCrossFrameSuperDragStorageListener() {
  if (superDragStorageListenerReady) return;
  superDragStorageListenerReady = true;
  initContentContext(() => {
    const sdKey = getSuperDragStorageKey();
    if (!sdKey) return;
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        const key = getSuperDragStorageKey();
        if (!key || area !== 'local' || !changes[key]) return;
        applySuperDragSessionSnapshot(changes[key].newValue);
      });
      chrome.storage.local.get([sdKey], (result) => {
        applySuperDragSessionSnapshot(result?.[sdKey]);
      });
    } catch (e) {
      console.log('超级拖拽跨帧 storage 监听失败:', e.message);
    }
  });
}

function hideSuperDragCompassOnTop() {
  if (superDragCompassEl && superDragCompassEl.isConnected) {
    superDragCompassEl.remove();
  }
  superDragCompassEl = null;
  superDragCompassPlacedKey = '';
}

function applySuperDragCompassHide() {
  if (superDragCompassForwardRafId) {
    cancelAnimationFrame(superDragCompassForwardRafId);
    superDragCompassForwardRafId = 0;
  }
  pendingSuperDragCompassForward = null;
  if (window === window.top) {
    hideSuperDragCompassOnTop();
    return;
  }
  sendCrossFrameSilent({ action: 'superDragCompassHide' });
}

function hideSuperDragCompass() {
  applySuperDragCompassHide();
}

function applySuperDragCompassUpdate(startX, startY, currentX, currentY, direction, contentType) {
  if (window === window.top) {
    updateSuperDragCompass(startX, startY, currentX, currentY, direction, contentType);
    return;
  }
  pendingSuperDragCompassForward = { startX, startY, currentX, currentY, direction, contentType };
  if (superDragCompassForwardRafId) return;
  superDragCompassForwardRafId = requestAnimationFrame(() => {
    superDragCompassForwardRafId = 0;
    const data = pendingSuperDragCompassForward;
    pendingSuperDragCompassForward = null;
    if (!data) return;
    sendCrossFrameSilent({
      action: 'superDragCompassFromIframe',
      data
    });
  });
}

function getActiveEditableDragSource() {
  if (potentialDragEditable && potentialDragEditable.root) {
    return potentialDragEditable.root;
  }
  if (dragInfo && dragInfo.editableSource) {
    return dragInfo.editableSource;
  }
  return null;
}

function shouldHideSuperDragCompassAtPointer(pointerClient, editableSource) {
  return isPointerWithinEditableSourceRect(pointerClient, editableSource);
}

function processSuperDragCompassMove(startX, startY, curX, curY, contentType, pointerClient, editableSource) {
  const source = editableSource !== undefined ? editableSource : getActiveEditableDragSource();
  if (shouldHideSuperDragCompassAtPointer(pointerClient, source)) {
    applySuperDragCompassHide();
    return;
  }
  const dx = curX - startX;
  const dy = curY - startY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < dragDistanceThreshold || !contentType) {
    applySuperDragCompassHide();
    return;
  }
  const direction = computeSuperDragDirection(dx, dy);
  if (!isSuperDragCompassContentAllowed(contentType)) {
    applySuperDragCompassHide();
    return;
  }
  lockSuperDragDirection(direction);
  if (dragInfo.type && contentType === dragInfo.type) {
    dragInfo.direction = direction;
  }
  if (cachedSuperDragSession.active) {
    const payload = Object.assign({}, cachedSuperDragSession, { direction });
    applySuperDragSessionSnapshot(payload);
    const now = Date.now();
    if (
      direction !== lastSuperDragSessionDirectionWritten ||
      now - lastSuperDragSessionDirectionWriteAt >= SUPER_DRAG_SESSION_DIRECTION_SYNC_MS
    ) {
      lastSuperDragSessionDirectionWritten = direction;
      lastSuperDragSessionDirectionWriteAt = now;
      try {
    writeSuperDragStorage(payload);
      } catch (e) { /* ignore */ }
    }
  }
  applySuperDragCompassUpdate(startX, startY, curX, curY, direction, contentType);
}

function handleSuperDragDragOver(e) {
  if (!isTrustedUserEvent(e)) return;
  if (!isSuperDragFeatureEnabled()) return;

  const editableSource = getActiveEditableDragSource();
  const pointer = getDragPointerClient(e);
  const dropTarget = resolveNativeDropTarget(e);

  // 仍在源输入框内：隐藏罗盘，保留原生拖出/框间拖放
  if (editableSource && shouldHideSuperDragCompassAtPointer(pointer, editableSource)) {
    applySuperDragCompassHide();
    return;
  }
  if (editableSource) {
    syncEditableSuperDragSessionIfOutsideSource(pointer);
  }
  // 拖向其他输入框：隐藏罗盘，走原生 drop
  if (editableSource && dropTarget && dropTarget !== editableSource) {
    applySuperDragCompassHide();
    return;
  }
  // 页面文字 HTML5 拖拽到输入框
  if (!editableSource && dropTarget) {
    applySuperDragCompassHide();
    return;
  }

  const tracking = isSuperDragTrackingActive();
  if (tracking) {
    try {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    } catch (err) { /* ignore */ }
  }
  if (!tracking) return;

  let startX;
  let startY;
  let contentType;
  if (dragInfo.type) {
    startX = dragInfo.startX;
    startY = dragInfo.startY;
    contentType = dragInfo.type;
  } else if (cachedSuperDragSession.active && cachedSuperDragSession.type) {
    startX = cachedSuperDragSession.startX;
    startY = cachedSuperDragSession.startY;
    contentType = cachedSuperDragSession.type;
  } else {
    return;
  }

  const cur = clientToSuperDragViewport(pointer.clientX, pointer.clientY);
  processSuperDragCompassMove(startX, startY, cur.x, cur.y, contentType, pointer, editableSource);
}

function clampSuperDragCompassTopLeft(left, top, width, height) {
  const pad = 10;
  return {
    left: Math.max(pad, Math.min(window.innerWidth - pad - width, left)),
    top: Math.max(pad, Math.min(window.innerHeight - pad - height, top))
  };
}

/** 重置定位基准；后续用 translate 按视口 delta 移动，避免部分页面对 html/body 的 transform 导致 fixed+left/top 与 getBoundingClientRect 不一致 */
function resetSuperDragCompassTransform(el) {
  if (!el) return;
  hideSuperDragCompassUntilPlaced(el);
  el.style.left = '0px';
  el.style.top = '0px';
  el.style.transform = 'none';
}

function translateSuperDragCompassByViewportDelta(el, dx, dy) {
  if (!el) return;
  el.style.transform = 'translate(' + Math.round(dx) + 'px, ' + Math.round(dy) + 'px)';
}

function hideSuperDragCompassUntilPlaced(el) {
  if (el) el.classList.remove('sd-compass-ready');
}

function revealSuperDragCompass(el) {
  if (el) el.classList.add('sd-compass-ready');
}

function getSuperDragCompassPlacedKey(startX, startY) {
  return startX + '|' + startY + '|' + getSuperDragCompassPositionMode();
}

function normalizeSuperDragCompassPosition(mode) {
  if (mode && SUPER_DRAG_COMPASS_POSITIONS.includes(mode)) return mode;
  return 'compassHub';
}

function getSuperDragCompassPositionMode() {
  return normalizeSuperDragCompassPosition(settings && settings.superDragCompassPosition);
}

function shouldShowSuperDragCompass() {
  return getSuperDragCompassPositionMode() !== 'compassHidden';
}

function isSuperDragCompassContentAllowed(contentType) {
  if (contentType === 'text' && settings && !settings.enableDragTextSearch) return false;
  return true;
}

function positionSuperDragCompassAtDragStart(el, startX, startY) {
  const hub = el && el.querySelector('.sd-hub');
  if (!hub) return;
  resetSuperDragCompassTransform(el);
  const hubRect = hub.getBoundingClientRect();
  const hubCx = hubRect.left + hubRect.width / 2;
  const hubCy = hubRect.top + hubRect.height / 2;
  translateSuperDragCompassByViewportDelta(el, startX - hubCx, startY - hubCy);
  const panelRect = el.getBoundingClientRect();
  const clamped = clampSuperDragCompassTopLeft(
    panelRect.left,
    panelRect.top,
    panelRect.width || 110,
    panelRect.height || 130
  );
  if (
    Math.abs(clamped.left - panelRect.left) >= 0.5 ||
    Math.abs(clamped.top - panelRect.top) >= 0.5
  ) {
    translateSuperDragCompassByViewportDelta(
      el,
      startX - hubCx + (clamped.left - panelRect.left),
      startY - hubCy + (clamped.top - panelRect.top)
    );
  }
  revealSuperDragCompass(el);
}

function positionSuperDragCompassNearDrag(el, startX, startY, side) {
  resetSuperDragCompassTransform(el);
  const rect = el.getBoundingClientRect();
  const w = rect.width || 110;
  const h = rect.height || 130;
  const pad = 10;
  const gap = SUPER_DRAG_COMPASS_DRAG_GAP;
  let targetLeft = startX - w / 2;
  let targetTop = startY - h - gap;
  switch (side) {
    case 'compassRight':
      targetLeft = startX + gap;
      targetTop = startY - h / 2;
      break;
    case 'compassBelow':
      targetLeft = startX - w / 2;
      targetTop = startY + gap;
      break;
    case 'compassLeft':
      targetLeft = startX - w - gap;
      targetTop = startY - h / 2;
      break;
    case 'compassAbove':
    default:
      if (targetTop < pad) targetTop = startY + 28;
      break;
  }
  const pos = clampSuperDragCompassTopLeft(targetLeft, targetTop, w, h);
  translateSuperDragCompassByViewportDelta(el, pos.left - rect.left, pos.top - rect.top);
  revealSuperDragCompass(el);
}

function positionSuperDragCompass(el, startX, startY) {
  const mode = getSuperDragCompassPositionMode();
  if (!el || mode === 'compassHidden') return;

  if (mode === 'compassHub') {
    positionSuperDragCompassAtDragStart(el, startX, startY);
    return;
  }

  if (mode === 'compassAbove' || mode === 'compassRight' || mode === 'compassBelow' || mode === 'compassLeft') {
    positionSuperDragCompassNearDrag(el, startX, startY, mode);
    return;
  }

  const pad = 10;
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  resetSuperDragCompassTransform(el);
  const originRect = el.getBoundingClientRect();
  const w = originRect.width || 110;
  const h = originRect.height || 130;
  let targetLeft = pad;
  let targetTop = pad;
  switch (mode) {
    case 'compassScreenCenter':
      targetLeft = (viewW - w) / 2;
      targetTop = (viewH - h) / 2;
      break;
    case 'compassScreenTop':
      targetLeft = (viewW - w) / 2;
      targetTop = pad;
      break;
    case 'compassScreenBottom':
      targetLeft = (viewW - w) / 2;
      targetTop = viewH - pad - h;
      break;
    case 'compassScreenLeft':
      targetLeft = pad;
      targetTop = (viewH - h) / 2;
      break;
    case 'compassScreenRight':
      targetLeft = viewW - pad - w;
      targetTop = (viewH - h) / 2;
      break;
    default:
      break;
  }
  const pos = clampSuperDragCompassTopLeft(targetLeft, targetTop, w, h);
  translateSuperDragCompassByViewportDelta(
    el,
    pos.left - originRect.left,
    pos.top - originRect.top
  );
  revealSuperDragCompass(el);
}

function updateSuperDragCompass(startX, startY, currentX, currentY, direction, contentType) {
  if (!isSuperDragFeatureEnabled()) {
    hideSuperDragCompass();
    return;
  }
  if (!shouldShowSuperDragCompass()) {
    hideSuperDragCompass();
    return;
  }
  if (!isSuperDragCompassContentAllowed(contentType)) {
    hideSuperDragCompass();
    return;
  }
  const dx = currentX - startX;
  const dy = currentY - startY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < dragDistanceThreshold || !direction) {
    hideSuperDragCompass();
    return;
  }

  ensureSuperDragCompassStyles();
  if (typeof MouseExtUiHost === 'undefined') return;

  if (!superDragCompassEl || !superDragCompassEl.isConnected) {
    superDragCompassEl = createMouseExtElement('div');
    superDragCompassEl.id = 'mouse-super-drag-compass';
    const panel = createMouseExtElement('div');
    panel.className = 'sd-compass-panel';
    const grid = createMouseExtElement('div');
    grid.className = 'sd-compass-grid';
    SUPER_DRAG_COMPASS_LAYOUT.forEach((item) => {
      if (!item.dir) {
        const hubCell = createMouseExtElement('span');
        hubCell.className = 'sd-dir sd-hub-cell';
        const hub = createMouseExtElement('span');
        hub.className = 'sd-hub';
        hubCell.appendChild(hub);
        grid.appendChild(hubCell);
        return;
      }
      const cell = createMouseExtElement('span');
      cell.className = 'sd-dir';
      cell.dataset.dir = item.dir;
      cell.textContent = item.sym;
      cell.title = getI18nMessage(SUPER_DRAG_DIR_I18N[item.dir], item.dir);
      grid.appendChild(cell);
    });
    const gridWrap = createMouseExtElement('div');
    gridWrap.className = 'sd-grid-wrap';
    gridWrap.appendChild(grid);
    const vector = createMouseExtElement('div');
    vector.className = 'sd-vector';
    gridWrap.appendChild(vector);
    panel.appendChild(gridWrap);
    const caption = createMouseExtElement('div');
    caption.className = 'sd-caption';
    caption.innerHTML = '<span class="sd-dir-name"></span><span class="sd-action-name"></span>';
    panel.appendChild(caption);
    superDragCompassEl.appendChild(panel);
    if (!MouseExtUiHost.appendToCompassLayer(superDragCompassEl)) return;
    superDragCompassPlacedKey = '';
  } else {
    const compassLayer = MouseExtUiHost.getLayer('compass');
    if (!compassLayer || superDragCompassEl.parentNode !== compassLayer) {
      if (!MouseExtUiHost.appendToCompassLayer(superDragCompassEl)) return;
      superDragCompassPlacedKey = '';
    }
  }

  superDragCompassEl.querySelectorAll('.sd-dir:not(.sd-hub-cell)').forEach((cell) => {
    cell.classList.toggle('active', cell.dataset.dir === direction);
  });

  const dirNameEl = superDragCompassEl.querySelector('.sd-dir-name');
  const actionNameEl = superDragCompassEl.querySelector('.sd-action-name');
  const i18nKey = SUPER_DRAG_DIR_I18N[direction];
  if (dirNameEl) {
    dirNameEl.textContent = i18nKey
      ? getI18nMessage(i18nKey, direction)
      : direction;
  }
  if (actionNameEl) {
    const actionType = getEffectiveSuperDragActionForDirection(
      direction,
      contentType,
      getSuperDragCompassPayloadUrl(contentType)
    );
    actionNameEl.textContent = getSuperDragActionLabel(actionType);
  }

  const vectorEl = superDragCompassEl.querySelector('.sd-vector');
  if (vectorEl) {
    const len = Math.min(52, Math.max(18, dist * 0.35));
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    vectorEl.style.width = len + 'px';
    vectorEl.style.transform = 'rotate(' + angle + 'deg)';
    vectorEl.classList.add('visible');
  }

  const placeKey = getSuperDragCompassPlacedKey(startX, startY);
  if (superDragCompassPlacedKey !== placeKey) {
    positionSuperDragCompass(superDragCompassEl, startX, startY);
    superDragCompassPlacedKey = placeKey;
  }
}

// 拖拽移动时计算方向，但不执行操作（HTML5 拖拽；跨 frame 由 handleSuperDragDragOver 接力）
function handleDragMove(moveEvent) {
  if (!isTrustedUserEvent(moveEvent)) return;
  if (!dragInfo.type) return;
  const editableSource = dragInfo.editableSource || null;
  const pointer = getDragPointerClient(moveEvent);
  if (editableSource && isPointerWithinEditableSourceRect(pointer, editableSource)) {
    dragInfo.direction = '';
    applySuperDragCompassHide();
    return;
  }
  if (editableSource) {
    syncEditableSuperDragSessionIfOutsideSource(pointer);
  }
  const cur = clientToSuperDragViewport(pointer.clientX, pointer.clientY);
  const dx = cur.x - dragInfo.startX;
  const dy = cur.y - dragInfo.startY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < dragDistanceThreshold) {
    dragInfo.direction = '';
    applySuperDragCompassHide();
    return;
  }
  const direction = computeSuperDragDirection(dx, dy);
  lockSuperDragDirection(direction);
  dragInfo.direction = direction;
  processSuperDragCompassMove(
    dragInfo.startX,
    dragInfo.startY,
    cur.x,
    cur.y,
    dragInfo.type,
    pointer,
    editableSource
  );
}

// 判断链接是否为可下载文件（根据 URL 路径扩展名）
function isDownloadableFileUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const extMatch = path.match(/\.([a-z0-9]+)$/i);
    if (!extMatch) return false;
    const ext = extMatch[1].toLowerCase();
    const downloadableExts = [
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico',
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
      'zip', 'rar', '7z', 'tar', 'gz', 'bz2',
      'exe', 'dmg', 'pkg', 'apk', 'msi',
      'mp3', 'mp4', 'wav', 'avi', 'mov', 'webm', 'mkv', 'flac'
    ];
    return downloadableExts.includes(ext);
  } catch (e) {
    return false;
  }
}

// 超级拖拽功能 - 处理拖拽结束
function handleDragEnd(e) {
  if (!isTrustedUserEvent(e)) return;
  if (wasPointerSyntheticSuperDragExecutedRecently()) {
    resetDragInfo();
    return;
  }

  const editableSource = dragInfo.editableSource;
  if (editableSource && dragInfo.text && tryFinishEditableTextDrag(e)) {
    resetDragInfo();
    return;
  }

  const dropTarget = resolveNativeDropTarget(e);
  if (dropTarget && editableSource) {
    if (dropTarget !== editableSource) {
      resetDragInfo();
      return;
    }
    if (isPointerWithinEditableSourceRect(e, editableSource)) {
      resetDragInfo();
      return;
    }
  } else if (dropTarget) {
    resetDragInfo();
    return;
  }

  if (editableSource && Date.now() - lastEditableSuperDragFinishAt < 350) {
    resetDragInfo();
    return;
  }

  ensureDragInfoDirectionFromEvent(e);
  // 检查是否有有效的拖拽方向和内容
  if (!dragInfo.direction) {
    resetDragInfo();
    return;
  }

  if (dragInfo.type === 'text' && !settings.enableDragTextSearch) {
    resetDragInfo();
    return;
  }
  
  if (dragInfo.type === 'text' && dragInfo.savedSelection && !dragInfo.text) {
    dragInfo.text = dragInfo.savedSelection;
  }
  
  if (!(dragInfo.url || dragInfo.text)) {
    if (!((isLinuxOS || isMacOS) && dragInfo.savedSelection && dragInfo.type === 'text')) {
      resetDragInfo();
      return;
    }
    dragInfo.text = dragInfo.savedSelection;
  }
  
  const actionType = getEffectiveSuperDragActionForDirection(
    dragInfo.direction,
    dragInfo.type,
    dragInfo.url
  );
  
  // 如果操作类型为'none'，不执行任何操作
  if (actionType === 'none') {
    resetDragInfo();
    return;
  }

  try {
    e.preventDefault();
    e.stopPropagation();
  } catch (_) {}

  // 开关开启时：拖拽图片或可下载文件链接则自动下载
  if (actionType === 'download') {
    markSuperDragNavigationSuppressed();
    sendSuperDragMessage({
      action: 'superDrag',
      type: dragInfo.type === 'image' ? 'image' : 'link',
      url: dragInfo.url,
      actionType: 'download'
    }, resetDragInfo);
    return;
  }
  
  // 复制动作：将选中的文本或链接/图片URL复制到剪贴板
  if (actionType === 'copy') {
    let toCopy = '';
    if (dragInfo.type === 'link' || dragInfo.type === 'image') toCopy = dragInfo.url || '';
    else if (dragInfo.type === 'text') toCopy = dragInfo.text || '';
    if (toCopy) {
      copyPlainTextToClipboard(toCopy).then((ok) => {
        if (ok) {
          showGestureHint(getI18nMessage('copiedToClipboard', 'Copied to clipboard'));
        }
      });
    }
    resetDragInfo();
    return;
  }
  
  // 分屏方向选项：splitLeft / splitRight / splitUp / splitDown
  const isSplitView = ['splitLeft', 'splitRight', 'splitUp', 'splitDown'].includes(actionType);
  markSuperDragNavigationSuppressed();

  // 根据类型和设置的操作类型决定打开方式
  switch (dragInfo.type) {
    case 'link':
      if (actionType === 'popupView') {
        openSuperDragPayloadInPopupView({
          type: 'link',
          url: dragInfo.url,
          title: dragInfo.text || dragInfo.url
        });
        resetDragInfo();
      } else if (isSplitView) {
        // 分屏视图（四向）：通过后台脚本在新的浏览器窗口中分屏打开链接
        sendSuperDragMessage({
          action: 'superDrag',
          type: 'link',
          url: dragInfo.url,
          actionType: actionType
        }, resetDragInfo);
      } else if (actionType === 'incognito') {
        sendSuperDragMessage({
          action: 'superDrag',
          type: 'link',
          url: dragInfo.url,
          actionType: 'incognito'
        }, resetDragInfo);
      } else if (actionType === 'foreground') {
        // 前台打开链接
        window.open(dragInfo.url, '_blank', 'noopener');
        resetDragInfo();
      } else if (actionType === 'background') {
        sendSuperDragMessage({
          action: 'superDrag',
          type: 'link',
          url: dragInfo.url,
          actionType: 'background'
        }, resetDragInfo);
      }
      break;
    
    case 'image':
      if (actionType === 'popupView') {
        openSuperDragPayloadInPopupView({
          type: 'image',
          url: dragInfo.url,
          title: dragInfo.text || dragInfo.url
        });
        resetDragInfo();
      } else if (isSplitView) {
        sendSuperDragMessage({
          action: 'superDrag',
          type: 'image',
          url: dragInfo.url,
          actionType: actionType
        }, resetDragInfo);
      } else if (actionType === 'incognito') {
        sendSuperDragMessage({
          action: 'superDrag',
          type: 'image',
          url: dragInfo.url,
          actionType: 'incognito'
        }, resetDragInfo);
      } else if (actionType === 'foreground') {
        window.open(dragInfo.url, '_blank', 'noopener');
        resetDragInfo();
      } else if (actionType === 'background') {
        sendSuperDragMessage({
          action: 'superDrag',
          type: 'image',
          url: dragInfo.url,
          actionType: 'background'
        }, resetDragInfo);
      }
      break;
    
    case 'text':
      if (settings.enableDragTextSearch) {
        if (actionType === 'popupView') {
          openSuperDragPayloadInPopupView({
            type: 'text',
            text: dragInfo.text,
            dragDirection: dragInfo.direction
          });
          resetDragInfo();
        } else {
          sendSuperDragMessage({
            action: 'superDrag',
            type: 'text',
            text: dragInfo.text,
            actionType: actionType,
            dragDirection: dragInfo.direction
          }, resetDragInfo);
        }
      } else {
        resetDragInfo();
      }
      break;
    default:
      resetDragInfo();
      break;
  }
}

// 处理页面内部的放下事件
function handleDrop(e) {
  if (!isTrustedUserEvent(e)) return;
  if (resolveNativeDropTarget(e)) {
    return;
  }
  const direction = dragInfo.direction || cachedSuperDragSession.direction;
  if (direction && dragInfo.type) {
    e.preventDefault();
  }
}

// 处理拖拽离开页面事件
function handleDragLeave(e) {
  if (!isTrustedUserEvent(e)) return;
  if (!isSuperDragTrackingActive()) return;
  if (e.relatedTarget != null) return;
  dragInfo.direction = '';
  applySuperDragCompassHide();
}

// 显示手势准备就绪提示
function showGestureReadyHint() {
  try {
    const hintText = getI18nMessage('gestureReady', 'Gesture mode ready');
    
    // 使用现有的showGestureHint函数显示提示
    showGestureHint(hintText);
    
    // 添加特殊的视觉效果以区分普通提示
    if (gestureHint) {
      // 添加特殊的边框和背景色以区分
      gestureHint.style.borderColor = '#00b3ff';
      gestureHint.style.backgroundColor = 'rgba(0, 179, 255, 0.15)';
      
      // 短暂的闪烁动画
      setTimeout(() => {
        if (gestureHint && gestureHint.isConnected) {
          gestureHint.style.backgroundColor = 'rgba(0, 179, 255, 0.3)';
          setTimeout(() => {
            if (gestureHint && gestureHint.isConnected) {
              gestureHint.style.backgroundColor = 'rgba(0, 179, 255, 0.15)';
            }
          }, 150);
        }
      }, 150);
    }
  } catch (e) {
    console.log('显示手势准备就绪提示失败:', e.message);
  }
}

// 阻止默认的右键菜单
function getMacLinuxRightClickSpread() {
  if (!gesturePoints || gesturePoints.length === 0) return 0;
  let minX = gesturePoints[0].x;
  let maxX = minX;
  let minY = gesturePoints[0].y;
  let maxY = minY;
  for (let i = 1; i < gesturePoints.length; i++) {
    const p = gesturePoints[i];
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return Math.max(maxX - minX, maxY - minY);
}

/** 触摸板双指轻点会产生多段 pointermove，用位移范围而非点数判断是否为单击 */
function isMacLinuxSimpleRightClickIntent() {
  return getMacLinuxRightClickSpread() < MAC_LINUX_SIMPLE_RIGHT_CLICK_MAX_MOVE;
}

function isMacLinuxRightClickPointerEvent(e) {
  if (!e) return false;
  return e.button === 2 || (isMacOS && e.button === 0 && e.ctrlKey);
}

function hasRecentMacLinuxRightClick(currentTime) {
  return (
    lastMacLinuxRightClickTime > 0 &&
    currentTime - lastMacLinuxRightClickTime < macLinuxAdaptiveDoubleRightClickMs
  );
}

function getMacLinuxRightClickDistance(x, y, refX, refY) {
  return Math.hypot(Number(x) - Number(refX), Number(y) - Number(refY));
}

function beginMacLinuxRightPress(e, currentTime) {
  if (!(isMacOS || isLinuxOS) || !isMacLinuxRightClickPointerEvent(e)) return;
  const hasFirstClick = hasRecentMacLinuxRightClick(currentTime);
  const distanceFromFirst = hasFirstClick
    ? getMacLinuxRightClickDistance(e.clientX, e.clientY, lastMacLinuxRightPointerUpX, lastMacLinuxRightPointerUpY)
    : Infinity;
  macLinuxCurrentRightPress = {
    startedAt: currentTime,
    x: Number(e.clientX) || 0,
    y: Number(e.clientY) || 0,
    secondCandidate: hasFirstClick && distanceFromFirst <= MAC_LINUX_DOUBLE_RIGHT_CLICK_MAX_MOVE,
    contextMenuSeen: false,
    counted: false
  };
}

function clearMacLinuxSimpleRightClickResetTimer() {
  if (macLinuxSimpleRightClickResetTimer) {
    clearTimeout(macLinuxSimpleRightClickResetTimer);
    macLinuxSimpleRightClickResetTimer = 0;
  }
}

function scheduleMacLinuxSimpleRightClickReset() {
  clearMacLinuxSimpleRightClickResetTimer();
  macLinuxSimpleRightClickResetTimer = setTimeout(() => {
    macLinuxSimpleRightClickResetTimer = 0;
    if (isGestureInProgress) return;
    isRightMouseDown = false;
    macLinuxCurrentRightPress = null;
    lastMacLinuxRightClickTime = 0;
    lastMacLinuxRightPointerUpTime = 0;
    syncGestureStateToStorage(false, 0);
    resetGestureState();
    clearGestureCanvas();
  }, macLinuxAdaptiveDoubleRightClickMs + 120);
}

function armMacLinuxDoubleRightClickMenu(currentTime) {
  macLinuxDoubleRightClickMenuArmedUntil = currentTime + MAC_LINUX_CONTEXTMENU_ALLOW_ARM_MS;
  if (macLinuxDoubleRightClickArmTimer) clearTimeout(macLinuxDoubleRightClickArmTimer);
  macLinuxDoubleRightClickArmTimer = setTimeout(() => {
    macLinuxDoubleRightClickArmTimer = 0;
    if (Date.now() >= macLinuxDoubleRightClickMenuArmedUntil) {
      macLinuxDoubleRightClickMenuArmedUntil = 0;
      macLinuxAllowContextMenu = false;
    }
  }, MAC_LINUX_CONTEXTMENU_ALLOW_ARM_MS + 30);
}

function isMacLinuxDoubleRightClickMenuArmed(currentTime) {
  if (macLinuxDoubleRightClickMenuArmedUntil > currentTime) return true;
  macLinuxDoubleRightClickMenuArmedUntil = 0;
  return false;
}

function isMacLinuxSameTapContextMenu(e, currentTime) {
  if (!e || !lastMacLinuxRightPointerUpTime) return false;
  if (currentTime - lastMacLinuxRightPointerUpTime > MAC_LINUX_CONTEXTMENU_SAME_TAP_MS) return false;
  const dx = Number(e.clientX) - lastMacLinuxRightPointerUpX;
  const dy = Number(e.clientY) - lastMacLinuxRightPointerUpY;
  return Math.hypot(dx, dy) <= MAC_LINUX_SIMPLE_RIGHT_CLICK_MAX_MOVE;
}

function isMacLinuxDoubleRightClickNow(currentTime, e) {
  if (isMacLinuxDoubleRightClickMenuArmed(currentTime)) {
    const targetX = macLinuxCurrentRightPress?.x ?? lastMacLinuxRightPointerUpX;
    const targetY = macLinuxCurrentRightPress?.y ?? lastMacLinuxRightPointerUpY;
    return getMacLinuxRightClickDistance(e?.clientX, e?.clientY, targetX, targetY) <= MAC_LINUX_DOUBLE_RIGHT_CLICK_MAX_MOVE;
  }
  if (
    macLinuxCurrentRightPress &&
    macLinuxCurrentRightPress.secondCandidate &&
    isMacLinuxSimpleRightClickIntent()
  ) {
    return true;
  }
  if (!hasRecentMacLinuxRightClick(currentTime)) return false;
  if (isMacLinuxSameTapContextMenu(e, currentTime)) return false;
  const dx = Number(e && e.clientX) - lastMacLinuxRightPointerUpX;
  const dy = Number(e && e.clientY) - lastMacLinuxRightPointerUpY;
  return Math.hypot(dx, dy) <= MAC_LINUX_DOUBLE_RIGHT_CLICK_MAX_MOVE;
}

function rememberMacLinuxRightPointerUp(e, currentTime) {
  if (!(isMacOS || isLinuxOS) || !isMacLinuxRightClickPointerEvent(e)) return;
  const press = macLinuxCurrentRightPress;
  const pressDuration = press ? currentTime - press.startedAt : 0;
  const simpleClick = (!press || pressDuration <= 450) && isMacLinuxSimpleRightClickIntent();
  if (!simpleClick) {
    macLinuxCurrentRightPress = null;
    lastMacLinuxRightClickTime = 0;
    lastMacLinuxRightPointerUpTime = 0;
    clearMacLinuxSimpleRightClickResetTimer();
    return;
  }

  if (
    macLinuxMenuAllowedAt > 0 &&
    currentTime - macLinuxMenuAllowedAt < 260 &&
    getMacLinuxRightClickDistance(e.clientX, e.clientY, macLinuxMenuAllowedX, macLinuxMenuAllowedY) <= MAC_LINUX_DOUBLE_RIGHT_CLICK_MAX_MOVE
  ) {
    macLinuxMenuAllowedAt = 0;
    macLinuxCurrentRightPress = null;
    return;
  }

  const dx = Number(e && e.clientX) - lastMacLinuxRightPointerUpX;
  const dy = Number(e && e.clientY) - lastMacLinuxRightPointerUpY;
  const sameDoubleClickTarget = Math.hypot(dx, dy) <= MAC_LINUX_DOUBLE_RIGHT_CLICK_MAX_MOVE;
  if (
    !press?.counted &&
    press?.secondCandidate &&
    sameDoubleClickTarget
  ) {
    armMacLinuxDoubleRightClickMenu(currentTime);
  } else if (!press?.counted) {
    lastMacLinuxRightClickTime = currentTime;
    lastMacLinuxRightPointerUpTime = currentTime;
    lastMacLinuxRightPointerUpX = Number(e.clientX) || 0;
    lastMacLinuxRightPointerUpY = Number(e.clientY) || 0;
  }
  if (press) press.counted = true;
  scheduleMacLinuxSimpleRightClickReset();
}

function rememberMacLinuxContextMenuAsFirstClick(e, currentTime) {
  macLinuxAllowContextMenu = false;
  macLinuxDoubleRightClickMenuArmedUntil = 0;
  if (macLinuxDoubleRightClickArmTimer) {
    clearTimeout(macLinuxDoubleRightClickArmTimer);
    macLinuxDoubleRightClickArmTimer = 0;
  }
  lastMacLinuxContextMenuTime = currentTime;
  const press = macLinuxCurrentRightPress;
  if (!press || !press.secondCandidate) {
    lastMacLinuxRightClickTime = currentTime;
    lastMacLinuxRightPointerUpTime = currentTime;
    lastMacLinuxRightPointerUpX = Number(e.clientX) || 0;
    lastMacLinuxRightPointerUpY = Number(e.clientY) || 0;
  }
  if (press) {
    press.contextMenuSeen = true;
    press.counted = true;
  }
  isRightMouseDown = true;
  isGestureInProgress = false;
  gestureStartX = e.clientX;
  gestureStartY = e.clientY;
  gesturePoints = [{ x: e.clientX, y: e.clientY }];
  gestureComposedPath = e.composedPath().slice();
  clearGestureCanvas();
  scheduleMacLinuxSimpleRightClickReset();
}

function allowMacLinuxDoubleRightClickMenu() {
  if (macLinuxCurrentRightPress?.secondCandidate && lastMacLinuxRightClickTime > 0) {
    const observedInterval = macLinuxCurrentRightPress.startedAt - lastMacLinuxRightClickTime;
    const targetWindow = Math.min(
      MAC_LINUX_DOUBLE_RIGHT_CLICK_MAX_MS,
      Math.max(MAC_LINUX_DOUBLE_RIGHT_CLICK_MIN_MS, observedInterval + 180)
    );
    macLinuxAdaptiveDoubleRightClickMs = Math.round(
      macLinuxAdaptiveDoubleRightClickMs * 0.7 + targetWindow * 0.3
    );
  }
  macLinuxMenuAllowedAt = Date.now();
  macLinuxMenuAllowedX = macLinuxCurrentRightPress?.x || lastMacLinuxRightPointerUpX;
  macLinuxMenuAllowedY = macLinuxCurrentRightPress?.y || lastMacLinuxRightPointerUpY;
  macLinuxAllowContextMenu = true;
  macLinuxDoubleRightClickMenuArmedUntil = 0;
  if (macLinuxDoubleRightClickArmTimer) {
    clearTimeout(macLinuxDoubleRightClickArmTimer);
    macLinuxDoubleRightClickArmTimer = 0;
  }
  clearMacLinuxSimpleRightClickResetTimer();
  lastMacLinuxRightClickTime = 0;
  lastMacLinuxRightPointerUpTime = 0;
  lastMacLinuxContextMenuTime = 0;
  isRightMouseDown = false;
  isGestureInProgress = false;
  resetGestureState();
  clearGestureCanvas();
  scheduleReleaseGesturePreventDefault();
  setTimeout(() => {
    macLinuxAllowContextMenu = false;
  }, 0);
}

function handleContextMenu(e) {
  if (!isTrustedUserEvent(e)) return;
  // 检查鼠标手势功能是否启用
  if (!settings || !settings.enableGesture) {
    return;
  }
  if (isSiteInDisabledList(window.location.href)) {
    return;
  }

  const currentTime = Date.now();

  // 在 macOS / Linux 上：单击右键进手势，双击右键出菜单（与 Windows 逻辑相反）
  if (isMacOS || isLinuxOS) {
    // 双击检测必须优先且独立于 isGestureInProgress：触摸板轻点易触发 1px 手势阈值
    if (isMacLinuxDoubleRightClickNow(currentTime, e)) {
      allowMacLinuxDoubleRightClickMenu();
      return true;
    }

    if (isMacLinuxSimpleRightClickIntent()) {
      e.preventDefault();
      rememberMacLinuxContextMenuAsFirstClick(e, currentTime);
      return false;
    }
  }

  // 如果右键按下或手势进行中，阻止右键菜单
  if (isRightMouseDown || isGestureInProgress) {
    if (
      (isMacOS || isLinuxOS) &&
      isMacLinuxSimpleRightClickIntent() &&
      !isMacLinuxDoubleRightClickNow(currentTime, e)
    ) {
      lastMacLinuxRightClickTime = currentTime;
      scheduleMacLinuxSimpleRightClickReset();
    }
    e.preventDefault();
    return false;
  }

  // 检查是否是手势释放后的右键菜单事件
  const timeThreshold = getGestureContextMenuThreshold();
  const crossFrameThreshold = timeThreshold + 80;

  // 按住右键+滚轮/左键，或按住左键+右键：需 500ms 阻止，因松开顺序可能导致 contextmenu 较晚触发
  if (rightHoldGestureEndTime > 0 && (currentTime - rightHoldGestureEndTime < 500)) {
    e.preventDefault();
    return false;
  }

  const endTs = getRecentGestureEndTime();
  if (endTs > 0 && currentTime - endTs < timeThreshold) {
    e.preventDefault();
    return false;
  }

  // 跨帧：主框架手势在 iframe/播放器内触发 contextmenu
  if (
    cachedGestureState.gestureActive ||
    (cachedGestureState.lastGestureEndTime > 0 &&
      currentTime - cachedGestureState.lastGestureEndTime < crossFrameThreshold)
  ) {
    e.preventDefault();
  }
}

// 窗口大小改变时重新调整画布大小
function handleResize() {
  if (gestureCanvas) {
    resizeGestureCanvasToViewport(gestureCanvas);
    if (gestureContext && gesturePoints && gesturePoints.length > 1) {
      redrawGestureTrail();
    }
  }
}

document.addEventListener('fullscreenchange', syncGestureOverlaysToFullscreenLayer);

function invalidateIframeRectCache() {
  iframeRectCacheByFrameId.clear();
}
if (window === window.top) {
  window.addEventListener('scroll', invalidateIframeRectCache, { capture: true, passive: true });
  window.addEventListener('resize', invalidateIframeRectCache, { passive: true });
}

function handleIframeTrailEndOnTop(data, sourceFrameId) {
  if (data.closedTrailGen != null) {
    topIframeTrailClosedGen = Math.max(topIframeTrailClosedGen, data.closedTrailGen);
  }
  iframeGesturePoints = [];
  iframeGestureComposedPathHints = null;
  iframeGestureScrollAnchor = null;
  lastIframeTrailTime = 0;
  if (sourceFrameId != null) iframeRectCacheByFrameId.delete(sourceFrameId);
  crossFrameGestureSourceFrameUrl = null;
  cancelTopIframeTrailStaleCleanup();
  if (!(isGestureInProgress && isRightMouseDown)) {
    disposeGestureTrailCanvas();
  }
}

// 主框架接收 iframe 内手势轨迹并绘制，保证跨 frame 连续
function handleGestureTrailFromIframe(data, meta) {
  if (!data) return;
  const sourceFrameId = meta && meta.fromFrameId != null ? meta.fromFrameId : null;
  const sourceUrl = meta && meta.sourceUrl ? meta.sourceUrl : null;
  try {
    if (data.type === 'end') {
      handleIframeTrailEndOnTop(data, sourceFrameId);
      return;
    }
    if (!settings?.showGestureTrail || !isGestureFeatureAllowedHere()) return;
    if (data.trailGen != null && data.trailGen <= topIframeTrailClosedGen) {
      return;
    }
    let points = data.points || [];
    if (data.iframeLocal !== false && points.length > 0) {
      points = convertIframeLocalPointsWithSource(points, sourceFrameId, sourceUrl);
    } else if (data.needsConversion && points.length > 0) {
      points = convertIframeLocalPointsWithSource(points, sourceFrameId, sourceUrl);
    }
    if (data.type === 'init' && data.scrollContext) {
      iframeGestureComposedPathHints = data.scrollContext.pathHints || null;
      iframeGestureScrollAnchor = data.scrollContext.anchor || null;
      if (typeof MouseScrollGesture !== 'undefined') {
        MouseScrollGesture.clearContainerCache();
      }
    }
    iframeGesturePoints = points.map(p => ({ x: p.x, y: p.y }));
    lastIframeTrailTime = Date.now();
    scheduleTopIframeTrailStaleCleanup();
    if (points.length === 0) return;
    if (!isGestureCanvasLive()) {
      gestureCanvas = createGestureCanvas();
      gestureContext = gestureCanvas?.getContext('2d');
    } else if (!gestureContext) {
      gestureContext = gestureCanvas.getContext('2d');
    }
    if (gestureCanvas) {
      resizeGestureCanvasToViewport(gestureCanvas);
    }
    if (!gestureContext) return;
    applyGestureTrailContextStyles(gestureContext);
    gestureContext.clearRect(0, 0, gestureCanvas.width, gestureCanvas.height);
    if (points.length < 2) return;
    const transform = getCanvasViewportTransform(gestureCanvas);
    strokeSmoothGestureTrailPath(gestureContext, points, transform);
  } catch (e) {
    console.log('绘制 iframe 手势轨迹失败:', e.message);
  }
}

// 添加消息监听器，用于接收设置更新
if (mouseExtListenerFlag('runtimeOnMessage')) {
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const pinActions = [
    'addScreenshotPin',
    'pingScreenshotPins',
    'clearScreenshotPins',
    'removeScreenshotPin'
  ];
  if (message && pinActions.includes(message.action)) {
    return false;
  }
  try {
    if (!isExtensionValid) {
      checkExtensionValidity();
      sendResponse({ success: false, error: 'Extension context invalidated' });
      return true;
    }
    
    if (message.action === 'gestureTrailFromIframe' && window === window.top) {
      if (message._fromFrameId == null || message._fromFrameId === 0) {
        sendResponse({ success: false, error: 'invalid_forward' });
        return true;
      }
      crossFrameGestureSourceFrameId = message._fromFrameId;
      if (message._sourceUrl) {
        crossFrameGestureSourceFrameUrl = message._sourceUrl;
      }
      handleGestureTrailFromIframe(message.data, {
        fromFrameId: message._fromFrameId,
        sourceUrl: message._sourceUrl
      });
      sendResponse({ success: true });
    } else if (message.action === 'executeRelayedGestureAction' && window === window.top) {
      const innerAction = message.gestureAction && String(message.gestureAction);
      if (!innerAction) {
        sendResponse({ success: false, error: 'invalid_action' });
        return true;
      }
      const payload =
        message.gesturePayload && typeof message.gesturePayload === 'object'
          ? Object.assign({}, message.gesturePayload)
          : {};
      payload.action = innerAction;
      safeSendMessage(payload).then((resp) => {
        sendResponse(resp && typeof resp === 'object' ? resp : { success: !!resp });
      });
      return true;
    } else if (message.action === 'gestureCompleteHandoffRequest' && window === window.top) {
      if (isGestureInProgress && gesturePoints.length >= 2) {
        finalizeActiveGestureRecognition();
      } else if (tryBootstrapTopGestureFromIframePoints()) {
        finalizeActiveGestureRecognition();
      } else {
        disposeGestureTrailCanvas();
      }
      sendResponse({ success: true });
      return true;
    } else if (message.action === 'superDragCompassFromIframe' && window === window.top) {
      if (message._fromFrameId == null || message._fromFrameId === 0) {
        sendResponse({ success: false, error: 'invalid_forward' });
        return true;
      }
      const d = message.data;
      if (d && d.contentType) {
        updateSuperDragCompass(
          d.startX,
          d.startY,
          d.currentX,
          d.currentY,
          d.direction,
          d.contentType
        );
      }
      sendResponse({ success: true });
    } else if (message.action === 'superDragCompassHide' && window === window.top) {
      hideSuperDragCompassOnTop();
      sendResponse({ success: true });
    } else if (message.action === 'gestureHintFromIframe' && window === window.top) {
      if (message._fromFrameId == null || message._fromFrameId === 0) {
        sendResponse({ success: false, error: 'invalid_forward' });
        return true;
      }
      if (message.data?.action) {
        const hintAction = message.data.action;
        const noNextPageText = getNavigationErrorTranslations().noNextPage;
        const isNoNextPage = hintAction === noNextPageText;
        let suppress = false;
        if (isNoNextPage) {
          if (lastHintAction === getNavigationErrorTranslations().nextPageSuccess && Date.now() - lastHintTime < 500) suppress = true;
          if (!suppress) {
            try {
              const t = parseInt(sessionStorage.getItem(NEXT_PAGE_SUCCESS_KEY) || '0', 10);
              if (t && Date.now() - t < 1200) suppress = true;
            } catch (_) {}
          }
        }
        if (
          !suppress &&
          typeof hintAction === 'string' &&
          hintAction.length > 0 &&
          hintAction.length <= 240
        ) {
          showGestureHint(hintAction);
        }
      }
      sendResponse({ success: true });
    } else if (message.action === 'vouchCrossFrameSessionRequest' && window === window.top) {
      const finishVouch = (ok) => sendResponse({ success: ok, error: ok ? undefined : 'no_active_gesture' });
      initContentContext(() => {
        finishVouch(canVouchCrossFrameSession(message.childFrameId));
      });
      return true;
    } else if (message.action === 'runScreenshotByModeFromIframeHotkey' && window === window.top) {
      const runRelayedScreenshotHotkey = () => {
        const mode = message.mode && String(message.mode);
        const MS = typeof window !== 'undefined' ? window.MouseScreenshot : null;
        if (!SCREENSHOT_HOTKEY_RELAY_MODES.has(mode)) {
          sendResponse({ success: false, error: 'invalid_mode' });
          return;
        }
        if (!isExtensionValid || !settings || !settings.enableScreenshotFeature) {
          sendResponse({ success: false, error: 'screenshot_disabled' });
          return;
        }
        if (isSiteInDisabledList(window.location.href)) {
          sendResponse({ success: false, error: 'site_disabled' });
          return;
        }
        if (!MS) {
          sendResponse({ success: false, error: 'screenshot_unavailable' });
          return;
        }
        if (
          typeof MS.isRegionPickerCaptureActive === 'function' &&
          MS.isRegionPickerCaptureActive()
        ) {
          sendResponse({ success: false, error: 'picker_active' });
          return;
        }
        try {
          runScreenshotByMode(mode, () => {});
          sendResponse({ success: true });
        } catch (e) {
          sendResponse({ success: false, error: 'run_failed' });
        }
      };
      if (!settingsLoaded) {
        loadSettings(runRelayedScreenshotHotkey);
      } else {
        runRelayedScreenshotHotkey();
      }
      return true;
    } else if (message.action === 'runCaptureRegionFromIframe' && window === window.top) {
      const MS = window.MouseScreenshot;
      let pts = message.points;
      if (!MS || !MS.captureRegionFromPoints || !pts || pts.length < 2) {
        sendResponse({ success: false, error: 'capture_unavailable' });
        return true;
      }
      if (message.iframeLocal !== false) {
        pts = convertIframeLocalPointsToTopViewport(
          pts,
          message._sourceFrameId,
          message._sourceUrl
        );
      }
      (async () => {
        try {
          await MS.captureRegionFromPoints(pts, {
            trailPad: message.trailPad != null ? message.trailPad : undefined
          });
          showScreenshotSuccessHint();
          sendResponse({ success: true });
        } catch (e) {
          sendResponse({ success: false, error: 'capture_failed' });
        }
      })();
      return true;
    } else if (message.action === 'screenshotOverlayHideInternal') {
      hideExtensionOverlaysForScreenshot();
      sendResponse({ success: true });
    } else if (message.action === 'screenshotOverlayShowInternal') {
      restoreExtensionOverlaysAfterScreenshot();
      sendResponse({ success: true });
    } else if (message.action === 'showDuplicateTabsNotification') {
      showDuplicateTabsNotification(message.data);
      sendResponse({ success: true });
    } else if (message.action === 'scrollUp') {
      startProgrammaticScrollGuard();
      const scrollSuccessful = performPageScrollAction('scrollUp', { distance: message.distance });
      endProgrammaticScrollGuard();
      sendResponse({ success: scrollSuccessful });
    } else if (message.action === 'scrollDown') {
      startProgrammaticScrollGuard();
      const scrollSuccessful = performPageScrollAction('scrollDown', { distance: message.distance });
      endProgrammaticScrollGuard();
      sendResponse({ success: scrollSuccessful });
    } else if (message.action === 'scrollLeft') {
      startProgrammaticScrollGuard();
      const scrollSuccessful = performPageScrollAction('scrollLeft', { distance: message.distance });
      endProgrammaticScrollGuard();
      sendResponse({ success: scrollSuccessful });
    } else if (message.action === 'scrollRight') {
      startProgrammaticScrollGuard();
      const scrollSuccessful = performPageScrollAction('scrollRight', { distance: message.distance });
      endProgrammaticScrollGuard();
      sendResponse({ success: scrollSuccessful });
    } else if (message.action === 'scrollToTop') {
      startProgrammaticScrollGuard();
      scrollToExtremity('y', true, { forceRoot: true });
      endProgrammaticScrollGuard(0);
      sendResponse({ success: true });
    } else if (message.action === 'scrollToBottom') {
      startProgrammaticScrollGuard();
      scrollToExtremity('y', false, { forceRoot: true });
      endProgrammaticScrollGuard(1);
      sendResponse({ success: true });
    } else if (message.action === 'tryNavigateToNextPage') {
      tryNavigateToNextPage();
      sendResponse({ success: true });
    } else if (message.action === 'scrollToLeft') {
      startProgrammaticScrollGuard();
      scrollToExtremity('x', true, { forceRoot: true });
      endProgrammaticScrollGuard(undefined, 0);
      sendResponse({ success: true });
    } else if (message.action === 'scrollToRight') {
      startProgrammaticScrollGuard();
      scrollToExtremity('x', false, { forceRoot: true });
      endProgrammaticScrollGuard(undefined, 1);
      sendResponse({ success: true });
    } else if (message.action === 'syncScrollTo') {
      // 分屏滚动同步：纵向 + 横向比例；仅主框架处理
      if (window !== window.top) {
        sendResponse({ success: true });
      } else if (isProgrammaticScrollToEnd) {
        sendResponse({ success: true });
      } else {
        const ry = message.scrollRatio;
        const rx = message.scrollRatioX;
        const hasY = typeof ry === 'number' && ry >= 0 && ry <= 1;
        const hasX = typeof rx === 'number' && rx >= 0 && rx <= 1;
        if (!hasY && !hasX) {
          sendResponse({ success: true });
        } else {
          isSplitScrollSyncing = true;
          const el = document.scrollingElement || document.documentElement;
          const maxY = Math.max(0, el.scrollHeight - el.clientHeight);
          const maxX = Math.max(0, el.scrollWidth - el.clientWidth);
          const top = hasY && maxY > 0 ? ry * maxY : el.scrollTop;
          const left = hasX && maxX > 0 ? rx * maxX : el.scrollLeft;
          window.scrollTo({ left, top, behavior: 'instant' });
          setTimeout(() => { isSplitScrollSyncing = false; }, 30);
          sendResponse({ success: true });
        }
      }
    } else if (message.action === 'languageChanged') {
      // 特殊的语言变更消息，执行语言变更操作并显示提示
      const newLanguage = message.language;
      
      // 保存旧语言设置，用于比较
      const oldLanguage = settings ? settings.language : null;
      
      // 加载新的设置，并标记这是一个语言变更事件
      loadSettingsWithLanguageChange(newLanguage);
      
      sendResponse({ success: true });
    } else if (message.action === 'checkExtensionValid') {
      // 检查扩展是否有效
      isExtensionValid = true;
      sendResponse({ success: true });
    } else if (message.action === 'stopLoadingInternal') {
      // 备用方案：在内容脚本中执行stop操作
      window.stop();
      sendResponse({ success: true });
    } else if (message.action === 'navigationFailed') {
      // 处理导航失败消息
      const currentLang = settings.language || 'zh';
      let errorText = '';
      
      // 根据操作类型显示不同的错误提示
      if (message.operation === 'forward') {
        // 前进失败时，先显示没有可前进页面的提示（0ms关闭显示）
        errorText = getNavigationErrorTranslations().noForwardPage;
        showGestureHint(errorText);
        
        // 短暂延迟后尝试查找并跳转到下一页
        setTimeout(() => {
          tryNavigateToNextPage();
        }, 0);
      } else if (message.operation === 'back') {
        errorText = getNavigationErrorTranslations().noBackPage;
        showGestureHint(errorText);
      } else {
        errorText = getNavigationErrorTranslations().navigationFailed;
        showGestureHint(errorText);
      }
      
      sendResponse({ success: true });
    } else if (message.action === 'showAutoCloseSuccessNotification') {
      // 显示自动关闭成功的通知
      showAutoCloseSuccessNotification(message.data);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Unknown action' });
    }
  } catch (e) {
    console.log('消息处理错误:', e.message);
    if (e.message.includes('Extension context invalidated')) {
      isExtensionValid = false;
    }
    sendResponse({ success: false, error: e.message });
  }
  return true;
});
}

function isExtensionUiNode(el) {
  if (!el || el.nodeType !== 1) return false;
  try {
    const host = document.getElementById('mouse-ext-ui-host');
    if (host && (el === host || host.contains(el))) return true;
  } catch { /* ignore */ }
  return false;
}

function bindMouseScrollGesture() {
  if (typeof MouseScrollGesture === 'undefined') {
    console.warn('mouse-ext: scroll-gesture.js 未加载，手势滚动不可用');
    return false;
  }
  MouseScrollGesture.bindContext({
    getGesturePoints: () => gesturePoints,
    getComposedPath: () => gestureComposedPath,
    getIframePathHints: () => iframeGestureComposedPathHints,
    getIframeScrollAnchor: () => iframeGestureScrollAnchor,
    isExtensionUiNode,
    getEnableSmoothScroll: () => !!(settings && settings.enableSmoothScroll),
    beginGestureScrollSession
  });
  return true;
}

const mouseScrollGestureReady = bindMouseScrollGesture();

function serializeComposedPathForMessage(path) {
  if (!mouseScrollGestureReady) return null;
  return MouseScrollGesture.serializeComposedPathForMessage(path);
}
function shouldScrollIframeLocally(axis, direction) {
  if (!mouseScrollGestureReady) return false;
  return MouseScrollGesture.shouldScrollIframeLocally(axis, direction);
}
function scrollPageByAxis(axis, direction, fraction, options) {
  if (!mouseScrollGestureReady) return;
  return MouseScrollGesture.scrollPageByAxis(axis, direction, fraction, options);
}
function scrollToExtremity(axis, toTop, options) {
  if (!mouseScrollGestureReady) return;
  return MouseScrollGesture.scrollToExtremity(axis, toTop, options);
}
function scrollToPosition(position) {
  if (!mouseScrollGestureReady) return false;
  return MouseScrollGesture.scrollToPosition(position);
}
function getGesturePageScrollDistance(axis) {
  if (!mouseScrollGestureReady) {
    const span = axis === 'x' ? (window.innerWidth || 800) : (window.innerHeight || 600);
    return Math.round(span * 0.92);
  }
  const fraction = MouseScrollGesture.getDefaultPageFraction();
  const span = axis === 'x' ? (window.innerWidth || 800) : (window.innerHeight || 600);
  return Math.round(span * fraction);
}
function performPageScrollAction(action, opts) {
  if (!mouseScrollGestureReady) return false;
  return MouseScrollGesture.performPageScrollAction(action, opts);
}
function performScroll(distance, options) {
  if (!mouseScrollGestureReady) return false;
  return MouseScrollGesture.performScroll(distance, options);
}
function performHorizontalScroll(distance, options) {
  if (!mouseScrollGestureReady) return false;
  return MouseScrollGesture.performHorizontalScroll(distance, options);
}
function findScrollableContainer(axis, direction, options) {
  if (!mouseScrollGestureReady) return document.documentElement;
  return MouseScrollGesture.findScrollableContainer(axis, direction, options);
}
function isElementScrollable(element, axis) {
  if (!mouseScrollGestureReady) return false;
  return MouseScrollGesture.isElementScrollable(element, axis);
}

// 专门处理语言变更的函数
function loadSettingsWithLanguageChange(newLanguage) {
  if (!isExtensionValid) return;
  
  try {
    chrome.storage.sync.get({
      enableGesture: true,
      showGestureTrail: true,
      showGestureHint: true,
      trailColor: '#FF9ECD',
      trailWidth: 3,
      enableSuperDrag: true,
      superDragCompassPosition: 'compassHub',
      enableDragTextSearch: true,
      enableSplitScrollSync: false,
      autoDownloadOnDragFile: false,
      enableImageDrag: true,
      enableImagePreview: false,
      enableImagePreviewEnhanced: false,
      enableDuplicateCheck: true,
      dragUpAction: 'background',
      dragUpRightAction: 'foreground',
      dragRightAction: 'background',
      dragDownRightAction: 'foreground',
      dragDownAction: 'background',
      dragDownLeftAction: 'popupView',
      dragLeftAction: 'background',
      dragUpLeftAction: 'splitLeft',
      dragSearchEngine: 'https://www.google.com/search?q={q}', // 添加超级拖拽搜索引擎URL设置
      dragUpSearchEngine: '',
      dragUpRightSearchEngine: '',
      dragRightSearchEngine: '',
      dragDownRightSearchEngine: '',
      dragDownSearchEngine: '',
      dragDownLeftSearchEngine: '',
      dragLeftSearchEngine: '',
      dragUpLeftSearchEngine: '',
      language: newLanguage // 使用传入的新语言
    }, (loadedSettings) => {
      if (chrome.runtime.lastError) {
        console.log(getI18nMessage('loadError'), chrome.runtime.lastError.message);
        return;
      }
      
      // 保存旧语言设置，用于比较
      const oldLanguage = settings ? settings.language : null;
      // storage 中已有 language 时 defaults 不会覆盖，需强制采用消息中的新语言
      loadedSettings.language = newLanguage;
      // 勿整体替换 settings，否则会丢失本次 get 未列出的手势等字段
      Object.assign(settings, loadedSettings);
      syncScreenshotCheckers();
      
      // 重置上一次提示的动作以确保下次显示提示时使用新语言
      lastHintAction = '';
      
      // 如果当前有显示的提示，移除它
      removeGestureHintElement();
      
      // 显示语言已变更提示
      if (oldLanguage && oldLanguage !== newLanguage) {
        // 重置上一次提示的动作以确保下次显示提示时使用新语言
        lastHintAction = '';
        console.log(getI18nMessage('languageChanged', [oldLanguage, newLanguage]));
        
        // 如果当前有显示的提示，移除它
        removeGestureHintElement();
        
        // 立即显示一个临时的语言切换提示，帮助用户确认语言已经切换
        const tempMsg = newLanguage === 'zh' ? getI18nMessage('switchedToChinese') : getI18nMessage('switchedToEnglish');
        setTimeout(() => {
          showGestureHint(tempMsg);
        }, 100); // 短暂延迟确保DOM已更新
      }
      
      // 如果手势被禁用，确保清理任何现有的手势状态
      if (!settings.enableGesture) {
        clearGestureCanvas();
        resetGestureState();
      }
      // 再从 storage 全量拉取一次，与 popup 保存的完整键对齐（手势动作等）
      loadSettings();
    });
  } catch (e) {
    console.log(getI18nMessage('loadError'), e.message);
    if (e.message.includes('Extension context invalidated')) {
      isExtensionValid = false;
    }
  }
}

// 初始化
initContentSettingsSyncListener();
loadSettings();

// 定期检查扩展上下文是否有效
function checkExtensionValidity() {
  if (!isExtensionValid) return;

  try {
    chrome.runtime.sendMessage({ action: 'ping' }, () => {
      if (chrome.runtime.lastError) {
        if (isExtensionContextInvalidatedError(chrome.runtime.lastError.message)) {
          markExtensionInvalidated();
        }
      } else {
        isExtensionValid = true;
      }
    });
  } catch (e) {
    if (isExtensionContextInvalidatedError(e)) {
      markExtensionInvalidated();
    }
  }
}

extensionValidityCheckTimer = setInterval(checkExtensionValidity, 60000);

// 创建图片预览元素（挂载于 Shadow DOM preview 层）
function createImagePreview() {
  if (typeof MouseExtUiHost === 'undefined') return null;
  MouseExtUiHost.ensureHost();
  MouseExtUiHost.syncHostToFullscreenLayer();

  let preview = MouseExtUiHost.getElementById('mouse-image-preview');
  if (preview) return preview;

  preview = createMouseExtElement('div');
  preview.id = 'mouse-image-preview';

  const img = createMouseExtElement('img');
  preview.appendChild(img);

  if (!MouseExtUiHost.appendToPreviewLayer(preview)) return null;
  return preview;
}

function getImagePreviewElement() {
  if (imagePreview && imagePreview.isConnected) return imagePreview;
  if (typeof MouseExtUiHost !== 'undefined') {
    const el = MouseExtUiHost.getElementById('mouse-image-preview');
    if (el) {
      imagePreview = el;
      return el;
    }
  }
  return null;
}

// 隐藏图片预览
function hideImagePreview(immediate = false) {
  if (immediate && !potentialDragImage && !potentialDragLink) {
    imagePreviewDragCandidateCache = null;
  }
  const preview = getImagePreviewElement();
  if (preview) {
    imagePreview = preview;
    preview.style.opacity = '0';
    imagePreview.style.pointerEvents = 'none';
    if (imagePreviewHideTimer) {
      clearTimeout(imagePreviewHideTimer);
      imagePreviewHideTimer = 0;
    }
    // 停止任何当前活动的元素可见性检查
    if (imagePreview._visibilityCheckInterval) {
      clearInterval(imagePreview._visibilityCheckInterval);
      imagePreview._visibilityCheckInterval = null;
    }
    // 停止任何当前活动的变异观察器
    if (imagePreview._mutationObserver) {
      imagePreview._mutationObserver.disconnect();
      imagePreview._mutationObserver = null;
    }
    
    if (immediate) {
      // 立即隐藏，用于滚动时立即关闭
      imagePreview.style.display = 'none';
      imagePreview._currentTriggerElement = null;
    } else {
      imagePreviewHideTimer = setTimeout(() => {
        imagePreviewHideTimer = 0;
        if (imagePreview && imagePreview.style.opacity === '0') {
          imagePreview.style.display = 'none';
          imagePreview._currentTriggerElement = null;
        }
      }, 100);
    }

    // 预览隐藏后，移除仅在预览显示时注册的wheel监听
    if (previewWheelListenerAttached) {
      try {
        document.removeEventListener('wheel', handleWheelScroll, { passive: true });
      } catch (e) {
        // 某些浏览器在带选项移除时需要无选项匹配
        document.removeEventListener('wheel', handleWheelScroll);
      }
      previewWheelListenerAttached = false;
    }
  } else if (previewWheelListenerAttached) {
    try {
      document.removeEventListener('wheel', handleWheelScroll, { passive: true });
    } catch (e) {
      document.removeEventListener('wheel', handleWheelScroll);
    }
    previewWheelListenerAttached = false;
    imagePreview = null;
  }
}

function ensureImagePreviewWheelListener() {
  if (previewWheelListenerAttached) return;
  try {
    document.addEventListener('wheel', handleWheelScroll, { passive: true });
  } catch (err) {
    document.addEventListener('wheel', handleWheelScroll);
  }
  previewWheelListenerAttached = true;
}

function positionImagePreviewElement(preview, e, displayWidth, displayHeight) {
  if (!preview || !e) return;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.max(1, Number(displayWidth) || 1);
  const height = Math.max(1, Number(displayHeight) || 1);

  let left = e.clientX + 20;
  let top = e.clientY + 20;

  if (e.clientX > viewportWidth / 2) {
    left = e.clientX - width - 20;
  }
  if (e.clientY > viewportHeight / 2) {
    top = e.clientY - height - 20;
  }

  left = Math.max(10, Math.min(left, viewportWidth - width - 20));
  top = Math.max(10, Math.min(top, viewportHeight - height - 20));

  preview.style.left = left + 'px';
  preview.style.top = top + 'px';
}

function showImagePreview(e, imgElement, candidate = null) {
  if (isPageScrolling) {
    return;
  }
  if (isSiteInDisabledList(window.location.href)) return;

  if (!imagePreview || !imagePreview.isConnected) {
    imagePreview = createImagePreview();
  }
  if (!imagePreview) return;

  const preview = imagePreview;
  const img = preview.querySelector('img');
  if (!img) return;

  const nextPreviewSrc = imgElement.currentSrc || imgElement.src;
  if (!nextPreviewSrc) return;
  rememberImagePreviewDragCandidate(e, candidate || { url: nextPreviewSrc, imgElement }, imgElement);
  const originalImgElement = (e && e.target && e.target.tagName === 'IMG') ? e.target : imgElement;
  const sameVisiblePreview =
    preview._currentPreviewUrl === nextPreviewSrc &&
    preview._currentTriggerElement === originalImgElement &&
    preview.style.display !== 'none';

  // 鼠标在同一张图上移动时只更新位置，不重新设置 src / onload / observer / interval。
  if (sameVisiblePreview) {
    const displayWidth = preview._displayWidth || parseFloat(img.style.width) || img.naturalWidth || 1;
    const displayHeight = preview._displayHeight || parseFloat(img.style.height) || img.naturalHeight || 1;
    positionImagePreviewElement(preview, e, displayWidth, displayHeight);
    preview.style.display = 'block';
    if (preview.style.opacity !== '1') {
      requestAnimationFrame(() => {
        if (preview._currentPreviewUrl === nextPreviewSrc) preview.style.opacity = '1';
      });
    }
    ensureImagePreviewWheelListener();
    return;
  }

  // 设置图片源
  img.src = nextPreviewSrc;
  preview._currentPreviewUrl = nextPreviewSrc;
  
  // 存储当前触发预览的元素，以便后续检查
  preview._currentTriggerElement = originalImgElement;
  
  // 检测原始图片的圆角并应用到预览
  if (originalImgElement && originalImgElement.getBoundingClientRect) {
    try {
      // 获取原始图片的计算样式
      const imgStyle = window.getComputedStyle(originalImgElement);
      
      // 处理可能的复杂圆角值（例如：10px 20px 30px 40px）
      const borderRadius = imgStyle.borderRadius || '0';
      
      // 检测是否为圆形图片
      const isCircular = detectCircularImage(originalImgElement, imgStyle);
      
      if (isCircular) {
        // 圆形图片
        img.style.borderRadius = '50%';
        preview.style.borderRadius = '50%';
        img.onload = applyPreviewLayout;
      } else if (borderRadius && borderRadius !== '0' && borderRadius !== '0px') {
        // 处理非圆形但有圆角的图片
        processRoundedCorners(img, preview, originalImgElement, borderRadius);
      } else {
        // 无圆角的普通图片
        img.style.borderRadius = '0';
        preview.style.borderRadius = '0';
        img.onload = applyPreviewLayout;
      }
    } catch (e) {
      console.error('Failed to detect image border radius:', e);
      img.style.borderRadius = '0';
      preview.style.borderRadius = '0';
      img.onload = applyPreviewLayout;
    }
  } else {
    // 无法获取原始图片元素信息，使用默认无圆角
    img.style.borderRadius = '0';
    preview.style.borderRadius = '0';
    img.onload = applyPreviewLayout;
  }
  
  // 清除任何现有的检查间隔和观察器
  if (preview._visibilityCheckInterval) {
    clearInterval(preview._visibilityCheckInterval);
    preview._visibilityCheckInterval = null;
  }
  if (preview._mutationObserver) {
    preview._mutationObserver.disconnect();
    preview._mutationObserver = null;
  }
  
  // 设置元素变化观察器，当触发预览的元素被移除时自动隐藏预览
  if (originalImgElement && originalImgElement.parentNode) {
    try {
      // 创建一个新的 MutationObserver 实例
      preview._mutationObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          // 检查是否有节点被移除
          if (mutation.type === 'childList' && mutation.removedNodes.length > 0) {
            // 检查移除的节点是否包含原始图片元素
            for (const node of mutation.removedNodes) {
              if (node === originalImgElement || 
                  (node.contains && node.contains(originalImgElement))) {
                hideImagePreview();
                return;
              }
            }
          }
          // 检查元素属性变化（如隐藏）
          if (mutation.type === 'attributes' && 
              (mutation.attributeName === 'style' || 
               mutation.attributeName === 'class' || 
               mutation.attributeName === 'hidden')) {
            if (!isElementVisible(originalImgElement)) {
              hideImagePreview();
              return;
            }
          }
        }
      });
      
      // 开始观察包含原始元素的父元素
      preview._mutationObserver.observe(originalImgElement.parentNode, {
        childList: true,       // 监视子节点的添加或删除
        attributes: true,      // 监视属性更改
        subtree: false         // 不监视后代
      });
      
      // 同时监视原始元素本身的属性变化
      preview._mutationObserver.observe(originalImgElement, {
        attributes: true,      // 监视属性更改
        attributeFilter: ['style', 'class', 'hidden']  // 仅监视影响可见性的属性
      });
    } catch (err) {
      console.error(getI18nMessage('errorMutationObserver'), err);
    }
  }
  
  // 添加定期检查，确保当元素不再可见时隐藏预览
  preview._visibilityCheckInterval = setInterval(() => {
    // 仅在预览可见时进行检查
    if (preview.style.display !== 'none' && preview.style.opacity !== '0') {
      if (originalImgElement && !isElementVisible(originalImgElement)) {
        hideImagePreview();
      } else if (!document.body.contains(originalImgElement)) {
        // 如果元素已从DOM中移除
        hideImagePreview();
      }
    } else {
      // 如果预览不再可见，停止检查
      clearInterval(preview._visibilityCheckInterval);
      preview._visibilityCheckInterval = null;
    }
  }, 500); // 每500毫秒检查一次
  
  // 检测元素是否在视图中并可见
  function isElementVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    
    try {
      // 检查元素是否连接到DOM
      if (!document.body.contains(el)) return false;
      
      // 获取元素的计算样式
      const style = window.getComputedStyle(el);
      
      // 检查元素是否通过CSS隐藏
      if (style.display === 'none' || style.visibility === 'hidden' || 
          style.opacity === '0') {
        return false;
      }
      
      // 获取元素的尺寸和位置
      const rect = el.getBoundingClientRect();
      
      // 检查元素是否有尺寸
      if (rect.width === 0 || rect.height === 0) {
        return false;
      }
      
      // 检查元素是否在视口内（至少部分可见）
      if (rect.right < 0 || rect.bottom < 0 || 
          rect.left > window.innerWidth || rect.top > window.innerHeight) {
        return false;
      }
      
      return true;
    } catch (e) {
      console.error(getI18nMessage('errorCheckVisibility'), e);
      return false;
    }
  }
  
  // 检测图片是否为圆形
  function detectCircularImage(element, style) {
    // 检查是否有50%或100%的border-radius
    if (style.borderRadius.includes('50%') || style.borderRadius === '100%') {
      return true;
    }
    
    // 检查宽高是否相等，且圆角值大于或等于宽度的一半
    if (style.width !== 'auto' && style.height !== 'auto' && style.width === style.height) {
      const width = parseFloat(style.width);
      // 处理多种圆角格式
      const radiusValues = style.borderRadius.split(' ').map(val => {
        // 提取数值部分
        const match = val.match(/^(\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : 0;
      });
      
      // 如果所有圆角值都大于等于宽度的一半
      const isAllCornersRounded = radiusValues.length > 0 && 
        radiusValues.every(value => value >= width / 2);
      
      return isAllCornersRounded;
    }
    
    return false;
  }
  
  // 处理圆角矩形图片
  function processRoundedCorners(img, preview, originalElement, borderRadiusValue) {
  img.onload = function() {
      try {
        const origRect = originalElement.getBoundingClientRect();
        const previewWidth = img.width;
        const previewHeight = img.height;
        
        // 检测原始图片是否有透明部分或者是否为透明背景
        detectImageBackground(img, originalElement).then(backgroundColor => {
          // 应用检测到的背景色
          img.style.backgroundColor = backgroundColor;
          
          // 计算缩放比例
          const widthRatio = previewWidth / origRect.width;
          const heightRatio = previewHeight / origRect.height;
          const scaleFactor = Math.max(widthRatio, heightRatio);
          
          // 处理不同格式的圆角值
          if (borderRadiusValue.includes(' ')) {
            // 多值圆角（例如：10px 20px 30px 40px）
            const radiusValues = borderRadiusValue.split(' ');
            const scaledValues = radiusValues.map(val => {
              if (val.includes('%')) {
                // 百分比值保持不变
                return val;
              } else {
                // 像素值应用缩放
                const numVal = parseFloat(val);
                const unit = val.replace(/[\d.]/g, '');
                return Math.round(numVal * scaleFactor) + (unit || 'px');
              }
            });
            
            // 应用缩放后的圆角值
            const scaledBorderRadius = scaledValues.join(' ');
            img.style.borderRadius = scaledBorderRadius;
            preview.style.borderRadius = scaledBorderRadius;
          } else {
            // 单值圆角
            let radiusValue;
            if (borderRadiusValue.includes('%')) {
              // 百分比值保持不变
              radiusValue = borderRadiusValue;
            } else {
              // 像素值应用缩放
              const numValue = parseFloat(borderRadiusValue);
              const unit = borderRadiusValue.replace(/[\d.]/g, '');
              radiusValue = Math.round(numValue * scaleFactor) + (unit || 'px');
            }
            
            img.style.borderRadius = radiusValue;
            preview.style.borderRadius = radiusValue;
          }
          
          // 继续执行原有的加载逻辑
          applyPreviewLayout();
        }).catch(() => {
          // 如果背景检测失败，使用默认设置
          img.style.backgroundColor = '#ffffff';
          applyPreviewRadius();
          applyPreviewLayout();
        });
        
        // 封装圆角应用逻辑以便重用
        function applyPreviewRadius() {
          // 处理不同格式的圆角值
          if (borderRadiusValue.includes(' ')) {
            // 多值圆角（例如：10px 20px 30px 40px）
            const radiusValues = borderRadiusValue.split(' ');
            const scaledValues = radiusValues.map(val => {
              if (val.includes('%')) {
                // 百分比值保持不变
                return val;
              } else {
                // 像素值应用缩放
                const numVal = parseFloat(val);
                const unit = val.replace(/[\d.]/g, '');
                return Math.round(numVal * scaleFactor) + (unit || 'px');
              }
            });
            
            // 应用缩放后的圆角值
            const scaledBorderRadius = scaledValues.join(' ');
            img.style.borderRadius = scaledBorderRadius;
            preview.style.borderRadius = scaledBorderRadius;
          } else {
            // 单值圆角
            let radiusValue;
            if (borderRadiusValue.includes('%')) {
              // 百分比值保持不变
              radiusValue = borderRadiusValue;
            } else {
              // 像素值应用缩放
              const numValue = parseFloat(borderRadiusValue);
              const unit = borderRadiusValue.replace(/[\d.]/g, '');
              radiusValue = Math.round(numValue * scaleFactor) + (unit || 'px');
            }
            
            img.style.borderRadius = radiusValue;
            preview.style.borderRadius = radiusValue;
          }
        }
      } catch (err) {
        console.error(getI18nMessage('errorProcessCorners'), err);
        img.style.borderRadius = '0';
        preview.style.borderRadius = '0';
        applyPreviewLayout();
      }
    };
    
    // 检测图片背景色的函数
    function detectImageBackground(imgElement, originalElement) {
      return new Promise((resolve) => {
        try {
          // 检查页面是否为深色模式
          const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
          
          // 默认采用透明背景
          let backgroundColor = 'transparent';
          
          // 尝试获取原始元素的背景色
          if (originalElement && originalElement.tagName === 'IMG') {
            // 1. 首先检查元素计算样式
            const elementStyle = window.getComputedStyle(originalElement);
            const parentStyle = window.getComputedStyle(originalElement.parentElement);
            const bodyStyle = window.getComputedStyle(document.body);
            
            // 2. 检查元素是否有明确的背景色
            if (elementStyle.backgroundColor && 
                elementStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' && 
                elementStyle.backgroundColor !== 'transparent') {
              backgroundColor = elementStyle.backgroundColor;
            } 
            // 3. 检查父元素背景色
            else if (parentStyle.backgroundColor && 
                     parentStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' && 
                     parentStyle.backgroundColor !== 'transparent') {
              backgroundColor = parentStyle.backgroundColor;
            }
            // 4. 使用body背景色
            else if (bodyStyle.backgroundColor && 
                     bodyStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' && 
                     bodyStyle.backgroundColor !== 'transparent') {
              backgroundColor = bodyStyle.backgroundColor;
            }
            // 5. 根据系统主题设置合适的背景色
            else {
              backgroundColor = isDarkMode ? '#121212' : 'transparent';
            }
          }
          
          // 检查是否可以使用Canvas进行像素分析
          // 跨域图片无法进行像素分析，直接使用预设背景色
          if (isImageCrossOrigin(imgElement)) {
            // 对于跨域图片，使用更智能的背景色判断
            const isDark = isDarkMode || isPageDark();
            // 使用半透明背景而非纯黑色，提供更好的视觉效果
            backgroundColor = isDark ? 'rgba(18, 18, 18, 0.7)' : 'rgba(255, 255, 255, 0.7)';
            resolve(backgroundColor);
            return;
          }
          
          // 检测图片是否有透明部分，需要使用canvas
          const canvas = createMouseExtElement('canvas');
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          
          // 仅针对已加载的图片进行分析
          if (imgElement.complete && imgElement.naturalWidth > 0) {
            try {
              // 设置canvas尺寸
              canvas.width = imgElement.naturalWidth;
              canvas.height = imgElement.naturalHeight;
              
              // 尝试绘制图片到canvas
              ctx.drawImage(imgElement, 0, 0);
              
              // 尝试读取像素数据（可能会因跨域限制而失败）
              try {
                // 分析策略：先检查透明度，再采样边缘颜色
                let hasTransparency = false;
                let dominantEdgeColor = null;
                
                // 1. 检查透明度（四角和中心点）
                const checkPoints = [
                  {x: 0, y: 0},  // 左上
                  {x: canvas.width - 1, y: 0},  // 右上
                  {x: 0, y: canvas.height - 1},  // 左下
                  {x: canvas.width - 1, y: canvas.height - 1},  // 右下
                  {x: Math.floor(canvas.width/2), y: Math.floor(canvas.height/2)}  // 中心
                ];
                
                // 记录边缘颜色的数组
                const edgeColors = [];
                
                for (const point of checkPoints) {
                  try {
                    const pixel = ctx.getImageData(point.x, point.y, 1, 1).data;
                    
                    // 检查透明度
                    if (pixel[3] < 255) {
                      hasTransparency = true;
                    }
                    
                    // 收集非透明的边缘颜色（只收集四个角落点）
                    if (point.x === 0 || point.x === canvas.width - 1 || 
                        point.y === 0 || point.y === canvas.height - 1) {
                      if (pixel[3] > 200) { // 只考虑几乎不透明的像素
                        edgeColors.push({
                          r: pixel[0],
                          g: pixel[1],
                          b: pixel[2],
                          a: pixel[3]
                        });
                      }
                    }
                  } catch (pixelError) {
                    // 读取单个像素出错，继续尝试其他像素点
                    console.log(getI18nMessage('errorReadPixel'), pixelError.message);
                    continue;
                  }
                }
                
                // 2. 如果图片有透明部分，我们可能需要一个背景色
                if (hasTransparency) {
                  // 如果有足够的边缘颜色样本，使用其平均值
                  if (edgeColors.length >= 2) {
                    // 计算平均边缘颜色
                    const avgColor = edgeColors.reduce((acc, color) => {
                      return {
                        r: acc.r + color.r,
                        g: acc.g + color.g,
                        b: acc.b + color.b,
                        a: acc.a + color.a
                      };
                    }, {r: 0, g: 0, b: 0, a: 0});
                    
                    avgColor.r = Math.round(avgColor.r / edgeColors.length);
                    avgColor.g = Math.round(avgColor.g / edgeColors.length);
                    avgColor.b = Math.round(avgColor.b / edgeColors.length);
                    avgColor.a = Math.round(avgColor.a / edgeColors.length);
                    
                    dominantEdgeColor = `rgba(${avgColor.r},${avgColor.g},${avgColor.b},1)`;
                    backgroundColor = dominantEdgeColor;
                  } else {
                    // 如果没有足够的边缘样本，使用更保守的背景色策略
                    const isDark = isDarkMode || isPageDark();
                    backgroundColor = isDark ? '#121212' : '#f8f8f8';
                  }
                } else {
                  // 图片没有透明部分，可以考虑不设背景色
                  backgroundColor = 'transparent';
                }
              } catch (canvasReadError) {
                // getImageData 失败，可能是因为跨域问题
                console.log(getI18nMessage('errorCanvasRead'), canvasReadError.message);
                const isDark = isDarkMode || isPageDark();
                // 使用半透明背景而非纯色，更好地适应各种页面
                backgroundColor = isDark ? 'rgba(18, 18, 18, 0.7)' : 'rgba(248, 248, 248, 0.7)';
              }
            } catch (canvasDrawError) {
              // drawImage 操作失败
              console.log(getI18nMessage('errorCanvasDraw'), canvasDrawError.message);
              const isDark = isDarkMode || isPageDark();
              // 使用更温和的背景色
              backgroundColor = isDark ? 'rgba(30, 30, 30, 0.5)' : 'rgba(240, 240, 240, 0.5)';
            } finally {
              // 清理资源
              try {
                // 在某些环境下，canvas可能没有release方法
                if (canvas.release) {
                  canvas.release();
                }
              } catch (e) {
                // 忽略清理错误
              }
            }
          }
          
          resolve(backgroundColor);
        } catch (e) {
          console.error(getI18nMessage('errorDetectBackgroundColor'), e.message || e);
          // 出错时根据页面主题选择合适的默认背景
          const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
          resolve(isDark ? '#121212' : 'transparent');
        }
      });
      
      // 检测页面整体是否为深色
      function isPageDark() {
        try {
          const bodyColor = window.getComputedStyle(document.body).backgroundColor;
          
          // 如果body没有背景色，检查html元素
          if (!bodyColor || bodyColor === 'rgba(0, 0, 0, 0)' || bodyColor === 'transparent') {
            const htmlColor = window.getComputedStyle(document.documentElement).backgroundColor;
            if (!htmlColor || htmlColor === 'rgba(0, 0, 0, 0)' || htmlColor === 'transparent') {
              return false; // 默认假设不是暗色
            }
            return !isLightBackground(htmlColor);
          }
          
          return !isLightBackground(bodyColor);
        } catch (e) {
          return false; // 出错时假设不是暗色
        }
      }
      
      // 检测图片是否跨域
      function isImageCrossOrigin(img) {
        if (!img || !img.src) return false;
        
        try {
          // 获取当前域名
          const currentDomain = window.location.hostname;
          
          // 解析图片URL的域名
          const imgUrl = new URL(img.src);
          const imgDomain = imgUrl.hostname;
          
          // 检查是否为跨域图片
          return imgDomain !== currentDomain &&
                 imgDomain !== '' &&
                 imgDomain !== 'data:'; // 排除data URL
        } catch (e) {
          // URL解析错误或其他问题
          return false;
        }
      }
    }
  }
  
  // 提取原先img.onload中的布局逻辑为一个单独的函数
  function applyPreviewLayout() {
    // 获取图片原始尺寸
    const originalWidth = img.naturalWidth;
    const originalHeight = img.naturalHeight;
    
    // 计算最大显示尺寸（考虑屏幕大小的限制）
    const maxWidth = window.innerWidth * 0.98;
    const maxHeight = window.innerHeight * 0.98;
    
    // 保持宽高比的情况下计算适合的尺寸
    let displayWidth = originalWidth;
    let displayHeight = originalHeight;
    
    // 如果图片尺寸超过最大限制，按比例缩小
    if (displayWidth > maxWidth || displayHeight > maxHeight) {
      const widthRatio = maxWidth / displayWidth;
      const heightRatio = maxHeight / displayHeight;
      const ratio = Math.min(widthRatio, heightRatio);
      
      displayWidth = Math.floor(displayWidth * ratio);
      displayHeight = Math.floor(displayHeight * ratio);
    }
    
    // 设置图片显示尺寸
    img.style.width = displayWidth + 'px';
    img.style.height = displayHeight + 'px';
    
    preview._displayWidth = displayWidth;
    preview._displayHeight = displayHeight;
    positionImagePreviewElement(preview, e, displayWidth, displayHeight);
    preview.style.display = 'block';
    
    // 使用淡入效果显示
    requestAnimationFrame(() => {
      preview.style.opacity = '1';
    });

  // 仅在预览显示期间监听wheel事件，用于立即隐藏预览
  ensureImagePreviewWheelListener();
  }

  if (img.complete && img.naturalWidth > 0 && typeof img.onload === 'function') {
    const onload = img.onload;
    requestAnimationFrame(() => {
      if (img.onload === onload && preview._currentPreviewUrl === nextPreviewSrc) {
        onload.call(img);
      }
    });
  }
}

// 获取视频封面图URL
function getVideoPosterUrl(videoElement) {
  // 首先尝试获取poster属性
  if (videoElement.poster) {
    return videoElement.poster;
  }
  
  // 检查data-poster或其他常见的自定义属性
  const customPosterAttributes = ['data-poster', 'data-thumbnail', 'data-preview'];
  for (const attr of customPosterAttributes) {
    const posterUrl = videoElement.getAttribute(attr);
    if (posterUrl) {
      return posterUrl;
    }
  }
  
  // 尝试从父元素或相邻元素查找预览图
  const parent = videoElement.parentElement;
  if (parent) {
    // 查找相邻的img元素
    const nearbyImg = parent.querySelector('img[class*="poster"], img[class*="preview"], img[class*="thumbnail"]');
    if (nearbyImg && nearbyImg.src) {
      return nearbyImg.src;
    }
  }
  
  return null;
}

// 提取 background-image 中的 URL
function getBackgroundImageInfo(el) {
  if (!el || typeof getComputedStyle !== 'function') return null;
  try {
    const style = window.getComputedStyle(el);
    const bg = style.backgroundImage || style.background;
    if (!bg || bg === 'none') return null;
    const match = bg.match(/url\s*\(\s*["']?([^"')]+)["']?\s*\)/);
    if (!match || !match[1]) return null;
    let url = match[1].trim();
    if (!url) return null;
    if (!url.startsWith('data:')) {
      try {
        url = new URL(url, el.baseURI || document.baseURI || window.location.href).href;
      } catch (_) { /* keep raw url */ }
    }
    return {
      url,
      size: style.backgroundSize || '',
      repeat: style.backgroundRepeat || '',
      position: style.backgroundPosition || '',
      attachment: style.backgroundAttachment || '',
      display: style.display || '',
      visibility: style.visibility || '',
      opacity: style.opacity || ''
    };
  } catch (_) {
    return null;
  }
}

function getBackgroundImageUrl(el) {
  const info = getBackgroundImageInfo(el);
  return info ? info.url : null;
}

// 判断 URL 是否为图片
function isImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|heic|heif)([?#].*)?$/i.test(url) || /^data:image\//i.test(url);
}

function resolveMaybeRelativeUrl(url, baseEl) {
  if (!url || typeof url !== 'string') return '';
  const raw = url.trim();
  if (!raw) return '';
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  try {
    return new URL(raw, baseEl?.baseURI || document.baseURI || window.location.href).href;
  } catch (_) {
    return raw;
  }
}

function firstUrlFromSrcset(srcset) {
  if (!srcset || typeof srcset !== 'string') return '';
  const first = srcset.split(',').map((part) => part.trim()).find(Boolean);
  return first ? first.split(/\s+/)[0] : '';
}

function getImageElementUrl(imgEl) {
  if (!imgEl || imgEl.nodeType !== Node.ELEMENT_NODE) return '';
  const attrs = [
    'currentSrc',
    'src',
    'data-src',
    'data-original',
    'data-url',
    'data-lazy-src',
    'data-actualsrc',
    'data-image',
    'data-img',
    'data-thumb',
    'data-thumbnail',
    'data-bg',
    'data-background'
  ];
  for (const attr of attrs) {
    let value = '';
    try {
      value = attr in imgEl ? imgEl[attr] : imgEl.getAttribute(attr);
    } catch (_) {
      value = '';
    }
    const resolved = resolveMaybeRelativeUrl(value, imgEl);
    if (resolved) return resolved;
  }
  try {
    const srcset = imgEl.getAttribute('srcset') || imgEl.getAttribute('data-srcset');
    const fromSrcset = resolveMaybeRelativeUrl(firstUrlFromSrcset(srcset), imgEl);
    if (fromSrcset) return fromSrcset;
  } catch (_) { /* ignore */ }
  return '';
}

function getSvgImageUrl(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
  const tag = (el.tagName || '').toLowerCase();
  if (tag !== 'image') return '';
  try {
    return resolveMaybeRelativeUrl(
      el.getAttribute('href') || el.getAttribute('xlink:href') || '',
      el
    );
  } catch (_) {
    return '';
  }
}

function isPointInElementRect(el, clientX, clientY, tolerance = 0) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return false;
  try {
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    return clientX >= rect.left - tolerance && clientX <= rect.right + tolerance &&
      clientY >= rect.top - tolerance && clientY <= rect.bottom + tolerance;
  } catch (e) {
    return false;
  }
}

function hasImageLikeDragSignal(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  try {
    const tag = el.tagName;
    if (tag === 'IMG' || tag === 'PICTURE' || tag === 'VIDEO' || tag === 'FIGURE') return true;
    const role = el.getAttribute('role') || '';
    const text = [
      tag,
      role,
      el.id || '',
      typeof el.className === 'string' ? el.className : '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('alt') || '',
      el.getAttribute('title') || ''
    ].join(' ');
    if (/\b(img|image|photo|picture|pic|avatar|thumb|thumbnail|poster|cover|logo|media|gallery|figure|background|bg[-_a-z0-9]*|artwork|banner|hero|card-img|og-image)\b/i.test(text)) {
      return true;
    }
    return !!(el.closest && el.closest('picture, figure, [role="img"]'));
  } catch (e) {
    return false;
  }
}

function getViewportAreaForImageHitTest() {
  const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
  return { viewportWidth, viewportHeight, viewportArea: viewportWidth * viewportHeight };
}

function getElementAreaRatio(rect) {
  const viewport = getViewportAreaForImageHitTest();
  const area = Math.max(0, (rect?.width || 0) * (rect?.height || 0));
  return area / viewport.viewportArea;
}

function scoreBackgroundImageCandidate(el, clientX, clientY, bgInfo, options = {}) {
  if (!el || el === document.body || el === document.documentElement) return -Infinity;
  if (!bgInfo || !bgInfo.url || String(bgInfo.url).startsWith('data:')) return -Infinity;
  if (bgInfo.display === 'none' || bgInfo.visibility === 'hidden' || bgInfo.opacity === '0') return -Infinity;
  if (!isPointInElementRect(el, clientX, clientY, 1)) return -Infinity;

  let rect;
  try {
    rect = el.getBoundingClientRect();
  } catch (_) {
    return -Infinity;
  }
  if (!rect || rect.width < 8 || rect.height < 8) return -Infinity;

  const areaRatio = getElementAreaRatio(rect);
  const hinted = hasImageLikeDragSignal(el);
  const urlLooksLikeImage = isImageUrl(bgInfo.url);
  const cssLooksImage = /\b(cover|contain)\b/i.test(bgInfo.size || '') || /no-repeat/i.test(bgInfo.repeat || '');
  const role = (el.getAttribute && el.getAttribute('role')) || '';
  const isControlSurface = /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName || '') ||
    /^(button|switch|checkbox|radio|tab|menuitem)$/i.test(role);
  if (isControlSurface && !hinted && !urlLooksLikeImage) return -Infinity;
  if ((rect.width < 24 || rect.height < 24) && !hinted && !urlLooksLikeImage) return -Infinity;
  const direct = options.relation === 'target';
  const child = options.relation === 'child';
  const ancestor = options.relation === 'ancestor';
  const depth = Math.max(0, Number(options.depth) || 0);

  let score = 0;
  if (direct) score += 20;
  if (child) score += 16;
  if (ancestor) score += Math.max(5, 16 - depth * 3);
  if (hinted) score += 30;
  if (urlLooksLikeImage) score += 28;
  if (cssLooksImage) score += 16;
  if (/^blob:/i.test(bgInfo.url)) score += 18;
  if (areaRatio <= 0.18) score += 16;
  else if (areaRatio <= 0.38) score += 12;
  else if (areaRatio <= 0.58) score += 4;
  else if (areaRatio > 0.92) score -= 60;
  else if (areaRatio > 0.76) score -= 36;
  else if (areaRatio > 0.62) score -= 18;
  if (ancestor && areaRatio > 0.45 && !hinted) score -= 18;
  if (rect.width > 32 && rect.height > 32) score += 4;
  return score;
}

function makeBackgroundImageCandidate(el, clientX, clientY, options = {}) {
  const info = getBackgroundImageInfo(el);
  if (!info) return null;
  const score = scoreBackgroundImageCandidate(el, clientX, clientY, info, options);
  const minScore = options.forDrag
    ? (options.relation === 'target' ? 36 : 42)
    : 28;
  if (score < minScore) return null;
  return { url: info.url, imgElement: { src: info.url }, score, source: 'background' };
}

function shouldAcceptBackgroundImageForDrag(el, clientX, clientY, bgUrl, options = {}) {
  const bgInfo = { url: bgUrl, size: '', repeat: '', display: '', visibility: '', opacity: '' };
  return scoreBackgroundImageCandidate(el, clientX, clientY, bgInfo, Object.assign({ forDrag: true }, options)) >= 42;
}

function makeImageCandidateFromElement(img, source) {
  const url = getImageElementUrl(img);
  return url ? { url, imgElement: img, score: 100, source: source || 'img' } : null;
}

function findBestImgUnderPoint(root, clientX, clientY, limit = 30) {
  if (!root || !root.querySelectorAll) return null;
  const imgs = root.querySelectorAll('img, picture img');
  let best = null;
  const max = Math.min(imgs.length, limit);
  for (let i = 0; i < max; i++) {
    const img = imgs[i];
    const url = getImageElementUrl(img);
    if (!url) continue;
    let rect;
    try {
      rect = img.getBoundingClientRect();
    } catch (_) {
      continue;
    }
    if (!rect || rect.width < 4 || rect.height < 4) continue;
    if (!isPointInElementRect(img, clientX, clientY, 2)) continue;
    const area = rect.width * rect.height;
    const score = 100 + Math.min(20, area / 5000);
    if (!best || score > best.score) {
      best = { url, imgElement: img, score, source: 'descendant-img' };
    }
  }
  return best;
}

// 查找可用于图片预览/图片拖拽的图片 URL，支持 IMG、VIDEO poster、SVG image、background-image 等来源
// skipThrottle: 为 true 时跳过节流，适用于 mousedown/dragstart 等即时命中检测
// options.forDrag: 为图片拖拽模式，会使用拖拽开关并放宽增强查找
// options.fastOnly: 仅检查 IMG/VIDEO/直接图片链接等 O(1) 快速路径，避免 mouseover 高频遍历 DOM
function findImageForPreview(target, clientX, clientY, skipThrottle, options = {}) {
  const forDrag = !!(options && options.forDrag);
  const fastOnly = !!(options && options.fastOnly);
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return null;
  if (forDrag) {
    if (!settings?.enableImageDrag) return null;
  } else if (!settings?.enableImagePreview) {
    return null;
  }

  const directImg = target.tagName === 'IMG' ? makeImageCandidateFromElement(target, 'direct-img') : null;
  if (directImg) return directImg;

  const svgImageUrl = getSvgImageUrl(target);
  if (svgImageUrl) return { url: svgImageUrl, imgElement: { src: svgImageUrl }, score: 96, source: 'svg-image' };

  if (target.tagName === 'VIDEO') {
    const url = getVideoPosterUrl(target);
    return url ? { url, imgElement: { src: url }, score: 90, source: 'video-poster' } : null;
  }

  if (target.tagName === 'PICTURE') {
    const pictureImg = target.querySelector && target.querySelector('img');
    const candidate = makeImageCandidateFromElement(pictureImg, 'picture-img');
    if (candidate && isPointInElementRect(pictureImg, clientX, clientY, 2)) return candidate;
  }

  if (target.tagName === 'A' && target.href && isImageUrl(target.href)) {
    return { url: target.href, imgElement: { src: target.href }, score: 86, source: 'image-link' };
  }

  if (fastOnly) return null;

  const allowEnhancedLookup = forDrag || settings.enableImagePreviewEnhanced;
  if (!allowEnhancedLookup) return null;

  if (!skipThrottle && !forDrag) {
    const now = Date.now();
    if (now - lastEnhancedImageLookupTime < 150) return null;
    lastEnhancedImageLookupTime = now;
  }

  const candidates = [];
  const addCandidate = (candidate) => {
    if (candidate && candidate.url) candidates.push(candidate);
  };

  addCandidate(makeBackgroundImageCandidate(target, clientX, clientY, {
    forDrag,
    relation: 'target',
    depth: 0
  }));

  const tag = target.tagName;
  if (tag === 'BUTTON') {
    const next = target.nextElementSibling;
    if (next) {
      const img = (next.tagName === 'IMG') ? next : (next.querySelector && next.querySelector('img'));
      const candidate = makeImageCandidateFromElement(img, 'button-next-img');
      if (candidate && isPointInElementRect(img, clientX, clientY, 2)) addCandidate(candidate);
    }
  }

  const MAX_PARENT_DEPTH = 6;
  const MAX_BG_CHECK_DEPTH = 4;
  let depth = 0;
  let el = target;
  while (el && el !== document.body && depth < MAX_PARENT_DEPTH) {
    if (depth > 0) {
      addCandidate(findBestImgUnderPoint(el, clientX, clientY, 24));
    }
    if (depth <= MAX_BG_CHECK_DEPTH) {
      addCandidate(makeBackgroundImageCandidate(el, clientX, clientY, {
        forDrag,
        relation: depth === 0 ? 'target' : 'ancestor',
        depth
      }));
    }
    el = el.parentElement;
    depth++;
  }

  if (target !== document.body && target !== document.documentElement) {
    const tagUpper = tag ? tag.toUpperCase() : '';
    if (tagUpper !== 'SVG' && tagUpper !== 'PATH' && tagUpper !== 'G' && tagUpper !== 'CIRCLE' && tagUpper !== 'RECT') {
      const childCount = target.children ? target.children.length : 0;
      if (childCount <= 48) {
        addCandidate(findBestImgUnderPoint(target, clientX, clientY, 24));
        const children = target.children || [];
        for (let i = 0; i < Math.min(children.length, 16); i++) {
          addCandidate(makeBackgroundImageCandidate(children[i], clientX, clientY, {
            forDrag,
            relation: 'child',
            depth: 1
          }));
        }
      }
    }
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
  return candidates[0];
}

// 处理鼠标移动到图片或视频上
function handleImageMouseOver(e) {
  const target = e.target;
  if (!settings.enableImagePreview) return;
  if (isSiteInDisabledList(window.location.href)) return;
  if (isPageScrolling) return;
  if (scrollPreviewDelayTimer) return;

  // mouseover 是页面常驻高频入口：先只做 O(1) 快速判断，复杂增强查找放到下一帧，避免偶发卡顿。
  const found = findImageForPreview(target, e.clientX, e.clientY, false, { fastOnly: true });
  const previewUrl = found ? found.url : null;
  const imgElement = found ? found.imgElement : null;

  // 同步未找到且开启增强时，延迟到下一帧再查（skipThrottle 避免重复节流），避免阻塞主线程
  if (!found && settings.enableImagePreviewEnhanced) {
    if (imagePreviewDeferredRafId) cancelAnimationFrame(imagePreviewDeferredRafId);
    const ev = { target, clientX: e.clientX, clientY: e.clientY };
    imagePreviewDeferredRafId = requestAnimationFrame(() => {
      imagePreviewDeferredRafId = 0;
      const deferred = findImageForPreview(ev.target, ev.clientX, ev.clientY, true);
      if (deferred) showImagePreview(ev, deferred.imgElement, deferred);
    });
  }

  if (previewUrl && imgElement) {
    if (imagePreviewDeferredRafId) {
      cancelAnimationFrame(imagePreviewDeferredRafId);
      imagePreviewDeferredRafId = 0;
    }
    // 清除任何现有的预览隐藏定时器
    if (target._hidePreviewTimer) {
      clearTimeout(target._hidePreviewTimer);
      target._hidePreviewTimer = null;
    }
    showImagePreview(e, imgElement, found);
    
    // 移除之前的事件监听器
    if (target._mouseMoveHandler) {
      target.removeEventListener('mousemove', target._mouseMoveHandler);
    }
    if (target._mouseOutHandler) {
      target.removeEventListener('mouseout', target._mouseOutHandler);
    }
    
    // 创建新的事件处理函数
    target._mouseMoveHandler = (moveEvent) => {
      if (target._hidePreviewTimer) {
        clearTimeout(target._hidePreviewTimer);
        target._hidePreviewTimer = null;
      }
      
      // 只有在鼠标移动超过阈值距离时才更新预览位置
      const dx = moveEvent.clientX - e.clientX;
      const dy = moveEvent.clientY - e.clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > 5) {
        showImagePreview(moveEvent, imgElement);
      }
    };
    
    target._mouseOutHandler = () => {
      // 添加延迟，防止鼠标快速移动导致的闪烁
      target._hidePreviewTimer = setTimeout(() => {
        hideImagePreview();
        target._hidePreviewTimer = null;
        
        // 清理事件监听器
        if (target._mouseMoveHandler) {
          target.removeEventListener('mousemove', target._mouseMoveHandler);
          target._mouseMoveHandler = null;
        }
        if (target._mouseOutHandler) {
          target.removeEventListener('mouseout', target._mouseOutHandler);
          target._mouseOutHandler = null;
        }
      }, 100);
    };
    
    // 添加新的事件监听器
    target.addEventListener('mousemove', target._mouseMoveHandler);
    target.addEventListener('mouseout', target._mouseOutHandler);
  }
}

// 按住右键 + 滚轮/左键 手势处理（需阻止松开后弹出右键菜单）
function bolsterLeftHoldWheelAgainstTextSelection() {
  try {
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount) sel.removeAllRanges();
  } catch (_) { /* ignore */ }

  if (leftHoldWheelSelectGuardActive) return;
  leftHoldWheelSelectGuardActive = true;

  const html = document.documentElement;
  const body = document.body;
  leftHoldWheelSelectGuardPrevHtmlUserSelect = html.style.userSelect;
  leftHoldWheelSelectGuardPrevBodyUserSelect = body ? body.style.userSelect : '';
  html.style.userSelect = 'none';
  if (body) body.style.userSelect = 'none';

  const onSelectStart = (ev) => {
    ev.preventDefault();
  };

  const endGuard = () => {
    if (!leftHoldWheelSelectGuardActive) return;
    leftHoldWheelSelectGuardActive = false;
    html.style.userSelect = leftHoldWheelSelectGuardPrevHtmlUserSelect;
    if (body) body.style.userSelect = leftHoldWheelSelectGuardPrevBodyUserSelect;
    document.removeEventListener('selectstart', onSelectStart, true);
    window.removeEventListener('pointerup', onPointerOrMouseUp, true);
    window.removeEventListener('mouseup', onPointerOrMouseUp, true);
  };

  const onPointerOrMouseUp = (ev) => {
    if (ev.pointerType && ev.pointerType !== 'mouse') return;
    if (ev.button !== 0) return;
    endGuard();
  };

  document.addEventListener('selectstart', onSelectStart, { capture: true });
  window.addEventListener('pointerup', onPointerOrMouseUp, { capture: true });
  window.addEventListener('mouseup', onPointerOrMouseUp, { capture: true });
}

function clearGestureTrailAfterAuxiliaryAction() {
  if (isGestureCanvasLive()) clearGestureCanvas();
  resetGestureState();
}

function handleWheelWithRightHold(e) {
  if (!isTrustedUserEvent(e)) return;
  if (!settings?.enableGesture || !isExtensionValid || isSiteInDisabledList(window.location.href)) return;
  const rightHeld = e.buttons === 2 || (isMacOS && e.ctrlKey && e.buttons === 1);
  if (!rightHeld) return;
  e.preventDefault();
  e.stopPropagation();
  const action = e.deltaY < 0
    ? (settings.gestureRightHoldWheelUpAction || 'scrollToTop')
    : (settings.gestureRightHoldWheelDownAction || 'scrollToBottom');
  if (action === 'noAction') return;
  lastGestureEndTime = Date.now();
  rightHoldGestureEndTime = lastGestureEndTime;
  cachedGestureState.lastGestureEndTime = lastGestureEndTime;
  syncGestureStateToStorage(false, lastGestureEndTime);
  enableGesturePreventDefault();
  if (preventDefaultTimeout) clearTimeout(preventDefaultTimeout);
  preventDefaultTimeout = setTimeout(disableGesturePreventDefault, 500);
  executeCustomGestureAction(action, null, clearGestureTrailAfterAuxiliaryAction);
}

function handleWheelWithLeftHold(e) {
  if (!isTrustedUserEvent(e)) return;
  if (!settings?.enableGesture || !isExtensionValid || isSiteInDisabledList(window.location.href)) return;
  // Mac Ctrl+click 视为右键：交给「按住右键+滚轮」逻辑
  if (isMacOS && e.ctrlKey && e.buttons === 1) return;
  if ((e.buttons & 2) === 2) return;
  const leftHeld = (e.buttons & 1) === 1;
  if (!leftHeld) return;
  e.preventDefault();
  e.stopPropagation();
  const action = e.deltaY < 0
    ? (settings.gestureLeftHoldWheelUpAction || 'noAction')
    : (settings.gestureLeftHoldWheelDownAction || 'noAction');
  if (action === 'noAction') return;
  if (action === 'zoomIn' || action === 'zoomOut') {
    bolsterLeftHoldWheelAgainstTextSelection();
  }
  lastGestureEndTime = Date.now();
  rightHoldGestureEndTime = lastGestureEndTime;
  cachedGestureState.lastGestureEndTime = lastGestureEndTime;
  syncGestureStateToStorage(false, lastGestureEndTime);
  enableGesturePreventDefault();
  if (preventDefaultTimeout) clearTimeout(preventDefaultTimeout);
  preventDefaultTimeout = setTimeout(disableGesturePreventDefault, 500);
  executeCustomGestureAction(action, null, clearGestureTrailAfterAuxiliaryAction);
}

function handleLeftClickWithRightHold(e) {
  if (!isTrustedUserEvent(e)) return;
  if (!settings?.enableGesture || !isExtensionValid || isSiteInDisabledList(window.location.href)) return;
  if (e.button !== 0) return;
  const rightHeld = (e.buttons & 2) === 2;
  if (!rightHeld) return;
  e.preventDefault();
  e.stopPropagation();
  const action = settings.gestureRightHoldLeftClickAction || 'noAction';
  if (action === 'noAction') return;
  lastGestureEndTime = Date.now();
  rightHoldGestureEndTime = lastGestureEndTime;
  cachedGestureState.lastGestureEndTime = lastGestureEndTime;
  syncGestureStateToStorage(false, lastGestureEndTime);
  enableGesturePreventDefault();
  if (preventDefaultTimeout) clearTimeout(preventDefaultTimeout);
  preventDefaultTimeout = setTimeout(disableGesturePreventDefault, 500);
  executeCustomGestureAction(action, null, clearGestureTrailAfterAuxiliaryAction);
}

function handleRightClickWithLeftHold(e) {
  if (!isTrustedUserEvent(e)) return;
  if (!settings?.enableGesture || !isExtensionValid || isSiteInDisabledList(window.location.href)) return;
  if (e.button !== 2) return;
  const leftHeld = (e.buttons & 1) === 1;
  if (!leftHeld) return;
  e.preventDefault();
  e.stopPropagation();
  const action = settings.gestureLeftHoldRightClickAction || 'noAction';
  if (action === 'noAction') return;
  lastGestureEndTime = Date.now();
  rightHoldGestureEndTime = lastGestureEndTime;
  cachedGestureState.lastGestureEndTime = lastGestureEndTime;
  syncGestureStateToStorage(false, lastGestureEndTime);
  enableGesturePreventDefault();
  if (preventDefaultTimeout) clearTimeout(preventDefaultTimeout);
  preventDefaultTimeout = setTimeout(disableGesturePreventDefault, 500);
  executeCustomGestureAction(action, null, clearGestureTrailAfterAuxiliaryAction);
}

// 注册事件监听器：早期手势 vs DOM 就绪后的拖拽/预览/UI
let earlyGestureListenersRegistered = false;
let earlySuperDragListenersRegistered = false;
let deferredDomListenersRegistered = false;

function registerEarlySuperDragEventListeners() {
  if (!mouseExtListenerFlag('earlySuperDragListeners')) return;
  initCrossFrameSuperDragStorageListener();
  try {
    window.addEventListener('dragstart', handleDragStart, { capture: true, passive: false });
    window.addEventListener('drag', handleDragMove, { capture: true, passive: false });
    window.addEventListener('dragend', handleDragEnd, { capture: true, passive: false });
    document.addEventListener('dragover', handleSuperDragDragOver, { capture: true, passive: false });
    window.addEventListener('mousedown', handleSuperDragLinkMouseDown, { capture: true, passive: true });
    window.addEventListener('mousedown', handleSuperDragNavigationSuppress, { capture: true, passive: false });
    window.addEventListener('mouseup', handleSuperDragNavigationSuppress, { capture: true, passive: false });
    window.addEventListener('click', handleSuperDragNavigationSuppress, { capture: true, passive: false });
    window.addEventListener('auxclick', handleSuperDragNavigationSuppress, { capture: true, passive: false });
    console.log('早期超级拖拽监听器注册成功');
  } catch (e) {
    console.log('注册早期超级拖拽监听器失败:', e.message);
  }
}

function registerEarlyGestureEventListeners() {
  if (!mouseExtListenerFlag('earlyGestureListeners')) return;
  initContentContext();
  initCrossFrameGestureStorageListener();
  try {
    // 按住右键 + 滚轮 / 按住左键 + 滚轮 / 按住右键 + 左键 / 按住左键 + 右键
    window.addEventListener('wheel', handleWheelWithRightHold, { capture: true, passive: false });
    window.addEventListener('wheel', handleWheelWithLeftHold, { capture: true, passive: false });
    window.addEventListener('mousedown', handleLeftClickWithRightHold, { capture: true, passive: false });
    window.addEventListener('mousedown', handleRightClickWithLeftHold, { capture: true, passive: false });
    window.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: false });
    window.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', handlePointerUp, { capture: true, passive: false });
    window.addEventListener('pointercancel', handlePointerUp, { capture: true, passive: false });
    window.addEventListener('contextmenu', handleContextMenu, { capture: true, passive: false });

    if (isMacOS) {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Control') {
          // 暂不做任何操作，为后续可能的扩展预留
        }
      }, { capture: true, passive: true });

      window.addEventListener('keyup', (e) => {
        if (e.key === 'Control') {
          if (!isTrustedUserEvent(e)) return;
          if (isRightMouseDown || isGestureInProgress) {
            isRightMouseDown = false;
            if (isGestureInProgress) {
              finalizeActiveGestureRecognition();
            } else {
              resetGestureState();
              clearGestureCanvas();
            }
          }
        }
      }, { capture: true, passive: true });
    }

    console.log('早期手势监听器注册成功');
  } catch (e) {
    console.log('注册早期手势监听器失败:', e.message);
  }
}

function registerDeferredDomEventListeners() {
  if (!mouseExtListenerFlag('deferredDomListeners')) return;
  try {
    window.addEventListener('scroll', handlePageScroll, { passive: true });
    window.addEventListener('drop', handleDrop, { capture: false, passive: false });
    window.addEventListener('dragleave', handleDragLeave, { capture: false, passive: false });
    window.addEventListener('resize', handleResize, { capture: false, passive: true });
    window.addEventListener('mouseover', handleImageMouseOver, { capture: true, passive: true });

    console.log('DOM 依赖监听器注册成功');
  } catch (e) {
    console.log('注册 DOM 依赖监听器失败:', e.message);
  }
}

let contentScriptInitialized = false;

// document_start：仅注册手势核心监听
function bootstrapContentScriptEarly() {
  if (!mouseExtListenerFlag('contentBootstrapEarly')) return;
  try {
    initNvidiaGpuDetection();
    registerEarlyGestureEventListeners();
    registerEarlySuperDragEventListeners();
    checkExtensionValidity();
  } catch (e) {
    console.log('早期初始化鼠标手势扩展失败:', e.message);
  }
}

// DOMContentLoaded：拖拽、图片预览、小窗预览、调试面板等
function initializeDomDependentFeatures() {
  if (contentScriptInitialized) return;
  contentScriptInitialized = true;
  try {
    registerDeferredDomEventListeners();
    if (typeof initLinkPreview === 'function') {
      initLinkPreview();
    }
    initDebugPanelState();
  } catch (e) {
    console.log('初始化 DOM 依赖功能失败:', e.message);
  }
}

// 初始化调试面板状态 - 新增函数
function initDebugPanelState() {
  try {
    if (!enableDebugPanelSetting) return;
    const panelVisible = localStorage.getItem('mouseGestureDebugPanelVisible');
    if (panelVisible === 'true') {
      // 如果之前是可见的，则重新显示面板
      isDebugPanelVisible = true;
      // 延迟一点初始化面板，确保DOM已经完全加载
      setTimeout(() => {
        if (document.body) {
          initDebugPanel();
        }
      }, 500);
    }
  } catch (e) {
    console.log('初始化调试面板状态错误:', e.message);
  }
}

bootstrapContentScriptEarly();

function scheduleDomDependentInitialization() {
  const run = () => initializeDomDependentFeatures();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    // 同批 content_scripts 中 preview.js 排在后面，推迟到下一任务再初始化
    setTimeout(run, 0);
  }
}

scheduleDomDependentInitialization();

// 重置拖拽信息
function resetDragInfo() {
  hideSuperDragCompass();
  clearSuperDragSessionStorage();
  disableSyntheticSuperDragSelectionGuard();
  potentialDragImage = null;
  potentialDragLink = null;
  potentialDragEditable = null;
  potentialDragSelection = null;
  lastLockedSuperDragDirection = '';
  editableSuperDragSessionSynced = false;
  endSuperDragSession();
  dragInfo = {
    startX: 0,
    startY: 0,
    direction: '',
    target: null,
    url: '',
    text: '',
    type: '',
    savedSelection: null,
    editableSource: null
  };
} 

// 添加一个新函数用于显示自动关闭重复标签页的成功通知（仅顶层 frame）
function showAutoCloseSuccessNotification(data) {
  try {
    if (window !== window.top) return;
    if (typeof MouseExtUiHost === 'undefined') return;
    MouseExtUiHost.removeElementById('mouse-gesture-notification-container');
    
    const count = String(data.count ?? 0);
    const texts = {
      title: getI18nMessage('autoClosedTabs', [count],
        `Automatically closed ${count} duplicate tab${Number(count) !== 1 ? 's' : ''}`)
    };
    
    // 创建通知容器
    const container = createMouseExtElement('div');
    container.id = 'mouse-gesture-notification-container';
    container.style.position = 'fixed';
    container.style.bottom = '28px';
    container.style.left = '50%';
    container.style.transform = 'translateX(-50%)';
    container.style.zIndex = '2147483647';
    container.style.transition = 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    container.style.opacity = '0';
    container.style.filter = 'drop-shadow(0 8px 20px rgba(0, 0, 0, 0.15))';
    container.style.maxWidth = '420px';
    container.style.width = 'calc(100% - 40px)';
    
    // 创建通知框 - 使用现代化渐变背景（成功样式）
    const notification = createMouseExtElement('div');
    notification.style.background = 'linear-gradient(135deg, rgba(46, 125, 100, 0.92) 0%, rgba(35, 105, 85, 0.94) 100%)';
    notification.style.color = '#ffffff';
    notification.style.padding = '16px 22px';
    notification.style.borderRadius = '16px';
    notification.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.18), inset 0 1px 2px rgba(255, 255, 255, 0.1)';
    notification.style.display = 'flex';
    notification.style.alignItems = 'flex-start';
    notification.style.backdropFilter = 'blur(12px)';
    notification.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    notification.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    
    // 创建成功图标 - 缩小尺寸
    const icon = createMouseExtElement('div');
    icon.innerHTML = '✅';
    icon.style.fontSize = '18px'; // 从22px减小到18px
    icon.style.marginInlineEnd = '12px'; // 从14px减小到12px
    icon.style.marginTop = '2px';
    icon.style.display = 'flex';
    icon.style.alignItems = 'center';
    icon.style.justifyContent = 'center';
    icon.style.width = '32px'; // 从38px减小到32px
    icon.style.height = '32px'; // 从38px减小到32px
    icon.style.borderRadius = '10px'; // 从12px减小到10px
    icon.style.background = 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.05) 100%)';
    icon.style.boxShadow = 'inset 0 1px 1px rgba(255, 255, 255, 0.1)';
    
    // 信息容器
    const content = createMouseExtElement('div');
    content.style.flexGrow = '1';
    
    // 成功消息标题
    const title = createMouseExtElement('div');
    title.textContent = texts.title;
    title.style.fontWeight = '600';
    title.style.fontSize = '15px';
    title.style.marginBottom = '6px';
    title.style.letterSpacing = '0.3px';
    title.style.color = '#FFFFFF';
    title.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.1)';
    
    // 创建URL列表容器
    const urlListContainer = createMouseExtElement('div');
    urlListContainer.style.fontSize = '13px';
    urlListContainer.style.lineHeight = '1.5';
    urlListContainer.style.color = '#f0fff5';
    urlListContainer.style.opacity = '0.9';
    
    // 显示已关闭的标签页标题，最多3个
    if (data.titles && data.titles.length > 0) {
      // 简单显示已关闭的标签
      const maxTitlesToShow = Math.min(data.titles.length, 3);
      
      for (let i = 0; i < maxTitlesToShow; i++) {
        const urlItem = createMouseExtElement('div');
        urlItem.style.display = 'flex';
        urlItem.style.alignItems = 'center';
        
        // 添加小圆点作为前缀
        const bullet = createMouseExtElement('span');
        bullet.textContent = '•';
        bullet.style.color = '#8EEDC7';
        bullet.style.marginInlineEnd = '6px';
        bullet.style.fontSize = '16px';
        
        // URL标题
        const urlTitle = createMouseExtElement('span');
        urlTitle.textContent = data.titles[i];
        urlTitle.style.whiteSpace = 'nowrap';
        urlTitle.style.overflow = 'hidden';
        urlTitle.style.textOverflow = 'ellipsis';
        urlTitle.style.maxWidth = '300px';
        
        urlItem.appendChild(bullet);
        urlItem.appendChild(urlTitle);
        urlListContainer.appendChild(urlItem);
      }
    }
    
    // 组装通知
    content.appendChild(title);
    if (data.titles && data.titles.length > 0) {
      content.appendChild(urlListContainer);
    }
    notification.appendChild(icon);
    notification.appendChild(content);
    container.appendChild(notification);

    if (!MouseExtUiHost.appendToNotificationsLayer(container)) return;
    
    // 淡入效果
    setTimeout(() => {
      container.style.opacity = '1';
      container.style.transform = 'translate(-50%, -5px)';
      
      // 稍后恢复正常位置，产生弹性效果
      setTimeout(() => {
        container.style.transform = 'translate(-50%, 0)';
      }, 180);
    }, 10);
    
    // 4秒后自动淡出（比普通通知更短）
    setTimeout(() => {
      try {
        container.style.opacity = '0';
        container.style.transform = 'translate(-50%, 10px)';
        setTimeout(() => {
          try {
            if (container.parentNode) {
              container.parentNode.removeChild(container);
            }
          } catch (e) {
            console.log('自动关闭通知错误:', e.message);
          }
        }, 400);
      } catch (e) {
        console.log('通知淡出效果错误:', e.message);
      }
    }, 4000);
  } catch (e) {
    console.error('显示自动关闭成功通知错误:', e.message);
  }
} 

// 更新手势画布设置
function updateGestureCanvasSettings() {
  applyGestureTrailContextStyles(gestureContext);
} 

// 查找页面中的"下一页"链接
// 优化策略：优先使用URL构造的链接，避免JavaScript URL报错
// 优先级排序：
// 1. URL参数构造 (最可靠)
// 2. URL路径构造 
// 3. offset/limit参数构造
// 4. rel="next"链接
// 5. 文本匹配链接
// 6. CSS类匹配链接  
// 7. 图标匹配链接
// 8. 分页容器链接
// 所有策略都会过滤JavaScript URL以避免CSP错误
function findNextPageLink() {
  // Google 搜索结果页：优先用 URL 构造（不依赖 DOM），再尝试 DOM 查找
  if (window.location.hostname.match(/^([\w-]+\.)?google\./)) {
    const gParams = new URLSearchParams(window.location.search);
    const hasQuery = gParams.has('q') || gParams.has('query');
    if (hasQuery && (window.location.pathname.includes('/search') || gParams.has('start'))) {
      const start = parseInt(gParams.get('start') || '0', 10);
      if (!isNaN(start) && start >= 0) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('start', String(start + 10));
        const virtualLink = createMouseExtElement('a');
        virtualLink.href = nextUrl.href;
        virtualLink._constructedFromUrl = true;
        virtualLink._urlBased = true;
        return virtualLink;
      }
    }
    // DOM 备用：aria-label、pnnext、div[role="navigation"]
    let googleNext = document.querySelector('a[aria-label="下一页"], a[aria-label="Next page"]');
    if (!googleNext) googleNext = document.getElementById('pnnext');
    if (!googleNext) {
      const navDivs = document.querySelectorAll('div[role="navigation"]');
      let paginationNav = null;
      for (const div of navDivs) {
        const links = div.querySelectorAll('a[href]');
        if (Array.from(links).some(a => a.href && (a.href.includes('start=') || a.href.includes('?q=')))) {
          paginationNav = div;
          break;
        }
      }
      if (!paginationNav && navDivs.length > 0) paginationNav = navDivs[navDivs.length - 1];
      if (paginationNav) {
        const links = paginationNav.querySelectorAll('a[href]');
        if (links.length > 0) googleNext = links[links.length - 1];
      }
    }
    if (googleNext && googleNext.href && !googleNext.href.toLowerCase().startsWith('javascript:')) {
      return googleNext;
    }
    // 兜底：pathname 含 /search 时直接按 start 构造，避免偶发漏检
    if (window.location.pathname.includes('/search')) {
      const start = parseInt(gParams.get('start') || '0', 10);
      if (!isNaN(start) && start >= 0) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('start', String(start + 10));
        const v = createMouseExtElement('a');
        v.href = nextUrl.href;
        v._constructedFromUrl = true;
        v._urlBased = true;
        return v;
      }
    }
    return null;
  }

  // Bing 搜索结果页：优先用 URL 构造（first=1,11,21... 每页10条）
  if (window.location.hostname.includes('bing.com') && window.location.pathname.includes('/search')) {
    const bingParams = new URLSearchParams(window.location.search);
    const first = parseInt(bingParams.get('first') || '1', 10);
    if (!isNaN(first) && first >= 1) {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('first', String(first + 10));
      const virtualLink = createMouseExtElement('a');
      virtualLink.href = nextUrl.href;
      virtualLink._constructedFromUrl = true;
      virtualLink._urlBased = true;
      return virtualLink;
    }
  }

  // 百度搜索特殊处理：pn=0,10,20... 每页10条
  if (window.location.hostname.includes('baidu.com') && window.location.pathname.includes('/s')) {
    const bParams = new URLSearchParams(window.location.search);
    if (bParams.has('wd') || bParams.has('word')) {
      const pn = parseInt(bParams.get('pn') || '0', 10);
      if (!isNaN(pn) && pn >= 0) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set('pn', String(pn + 10));
        const virtualLink = createMouseExtElement('a');
        virtualLink.href = nextUrl.href;
        virtualLink._constructedFromUrl = true;
        virtualLink._urlBased = true;
        return virtualLink;
      }
    }
  }

  // 优先策略1：从URL参数构造下一页链接
  // 支持 page、p、pn、first 等，并根据站点/limit 推断增量（+1/+5/+10/+20）
  const urlParams = new URLSearchParams(window.location.search);
  const pageParamKeys = []; // 收集所有像页码的参数名
  for (const [key] of urlParams) {
    const k = key.toLowerCase();
    if (/page|^p$|^pn$|^pg$|paged|pagenum|cpage|pageid|pageindex|pageno|pagenumber|^first$/.test(k) ||
        ['offset', 'start', 'from', 'begin', 'current', 'pages'].includes(k)) {
      pageParamKeys.push(key);
    }
  }
  // 页码类参数（+1 递增）与 offset 类参数（按 limit 递增）分开处理
  const pageLikeKeys = ['page', 'p', 'pg', 'paged', 'pagenum', 'pn', 'cpage', 'current', 'pages', 'pageid', 'pageIndex', 'pageNo', 'pageNumber', 'first'];
  const offsetLikeKeys = ['offset', 'start', 'from', 'begin', 'skip'];
  const limitKeys = ['limit', 'size', 'count', 'per_page', 'perpage', 'pagesize', 'num', 'rn'];

  // 尝试从页面上的分页链接推断增量（优先扫描分页容器，避免全页 a[href]）
  function inferPageIncrement(paramKey, currentVal) {
    const paginationRoots = document.querySelectorAll(
      '[class*="pagination"], [id*="pagination"], nav, [role="navigation"], .pager, .pages, .page-numbers'
    );
    const links = [];
    if (paginationRoots.length) {
      for (let i = 0; i < paginationRoots.length; i++) {
        const part = paginationRoots[i].querySelectorAll('a[href]');
        for (let j = 0; j < part.length; j++) links.push(part[j]);
      }
    }
    if (!links.length) {
      const all = document.querySelectorAll('a[href]');
      for (let i = 0; i < all.length && links.length < 400; i++) links.push(all[i]);
    }
    const candidates = [];
    for (const a of links) {
      try {
        const u = new URL(a.href, window.location.origin);
        const v = u.searchParams.get(paramKey);
        if (v !== null) {
          const n = parseInt(v, 10);
          if (!isNaN(n) && n !== currentVal) candidates.push(n);
        }
      } catch (_) {}
    }
    if (candidates.length === 0) return null;
    const diffs = [...new Set(candidates.map(n => Math.abs(n - currentVal)))].filter(d => d > 0).sort((a, b) => a - b);
    return diffs[0] || null;
  }

  for (const pattern of pageParamKeys) {
    const key = pattern;
    const currentStr = urlParams.get(key);
    const currentVal = parseInt(currentStr, 10);
    if (isNaN(currentVal) && key.toLowerCase() !== 'first') continue;

    let increment = 1;
    const keyLower = key.toLowerCase();
    if (offsetLikeKeys.includes(keyLower)) {
      for (const lk of limitKeys) {
        if (urlParams.has(lk)) {
          const lim = parseInt(urlParams.get(lk), 10);
          if (!isNaN(lim) && lim > 0 && lim <= 100) {
            increment = lim;
            break;
          }
        }
      }
      if (increment === 1) increment = 10;
    } else {
      const inferred = inferPageIncrement(key, currentVal);
      if (inferred !== null) increment = inferred;
    }

    const baseVal = isNaN(currentVal) ? 0 : currentVal;
    const nextVal = baseVal + increment;
    if (nextVal > 10000) continue;

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set(key, String(nextVal));
    const virtualLink = createMouseExtElement('a');
    virtualLink.href = nextUrl.href;
    virtualLink._constructedFromUrl = true;
    virtualLink._urlBased = true;
    return virtualLink;
  }
  
  // 优先策略2：检查URL路径中的数字模式（以 page 为关键词：page-2, page/2, p/2, p2 等）
  const pathPatterns = [
    /\/(\d+)\/?$/,                    // /123/ 或 /123
    /\/(\d+)\.html?$/i,               // /123.html 或 /123.htm
    /\/(\d+)\.php$/i,                 // /123.php
    /\/(\d+)\.aspx?$/i,               // /123.asp 或 /123.aspx
    /-(\d+)\/?$/,                     // -123/ 或 -123
    /_(\d+)\/?$/,                     // _123/ 或 _123
    /(\d+)\/$/,                       // 123/
    /\/page[-_]?(\d+)/i,              // /page2, /page-2, /page_2
    /\/page\/(\d+)/i,                 // /page/2
    /\/p\/(\d+)/i,                    // /p/2
    /\/p[-_]?(\d+)/i,                 // /p2, /p-2
    /\/page-?(\d+)/i,                 // /page123 或 /page-123（兼容旧）
    /\/p(\d+)/i                       // /p123
  ];
  
  for (const pattern of pathPatterns) {
    const pathMatch = window.location.pathname.match(pattern);
    if (pathMatch) {
      const currentNum = parseInt(pathMatch[1]);
      if (!isNaN(currentNum) && currentNum > 0 && currentNum < 10000) {
        const nextNum = currentNum + 1;
        const nextPath = window.location.pathname.replace(pattern, (match) => {
          return match.replace(currentNum.toString(), nextNum.toString());
        });
        
        console.log(`从URL路径构造下一页: ${currentNum} -> ${nextNum}`);
        
        // 创建虚拟链接
        const virtualLink = createMouseExtElement('a');
        virtualLink.href = window.location.origin + nextPath + window.location.search + window.location.hash;
        virtualLink._constructedFromUrl = true;
        virtualLink._urlBased = true;
        return virtualLink;
      }
    }
  }
  
  // 优先策略3：检查URL中的其他数字模式 
  // 例如查询参数中的offset、start等
  const offsetPatterns = ['offset', 'start', 'from', 'begin', 'skip'];
  const limitPatterns = ['limit', 'size', 'count', 'per_page', 'perpage', 'pagesize'];
  
  for (const offsetPattern of offsetPatterns) {
    if (urlParams.has(offsetPattern)) {
      const currentOffset = parseInt(urlParams.get(offsetPattern));
      if (!isNaN(currentOffset) && currentOffset >= 0) {
        // 尝试找到对应的limit参数
        let increment = 10; // 默认增量
        
        for (const limitPattern of limitPatterns) {
          if (urlParams.has(limitPattern)) {
            const limit = parseInt(urlParams.get(limitPattern));
            if (!isNaN(limit) && limit > 0 && limit <= 100) {
              increment = limit;
              break;
            }
          }
        }
        
        const nextOffset = currentOffset + increment;
        if (nextOffset < 100000) { // 防止过大的offset
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.set(offsetPattern, nextOffset.toString());
          
          console.log(`从offset参数构造下一页: ${offsetPattern}=${currentOffset} -> ${nextOffset}`);
          
          const virtualLink = createMouseExtElement('a');
          virtualLink.href = nextUrl.href;
          virtualLink._constructedFromUrl = true;
          virtualLink._urlBased = true;
          return virtualLink;
        }
      }
    }
  }

  // 优先策略2.5：当前 URL 无页码时，从页面中查找分页链接（?page=2、?p=2、/recent?p=2 等）
  // 解决 eleduck.com、v2ex.com 等首页误识别底部导航的问题
  function hrefLooksLikePagination(href) {
    if (!href || href.startsWith('javascript:')) return false;
    try {
      const u = new URL(href, window.location.origin);
      if (u.origin !== window.location.origin) return false;
      const q = u.searchParams;
      for (const [k, v] of q) {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n >= 2 && /^(page|p|pn|pg|first|offset|start)$/i.test(k)) return true;
      }
      if (/\/page[-_]?\d+|\/page\/\d+|\/p\/\d+|\/p[-_]?\d+/i.test(u.pathname)) return true;
    } catch (_) {}
    return false;
  }
  const hasPageParam = Array.from(urlParams.keys()).some(k =>
    /page|^p$|^pn$|^pg$|first|offset|start/i.test(k));
  if (!hasPageParam) {
    const pageLinks = [];
    const containers = document.querySelectorAll(
      '[class*="page-inner"], [id*="page-inner"], [class*="pagination"], [id*="pagination"], ' +
      '[class*="pagin"], [id*="pagin"], [class*="page-nav"], [id*="page-nav"], .pager, .pages, .page-numbers'
    );
    for (const c of containers) {
      for (const a of c.querySelectorAll('a[href]')) {
        if (hrefLooksLikePagination(a.href) && !a.href.toLowerCase().startsWith('javascript:')) {
          const match = a.href.match(/(?:[?&])(?:page|p|pn|pg|first|offset|start)=(\d+)/i) ||
            a.href.match(/\/(?:page[-_]?|page\/|p\/|p[-_]?)(\d+)/i);
          const num = match ? parseInt(match[1], 10) : 2;
          if (num >= 2) pageLinks.push({ el: a, num });
        }
      }
    }
    if (pageLinks.length > 0) {
      pageLinks.sort((a, b) => a.num - b.num);
      return pageLinks[0].el;
    }
    // 无分页容器时，扫描全页查找 page=2、p=2 等链接（如 eleduck.com 首页，分页在底部）
    for (const a of document.querySelectorAll('a[href]')) {
      if (hrefLooksLikePagination(a.href) && !a.href.toLowerCase().startsWith('javascript:')) {
        const m = a.href.match(/(?:[?&])(?:page|p|pn|pg|first|offset|start)=(\d+)/i) || a.href.match(/\/(?:page[-_]?|page\/|p\/|p[-_]?)(\d+)/i);
        if (m && parseInt(m[1], 10) === 2) return a;
      }
    }
    // v2ex 首页：next 为 /recent?p=1（最近页第一页）
    if (window.location.hostname.includes('v2ex.com') && (window.location.pathname === '/' || window.location.pathname === '')) {
      const v2Links = document.querySelectorAll('a[href*="recent"]');
      for (const a of v2Links) {
        const m = a.href.match(/[?&]p=(\d+)/);
        if (m && parseInt(m[1], 10) === 1) return a;
      }
      const nextUrl = new URL('/recent', window.location.origin);
      nextUrl.searchParams.set('p', '1');
      const v = createMouseExtElement('a');
      v.href = nextUrl.href;
      v._constructedFromUrl = true;
      v._urlBased = true;
      return v;
    }
  }

  // 匹配常见的"下一页"文本模式（中文和英文）
  const nextPageTexts = [
    '下一页', '下一张', '下一章', '下一篇', '下一条', '下一项', 
    '下一頁', '下頁', '后一页', '后页', '后一张', '后一篇', '后一章', 
    '下一部', '下一节', '下一卷', '下一话', '下一集', '下一幕', '下个', 
    'next page', 'next', '>', '>>', '→', '»', 'Next', 'NEXT', 'forward',
    'Forward', 'more', 'More', 'continue', 'Continue', 'Next Article',
    'older', 'Older', 'newer', 'Newer', 'Show more', '继续阅读', '阅读全文',
    '查看更多', '显示更多', '查看全部', '下一站', '后一篇', '下一位', '下一个'
  ];
  // 当匹配单字 "next" 或短词时，要求 href 含分页特征，避免误匹配 /go/nextjs、jobs-channel 等
  const ambiguousTexts = ['next', 'Next', 'NEXT', 'more', 'More', 'forward', 'Forward'];

  // 匹配常见的下一页class和id模式
  const nextPageClasses = [
    'next', 'next-page', 'nextPage', 'pagination-next', 'next-btn', 
    'nextBtn', 'btn-next', 'pager-next', 'pagination-item-next', 'page-next',
    'next-link', 'nextLink', 'page-next-link', 'pagenext', 'pagination-next',
    'pagination__next', 'navigation-next', 'nav-next', 'page-nav-next',
    'pagination_next', 'paging-next', 'pagingNext', 'next-posts', 'nextpost',
    'next-post', 'post-next', 'load-more', 'loadMore', 'load_more', 'more-link',
    'nextStep', 'next-step', 'nextSlide', 'next-slide', 'goNext',
    'btn-continue', 'btnContinue', 'continue-btn', 'next-button', 'forward-button',
    'nav-forward', 'next-arrow', 'nextArrow', 'arrow-next', 'arrow_next'
  ];

  // 匹配常见的下一页svg/icon类名或属性
  const nextPageIconClasses = [
    'icon-next', 'next-icon', 'icon-arrow-right', 'icon-chevron-right', 
    'icon-forward', 'arrow-right-icon', 'chevron-right-icon', 'icon-angle-right',
    'pagination-next-icon', 'right-arrow-icon', 'right-chevron'
  ];

  // 页脚判定：用于策略5/6/7，避免误取 About/Products 等链接
  // 若元素在分页容器内（pagination/pager 等），即使位于 footer 也允许，因分页常置于底部
  const paginationContainerSel = '[class*="page-inner"], [id*="page-inner"], [class*="pagination"], [id*="pagination"], [class*="pagin"], [id*="pagin"], [class*="page-nav"], [id*="page-nav"], .pager, .pages, .page-numbers';
  function isInFooter(el) {
    if (!el || !el.closest) return false;
    if (el.closest(paginationContainerSel)) return false;
    return !!el.closest('#foot, footer, [role="contentinfo"]');
  }

  // 策略4：寻找 rel="next" 的链接（只认 rel 为整词 "next"，避免 rel 含子串的误匹配）
  function relIsNext(rel) {
    if (!rel || typeof rel !== 'string') return false;
    return rel.trim() === 'next' || rel.trim().split(/\s+/).includes('next');
  }
  const relExactNext = document.querySelectorAll('a[rel="next"], link[rel="next"]');
  for (const relLink of relExactNext) {
    if (relLink.tagName === 'A' && relLink.href) {
      if (!relLink.href.toLowerCase().startsWith('javascript:')) {
        console.log('找到rel="next"链接:', relLink.href);
        return relLink;
      }
    } else if (relLink.tagName === 'LINK') {
      const href = relLink.getAttribute('href');
      if (href && !href.toLowerCase().startsWith('javascript:')) {
        console.log('找到rel="next" LINK元素:', href);
        const virtualLink = createMouseExtElement('a');
        virtualLink.href = href;
        virtualLink._urlBased = true;
        return virtualLink;
      }
    }
  }
  const relLooseNext = document.querySelectorAll('a[rel]');
  for (const relLink of relLooseNext) {
    if (relLink.tagName === 'A' && relLink.href && relIsNext(relLink.getAttribute('rel'))) {
      if (!relLink.href.toLowerCase().startsWith('javascript:')) {
        console.log('找到rel含next链接:', relLink.href);
        return relLink;
      }
    }
  }

  // 策略5: 查找带有明显下一页文本的<a>, <button>, <div>, <span>元素
  // 首先收集所有候选元素，然后按优先级排序
  const candidateLinks = [];
  
  for (const text of nextPageTexts) {
    // 精确匹配文本内容的链接或按钮元素
    const exactElements = Array.from(document.querySelectorAll('a, button, div[role="button"], span[role="button"]')).filter(el => {
      // 过滤掉隐藏元素
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
      
      const trimmedText = el.textContent.trim();
      return trimmedText === text || 
             el.title.trim() === text || 
             el.getAttribute('aria-label') === text ||
             el.getAttribute('alt') === text;
    });
    
    for (const el of exactElements) {
      if (isInFooter(el)) continue;
      // 如果是链接元素，检查并添加到候选列表
      if (el.tagName === 'A' && el.href) {
        if (!el.href.toLowerCase().startsWith('javascript:')) {
          if (ambiguousTexts.includes(text) && !hrefLooksLikePagination(el.href)) continue;
          candidateLinks.push({
            element: el,
            priority: 1, // 最高优先级：直接的安全链接
            type: 'direct_link'
          });
        }
        continue;
      }
      
      // 对于非链接元素，尝试查找它的父元素或子元素中的链接
      // 1. 检查父元素
      let parent = el.parentElement;
      for (let i = 0; i < 3 && parent; i++) { // 向上查找最多3层
        if (parent.tagName === 'A' && parent.href && 
            !parent.href.toLowerCase().startsWith('javascript:') && !isInFooter(parent)) {
          if (ambiguousTexts.includes(text) && !hrefLooksLikePagination(parent.href)) break;
          candidateLinks.push({
            element: parent,
            priority: 2, // 中等优先级：父元素链接
            type: 'parent_link'
          });
          break;
        }
        parent = parent.parentElement;
      }
      
      // 2. 检查子元素
      const childLink = el.querySelector('a[href]');
      if (childLink && !childLink.href.toLowerCase().startsWith('javascript:') && !isInFooter(childLink)) {
        if (!ambiguousTexts.includes(text) || hrefLooksLikePagination(childLink.href)) {
          candidateLinks.push({
            element: childLink,
            priority: 2, // 中等优先级：子元素链接
            type: 'child_link'
          });
        }
        continue;
      }
      
      // 3. 如果是按钮或可点击div，创建一个虚拟链接（最低优先级）
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
        candidateLinks.push({
          element: el,
          priority: 9, // 最低优先级：需要点击的元素
          type: 'button_element'
        });
      }
    }
    
    // 包含文本内容的元素（优先级稍低）
    const containsElements = Array.from(document.querySelectorAll('a, button, div[role="button"], span[role="button"]')).filter(el => {
      // 过滤掉隐藏元素
      if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
      
      const trimmedText = el.textContent.trim();
      return trimmedText.includes(text) || 
             (el.title && el.title.trim().includes(text)) || 
             (el.getAttribute('aria-label') && el.getAttribute('aria-label').includes(text)) ||
             (el.getAttribute('alt') && el.getAttribute('alt').includes(text));
    });
    
    for (const el of containsElements) {
      if (isInFooter(el)) continue;
      if (ambiguousTexts.includes(text) && el.tagName === 'A' && el.href && !hrefLooksLikePagination(el.href)) continue;
      // 处理方式与精确匹配相同，但优先级稍低
      if (el.tagName === 'A' && el.href) {
        if (!el.href.toLowerCase().startsWith('javascript:')) {
          candidateLinks.push({
            element: el,
            priority: 3, // 稍低优先级：包含文本的直接链接
            type: 'contains_direct_link'
          });
        }
        continue;
      }
      
      let parent = el.parentElement;
      for (let i = 0; i < 3 && parent; i++) {
        if (parent.tagName === 'A' && parent.href && 
            !parent.href.toLowerCase().startsWith('javascript:') && !isInFooter(parent)) {
          if (ambiguousTexts.includes(text) && !hrefLooksLikePagination(parent.href)) break;
          candidateLinks.push({
            element: parent,
            priority: 4, // 包含文本的父元素链接
            type: 'contains_parent_link'
          });
          break;
        }
        parent = parent.parentElement;
      }
      
      const childLink = el.querySelector('a[href]');
      if (childLink && !childLink.href.toLowerCase().startsWith('javascript:') && !isInFooter(childLink)) {
        if (!ambiguousTexts.includes(text) || hrefLooksLikePagination(childLink.href)) {
          candidateLinks.push({
            element: childLink,
            priority: 4, // 包含文本的子元素链接
            type: 'contains_child_link'
          });
        }
        continue;
      }
      
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
        candidateLinks.push({
          element: el,
          priority: 10, // 最低优先级：包含文本的按钮元素
          type: 'contains_button_element'
        });
      }
    }
  }
  
  // 如果找到了候选链接，返回优先级最高的
  if (candidateLinks.length > 0) {
    // 按优先级排序（数字越小优先级越高）
    candidateLinks.sort((a, b) => a.priority - b.priority);
    const bestCandidate = candidateLinks[0];
    
    console.log(`找到文本匹配链接，优先级: ${bestCandidate.priority}, 类型: ${bestCandidate.type}`);
    
    if (bestCandidate.type === 'button_element' || bestCandidate.type === 'contains_button_element') {
      // 为按钮元素创建虚拟链接
      const virtualLink = createMouseExtElement('a');
      virtualLink.href = "#";
      virtualLink._originalElement = bestCandidate.element;
      return virtualLink;
    } else {
      // 直接返回链接元素
      return bestCandidate.element;
    }
  }

  // 策略6：查找带有典型class或id的元素（排除页脚区域，避免误触 About/Products 等链接）
  // 当 class 为 next 等短词时，要求 href 含分页特征，避免误匹配 nextjs、next-slug 等
  const ambiguousClasses = ['next', 'nextBtn', 'nextLink', 'next-link', 'nextStep', 'nextSlide', 'goNext'];
  const classCandidates = [];
  
  for (const className of nextPageClasses) {
    // 查找class或id包含该模式的元素
    const classElements = document.querySelectorAll(
      `a.${className}, a[id*="${className}"], [class*="${className}"] a, ` + 
      `button.${className}, button[id*="${className}"], [class*="${className}"] button, ` +
      `div[role="button"].${className}, div[role="button"][id*="${className}"], [class*="${className}"] div[role="button"]`
    );
    
    for (const el of classElements) {
      if (el.tagName === 'A' && el.href) {
        if (!el.href.toLowerCase().startsWith('javascript:') && !isInFooter(el)) {
          if (ambiguousClasses.includes(className) && !hrefLooksLikePagination(el.href)) continue;
          classCandidates.push({
            element: el,
            priority: 5, // 中等优先级：基于CSS类的直接链接
            type: 'class_direct_link'
          });
        }
        continue;
      }
      
      let parent = el.parentElement;
      for (let i = 0; i < 3 && parent; i++) {
        if (parent.tagName === 'A' && parent.href && 
            !parent.href.toLowerCase().startsWith('javascript:') && !isInFooter(parent)) {
          if (ambiguousClasses.includes(className) && !hrefLooksLikePagination(parent.href)) break;
          classCandidates.push({
            element: parent,
            priority: 6, // 基于CSS类的父元素链接
            type: 'class_parent_link'
          });
          break;
        }
        parent = parent.parentElement;
      }
      
      const childLink = el.querySelector('a[href]');
      if (childLink && !childLink.href.toLowerCase().startsWith('javascript:') && !isInFooter(childLink)) {
        if (!ambiguousClasses.includes(className) || hrefLooksLikePagination(childLink.href)) {
          classCandidates.push({
            element: childLink,
            priority: 6, // 基于CSS类的子元素链接
            type: 'class_child_link'
          });
        }
        continue;
      }
      
      if ((el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && !isInFooter(el)) {
        classCandidates.push({
          element: el,
          priority: 11, // 较低优先级：基于CSS类的按钮元素
          type: 'class_button_element'
        });
      }
    }
  }
  
  // 如果找到了基于CSS类的候选链接，返回优先级最高的
  if (classCandidates.length > 0) {
    classCandidates.sort((a, b) => a.priority - b.priority);
    const bestCandidate = classCandidates[0];
    
    console.log(`找到CSS类匹配链接，优先级: ${bestCandidate.priority}, 类型: ${bestCandidate.type}`);
    
    if (bestCandidate.type === 'class_button_element') {
      const virtualLink = createMouseExtElement('a');
      virtualLink.href = "#";
      virtualLink._originalElement = bestCandidate.element;
      return virtualLink;
    } else {
      return bestCandidate.element;
    }
  }

  // 策略7：查找包含下一页图标的元素
  const iconCandidates = [];
  
  for (const iconClass of nextPageIconClasses) {
    const iconElements = document.querySelectorAll(
      `[class*="${iconClass}"], [id*="${iconClass}"], ` +
      `a i[class*="next"], a i[class*="right"], a span[class*="next"], a span[class*="right"], ` +
      `button i[class*="next"], button i[class*="right"], button span[class*="next"], button span[class*="right"]`
    );
    
    for (const iconEl of iconElements) {
      if (isInFooter(iconEl)) continue;
      // 检查自身或最近的父元素是否为链接
      let current = iconEl;
      for (let i = 0; i < 4 && current; i++) { // 向上查找最多4层
        if (current.tagName === 'A' && current.href) {
          if (!current.href.toLowerCase().startsWith('javascript:') && !isInFooter(current)) {
            iconCandidates.push({
              element: current,
              priority: 7, // 图标相关链接
              type: 'icon_link'
            });
          }
          break;
        }
        
        // 检查是否是按钮或可点击div
        if (current.tagName === 'BUTTON' || current.getAttribute('role') === 'button') {
          if (!isInFooter(current)) {
            iconCandidates.push({
              element: current,
              priority: 12, // 较低优先级：图标按钮元素
              type: 'icon_button_element'
            });
          }
          break;
        }
        
        current = current.parentElement;
      }
    }
  }
  
  // 如果找到了基于图标的候选链接，返回优先级最高的
  if (iconCandidates.length > 0) {
    iconCandidates.sort((a, b) => a.priority - b.priority);
    const bestCandidate = iconCandidates[0];
    
    console.log(`找到图标匹配链接，优先级: ${bestCandidate.priority}, 类型: ${bestCandidate.type}`);
    
    if (bestCandidate.type === 'icon_button_element') {
      const virtualLink = createMouseExtElement('a');
      virtualLink.href = "#";
      virtualLink._originalElement = bestCandidate.element;
      return virtualLink;
    } else {
      return bestCandidate.element;
    }
  }

  // 策略8：在分页容器中查找页码序列中当前页之后的链接
  // 支持 page-inner、pagination 等 id/class，以及 page、pager、pages 等
  const paginationContainers = [
    ...document.querySelectorAll('.pagination'),
    ...document.querySelectorAll('.pager'),
    ...document.querySelectorAll('.pages'),
    ...document.querySelectorAll('.page-numbers'),
    ...document.querySelectorAll('[class*="pagin"]'),
    ...document.querySelectorAll('[id*="pagin"]'),
    ...document.querySelectorAll('[class*="page-inner"]'),
    ...document.querySelectorAll('[id*="page-inner"]'),
    ...document.querySelectorAll('[class*="pagination"]'),
    ...document.querySelectorAll('[id*="pagination"]'),
    ...document.querySelectorAll('nav[aria-label*="pagination"]'),
    ...document.querySelectorAll('nav[aria-label*="Pagination"]'),
    ...document.querySelectorAll('nav[role="navigation"]'),
    ...document.querySelectorAll('ul.page, ol.page, div.page'),
    ...document.querySelectorAll('.paging, .page-list, .page-nav'),
    ...document.querySelectorAll('[class*="page-nav"]'),
    ...document.querySelectorAll('[id*="page-nav"]')
  ];

  for (const container of paginationContainers) {
    if (isInFooter(container)) continue;
    // 尝试找到当前页面的指示器(通常有active或current的class)
    const currentPageElement = container.querySelector(
      '.active, .current, [aria-current="page"], .selected, .on, ' +
      '[class*="current"], [class*="active"], [class*="selected"], ' +
      'span.page, em.page, strong.page'
    );
    
    if (currentPageElement) {
      // 找到当前元素后的下一个<a>元素
      let nextElement = currentPageElement.nextElementSibling;
      while (nextElement) {
        if (nextElement.tagName === 'A' && nextElement.href && 
            !nextElement.href.toLowerCase().startsWith('javascript:')) {
          console.log('在分页容器中找到下一页链接:', nextElement.href);
          return nextElement;
        }
        nextElement = nextElement.nextElementSibling;
      }
      
      // 如果当前页是在一个列表项中，尝试找到下一个列表项中的链接
      if (currentPageElement.tagName === 'LI' || currentPageElement.parentElement.tagName === 'LI') {
        const parentLi = currentPageElement.tagName === 'LI' ? 
                          currentPageElement : 
                          currentPageElement.parentElement;
        
        const nextLi = parentLi.nextElementSibling;
        if (nextLi) {
          const link = nextLi.querySelector('a');
          if (link && link.href && !link.href.toLowerCase().startsWith('javascript:')) {
            console.log('在分页列表中找到下一页链接:', link.href);
            return link;
          }
        }
      }
      
      // 检查当前元素的父元素的下一个兄弟元素
      if (currentPageElement.parentElement) {
        const nextSibling = currentPageElement.parentElement.nextElementSibling;
        if (nextSibling) {
          const link = nextSibling.querySelector('a');
          if (link && link.href && !link.href.toLowerCase().startsWith('javascript:')) {
            console.log('在分页父元素中找到下一页链接:', link.href);
            return link;
          }
        }
      }
    }
  }

  // 没有找到任何下一页链接
  console.log('未找到任何有效的下一页链接');
  return null;
}

// 尝试跳转到下一页（防抖：短时间重复调用只执行一次）
let lastTryNavigateToNextPageTime = 0;
const TRY_NAVIGATE_DEBOUNCE_MS = 600;

function tryNavigateToNextPage(isRetry, suppressNoNextHint) {
  const now = Date.now();
  if (!isRetry && now - lastTryNavigateToNextPageTime < TRY_NAVIGATE_DEBOUNCE_MS) return false;
  lastTryNavigateToNextPageTime = now;

  // 先查找，再只显示一次提示，避免多次闪烁
  let nextPageLink = findNextPageLink();
  // Google/Bing 偶发漏检时短暂重试一次（DOM 可能未就绪）
  if ((!nextPageLink || !nextPageLink.href) && window === window.top &&
      (window.location.hostname.match(/^([\w-]+\.)?google\./) || window.location.hostname.includes('bing.com'))) {
    setTimeout(() => tryNavigateToNextPage(true, false), 200);
    return false;
  }
  lastTriedNextPageLink = nextPageLink;

  if (!nextPageLink || !nextPageLink.href) {
    if (!suppressNoNextHint) {
      try {
        const t = parseInt(sessionStorage.getItem(NEXT_PAGE_SUCCESS_KEY) || '0', 10);
        if (t && Date.now() - t < 1200) return false; // 刚成功翻页，抑制 noNextPage
      } catch (_) {}
      showGestureHint(getNavigationErrorTranslations().noNextPage);
    }
    return false;
  }

  showGestureHint(getNavigationErrorTranslations().nextPageSuccess);
  try { sessionStorage.setItem(NEXT_PAGE_SUCCESS_KEY, String(Date.now())); } catch (_) {}

  // 优先级1: 检查是否为JavaScript URL，避免CSP错误和安全问题
  if (nextPageLink.href.toLowerCase().startsWith('javascript:')) {
    console.log('检测到JavaScript URL，出于安全原因跳过:', nextPageLink.href);
    showGestureHint(getNavigationErrorTranslations().navigationError);
    return false;
  }
  
  // 优先级2: 检查是否为无效的URL协议
  try {
    const urlObj = new URL(nextPageLink.href, window.location.origin);
    const protocol = urlObj.protocol.toLowerCase();
    
    // 仅允许安全的URL协议
    if (!['http:', 'https:', 'file:'].includes(protocol)) {
      console.log('检测到不支持的URL协议:', protocol, nextPageLink.href);
      showGestureHint(getNavigationErrorTranslations().navigationError);
      return false;
    }
  } catch (e) {
    console.log('URL解析失败:', nextPageLink.href, e.message);
    showGestureHint(getNavigationErrorTranslations().navigationError);
    return false;
  }
  
  // 优先级3: 优先使用URL导航（避免JavaScript执行）
  // 延迟导航以确保提示显示完成
  setTimeout(() => {
    try {
      // 如果是从URL构造的虚拟链接，直接使用URL导航
      if (nextPageLink._constructedFromUrl) {
        console.log('使用URL导航:', nextPageLink.href);
        window.location.href = nextPageLink.href;
        return;
      }
      
      // 如果是普通链接元素，检查是否有外部链接属性
      if (nextPageLink.tagName === 'A') {
        // 检查是否为外部链接
        if (nextPageLink.target === '_blank' || 
            nextPageLink.getAttribute('rel') === 'external' ||
            nextPageLink.getAttribute('rel') === 'noopener') {
          console.log('打开外部链接:', nextPageLink.href);
          window.open(nextPageLink.href, '_blank', 'noopener,noreferrer');
          return;
        }
        
        // 对于普通链接，优先使用URL导航而不是点击事件
        console.log('使用URL导航 (普通链接):', nextPageLink.href);
        window.location.href = nextPageLink.href;
        return;
      }
      
      // 优先级4: 只有在必要时才使用点击事件（如按钮元素）
      if (nextPageLink._originalElement) {
        const originalEl = nextPageLink._originalElement;
        
        // 再次检查原始元素是否是链接
        if (originalEl.tagName === 'A' && originalEl.href && 
            !originalEl.href.toLowerCase().startsWith('javascript:')) {
          console.log('使用原始链接URL导航:', originalEl.href);
          window.location.href = originalEl.href;
          return;
        }
        
        // 只有在原始元素是按钮或其他交互元素时才使用点击
        if (originalEl.tagName === 'BUTTON' || 
            originalEl.getAttribute('role') === 'button' ||
            originalEl.tagName === 'INPUT') {
          console.log('点击按钮元素:', originalEl);
          originalEl.click();
          return;
        }
      }
      
      // 最后的备选方案：尝试常规URL导航
      console.log('使用备选URL导航:', nextPageLink.href);
      window.location.href = nextPageLink.href;
      
    } catch (e) {
      console.log('导航到下一页时出错:', e.message);
      
      // 错误处理：只有在确保不是JavaScript URL的情况下才尝试备选导航
      try {
        if (nextPageLink.href && 
            !nextPageLink.href.toLowerCase().startsWith('javascript:') &&
            (nextPageLink.href.startsWith('http') || nextPageLink.href.startsWith('/'))) {
          console.log('尝试备选导航方案:', nextPageLink.href);
          window.location.href = nextPageLink.href;
        } else {
          showGestureHint(getNavigationErrorTranslations().navigationError);
        }
      } catch (fallbackError) {
        console.log('备选导航也失败:', fallbackError.message);
        showGestureHint(getNavigationErrorTranslations().navigationError);
      }
    }
  }, CONFIG.NAVIGATION_DELAY); // 延迟导航
  
  return true;
}

// 页面滚动状态跟踪
let isPageScrolling = false;
let scrollDebounceTimer = null;
let scrollPreviewDelayTimer = null; // 滚动停止后的额外延迟定时器
let previewWheelListenerAttached = false; // 仅在预览显示时监听wheel
// 配置常量 - 消除硬编码问题
const CONFIG = {
  SCROLL_DEBOUNCE_DELAY: 200, // 滚动后多久恢复图片预览显示的时间（毫秒）- 增加延迟防止中途停止
  SCROLL_PREVIEW_DELAY: 300, // 滚动停止后额外延迟，防止中途停止时立即显示预览
  NAVIGATION_DELAY: 500, // 导航延迟时间
  GESTURE_MIN_DISTANCE: 30, // 最小手势距离
  PREVIEW_FADE_DURATION: 300, // 预览淡入淡出时间
  CACHE_MAX_SIZE: 1000, // DOM缓存最大大小
  PERFORMANCE_THROTTLE: 8, // 性能节流间隔（提高敏感度）
  NOTIFICATION_DURATION: 8000, // 通知显示时间
  GESTURE_HINT_DURATION: 1500, // 手势提示显示时间
  SCROLL_ACTION_HINT_DURATION: 1000, // 滚动动作提示时间
  INVALID_GESTURE_HINT_DURATION: 350, // 无效手势提示时间
};

// 处理滚动事件 - 即时设置滚动状态，并在停止后进入额外延迟
function handlePageScroll() {
  // 设置页面滚动状态为真
  isPageScrolling = true;

  // 如果图片预览正在显示，立即隐藏（使用immediate参数）
  if (imagePreview && imagePreview.style.opacity !== '0') {
    CommonUtils.safeExecute(() => hideImagePreview(true), 'hideImagePreview');
  }

  // 清除之前的防抖定时器（如果存在）
  if (scrollDebounceTimer) {
    clearTimeout(scrollDebounceTimer);
  }

  // 设置新的防抖定时器，滚动停止后一段时间将滚动状态重置为false
  scrollDebounceTimer = setTimeout(() => {
    console.log('滚动停止，开始额外延迟');
    isPageScrolling = false;
    scrollDebounceTimer = null;

    // 清除之前的额外延迟定时器
    if (scrollPreviewDelayTimer) {
      clearTimeout(scrollPreviewDelayTimer);
    }

    // 设置额外的延迟，防止滚动中途停止时立即显示预览
    scrollPreviewDelayTimer = setTimeout(() => {
      console.log('滚动停止后的额外延迟结束，图片预览已完全启用');
      scrollPreviewDelayTimer = null;
    }, CONFIG.SCROLL_PREVIEW_DELAY);

    console.log('滚动状态已重置:', { isPageScrolling });
  }, CONFIG.SCROLL_DEBOUNCE_DELAY);
}

// 处理窗口大小变化 - 优化性能
const handleWindowResize = CommonUtils.createDebouncedHandler(() => {
  // 如果图片预览正在显示，立即隐藏（使用immediate参数）
  if (imagePreview && imagePreview.style.opacity !== '0') {
    CommonUtils.safeExecute(() => hideImagePreview(true), 'hideImagePreview');
  }
  
  // 清理DOM缓存，因为窗口大小变化可能影响元素位置
  domCache.clear();
}, 100); // 窗口大小变化使用更短的防抖时间

// 简化的滚动检测 - 使用wheel事件立即检测滚动开始
const handleWheelScroll = (e) => {
  // 当图片预览未显示时，不对滚轮默认动作进行任何干预
  if (!imagePreview || imagePreview.style.opacity === '0' || imagePreview.style.display === 'none') {
    return;
  }

  console.log('检测到wheel滚动（预览可见），设置滚动状态');
  isPageScrolling = true;

  // 立即隐藏图片预览
  CommonUtils.safeExecute(() => hideImagePreview(true), 'hideImagePreview');

  // 清除之前的防抖定时器（如果存在）
  if (scrollDebounceTimer) {
    clearTimeout(scrollDebounceTimer);
  }

  // 设置新的防抖定时器，滚动停止后一段时间将滚动状态重置为false
  scrollDebounceTimer = setTimeout(() => {
    console.log('wheel滚动停止，开始额外延迟');
    isPageScrolling = false;
    scrollDebounceTimer = null;

    // 清除之前的额外延迟定时器
    if (scrollPreviewDelayTimer) {
      clearTimeout(scrollPreviewDelayTimer);
    }

    // 设置额外的延迟，防止滚动中途停止时立即显示预览
    scrollPreviewDelayTimer = setTimeout(() => {
      console.log('wheel滚动停止后的额外延迟结束，图片预览已完全启用');
      scrollPreviewDelayTimer = null;
    }, CONFIG.SCROLL_PREVIEW_DELAY);

    console.log('wheel滚动状态已重置:', { isPageScrolling });
  }, CONFIG.SCROLL_DEBOUNCE_DELAY);
};

const splitScrollSyncState = {
  ratioY: null,
  ratioX: null,
  sentAt: 0
};

// 分屏滚动同步：将纵向、横向滚动比例发给配对窗口（仅主框架）
function handleSplitScrollSync() {
  if (window !== window.top || !settings?.enableSplitScrollSync || isSplitScrollSyncing) return;
  try {
    const el = document.scrollingElement || document.documentElement;
    const maxY = Math.max(0, el.scrollHeight - el.clientHeight);
    const maxX = Math.max(0, el.scrollWidth - el.clientWidth);
    if (maxY <= 0 && maxX <= 0) return;
    const ratioY = maxY > 0 ? el.scrollTop / maxY : 0;
    const ratioX = maxX > 0 ? el.scrollLeft / maxX : 0;
    const now = Date.now();
    if (
      splitScrollSyncState.ratioY != null &&
      Math.abs(ratioY - splitScrollSyncState.ratioY) < 0.0005 &&
      Math.abs(ratioX - splitScrollSyncState.ratioX) < 0.0005 &&
      now - splitScrollSyncState.sentAt < 250
    ) {
      return;
    }
    splitScrollSyncState.ratioY = ratioY;
    splitScrollSyncState.ratioX = ratioX;
    splitScrollSyncState.sentAt = now;
    chrome.runtime.sendMessage({
      action: 'splitViewScroll',
      scrollRatio: ratioY,
      scrollRatioX: ratioX
    }).catch((err) => {
      if (chrome.runtime && chrome.runtime.lastError) return;
      if (err && String(err.message || err).includes('Extension context invalidated')) {
        isExtensionValid = false;
      }
    });
  } catch (e) {}
}
// 32ms 节流，约 30 次/秒，兼顾实时性与消息量
const throttledSplitScrollSync = throttle(handleSplitScrollSync, 32);

// 设置事件监听器（handlePageScroll 已在 registerDeferredDomEventListeners 中注册于 window）
if (mouseExtListenerFlag('splitScrollSyncListeners')) {
document.addEventListener('scroll', throttledSplitScrollSync, { passive: true });
window.addEventListener('resize', handleWindowResize, { passive: true });
}

// 清理滚动相关状态与定时器
function resetScrollStateTimers() {
  try {
    if (scrollDebounceTimer) {
      clearTimeout(scrollDebounceTimer);
      scrollDebounceTimer = null;
    }
    if (scrollPreviewDelayTimer) {
      clearTimeout(scrollPreviewDelayTimer);
      scrollPreviewDelayTimer = null;
    }
    isPageScrolling = false;
  } catch (e) {}
}

// 页面隐藏或窗口失焦时，重置滚动状态并立即隐藏预览
if (mouseExtListenerFlag('visibilityScrollPreviewReset')) {
document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    resetScrollStateTimers();
    if (imagePreview && imagePreview.style.opacity !== '0' && imagePreview.style.display !== 'none') {
      hideImagePreview(true);
    }
  }
});

window.addEventListener('blur', function() {
  resetScrollStateTimers();
  if (imagePreview && imagePreview.style.opacity !== '0' && imagePreview.style.display !== 'none') {
    hideImagePreview(true);
  }
}, { passive: true });
}

// 手势轨迹 canvas 在首次手势超过阈值时 initGestureCanvas() 懒创建，不在 document_start 预建
