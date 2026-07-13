/**
 * Per-page screenshot pin persistence (IndexedDB, one record per pin).
 */
import {
  openPreviewDb,
  PAGE_PINS_STORE,
  persistPreviewImage,
  loadPreviewImage,
  removePreviewImage
} from './screenshot-preview-storage.js';

const PAGE_PIN_IMAGE_PREFIX = 'screenshotPagePin_';
const MAX_PINS_PER_PAGE = 30;

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

function idbGetAllByIndex(db, storeName, indexName, query) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.index(indexName).getAll(query);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export function normalizePagePinScopeKey(url) {
  try {
    const u = new URL(url || '');
    return u.origin + u.pathname;
  } catch (e) {
    return String(url || '');
  }
}

function pinImageKey(pinId) {
  return PAGE_PIN_IMAGE_PREFIX + String(pinId);
}

async function pruneOldPagePins(db, scope) {
  if (!db.objectStoreNames.contains(PAGE_PINS_STORE)) return;
  const pins = await idbGetAllByIndex(db, PAGE_PINS_STORE, 'pageScopeKey', scope);
  if (pins.length <= MAX_PINS_PER_PAGE) return;
  pins.sort((a, b) => (a.updated || 0) - (b.updated || 0));
  const remove = pins.slice(0, pins.length - MAX_PINS_PER_PAGE);
  for (let i = 0; i < remove.length; i++) {
    const p = remove[i];
    if (p && p.imageKey) await removePreviewImage(p.imageKey);
    if (p && p.id) await idbDelete(db, PAGE_PINS_STORE, p.id);
  }
}

export async function listPageScreenshotPins(pageScopeKey) {
  const scope = normalizePagePinScopeKey(pageScopeKey);
  if (!scope) return [];
  const db = await openPreviewDb();
  try {
    if (!db.objectStoreNames.contains(PAGE_PINS_STORE)) return [];
    const pins = await idbGetAllByIndex(db, PAGE_PINS_STORE, 'pageScopeKey', scope);
    pins.sort((a, b) => {
      const ao = a.pinOrder | 0;
      const bo = b.pinOrder | 0;
      if (ao && bo && ao !== bo) return ao - bo;
      if (ao && !bo) return -1;
      if (!ao && bo) return 1;
      return (a.updated || 0) - (b.updated || 0);
    });
    const out = [];
    for (let i = 0; i < pins.length; i++) {
      const p = pins[i];
      if (!p || !p.id) continue;
      const imageKey = p.imageKey || pinImageKey(p.id);
      const dataUrl = await loadPreviewImage(imageKey);
      if (!dataUrl) continue;
      out.push(Object.assign({}, p, { imageKey, dataUrl }));
    }
    return out;
  } finally {
    db.close();
  }
}

export async function savePageScreenshotPin(pageScopeKey, pin, dataUrl) {
  const scope = normalizePagePinScopeKey(pageScopeKey);
  if (!scope || !pin || !pin.id) throw new Error('invalid_pin');
  const pinId = String(pin.id).trim();
  if (!pinId) throw new Error('invalid_pin');
  let imageKey = pin.imageKey || pinImageKey(pinId);
  const db = await openPreviewDb();
  try {
    if (!db.objectStoreNames.contains(PAGE_PINS_STORE)) {
      throw new Error('page_pins_store_missing');
    }
    const existing = await idbGet(db, PAGE_PINS_STORE, pinId);
    imageKey = (existing && existing.imageKey) || imageKey;
    if (dataUrl && typeof dataUrl === 'string') {
      await persistPreviewImage(
        imageKey,
        dataUrl,
        Math.max(1, Number(pin.width) || 1),
        Math.max(1, Number(pin.height) || 1)
      );
    }
    const rawDw = Number(pin.displayW);
    const nextDw =
      Number.isFinite(rawDw) && rawDw > 0
        ? Math.max(1, Math.round(rawDw))
        : existing && Number(existing.displayW) > 0
          ? Math.max(1, Math.round(Number(existing.displayW)))
          : Math.max(1, Math.round(Number(pin.width) || 1));
    const record = {
      ...(existing || {}),
      id: pinId,
      pageScopeKey: scope,
      imageKey,
      x: Math.max(0, Number(pin.x) || 0),
      y: Math.max(0, Number(pin.y) || 0),
      displayW: nextDw,
      width: Math.max(1, Number(pin.width) || 1),
      height: Math.max(1, Number(pin.height) || 1),
      title: pin.title != null ? pin.title : (existing && existing.title) || '',
      closeTitle:
        pin.closeTitle != null
          ? pin.closeTitle
          : (existing && existing.closeTitle) || '',
      resizeTitle:
        pin.resizeTitle != null
          ? pin.resizeTitle
          : (existing && existing.resizeTitle) || '',
      pinOrder: Math.max(
        1,
        (pin.pinOrder | 0) || (existing && existing.pinOrder | 0) || 1
      ),
      updated: Date.now()
    };
    delete record.layoutSeq;
    delete record.layoutRevision;
    await idbPut(db, PAGE_PINS_STORE, record);
    if (dataUrl) {
      await pruneOldPagePins(db, scope);
    }
  } finally {
    db.close();
  }
  return { success: true, id: pinId, imageKey };
}

export async function removePageScreenshotPin(pageScopeKey, pinId) {
  if (!pinId) return;
  const id = String(pinId);
  const db = await openPreviewDb();
  try {
    if (!db.objectStoreNames.contains(PAGE_PINS_STORE)) return;
    const rec = await idbGet(db, PAGE_PINS_STORE, id);
    if (rec && rec.imageKey) await removePreviewImage(rec.imageKey);
    await idbDelete(db, PAGE_PINS_STORE, id);
  } finally {
    db.close();
  }
}

export async function clearPageScreenshotPins(pageScopeKey) {
  const scope = normalizePagePinScopeKey(pageScopeKey);
  if (!scope) return;
  const db = await openPreviewDb();
  try {
    if (!db.objectStoreNames.contains(PAGE_PINS_STORE)) return;
    const pins = await idbGetAllByIndex(db, PAGE_PINS_STORE, 'pageScopeKey', scope);
    for (let i = 0; i < pins.length; i++) {
      const p = pins[i];
      if (p && p.imageKey) await removePreviewImage(p.imageKey);
      if (p && p.id) await idbDelete(db, PAGE_PINS_STORE, p.id);
    }
  } finally {
    db.close();
  }
}
