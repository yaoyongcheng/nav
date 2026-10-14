/**
 * 定位能力检测模块（Geolocation 可用性 + 坐标系）
 * ============================================================
 * 首页快捷入口 #qa-geo-check → window.GeoCheckPanel.open()
 *
 * 用途：**在五款机型上验证「能否打开定位」**，并顺带判定返回坐标系。
 *
 * 为什么需要专门的检测（而不是直接看地图有没有定位成功）：
 *  1. **iOS PWA standalone 挂起** —— 权限未授权时 getCurrentPosition() 会
 *     永久挂起：不返回、不报错、**权限弹窗永不出现**；且此时
 *     `PositionOptions.timeout` 被 iOS **直接忽略**（实测 iOS 15.x）。
 *     因此本模块**自实现看门狗**（WATCHDOG_MS），不依赖 timeout 参数。
 *  2. **国产 ROM 老机型无系统定位服务** —— 表现为 POSITION_UNAVAILABLE，
 *     需要明确区分「没权限」和「系统定位不可用」，否则用户无从下手。
 *  3. **坐标系不一致** —— 不同浏览器返回 WGS-84 或 GCJ-02 不等，
 *     项目 map-core.js 无条件做 WGS84→GCJ02 转换，若浏览器本已返回
 *     GCJ-02 则会产生二次偏移（数百米）。本模块用「在高德地图中打开」
 *     做客观比对，结论可复制回传。
 *
 * ⚠️ 关于「GPS / 北斗」：Web 层**没有**独立的 GPS 或北斗 API，只有统一的
 *    navigator.geolocation。底层用哪个星座由**系统定位服务**决定，Web 层
 *    既不能指定、也拿不到星座信息。本模块用 **精度值**间接反映：
 *    精度 < 50m 通常为卫星定位（GPS/北斗混合），> 100m 通常为网络定位。
 *
 * 纯 API 模块：无副作用，不自动绑定 click（已在 js/login.js 的
 * initQuickActions() 内单点绑定）。
 */
(function () {
  'use strict';

  var ROOT_ID = 'gc-root';
  var MASK_ID = 'gc-mask';
  var SHEET_ID = 'gc-sheet';
  var BODY_ID = 'gc-body';

  // 自实现看门狗：必须大于传给 geolocation 的 timeout，
  // 用于兜住「iOS PWA 挂起」与「国产 ROM 无回调」这两类不报错的情况。
  var GEO_TIMEOUT_MS = 12000;
  var WATCHDOG_MS = 15000;

  var state = {
    sheetOpen: false,
    phase: 'idle',        // idle | checking | success | failed | hung
    result: null,
    errorMsg: '',
    errorHint: '',
    env: null
  };

  var _initialized = false;

  // ============================================================
  // ============ 日志（Q2：异常路径必须留痕）====================
  // ============================================================
  var TAG = '[geo-check]';
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

  function geoSupported() {
    try { return ('geolocation' in navigator) && !!navigator.geolocation; } catch (_) { return false; }
  }

  /** 平台识别：只用于选引导文案，不参与能力判定 */
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
    var isUC = /UCBrowser|UCWEB/i.test(ua);
    var isBaidu = /baidubrowser|BIDUBrowser/i.test(ua);

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
    else if (isUC) platform = 'uc';
    else if (isBaidu) platform = 'baidu';

    return {
      platform: platform,
      isIOS: isIOS,
      isHarmony: isHarmony,
      isWeChat: isWeChat,
      standalone: standalone,
      secure: secure,
      hasAPI: geoSupported(),
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
          case 'uc': return 'UC 浏览器';
          case 'baidu': return '百度浏览器';
          default: return '当前浏览器';
        }
      })()
    };
  }

  /** 坐标转换：复用项目权威实现（js/coordinate-convert.js），缺失则原样返回 */
  function toGcj02(lng, lat) {
    try {
      if (typeof wgs84ToGcj02 === 'function') return wgs84ToGcj02(lng, lat);
    } catch (e) { warn('坐标转换失败:', e && e.name); }
    return [lng, lat];
  }

  /** 两坐标间距离（米），用于展示 WGS84↔GCJ02 的偏移量级 */
  function distanceMeters(lng1, lat1, lng2, lat2) {
    try {
      var R = 6371000;
      var dLat = (lat2 - lat1) * Math.PI / 180;
      var dLng = (lng2 - lng1) * Math.PI / 180;
      var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
      return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    } catch (_) { return null; }
  }

  /** 精度 → 定位方式推断（间接反映是否用上了卫星/北斗） */
  function accuracyLabel(acc) {
    if (typeof acc !== 'number' || isNaN(acc)) return { text: '未知', note: '' };
    var a = Math.round(acc);
    if (a <= 20) return { text: a + ' 米', note: '卫星定位（精度高，通常为 GPS/北斗 混合定位）' };
    if (a <= 50) return { text: a + ' 米', note: '卫星定位（可能刚完成首次定位）' };
    if (a <= 200) return { text: a + ' 米', note: '网络辅助定位（WiFi/基站，未锁定卫星）' };
    return { text: a + ' 米', note: '仅网络定位（精度较低，可能未使用卫星）' };
  }

  function fmt(n) {
    try { return Number(n).toFixed(6); } catch (_) { return String(n); }
  }

  // ============================================================
  // ============ 浮层 DOM（幂等注入，照 js/microphone.js）=====
  // ============================================================

  function ensureSheet() {
    var existing = $(ROOT_ID);
    if (existing) return existing;

    var root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = ''
      + '<div class="gc-mask" id="' + MASK_ID + '"></div>'
      + '<div class="gc-sheet" id="' + SHEET_ID + '" role="dialog" aria-modal="true">'
      +   '<button type="button" class="gc-close" data-gc-act="close" aria-label="关闭">✕</button>'
      +   '<div class="gc-sheet-inner">'
      +     '<div id="' + BODY_ID + '"></div>'
      +   '</div>'
      + '</div>';

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
      else if (state.phase === 'checking') html = renderChecking();
      else if (state.phase === 'success') html = renderSuccess(env);
      else if (state.phase === 'hung') html = renderHung(env);
      else if (state.phase === 'failed') html = renderFailed(env);
      else html = renderIdle(env);
    } catch (e) {
      errorLog('render 失败:', e);
      html = '<h2 class="gc-title">定位检测</h2><p class="gc-hint">页面初始化异常，请关闭后重试。</p>';
    }
    try { body.innerHTML = html; } catch (e2) { errorLog('写入浮层失败:', e2); }
  }

  function metaRows(env) {
    return ''
      + '<div class="gc-meta">'
      +   '<div class="gc-meta-row"><span>设备</span><b>' + escapeHtml(env.vendorName) + '</b></div>'
      +   '<div class="gc-meta-row"><span>运行模式</span><b>' + (env.standalone ? '桌面图标（独立窗口）' : '浏览器内') + '</b></div>'
      +   '<div class="gc-meta-row"><span>安全上下文</span><b class="' + (env.secure ? 'gc-ok' : 'gc-no') + '">'
      +     (env.secure ? 'HTTPS' : '非 HTTPS') + '</b></div>'
      +   '<div class="gc-meta-row"><span>定位接口</span><b class="' + (env.hasAPI ? 'gc-ok' : 'gc-no') + '">'
      +     (env.hasAPI ? '存在' : '不存在') + '</b></div>'
      + '</div>';
  }

  function renderUnsupported(env) {
    return ''
      + '<h2 class="gc-title">定位检测</h2>'
      + '<div class="gc-status gc-status-no">'
      +   '<span class="gc-status-icon">🚫</span>'
      +   '<span class="gc-status-text">该浏览器没有定位接口</span>'
      + '</div>'
      + '<p class="gc-hint gc-hint-warn">' +
        (env.secure ? '当前浏览器未暴露 navigator.geolocation。'
                    : '非 HTTPS 页面下浏览器不会提供定位接口（硬性限制）。') + '</p>'
      + '<p class="gc-hint">' + (env.secure ? '建议改用系统浏览器或 Chrome 打开本页。' : '请改用 https:// 地址访问本页。') + '</p>'
      + metaRows(env)
      + '<div class="gc-btns"><button type="button" class="gc-btn" data-gc-act="close">知道了</button></div>';
  }

  function renderIdle(env) {
    return ''
      + '<h2 class="gc-title">定位检测</h2>'
      + '<div class="gc-status gc-status-ok">'
      +   '<span class="gc-status-icon">📍</span>'
      +   '<span class="gc-status-text">准备就绪</span>'
      + '</div>'
      + '<p class="gc-hint">点击下方按钮，系统会询问定位权限。请在弹窗中点击「允许」，并保持本页在前台。</p>'
      + metaRows(env)
      + '<div class="gc-btns">'
      +   '<button type="button" class="gc-btn gc-btn-primary" data-gc-act="check">开始检测定位</button>'
      + '</div>'
      + '<p class="gc-footnote">⚠️ 浏览器定位依赖系统定位服务。若系统定位未开启，网页端同样无法定位 —— 这是系统层限制，无法在网页内绕过。</p>';
  }

  function renderChecking() {
    return ''
      + '<h2 class="gc-title">定位检测</h2>'
      + '<div class="gc-status gc-status-wait">'
      +   '<span class="gc-status-icon">⏳</span>'
      +   '<span class="gc-status-text">正在定位…</span>'
      + '</div>'
      + '<p class="gc-hint">首次定位可能需要几秒到十几秒。若弹出权限询问，请点击「允许」。</p>'
      + '<div class="gc-btns"><button type="button" class="gc-btn" data-gc-act="close">取消</button></div>';
  }

  function renderSuccess(env) {
    var r = state.result || {};
    var acc = accuracyLabel(r.accuracy);
    var off = distanceMeters(r.rawLng, r.rawLat, r.gcjLng, r.gcjLat);

    // 高德链接：用 uri.amap.com 唤起（网页/App 均可），无需 SDK 与 key
    var rawLink = 'https://uri.amap.com/marker?position=' + r.rawLng + ',' + r.rawLat +
                  '&name=' + encodeURIComponent('坐标A-原始') + '&src=geo-check';
    var gcjLink = 'https://uri.amap.com/marker?position=' + r.gcjLng + ',' + r.gcjLat +
                  '&name=' + encodeURIComponent('坐标B-转换后') + '&src=geo-check';

    return ''
      + '<h2 class="gc-title">定位检测</h2>'
      + '<div class="gc-status gc-status-ok">'
      +   '<span class="gc-status-icon">✅</span>'
      +   '<span class="gc-status-text">定位可用</span>'
      + '</div>'

      + '<div class="gc-result">'
      +   '<div class="gc-result-row"><span>定位精度</span><b>' + escapeHtml(acc.text) + '</b></div>'
      +   '<div class="gc-result-row"><span>获取耗时</span><b>' + escapeHtml(String(r.elapsed)) + ' ms</b></div>'
      + '</div>'
      + (acc.note ? '<p class="gc-hint">' + escapeHtml(acc.note) + '</p>' : '')

      + '<div class="gc-coord">'
      +   '<div class="gc-coord-label">坐标 A · 浏览器原始返回</div>'
      +   '<div class="gc-coord-value">' + escapeHtml(fmt(r.rawLng)) + ', ' + escapeHtml(fmt(r.rawLat)) + '</div>'
      + '</div>'
      + '<div class="gc-coord">'
      +   '<div class="gc-coord-label">坐标 B · WGS84→GCJ02 转换后（高德用）</div>'
      +   '<div class="gc-coord-value">' + escapeHtml(fmt(r.gcjLng)) + ', ' + escapeHtml(fmt(r.gcjLat)) + '</div>'
      + '</div>'

      + (off != null && off > 0
          ? '<p class="gc-hint gc-hint-warn">两者相差 <b>' + off + ' 米</b>。请用下方按钮在高德地图中分别查看，'
            + '判断哪一个落在你的真实位置上 —— 这决定本机浏览器返回的是哪种坐标系。</p>'
          : '<p class="gc-hint">两者一致（可能位于境外，或转换函数未加载）。</p>')

      + '<div class="gc-btns">'
      +   '<a class="gc-btn" href="' + escapeHtml(rawLink) + '" target="_blank" rel="noopener">在高德查看【坐标 A】</a>'
      +   '<a class="gc-btn" href="' + escapeHtml(gcjLink) + '" target="_blank" rel="noopener">在高德查看【坐标 B】</a>'
      + '</div>'
      + '<div class="gc-btns">'
      +   '<button type="button" class="gc-btn gc-btn-primary" data-gc-act="copy">复制检测结果</button>'
      +   '<button type="button" class="gc-btn" data-gc-act="check">重新检测</button>'
      + '</div>'
      + '<p class="gc-footnote">⚠️ 定位仅在本页处于前台时有效，锁屏或切到后台会暂停。</p>';
  }

  function renderFailed(env) {
    return ''
      + '<h2 class="gc-title">定位检测</h2>'
      + '<div class="gc-status gc-status-no">'
      +   '<span class="gc-status-icon">❌</span>'
      +   '<span class="gc-status-text">定位失败</span>'
      + '</div>'
      + '<p class="gc-hint gc-hint-warn">' + escapeHtml(state.errorMsg || '未知错误') + '</p>'
      + (state.errorHint ? '<p class="gc-hint">' + escapeHtml(state.errorHint) + '</p>' : '')
      + metaRows(env)
      + '<div class="gc-btns">'
      +   '<button type="button" class="gc-btn gc-btn-primary" data-gc-act="check">重试</button>'
      +   '<button type="button" class="gc-btn" data-gc-act="copy">复制检测结果</button>'
      +   '<button type="button" class="gc-btn" data-gc-act="close">关闭</button>'
      + '</div>';
  }

  function renderHung(env) {
    return ''
      + '<h2 class="gc-title">定位检测</h2>'
      + '<div class="gc-status gc-status-warn">'
      +   '<span class="gc-status-icon">⚠️</span>'
      +   '<span class="gc-status-text">无响应（超时）</span>'
      + '</div>'
      + '<p class="gc-hint gc-hint-warn">' + escapeHtml(state.errorMsg) + '</p>'
      + (state.errorHint ? '<p class="gc-hint">' + escapeHtml(state.errorHint) + '</p>' : '')
      + metaRows(env)
      + '<div class="gc-btns">'
      +   '<button type="button" class="gc-btn gc-btn-primary" data-gc-act="check">再试一次</button>'
      +   '<button type="button" class="gc-btn" data-gc-act="copy">复制检测结果</button>'
      +   '<button type="button" class="gc-btn" data-gc-act="close">关闭</button>'
      + '</div>';
  }

  // ============================================================
  // ============ 检测逻辑 ======================================
  // ============================================================

  function explainFailure(err, env) {
    var code = err && err.code;
    var out = { msg: '', hint: '' };

    // code: 1=PERMISSION_DENIED 2=POSITION_UNAVAILABLE 3=TIMEOUT
    if (code === 1) {
      out.msg = '定位权限被拒绝。';
      out.hint = env && env.isIOS
        ? '请到「设置 → 隐私与安全性 → 定位服务」，找到 Safari 或本应用，改为「使用 App 期间」。'
        : '请在浏览器地址栏的权限设置中把「位置」改为允许，然后返回本页重试。';
      return out;
    }
    if (code === 2) {
      // 国产 ROM 最常见：系统定位服务未开启 / 未获地图厂商授权 / 无 GMS
      out.msg = '位置信息不可用（系统定位服务未就绪）。';
      if (env && (env.platform === 'harmony' || env.platform === 'huawei')) {
        out.hint = '请在系统设置中开启「定位服务」，并确认已允许本应用使用位置。华为/鸿蒙部分机型需开启「设置 → 隐私 → 定位服务」中的高精度模式。';
      } else if (env && (env.platform === 'xiaomi' || env.platform === 'vivo' || env.platform === 'oppo')) {
        out.hint = '请到系统设置中开启「定位服务」（通常在下拉快捷开关或「设置 → 位置信息」），并确认已允许浏览器使用位置。';
      } else if (env && env.isIOS) {
        out.hint = '请到「设置 → 隐私与安全性 → 定位服务」确认已开启，并允许 Safari/本应用使用。';
      } else {
        out.hint = '请确认手机的系统定位开关已打开，且已允许浏览器使用位置信息。';
      }
      return out;
    }
    if (code === 3) {
      out.msg = '定位超时。';
      out.hint = '可能是当前信号弱（室内、地下、遮挡严重）。请到室外空旷处重试。';
      return out;
    }
    out.msg = '定位失败：' + ((err && err.message) || '未知错误');
    out.hint = '请重试；若持续失败，可在系统设置中检查定位权限。';
    return out;
  }

  function startCheck() {
    var env = state.env || detectEnv();
    if (!env.hasAPI) { warn('geolocation 不可用'); render(); return; }

    state.phase = 'checking';
    state.errorMsg = '';
    state.errorHint = '';
    state.result = null;
    render();

    var settled = false;
    var startedAt = Date.now();
    var watchdog = setTimeout(function () {
      if (settled) return;
      settled = true;
      // 既没成功也没报错 —— iOS PWA 挂起 / 国产 ROM 无回调
      state.phase = 'hung';
      state.errorMsg = '等待超过 ' + Math.round(WATCHDOG_MS / 1000) + ' 秒，浏览器既未返回位置，也未报错。';
      if (env.isIOS && env.standalone) {
        state.errorHint = '这是 iOS 独立窗口（已添加到主屏幕）的已知问题：权限未授权时不会弹出询问框。'
          + '请先用 Safari 打开本页并允许一次定位，或到「设置 → 隐私与安全性 → 定位服务」把 Safari 设为「使用 App 期间」。';
      } else if (env.isHarmony || env.platform === 'huawei') {
        state.errorHint = '鸿蒙/华为部分机型的系统浏览器对网页定位不响应，请确认系统定位已开启，或改用其他浏览器。';
      } else {
        state.errorHint = '可能是系统定位服务未响应。请确认手机定位开关已打开，或重启浏览器后重试。';
      }
      errorLog('看门狗触发：geolocation 无响应');
      render();
    }, WATCHDOG_MS);

    function settle(fn) {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      fn();
    }

    try {
      navigator.geolocation.getCurrentPosition(
        function (position) {
          settle(function () {
            try {
              var c = position.coords || {};
              var rawLng = c.longitude, rawLat = c.latitude;
              var conv = toGcj02(rawLng, rawLat);
              state.result = {
                rawLng: rawLng,
                rawLat: rawLat,
                gcjLng: conv[0],
                gcjLat: conv[1],
                accuracy: c.accuracy,
                elapsed: Date.now() - startedAt
              };
              state.phase = 'success';
              log('定位成功 精度=' + c.accuracy + 'm 耗时=' + state.result.elapsed + 'ms');
            } catch (e) {
              errorLog('结果处理异常:', e);
              state.phase = 'failed';
              state.errorMsg = '定位结果解析异常。';
              state.errorHint = '请重试。';
            }
            render();
          });
        },
        function (err) {
          settle(function () {
            var e = explainFailure(err, env);
            state.phase = 'failed';
            state.errorMsg = e.msg;
            state.errorHint = e.hint;
            warn('定位失败 code=' + (err && err.code) + ' msg=' + (err && err.message));
            render();
          });
        },
        { enableHighAccuracy: true, timeout: GEO_TIMEOUT_MS, maximumAge: 0 }
      );
    } catch (e) {
      settle(function () {
        state.phase = 'failed';
        state.errorMsg = '调用定位接口时异常：' + (e && e.name || '');
        state.errorHint = '请重试；若持续失败，可改用 Chrome 打开本页。';
        errorLog('getCurrentPosition 同步抛错:', e);
        render();
      });
    }
  }

  /** 汇总为可复制文本，便于回传五机型结果 */
  function buildReport() {
    var env = state.env || detectEnv();
    var r = state.result;
    var lines = [];
    lines.push('【定位能力检测】');
    lines.push('结论: ' + (function () {
      if (state.phase === 'success') return '定位可用 ✅';
      if (state.phase === 'hung') return '无响应（超时）⚠️';
      if (state.phase === 'failed') return '定位失败 ❌';
      return state.phase;
    })());
    lines.push('设备: ' + env.vendorName);
    lines.push('运行模式: ' + (env.standalone ? 'standalone(桌面图标)' : '浏览器内'));
    lines.push('安全上下文: ' + (env.secure ? 'HTTPS' : '非HTTPS'));
    if (r) {
      lines.push('坐标A(原始): ' + fmt(r.rawLng) + ', ' + fmt(r.rawLat));
      lines.push('坐标B(GCJ02): ' + fmt(r.gcjLng) + ', ' + fmt(r.gcjLat));
      lines.push('精度: ' + r.accuracy + ' m');
      lines.push('耗时: ' + r.elapsed + ' ms');
      var off = distanceMeters(r.rawLng, r.rawLat, r.gcjLng, r.gcjLat);
      if (off != null) lines.push('A/B 相差: ' + off + ' m');
    }
    if (state.errorMsg) lines.push('错误: ' + state.errorMsg);
    lines.push('UA: ' + env.ua);
    return lines.join('\n');
  }

  function copyReport() {
    var text = buildReport();
    function done() { log('检测结果已复制'); return true; }
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      } catch (e) { warn('复制失败:', e); return false; }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else { fallback(); }
    } catch (e) { fallback(); }
    return text;
  }

  // ============================================================
  // ============ 交互 ==========================================
  // ============================================================

  function onRootClick(e) {
    var t = e.target;
    // 链接（<a>）不拦截，交给浏览器处理
    while (t && t !== document) {
      if (t.tagName === 'A') return;
      if (t.getAttribute && t.getAttribute('data-gc-act')) break;
      t = t.parentNode;
    }
    var act = null;
    t = e.target;
    while (t && t !== document) {
      if (t.getAttribute && t.getAttribute('data-gc-act')) { act = t.getAttribute('data-gc-act'); break; }
      t = t.parentNode;
    }
    if (!act) {
      if (e.target && e.target.id === MASK_ID) close();
      return;
    }
    try {
      if (act === 'close') close();
      else if (act === 'check') startCheck();
      else if (act === 'copy') {
        var btn = null;
        try {
          btn = e.target.getAttribute && e.target.getAttribute('data-gc-act') ? e.target : e.target.parentNode;
        } catch (_) {}
        copyReport();
        if (btn && btn.tagName === 'BUTTON') {
          var old = btn.textContent;
          btn.textContent = '已复制 ✓';
          setTimeout(function () { try { btn.textContent = old; } catch (_) {} }, 1500);
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
      state.env = detectEnv();   // 每次打开重算，避免长时间缓存
      var root = ensureSheet();
      if (!root) { errorLog('浮层创建失败'); return; }
      state.phase = 'idle';
      state.errorMsg = '';
      state.errorHint = '';
      state.result = null;
      render();
      openSheetDom();
      state.sheetOpen = true;
      log('open; platform=' + state.env.platform +
          '; hasAPI=' + state.env.hasAPI +
          '; secure=' + state.env.secure +
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
          '; standalone=' + state.env.standalone +
          '; convertFn=' + (typeof wgs84ToGcj02 === 'function'));
    } catch (e) {
      errorLog('init 失败:', e);
    }
  }

  window.GeoCheckPanel = {
    open: open,
    close: close,
    isSupported: function () { try { return geoSupported(); } catch (_) { return false; } },
    getEnv: function () { try { return detectEnv(); } catch (_) { return null; } },
    getReport: function () { try { return buildReport(); } catch (_) { return ''; } }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
