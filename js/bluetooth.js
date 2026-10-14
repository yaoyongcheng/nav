/**
 * 蓝牙连接模块（Web Bluetooth）
 * ============================================================
 * 首页快捷入口 #qa-bluetooth → window.BluetoothPanel.open()
 *
 * ⚠️ 平台能力真相（2026-10-14 查证，勿改文案为「已适配」）：
 *   - iOS 全系（含 Safari / Chrome / 微信）WebKit 未实现 navigator.bluetooth
 *     → 物理上无法调用，非版本或设置问题
 *   - 华为浏览器 / 鸿蒙 ArkWeb 未开放该接口
 *   - 微信内置浏览器为 Android WebView 内核，WebView 不支持 Web Bluetooth
 *   - 小米 / vivo / OPPO 自带浏览器结果取决于其内核是否为完整 Chromium
 *   → 本模块策略：能力检测优先，能用的真能用，不能用的一律给出**准确原因 +
 *     可操作引导**，绝不出现「点了没反应」的假装适配。
 *
 * 纯 API 模块：无副作用，不自动绑定 click（已在 js/login.js 的
 * initQuickActions() 内单点绑定，照 #qa-camera / #qa-app-launch 约定）。
 */
(function () {
  'use strict';

  var ROOT_ID = 'bt-root';
  var MASK_ID = 'bt-mask';
  var SHEET_ID = 'bt-sheet';
  var BODY_ID = 'bt-body';

  // 设备选择器若在此时限内既未弹出、也未返回错误 → 判定为静默失败
  // （Android standalone PWA 已知问题：无列表、无报错、无日志）
  var SILENT_FAIL_MS = 3000;

  var state = {
    sheetOpen: false,
    phase: 'idle',        // idle | pairing | connected | error
    device: null,
    server: null,
    errorMsg: '',
    env: null
  };

  var _initialized = false;

  // ============================================================
  // ============ 日志（Q2：异常路径必须留痕）====================
  // ============================================================
  var TAG = '[bluetooth]';
  function log() {
    try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch (_) {}
  }
  function warn() {
    try { console.warn.apply(console, [TAG].concat([].slice.call(arguments))); } catch (_) {}
  }
  function errorLog() {
    try { console.error.apply(console, [TAG].concat([].slice.call(arguments))); } catch (_) {}
  }

  // ============================================================
  // ============ 工具 ==========================================
  // ============================================================
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function $(id) { return document.getElementById(id); }

  /**
   * 平台环境识别。
   * 注意：这里的判断只用于**选择引导文案**，不参与「能否用蓝牙」的判定
   * —— 可用性一律以 navigator.bluetooth 实际存在为准（避免误判）。
   */
  function detectEnv() {
    var ua = '';
    try { ua = navigator.userAgent || ''; } catch (_) { ua = ''; }

    var isIOS = /iPhone|iPad|iPod/i.test(ua) ||
                (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
    var isHarmony = /HarmonyOS|ArkWeb|OpenHarmony/i.test(ua);
    var isWeChat = /MicroMessenger/i.test(ua);
    var isHuaweiBrowser = /HuaweiBrowser/i.test(ua) || /Huawei/i.test(ua);
    var isXiaomi = /MiuiBrowser|XiaoMi|MiBrowser/i.test(ua);
    var isVivo = /VivoBrowser|vivo/i.test(ua);
    var isOppo = /OppoBrowser|OPPO|HeyTap/i.test(ua);
    var isUC = /UCBrowser|UCWEB/i.test(ua);
    var isBaidu = /baidubrowser|BIDUBrowser/i.test(ua);
    var isQQ = !isWeChat && /QQBrowser|MQQBrowser/i.test(ua);
    var isEdge = /EdgA?\//.test(ua);
    var isChrome = !isEdge && /Chrome\//.test(ua);

    // 运行模式（standalone 下设备选择器有静默失败的已知案例）
    var standalone = false;
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) standalone = true;
      else if (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) standalone = true;
      else if (window.matchMedia && window.matchMedia('(display-mode: minimal-ui)').matches) standalone = true;
      else if (navigator.standalone === true) standalone = true;
    } catch (_) {}

    // 唯一权威判据
    var hasAPI = false;
    try { hasAPI = ('bluetooth' in navigator) && !!navigator.bluetooth; } catch (_) { hasAPI = false; }

    var secure = false;
    try { secure = window.isSecureContext === true; } catch (_) {}

    var platform = 'other';
    if (isIOS) platform = 'ios';
    else if (isHarmony) platform = 'harmony';
    else if (isWeChat) platform = 'wechat';
    else if (isHuaweiBrowser) platform = 'huawei';
    else if (isXiaomi) platform = 'xiaomi';
    else if (isVivo) platform = 'vivo';
    else if (isOppo) platform = 'oppo';
    else if (isQQ) platform = 'qq';
    else if (isUC) platform = 'uc';
    else if (isBaidu) platform = 'baidu';
    else if (isEdge) platform = 'edge';
    else if (isChrome) platform = 'chrome';

    return {
      platform: platform,
      isIOS: isIOS,
      isHarmony: isHarmony,
      isWeChat: isWeChat,
      isHuaweiBrowser: isHuaweiBrowser,
      isXiaomi: isXiaomi,
      isVivo: isVivo,
      isOppo: isOppo,
      isQQ: isQQ,
      isUC: isUC,
      isBaidu: isBaidu,
      isEdge: isEdge,
      isChrome: isChrome,
      vendorName: vendorName(platform),
      standalone: standalone,
      hasAPI: hasAPI,
      secure: secure,
      ua: ua
    };
  }

  function vendorName(platform) {
    switch (platform) {
      case 'ios': return '苹果 iOS';
      case 'harmony': return '华为鸿蒙';
      case 'huawei': return '华为浏览器';
      case 'xiaomi': return '小米浏览器';
      case 'vivo': return 'vivo 浏览器';
      case 'oppo': return 'OPPO 浏览器';
      case 'wechat': return '微信内置浏览器';
      case 'qq': return 'QQ 浏览器';
      case 'uc': return 'UC 浏览器';
      case 'baidu': return '百度浏览器';
      case 'edge': return 'Edge 浏览器';
      case 'chrome': return 'Chrome 浏览器';
      default: return '当前浏览器';
    }
  }

  /**
   * 不支持时的引导文案。
   * ⚠️ 全部基于 2026-10-14 的实际查证结论，**不得改写为模糊话术**：
   *    用户需要知道是「系统层面封死」还是「换个浏览器就行」。
   */
  function guidanceFor(env) {
    if (env.isIOS) {
      return {
        title: 'iOS 无法调用蓝牙',
        reason: 'iOS 系统没有向浏览器开放蓝牙接口（Web Bluetooth）。iPhone 上所有浏览器 —— Safari、Chrome、微信 —— 都强制使用 WebKit 内核，换浏览器同样无效。',
        action: '这不是版本或设置问题，无法通过升级系统解决。请改用 Android 设备操作。'
      };
    }
    if (env.platform === 'harmony') {
      return {
        title: '鸿蒙系统无法调用蓝牙',
        reason: '鸿蒙（ArkWeb 内核）未开放网页蓝牙接口。',
        action: '请改用 Android 设备，或使用支持该能力的 Chromium 浏览器。'
      };
    }
    if (env.platform === 'huawei') {
      return {
        title: '华为浏览器无法调用蓝牙',
        reason: '华为浏览器未开放网页蓝牙接口（Web Bluetooth），当前也不支持升级解决。',
        action: '可尝试改用 UC 或百度浏览器打开本页；若仍不可用，请改用 Android 设备。'
      };
    }
    if (env.isWeChat) {
      return {
        title: '微信内无法调用蓝牙',
        reason: '微信内置浏览器使用 Android WebView 内核，而 WebView 不支持网页蓝牙接口。',
        action: '请点击右上角「···」→「在浏览器打开」，用系统浏览器访问本页后重试。'
      };
    }
    if (env.platform === 'qq') {
      return {
        title: 'QQ 浏览器无法调用蓝牙',
        reason: 'QQ 浏览器未实现网页蓝牙接口（Web Bluetooth）。',
        action: '请改用 Chrome 浏览器打开本页。'
      };
    }
    return {
      title: '当前浏览器无法调用蓝牙',
      reason: vendorName(env.platform) + '未开放网页蓝牙接口（Web Bluetooth），可能是内核为 WebView 或该能力被裁剪。',
      action: '建议改用 Chrome 浏览器打开本页后重试。'
    };
  }

  // ============================================================
  // ============ 浮层 DOM（幂等注入，照 js/app-launch.js:644）===
  // ============================================================

  function ensureSheet() {
    var existing = $(ROOT_ID);
    if (existing) return existing;

    var root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = ''
      + '<div class="bt-mask" id="' + MASK_ID + '"></div>'
      + '<div class="bt-sheet" id="' + SHEET_ID + '" role="dialog" aria-modal="true">'
      +   '<button type="button" class="bt-close" data-bt-act="close" aria-label="关闭">✕</button>'
      +   '<div class="bt-sheet-inner">'
      +     '<div id="' + BODY_ID + '"></div>'
      +   '</div>'
      + '</div>';

    // 事件委托绑在根节点：render() 重写 innerHTML 不会丢事件（C3 / 照 app-launch.js:660）
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
    var mask = $(MASK_ID);
    var sheet = $(SHEET_ID);
    if (!mask || !sheet) return;
    // 双 rAF 等 layout 后再加 is-open，让 CSS 动画真正触发（项目既有写法）
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
    var mask = $(MASK_ID);
    var sheet = $(SHEET_ID);
    try {
      if (mask) mask.classList.remove('is-open');
      if (sheet) sheet.classList.remove('is-open');
    } catch (_) {}
  }

  // ============================================================
  // ============ 渲染 ==========================================
  // ============================================================

  function render() {
    var body = $(BODY_ID);
    if (!body) return;
    var html = '';
    try {
      var env = state.env || detectEnv();
      if (!env.hasAPI) {
        html = renderUnsupported(env);
      } else if (state.phase === 'pairing') {
        html = renderPairing();
      } else if (state.phase === 'connected') {
        html = renderConnected();
      } else if (state.phase === 'error') {
        html = renderError();
      } else {
        html = renderReady(env);
      }
    } catch (e) {
      errorLog('render 失败:', e);
      html = '<h2 class="bt-title">蓝牙</h2><p class="bt-hint">页面初始化异常，请关闭后重试。</p>';
    }
    try { body.innerHTML = html; } catch (e2) { errorLog('写入浮层失败:', e2); }
  }

  function metaRows(env) {
    return ''
      + '<div class="bt-meta">'
      +   '<div class="bt-meta-row"><span>设备</span><b>' + escapeHtml(env.vendorName) + '</b></div>'
      +   '<div class="bt-meta-row"><span>运行模式</span><b>' + (env.standalone ? '桌面图标（独立窗口）' : '浏览器内') + '</b></div>'
      +   '<div class="bt-meta-row"><span>蓝牙接口</span><b class="' + (env.hasAPI ? 'bt-ok' : 'bt-no') + '">'
      +     (env.hasAPI ? '可用' : '不可用') + '</b></div>'
      + '</div>';
  }

  /** 不支持：给出准确原因 + 可操作引导（不做模糊话术） */
  function renderUnsupported(env) {
    var g = guidanceFor(env);
    return ''
      + '<h2 class="bt-title">蓝牙</h2>'
      + '<div class="bt-status bt-status-no">'
      +   '<span class="bt-status-icon">🚫</span>'
      +   '<span class="bt-status-text">' + escapeHtml(g.title) + '</span>'
      + '</div>'
      + '<p class="bt-hint bt-hint-warn">' + escapeHtml(g.reason) + '</p>'
      + '<p class="bt-hint">' + escapeHtml(g.action) + '</p>'
      + metaRows(env)
      + '<div class="bt-btns">'
      +   '<button type="button" class="bt-btn" data-bt-act="close">知道了</button>'
      + '</div>';
  }

  /** 可用：待配对 */
  function renderReady(env) {
    return ''
      + '<h2 class="bt-title">蓝牙</h2>'
      + '<div class="bt-status bt-status-ok">'
      +   '<span class="bt-status-icon">📶</span>'
      +   '<span class="bt-status-text">蓝牙可用</span>'
      + '</div>'
      + '<p class="bt-hint">点击下方按钮后，系统会弹出附近蓝牙设备列表，选择要连接的设备即可。</p>'
      + metaRows(env)
      + '<div class="bt-btns">'
      +   '<button type="button" class="bt-btn bt-btn-primary" data-bt-act="pair">开启并连接设备</button>'
      + '</div>'
      + '<p class="bt-footnote">⚠️ 浏览器蓝牙仅在页面处于前台时保持连接，锁屏或切到后台会断开，返回本页后可重新连接。</p>';
  }

  function renderPairing() {
    return ''
      + '<h2 class="bt-title">蓝牙</h2>'
      + '<div class="bt-status bt-status-wait">'
      +   '<span class="bt-status-icon">⏳</span>'
      +   '<span class="bt-status-text">等待选择设备…</span>'
      + '</div>'
      + '<p class="bt-hint">请在弹出的设备列表中选择目标设备。</p>'
      + '<div class="bt-btns">'
      +   '<button type="button" class="bt-btn" data-bt-act="close">取消</button>'
      + '</div>';
  }

  function renderConnected() {
    var d = state.device;
    var name = (d && d.name) ? d.name : '未命名设备';
    var connected = false;
    try { connected = !!(d && d.gatt && d.gatt.connected); } catch (_) {}
    return ''
      + '<h2 class="bt-title">蓝牙</h2>'
      + '<div class="bt-status bt-status-ok">'
      +   '<span class="bt-status-icon">✅</span>'
      +   '<span class="bt-status-text">' + (connected ? '已连接' : '已选择设备') + '</span>'
      + '</div>'
      + '<div class="bt-device">'
      +   '<div class="bt-device-name">' + escapeHtml(name) + '</div>'
      +   '<div class="bt-device-id">ID: ' + escapeHtml(d && d.id ? d.id : '-') + '</div>'
      + '</div>'
      + '<div class="bt-btns">'
      +   (connected
            ? '<button type="button" class="bt-btn" data-bt-act="disconnect">断开连接</button>'
            : '<button type="button" class="bt-btn bt-btn-primary" data-bt-act="reconnect">重新连接</button>')
      +   '<button type="button" class="bt-btn" data-bt-act="close">关闭</button>'
      + '</div>'
      + '<p class="bt-footnote">⚠️ 锁屏或切到后台会断开，返回本页后可重新连接。</p>';
  }

  function renderError() {
    return ''
      + '<h2 class="bt-title">蓝牙</h2>'
      + '<div class="bt-status bt-status-no">'
      +   '<span class="bt-status-icon">⚠️</span>'
      +   '<span class="bt-status-text">连接未完成</span>'
      + '</div>'
      + '<p class="bt-hint bt-hint-warn">' + escapeHtml(state.errorMsg || '未知错误') + '</p>'
      + '<div class="bt-btns">'
      +   '<button type="button" class="bt-btn bt-btn-primary" data-bt-act="pair">重试</button>'
      +   '<button type="button" class="bt-btn" data-bt-act="close">关闭</button>'
      + '</div>';
  }

  // ============================================================
  // ============ 蓝牙操作 ======================================
  // ============================================================

  /** 错误码 → 用户可读文案。区分「用户取消」与「真失败」。 */
  function explainError(err) {
    var n = (err && err.name) || '';
    var m = (err && err.message) || '';
    if (n === 'NotFoundError') {
      // 选择器弹出后被取消 —— 这恰恰说明接口是通的
      if (/cancel|chooser/i.test(m)) return '已取消选择设备。';
      return '未找到可用的蓝牙设备。请确认设备已开机、处于可被发现状态，并靠近手机后重试。';
    }
    if (n === 'SecurityError') return '蓝牙权限被拒绝。请在浏览器设置中允许本页面使用蓝牙（「附近设备」权限）。';
    if (n === 'NotSupportedError') return '当前浏览器未实现该蓝牙能力，请改用 Chrome 打开。';
    if (n === 'InvalidStateError') return '已有蓝牙弹窗未关闭，请关闭后重试。';
    if (n === 'NetworkError') return '设备连接被中断（GATT 服务器不可用）。请重新选择设备。';
    if (n === 'AbortError') return '操作被中断，请重试。';
    return '连接失败：' + (n || '未知错误') + (m ? '（' + m + '）' : '');
  }

  function startPair() {
    var env = state.env || detectEnv();
    if (!env.hasAPI) {
      warn('requestDevice 不可用，环境不支持蓝牙');
      render();
      return;
    }

    state.phase = 'pairing';
    state.errorMsg = '';
    render();

    var settled = false;
    var silentTimer = null;

    // 静默失败检测：既没弹窗也没报错（Android standalone PWA 已知问题）
    var lostFocus = false;
    function markFocusLost() { lostFocus = true; }
    try {
      window.addEventListener('blur', markFocusLost);
      document.addEventListener('visibilitychange', onVisChange);
    } catch (_) {}
    function onVisChange() { if (document.hidden) lostFocus = true; }
    function cleanup() {
      settled = true;
      if (silentTimer) { clearTimeout(silentTimer); silentTimer = null; }
      try {
        window.removeEventListener('blur', markFocusLost);
        document.removeEventListener('visibilitychange', onVisChange);
      } catch (_) {}
    }

    silentTimer = setTimeout(function () {
      if (settled || lostFocus) return;
      cleanup();
      state.phase = 'error';
      state.errorMsg = '未弹出设备选择器，也未返回错误。该浏览器的蓝牙功能可能存在兼容问题，可尝试在浏览器设置中重置「附近设备」权限后重试。';
      errorLog('静默失败：requestDevice 未弹出选择器');
      render();
    }, SILENT_FAIL_MS);

    try {
      navigator.bluetooth.requestDevice({ acceptAllDevices: true })
        .then(function (device) {
          if (settled) return;
          cleanup();
          state.device = device;
          try {
            device.addEventListener('gattserverdisconnected', onGattDisconnected);
          } catch (e) { warn('绑定断开监听失败:', e); }
          log('已选择设备:', device && device.name, device && device.id);
          // 选中后尝试建立 GATT 连接；连不上也不算失败（部分设备仅广播不可连）
          return device.gatt.connect().then(function (server) {
            state.server = server;
            log('GATT 已连接');
            return true;
          }).catch(function (ge) {
            warn('GATT 连接失败（设备可能仅广播不连接）:', ge && ge.name);
            return false;
          });
        })
        .then(function () {
          if (settled && state.phase !== 'pairing') return;
          state.phase = 'connected';
          render();
        })
        .catch(function (err) {
          if (settled) return;
          cleanup();
          state.phase = 'error';
          state.errorMsg = explainError(err);
          warn('requestDevice 失败:', err && err.name, err && err.message);
          render();
        });
    } catch (e) {
      // 同步抛错（极少数老内核）：必须兜底，否则按钮点了没反应
      if (!settled) {
        cleanup();
        state.phase = 'error';
        state.errorMsg = explainError(e);
        errorLog('requestDevice 同步抛错:', e);
        render();
      }
    }
  }

  function doDisconnect() {
    try {
      if (state.device && state.device.gatt) {
        try { if (state.device.gatt.connected) state.device.gatt.disconnect(); } catch (_) {}
      }
    } catch (e) { warn('断开失败:', e); }
    state.device = null;
    state.server = null;
    state.phase = 'idle';
    render();
  }

  function onGattDisconnected() {
    log('GATT 连接已断开（锁屏 / 切后台 / 设备侧断开）');
    render();
  }

  // ============================================================
  // ============ 交互 ==========================================
  // ============================================================

  function onRootClick(e) {
    var t = e.target;
    var act = null;
    // 向上找带 data-bt-act 的祖先（点中按钮内文字也要能命中）
    while (t && t !== document) {
      if (t.getAttribute && t.getAttribute('data-bt-act')) { act = t.getAttribute('data-bt-act'); break; }
      t = t.parentNode;
    }
    if (!act) {
      // 点遮罩关闭
      if (e.target && e.target.id === MASK_ID) close();
      return;
    }
    try {
      if (act === 'close') close();
      else if (act === 'pair') startPair();
      else if (act === 'disconnect') doDisconnect();
      else if (act === 'reconnect') {
        // 重新连接已选设备（页面未刷新时 gatt.connect 可静默重连，无需重新配对）
        if (state.device && state.device.gatt) {
          state.device.gatt.connect().then(function (server) {
            state.server = server;
            state.phase = 'connected';
            render();
          }).catch(function (err) {
            state.phase = 'error';
            state.errorMsg = explainError(err);
            render();
          });
        } else {
          startPair();
        }
      }
    } catch (err) {
      errorLog('点击处理异常:', err);
    }
  }

  // ============================================================
  // ============ 对外 API ======================================
  // ============================================================

  function open() {
    try {
      if (!state.env) state.env = detectEnv();
      var root = ensureSheet();
      if (!root) { errorLog('浮层创建失败'); return; }
      state.phase = 'idle';
      state.errorMsg = '';
      render();
      openSheetDom();
      state.sheetOpen = true;
      log('open; platform=' + state.env.platform +
          '; hasAPI=' + state.env.hasAPI +
          '; standalone=' + state.env.standalone);
    } catch (e) {
      errorLog('open 失败:', e);
    }
  }

  function close() {
    try {
      closeSheetDom();
      state.sheetOpen = false;
    } catch (e) { errorLog('close 失败:', e); }
  }

  function init() {
    if (_initialized) return;
    _initialized = true;
    try {
      state.env = detectEnv();
      log('loaded; platform=' + state.env.platform +
          '; hasAPI=' + state.env.hasAPI +
          '; secure=' + state.env.secure +
          '; standalone=' + state.env.standalone);
    } catch (e) {
      errorLog('init 失败:', e);
    }
  }

  window.BluetoothPanel = {
    open: open,
    close: close,
    getEnv: function () { try { return detectEnv(); } catch (_) { return null; } },
    isSupported: function () {
      try { return ('bluetooth' in navigator) && !!navigator.bluetooth; } catch (_) { return false; }
    }
  };

  // 三态启动（项目既有写法，照 app-launch.js 结尾）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
