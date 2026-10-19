export interface PendingAttachment {
  id: string;
  owner: string;
  scope: string;
  name: string;
  type: string;
  size: number;
  modified: number;
  created: number;
  blob?: Blob;
  pendingBytes?: ArrayBuffer;
  bytes?: ArrayBuffer;
}

export function identicalAttachmentBytes(left: ArrayBuffer, right: ArrayBuffer) {
  if (left.byteLength !== right.byteLength) return false;
  const a = new Uint8Array(left), b = new Uint8Array(right);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Originals are staged atomically before processing. A closed page leaves a
// durable pending item; processing never calls a business API or submits a form.
export function pendingAttachmentStore(factory: IDBFactory = indexedDB) {
  let opening: Promise<IDBDatabase> | undefined;
  function open() {
    return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("jg-business-pending-attachments", 1);
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new Error("本机附件存储未响应，请稍后重试。"));
      }, 10000);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("files", { keyPath: "id" });
        store.createIndex("scope", ["owner", "scope"]);
        store.createIndex("owner", "owner");
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled) { request.result.close(); return; }
        settled = true;
        request.result.onversionchange = () => { request.result.close(); opening = undefined; };
        resolve(request.result);
      };
      request.onerror = request.onblocked = () => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(new Error("无法打开本机附件存储，请关闭旧页面后重试。"));
      };
    }).catch((error) => { opening = undefined; throw error; });
  }
  async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, done: (result: T) => void) => void) {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction("files", mode);
      let result: T;
      const timer = setTimeout(() => { try { tx.abort(); } catch { /* already ended */ } }, 15000);
      tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
      tx.onabort = tx.onerror = () => { clearTimeout(timer); reject(new Error("附件未能保存到本机，请检查剩余空间后重试；原有附件仍保留。")); };
      try { run(tx.objectStore("files"), (value) => { result = value; }); } catch { tx.abort(); }
    });
  }
  const list = (owner: string, scope: string) => transact<PendingAttachment[]>("readonly", (store, done) => {
    const request = store.index("scope").getAll([owner, scope]);
    request.onsuccess = () => done((request.result as PendingAttachment[]).sort((a, b) => a.created - b.created));
  });
  return {
    list,
    async stage(owner: string, scope: string, files: readonly File[]) {
      if (!owner || !scope) throw new Error("请先登录并选择业务项目。");
      // Safari can reject persisted File/Blob handles. Persist owned byte data
      // before exposing a durable attachment; keep older Blob records readable.
      const staged: PendingAttachment[] = [];
      for (const [index, file] of files.entries()) staged.push({
        id: globalThis.crypto.randomUUID(), owner, scope, name: file.name, type: file.type,
        size: file.size, modified: file.lastModified, created: Date.now() + index / 1000,
        pendingBytes: await file.arrayBuffer()
      });
      return transact<void>("readwrite", (store) => {
        for (const item of staged) store.add(item);
      });
    },
    async finish(item: PendingAttachment) {
      if (item.bytes || (!item.blob && !item.pendingBytes)) return false;
      const bytes = item.pendingBytes ?? await item.blob!.arrayBuffer();
      return transact<boolean>("readwrite", (store, done) => {
        const request = store.index("scope").getAll([item.owner, item.scope]);
        request.onsuccess = () => {
          const current = request.result as PendingAttachment[];
          if (!current.some((file) => file.id === item.id)) { done(false); return; }
          const duplicate = current.some((file) => file.id !== item.id && file.bytes && identicalAttachmentBytes(file.bytes, bytes));
          if (duplicate) store.delete(item.id);
          else store.put({ ...item, blob: undefined, pendingBytes: undefined, bytes });
          done(duplicate);
        };
      });
    },
    remove(owner: string, scope: string, id: string) {
      return transact<void>("readwrite", (store) => {
        const request = store.get(id);
        request.onsuccess = () => {
          const item = request.result as PendingAttachment | undefined;
          if (item?.owner === owner && item.scope === scope) store.delete(id);
        };
      });
    },
    removeConfirmed(owner: string, scope: string, ids: readonly string[]) {
      return transact<void>("readwrite", (store) => {
        for (const id of ids) {
          const request = store.get(id);
          request.onsuccess = () => {
            const item = request.result as PendingAttachment | undefined;
            if (item?.owner === owner && item.scope === scope) store.delete(id);
          };
        }
      });
    }
  };
}
