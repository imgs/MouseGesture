// 禁用所有控制台日志
console.log = function() {};
console.error = function() {};
console.warn = function() {};
console.info = function() {};
console.debug = function() {};

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
window.addEventListener('beforeunload', cleanupAllEventListeners);
window.addEventListener('pagehide', cleanupAllEventListeners);

// 监听页面可见性变化，处理标签切换时的手势轨迹清理
document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    // 页面变为不可见时（标签切换），立即清理手势轨迹
    if (isGestureInProgress) {
      resetGestureState();
    }
    clearGestureCanvas();
  }
});

// 监听窗口焦点变化，处理窗口切换时的手势轨迹清理
window.addEventListener('blur', function() {
  // 窗口失去焦点时，清理手势轨迹
  if (isGestureInProgress) {
    resetGestureState();
  }
  clearGestureCanvas();
});

// 监听窗口获得焦点，重新初始化手势画布
window.addEventListener('focus', function() {
  // 窗口获得焦点时，如果需要显示轨迹，重新初始化画布
  if (settings.showGestureTrail && !gestureCanvas) {
    initGestureCanvas();
  }
});

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

// ===== 智能滚动优化系统 =====

// 缓动函数缓存，提高性能
const easingCache = new Map();

// 自定义缓动滚动到指定位置实现
function performCustomEasingScrollTo(element, targetPosition, duration, easing, isHorizontal) {
  const startPosition = isHorizontal ? element.scrollLeft : element.scrollTop;
  const startTime = performance.now();
  
  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // 应用缓动函数
    const easedProgress = applyEasing(progress, easing);
    const currentPosition = startPosition + (targetPosition - startPosition) * easedProgress;
    
    if (isHorizontal) {
      element.scrollLeft = currentPosition;
    } else {
      element.scrollTop = currentPosition;
    }
    
    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  }
  
  requestAnimationFrame(animate);
}

// 缓动函数应用器
function applyEasing(t, easing) {
  // 检查缓存
  const cacheKey = `${easing}_${Math.round(t * 100)}`;
  if (easingCache.has(cacheKey)) {
    return easingCache.get(cacheKey);
  }
  
  let result;
  
  switch (easing) {
    case 'linear':
      result = t;
      break;
    case 'ease':
      result = 1 - Math.pow(1 - t, 2); // 标准ease缓动，快速开始，缓慢结束
      break;
    case 'ease-out':
      result = 1 - Math.pow(1 - t, 1.5); // 使用1.5次方，让减速更快
      break;
    case 'ease-in-out':
      result = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // 使用平方函数，更快速
      break;
    default:
      // 自定义贝塞尔曲线
      if (easing.startsWith('cubic-bezier')) {
        result = applyCubicBezier(t, easing);
      } else {
        result = t; // 默认线性
      }
  }
  
  // 缓存结果
  easingCache.set(cacheKey, result);
  
  // 限制缓存大小
  if (easingCache.size > 1000) {
    const firstKey = easingCache.keys().next().value;
    easingCache.delete(firstKey);
  }
  
  return result;
}

// 贝塞尔曲线计算
function applyCubicBezier(t, bezierString) {
  // 解析贝塞尔曲线参数
  const match = bezierString.match(/cubic-bezier\(([^)]+)\)/);
  if (!match) return t;
  
  const coords = match[1].split(',').map(Number);
  if (coords.length !== 4) return t;
  
  const [x1, y1, x2, y2] = coords;
  
  // 使用牛顿法求解贝塞尔曲线
  let currentT = t;
  for (let i = 0; i < 5; i++) {
    const currentX = cubicBezierX(currentT, x1, x2);
    const derivative = cubicBezierDerivative(currentT, x1, x2);
    
    if (Math.abs(derivative) < 1e-6) break;
    
    currentT = currentT - (currentX - t) / derivative;
    currentT = Math.max(0, Math.min(1, currentT));
  }
  
  return cubicBezierY(currentT, y1, y2);
}

// 贝塞尔曲线X坐标
function cubicBezierX(t, x1, x2) {
  return 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
}

// 贝塞尔曲线Y坐标
function cubicBezierY(t, y1, y2) {
  return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
}

// 贝塞尔曲线导数
function cubicBezierDerivative(t, x1, x2) {
  return 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
}

// 检测是否应该使用网站自带的平滑滚动方案
function shouldUseNativeSmoothScroll() {
  // 检查网站是否有自定义的滚动行为
  const hasCustomScrollBehavior = detectCustomScrollBehavior();
  
  // 检查网站是否使用了现代CSS滚动行为
  const hasModernScrollBehavior = detectModernScrollBehavior();
  
  return hasCustomScrollBehavior || hasModernScrollBehavior;
}

// 检测网站是否有自定义滚动行为
function detectCustomScrollBehavior() {
  try {
    // 检查是否有自定义的滚动事件监听器
    const hasScrollListeners = window.onscroll !== null || 
                              document.onscroll !== null ||
                              document.addEventListener.toString().includes('scroll');
    
    // 检查是否有自定义的CSS滚动行为
    const styleSheets = document.styleSheets;
    for (let i = 0; i < styleSheets.length; i++) {
      try {
        const rules = styleSheets[i].cssRules || styleSheets[i].rules;
        for (let j = 0; j < rules.length; j++) {
          const rule = rules[j];
          if (rule.style && (
            rule.style.scrollBehavior === 'smooth' ||
            rule.style.getPropertyValue('scroll-behavior') === 'smooth' ||
            rule.cssText.includes('scroll-behavior: smooth') ||
            rule.cssText.includes('scroll-behavior:smooth')
          )) {
            return true;
          }
        }
      } catch (e) {
        // 跨域样式表无法访问，跳过
        continue;
      }
    }
    
    // 检查是否有JavaScript滚动库
    const scrollLibraries = [
      'smooth-scroll',
      'locomotive-scroll',
      'fullpage',
      'aos',
      'gsap',
      'scrollmagic',
      'skrollr',
      'parallax',
      'scrollreveal',
      'wow',
      'animate',
      'velocity',
      'jquery.scrollTo',
      'jquery.smoothScroll',
      'perfect-scrollbar',
      'simplebar',
      'overlayscrollbars',
      'malihu-custom-scrollbar',
      'nicescroll',
      'tinyscrollbar',
      'jscrollpane',
      'iscroll',
      'swiper',
      'slick',
      'owl',
      'bxslider',
      'flexslider',
      'unslider',
      'sly',
      'scrollme',
      'scrollify',
      'fullpage.js',
      'pagepiling.js',
      'multiscroll.js',
      'onepage-scroll',
      'jquery.onepage-scroll',
      'jquery.fullpage',
      'jquery.pagepiling',
      'jquery.multiscroll',
      'jquery.scrollify',
      'jquery.scrollme',
      'jquery.sly',
      'jquery.flexslider',
      'jquery.bxslider',
      'jquery.owl',
      'jquery.slick',
      'jquery.swiper',
      'jquery.iscroll',
      'jquery.tinyscrollbar',
      'jquery.jscrollpane',
      'jquery.nicescroll',
      'jquery.malihu-custom-scrollbar',
      'jquery.overlayscrollbars',
      'jquery.simplebar',
      'jquery.perfect-scrollbar',
      'jquery.velocity',
      'jquery.animate',
      'jquery.wow',
      'jquery.scrollreveal',
      'jquery.parallax',
      'jquery.skrollr',
      'jquery.scrollmagic',
      'jquery.gsap',
      'jquery.aos',
      'jquery.fullpage',
      'jquery.locomotive-scroll',
      'jquery.smooth-scroll'
    ];
    
    for (const lib of scrollLibraries) {
      if (window[lib] || document.querySelector(`[data-${lib}]`) || 
          document.querySelector(`.${lib}`) || document.querySelector(`#${lib}`)) {
        return true;
      }
    }
    
    return hasScrollListeners;
  } catch (e) {
    return false;
  }
}

// 检测网站是否使用了现代CSS滚动行为
function detectModernScrollBehavior() {
  try {
    // 检查根元素的滚动行为
    const htmlScrollBehavior = getComputedStyle(document.documentElement).scrollBehavior;
    const bodyScrollBehavior = getComputedStyle(document.body).scrollBehavior;
    
    if (htmlScrollBehavior === 'smooth' || bodyScrollBehavior === 'smooth') {
      return true;
    }
    
    // 检查是否有CSS变量定义滚动行为
    const htmlStyle = getComputedStyle(document.documentElement);
    const bodyStyle = getComputedStyle(document.body);
    
    const htmlScrollBehaviorVar = htmlStyle.getPropertyValue('--scroll-behavior');
    const bodyScrollBehaviorVar = bodyStyle.getPropertyValue('--scroll-behavior');
    
    if (htmlScrollBehaviorVar === 'smooth' || bodyScrollBehaviorVar === 'smooth') {
      return true;
    }
    
    // 检查是否有CSS @property定义
    const styleSheets = document.styleSheets;
    for (let i = 0; i < styleSheets.length; i++) {
      try {
        const rules = styleSheets[i].cssRules || styleSheets[i].rules;
        for (let j = 0; j < rules.length; j++) {
          const rule = rules[j];
          if (rule.type === CSSRule.KEYFRAMES_RULE || 
              (rule.cssText && rule.cssText.includes('@property'))) {
            return true;
          }
        }
      } catch (e) {
        continue;
      }
    }
    
    return false;
  } catch (e) {
    return false;
  }
}

// 检测当前操作系统是否为Mac（现代方法）
const isMacOS = (() => {
  if (navigator.userAgentData) {
    return navigator.userAgentData.platform.toLowerCase().includes('mac');
  }
  return navigator.userAgent.toLowerCase().indexOf('mac') !== -1;
})();

// 检测当前操作系统是否为Linux（现代方法）
const isLinuxOS = (() => {
  if (navigator.userAgentData) {
    return navigator.userAgentData.platform.toLowerCase().includes('linux');
  }
  return navigator.userAgent.toLowerCase().indexOf('linux') !== -1;
})();

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

// 鼠标手势状态
let isGestureInProgress = false;
let gesturePoints = [];
let gestureStartX = 0;
let gestureStartY = 0;
let gestureCanvas = null;
let gestureContext = null;
let minGestureDistance = 3; // 手势最小距离，从5减小到3，极大提高对微小幅度手势的敏感度
let isRightMouseDown = false; // 跟踪右键是否按下
let minMovementToStartGesture = 1; // 启动手势的最小移动阈值，从2减小到1，几乎立即开始手势
let angleThreshold = 0.8; // 角度阈值调整为0.8（约36度），平衡精确度和容错性
let smoothingFactor = 0.2; // 平滑因子，减小到0.2，减少平滑强度
let minDirectionSegmentLength = 5; // 最小方向段长度从10降低到5，极大增强对超短距离手势的识别
let directionChangeThreshold = 0.35; // 方向变化阈值从0.4降低到0.35，更易捕捉细微的方向变化
let minGestureComplexity = 3; // 最小手势复杂度降低到3，进一步提高对复杂轨迹的容忍度
let settings = {
  showGestureTrail: true,
  showGestureHint: true,
  trailColor: '#FF9ECD',
  trailWidth: 3,
  enableSuperDrag: true,
  enableDragTextSearch: true,
  autoDownloadOnDragFile: false,
  enableImagePreview: true,
  enableDuplicateCheck: true,
  // 添加超级拖拽方向自定义，全部设为后台打开
  dragUpAction: 'background',
  dragRightAction: 'background',
  dragDownAction: 'background',
  dragLeftAction: 'background',
  dragSearchEngine: 'https://www.google.com/search?q={q}', // 添加超级拖拽搜索引擎URL设置
  language: 'en' // 默认语言为英文
};
let isExtensionValid = true; // 跟踪扩展上下文是否有效
let gestureHint = null; // 用于存储手势提示元素
let lastGestureEndTime = 0; // 添加一个变量来记录手势结束时间
let imagePreview = null; // 用于存储图片预览元素

// N 卡检测缓存：为兼容 HDR/RTX VSR，N 卡时自动使用简化手势提示（无 backdrop-filter）
let isNvidiaGpuCached = null;
function isNvidiaGpu() {
  if (isNvidiaGpuCached !== null) return isNvidiaGpuCached;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) { isNvidiaGpuCached = false; return false; }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) { isNvidiaGpuCached = false; return false; }
    const renderer = (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    isNvidiaGpuCached = /nvidia/i.test(renderer);
    return isNvidiaGpuCached;
  } catch (e) {
    isNvidiaGpuCached = false;
    return false;
  }
}

// 添加提示节流相关变量
let lastHintTime = 0;
let lastHintAction = '';
let hintThrottleDelay = 300; // 提示节流延迟（毫秒）

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
function getGestureTranslations() {
  return {
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
    'stopLoading': getI18nMessage('stopLoading', 'Stop Loading'),
    'closeAllTabs': getI18nMessage('closeAllTabs', 'Close All Tabs'),
    'scrollToBottom': getI18nMessage('scrollToBottom', 'Scroll to Bottom'),
    'scrollToTop': getI18nMessage('scrollToTop', 'Scroll to Top'),
    'scrollToLeft': getI18nMessage('scrollToLeft', 'Scroll to Left Edge'),
    'scrollToRight': getI18nMessage('scrollToRight', 'Scroll to Right Edge'),
    'invalidGesture': getI18nMessage('invalidGesture', 'Invalid Gesture'),
    'nextPage': getI18nMessage('nextPage', 'Next Page'),
    'closeOtherTabs': getI18nMessage('closeOtherTabs', 'Close Other Tabs'),
    'closeTabsToRight': getI18nMessage('closeTabsToRight', 'Close Tabs to Right'),
    'closeTabsToLeft': getI18nMessage('closeTabsToLeft', 'Close Tabs to Left'),
    'reloadAllTabs': getI18nMessage('reloadAllTabs', 'Reload All Tabs'),
    'togglePinTab': getI18nMessage('togglePinTab', 'Pin/Unpin Tab'),
    'toggleMuteTab': getI18nMessage('toggleMuteTab', 'Mute/Unmute Tab'),
    'muteOtherTabs': getI18nMessage('muteOtherTabs', 'Mute Other Tabs'),
    'toggleMaximize': getI18nMessage('toggleMaximize', 'Maximize/Restore Window'),
    'minimizeWindow': getI18nMessage('minimizeWindow', 'Minimize Window'),
    'toggleFullscreen': getI18nMessage('toggleFullscreen', 'Toggle Fullscreen'),
    'newWindow': getI18nMessage('newWindow', 'New Window'),
    'newInPrivateWindow': getI18nMessage('newInPrivateWindow', 'New Private Window')
  };
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
let linkClickPending = null; // 用于存储链接点击延迟处理的计时器
let linkClickThreshold = 150; // 点击和拖拽的区分阈值（毫秒）
let potentialDragLink = null; // 可能的拖拽链接元素
let mouseDownPosition = { x: 0, y: 0 }; // 鼠标按下的位置
let mouseCurrentPosition = { x: 0, y: 0 }; // 当前鼠标位置
let dragDistanceThreshold = 5; // 判断为拖拽的最小像素距离

// 全局变量用于跟踪重复标签页通知
let tabNotification = null;
// 记录上次尝试的下一页链接
let lastTriedNextPageLink = null;

// 显示重复标签页通知
function showDuplicateTabsNotification(data) {
  try {
    // 如果notification-container已存在，先移除它
    const existingContainer = document.getElementById('mouse-gesture-notification-container');
    if (existingContainer) {
      document.body.removeChild(existingContainer);
    }
    
    // 获取当前语言设置
    const currentLang = settings.language || 'en';
    const isEnglish = currentLang === 'en';
    
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
    const container = document.createElement('div');
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
    const notification = document.createElement('div');
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
    const icon = document.createElement('div');
    // 使用更可爱的表情符号组合
    icon.innerHTML = '🔍✨';
    icon.style.fontSize = '18px';
    icon.style.marginRight = '12px';
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
    const content = document.createElement('div');
    content.style.flexGrow = '1';
    content.style.flexShrink = '1';
    content.style.minWidth = '0';
    content.style.boxSizing = 'border-box';
    
    // 消息标题 - 更时尚的字体和样式
    const title = document.createElement('div');
    title.textContent = data.summary || texts.title;
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
    const urlListContainer = document.createElement('div');
    urlListContainer.style.fontSize = '13px';
    urlListContainer.style.lineHeight = '1.5';
    urlListContainer.style.color = '#f0f0f5';
    urlListContainer.style.opacity = '0.85';
    urlListContainer.style.maxHeight = '90px';
    urlListContainer.style.overflow = 'auto';
    urlListContainer.style.marginBottom = '4px';
    urlListContainer.style.paddingRight = '4px';
    urlListContainer.style.scrollbarWidth = 'thin';
    urlListContainer.style.scrollbarColor = 'rgba(255,255,255,0.2) transparent';
    urlListContainer.style.boxSizing = 'border-box';
    urlListContainer.style.width = '100%';
    
    // 为Webkit浏览器定义滚动条样式
    const scrollbarStyle = document.createElement('style');
    scrollbarStyle.textContent = `
      #mouse-gesture-notification-container .url-list::-webkit-scrollbar {
        width: 4px !important;
      }
      #mouse-gesture-notification-container .url-list::-webkit-scrollbar-track {
        background: transparent !important;
      }
      #mouse-gesture-notification-container .url-list::-webkit-scrollbar-thumb {
        background-color: rgba(255,255,255,0.2) !important;
        border-radius: 4px !important;
      }
    `;
    document.head.appendChild(scrollbarStyle);
    urlListContainer.classList.add('url-list');
    
    // 显示URL标题，每行一个
    if (data.titles && data.titles.length > 0) {
      // 最多显示5个URL
      const maxUrlsToShow = 5;
      const titlesToShow = data.titles.slice(0, maxUrlsToShow);
      
      titlesToShow.forEach((titleText, index) => {
        const urlItem = document.createElement('div');
        urlItem.style.cssText = `
          display: flex !important;
          align-items: center !important;
          margin-bottom: 4px !important;
          box-sizing: border-box !important;
          width: 100% !important;
          padding: 0 !important;
        `;
        
        // 添加小圆点作为前缀
        const bullet = document.createElement('span');
        bullet.textContent = '•';
        bullet.style.cssText = `
          color: #FF82A9 !important;
          margin-right: 6px !important;
          font-size: 16px !important;
          line-height: 1 !important;
          flex-shrink: 0 !important;
        `;
        
        // URL标题容器，添加文本截断
        const urlTitle = document.createElement('span');
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
        const moreUrls = document.createElement('div');
        moreUrls.textContent = texts.moreTabs;
        moreUrls.style.cssText = `
          font-size: 12px !important;
          font-style: italic !important;
          opacity: 0.7 !important;
          margin-top: 2px !important;
          padding-left: 12px !important;
          box-sizing: border-box !important;
          width: 100% !important;
        `;
        urlListContainer.appendChild(moreUrls);
      }
    } else {
      const noUrlMessage = document.createElement('div');
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
    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.marginTop = '14px';
    buttons.style.gap = '10px';
    buttons.style.justifyContent = 'flex-end';
    buttons.style.boxSizing = 'border-box';
    buttons.style.width = '100%';
    buttons.style.padding = '0';
    
    // 忽略按钮 - 半透明+玻璃效果
    const ignoreBtn = document.createElement('button');
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
      document.body.removeChild(container);
    };
    
    // 关闭重复标签按钮 - 渐变粉红色
    const closeBtn = document.createElement('button');
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
      document.body.removeChild(container);
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
    
    // 确保body存在
    if (!document.body) {
      console.log('文档body不存在，无法显示通知');
      return;
    }
    
    // 添加到页面
    document.body.appendChild(container);
    
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
            if (document.body && container.parentNode === document.body) {
              document.body.removeChild(container);
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

// 安全地发送消息到扩展
function safeSendMessage(message) {
  if (!isExtensionValid) return Promise.resolve({success: false, error: 'Extension context invalidated'});
  
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
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

// 检查当前网址是否在禁用列表（禁用鼠标手势、超级拖拽、小窗预览）
function isSiteInDisabledList(href) {
  const list = settings.disabledSites;
  if (!list || !Array.isArray(list) || list.length === 0) return false;
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

// 加载设置
function loadSettings() {
  if (!isExtensionValid) return;
  
  try {
    chrome.storage.sync.get({
      enableGesture: true,
      showGestureTrail: true,
      showGestureHint: true,
      trailColor: '#FF9ECD',
      trailWidth: 3,
      enableSuperDrag: true,
      enableDragTextSearch: true,
      autoDownloadOnDragFile: false,
      enableImagePreview: true,
      enableDuplicateCheck: true,
      enableSmoothScroll: true,
      // 添加超级拖拽方向自定义，全部设为后台打开
      dragUpAction: 'background',
      dragRightAction: 'background',
      dragDownAction: 'background',
      dragLeftAction: 'background',
      dragSearchEngine: 'https://www.google.com/search?q={q}', // 添加超级拖拽搜索引擎URL设置
      language: getBrowserLanguage(), // 使用浏览器语言代替硬编码的'zh'
      
      // 手势动作自定义设置
      gestureLeftAction: 'goBack',
      gestureRightAction: 'forward',
      gestureUpAction: 'scrollUp',
      gestureDownAction: 'scrollDown',
      gestureDownThenRightAction: 'closeTab',
      gestureLeftThenUpAction: 'reopenClosedTab',
      gestureRightThenUpAction: 'openNewTab',
      gestureRightThenDownAction: 'refresh',
      gestureUpThenLeftAction: 'switchToLeftTab',
      gestureUpThenRightAction: 'switchToRightTab',
      gestureDownThenLeftAction: 'stopLoading',
      gestureLeftThenDownAction: 'forceRefresh',
      gestureUpThenDownAction: 'scrollToBottom',
      gestureDownThenUpAction: 'scrollToTop',
      gestureLeftThenRightAction: 'closeTab',
      gestureRightThenLeftAction: 'reopenClosedTab',
      disabledSites: []
    }, (loadedSettings) => {
      if (chrome.runtime.lastError) {
        console.log('加载设置错误:', chrome.runtime.lastError.message);
        return;
      }
      
      // 直接更新设置，不再检查语言是否变化，也不显示提示
      settings = loadedSettings;
      
      // 如果手势被禁用，确保清理任何现有的手势状态
      if (!settings.enableGesture) {
        clearGestureCanvas();
        resetGestureState();
      }
    });
  } catch (e) {
    console.log('加载设置异常:', e.message);
    if (e.message.includes('Extension context invalidated')) {
      isExtensionValid = false;
    }
  }
}

// 获取浏览器语言
function getBrowserLanguage() {
  // 获取浏览器语言设置
  const browserLang = (navigator.language || navigator.userLanguage || 'en').toLowerCase();
  
  // 支持的语言列表及其对应的locale映射
  const languageMap = {
    'zh_CN': 'zh_CN',
    'zh_TW': 'zh_TW',
    'zh_HK': 'zh_TW',
    'zh_MO': 'zh_TW',
    'zh': 'zh_CN',
    'en_US': 'en_US',
    'es': 'es',
    'fr': 'fr',
    'de': 'de',
    'pt_BR': 'pt_BR',
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
  const langPrefix = browserLang.split('-')[0];
  if (languageMap[langPrefix]) {
    return languageMap[langPrefix];
  }
  
  // 默认使用英文
  return 'en_US';
}

// 获取i18n消息
function getI18nMessage(messageName, substitutionsOrFallback = '', fallback = '') {
  try {
    // 检查第二个参数是否为替换数组
    let substitutions = [];
    let actualFallback = '';
    
    if (Array.isArray(substitutionsOrFallback)) {
      substitutions = substitutionsOrFallback;
      actualFallback = fallback;
    } else {
      actualFallback = substitutionsOrFallback;
    }
    
    const message = chrome.i18n.getMessage(messageName, substitutions);
    return message || actualFallback;
  } catch (error) {
    console.error('获取i18n消息失败:', error.message);
    return Array.isArray(substitutionsOrFallback) ? fallback : substitutionsOrFallback;
  }
}

// 重置手势状态
function resetGestureState() {
  isRightMouseDown = false;
  isGestureInProgress = false;
  gesturePoints = [];
  lastHintAction = ''; // 重置上一次提示的动作
}

// 手势动作执行后的重置函数
function resetGestureAfterAction(immediate = false) {
  // 重置手势状态
  resetGestureState();
  
  // 清理手势画布
  if (immediate) {
    // 立即清理画布
    clearGestureCanvas();
  } else {
    // 延迟清理画布，让用户能看到完整的手势轨迹
    setTimeout(() => {
      clearGestureCanvas();
    }, 100);
  }
}


// 创建用于显示手势轨迹的画布
function createGestureCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.zIndex = '2147483647'; // 使用最大z-index值
  canvas.style.pointerEvents = 'none'; // 确保画布不会捕获鼠标事件
  canvas.style.display = 'block'; // 确保画布始终显示
  
  // 将画布添加到body的最前面
  if (document.body) {
    if (document.body.firstChild) {
      document.body.insertBefore(canvas, document.body.firstChild);
    } else {
      document.body.appendChild(canvas);
    }
  } else {
    // 如果body还不存在，等待DOM加载完成
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        if (document.body) {
          document.body.appendChild(canvas);
        }
      });
    } else {
      // 如果readyState不是loading但body仍为null，延迟执行
      setTimeout(function() {
        if (document.body) {
          document.body.appendChild(canvas);
        }
      }, 100);
    }
  }
  
  return canvas;
}

// 初始化手势画布
function initGestureCanvas() {
  if (gestureCanvas) {
    try {
      // 检查body是否存在，以及画布是否还在DOM中
      if (document.body && document.body.contains(gestureCanvas)) {
        document.body.removeChild(gestureCanvas);
      }
    } catch (e) {
      console.log('移除画布错误:', e.message);
    }
  }
  
  // 如果不显示手势轨迹，只初始化手势点数组
  if (!settings.showGestureTrail) {
    gestureCanvas = null;
    gestureContext = null;
    return;
  }
  
  gestureCanvas = createGestureCanvas();
  gestureContext = gestureCanvas.getContext('2d');
  
  // 启用抗锯齿
  gestureContext.imageSmoothingEnabled = true;
  gestureContext.imageSmoothingQuality = 'high';
  
  // 设置基本样式
  gestureContext.strokeStyle = settings.trailColor;
  gestureContext.lineWidth = settings.trailWidth;
  gestureContext.lineCap = 'round';
  gestureContext.lineJoin = 'round';
}

// 清除手势画布
function clearGestureCanvas() {
  if (gestureCanvas) {
    try {
      // 检查body是否存在，以及画布是否还在DOM中
      if (document.body && document.body.contains(gestureCanvas)) {
        document.body.removeChild(gestureCanvas);
      }
    } catch (e) {
      console.log('清除画布错误:', e.message);
    }
    gestureCanvas = null;
    gestureContext = null;
  }
}

// 获取元素相对于视口的位置
function getElementPosition(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY
  };
}

// 修改绘制手势轨迹的函数
function drawGesture(x, y) {
  // 添加当前点到手势点数组
  gesturePoints.push({ x: x, y: y });
  
  // 如果不显示轨迹或没有上下文，直接返回
  if (!settings.showGestureTrail || !gestureContext) return;
  
  try {
    // 清除画布
    gestureContext.clearRect(0, 0, gestureCanvas.width, gestureCanvas.height);
    
    // 如果点数太少，直接绘制直线
    if (gesturePoints.length < 3) {
      gestureContext.beginPath();
      gestureContext.moveTo(gesturePoints[0].x, gesturePoints[0].y);
      gestureContext.lineTo(x, y);
      gestureContext.stroke();
      return;
    }
    
    // 使用贝塞尔曲线绘制平滑轨迹
    gestureContext.beginPath();
    gestureContext.moveTo(gesturePoints[0].x, gesturePoints[0].y);
    
    // 计算控制点
    for (let i = 1; i < gesturePoints.length - 2; i++) {
      const xc = (gesturePoints[i].x + gesturePoints[i + 1].x) / 2;
      const yc = (gesturePoints[i].y + gesturePoints[i + 1].y) / 2;
      gestureContext.quadraticCurveTo(gesturePoints[i].x, gesturePoints[i].y, xc, yc);
    }
    
    // 处理最后两个点
    const last = gesturePoints.length - 2;
    gestureContext.quadraticCurveTo(
      gesturePoints[last].x,
      gesturePoints[last].y,
      gesturePoints[last + 1].x,
      gesturePoints[last + 1].y
    );
    
    // 设置基本样式
    gestureContext.strokeStyle = settings.trailColor;
    gestureContext.lineWidth = settings.trailWidth;
    gestureContext.lineCap = 'round';
    gestureContext.lineJoin = 'round';
    
    // 绘制轨迹
    gestureContext.stroke();
  } catch (e) {
    console.log('绘制手势错误:', e.message);
  }
}

// 简化手势点，去除冗余点
function simplifyGesturePoints(points) {
  if (points.length <= 2) return points;
  
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
      const dist = lineDistance(points[i], points[start], points[end]);
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
      return [points[start], points[end]];
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
  const epsilon = minDirectionSegmentLength / 2; // 使用方向段长度的一半作为阈值
  return douglasPeucker(0, points.length - 1, epsilon, []);
}

// 调试信息面板相关变量
let debugPanel = null; // 调试信息面板元素
let isDebugPanelVisible = false; // 跟踪调试面板显示状态
let lastDebugInfo = {}; // 存储最近一次手势的调试信息
let enableDebugPanelSetting = false; // 从设置控制是否允许显示调试面板

// 初始化调试面板开关设置并监听变化
try {
  if (chrome && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({ enableDebugPanel: false }, (items) => {
      enableDebugPanelSetting = !!items.enableDebugPanel;
      if (!enableDebugPanelSetting && isDebugPanelVisible) {
        toggleDebugPanel();
      }
    });
    chrome.storage.onChanged.addListener((changes, namespace) => {
      try {
        if (namespace === 'sync' && changes.enableDebugPanel) {
          enableDebugPanelSetting = !!changes.enableDebugPanel.newValue;
          if (!enableDebugPanelSetting && isDebugPanelVisible) {
            toggleDebugPanel();
          }
        }
      } catch (e) {}
    });
  }
} catch (e) {}

// 添加调试信息收集函数
function collectDebugInfo(originalDirections, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                          repeatingPattern, mergedDirections, finalGesture, similarity, directionDistances) {
  // 收集所有调试信息
  lastDebugInfo = {
    timestamp: new Date().toLocaleTimeString(),
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
  if (isDebugPanelVisible && debugPanel) {
    updateDebugPanel();
  }
}

// 获取调试面板翻译文本
function getDebugPanelText(key) {
  return getI18nMessage('debug' + key.charAt(0).toUpperCase() + key.slice(1), key);
}

// 初始化调试面板
function initDebugPanel() {
  // 如果已经存在，先移除
  if (debugPanel && document.body.contains(debugPanel)) {
    document.body.removeChild(debugPanel);
  }
  
  // 创建新的调试面板
  debugPanel = document.createElement('div');
  debugPanel.id = 'mouseGestureDebugPanel';
  debugPanel.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    width: 300px;
    max-height: 80vh;
    overflow-y: auto;
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
  
  // 添加标题和关闭按钮
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(102, 126, 234, 0.25);
    padding-bottom: 8px;
    margin-bottom: 12px;
  `;
  
  const title = document.createElement('div');
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
  
  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '8px';
  
  const copyButton = document.createElement('button');
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
  
  const closeButton = document.createElement('button');
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
  const content = document.createElement('div');
  content.id = 'mouseGestureDebugContent';
  debugPanel.appendChild(content);
  
  // 添加消息提示区域
  const messageArea = document.createElement('div');
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
  
  // 最后添加到文档
  document.body.appendChild(debugPanel);
  
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
function copyDebugInfo() {
  // 如果没有调试信息，直接返回
  if (!lastDebugInfo || Object.keys(lastDebugInfo).length === 0) {
    showDebugMessage(getDebugPanelText('waitingForGestureData'), false);
    return;
  }
  
  // 格式化调试信息为纯文本
  const textInfo = formatDebugInfoForCopy(currentLang);
  
  try {
    // 创建临时文本区域
    const textarea = document.createElement('textarea');
    textarea.value = textInfo;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    
    // 尝试使用execCommand复制
    let success = false;
    try {
      success = document.execCommand('copy');
    } catch (e) {
      success = false;
    }
    
    // 如果execCommand失败，尝试使用Clipboard API
    if (!success && navigator.clipboard) {
      navigator.clipboard.writeText(textInfo)
        .then(() => {
          showDebugMessage(getDebugPanelText('copySuccess'), true);
        })
        .catch(() => {
          showDebugMessage(getDebugPanelText('copyFailed'), false);
        });
    } else if (success) {
      showDebugMessage(getDebugPanelText('copySuccess'), true);
    } else {
      showDebugMessage(getDebugPanelText('copyFailed'), false);
    }
    
    // 清理
    document.body.removeChild(textarea);
  } catch (e) {
    console.log('复制调试信息错误:', e.message);
    showDebugMessage(getDebugPanelText('copyFailed'), false);
  }
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
  
  // 系统设置
  result += `${getDebugPanelText('systemSettings')}:\n`;
  result += `- ${getDebugPanelText('angleThreshold')}: ${angleThreshold}\n`;
  result += `- ${getDebugPanelText('directionChangeThreshold')}: ${directionChangeThreshold}\n`;
  result += `- ${getDebugPanelText('minGestureDistance')}: ${minGestureDistance}\n`;
  result += `- ${getDebugPanelText('minDirectionSegmentLength')}: ${minDirectionSegmentLength}\n`;
  result += `- ${getDebugPanelText('minGestureComplexity')}: ${minGestureComplexity}\n\n`;
  
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

// 更新调试面板内容
function updateDebugPanel() {
  try {
    if (!debugPanel) return;
    
    const content = debugPanel.querySelector('#mouseGestureDebugContent');
    if (!content) return;
    
    // 显示系统设置
    let html = `
      <div style="margin-bottom: 12px;">
        <div style="
          color: #a78bfa; 
          margin-bottom: 6px; 
          font-weight: 600; 
          font-size: 11px;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          border-bottom: 1px dashed rgba(167, 139, 250, 0.2);
          padding-bottom: 3px;
        ">${getDebugPanelText('systemSettings')}</div>
        <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; padding-left: 4px;">
          <span style="color: #93c5fd;">${getDebugPanelText('angleThreshold')}:</span>
          <span style="color: #e2e8f0;">${angleThreshold}</span>
          <span style="color: #93c5fd;">${getDebugPanelText('directionChangeThreshold')}:</span>
          <span style="color: #e2e8f0;">${directionChangeThreshold}</span>
          <span style="color: #93c5fd;">${getDebugPanelText('minGestureDistance')}:</span>
          <span style="color: #e2e8f0;">${minGestureDistance}</span>
          <span style="color: #93c5fd;">${getDebugPanelText('minDirectionSegmentLength')}:</span>
          <span style="color: #e2e8f0;">${minDirectionSegmentLength}</span>
          <span style="color: #93c5fd;">${getDebugPanelText('minGestureComplexity')}:</span>
          <span style="color: #e2e8f0;">${minGestureComplexity}</span>
        </div>
      </div>
    `;
    
    // 显示最新手势信息
    if (lastDebugInfo && Object.keys(lastDebugInfo).length > 0) {
      html += `
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
        <div style="margin-bottom: 12px; padding-left: 4px;">
          <div style="margin-bottom: 4px;">
            <span style="color: #93c5fd;">${getDebugPanelText('points')}:</span>
            <span style="color: #e2e8f0;">${lastDebugInfo.pointsCount}</span>
            <span style="color: #64748b;">→</span>
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
          <div style="margin-bottom: 8px; padding-left: 4px;">
            <div style="margin-bottom: 4px;">
              <div style="color: #93c5fd;">${getDebugPanelText('originalDirections')}:</div>
              <div style="margin-left: 4px;">${formatDirections(lastDebugInfo.originalDirections, getBrowserLanguage(), lastDebugInfo.directionDistances)}</div>
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
          <div style="padding-left: 4px;">
            <div style="color: #93c5fd; margin-bottom: 2px;">${getDebugPanelText('mergedDirections')}:</div>
            <div style="margin-left: 4px;">${formatDirections(lastDebugInfo.mergedDirections, getBrowserLanguage(), lastDebugInfo.directionDistances)}</div>
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
          <div style="padding-left: 4px;">
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
    } else {
      html += `<div style="color: #94a3b8; font-style: italic; text-align: center; padding: 20px 0;">${getDebugPanelText('waitingForGestureData')}</div>`;
    }
    
    content.innerHTML = html;
  } catch (e) {
    console.error('更新调试面板内容时出错:', e.message);
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
    if (!debugPanel || !document.body.contains(debugPanel)) {
      initDebugPanel();
    } else {
      debugPanel.style.display = 'block';
      updateDebugPanel();
    }
  } else if (debugPanel) {
    debugPanel.style.display = 'none';
  }
}

// 添加快捷键监听
document.addEventListener('keydown', function(e) {
  // 按下Alt+D组合键切换调试面板
  if (e.altKey && (e.key === 'd' || e.key === 'D')) {
    // 仅在启用调试面板功能时拦截；关闭时允许浏览器默认行为
    if (enableDebugPanelSetting) {
      toggleDebugPanel();
      e.preventDefault();
    }
  }
});

// 优化手势识别算法
function recognizeGesture() {
  if (gesturePoints.length < 2) return '';
  
  // 简化手势点
  const simplifiedPoints = simplifyGesturePoints(gesturePoints);
  
  // 如果简化后的点太少，不识别为手势
  if (simplifiedPoints.length < 2) return '';
  
  // 检查是否有乱画标记
  if (simplifiedPoints.length === 2 && simplifiedPoints[1].isScribbling) {
    // 如果检测到乱画，直接返回空
    return '';
  }
  
  // 识别每段的方向
  const directions = [];
  const directionDistances = []; // 添加存储方向距离的数组
  let totalDistance = 0;
  
  for (let i = 1; i < simplifiedPoints.length; i++) {
    const prev = simplifiedPoints[i - 1];
    const curr = simplifiedPoints[i];
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    totalDistance += distance;
    
    // 使用角度阈值判断方向，更严格的判断标准
    if (Math.abs(dx) > Math.abs(dy) * angleThreshold) {
      // 水平方向
      const direction = dx > 0 ? 'right' : 'left';
      directions.push(direction);
      directionDistances.push(Math.round(distance)); // 记录该方向的距离
    } else if (Math.abs(dy) > Math.abs(dx) * angleThreshold) {
      // 垂直方向
      const direction = dy > 0 ? 'down' : 'up';
      directions.push(direction);
      directionDistances.push(Math.round(distance)); // 记录该方向的距离
    }
  }
  
  // 如果总距离太短，不识别为手势
  if (totalDistance < minGestureDistance * 1.5) return '';
  
  // 如果没有识别出方向，返回空
  if (directions.length === 0) return '';
  
  // 计算手势复杂度 - 检测乱画手势
  let directionChanges = 0;
  let prevDirection = directions[0];
  let sequentialRepetitions = 0; // 用于检测连续重复的模式
  let lastDirectionPair = ''; // 上一个方向对
  let directionPairs = []; // 存储所有方向对
  
  for (let i = 1; i < directions.length; i++) {
    if (directions[i] !== prevDirection) {
      // 存储当前方向对
      if (i > 1) {
        directionPairs.push(prevDirection + '-' + directions[i]);
      }
        
      // 检测是否形成了重复模式（如 up-down-up-down）
      const currentPair = prevDirection + '-' + directions[i];
      if (lastDirectionPair === currentPair) {
        sequentialRepetitions++;
      } else {
        lastDirectionPair = currentPair;
      }
        
      directionChanges++;
      prevDirection = directions[i];
    }
  }
  
  // 检测是否存在重复模式
  let hasRepetitivePattern = sequentialRepetitions >= 1; // 检测连续的重复对
  
  // 检测非连续的重复模式，例如"上下左上下右"中的两个"上下"
  if (!hasRepetitivePattern && directionPairs.length >= 3) {
    const pairCounts = {};
    for (const pair of directionPairs) {
      pairCounts[pair] = (pairCounts[pair] || 0) + 1;
    }
    
    // 如果任何方向对出现超过一次，认为存在重复模式
    for (const pair in pairCounts) {
      if (pairCounts[pair] > 1) {
        hasRepetitivePattern = true;
        break;
      }
    }
  }
  
  // 特殊检测：zigzag模式 (上下上下或左右左右)
  let repeatingPattern = '';
  if (!hasRepetitivePattern && directions.length >= 4) {
    let isZigzagPattern = false;
    
    // 检查特定的重复模式
    const zigzagPatterns = [
      ['left', 'right'], // 左右左右...
      ['right', 'left'], // 右左右左...
      ['up', 'down'],    // 上下上下...
      ['down', 'up']     // 下上下上...
    ];
    
    for (const pattern of zigzagPatterns) {
      let matchCount = 0;
      let totalCheck = 0;
      
      for (let i = 0; i < directions.length - 1; i += 2) {
        if (i + 1 < directions.length) {
          totalCheck++;
          if (directions[i] === pattern[0] && directions[i+1] === pattern[1]) {
            matchCount++;
          }
        }
      }
      
      // 如果有超过50%的匹配，认为是重复模式
      if (totalCheck > 0 && matchCount / totalCheck > 0.5) {
        isZigzagPattern = true;
        repeatingPattern = `${pattern[0]}-${pattern[1]}`;
        console.log(`检测到zigzag模式: ${pattern[0]}-${pattern[1]}，匹配率: ${matchCount}/${totalCheck}`);
        break;
      }
    }
    
    if (isZigzagPattern) {
      hasRepetitivePattern = true;
    }
  }
  
  // 如果方向变化次数过多且总距离不大，且不是重复模式，认为是乱画
  if (directionChanges > minGestureComplexity && !hasRepetitivePattern) {
    if (totalDistance < 200 || directions.length > 20) {
      return ''; // 乱画手势直接返回空
    }
  }
  
  // 合并相同的连续方向，允许少量抖动
  const mergedDirections = [];
  let currentDirection = directions[0];
  let directionCount = 1;
  let maxCount = 1;
  let hasDirectionChanges = false; // 标记是否有方向变化
  
  // 首先检测是否存在反复的方向变化模式
  // 例如：左右左右或上下上下
  let repeatingFlag = false;
  if (directions.length >= 4) {
    // 检查交替出现的模式
    let alternatingCount = 0;
    for (let i = 0; i < directions.length - 2; i += 2) {
      if (directions[i] === directions[i+2] && 
          directions[i+1] && directions[i] !== directions[i+1]) {
        alternatingCount++;
      }
    }
    
    // 如果有多次交替出现，认为是重复手势
    repeatingFlag = alternatingCount >= 1;
  }
  
  // 如果检测到重复模式，使用更宽松的方向合并策略
  if (repeatingFlag) {
    // 对于重复模式，不做过度合并，而是保留方向变化
    for (let i = 0; i < directions.length; i++) {
      // 如果当前方向与前一个不同，添加到合并数组
      if (i === 0 || directions[i] !== directions[i-1]) {
        mergedDirections.push(directions[i]);
        hasDirectionChanges = i > 0 && directions[i] !== directions[i-1];
      }
    }
  } else {
    // 改进的合并逻辑，对于非重复模式使用
    // 更保守的合并策略，更容易保留方向变化
  for (let i = 1; i < directions.length; i++) {
    if (directions[i] === currentDirection) {
      directionCount++;
      if (directionCount > maxCount) {
        maxCount = directionCount;
      }
    } else {
        // 降低判断标准，使更多方向变化被保留
        // 只有当新方向的出现次数非常少时才认为是抖动
        if (directionCount < maxCount * directionChangeThreshold / 2) {
          // 抖动阈值减半，更容易接受新方向
          // 但仍然忽略极短的方向变化
        continue;
      }
      mergedDirections.push(currentDirection);
      currentDirection = directions[i];
      directionCount = 1;
        hasDirectionChanges = true;
    }
  }
  
    // 添加最后一个方向，更宽松的标准
    if (directionCount >= maxCount * directionChangeThreshold / 2 || mergedDirections.length === 0) {
  mergedDirections.push(currentDirection);
    }
  }
  
  // 检查合并后的方向数量，如果超过两个不同方向，则识别为无效手势
  if (mergedDirections.length > 2) {
    console.log('检测到超过两个不同方向的手势，识别为无效手势:', mergedDirections.join(' then '));
    collectDebugInfo(directions, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                    repeatingPattern, mergedDirections, '', 0, directionDistances);
    return ''; // 超过两个方向的手势视为无效
  }
  
  // 特殊处理重复的左右或上下模式
  if (hasRepetitivePattern && mergedDirections.length >= 2) {
    // 保留重复左右或上下的模式，不要简化为单一方向
    const firstTwo = mergedDirections.slice(0, 2);
    const pattern = firstTwo.join('-');
    
    // 检查是否为左右、右左、上下、下上模式
    const repeatingPatterns = ['left-right', 'right-left', 'up-down', 'down-up'];
    if (repeatingPatterns.includes(pattern)) {
      console.log('检测到重复的方向变化模式:', pattern);
      // 简化为最多4个方向，捕捉核心模式
      if (mergedDirections.length > 4) {
        // 保留前4个方向或偶数个方向，确保完整的左右/上下循环
        const patternLength = Math.min(4, Math.floor(mergedDirections.length / 2) * 2);
        mergedDirections.splice(patternLength);
      }
      
      // 收集调试信息
      collectDebugInfo(directions, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                      repeatingPattern, mergedDirections, mergedDirections.join(' then '), 1.0, directionDistances);
      
      // 返回这个重复模式的字符串表示
      return mergedDirections.join(' then ');
    }
  }
  
  // 如果合并后的方向大于2个，且包含关闭标签页的子模式，则提高判断标准
  if (mergedDirections.length > 2) {
    const closeTabPatterns = [['down', 'right'], ['left', 'right']];
    for (const pattern of closeTabPatterns) {
      let matchFound = false;
      for (let i = 0; i < mergedDirections.length - 1; i++) {
        if (mergedDirections[i] === pattern[0] && mergedDirections[i+1] === pattern[1]) {
          matchFound = true;
          // 对于多于2个方向的手势，如包含关闭标签页模式，需要更严格的判定
          if (totalDistance < 120) {
            collectDebugInfo(directions, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                            repeatingPattern, mergedDirections, '', 0, directionDistances);
            return ''; // 距离太短，不认为是关闭标签页的手势
          }
          break;
        }
      }
      if (matchFound) break;
    }
  }
  
  // 特殊处理上下/下上手势，确保它们被正确识别
  if (mergedDirections.length === 2) {
    // 上下手势 - 添加更严格的判断逻辑
    if (mergedDirections[0] === 'up' && mergedDirections[1] === 'down') {
      // 检查第一个方向的占比，如果上占比明显大，则强化识别为上下
      const startIndex = 0;
      const dirChanges = [];
      
      // 找出所有方向变化点
      for (let i = 1; i < directions.length; i++) {
        if (directions[i] !== directions[i-1]) {
          dirChanges.push(i);
        }
      }
      
      // 只有一个方向变化点且方向从上变为下
      if (dirChanges.length === 1 && directions[0] === 'up' && directions[dirChanges[0]] === 'down') {
        const upPortion = dirChanges[0] / directions.length;
        // 如果上方向占比超过40%，则确认为上下手势
        if (upPortion >= 0.4) {
          console.log('明确识别为上下手势，上方向占比:', upPortion);
          collectDebugInfo(directions, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                          repeatingPattern, mergedDirections, 'up then down', 1.0, directionDistances);
          return 'up then down';
        }
      }
      
      // 如果有多个方向变化点，分析主要方向
      if (dirChanges.length > 1) {
        let upCount = 0;
        let downCount = 0;
        
        // 统计各方向的点数
        for (let i = 0; i < directions.length; i++) {
          if (directions[i] === 'up') upCount++;
          else if (directions[i] === 'down') downCount++;
        }
        
        // 确保上方向的点多于下方向，增强上下识别准确性
        if (upCount > downCount * 0.7) {
          console.log('多方向变化中识别为上下手势, 上点数:', upCount, '下点数:', downCount);
          collectDebugInfo(directions, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                          repeatingPattern, mergedDirections, 'up then down', 1.0, directionDistances);
          return 'up then down';
        }
      }
      
      // 检查上下距离比例
      let upDistance = 0;
      let downDistance = 0;
      let firstDirectionChange = -1;
      
      // 找到第一个方向变化点
      for (let i = 1; i < directions.length; i++) {
        if (directions[i] !== directions[0]) {
          firstDirectionChange = i;
          break;
        }
      }
      
      if (firstDirectionChange > 0) {
        // 计算上方向和下方向的距离
        for (let i = 0; i < firstDirectionChange; i++) {
          if (i < directionDistances.length) {
            upDistance += directionDistances[i];
          }
        }
        
        for (let i = firstDirectionChange; i < directions.length; i++) {
          if (i < directionDistances.length) {
            downDistance += directionDistances[i];
          }
        }
        
        // 如果上方向的距离显著大于下方向，增强识别为"上下"的置信度
        if (upDistance > downDistance * 0.7) {
          console.log('增强识别上下手势, 上距离:', upDistance, '下距离:', downDistance);
          collectDebugInfo(directions, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                          repeatingPattern, mergedDirections, 'up then down', 1.0, directionDistances);
          return 'up then down';
        }
      } else {
        // 如果没有找到方向变化点，仍然返回合并后的方向
        collectDebugInfo(directions, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                        repeatingPattern, mergedDirections, 'up then down', 1.0, directionDistances);
        return 'up then down';
      }
    }
    
    // 下上手势 - 添加更严格的判断逻辑
    if (mergedDirections[0] === 'down' && mergedDirections[1] === 'up') {
      // 检查下上距离比例
      let downDistance = 0;
      let upDistance = 0;
      let firstDirectionChange = -1;
      
      // 找到第一个方向变化点
      for (let i = 1; i < directions.length; i++) {
        if (directions[i] !== directions[0]) {
          firstDirectionChange = i;
          break;
        }
      }
      
      if (firstDirectionChange > 0) {
        // 计算下方向和上方向的距离
        for (let i = 0; i < firstDirectionChange; i++) {
          if (i < directionDistances.length) {
            downDistance += directionDistances[i];
          }
        }
        
        for (let i = firstDirectionChange; i < directions.length; i++) {
          if (i < directionDistances.length) {
            upDistance += directionDistances[i];
          }
        }
        
        // 如果下方向的距离显著大于上方向，增强识别为"下上"的置信度
        if (downDistance > upDistance * 0.8) {
          console.log('增强识别下上手势, 下距离:', downDistance, '上距离:', upDistance);
          collectDebugInfo(directions, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                          repeatingPattern, mergedDirections, 'down then up', 1.0, directionDistances);
          return 'down then up';
        }
      } else {
        // 如果没有找到方向变化点，仍然返回合并后的方向
        collectDebugInfo(directions, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                        repeatingPattern, mergedDirections, 'down then up', 1.0, directionDistances);
        return 'down then up';
      }
    }
  }
  
  // 检查是否是有效的手势组合
  const gesture = mergedDirections.join(' then ');
  const validGestures = [
    'left', 'right', 'up', 'down',
    'down then right', 'left then up', 'right then up',
    'right then down', 'up then left', 'up then right',
    'down then left', 'left then down', 'up then down',
    'down then up', 'left then right', 'right then left',
    'right then right', // 添加新的手势：右右 = 下一页
    'scrollLeft', 'scrollRight', 'forceRefresh'
  ];
  
  // 使用模糊匹配来提高识别率
  const result = findBestMatch(gesture, validGestures, directions, 
                              simplifiedPoints, totalDistance, hasRepetitivePattern, 
                              repeatingPattern, mergedDirections, directionDistances);
  return result;
}

// 改进模糊匹配函数
function findBestMatch(gesture, validGestures, originalDirections, simplifiedPoints, 
                      totalDistance, hasRepetitivePattern, repeatingPattern, mergedDirections, directionDistances) {
  // 如果完全匹配，直接返回
  if (validGestures.includes(gesture)) {
    collectDebugInfo(originalDirections, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                    repeatingPattern, mergedDirections, gesture, 1.0, directionDistances);
    return gesture;
  }
  
  // 分解手势为方向数组
  const gestureDirections = gesture.split(' then ');
  
  // 如果只有一个方向，只匹配基本方向
  if (gestureDirections.length === 1) {
    if (validGestures.includes(gestureDirections[0])) {
      collectDebugInfo(originalDirections, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                      repeatingPattern, mergedDirections, gestureDirections[0], 1.0, directionDistances);
      return gestureDirections[0];
    }
    collectDebugInfo(originalDirections, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                    repeatingPattern, mergedDirections, '', 0, directionDistances);
    return '';
  }
  
  // 对于复合手势，查找最接近的有效手势
  let bestMatch = '';
  let maxSimilarity = 0;
  
  // 首先检查是否是常见的重复方向模式
  const isRepeatingPattern = 
    gestureDirections.length >= 4 && 
    (
      // 左右重复模式
      (gestureDirections[0] === 'left' && gestureDirections[1] === 'right' &&
       gestureDirections[2] === 'left' && gestureDirections[3] === 'right') ||
      // 右左重复模式
      (gestureDirections[0] === 'right' && gestureDirections[1] === 'left' &&
       gestureDirections[2] === 'right' && gestureDirections[3] === 'left') ||
      // 上下重复模式
      (gestureDirections[0] === 'up' && gestureDirections[1] === 'down' &&
       gestureDirections[2] === 'up' && gestureDirections[3] === 'down') ||
      // 下上重复模式
      (gestureDirections[0] === 'down' && gestureDirections[1] === 'up' &&
       gestureDirections[2] === 'down' && gestureDirections[3] === 'up')
    );

  // 如果是重复方向模式，返回前2个方向作为核心模式
  if (isRepeatingPattern) {
    const corePattern = gestureDirections.slice(0, 2).join(' then ');
    console.log('识别到重复方向模式，使用核心模式:', corePattern);
    
    // 检查核心模式是否是有效手势
    if (validGestures.includes(corePattern)) {
      collectDebugInfo(originalDirections, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                      repeatingPattern, mergedDirections, corePattern, 0.95, directionDistances);
      return corePattern;
    }
  }
  
  // 进一步降低相似性阈值来提高识别率
  const similarityThreshold = gestureDirections.length <= 2 ? 0.82 : 0.65;
  
  // 为关闭标签页相关手势设置较高的相似度阈值，但不要太高以避免过度抑制
  const closeTabGestures = ['down then right', 'left then right'];
  const closeTabThreshold = 0.92; // 从0.95降低到0.92，仍然高于普通手势但更容易识别
  
  // 对于可能包含重复模式的手势，进一步优化识别
  let hasAdvancedRepetitivePattern = false;
  let isComplexPattern = false;
  
  // 检测是否有重复模式
  if (gestureDirections.length >= 4) {
    // 检查是否有重复模式 (例如 ABAB 模式)
    for (let i = 0; i < gestureDirections.length - 3; i++) {
      if (gestureDirections[i] === gestureDirections[i+2] && 
          gestureDirections[i+1] === gestureDirections[i+3]) {
        hasAdvancedRepetitivePattern = true;
        break;
      }
    }
    
    // 特殊检测：zigzag模式 (例如 ABABAB...)
    let zigzagCount = 0;
    for (let i = 0; i < gestureDirections.length - 2; i++) {
      if (gestureDirections[i] === gestureDirections[i+2] && 
          gestureDirections[i] !== gestureDirections[i+1]) {
        zigzagCount++;
      }
    }
    
    isComplexPattern = zigzagCount > 1 || gestureDirections.length > 5;
  }
  
  // 设置不同类型手势的相似度阈值
  const repetitivePatternThreshold = 0.6; // 降低重复模式的阈值
  const complexPatternThreshold = 0.55; // 更复杂模式可使用更低的阈值
  
  // 尝试提取重复轨迹中的关键方向模式
  let simplifiedPattern = [];
  if (hasAdvancedRepetitivePattern && gestureDirections.length > 3) {
    // 提取前2-4个方向作为核心模式
    const corePatternLength = Math.min(4, gestureDirections.length);
    simplifiedPattern = gestureDirections.slice(0, corePatternLength);
    
    // 对每个有效手势检查此简化模式
    for (const validGesture of validGestures) {
      const validDirections = validGesture.split(' then ');
      
      if (validDirections.length <= simplifiedPattern.length) {
        let matches = 0;
        for (let i = 0; i < validDirections.length; i++) {
          if (i < simplifiedPattern.length && validDirections[i] === simplifiedPattern[i]) {
            matches++;
          }
        }
        
        // 如果开头的关键方向匹配度高，就视为可能的匹配
        if (matches === validDirections.length) {
          collectDebugInfo(originalDirections, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                          repeatingPattern, mergedDirections, validGesture, 0.9, directionDistances);
          return validGesture; // 直接返回此手势
        }
      }
    }
  }
  
  for (const validGesture of validGestures) {
    const validDirections = validGesture.split(' then ');
    
    // 只比较相同长度的手势
    if (validDirections.length === gestureDirections.length) {
      let similarity = 0;
      let matches = 0;
      let importance = 1.0; // 权重因子
      
      // 计算方向匹配度，第一个方向和最后一个方向更重要
      for (let i = 0; i < gestureDirections.length; i++) {
        // 第一个和最后一个方向的权重更高
        if (i === 0 || i === gestureDirections.length - 1) {
          importance = 1.5;
        } else {
          importance = 1.0;
        }
        
        if (gestureDirections[i] === validDirections[i]) {
          matches++;
          similarity += importance;
        }
      }
      
      // 计算相似度百分比，考虑权重
      const maxPossibleSimilarity = gestureDirections.length + 0.5 * (gestureDirections.length < 3 ? 2 : 2);
      similarity = similarity / maxPossibleSimilarity;
      
      // 获取当前手势需要达到的相似度阈值
      let currentThreshold = similarityThreshold;
      
      // 如果是关闭标签页相关手势，使用更高的相似度要求
      if (closeTabGestures.includes(validGesture)) {
        currentThreshold = closeTabThreshold;
      }
      
      // 如果检测到重复模式，且当前手势不是关闭标签页，使用更低的阈值
      else if (hasRepetitivePattern && !closeTabGestures.includes(validGesture)) {
        currentThreshold = repetitivePatternThreshold;
        
        // 对于更复杂的模式使用更低的阈值
        if (isComplexPattern) {
          currentThreshold = complexPatternThreshold;
        }
      }
      
      // 上下和下上手势特殊处理，适当放宽匹配要求
      if ((validGesture === 'up then down' || validGesture === 'down then up')) {
        if (matches < gestureDirections.length * 0.7) {  // 从0.8降低到0.7
        continue; // 跳过这个匹配
        }
      }
      
      // 为重复轨迹手势的匹配提供额外的容错处理
      if (hasRepetitivePattern && gestureDirections.length > 5) {
        // 对于长重复轨迹，如果起始方向匹配，给予额外加分
        if (gestureDirections[0] === validDirections[0] && 
            (validDirections.length == 1 || 
             (validDirections.length > 1 && gestureDirections[1] === validDirections[1]))) {
          // 给相似度额外加分，但不超过1
          similarity = Math.min(1.0, similarity + 0.15);
        }
      }
      
      // 如果相似度超过阈值，更新最佳匹配
      if (similarity > maxSimilarity && similarity >= currentThreshold) {
        maxSimilarity = similarity;
        bestMatch = validGesture;
      }
    }
  }
  
  // 存储调试信息
  collectDebugInfo(originalDirections, simplifiedPoints, totalDistance, hasRepetitivePattern, 
                  repeatingPattern, mergedDirections, bestMatch, maxSimilarity, directionDistances);
  
  return bestMatch;
}

// 显示手势提示
function showGestureHint(action) {
  // 如果手势提示被禁用或document.body不存在，直接返回
  if (!settings.showGestureHint || !document.body) return;
  
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
  
  // 如果提示元素存在，先清除它
  if (gestureHint && document.body.contains(gestureHint)) {
    // 清除任何现有的淡出定时器
    if (gestureHint.fadeOutTimer) {
      clearTimeout(gestureHint.fadeOutTimer);
    }
    document.body.removeChild(gestureHint);
    gestureHint = null;
  }
  
  // 获取动作显示文本
  let actionText = action;
  let actionKey = '';
  
  // 检查是否是带有滚动信息的滚动动作 (格式：滚动操作 (100px, 10%))
  const scrollUpText = getGestureTranslations().scrollUp || '向上滚动';
  const scrollDownText = getGestureTranslations().scrollDown || '向下滚动';
  const scrollLeftText = getGestureTranslations().scrollLeft || '向左滚动';
  const scrollRightText = getGestureTranslations().scrollRight || '向右滚动';
  
  const isScrollActionWithInfo = (action.includes(scrollUpText) || action.includes(scrollDownText) || 
                                 action.includes(scrollLeftText) || action.includes(scrollRightText)) && 
                               action.includes('px') && 
                               action.includes('%');
  
  if (isScrollActionWithInfo) {
    // 如果是带信息的滚动动作，提取基本动作类型
    if (action.includes(scrollUpText)) {
      actionKey = 'scrollUp';
    } else if (action.includes(scrollDownText)) {
      actionKey = 'scrollDown';
    } else if (action.includes(scrollLeftText)) {
      actionKey = 'scrollLeft';
    } else if (action.includes(scrollRightText)) {
      actionKey = 'scrollRight';
    }
    // 保留原始文本，包含距离和百分比信息
    actionText = action;
  } else {
    // 通过翻译键反向查找动作类型
    for (const key in getGestureTranslations()) {
      if (getGestureTranslations()[key] === action) {
        actionKey = key;
        break;
      }
    }
  
    // 如果找不到actionKey，可能是因为语言刚切换，尝试从其他语言翻译
    if (!actionKey) {
      // 尝试反向查找英文翻译
      for (const key in getGestureTranslations()) {
        if (getGestureTranslations()[key] === action || (getGestureTranslations().zh && getGestureTranslations().zh[key] === action)) {
          actionKey = key;
          // 获取当前语言的正确翻译
          if (getGestureTranslations()[currentLang] && getGestureTranslations()[currentLang][actionKey]) {
            actionText = getGestureTranslations()[currentLang][actionKey];
          }
          break;
        }
      }
    }
  }
  
  // 检查是否是无效手势提示
  const isInvalidGesture = actionKey === 'invalidGesture';
  
  // 检查是否是滚动相关提示 (带有px和百分比的格式)
  const isScrollAction = action.includes('px') && action.includes('%');
  
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
    case 'nextPage':
      iconText = '⏭';
      iconColor = '#4dabf7';
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
    case 'scrollToLeft':
      iconText = '⇤';
      iconColor = '#63e6be';
      break;
    case 'scrollToRight':
      iconText = '⇥';
      iconColor = '#63e6be';
      break;
    default:
      // 如果没有通过动作键匹配到，尝试通过动作文本匹配（向后兼容）
      if (action.includes('新窗口') || action.includes('New Window')) {
        iconText = '⊞';
        iconColor = '#a9e34b';
      } else if (action.includes('隐私窗口') || action.includes('Private')) {
        iconText = '👁';
        iconColor = '#845ef7';
      } else if (action.includes('其他标签页') || action.includes('Other Tabs')) {
        iconText = '⊟';
        iconColor = '#ff8787';
      } else if (action.includes('右侧标签页') || action.includes('Right Tabs')) {
        iconText = '⊟';
        iconColor = '#ff8787';
      } else if (action.includes('左侧标签页') || action.includes('Left Tabs')) {
        iconText = '⊟';
        iconColor = '#ff8787';
      } else if (action.includes('全部重新加载') || action.includes('Reload All Tabs')) {
        iconText = '↻';
        iconColor = '#94d3a2';
      } else if (action.includes('固定/取消固定标签页') || action.includes('Toggle Pin Tab')) {
        iconText = '🔒';
        iconColor = '#94d3a2';
      } else if (action.includes('静音/取消静音标签页') || action.includes('Toggle Mute Tab')) {
        iconText = '🔊';
        iconColor = '#94d3a2';
      } else if (action.includes('静音其他标签页') || action.includes('Mute Other Tabs')) {
        iconText = '🔊';
        iconColor = '#ff8787';
      } else if (action.includes('最大化/还原窗口') || action.includes('Toggle Maximize')) {
        iconText = '⛶';
        iconColor = '#ff8787';
      } else if (action.includes('最小化窗口') || action.includes('Minimize Window')) {
        iconText = '⛶';
        iconColor = '#ff8787';
      } else if (action.includes('全屏') || action.includes('Fullscreen')) {
        iconText = '⛶';
        iconColor = '#74c0fc';
      } else {
        iconText = '•';
        iconColor = '#ffffff';
      }
  }
  
  // 创建新的提示元素
  gestureHint = document.createElement('div');
  
  // 设置基本样式
  gestureHint.style.position = 'fixed';
  gestureHint.style.left = '50%';
  gestureHint.style.bottom = '100px';
  gestureHint.style.transform = 'translateX(-50%) translateY(20px)';
  // N 卡时自动简化样式（无 backdrop-filter）以兼容 HDR/RTX VSR
  const useSimplifiedHint = isNvidiaGpu();
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
  const icon = document.createElement('span');
  icon.style.marginRight = '6px';
  icon.style.marginLeft = '0';
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
  
  const text = document.createElement('span');
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

  // 检测系统主题是否为暗色模式
  const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  // 也可以检测页面背景颜色
  let pageBgColor = window.getComputedStyle(document.body).backgroundColor;
  const isLightBg = isLightBackground(pageBgColor);
  
  // 如果是亮色背景，调整提示框样式
  if (isLightBg && !isDarkMode) {
    gestureHint.style.backgroundColor = useSimplifiedHint ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.65)';
    gestureHint.style.border = '1px solid rgba(0, 0, 0, 0.02)'; // 从0.04降低到0.02，进一步减淡边框颜色
    gestureHint.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.08), 0 2px 6px rgba(0, 0, 0, 0.04)'; // 减轻阴影
    text.style.color = 'rgba(0, 0, 0, 0.85)';
    text.style.textShadow = '0 1px 2px rgba(255, 255, 255, 0.4)';
    // 为亮色背景调整图标圆圈样式
    icon.style.backgroundColor = 'rgba(0, 0, 0, 0.03)'; // 从0.04降低到0.03，增加透明度
    icon.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.06), inset 0 1px 1px rgba(255, 255, 255, 0.08)'; // 减轻阴影
  }
  
  // 添加到页面
  document.body.appendChild(gestureHint);
  
  // 重置淡出定时器
  if (gestureHint.fadeOutTimer) {
    clearTimeout(gestureHint.fadeOutTimer);
  }
  
  // 使用requestAnimationFrame在下一帧渲染前设置不透明度，确保过渡效果生效
  requestAnimationFrame(() => {
    // 检查元素是否仍然存在于DOM中
    if (gestureHint && document.body.contains(gestureHint)) {
      gestureHint.style.opacity = '1';
      gestureHint.style.transform = 'translateX(-50%) translateY(0)';
      
      // 等DOM更新后再添加子元素动画
      requestAnimationFrame(() => {
        // 再次检查所有元素是否仍然存在
        if (gestureHint && document.body.contains(gestureHint) && 
            icon && text) {
          icon.style.transform = 'scale(1)';
          text.style.opacity = '1';
          text.style.transform = 'translateY(0)';
        }
      });
    }
  });
  
  // 设置提示显示时间
  let displayDuration = 800; // 默认显示时间：800毫秒
  
  // 无效手势提示显示时间短一些
  if (isInvalidGesture) {
    displayDuration = 350; // 无效手势提示只显示350毫秒
  }
  
  // 滚动动作提示显示时间长一些
  if (isScrollAction) {
    displayDuration = 1000; // 滚动动作提示显示1000毫秒
  }
  
  // 设置定时器移除提示
  // 保存定时器引用，避免直接操作可能已经不存在的对象
  const timerRef = setTimeout(() => {
    try {
      if (gestureHint && document.body.contains(gestureHint)) {
        // 平滑淡出
        gestureHint.style.opacity = '0';
        gestureHint.style.transform = 'translateX(-50%) translateY(20px)';
        
        // 等待过渡完成后移除元素
        setTimeout(() => {
          try {
    if (gestureHint && document.body.contains(gestureHint)) {
      document.body.removeChild(gestureHint);
      gestureHint = null;
    }
          } catch (e) {
            console.log('移除提示元素错误:', e.message);
            // 确保变量被重置，即使出现错误
            gestureHint = null;
          }
        }, 300); // 与transition duration匹配
      }
    } catch (e) {
      console.log('淡出提示元素错误:', e.message);
      // 如果出现错误，尝试直接移除元素
      try {
        if (gestureHint && document.body.contains(gestureHint)) {
          document.body.removeChild(gestureHint);
        }
      } catch (e2) {
        // 忽略最终错误，但确保重置变量
      }
      gestureHint = null;
    }
  }, displayDuration);
  
  // 只有当元素仍然存在时才设置定时器引用
  if (gestureHint) {
    gestureHint.fadeOutTimer = timerRef;
  }
}

// 判断背景颜色是否为亮色
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

// 执行手势动作
// 获取自定义手势动作
function getCustomGestureAction(gesture) {
  // 手势到设置的映射
  const gestureToSetting = {
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
  
  const settingKey = gestureToSetting[gesture];
  if (!settingKey) return null;
  
  // 从设置中获取自定义动作
  return settings[settingKey] || null;
}

function executeGestureAction(gesture) {
  if (!isExtensionValid) return;
  
  // 获取当前语言
  const currentLang = settings.language || 'zh';
  
  // 获取自定义手势动作
  const customAction = getCustomGestureAction(gesture);
  
  // 如果没有自定义动作或设置为"无操作"，直接返回
  if (!customAction || customAction === 'noAction') {
    return;
  }
  

  // 定义一个函数来统一处理动作执行完后的手势重置
  const resetGestureAfterAction = (isInstantReset = false) => {
    // 对于滚动动作，我们立即重置以防止无效手势提示
    // 对于其他动作，由handleMouseUp函数处理重置，这里不额外处理
    if (isInstantReset) {
      // 立即重置手势状态，防止鼠标微小移动触发额外的无效手势提示
      isGestureInProgress = false;
      lastGestureEndTime = Date.now();
      clearGestureCanvas(); // 清除手势画布
      resetGestureState();
      
      // 在YouTube网站上，额外确保右键状态被重置
      const isYouTube = window.location.hostname.includes('youtube.com');
      if (isYouTube) {
        isRightMouseDown = false;
      }
    }
  };
  
  // 执行自定义手势动作
  executeCustomGestureAction(customAction, gesture, resetGestureAfterAction);
}

// 执行自定义手势动作
function executeCustomGestureAction(action, gesture, resetGestureAfterAction) {
  switch (action) {
    case 'scrollUp': {
      const isYouTube = window.location.hostname.includes('youtube.com');
      let upScrollDistance, upScrollPercentage;
      // 统一所有网站为一屏的92%
      let el = isYouTube ? (getYouTubeMainScrollable() || document.documentElement) : (findScrollableContainer() || document.documentElement);
      const screen = el.clientHeight;
      const scrollDistance = Math.round(screen * 0.92); // 滚动92%的屏幕高度
      const target = Math.max(0, el.scrollTop - scrollDistance);
      if (Math.abs(el.scrollTop - target) < 2) break;
      if (settings.enableSmoothScroll) {
        if ('scrollBehavior' in document.documentElement.style) {
          el.scrollTo({ top: target, behavior: 'smooth' });
        } else {
          performCustomEasingScrollTo(el, target, 150, 'ease-out', false);
        }
      } else {
        el.scrollTop = target;
      }
      upScrollDistance = scrollDistance;
      upScrollPercentage = 92;
      showGestureHint(`${getGestureTranslations().scrollUp} (${upScrollDistance}px, ${upScrollPercentage}%)`);
      resetGestureAfterAction(true);
      break;
    }
    case 'scrollDown': {
      const isYouTube = window.location.hostname.includes('youtube.com');
      let downScrollDistance, downScrollPercentage;
      // 统一所有网站为一屏的92%
      let el = isYouTube ? (getYouTubeMainScrollable() || document.documentElement) : (findScrollableContainer() || document.documentElement);
      const screen = el.clientHeight;
      const scrollDistance = Math.round(screen * 0.92); // 滚动92%的屏幕高度
      const maxScroll = el.scrollHeight - el.clientHeight;
      const target = Math.min(maxScroll, el.scrollTop + scrollDistance);
      if (Math.abs(el.scrollTop - target) < 2) break;
      if (settings.enableSmoothScroll) {
        if ('scrollBehavior' in document.documentElement.style) {
          el.scrollTo({ top: target, behavior: 'smooth' });
        } else {
          performCustomEasingScrollTo(el, target, 150, 'ease-out', false);
        }
      } else {
        el.scrollTop = target;
      }
      downScrollDistance = scrollDistance;
      downScrollPercentage = 92;
      showGestureHint(`${getGestureTranslations().scrollDown} (${downScrollDistance}px, ${downScrollPercentage}%)`);
      resetGestureAfterAction(true);
      break;
    }
    case 'scrollToTop': {
      const isYouTube = window.location.hostname.includes('youtube.com');
      if (isYouTube) {
        const el = getYouTubeMainScrollable() || document.documentElement;
        const target = 0;
        if (Math.abs(el.scrollTop - target) < 2) break;
        if (settings.enableSmoothScroll) {
          if ('scrollBehavior' in document.documentElement.style) {
            el.scrollTo({ top: target, behavior: 'smooth' });
          } else {
            performCustomEasingScrollTo(el, target, 150, 'ease-out', false);
          }
        } else {
          el.scrollTop = target;
        }
      } else {
        safeSendMessage({ action: 'scrollToTop' });
      }
      showGestureHint(getGestureTranslations().scrollToTop);
      resetGestureAfterAction(true);
      break;
    }
    case 'scrollToBottom': {
      const isYouTube = window.location.hostname.includes('youtube.com');
      if (isYouTube) {
        const el = getYouTubeMainScrollable() || document.documentElement;
        const target = el.scrollHeight;
        if (Math.abs(el.scrollTop - target) < 2) break;
        if (settings.enableSmoothScroll) {
          if ('scrollBehavior' in document.documentElement.style) {
            el.scrollTo({ top: target, behavior: 'smooth' });
          } else {
            performCustomEasingScrollTo(el, target, 150, 'ease-out', false);
          }
        } else {
          el.scrollTop = target;
        }
      } else {
        safeSendMessage({ action: 'scrollToBottom' });
      }
      showGestureHint(getGestureTranslations().scrollToBottom);
      resetGestureAfterAction(true);
      break;
    }
    case 'newWindow':
      // 新窗口
      safeSendMessage({ action: 'newWindow' });
      showGestureHint(getGestureTranslations().newWindow);
      resetGestureAfterAction();
      break;
    case 'newInPrivateWindow':
      // 新建隐私窗口
      safeSendMessage({ action: 'newInPrivateWindow' });
      showGestureHint(getGestureTranslations().newInPrivateWindow);
      resetGestureAfterAction();
      break;
    case 'goBack':
      safeSendMessage({ action: 'goBack' });
      showGestureHint(getGestureTranslations().back);
      resetGestureAfterAction();
      break;
    case 'forward':
      safeSendMessage({ action: 'goForward' });
      showGestureHint(getGestureTranslations().forward);
      resetGestureAfterAction();
      break;
    case 'scrollLeft': {
      const isYouTube = window.location.hostname.includes('youtube.com');
      let leftScrollDistance, leftScrollPercentage;
      // 统一所有网站为一屏宽的92%
      let el = isYouTube ? (getYouTubeMainScrollable() || document.documentElement) : (findScrollableContainer() || document.documentElement);
      const screen = el.clientWidth;
      const scrollDistance = Math.round(screen * 0.92); // 滚动92%的屏幕宽度
      const target = Math.max(0, el.scrollLeft - scrollDistance);
      if (Math.abs(el.scrollLeft - target) < 2) break;
      if (settings.enableSmoothScroll) {
        if ('scrollBehavior' in document.documentElement.style) {
          el.scrollTo({ left: target, behavior: 'smooth' });
        } else {
          performCustomEasingScrollTo(el, target, 150, 'ease-out', true);
        }
      } else {
        el.scrollLeft = target;
      }
      leftScrollDistance = scrollDistance;
      leftScrollPercentage = 92;
      showGestureHint(`${getGestureTranslations().scrollLeft} (${leftScrollDistance}px, ${leftScrollPercentage}%)`);
      resetGestureAfterAction(true);
      break;
    }
    case 'scrollRight': {
      const isYouTube = window.location.hostname.includes('youtube.com');
      let rightScrollDistance, rightScrollPercentage;
      // 统一所有网站为一屏宽的92%
      let el = isYouTube ? (getYouTubeMainScrollable() || document.documentElement) : (findScrollableContainer() || document.documentElement);
      const screen = el.clientWidth;
      const scrollDistance = Math.round(screen * 0.92); // 滚动92%的屏幕宽度
      const maxScroll = el.scrollWidth - el.clientWidth;
      const target = Math.min(maxScroll, el.scrollLeft + scrollDistance);
      if (Math.abs(el.scrollLeft - target) < 2) break;
      if (settings.enableSmoothScroll) {
        if ('scrollBehavior' in document.documentElement.style) {
          el.scrollTo({ left: target, behavior: 'smooth' });
        } else {
          performCustomEasingScrollTo(el, target, 150, 'ease-out', true);
        }
      } else {
        el.scrollLeft = target;
      }
      rightScrollDistance = scrollDistance;
      rightScrollPercentage = 92;
      showGestureHint(`${getGestureTranslations().scrollRight} (${rightScrollDistance}px, ${rightScrollPercentage}%)`);
      resetGestureAfterAction(true);
      break;
    }
    case 'forceRefresh':
      safeSendMessage({ action: 'forceRefresh' });
      showGestureHint(getGestureTranslations().forceRefresh);
      resetGestureAfterAction();
      break;
    case 'closeTab':
      safeSendMessage({ action: 'closeTab' });
      showGestureHint(getGestureTranslations().closeTab);
      resetGestureAfterAction();
      break;
    case 'reopenClosedTab':
      safeSendMessage({ action: 'reopenClosedTab' });
      showGestureHint(getGestureTranslations().reopenTab);
      resetGestureAfterAction();
      break;
    case 'openNewTab':
      safeSendMessage({ action: 'openNewTab' });
      showGestureHint(getGestureTranslations().newTab);
      resetGestureAfterAction();
      break;
    case 'refresh':
      safeSendMessage({ action: 'refresh' });
      showGestureHint(getGestureTranslations().refresh);
      resetGestureAfterAction();
      break;
    case 'switchToLeftTab':
      safeSendMessage({ action: 'switchToLeftTab' });
      showGestureHint(getGestureTranslations().prevTab);
      resetGestureAfterAction();
      break;
    case 'switchToRightTab':
      safeSendMessage({ action: 'switchToRightTab' });
      showGestureHint(getGestureTranslations().nextTab);
      resetGestureAfterAction();
      break;
    case 'stopLoading':
      safeSendMessage({ action: 'stopLoading' });
      showGestureHint(getGestureTranslations().stopLoading);
      resetGestureAfterAction();
      break;
    case 'closeAllTabs':
      safeSendMessage({ action: 'closeAllTabs' });
      showGestureHint(getGestureTranslations().closeAllTabs);
      resetGestureAfterAction();
      break;
    case 'closeOtherTabs':
      safeSendMessage({ action: 'closeOtherTabs' });
      showGestureHint(getGestureTranslations().closeOtherTabs);
      resetGestureAfterAction();
      break;
    case 'closeTabsToRight':
      safeSendMessage({ action: 'closeTabsToRight' });
      showGestureHint(getGestureTranslations().closeTabsToRight);
      resetGestureAfterAction();
      break;
    case 'toggleFullscreen':
      safeSendMessage({ action: 'toggleFullscreen' });
      showGestureHint(getGestureTranslations().toggleFullscreen);
      resetGestureAfterAction();
      break;
    case 'closeTabsToLeft':
      safeSendMessage({ action: 'closeTabsToLeft' });
      showGestureHint(getGestureTranslations().closeTabsToLeft);
      resetGestureAfterAction();
      break;
    case 'reloadAllTabs':
      safeSendMessage({ action: 'reloadAllTabs' });
      showGestureHint(getGestureTranslations().reloadAllTabs);
      resetGestureAfterAction();
      break;
    case 'togglePinTab':
      safeSendMessage({ action: 'togglePinTab' });
      showGestureHint(getGestureTranslations().togglePinTab);
      resetGestureAfterAction();
      break;
    case 'toggleMuteTab':
      safeSendMessage({ action: 'toggleMuteTab' });
      showGestureHint(getGestureTranslations().toggleMuteTab);
      resetGestureAfterAction();
      break;
    case 'muteOtherTabs':
      safeSendMessage({ action: 'muteOtherTabs' });
      showGestureHint(getGestureTranslations().muteOtherTabs);
      resetGestureAfterAction();
      break;
    case 'toggleMaximize':
      safeSendMessage({ action: 'toggleMaximize' });
      showGestureHint(getGestureTranslations().toggleMaximize);
      resetGestureAfterAction();
      break;
    case 'minimizeWindow':
      safeSendMessage({ action: 'minimizeWindow' });
      showGestureHint(getGestureTranslations().minimizeWindow);
      resetGestureAfterAction();
      break;
    case 'scrollToLeft':
      if (settings.enableSmoothScroll) {
        window.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        window.scrollTo(0, window.scrollY);
      }
      showGestureHint(getGestureTranslations().scrollToLeft);
      resetGestureAfterAction(true); // 强制立即重置
      break;
    case 'scrollToRight':
      if (settings.enableSmoothScroll) {
        window.scrollTo({ left: document.body.scrollWidth, behavior: 'smooth' });
      } else {
        window.scrollTo(document.body.scrollWidth, window.scrollY);
      }
      showGestureHint(getGestureTranslations().scrollToRight);
      resetGestureAfterAction(true); // 强制立即重置
      break;
    default:
      // 未知动作，不执行任何操作
      break;
  }
}

// 鼠标按下事件处理
function handleMouseDown(e) {
  try {
    // 保存鼠标按下位置（无论是左键还是右键）
    mouseDownPosition = { x: e.clientX, y: e.clientY };
    mouseCurrentPosition = { x: e.clientX, y: e.clientY };
    
    // 处理左键按下时可能是拖拽操作的情况
    if (e.button === 0) { // 左键
      // 检查是否点击在链接上
      let linkElement = e.target;
      while (linkElement && linkElement.tagName !== 'A' && linkElement !== document.body) {
        linkElement = linkElement.parentElement;
      }
      
      // 如果是链接元素且超级拖拽功能已启用，且当前网站未在禁用列表，记录为潜在拖拽链接
      // 但不阻止默认行为，这样拖拽可以正常开始
      if (linkElement && linkElement.tagName === 'A' && linkElement.href && 
          isExtensionValid && settings.enableSuperDrag && !isSiteInDisabledList(window.location.href)) {
        
        potentialDragLink = linkElement;
        
        // 不再阻止默认行为和设置延迟点击计时器
        // 删除了相关代码，允许正常的拖放操作开始
      }
    }
    
    // 以下是原有的右键按下逻辑
    // 只处理右键
    // 在Mac系统上按Ctrl+左键也被当作右键点击（模拟右键点击）
    const isMacRightClick = isMacOS && e.button === 0 && e.ctrlKey;
    if (e.button !== 2 && !isMacRightClick) return;
    
    // 检查扩展是否有效
    if (!isExtensionValid) {
      checkExtensionValidity();
      return;
    }
    
    // 检查鼠标手势功能是否启用
    if (!settings || !settings.enableGesture) {
      return;
    }
    
    // 检查当前网站是否在禁用列表
    if (isSiteInDisabledList(window.location.href)) {
      return;
    }
    
    // 记录右键按下状态
    isRightMouseDown = true;
    
    // 记录起始点，但还不启动手势
    gestureStartX = e.clientX;
    gestureStartY = e.clientY;
    gesturePoints = [{ x: e.clientX, y: e.clientY }];
  } catch (e) {
    console.log('处理鼠标按下事件失败:', e.message);
    isRightMouseDown = false;
  }
}

// 鼠标移动事件处理
function handleMouseMove(e) {
  try {
    // 更新当前鼠标位置
    mouseCurrentPosition = { x: e.clientX, y: e.clientY };
    
    // 如果有潜在的拖拽链接，检查是否移动距离足够判定为拖拽
    if (potentialDragLink) {
      const dx = mouseCurrentPosition.x - mouseDownPosition.x;
      const dy = mouseCurrentPosition.y - mouseDownPosition.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // 如果移动距离超过阈值，认为是拖拽操作，取消点击计时器
      if (distance >= dragDistanceThreshold) {
        if (linkClickPending) {
          clearTimeout(linkClickPending);
          linkClickPending = null;
        }
      }
    }
    
    // 以下是原有的右键手势逻辑
    // 如果右键没有按下，不处理
    if (!isRightMouseDown) return;
    
    // 检查扩展是否有效
    if (!isExtensionValid) {
      checkExtensionValidity();
      return;
    }
    
    // 检查鼠标手势功能是否启用
    if (!settings || !settings.enableGesture) {
      return;
    }
    
    // 获取鼠标相对于视口的位置
    const viewportX = e.clientX;
    const viewportY = e.clientY;
    
    // 计算移动距离
    const dx = viewportX - gestureStartX;
    const dy = viewportY - gestureStartY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 如果移动距离超过阈值，开始手势
    if (!isGestureInProgress && distance >= minMovementToStartGesture) {
      isGestureInProgress = true;
      initGestureCanvas();
    }
    
    if (isGestureInProgress) {
      // 绘制手势轨迹
      drawGesture(viewportX, viewportY);
      
      // 动态识别手势并显示提示
      const currentGesture = recognizeGesture();
      if (currentGesture) {
        // 将手势映射到动作键
        let actionKey = '';
        let actionText = ''; // 用于存储完整的提示文本，包括距离和百分比
        
        switch (currentGesture) {
          case 'left':
            actionKey = 'back';
            break;
          case 'right':
            actionKey = 'forward';
            break;
          case 'up':
            actionKey = 'scrollUp';
            break;
          case 'down':
            actionKey = 'scrollDown';
            break;
          case 'down then right':
            actionKey = 'closeTab';
            break;
          case 'left then up':
            actionKey = 'reopenTab';
            break;
          case 'right then up':
            actionKey = 'newTab';
            break;
          case 'right then down':
            actionKey = 'refresh';
            break;
          case 'up then left':
            actionKey = 'prevTab';
            break;
          case 'up then right':
            actionKey = 'nextTab';
            break;
          case 'down then left':
            actionKey = 'stopLoading';
            break;
          case 'left then down':
            actionKey = 'forceRefresh';
            break;
          case 'up then down':
            actionKey = 'scrollToBottom';
            break;
          case 'down then up':
            actionKey = 'scrollToTop';
            break;
          case 'left then right':
            actionKey = 'closeTab';
            break;
          case 'right then left':
            actionKey = 'reopenTab';
            break;
          case 'right then right':
            actionKey = 'nextPage';
            break;
          case 'scrollLeft':
            actionKey = 'scrollLeft';
            break;
          case 'scrollRight':
            actionKey = 'scrollRight';
            break;
          case 'forceRefresh':
            actionKey = 'forceRefresh';
            break;
        }
        
        // 如果找到了匹配的手势，获取用户设置的自定义动作并显示相应的提示
        if (actionKey) {
          // 获取用户设置的自定义动作
          const customAction = getCustomGestureAction(currentGesture);
          
          // 如果没有自定义动作或设置为"无操作"，不显示提示
          if (!customAction || customAction === 'noAction') {
            return;
          }
          
          // 根据自定义动作生成提示文本
          let actionText = '';
          
          switch (customAction) {
            case 'newWindow':
              actionText = getGestureTranslations().newWindow;
              break;
            case 'newInPrivateWindow':
              actionText = getGestureTranslations().newInPrivateWindow;
              break;
            case 'goBack':
              actionText = getGestureTranslations().back;
              break;
            case 'forward':
              actionText = getGestureTranslations().forward;
              break;
            case 'scrollUp':
              // 对于滚动动作，计算距离并显示详细信息，同时进行预处理
              if (gesturePoints.length >= 2) {
                const startPoint = gesturePoints[0];
                const endPoint = gesturePoints[gesturePoints.length - 1];
                const verticalDistance = Math.abs(endPoint.y - startPoint.y);
                const scrollDistance = Math.max(50, Math.min(verticalDistance, window.innerHeight * 0.92));
                const scrollPercentage = Math.round((scrollDistance / window.innerHeight) * 100);
                actionText = `${getGestureTranslations().scrollUp} (${Math.round(scrollDistance)}px, ${scrollPercentage}%)`;
              } else {
                actionText = getGestureTranslations().scrollUp;
              }
              break;
            case 'scrollDown':
              // 对于滚动动作，计算距离并显示详细信息，同时进行预处理
              if (gesturePoints.length >= 2) {
                const startPoint = gesturePoints[0];
                const endPoint = gesturePoints[gesturePoints.length - 1];
                const verticalDistance = Math.abs(endPoint.y - startPoint.y);
                const scrollDistance = Math.max(50, Math.min(verticalDistance, window.innerHeight * 0.92));
                const scrollPercentage = Math.round((scrollDistance / window.innerHeight) * 100);
                actionText = `${getGestureTranslations().scrollDown} (${Math.round(scrollDistance)}px, ${scrollPercentage}%)`;
              } else {
                actionText = getGestureTranslations().scrollDown;
              }
              break;
            case 'scrollLeft':
              // 对于水平滚动动作，计算距离并显示详细信息，同时进行预处理
              if (gesturePoints.length >= 2) {
                const startPoint = gesturePoints[0];
                const endPoint = gesturePoints[gesturePoints.length - 1];
                const horizontalDistance = Math.abs(endPoint.x - startPoint.x);
                const scrollDistance = Math.max(50, Math.min(horizontalDistance, window.innerWidth * 0.92));
                const scrollPercentage = Math.round((scrollDistance / window.innerWidth) * 100);
                actionText = `${getGestureTranslations().scrollLeft} (${Math.round(scrollDistance)}px, ${scrollPercentage}%)`;
              } else {
                actionText = getGestureTranslations().scrollLeft;
              }
              break;
            case 'scrollRight':
              // 对于水平滚动动作，计算距离并显示详细信息，同时进行预处理
              if (gesturePoints.length >= 2) {
                const startPoint = gesturePoints[0];
                const endPoint = gesturePoints[gesturePoints.length - 1];
                const horizontalDistance = Math.abs(endPoint.x - startPoint.x);
                const scrollDistance = Math.max(50, Math.min(horizontalDistance, window.innerWidth * 0.92));
                const scrollPercentage = Math.round((scrollDistance / window.innerWidth) * 100);
                actionText = `${getGestureTranslations().scrollRight} (${Math.round(scrollDistance)}px, ${scrollPercentage}%)`;
              } else {
                actionText = getGestureTranslations().scrollRight;
              }
              break;
            case 'closeTab':
              actionText = getGestureTranslations().closeTab;
              break;
            case 'reopenClosedTab':
              actionText = getGestureTranslations().reopenTab;
              break;
            case 'openNewTab':
              actionText = getGestureTranslations().newTab;
              break;
            case 'refresh':
              actionText = getGestureTranslations().refresh;
              break;
            case 'forceRefresh':
              actionText = getGestureTranslations().forceRefresh;
              break;
            case 'switchToLeftTab':
              actionText = getGestureTranslations().prevTab;
              break;
            case 'switchToRightTab':
              actionText = getGestureTranslations().nextTab;
              break;
            case 'stopLoading':
              actionText = getGestureTranslations().stopLoading;
              break;
            case 'closeAllTabs':
              actionText = getGestureTranslations().closeAllTabs;
              break;
            case 'scrollToBottom':
              actionText = getGestureTranslations().scrollToBottom;
              break;
            case 'scrollToTop':
              actionText = getGestureTranslations().scrollToTop;
              break;
            case 'closeOtherTabs':
              actionText = getGestureTranslations().closeOtherTabs;
              break;
            case 'closeTabsToRight':
              actionText = getGestureTranslations().closeTabsToRight;
              break;
            case 'closeTabsToLeft':
              actionText = getGestureTranslations().closeTabsToLeft;
              break;
            case 'reloadAllTabs':
              actionText = getGestureTranslations().reloadAllTabs;
              break;
            case 'togglePinTab':
              actionText = getGestureTranslations().togglePinTab;
              break;
            case 'toggleMuteTab':
              actionText = getGestureTranslations().toggleMuteTab;
              break;
            case 'muteOtherTabs':
              actionText = getGestureTranslations().muteOtherTabs;
              break;
            case 'toggleMaximize':
              actionText = getGestureTranslations().toggleMaximize;
              break;
            case 'minimizeWindow':
              actionText = getGestureTranslations().minimizeWindow;
              break;
            case 'toggleFullscreen':
              actionText = getGestureTranslations().toggleFullscreen;
              break;
            case 'scrollToLeft':
              actionText = getGestureTranslations().scrollToLeft;
              break;
            case 'scrollToRight':
              actionText = getGestureTranslations().scrollToRight;
              break;
            default:
              // 如果没有特定的actionText（非滚动动作），使用普通翻译
              if (!actionText) {
                actionText = getGestureTranslations()[actionKey];
              }
          }
          
          // 只有当动作改变时才显示新提示
          if (actionText && actionText !== lastHintAction) {
            showGestureHint(actionText);
          }
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
        if (totalDistance >= minGestureDistance * 1.5 && isGestureInProgress) {
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
    }
  } catch (e) {
    console.log('处理鼠标移动事件失败:', e.message);
    isGestureInProgress = false;
    clearGestureCanvas();
  }
}

// 鼠标释放事件处理
function handleMouseUp(e) {
  try {
    // 清理拖拽相关状态
    if (potentialDragLink) {
      // 如果距离小，且链接点击延迟计时器还存在，则不做额外处理
      // 让计时器自然执行链接点击
      const dx = mouseCurrentPosition.x - mouseDownPosition.x;
      const dy = mouseCurrentPosition.y - mouseDownPosition.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      // 如果移动距离超过阈值，认为是拖拽而非点击，清除计时器
      if (distance >= dragDistanceThreshold && linkClickPending) {
        clearTimeout(linkClickPending);
        linkClickPending = null;
      }
      
      // 短距离移动不处理，让默认点击行为发生
    }
    
    // 在鼠标释放时，重置潜在拖拽链接
    potentialDragLink = null;
    
    // 在Mac系统上，Ctrl+左键被当作右键，所以需要对其进行特殊处理
    const isMacRightClick = isMacOS && e.button === 0 && e.ctrlKey;
    
    // 只处理右键释放
    // 注意：在某些情况下，e.button可能是undefined，所以需要特殊处理
    if (e.button !== 2 && e.button !== undefined && !isMacRightClick) return;
    
    isRightMouseDown = false;
    
    // 检查鼠标手势功能是否启用
    if (!settings || !settings.enableGesture) {
      return;
    }
    
    // 检查是否是纯粹的点击（几乎没有移动鼠标）
    if ((isMacOS || isLinuxOS) && !isGestureInProgress) {
      // 如果鼠标几乎没有移动（距离小于阈值），并且不是在手势模式下
      if (gesturePoints.length <= 1 || 
          (gesturePoints.length === 2 && 
           Math.abs(gesturePoints[0].x - gesturePoints[1].x) < 5 && 
           Math.abs(gesturePoints[0].y - gesturePoints[1].y) < 5)) {
        
        // 记录手势结束时间，用于后续双击检测
        lastGestureEndTime = Date.now();
        
        // 单击右键，不执行任何手势操作，保留时间戳用于双击检测
        resetGestureState();
        return;
      }
    }
    
    // 如果不是手势，则清除状态
    if (!isGestureInProgress) {
      resetGestureState();
      return;
    }
    
    // 设置手势完成标记
    isGestureInProgress = false;
    
    // 记录手势结束时间
    lastGestureEndTime = Date.now();
    
    // 最后一次识别手势结果
    const finalGesture = recognizeGesture();
    lastHintAction = ''; // 清除提示操作
    clearGestureCanvas(); // 清除手势绘制
    
    // 执行手势操作
    if (finalGesture) {
      executeGestureAction(finalGesture);
    } else {
      // 重置手势状态
      resetGestureState();
    }
  } catch (e) {
    console.log('处理鼠标释放事件失败:', e.message);
    isGestureInProgress = false;
    resetGestureState();
    clearGestureCanvas();
  }
}

// 超级拖拽功能 - 处理拖拽开始
function handleDragStart(e) {
  // 首先检查扩展是否有效和超级拖拽功能是否启用
  if (!isExtensionValid || !settings.enableSuperDrag) return;
  
  // 检查当前网站是否在禁用列表
  if (isSiteInDisabledList(window.location.href)) return;
  
  // 如果有正在等待的链接点击，立即取消它
  // 因为拖拽事件已经开始，说明用户的意图是拖拽而非点击
  if (linkClickPending) {
    clearTimeout(linkClickPending);
    linkClickPending = null;
  }
  
  // 初始化拖拽操作信息
  dragInfo = {
    startX: e.clientX,
    startY: e.clientY,
    target: e.target,
    type: '',
    url: '',
    text: '',
    image: '',
    direction: '',
    time: Date.now(),
    savedSelection: null
  };
  
  // 检查是否已选中文本，优先处理选中文本
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();
  
  // 如果有选中文本，则优先使用文本拖拽，无论是否在链接上
  if (selectedText) {
    dragInfo.type = 'text';
    dragInfo.text = selectedText;
    
    // 保存用户选择，防止Linux和macOS上拖拽时失去焦点
    if (isLinuxOS || isMacOS) {
      // 由于Linux和macOS系统在拖拽时通常会清除文本选择，这里保存选择状态
      dragInfo.savedSelection = selectedText;
    }
    
    // 检查选中的文本是否为链接
    if (isValidUrl(selectedText)) {
      // 作为链接处理
      let url = selectedText;
      // 如果不以协议开头，添加https://
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('ftp://')) {
        url = 'https://' + url;
      }
      
      dragInfo.type = 'link';
      dragInfo.url = url;
      dragInfo.text = selectedText;
    }
    
    e.dataTransfer.setData('text/plain', selectedText);
    
    // 开始监听拖拽移动事件
    document.addEventListener('dragover', handleDragMove, { capture: true, passive: true });
    return;
  }
  
  // 检查拖拽目标是否为图片
  if (e.target.tagName === 'IMG') {
    // 如果是从图片开始拖拽
    dragInfo.type = 'image';
    dragInfo.url = e.target.src;
    if (e.target.alt) {
      dragInfo.text = e.target.alt;
    }
    
    e.dataTransfer.setData('text/plain', e.target.src);
    
    // 开始监听拖拽移动事件
    document.addEventListener('dragover', handleDragMove, { capture: true, passive: true });
    return;
  }
  
  // 检查拖拽目标是否为链接或位于链接内
  let linkElement = e.target;
  while (linkElement && linkElement.tagName !== 'A' && linkElement !== document.body) {
    linkElement = linkElement.parentElement;
  }
  
  // 如果是潜在的拖拽链接，优先使用它
  if (potentialDragLink && potentialDragLink.href) {
    linkElement = potentialDragLink;
    potentialDragLink = null; // 清除潜在拖拽链接，避免干扰后续操作
  }
  
  if (linkElement && linkElement.tagName === 'A' && linkElement.href) {
    // 拖拽开始于链接元素
    dragInfo.type = 'link';
    dragInfo.url = linkElement.href;
    
    // 如果链接有文本内容，也保存下来
    dragInfo.text = linkElement.textContent.trim() || linkElement.href;
    
    e.dataTransfer.setData('text/plain', linkElement.href);
    
    // 开始监听拖拽移动事件
    document.addEventListener('dragover', handleDragMove, { capture: true, passive: true });
    return;
  }
  
  // 如果不是链接、图片或选中文本，则检查是否为可拖拽的纯文本
  let elementText = '';
  
  // 尝试获取元素的文本内容
  if (e.target.textContent) {
    elementText = e.target.textContent.trim();
  }
  
  // 如果有文本内容，设置为文本拖拽
  if (elementText) {
    dragInfo.type = 'text';
    dragInfo.text = elementText;
    
    e.dataTransfer.setData('text/plain', elementText);
    
    // 开始监听拖拽移动事件
    document.addEventListener('dragover', handleDragMove, { capture: true, passive: true });
    return;
  }
  
  // 如果没有任何有效内容，重置拖拽信息
  resetDragInfo();
}

// 拖拽移动时计算方向，但不执行操作
function handleDragMove(moveEvent) {
  // 计算拖拽方向
  const dx = moveEvent.clientX - dragInfo.startX;
  const dy = moveEvent.clientY - dragInfo.startY;
  
  // 确定主要拖拽方向
  if (Math.abs(dx) > Math.abs(dy)) {
    // 水平方向为主
    dragInfo.direction = dx > 0 ? 'right' : 'left';
  } else {
    // 垂直方向为主
    dragInfo.direction = dy > 0 ? 'down' : 'up';
  }
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
  // 移除事件监听
  document.removeEventListener('dragover', handleDragMove, { capture: true, passive: true });
  
  // 检查是否有有效的拖拽方向和内容
  if (!dragInfo.direction) {
    resetDragInfo();
    return;
  }
  
  // 检查拖拽是否从文本输入框开始
  if (dragInfo.target && isTextInputElement(dragInfo.target)) {
    // 如果拖拽开始于文本输入框，不执行任何超级拖拽操作
    resetDragInfo();
    return;
  }
  
  // 检查拖拽释放的目标是否为文本输入框
  try {
    // 获取当前光标位置下的元素及其父元素
    const elementUnderCursor = document.elementFromPoint(e.clientX, e.clientY);
    if (elementUnderCursor) {
      // 检查元素本身或其父元素是否为文本输入元素
      let currentElement = elementUnderCursor;
      const maxDepth = 5; // 限制向上查找的层数，避免过度递归
      let depth = 0;
      
      while (currentElement && depth < maxDepth) {
        if (isTextInputElement(currentElement)) {
          // 如果拖拽释放到文本输入框上，不执行搜索操作，允许默认的文本拖放行为
          console.log('拖拽释放到文本框，不触发搜索');
          resetDragInfo();
          return;
        }
        currentElement = currentElement.parentElement;
        depth++;
      }
    }
  } catch (error) {
    // 错误处理，继续执行原有逻辑
    console.log('检查拖拽释放目标时出错:', error.message);
  }
  
  // 对于Linux和macOS系统，如果文本焦点丢失，使用之前保存的文本
  if ((isLinuxOS || isMacOS) && dragInfo.savedSelection && dragInfo.type === 'text') {
    // 使用之前保存的文本，不需要重新获取选择内容
    console.log('使用保存的选中文本:', dragInfo.text);
  } else if (!(dragInfo.url || dragInfo.text)) {
    resetDragInfo();
    return;
  }
  
  // 获取当前拖拽方向的操作设置
  let actionType = 'none';
  switch (dragInfo.direction) {
    case 'up':
      actionType = settings.dragUpAction || 'background';
      break;
    case 'right':
      actionType = settings.dragRightAction || 'background';
      break;
    case 'down':
      actionType = settings.dragDownAction || 'background';
      break;
    case 'left':
      actionType = settings.dragLeftAction || 'background';
      break;
  }
  
  // 如果操作类型为'none'，不执行任何操作
  if (actionType === 'none') {
    console.log(`拖拽方向 ${dragInfo.direction} 设置为不执行操作`);
    resetDragInfo();
    return;
  }

  // 开关开启时：拖拽图片或可下载文件链接则自动下载
  if (settings.autoDownloadOnDragFile && dragInfo.url &&
      (dragInfo.type === 'image' || (dragInfo.type === 'link' && isDownloadableFileUrl(dragInfo.url)))) {
    chrome.runtime.sendMessage({ action: 'downloadUrl', url: dragInfo.url }, () => {});
    resetDragInfo();
    return;
  }
  
  // 复制动作：将选中的文本或链接/图片URL复制到剪贴板
  if (actionType === 'copy') {
    let toCopy = '';
    if (dragInfo.type === 'link' || dragInfo.type === 'image') toCopy = dragInfo.url || '';
    else if (dragInfo.type === 'text') toCopy = dragInfo.text || '';
    if (toCopy) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(toCopy).then(() => {
          showGestureHint(getI18nMessage('copiedToClipboard', 'Copied to clipboard'));
        }).catch(() => {});
      } else {
        try {
          const ta = document.createElement('textarea');
          ta.value = toCopy;
          ta.style.cssText = 'position:fixed;left:-9999px;';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          showGestureHint(getI18nMessage('copiedToClipboard', 'Copied to clipboard'));
        } catch (e) {}
      }
    }
    resetDragInfo();
    return;
  }
  
  // 分屏方向选项：splitLeft / splitRight / splitUp / splitDown
  const isSplitView = ['splitLeft', 'splitRight', 'splitUp', 'splitDown'].includes(actionType);

  // 根据类型和设置的操作类型决定打开方式
  switch (dragInfo.type) {
    case 'link':
      if (isSplitView) {
        // 分屏视图（四向）：通过后台脚本在新的浏览器窗口中分屏打开链接
        chrome.runtime.sendMessage({
          action: 'superDrag',
          type: 'link',
          url: dragInfo.url,
          actionType: actionType
        });
      } else if (actionType === 'foreground') {
        // 前台打开链接
        window.open(dragInfo.url, '_blank', 'noopener');
      } else if (actionType === 'background') {
        // 后台打开链接
        chrome.runtime.sendMessage({
          action: 'openTabInBackground',
          url: dragInfo.url
        });
      }
      break;
    
    case 'image':
      if (isSplitView) {
        // 分屏视图（四向）：通过后台脚本在新的浏览器窗口中分屏打开图片
        chrome.runtime.sendMessage({
          action: 'superDrag',
          type: 'image',
          url: dragInfo.url,
          actionType: actionType
        });
      } else if (actionType === 'foreground') {
        // 前台打开图片
        window.open(dragInfo.url, '_blank', 'noopener');
      } else if (actionType === 'background') {
        // 后台打开图片
        chrome.runtime.sendMessage({
          action: 'openTabInBackground',
          url: dragInfo.url
        });
      }
      break;
    
    case 'text':
      // 检查是否启用了拖拽文本搜索功能
      if (settings.enableDragTextSearch) {
        // 发送消息到background.js使用浏览器默认搜索引擎搜索文本
        chrome.runtime.sendMessage({
          action: 'superDrag',
          type: 'text',
          text: dragInfo.text,
          actionType: actionType
        });
      }
      break;
  }
  
  // 重置拖拽信息
  resetDragInfo();
}

// 处理页面内部的放下事件
function handleDrop(e) {
  // 如果在页面内部放下，不需要特殊处理
}

// 处理拖拽离开页面事件
function handleDragLeave(e) {
  // 不需要特殊处理
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
        if (gestureHint && document.body.contains(gestureHint)) {
          gestureHint.style.backgroundColor = 'rgba(0, 179, 255, 0.3)';
          setTimeout(() => {
            if (gestureHint && document.body.contains(gestureHint)) {
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
function handleContextMenu(e) {
  // 检查鼠标手势功能是否启用
  if (!settings || !settings.enableGesture) {
    return;
  }
  
  // 在macOS和Linux系统上，实现单击右键用于手势，双击右键显示菜单（逻辑反转）
  if ((isMacOS || isLinuxOS) && !isGestureInProgress) {
    // 如果鼠标几乎没有移动（认为是单击而非拖拽）
    if (gesturePoints.length <= 1 || 
        (gesturePoints.length === 2 && 
         Math.abs(gesturePoints[0].x - gesturePoints[1].x) < 5 && 
         Math.abs(gesturePoints[0].y - gesturePoints[1].y) < 5)) {
      
      // 检测是否在短时间内有两次右键点击（双击右键）
      const currentTime = Date.now();
      const timeSinceLastRightClick = currentTime - lastGestureEndTime;
      
      // 如果是双击右键（300ms内的两次点击）
      if (lastGestureEndTime > 0 && timeSinceLastRightClick < 300) {
        // 是双击右键，允许显示浏览器上下文菜单
        
        // 重要：重置所有手势相关状态，防止同时触发手势操作
        isRightMouseDown = false;
        isGestureInProgress = false;
        resetGestureState();
        clearGestureCanvas();
        
        return true;
      } else {
        // 是单击右键，阻止菜单显示，准备进入手势模式
        e.preventDefault();
        
        // 将isRightMouseDown设为true，使下一次鼠标移动可以启动手势
        isRightMouseDown = true;
        
        // 更新起始点，以便于下一次鼠标移动时计算手势
        gestureStartX = e.clientX;
        gestureStartY = e.clientY;
        gesturePoints = [{ x: e.clientX, y: e.clientY }];
        
        return false;
      }
    }
  }
  
  // 如果右键按下或手势进行中，阻止右键菜单
  if (isRightMouseDown || isGestureInProgress) {
    e.preventDefault();
    return false;
  }
  
  // 检查是否是手势释放后的右键菜单事件
  const currentTime = Date.now();
  const isYouTube = window.location.hostname.includes('youtube.com');
  const timeThreshold = isYouTube ? 300 : 200; // YouTube上给更多时间
  
  if (currentTime - lastGestureEndTime < timeThreshold) {
    e.preventDefault();
    return false;
  }
}

// 窗口大小改变时重新调整画布大小
function handleResize() {
  if (gestureCanvas) {
    gestureCanvas.width = window.innerWidth;
    gestureCanvas.height = window.innerHeight;
  }
}

// 添加消息监听器，用于接收设置更新
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (!isExtensionValid) {
      checkExtensionValidity();
      sendResponse({ success: false, error: 'Extension context invalidated' });
      return true;
    }
    
    if (message.action === 'showDuplicateTabsNotification') {
      // 显示重复标签页通知
      showDuplicateTabsNotification(message.data);
      sendResponse({ success: true });
    } else if (message.action === 'scrollUp') {
      // 使用动态距离向上滚动，如果未提供则使用默认值100
      const scrollDistance = message.distance || 100;
      
      // 改进的滚动方法，支持视频网站的特殊滚动容器
      const scrollSuccessful = performScroll(-scrollDistance);
      sendResponse({ success: scrollSuccessful });
    } else if (message.action === 'scrollDown') {
      // 使用动态距离向下滚动，如果未提供则使用默认值100
      const scrollDistance = message.distance || 100;
      
      // 改进的滚动方法，支持视频网站的特殊滚动容器
      const scrollSuccessful = performScroll(scrollDistance);
      sendResponse({ success: scrollSuccessful });
    } else if (message.action === 'scrollLeft') {
      // 使用动态距离向左滚动，如果未提供则使用默认值100
      const scrollDistance = message.distance || 100;
      
      // 水平滚动方法
      const scrollSuccessful = performHorizontalScroll(-scrollDistance);
      sendResponse({ success: scrollSuccessful });
    } else if (message.action === 'scrollRight') {
      // 使用动态距离向右滚动，如果未提供则使用默认值100
      const scrollDistance = message.distance || 100;
      
      // 水平滚动方法
      const scrollSuccessful = performHorizontalScroll(scrollDistance);
      sendResponse({ success: scrollSuccessful });
    } else if (message.action === 'scrollToTop') {
      // 改进的滚动到顶部方法
      scrollToPosition(0);
      sendResponse({ success: true });
    } else if (message.action === 'scrollToBottom') {
      // 改进的滚动到底部方法
      scrollToPosition(document.body.scrollHeight);
      sendResponse({ success: true });
    } else if (message.action === 'scrollToLeft') {
      // 滚动到左侧边缘
      if (settings.enableSmoothScroll) {
        window.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        window.scrollTo(0, window.scrollY);
      }
      sendResponse({ success: true });
    } else if (message.action === 'scrollToRight') {
      // 滚动到右侧边缘
      if (settings.enableSmoothScroll) {
        window.scrollTo({ left: document.body.scrollWidth, behavior: 'smooth' });
      } else {
        window.scrollTo(document.body.scrollWidth, window.scrollY);
      }
      sendResponse({ success: true });
    } else if (message.action === 'settingsUpdated') {
      // 普通设置更新，重新加载设置
      loadSettings();
      sendResponse({ success: true });
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

// 水平滚动函数，支持水平方向的滚动
function performHorizontalScroll(distance) {
  try {
    // 确定滚动方向(正数向右滚，负数向左滚)
    const direction = distance > 0 ? 1 : -1;
    // 获取有效滚动距离(取绝对值后应用)
    const scrollAmount = Math.min(Math.abs(distance), 300) * direction;
    
    // 检查是否启用平滑滚动
    const useSmoothScroll = settings.enableSmoothScroll;
    
    // 检查是否是YouTube网站
    const isYouTube = window.location.hostname.includes('youtube.com');
    if (isYouTube) {
      console.log('在YouTube上执行水平滚动，距离:', scrollAmount, '平滑滚动:', useSmoothScroll);
      
      // 对YouTube使用优化的水平滚动方法，减少延迟
      try {
        // 对于小距离滚动，直接使用原生滚动以提高响应速度
        if (Math.abs(scrollAmount) <= 50) {
          window.scrollBy(scrollAmount, 0);
          return true;
        }
        
        // 对于大距离滚动，使用原生滚动
        if (useSmoothScroll) {
          window.scrollBy({ left: scrollAmount, behavior: 'smooth' });
        } else {
          window.scrollBy(scrollAmount, 0);
        }
        
        // 如果页面级滚动不够，再尝试主容器（但只尝试一个，使用缓存）
        const ytdApp = getYouTubeScrollContainer();
        if (ytdApp && Math.abs(scrollAmount) > 100) {
          if (useSmoothScroll) {
            ytdApp.scrollBy({ left: scrollAmount, behavior: 'smooth' });
          } else {
            ytdApp.scrollBy(scrollAmount, 0);
          }
        }
        
      } catch (error) {
        console.log('YouTube特定水平滚动失败，使用备用方法');
        if (useSmoothScroll) {
          window.scrollBy({ left: scrollAmount, behavior: 'smooth' });
        } else {
          window.scrollBy(scrollAmount, 0);
        }
      }
      return true;
    }
    
    // 非YouTube网站的处理
    // 获取可滚动容器
    const scrollContainer = findScrollableContainer();
    
    if (scrollContainer) {
      // 执行滚动
      if (scrollContainer === document.documentElement || scrollContainer === document.body) {
        if (useSmoothScroll) {
          window.scrollBy({ left: scrollAmount, behavior: 'smooth' });
        } else {
          window.scrollBy(scrollAmount, 0);
        }
      } else {
        if (useSmoothScroll) {
          scrollContainer.scrollBy({ left: scrollAmount, behavior: 'smooth' });
        } else {
          scrollContainer.scrollBy(scrollAmount, 0);
        }
      }
      
      return true;
    } else {
      // 如果没有找到特定容器，使用window滚动
      if (useSmoothScroll) {
        window.scrollBy({ left: scrollAmount, behavior: 'smooth' });
      } else {
        window.scrollBy(scrollAmount, 0);
      }
      return true;
    }
  } catch (error) {
    console.log('执行水平滚动时出错:', error.message);
    // 出错时尝试使用基本滚动方法
    try {
      if (settings.enableSmoothScroll) {
        window.scrollBy({ left: distance, behavior: 'smooth' });
      } else {
        window.scrollBy(distance, 0);
      }
      return true;
    } catch (e) {
      return false;
    }
  }
}

// 缓存YouTube滚动容器，避免重复查找
let cachedYouTubeScrollContainer = null;
let lastYouTubeContainerCheck = 0;

// 获取YouTube滚动容器的优化函数
function getYouTubeScrollContainer() {
  const now = Date.now();
  // 缓存5秒，避免频繁查找
  if (cachedYouTubeScrollContainer && (now - lastYouTubeContainerCheck) < 5000) {
    return cachedYouTubeScrollContainer;
  }
  
  // 重新查找容器
  const ytdApp = document.querySelector('ytd-app');
  if (ytdApp) {
    cachedYouTubeScrollContainer = ytdApp;
    lastYouTubeContainerCheck = now;
    return ytdApp;
  }
  
  cachedYouTubeScrollContainer = null;
  lastYouTubeContainerCheck = now;
  return null;
}

// 简化并改进performScroll函数，确保YouTube滚动正常工作
function performScroll(distance) {
  try {
    // 确定滚动方向(正数向下滚，负数向上滚)
    const direction = distance > 0 ? 1 : -1;
    // 获取有效滚动距离(取绝对值后应用)
    const scrollAmount = Math.min(Math.abs(distance), 300) * direction;
    
    // 检查是否启用平滑滚动
    const useSmoothScroll = settings.enableSmoothScroll;
    
    // 检查是否是YouTube网站
    const isYouTube = window.location.hostname.includes('youtube.com');
    if (isYouTube) {
      console.log('在YouTube上执行普通滚动，距离:', scrollAmount, '平滑滚动:', useSmoothScroll);
      
      // 对YouTube使用优化的滚动方法，减少延迟
      try {
        // 对于小距离滚动，直接使用原生滚动以提高响应速度
        if (Math.abs(scrollAmount) <= 50) {
          window.scrollBy(0, scrollAmount);
          return true;
        }
        
        // 对于大距离滚动，使用原生滚动
        if (useSmoothScroll) {
          window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        } else {
          window.scrollBy(0, scrollAmount);
        }
        
        // 如果页面级滚动不够，再尝试主容器（但只尝试一个，使用缓存）
        const ytdApp = getYouTubeScrollContainer();
        if (ytdApp && Math.abs(scrollAmount) > 100) {
          if (useSmoothScroll) {
            ytdApp.scrollBy({ top: scrollAmount, behavior: 'smooth' });
          } else {
            ytdApp.scrollBy(0, scrollAmount);
          }
        }
        
        // 显示滚动提示，移除YouTube标识
        // 注释掉以下两行：executeGestureAction已经显示了带有距离和百分比的提示
        // const actionKey = direction > 0 ? 'scrollDown' : 'scrollUp';
        // showGestureHint(getGestureTranslations()[actionKey]);
      } catch (error) {
        console.log('YouTube特定滚动失败，使用备用方法');
        if (useSmoothScroll) {
          window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        } else {
          window.scrollBy(0, scrollAmount);
        }
        const actionKey = direction > 0 ? 'scrollDown' : 'scrollUp';
        showGestureHint(getGestureTranslations()[actionKey]);
      }
      return true;
    }
    
    // 非YouTube网站的处理
    // 获取可滚动容器
    const scrollContainer = findScrollableContainer();
    
    if (scrollContainer) {
      // 执行滚动
      if (scrollContainer === document.documentElement || scrollContainer === document.body) {
        if (useSmoothScroll) {
          window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        } else {
          window.scrollBy(0, scrollAmount);
        }
      } else {
        if (useSmoothScroll) {
          scrollContainer.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        } else {
          scrollContainer.scrollBy(0, scrollAmount);
        }
      }
      
      // 显示滚动提示 - 移除容器信息
      // 注释掉以下两行：executeGestureAction已经显示了带有距离和百分比的提示
      // const actionKey = direction > 0 ? 'scrollDown' : 'scrollUp';
      // showGestureHint(getGestureTranslations()[actionKey]);
      return true;
    } else {
      // 如果没有找到特定容器，使用window滚动
      if (useSmoothScroll) {
        window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
      } else {
        window.scrollBy(0, scrollAmount);
      }
      // 注释掉以下两行：executeGestureAction已经显示了带有距离和百分比的提示
      // const actionKey = direction > 0 ? 'scrollDown' : 'scrollUp';
      // showGestureHint(getGestureTranslations()[actionKey]);
      return true;
    }
  } catch (error) {
    console.log('执行滚动时出错:', error.message);
    // 出错时尝试使用基本滚动方法
    try {
      if (settings.enableSmoothScroll) {
        window.scrollBy({ top: distance, behavior: 'smooth' });
      } else {
        window.scrollBy(0, distance);
      }
      return true;
    } catch (e) {
      return false;
    }
  }
}

// 滚动到指定位置，支持视频网站特殊滚动容器
function scrollToPosition(position) {
  try {
    const hostname = window.location.hostname;
    const isYouTube = hostname.includes('youtube.com');
    const useSmoothScroll = settings.enableSmoothScroll;
    let scrollableElement = null;

    if (isYouTube) {
      scrollableElement = getYouTubeMainScrollable() || document.documentElement;
      const target = position === 0 ? 0 : scrollableElement.scrollHeight;
      if (Math.abs(scrollableElement.scrollTop - target) < 2) return true;
      if (useSmoothScroll) {
        if ('scrollBehavior' in document.documentElement.style) {
          scrollableElement.scrollTo({ top: target, behavior: 'smooth' });
        } else {
          performCustomEasingScrollTo(scrollableElement, target, 150, 'ease-out', false);
        }
      } else {
        scrollableElement.scrollTop = target;
      }
      return true;
    }

    // 其它网站逻辑保持不变
    scrollableElement = findScrollableContainer();
    if (scrollableElement) {
      const target = position === 0 ? 0 : scrollableElement.scrollHeight;
      if (Math.abs(scrollableElement.scrollTop - target) < 2) return true;
      if (useSmoothScroll) {
        if (shouldUseNativeSmoothScroll()) {
          scrollableElement.scrollTo({ top: target, behavior: 'smooth' });
        } else {
          performCustomEasingScrollTo(scrollableElement, target, 200, 'ease-out', false);
        }
      } else {
        scrollableElement.scrollTop = target;
      }
      return true;
    }

    // 多容器兜底
    const allPotentialScrollables = [];
    const elementsToCheck = [...document.querySelectorAll('div, section, main, article, aside, nav')];
    elementsToCheck.push(
      document.documentElement,
      document.body,
      document.querySelector('main'),
      document.querySelector('.main'),
      document.querySelector('#main'),
      document.querySelector('.content'),
      document.querySelector('#content')
    );
    for (const el of elementsToCheck) {
      if (el && isElementScrollable(el)) {
        allPotentialScrollables.push(el);
      }
    }
    allPotentialScrollables.sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();
      return (rectB.width * rectB.height) - (rectA.width * rectA.height);
    });
    if (allPotentialScrollables.length > 0) {
      for (const el of allPotentialScrollables.slice(0, 3)) {
        try {
          const target = position === 0 ? 0 : el.scrollHeight;
          if (Math.abs(el.scrollTop - target) < 2) continue;
          if (useSmoothScroll) {
            if (shouldUseNativeSmoothScroll()) {
              el.scrollTo({ top: target, behavior: 'smooth' });
            } else {
              performCustomEasingScrollTo(el, target, 200, 'ease-out', false);
            }
          } else {
            el.scrollTop = target;
          }
        } catch (e) {
          console.log('滚动容器失败:', e.message);
        }
      }
      return true;
    }

    // 全局兜底
    const maxHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight,
      document.body.clientHeight,
      document.documentElement.clientHeight
    );
    const target = position === 0 ? 0 : maxHeight;
    if (useSmoothScroll) {
      if (shouldUseNativeSmoothScroll()) {
        window.scrollTo({ top: target, behavior: 'smooth' });
        document.documentElement.scrollTo({ top: target, behavior: 'smooth' });
        document.body.scrollTo({ top: target, behavior: 'smooth' });
      } else {
        performCustomEasingScrollTo(window, target, 200, 'ease-out', false);
        performCustomEasingScrollTo(document.documentElement, target, 200, 'ease-out', false);
        performCustomEasingScrollTo(document.body, target, 200, 'ease-out', false);
      }
    } else {
      window.scrollTo(0, target);
      document.documentElement.scrollTop = target;
      document.body.scrollTop = target;
    }
    return true;
  } catch (error) {
    console.log('滚动到指定位置时出错:', error.message);
    try {
      if (settings.enableSmoothScroll) {
        if (shouldUseNativeSmoothScroll()) {
          window.scrollTo({ top: position, behavior: 'smooth' });
        } else {
          performCustomEasingScrollTo(window, position, 200, 'ease-out', false);
        }
      } else {
        window.scrollTo(0, position);
      }
      return true;
    } catch (e) {
      return false;
    }
  }
}

// 获取YouTube主内容区可滚动容器
function getYouTubeMainScrollable() {
  const selectors = [
    'ytd-app',
    '#page-manager',
    '#primary',
    '#content',
    'ytd-page-manager',
    'ytd-browse',
    'ytd-watch-flexy'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && isElementScrollable(el)) {
      return el;
    }
  }
  return null;
}

// 查找当前页面中的可滚动容器
function findScrollableContainer() {
  // 特殊网站处理 - 基于域名的特定选择器
  const hostname = window.location.hostname;
  
  // 网站模式配置 - 使用通配符匹配支持更多网站
  const sitePatterns = [
    // YouTube及其相关域名
    {
      pattern: '*youtube*',
      selectors: [
        // 视频播放器页面
        'ytd-watch-flexy',
        '#columns #primary-inner',
        '#columns #primary',
        'ytd-watch-flexy #primary-inner',
        'ytd-watch-flexy #primary',
        // 首页和频道页
        'ytd-browse',
        'ytd-browse #contents',
        'ytd-two-column-browse-results-renderer',
        '#contents.ytd-rich-grid-renderer',
        // 搜索结果页
        'ytd-search',
        'ytd-search #contents',
        // 播放列表
        'ytd-playlist-panel-renderer #items',
        'ytd-playlist-panel-renderer',
        // 备用选择器
        'ytd-page-manager ytd-browse',
        'ytd-page-manager ytd-search',
        'ytd-page-manager',
        '#page-manager',
        '#content',
        '#contents'
      ],
      genericSelectors: [
        'ytd-section-list-renderer',
        'ytd-item-section-renderer',
        'ytd-rich-grid-renderer',
        'ytd-rich-item-renderer',
        'ytd-app'
      ],
      isVideoPage: () => !!document.querySelector('ytd-watch-flexy'),
      videoPageSelector: ['#primary', '#primary-inner']
    },
    // 抖音及相关网站
    {
      pattern: '*douyin*',
      selectors: [
        '.douyin-web__container',
        '.scroll-container',
        '.recommend-list-container',
        '.xgplayer-container'
      ]
    },
    // TikTok (国际版抖音)
    {
      pattern: '*tiktok*',
      selectors: [
        '.tiktok-web__container',
        '.scroll-container',
        '.recommend-list-container',
        '.xgplayer-container',
        '.video-card-container',
        '.feed-content',
        '.for-you-feed'
      ]
    },
    // 爱奇艺及相关网站
    {
      pattern: '*iqiyi*',
      selectors: [
        '.qy-scroll-container',
        '.qy-scroll-content',
        '.m-video-player-wrap',
        '.m-box-items'
      ]
    },
    // 腾讯视频
    {
      pattern: '*v.qq*',
      selectors: [
        '.site_container',
        '.mod_player',
        '.mod_episodes',
        '.container_main',
        '.mod_row_box',
        '.mod_pagination'
      ]
    },
    // Bilibili
    {
      pattern: '*bilibili*',
      selectors: [
        '#bilibiliPlayer',
        '.video-container',
        '.player-wrap',
        '.video-info-container',
        '.main-container',
        '.bili-wrapper',
        '.recommend-list'
      ]
    },
    // 优酷
    {
      pattern: '*youku*',
      selectors: [
        '.youku-film-player',
        '.playerBox',
        '.player-container',
        '.h5-detail-content',
        '.h5-detail-player',
        '.normal-player'
      ]
    },
    // Vimeo
    {
      pattern: '*vimeo*',
      selectors: [
        '.player_container',
        '.player_area',
        '.player',
        '.content',
        '.player_container',
        '.vp-player-layout'
      ]
    },
    // Twitch
    {
      pattern: '*twitch*',
      selectors: [
        '.persistent-player',
        '.video-player',
        '.video-player__container',
        '.twilight-main',
        '.stream-chat',
        '.channel-page'
      ]
    },
    // Netflix
    {
      pattern: '*netflix*',
      selectors: [
        '.watch-video',
        '.nfp',
        '.video-container',
        '.lolomo',
        '.mainView',
        '.gallery'
      ]
    }
  ];
  
  // 通配符匹配函数
  const matchPattern = (pattern, text) => {
    // 转换通配符为正则表达式
    const regexPattern = pattern
      .replace(/\./g, '\\.')  // 转义点号
      .replace(/\*/g, '.*');  // 星号转换为正则通配符
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(text);
  };
  
  // 检查域名是否匹配任何配置的模式
  const findMatchingPatterns = (hostname) => {
    return sitePatterns.filter(site => {
      // 尝试直接匹配域名
      if (matchPattern(site.pattern, hostname)) {
        return true;
      }
      
      // 尝试匹配不带www的域名
      const domainWithoutWww = hostname.replace(/^www\./, '');
      if (domainWithoutWww !== hostname && matchPattern(site.pattern, domainWithoutWww)) {
        return true;
      }
      
      // 或者检查域名是否包含模式
      // 将"*"通配符删除，使用简单的includes检查
      const simplifiedPattern = site.pattern.replace(/\*/g, '');
      return simplifiedPattern && hostname.includes(simplifiedPattern);
    });
  };
  
  // 获取手势起始点，优先使用这个位置来确定滚动容器
  let gestureStartElement = null;
  if (gesturePoints && gesturePoints.length > 0) {
    const gestureStartX = gesturePoints[0].x;
    const gestureStartY = gesturePoints[0].y;
    gestureStartElement = document.elementFromPoint(gestureStartX, gestureStartY);
    
    if (gestureStartElement) {
      console.log('手势起始点在元素:', gestureStartElement.tagName, 
                gestureStartElement.id || gestureStartElement.className);
    }
  }
  
  // 如果手势起始点在特定元素上，优先查找它的可滚动父容器
  if (gestureStartElement) {
    let container = gestureStartElement;
    let depth = 0;
    const maxDepth = 5;
    
    while (container && container !== document.body && container !== document.documentElement && depth < maxDepth) {
      if (isElementScrollable(container)) {
        console.log('在手势起始位置找到滚动容器:', container.tagName, 
                   container.id || container.className);
        return container;
      }
      container = container.parentElement;
      depth++;
    }
  }
  
  // 查找匹配的网站模式
  const matchedSites = findMatchingPatterns(hostname);
  console.log('匹配到的网站模式:', matchedSites.length > 0 ? matchedSites.map(s => s.pattern).join(', ') : '无');
  
  // 如果找到匹配的网站，尝试使用其特定选择器
  if (matchedSites.length > 0) {
    // 遍历所有匹配的网站模式
    for (const site of matchedSites) {
      // 检查是否是视频页面（如果有此检测函数）
      if (site.isVideoPage && site.isVideoPage() && site.videoPageSelector) {
        // 尝试视频页面特定选择器
        for (const selector of site.videoPageSelector) {
          const element = document.querySelector(selector);
          if (element && isElementScrollable(element)) {
            console.log(`找到${site.pattern}视频页面滚动容器:`, selector);
            return element;
          }
        }
      }
      
      // 尝试网站特定选择器
      if (site.selectors) {
        for (const selector of site.selectors) {
          const element = document.querySelector(selector);
          if (element && isElementScrollable(element)) {
            console.log(`找到${site.pattern}网站滚动容器:`, selector);
            return element;
          }
        }
      }
      
      // 尝试通用选择器（如果有）
      if (site.genericSelectors) {
        for (const selector of site.genericSelectors) {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            if (isElementScrollable(element)) {
              console.log(`找到${site.pattern}通用滚动容器:`, selector);
              return element;
            }
          }
        }
      }
    }
    
    // 如果以上都没找到，但有匹配的网站，可能是新版页面结构
    // 我们仍然尝试使用document.documentElement，而不是寻找其他容器
    console.log('识别到特定网站但未找到匹配的滚动容器，使用文档根元素');
    if (isElementScrollable(document.documentElement)) {
      return document.documentElement;
    }
  }
  
  // 通用选择器 - 已知的视频网站主滚动容器选择器
  const knownScrollSelectors = [
    // 通用视频网站常用的滚动容器class
    '.main-content-container',
    '.main-content',
    '.content-wrapper',
    '.content-container',
    '.video-feed',
    '.video-list',
    '.content-area',
    '.primary-column',
    '.main-column',
    '.scroll-container',
    '.video-container',
    '.player-container',
    '.main-view',
    '.main-section',
    '.video-player-container',
    '.media-player',
    '.watch-container',
    '.player-view',
    '.app-main',
    '.app-content',
    '.media-content',
    '.feed-container'
  ];
  
  // 先尝试已知的选择器
  for (const selector of knownScrollSelectors) {
    const element = document.querySelector(selector);
    if (element && isElementScrollable(element)) {
      console.log('找到通用滚动容器:', selector);
      return element;
    }
  }
  
  // 如果没有找到已知的滚动容器，尝试检测页面中的滚动容器
  return detectScrollableContainer();
}

// 检测页面中的滚动容器
function detectScrollableContainer() {
  // 首先检查文档根元素是否可滚动
  if (isElementScrollable(document.documentElement)) {
    return document.documentElement;
  }
  
  // 然后检查body元素是否可滚动
  if (isElementScrollable(document.body)) {
    return document.body;
  }
  
  // 使用手势起始点来确定最适合的滚动容器
  // 如果手势起始点可用，则优先从该点寻找可滚动容器
  if (gesturePoints && gesturePoints.length > 0) {
    const gestureStartX = gesturePoints[0].x;
    const gestureStartY = gesturePoints[0].y;
    
    // 从手势起始点获取元素
    const elementAtGestureStart = document.elementFromPoint(gestureStartX, gestureStartY);
    
    if (elementAtGestureStart) {
      // 向上查找可能的滚动容器
      let container = elementAtGestureStart;
      let depth = 0;
      const maxDepth = 5; // 限制向上查找深度
      
      while (container && container !== document.body && container !== document.documentElement && depth < maxDepth) {
        if (isElementScrollable(container)) {
          const rect = container.getBoundingClientRect();
          // 确保容器足够大(至少占视口宽度的50%或高度的30%)
          if (rect.width > window.innerWidth * 0.5 || rect.height > window.innerHeight * 0.3) {
            console.log('使用手势起始点找到滚动容器:', container);
            return container;
          }
        }
        container = container.parentElement;
        depth++;
      }
    }
  }
  
  // 优先检查这些常见的主内容容器
  const mainContentSelectors = [
    'main',
    '#main',
    '#content',
    '.content',
    '#app',
    '.app',
    '.main-content'
  ];
  
  for (const selector of mainContentSelectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      if (isElementScrollable(element)) {
        // 如果找到可滚动的主内容容器，优先返回
        return element;
      }
    }
  }
  
  // 尝试查找视口中心和下半部分的可滚动元素
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const viewportCenter = { x: viewportWidth / 2, y: viewportHeight / 2 };
  
  // 在视口中心点和下半部分寻找元素
  // 优先在中心区域检查，避免导航栏等边缘元素
  for (let y = viewportCenter.y; y < viewportHeight * 0.9; y += 50) {
    const element = document.elementFromPoint(viewportCenter.x, y);
    if (element) {
      // 向上查找可能的滚动容器
      let container = element;
      let depth = 0;
      // 限制向上查找的深度，以避免到达顶层容器
      const maxDepth = 5;
      
      while (container && container !== document.body && container !== document.documentElement && depth < maxDepth) {
        if (isElementScrollable(container)) {
          const rect = container.getBoundingClientRect();
          // 确保容器足够大(至少占视口宽度的50%和高度的30%)
          if (rect.width > viewportWidth * 0.5 && rect.height > viewportHeight * 0.3) {
            return container;
          }
        }
        container = container.parentElement;
        depth++;
      }
    }
  }
  
  // 如果在中心区域没找到，检查整个文档中的大型可滚动元素
  const allElements = document.querySelectorAll('*');
  let bestContainer = null;
  let maxArea = 0;
  
  for (const element of allElements) {
    if (isElementScrollable(element)) {
      const rect = element.getBoundingClientRect();
      const area = rect.width * rect.height;
      
      // 找出最大的可滚动区域，但避免整个文档
      if (area > maxArea && element !== document.documentElement && element !== document.body) {
        // 额外检查：确保元素不是左侧导航栏或其他辅助UI
        // 通常主内容区域会位于较中央的位置
        const centerOffset = Math.abs((rect.left + rect.right) / 2 - viewportWidth / 2);
        // 如果元素中心与视口中心的水平偏移较小，更可能是主内容
        if (centerOffset < viewportWidth * 0.3) {
          maxArea = area;
          bestContainer = element;
        }
      }
    }
  }
  
  if (bestContainer) {
    return bestContainer;
  }
  
  // 默认返回document.scrollingElement
  return document.scrollingElement || document.documentElement;
}

// 检查元素是否可滚动
function isElementScrollable(element) {
  if (!element) return false;
  
  try {
    // 检查文档根或body元素（这些总是可滚动的）
    if (element === document.documentElement || element === document.body) {
      return element.scrollHeight > element.clientHeight;
    }
    
    const style = window.getComputedStyle(element);
    
    // 检查常见的可滚动样式
    const hasScrollableStyle = 
      style.overflow === 'auto' || 
      style.overflow === 'scroll' || 
      style.overflowY === 'auto' || 
      style.overflowY === 'scroll';
    
    // 有些元素即使是overflow:hidden，但内容超出也可以滚动
    const potentiallyScrollableWithHidden = 
      style.overflow === 'hidden' || 
      style.overflowY === 'hidden';
    
    // 检查元素内容是否超出容器高度
    const hasScrollHeight = element.scrollHeight > element.clientHeight;
    
    // 额外检查：避免选择太小的容器
    const rect = element.getBoundingClientRect();
    
    // 检查特殊角色属性
    const role = element.getAttribute('role');
    const isScrollableRole = role === 'scrollbar' || role === 'listbox' || 
                            role === 'grid' || role === 'tree';
    
    // 检查常见的可滚动类名
    const className = element.className || '';
    const hasScrollableClass = /\b(scroll|scrollable|overflow|content)\b/i.test(className);
    
    // 为特殊元素调整大小要求
    let isLargeEnough = true;
    if (isScrollableRole || hasScrollableClass) {
      // 对于有明确滚动指示的元素，大小要求可以放宽
      isLargeEnough = rect.width > 100 && rect.height > 50;
    } else {
      // 对于普通元素，保持较严格的大小要求
      isLargeEnough = rect.width > 200 && rect.height > 100;
    }
    
    // 检查是否在视口内
    const isInViewport = 
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth && 
      rect.bottom > 0 && 
      rect.right > 0;
    
    // 普通滚动条件
    if (hasScrollableStyle && hasScrollHeight && isLargeEnough && isInViewport) {
      return true;
    }
    
    // 特殊处理：即使overflow:hidden，但内容超出且有明确滚动特征的元素
    if (potentiallyScrollableWithHidden && hasScrollHeight && 
        (isScrollableRole || hasScrollableClass) && isInViewport) {
      return true;
    }
    
    // 特殊处理：无样式但有明显滚动特征的元素
    if (hasScrollHeight && isScrollableRole && isLargeEnough && isInViewport) {
      return true;
    }
    
    return false;
  } catch (error) {
    // 如果获取样式出错，默认返回false
    return false;
  }
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
      enableDragTextSearch: true,
      autoDownloadOnDragFile: false,
      enableImagePreview: true,
      enableDuplicateCheck: true,
      dragUpAction: 'background', // 向上拖拽动作：后台打开
      dragRightAction: 'background', // 向右拖拽动作：后台打开
      dragDownAction: 'background', // 向下拖拽动作：后台打开
      dragLeftAction: 'background', // 向左拖拽动作：后台打开
      dragSearchEngine: 'https://www.google.com/search?q={q}', // 添加超级拖拽搜索引擎URL设置
      language: newLanguage // 使用传入的新语言
    }, (loadedSettings) => {
      if (chrome.runtime.lastError) {
        console.log(getI18nMessage('errorLoadSettings'), chrome.runtime.lastError.message);
        return;
      }
      
      // 保存旧语言设置，用于比较
      const oldLanguage = settings ? settings.language : null;
      
      // 更新设置
      settings = loadedSettings;
      
      // 重置上一次提示的动作以确保下次显示提示时使用新语言
      lastHintAction = '';
      
      // 如果当前有显示的提示，移除它
      if (gestureHint && document.body.contains(gestureHint)) {
        document.body.removeChild(gestureHint);
        gestureHint = null;
      }
      
      // 显示语言已变更提示
      if (oldLanguage && oldLanguage !== newLanguage) {
        // 重置上一次提示的动作以确保下次显示提示时使用新语言
        lastHintAction = '';
        console.log(getI18nMessage('languageChanged', [oldLanguage, newLanguage]));
        
        // 如果当前有显示的提示，移除它
        if (gestureHint && document.body.contains(gestureHint)) {
          document.body.removeChild(gestureHint);
          gestureHint = null;
        }
        
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
    });
  } catch (e) {
    console.log(getI18nMessage('errorLoadSettings'), e.message);
    if (e.message.includes('Extension context invalidated')) {
      isExtensionValid = false;
    }
  }
}

// 初始化
loadSettings();

// 定期检查扩展上下文是否有效
function checkExtensionValidity() {
  if (!isExtensionValid) return;
  
  try {
    // 尝试发送一个简单的消息来检查扩展上下文
    chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log(getI18nMessage('errorCheckExtension'), chrome.runtime.lastError.message);
        if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
          isExtensionValid = false;
        }
      } else {
        isExtensionValid = true;
      }
    });
  } catch (e) {
    console.log(getI18nMessage('errorCheckExtension'), e.message);
    if (e.message.includes('Extension context invalidated')) {
      isExtensionValid = false;
    }
  }
}

// 每分钟检查一次扩展上下文
setInterval(checkExtensionValidity, 60000);

// 创建图片预览元素
function createImagePreview() {
  const preview = document.createElement('div');
  preview.style.position = 'fixed';
  preview.style.zIndex = '9999999';
  preview.style.pointerEvents = 'none';
  preview.style.display = 'none';
  preview.style.backgroundColor = 'transparent'; // 将背景改为透明，避免与圆角图片产生边框问题
  preview.style.padding = '0';
  preview.style.borderRadius = '0';
  preview.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
  preview.style.transition = 'opacity 0.2s ease-in-out';
  preview.style.opacity = '0';
  preview.style.border = 'none';
  preview.style.overflow = 'hidden'; // 确保内容不会溢出边界
  
  const img = document.createElement('img');
  img.style.display = 'block';
  img.style.objectFit = 'contain';
  img.style.border = 'none';
  img.style.maxWidth = '100%';
  img.style.maxHeight = '100%';
  // 不预设背景色，而是在检测后动态设置
  preview.appendChild(img);
  
  document.body.appendChild(preview);
  return preview;
}

// 隐藏图片预览
function hideImagePreview(immediate = false) {
  if (imagePreview) {
    imagePreview.style.opacity = '0';
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
      // 延迟隐藏，用于正常的鼠标移出
      setTimeout(() => {
        if (imagePreview && imagePreview.style.opacity === '0') {
          imagePreview.style.display = 'none';
          // 清除引用的元素
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
  }
}

function showImagePreview(e, imgElement) {
  // 如果页面正在滚动中，不显示图片预览
  if (isPageScrolling) {
    return;
  }
  
  if (!imagePreview) {
    imagePreview = createImagePreview();
  }
  
  const preview = imagePreview;
  const img = preview.querySelector('img');
  
  // 设置图片源
  img.src = imgElement.src;
  
  // 获取原始图片元素，可能是事件触发源
  const originalImgElement = (e && e.target && e.target.tagName === 'IMG') ? e.target : imgElement;
  
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
      console.error(getI18nMessage('errorDetectImageRadius'), e);
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
  if (originalImgElement && originalImgElement.parentNode && typeof MutationObserver !== 'undefined') {
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
          const canvas = document.createElement('canvas');
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
    
    // 计算预览窗口位置，根据鼠标位置智能调整
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // 默认位置：鼠标右下方
    let left = e.clientX + 20;
    let top = e.clientY + 20;
    
    // 根据鼠标在屏幕上的位置调整预览位置
    if (e.clientX > viewportWidth / 2) {
      left = e.clientX - displayWidth - 20;
    }
    
    if (e.clientY > viewportHeight / 2) {
      top = e.clientY - displayHeight - 20;
    }
    
    // 最终边界检查，确保预览完全在可视区域内
    left = Math.max(10, Math.min(left, viewportWidth - displayWidth - 20));
    top = Math.max(10, Math.min(top, viewportHeight - displayHeight - 20));
    
    // 应用位置
    preview.style.left = left + 'px';
    preview.style.top = top + 'px';
    preview.style.display = 'block';
    
    // 使用淡入效果显示
    requestAnimationFrame(() => {
      preview.style.opacity = '1';
    });

  // 仅在预览显示期间监听wheel事件，用于立即隐藏预览
  if (!previewWheelListenerAttached) {
    try {
      document.addEventListener('wheel', handleWheelScroll, { passive: true });
    } catch (err) {
      document.addEventListener('wheel', handleWheelScroll);
    }
    previewWheelListenerAttached = true;
  }
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

// 处理鼠标移动到图片或视频上
function handleImageMouseOver(e) {
  const target = e.target;
  if (!settings.enableImagePreview) {
    console.log('图片预览功能已禁用');
    return;
  }
  
  // 如果页面正在滚动中，不显示图片预览
  if (isPageScrolling) {
    console.log('页面正在滚动中，跳过图片预览', { isPageScrolling });
    return;
  }
  
  // 如果滚动停止后还在额外延迟期间，不显示图片预览
  if (scrollPreviewDelayTimer) {
    console.log('滚动停止后的额外延迟期间，跳过图片预览');
    return;
  }
  
  console.log('开始处理图片预览，滚动状态:', { isPageScrolling, hasPreviewDelay: !!scrollPreviewDelayTimer });
  
  let previewUrl = null;
  let imgElement = null;
  
  if (target.tagName === 'IMG') {
    previewUrl = target.src;
    imgElement = target;
    console.log('检测到图片元素:', {
      src: target.src,
      loading: target.loading,
      complete: target.complete,
      naturalWidth: target.naturalWidth,
      naturalHeight: target.naturalHeight
    });
  } else if (target.tagName === 'VIDEO') {
    previewUrl = getVideoPosterUrl(target);
  } else if (target.tagName === 'A') {
    // 检查链接是否指向图片
    const href = target.href;
    if (href && /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(href)) {
      previewUrl = href;
    }
  }
  
  if (previewUrl) {
    console.log('准备显示图片预览:', previewUrl);
    // 清除任何现有的预览隐藏定时器
    if (target._hidePreviewTimer) {
      clearTimeout(target._hidePreviewTimer);
      target._hidePreviewTimer = null;
    }
    
    // 对于非IMG元素的情况，创建一个虚拟元素
    if (!imgElement) {
      imgElement = { src: previewUrl };
    }
    
    showImagePreview(e, imgElement);
    
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
  } else {
    console.log('没有找到有效的预览URL');
  }
}

// 注册事件监听器
function registerEventListeners() {
  try {
    // 使用 capture 阶段来确保我们的监听器最先执行
    window.addEventListener('mousedown', handleMouseDown, { capture: true, passive: false });
    window.addEventListener('mousemove', handleMouseMove, { capture: true, passive: false });
    window.addEventListener('mouseup', handleMouseUp, { capture: true, passive: false });
    window.addEventListener('contextmenu', handleContextMenu, { capture: true, passive: false });
    window.addEventListener('scroll', handlePageScroll, { passive: true });
    
    // 为Mac系统特别添加键盘事件监听，以检测Ctrl键状态
    if (isMacOS) {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Control') {
          // 暂不做任何操作，为后续可能的扩展预留
        }
      }, { capture: true, passive: true });
      
      window.addEventListener('keyup', (e) => {
        if (e.key === 'Control') {
          // 如果在Mac上松开Ctrl键，并且手势正在进行中，则模拟右键释放
          if (isRightMouseDown || isGestureInProgress) {
            isRightMouseDown = false;
            
            if (isGestureInProgress) {
              isGestureInProgress = false;
              lastGestureEndTime = Date.now();
              lastHintAction = '';
              
              const gesture = recognizeGesture();
              clearGestureCanvas();
              
              if (gesture) {
                executeGestureAction(gesture);
              } else {
                resetGestureState();
              }
            }
          }
        }
      }, { capture: true, passive: true });
    }
    
    window.addEventListener('dragstart', handleDragStart, { capture: false, passive: false });
    window.addEventListener('dragend', handleDragEnd, { capture: false, passive: false });
    window.addEventListener('drop', handleDrop, { capture: false, passive: false });
    window.addEventListener('dragleave', handleDragLeave, { capture: false, passive: false });
    window.addEventListener('resize', handleResize, { capture: false, passive: true });
    window.addEventListener('mouseover', handleImageMouseOver, { capture: true, passive: true });
    
    // 为所有 iframe 添加事件监听器
    const handleIframes = () => {
      const iframes = document.getElementsByTagName('iframe');
      for (let iframe of iframes) {
        try {
          iframe.contentWindow.addEventListener('mousedown', handleMouseDown, { capture: true, passive: false });
          iframe.contentWindow.addEventListener('mousemove', handleMouseMove, { capture: true, passive: false });
          iframe.contentWindow.addEventListener('mouseup', handleMouseUp, { capture: true, passive: false });
          iframe.contentWindow.addEventListener('contextmenu', handleContextMenu, { capture: true, passive: false });
          iframe.contentWindow.addEventListener('scroll', handlePageScroll, { passive: true });
          
          // 为Mac系统特别添加键盘事件监听
          if (isMacOS) {
            iframe.contentWindow.addEventListener('keydown', (e) => {
              if (e.key === 'Control') {
                // 暂不做任何操作
              }
            }, { capture: true, passive: true });
            
            iframe.contentWindow.addEventListener('keyup', (e) => {
              if (e.key === 'Control') {
                if (isRightMouseDown || isGestureInProgress) {
                  isRightMouseDown = false;
                  
                  if (isGestureInProgress) {
                    isGestureInProgress = false;
                    lastGestureEndTime = Date.now();
                    lastHintAction = '';
                    
                    const gesture = recognizeGesture();
                    clearGestureCanvas();
                    
                    if (gesture) {
                      executeGestureAction(gesture);
                    } else {
                      resetGestureState();
                    }
                  }
                }
              }
            }, { capture: true, passive: true });
          }
        } catch (e) {
          console.log(getI18nMessage('errorAccessIframe'), e.message);
        }
      }
    };

    // 立即处理现有的iframe
    handleIframes();
    
    // 监听DOM变化以处理新添加的iframe和图片
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.addedNodes) {
          mutation.addedNodes.forEach((node) => {
            // 处理新添加的图片元素
            if (node.tagName === 'IMG') {
              // 懒加载图片在滚动时被添加，需要确保它们能触发图片预览
              // 由于使用了事件委托，新添加的图片会自动被处理
              console.log('检测到新添加的图片元素:', node.src);
            }
            // 处理包含图片的容器
            else if (node.nodeType === Node.ELEMENT_NODE) {
              const images = node.querySelectorAll('img');
              images.forEach(img => {
                console.log('检测到容器中的新图片元素:', img.src);
              });
            }
            
            if (node.tagName === 'IFRAME') {
              try {
                node.contentWindow.addEventListener('mousedown', handleMouseDown, { capture: true, passive: false });
                node.contentWindow.addEventListener('mousemove', handleMouseMove, { capture: true, passive: false });
                node.contentWindow.addEventListener('mouseup', handleMouseUp, { capture: true, passive: false });
                node.contentWindow.addEventListener('contextmenu', handleContextMenu, { capture: true, passive: false });
                node.contentWindow.addEventListener('scroll', handlePageScroll, { passive: true });
                
                // 为Mac系统特别添加键盘事件监听
                if (isMacOS) {
                  node.contentWindow.addEventListener('keydown', (e) => {
                    if (e.key === 'Control') {
                      // 暂不做任何操作
                    }
                  }, { capture: true, passive: true });
                  
                  node.contentWindow.addEventListener('keyup', (e) => {
                    if (e.key === 'Control') {
                      if (isRightMouseDown || isGestureInProgress) {
                        isRightMouseDown = false;
                        
                        if (isGestureInProgress) {
                          isGestureInProgress = false;
                          lastGestureEndTime = Date.now();
                          lastHintAction = '';
                          
                          const gesture = recognizeGesture();
                          clearGestureCanvas();
                          
                          if (gesture) {
                            executeGestureAction(gesture);
                          } else {
                            resetGestureState();
                          }
                        }
                      }
                    }
                  }, { capture: true, passive: true });
                }
              } catch (e) {
                console.log('无法访问新iframe内容:', e.message);
              }
            }
          });
        }
      });
    });

    // 开始观察DOM变化
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    console.log('事件监听器注册成功');
  } catch (e) {
    console.log('注册事件监听器失败:', e.message);
  }
}

// 修改初始化函数
function initialize() {
  try {
    // 加载设置
    loadSettings();
    
    // 注册事件监听器
    registerEventListeners();
    
    // 检查扩展有效性
    checkExtensionValidity();
    
    // 检查并初始化调试面板状态
    initDebugPanelState();
  } catch (e) {
    console.log('初始化鼠标手势扩展失败:', e.message);
  }
}

// 初始化调试面板状态 - 新增函数
function initDebugPanelState() {
  try {
    // 从localStorage读取面板状态
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

// 立即启动初始化
initialize();

// 重置拖拽信息
function resetDragInfo() {
  dragInfo = {
    startX: 0,
    startY: 0,
    direction: '',
    target: null,
    url: '',
    text: '',
    type: '',
    savedSelection: false
  };
} 

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', initialize); 

// 添加一个新函数用于显示自动关闭重复标签页的成功通知
function showAutoCloseSuccessNotification(data) {
  try {
    // 如果notification-container已存在，先移除它
    const existingContainer = document.getElementById('mouse-gesture-notification-container');
    if (existingContainer) {
      document.body.removeChild(existingContainer);
    }
    
    // 获取当前语言设置
    const currentLang = settings.language || 'zh';
    const isEnglish = currentLang === 'en';
    
    // 文本翻译
    const texts = {
      title: isEnglish 
        ? `Auto-closed ${data.count} duplicate tab${data.count > 1 ? 's' : ''}` 
        : `已自动关闭${data.count}个重复标签页`
    };
    
    // 创建通知容器
    const container = document.createElement('div');
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
    const notification = document.createElement('div');
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
    const icon = document.createElement('div');
    icon.innerHTML = '✅';
    icon.style.fontSize = '18px'; // 从22px减小到18px
    icon.style.marginRight = '12px'; // 从14px减小到12px
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
    const content = document.createElement('div');
    content.style.flexGrow = '1';
    
    // 成功消息标题
    const title = document.createElement('div');
    title.textContent = texts.title;
    title.style.fontWeight = '600';
    title.style.fontSize = '15px';
    title.style.marginBottom = '6px';
    title.style.letterSpacing = '0.3px';
    title.style.color = '#FFFFFF';
    title.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.1)';
    
    // 创建URL列表容器
    const urlListContainer = document.createElement('div');
    urlListContainer.style.fontSize = '13px';
    urlListContainer.style.lineHeight = '1.5';
    urlListContainer.style.color = '#f0fff5';
    urlListContainer.style.opacity = '0.9';
    
    // 显示已关闭的标签页标题，最多3个
    if (data.titles && data.titles.length > 0) {
      // 简单显示已关闭的标签
      const maxTitlesToShow = Math.min(data.titles.length, 3);
      
      for (let i = 0; i < maxTitlesToShow; i++) {
        const urlItem = document.createElement('div');
        urlItem.style.display = 'flex';
        urlItem.style.alignItems = 'center';
        
        // 添加小圆点作为前缀
        const bullet = document.createElement('span');
        bullet.textContent = '•';
        bullet.style.color = '#8EEDC7';
        bullet.style.marginRight = '6px';
        bullet.style.fontSize = '16px';
        
        // URL标题
        const urlTitle = document.createElement('span');
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
    
    // 确保body存在
    if (!document.body) {
      console.log('文档body不存在，无法显示通知');
      return;
    }
    
    // 添加到页面
    document.body.appendChild(container);
    
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
            if (document.body && container.parentNode === document.body) {
              document.body.removeChild(container);
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

// 监听从popup.js发送来的设置更新消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "settingsUpdated") {
    try {
      // 保存旧的语言设置用于比较
      const oldLanguage = settings ? settings.language : null;
      
      // 重新加载设置
      loadSettings();
      console.log('收到设置更新消息，已重新加载设置');
      
      // 特殊处理语言变更情况
      if (oldLanguage && oldLanguage !== settings.language) {
        console.log('语言已从', oldLanguage, '更改为', settings.language);
        // 强制重置手势提示状态
        lastHintAction = '';
        
        // 如果当前有显示的提示，立即移除它
        if (gestureHint && document.body.contains(gestureHint)) {
          document.body.removeChild(gestureHint);
          gestureHint = null;
        }
      }
      
      // 如果有必要，在设置更新后刷新某些UI元素或状态
      if (gestureCanvas && settings.enableGesture) {
        // 更新与手势相关的状态
        updateGestureCanvasSettings();
      }
      
      // 返回成功响应
      if (sendResponse) {
        sendResponse({ status: "success" });
      }
    } catch (error) {
      console.log('处理设置更新消息时出错:', error.message);
      
      // 即使出错也返回响应
      if (sendResponse) {
        sendResponse({ status: "error", message: error.message });
      }
    }
    return true; // 保持消息通道开放，允许异步响应
  }
});

// 更新手势画布设置
function updateGestureCanvasSettings() {
  if (gestureCanvas && gestureContext) {
    gestureContext.strokeStyle = settings.trailColor || '#FF0000';
    gestureContext.lineWidth = settings.trailWidth || 3;
  }
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
  // Google搜索结果页特殊处理
  if (window.location.hostname.match(/^([\w-]+\.)?google\./)) {
    // 新版Google搜索结果页（2024年常见结构）
    // 1. 新版：a[aria-label="下一页"], a[aria-label="Next page"]
    let googleNext = document.querySelector('a[aria-label="下一页"], a[aria-label="Next page"]');
    if (!googleNext) {
      // 2. 旧版：id为pnnext的a标签
      googleNext = document.getElementById('pnnext');
    }
    if (!googleNext) {
      // 3. 备用：底部分页区的最后一个a（通常是下一页）
      const nav = document.querySelector('#foot, #nav, .d6cvqb');
      if (nav) {
        const links = nav.querySelectorAll('a');
        if (links.length > 0) {
          googleNext = links[links.length - 1];
        }
      }
    }
    if (googleNext && googleNext.href && !googleNext.href.toLowerCase().startsWith('javascript:')) {
      return googleNext;
    }
  }
  
  // 优先策略1：从URL参数构造下一页链接（最可靠的方法）
  // 如果URL中包含页码参数(如page=2, p=3等)，尝试构造下一页URL
  const urlParams = new URLSearchParams(window.location.search);
  const pagePatterns = [
    'page', 'p', 'pg', 'paged', 'pagenum', 'pn', 'cpage', 'current', 'pages', 'pageid',
    'pageIndex', 'pageNo', 'pageNumber', 'offset', 'start', 'from', 'begin'
  ];
  
  for (const pattern of pagePatterns) {
    if (urlParams.has(pattern)) {
      const currentPageStr = urlParams.get(pattern);
      const currentPage = parseInt(currentPageStr);
      
      if (!isNaN(currentPage) && currentPage > 0) {
        // 验证下一页是否合理（不超过常见的最大页数）
        const nextPage = currentPage + 1;
        if (nextPage <= 10000) { // 防止构造过大的页码
          // 构造下一页URL
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.set(pattern, nextPage.toString());
          
          console.log(`从URL参数构造下一页: ${pattern}=${currentPage} -> ${nextPage}`);
          
          // 创建虚拟链接，标记为高优先级
          const virtualLink = document.createElement('a');
          virtualLink.href = nextUrl.href;
          virtualLink._constructedFromUrl = true;
          virtualLink._urlBased = true; // 标记为基于URL的链接
          return virtualLink;
        }
      }
    }
  }
  
  // 优先策略2：检查URL路径中的数字模式
  // 例如 /article/123/ -> /article/124/, /post/456.html -> /post/457.html
  const pathPatterns = [
    /\/(\d+)\/?$/,                    // /123/ 或 /123
    /\/(\d+)\.html?$/i,               // /123.html 或 /123.htm
    /\/(\d+)\.php$/i,                 // /123.php
    /\/(\d+)\.aspx?$/i,               // /123.asp 或 /123.aspx
    /-(\d+)\/?$/,                     // -123/ 或 -123
    /_(\d+)\/?$/,                     // _123/ 或 _123
    /(\d+)\/$/,                       // 123/
    /\/page-?(\d+)/i,                 // /page123 或 /page-123
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
        const virtualLink = document.createElement('a');
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
          
          const virtualLink = document.createElement('a');
          virtualLink.href = nextUrl.href;
          virtualLink._constructedFromUrl = true;
          virtualLink._urlBased = true;
          return virtualLink;
        }
      }
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

  // 策略4：寻找rel="next"的链接（这是比较精确的标准）
  const relNextLinks = document.querySelectorAll('a[rel="next"], link[rel="next"], a[rel*="next"]');
  for (const relLink of relNextLinks) {
    if (relLink.tagName === 'A' && relLink.href) {
      // 过滤JavaScript URL
      if (!relLink.href.toLowerCase().startsWith('javascript:')) {
        console.log('找到rel="next"链接:', relLink.href);
        return relLink;
      }
    } else if (relLink.tagName === 'LINK') {
      const href = relLink.getAttribute('href');
      if (href && !href.toLowerCase().startsWith('javascript:')) {
        console.log('找到rel="next" LINK元素:', href);
        // 为link元素创建一个虚拟a元素
        const virtualLink = document.createElement('a');
        virtualLink.href = href;
        virtualLink._urlBased = true;
        return virtualLink;
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
      // 如果是链接元素，检查并添加到候选列表
      if (el.tagName === 'A' && el.href) {
        if (!el.href.toLowerCase().startsWith('javascript:')) {
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
            !parent.href.toLowerCase().startsWith('javascript:')) {
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
      if (childLink && !childLink.href.toLowerCase().startsWith('javascript:')) {
        candidateLinks.push({
          element: childLink,
          priority: 2, // 中等优先级：子元素链接
          type: 'child_link'
        });
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
            !parent.href.toLowerCase().startsWith('javascript:')) {
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
      if (childLink && !childLink.href.toLowerCase().startsWith('javascript:')) {
        candidateLinks.push({
          element: childLink,
          priority: 4, // 包含文本的子元素链接
          type: 'contains_child_link'
        });
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
      const virtualLink = document.createElement('a');
      virtualLink.href = "#";
      virtualLink._originalElement = bestCandidate.element;
      return virtualLink;
    } else {
      // 直接返回链接元素
      return bestCandidate.element;
    }
  }

  // 策略6：查找带有典型class或id的元素
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
        if (!el.href.toLowerCase().startsWith('javascript:')) {
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
            !parent.href.toLowerCase().startsWith('javascript:')) {
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
      if (childLink && !childLink.href.toLowerCase().startsWith('javascript:')) {
        classCandidates.push({
          element: childLink,
          priority: 6, // 基于CSS类的子元素链接
          type: 'class_child_link'
        });
        continue;
      }
      
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
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
      const virtualLink = document.createElement('a');
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
      // 检查自身或最近的父元素是否为链接
      let current = iconEl;
      for (let i = 0; i < 4 && current; i++) { // 向上查找最多4层
        if (current.tagName === 'A' && current.href) {
          if (!current.href.toLowerCase().startsWith('javascript:')) {
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
          iconCandidates.push({
            element: current,
            priority: 12, // 较低优先级：图标按钮元素
            type: 'icon_button_element'
          });
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
      const virtualLink = document.createElement('a');
      virtualLink.href = "#";
      virtualLink._originalElement = bestCandidate.element;
      return virtualLink;
    } else {
      return bestCandidate.element;
    }
  }

  // 策略8：在分页容器中查找页码序列中当前页之后的链接
  // 通常分页在页面底部，查找所有可能的分页容器
  const paginationContainers = [
    ...document.querySelectorAll('.pagination'),
    ...document.querySelectorAll('.pager'),
    ...document.querySelectorAll('.pages'),
    ...document.querySelectorAll('.page-numbers'),
    ...document.querySelectorAll('[class*="pagin"]'),
    ...document.querySelectorAll('[id*="pagin"]'),
    ...document.querySelectorAll('nav[aria-label*="pagination"]'),
    ...document.querySelectorAll('nav[aria-label*="Pagination"]'),
    ...document.querySelectorAll('nav[role="navigation"]'),
    ...document.querySelectorAll('ul.page, ol.page, div.page'),
    ...document.querySelectorAll('.paging, .page-list, .page-nav')
  ];

  for (const container of paginationContainers) {
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

// 尝试跳转到下一页
function tryNavigateToNextPage() {
  // 获取当前语言
  const currentLang = settings.language || 'zh';
  
  // 显示正在尝试查找下一页的提示
  showGestureHint(getNavigationErrorTranslations().tryingNextPage);
  
  // 查找下一页链接
  const nextPageLink = findNextPageLink();
  lastTriedNextPageLink = nextPageLink; // 记录上次尝试的链接
  
  if (!nextPageLink || !nextPageLink.href) {
    // 如果没有找到下一页链接，显示提示
    showGestureHint(getNavigationErrorTranslations().noNextPage);
    return false;
  }
  
  // 显示成功找到下一页的提示
  showGestureHint(getNavigationErrorTranslations().nextPageSuccess);
  
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

// 设置事件监听器
document.addEventListener('scroll', handlePageScroll, { passive: true });
window.addEventListener('resize', handleWindowResize, { passive: true });

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

// 初始化设置和画布
loadSettings();
initGestureCanvas();