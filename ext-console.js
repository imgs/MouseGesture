/** 扩展控制台日志：默认静默，可通过 storage.enableExtConsoleLog 或 __MOUSE_EXT_DEBUG__ 开启 */
(function () {
  const G = typeof globalThis !== 'undefined' ? globalThis : window;
  if (G.__MOUSE_EXT_CONSOLE_BOOT__) return;
  G.__MOUSE_EXT_CONSOLE_BOOT__ = true;

  const native = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console)
  };
  const noop = function () {};
  const silentLog = { log: noop, info: noop, debug: noop };
  let consoleLoadGen = 0;

  function applyExtConsoleLog(enabled) {
    console.log = enabled ? native.log : silentLog.log;
    console.info = enabled ? native.info : silentLog.info;
    console.debug = enabled ? native.debug : silentLog.debug;
    console.warn = native.warn;
    console.error = native.error;
    G.__MOUSE_EXT_CONSOLE_ENABLED__ = !!enabled;
  }

  G.__MOUSE_EXT_APPLY_CONSOLE__ = applyExtConsoleLog;
  G.__MOUSE_EXT_NATIVE_CONSOLE__ = native;

  if (G.__MOUSE_EXT_DEBUG__) {
    applyExtConsoleLog(true);
    return;
  }

  applyExtConsoleLog(false);

  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      const loadGen = ++consoleLoadGen;
      chrome.storage.sync.get({ enableExtConsoleLog: false }, (items) => {
        if (loadGen !== consoleLoadGen) return;
        if (chrome.runtime && chrome.runtime.lastError) return;
        applyExtConsoleLog(!!(items && items.enableExtConsoleLog));
      });
      if (!G.__MOUSE_EXT_CONSOLE_STORAGE_LISTENER__) {
        G.__MOUSE_EXT_CONSOLE_STORAGE_LISTENER__ = true;
        chrome.storage.onChanged.addListener((changes, namespace) => {
          if (namespace === 'sync' && changes.enableExtConsoleLog) {
            applyExtConsoleLog(!!changes.enableExtConsoleLog.newValue);
          }
        });
      }
    }
  } catch (e) { /* ignore */ }
})();
