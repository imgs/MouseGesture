// 禁用所有控制台日志
console.log = function() {};
console.error = function() {};
console.warn = function() {};
console.info = function() {};
console.debug = function() {};

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
    
    // 富文本编辑器框架
    if (tagName === 'iframe' || tagName === 'frame') return true;
    
    // CodeMirror, Monaco, Ace等编辑器常用的类名检测 - 使用更精确的匹配
    const className = element.className || '';
    if (className && typeof className === 'string') {
      // 使用单词边界或精确的编辑器类名匹配，避免匹配到部分词
      if (className.includes('CodeMirror') || 
          className.includes('monaco-editor') || 
          className.includes('ace_editor') || 
          className.match(/\beditor\b/) || 
          className.match(/\binput\b/) ||
          // 移除对text的通用匹配，避免匹配诸如text-bold等类名
          className.match(/\bfield\b/)) {
        return true;
      }
    }
    
    // 具有可编辑角色的元素
    const role = element.getAttribute('role');
    if (role === 'textbox' || role === 'combobox' || role === 'searchbox') {
      return true;
    }
    
    // 检查是否有类似编辑器的属性
    if (element.getAttribute('contenteditable') === 'true' || 
        element.getAttribute('aria-multiline') === 'true') {
      return true;
    }
    
    // 检查输入相关的ID或name - 使用更精确的匹配
    const id = (element.id || '').toLowerCase();
    const name = (element.name || '').toLowerCase();
    if (
      id.match(/\binput\b/) || 
      id.match(/\beditor\b/) ||
      name.match(/\binput\b/) || 
      name.match(/\beditor\b/)
      // 移除对text的通用匹配
    ) {
      return true;
    }
    
    // 更全面的DOM属性检测
    if (
      element.getAttribute('autocomplete') || 
      element.getAttribute('autocorrect') || 
      element.getAttribute('autocapitalize') || 
      element.getAttribute('spellcheck') === 'true'
    ) {
      return true;
    }
    
    return false;
  } catch (error) {
    // 出错时安全返回false
    return false;
  }
}

// 链接预览功能
// 实现在鼠标悬停+Ctrl键时显示链接预览窗口

// 预览状态管理
let previewSettings = {
  enabled: true,              // 链接预览功能开关
  hoverDelay: 200,            // 悬停延迟(毫秒)
  modifierKey: 'Shift',     // 修饰键: 'Control', 'Alt', 'Shift', 'none'
  maxPreviews: 20,             // 最大同时显示的预览窗口数
  defaultWidth: 480,          // 默认窗口宽度
  defaultHeight: 640,         // 默认窗口高度
  position: 'cursor',         // 位置: 'cursor', 'center', 'corner'
  searchEngine: 'https://www.google.com/search?q={q}', // 默认搜索引擎
  enableTextSearchPreview: true, // 选中文字触发搜索功能开关
  disabledSites: [] // 在此列表中的网站禁用小窗预览
};

// 当前活动的预览窗口
const activePreviewWindows = new Map();
// 预览计时器
let previewTimer = null;
// 当前悬停的链接元素
let currentHoverElement = null;
// 当前鼠标位置
let currentMousePosition = { x: 0, y: 0 };
// 当前是否按下修饰键
let isModifierKeyPressed = false;
// 预览窗口计数器
let previewCounter = 0;
// 当前文本选择
let currentTextSelection = null;

// 加载设置
function loadPreviewSettings() {
  try {
    chrome.storage.sync.get({
      previewEnabled: true,
      previewHoverDelay: 200,
      previewModifierKey: 'Shift',
      previewMaxWindows: 20,
      previewDefaultWidth: 480,
      previewDefaultHeight: 640,
      previewPosition: 'cursor',
      previewSearchEngine: 'https://www.google.com/search?q={q}',
      enableTextSearchPreview: true,
      disabledSites: []
    }, (items) => {
      // 检查chrome.runtime.lastError，可能是扩展上下文失效
      if (chrome.runtime.lastError) {
        console.log('加载预览设置错误:', chrome.runtime.lastError.message);
        // 如果是扩展上下文失效，停止进一步操作
        if (chrome.runtime.lastError.message.includes('Extension context invalidated')) {
          console.log('扩展上下文失效，预览功能将停止工作');
          return;
        }
        // 使用默认设置
        return;
      }
      
      previewSettings.enabled = items.previewEnabled;
      previewSettings.hoverDelay = items.previewHoverDelay;
      previewSettings.modifierKey = items.previewModifierKey;
      previewSettings.maxPreviews = items.previewMaxWindows;
      previewSettings.defaultWidth = items.previewDefaultWidth;
      previewSettings.defaultHeight = items.previewDefaultHeight;
      previewSettings.position = items.previewPosition;
      previewSettings.searchEngine = items.previewSearchEngine;
      previewSettings.enableTextSearchPreview = items.enableTextSearchPreview;
      previewSettings.disabledSites = items.disabledSites || [];
      
      console.log('预览设置已加载:', previewSettings);
    });
  } catch (error) {
    console.log('加载预览设置异常:', error.message);
    // 出现异常时不做任何操作，使用默认设置
  }
}

// 检查修饰键是否匹配
function isModifierKeyMatch(e) {
  // 如果设置为无需修饰键，则始终返回true
  if (previewSettings.modifierKey === 'none') return true;
  
  // 根据设置的修饰键检查对应的键是否按下
  if (previewSettings.modifierKey === 'Control') return e.ctrlKey;
  if (previewSettings.modifierKey === 'Alt') return e.altKey;
  if (previewSettings.modifierKey === 'Shift') return e.shiftKey;
  
  return false;
}

// 检查当前网址是否在禁用列表（与小窗预览共用 disabledSites）
function isSiteInDisabledListForPreview(href) {
  const list = previewSettings.disabledSites;
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

// 定期检查修饰键状态的函数
function checkModifierKeyState() {
  // 如果用户当前没有按下修饰键，但我们的状态却显示已按下，则重置状态
  if (isModifierKeyPressed) {
    // 创建一个模拟的键盘事件来检查当前状态
    const fakeEvent = {
      ctrlKey: false,
      altKey: false,
      shiftKey: false
    };
    
    if (!isModifierKeyMatch(fakeEvent)) {
      // 重置状态
      isModifierKeyPressed = false;
      console.log('检测到修饰键状态不一致，已重置状态');
      
      // 如果有预览计时器，取消它
      if (previewTimer) {
        clearTimeout(previewTimer);
        previewTimer = null;
        console.log('自动取消预览计时器');
      }
    }
  }
}

// 初始化
function initLinkPreview() {
  try {
    loadPreviewSettings();
    
    // 监听设置变更
    try {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        try {
          if (namespace === 'sync') {
            if (changes.previewEnabled) previewSettings.enabled = changes.previewEnabled.newValue;
            if (changes.previewHoverDelay) previewSettings.hoverDelay = changes.previewHoverDelay.newValue;
            if (changes.previewModifierKey) previewSettings.modifierKey = changes.previewModifierKey.newValue;
            if (changes.previewMaxWindows) previewSettings.maxPreviews = changes.previewMaxWindows.newValue;
            if (changes.previewDefaultWidth) previewSettings.defaultWidth = changes.previewDefaultWidth.newValue;
            if (changes.previewDefaultHeight) previewSettings.defaultHeight = changes.previewDefaultHeight.newValue;
            if (changes.previewPosition) previewSettings.position = changes.previewPosition.newValue;
            if (changes.previewSearchEngine) previewSettings.searchEngine = changes.previewSearchEngine.newValue;
            if (changes.enableTextSearchPreview) previewSettings.enableTextSearchPreview = changes.enableTextSearchPreview.newValue;
            if (changes.disabledSites) previewSettings.disabledSites = changes.disabledSites.newValue || [];
            
            console.log('预览设置已更新:', previewSettings);
          }
        } catch (error) {
          console.log('处理设置变更错误:', error.message);
          // 如果是扩展上下文失效，停止监听
          if (error.message.includes('Extension context invalidated')) {
            console.log('扩展上下文失效，预览功能将停止工作');
          }
        }
      });
    } catch (error) {
      console.log('添加设置变更监听器错误:', error.message);
    }
    
    // 监听从popup.js发来的设置更新消息
    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "settingsUpdated") {
          try {
            // 直接重新加载设置确保与最新保存的设置同步
            loadPreviewSettings();
            console.log('收到设置更新消息，已重新加载设置');
            
            // 如果需要，可以在这里返回响应
            if (sendResponse) {
              sendResponse({ status: "success" });
            }
          } catch (error) {
            console.log('处理设置更新消息时出错:', error.message);
            
            // 即使出错也返回响应，避免未处理的Promise
            if (sendResponse) {
              sendResponse({ status: "error", message: error.message });
            }
            
            // 如果是扩展上下文失效，记录日志
            if (error.message.includes('Extension context invalidated')) {
              console.log('扩展上下文失效，预览功能将停止工作');
            }
          }
          return true; // 保持消息通道开放，允许异步响应
        }
      });
    } catch (error) {
      console.log('添加消息监听器错误:', error.message);
    }
    
    // 使用事件委托注册事件监听器
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    // 全局键盘状态监听，确保捕获所有键盘事件，包括焦点在iframe或其他元素时
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });
    
    // 定期检查修饰键状态，防止状态不同步
    setInterval(checkModifierKeyState, 500);
    
    // 使用事件委托处理鼠标悬停和离开事件
    document.addEventListener('mouseover', (e) => {
      try {
        // 如果预览功能被禁用，直接返回
        if (!previewSettings.enabled) return;
        
        // 如果当前网站在禁用列表，不显示小窗预览
        if (isSiteInDisabledListForPreview(window.location.href)) return;
        
        // 先检查修饰键状态，确保同步
        checkModifierKeyState();
        
        const linkElement = findLinkElement(e.target);
        if (linkElement) {
          handleMouseOver(e, linkElement);
        }
      } catch (error) {
        console.log('处理mouseover事件错误:', error.message);
        // 异常处理，避免中断用户体验
      }
    }, { passive: true });
    
    document.addEventListener('mouseout', (e) => {
      try {
        const linkElement = findLinkElement(e.target);
        if (linkElement && linkElement === currentHoverElement) {
          handleMouseOut(e, linkElement);
        }
      } catch (error) {
        console.log('处理mouseout事件错误:', error.message);
      }
    }, { passive: true });
    
    // 使用事件委托处理点击事件
    document.addEventListener('click', handleClick, { passive: true });
    
    // 文本选择事件
    document.addEventListener('selectstart', handleTextSelection, { passive: true });
    document.addEventListener('selectionchange', debounce(handleSelectionChange, 200), { passive: true });
    
    // 添加窗口焦点变化处理
    window.addEventListener('blur', () => {
      try {
        // 窗口失去焦点时，重置修饰键状态
        if (isModifierKeyPressed) {
          isModifierKeyPressed = false;
          console.log('窗口失去焦点，重置修饰键状态');
          
          if (previewTimer) {
            clearTimeout(previewTimer);
            previewTimer = null;
          }
        }
      } catch (error) {
        console.log('处理窗口失焦事件错误:', error.message);
      }
    }, { passive: true });
    
    // 添加辅助函数处理页面可见性变更
    document.addEventListener('visibilitychange', () => {
      try {
        if (document.hidden) {
          // 页面不可见时，清除所有预览计时器和修饰键状态
          if (previewTimer) {
            clearTimeout(previewTimer);
            previewTimer = null;
          }
          
          isModifierKeyPressed = false;
        }
      } catch (error) {
        console.log('处理页面可见性变更事件错误:', error.message);
      }
    }, { passive: true });
    
    console.log('链接预览功能已初始化，设置:', previewSettings);
    console.log('支持两种预览模式:');
    console.log('1. 按住修饰键并悬停在链接上');
    console.log('2. 先选中文本，再按修饰键显示搜索预览');
  } catch (error) {
    console.log('初始化链接预览功能失败:', error.message);
    // 如果是扩展上下文失效，显示特殊日志
    if (error.message && error.message.includes('Extension context invalidated')) {
      console.log('扩展上下文失效，预览功能将停止工作');
    }
  }
}

// 防抖函数，避免频繁触发事件
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// 处理鼠标移动
function handleMouseMove(e) {
  // 记录当前鼠标位置
  currentMousePosition.x = e.clientX;
  currentMousePosition.y = e.clientY;
}

// 处理键盘按下事件
function handleKeyDown(e) {
  console.log('键盘按下:', e.key, 'ctrl:', e.ctrlKey, 'alt:', e.altKey, 'shift:', e.shiftKey, '当前修饰键设置:', previewSettings.modifierKey);
  
  // 1. 检查是否直接按下了目标修饰键
  const isModifierKey = (e.key === previewSettings.modifierKey) || 
                        (e.key === `${previewSettings.modifierKey}Left`) || 
                        (e.key === `${previewSettings.modifierKey}Right`);
  
  // 2. 使用isModifierKeyMatch检查修饰键状态
  const modifierActive = isModifierKeyMatch(e);
  
  // 如果按下了目标修饰键或修饰键状态为活动
  if (isModifierKey || (modifierActive && !isModifierKeyPressed)) {
    // 只有在之前未设置的情况下才更新状态，避免重复触发
    if (!isModifierKeyPressed) {
      isModifierKeyPressed = true;
      console.log('修饰键已按下:', previewSettings.modifierKey, '已设置isModifierKeyPressed =', isModifierKeyPressed);
      
      // 如果已经有悬停元素且预览尚未显示，立即开始预览
      if (currentHoverElement && !previewTimer && previewSettings.enabled) {
        console.log('由于修饰键按下，立即开始预览');
        startPreviewTimer(currentHoverElement);
      }
      
      // 检查是否有文本选择，如果有且文本选择搜索功能启用，则显示搜索预览
      if (currentTextSelection && previewSettings.enabled && previewSettings.enableTextSearchPreview) {
        // 获取当前选择对象
        const selection = document.getSelection();
        if (selection && selection.rangeCount > 0) {
          // 检查当前活动元素或选择的容器元素是否为文本输入框
          let activeElement = document.activeElement;
          if (activeElement && isTextInputElement(activeElement)) {
            console.log('选择在文本输入框内，不显示搜索预览');
            return;
          }
          
          // 检查选择的节点是否在文本框内
          const range = selection.getRangeAt(0);
          const selectionNode = range.commonAncestorContainer;
          let currentNode = selectionNode;
          
          // 向上查找包含元素
          while (currentNode && currentNode.nodeType !== Node.ELEMENT_NODE) {
            currentNode = currentNode.parentNode;
          }
          
          // 检查是否在文本输入框内
          if (currentNode && isTextInputElement(currentNode)) {
            console.log('选择在文本输入框内，不显示搜索预览');
            return;
          }
        }
        
        console.log('发现有效文本选择，显示搜索预览:', currentTextSelection.text);
        showTextSelectionPreview(currentTextSelection);
      }
    }
  }
  
  // 处理Escape键关闭预览窗口
  if (e.key === 'Escape' && activePreviewWindows.size > 0) {
    console.log('检测到Escape键，关闭所有预览窗口');
    closeAllPreviewWindows();
  }
}

// 处理键盘释放事件
function handleKeyUp(e) {
  console.log('键盘释放:', e.key, 'ctrl:', e.ctrlKey, 'alt:', e.altKey, 'shift:', e.shiftKey, '当前修饰键状态:', isModifierKeyPressed);
  
  // 这里改进修饰键检测，更全面地检查修饰键状态
  // 情况1: 判断是否直接释放了相关修饰键
  const isModifierKey = (e.key === previewSettings.modifierKey) || 
                        (e.key === `${previewSettings.modifierKey}Left`) || 
                        (e.key === `${previewSettings.modifierKey}Right`);
                        
  // 情况2: 检查修饰键状态是否改变 (即使按键名称不匹配)
  const modifierReleased = 
    (previewSettings.modifierKey === 'Control' && !e.ctrlKey) ||
    (previewSettings.modifierKey === 'Alt' && !e.altKey) ||
    (previewSettings.modifierKey === 'Shift' && !e.shiftKey);
  
  // 如果是修饰键被释放或修饰键状态发生改变
  if (isModifierKey || (isModifierKeyPressed && modifierReleased)) {
    isModifierKeyPressed = false;
    console.log('修饰键已释放:', previewSettings.modifierKey, '已重置isModifierKeyPressed =', isModifierKeyPressed);
    
    // 如果预览还没有开始，则清除预览计时器
    if (previewTimer) {
      console.log('由于修饰键释放，取消预览计时器');
      clearTimeout(previewTimer);
      previewTimer = null;
    }
    
    // 当修饰键释放时，不立即清除文本选择
    // 这样用户可以再次按下修饰键触发同一文本的预览
    // 当用户选择新文本或取消选择时，currentTextSelection会被更新
  }
  
  // 处理Escape键（放在这里是为了确保即使在handleKeyDown中也能捕获）
  if (e.key === 'Escape' && activePreviewWindows.size > 0) {
    console.log('检测到Escape键释放，关闭所有预览窗口');
    closeAllPreviewWindows();
  }
}

// 处理鼠标悬停
function handleMouseOver(e, linkElement) {
  currentHoverElement = linkElement;
  console.log('鼠标悬停在链接上:', linkElement.href, '修饰键状态:', isModifierKeyPressed, '预览功能状态:', previewSettings.enabled);
  
  // 如果预览功能已启用且满足条件，开始预览倒计时
  if (previewSettings.enabled && 
      (previewSettings.modifierKey === 'none' || isModifierKeyPressed)) {
    console.log('开始预览计时器...');
    startPreviewTimer(linkElement);
  } else {
    console.log('不满足预览条件，不启动预览');
  }
}

// 处理鼠标离开
function handleMouseOut(e, linkElement) {
  console.log('鼠标离开链接:', linkElement.href);
  // 清除当前悬停元素和计时器
  currentHoverElement = null;
  if (previewTimer) {
    console.log('取消预览计时器');
    clearTimeout(previewTimer);
    previewTimer = null;
  }
}

// 处理点击事件
function handleClick(e) {
  // 链接点击由浏览器自己处理
}

// 处理文本选择开始
function handleTextSelection(e) {
  // 监听选择的开始
}

// 处理文本选择变化
function handleSelectionChange(e) {
  // 如果预览功能被禁用或选中文字搜索功能被禁用，直接返回
  if (!previewSettings.enabled || !previewSettings.enableTextSearchPreview) return;
  
  // 获取当前选择
  const selection = document.getSelection();
  
  // 如果有文本选择
  if (selection && selection.toString().trim()) {
    try {
      // 获取选择的文本
      const selectedText = selection.toString().trim();
      
      // 如果选择的文本长度大于0，保存当前选择
      if (selectedText.length > 0) {
        // 检查选择是否在文本输入框内
        const anchorNode = selection.anchorNode;
        let currentElement = anchorNode;
        
        // 向上查找包含元素节点
        while (currentElement && currentElement.nodeType !== Node.ELEMENT_NODE) {
          currentElement = currentElement.parentNode;
        }
        
        // 检查当前活动元素是否为文本输入框
        let activeElement = document.activeElement;
        if (activeElement && isTextInputElement(activeElement)) {
          // 清除当前文本选择状态
          currentTextSelection = null;
          return;
        }
        
        // 如果选择在文本输入框内，不触发小窗预览
        if (currentElement && isTextInputElement(currentElement)) {
          // 清除当前文本选择状态
          currentTextSelection = null;
          return;
        }
        
        // 再次检查选区内的所有元素
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (isSelectionInTextInput(range)) {
            currentTextSelection = null;
            return;
          }
        }
        
        // 获取选择区域的位置
        const selectionRect = selection.getRangeAt(0).getBoundingClientRect();
        
        // 存储当前文本选择和位置，但不立即显示预览
        currentTextSelection = {
          text: selectedText,
          position: {
            x: selectionRect.left + selectionRect.width / 2,
            y: selectionRect.bottom
          }
        };
        
        // 如果设置为无需修饰键或已经按下修饰键，立即显示预览
        if (previewSettings.modifierKey === 'none' || isModifierKeyPressed) {
          console.log('修饰键已按下，立即显示选中文本预览');
          showTextSelectionPreview(currentTextSelection);
        } else {
          console.log('已保存文本选择，等待修饰键触发预览:', selectedText);
        }
      }
    } catch (error) {
      console.error('处理文本选择时出错:', error);
    }
  } else {
    // 清除当前文本选择
    currentTextSelection = null;
  }
}

// 检查选择区域是否在文本输入框内
function isSelectionInTextInput(range) {
  // 创建一个临时的范围来遍历选区中的所有节点
  const tempRange = document.createRange();
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_ELEMENT,
    null,
    false
  );
  
  // 首先检查起点元素
  let startElement = range.startContainer;
  while (startElement && startElement.nodeType !== Node.ELEMENT_NODE) {
    startElement = startElement.parentElement;
  }
  
  if (startElement && isTextInputElement(startElement)) {
    return true;
  }
  
  // 检查范围内的所有元素
  let currentNode = walker.nextNode();
  while (currentNode) {
    if (isTextInputElement(currentNode)) {
      return true;
    }
    currentNode = walker.nextNode();
  }
  
  return false;
}

// 显示文本选择预览
function showTextSelectionPreview(selectionData) {
  if (!selectionData || !selectionData.text) return;

  // 显示预览前再次检查当前选择是否在输入框内
  const selection = document.getSelection();
  if (selection && selection.rangeCount > 0) {
    // 检查当前活动元素
    let activeElement = document.activeElement;
    if (activeElement && isTextInputElement(activeElement)) {
      console.log('显示前检测到选择在文本输入框内，取消预览');
      return;
    }
    
    // 检查选区
    const range = selection.getRangeAt(0);
    if (isSelectionInTextInput(range)) {
      console.log('显示前检测到选择在文本输入框内，取消预览');
      return;
    }
  }
  
  // 检查是否达到最大预览窗口数
  if (activePreviewWindows.size >= previewSettings.maxPreviews) {
    // 关闭最早创建的预览窗口
    const oldestId = Array.from(activePreviewWindows.keys())[0];
    closePreviewWindow(oldestId);
  }
  
  // 创建预览窗口ID
  const previewId = `search-preview-${Date.now()}-${previewCounter++}`;
  
  // 构建搜索URL - 支持{q}占位符
  let searchUrl;
  if (previewSettings.searchEngine.includes('{q}')) {
    searchUrl = previewSettings.searchEngine.replace('{q}', encodeURIComponent(selectionData.text));
  } else {
    // 向后兼容：如果没有占位符，则在末尾追加
    searchUrl = `${previewSettings.searchEngine}${encodeURIComponent(selectionData.text)}`;
  }
  
  const title = getI18nMessage('searchPrefix', 'Search: ') + selectionData.text;
  
  // 临时保存当前鼠标位置
  const originalMousePosition = {...currentMousePosition};
  
  // 如果是基于选择的预览，则使用选择位置
  if (selectionData.position) {
    currentMousePosition.x = selectionData.position.x;
    currentMousePosition.y = selectionData.position.y;
  }
  
  // 创建预览窗口
  createPopupWindow(previewId, searchUrl, title);
  
  // 恢复原始鼠标位置
  currentMousePosition = originalMousePosition;
}

// 查找链接元素
function findLinkElement(element) {
  let current = element;
  
  // 检查是否在文本输入框内
  let checkElement = element;
  while (checkElement && checkElement !== document.body) {
    if (isTextInputElement(checkElement)) {
      // 如果在文本输入框内，不处理链接预览
      return null;
    }
    checkElement = checkElement.parentElement;
  }
  
  // 向上查找最近的链接元素
  while (current && current !== document.body) {
    if (current.tagName === 'A' && current.href) {
      return current;
    }
    current = current.parentElement;
  }
  
  return null;
}

// 开始预览计时器
function startPreviewTimer(linkElement) {
  // 如果已有计时器，先清除
  if (previewTimer) {
    clearTimeout(previewTimer);
  }
  
  // 设置新计时器
  previewTimer = setTimeout(() => {
    showLinkPreview(linkElement);
    previewTimer = null;
  }, previewSettings.hoverDelay);
}

// 显示链接预览
function showLinkPreview(linkElement) {
  // 检查是否达到最大预览窗口数
  if (activePreviewWindows.size >= previewSettings.maxPreviews) {
    // 关闭最早创建的预览窗口
    const oldestId = Array.from(activePreviewWindows.keys())[0];
    closePreviewWindow(oldestId);
  }
  
  // 创建预览窗口ID
  const previewId = `preview-${Date.now()}-${previewCounter++}`;
  
  // 获取链接URL和文本
  const url = linkElement.href;
  const title = linkElement.textContent.trim() || url;
  
  // 创建预览窗口
  createPopupWindow(previewId, url, title);
}

// 创建弹出窗口
function createPopupWindow(previewId, url, title) {
  // 确保URL格式正确
  let targetUrl = url;
  try {
    new URL(targetUrl);
  } catch (e) {
    // 如果URL无效，尝试添加https://前缀
    if (!targetUrl.match(/^https?:\/\//i)) {
      targetUrl = 'https://' + targetUrl;
    }
  }
  
  // 设置弹出窗口特性
  const width = previewSettings.defaultWidth;
  const height = previewSettings.defaultHeight;
  
  // 计算窗口位置
  let left, top;
  
  // 获取当前屏幕尺寸信息
  const screenWidth = window.screen.availWidth;
  const screenHeight = window.screen.availHeight;
  const screenLeft = window.screen.availLeft || 0;
  const screenTop = window.screen.availTop || 0;
  
  if (previewSettings.position === 'cursor' && currentMousePosition) {
    // 使用当前鼠标位置，转换为屏幕坐标
    // 获取页面滚动位置
    const scrollX = window.scrollX || document.documentElement.scrollLeft;
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    
    // 计算鼠标在屏幕上的绝对位置
    left = Math.min(Math.max(screenLeft, currentMousePosition.x + scrollX), screenLeft + screenWidth - width);
    top = Math.min(Math.max(screenTop, currentMousePosition.y + scrollY), screenTop + screenHeight - height);
    
    // 确保预览窗口完全可见（不会超出屏幕）
    if (left + width > screenLeft + screenWidth) {
      left = screenLeft + screenWidth - width;
    }
    if (top + height > screenTop + screenHeight) {
      top = screenTop + screenHeight - height;
    }
  } else if (previewSettings.position === 'center') {
    // 在屏幕中央打开
    left = screenLeft + (screenWidth - width) / 2;
    top = screenTop + (screenHeight - height) / 2;
  } else {
    // 在屏幕右上角打开
    left = screenLeft + screenWidth - width - 20;
    top = screenTop + 20;
  }
  
  // 设置窗口特性
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
  
  // 打开弹出窗口
  const popupWindow = window.open(targetUrl, previewId, features);
  
  // 如果窗口无法打开（可能被浏览器阻止），显示警告
  if (!popupWindow) {
    console.error('Unable to open popup window, it may be blocked by the browser. Please allow popups.');
    // 在页面上显示弹出窗口被阻止的通知
    showBlockedPopupNotification();
    return null;
  }
  
  // 存储窗口信息
  activePreviewWindows.set(previewId, {
    id: previewId,
    window: popupWindow,
    url: targetUrl,
    title: title
  });
  
  // 监听窗口关闭事件
  const checkClosedInterval = setInterval(() => {
    if (popupWindow.closed) {
      clearInterval(checkClosedInterval);
      closePreviewWindow(previewId);
    }
  }, 500);
  
  return popupWindow;
}

// 关闭预览窗口
function closePreviewWindow(previewId) {
  const previewData = activePreviewWindows.get(previewId);
  if (!previewData) return;
  
  // 关闭弹出窗口
  if (previewData.window && !previewData.window.closed) {
    previewData.window.close();
  }
  
  // 从活动窗口列表中移除
  activePreviewWindows.delete(previewId);
}

// 关闭所有预览窗口
function closeAllPreviewWindows() {
  for (const [previewId, previewData] of activePreviewWindows.entries()) {
    if (previewData.window && !previewData.window.closed) {
      previewData.window.close();
    }
  }
  
  // 清空活动窗口列表
  activePreviewWindows.clear();
  
  // 清除当前文本选择
  currentTextSelection = null;
}

// 显示弹出窗口被阻止的通知
function showBlockedPopupNotification() {
  // 创建通知元素
  const notification = document.createElement('div');
  notification.className = 'popup-blocked-notification';
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background-color: #f44336;
    color: white;
    padding: 15px 20px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    font-family: Arial, sans-serif;
    font-size: 14px;
    z-index: 2147483647;
    max-width: 300px;
    opacity: 0;
    transition: opacity 0.3s ease-in-out;
  `;
  
  // 创建关闭按钮
  const closeButton = document.createElement('span');
  closeButton.innerHTML = '&times;';
  closeButton.style.cssText = `
    position: absolute;
    top: 5px;
    right: 10px;
    cursor: pointer;
    font-size: 18px;
    font-weight: bold;
  `;
  closeButton.addEventListener('click', () => {
    document.body.removeChild(notification);
  });
  
  // 设置通知内容
  const popupBlockedTitle = getI18nMessage('popupBlocked', 'Popup Blocked');
  const popupBlockedMessage = getI18nMessage('allowPopupsMessage', 'Please allow popups for this site to enable link preview functionality.');
  
  notification.innerHTML = `
    <div style="margin-right: 20px;">
      <strong>${popupBlockedTitle}</strong>
      <p style="margin: 5px 0 0 0;">${popupBlockedMessage}</p>
    </div>
  `;
  notification.appendChild(closeButton);
  
  // 添加到页面
  document.body.appendChild(notification);
  
  // 使用延迟显示以触发过渡效果
  setTimeout(() => {
    notification.style.opacity = '1';
  }, 10);
  
  // 5秒后自动隐藏
  setTimeout(() => {
    notification.style.opacity = '0';
    // 等待过渡完成后移除元素
    setTimeout(() => {
      if (notification.parentNode) {
        document.body.removeChild(notification);
      }
    }, 300);
  }, 5000);
}

// 初始化预览功能
window.addEventListener('DOMContentLoaded', () => {
  try {
    initLinkPreview();
  } catch (error) {
    console.log('Failed to initialize preview function:', error.message);
    if (error.message && error.message.includes('Extension context invalidated')) {
      console.log('Extension context invalidated, preview function will be unavailable');
    }
  }
});

// 导出功能供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initLinkPreview,
    loadPreviewSettings,
    showLinkPreview,
    closeAllPreviewWindows
  };
} 
