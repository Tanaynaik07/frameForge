/* IndexedDB wrapper with graceful fallback. No network requests. */
(function(){
  const DB_NAME = "frameforge-local-v1";
  const STORE = "projects";
  let dbPromise = null;
  function openDB(){
    if (!("indexedDB" in window)) return Promise.reject(new Error("IndexedDB is unavailable"));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME,1);
      req.onupgradeneeded = () => { const db=req.result; if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:"id"}); };
      req.onsuccess = ()=>resolve(req.result);
      req.onerror = ()=>reject(req.error || new Error("Could not open local project storage"));
    });
    return dbPromise;
  }
  async function request(mode, action){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode), store=tx.objectStore(STORE);
      let req;
      try{ req=action(store); }catch(e){ reject(e); return; }
      tx.oncomplete=()=>resolve(req ? req.result : undefined);
      tx.onerror=()=>reject(tx.error || new Error("Local storage operation failed"));
      tx.onabort=()=>reject(tx.error || new Error("Local storage operation was cancelled"));
    });
  }
  window.ProjectStorage={
    supported: "indexedDB" in window,
    save: project=>request("readwrite",s=>s.put(project)),
    get: id=>request("readonly",s=>s.get(id)),
    list: ()=>request("readonly",s=>s.getAll()),
    remove: id=>request("readwrite",s=>s.delete(id))
  };
})();