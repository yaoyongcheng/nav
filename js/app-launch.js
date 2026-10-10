/**
 * main-9.4 / 外部 App 唤起模块（地图导航 / 应用商店）
 * ================================================
 * 首页 #qa-app-launch 按钮 → 底部浮层 → 唤起高德地图 / 应用商店。
 * 适配：苹果（Safari / PWA 独立模式）、华为（HarmonyOS 4 / 纯血 NEXT）、
 *       小米、vivo、OPPO，以及微信内（受限，走引导）。
 *
 * 设计依据（四条硬约束，改动前务必先读）：
 *
 * 1. 【用户手势铁律】scheme 赋值必须与 click 回调同步完成，不得 async/await/setTimeout，
 *    否则 iOS Safari / Chrome 会拦截。因此 launchById() 全链路同步。
 *
 * 2. 【成功信号】只用 visibilitychange(document.hidden===true) / pagehide 判定「已跳走」。
 *    ⚠️ 禁用 window.blur —— iOS 弹「在"高德地图"中打开？」系统框时窗口也会失焦，
 *    用 blur 会把「框刚弹出」误判为「已成功」，从而永远不触发兜底。
 *
 * 3. 【iOS 超时不自动跳转】系统框期间页面始终可见，定时器无法区分「用户没点」与
 *    「点了取消」。若超时即自动跳网页版，会出现「高德开着、页面也跑去了网页版」的双开。
 *    所以 iOS 超时只渲染兜底面板，把选择权还给用户；Android 无系统框，超时可自动跳 web。
 *
 * 4. 【微信内零尝试】微信内置浏览器（MicroMessenger）在 Native 层静默拦截 scheme，
 *    无公开白名单可申请 → 检出后直接给「右上角 → 在浏览器中打开」引导，不做无谓尝试。
 *
 * 另注：纯血鸿蒙 NEXT 无 Android 运行时，APK scheme（androidamap://）必然无响应，
 *       UA 识别后跳过 scheme 直接走兜底（华为 HarmonyOS 4 仍含 Android，正常走安卓路径）。
 *
 * 唤起协议与各厂商商店参数均经 2026-10 联网核实，见 CHANGELOG [v1.6.22] 与计划文档。
 * 仅新增目标时**只改本文件顶部的 APPS / TARGETS 配置区**，逻辑零改动。
 */
(function () {
  'use strict';

  // ============================================================
  // ============ 配置区（新增目标只改这里）=====================
  // ============================================================

  // 来源标识，写入高德 sourceApplication 参数（仅作标识，用 ASCII 更稳）
  var SOURCE_APP = 'site-nav';

  var APPS = {
    amap: {
      name: '高德地图',
      pkg: 'com.autonavi.minimap',      // Android 包名（intent:// 与商店查详情共用）
      itunesId: '461703208',            // App Store 数字 ID（2026-10 已核实）

      // 各环境首跳模板。{action} 位置的取值由 dest 决定：
      //   - 有坐标 → navi（直接发起导航）
      //   - 无坐标 → myLocation（打开「我的位置」）
      // dev=1 表示坐标未偏移（我们统一用 GCJ-02，理论上不需要 dev，但保留以兼容旧版高德）
      scheme: {
        ios: 'iosamap://navi?sourceApplication={src}&poiname={name}&lat={lat}&lon={lng}&dev=1&style=2',
        android: 'androidamap://navi?sourceApplication={src}&poiname={name}&lat={lat}&lon={lng}&dev=1&style=2',
        // Android Chromium 系用 intent:// —— 未装高德时由系统自动跳 S.browser_fallback_url，
        // 比定时器更早更准；定时器仅作第二层保险。
        intent: 'intent://navi?sourceApplication={src}&poiname={name}&lat={lat}&lon={lng}&dev=1&style=2'
          + '#Intent;scheme=androidamap;package={pkg};S.browser_fallback_url={fallback};end',

        // 无坐标时：打开 App 的「我的位置」（待真机验证，失败则落到 web 兜底）
        iosOpen: 'iosamap://myLocation?sourceApplication={src}',
        androidOpen: 'androidamap://myLocation?sourceApplication={src}',
        intentOpen: 'intent://myLocation?sourceApplication={src}'
          + '#Intent;scheme=androidamap;package={pkg};S.browser_fallback_url={fallback};end'
      },

      // 网页版兜底。⚠️ uri.amap.com 的 to 参数是「经度,纬度」——经度在前，最易写反。
      web: {
        dest: 'https://uri.amap.com/navigation?to={lng},{lat},{name}&mode=car&coordinate=gaode&callnative=0',
        noDest: 'https://www.amap.com/'
      },

      // 未安装时去哪个商店。查表顺序：精确平台 key → android（通用）→ _web
      // ⚠️ OPPO 的参数名是 packagename，不是 id（写错会跳不过去）
      store: {
        ios: {
          scheme: 'itms-apps://itunes.apple.com/app/id{itunesId}',
          web: 'https://apps.apple.com/cn/app/id{itunesId}'
        },
        'huawei-harmony': {
          scheme: 'appmarket://details?id={pkg}',
          web: 'https://appgallery.huawei.com/'
        },
        xiaomi: {
          scheme: 'mimarket://details?id={pkg}',
          web: 'https://app.mi.com/details?id={pkg}'
        },
        oppo: {
          scheme: 'oppomarket://details?packagename={pkg}',
          web: 'https://mobile.amap.com/'
        },
        vivo: {
          scheme: 'vivomarket://details?id={pkg}',
          web: 'https://mobile.amap.com/'
        },
        android: {
          // 通用协议会弹「应用选择器」让用户挑商店 —— 因此仅手动触发，不参与自动兜底
          scheme: 'market://details?id={pkg}',
          web: 'https://mobile.amap.com/'
        },
        _web: {
          scheme: '',
          web: 'https://mobile.amap.com/'
        }
      }
    }
    // 加新 App（如百度地图）：在此加一段同结构配置，然后在 TARGETS 里用 app:'key' 引用
  };

  // ⚠️ dest 坐标必须为 GCJ-02（火星坐标 / 高德坐标系）。填 WGS84 会偏移 50~500m。
  //    留 null 则仅打开高德，不带目的地；填入 { lat, lng, name } 后自动变为发起导航。
  var TARGETS = [
    {
      id: 'open-amap',
      kind: 'nav',            // nav = 地图类；store = 商店类
      app: 'amap',
      icon: '🧭',
      name: '打开高德地图',
      sub: '地图导航',
      dest: null              // 例：{ lat: 39.908722, lng: 116.397499, name: '工地大门' }
    },
    {
      id: 'install-amap',
      kind: 'store',
      app: 'amap',
      icon: '🗺️',
      name: '安装高德地图',
      sub: '应用商店'
    }
  ];

  // 平台提示文案（key 为 PWAInstall.getPlatform() 的枚举值）
  var HINTS = {
    'ios-safari': '将弹出「在高德地图中打开？」，请点「打开」',
    'ios-other': '将尝试打开高德地图；若没有反应，建议改用 Safari 打开本页',
    'huawei-harmony': '将打开高德地图；未安装可去华为应用市场',
    xiaomi: '将打开高德地图；未安装可去小米应用商店',
    oppo: '将打开高德地图；未安装可去 OPPO 软件商店',
    vivo: '将打开高德地图；未安装可去 vivo 应用商店',
    'in-app': '当前在应用内置浏览器中，跳转可能被拦截；建议在系统浏览器中打开',
    _default: '将尝试打开高德地图；未安装时可去应用商店下载'
  };

  // ============================================================
  // ============ 常量 / 状态 ===================================
  // ============================================================

  var ROOT_ID = 'al-root';
  var MASK_ID = 'al-mask';
  var SHEET_ID = 'al-sheet';
  var BODY_ID = 'al-body';

  var TIMEOUT_IOS = 3000;      // iOS 有系统框，给用户更多决策时间
  var TIMEOUT_ANDROID = 2500;

  // 视为移动端的平台枚举值（其余走桌面分支：新窗口打开网页版）
  var MOBILE_PLATFORMS = [
    'ios-safari', 'ios-other', 'xiaomi', 'oppo', 'vivo', 'huawei-harmony',
    'android-chrome', 'android-samsung', 'android-edge', 'android-firefox',
    'android-other', 'in-app'
  ];

  var state = {
    env: null,
    mode: 'app',          // 'app' | 'wechat' | 'desktop' | 'launching' | 'fallback'
    pending: null,        // { id, web, store, appName, kind, done, fallbackShown, timer, detach }
    fallback: null,       // { web, store, appName, kind }
    launchingName: '',    // 'launching' 视图显示的目标名
    sheetOpen: false
  };

  var _initialized = false;

  // ============================================================
  // ============ 日志 / 工具（项目约定：console 调用包 try/catch）===
  // ============================================================

  function log() {
    try { console.log.apply(console, ['[AppLaunch]'].concat(Array.prototype.slice.call(arguments))); } catch (_) {}
  }
  function warn() {
    try { console.warn.apply(console, ['[AppLaunch]'].concat(Array.prototype.slice.call(arguments))); } catch (_) {}
  }
  function errorLog() {
    try { console.error.apply(console, ['[AppLaunch]'].concat(Array.prototype.slice.call(arguments))); } catch (_) {}
  }

  // 项目约定：凡 innerHTML 拼接动态文本必须先转义（照抄 js/camera-capture.js:124-128）
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function hasDest(t) {
    return !!(t && t.dest && isFinite(t.dest.lat) && isFinite(t.dest.lng));
  }

  function findTarget(id) {
    for (var i = 0; i < TARGETS.length; i++) {
      if (TARGETS[i].id === id) return TARGETS[i];
    }
    return null;
  }

  function firstDest() {
    for (var i = 0; i < TARGETS.length; i++) {
      if (hasDest(TARGETS[i])) return TARGETS[i].dest;
    }
    return null;
  }

  // 坐标文本（lat,lng 顺序，方便直接粘贴到地图搜索框）
  function destText(dest) {
    return Number(dest.lat).toFixed(6) + ',' + Number(dest.lng).toFixed(6);
  }

  // ============================================================
  // ============ 环境检测 ======================================
  // ============================================================

  function detectPlatformSafe() {
    try {
      if (window.PWAInstall && typeof window.PWAInstall.getPlatform === 'function') {
        return window.PWAInstall.getPlatform();
      }
    } catch (_) {}
    return 'unknown';
  }

  function detectEnv() {
    var ua = '';
    try { ua = navigator.userAgent || ''; } catch (_) {}

    var platform = detectPlatformSafe();
    var isIOS = /iPad|iPhone|iPod/.test(ua) || platform.indexOf('ios-') === 0;

    // ⚠️ 必须自己判微信：pwa-install 的 'in-app' 把微信/QQ/企微混在一起
    //    （pwa-install.js:342 的 /MicroMessenger|MQQBrowser|\bQQ\/|wxwork/i）
    var isWeChat = /MicroMessenger/i.test(ua);
    var isInApp = platform === 'in-app';

    var isStandalone = false;
    try {
      isStandalone = (window.navigator.standalone === true) || !!(window.matchMedia &&
        (window.matchMedia('(display-mode: standalone)').matches ||
          window.matchMedia('(display-mode: fullscreen)').matches ||
          window.matchMedia('(display-mode: minimal-ui)').matches));
    } catch (_) {}

    // 纯血鸿蒙 NEXT：无 Android 运行时 → APK scheme 必然无响应
    var isHarmonyNext = /OpenHarmony/i.test(ua) ||
      (platform === 'huawei-harmony' && !/Android/i.test(ua));

    // Chromium 系：intent:// 可用（含五大 ROM 自带浏览器；鸿蒙 ArkWeb 亦为 Chromium 内核）
    var isChromium = false;
    try {
      isChromium = /Chrome|CriOS|EdgA|EdgiOS|SamsungBrowser|HuaweiBrowser|MiuiBrowser|MiBrowser|OppoBrowser|HeyTapBrowser|VivoBrowser|XiaomiBrowser/i.test(ua) &&
        !/Firefox|FxiOS/i.test(ua);
    } catch (_) {}

    var isMobile = MOBILE_PLATFORMS.indexOf(platform) >= 0 || isIOS || isInApp;

    return {
      platform: platform,
      isIOS: isIOS,
      isWeChat: isWeChat,
      isInApp: isInApp,
      isStandalone: isStandalone,
      isHarmonyNext: isHarmonyNext,
      isChromium: isChromium,
      isMobile: isMobile,
      isDesktop: !isMobile
    };
  }

  function resolveMode(env) {
    if (env.isWeChat) return 'wechat';
    if (env.isDesktop) return 'desktop';
    return 'app';
  }

  // ============================================================
  // ============ URL 构造 ======================================
  // ============================================================

  function fillTpl(tpl, vars) {
    if (!tpl) return '';
    return String(tpl).replace(/\{(\w+)\}/g, function (m, key) {
      if (key === 'fallback') {
        // 已整体编码（见 buildUrl），不能再 encode 一次，否则双重编码
        return vars.fallbackEncoded || '';
      }
      var v = vars[key];
      if (v === null || v === undefined || v === '') return '';
      return encodeURIComponent(String(v));
    });
  }

  function makeVars(target) {
    var app = APPS[target.app] || {};
    var dest = target.dest || {};
    var vars = {
      src: SOURCE_APP,
      name: dest.name || target.name || '',
      pkg: app.pkg || '',
      itunesId: app.itunesId || ''
    };
    if (hasDest(target)) {
      vars.lat = Number(dest.lat).toFixed(6);
      vars.lng = Number(dest.lng).toFixed(6);
    }
    return vars;
  }

  // 商店配置 key 解析：精确平台 → android（通用）→ _web
  function storeKeyFor(env) {
    if (env.isIOS) return 'ios';
    var p = env.platform;
    if (p === 'huawei-harmony') return 'huawei-harmony';
    if (p === 'xiaomi') return 'xiaomi';
    if (p === 'oppo') return 'oppo';
    if (p === 'vivo') return 'vivo';
    return 'android';
  }

  function storeEntry(app, env) {
    var key = storeKeyFor(env);
    return app.store[key] || app.store.android || app.store._web || { scheme: '', web: '' };
  }

  /**
   * 构造 URL。
   * @param {Object} target  TARGETS 中的一项
   * @param {Object} env     detectEnv() 结果
   * @param {String} phase   'scheme' 首跳 | 'web' 网页兜底 | 'store' 去商店
   * @returns {String} 空字符串表示该阶段无可用地址
   */
  function buildUrl(target, env, phase) {
    try {
      var app = APPS[target.app];
      if (!app) return '';
      phase = phase || 'scheme';

      if (target.kind === 'store') {
        if (env.isDesktop) return '';      // 桌面不跳商店
        var se = storeEntry(app, env);
        return fillTpl(phase === 'web' ? se.web : se.scheme, makeVars(target));
      }

      // nav 类
      if (phase === 'store') {
        if (env.isDesktop) return '';
        return fillTpl(storeEntry(app, env).scheme, makeVars(target));
      }

      if (phase === 'web') {
        var webTpl = hasDest(target) ? app.web.dest : app.web.noDest;
        return fillTpl(webTpl, makeVars(target));
      }

      // phase === 'scheme'
      if (env.isDesktop || env.isHarmonyNext) return '';   // 无可用 scheme，直接走兜底

      var vars = makeVars(target);
      // intent 模板需要预编码的 fallback（web 兜底），先算好塞进去
      vars.fallbackEncoded = encodeURIComponent(buildUrl(target, env, 'web'));

      var useDest = hasDest(target);
      var key;
      if (env.isIOS) key = useDest ? 'ios' : 'iosOpen';
      else if (env.isChromium) key = useDest ? 'intent' : 'intentOpen';
      else key = useDest ? 'android' : 'androidOpen';

      var url = fillTpl(app.scheme[key] || '', vars);
      // 防御：模板缺变量会留下空参数，若出现 undefined/NaN 视为构造失败
      if (/undefined|NaN/.test(url)) {
        warn('URL 含非法值，已丢弃:', url);
        return '';
      }
      return url;
    } catch (e) {
      errorLog('buildUrl 失败:', e);
      return '';
    }
  }

  // 渲染哪些卡片：至少有一种可用方式才渲染（避免死卡片）
  function targetsFor(env) {
    var out = [];
    try {
      for (var i = 0; i < TARGETS.length; i++) {
        var t = TARGETS[i];
        if (buildUrl(t, env, 'scheme') || buildUrl(t, env, 'web')) out.push(t);
      }
    } catch (e) { errorLog('targetsFor 失败:', e); }
    return out;
  }

  // ============================================================
  // ============ 唤起 / 超时检测 / 兜底 =========================
  // ============================================================

  function openExternal(url, newTab) {
    try {
      if (newTab) {
        window.open(url, '_blank');
        return;
      }

      // ⚠️ iOS PWA 独立模式（主屏幕图标启动）下，直接给 location.href 赋一个
      //    自定义 scheme 会被 WebKit 拒绝，并且**把当前 PWA 页面替换成
      //    「当前页面无法访问」错误页** —— PWA 没有地址栏/返回键，用户直接卡死。
      //    2026-10-10 真机实测复现（iPhone / 主屏幕图标 / weixin://）。
      //    对策：改用 <a target="_blank"> 点击，让这次导航发生在新浏览上下文里，
      //    失败也不破坏 PWA 本体；主页面存活后，2.5~3s 的超时兜底面板才可能显示。
      if (state.env && state.env.isIOS && state.env.isStandalone) {
        var a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.style.display = 'none';
        try {
          document.body.appendChild(a);
          a.click();
        } finally {
          setTimeout(function () { try { a.remove(); } catch (_) {} }, 1500);
        }
        return;
      }

      window.location.href = url;
    } catch (e) {
      errorLog('openExternal 失败:', e);
      try { window.location.href = url; } catch (_) {}
    }
  }

  function clearTimer(p) {
    if (p && p.timer) {
      try { clearTimeout(p.timer); } catch (_) {}
      p.timer = null;
    }
  }

  /**
   * 注册「是否已跳出」的观察者。
   * ⚠️ 只监听 visibilitychange / pagehide，**绝不用 window.blur**（见文件头约束 2）。
   * 注册监听本身不消耗用户手势，可以在 location.href 赋值之前调用。
   */
  function armLeaveWatch(p) {
    var onVisibility = function () {
      try {
        if (document.hidden) {
          // 页面转入后台 → 判定唤起成功，撤掉超时兜底
          p.done = true;
          clearTimer(p);
          log('页面转入后台，判定唤起成功:', p.id);
        } else if (p.done && state.sheetOpen) {
          // 从外部 App 返回 → 关掉残留浮层
          log('从外部 App 返回，自动关闭浮层');
          close();
        }
      } catch (_) {}
    };
    var onPageHide = function () {
      try {
        p.done = true;
        clearTimer(p);
      } catch (_) {}
    };
    p.detach = function () {
      try { document.removeEventListener('visibilitychange', onVisibility); } catch (_) {}
      try { window.removeEventListener('pagehide', onPageHide); } catch (_) {}
    };
    try {
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', onPageHide);
    } catch (_) {}
  }

  function detachWatch(p) {
    if (p && p.detach) {
      try { p.detach(); } catch (_) {}
      p.detach = null;
    }
  }

  function armTimeout(p, ms) {
    p.timer = setTimeout(function () {
      p.timer = null;
      onTimeout(p);
    }, ms);
  }

  function onTimeout(p) {
    if (state.pending !== p || p.done) return;   // 已成功或被新的唤起取代
    p.fallbackShown = true;
    detachWatch(p);

    var fb = { web: p.web, store: p.store, appName: p.appName, kind: p.kind };
    state.fallback = fb;

    if (state.env.isIOS) {
      // 约束 3：iOS 不自动跳转，只渲染兜底面板
      log('iOS 超时未跳出 → 渲染兜底面板（不自动跳转）');
      state.mode = 'fallback';
      render();
      toast('没有自动打开？试试下面的方式');
    } else {
      // Android 等：无系统框干扰，超时即真的没装/被拦 → 自动跳网页版
      if (p.web) {
        log('超时未跳出 → 自动打开网页版:', p.web);
        openExternal(p.web, false);
      } else {
        // 无网页版兜底 → 渲染兜底面板
        state.mode = 'fallback';
        render();
      }
    }
  }

  /**
   * 发起唤起。⚠️ 全链路同步 —— 见文件头约束 1，禁止改成 async/await。
   */
  function launchById(id) {
    var target = findTarget(id);
    if (!target) return;
    var env = state.env || detectEnv();

    // 连点保护：上一次唤起还没结论（既没跳出、也没超时）时忽略新点击，
    // 避免起两组定时器 / 连续两次 scheme 赋值。done 或已兜底则允许（用户可能想重试）。
    if (state.pending && !state.pending.done && !state.pending.fallbackShown) {
      log('已有进行中的唤起，忽略本次点击');
      return;
    }

    var schemeUrl = buildUrl(target, env, 'scheme');
    var webUrl = buildUrl(target, env, 'web');
    var storeUrl = buildUrl(target, env, 'store');

    // 微信内：零 scheme 尝试，直接同页导航到 https 网页版（微信内可开）
    if (state.mode === 'wechat') {
      if (webUrl) openExternal(webUrl, false);
      else toast('当前环境无法直接打开，请复制坐标后到地图 App 搜索');
      return;
    }

    // 桌面：新窗口打开网页版（同步手势内 window.open 才不会被弹窗拦截）
    if (state.mode === 'desktop') {
      if (webUrl) openExternal(webUrl, true);
      else toast('暂无可用的网页版入口');
      return;
    }

    var appName = (APPS[target.app] || {}).name || '目标应用';

    // 无可用 scheme（纯血鸿蒙等）→ 直接兜底面板
    if (!schemeUrl) {
      state.fallback = { web: webUrl, store: storeUrl, appName: appName, kind: target.kind };
      state.mode = 'fallback';
      render();
      return;
    }

    var p = {
      id: id, web: webUrl, store: storeUrl, appName: appName, kind: target.kind,
      done: false, fallbackShown: false, timer: null, detach: null
    };
    state.pending = p;

    armLeaveWatch(p);                  // ① 先注册观察者（非触发，不消耗手势）
    openExternal(schemeUrl, false);    // ② ⚡ 同步跳转 —— 正在用户手势窗口内

    // 切到「正在打开」视图（浮层未打开时写入隐藏容器，无副作用）
    state.mode = 'launching';
    state.launchingName = target.name || appName;
    render();

    toast('正在打开…');
    armTimeout(p, env.isIOS ? TIMEOUT_IOS : TIMEOUT_ANDROID);   // ③ 起兜底定时器
  }

  // ============================================================
  // ============ 复制坐标 ======================================
  // ============================================================

  function copyText(text) {
    var done = function () { toast('已复制：' + text); };
    var fail = function () {
      toast('复制失败，请长按下方坐标手动复制');
      var body = document.getElementById(BODY_ID);
      if (body && body.innerHTML.indexOf('al-coord') < 0) {
        try {
          body.insertAdjacentHTML('beforeend',
            '<span class="al-coord">' + escapeHtml(text) + '</span>');
        } catch (_) {}
      }
    };
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done, fail); });
        return;
      }
    } catch (_) {}
    legacyCopy(text, done, fail);
  }

  function legacyCopy(text, done, fail) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      try { ta.setSelectionRange(0, text.length); } catch (_) {}
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) done(); else fail();
    } catch (e) {
      fail();
    }
  }

  // ============================================================
  // ============ Toast =========================================
  // ============================================================

  function toast(text) {
    try {
      var t = document.createElement('div');
      t.className = 'al-toast';
      t.textContent = text;
      document.body.appendChild(t);
      setTimeout(function () { try { t.remove(); } catch (_) {} }, 1800);
    } catch (_) {}
  }

  // ============================================================
  // ============ 浮层 DOM（幂等注入，照 js/camera-capture.js:250-310）===
  // ============================================================

  function ensureSheet() {
    var existing = document.getElementById(ROOT_ID);
    if (existing) return existing;

    var root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = ''
      + '<div class="al-mask" id="' + MASK_ID + '"></div>'
      + '<div class="al-sheet" id="' + SHEET_ID + '" role="dialog" aria-modal="true">'
      +   '<button type="button" class="al-close" data-al-act="close" aria-label="关闭">✕</button>'
      +   '<div class="al-sheet-inner">'
      +     '<div id="' + BODY_ID + '"></div>'
      +   '</div>'
      + '</div>';

    // 事件委托绑在根节点：render() 重写 innerHTML 不会丢事件（照 camera-capture.js:269-271）
    root.addEventListener('click', onRootClick);

    try {
      document.body.appendChild(root);
    } catch (e) {
      errorLog('appendChild 失败:', e);
      return null;
    }
    return root;
  }

  function openSheetDom() {
    var mask = document.getElementById(MASK_ID);
    var sheet = document.getElementById(SHEET_ID);
    if (!mask || !sheet) return;
    // 双 rAF 等 layout 后再加 is-open，让 CSS 动画真正触发（项目既有写法，非 rAF 循环）
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        try {
          mask.classList.add('is-open');
          sheet.classList.add('is-open');
        } catch (_) {}
      });
    });
  }

  function closeSheetDom() {
    var mask = document.getElementById(MASK_ID);
    var sheet = document.getElementById(SHEET_ID);
    try {
      if (mask) mask.classList.remove('is-open');
      if (sheet) sheet.classList.remove('is-open');
    } catch (_) {}
  }

  // ============================================================
  // ============ 渲染 ==========================================
  // ============================================================

  function render() {
    var body = document.getElementById(BODY_ID);
    if (!body) return;
    var html = '';
    try {
      if (state.mode === 'wechat') html = renderWechat();
      else if (state.mode === 'fallback') html = renderFallback();
      else if (state.mode === 'launching') html = renderLaunching();
      else html = renderMain();
    } catch (e) {
      errorLog('render 失败:', e);
      html = '<h2 class="al-title">地图导航</h2><p class="al-hint">页面初始化异常，请稍后重试。</p>';
    }
    try { body.innerHTML = html; } catch (e2) { errorLog('写入浮层失败:', e2); }
  }

  function cardHtml(t) {
    return '<button type="button" class="al-action" data-al-act="launch" data-al-id="' + escapeHtml(t.id) + '">'
      + '<span class="al-action-icon">' + escapeHtml(t.icon) + '</span>'
      + '<span class="al-action-label">' + escapeHtml(t.name) + '</span>'
      + '<span class="al-action-sub">' + escapeHtml(t.sub) + '</span>'
      + '</button>';
  }

  function renderMain() {
    var env = state.env || detectEnv();
    var targets = targetsFor(env);
    var hint = HINTS[env.platform] || HINTS._default;
    if (state.mode === 'desktop') hint = '桌面端将打开网页版地图';

    if (!targets.length) {
      return '<h2 class="al-title">打开应用</h2>'
        + '<p class="al-hint al-hint-warn">当前环境暂不支持打开外部应用，请在手机浏览器中重试。</p>';
    }

    var cards = '';
    for (var i = 0; i < targets.length; i++) cards += cardHtml(targets[i]);

    return '<h2 class="al-title">打开应用</h2>'
      + '<p class="al-hint">' + escapeHtml(hint) + '</p>'
      + '<div class="al-actions">' + cards + '</div>';
  }

  function renderLaunching() {
    var name = state.launchingName || '目标应用';
    return '<h2 class="al-title">正在打开…</h2>'
      + '<p class="al-hint">正在尝试唤起「' + escapeHtml(name) + '」。'
      + '若几秒内没有反应，会自动显示其他打开方式。</p>';
  }

  function renderFallback() {
    var fb = state.fallback || {};
    var appName = fb.appName || '目标应用';
    var dest = firstDest();
    var html = '<h2 class="al-title">没有自动打开？</h2>'
      + '<p class="al-hint">可能未安装' + escapeHtml(appName) + '，或系统拦截了跳转。试试下面的方式：</p>'
      + '<div class="al-btns">';
    if (fb.web) {
      html += '<button type="button" class="al-btn al-btn-primary" data-al-act="web">用网页版打开</button>';
    }
    if (fb.store) {
      html += '<button type="button" class="al-btn" data-al-act="store">去应用商店安装' + escapeHtml(appName) + '</button>';
    }
    if (dest) {
      html += '<button type="button" class="al-btn" data-al-act="copy">复制坐标（可粘贴到地图搜索框）</button>';
    }
    html += '</div>'
      + '<p class="al-footnote">也可以关闭本浮层后重试，或确认手机已安装' + escapeHtml(appName) + '。</p>';
    return html;
  }

  function renderWechat() {
    var env = state.env || detectEnv();
    var webUrl = '';
    for (var i = 0; i < TARGETS.length; i++) {
      if (TARGETS[i].kind === 'nav') { webUrl = buildUrl(TARGETS[i], env, 'web'); break; }
    }
    var dest = firstDest();
    return '<h2 class="al-title">请在浏览器中打开</h2>'
      + '<div class="al-steps">微信内置浏览器会拦截外部应用跳转（微信官方限制）：<br>'
      +   '1. 点右上角 <b>⋯</b><br>'
      +   '2. 选择「在浏览器中打开」<br>'
      +   '3. 在打开的页面里再点本按钮</div>'
      + '<div class="al-btns">'
      +   (webUrl ? '<button type="button" class="al-btn al-btn-primary" data-al-act="web">先用网页版导航</button>' : '')
      +   (dest ? '<button type="button" class="al-btn" data-al-act="copy">复制坐标（可粘贴到地图搜索框）</button>' : '')
      + '</div>';
  }

  // ============================================================
  // ============ 事件分发 ======================================
  // ============================================================

  function onRootClick(e) {
    var node = e.target;
    // closest 在极老内核可能缺失，降级为向上遍历（照 camera-capture.js:1273-1284）
    var btn = null;
    if (node && node.closest) {
      btn = node.closest('[data-al-act]');
    } else {
      while (node && node !== this) {
        if (node.getAttribute && node.getAttribute('data-al-act')) { btn = node; break; }
        node = node.parentNode;
      }
    }
    if (!btn || btn.disabled) return;

    var act = btn.getAttribute('data-al-act');
    try { e.preventDefault(); } catch (_) {}
    try { e.stopPropagation(); } catch (_) {}

    // ⚠️ 本分发必须保持同步：'launch'/'web'/'store' 分支会一路同步走到
    //    location.href —— 绝不能改成 async / 加 await（文件头约束 1）。
    switch (act) {
      case 'launch':
        launchById(btn.getAttribute('data-al-id'));
        break;
      case 'web':
        gotoWeb();
        break;
      case 'store':
        gotoStore();
        break;
      case 'copy':
        doCopy();
        break;
      case 'retry':
        retry();
        break;
      case 'close':
        close();
        break;
      default: break;
    }
  }

  function gotoWeb() {
    var url = (state.fallback && state.fallback.web) || '';
    if (!url) {
      var env = state.env || detectEnv();
      for (var i = 0; i < TARGETS.length; i++) {
        if (TARGETS[i].kind === 'nav') { url = buildUrl(TARGETS[i], env, 'web'); break; }
      }
    }
    if (url) openExternal(url, state.mode === 'desktop');
    else toast('暂无网页版入口');
  }

  function gotoStore() {
    var url = (state.fallback && state.fallback.store) || '';
    var env = state.env || detectEnv();
    if (url) { openExternal(url, false); return; }
    for (var i = 0; i < TARGETS.length; i++) {
      if (TARGETS[i].kind === 'store') {
        url = buildUrl(TARGETS[i], env, 'scheme');
        break;
      }
    }
    if (url) openExternal(url, false);
    else toast('当前环境无法打开应用商店');
  }

  function doCopy() {
    var dest = firstDest();
    if (!dest) { toast('当前没有可复制的坐标'); return; }
    copyText(destText(dest));
  }

  function retry() {
    state.mode = state.env && state.env.isDesktop ? 'desktop' : 'app';
    state.fallback = null;
    state.pending = null;
    render();
  }

  // ============================================================
  // ============ 生命周期 ======================================
  // ============================================================

  /**
   * 打开浮层。
   * @param {String} [autoLaunchId] 可选：打开后立即对指定目标发起唤起
   *        （由 click 回调直接调用，全程同步 → 仍在用户手势窗口内，见文件头约束 1）
   */
  function open(autoLaunchId) {
    if (state.sheetOpen) {
      if (autoLaunchId) launchById(autoLaunchId);   // 浮层已开：直接发起
      return;
    }
    try {
      // 撞层防御：收掉 pwa-install 的自动安装引导（z-index 9999/10000 < 本浮层 10004/10005）
      // 照 js/camera-capture.js:1382-1390 的先例
      if (window.PWAInstall && typeof window.PWAInstall.dismissGuide === 'function') {
        window.PWAInstall.dismissGuide();
      }
    } catch (_) {}

    state.env = detectEnv();
    state.mode = resolveMode(state.env);
    state.fallback = null;
    state.pending = null;

    var root = ensureSheet();
    if (!root) return;

    render();
    openSheetDom();
    state.sheetOpen = true;
    log('opened; platform=' + state.env.platform +
      '; wechat=' + state.env.isWeChat +
      '; standalone=' + state.env.isStandalone +
      '; harmonyNext=' + state.env.isHarmonyNext +
      '; mode=' + state.mode);

    // 指定目标则立即发起唤起 —— 全程同步，仍在调用方（click 回调）的手势窗口内
    if (autoLaunchId) launchById(autoLaunchId);
  }

  function close() {
    try {
      if (state.pending) {
        clearTimer(state.pending);
        detachWatch(state.pending);
        state.pending = null;
      }
      closeSheetDom();
      state.sheetOpen = false;
      state.mode = 'app';
      state.fallback = null;
    } catch (e) { errorLog('close 失败:', e); }
  }

  function init() {
    if (_initialized) return;
    _initialized = true;
    try {
      state.env = detectEnv();
      log('loaded; platform=' + state.env.platform +
        '; wechat=' + state.env.isWeChat +
        '; standalone=' + state.env.isStandalone);
    } catch (e) { errorLog('init 失败:', e); }
  }

  // ============================================================
  // ============ 对外 API ======================================
  // ============================================================

  window.AppLaunch = {
    open: open,
    close: close,
    getEnv: function () { try { return detectEnv(); } catch (_) { return null; } },
    getTargets: function () { try { return targetsFor(detectEnv()); } catch (_) { return []; } },
    buildUrl: function (target, env, phase) {
      try { return buildUrl(target, env || detectEnv(), phase || 'scheme'); } catch (_) { return ''; }
    }
  };

  // 三态启动（项目既有写法，照 camera-capture.js:1429-1433）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
