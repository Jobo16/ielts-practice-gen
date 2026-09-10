(function (root) {
  'use strict';
  function transact(mode, value) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('reading-engine-authoring', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('content');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('content', mode);
        const operation = mode === 'readonly' ? tx.objectStore('content').get('current') : tx.objectStore('content').put(value, 'current');
        let result;
        operation.onsuccess = () => { result = operation.result; };
        tx.oncomplete = () => { db.close(); resolve(result); };
        tx.onabort = tx.onerror = () => { db.close(); reject(tx.error || new Error('题目保存失败')); };
      };
    });
  }
  root.ReadingImportStore = { load: () => transact('readonly'), save: value => transact('readwrite', value) };
})(window);
