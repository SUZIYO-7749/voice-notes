// 语音笔记 · 数据层（IndexedDB）
// notes  仓库：笔记元数据，主键 id
// blobs  仓库：音频二进制，主键 = 笔记 id

const DB_NAME = 'voice-notes';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('notes')) {
        const store = db.createObjectStore('notes', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const transactionDone = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('数据库事务被中止，可能是存储空间不足'));
});

/**
 * 在指定仓库上跑一段逻辑。
 * 注意：事务完成监听必须在发起请求之前注册，否则事务可能在挂载监听前就结束而永久等待。
 */
async function withStore(name, mode, fn) {
  const database = await openDB();
  const tx = database.transaction(name, mode);
  const done = transactionDone(tx);
  const store = tx.objectStore(name);
  let out;
  try {
    out = await fn(store);
  } catch (err) {
    try { tx.abort(); } catch { /* 事务可能已结束 */ }
    throw err;
  }
  await done;
  return out;
}

export const db = {
  async allNotes() {
    const list = await withStore('notes', 'readonly', (store) => request(store.getAll()));
    return (list || []).sort((a, b) => b.createdAt - a.createdAt);
  },

  getNote(id) {
    return withStore('notes', 'readonly', (store) => request(store.get(id)));
  },

  async putNote(note) {
    await withStore('notes', 'readwrite', (store) => request(store.put(note)));
    return note;
  },

  async deleteNote(id) {
    await withStore('notes', 'readwrite', (store) => request(store.delete(id)));
    await withStore('blobs', 'readwrite', (store) => request(store.delete(id)));
  },

  async putBlob(id, blob) {
    await withStore('blobs', 'readwrite', (store) => request(store.put(blob, id)));
  },

  getBlob(id) {
    return withStore('blobs', 'readonly', (store) => request(store.get(id)));
  },

  async deleteBlob(id) {
    await withStore('blobs', 'readwrite', (store) => request(store.delete(id)));
  },

  /** 彻底清空回收站中的笔记与音频，释放空间 */
  async purgeTrash(notes) {
    const ids = notes.filter((n) => n.deletedAt).map((n) => n.id);
    for (const id of ids) {
      await withStore('blobs', 'readwrite', (store) => request(store.delete(id)));
      await withStore('notes', 'readwrite', (store) => request(store.delete(id)));
    }
    return ids.length;
  },

  async clearAll() {
    await withStore('notes', 'readwrite', (store) => request(store.clear()));
    await withStore('blobs', 'readwrite', (store) => request(store.clear()));
  },

  async estimate() {
    if (!navigator.storage?.estimate) return null;
    try { return await navigator.storage.estimate(); } catch { return null; }
  },
};

/** 请求持久化存储，避免浏览器在空间紧张时清掉录音 */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
