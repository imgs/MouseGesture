// 禁用所有控制台日志
console.log = function() {};
console.error = function() {};
console.warn = function() {};
console.info = function() {};
console.debug = function() {};

// 配置常量 - 消除硬编码问题
const CONFIG = {
  STATUS_MESSAGE_DURATION: 3000,
  FADE_DURATION: 300,
  DEBOUNCE_DELAY: 300,
  WHEEL_STEP: 1,
  MAX_PREVIEW_DELAY: 300,
  DEFAULT_PREVIEW_DELAY: 5000,
  LOADING_ANIMATION_INTERVAL: 300,
  RESET_BUTTON_DISABLE_DURATION: 2000
};

// 公共工具类 - 消除代码重复
const CommonUtils = {
  // 防抖函数
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func.apply(this, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  // 统一的DOM元素获取
  getElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      console.warn(`Element with id "${id}" not found`);
    }
    return element;
  },

  // 统一的事件监听器添加
  addChangeListener(selector, callback, statusId = null) {
    const element = this.getElement(selector);
    if (element) {
      element.addEventListener('change', function(event) {
        callback(event);
        if (statusId) {
          showSectionSaveStatus(statusId, 'settingsSaved');
        }
      });
    }
  },

  // 统一的输入事件监听器
  addInputListener(selector, valueSelector, callback = null) {
    const element = this.getElement(selector);
    const valueElement = this.getElement(valueSelector);
    
    if (element && valueElement) {
      element.addEventListener('input', function() {
        valueElement.textContent = this.value;
        if (callback) callback();
      });
    }
  },

  // 统一的设置保存
  saveSettings() {
    const settings = getSettingsSnapshot();
    chrome.storage.sync.set(settings, handleSaveResponse);
  },

  // 统一的错误处理
  handleError(error, context = 'Unknown') {
    console.error(`Error in ${context}:`, error.message);
    showStatusMessage('saveError', true);
  }
};

// 统一的保存响应处理
function handleSaveResponse() {
  if (chrome.runtime.lastError) {
    CommonUtils.handleError(chrome.runtime.lastError, 'saveSettings');
    return;
  }
  
  showStatusMessage('settingsSaved');
  notifySettingsUpdated();
}

// 默认设置
const defaultSettings = {
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
  autoCloseDetectedTabs: false,
  enableSmoothScroll: true,
  enableDebugPanel: false,
  showTabCountBadge: true,
  language: getBrowserLanguage(), // 自动获取浏览器语言
  theme: 'light',
  
  // 超级拖拽方向自定义，全部设为后台打开
  dragUpAction: 'background',
  dragRightAction: 'background',
  dragDownAction: 'background',
  dragLeftAction: 'background',
  // 超级拖拽搜索引擎URL
  dragSearchEngine: 'https://www.google.com/search?q={q}',
  
  // 小窗视图的默认设置
  previewEnabled: true,
  previewHoverDelay: 200,
  previewModifierKey: 'Shift',
  previewMaxWindows: 20,
  previewDefaultWidth: 480,
  previewDefaultHeight: 640,
  previewPosition: 'cursor',
  previewSearchEngine: 'https://www.google.com/search?q={q}',
  enableTextSearchPreview: true,
  
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
};

// 获取浏览器语言
function getBrowserLanguage() {
  // 获取浏览器语言设置
  const browserLang = navigator.language.toLowerCase();
  
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
function getI18nMessage(messageName, fallback = '') {
  try {
    const message = chrome.i18n.getMessage(messageName);
    return message || fallback;
  } catch (error) {
    console.error('Failed to get i18n message:', error.message);
    return fallback;
  }
}

// DOM 元素
let enableGestureCheckbox = null;
let gestureTrailCheckbox = null;
let gestureHintCheckbox = null;
let trailColorInput = null;
let trailWidthInput = null;
let trailWidthValue = null;
let superDragCheckbox = null;
let imagePreviewCheckbox = null;
let duplicateCheckCheckbox = null;
let autoCloseDuplicatesCheckbox = null;
let saveStatus = null;
let resetButton = null;
let exportButton = null;
let importButton = null;
let importFileInput = null;
let themeToggle = null;
let debugEnabledState = false; // 调试面板开关状态（无需复选框）

// 更新界面文本
function updateUIText(lang) {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    element.textContent = getI18nMessage(key, element.textContent);
  });
  
  // 更新按钮的title属性
  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    const key = element.getAttribute('data-i18n-title');
    element.title = getI18nMessage(key, element.title);
  });
}

// 切换主题
function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  
  document.documentElement.setAttribute('data-theme', newTheme);
  // 更新主题切换按钮图标：深色模式显示太阳☀️，浅色模式显示月亮🌙
  themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
  
  // 保存主题设置
  chrome.storage.sync.set({ theme: newTheme }, () => {
    if (chrome.runtime.lastError) {
              console.log('Save theme setting error:', chrome.runtime.lastError.message);
      // 获取当前语言
      let currentLang = getBrowserLanguage();
      showStatusMessage('saveError', true);
      return;
    }
    
    // 显示设置已保存的消息
    showStatusMessage('settingsSaved');
    
    // 立即通知所有标签页设置已更新
    notifySettingsUpdated();
    
    // 记录主题变更 - 用于调试
    console.log('Theme switched and saved as:', newTheme);
  });
}

// 隐藏/显示控制按钮
function toggleControlButtonsVisibility(hide = true) {
  if (exportButton) exportButton.style.display = hide ? 'none' : '';
  if (importButton) importButton.style.display = hide ? 'none' : '';
  if (resetButton) resetButton.style.display = hide ? 'none' : '';
}

// 显示状态消息
function showStatusMessage(messageKey, isError = false) {
  // 使用saveStatus元素显示状态消息
  const message = getI18nMessage(messageKey, messageKey);
  saveStatus.textContent = message;
  saveStatus.style.color = isError ? '#F44336' : '#4CAF50'; // 红色表示错误，绿色表示成功
  saveStatus.classList.add('show');
  
  // 隐藏导入、导出、重设按钮（使用 visibility 避免布局抖动）
  toggleControlButtonsVisibility(true);
  
  // 使用配置常量替代硬编码
  setTimeout(() => {
    saveStatus.classList.remove('show');
    // 恢复默认颜色并清空文本内容
    setTimeout(() => {
      saveStatus.style.color = '#4CAF50';
      saveStatus.textContent = '';
      
      // 恢复显示导入、导出、重设按钮
      toggleControlButtonsVisibility(false);
    }, CONFIG.FADE_DURATION);
  }, CONFIG.STATUS_MESSAGE_DURATION);
}

// 显示区域特定的保存状态
function showSectionSaveStatus(sectionId, messageKey, isError = false) {
  const statusElement = document.getElementById(sectionId);
  if (!statusElement) return;
  
  // 找到对应的操作提示元素
  const statusContainer = statusElement.closest('.status-container');
  const operationHint = statusContainer ? statusContainer.querySelector('.operation-hint') : null;
  
  const message = getI18nMessage(messageKey, messageKey);
  statusElement.textContent = message;
  statusElement.style.color = isError ? '#F44336' : '#4CAF50';
  statusElement.classList.add('show');
  
  // 隐藏操作提示
  if (operationHint) {
    operationHint.style.opacity = '0';
  }
  
  // 隐藏导入、导出、重设按钮（使用 visibility 避免布局抖动）
  toggleControlButtonsVisibility(true);
  
  // 使用配置常量替代硬编码
  setTimeout(() => {
    statusElement.classList.remove('show');
    // 恢复默认颜色并清空文本内容
    setTimeout(() => {
      statusElement.style.color = '#4CAF50';
      statusElement.textContent = '';
      // 显示操作提示
      if (operationHint) {
        operationHint.style.opacity = '0.9';
      }
      // 恢复显示导入、导出、重设按钮
      toggleControlButtonsVisibility(false);
    }, CONFIG.FADE_DURATION);
  }, CONFIG.STATUS_MESSAGE_DURATION - 1000); // 区域消息显示时间稍短
}

// 设置按钮状态
function setButtonState(button, isLoading, isDisabled = false, successMessage = null) {
  button.disabled = isLoading || isDisabled;
  
  if (isLoading) {
    button.classList.add('loading');
    
    // 添加加载动画
    const originalHTML = button.innerHTML;
    button.setAttribute('data-original-text', originalHTML);
    button.innerHTML = '<span class="loading-dots">...</span>';
    
    // 为防止内存泄漏，确保只有一个动画定时器在运行
    if (button._loadingInterval) {
      clearInterval(button._loadingInterval);
    }
    
    // 创建加载动画
    let dots = 0;
    button._loadingInterval = setInterval(() => {
      dots = (dots + 1) % 4;
      const dotsText = '.'.repeat(dots);
      button.querySelector('.loading-dots').textContent = dotsText;
    }, CONFIG.LOADING_ANIMATION_INTERVAL);
  } else {
    button.classList.remove('loading');
    
    // 清除加载动画
    if (button._loadingInterval) {
      clearInterval(button._loadingInterval);
      button._loadingInterval = null;
    }
    
    // 恢复原始文本
    const originalHTML = button.getAttribute('data-original-text');
    if (originalHTML) {
      button.innerHTML = originalHTML;
    }
    
    // 如果成功，使用saveStatus显示成功消息
    if (successMessage) {
      saveStatus.textContent = successMessage;
      saveStatus.style.color = '#4CAF50';
      saveStatus.classList.add('show');
      
      // 隐藏导入、导出、重设按钮（使用 visibility 避免布局抖动）
      toggleControlButtonsVisibility(true);
      
      // 使用配置常量替代硬编码
      setTimeout(() => {
        saveStatus.classList.remove('show');
        // 恢复默认颜色并清空文本内容
        setTimeout(() => {
          saveStatus.style.color = '#4CAF50';
          saveStatus.textContent = '';
          // 恢复显示导入、导出、重设按钮
          toggleControlButtonsVisibility(false);
        }, CONFIG.FADE_DURATION);
      }, CONFIG.STATUS_MESSAGE_DURATION - 1000);
    }
  }
}

// 加载设置
function loadSettings() {
  try {
    chrome.storage.sync.get({
      enableGesture: true, // 默认值，仅在首次安装时使用
      showGestureTrail: true,
      showGestureHint: true,
      trailColor: '#FF9ECD',
      trailWidth: 3,
      enableSuperDrag: true,
      enableDragTextSearch: true,
      autoDownloadOnDragFile: false,
      enableImagePreview: true,
      enableDuplicateCheck: true,
      autoCloseDetectedTabs: false,
      enableSmoothScroll: true,
      enableDebugPanel: false,
      showTabCountBadge: true,
      language: getBrowserLanguage(),
      theme: 'light', // 明确指定默认主题为light
      
      // 超级拖拽方向自定义，全部设为后台打开
      dragUpAction: 'background',
      dragRightAction: 'background',
      dragDownAction: 'background',
      dragLeftAction: 'background',
      dragSearchEngine: 'https://www.google.com/search?q={q}',
      
      // 链接预览设置
      previewEnabled: true,
      previewHoverDelay: 200,
      previewModifierKey: 'Shift',
      previewMaxWindows: 20,
      previewDefaultWidth: 480,
      previewDefaultHeight: 320,
      previewPosition: 'cursor',
      previewSearchEngine: 'https://www.google.com/search?q={q}',
      enableTextSearchPreview: true,
      
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
    }, function(items) {
      // 应用鼠标手势设置
      document.getElementById('enable-gesture').checked = items.enableGesture; // 从存储中读取真实状态
      document.getElementById('gesture-trail').checked = items.showGestureTrail;
      document.getElementById('gesture-hint').checked = items.showGestureHint;
      document.getElementById('trail-color').value = items.trailColor;
      document.getElementById('trail-width').value = items.trailWidth;
      document.getElementById('trail-width-value').textContent = items.trailWidth;
      document.getElementById('super-drag').checked = items.enableSuperDrag;
      document.getElementById('drag-text-search').checked = items.enableDragTextSearch;
      document.getElementById('auto-download-on-drag-file').checked = !!items.autoDownloadOnDragFile;
      document.getElementById('image-preview').checked = items.enableImagePreview;
      document.getElementById('duplicate-check').checked = items.enableDuplicateCheck;
      document.getElementById('auto-close-duplicates').checked = items.autoCloseDetectedTabs;
      document.getElementById('smooth-scroll').checked = items.enableSmoothScroll;
      document.getElementById('show-tab-count-badge').checked = items.showTabCountBadge;
      
      // 调试面板状态（不使用复选框，使用内存状态+图标透明度）
      debugEnabledState = !!items.enableDebugPanel;
      const debugIcon = document.getElementById('enable-debug-panel-icon');
      if (debugIcon) {
        debugIcon.style.opacity = debugEnabledState ? '1' : '0.25';
      }
      
      // 应用超级拖拽方向自定义
      document.getElementById('drag-up-action').value = items.dragUpAction || 'background';
      document.getElementById('drag-right-action').value = items.dragRightAction || 'background';
      document.getElementById('drag-down-action').value = items.dragDownAction || 'background';
      document.getElementById('drag-left-action').value = items.dragLeftAction || 'background';
      document.getElementById('drag-search-engine').value = items.dragSearchEngine;
      
      // 应用链接预览设置
      document.getElementById('preview-enabled').checked = items.previewEnabled;
      document.getElementById('preview-modifier-key').value = items.previewModifierKey;
      document.getElementById('preview-hover-delay').value = items.previewHoverDelay;
      document.getElementById('preview-hover-delay-value').textContent = items.previewHoverDelay;
      document.getElementById('preview-max-windows').value = items.previewMaxWindows;
      document.getElementById('preview-max-windows-value').textContent = items.previewMaxWindows;
      document.getElementById('preview-width').value = items.previewDefaultWidth;
      document.getElementById('preview-width-value').textContent = items.previewDefaultWidth;
      document.getElementById('preview-height').value = items.previewDefaultHeight;
      document.getElementById('preview-height-value').textContent = items.previewDefaultHeight;
      document.getElementById('preview-position').value = items.previewPosition;
      document.getElementById('preview-search-engine').value = items.previewSearchEngine;
      document.getElementById('text-search-preview').checked = items.enableTextSearchPreview;
      
      // 应用手势动作自定义设置
      document.getElementById('gesture-left-action').value = items.gestureLeftAction || 'goBack';
      document.getElementById('gesture-right-action').value = items.gestureRightAction || 'forward';
      document.getElementById('gesture-up-action').value = items.gestureUpAction || 'scrollUp';
      document.getElementById('gesture-down-action').value = items.gestureDownAction || 'scrollDown';
      document.getElementById('gesture-downThenRight-action').value = items.gestureDownThenRightAction || 'closeTab';
      document.getElementById('gesture-leftThenUp-action').value = items.gestureLeftThenUpAction || 'reopenClosedTab';
      document.getElementById('gesture-rightThenUp-action').value = items.gestureRightThenUpAction || 'openNewTab';
      document.getElementById('gesture-rightThenDown-action').value = items.gestureRightThenDownAction || 'refresh';
      document.getElementById('gesture-upThenLeft-action').value = items.gestureUpThenLeftAction || 'switchToLeftTab';
      document.getElementById('gesture-upThenRight-action').value = items.gestureUpThenRightAction || 'switchToRightTab';
      document.getElementById('gesture-downThenLeft-action').value = items.gestureDownThenLeftAction || 'stopLoading';
      document.getElementById('gesture-leftThenDown-action').value = items.gestureLeftThenDownAction || 'forceRefresh';
      document.getElementById('gesture-upThenDown-action').value = items.gestureUpThenDownAction || 'scrollToBottom';
      document.getElementById('gesture-downThenUp-action').value = items.gestureDownThenUpAction || 'scrollToTop';
      document.getElementById('gesture-leftThenRight-action').value = items.gestureLeftThenRightAction || 'closeTab';
      document.getElementById('gesture-rightThenLeft-action').value = items.gestureRightThenLeftAction || 'reopenClosedTab';
      
      // 自定义行为：禁用网站列表
      const disabledSitesEl = document.getElementById('disabled-sites-list');
      if (disabledSitesEl) disabledSitesEl.value = (items.disabledSites || []).join('\n');
      
      // 根据触发按键设置调整小窗延迟范围
      updatePreviewDelayRange(items.previewModifierKey);
      
      // 应用主题设置 - 确保使用明确加载的主题值
      const theme = items.theme || 'light';
      document.documentElement.setAttribute('data-theme', theme);
      // 根据主题更新切换按钮文本：深色模式显示太阳☀️，浅色模式显示月亮🌙
      themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
      console.log('加载主题:', theme); // 调试日志
      
      // 应用语言设置
      const lang = items.language || getBrowserLanguage();
      updateUIText(lang);
      
      // 根据鼠标手势是否启用来设置相关选项的禁用状态
      updateGestureRelatedOptions(items.enableGesture);
      
      // 根据重复标签检测是否启用来设置自动关闭选项的禁用状态
      updateDuplicateTabOptions(items.enableDuplicateCheck);
      
      // 根据超级拖拽是否启用来设置相关选项的禁用状态
      updateSuperDragRelatedOptions(items.enableSuperDrag);
      
      // 根据链接预览是否启用来设置相关选项的禁用状态
      updatePreviewRelatedOptions(items.previewEnabled);

      console.log('设置加载完成，鼠标手势状态:', items.enableGesture);
    });
  } catch (e) {
    console.error('加载设置发生错误:', e.message);
    showStatusMessage('loadError', true);
  }
}

// 更新与手势相关的选项的启用/禁用状态
function updateGestureRelatedOptions(enableGesture) {
  // 设置相关DOM元素的禁用状态
  gestureTrailCheckbox.disabled = !enableGesture;
  gestureHintCheckbox.disabled = !enableGesture;
  trailColorInput.disabled = !enableGesture;
  trailWidthInput.disabled = !enableGesture;
  
  // 更新视觉反馈
  const gestureRelatedOptions = [
    gestureTrailCheckbox.parentElement,
    gestureHintCheckbox.parentElement,
    trailColorInput.parentElement,
    trailWidthInput.parentElement
  ];
  
  gestureRelatedOptions.forEach(element => {
    if (enableGesture) {
      element.classList.remove('disabled-option');
      element.classList.remove('no-hover-effect'); // 移除禁用悬停效果类
    } else {
      element.classList.add('disabled-option');
      element.classList.add('no-hover-effect'); // 添加禁用悬停效果类
    }
  });
  
  // 记录状态变化 - 用于调试
  console.log('手势相关选项状态已更新, 启用状态:', enableGesture);
}

// 更新与重复标签检测相关的选项的启用/禁用状态
function updateDuplicateTabOptions(enableDuplicateCheck) {
  autoCloseDuplicatesCheckbox.disabled = !enableDuplicateCheck;
  
  // 更新视觉反馈
  if (enableDuplicateCheck) {
    autoCloseDuplicatesCheckbox.parentElement.style.opacity = '1';
    autoCloseDuplicatesCheckbox.parentElement.classList.remove('no-hover-effect'); // 移除禁用悬停效果类
  } else {
    autoCloseDuplicatesCheckbox.parentElement.style.opacity = '0.6';
    autoCloseDuplicatesCheckbox.parentElement.classList.add('no-hover-effect'); // 添加禁用悬停效果类
  }
}

// 更新与超级拖拽相关的选项的启用/禁用状态
function updateSuperDragRelatedOptions(enableSuperDrag) {
  const dragTextSearchCheckbox = document.getElementById('drag-text-search');
  dragTextSearchCheckbox.disabled = !enableSuperDrag;
  
  // 更新视觉反馈
  if (enableSuperDrag) {
    dragTextSearchCheckbox.parentElement.style.opacity = '1';
    dragTextSearchCheckbox.parentElement.classList.remove('no-hover-effect'); // 移除禁用悬停效果类
  } else {
    dragTextSearchCheckbox.parentElement.style.opacity = '0.6';
    dragTextSearchCheckbox.parentElement.classList.add('no-hover-effect'); // 添加禁用悬停效果类
  }
}

// 更新与小窗视图相关的选项的启用/禁用状态
function updatePreviewRelatedOptions(enablePreview) {
  // 获取所有相关的设置项元素
  const textSearchPreview = document.getElementById('text-search-preview');
  const previewModifierKey = document.getElementById('preview-modifier-key');
  const previewHoverDelay = document.getElementById('preview-hover-delay');
  const previewMaxWindows = document.getElementById('preview-max-windows');
  const previewWidth = document.getElementById('preview-width');
  const previewHeight = document.getElementById('preview-height');
  const previewPosition = document.getElementById('preview-position');
  const previewSearchEngine = document.getElementById('preview-search-engine');
  
  // 设置禁用状态
  textSearchPreview.disabled = !enablePreview;
  previewModifierKey.disabled = !enablePreview;
  previewHoverDelay.disabled = !enablePreview;
  previewMaxWindows.disabled = !enablePreview;
  previewWidth.disabled = !enablePreview;
  previewHeight.disabled = !enablePreview;
  previewPosition.disabled = !enablePreview;
  previewSearchEngine.disabled = !enablePreview;
  
  // 更新视觉反馈
  const previewRelatedOptions = [
    textSearchPreview.parentElement,
    previewModifierKey.parentElement,
    previewHoverDelay.parentElement,
    previewMaxWindows.parentElement,
    previewWidth.parentElement,
    previewHeight.parentElement,
    previewPosition.parentElement,
    previewSearchEngine.parentElement
  ];
  
  previewRelatedOptions.forEach(element => {
    if (enablePreview) {
      element.style.opacity = '1';
      element.classList.remove('no-hover-effect'); // 移除禁用悬停效果类
    } else {
      element.style.opacity = '0.6';
      element.classList.add('no-hover-effect'); // 添加禁用悬停效果类
    }
  });
  
  // 如果小窗视图已启用，还需要检查文字搜索是否启用来确定搜索引擎URL的状态
  if (enablePreview) {
    updateTextSearchPreviewOptions(textSearchPreview.checked);
  }
}

// 更新选中文字搜索相关选项的启用/禁用状态
function updateTextSearchPreviewOptions(enableTextSearch) {
  const previewSearchEngine = document.getElementById('preview-search-engine');
  
  // 只有当小窗视图启用时，这个函数才有效
  if (document.getElementById('preview-enabled').checked) {
    // 设置搜索引擎URL的禁用状态
    previewSearchEngine.disabled = !enableTextSearch;
    
    // 更新视觉反馈
    if (enableTextSearch) {
      previewSearchEngine.parentElement.style.opacity = '1';
      previewSearchEngine.parentElement.classList.remove('no-hover-effect'); // 移除禁用悬停效果类
    } else {
      previewSearchEngine.parentElement.style.opacity = '0.6';
      previewSearchEngine.parentElement.classList.add('no-hover-effect'); // 添加禁用悬停效果类
    }
  }
}

// 为所有滑块设置项添加鼠标滚轮控制
function setupRangeWheelControl() {
  // 获取所有range类型的输入元素
  const rangeInputs = document.querySelectorAll('input[type="range"]');
  
  // 获取当前语言
  const currentLang = getBrowserLanguage();
  
  rangeInputs.forEach(rangeInput => {
    // 获取相应的值显示元素
    const valueDisplay = document.getElementById(`${rangeInput.id}-value`);
    // 获取步长，如果未设置则默认为1
    const step = parseInt(rangeInput.step) || 1;
    
    // 为滑块的父元素添加滚轮事件监听器
    rangeInput.parentElement.addEventListener('wheel', function(event) {
      // 如果控件或父元素被禁用，则不处理滚轮事件
      if (rangeInput.disabled || rangeInput.parentElement.classList.contains('no-hover-effect')) {
        return;
      }
      
      // 阻止页面滚动
      event.preventDefault();
      
      // 获取当前值
      let currentValue = parseInt(rangeInput.value);
      
      // 根据滚轮方向调整值（向上滚动增加，向下滚动减少）
      if (event.deltaY < 0) {
        // 向上滚动，增加值
        currentValue = Math.min(parseInt(rangeInput.max), currentValue + step);
      } else {
        // 向下滚动，减少值
        currentValue = Math.max(parseInt(rangeInput.min), currentValue - step);
      }
      
      // 更新滑块值
      rangeInput.value = currentValue;
      
      // 更新显示值
      if (valueDisplay) {
        valueDisplay.textContent = currentValue;
      }
      
      // 触发change事件以保存设置
      const changeEvent = new Event('change', { bubbles: true });
      rangeInput.dispatchEvent(changeEvent);
      
      // 添加一个轻微的视觉反馈
      rangeInput.classList.add('wheel-adjusted');
      setTimeout(() => {
        rangeInput.classList.remove('wheel-adjusted');
      }, 200);
    });
    
    // 添加鼠标悬停提示
    rangeInput.parentElement.setAttribute('title', getI18nMessage('wheelTip'));
  });
  
  // 更新延迟范围提示（如果需要）
  updateDelayTitleForLanguage(currentLang);
}

// 根据触发按键的选择调整小窗延迟的范围
function updatePreviewDelayRange(modifierKey) {
  const previewHoverDelay = document.getElementById('preview-hover-delay');
  const previewHoverDelayValue = document.getElementById('preview-hover-delay-value');
  const delayParent = previewHoverDelay.parentElement;
  
  // 获取当前语言
  const currentLang = getBrowserLanguage();
  
  // 如果触发按键不是"无需按键"，则将最大延迟限制为配置值
  if (modifierKey !== 'none') {
    // 设置最大值为配置值
    previewHoverDelay.max = CONFIG.MAX_PREVIEW_DELAY.toString();
    
    // 如果当前值超过配置值，则调整为配置值
    if (parseInt(previewHoverDelay.value) > CONFIG.MAX_PREVIEW_DELAY) {
      previewHoverDelay.value = CONFIG.MAX_PREVIEW_DELAY.toString();
      previewHoverDelayValue.textContent = CONFIG.MAX_PREVIEW_DELAY.toString();
    }
    
    // 视觉提示
    delayParent.setAttribute('title', getI18nMessage('modifierKeyDelayTip'));
  } else {
    // 恢复默认最大值
    previewHoverDelay.max = CONFIG.DEFAULT_PREVIEW_DELAY.toString();
    
    // 恢复滚轮提示
    delayParent.setAttribute('title', getI18nMessage('wheelTip'));
  }
}

// 根据语言更新延迟提示
function updateDelayTitleForLanguage(lang) {
  const previewHoverDelay = document.getElementById('preview-hover-delay');
  const modifierKey = document.getElementById('preview-modifier-key').value;
  
  if (previewHoverDelay) {
    const delayParent = previewHoverDelay.parentElement;
    
    if (modifierKey !== 'none') {
      delayParent.setAttribute('title', getI18nMessage('modifierKeyDelayTip'));
    } else {
      delayParent.setAttribute('title', getI18nMessage('wheelTip'));
    }
  }
}

// 通知所有标签页设置已更新
function notifySettingsUpdated() {
  // 查询所有标签页并发送消息
  chrome.tabs.query({}, function(tabs) {
    if (chrome.runtime.lastError) {
      console.log('查询标签页错误:', chrome.runtime.lastError.message);
      return;
    }
    
    // 创建一个Promise数组来处理所有发送消息的操作
    const messagePromises = [];
    
    for (let tab of tabs) {
      // 跳过Chrome内部页面，这些页面无法接收消息
      if (tab.url && (tab.url.startsWith('chrome://') || 
                     tab.url.startsWith('edge://') || 
                     tab.url.startsWith('about:'))) {
        continue;
      }
      
      // 使用Promise包装sendMessage调用，以便捕获异常但不中断流程
      const messagePromise = new Promise((resolve) => {
        try {
          chrome.tabs.sendMessage(tab.id, { action: "settingsUpdated" }, () => {
            // 静默处理chrome.runtime.lastError，防止错误冒泡
            if (chrome.runtime.lastError) {
              // 某些标签页可能没有内容脚本加载，这是正常的
              resolve(false);
            } else {
              resolve(true);
            }
          });
        } catch (e) {
          // 捕获任何可能的异常
          console.log('向标签页发送消息失败:', tab.id, e.message);
          resolve(false);
        }
      });
      
      messagePromises.push(messagePromise);
    }
    
    // 使用Promise.all确保所有消息处理完毕
    Promise.all(messagePromises)
      .then(() => {
        // 所有消息发送完成后，通知后台脚本
        chrome.runtime.sendMessage({ action: "settingsUpdated" }, (response) => {
          // 静默处理后台脚本的响应错误
          if (chrome.runtime.lastError) {
            console.log('后台脚本通知错误，这可能是正常的');
          }
        });
      })
      .catch(error => {
        // 这里不应该发生错误，因为我们已经在每个Promise中处理了异常
        // 但为了完整性，仍然添加错误处理
        console.log('发送设置更新消息时出现意外错误:', error);
      });
  });
}

// 获取当前设置快照
function getSettingsSnapshot() {
  return {
    enableGesture: enableGestureCheckbox.checked,
    showGestureTrail: gestureTrailCheckbox.checked,
    showGestureHint: gestureHintCheckbox.checked,
    trailColor: trailColorInput.value,
    trailWidth: parseInt(trailWidthInput.value),
    enableSuperDrag: superDragCheckbox.checked,
    enableDragTextSearch: document.getElementById('drag-text-search').checked,
    autoDownloadOnDragFile: document.getElementById('auto-download-on-drag-file').checked,
    enableImagePreview: imagePreviewCheckbox.checked,
    enableDuplicateCheck: duplicateCheckCheckbox.checked,
    autoCloseDetectedTabs: autoCloseDuplicatesCheckbox.checked,
    enableSmoothScroll: document.getElementById('smooth-scroll').checked,
    showTabCountBadge: document.getElementById('show-tab-count-badge').checked,
    language: getBrowserLanguage(),
    theme: document.documentElement.getAttribute('data-theme') || 'light',
    enableDebugPanel: debugEnabledState,
    // 超级拖拽方向自定义
    dragUpAction: document.getElementById('drag-up-action').value,
    dragRightAction: document.getElementById('drag-right-action').value,
    dragDownAction: document.getElementById('drag-down-action').value,
    dragLeftAction: document.getElementById('drag-left-action').value,
    dragSearchEngine: document.getElementById('drag-search-engine').value,
    // 小窗视图设置
    previewEnabled: document.getElementById('preview-enabled').checked,
    previewHoverDelay: parseInt(document.getElementById('preview-hover-delay').value),
    previewModifierKey: document.getElementById('preview-modifier-key').value,
    previewMaxWindows: parseInt(document.getElementById('preview-max-windows').value),
    previewDefaultWidth: parseInt(document.getElementById('preview-width').value),
    previewDefaultHeight: parseInt(document.getElementById('preview-height').value),
    previewPosition: document.getElementById('preview-position').value,
    previewSearchEngine: document.getElementById('preview-search-engine').value,
    enableTextSearchPreview: document.getElementById('text-search-preview').checked,
    // 手势动作自定义设置
    gestureLeftAction: document.getElementById('gesture-left-action').value,
    gestureRightAction: document.getElementById('gesture-right-action').value,
    gestureUpAction: document.getElementById('gesture-up-action').value,
    gestureDownAction: document.getElementById('gesture-down-action').value,
    gestureDownThenRightAction: document.getElementById('gesture-downThenRight-action').value,
    gestureLeftThenUpAction: document.getElementById('gesture-leftThenUp-action').value,
    gestureRightThenUpAction: document.getElementById('gesture-rightThenUp-action').value,
    gestureRightThenDownAction: document.getElementById('gesture-rightThenDown-action').value,
    gestureUpThenLeftAction: document.getElementById('gesture-upThenLeft-action').value,
    gestureUpThenRightAction: document.getElementById('gesture-upThenRight-action').value,
    gestureDownThenLeftAction: document.getElementById('gesture-downThenLeft-action').value,
    gestureLeftThenDownAction: document.getElementById('gesture-leftThenDown-action').value,
    gestureUpThenDownAction: document.getElementById('gesture-upThenDown-action').value,
    gestureDownThenUpAction: document.getElementById('gesture-downThenUp-action').value,
    gestureLeftThenRightAction: document.getElementById('gesture-leftThenRight-action').value,
    gestureRightThenLeftAction: document.getElementById('gesture-rightThenLeft-action').value,
    disabledSites: (document.getElementById('disabled-sites-list')?.value || '').split(/\n/).map(s => s.trim()).filter(Boolean)
  };
}

// 防抖保存设置 - 性能优化
const debouncedSaveSettings = CommonUtils.debounce(() => {
  try {
    const settings = getSettingsSnapshot();
    chrome.storage.sync.set(settings, handleSaveResponse);
  } catch (e) {
    CommonUtils.handleError(e, 'saveSettings');
  }
}, CONFIG.DEBOUNCE_DELAY);

// 保存设置
function saveSettings(event = null) {
  debouncedSaveSettings();
}

// 立即保存设置（用于需要立即保存的场景）
function saveSettingsImmediate() {
  try {
    const settings = getSettingsSnapshot();
    chrome.storage.sync.set(settings, handleSaveResponse);
  } catch (e) {
    CommonUtils.handleError(e, 'saveSettings');
  }
}

// 重置设置
function resetSettings() {
  try {
    // 获取当前语言
    let currentLang = getBrowserLanguage();
    
    // 显示重置进行中状态
    resetButton.disabled = true;
    saveStatus.textContent = getI18nMessage('resetting');
    saveStatus.style.color = '#FFA500'; // 橙色，表示进行中
    saveStatus.classList.add('show');
    
    // 隐藏导入、导出、重设按钮（使用 visibility 避免布局抖动）
    toggleControlButtonsVisibility(true);
    
    // 创建一个深拷贝的默认设置对象
    const resetConfig = JSON.parse(JSON.stringify(defaultSettings));
    
    // 不再保留当前语言设置，使用浏览器默认语言 (默认设置中已经包含)
    // 注意：只保留主题设置，方便用户体验
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    resetConfig.theme = currentTheme;
    
    // 保存重置后的设置
    chrome.storage.sync.set(resetConfig, () => {
      if (chrome.runtime.lastError) {
        console.log('重置设置错误:', chrome.runtime.lastError.message);
        resetButton.disabled = false;
        saveStatus.textContent = getI18nMessage('resetError');
        saveStatus.style.color = '#F44336'; // 红色，表示错误
        // 保持按钮隐藏状态，等待消息消失后恢复
        setTimeout(() => {
          saveStatus.classList.remove('show');
          setTimeout(() => {
            saveStatus.style.color = '#4CAF50';
            saveStatus.textContent = '';
            toggleControlButtonsVisibility(false);
          }, CONFIG.FADE_DURATION);
        }, CONFIG.STATUS_MESSAGE_DURATION);
        return;
      }
      
      // 加载默认设置到界面
      loadSettings();
      
      // 确保小窗视图设置也被正确更新
      // 立即更新界面上的值，不等待加载
      document.getElementById('preview-enabled').checked = resetConfig.previewEnabled;
      document.getElementById('preview-modifier-key').value = resetConfig.previewModifierKey;
      document.getElementById('preview-hover-delay').value = resetConfig.previewHoverDelay;
      document.getElementById('preview-hover-delay-value').textContent = resetConfig.previewHoverDelay;
      document.getElementById('preview-max-windows').value = resetConfig.previewMaxWindows;
      document.getElementById('preview-max-windows-value').textContent = resetConfig.previewMaxWindows;
      document.getElementById('preview-width').value = resetConfig.previewDefaultWidth;
      document.getElementById('preview-width-value').textContent = resetConfig.previewDefaultWidth;
      document.getElementById('preview-height').value = resetConfig.previewDefaultHeight;
      document.getElementById('preview-height-value').textContent = resetConfig.previewDefaultHeight;
      document.getElementById('preview-position').value = resetConfig.previewPosition;
      document.getElementById('preview-search-engine').value = resetConfig.previewSearchEngine;
      document.getElementById('text-search-preview').checked = resetConfig.enableTextSearchPreview;
      // 更新调试面板状态
      debugEnabledState = resetConfig.enableDebugPanel;
      const debugIcon = document.getElementById('enable-debug-panel-icon');
      if (debugIcon) {
        debugIcon.style.opacity = debugEnabledState ? '1' : '0.25';
      }
      
      // 更新标签页数量徽章设置
      document.getElementById('show-tab-count-badge').checked = resetConfig.showTabCountBadge;
      
      // 通知内容脚本设置已更新
      notifySettingsUpdated();
      
      // 显示重置成功状态
      resetButton.disabled = false;
      
      // 获取重置后的语言进行提示
      const browserLang = getBrowserLanguage();
      saveStatus.textContent = getI18nMessage('settingsReset');
      saveStatus.style.color = '#4CAF50'; // 绿色，表示成功
      
      // 更新UI语言
      updateUIText(browserLang);
      
      // 使用配置常量恢复原始状态
      setTimeout(() => {
        saveStatus.classList.remove('show');
        setTimeout(() => {
          saveStatus.style.color = '#4CAF50'; // 恢复默认颜色
          saveStatus.textContent = '';
          // 恢复显示导入、导出、重设按钮
          toggleControlButtonsVisibility(false);
        }, CONFIG.FADE_DURATION);
      }, CONFIG.RESET_BUTTON_DISABLE_DURATION);
    });
  } catch (e) {
    console.log('重置设置异常:', e.message);
    resetButton.disabled = false;
    saveStatus.classList.remove('show');
    // 恢复显示按钮
    toggleControlButtonsVisibility(false);
  }
}

// 导出设置到 JSON 文件
function exportSettings() {
  try {
    chrome.storage.sync.get(null, (items) => {
      if (chrome.runtime.lastError) {
        showStatusMessage('exportError', true);
        return;
      }
      
      // 添加导出元数据
      const exportData = {
        version: chrome.runtime.getManifest().version,
        exportDate: new Date().toISOString(),
        settings: items
      };
      
      // 创建 JSON 字符串
      const jsonString = JSON.stringify(exportData, null, 2);
      
      // 创建 Blob 并下载
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mouse-gesture-settings-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      showStatusMessage('exportSuccess');
    });
  } catch (e) {
    console.error('导出设置错误:', e.message);
    showStatusMessage('exportError', true);
  }
}

// 处理导入文件选择
function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const importData = JSON.parse(e.target.result);
      
      // 验证数据格式
      if (!importData.settings || typeof importData.settings !== 'object') {
        showStatusMessage('importError', true);
        return;
      }
      
      // 导入设置
      importSettings(importData.settings);
    } catch (error) {
      console.error('解析导入文件错误:', error.message);
      showStatusMessage('importError', true);
    }
  };
  
  reader.onerror = () => {
    showStatusMessage('importError', true);
  };
  
  reader.readAsText(file);
  
  // 清空文件输入，允许重复选择同一文件
  event.target.value = '';
}

// 导入设置
function importSettings(settings) {
  try {
    // 验证并清理设置数据
    const validSettings = {};
    const allowedKeys = [
      'enableGesture', 'showGestureTrail', 'showGestureHint', 'trailColor', 'trailWidth',
      'enableSuperDrag', 'enableDragTextSearch', 'autoDownloadOnDragFile', 'enableImagePreview', 'enableDuplicateCheck',
      'autoCloseDetectedTabs', 'enableSmoothScroll', 'enableDebugPanel', 'showTabCountBadge',
      'language', 'theme',
      'dragUpAction', 'dragRightAction', 'dragDownAction', 'dragLeftAction', 'dragSearchEngine',
      'previewEnabled', 'previewHoverDelay', 'previewModifierKey', 'previewMaxWindows',
      'previewDefaultWidth', 'previewDefaultHeight', 'previewPosition', 'previewSearchEngine',
      'enableTextSearchPreview',
      'gestureLeftAction', 'gestureRightAction', 'gestureUpAction', 'gestureDownAction',
      'gestureDownThenRightAction', 'gestureLeftThenUpAction', 'gestureRightThenUpAction',
      'gestureRightThenDownAction', 'gestureUpThenLeftAction', 'gestureUpThenRightAction',
      'gestureDownThenLeftAction', 'gestureLeftThenDownAction', 'gestureUpThenDownAction',
      'gestureDownThenUpAction', 'gestureLeftThenRightAction', 'gestureRightThenLeftAction',
      'disabledSites'
    ];
    
    // 只导入允许的设置项
    for (const key of allowedKeys) {
      if (key in settings) {
        validSettings[key] = settings[key];
      }
    }
    
    // 保存到 storage
    chrome.storage.sync.set(validSettings, () => {
      if (chrome.runtime.lastError) {
        showStatusMessage('importError', true);
        return;
      }
      
      // 重新加载设置到界面
      loadSettings();
      
      // 通知所有标签页设置已更新
      notifySettingsUpdated();
      
      showStatusMessage('importSuccess');
    });
  } catch (e) {
    console.error('导入设置错误:', e.message);
    showStatusMessage('importError', true);
  }
}

// 更新轨迹宽度显示
function updateTrailWidthValue() {
  trailWidthValue.textContent = trailWidthInput.value;
}

// 显示扩展版本号
function displayExtensionVersion() {
  const versionInfo = document.getElementById('version-info');
  // 从manifest获取版本号
  const manifest = chrome.runtime.getManifest();
  if (versionInfo && manifest) {
    // 更新版本显示
    versionInfo.innerHTML = `<a href="https://abcrk.com/reward" target="_blank"><img src="images/icon16.png" class="footer-icon" alt="icon"> v${manifest.version}</a>`;
    
    // 获取当前语言并更新提示文本
    chrome.storage.sync.get(['language'], (result) => {
      const tooltipText = getI18nMessage('donationTooltip');
      
      // 使用自定义属性存储提示文本
      versionInfo.setAttribute('data-tooltip', tooltipText);
    });
  }
}

// 初始化界面和事件监听
document.addEventListener('DOMContentLoaded', function() {
  // 初始化DOM元素引用
  enableGestureCheckbox = document.getElementById('enable-gesture');
  gestureTrailCheckbox = document.getElementById('gesture-trail');
  gestureHintCheckbox = document.getElementById('gesture-hint');
  trailColorInput = document.getElementById('trail-color');
  trailWidthInput = document.getElementById('trail-width');
  trailWidthValue = document.getElementById('trail-width-value');
  superDragCheckbox = document.getElementById('super-drag');
  imagePreviewCheckbox = document.getElementById('image-preview');
  duplicateCheckCheckbox = document.getElementById('duplicate-check');
  autoCloseDuplicatesCheckbox = document.getElementById('auto-close-duplicates');
  saveStatus = document.getElementById('save-status');
  resetButton = document.getElementById('reset-btn');
  exportButton = document.getElementById('export-btn');
  importButton = document.getElementById('import-btn');
  importFileInput = document.createElement('input');
  importFileInput.type = 'file';
  importFileInput.accept = '.json';
  importFileInput.style.display = 'none';
  document.body.appendChild(importFileInput);
  themeToggle = document.getElementById('theme-toggle');

  // 加载设置
  loadSettings();

  // 显示扩展版本号
  displayExtensionVersion();
  
  // 设置滑块的鼠标滚轮控制
  setupRangeWheelControl();

  // 添加事件监听器
  // 鼠标手势开关 - 添加即时更新UI状态的逻辑
  enableGestureCheckbox.addEventListener('change', function() {
    // 更新相关选项的启用/禁用状态
    updateGestureRelatedOptions(this.checked);
    
    // 立即保存设置
    saveSettings();
    
    // 记录状态变化 - 用于调试
    console.log('鼠标手势开关状态已更改为:', this.checked);
  });

  // 使用公共函数重构事件监听器
  CommonUtils.addChangeListener('gesture-trail', saveSettings);
  CommonUtils.addChangeListener('gesture-hint', saveSettings);
  
  // 颜色设置需要立即保存
  document.getElementById('trail-color').addEventListener('change', function() {
    saveSettingsImmediate();
  });
  
  CommonUtils.addInputListener('trail-width', 'trail-width-value', updateTrailWidthValue);
  
  // 轨迹宽度设置需要立即保存
  document.getElementById('trail-width').addEventListener('change', function() {
    saveSettingsImmediate();
  });
  
  // 超级拖拽开关 - 需要特殊处理
  superDragCheckbox.addEventListener('change', function() {
    updateSuperDragRelatedOptions(this.checked);
    saveSettingsImmediate(); // 立即保存
  });
  
  // 图片预览设置需要立即保存
  document.getElementById('image-preview').addEventListener('change', function() {
    saveSettingsImmediate();
  });
  
  CommonUtils.addChangeListener('drag-text-search', saveSettings);
  CommonUtils.addChangeListener('auto-download-on-drag-file', saveSettings);
  
  // 重复标签检测开关 - 需要特殊处理
  duplicateCheckCheckbox.addEventListener('change', function() {
    updateDuplicateTabOptions(this.checked);
    saveSettingsImmediate(); // 立即保存
  });
  
  CommonUtils.addChangeListener('auto-close-duplicates', saveSettings);
  
  // 自定义行为：禁用网站列表（失焦时保存）
  const disabledSitesListEl = document.getElementById('disabled-sites-list');
  if (disabledSitesListEl) {
    disabledSitesListEl.addEventListener('change', function() {
      saveSettingsImmediate();
      showSectionSaveStatus('customized-save-status', 'settingsSaved');
    });
  }
  
  // 平滑滚动设置需要立即保存
  document.getElementById('smooth-scroll').addEventListener('change', function() {
    saveSettingsImmediate();
  });
  
  // 标签页数量徽章设置需要立即保存
  document.getElementById('show-tab-count-badge').addEventListener('change', function() {
    saveSettingsImmediate();
  });
  const debugIcon = document.getElementById('enable-debug-panel-icon');
  if (debugIcon) {
    debugIcon.addEventListener('click', function() {
      debugEnabledState = !debugEnabledState;
      // 视觉状态
      debugIcon.style.opacity = debugEnabledState ? '1' : '0.25';
      saveSettings();
      showSectionSaveStatus('preview-save-status', 'settingsSaved');
    });
  }
  
  resetButton.addEventListener('click', resetSettings);
  if (exportButton) {
    exportButton.addEventListener('click', exportSettings);
  }
  if (importButton) {
    importButton.addEventListener('click', () => importFileInput.click());
  }
  importFileInput.addEventListener('change', handleImportFile);
  themeToggle.addEventListener('click', toggleTheme);
  
  // 小窗视图设置相关的事件监听器 - 使用公共函数重构
  document.getElementById('preview-enabled').addEventListener('change', function() {
    updatePreviewRelatedOptions(this.checked);
    saveSettingsImmediate(); // 立即保存
    showSectionSaveStatus('preview-save-status', 'settingsSaved');
  });
  
  // 修改触发按键的事件处理函数
  document.getElementById('preview-modifier-key').addEventListener('change', function() {
    updatePreviewDelayRange(this.value);
    saveSettingsImmediate(); // 立即保存
    showSectionSaveStatus('preview-save-status', 'settingsSaved');
  });
  
  // 使用公共函数重构输入和变化事件
  CommonUtils.addInputListener('preview-hover-delay', 'preview-hover-delay-value');
  CommonUtils.addChangeListener('preview-hover-delay', saveSettings, 'preview-save-status');
  CommonUtils.addInputListener('preview-max-windows', 'preview-max-windows-value');
  CommonUtils.addChangeListener('preview-max-windows', saveSettings, 'preview-save-status');
  CommonUtils.addInputListener('preview-width', 'preview-width-value');
  CommonUtils.addChangeListener('preview-width', saveSettings, 'preview-save-status');
  CommonUtils.addInputListener('preview-height', 'preview-height-value');
  CommonUtils.addChangeListener('preview-height', saveSettings, 'preview-save-status');
  CommonUtils.addChangeListener('preview-position', saveSettings, 'preview-save-status');
  CommonUtils.addChangeListener('preview-search-engine', saveSettings, 'preview-save-status');
  
  // 为选中文字搜索复选框添加更新UI的事件处理
  document.getElementById('text-search-preview').addEventListener('change', function() {
    updateTextSearchPreviewOptions(this.checked);
    saveSettingsImmediate(); // 立即保存
    showSectionSaveStatus('preview-save-status', 'settingsSaved');
  });
  
  // 为超级拖拽方向设置添加事件监听器 - 使用公共函数重构
  const superDragSelectors = ['drag-up-action', 'drag-right-action', 'drag-down-action', 'drag-left-action', 'drag-search-engine'];
  superDragSelectors.forEach(selector => {
    CommonUtils.addChangeListener(selector, saveSettings, 'superdrag-save-status');
  });
  
  // 为手势动作选择下拉框添加事件监听器 - 使用公共函数重构
  const gestureActionSelectors = [
    'gesture-left-action', 'gesture-right-action', 'gesture-up-action', 'gesture-down-action',
    'gesture-downThenRight-action', 'gesture-leftThenUp-action', 'gesture-rightThenUp-action',
    'gesture-rightThenDown-action', 'gesture-upThenLeft-action', 'gesture-upThenRight-action',
    'gesture-downThenLeft-action', 'gesture-leftThenDown-action', 'gesture-upThenDown-action',
    'gesture-downThenUp-action', 'gesture-leftThenRight-action', 'gesture-rightThenLeft-action'
  ];
  gestureActionSelectors.forEach(selector => {
    CommonUtils.addChangeListener(selector, saveSettings, 'gesture-save-status');
  });

  // 快速定位功能 - 点击标题进行快速定位
  const sections = [
    { id: 'settings-feature', nameKey: 'settings' },
    { id: 'customized-behavior-feature', nameKey: 'customizedBehavior' },
    { id: 'gesture-actions-feature', nameKey: 'builtInGestures' },
    { id: 'super-drag-feature', nameKey: 'superDragFeature' },
    { id: 'link-preview-feature', nameKey: 'linkPreview' }
  ];

  // 为所有h2标题添加点击事件
  const sectionHeaders = document.querySelectorAll('h2');
  sectionHeaders.forEach(header => {
    // 添加悬停提示
    header.addEventListener('mouseenter', function() {
      const currentSection = this.closest('.section');
      if (!currentSection) return;
      
      const currentSectionId = currentSection.id;
      const currentIndex = sections.findIndex(section => section.id === currentSectionId);
      
      if (currentIndex === -1) return;
      
      const nextIndex = (currentIndex + 1) % sections.length;
      const prevIndex = currentIndex === 0 ? sections.length - 1 : currentIndex - 1;
      const nextSection = sections[nextIndex];
      const prevSection = sections[prevIndex];
      
      // 使用国际化系统获取翻译
      const tooltipMessage = getI18nMessage('quickNavTooltip', 'quickNavTooltip');
      const nextSectionName = getI18nMessage(nextSection.nameKey, nextSection.nameKey);
      const prevSectionName = getI18nMessage(prevSection.nameKey, prevSection.nameKey);
      this.title = tooltipMessage.replace('{next}', nextSectionName).replace('{prev}', prevSectionName);
    });

    // 移除悬停提示
    header.addEventListener('mouseleave', function() {
      this.title = '';
    });

    // 左键点击 - 正向定位
    header.addEventListener('click', function(e) {
      e.preventDefault();
      
      // 找到当前点击的section
      const currentSection = this.closest('.section');
      if (!currentSection) return;
      
      const currentSectionId = currentSection.id;
      const currentIndex = sections.findIndex(section => section.id === currentSectionId);
      
      if (currentIndex === -1) return;
      
      // 计算下一个section的索引
      const nextIndex = (currentIndex + 1) % sections.length;
      const nextSection = sections[nextIndex];
      const targetElement = document.getElementById(nextSection.id);
      
      if (targetElement) {
        // 平滑滚动到目标位置
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });

    // 右键点击 - 反向定位
    header.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      
      // 找到当前点击的section
      const currentSection = this.closest('.section');
      if (!currentSection) return;
      
      const currentSectionId = currentSection.id;
      const currentIndex = sections.findIndex(section => section.id === currentSectionId);
      
      if (currentIndex === -1) return;
      
      // 计算上一个section的索引
      const prevIndex = currentIndex === 0 ? sections.length - 1 : currentIndex - 1;
      const prevSection = sections[prevIndex];
      const targetElement = document.getElementById(prevSection.id);
      
      if (targetElement) {
        // 平滑滚动到目标位置
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
}); 