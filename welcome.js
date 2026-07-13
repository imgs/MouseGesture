// 禁用所有控制台日志
console.log = function() {};
console.error = function() {};
console.warn = function() {};
console.info = function() {};
console.debug = function() {};

// 获取i18n消息
function getI18nMessage(messageName, fallback = '') {
  return chrome.i18n.getMessage(messageName) || fallback;
}

// 获取浏览器语言
function getBrowserLanguage() {
  // 获取浏览器语言设置
  const browserLang = chrome.i18n.getUILanguage().replace('-', '_').toLowerCase();
  
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

// 当前语言
let currentLang = getBrowserLanguage();

const initialUiLanguage = chrome.i18n.getUILanguage() || 'en';
document.documentElement.lang = initialUiLanguage.replace(/_/g, '-');
document.documentElement.dir = /^(ar|fa|he|ps|ur)(-|_|$)/i.test(initialUiLanguage) ? 'rtl' : 'ltr';

// 更新界面文本
function updateUIText(lang) {
  const uiLanguage = chrome.i18n.getUILanguage() || 'en';
  document.documentElement.lang = uiLanguage.replace(/_/g, '-');
  document.documentElement.dir = /^(ar|fa|he|ps|ur)(-|_|$)/i.test(uiLanguage) ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    element.textContent = getI18nMessage(key, element.textContent);
  });
  
  // 更新页面标题
  document.title = getI18nMessage('welcomeTitle', document.title);
  
  // 更新当前语言
  currentLang = lang;
  
  chrome.storage.sync.set({ language: lang });
}

// 加载语言设置
function loadLanguage() {
  chrome.storage.sync.get({ language: getBrowserLanguage() }, (result) => {
    updateUIText(result.language);
  });
}

// 显示扩展版本号
function displayExtensionVersion() {
  const versionText = document.getElementById('version-text');
  const iconContainer = document.getElementById('icon-container');
  
  const manifest = chrome.runtime.getManifest();
  if (versionText) versionText.textContent = `v${manifest.version}`;
  if (iconContainer) {
    iconContainer.replaceChildren();
    const img = document.createElement('img');
    img.src = chrome.runtime.getURL('images/icon16.png');
    img.className = 'footer-icon';
    img.alt = 'icon';
    iconContainer.appendChild(img);
  }
}

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', loadLanguage);
document.addEventListener('DOMContentLoaded', displayExtensionVersion); 
