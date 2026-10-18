/* PratMusic — IndexedDB store for user-imported audio (survives offline, restarts, everything) */
const DB = (() => {
  const NAME = 'pratmusic-db', STORE = 'tracks', VER = 1;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const rq = indexedDB.open(NAME, VER);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      const out = fn(st);
      t.oncomplete = () => res(out && out.result);
      t.onerror = () => rej(t.error);
    });
  }
  return {
    all: () => tx('readonly', (st) => st.getAll()),
    put: (rec) => tx('readwrite', (st) => st.put(rec)),
    del: (id) => tx('readwrite', (st) => st.delete(id)),
    blob: async (id) => {
      const db = await open();
      return new Promise((res, rej) => {
        const t = db.transaction(STORE, 'readonly');
        const rq = t.objectStore(STORE).get(id);
        rq.onsuccess = () => res(rq.result && rq.result.blob);
        rq.onerror = () => rej(rq.error);
      });
    }
  };
})();
