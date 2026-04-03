import type { ReminderRingtoneConfig } from '../types/reminder';

const DB_NAME = 'car-journal-reminder-assets-v1';
const DB_VERSION = 1;
const STORE_NAME = 'ringtone-blobs';

export const MAX_REMINDER_RINGTONE_UPLOAD_BYTES = 100 * 1024 * 1024;
// localStorage 对大 data URL 不稳定，超过阈值转存 IndexedDB blob。
export const REMINDER_RINGTONE_DATA_URL_STORAGE_MAX_BYTES = 2 * 1024 * 1024;

interface ReminderRingtoneBlobRecord {
  id: string;
  blob: Blob;
  mimeType: string;
  name: string;
  sizeBytes: number;
  updatedAtUnix: number;
}

interface ReminderRingtoneSourceResult {
  sourceUrl: string | null;
  release: () => void;
}

function makeBlobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `ringtone-${crypto.randomUUID()}`;
  }

  const random = Math.random().toString(16).slice(2);
  return `ringtone-${Date.now().toString(36)}-${random}`;
}

function openReminderAssetsDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('当前环境不支持 IndexedDB。'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      reject(new Error('无法打开本地铃声数据库（IndexedDB）。'));
    };
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function withStore<T>(mode: IDBTransactionMode, handler: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  return openReminderAssetsDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let settled = false;

        const settleOnce = (fn: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          fn();
        };

        transaction.onerror = () => {
          db.close();
          settleOnce(() => reject(new Error('本地铃声数据库读写失败。')));
        };
        transaction.onabort = () => {
          db.close();
          settleOnce(() => reject(new Error('本地铃声数据库事务已中止。')));
        };
        transaction.oncomplete = () => {
          db.close();
        };

        Promise.resolve(handler(store))
          .then((result) => {
            settleOnce(() => resolve(result));
          })
          .catch((error) => {
            transaction.abort();
            settleOnce(() => reject(error instanceof Error ? error : new Error('本地铃声数据库操作失败。')));
          });
      }),
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取铃声二进制失败。'));
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('读取铃声二进制失败。'));
    };
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return fetch(dataUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error('Data URL 转换为二进制失败。');
      }
      return response.blob();
    })
    .catch((error) => {
      throw error instanceof Error ? error : new Error('Data URL 转换为二进制失败。');
    });
}

export function shouldPersistRingtoneAsBlob(fileSizeBytes: number): boolean {
  return fileSizeBytes > REMINDER_RINGTONE_DATA_URL_STORAGE_MAX_BYTES;
}

export async function saveReminderRingtoneBlob(input: {
  blob: Blob;
  mimeType: string;
  name: string;
  updatedAtUnix: number;
  reuseId?: string;
}): Promise<{ blobStorageId: string; sizeBytes: number }> {
  const blobStorageId = (input.reuseId || '').trim() || makeBlobId();
  const sizeBytes = Number.isFinite(input.blob.size) ? Math.max(0, Math.floor(input.blob.size)) : 0;

  const record: ReminderRingtoneBlobRecord = {
    id: blobStorageId,
    blob: input.blob,
    mimeType: input.mimeType.trim().toLowerCase(),
    name: input.name.trim().slice(0, 120),
    sizeBytes,
    updatedAtUnix: Math.floor(Number(input.updatedAtUnix) || Date.now() / 1000),
  };

  await withStore('readwrite', (store) => {
    return new Promise<void>((resolve, reject) => {
      const request = store.put(record);
      request.onerror = () => reject(new Error('保存大铃声到本地数据库失败。'));
      request.onsuccess = () => resolve();
    });
  });

  return { blobStorageId, sizeBytes };
}

export async function loadReminderRingtoneBlob(blobStorageId: string): Promise<Blob | null> {
  const normalizedId = blobStorageId.trim();
  if (!normalizedId) {
    return null;
  }

  return withStore('readonly', (store) => {
    return new Promise<Blob | null>((resolve, reject) => {
      const request = store.get(normalizedId);
      request.onerror = () => reject(new Error('读取本地铃声数据库失败。'));
      request.onsuccess = () => {
        const value = request.result as ReminderRingtoneBlobRecord | undefined;
        if (!value || !(value.blob instanceof Blob)) {
          resolve(null);
          return;
        }
        resolve(value.blob);
      };
    });
  });
}

export async function removeReminderRingtoneBlob(blobStorageId: string): Promise<void> {
  const normalizedId = blobStorageId.trim();
  if (!normalizedId) {
    return;
  }

  await withStore('readwrite', (store) => {
    return new Promise<void>((resolve, reject) => {
      const request = store.delete(normalizedId);
      request.onerror = () => reject(new Error('删除本地铃声二进制失败。'));
      request.onsuccess = () => resolve();
    });
  });
}

export async function resolveReminderRingtoneSource(config: ReminderRingtoneConfig | null): Promise<ReminderRingtoneSourceResult> {
  if (!config) {
    return {
      sourceUrl: null,
      release: () => undefined,
    };
  }

  if (typeof config.dataUrl === 'string' && config.dataUrl.trim()) {
    return {
      sourceUrl: config.dataUrl.trim(),
      release: () => undefined,
    };
  }

  if (config.storageMode === 'idb-blob' && typeof config.blobStorageId === 'string' && config.blobStorageId.trim()) {
    const blob = await loadReminderRingtoneBlob(config.blobStorageId);
    if (!blob) {
      return {
        sourceUrl: null,
        release: () => undefined,
      };
    }
    const objectUrl = URL.createObjectURL(blob);
    return {
      sourceUrl: objectUrl,
      release: () => {
        URL.revokeObjectURL(objectUrl);
      },
    };
  }

  return {
    sourceUrl: null,
    release: () => undefined,
  };
}

export async function resolveReminderRingtoneDataUrl(config: ReminderRingtoneConfig): Promise<string> {
  if (typeof config.dataUrl === 'string' && config.dataUrl.trim()) {
    return config.dataUrl.trim();
  }

  if (config.storageMode === 'idb-blob' && typeof config.blobStorageId === 'string' && config.blobStorageId.trim()) {
    const blob = await loadReminderRingtoneBlob(config.blobStorageId);
    if (!blob) {
      throw new Error('本地大铃声文件不存在，请重新上传。');
    }
    return blobToDataUrl(blob);
  }

  throw new Error('铃声数据不可用，请重新上传。');
}

export async function saveDataUrlAsReminderRingtoneBlob(input: {
  dataUrl: string;
  mimeType: string;
  name: string;
  updatedAtUnix: number;
}): Promise<{ blobStorageId: string; sizeBytes: number }> {
  const blob = await dataUrlToBlob(input.dataUrl);
  return saveReminderRingtoneBlob({
    blob,
    mimeType: input.mimeType,
    name: input.name,
    updatedAtUnix: input.updatedAtUnix,
  });
}
