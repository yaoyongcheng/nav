/**
 * iOS PWA 桌面图标未读角标管理 v1.1.0
 *
 * 核心职责:
 * 1. 在 iOS 16.4+ Safari PWA（添加到主屏幕）上调用 navigator.setAppBadge()
 *    让桌面图标的右上角显示数字徽章
 * 2. 未读数持久化到 localStorage（PWA 重启后能恢复角标）
 * 3. 提供统一入口 setBadge / increment / clear / getCurrent
 * 4. 与 sw.js 的 push 事件配合（SW 自身维护累计计数器 + 兜底 setAppBadge）
 * 5. 与 AdminMessageManager.messageUpdated / WebSocket 消息对接
 * 6. 降级路径：其他环境走 in-app 红点 + favicon + 标题栏
 *
 * v1.2.0 变更:
 * - 修复「主线程清零后 SW 仍累加」导致下次 push 角标错乱的问题
 * - v1.1.0 用 postMessage(controller) 通知 SW，但 iOS PWA 冷启动时 controller
 *   经常是 null → 消息被静默丢弃 → SW 内部 Cache 计数器与主线程脱钩
 *   · 现象: 10 → 打开PWA(主线程清零)→ 关闭 → 5条push → 15
 *   · 根因: notifySW 失败，SW Cache 仍是 10，push 累加 10+5=15
 * - v1.2.0: 主线程直接写入 SW 共享的 'badge-tracker' Cache
 *   · SW push handler 也是从同一 Cache 读 → 两端共享单一真实源
 *   · postMessage(controller) 失败也不影响，下一次 push 时 SW 自动读最新值
 * - notifySW 同时增强：controller 不存在时等 navigator.serviceWorker.ready
 *   拿到 active worker 再 post，最大限度保证消息送达
 * - 行为兼容 v1.1.0：Cache 写入失败时静默，不影响主流程
 *
 * v1.1.0 变更:
 * - 修复「连发多条 push 只显示 1」问题：新增 notifySW()，每次 setBadge/clear
 *   都会向 SW 发送 BADGE_SET 消息，让 SW 校准自身 Cache 里的累计计数器
 * - SW push handler 在 v1.6.12 起改为「累加 + setAppBadge」语义
 *   · PWA 关闭时：连发 5 条 push → 角标累加为 5
 *   · PWA 打开时：主线程 syncFromServer 拉到准确数 → postMessage BADGE_SET → SW 校准
 *   · 标记全部已读：setBadge(0) → SW 计数器清零 + clearAppBadge
 * - 行为兼容 v1.0.0：未对接 SW controller 的环境（普通 Safari / 桌面 Chrome）
 *   notifySW 静默无操作
 *
 * 关键事实:
 * - iOS 16.4 setAppBadge API **不需要 Web Push** 即可使用
 * - 必须满足: iOS 16.4+ + PWA standalone + HTTPS
 * - iOS 角标是系统级持久化（不依赖 PWA 进程）
 * - 数字上限 99，超过显示 "99+"
 *
 * 用法:
 *   <script src="js/ios-badge.js"></script>
 *   <script>
 *     // 页面加载后恢复未读数
 *     IOSBadge.restore();
 *
 *     // 收到新消息时
 *     IOSBadge.increment();                  // +1
 *     IOSBadge.setBadge(5);                  // 直接设为 5
 *     IOSBadge.clear();                      // 清零
 *   </script>
 *
 * 调试: URL 加 ?pushdebug=1 显示状态 banner
 *
 * 暴露 API:
 *   window.IOSBadge = {
 *     isSupported()      → 是否支持 setAppBadge
 *     isAvailable()      → 当前环境是否真的能显示桌面角标（iOS 16.4+ PWA）
 *     getCurrent()       → 当前未读数
 *     setBadge(n)        → 设置未读数为 n
 *     increment(delta=1) → 增加未读数
 *     clear()            → 清零
 *     restore()          → 从 localStorage 恢复角标（页面加载时调用）
 *     syncFromServer(url) → 从服务端拉取未读数并同步（核心去 WebSocket 依赖）
 *     subscribe(cb)      → 订阅未读数变化
 *     refresh()          → 强制重新同步角标到系统（用于外部状态变化）
 *   }
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'm94-ios-badge-unread';
  const DEBUG_PARAM = 'pushdebug';

  let _current = 0;
  let _initialized = false;
  const _listeners = [];

  // ==================== 环境检测 ====================

  function detectIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function detectIOSVersion() {
    const ua = navigator.userAgent;
    const m = ua.match(/OS (\d+)_(\d+)/);
    if (!m) return 0;
    return parseInt(m[1], 10) + parseInt(m[2], 10) / 10;
  }

  function detectStandalone() {
    return navigator.standalone === true ||
           window.matchMedia('(display-mode: standalone)').matches;
  }

  function detectHttps() {
    return location.protocol === 'https:' || location.hostname === 'localhost' ||
           location.hostname === '127.0.0.1';
  }

  /** API 是否存在于浏览器 */
  function isSupported() {
    return typeof navigator !== 'undefined' &&
           typeof navigator.setAppBadge === 'function';
  }

  /** 当前环境是否真的能在桌面图标显示角标 */
  function isAvailable() {
    return detectIOS() &&
           detectIOSVersion() >= 16.4 &&
           detectStandalone() &&
           detectHttps() &&
           isSupported();
  }

  // ==================== 持久化 ====================

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return 0;
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch (_) {
      return 0;
    }
  }

  function saveToStorage(n) {
    try {
      if (n > 0) {
        localStorage.setItem(STORAGE_KEY, String(n));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (_) { /* ignore */ }
  }

  // ==================== 角标同步 ====================

  /** 触发系统层角标更新（仅在 iOS PWA 有效） */
  async function applyToSystem(n) {
    if (!isAvailable()) return false;
    try {
      if (n > 0) {
        await navigator.setAppBadge(n);
      } else {
        await navigator.clearAppBadge();
      }
      return true;
    } catch (err) {
      console.warn('[IOSBadge] setAppBadge 失败:', err && err.message);
      return false;
    }
  }

  /**
   * v1.1.0 新增：通知 SW 同步角标状态
   * 主线程在 setBadge / clear / restore / syncFromServer 后调用
   * 让 SW 内部累计计数器跟主线程保持一致（防止 PWA 关闭期间 SW 累加的值
   * 跟用户从服务端拉到真实数对不上）
   *
   * SW 端通过 message handler 接收：
   *   { type: 'BADGE_SET',  value: 5 }   → setStoredBadge(5) + setAppBadge(5)
   *   { type: 'BADGE_CLEAR' }            → setStoredBadge(0) + clearAppBadge
   *
   * v1.2.0 增强：
   *   - controller 为 null 时等待 navigator.serviceWorker.ready 拿到 active worker
   *   - 主要修复 iOS PWA 冷启动场景下 controller 未就绪导致消息丢弃
   */
  function notifySW(value) {
    try {
      if (!('serviceWorker' in navigator)) return;
      const msg = (value === 0)
        ? { type: 'BADGE_CLEAR' }
        : { type: 'BADGE_SET', value: Math.max(0, parseInt(value, 10) || 0) };

      // 路径 1：直接 post 给 controller（最快路径）
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage(msg);
        return;
      }

      // 路径 2：controller 不在，等 SW 激活后再 post
      navigator.serviceWorker.ready
        .then(function (reg) {
          if (reg && reg.active) {
            try { reg.active.postMessage(msg); } catch (_) {}
          }
        })
        .catch(function () { /* SW 注册失败，忽略 */ });
    } catch (e) {
      // 跨域 / 已被卸载等异常一律吞掉，不影响主流程
    }
  }

  /**
   * v1.2.0 新增：写入 SW 共享的「badge-tracker」Cache
   * 这是真正的「单一真实源」：主线程和 SW 都读写同一份 Cache，
   * 不依赖 postMessage 通道的可达性。
   *
   * 为什么需要这个（修复 10→打开PWA→0→5条push→15 这个 bug）：
   *   - 旧方案仅靠 postMessage(controller) 通知 SW 校准
   *   - iOS PWA 冷启动时 controller 经常是 null → postMessage 被静默丢弃
   *   - SW 内部 Cache 仍是 10（没收到清零消息）
   *   - 关闭 PWA → 5 条 push 进来 → SW 从 Cache 读 10，累加到 15
   * 新方案：主线程直接写 Cache，SW push handler 也是从同一 Cache 读
   *   - 即使 postMessage 失败，SW 下次读 Cache 也是最新值
   *   - 写入失败也无所谓（极端情况），下次 push 时本地 _current 还能补救
   */
  function writeSharedBadge(n) {
    try {
      if (!('caches' in window)) return;
      const safeN = Math.max(0, parseInt(n, 10) || 0);
      const cachePromise = caches.open('badge-tracker');
      cachePromise.then(function (cache) {
        return cache.put(
          './__badge_count__',
          new Response(String(safeN), {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          })
        );
      }).catch(function () { /* 缓存写失败不阻塞主流程 */ });
    } catch (e) {
      // 同步异常吞掉
    }
  }

  /** 触发变化通知 */
  function notify(prev, next) {
    const event = new CustomEvent('iosbadge:change', {
      detail: { prev: prev, current: next, ts: Date.now() }
    });
    window.dispatchEvent(event);
    for (let i = 0; i < _listeners.length; i++) {
      try { _listeners[i](next, prev); } catch (_) {}
    }
  }

  // ==================== 主入口 ====================

  function getCurrent() {
    return _current;
  }

  /**
   * 设置未读数（绝对值）
   * @param {number} n 目标未读数（>=0）
   * @returns {Promise<boolean>} 是否成功应用到系统层
   */
  async function setBadge(n) {
    const prev = _current;
    const next = Math.max(0, parseInt(n, 10) || 0);
    if (next === prev) {
      // 即便值相同，仍调用一次系统 API 兜底（防止外部系统状态不一致）
      const ok = await applyToSystem(next);
      // 同时同步给 SW（让 SW 内部计数器跟主线程保持一致）
      notifySW(next);
      // v1.2.0: 写入 SW 共享 Cache（即使 postMessage 失败下次 push 也能读到）
      writeSharedBadge(next);
      return ok;
    }
    _current = next;
    saveToStorage(next);
    const ok = await applyToSystem(next);
    // v1.1.0: 同步给 SW，让 SW 内部累计计数器跟主线程一致
    notifySW(next);
    // v1.2.0: 写入 SW 共享 Cache（绕过 postMessage 不可靠问题）
    writeSharedBadge(next);
    notify(prev, next);
    console.log('[IOSBadge] setBadge:', prev, '→', next, 'applied:', ok,
                'available:', isAvailable());
    return ok;
  }

  /** 增加未读数 */
  async function increment(delta) {
    delta = parseInt(delta, 10) || 1;
    return await setBadge(_current + delta);
  }

  /** 清零 */
  async function clear() {
    return await setBadge(0);
  }

  /**
   * 从服务端拉取未读数并同步到角标
   * 这是「不依赖 WebSocket / Web Push」的核心同步机制：
   *   - 用户进入消息中心时调一次 → iOS 桌面图标立即准确
   *   - 应用切回前台时调一次 → 角标刷新
   *   - 定时轮询（可选）→ 角标持续准确
   *
   * @param {string|Function} source - 服务端 URL 或返回 Promise<number> 的函数
   *   支持的响应格式（自动识别）:
   *     { unread: 3 }
   *     { unreadCount: 3 }
   *     { count: 3 }
   *     { data: { unread: 3 } }
   *     [item1, item2, ...]   ← 数组长度
   *     3                     ← 裸数字
   * @param {Object} [options]
   * @param {string} [options.method='GET']
   * @param {Object} [options.headers]
   * @param {Object} [options.body]
   * @param {string} [options.credentials='same-origin']
   * @returns {Promise<number>} 同步后的未读数
   */
  async function syncFromServer(source, options) {
    options = options || {};
    let count = null;

    try {
      let raw;
      if (typeof source === 'function') {
        raw = await source();
      } else if (typeof source === 'string') {
        const resp = await fetch(source, {
          method: options.method || 'GET',
          headers: options.headers || { 'Accept': 'application/json' },
          body: options.body,
          credentials: options.credentials || 'same-origin'
        });
        if (!resp.ok) {
          console.warn('[IOSBadge] syncFromServer HTTP', resp.status, source);
          return _current;
        }
        raw = await resp.json();
      } else {
        console.warn('[IOSBadge] syncFromServer: source 必须是 URL 或函数');
        return _current;
      }

      count = extractUnreadFromResponse(raw);
    } catch (err) {
      console.warn('[IOSBadge] syncFromServer 失败:', err && err.message);
      return _current;
    }

    if (typeof count !== 'number' || !Number.isFinite(count)) {
      console.warn('[IOSBadge] syncFromServer: 无法从响应中提取未读数');
      return _current;
    }

    await setBadge(Math.max(0, count));
    return _current;
  }

  /** 从各种响应格式中提取未读数 */
  function extractUnreadFromResponse(raw) {
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : null;
    }
    if (Array.isArray(raw)) return raw.length;
    if (typeof raw !== 'object') return null;

    // 直接字段
    const directKeys = ['unread', 'unreadCount', 'badgeCount', 'count', 'total', 'newCount'];
    for (let i = 0; i < directKeys.length; i++) {
      const v = raw[directKeys[i]];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }

    // 嵌套 data
    if (raw.data && typeof raw.data === 'object') {
      for (let i = 0; i < directKeys.length; i++) {
        const v = raw.data[directKeys[i]];
        if (typeof v === 'number' && Number.isFinite(v)) return v;
      }
    }

    // success 响应 + data.items 数组
    if (Array.isArray(raw.items)) return raw.items.length;
    if (raw.data && Array.isArray(raw.data.items)) return raw.data.items.length;
    if (Array.isArray(raw.messages)) return raw.messages.length;
    if (Array.isArray(raw.data && raw.data.messages)) return raw.data.messages.length;

    // 显式 read 字段过滤（如 AdminMessageManager 的 messages 数组）
    if (Array.isArray(raw)) return raw.length;

    return null;
  }

  /** 从 localStorage 恢复角标（页面加载时调用） */
  async function restore() {
    if (_initialized) return _current;
    _initialized = true;
    _current = loadFromStorage();
    const ok = await applyToSystem(_current);
    // v1.1.0: 通知 SW 校准（如果 SW 内部计数器大于 _current，以主线程为准）
    notifySW(_current);
    // v1.2.0: 写入 SW 共享 Cache（主线程视角的权威值）
    writeSharedBadge(_current);
    console.log('[IOSBadge] restore:', _current, 'applied:', ok,
                'available:', isAvailable());
    notify(0, _current);
    return _current;
  }

  /**
   * 强制重新同步角标到系统
   * 用于外部状态变化（如从服务端拉到最新未读数后）
   */
  async function refresh() {
    return await applyToSystem(_current);
  }

  /** 订阅未读数变化 */
  function subscribe(cb) {
    if (typeof cb === 'function') {
      _listeners.push(cb);
      // 返回取消订阅函数
      return function unsubscribe() {
        const idx = _listeners.indexOf(cb);
        if (idx >= 0) _listeners.splice(idx, 1);
      };
    }
    return function () {};
  }

  // ==================== 自动对接（尽量减少调用方改动）====================

  /**
   * 监听 AdminMessageManager 的 messageUpdated 事件
   * 优先使用详情里的 unreadCount（与现有 AdminMessageManager 一致）
   */
  function autoBindMessageManager() {
    if (typeof window === 'undefined') return;
    window.addEventListener('messageUpdated', function (e) {
      const count = e && e.detail && e.detail.unreadCount;
      if (typeof count === 'number') {
        setBadge(count);
      }
    });
  }

  /**
   * 监听自定义 'm94:unread-changed' 事件
   * 其它模块可以通过这个事件更新未读数，IOSBadge 自动同步系统角标
   */
  function autoBindCustomEvent() {
    window.addEventListener('m94:unread-changed', function (e) {
      const count = e && e.detail && e.detail.count;
      if (typeof count === 'number') {
        setBadge(count);
      }
    });
  }

  // ==================== 调试 banner（?pushdebug=1）====================

  function renderDebugBanner() {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(location.search);
    if (params.get(DEBUG_PARAM) !== '1') return;

    const banner = document.createElement('div');
    banner.id = 'iosbadge-debug';
    banner.style.cssText = [
      'position:fixed', 'left:8px', 'right:8px', 'bottom:8px',
      'z-index:999998', 'background:rgba(0,0,0,0.85)', 'color:#fff',
      'padding:10px 12px', 'border-radius:10px',
      'font-family:-apple-system,monospace', 'font-size:12px',
      'line-height:1.5', 'box-shadow:0 4px 12px rgba(0,0,0,0.3)',
      'pointer-events:auto'
    ].join(';');

    function refreshBanner() {
      banner.innerHTML = [
        '<b>🔴 iOSBadge Debug</b><br>',
        'available: ' + isAvailable() + '<br>',
        'supported: ' + isSupported() + '<br>',
        'iOS: ' + detectIOS() + ' (ver ' + detectIOSVersion() + ')<br>',
        'standalone: ' + detectStandalone() + '<br>',
        'https: ' + detectHttps() + '<br>',
        'current: ' + _current + '<br>',
        '<button id="iosbadge-test-add" style="margin-right:6px;padding:4px 8px;">+1</button>',
        '<button id="iosbadge-test-set5" style="margin-right:6px;padding:4px 8px;">设为 5</button>',
        '<button id="iosbadge-test-clear" style="margin-right:6px;padding:4px 8px;">清零</button>',
        '<button id="iosbadge-test-read" style="padding:4px 8px;">读取 storage</button>'
      ].join('');
      const addBtn = document.getElementById('iosbadge-test-add');
      const set5Btn = document.getElementById('iosbadge-test-set5');
      const clearBtn = document.getElementById('iosbadge-test-clear');
      const readBtn = document.getElementById('iosbadge-test-read');
      if (addBtn) addBtn.onclick = function () { IOSBadge.increment(); refreshBanner(); };
      if (set5Btn) set5Btn.onclick = function () { IOSBadge.setBadge(5); refreshBanner(); };
      if (clearBtn) clearBtn.onclick = function () { IOSBadge.clear(); refreshBanner(); };
      if (readBtn) readBtn.onclick = function () {
        console.log('[IOSBadge] storage =', localStorage.getItem(STORAGE_KEY));
        refreshBanner();
      };
    }

    document.body.appendChild(banner);
    refreshBanner();

    window.addEventListener('iosbadge:change', refreshBanner);
  }

  // ==================== 暴露 API ====================

  window.IOSBadge = {
    isSupported: isSupported,
    isAvailable: isAvailable,
    getCurrent: getCurrent,
    setBadge: setBadge,
    increment: increment,
    clear: clear,
    restore: restore,
    syncFromServer: syncFromServer,
    refresh: refresh,
    subscribe: subscribe,
    // 调试 / 高级
    _detectIOS: detectIOS,
    _detectIOSVersion: detectIOSVersion,
    _detectStandalone: detectStandalone,
    _detectHttps: detectHttps,
    _loadFromStorage: loadFromStorage,
    _STORAGE_KEY: STORAGE_KEY
  };

  // ==================== 自启动 ====================

  function autoInit() {
    if (typeof window === 'undefined') return;
    autoBindMessageManager();
    autoBindCustomEvent();
    // 不在此处自动 restore() — 由各页面在合适时机调用（避免登录前读取旧账号的角标）

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', renderDebugBanner);
    } else {
      renderDebugBanner();
    }
  }

  autoInit();

  console.log('[IOSBadge] v1.2.0 loaded; available =', isAvailable());

})();
