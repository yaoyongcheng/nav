/**
 * Web Push 前端订阅模块 v1.4.11.10（按钮全模式可见 + 不再依赖 PWA detection）
 * - v1.4.11.10 新增：与 js/ios-badge.js 联动
 *   · 订阅成功时调用 IOSBadge.restore() 让 iOS 16.4+ Safari PWA 桌面图标恢复未读角标
 *   · 取消订阅时调用 IOSBadge.clear() 清零桌面角标
 *   · 这两步是「让 iOS PWA 主屏幕图标显示消息数」完整链路的核心：
 *     sw.js 的 push 事件 setAppBadge 主动设置 + 主线程 restore/clear 持久化
 * - 检查浏览器支持（iOS Safari < 16.4 不支持）
 * - 首次用户手势触发 requestPermission（iOS 严格要求）
 * - 监听 appinstalled（Android / Desktop 浏览器）
 * - 订阅成功后发送到后端 /api/push/subscribe
 * - v1.4.11.9 重构（按钮全模式可见，绕开国产浏览器 PWA detection API 缺失问题）:
 *   · 问题：v1.4.11.8 已扩充 isStandalonePWA() 检测（minimal-ui media + 11 种国产浏览器
 *     scheme），但小米 17T Pro_2026 默认浏览器测试仍看不到按钮。
 *   · 根因：用户从桌面图标打开后无搜索框（证明是真的 PWA），但小米浏览器不暴露
 *     W3C 标准 detection API（display-mode media、android-app:// referrer、
 *     com.miui.browser scheme 都不命中）→ isStandalonePWA() 仍返回 false → 按钮被 display:none 隐藏。
 *   · 新策略：放弃 isStandalonePWA() 兜底依赖，按钮在所有模式可见（CSS 默认 display:inline-flex
 *     + JS syncButtonVisibility() 强制 display:flex !important）。不支持 Web Push 时由
 *     render() 渲染「⚠️ 不支持」灰色态。
 *   · 与其他 3 个快捷按钮（进场登记 / 视频监控 / 离线队列）保持产品逻辑一致。
 *   · isStandalonePWA() 函数本体保留，iOS PWA SW controller 检查等其他场景继续使用。
 * - v1.4.11.8 修复（国产 ROM 浏览器 PWA 检测覆盖，小米 17T Pro_2026 等场景）:
 *   · 问题：小米 / 华为 / vivo / OPPO / UC / QQ / 百度 / 360 / 搜狗 / 傲游 等国产浏览器的
 *     "添加到主屏幕"功能启动 PWA 时，document.referrer 是其私有 scheme
 *     （如 com.miui.browser://），不符合 W3C 标准的 android-app:// 前缀，
 *     且部分浏览器不实现 (display-mode: standalone) media query。
 *   · 原行为：isStandalonePWA() 返回 false → syncButtonVisibility() 不强制
 *     display:flex → CSS @media (display-mode: standalone) 也不命中
 *     → #qa-push-toggle 按钮被 display:none 完全隐藏。
 *   · 新行为：isStandalonePWA() 新增 4 项检测：
 *     ① (display-mode: minimal-ui) media query（部分国产浏览器降级实现）
 *     ② referrer 含 11 种已知国产浏览器包名前缀 → 视为 PWA 模式
 * - v1.4.11.7 清理（移除 PWA 自动浮动按钮入口）：
 *   · ?pushdebug=1 调试 banner 入口保留，移除 PWA 模式自动浮按钮（避免打扰正常用户）
 * - v1.4.11.4 关键修复（iOS 17+ WebKit 严格用户手势规则 — 真正的修复）:
 * - 检查浏览器支持（iOS Safari < 16.4 不支持）
 * - 首次用户手势触发 requestPermission（iOS 严格要求）
 * - 监听 appinstalled（Android / Desktop 浏览器）
 * - 订阅成功后发送到后端 /api/push/subscribe
 * - v1.4.11.4 关键修复（iOS 17+ WebKit 严格用户手势规则 — 真正的修复）:
 *   · click handler 不再用 `async function` 包裹（async 函数本身就是异步的）
 *   · Notification.requestPermission() 必须在 click handler 的同步路径中直接调用
 *   · 用 .then() 链驱动后续异步订阅流程（用户手势已被同步调用捕获）
 *   · 这才是 iOS WebKit「short running user-generated event handler」要求的正确写法
 * - v1.4.11.3 已弃用（async function click handler → iOS 视为已超出用户手势窗口）
 * - v1.4.11.2 关键修复（iOS PWA controllerchange 死循环）:
 *   · controllerchange 监听器改为只在 reg.waiting 存在时才 reload
 *   · 修复 iOS PWA 首次启动 SW 接管 controller 触发的 reload 死循环（导致权限弹窗被 reload 打断）
 *   · subscribe() 加 sessionStorage reload 防重入标记，防止 AbortError 重试时无限 reload
 *   · 删除 message 字段误匹配（只匹配 name），避免 UnknownError / NotAllowedError 误触发 reload
 * - v1.4.11 关键修复:
 *   · getSWRegistration() 始终等待 navigator.serviceWorker.ready（修复 iOS PWA reload
 *     后 controller 未激活导致的 subscribe 静默失败）
 *   · iOS PWA 授权后延迟 500ms 再 subscribe（iOS 内部需 ~300-800ms 写入 push service）
 *   · subscribe() 返回 null / AbortError / InvalidStateError / NotAllowedError 时
 *     自动触发 reload（让 iOS 重新建立 SW 上下文 + push service 准备）
 *   · init() 检测 permission=granted 但无 subscription → 自动完成 subscribe
 *     （reload 恢复路径，避免用户再次点击）
 *
 * 用法:
 *   <script src="js/push-subscribe.js"></script>
 *   <script>PushNotify.requestPermission()</script>   // 也可以手动调
 *
 * 调试: URL 加 ?pushdebug=1 显示状态 banner
 *
 * 全局配置（可选,调用前设）:
 *   window.PUSH_SERVER = 'https://your-domain';   // 默认相对路径（同源）
 */
(function () {
  'use strict';

  // PUSH_SERVER 默认走相对路径（与当前页面同源），让 cloudflared 等反代透明路由
  const PUSH_SERVER = (window.PUSH_SERVER || '').replace(/\/+$/, '');
  const STATUS_KEY = 'push_status_v1';
  const SUB_KEY = 'push_subscription_v1';

  // 状态机
  let _status = 'default';
  let _triggeredOnce = false; // 防止首次手势多次触发

  function setStatus(s) {
    _status = s;
    try { localStorage.setItem(STATUS_KEY, s); } catch (_) {}
    document.dispatchEvent(new CustomEvent('pushnotify:change', { detail: { status: s } }));
  }
  function getStatus() { return _status; }

  function isSupported() {
    return (
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  function detectIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  // 把 base64url VAPID 公钥转成 Uint8Array
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function getVapidKey() {
    try {
      const r = await fetch(PUSH_SERVER + '/api/push/vapid-key', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { publicKey } = await r.json();
      if (!publicKey) throw new Error('empty publicKey');
      return publicKey;
    } catch (e) {
      console.warn('[PushNotify] 获取 VAPID 公钥失败:', e.message, '（请确认 push_server.py 已启动）');
      throw e;
    }
  }

  async function getSWRegistration() {
    // v1.4.11 修复（iOS PWA 兼容性）:
    //   始终等待 navigator.serviceWorker.ready，避免在 SW controller 未激活时
    //   调用 pushManager.subscribe() 导致 iOS 静默失败（permission = granted 但 sub = null）。
    //   旧版本只在首次注册时等 ready；如果是 PWA 模式 reload 后 controller 可能未就绪。
    if (!navigator.serviceWorker.controller) {
      try {
        await navigator.serviceWorker.ready;
      } catch (e) {
        console.warn('[PushNotify] SW ready 等待异常:', e && e.message);
      }
    }
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      reg = await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;
    }
    return reg;
  }

  async function sendSubscriptionToServer(sub) {
    try {
      const json = sub.toJSON ? sub.toJSON() : sub;
      const r = await fetch(PUSH_SERVER + '/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      console.log('[PushNotify] subscription 已发送到后端:', j);
      try { localStorage.setItem(SUB_KEY, JSON.stringify(json)); } catch (_) {}
      return true;
    } catch (e) {
      console.warn('[PushNotify] 发送 subscription 失败:', e.message);
      try { localStorage.setItem(SUB_KEY, JSON.stringify(sub.toJSON ? sub.toJSON() : sub)); } catch (_) {}
      return false;
    }
  }

  // 核心：请求权限 + 订阅
  async function requestPermission() {
    if (!isSupported()) {
      setStatus('unsupported');
      console.warn('[PushNotify] 浏览器不支持 Web Push');
      return false;
    }

    // 检查现有订阅
    try {
      const reg = await getSWRegistration();
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        setStatus('subscribed');
        await sendSubscriptionToServer(existing);
        console.log('[PushNotify] 已订阅，跳过权限请求');
        return true;
      }
    } catch (e) {
      console.warn('[PushNotify] 检查订阅失败:', e);
    }

    // 请求权限（必须在用户手势中调！）
    let perm = Notification.permission;
    if (perm === 'default') {
      try {
        perm = await Notification.requestPermission();
      } catch (e) {
        console.warn('[PushNotify] requestPermission 异常:', e);
        perm = 'denied';
      }
    }
    console.log('[PushNotify] requestPermission 结果:', perm);
    if (perm !== 'granted') {
      // 用户在系统弹窗选了「不允许」→ 按钮保持「开启通知」态，不显示「禁止」
      // 这样用户可以再次点击重新触发弹窗
      setStatus('default');
      console.warn('[PushNotify] 通知权限被拒，保持 default 态:', perm);
      return false;
    }

    return await completeSubscription();
  }

  // v1.4.11.3 新增：拆出「拿到 granted 后的订阅流程」
  //   用于让 click handler 能拆成两步：先在用户手势同步窗口里
  //   调用 Notification.requestPermission() 拿到 granted，再异步完成 subscribe。
  //   subscribe 本身不需要用户手势，可以放在 await 之后。
  async function completeSubscription() {
    // v1.4.11 修复（iOS 16.6+ / 17.x PWA 兼容性）:
    //   用户授权后立即调用 pushManager.subscribe() 在 iOS PWA 模式下经常
    //   静默失败（permission = granted 但 sub = null）。原因：iOS 内部需要
    //   ~300-800ms 把权限写入 push service。延迟 500ms 让权限稳定后再 subscribe。
    if (detectIOS() && isStandalonePWA()) {
      console.log('[PushNotify] iOS PWA 授权后等待 500ms 让权限写入 push service...');
      await new Promise(function (r) { setTimeout(r, 500); });
    }

    // 取 VAPID 公钥
    let vapidKey;
    try { vapidKey = await getVapidKey(); } catch (_) {
      setStatus('default');
      return false;
    }

    // pushManager.subscribe
    // v1.4.11.1 修复：加 reload 防重入保护（防止 v1.4.11 初次版 reload 死循环）
    // 使用 sessionStorage 标记本次会话已 reload 过一次 → 第二次失败直接放弃，避免无限循环
    var RELOAD_GUARD_KEY = 'm94-push-reload-guard';
    var hasReloadedThisSession = false;
    try { hasReloadedThisSession = sessionStorage.getItem(RELOAD_GUARD_KEY) === '1'; } catch (_) {}
    try {
      const reg = await getSWRegistration();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      // v1.4.11 修复：iOS 偶发返回 null（push service 还没准备好）
      if (!sub) {
        console.warn('[PushNotify] subscribe() 返回 null，iOS PWA 偶发');
        setStatus('default');
        if (detectIOS() && isStandalonePWA() && !hasReloadedThisSession) {
          try { sessionStorage.setItem(RELOAD_GUARD_KEY, '1'); } catch (_) {}
          setTimeout(function () { location.reload(); }, 1500);
        }
        return false;
      }
      // 成功 → 清理 reload guard
      try { sessionStorage.removeItem(RELOAD_GUARD_KEY); } catch (_) {}
      await sendSubscriptionToServer(sub);
      setStatus('subscribed');
      console.log('[PushNotify] 订阅成功');
      // v1.4.11.10：联动 iOS PWA 角标 — 恢复未读数到桌面图标
      try {
        if (window.IOSBadge && typeof window.IOSBadge.restore === 'function') {
          window.IOSBadge.restore();
        }
      } catch (_) { /* ignore */ }
      return true;
    } catch (e) {
      console.error('[PushNotify] 订阅失败:', e);
      // v1.4.11.1 修复：放宽误匹配 — 只匹配 name 字段，不匹配 message（避免 false positive）
      //   iOS 16.6+ / 17.x PWA 模式下 pushManager.subscribe() 抛 AbortError 时
      //   自动 reload 让 iOS 重新建立 SW 上下文 + push service 准备。
      //   严格防重入：sessionStorage 标记 + 仅当 name 命中才 reload。
      var isRetryableError = e && (
        e.name === 'AbortError' ||
        e.name === 'InvalidStateError'
        // 注意：删除 NotAllowedError / UnknownError — 它们的语义不同,
        //   NotAllowedError 可能是永久拒绝, UnknownError 可能是网络问题
      );
      if (isRetryableError && detectIOS() && isStandalonePWA() && !hasReloadedThisSession) {
        console.warn('[PushNotify] iOS PWA subscribe 失败，触发自动 reload 重试:', e && e.name);
        setStatus('default');
        try { sessionStorage.setItem(RELOAD_GUARD_KEY, '1'); } catch (_) {}
        setTimeout(function () { location.reload(); }, 1800);
        return false;
      }
      setStatus('default');
      return false;
    }
  }

  async function unsubscribe() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return true;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setStatus('default');
        try { localStorage.removeItem(SUB_KEY); } catch (_) {}
        // v1.4.11.10：联动 iOS PWA 角标 — 清零桌面图标
        try {
          if (window.IOSBadge && typeof window.IOSBadge.clear === 'function') {
            window.IOSBadge.clear();
          }
        } catch (_) { /* ignore */ }
        return true;
      }
      const ok = await sub.unsubscribe();
      try { localStorage.removeItem(SUB_KEY); } catch (_) {}
      setStatus('default');
      console.log('[PushNotify] 取消订阅:', ok);
      // v1.4.11.10：联动 iOS PWA 角标 — 清零桌面图标
      try {
        if (window.IOSBadge && typeof window.IOSBadge.clear === 'function') {
          window.IOSBadge.clear();
        }
      } catch (_) { /* ignore */ }
      return ok;
    } catch (e) {
      console.error('[PushNotify] 取消订阅失败:', e);
      return false;
    }
  }

  async function toggle() {
    const s = getStatus();
    if (s === 'subscribed') {
      await unsubscribe();
      return 'unsubscribed';
    }
    const ok = await requestPermission();
    return ok ? 'subscribed' : getStatus();
  }

  function isStandalonePWA() {
    // 1. W3C 标准 display-mode: standalone（Chrome / Edge / Firefox 等标准 PWA）
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia && window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    } catch (_) {}
    // 2. iOS Safari Web App（添加到主屏幕的旧 API）
    if (typeof navigator.standalone !== 'undefined' && navigator.standalone === true) return true;
    // 3. Android Chrome WebAPK 标准 referrer
    if (document.referrer && document.referrer.startsWith('android-app://')) return true;
    // 4. v1.4.11.8 国产 ROM 浏览器 PWA 兜底:
    //   小米 / 华为 / vivo / OPPO / UC / QQ / 百度 / 360 / 搜狗 / 傲游 等国产浏览器
    //   从桌面图标启动 PWA 时,document.referrer 是其私有 scheme(如 com.miui.browser://),
    //   不符合 android-app:// 前缀,标准 display-mode media 也不命中,
    //   导致 isStandalonePWA() 返回 false → CSS @media (display-mode: standalone)
    //   不命中 → #qa-push-toggle 按钮被 display:none 隐藏。
    //   兜底:referrer 含已知国产浏览器包名前缀即视为 PWA 模式。
    if (document.referrer) {
      var ref = String(document.referrer).toLowerCase();
      var KNOWN_DOMESTIC_BROWSERS = [
        'com.miui.browser',     // 小米浏览器（Mi Browser）
        'com.huawei.browser',   // 华为浏览器（Huawei Browser）
        'com.vivo.browser',     // vivo 浏览器
        'com.heytap.browser',   // OPPO 浏览器（HeyTap）
        'com.oppo.browser',     // OPPO 旧版浏览器
        'com.baidu.browser',    // 百度浏览器
        'com.uc.browser',       // UC 浏览器
        'com.tencent.mttbx',    // QQ 浏览器
        'com.qihoo.browser',    // 360 浏览器
        'com.sogou.browser',    // 搜狗浏览器
        'com.maxthon.browser',  // 傲游浏览器
      ];
      for (var i = 0; i < KNOWN_DOMESTIC_BROWSERS.length; i++) {
        if (ref.indexOf(KNOWN_DOMESTIC_BROWSERS[i]) !== -1) return true;
      }
    }
    return false;
  }

  // v1.4.11.9 重构：按钮在所有模式可见（CSS 已取消 display:none 默认值）
  // · 原设计：仅 PWA（standalone）模式显示，依赖 isStandalonePWA() 检测。
  // · 问题：国产 ROM 浏览器（小米 / 华为 / vivo / OPPO 等）实现 PWA 时不暴露
  //   W3C 标准 detection API（display-mode: standalone media / android-app:// referrer /
  //   私有 scheme 都不命中），isStandalonePWA() 返回 false → 按钮被 display:none 隐藏。
  // · 新策略：所有模式都强制 display:flex !important（CSS 兜底 + JS 兜底双保险），
  //   不支持 Web Push 的环境由 render() 渲染「⚠️ 不支持」灰色态，无需依赖 isStandalonePWA()。
  // · 注意：isStandalonePWA() 函数本体保留（iOS PWA SW controller 检查等其他场景仍需用）。
  function syncButtonVisibility() {
    const btn = document.getElementById('qa-push-toggle');
    if (!btn) return;
    btn.style.setProperty('display', 'flex', 'important');
  }

  // ============ 首次手势触发 ============
  // 已禁用：首次手势不再自动弹权限框（避免用户进页面就被打扰）
  // 仅在用户主动点击「开启通知」按钮时才触发 requestPermission

  // iOS PWA 模式下，用户没添加到主屏幕时给个视觉提示（保留备用，未自动触发）
  function showAddToHomeHint() {
    if (document.getElementById('pushnotify-hint')) return;
    if (!detectIOS()) return; // 仅 iOS
    const hint = document.createElement('div');
    hint.id = 'pushnotify-hint';
    hint.style.cssText = 'position:fixed;top:env(safe-area-inset-top, 0);left:0;right:0;z-index:99999;background:#1976d2;color:#fff;padding:12px;text-align:center;font-size:14px;line-height:1.4;font-family:-apple-system,sans-serif;';
    hint.innerHTML = '🔔 请先在 Safari 分享菜单 → <b>添加到主屏幕</b>，再从主屏幕图标打开';
    document.body.appendChild(hint);
    setTimeout(() => hint.remove(), 8000);
  }

  // 通知权限已被永久拒绝时的引导提示
  // iOS Safari 行为：第一次拒绝后，系统不会再弹权限框，必须用户在设置里手动开启
  // iOS 限制：Notification.permission 缓存在进程内，必须 reload / 重开才能读到新值
  function showPermissionDeniedHint() {
    const old = document.getElementById('pushnotify-denied-hint');
    if (old) old.remove();
    const hint = document.createElement('div');
    hint.id = 'pushnotify-denied-hint';
    hint.style.cssText = 'position:fixed;top:env(safe-area-inset-top, 16px);left:50%;transform:translateX(-50%);background:#ff6f00;color:#fff;padding:16px 18px;border-radius:14px;z-index:999999;max-width:380px;font-size:14px;line-height:1.5;box-shadow:0 6px 16px rgba(0,0,0,0.25);font-family:-apple-system,sans-serif;text-align:left;display:flex;flex-direction:column;gap:10px;';

    const text = document.createElement('div');
    if (detectIOS()) {
      text.innerHTML = '⚠️ 通知权限已被系统永久拒绝。<br><br>请到 <b>iPhone 设置 → 通知 → 工地导航 → 允许通知</b>。开启后点击下方「立即重试」即可生效（无需杀进程）。';
    } else {
      text.innerHTML = '⚠️ 通知权限已被浏览器禁止。请在浏览器设置中允许通知，然后点击「立即重试」。';
    }

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

    const retryBtn = document.createElement('button');
    retryBtn.textContent = '🔄 立即重试';
    retryBtn.style.cssText = 'background:#fff;color:#ff6f00;border:none;padding:8px 14px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;';
    retryBtn.onclick = function () {
      hint.remove();
      // reload 后 permission 会被 iOS 重新读取（部分版本生效）
      location.reload();
    };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.4);padding:8px 12px;border-radius:8px;font-size:14px;cursor:pointer;';
    closeBtn.onclick = function () { hint.remove(); };

    actions.appendChild(closeBtn);
    actions.appendChild(retryBtn);

    hint.appendChild(text);
    hint.appendChild(actions);
    document.body.appendChild(hint);

    // 30 秒才自动消失（用户需要时间切到设置再切回来）
    setTimeout(() => { if (hint && hint.parentNode) hint.remove(); }, 30000);
  }

  // v1.4.11.5 新增（iOS PWA SW controller 未就绪提示）:
  //   场景：iOS PWA 启动后 SW 还没 activate，Notification.requestPermission() 会被静默 deny。
  //   这里给用户明确提示「PWA 启动中，请稍候再点」，而不是「按钮无反应」。
  function showSWNotReadyHint() {
    const old = document.getElementById('pushnotify-sw-hint');
    if (old) old.remove();
    const hint = document.createElement('div');
    hint.id = 'pushnotify-sw-hint';
    hint.style.cssText = 'position:fixed;top:env(safe-area-inset-top, 16px);left:50%;transform:translateX(-50%);background:#1976d2;color:#fff;padding:16px 18px;border-radius:14px;z-index:999999;max-width:380px;font-size:14px;line-height:1.5;box-shadow:0 6px 16px rgba(0,0,0,0.25);font-family:-apple-system,sans-serif;text-align:left;display:flex;flex-direction:column;gap:10px;';

    const text = document.createElement('div');
    text.innerHTML = '⏳ PWA 正在启动中，系统服务（Service Worker）尚未就绪。<br><br>iOS 系统要求必须等服务就绪后才能弹出通知权限框。请稍候 <b>3~5 秒</b>，待页面底部的调试信息（若有）显示 <code>swController: true</code> 后，再次点击「开启通知」按钮即可。';

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

    const reloadBtn = document.createElement('button');
    reloadBtn.textContent = '🔄 重新加载 PWA';
    reloadBtn.style.cssText = 'background:#fff;color:#1976d2;border:none;padding:8px 14px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;';
    reloadBtn.onclick = function () {
      hint.remove();
      // reload 让 iOS 重新启动 PWA + SW 完整激活流程
      try { location.reload(); } catch (_) {}
    };

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.4);padding:8px 12px;border-radius:8px;font-size:14px;cursor:pointer;';
    closeBtn.onclick = function () { hint.remove(); };

    actions.appendChild(closeBtn);
    actions.appendChild(reloadBtn);

    hint.appendChild(text);
    hint.appendChild(actions);
    document.body.appendChild(hint);

    // 20 秒自动消失
    setTimeout(() => { if (hint && hint.parentNode) hint.remove(); }, 20000);
  }

  // 用户从系统设置切回 PWA 时：如果引导浮层还在显示，主动 reload 一次让 iOS 重新读取 permission
  // 部分 iOS 版本 reload 后 permission 会刷新；reload 后 init 会再次执行
  let __visibility_reloaded = false;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    const hint = document.getElementById('pushnotify-denied-hint');
    if (hint && !__visibility_reloaded) {
      __visibility_reloaded = true;
      console.log('[PushNotify] 从后台切回，触发 reload 以刷新 iOS Notification.permission 缓存');
      setTimeout(() => location.reload(), 200);
    }
  });

  // 监听 SW 更新：拿到新版本时自动 reload，让 push-subscribe.js 等关键文件刷新

  // ============ appinstalled 事件（Android / Desktop 浏览器） ============
  // iOS Safari 不发 appinstalled（PWA 是 silent install），所以这部分对 iOS 无效
  window.addEventListener('appinstalled', function () {
    console.log('[PushNotify] PWA 已安装（appinstalled），立即请求通知权限…');
    if (Notification && Notification.permission === 'default') {
      requestPermission();
    }
  });

  // ============ 调试模式（v1.4.11.5 引入 + v1.4.11.7 清理）==========
  // v1.4.11.5：banner 改为独立函数，IIFE 顶部立即调用（不等 DOMContentLoaded/init），
  //   解决 iOS PWA SW 时序阻塞 init() 导致 banner 不显示的问题。
  // v1.4.11.7：移除 PWA 模式自动浮动按钮（避免打扰正常用户），仅 ?pushdebug=1 触发。
  function startDebugBannerImmediate() {
    try {
      // v1.4.11.7 清理：仅 ?pushdebug=1 触发（移除 PWA 自动浮动按钮，避免打扰正常用户）
      if (!location.search.includes('pushdebug=1')) return;

      const start = function () {
        try {
          _mountDebugBanner();
        } catch (e) {
          try { console.warn('[PushNotify] banner 启动失败:', e && e.message); } catch (_) {}
        }
      };

      if (document.body) start();
      else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
      } else {
        setTimeout(start, 0);
      }
    } catch (e) {
      try { console.warn('[PushNotify] startDebugBannerImmediate 失败:', e && e.message); } catch (_) {}
    }
  }

  // 创建完整诊断 banner（仅 ?pushdebug=1 模式触发；v1.4.11.7 移除 PWA 浮动按钮入口）
  function _mountDebugBanner() {
    try {
      if (document.getElementById('pushnotify-debug')) return;
      const el = document.createElement('div');
      el.id = 'pushnotify-debug';
      el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:999999;' +
        'background:rgba(0,0,0,0.92);color:#0f0;font:11px/1.4 -apple-system,monospace;' +
        'padding:10px 8px calc(10px + env(safe-area-inset-bottom, 0px));' +
        'white-space:pre-wrap;max-height:60vh;overflow:auto;' +
        'border-top:2px solid #0f0;box-sizing:border-box;';
      document.body.appendChild(el);
      let lastText = '';
      function refresh() {
        const info = {
          url: location.href,
          ua: navigator.userAgent.slice(0, 100),
          iOS: /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream,
          standalone: !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
            || (typeof navigator.standalone !== 'undefined' && navigator.standalone === true)
            || !!(document.referrer && document.referrer.startsWith('android-app://')),
          swSupported: 'serviceWorker' in navigator,
          pushManager: 'PushManager' in window,
          notification: 'Notification' in window,
          permission: (typeof Notification !== 'undefined' && Notification) ? Notification.permission : 'n/a',
          swController: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
          sub: null,
          now: new Date().toLocaleTimeString(),
        };
        try {
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration().then(function (reg) {
              info.swRegistered = !!reg;
              if (reg) info.swScope = reg.scope;
              if (reg && reg.active) info.swState = reg.active.state;
              if (reg && reg.installing) info.swInstalling = true;
              if (reg && reg.waiting) info.swWaiting = true;
              if (reg && reg.pushManager) {
                return reg.pushManager.getSubscription();
              }
              return null;
            }).then(function (sub) {
              if (sub) info.sub = sub.endpoint.slice(0, 70) + '...';
              render();
            }).catch(function (e) {
              info.swErr = String(e && e.message || e);
              render();
            });
          } else { render(); }
        } catch (e) {
          info.swErr = String(e && e.message || e);
          render();
        }
        function render() {
          const text = '[PushNotify DEBUG v1.4.11.5 (IIFE 立即启动)]\n' + JSON.stringify(info, null, 2);
          if (text !== lastText) { el.textContent = text; lastText = text; }
        }
      }
      refresh();
      setInterval(refresh, 1500);
    } catch (e) {
      try { console.warn('[PushNotify] banner mount 失败:', e && e.message); } catch (_) {}
    }
  }

  // v1.4.11.5：IIFE 顶部立即启动，不等 init()，不等 DOMContentLoaded
  startDebugBannerImmediate();

  // v1.4.11.6 关键修复（iOS PWA SW 未注册导致"按钮点不动"）:
  //   问题：pwa-install.js 在 PWA 模式下整个 IIFE 早返回（line 1876 `if (isStandalone) return;`），
  //   导致其内部的 registerSW() 永远不被调用。如果用户从未在 Safari 里打开过、只从主屏幕图标
  //   打开 PWA，SW 从来没机会注册 → Notification.requestPermission() 即使成功也会因为
  //   pushManager.subscribe() 失败导致整个订阅流程无效。
  //   修复：push-subscribe.js 不再依赖 pwa-install.js，IIFE 顶部**主动 register SW**，
  //   保证 iPhone PWA 模式（包括首次从主屏幕图标打开）也能注册成功。
  //   注意：
  //     ① 浏览器对相同 scope 的 register() 是幂等的（已注册就直接 resolve 现有 reg）
  //     ② file:// 协议下 navigator.serviceWorker 不存在，必须跳过
  //     ③ SW 加载失败不会阻塞 push 模块其他功能
  function _registerServiceWorkerTopLevel() {
    try {
      if (!('serviceWorker' in navigator)) {
        try { console.info('[PushNotify] 当前环境不支持 SW，跳过注册'); } catch (_) {}
        return;
      }
      if (location.protocol === 'file:') {
        try { console.info('[PushNotify] file:// 协议不支持 SW，跳过注册'); } catch (_) {}
        return;
      }
      // PWA 模式下 SW scope 必须覆盖当前 origin，用相对路径 './sw.js' 即可
      navigator.serviceWorker.register('./sw.js')
        .then(function (reg) {
          try { console.info('[PushNotify] SW 注册成功:', reg && reg.scope); } catch (_) {}
        })
        .catch(function (e) {
          try { console.warn('[PushNotify] SW 注册失败:', e && e.message); } catch (_) {}
        });
    } catch (e) {
      try { console.warn('[PushNotify] SW register 调用异常:', e && e.message); } catch (_) {}
    }
  }
  // v1.4.11.6：IIFE 顶部立即执行（不等 DOMContentLoaded、不等 init）
  _registerServiceWorkerTopLevel();

  // ============ 启动 ============
  async function init() {
    try {
      const saved = localStorage.getItem(STATUS_KEY);
      // 只有 subscribed 才认 localStorage；denied/default 一律以实时权限为准
      if (saved === 'subscribed') _status = saved;
    } catch (_) {}

    // v1.4.11.5 修复（iOS PWA SW 时序）:
    //   原问题：syncButtonVisibility/bindToggleButton 都在 init() 末尾，init() 顶部
    //   任何 await 卡住（典型场景：iOS PWA 启动后 SW 长时间未 activate，
    //   await getSWRegistration() 永远 pending）都会让按钮 click handler 不绑，
    //   用户看到「按钮可见但点不动」、「点完按钮完全没反应」。
    //   修复：把按钮绑定提前到 init() 顶部（不等 SW ready，不等订阅检查），
    //   让用户立即可以点击。SW 状态相关检查放在 click handler 内部做。
    //   调试 banner 已在 IIFE 顶部的 startDebugBannerImmediate() 独立启动，
    //   这里不再重复调用。
    syncButtonVisibility();
    bindToggleButton();

    // 监听 SW 更新：拿到新版本时自动 reload，让 push-subscribe.js 等关键文件刷新
    if ('serviceWorker' in navigator) {
      // v1.4.11.2 修复（iOS PWA 无限 reload）:
      //   原代码在 controllerchange 时立刻 reload，但 iOS PWA 首次启动 SW 接管
      //   controller 也会触发 controllerchange，导致 reload 死循环。
      //   修复方案：只有当页面已经处于「等待新 SW」状态（navigator.serviceWorker
      //   里有 waiting worker）时，controllerchange 才意味着新版本接管，才 reload。
      //   首次注册导致的 controllerchange 不会 reload。
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (window.__pushnotify_reloading) return;
        // v1.4.11.5 协同守卫：让位 pwa-install.js 的版本更新接管
        if (window.__APP_VERSION_UPDATE_STARTED__) return;
        // 检测是否有 waiting worker — 没有说明不是版本更新引起的 controllerchange
        navigator.serviceWorker.getRegistration().then(function (reg) {
          if (!reg || !reg.waiting) {
            // 首次注册接管，不 reload
            console.log('[PushNotify] controllerchange 但无 waiting worker，不 reload');
            return;
          }
          window.__pushnotify_reloading = true;
          console.log('[PushNotify] 检测到新 SW 接管，reload 加载新版本');
          window.location.reload();
        });
      });
      // 监听新 SW 等待激活 → 提示用户刷新（但不强 reload，避免打断弹窗）
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.addEventListener('statechange', function () {
          // 仅做日志，不触发 reload
          console.log('[PushNotify] SW state 变化:', navigator.serviceWorker.controller && navigator.serviceWorker.controller.state);
        });
      }
      // 主动检查更新
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) reg.update().catch(() => {});
      } catch (_) {}
    }

    console.log('[PushNotify] init', {
      supported: isSupported(),
      iOS: detectIOS(),
      standalone: isStandalonePWA(),
      permission: Notification && Notification.permission,
    });

    if (!isSupported()) {
      // v1.4.11.5：bindToggleButton/syncButtonVisibility 已在 init() 顶部调用过，
      // 这里不能重复调用 bindToggleButton（会导致 click handler 绑定多次，点一次触发两次）。
      // 只需 setStatus 触发 pushnotify:change → render() 渲染「不支持」态。
      setStatus('unsupported');
      return;
    }

    // 异步检查现有订阅
    try {
      const reg = await getSWRegistration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        setStatus('subscribed');
        await sendSubscriptionToServer(sub);
      } else if (Notification && Notification.permission === 'granted') {
        // v1.4.11 修复（iOS PWA reload 后的恢复路径）:
        //   iOS 用户授权后立即 reload 一次 → 重新进入 init() 时 permission = granted
        //   但此时还没有 subscription（旧的失效/未完成）。自动完成 subscribe 流程，
        //   这样用户不需要再点一次按钮。
        console.log('[PushNotify] init 检测到 permission=granted 但无 subscription，自动 subscribe');
        try {
          const vapidKey = await getVapidKey();
          const newSub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
          });
          if (newSub) {
            await sendSubscriptionToServer(newSub);
            setStatus('subscribed');
            console.log('[PushNotify] 订阅成功（reload 恢复路径）');
          }
        } catch (e2) {
          console.warn('[PushNotify] reload 后自动 subscribe 失败:', e2 && e2.message);
        }
      }
      // 注意：Notification.permission === 'denied' 不再写状态，按钮保持「开启通知」
    } catch (e) {
      console.warn('[PushNotify] init 检查失败:', e);
    }

    // 不再监听首次手势自动触发 requestPermission
    // 只在用户主动点击按钮时才请求权限
    //
    // v1.4.11.5：syncButtonVisibility / bindToggleButton / startDebugBanner 已提前到 init() 顶部，
    // 这里不再重复调用。原因是：原位置在所有 await 之后，任意一个 await 卡住都会让
    // 按钮 click handler 不绑（用户感觉「按钮点不动」）、调试 banner 不显示。
  }

  // ============ 首页按钮 UI 绑定 ============
  // 按钮三态：
  // - default      → 🔔 开启通知（包含用户曾选「不允许」的情况，可再次点击触发）
  // - subscribed   → 🔕 关闭通知
  // - unsupported  → ⚠️ 不支持（disabled）
  // 已不再显示「禁止」态，按钮永远是「开启通知」除非已订阅或环境不支持
  function bindToggleButton() {
    const btn = document.getElementById('qa-push-toggle');
    if (!btn) return;

    function render() {
      const s = getStatus();

      btn.classList.remove('qa-subscribed', 'qa-denied', 'qa-unsupported');

      // 1. 浏览器不支持 Web Push
      if (!isSupported()) {
        btn.innerHTML = '<span class="qa-icon">⚠️</span><span class="qa-label">不支持</span>';
        btn.classList.add('qa-unsupported');
        btn.dataset.state = 'unsupported';
        btn.disabled = true;
        btn.title = '当前浏览器不支持 Web Push';
        return;
      }

      // 2. 已订阅（pushManager 有端点）
      if (s === 'subscribed') {
        btn.innerHTML = '<span class="qa-icon">🔕</span><span class="qa-label">关闭通知</span>';
        btn.classList.add('qa-subscribed');
        btn.dataset.state = 'subscribed';
        btn.disabled = false;
        btn.title = '点击关闭系统推送通知';
        return;
      }

      // 3. 默认：未订阅 / 未询问 / 曾被拒（统一态：保持开启通知）
      btn.innerHTML = '<span class="qa-icon">🔔</span><span class="qa-label">开启通知</span>';
      btn.dataset.state = 'default';
      btn.disabled = false;
      btn.title = '点击开启系统推送通知';
    }

    btn.addEventListener('click', function (e) {
      // v1.4.11.4 关键修复（iOS 17+ WebKit 严格用户手势规则 — 真正的修复）:
      //   之前的 v1.4.11.3 用 `async function` 包裹 click handler，但 `async function`
      //   本身就是异步的，无论后续代码看起来多"同步"，iOS WebKit 都视为「已超出
      //   用户手势窗口」，导致 requestPermission() 静默 deny。
      //   真正的修复：
      //   ① click handler 必须是**同步 function**（不能是 async）
      //   ② Notification.requestPermission() 必须**直接同步调用**
      //   ③ 用 .then() 链驱动后续异步订阅流程（用户手势已被同步调用捕获）
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      const state = btn.dataset.state;
      btn.disabled = true;

      // 取消订阅路径：可以直接调 async 函数（不需要用户手势）
      if (state === 'subscribed') {
        PushNotify.unsubscribe().then(function () { render(); }).catch(function (err) {
          console.warn('[PushNotify] 取消订阅失败:', err);
          render();
        });
        return;
      }

      // 每次点击都实时读取当前权限
      const currentPerm = (typeof Notification !== 'undefined' && Notification) ? Notification.permission : 'default';

      // v1.4.11.5 新增（iOS PWA 启动时序防御）:
      //   iOS WebKit 在 PWA 模式下若 Service Worker controller 还没 active，
      //   调用 Notification.requestPermission() 会被静默拒绝（不弹窗、不抛错，
      //   Promise 直接 resolve 成 'denied'），用户感觉「按钮无反应」。
      //   这里在 click handler 同步路径里做一次实时 SW controller 检查，
      //   iOS PWA 模式下 controller 缺失时给用户明确提示，而不是默默失败。
      //   注意：必须放在用户手势同步路径里执行，所以这里只是查 navigator.serviceWorker.controller
      //   同步属性 + 弹一个静态提示，没有 await。
      if (detectIOS() && isStandalonePWA() && 'serviceWorker' in navigator && !navigator.serviceWorker.controller) {
        console.warn('[PushNotify] iOS PWA SW controller 未就绪，主动提示用户稍候');
        showSWNotReadyHint();
        btn.disabled = false;
        return;
      }

      // 已永久拒绝
      if (currentPerm === 'denied') {
        console.warn('[PushNotify] 系统已永久拒绝，请引导用户去设置开启');
        showPermissionDeniedHint();
        btn.disabled = false;
        return;
      }

      // ⚠️ 核心：必须直接在 click handler 的同步路径里调用 Notification.requestPermission()
      //    不能用 await，不能用 async 函数包裹
      if (currentPerm === 'default') {
        console.log('[PushNotify] [iOS-safe v1.4.11.4] 同步调用 requestPermission...');
        // 直接调用，不 await
        const p = Notification.requestPermission();
        p.then(function (result) {
          // 这里已经是异步，但 iOS 已经从同步调用里捕获了用户手势
          console.log('[PushNotify] requestPermission 结果:', result);
          if (result !== 'granted') {
            setStatus('default');
            btn.disabled = false;
            render();
            return;
          }
          // granted：异步完成订阅（subscribe 不需要用户手势）
          PushNotify.completeSubscription().then(function () {
            btn.disabled = false;
            render();
          }).catch(function (err) {
            console.warn('[PushNotify] 订阅失败:', err);
            btn.disabled = false;
            render();
          });
        }, function (err) {
          console.warn('[PushNotify] requestPermission reject:', err);
          setStatus('default');
          btn.disabled = false;
          render();
        });
      } else {
        // currentPerm === 'granted'：直接异步订阅
        PushNotify.completeSubscription().then(function () {
          btn.disabled = false;
          render();
        }).catch(function (err) {
          console.warn('[PushNotify] 订阅失败:', err);
          btn.disabled = false;
          render();
        });
      }
    });

    document.addEventListener('pushnotify:change', render);
    setTimeout(render, 100);
    setInterval(render, 5000); // 兜底定时同步（防止事件漏发）

    // 监听页面 visibility 变化，回到前台时强制重渲染
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) render();
    });
  }

  // 暴露 API
  window.PushNotify = {
    requestPermission,
    completeSubscription,
    unsubscribe,
    toggle,
    getStatus,
    isSupported,
    isStandalonePWA,
    detectIOS,
    getServer: () => PUSH_SERVER,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();