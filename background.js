// 禁用所有控制台日志
console.log = function() {};
console.error = function() {};
console.warn = function() {};
console.info = function() {};
console.debug = function() {};

// 常量定义
const SPECIAL_PROTOCOLS = [
  'chrome-extension://',
  'chrome://',
  'edge://',
  'about:',
  'data:',
  'file://',
  'view-source:',
  'javascript:',
  'ftp://',
  'ws://',
  'wss://',
  'http://',
  'https://'
];

const NEW_TAB_URLS = [
  'chrome://newtab/',
  'edge://newtab/',
  'about:newtab',
  'chrome://new-tab-page/',
  'about:blank'
];

const IGNORED_PROTOCOLS = [
  'chrome://',
  'edge://',
  'about:',
  'chrome-extension://'
];

// 全局变量定义
let lastCheckedTab = {
  id: null,
  url: null,
  time: 0,
  cooldown: 5000,
  processedUrls: new Map()
};

// 分屏视图会话跟踪：记录新窗口与原窗口及原始尺寸的对应关系
const splitViewSessions = {};

// URL标准化缓存
const urlNormalizeCache = new Map();
const MAX_CACHE_SIZE = 2000; // 增加到2000条
const CACHE_CLEANUP_THRESHOLD = 0.9; // 缓存使用率达到90%时清理

// 全局URL标准化函数（带缓存）
function normalizeUrl(inputUrl) {
  if (!inputUrl) return '';
  
  // 检查缓存
  if (urlNormalizeCache.has(inputUrl)) {
    const cacheEntry = urlNormalizeCache.get(inputUrl);
    cacheEntry.accessCount++; // 增加访问计数
    return cacheEntry.result;
  }
  
  let result;
  try {
    let urlObj;
    try {
      urlObj = new URL(inputUrl);
    } catch (e) {
      try {
        urlObj = new URL('https://' + inputUrl);
      } catch (e2) {
        result = inputUrl.toLowerCase();
        // 缓存结果
        if (urlNormalizeCache.size < MAX_CACHE_SIZE) {
          urlNormalizeCache.set(inputUrl, result);
        }
        return result;
      }
    }
    
    let hostname = urlObj.hostname.toLowerCase();
    if (hostname.startsWith('www.')) {
      hostname = hostname.substring(4);
    }
    
    let pathname = urlObj.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    
    // 忽略常见追踪参数
    const ignoredParams = new Set([
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'msclkid', 'ref', 'source', 'ref_src', '_ga'
    ]);
    
    let cleanParams = new URLSearchParams();
    for (let [key, value] of urlObj.searchParams.entries()) {
      if (!ignoredParams.has(key.toLowerCase())) {
        cleanParams.append(key.toLowerCase(), value);
      }
    }
    
    const sortedParams = Array.from(cleanParams.entries())
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
    
    const cleanQuery = sortedParams.length > 0 
      ? '?' + sortedParams.map(([k, v]) => `${k}=${v}`).join('&') 
      : '';
    
    // 处理锚点(#)，只有当它是URL的末尾且没有实际内容时才忽略
    let hash = '';
    if (urlObj.hash && urlObj.hash !== '#') {
      hash = urlObj.hash;
    }
    
    result = `${urlObj.protocol}//${hostname}${pathname}${cleanQuery}${hash}`;
  } catch (e) {
    console.warn('URL标准化失败:', e.message);
    result = inputUrl.toLowerCase();
  }
  
  // 智能缓存管理
  if (urlNormalizeCache.size >= MAX_CACHE_SIZE) {
    // 缓存已满，清理最旧的条目
    clearOldestCacheEntries();
  }
  
  // 缓存结果
  urlNormalizeCache.set(inputUrl, {
    result: result,
    timestamp: Date.now(),
    accessCount: 1
  });
  
  return result;
}

// 清理URL标准化缓存
function clearUrlNormalizeCache() {
  urlNormalizeCache.clear();
}

// 智能清理最旧的缓存条目
function clearOldestCacheEntries() {
  const entries = Array.from(urlNormalizeCache.entries());
  
  // 按访问频率和时间排序，优先保留高频访问的条目
  entries.sort((a, b) => {
    const [urlA, entryA] = a;
    const [urlB, entryB] = b;
    
    // 计算访问频率分数（访问次数 / 时间差）
    const timeA = Date.now() - entryA.timestamp;
    const timeB = Date.now() - entryB.timestamp;
    const scoreA = entryA.accessCount / Math.max(timeA, 1);
    const scoreB = entryB.accessCount / Math.max(timeB, 1);
    
    return scoreA - scoreB; // 分数低的先删除
  });
  
  // 删除最旧的25%条目
  const deleteCount = Math.floor(entries.length * 0.25);
  for (let i = 0; i < deleteCount; i++) {
    urlNormalizeCache.delete(entries[i][0]);
  }
  
  console.log(`清理了 ${deleteCount} 个最旧的缓存条目`);
}

// 检查缓存使用率并智能清理
function checkAndCleanCache() {
  const usageRatio = urlNormalizeCache.size / MAX_CACHE_SIZE;
  
  if (usageRatio >= CACHE_CLEANUP_THRESHOLD) {
    console.log(`缓存使用率 ${(usageRatio * 100).toFixed(1)}% 超过阈值，开始清理`);
    clearOldestCacheEntries();
  }
}

// 获取缓存统计信息
function getCacheStats() {
  const entries = Array.from(urlNormalizeCache.values());
  const totalAccessCount = entries.reduce((sum, entry) => sum + entry.accessCount, 0);
  const avgAccessCount = entries.length > 0 ? totalAccessCount / entries.length : 0;
  
  return {
    size: urlNormalizeCache.size,
    maxSize: MAX_CACHE_SIZE,
    usageRatio: urlNormalizeCache.size / MAX_CACHE_SIZE,
    totalAccessCount: totalAccessCount,
    avgAccessCount: avgAccessCount,
    lastCleanupTime: lastCleanupTime
  };
}

// 定期输出缓存统计（仅在开发模式下）
function logCacheStats() {
  const stats = getCacheStats();
  console.log('缓存统计:', {
    使用率: `${(stats.usageRatio * 100).toFixed(1)}%`,
    条目数: `${stats.size}/${stats.maxSize}`,
    总访问次数: stats.totalAccessCount,
    平均访问次数: stats.avgAccessCount.toFixed(2)
  });
}

// 检查标签页是否为有效标签页（非特殊页面）
function isValidTab(tab) {
  if (!tab || !tab.url) return false;
  
  // 跳过空白标签页和特殊页面
  if (tab.url.startsWith('chrome://') || 
      tab.url.startsWith('edge://') || 
      tab.url.startsWith('about:') || 
      NEW_TAB_URLS.includes(tab.url)) {
    return false;
  }
  
  return true;
}

// 批量标准化URL列表
function batchNormalizeUrls(tabs) {
  const normalizedUrls = new Map();
  
  for (const tab of tabs) {
    if (!isValidTab(tab)) continue;
    
    try {
      const normalizedUrl = normalizeUrl(tab.url);
      normalizedUrls.set(tab.id, normalizedUrl);
    } catch (e) {
      console.log(`无法处理标签页 ${tab.id} 的URL:`, e.message);
      continue;
    }
  }
  
  return normalizedUrls;
}

// Service Worker 生命周期事件
self.addEventListener('install', (event) => {
  console.log('Service Worker 安装完成');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker 激活完成');
  event.waitUntil(clients.claim());
});

// 错误处理
self.addEventListener('error', (event) => {
  console.error('Service Worker 错误:', event.message);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker 未处理的 Promise 拒绝:', event.reason);
});

// 标签页检查跟踪已移至 duplicateCheckTracker 中，基于URL的独立冷却时间

// 优化的防抖函数 - 区分不同类型的操作
function debounce(func, wait, immediate = false) {
  let timeout;
  return function(...args) {
    const context = this;
    const later = function() {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
}


// 获取最近打开的标签页右侧的索引位置
async function getRecentTabRightIndex() {
  try {
    // 获取所有标签页
    const tabs = await chrome.tabs.query({});
    
    if (tabs.length === 0) return null;
    
    // 按最后访问时间排序，找到最近打开的标签页
    const sortedTabs = tabs
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    
    if (sortedTabs.length === 0) return null;
    
    // 返回最近标签页的索引 + 1（在其右侧创建）
    const recentTab = sortedTabs[0];
    return recentTab.index + 1;
  } catch (e) {
    console.error('获取最近标签页右侧索引错误:', e.message);
    return null;
  }
}

// 统一的标签页创建函数
async function createTabWithRecentIndex(url, active = true) {
  try {
    const createOptions = { active };
    if (url) {
      createOptions.url = url;
    }
    
    const recentRightIndex = await getRecentTabRightIndex();
    if (recentRightIndex !== null) {
      createOptions.index = recentRightIndex;
    }
    
    return new Promise((resolve, reject) => {
      chrome.tabs.create(createOptions, (tab) => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError;
          console.error('创建标签页错误:', error.message);
          reject(error);
        } else {
          console.log('成功创建标签页:', tab.id);
          resolve(tab);
        }
      });
    });
  } catch (e) {
    console.error('创建标签页错误:', e.message);
    throw e;
  }
}

// 创建一个检查跟踪器，用于智能决定是否需要执行检查
const duplicateCheckTracker = {
  // 记录每个URL的上次检查时间（基于URL的独立冷却时间）
  urlChecks: new Map(),
  
  // 检查冷却时间（毫秒）
  cooldownTime: 5000,
  
  // 最大缓存大小，避免内存泄漏
  maxCacheSize: 200,
  
  // URL检查频率调整
  urlFrequency: new Map(),
  
  // 判断是否需要检查特定URL
  shouldCheck: function(tabId, url) {
    if (!url) return false;
    
    try {
      // 记录当前时间
      const now = Date.now();
      
      // 获取此URL的上次检查记录
      const lastCheck = this.urlChecks.get(url);
      
      // 获取此URL的检查频率（默认为标准冷却时间）
      let urlCooldown = this.cooldownTime;
      if (this.urlFrequency.has(url)) {
        // 如果此URL很少有重复，增加冷却时间
        const urlStats = this.urlFrequency.get(url);
        if (urlStats.duplicateRatio < 0.1) { // 重复率低于10%
          urlCooldown = this.cooldownTime * 2; // 加倍冷却时间
        } else if (urlStats.duplicateRatio > 0.5) { // 重复率高于50%
          urlCooldown = this.cooldownTime / 2; // 减半冷却时间
        }
      }
      
      // 如果有上次检查记录，且未超过冷却时间，跳过检查
      if (lastCheck && (now - lastCheck.time) < urlCooldown) {
        console.log(`URL ${url} 在冷却期内，跳过检查`);
        return false;
      }
      
      // 更新检查记录
      this.urlChecks.set(url, {
        time: now,
        tabId: tabId
      });
      
      // 清理过期缓存，避免内存持续增长
      if (this.urlChecks.size > this.maxCacheSize) {
        this.cleanup();
      }
      
      return true;
    } catch (e) {
      console.warn('检查跟踪器错误:', e.message);
      return true; // 出错时默认执行检查
    }
  },
  
  // 更新URL统计数据
  updateUrlStats: function(url, foundDuplicates) {
    try {
      if (!url) return;
      
      const stats = this.urlFrequency.get(url) || {
        checkCount: 0,
        duplicateCount: 0,
        duplicateRatio: 0
      };
      
      stats.checkCount++;
      if (foundDuplicates) stats.duplicateCount++;
      stats.duplicateRatio = stats.duplicateCount / stats.checkCount;
      
      this.urlFrequency.set(url, stats);
      
      // 限制URL统计缓存大小
      if (this.urlFrequency.size > this.maxCacheSize) {
        // 移除最早添加的项
        const oldestUrl = this.urlFrequency.keys().next().value;
        this.urlFrequency.delete(oldestUrl);
      }
    } catch (e) {
      console.warn('更新URL统计错误:', e.message);
    }
  },
  
  // 清理过期的检查记录
  cleanup: function() {
    const now = Date.now();
    const expiredTime = now - this.cooldownTime * 3; // 保留3倍冷却时间的记录
    
    // 移除过期的URL检查记录
    for (const [url, checkInfo] of this.urlChecks.entries()) {
      if (checkInfo.time < expiredTime) {
        this.urlChecks.delete(url);
      }
    }
    
    // 清理过期的URL统计记录
    for (const [url, stats] of this.urlFrequency.entries()) {
      if (stats.checkCount > 0 && stats.duplicateRatio === 0 && stats.checkCount > 10) {
        // 如果URL检查次数很多但从未重复，且检查次数超过10次，可以清理
        this.urlFrequency.delete(url);
      }
    }
  }
};

// 定期清理缓存
setInterval(() => {
  duplicateCheckTracker.cleanup();
}, 60000); // 每分钟执行一次

// 优化后的标签页检查函数 - 2秒防抖，重要操作立即执行
const checkTabDuplicatesDebounced = debounce(async (tabId, isImportant = false) => {
  try {
    // 首先检查设置是否启用了重复标签页检测
    const settings = await chrome.storage.sync.get({ 
      enableDuplicateCheck: true,
      autoCloseDetectedTabs: false 
    });
    
    if (!settings.enableDuplicateCheck) {
      console.log('重复标签页检测已禁用');
      return;
    }
    
    // 首先验证标签页是否仍然存在
    try {
      // 获取当前标签页信息
      const tab = await chrome.tabs.get(tabId);
      if (!tab || !tab.url) return;
      
      // 检查URL是否在忽略列表中
      if (!notificationTracker.shouldCheckUrl(tab.url)) {
        console.log(`标签页 ${tabId} URL已被用户忽略，跳过重复检测`);
        return;
      }
      
      // 使用智能跟踪器判断是否需要检查
      if (!isImportant && !duplicateCheckTracker.shouldCheck(tabId, tab.url)) {
        console.log(`标签页 ${tabId} 跳过检查（冷却期或非重要操作）`);
        return;
      }
      
      console.log(`开始检查标签页 ${tabId} 的重复标签: ${tab.url}`);
      
      // 提取完整URL，用于通知跟踪
      let fullUrl = tab.url;
      
      // 检查是否有重复标签页
      const duplicates = await checkDuplicateTabs(tab.id, tab.url);
      
      // 更新URL统计
      duplicateCheckTracker.updateUrlStats(tab.url, duplicates.length > 0);
      
      // 如果找到重复标签页
      if (duplicates.length > 0) {
        // 检查是否启用了自动关闭重复标签功能
        if (settings.autoCloseDetectedTabs) {
          console.log(`已启用自动关闭重复标签功能，将关闭 ${duplicates.length} 个重复标签页`);
          
          try {
            // 获取重复标签的ID
            const duplicateIds = duplicates.map(tab => tab.id);
            
            // 关闭重复标签页
            await chrome.tabs.remove(duplicateIds);
            
            // 记录该URL的自动关闭操作
            if (fullUrl) {
              notificationTracker.recordResponse(fullUrl, 'autoclose', tab.url);
              console.log(`已自动关闭URL ${fullUrl} 的 ${duplicateIds.length} 个重复标签页`);
            }
            
            // 显示一个简短的成功通知
            safeTabSendMessage(tab.id, {
              action: 'showAutoCloseSuccessNotification',
              data: {
                count: duplicates.length,
                titles: duplicates.map(t => t.title || '未命名标签页').slice(0, 3)
              }
            }, true);
          } catch (e) {
            console.error('自动关闭重复标签页错误:', e.message);
            // 自动关闭失败时，退回到显示通知
        notifyDuplicateTabs(tab.id, duplicates);
          }
        } else {
          // 未启用自动关闭，显示常规通知
          notifyDuplicateTabs(tab.id, duplicates);
        }
      }
    } catch (e) {
      // 如果标签页不存在，静默忽略
      if (e.message.includes('No tab with id')) {
        console.log('标签页已不存在，忽略检查:', tabId);
      } else {
        console.error('切换标签页后检查重复错误:', e.message);
      }
    }
  } catch (e) {
    console.error('标签页检查防抖函数错误:', e.message);
  }
}, 2000); // 2秒的防抖时间，比之前更短以提高响应速度

// 监听标签页激活事件
chrome.tabs.onActivated.addListener((activeInfo) => {
  console.log(`标签页激活事件: ${activeInfo.tabId}`);
  // 标签页被激活时，检查是否有重复
  checkTabDuplicatesDebounced(activeInfo.tabId, true); // 激活事件是重要操作，设置为true
});

// 监听标签页更新事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  console.log(`标签页更新事件: ${tabId}, status: ${changeInfo.status}, active: ${tab.active}, url: ${changeInfo.url}`);
  // 只在页面加载完成并且是当前激活的标签页时检查
  if (changeInfo.status === 'complete' && tab.active) {
    console.log(`页面加载完成，开始检查重复标签: ${tabId}`);
    checkTabDuplicatesDebounced(tabId);
  } else if (changeInfo.url && tab.active) {
    // URL变化时也检查，但使用短防抖
    console.log(`URL变化，开始检查重复标签: ${tabId}`);
    checkTabDuplicatesDebounced(tabId, true);
  }
});

// 检查与指定标签页URL相同的其他标签页
// 返回重复标签页的数组（不包括指定的标签页）
async function checkDuplicateTabs(tabId, url) {
  try {
    if (!url) return [];
    
    // 空白标签页不检查重复
    const newTabUrls = [
      'chrome://newtab/',
      'edge://newtab/',
      'about:newtab',
      'chrome://new-tab-page/',
      'about:blank'
    ];
    
    // 浏览器特殊页面不检查重复
    if (url.startsWith('chrome://') || 
        url.startsWith('edge://') || 
        url.startsWith('about:') || 
        newTabUrls.includes(url)) {
      return [];
    }
    
    // 检查URL是否在忽略列表中 - 用户已明确选择忽略该URL的重复检测
    if (!notificationTracker.shouldCheckUrl(url)) {
      console.log(`标签页 ${tabId} URL已被用户忽略，跳过重复检测`);
      return [];
    }
    
    // 使用全局URL标准化函数
    
    // 预先规范化当前URL，避免在循环中重复处理
    const normalizedCurrentUrl = normalizeUrl(url);
    console.log('规范化当前URL:', normalizedCurrentUrl);

    // 获取所有标签页
    const tabs = await chrome.tabs.query({});
    
    // 查找URL相同但ID不同的标签页
    const duplicates = [];
    
    // 使用Map存储已处理过的URL，提高大量标签页的处理效率
    const processedUrls = new Map();
    
    // 批量处理标签页，减少重复的URL标准化
    const validTabs = tabs.filter(tab => tab.id !== tabId && isValidTab(tab));
    
    // 批量标准化URL，提高性能
    const normalizedUrls = batchNormalizeUrls(validTabs);
    
    // 查找重复标签页
    for (const tab of validTabs) {
      const normalizedTabUrl = normalizedUrls.get(tab.id);
      if (!normalizedTabUrl) continue;
      
      // 检查规范化后的URL是否匹配
      const isDuplicate = normalizedCurrentUrl === normalizedTabUrl;
      
      // 记录处理结果，以便后续查找同样URL的标签页时可以直接使用结果
      processedUrls.set(tab.url, isDuplicate);
      
      if (isDuplicate) {
        duplicates.push(tab);
      }
    }
    
    console.log(`找到 ${duplicates.length} 个重复标签页，规范化URL: ${normalizedCurrentUrl}`);
    return duplicates;
  } catch (e) {
    console.error('检查重复标签页错误:', e.message);
    return [];
  }
}

// 重复标签通知跟踪器
const notificationTracker = {
  // 通知记录 - 格式: { [domain]: { lastShown: timestamp, totalShown: number, responses: { close: number, ignore: number } } }
  notifications: {},
  // 忽略的URL - 格式: { [normalizedUrl]: timestamp }
  ignoredUrls: {},
  // 标签页特定记录 - 跟踪每个标签页的最后通知时间
  tabNotifications: new Map(),
  
  // 使用全局URL标准化函数
  normalizeUrl: normalizeUrl,
  
  // 检查URL是否应该检测重复
  shouldCheckUrl(url) {
    if (!url) return true;
    
    const normalizedUrl = this.normalizeUrl(url);
    
    // 检查URL是否在忽略列表中
    if (normalizedUrl in this.ignoredUrls) {
      // 检查是否已过期（24小时后自动过期）
      const timestamp = this.ignoredUrls[normalizedUrl];
    const now = Date.now();
    
      if (now - timestamp < 24 * 60 * 60 * 1000) { // 24小时内
        console.log(`URL ${url} 在忽略列表中，跳过检测`);
      return false;
      } else {
        // 已过期，从忽略列表中移除
        delete this.ignoredUrls[normalizedUrl];
      }
    }
    
    return true;
  },
  
  // 清理过期忽略的URL
  cleanupIgnoredUrls() {
    const now = Date.now();
    const expireTime = 24 * 60 * 60 * 1000; // 24小时
    
    Object.keys(this.ignoredUrls).forEach(url => {
      if (now - this.ignoredUrls[url] > expireTime) {
        delete this.ignoredUrls[url];
      }
    });
  },
  
  // 检查是否可以为特定标签页显示通知
  canNotify(tabId, url, count) {
    // 首先检查URL是否在忽略列表中
    if (!this.shouldCheckUrl(url)) {
      return false;
    }
    
    // 使用完整URL作为键
    const fullUrl = url;
    
    const now = Date.now();
    
    // 如果没有该URL的记录，创建一个
    if (!this.notifications[fullUrl]) {
      this.notifications[fullUrl] = {
        lastShown: 0,
        totalShown: 0,
        responses: { close: 0, ignore: 0 }
      };
    }
    
    const record = this.notifications[fullUrl];
    
    // 清理记录中的旧数据
    this.cleanup();
    
    // 标签页特定的时间检查 - 处理在标签页间切换的情况
    // 如果这个标签页之前收到过通知，有自己的冷却时间
    const tabLastNotified = this.tabNotifications.get(tabId) || 0;
    const tabCooldown = 3 * 60 * 1000; // 标签页特定冷却时间：3分钟
    
    // 域名通用冷却时间检查（降低为5分钟，更易于在切换标签页后再次收到通知）
    const domainCooldown = 5 * 60 * 1000; // 5分钟
    
    // 检查标签页特定的冷却时间
    if (now - tabLastNotified < tabCooldown) {
      // 如果有足够多的重复标签页，仍然允许显示
      if (count > 2) {
        // 当有大量重复标签页时，重写冷却时间
        console.log(`标签页 ${tabId} 有 ${count} 个重复标签，允许显示通知`);
      } else {
        console.log(`标签页 ${tabId} 通知冷却中，跳过通知`);
        return false;
      }
    }
    
    // 检查URL通用冷却时间
    if (now - record.lastShown < domainCooldown) {
      // 为URL提供的阈值判断
      if (count < 1 + Math.min(2, record.responses.close)) {
        console.log(`URL ${fullUrl} 重复标签数量未达阈值，跳过通知`);
        return false;
      }
    }
    
    // 更新记录
    record.lastShown = now;
    record.totalShown += 1;
    
    // 更新标签页特定通知时间
    this.tabNotifications.set(tabId, now);
    
    return true;
  },
  
  // 记录用户对通知的响应
  recordResponse(fullUrl, action, url) {
    if (!fullUrl) return;
    
    // 使用完整URL作为键，如果没有该URL的记录，创建一个
    if (!this.notifications[fullUrl]) {
      this.notifications[fullUrl] = {
        lastShown: Date.now(),
        totalShown: 1,
        responses: { close: 0, ignore: 0 }
      };
    }
    
    // 增加相应动作的计数
    if (action in this.notifications[fullUrl].responses) {
      this.notifications[fullUrl].responses[action] += 1;
    }
    
    // 如果是忽略操作，将URL添加到忽略列表
    if (action === 'ignore' && url) {
      const normalizedUrl = this.normalizeUrl(url);
      this.ignoredUrls[normalizedUrl] = Date.now();
      console.log(`添加URL到忽略列表: ${url} (标准化为: ${normalizedUrl})`);
      
      // 保存到session存储
      this.saveIgnoredUrls();
    }
    
    // 保存通知记录
    this.save();
  },
  
  // 清理超过24小时的通知记录
  cleanup() {
    const now = Date.now();
    const expiryTime = 24 * 60 * 60 * 1000; // 24小时
    
    // 清理通知记录
    Object.keys(this.notifications).forEach(domain => {
      const record = this.notifications[domain];
      if (now - record.lastShown > expiryTime) {
        delete this.notifications[domain];
      }
    });
    
    // 清理忽略的URL列表
    this.cleanupIgnoredUrls();
  },
  
  // 清理已关闭标签页的记录
  cleanupTabNotifications(closedTabId) {
    if (closedTabId && this.tabNotifications.has(closedTabId)) {
      // 删除指定的标签页记录
      this.tabNotifications.delete(closedTabId);
      console.log(`清理标签页 ${closedTabId} 的通知记录`);
    } else if (!closedTabId) {
      // 定期清理：检查所有标签页是否仍然有效
      chrome.tabs.query({}, tabs => {
        const existingTabIds = new Set(tabs.map(tab => tab.id));
        
        // 找出并删除不再存在的标签页记录
        for (const tabId of this.tabNotifications.keys()) {
          if (!existingTabIds.has(tabId)) {
            this.tabNotifications.delete(tabId);
            console.log(`清理已关闭标签页 ${tabId} 的记录`);
          }
        }
      });
    }
  },
  
  // 保存通知记录到storage
  save() {
    chrome.storage.local.set({ notificationRecord: this.notifications }, () => {
      if (chrome.runtime.lastError) {
        console.error('保存通知记录错误:', chrome.runtime.lastError.message);
      }
    });
  },
  
  // 保存忽略的URL到storage
  saveIgnoredUrls() {
    try {
      // 首选使用session存储（浏览器关闭时自动清除）
      if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.set({ ignoredUrls: this.ignoredUrls }, () => {
          if (chrome.runtime.lastError) {
            console.error('保存忽略URL列表到session存储错误:', chrome.runtime.lastError.message);
            // 回退到local存储，但添加重启标记
            this.saveIgnoredUrlsToLocal();
          }
        });
      } else {
        // 不支持session存储，回退到local存储
        this.saveIgnoredUrlsToLocal();
      }
    } catch (e) {
      console.error('保存忽略URL列表错误:', e.message);
      this.saveIgnoredUrlsToLocal();
    }
  },
  
  // 备用方案：保存到local存储但添加重启标记
  saveIgnoredUrlsToLocal() {
    const dataWithFlag = {
      ignoredUrls: this.ignoredUrls,
      savedAt: Date.now()  // 记录保存时间，用于判断是否是新的浏览器会话
    };
    
    chrome.storage.local.set({ ignoredUrlsData: dataWithFlag }, () => {
      if (chrome.runtime.lastError) {
        console.error('保存忽略URL列表到local存储错误:', chrome.runtime.lastError.message);
      }
    });
  },
  
  // 从storage加载通知记录
  load() {
    chrome.storage.local.get(['notificationRecord', 'ignoredUrlsData', 'lastSessionId', 'isNewBrowserSession'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('加载通知记录错误:', chrome.runtime.lastError.message);
        return;
      }
      
      if (result.notificationRecord) {
        this.notifications = result.notificationRecord;
      }
      
      // 生成新的会话ID
      const currentSessionId = Date.now().toString();
      
      // 检查是否是新的浏览器会话
      let isNewSession = true;
      
      if (result.isNewBrowserSession) {
        // 如果明确标记为新的浏览器会话，则清除忽略列表
        isNewSession = true;
        console.log('检测到浏览器重启标记，将清除忽略URL列表');
        // 清除标记，避免重复处理
        chrome.storage.local.remove('isNewBrowserSession');
      } else if (result.lastSessionId) {
        // 如果存储的会话ID存在，且当前启动时间与上次相差很远，表示是新会话
        const lastSessionTime = parseInt(result.lastSessionId, 10);
        const timeDiff = currentSessionId - lastSessionTime;
        
        // 如果时间差小于一定阈值（例如5分钟），可能是扩展刷新而非浏览器重启
        // 5分钟 = 300000毫秒
        isNewSession = timeDiff > 300000;
        console.log(`会话检测: 上次会话时间=${new Date(lastSessionTime).toLocaleString()}, 时间差=${Math.round(timeDiff/1000)}秒, 是新会话=${isNewSession}`);
      } else {
        console.log('未找到上次会话ID，视为新会话');
      }
      
      // 保存新的会话ID
      chrome.storage.local.set({ lastSessionId: currentSessionId });
      
      // 尝试从session存储加载忽略的URL列表
      this.loadIgnoredUrlsFromSession(isNewSession, result.ignoredUrlsData);
    });
  },
  
  // 从session存储加载忽略的URL列表
  loadIgnoredUrlsFromSession(isNewSession, fallbackData) {
    try {
      // 检查是否支持session存储
      if (chrome.storage && chrome.storage.session) {
        chrome.storage.session.get(['ignoredUrls'], (sessionResult) => {
          if (chrome.runtime.lastError) {
            console.error('加载session存储中的忽略URL列表错误:', chrome.runtime.lastError.message);
            this.handleFallbackIgnoredUrls(isNewSession, fallbackData);
            return;
          }
          
          if (sessionResult.ignoredUrls) {
            this.ignoredUrls = sessionResult.ignoredUrls;
            console.log('从session存储加载了忽略URL列表');
          } else {
            // session存储中没有数据，尝试备用方案
            this.handleFallbackIgnoredUrls(isNewSession, fallbackData);
          }
          
          // 加载后立即清理过期的忽略URL
          this.cleanupIgnoredUrls();
        });
      } else {
        // 不支持session存储，使用备用方案
        this.handleFallbackIgnoredUrls(isNewSession, fallbackData);
      }
    } catch (e) {
      console.error('加载忽略URL列表错误:', e.message);
      this.handleFallbackIgnoredUrls(isNewSession, fallbackData);
    }
  },
  
  // 处理备用的忽略URL数据
  handleFallbackIgnoredUrls(isNewSession, fallbackData) {
    // 如果是新会话，则清空忽略列表（实现浏览器重启后过期）
    if (isNewSession) {
      console.log('检测到新的浏览器会话，清空忽略URL列表');
      this.ignoredUrls = {};
      return;
    }
    
    // 否则使用备用数据
    if (fallbackData && fallbackData.ignoredUrls) {
      this.ignoredUrls = fallbackData.ignoredUrls;
      console.log('从local存储加载了忽略URL列表');
    }
  }
};

// 初始化通知跟踪器
notificationTracker.load();

// 注册扩展启动事件处理
chrome.runtime.onStartup.addListener(() => {
  console.log('浏览器启动，清理会话数据');
  // 标记为新会话，确保忽略的URL被清除
  chrome.storage.local.set({ 
    lastSessionId: Date.now().toString(),
    isNewBrowserSession: true
  });
});

// 安装/更新事件处理
chrome.runtime.onInstalled.addListener((details) => {
  console.log('扩展安装或更新:', details.reason);
  // 如果是安装或更新，生成新的会话ID
  chrome.storage.local.set({ 
    lastSessionId: Date.now().toString(),
    installOrUpdateTime: Date.now()
  });
});

// 定期清理通知记录 - 每小时执行一次
setInterval(() => {
  notificationTracker.cleanup();
  notificationTracker.save();
  notificationTracker.saveIgnoredUrls();
}, 60 * 60 * 1000);

// 通知用户有重复标签页
function notifyDuplicateTabs(tabId, duplicates) {
  if (!duplicates || duplicates.length === 0) return;
  
  try {
    const count = duplicates.length;
    const duplicateIds = duplicates.map(tab => tab.id);
    
    // 获取当前标签页信息用于URL检查
    chrome.tabs.get(tabId, async (tab) => {
      if (chrome.runtime.lastError) {
        console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
        return;
      }
      
      if (!tab || !tab.url) return;
      
      // 提取域名用于跟踪
      let domain = '';
      try {
        domain = new URL(tab.url).hostname;
      } catch (e) {
        // 忽略无效URL
      }
      
      // 检查是否可以为该URL显示通知
      if (!notificationTracker.canNotify(tabId, tab.url, count)) {
        console.log('已对此URL显示过通知，暂不重复显示');
        return;
      }
      
      // 获取语言设置
      const settings = await chrome.storage.sync.get({ language: 'en' });
      const currentLang = settings.language || 'en';
      const isEnglish = currentLang === 'en';
      
      // 创建通知ID
      const notificationId = `duplicate-tabs-${tabId}-${Date.now()}`;
      
      // 增强的通知数据，包含更多信息
      const notificationData = {
          tabId: tabId,
          duplicateIds: duplicateIds,
        domain: domain,
        tabUrl: tab.url, // 添加标签页URL
        timestamp: Date.now(),
        duplicates: duplicates.map(dupTab => ({
          id: dupTab.id,
          url: dupTab.url,
          title: dupTab.title || '未命名标签页',
          favicon: dupTab.favIconUrl || ''
        }))
      };
      
      // 存储通知相关信息以便后续处理
      chrome.storage.local.set({
        [notificationId]: notificationData
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('保存重复标签页信息错误:', chrome.runtime.lastError.message);
          return;
        }
        
        // 使用改进的安全发送消息函数
        safeTabSendMessage(tabId, {
          action: 'showDuplicateTabsNotification',
          data: {
            count: count,
            notificationId: notificationId,
            domain: domain,
            tabUrl: tab.url,
            duplicateUrls: duplicates.map(tab => tab.url),
            title: duplicates[0].title || '未命名标签页',
            // 提供更详细的重复信息，根据语言提供不同翻译
            summary: chrome.i18n.getMessage(count === 1 ? 'duplicateTabsSingle' : 'duplicateTabsCount', count === 1 ? [] : [count.toString()]) ||
              (isEnglish 
              ? (count === 1 ? 'Found 1 duplicate tab' : `Found ${count} duplicate tabs`)
                : (count === 1 ? '有1个重复标签页' : `有${count}个重复标签页`)),
            // 只发送前3个标题，避免数据过大
            titles: duplicates.slice(0, 3).map(t => t.title || chrome.i18n.getMessage('untitledTab') || (isEnglish ? 'Untitled tab' : '未命名标签页'))
          }
        }, true);  // 设置为静默模式，不显示错误
      });
    });
  } catch (e) {
    console.error('创建重复标签页通知错误:', e.message);
  }
}

// 内容脚本发送的通知响应处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.action === 'closeDuplicateTabs') {
      // 获取通知ID
      const notificationId = message.notificationId;
      
      // 从存储中获取关联的标签页信息
      chrome.storage.local.get([notificationId], async (result) => {
        if (!result || !result[notificationId]) {
          sendResponse({ success: false, error: '未找到通知数据' });
          return;
        }
        
        const { tabId, duplicateIds, domain } = result[notificationId];
        
        // 记录用户选择了关闭重复标签
        if (domain) {
          notificationTracker.recordResponse(domain, 'close', null);
        }
        
        // 关闭所有重复标签页
        try {
          // 在关闭前验证所有标签页是否存在
          const validTabs = [];
          for (const id of duplicateIds) {
            try {
              await chrome.tabs.get(id);
              validTabs.push(id);
            } catch (e) {
              console.log(`标签页 ${id} 已不存在，忽略关闭`);
            }
          }
          
          // 只关闭存在的标签页
          if (validTabs.length > 0) {
            await chrome.tabs.remove(validTabs);
          }
          
          // 确保当前标签页仍保持活动状态（如果存在）
          try {
            await chrome.tabs.get(tabId);
            await chrome.tabs.update(tabId, { active: true });
          } catch (e) {
            console.log(`当前标签页 ${tabId} 已不存在，忽略激活`);
          }
          
          // 清理存储的通知数据
          chrome.storage.local.remove(notificationId);
          
          sendResponse({ success: true });
        } catch (e) {
          console.error('关闭重复标签页错误:', e.message);
          sendResponse({ success: false, error: e.message });
        }
      });
      
      return true; // 异步响应
    } else if (message.action === 'ignoreDuplicateTabs') {
      // 记录用户忽略了重复标签通知
      const notificationId = message.notificationId;
      
      chrome.storage.local.get([notificationId], (result) => {
        if (result && result[notificationId]) {
          const { domain, duplicates } = result[notificationId];
          
          // 获取标签页的URL - 用于添加到忽略列表
          let url = null;
          if (result[notificationId].tabUrl) {
            url = result[notificationId].tabUrl;
          } else if (duplicates && duplicates.length > 0) {
            // 尝试从重复标签中获取URL
            url = duplicates[0].url;
          }
          
          if (domain) {
            notificationTracker.recordResponse(domain, 'ignore', url);
          }
          
          // 清理存储的通知数据
          chrome.storage.local.remove(notificationId);
        }
        
        sendResponse({ success: true });
      });
      
      return true; // 异步响应
    } 
    
    // 其他消息处理保持不变...
  } catch (e) {
    console.error('处理消息错误:', e.message);
    sendResponse({ success: false, error: e.message });
  }
  
  return true;
});

// 检查是否存在空白新标签页
// 如果存在，激活该标签页并返回true，否则返回false
async function checkAndActivateEmptyTab() {
  try {
    // 获取所有标签页
    const tabs = await chrome.tabs.query({});
    
    // 空白新标签页的可能URL模式
    const newTabUrls = [
      'chrome://newtab/',
      'edge://newtab/',
      'about:newtab',
      'chrome://new-tab-page/',
      'about:blank'
    ];
    
    // 查找符合条件的标签页
    for (const tab of tabs) {
      // 跳过没有URL的标签页
      if (!tab.url) continue;
      
      // 检查是否是新标签页
      if (newTabUrls.includes(tab.url)) {
        console.log('找到空白新标签页，ID:', tab.id);
        
        // 激活找到的标签页
        await chrome.tabs.update(tab.id, { active: true });
        
        // 将窗口置于前台
        if (tab.windowId) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        
        return true; // 表示找到并激活了空白标签页
      }
    }
    
    // 未找到空白新标签页
    console.log('未找到空白新标签页');
    return false;
  } catch (e) {
    console.error('检查空白标签页错误:', e.message);
    return false;
  }
}

// 检查URL是否已在现有标签页中打开
// 如果找到匹配的标签页，则激活该标签页并返回true
// 如果未找到匹配的标签页，则返回false
async function checkAndActivateExistingTab(url) {
  try {
    // 如果URL为空，可能是想打开新标签页
    if (!url) {
      return await checkAndActivateEmptyTab();
    }
    
    // 特殊情况：如果请求打开的是新标签页
    const newTabUrls = [
      'chrome://newtab/',
      'edge://newtab/',
      'about:newtab',
      'chrome://new-tab-page/',
      'about:blank'
    ];
    
    if (newTabUrls.includes(url)) {
      return await checkAndActivateEmptyTab();
    }
    
    // 规范化URL以确保一致的比较
    // 只移除URL末尾的空片段标识符（#）
    const normalizedUrl = new URL(url);
    if (normalizedUrl.hash === '#') {
      normalizedUrl.hash = '';
    }
    const urlToFind = normalizedUrl.toString();
    
    console.log('检查是否存在相同URL的标签页:', urlToFind);
    
    // 获取所有标签页
    const tabs = await chrome.tabs.query({});
    
    // 查找具有相同URL的标签页
    for (const tab of tabs) {
      // 跳过没有URL的标签页
      if (!tab.url) continue;
      
      // 规范化标签页的URL
      const tabNormalizedUrl = new URL(tab.url);
      if (tabNormalizedUrl.hash === '#') {
        tabNormalizedUrl.hash = '';
      }
      const tabUrl = tabNormalizedUrl.toString();
      
      // 检查URL是否匹配
      if (tabUrl === urlToFind) {
        console.log('找到相同URL的标签页，ID:', tab.id);
        
        // 激活找到的标签页
        await chrome.tabs.update(tab.id, { active: true });
        
        // 将窗口置于前台
        if (tab.windowId) {
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        
        return true; // 表示找到并激活了现有标签页
      }
    }
    
    // 未找到匹配的标签页
    console.log('未找到相同URL的标签页');
    return false;
  } catch (e) {
    console.error('检查现有标签页错误:', e.message);
    return false; // 出错时返回false，允许创建新标签页
  }
}

// 优化内存使用的函数
function optimizeMemoryUsage() {
  try {
    // 清理通知跟踪器
    notificationTracker.cleanup();
    
    // 智能清理URL标准化缓存
    checkAndCleanCache();
    
    // 清理URL缓存
    if (lastCheckedTab.processedUrls && lastCheckedTab.processedUrls.size > 100) {
      lastCheckedTab.processedUrls.clear();
    }
    
    // 清理URL频率数据，只保留最近访问的URL
    if (duplicateCheckTracker && duplicateCheckTracker.urlFrequency) {
      const urls = Array.from(duplicateCheckTracker.urlFrequency.entries());
      if (urls.length > 50) {
        // 只保留最近使用的50个URL
        urls.sort((a, b) => {
          const lastTimeA = a[1].lastTime || 0;
          const lastTimeB = b[1].lastTime || 0;
          return lastTimeB - lastTimeA;
        });
        
        // 创建新的Map
        const newMap = new Map();
        urls.slice(0, 50).forEach(([url, stats]) => {
          newMap.set(url, stats);
        });
        
        duplicateCheckTracker.urlFrequency = newMap;
      }
    }
    
    // 清理tab检查缓存
    if (duplicateCheckTracker && duplicateCheckTracker.tabChecks) {
      duplicateCheckTracker.cleanup();
    }
    
    // 清理存储中的旧通知数据
    chrome.storage.local.get(null, (items) => {
      const now = Date.now();
      const keysToRemove = [];
      
      for (const key in items) {
        // 只处理重复标签页通知数据
        if (key.startsWith('duplicate-tabs-')) {
          const data = items[key];
          
          // 删除超过1小时的通知数据
          if (data.timestamp && (now - data.timestamp) > 3600000) {
            keysToRemove.push(key);
          }
        }
      }
      
      if (keysToRemove.length > 0) {
        chrome.storage.local.remove(keysToRemove, () => {
          console.log(`已清理 ${keysToRemove.length} 条过期通知数据`);
        });
      }
    });
  } catch (e) {
    console.warn('内存优化错误:', e.message);
  }
}

// 动态内存清理机制
let memoryCleanupInterval = 30 * 60 * 1000; // 默认30分钟
let lastCleanupTime = Date.now();

// 根据缓存使用率动态调整清理频率
function adjustCleanupFrequency() {
  const usageRatio = urlNormalizeCache.size / MAX_CACHE_SIZE;
  
  if (usageRatio > 0.8) {
    // 缓存使用率高，增加清理频率
    memoryCleanupInterval = 10 * 60 * 1000; // 10分钟
  } else if (usageRatio > 0.6) {
    // 缓存使用率中等，正常清理频率
    memoryCleanupInterval = 20 * 60 * 1000; // 20分钟
  } else {
    // 缓存使用率低，减少清理频率
    memoryCleanupInterval = 45 * 60 * 1000; // 45分钟
  }
}

// 定期优化内存使用
function scheduleMemoryCleanup() {
  adjustCleanupFrequency();
  
  setTimeout(() => {
    optimizeMemoryUsage();
    lastCleanupTime = Date.now();
    
    // 输出缓存统计信息
    logCacheStats();
    
    scheduleMemoryCleanup(); // 递归调度下次清理
  }, memoryCleanupInterval);
}

// 启动内存清理调度
scheduleMemoryCleanup();

// 智能打开标签页 - 如果标签页已存在则跳转，否则创建新标签页
async function smartCreateTab(url, active = true) {
  try {
    // 获取当前活动标签页的索引，用于在新标签页旁边创建标签页
    let currentTabIndex = null;
    try {
      const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (currentTabs.length > 0) {
        const allTabs = await chrome.tabs.query({ currentWindow: true });
        currentTabIndex = allTabs.findIndex(tab => tab.id === currentTabs[0].id);
        if (currentTabIndex !== -1) {
          currentTabIndex += 1; // 在下一个位置创建新标签页
        }
      }
    } catch (e) {
      console.warn('获取当前标签页索引失败:', e.message);
    }

    // 如果URL为空，说明是打开空白新标签页
    if (!url || typeof url !== 'string') {
      console.log('尝试打开空白新标签页');
      
      // 尝试查找并激活现有的空白标签页
      const existingEmptyTabActivated = await checkAndActivateEmptyTab();
      
      // 如果没有找到空白标签页，则创建一个
      if (!existingEmptyTabActivated) {
        console.log('创建新的空白标签页');
        try {
          await createTabWithRecentIndex(null, true);
        } catch (e) {
          console.error('创建空白标签页错误:', e.message);
        }
      }
      
      return;
    }
    
    // 对于非空URL，执行标准处理
    try {
      // 检查是否是特殊协议URL
      const hasSpecialProtocol = SPECIAL_PROTOCOLS.some(protocol => url.toLowerCase().startsWith(protocol));
      
      // 如果不是特殊协议URL，则添加https://
      if (!hasSpecialProtocol) {
        url = 'https://' + url;
      }
      
      // 特殊处理 chrome-extension:// URL 中的双斜杠问题
      if (url.startsWith('chrome-extension://')) {
        url = url.replace(/chrome-extension:\/\/([^\/]*)\/\//, 'chrome-extension://$1/');
        console.log('处理后的扩展URL:', url);
      }
      
      // 特殊处理新标签页的情况
      if (NEW_TAB_URLS.includes(url)) {
        return await checkAndActivateEmptyTab() || (async () => {
          try {
            return await createTabWithRecentIndex(null, true);
          } catch (e) {
            console.error('创建新标签页错误:', e.message);
            return null;
          }
        })();
      }
      
      new URL(url); // 验证URL格式
    } catch (e) {
      console.error('URL格式无效:', url, e.message);
      return;
    }
    
    // 首先检查该URL是否已在现有标签页中打开
    const existingTabActivated = await checkAndActivateExistingTab(url);
    
    // 如果已经激活了现有标签页，就不需要创建新标签页
    if (existingTabActivated) {
      console.log('已跳转到现有标签页，不创建新标签页');
      return;
    }
    
    // 新增: 自动关闭重复标签功能
    // 获取设置
    const settings = await chrome.storage.sync.get({
      enableDuplicateCheck: true,
      autoCloseDetectedTabs: false, // 默认不自动关闭
      smartTabHandling: true // 智能打开标签页
    });
    
    // 如果启用了自动关闭重复标签
    if (settings.enableDuplicateCheck && settings.autoCloseDetectedTabs) {
      try {
        // 先检查是否有重复标签
        const allTabs = await chrome.tabs.query({});
        
        // 使用全局URL标准化函数
        
        const normalizedUrl = normalizeUrl(url);
        const potentialDuplicates = [];
        
        // 查找潜在的重复标签
        const validTabs = allTabs.filter(isValidTab);
        const normalizedUrls = batchNormalizeUrls(validTabs);
        
        for (const tab of validTabs) {
          const normalizedTabUrl = normalizedUrls.get(tab.id);
          if (normalizedTabUrl && normalizedUrl === normalizedTabUrl) {
            potentialDuplicates.push(tab);
          }
        }
        
        // 找到重复标签，关闭它们，只保留一个并激活它
        if (potentialDuplicates.length > 0) {
          const tabToKeep = potentialDuplicates[0];
          
          // 关闭其他重复标签
          if (potentialDuplicates.length > 1) {
            const tabIdsToRemove = potentialDuplicates.slice(1).map(tab => tab.id);
            await chrome.tabs.remove(tabIdsToRemove);
            console.log(`自动关闭了 ${tabIdsToRemove.length} 个重复标签页`);
          }
          
          // 激活保留的标签
          await chrome.tabs.update(tabToKeep.id, { active: true });
          
          // 如果该标签页在不同窗口，则聚焦该窗口
          if (tabToKeep.windowId) {
            await chrome.windows.update(tabToKeep.windowId, { focused: true });
          }
          
          console.log('已激活现有标签页，不创建新标签页');
          return;
        }
      } catch (e) {
        console.warn('自动关闭重复标签检查错误:', e.message);
        // 错误时继续正常创建标签
      }
    }
    
    // 未找到现有标签页，创建新标签页
    console.log('创建新标签页:', url);
    try {
      const tab = await createTabWithRecentIndex(url, active);
      console.log('成功创建新标签页:', tab.id);
      
      // 添加延迟，确保标签页加载完成再检查重复
      // 由于onActivated和onUpdated事件会自动触发检查，这里延长到2秒检查以避免频繁重复检查
      setTimeout(async () => {
          try {
            // 获取当前打开的标签页
            const currentTab = await chrome.tabs.get(tab.id);
            if (!currentTab || !currentTab.url) return;
            
            // 检查该标签页是否已在冷却期内
            const now = Date.now();
            if (lastCheckedTab.id === tab.id && 
                lastCheckedTab.url === currentTab.url && 
                (now - lastCheckedTab.time) < lastCheckedTab.cooldown) {
              console.log(`新创建标签页 ${tab.id} 已在其他事件中检查过，跳过检查`);
              return;
            }
            
            // 更新最近检查记录
            lastCheckedTab = {
              id: tab.id,
              url: currentTab.url,
              time: now,
              cooldown: lastCheckedTab.cooldown,
              processedUrls: lastCheckedTab.processedUrls
            };
            
            // 检查是否有重复标签页
            const duplicates = await checkDuplicateTabs(tab.id, currentTab.url);
            
            // 如果找到重复标签页，显示通知
            if (duplicates.length > 0) {
              notifyDuplicateTabs(tab.id, duplicates);
            }
          } catch (e) {
            console.error('标签页打开后检查重复错误:', e.message);
          }
        }, 2000);
    } catch (e) {
      console.error('创建新标签页错误:', e.message);
    }
  } catch (e) {
    console.error('智能创建标签页错误:', e.message);
  }
}

// 监听来自内容脚本的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;
  
  try {
    console.log('收到消息:', message);
    
    switch (message.action) {
      case 'ping':
        // 简单的ping响应，用于检查扩展上下文是否有效
        sendResponse({ success: true, message: 'pong' });
        break;
        
      case 'goBack':
        // 后退
        try {
          // 使用 try-catch 捕获可能的错误
          chrome.tabs.goBack(tabId).catch(error => {
            console.log('后退操作错误 (已处理):', error.message);
            // 可以选择向内容脚本发送失败通知
            chrome.tabs.sendMessage(tabId, { 
              action: 'navigationFailed', 
              operation: 'back',
              error: error.message 
            }).catch(() => {});
          });
        } catch (e) {
          console.log('后退操作异常 (已处理):', e.message);
        }
        break;
        
      case 'goForward':
        // 前进
        try {
          // 使用 try-catch 捕获可能的错误
          chrome.tabs.goForward(tabId).catch(error => {
            console.log('前进操作错误 (已处理):', error.message);
            // 可以选择向内容脚本发送失败通知
            chrome.tabs.sendMessage(tabId, { 
              action: 'navigationFailed', 
              operation: 'forward',
              error: error.message 
            }).catch(() => {});
          });
        } catch (e) {
          console.log('前进操作异常 (已处理):', e.message);
        }
        break;
        
      case 'scrollUp':
      case 'scrollDown':
      case 'scrollLeft':
      case 'scrollRight':
      case 'scrollToTop':
      case 'scrollToBottom':
        // 这些滚动操作在内容脚本中处理，这里只需转发消息
        // 为所有滚动动作添加动态距离支持
        if (message.action === 'scrollUp' || message.action === 'scrollDown' || 
            message.action === 'scrollLeft' || message.action === 'scrollRight') {
          // 如果消息中包含距离参数，则传递该参数
          safeTabSendMessage(tabId, { 
            action: message.action, 
            distance: message.distance || 100 // 如果没有提供，则使用默认值100
          });
        } else {
          // 对于其他滚动操作（如scrollToTop和scrollToBottom），保持原样
        safeTabSendMessage(tabId, { action: message.action });
        }
        break;
        
      case 'closeTab':
        // 关闭当前标签页
        chrome.tabs.remove(tabId);
        break;
        
      case 'reopenClosedTab':
        // 重新打开关闭的标签页
        chrome.sessions.getRecentlyClosed({ maxResults: 1 }, function(sessions) {
          if (chrome.runtime.lastError) {
            console.log('获取最近关闭标签页错误:', chrome.runtime.lastError.message);
            return;
          }
          
          if (sessions.length) {
            chrome.sessions.restore();
          }
        });
        break;
        
      case 'openNewTab':
        // 打开空白新标签页 - 也进行检查是否已有空白标签页
        smartCreateTab(null, true);
        break;
        
      case 'refresh':
        // 刷新当前页面
        chrome.tabs.reload(tabId);
        break;
        
      case 'forceRefresh':
        // 强制刷新当前页面（忽略缓存）
        chrome.tabs.reload(tabId, { bypassCache: true });
        break;
        
      case 'switchToLeftTab':
        // 切换到左侧标签页
        switchToAdjacentTab(tabId, -1);
        break;
        
      case 'switchToRightTab':
        // 切换到右侧标签页
        switchToAdjacentTab(tabId, 1);
        break;
        
      case 'stopLoading':
        // 停止加载
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: () => { window.stop(); }
        }).then(result => {
          console.log('页面加载已停止');
        }).catch(error => {
          console.error('停止页面加载时出错:', error.message);
          // 错误发生时尝试通过消息传递的方式执行stop
          safeTabSendMessage(tabId, { action: 'stopLoadingInternal' });
        });
        break;
        
      case 'closeAllTabs':
        // 关闭所有标签页（保留当前标签页）
        closeAllTabs(tabId);
        break;
        
      case 'newWindow':
        // 新窗口
        chrome.windows.create({ url: 'chrome://newtab/' });
        break;
        
      case 'newInPrivateWindow':
        // 新建隐私窗口
        chrome.windows.create({ 
          url: 'chrome://newtab/',
          incognito: true 
        });
        break;
        
      case 'closeOtherTabs':
        // 关闭其他标签页
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
            const tabsToClose = tabs.filter(t => t.id !== tabId);
            if (tabsToClose.length > 0) {
              chrome.tabs.remove(tabsToClose.map(t => t.id));
            }
          });
        });
        break;
        
      case 'closeTabsToRight':
        // 关闭右侧标签页
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
            const currentTabIndex = tabs.findIndex(t => t.id === tabId);
            const tabsToClose = tabs.filter((t, index) => index > currentTabIndex);
            if (tabsToClose.length > 0) {
              chrome.tabs.remove(tabsToClose.map(t => t.id));
            }
          });
        });
        break;
        
      case 'toggleFullscreen':
        // 切换全屏
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.windows.get(tab.windowId, (window) => {
            if (chrome.runtime.lastError) {
              console.log('获取窗口信息错误:', chrome.runtime.lastError.message);
              return;
            }
            chrome.windows.update(tab.windowId, {
              state: window.state === 'fullscreen' ? 'normal' : 'fullscreen'
            });
          });
        });
        break;
        
      case 'closeTabsToLeft':
        // 关闭左侧标签页
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
            const currentTabIndex = tabs.findIndex(t => t.id === tabId);
            const tabsToClose = tabs.filter((t, index) => index < currentTabIndex);
            if (tabsToClose.length > 0) {
              chrome.tabs.remove(tabsToClose.map(t => t.id));
            }
          });
        });
        break;
        
      case 'reloadAllTabs':
        // 全部重新加载
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
            tabs.forEach(t => {
              // 跳过特殊页面（如chrome://页面）
              if (t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://')) {
                chrome.tabs.reload(t.id);
              }
            });
          });
        });
        break;
        
      case 'togglePinTab':
        // 固定/取消固定标签页
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.tabs.update(tabId, { pinned: !tab.pinned });
        });
        break;
        
      case 'toggleMuteTab':
        // 静音/取消静音标签页
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.tabs.update(tabId, { muted: !tab.mutedInfo.muted });
        });
        break;
        
      case 'muteOtherTabs':
        // 静音其他标签页
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
            tabs.forEach(t => {
              if (t.id !== tabId) {
                chrome.tabs.update(t.id, { muted: true });
              }
            });
          });
        });
        break;
        
      case 'toggleMaximize':
        // 最大化/还原窗口
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.windows.get(tab.windowId, (window) => {
            if (chrome.runtime.lastError) {
              console.log('获取窗口信息错误:', chrome.runtime.lastError.message);
              return;
            }
            chrome.windows.update(tab.windowId, {
              state: window.state === 'maximized' ? 'normal' : 'maximized'
            });
          });
        });
        break;
        
      case 'minimizeWindow':
        // 最小化窗口
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
            return;
          }
          chrome.windows.update(tab.windowId, { state: 'minimized' });
        });
        break;
        
      case 'superDrag':
        // 处理超级拖拽
        handleSuperDrag(message);
        sendResponse({ success: true });
        break;
      
      // 在后台打开标签页
      case 'openTabInBackground':
        if (message.url) {
          smartCreateTab(message.url, false);
        }
        sendResponse({ success: true });
        break;

      // 拖拽图片或可下载文件时自动下载
      case 'downloadUrl':
        if (message.url) {
          try {
            chrome.downloads.download({ url: message.url }, (downloadId) => {
              if (chrome.runtime.lastError) {
                console.warn('下载失败:', chrome.runtime.lastError.message);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
              } else {
                sendResponse({ success: true });
              }
            });
          } catch (e) {
            console.warn('下载请求异常:', e.message);
            sendResponse({ success: false, error: e.message });
          }
        } else {
          sendResponse({ success: false, error: 'URL 为空' });
        }
        return true; // 异步响应
        
      case 'fetchUrlContent':
        fetchUrlContent(message.url)
          .then(content => {
            sendResponse({ success: true, content: content });
          })
          .catch(error => {
            console.warn('获取URL内容失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // 异步响应
        
      case 'resolveRedirectUrl':
        resolveRedirectUrl(message.url)
          .then(finalUrl => {
            sendResponse({ success: true, finalUrl: finalUrl });
          })
          .catch(error => {
            console.warn('解析重定向URL失败:', error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // 异步响应
        
      case 'openInNewTab':
        // 使用统一的标签页创建函数
        createTabWithRecentIndex(message.url, true)
          .then(() => {
            sendResponse({ success: true });
          })
          .catch(e => {
            console.error('在新标签页中打开URL错误:', e.message);
            sendResponse({ success: false, error: e.message });
          });
        return true;
        
      case 'scrollToLeft':
        // 通过content script执行滚动操作
        chrome.tabs.sendMessage(sender.tab.id, { action: 'scrollToLeft' }, (response) => {
          sendResponse(response || { success: true });
        });
        return true;
        
      case 'scrollToRight':
        // 通过content script执行滚动操作
        chrome.tabs.sendMessage(sender.tab.id, { action: 'scrollToRight' }, (response) => {
          sendResponse(response || { success: true });
        });
        return true;
        
      default:
        console.log('未知消息类型:', message.action);
        sendResponse({ success: false, error: '未知消息类型' });
        break;
    }
    
    // 如果没有在case中发送响应，这里发送默认响应
    if (message.action !== 'ping' && message.action !== 'superDrag') {
      sendResponse({ success: true });
    }
  } catch (e) {
    console.error('处理消息错误:', e.message);
    sendResponse({ success: false, error: e.message });
  }
  
  return true;
});

// 安全地向标签页发送消息
function safeTabSendMessage(tabId, message, silent = false) {
  if (!tabId) return Promise.resolve(false);
  
  return new Promise((resolve) => {
    try {
      // 首先检查标签页是否有效
      chrome.tabs.get(tabId, (tab) => {
        // 如果标签页不存在
        if (chrome.runtime.lastError) {
          if (!silent) {
            console.log('目标标签页不存在:', chrome.runtime.lastError.message);
          }
          resolve(false);
          return;
        }
        
        // 检查URL是否是Chrome内部页面
        if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
          if (!silent) {
            console.log('无法向Chrome内部页面发送消息:', tab.url);
          }
          resolve(false);
          return;
        }
        
        // 然后尝试发送消息
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) {
            if (!silent) {
              console.log('发送消息时出错:', chrome.runtime.lastError.message);
            }
            resolve(false);
          } else {
            resolve(response || true);
          }
        });
      });
    } catch (e) {
      if (!silent) {
        console.error('向标签页发送消息异常:', e.message);
      }
      resolve(false);
    }
  });
}

// 切换到相邻标签页
function switchToAdjacentTab(currentTabId, offset) {
  try {
    chrome.tabs.query({ currentWindow: true }, function(tabs) {
      if (chrome.runtime.lastError) {
        console.error('查询标签页错误:', chrome.runtime.lastError.message);
        return;
      }
      
      if (tabs.length <= 1) return;
      
      let currentIndex = -1;
      for (let i = 0; i < tabs.length; i++) {
        if (tabs[i].id === currentTabId) {
          currentIndex = i;
          break;
        }
      }
      
      if (currentIndex === -1) return;
      
      // 计算目标索引，处理循环
      let targetIndex = (currentIndex + offset) % tabs.length;
      if (targetIndex < 0) targetIndex = tabs.length - 1;
      
      // 获取目标标签页ID
      const targetTabId = tabs[targetIndex].id;
      
      // 激活目标标签页
      chrome.tabs.update(targetTabId, { active: true }, () => {
        if (chrome.runtime.lastError) {
          console.error('激活标签页错误:', chrome.runtime.lastError.message);
          return;
        }
        
        // 标签页切换后进行重复检查（通过onActivated事件自动处理）
      });
    });
  } catch (e) {
    console.error('切换标签页错误:', e.message);
  }
}

// 关闭所有标签页（保留当前标签页）
function closeAllTabs(currentTabId) {
  try {
    chrome.tabs.query({ currentWindow: true }, function(tabs) {
      if (chrome.runtime.lastError) {
        console.error('查询标签页错误:', chrome.runtime.lastError.message);
        return;
      }
      
      for (const tab of tabs) {
        if (tab.id !== currentTabId) {
          chrome.tabs.remove(tab.id);
        }
      }
    });
  } catch (e) {
    console.error('关闭所有标签页错误:', e.message);
  }
}

// 处理超级拖拽
function handleSuperDrag(message) {
  try {
    console.log('收到超级拖拽请求:', message);
    
    // 获取用户设置的搜索引擎URL
    chrome.storage.sync.get({
      dragSearchEngine: 'https://www.google.com/search?q={q}'
    }, (settings) => {
      // 提取搜索引擎URL
      let searchEngineUrl = settings.dragSearchEngine || 'https://www.google.com/search?q={q}';
      
      // 根据明确指定的actionType决定标签页打开方式
      // 如果没有actionType，默认使用后台打开
      let openInForeground;
      
      if (message.actionType) {
        openInForeground = message.actionType === 'foreground';
      } else {
        // 默认使用后台打开，完全依赖用户设置
        openInForeground = false;
      }
      
      const actionType = message.actionType || (openInForeground ? 'foreground' : 'background');

      // 分屏四向：actionType -> 方向（splitLeft->left, splitRight->right, splitUp->up, splitDown->down）
      const splitDirectionMap = { splitLeft: 'left', splitRight: 'right', splitUp: 'up', splitDown: 'down' };
      const splitDirection = splitDirectionMap[actionType];
      
      if (message.type === 'text') {
        // 处理文本拖拽
        if (splitDirection) {
          // 分屏视图（四向）：在新窗口中分屏打开搜索结果
          let finalSearchUrl = searchEngineUrl.replace('{q}', encodeURIComponent(message.text));
          openUrlInSplitView(finalSearchUrl, splitDirection);
        } else if (openInForeground) {
          try {
            // 前台打开：首先尝试使用chrome.search.query API
            chrome.search.query({
              text: message.text,
              disposition: 'NEW_TAB'
            }, () => {
              if (chrome.runtime.lastError) {
                console.error('使用搜索API错误:', chrome.runtime.lastError.message);
                // 回退到自定义搜索引擎作为备选方案
                let finalSearchUrl = searchEngineUrl.replace('{q}', encodeURIComponent(message.text));
                smartCreateTab(finalSearchUrl, true);
              }
            });
          } catch (e) {
            // 如果chrome.search.query API不可用，使用自定义搜索引擎
            console.error('搜索API不可用:', e.message);
            let finalSearchUrl = searchEngineUrl.replace('{q}', encodeURIComponent(message.text));
            smartCreateTab(finalSearchUrl, true);
          }
        } else {
          // 后台打开：使用自定义搜索引擎（search API不支持后台打开）
          let finalSearchUrl = searchEngineUrl.replace('{q}', encodeURIComponent(message.text));
          smartCreateTab(finalSearchUrl, false);
        }
        return;
      }
      
      // 检查URL是否有效
      if (!message.url || typeof message.url !== 'string') {
        console.error('超级拖拽URL无效:', message.url);
        return;
      }
      
      // 尝试解析URL，确保它是有效的
      let url = message.url;
      try {
        // 如果URL不是以http或https开头，尝试添加https://
        // 保持与smartCreateTab函数处理一致
        if (!url.startsWith('http://') && !url.startsWith('https://') && 
            !url.startsWith('data:') && !url.startsWith('chrome://') && 
            !url.startsWith('edge://') && !url.startsWith('about:')) {
          url = 'https://' + url;
        }
        new URL(url); // 验证URL格式
        
        // 处理不同类型的拖拽
        if (message.type === 'link' || message.type === 'image') {
          // 处理链接或图片拖拽
          if (splitDirection) {
            // 分屏视图（四向）：在新窗口中分屏打开链接或图片
            openUrlInSplitView(url, splitDirection);
          } else {
            // 前台或后台打开取决于用户选择的操作类型
            console.log(`准备${openInForeground ? '前台' : '后台'}打开链接:`, url);
            smartCreateTab(url, openInForeground);
          }
        }
      } catch (e) {
        console.error('超级拖拽URL格式无效:', url, e.message);
        return;
      }
    });
  } catch (e) {
    console.error('处理超级拖拽错误:', e.message);
  }
}

// 在新窗口中打开URL并进行简单的分屏布局
function openUrlInSplitView(url, direction) {
  try {
    chrome.windows.getCurrent((currentWindow) => {
      if (chrome.runtime.lastError) {
        console.error('获取当前窗口信息错误:', chrome.runtime.lastError.message);
        // 回退：正常在新标签页中打开
        smartCreateTab(url, true);
        return;
      }
      
      try {
        const isFullscreen = currentWindow.state === 'fullscreen';
        const totalWidth = currentWindow.width || 1200;
        const totalHeight = currentWindow.height || 800;
        const baseLeft = currentWindow.left || 0;
        const baseTop = currentWindow.top || 0;

        // 记录原始窗口大小和状态，用于分屏窗口关闭后恢复
        const originalBounds = {
          left: baseLeft,
          top: baseTop,
          width: totalWidth,
          height: totalHeight,
          state: currentWindow.state || 'normal'
        };
        
        const halfWidth = Math.max(Math.round(totalWidth / 2), 400);
        const halfHeight = Math.max(Math.round(totalHeight / 2), 300);

        // 先计算两个区域：currentWindowRect / newWindowRect
        let currentRect = {
          left: baseLeft,
          top: baseTop,
          width: totalWidth,
          height: totalHeight
        };
        let newRect = { ...currentRect };

        // 左/右分屏（方向来自用户在下拉中的选择）
        if (direction === 'left' || direction === 'right') {
          currentRect.width = halfWidth;
          newRect.width = halfWidth;
          currentRect.height = totalHeight;
          newRect.height = totalHeight;

          if (direction === 'right') {
            // 当前窗口在左，新窗口在右
            currentRect.left = baseLeft;
            newRect.left = baseLeft + totalWidth - halfWidth;
          } else {
            // 左分屏：当前窗口在右，新窗口在左
            currentRect.left = baseLeft + totalWidth - halfWidth;
            newRect.left = baseLeft;
          }
        }
        // 上/下分屏（方向来自用户在下拉中的选择）
        else if (direction === 'up' || direction === 'down') {
          currentRect.height = halfHeight;
          newRect.height = halfHeight;
          currentRect.width = totalWidth;
          newRect.width = totalWidth;

          if (direction === 'down') {
            // 当前窗口在上，新窗口在下
            currentRect.top = baseTop;
            newRect.top = baseTop + totalHeight - halfHeight;
          } else {
            // 上分屏：当前窗口在下，新窗口在上
            currentRect.top = baseTop + totalHeight - halfHeight;
            newRect.top = baseTop;
          }
        }

        // 如果是全屏窗口，出于安全限制通常不能强制退出全屏，这里只新建分屏窗口，不调整原窗口
        if (isFullscreen) {
          chrome.windows.create({
            url,
            left: newRect.left,
            top: newRect.top,
            width: newRect.width,
            height: newRect.height,
            focused: true,
            type: 'normal'
          }, (createdWindow) => {
            if (chrome.runtime.lastError) {
              console.error('全屏模式下创建分屏窗口错误:', chrome.runtime.lastError.message);
              smartCreateTab(url, true);
            } else {
              console.log('全屏模式下已在新窗口中打开URL:', url, '窗口ID:', createdWindow.id);
            }
          });
          return;
        }

        // 构造一个函数，用于在窗口为 normal 状态时执行真正的分屏更新+新建窗口逻辑
        const doSplitUpdate = () => {
          chrome.windows.update(currentWindow.id, {
            left: currentRect.left,
            top: currentRect.top,
            width: currentRect.width,
            height: currentRect.height,
            focused: true,
            state: 'normal'
          }, (updatedWindow) => {
            if (chrome.runtime.lastError) {
              console.error('更新当前窗口为分屏大小错误:', chrome.runtime.lastError.message);
              // 回退：直接新标签页
              smartCreateTab(url, true);
              return;
            }

            chrome.windows.create({
              url,
              left: newRect.left,
              top: newRect.top,
              width: newRect.width,
              height: newRect.height,
              focused: true,
              type: 'normal'
            }, (createdWindow) => {
              if (chrome.runtime.lastError) {
                console.error('创建分屏窗口错误:', chrome.runtime.lastError.message);
                // 回退：正常打开标签页
                smartCreateTab(url, true);
              } else {
                console.log('已在分屏窗口中打开URL:', url, '窗口ID:', createdWindow.id);
                // 仅在非全屏模式下记录会话信息（全屏时原窗口未改变，无需恢复）
                if (!isFullscreen) {
                  splitViewSessions[createdWindow.id] = {
                    originalWindowId: currentWindow.id,
                    originalBounds
                  };
                }
              }
            });
          });
        };

        // 普通/最大化窗口：直接基于当前窗口尺寸计算好的矩形执行分屏逻辑
        // （最大化时 totalWidth/totalHeight 即为当前占满屏幕的大小）
        doSplitUpdate();
      } catch (e) {
        console.error('计算分屏窗口大小/位置时出错:', e.message);
        smartCreateTab(url, true);
      }
    });
  } catch (e) {
    console.error('openUrlInSplitView 执行错误:', e.message);
    smartCreateTab(url, true);
  }
}

// 获取URL内容
async function fetchUrlContent(url) {
  try {
    console.log('尝试获取URL内容:', url);
    
    // 直接获取URL内容，不使用代理
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      redirect: 'follow',
      headers: {
        'User-Agent': navigator.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    
    // 获取内容类型
    const contentType = response.headers.get('Content-Type') || 'text/html';
    const content = await response.text();
    
    console.log('成功获取URL内容，长度:', content.length);
    
    // 返回内容
    return content;
  } catch (error) {
    console.error('获取URL内容失败:', error.message);
    throw new Error(`获取内容失败: ${error.message}`);
  }
}

// 解析重定向URL
async function resolveRedirectUrl(url) {
  // 使用fetch的HEAD请求检查重定向
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow'
    });
    
    // 获取最终URL
    return response.url;
  } catch (error) {
    // 如果失败，返回原始URL
    console.warn('解析重定向URL失败:', error);
    return url;
  }
}

// 初始化预览设置
function initPreviewSettings() {
  // 从存储中加载预览设置
  chrome.storage.sync.get({
    // 提供默认值，避免undefined错误
    previewEnabled: true,
    previewHoverDelay: 200,
    previewModifierKey: 'Shift',
    previewMaxWindows: 20,
    previewDefaultWidth: 480,
    previewDefaultHeight: 640,
    previewPosition: 'cursor',
    previewSearchEngine: 'https://www.google.com/search?q={q}'
  }, (items) => {
    // 检查items是否为有效对象
    if (!items || typeof items !== 'object') {
      console.error('预览设置加载失败: items无效');
      // 初始化默认设置
      chrome.storage.sync.set({
        previewEnabled: true,
        previewHoverDelay: 200,
        previewModifierKey: 'Shift',
        previewMaxWindows: 20,
        previewDefaultWidth: 480,
        previewDefaultHeight: 640,
        previewPosition: 'cursor',
        previewSearchEngine: 'https://www.google.com/search?q={q}'
      });
      return;
    }
    
    // 如果没有设置，则初始化
    const needsInit = items.previewEnabled === undefined;
    if (needsInit) {
      console.log('初始化预览设置...');
      chrome.storage.sync.set({
        previewEnabled: true,
        previewHoverDelay: 200,
        previewModifierKey: 'Shift',
        previewMaxWindows: 20,
        previewDefaultWidth: 480,
        previewDefaultHeight: 640,
        previewPosition: 'cursor',
        previewSearchEngine: 'https://www.google.com/search?q={q}'
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('初始化预览设置失败:', chrome.runtime.lastError.message);
        } else {
          console.log('预览设置初始化成功');
        }
      });
    } else {
      console.log('预览设置已加载');
    }
  });
}

// 在扩展启动时初始化预览设置
initPreviewSettings();

// 监听标签页关闭事件，清理标签页通知记录
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  // 标签页关闭时清理对应的记录
  notificationTracker.cleanupTabNotifications(tabId);
});

// 定期清理全部标签页记录，防止可能的内存泄漏
setInterval(() => {
  notificationTracker.cleanupTabNotifications();
}, 15 * 60 * 1000); // 每15分钟清理一次

// 标签页数量统计防抖
let tabCountUpdateTimeout = null;

// 更新扩展图标徽章显示标签页数量
async function updateTabCountBadge() {
  try {
    // 检查设置是否启用标签页数量徽章
    const settings = await chrome.storage.sync.get({ showTabCountBadge: true });
    
    if (!settings.showTabCountBadge) {
      // 如果设置中禁用了徽章显示，清除徽章
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    
    const tabs = await chrome.tabs.query({});
    const tabCount = tabs.length;
    
    // 设置徽章文本
    if (tabCount > 0) {
      await chrome.action.setBadgeText({ text: tabCount.toString() });
      await chrome.action.setBadgeBackgroundColor({ color: '#ff6b6b' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
    
    console.log(`标签页数量: ${tabCount}`);
  } catch (error) {
    console.error('更新标签页数量徽章失败:', error.message);
  }
}

// 防抖更新标签页数量
function debouncedUpdateTabCount() {
  if (tabCountUpdateTimeout) {
    clearTimeout(tabCountUpdateTimeout);
  }
  
  tabCountUpdateTimeout = setTimeout(() => {
    updateTabCountBadge();
  }, 100); // 100ms防抖延迟
}

// 扩展安装或更新时的处理
chrome.runtime.onInstalled.addListener((details) => {
  try {
    if (details.reason === 'install') {
      // 首次安装 - 直接使用 chrome.tabs.create 打开欢迎页面
      const welcomeUrl = chrome.runtime.getURL('welcome.html');
      console.log('欢迎页面URL:', welcomeUrl);
      
      // 使用统一的标签页创建函数
      createTabWithRecentIndex(welcomeUrl, true)
        .then(tab => {
          console.log('成功创建欢迎页面:', tab.id);
          // 更新标签页数量
          updateTabCountBadge();
        })
        .catch(e => {
          console.error('创建欢迎页面错误:', e.message);
        });
      
      // 为所有已打开的标签页注入内容脚本，使扩展立即生效
      injectContentScriptsToAllTabs();
    } else if (details.reason === 'update') {
      // 扩展更新时，也为所有已打开的标签页注入内容脚本
      injectContentScriptsToAllTabs();
    }
    
    // 初始化时更新标签页数量
    updateTabCountBadge();
  } catch (e) {
    console.error('扩展安装/更新处理错误:', e.message);
  }
}); 

// 向所有已打开的标签页注入内容脚本
async function injectContentScriptsToAllTabs() {
  try {
    // 查询所有标签页
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      // 跳过扩展页面和特殊页面
      if (!tab.url || IGNORED_PROTOCOLS.some(protocol => tab.url.startsWith(protocol))) {
        continue;
      }
      
      // 注入内容脚本
      try {
        console.log(`向标签页 ${tab.id} (${tab.url}) 注入内容脚本`);
        
        // 按照 manifest.json 中相同的顺序注入脚本
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['utils.js']
        });
        
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['preview.js']
        });
        
        console.log(`标签页 ${tab.id} 注入脚本成功`);
      } catch (injectionError) {
        console.error(`标签页 ${tab.id} 注入脚本失败:`, injectionError.message);
      }
    }
    
    console.log('所有标签页注入脚本完成');
  } catch (e) {
    console.error('注入内容脚本到所有标签页失败:', e.message);
  }
}

// 监听标签页创建
chrome.tabs.onCreated.addListener((tab) => {
  console.log('标签页创建:', tab.id);
  debouncedUpdateTabCount();
});

// 监听标签页移除
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  console.log('标签页移除:', tabId);
  debouncedUpdateTabCount();
});

// 监听标签页更新（包括URL变化）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 只在标签页状态变为complete时更新，避免频繁更新
  if (changeInfo.status === 'complete') {
    console.log('标签页更新完成:', tabId);
    debouncedUpdateTabCount();
  }
});

// 监听标签页激活
chrome.tabs.onActivated.addListener((activeInfo) => {
  console.log('标签页激活:', activeInfo.tabId);
  debouncedUpdateTabCount();
});

// 监听窗口创建
chrome.windows.onCreated.addListener((window) => {
  console.log('窗口创建:', window.id);
  debouncedUpdateTabCount();
});

// 监听窗口移除
chrome.windows.onRemoved.addListener((windowId) => {
  console.log('窗口移除:', windowId);
  debouncedUpdateTabCount();
});

// 监听窗口关闭以恢复分屏前的原始窗口大小
chrome.windows.onRemoved.addListener((windowId) => {
  try {
    // 情况一：当前被关闭的是“分屏窗口”（新窗口），需要恢复原窗口大小
    const session = splitViewSessions[windowId];
    if (session) {
      // 使用后立即删除会话记录，避免重复恢复
      delete splitViewSessions[windowId];

      const { originalWindowId, originalBounds } = session;
      if (originalWindowId && originalBounds) {
        chrome.windows.get(originalWindowId, (win) => {
          if (chrome.runtime.lastError || !win) {
            console.log('原窗口已不存在或获取失败，无法恢复:', chrome.runtime.lastError?.message);
            return;
          }

          const updateInfo = { focused: true };

          // 如果原始状态是最大化，则恢复为最大化；否则按记录的尺寸恢复
          if (originalBounds.state === 'maximized') {
            updateInfo.state = 'maximized';
          } else {
            updateInfo.state = 'normal';
            updateInfo.left = originalBounds.left;
            updateInfo.top = originalBounds.top;
            updateInfo.width = originalBounds.width;
            updateInfo.height = originalBounds.height;
          }

          chrome.windows.update(originalWindowId, updateInfo, () => {
            if (chrome.runtime.lastError) {
              console.log('恢复原窗口大小时出错:', chrome.runtime.lastError.message);
            } else {
              console.log('已恢复原窗口到分屏前大小，窗口ID(原窗口):', originalWindowId);
            }
          });
        });
      }
    }

    // 情况二：当前被关闭的是“原窗口”，需要让分屏窗口恢复到原始大小/状态
    const sessionWindowIds = Object.keys(splitViewSessions);
    if (sessionWindowIds.length === 0) return;

    for (const splitId of sessionWindowIds) {
      const s = splitViewSessions[splitId];
      if (!s || s.originalWindowId !== windowId) continue;

      // 找到与被关闭原窗口对应的分屏窗口
      const targetWindowId = parseInt(splitId, 10);
      const originalBounds = s.originalBounds;

      // 使用后立即删除会话记录
      delete splitViewSessions[splitId];

      if (!originalBounds) continue;

      chrome.windows.get(targetWindowId, (win) => {
        if (chrome.runtime.lastError || !win) {
          console.log('分屏窗口已不存在或获取失败，无法恢复:', chrome.runtime.lastError?.message);
          return;
        }

        const updateInfo = { focused: true };

        if (originalBounds.state === 'maximized') {
          updateInfo.state = 'maximized';
        } else {
          updateInfo.state = 'normal';
          updateInfo.left = originalBounds.left;
          updateInfo.top = originalBounds.top;
          updateInfo.width = originalBounds.width;
          updateInfo.height = originalBounds.height;
        }

        chrome.windows.update(targetWindowId, updateInfo, () => {
          if (chrome.runtime.lastError) {
            console.log('恢复分屏窗口为原始大小时出错:', chrome.runtime.lastError.message);
          } else {
            console.log('原窗口关闭后，已将分屏窗口恢复到分屏前大小，窗口ID(剩余窗口):', targetWindowId);
          }
        });
      });
    }
  } catch (e) {
    console.error('处理分屏窗口关闭恢复时出错:', e.message);
  }
});

// 监听消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "settingsUpdated") {
    try {
      // 重新加载预览设置
      initPreviewSettings();
      
      // 更新标签页数量徽章
      updateTabCountBadge();
      
      // 如果有其他需要重新加载的设置，也在这里处理
      
      console.log('后台脚本收到设置更新消息，已重新加载设置');
      
      // 返回成功响应
      if (sendResponse) {
        sendResponse({ status: "success" });
      }
    } catch (error) {
      console.log('处理设置更新消息时出错:', error.message);
      // 即使出错也返回响应，避免挂起
      if (sendResponse) {
        sendResponse({ status: "error", message: error.message });
      }
    }
    return true; // 保持消息通道开放，允许异步响应
  }
});