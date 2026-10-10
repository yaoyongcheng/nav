/**
 * 通用离线请求队列（IndexedDB + Background Sync + iOS fallback）
 * v1.6.13 重构：抽象为 OfflineQueue，支持多业务共享同一 DB
 *
 * 功能：
 *   - 任何 fetch 失败（网络错误 / 5xx）→ 自动暂存 IndexedDB
 *   - 网络恢复 / 页面切前台 / SW sync 事件 → 自动重发
 *   - 多业务隔离：每个业务独立 object store（如 location-reports / entry-form-records）
 *   - LRU 上限 1000 条（防配额爆掉）
 *   - 每条最大重试 5 次（防永久卡队列）
 *
 * 浏览器支持：
 *   - IndexedDB：Chrome 24+ / Safari 10+ / Edge 12+ / Firefox 16+
 *   - Background Sync API：Android Chrome 49+ / Edge 79+ / Firefox 不支持 / **iOS Safari 不支持**
 *   - iOS fallback：online / visibilitychange / pageshow 事件触发 drainNow
 *
 * 用法（新业务）：
 *   <script src="js/location-queue.js"></script>
 *   // 1. 注册 store 名（首次使用前）
 *   OfflineQueue.registerStore('my-form-records');
 *   // 2. fetch 失败时入队
 *   try {
 *     const resp = await fetch(API, options);
 *     if (!resp.ok) throw new Error('http ' + resp.status);
 *   } catch (e) {
 *     await OfflineQueue.enqueue({
 *       storeName: 'my-form-records',
 *       url: API,
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify(data),
 *       label: '我的表单',
 *     });
 *   }
 *
 * 用法（位置上报，向后兼容）：
 *   LocationQueue.enqueue(payload)  // 等价于 OfflineQueue.enqueue({storeName:'location-reports', url, method, headers, body:payload, label:'车辆位置'})
 *   LocationQueue.drain()           // 等价于 OfflineQueue.drainStore('location-reports')
 *
 * 主线程主动 drain（iOS / 任何平台）：
 *   await OfflineQueue.drainNow();  // 遍历所有 store
 *   await OfflineQueue.drainStore('entry-form-records');  // 单 store
 *
 * UI 读取：
 *   const total = await OfflineQueue.count();
 *   const byStore = await OfflineQueue.listAll();  // { storeName: [items] }
 *   const labels = OfflineQueue.stores();  // ['location-reports', 'entry-form-records', ...]
 */
(function () {
  'use strict';

  // ============ 常量 ============
  const DB_NAME = 'm94-offline-queue';           // v1.6.13+ 新 DB（替代 m94-location-queue）
  const DB_VERSION = 2;                          // v2 = 多 store 架构
  const LEGACY_DB_NAME = 'm94-location-queue';    // v1.6.11~1.6.12 旧 DB（只读兼容，不写）
  const SYNC_TAG = 'app-pending';                 // Background Sync tag（v1.6.13 起通用）
  const LEGACY_SYNC_TAG = 'location-reports';     // 旧 tag（vehicle-location-reporter 仍注册）
  const INDEX_TIMESTAMP = 'by_timestamp';
  const MAX_QUEUE_SIZE = 1000;
  const LRU_DROP_ON_OVERFLOW = 100;
  const MAX_RETRY = 5;
  // 位置上报专用 API URL（LocationQueue 向后兼容保留）
  const LOCATION_API_URL = 'https://dmap.cscec3bxjy.cn/api/transport/temp-vehicle/report';

  // ============ 内部状态（必须先声明，registerStore 内部会 reset）============
  let _dbPromise = null;
  let _legacyDBPromise = null;
  let _drainInFlight = null;  // 防并发 drain

  // ============ 业务 store 注册表 ============
  // 业务模块首次使用时 registerStore('xxx') 声明自己的 object store
  // OfflineQueue 暴露给业务方，让其按需扩展
  const STORE_REGISTRY = new Set();

  function registerStore(storeName) {
    if (!storeName || typeof storeName !== 'string') {
      try { console.warn('[OfflineQueue] registerStore: invalid name'); } catch (_) {}
      return false;
    }
    if (storeName.length > 64 || /[^a-z0-9_-]/i.test(storeName)) {
      try { console.warn('[OfflineQueue] registerStore: name must be alphanumeric/underscore/dash, ≤64 chars'); } catch (_) {}
      return false;
    }
    const wasNew = !STORE_REGISTRY.has(storeName);
    STORE_REGISTRY.add(storeName);
    // 新 store 注册 → 重置 DB promise，下次 openDB 时 onupgradeneeded 会创建新 store
    // 注意：已升级过的 DB 不会再次触发 onupgradeneeded，所以新 store 需要 DB version bump 或手动升级
    if (wasNew) {
      _dbPromise = null;
    }
    return true;
  }

  // 内置 store（位置上报 + 表单记录）
  registerStore('location-reports');
  registerStore('entry-form-records');

  // ============ 工具：IndexedDB Promise 化 ============
  function reqToPromise(req) {
    return new Promise(function (resolve, reject) {
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  // ============ 打开 v2 DB（多 store）============
  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB not supported'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (event) {
        const db = event.target.result;
        for (const storeName of STORE_REGISTRY) {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, {
              keyPath: 'id',
              autoIncrement: true,
            });
            store.createIndex(INDEX_TIMESTAMP, 'timestamp', { unique: false });
          }
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return _dbPromise;
  }

  // 旧 DB 只读（v1.6.12 之前的 m94-location-queue）
  function openLegacyDB() {
    if (_legacyDBPromise) return _legacyDBPromise;
    _legacyDBPromise = new Promise(function (resolve) {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      try {
        const req = indexedDB.open(LEGACY_DB_NAME);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) {
        resolve(null);
      }
    });
    return _legacyDBPromise;
  }

  function txOnStore(db, storeName, mode) {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  // ============ LRU 清理（按 store）============
  async function ensureStoreCapacity(db, storeName) {
    try {
      const store = txOnStore(db, storeName, 'readwrite');
      const total = await reqToPromise(store.count());
      if (total < MAX_QUEUE_SIZE) return;
      // 超上限：删最早 LRU_DROP_ON_OVERFLOW 条
      const idx = store.index(INDEX_TIMESTAMP);
      const cursorReq = idx.openCursor();
      let dropped = 0;
      await new Promise(function (resolve, reject) {
        cursorReq.onsuccess = function (e) {
          const cursor = e.target.result;
          if (!cursor || dropped >= LRU_DROP_ON_OVERFLOW) { resolve(); return; }
          const delReq = cursor.delete();
          delReq.onsuccess = function () { dropped++; cursor.continue(); };
          delReq.onerror = function () { reject(delReq.error); };
        };
        cursorReq.onerror = function () { reject(cursorReq.error); };
      });
      try { console.warn('[OfflineQueue] LRU dropped ' + dropped + ' items from ' + storeName); } catch (_) {}
    } catch (e) {
      try { console.error('[OfflineQueue] LRU cleanup failed:', e); } catch (_) {}
    }
  }

  // ============ 公开 API：OfflineQueue 通用接口 ============

  async function init() {
    try {
      await openDB();
      // 预热旧 DB（兼容读取）
      openLegacyDB();
      return true;
    } catch (e) {
      try { console.error('[OfflineQueue] init failed:', e); } catch (_) {}
      return false;
    }
  }

  /**
   * 入队一条离线请求
   * @param {Object} opts
   * @param {string} opts.storeName - 业务 store 名（必须已 registerStore）
   * @param {string} opts.url - 请求 URL
   * @param {string} [opts.method='POST']
   * @param {Object} [opts.headers]
   * @param {string|Object} [opts.body] - 已 stringify 或对象（自动 stringify）
   * @param {string} [opts.label] - UI 显示名（如「进场登记」）
   * @returns {Promise<number>} id
   */
  async function enqueue(opts) {
    if (!opts || typeof opts !== 'object') {
      throw new Error('enqueue: opts must be an object');
    }
    const storeName = opts.storeName;
    if (!storeName || !STORE_REGISTRY.has(storeName)) {
      throw new Error('enqueue: unknown storeName="' + storeName + '"（must OfflineQueue.registerStore first）');
    }
    if (!opts.url) {
      throw new Error('enqueue: url is required');
    }

    const body = opts.body == null ? null
      : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));

    const item = {
      storeName: storeName,
      url: opts.url,
      method: (opts.method || 'POST').toUpperCase(),
      headers: opts.headers || {},
      body: body,
      label: opts.label || storeName,
      timestamp: Date.now(),
      createdAt: Date.now(),
      retryCount: 0,
      lastAttemptAt: 0,
    };

    const db = await openDB();
    await ensureStoreCapacity(db, storeName);
    const store = txOnStore(db, storeName, 'readwrite');
    const id = await reqToPromise(store.add(item));
    try { console.info('[OfflineQueue] enqueued #' + id + ' store=' + storeName + ' label=' + item.label); } catch (_) {}
    // Android Chrome：注册 Background Sync
    if (hasBackgroundSync()) {
      registerSync().catch(function () {});
    }
    return id;
  }

  /** 列出单个 store 的全部条目（按时间升序） */
  async function list(storeName) {
    if (!STORE_REGISTRY.has(storeName)) return [];
    try {
      const db = await openDB();
      const store = txOnStore(db, storeName, 'readonly');
      const items = await reqToPromise(store.getAll());
      items.sort(function (a, b) { return a.timestamp - b.timestamp; });
      return items;
    } catch (e) {
      return [];
    }
  }

  /**
   * 列出全部 store 的条目（含旧 DB 数据，向后兼容）
   * @returns {Promise<Object>} { storeName: [items], '__legacy__': [items] }
   */
  async function listAll() {
    const result = {};
    for (const storeName of STORE_REGISTRY) {
      result[storeName] = await list(storeName);
    }
    // 兼容旧 DB（不破坏 v1.6.12 之前的位置数据）
    try {
      const legacyDb = await openLegacyDB();
      if (legacyDb) {
        const storeNames = Array.from(legacyDb.objectStoreNames || []);
        for (const sn of storeNames) {
          try {
            const items = await reqToPromise(
              legacyDb.transaction(sn, 'readonly').objectStore(sn).getAll()
            );
            items.sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
            const legacyKey = '__legacy__:' + sn;
            result[legacyKey] = items;
          } catch (_) {}
        }
      }
    } catch (_) {}
    return result;
  }

  /** 已注册的 store 名列表 */
  function stores() {
    return Array.from(STORE_REGISTRY);
  }

  /** 单 store 计数 */
  async function count(storeName) {
    if (!STORE_REGISTRY.has(storeName)) return 0;
    try {
      const db = await openDB();
      const store = txOnStore(db, storeName, 'readonly');
      return await reqToPromise(store.count());
    } catch (e) {
      return 0;
    }
  }

  /** 全部 store 计数求和 */
  async function countAll() {
    let total = 0;
    for (const sn of STORE_REGISTRY) {
      total += await count(sn);
    }
    return total;
  }

  /** 删除单条 */
  async function remove(storeName, id) {
    if (!STORE_REGISTRY.has(storeName)) return;
    try {
      const db = await openDB();
      const store = txOnStore(db, storeName, 'readwrite');
      await reqToPromise(store.delete(id));
    } catch (e) {
      try { console.error('[OfflineQueue] remove store=' + storeName + ' id=' + id + ' failed:', e); } catch (_) {}
    }
  }

  /** 清空指定 store（或全部） */
  async function clear(storeName) {
    try {
      const db = await openDB();
      if (storeName) {
        if (!STORE_REGISTRY.has(storeName)) return;
        const store = txOnStore(db, storeName, 'readwrite');
        await reqToPromise(store.clear());
        try { console.warn('[OfflineQueue] cleared store=' + storeName); } catch (_) {}
      } else {
        for (const sn of STORE_REGISTRY) {
          const store = txOnStore(db, sn, 'readwrite');
          await reqToPromise(store.clear());
        }
        try { console.warn('[OfflineQueue] cleared all stores'); } catch (_) {}
      }
    } catch (e) {
      try { console.error('[OfflineQueue] clear failed:', e); } catch (_) {}
    }
  }

  /**
   * 标记某条 retry 次数 +1（失败但未达上限时）
   */
  async function bumpRetry(storeName, item) {
    try {
      const db = await openDB();
      const store = txOnStore(db, storeName, 'readwrite');
      item.retryCount = (item.retryCount || 0) + 1;
      item.lastAttemptAt = Date.now();
      await reqToPromise(store.put(item));
    } catch (_) {}
  }

  /**
   * 单条 fetch + 成功删 / 失败 retry 处理
   * @returns {Promise<'ok'|'fail-giveup'|'fail-retry'|'network-down'|'http-4xx'>}
   */
  async function _attemptOne(storeName, item) {
    try {
      const resp = await fetch(item.url, {
        method: item.method || 'POST',
        headers: item.headers || {},
        body: item.body || undefined,
      });
      if (resp && resp.ok) {
        await remove(storeName, item.id);
        return 'ok';
      }
      // 4xx：业务错误，不重试直接丢弃（用户输入问题，重试无意义）
      if (resp && resp.status >= 400 && resp.status < 500) {
        await remove(storeName, item.id);
        try { console.warn('[OfflineQueue] HTTP ' + resp.status + ' → drop #' + item.id + ' (store=' + storeName + ')'); } catch (_) {}
        return 'http-4xx';
      }
      // 5xx：服务端临时异常，重试
      if ((item.retryCount || 0) + 1 >= MAX_RETRY) {
        await remove(storeName, item.id);
        try { console.warn('[OfflineQueue] gave up #' + item.id + ' after ' + MAX_RETRY + ' retries'); } catch (_) {}
        return 'fail-giveup';
      }
      await bumpRetry(storeName, item);
      return 'fail-retry';
    } catch (networkErr) {
      // 网络仍未恢复
      return 'network-down';
    }
  }

  /**
   * 主线程同步 drain 单个 store（按时间顺序逐条重试）
   * @returns {Promise<{ok:number, fail:number, http4xx:number, giveup:number, networkDown:boolean}>}
   */
  async function drainStore(storeName) {
    if (!STORE_REGISTRY.has(storeName)) {
      return { ok: 0, fail: 0, http4xx: 0, giveup: 0, networkDown: false };
    }
    const items = await list(storeName);
    let ok = 0, fail = 0, http4xx = 0, giveup = 0, networkDown = false;
    for (const item of items) {
      const result = await _attemptOne(storeName, item);
      if (result === 'ok') ok++;
      else if (result === 'http-4xx') { http4xx++; fail++; }
      else if (result === 'fail-giveup') { giveup++; fail++; }
      else if (result === 'fail-retry') { fail++; break; }  // 失败时停止本次 drain，等下次触发
      else if (result === 'network-down') { networkDown = true; break; }
    }
    if (ok > 0 || fail > 0) {
      try { console.info('[OfflineQueue] drainStore(' + storeName + '): ok=' + ok + ' fail=' + fail + ' 4xx=' + http4xx + ' giveup=' + giveup); } catch (_) {}
    }
    return { ok: ok, fail: fail, http4xx: http4xx, giveup: giveup, networkDown: networkDown };
  }

  /**
   * 遍历全部 store 依次 drain（防并发：同一时刻只跑一份）
   * @returns {Promise<Object>} { [storeName]: {ok, fail, ...}, total: {ok, fail} }
   */
  async function drainNow() {
    if (_drainInFlight) return _drainInFlight;
    _drainInFlight = (async function () {
      const byStore = {};
      let totalOk = 0, totalFail = 0;
      for (const sn of STORE_REGISTRY) {
        // 一旦网络断就停止后续 store（避免无谓请求）
        const r = await drainStore(sn);
        byStore[sn] = r;
        totalOk += r.ok;
        totalFail += r.fail;
        if (r.networkDown) {
          try { console.info('[OfflineQueue] drainNow: stopped at ' + sn + ' (network down)'); } catch (_) {}
          break;
        }
      }
      return { byStore: byStore, total: { ok: totalOk, fail: totalFail } };
    })();
    try {
      return await _drainInFlight;
    } finally {
      _drainInFlight = null;
    }
  }

  // ============ Background Sync ============
  function hasBackgroundSync() {
    try {
      return 'serviceWorker' in navigator
        && 'SyncManager' in window
        && !!navigator.serviceWorker;
    } catch (e) {
      return false;
    }
  }

  async function registerSync() {
    if (!hasBackgroundSync()) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.sync && typeof reg.sync.register === 'function') {
        await reg.sync.register(SYNC_TAG);
        try { console.info('[OfflineQueue] Background Sync registered (tag=' + SYNC_TAG + ')'); } catch (_) {}
        return true;
      }
    } catch (e) {
      try { console.warn('[OfflineQueue] Background Sync register failed:', e); } catch (_) {}
    }
    return false;
  }

  // ============ iOS fallback 监听器注册（v1.6.13 新增）============
  // 在 init() 末尾自动注册，页面打开时立即生效
  function _registerIOSFallback() {
    // 1. online 事件：网络恢复立即 drain
    window.addEventListener('online', function () {
      try { console.info('[OfflineQueue] online event → drainNow()'); } catch (_) {}
      drainNow().catch(function () {});
    });
    // 2. visibilitychange：页面切前台时 drain
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        try { console.info('[OfflineQueue] visibilitychange→visible → drainNow()'); } catch (_) {}
        drainNow().catch(function () {});
      }
    });
    // 3. pageshow：从 bfcache 恢复时也触发
    window.addEventListener('pageshow', function (e) {
      try { console.info('[OfflineQueue] pageshow (persisted=' + !!e.persisted + ') → drainNow()'); } catch (_) {}
      drainNow().catch(function () {});
    });
    // 4. 启动时立即尝试一次（页面刚打开时）
    drainNow().catch(function () {});
  }

  // ============ 向后兼容：LocationQueue API ============
  // vehicle-location-reporter.js 仍调用 LocationQueue.enqueue(payload)
  // 内部转调 OfflineQueue.enqueue({storeName:'location-reports', url, body:payload})

  async function _locationEnqueue(payload) {
    return enqueue({
      storeName: 'location-reports',
      url: LOCATION_API_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      label: '车辆位置',
    });
  }

  async function _locationDrain() {
    return await drainStore('location-reports');
  }

  async function _locationCount() {
    return await count('location-reports');
  }

  async function _locationPeekAll() {
    return await list('location-reports');
  }

  async function _locationRemove(id) {
    return await remove('location-reports', id);
  }

  async function _locationClear() {
    return await clear('location-reports');
  }

  // ============ 暴露 API ============
  window.OfflineQueue = {
    init: init,
    registerStore: registerStore,
    stores: stores,
    enqueue: enqueue,
    list: list,
    listAll: listAll,
    count: count,
    countAll: countAll,
    remove: remove,
    clear: clear,
    drainStore: drainStore,
    drainNow: drainNow,
    hasBackgroundSync: hasBackgroundSync,
    registerSync: registerSync,
    _internal: {
      DB_NAME: DB_NAME,
      DB_VERSION: DB_VERSION,
      LEGACY_DB_NAME: LEGACY_DB_NAME,
      SYNC_TAG: SYNC_TAG,
      LEGACY_SYNC_TAG: LEGACY_SYNC_TAG,
      LOCATION_API_URL: LOCATION_API_URL,
      MAX_QUEUE_SIZE: MAX_QUEUE_SIZE,
      MAX_RETRY: MAX_RETRY,
    },
  };

  // 向后兼容（vehicle-location-reporter.js 仍用 LocationQueue）
  window.LocationQueue = {
    init: init,
    enqueue: _locationEnqueue,
    count: _locationCount,
    peekAll: _locationPeekAll,
    remove: _locationRemove,
    clear: _locationClear,
    drain: _locationDrain,
    hasBackgroundSync: hasBackgroundSync,
    registerBackgroundSync: registerSync,  // 同 SYNC_TAG 通用
  };

  // ============ 自动启动 iOS fallback 监听器 ============
  try {
    if (typeof window !== 'undefined') {
      // DOMContentLoaded 之后注册 online/visibilitychange（页面打开时）
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _registerIOSFallback);
      } else {
        _registerIOSFallback();
      }
    }
  } catch (e) {
    try { console.error('[OfflineQueue] init IOS fallback failed:', e); } catch (_) {}
  }
})();
