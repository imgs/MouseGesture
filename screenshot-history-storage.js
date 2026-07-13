/**
 * Screenshot capture history (IndexedDB meta + preview blob store).
 */
import {
  openPreviewDb,
  HISTORY_META_STORE,
  persistPreviewImage,
  loadPreviewImage,
  removePreviewImage
} from './screenshot-preview-storage.js';

const HISTORY_IMAGE_PREFIX = 'screenshotHist_';
const DEFAULT_MAX_HISTORY = 50;
const SCREENSHOT_HISTORY_UNLIMITED = 0;
const SCREENSHOT_HISTORY_MIN_COUNT = 1;
const SCREENSHOT_HISTORY_MAX_COUNT = 200;
const THUMB_MAX_WIDTH = 240;
/** 打开中的 history 页通过 storage.onChanged 监听此键以实时刷新 */
const SCREENSHOT_HISTORY_REVISION_KEY = 'screenshotHistoryRevision';

export function bumpScreenshotHistoryRevision() {
  try {
    chrome.storage.local.set({ [SCREENSHOT_HISTORY_REVISION_KEY]: Date.now() });
  } catch (e) {
    /* ignore */
  }
}

function isScreenshotHistoryUnlimited(maxCount) {
  return (maxCount | 0) === SCREENSHOT_HISTORY_UNLIMITED;
}

function clampScreenshotHistoryMaxCount(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return DEFAULT_MAX_HISTORY;
  if (v === SCREENSHOT_HISTORY_UNLIMITED) return SCREENSHOT_HISTORY_UNLIMITED;
  return Math.min(
    SCREENSHOT_HISTORY_MAX_COUNT,
    Math.max(SCREENSHOT_HISTORY_MIN_COUNT, v)
  );
}

function idbGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, storeName, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbGetAllHistoryMeta(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HISTORY_META_STORE, 'readonly');
    const req = tx.objectStore(HISTORY_META_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('read_failed'));
    reader.readAsDataURL(blob);
  });
}

async function createThumbnailDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return '';
  try {
    const blob = await fetch(dataUrl).then((response) => response.blob());
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, THUMB_MAX_WIDTH / Math.max(1, bmp.width));
    const w = Math.max(1, Math.floor(bmp.width * scale));
    const h = Math.max(1, Math.floor(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const thumbBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    const thumbUrl = await blobToDataUrl(thumbBlob);
    return thumbUrl && thumbUrl.length < 200000 ? thumbUrl : '';
  } catch (e) {
    return '';
  }
}

export async function isScreenshotHistoryEnabled() {
  try {
    const items = await chrome.storage.sync.get({
      enableScreenshotHistory: true
    });
    return items.enableScreenshotHistory !== false;
  } catch (e) {
    return true;
  }
}

async function getScreenshotHistoryMaxCount() {
  try {
    const items = await chrome.storage.sync.get({
      screenshotHistoryMaxCount: DEFAULT_MAX_HISTORY
    });
    return clampScreenshotHistoryMaxCount(items.screenshotHistoryMaxCount);
  } catch (e) {
    return DEFAULT_MAX_HISTORY;
  }
}

export async function trimScreenshotHistoryToLimit(maxCount) {
  const limit =
    maxCount != null
      ? clampScreenshotHistoryMaxCount(maxCount)
      : await getScreenshotHistoryMaxCount();
  if (isScreenshotHistoryUnlimited(limit)) {
    return { success: true, maxCount: limit, unlimited: true };
  }
  const db = await openPreviewDb();
  try {
    if (db.objectStoreNames.contains(HISTORY_META_STORE)) {
      await pruneScreenshotHistory(db, limit);
    }
  } finally {
    db.close();
  }
  bumpScreenshotHistoryRevision();
  return { success: true, maxCount: limit };
}

async function pruneScreenshotHistory(db, maxCount) {
  if (isScreenshotHistoryUnlimited(maxCount)) return;
  const all = await idbGetAllHistoryMeta(db);
  if (all.length <= maxCount) return;
  all.sort((a, b) => (b.created || 0) - (a.created || 0));
  const remove = all.slice(maxCount);
  for (let i = 0; i < remove.length; i++) {
    const item = remove[i];
    if (item && item.imageKey) {
      await removePreviewImage(item.imageKey);
    }
    if (item && item.id) {
      await idbDelete(db, HISTORY_META_STORE, item.id);
    }
  }
}

export async function addScreenshotHistoryEntry(entry) {
  if (!entry || !entry.dataUrl) throw new Error('no_image');
  const enabled = await isScreenshotHistoryEnabled();
  if (!enabled) return { skipped: true };

  const id = String(entry.id || Date.now() + '_' + Math.random().toString(36).slice(2, 8));
  const imageKey = HISTORY_IMAGE_PREFIX + id;
  const width = Math.max(1, entry.width | 0);
  const height = Math.max(1, entry.height | 0);
  const created = entry.created || Date.now();

  await persistPreviewImage(imageKey, entry.dataUrl, width, height);

  let thumbDataUrl = '';
  try {
    thumbDataUrl = await createThumbnailDataUrl(entry.dataUrl);
  } catch (e) { /* ignore */ }

  const db = await openPreviewDb();
  try {
    if (!db.objectStoreNames.contains(HISTORY_META_STORE)) {
      throw new Error('history_store_missing');
    }
    await idbPut(db, HISTORY_META_STORE, {
      id,
      imageKey,
      width,
      height,
      created,
      mode: entry.mode || entry.captureMode || 'unknown',
      pageUrl: entry.pageUrl || '',
      pageTitle: entry.pageTitle || '',
      sourceTabId: entry.sourceTabId != null ? entry.sourceTabId : null,
      thumbDataUrl
    });
    const maxCount = await getScreenshotHistoryMaxCount();
    if (!isScreenshotHistoryUnlimited(maxCount)) {
      await pruneScreenshotHistory(db, maxCount);
    }
  } finally {
    db.close();
  }
  bumpScreenshotHistoryRevision();
  return { success: true, id, imageKey };
}

export async function listScreenshotHistory(limit) {
  const db = await openPreviewDb();
  try {
    if (!db.objectStoreNames.contains(HISTORY_META_STORE)) {
      return [];
    }
    const all = await idbGetAllHistoryMeta(db);
    all.sort((a, b) => (b.created || 0) - (a.created || 0));
    const max = typeof limit === 'number' && limit > 0 ? limit : 0;
    const slice = max > 0 ? all.slice(0, max) : all;
    return slice.map((rec) => ({
      id: rec.id,
      imageKey: rec.imageKey,
      width: rec.width,
      height: rec.height,
      created: rec.created,
      mode: rec.mode,
      pageUrl: rec.pageUrl,
      pageTitle: rec.pageTitle,
      thumbDataUrl: rec.thumbDataUrl || ''
    }));
  } finally {
    db.close();
  }
}

export async function getScreenshotHistoryImage(id) {
  if (!id) return null;
  const db = await openPreviewDb();
  try {
    const meta = await idbGet(db, HISTORY_META_STORE, String(id));
    if (!meta || !meta.imageKey) return null;
    const dataUrl = await loadPreviewImage(meta.imageKey);
    if (!dataUrl) return null;
    return {
      id: meta.id,
      imageKey: meta.imageKey,
      dataUrl,
      width: meta.width,
      height: meta.height,
      created: meta.created,
      mode: meta.mode,
      pageUrl: meta.pageUrl,
      pageTitle: meta.pageTitle,
      sourceTabId: meta.sourceTabId != null ? meta.sourceTabId : null
    };
  } finally {
    db.close();
  }
}

export async function removeScreenshotHistoryEntry(id) {
  if (!id) return;
  const db = await openPreviewDb();
  try {
    const meta = await idbGet(db, HISTORY_META_STORE, String(id));
    if (meta && meta.imageKey) {
      await removePreviewImage(meta.imageKey);
    }
    await idbDelete(db, HISTORY_META_STORE, String(id));
  } finally {
    db.close();
  }
  bumpScreenshotHistoryRevision();
}

export async function clearScreenshotHistory() {
  const db = await openPreviewDb();
  try {
    const all = await idbGetAllHistoryMeta(db);
    for (let i = 0; i < all.length; i++) {
      const meta = all[i];
      if (meta && meta.imageKey) {
        await removePreviewImage(meta.imageKey);
      }
      if (meta && meta.id) {
        await idbDelete(db, HISTORY_META_STORE, meta.id);
      }
    }
  } finally {
    db.close();
  }
  bumpScreenshotHistoryRevision();
}
