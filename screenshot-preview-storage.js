/**
 * IndexedDB storage for screenshot preview images (survives service worker restarts).
 */
const PREVIEW_DB_NAME = 'mouseScreenshotPreview';
const PREVIEW_DB_VERSION = 5;
const PREVIEW_STORE = 'previews';
export const HISTORY_META_STORE = 'historyMeta';
/** 每条贴图一条记录，避免并发保存时互相覆盖 */
export const PAGE_PINS_STORE = 'pagePins';

export function openPreviewDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PREVIEW_DB_NAME, PREVIEW_DB_VERSION);
    req.onerror = () => reject(req.error || new Error('idb_open_failed'));
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(PREVIEW_STORE)) {
        db.createObjectStore(PREVIEW_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(HISTORY_META_STORE)) {
        const store = db.createObjectStore(HISTORY_META_STORE, { keyPath: 'id' });
        store.createIndex('created', 'created', { unique: false });
      }
      if (!db.objectStoreNames.contains(PAGE_PINS_STORE)) {
        const pinStore = db.createObjectStore(PAGE_PINS_STORE, { keyPath: 'id' });
        pinStore.createIndex('pageScopeKey', 'pageScopeKey', { unique: false });
        pinStore.createIndex('updated', 'updated', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PREVIEW_STORE, 'readonly');
    const req = tx.objectStore(PREVIEW_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PREVIEW_STORE, 'readwrite');
    tx.objectStore(PREVIEW_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PREVIEW_STORE, 'readwrite');
    tx.objectStore(PREVIEW_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function persistPreviewImage(key, dataUrl, width, height) {
  if (!key || !dataUrl) throw new Error('no_image');
  const db = await openPreviewDb();
  try {
    await idbPut(db, {
      key,
      dataUrl,
      width: Math.max(1, width | 0),
      height: Math.max(1, height | 0),
      updated: Date.now()
    });
  } finally {
    db.close();
  }
}

async function loadPreviewImage(key) {
  if (!key) return null;
  const db = await openPreviewDb();
  try {
    const rec = await idbGet(db, key);
    return rec && typeof rec.dataUrl === 'string' ? rec.dataUrl : null;
  } finally {
    db.close();
  }
}

async function removePreviewImage(key) {
  if (!key) return;
  const db = await openPreviewDb();
  try {
    await idbDelete(db, key);
  } finally {
    db.close();
  }
}

async function appendPreviewImageChunk(msg) {
  const key = msg.key && String(msg.key);
  const index = msg.index | 0;
  const total = msg.total | 0;
  const chunk = typeof msg.chunk === 'string' ? msg.chunk : '';
  if (!key || total < 1 || index < 0 || index >= total) {
    throw new Error('invalid_chunk');
  }
  const db = await openPreviewDb();
  try {
    let rec = await idbGet(db, key);
    if (!rec || rec.total !== total || !Array.isArray(rec.parts)) {
      rec = {
        key,
        parts: new Array(total).fill(null),
        total,
        width: Math.max(1, msg.width | 0),
        height: Math.max(1, msg.height | 0)
      };
    }
    if (msg.width > 0) rec.width = msg.width | 0;
    if (msg.height > 0) rec.height = msg.height | 0;
    rec.parts[index] = chunk;
    const ready = rec.parts.every((p) => typeof p === 'string');
    if (!ready) {
      await idbPut(db, rec);
      return { complete: false };
    }
    const dataUrl = rec.parts.join('');
    await idbPut(db, {
      key,
      dataUrl,
      width: rec.width,
      height: rec.height,
      updated: Date.now()
    });
    return {
      complete: true,
      dataUrl,
      width: rec.width,
      height: rec.height
    };
  } finally {
    db.close();
  }
}

export {
  persistPreviewImage,
  loadPreviewImage,
  removePreviewImage,
  appendPreviewImageChunk
};
