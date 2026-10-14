/**
 * 麦克风模块（MediaDevices.getUserMedia）
 * ============================================================
 * 首页快捷入口 #qa-microphone → window.MicrophonePanel.open()
 *
 * 与蓝牙（js/bluetooth.js）的关键差异：**麦克风是 Baseline 广泛可用能力**，
 * iOS Safari 11+ / Android 全系 / ArkWeb 均支持，真机可用性远高于蓝牙。
 * 但仍有若干实测坑，本模块逐条内建处理：
 *
 *  1. **必须在用户手势窗口内调用**，`startCapture()` 到 `getUserMedia()` 之间
 *     不能有 await（项目铁律，同 js/camera-capture.js 的 startLive 约束 /
 *     js/push-subscribe.js v1.6.10 修复同源）—— 否则 iOS 不弹权限框。
 *  2. **禁止用 navigator.permissions.query() 判断权限** —— HarmonyOS 6.1 的
 *     ArkWeb 该 API 恒返回 denied（华为官方确认）。一律以 getUserMedia 实际抛错为准。
 *  3. **超时看门狗** —— 部分旧版国产 ROM 浏览器（2021 前）会"既不授权也不报错"
 *     地静默挂起，没有超时就会永久卡在"正在开启"。
 *  4. **iOS 26 音频守护进程 bug（WebKit 319706）** —— audiomxd 重置后
 *     getUserMedia({audio}) 永久失败并报 AVAudioSessionCaptureDevice，重试无效，
 *     只能整页重载。已做专门文案识别。
 *  5. **关闭时必须彻底释放** —— stop 所有音轨 + close AudioContext + 停 rAF 循环，
 *     否则持续占用麦克风（系统状态栏常驻录音图标）并耗电。
 *
 * 纯 API 模块：无副作用，不自动绑定 click（已在 js/login.js 的
 * initQuickActions() 内单点绑定，照 #qa-camera / #qa-bluetooth 约定）。
 */
(function () {
  'use strict';

  var ROOT_ID = 'mic-root';
  var MASK_ID = 'mic-mask';
  var SHEET_ID = 'mic-sheet';
  var BODY_ID = 'mic-body';
  var BAR_ID = 'mic-level-bar';

  // 无回调静默挂起的兜底时限（旧版国产 ROM 浏览器）
  var CAPTURE_TIMEOUT_MS = 8000;

  var state = {
    sheetOpen: false,
    phase: 'idle',        // idle | requesting | active | error
    stream: null,
    audioCtx: null,
    analyser: null,
    rafId: null,
    errorMsg: '',
    errorHint: '',
    env: null
  };

  var _initialized = false;

  // ============================================================
  // ============ 日志（Q2：异常路径必须留痕）====================
  // ============================================================
  var TAG = '[microphone]';
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

  function mediaSupported() {
    try {
      return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
    } catch (_) { return false; }
  }

  /**
   * 平台环境识别。只用于**选择引导文案**，不参与能力判定
   * —— 可用性一律以 mediaDevices 是否存在 + 实际调用结果为准。
   */
  function detectEnv() {
    var ua = '';
    try { ua = navigator.userAgent || ''; } catch (_) { ua = ''; }

    var isIOS = /iPhone|iPad|iPod/i.test(ua) ||
                (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
    var isHarmony = /HarmonyOS|ArkWeb|OpenHarmony/i.test(ua);
    var isHuaweiBrowser = /HuaweiBrowser/i.test(ua) || /Huawei/i.test(ua);
    var isWeChat = /MicroMessenger/i.test(ua);
    var isXiaomi = /MiuiBrowser|XiaoMi|MiBrowser/i.test(ua);
    var isVivo = /VivoBrowser|vivo/i.test(ua);
    var isOppo = /OppoBrowser|OPPO|HeyTap/i.test(ua);

    var standalone = false;
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) standalone = true;
      else if (window.matchMedia && window.matchMedia('(display-mode: minimal-ui)').matches) standalone = true;
      else if (navigator.standalone === true) standalone = true;
    } catch (_) {}

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

    return {
      platform: platform,
      isIOS: isIOS,
      isHarmony: isHarmony,
      isWeChat: isWeChat,
      standalone: standalone,
      secure: secure,
      hasAPI: mediaSupported(),
      ua: ua,
      vendorName: (function () {
        switch (platform) {
          case 'ios': return '苹果 iOS';
          case 'harmony': return '华为鸿蒙';
          case 'huawei': return '华为浏览器';
          case 'xiaomi': return '小米浏览器';
          case 'vivo': return 'vivo 浏览器';
          case 'oppo': return 'OPPO 浏览器';
          case 'wechat': return '微信内置浏览器';
          default: return '当前浏览器';
        }
      })()
    };
  }

  /** API 层就不可用时的引导（HTTPS 缺失是五端最常见的真凶） */
  function guidanceFor(env) {
    if (!env.secure) {
      return {
        title: '需要 HTTPS 才能使用麦克风',
        reason: '浏览器规定：非安全上下文（HTTP）下 navigator.mediaDevices 根本不存在，这是硬性限制，无法绕过。',
        action: '请改用 https:// 开头的地址访问本页。'
      };
    }
    if (env.isIOS) {
      return {
        title: 'iOS 当前无法开启麦克风',
        reason: 'iOS 11 以下不支持网页麦克风；iOS 13.4 以下「添加到主屏幕」的独立窗口模式也不支持。',
        action: '请升级 iOS 到 13.4 以上，或改用 Safari 直接访问本页（不要从桌面图标打开）。'
      };
    }
    if (env.isWeChat) {
      return {
        title: '微信内暂无法开启麦克风',
        reason: 'Android 微信首次安装或清理数据后，内置 XWeb 内核尚未就绪，此时无法采集麦克风。',
        action: '请连 Wi-Fi 等几分钟让微信自动下载内核后重试，或点右上角「···」→「在浏览器打开」。'
      };
    }
    return {
      title: '当前浏览器无法开启麦克风',
      reason: env.vendorName + '未开放网页麦克风接口（navigator.mediaDevices 不存在）。',
      action: '建议改用 Chrome 浏览器打开本页后重试。'
    };
  }

  // ============================================================
  // ============ 浮层 DOM（幂等注入，照 js/bluetooth.js）======
  // ============================================================

  function ensureSheet() {
    var existing = $(ROOT_ID);
    if (existing) return existing;

    var root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = ''
      + '<div class="mic-mask" id="' + MASK_ID + '"></div>'
      + '<div class="mic-sheet" id="' + SHEET_ID + '" role="dialog" aria-modal="true">'
      +   '<button type="button" class="mic-close" data-mic-act="close" aria-label="关闭">✕</button>'
      +   '<div class="mic-sheet-inner">'
      +     '<div id="' + BODY_ID + '"></div>'
      +   '</div>'
      + '</div>';

    // 事件委托绑在根节点：render() 重写 innerHTML 不会丢事件
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
      if (!env.hasAPI) html = renderUnsupported(env);
      else if (state.phase === 'requesting') html = renderRequesting();
      else if (state.phase === 'active') html = renderActive();
      else if (state.phase === 'error') html = renderError();
      else html = renderIdle(env);
    } catch (e) {
      errorLog('render 失败:', e);
      html = '<h2 class="mic-title">麦克风</h2><p class="mic-hint">页面初始化异常，请关闭后重试。</p>';
    }
    try { body.innerHTML = html; } catch (e2) { errorLog('写入浮层失败:', e2); }
  }

  function metaRows(env) {
    return ''
      + '<div class="mic-meta">'
      +   '<div class="mic-meta-row"><span>设备</span><b>' + escapeHtml(env.vendorName) + '</b></div>'
      +   '<div class="mic-meta-row"><span>运行模式</span><b>' + (env.standalone ? '桌面图标（独立窗口）' : '浏览器内') + '</b></div>'
      +   '<div class="mic-meta-row"><span>安全上下文</span><b class="' + (env.secure ? 'mic-ok' : 'mic-no') + '">'
      +     (env.secure ? 'HTTPS' : '非 HTTPS') + '</b></div>'
      +   '<div class="mic-meta-row"><span>麦克风接口</span><b class="' + (env.hasAPI ? 'mic-ok' : 'mic-no') + '">'
      +     (env.hasAPI ? '可用' : '不可用') + '</b></div>'
      + '</div>';
  }

  function renderUnsupported(env) {
    var g = guidanceFor(env);
    return ''
      + '<h2 class="mic-title">麦克风</h2>'
      + '<div class="mic-status mic-status-no">'
      +   '<span class="mic-status-icon">🚫</span>'
      +   '<span class="mic-status-text">' + escapeHtml(g.title) + '</span>'
      + '</div>'
      + '<p class="mic-hint mic-hint-warn">' + escapeHtml(g.reason) + '</p>'
      + '<p class="mic-hint">' + escapeHtml(g.action) + '</p>'
      + metaRows(env)
      + '<div class="mic-btns">'
      +   '<button type="button" class="mic-btn" data-mic-act="close">知道了</button>'
      + '</div>';
  }

  function renderIdle(env) {
    return ''
      + '<h2 class="mic-title">麦克风</h2>'
      + '<div class="mic-status mic-status-ok">'
      +   '<span class="mic-status-icon">🎤</span>'
      +   '<span class="mic-status-text">麦克风可用</span>'
      + '</div>'
      + '<p class="mic-hint">点击下方按钮后，系统会询问麦克风权限，允许后即可开始采集。</p>'
      + metaRows(env)
      + '<div class="mic-btns">'
      +   '<button type="button" class="mic-btn mic-btn-primary" data-mic-act="start">开启麦克风</button>'
      + '</div>'
      + '<p class="mic-footnote">⚠️ 麦克风仅在页面处于前台时工作，锁屏或切到后台会停止采集，返回本页后可重新开启。</p>';
  }

  function renderRequesting() {
    return ''
      + '<h2 class="mic-title">麦克风</h2>'
      + '<div class="mic-status mic-status-wait">'
      +   '<span class="mic-status-icon">⏳</span>'
      +   '<span class="mic-status-text">正在开启…</span>'
      + '</div>'
      + '<p class="mic-hint">若系统弹出权限询问，请点击「允许」。</p>'
      + '<div class="mic-btns">'
      +   '<button type="button" class="mic-btn" data-mic-act="close">取消</button>'
      + '</div>';
  }

  function renderActive() {
    var track = null;
    try {
      var tracks = state.stream ? state.stream.getAudioTracks() : [];
      track = tracks.length ? tracks[0] : null;
    } catch (_) {}
    var label = (track && track.label) ? track.label : '默认麦克风';
    var settings = {};
    try { settings = (track && track.getSettings) ? (track.getSettings() || {}) : {}; } catch (_) {}
    var rate = settings.sampleRate ? (settings.sampleRate + ' Hz') : '—';
    var ch = (settings.channelCount != null) ? (settings.channelCount + ' 声道') : '—';

    return ''
      + '<h2 class="mic-title">麦克风</h2>'
      + '<div class="mic-status mic-status-ok">'
      +   '<span class="mic-status-icon">🔴</span>'
      +   '<span class="mic-status-text">已开启</span>'
      + '</div>'
      + '<div class="mic-device">'
      +   '<div class="mic-device-name">' + escapeHtml(label) + '</div>'
      +   '<div class="mic-device-id">' + escapeHtml(rate) + ' · ' + escapeHtml(ch) + '</div>'
      + '</div>'
      + '<div class="mic-level">'
      +   '<div class="mic-level-label">实时音量</div>'
      +   '<div class="mic-level-track"><div class="mic-level-bar" id="' + BAR_ID + '"></div></div>'
      + '</div>'
      + '<p class="mic-hint">对着手机说话，上方音量条会随之变化 —— 这是麦克风正在工作的证明。</p>'
      + '<div class="mic-btns">'
      +   '<button type="button" class="mic-btn" data-mic-act="stop">关闭麦克风</button>'
      +   '<button type="button" class="mic-btn" data-mic-act="close">收起</button>'
      + '</div>'
      + '<p class="mic-footnote">⚠️ 锁屏或切到后台会停止采集，返回本页后可重新开启。</p>';
  }

  function renderError() {
    return ''
      + '<h2 class="mic-title">麦克风</h2>'
      + '<div class="mic-status mic-status-no">'
      +   '<span class="mic-status-icon">⚠️</span>'
      +   '<span class="mic-status-text">未能开启</span>'
      + '</div>'
      + '<p class="mic-hint mic-hint-warn">' + escapeHtml(state.errorMsg || '未知错误') + '</p>'
      + (state.errorHint ? '<p class="mic-hint">' + escapeHtml(state.errorHint) + '</p>' : '')
      + '<div class="mic-btns">'
      +   '<button type="button" class="mic-btn mic-btn-primary" data-mic-act="start">重试</button>'
      +   '<button type="button" class="mic-btn" data-mic-act="close">关闭</button>'
      + '</div>';
  }

  // ============================================================
  // ============ 采集与释放 ====================================
  // ============================================================

  /** 错误码 → 用户可读文案 + 可操作指引 */
  function explainError(err) {
    var n = (err && err.name) || '';
    var m = (err && err.message) || '';
    var out = { msg: '', hint: '' };

    // 华为/鸿蒙「坚盾守护模式」：ArkWeb 直接禁用 getUserMedia（任意错误名都可能带此串）
    // 同 js/camera-capture.js:1237 的识别，保持一致。
    if (/advancedSecurityMode/i.test(m)) {
      out.msg = '鸿蒙「坚盾守护模式」已开启。';
      out.hint = '该模式会禁用网页麦克风。请到「设置 → 隐私和安全 → 坚盾守护模式」中关闭后重试。';
      return out;
    }

    if (n === 'NotAllowedError') {
      // iOS 26 音频守护进程 bug：必须整页重载才可能恢复（WebKit 319706）
      if (/AVAudioSessionCaptureDevice/i.test(m)) {
        out.msg = 'iOS 音频系统暂时不可用。';
        out.hint = '这是 iOS 系统级的音频服务异常，重试无效 —— 请完全关闭本页（或从后台划掉）后重新打开。';
        return out;
      }
      if (!state.env || state.env.secure === false) {
        out.msg = '仅支持 HTTPS 页面使用麦克风。';
        out.hint = '请改用 https:// 开头的地址访问本页。';
        return out;
      }
      out.msg = '麦克风权限被拒绝。';
      out.hint = '请在浏览器地址栏的权限设置中把「麦克风」改为允许，然后返回本页重试。';
      return out;
    }
    if (n === 'NotFoundError') {
      out.msg = '未检测到麦克风设备。';
      out.hint = '请确认设备有可用的麦克风（或耳机麦克风已插好）后重试。';
      return out;
    }
    if (n === 'NotReadableError') {
      out.msg = '麦克风被其他应用占用。';
      out.hint = '请关闭正在使用麦克风的应用（如录音机、通话、其他浏览器标签），然后重试。';
      return out;
    }
    if (n === 'AbortError') {
      out.msg = '采集被中断。';
      out.hint = '通常是页面切到后台导致的。请保持本页在前台，重新点击开启。';
      return out;
    }
    if (n === 'OverconstrainedError') {
      out.msg = '当前设备无法满足麦克风参数要求。';
      out.hint = '请重试；若持续失败，可能是该机型的音频驱动限制。';
      return out;
    }
    if (n === 'TimeoutError') {
      out.msg = '开启超时。';
      // 按机型分叉：这几家"无回调"的成因不同，笼统文案帮不到用户
      if (state.env && state.env.isHarmony) {
        out.hint = '鸿蒙部分版本的系统浏览器（API 11 及更早）对网页麦克风权限请求无响应，请升级系统，或改用其他浏览器重试。';
      } else if (state.env && state.env.isWeChat) {
        out.hint = '微信内置内核可能尚未就绪。请连 Wi-Fi 等待几分钟后重试，或点右上角「···」→「在浏览器打开」。';
      } else if (state.env && state.env.standalone) {
        out.hint = '独立窗口模式下未弹出权限询问。请改用浏览器直接打开本页重试。';
      } else {
        out.hint = '浏览器既未授权也未报错，可能是该内核存在兼容问题。请重启浏览器，或改用 Chrome 打开本页。';
      }
      return out;
    }
    out.msg = '开启失败：' + (n || '未知错误') + (m ? '（' + m + '）' : '');
    out.hint = '请重试；若持续失败，可改用 Chrome 浏览器打开本页。';
    return out;
  }

  /**
   * 开启麦克风。
   * ⚠️ 本函数必须在 click 的**同步路径**内被调用 —— 到 getUserMedia 之间不能有 await，
   *    否则 iOS 会因脱离用户手势窗口而**不弹权限框**（项目铁律）。
   */
  function startCapture() {
    if (!mediaSupported()) {
      warn('mediaDevices 不可用');
      render();
      return;
    }

    state.phase = 'requesting';
    state.errorMsg = '';
    state.errorHint = '';
    render();

    var settled = false;
    var watchdog = setTimeout(function () {
      if (settled) return;
      settled = true;
      var e = explainError({ name: 'TimeoutError', message: '' });
      state.phase = 'error';
      state.errorMsg = e.msg;
      state.errorHint = e.hint;
      errorLog('开启超时：浏览器既未授权也未报错（旧版国产 ROM 常见）');
      render();
    }, CAPTURE_TIMEOUT_MS);

    function settle(fn) {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      fn();
    }

    try {
      // 直接调用，中间不插入任何 await（用户手势窗口）
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        settle(function () {
          state.stream = stream;
          state.phase = 'active';
          // 音轨被系统/设备侧终止时（拔耳机、切后台等）自动回落到 idle
          try {
            var t = stream.getAudioTracks()[0];
            if (t) {
              t.addEventListener('ended', function () {
                log('音轨 ended');
                stopCapture();
              });
            }
          } catch (_) {}
          log('麦克风已开启');
          render();
          startLevelLoop();
        });
      }, function (err) {
        settle(function () {
          var e = explainError(err);
          state.phase = 'error';
          state.errorMsg = e.msg;
          state.errorHint = e.hint;
          warn('getUserMedia 失败:', err && err.name, err && err.message);
          render();
        });
      });
    } catch (e) {
      // 同步抛错（极少数内核）：必须兜底，否则按钮点了没反应
      settle(function () {
        var ex = explainError(e);
        state.phase = 'error';
        state.errorMsg = ex.msg;
        state.errorHint = ex.hint;
        errorLog('getUserMedia 同步抛错:', e);
        render();
      });
    }
  }

  /** 彻底释放：停轨 + 关 AudioContext + 停 rAF 循环（G1：循环必须可停） */
  function stopCapture() {
    stopLevelLoop();
    try {
      if (state.stream) {
        state.stream.getTracks().forEach(function (t) {
          try { t.stop(); } catch (_) {}
        });
      }
    } catch (e) { warn('停止音轨失败:', e); }
    state.stream = null;
    state.analyser = null;
    try {
      if (state.audioCtx && state.audioCtx.state !== 'closed') {
        var p = state.audioCtx.close();
        if (p && typeof p.catch === 'function') p.catch(function () {});
      }
    } catch (e) { warn('关闭 AudioContext 失败:', e); }
    state.audioCtx = null;

    if (state.phase !== 'error') state.phase = 'idle';
    render();
  }

  // ---- 实时音量（rAF 循环，严格管理生命周期）----

  function stopLevelLoop() {
    if (state.rafId) {
      try { cancelAnimationFrame(state.rafId); } catch (_) {}
      state.rafId = null;
    }
  }

  function startLevelLoop() {
    stopLevelLoop(); // 防双驱（Q6）
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) { warn('无 AudioContext，音量条不可用'); return; }
      state.audioCtx = new Ctx();
      // iOS 上 AudioContext 可能处于 suspended，需在用户手势内 resume
      if (state.audioCtx.state === 'suspended' && state.audioCtx.resume) {
        var rp = state.audioCtx.resume();
        if (rp && typeof rp.catch === 'function') rp.catch(function () {});
      }
      var src = state.audioCtx.createMediaStreamSource(state.stream);
      state.analyser = state.audioCtx.createAnalyser();
      state.analyser.fftSize = 256;
      state.analyser.smoothingTimeConstant = 0.6;
      src.connect(state.analyser);
    } catch (e) {
      warn('音量分析初始化失败（不影响采集）:', e && e.name);
      return;
    }

    var buf = new Uint8Array(state.analyser.frequencyBinCount);

    function step() {
      state.rafId = null;
      // 守卫：浮层关闭或流已释放则不再继续
      if (!state.stream || !state.analyser || !state.sheetOpen) return;
      try {
        state.analyser.getByteTimeDomainData(buf);
        var peak = 0;
        for (var i = 0; i < buf.length; i++) {
          var v = Math.abs(buf[i] - 128) / 128;
          if (v > peak) peak = v;
        }
        var bar = $(BAR_ID);
        if (bar) {
          // 感知映射：直接线性会显得"几乎不动"，做一次开方提升低音量可见度
          var pct = Math.min(100, Math.round(Math.sqrt(peak) * 130));
          bar.style.width = pct + '%';
        }
      } catch (e) {
        // G1/Q3：单帧异常只记一次，绝不中断后续帧
        if (!step._warned) { step._warned = true; warn('音量分析异常:', e && e.name); }
      }
      state.rafId = requestAnimationFrame(step);
    }

    state.rafId = requestAnimationFrame(step);
  }

  // ============================================================
  // ============ 交互 ==========================================
  // ============================================================

  function onRootClick(e) {
    var t = e.target;
    var act = null;
    while (t && t !== document) {
      if (t.getAttribute && t.getAttribute('data-mic-act')) { act = t.getAttribute('data-mic-act'); break; }
      t = t.parentNode;
    }
    if (!act) {
      if (e.target && e.target.id === MASK_ID) close();
      return;
    }
    try {
      if (act === 'close') close();
      else if (act === 'start') startCapture();
      else if (act === 'stop') stopCapture();
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
      // 已开启时保持 active 态（收起再打开不应中断采集）
      if (state.phase !== 'active') {
        state.phase = 'idle';
        state.errorMsg = '';
        state.errorHint = '';
      }
      render();
      openSheetDom();
      state.sheetOpen = true;
      if (state.phase === 'active') startLevelLoop();
      log('open; platform=' + state.env.platform +
          '; hasAPI=' + state.env.hasAPI +
          '; secure=' + state.env.secure +
          '; standalone=' + state.env.standalone);
    } catch (e) {
      errorLog('open 失败:', e);
    }
  }

  /**
   * 关闭浮层。
   * ⚠️ 与蓝牙不同：这里**不停止采集** —— 「收起」只是收起面板，
   *    麦克风继续工作符合用户预期（面板上有明确的「关闭麦克风」按钮）。
   *    但 rAF 循环必须停（浮层不可见时无需渲染）。
   */
  function close() {
    try {
      closeSheetDom();
      state.sheetOpen = false;
      stopLevelLoop();
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

  window.MicrophonePanel = {
    open: open,
    close: close,
    isSupported: function () { try { return mediaSupported(); } catch (_) { return false; } },
    isActive: function () { try { return !!state.stream; } catch (_) { return false; } },
    stop: function () { try { stopCapture(); } catch (_) {} },
    getEnv: function () { try { return detectEnv(); } catch (_) { return null; } }
  };

  // 三态启动（项目既有写法）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
