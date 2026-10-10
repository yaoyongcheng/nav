/**
 * 相机 / 照片 / 视频采集模块 v1.0.0（五平台适配：iOS / 华为 / 小米 / vivo / OPPO）
 *
 * 职责：
 *   - 首页「📷 拍照录像」按钮（login.html #qa-camera）打开采集浮层
 *   - 三级降级采集：
 *       Level 1  getUserMedia 页面内实时预览（拍照 = canvas 截帧；录像 = MediaRecorder）
 *       Level 2  <input type="file" capture="environment"> 调系统相机 App
 *       Level 3  <input type="file" accept="image/*|video/*"> 系统文件选择器
 *   - 采集后**仅本地预览**（不上传 / 不入离线队列 / 不写 localStorage / 不写 IndexedDB）
 *   - **保存到系统相册**（仅对 Level 1 页面内采集的内容开放，见 saveToAlbum）：
 *       Level 1  navigator.share({files})  唯一能进相册的 Web 路径（iOS 15+ / Chrome 76+）
 *       Level 2  <a download>              Android 保底 →「下载」目录
 *       Level 3  长按预览图                五端都有的手工保底（UI 恒定提示）
 *     ⚠️ Web 平台没有静默写入相册的 API，最终都要用户在系统面板里点一次「保存到相册」。
 *        走 Level 2/3 采集到的文件本身已在相册里，因此不提供保存按钮。
 *
 * 依赖：无硬依赖。若 window.PWAInstall 存在则复用其 getPlatform()（13 个平台分支）；
 *       不存在时内部回退为 'unknown'，因此本模块可原样挂到 index.html 的 .map-controls。
 *
 * 用法：
 *   <script src="js/camera-capture.js"></script>
 *   <script>CameraCapture.open()</script>   // 也可以手动调
 *
 * 调试：控制台执行 CameraCapture.getCapability() 查看能力检测结果
 *
 * ── 五平台已核实的坑（本文件的每条防御都对应其中之一，改动前请先读）────────────
 *   iOS    · getUserMedia 在 PWA standalone 需 iOS 14.3+（WKWebView 才开放）
 *          · WebKit Bug 273938：standalone 下可能「有 stream 无画面」→ 见 checkVideoFrames()
 *          · WebKit Bug 212040：standalone 下路由切换会把 track 打成 muted → 见 visibilitychange
 *          · MediaRecorder 只支持 video/mp4，不支持 webm → 见 pickMimeType()
 *   华为   · 「坚盾守护模式」直接禁用 getUserMedia，抛 advancedSecurityMode → 见 mapMediaError()
 *          · permissions.query({name:'camera'}) 是已知 BUG 永远返回 denied
 *            → 本模块**刻意不调用它**，一律以 getUserMedia 实际抛错为准
 *          · 浏览器是系统应用，默认可能选中长焦摄像头 → 显式 facingMode: 'environment'
 *   国产ROM· 华为/小米/vivo/OPPO 普遍静默剥离 capture 属性 → 降级为文件选择器（不报错）
 *            「忽略 capture」≠「不能拍照」，选择器里仍有「相机」入口。因此用平台预判 + 文案
 *            提示，而不是「N 毫秒无 change 事件就判失败」的行为试探（用户拍照要好几秒，会误判）
 * ────────────────────────────────────────────────────────────────
 */
(function () {
  'use strict';

  // ============ 常量 ============

  var ROOT_ID = 'cam-root';
  var BODY_ID = 'cam-body';

  // 浮层层级必须高于 pwa-install.css 的 mask 9999 / sheet 10000，
  // 否则 pwa-install.js 在页面加载 3s 后自动弹出的安装引导会盖住相机浮层。
  var Z_MASK = 10001;
  var Z_SHEET = 10002;

  var STREAM_TIMEOUT = 8000;         // getUserMedia 多久没结果就判失败（见 startLive 注释）
  var BLACK_SCREEN_TIMEOUT = 2500;   // 拿到 stream 后多久没画面就判失败（WebKit 273938）
  var MAX_RECORD_MS = 60000;         // 录像上限 60s，避免 blob 撑爆内存
  var RECORD_SLICE_MS = 1000;        // MediaRecorder 分片间隔

  // mimeType 探测优先级：mp4 放最前 —— iOS 只支持 mp4，且 mp4 通用性最好。
  // Android Chrome 以 webm 为主（Chromium 111+ 才有 mp4），故 webm 作为后续候选。
  var VIDEO_MIME_CANDIDATES = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264',
    'video/webm'
  ];

  var PLATFORM_HINTS = {
    'ios-safari': '若提示「允许访问相机」，请选择「允许」。录像将以 MP4 格式保存。',
    'ios-other': '当前不是 Safari，摄像头功能可能受限，建议用 Safari 打开本页。',
    'huawei-harmony': '若无法打开摄像头，请检查「设置 → 隐私和安全 → 坚盾守护模式」是否开启 —— 该模式会禁用网页摄像头。',
    'xiaomi': '小米浏览器可能不响应「直接打开相机」，会改为弹出选择器，请在其中选择「相机」。',
    'oppo': 'OPPO 浏览器可能不响应「直接打开相机」，会改为弹出选择器，请在其中选择「相机」。',
    'vivo': 'vivo 浏览器可能不响应「直接打开相机」，会改为弹出选择器，请在其中选择「相机」。',
    'in-app': '当前在 App 内打开，摄像头可能受限，建议在系统浏览器中打开本页。',
    '_default': '若未直接打开相机，会在选择器中出现「相机」入口，请从中选择。'
  };

  // ============ 运行时状态 ============

  var _initialized = false;

  // 会话令牌：每次 startLive 递增。用于丢弃「陈旧」的异步回调 ——
  // getUserMedia 可能在用户已经点了「返回」/ 关闭浮层之后才 resolve，
  // 此时若无条件接管，会把已经切走的界面拽回错误态、或覆盖新会话的 stream。
  var _sid = 0;

  var state = 'idle';        // idle | live | preview | interrupted | error
  var kind = 'photo';        // photo | video —— 当前会话类型
  var facing = 'environment';// environment | user

  var stream = null;         // 当前 MediaStream
  var videoEl = null;        // 当前 <video> 元素引用
  var blackScreenTimer = null;

  var recorder = null;
  var chunks = [];
  var recordTimer = null;
  var recordStartTs = 0;
  var recordAborted = false;

  var lastResult = null;     // { type, blob, mime, url, size, ts } —— 仅内存，不持久化
  var lastError = null;      // 最近一次失败原因文本，供 error 态渲染
  var flipRevertTo = null;   // 前后摄切换失败时回滚的目标，null 表示无待回滚切换

  // ============ 日志（项目约定：所有 console 调用包 try/catch）============

  function log() {
    try { console.log.apply(console, ['[Cam]'].concat(Array.prototype.slice.call(arguments))); } catch (_) {}
  }
  function warn() {
    try { console.warn.apply(console, ['[Cam]'].concat(Array.prototype.slice.call(arguments))); } catch (_) {}
  }
  function errorLog() {
    try { console.error.apply(console, ['[Cam]'].concat(Array.prototype.slice.call(arguments))); } catch (_) {}
  }

  // ============ 工具 ============

  // 项目约定：凡 innerHTML 拼接动态文本必须先转义（照抄 js/pwa-install.js:140-144）
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isSecureEnv() {
    try {
      if (window.isSecureContext) return true;
    } catch (_) {}
    var h = location.hostname;
    return location.protocol === 'https:' || h === 'localhost' || h === '127.0.0.1';
  }

  function detectPlatformSafe() {
    try {
      if (window.PWAInstall && typeof window.PWAInstall.getPlatform === 'function') {
        return window.PWAInstall.getPlatform();
      }
    } catch (_) {}
    return 'unknown';
  }

  function pickMimeType() {
    if (typeof window.MediaRecorder === 'undefined') return '';
    if (typeof window.MediaRecorder.isTypeSupported !== 'function') return '';
    for (var i = 0; i < VIDEO_MIME_CANDIDATES.length; i++) {
      try {
        if (window.MediaRecorder.isTypeSupported(VIDEO_MIME_CANDIDATES[i])) {
          return VIDEO_MIME_CANDIDATES[i];
        }
      } catch (_) {}
    }
    return '';
  }

  function detectMediaCapability() {
    var hasGUM = !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
    var secure = isSecureEnv();
    return {
      platform: detectPlatformSafe(),
      secureContext: secure,
      hasGetUserMedia: hasGUM,
      hasMediaRecorder: typeof window.MediaRecorder !== 'undefined',
      supportedMime: pickMimeType(),
      // 能否走 Level 1（页面内实时采集）
      canLive: hasGUM && secure,
      // 保存到相册的能力探测（真机矩阵排查用）：
      //   hasWebShare      navigator.share 是否存在
      //   hasCanShareFiles navigator.canShare 是否存在（Web Share Level 2 前提）
      // 注意两者都存在也不保证分享面板里有「保存到相册」——那取决于系统，
      // 检测不到，只能靠真机验证。
      hasWebShare: typeof navigator.share === 'function',
      hasCanShareFiles: typeof navigator.canShare === 'function'
    };
  }

  function getHintText() {
    var p = detectPlatformSafe();
    return PLATFORM_HINTS[p] || PLATFORM_HINTS._default;
  }

  function formatClock(ms) {
    var total = Math.floor(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function showToast(text) {
    try {
      var t = document.createElement('div');
      t.className = 'cam-toast';
      t.textContent = text;
      document.body.appendChild(t);
      setTimeout(function () { try { t.remove(); } catch (_) {} }, 1800);
    } catch (_) {}
  }

  // ============ 资源释放（防摄像头指示灯常亮 / 内存泄漏）============

  function clearBlackScreenTimer() {
    if (blackScreenTimer) {
      clearTimeout(blackScreenTimer);
      blackScreenTimer = null;
    }
  }

  function releaseStream() {
    clearBlackScreenTimer();
    if (videoEl) {
      try { videoEl.pause(); } catch (_) {}
      try { videoEl.srcObject = null; } catch (_) {}
      videoEl = null;
    }
    if (stream) {
      try {
        stream.getTracks().forEach(function (t) {
          try { t.stop(); } catch (_) {}
        });
      } catch (e) { warn('releaseStream 失败:', e && e.name); }
      stream = null;
    }
  }

  function releaseObjectUrl() {
    if (lastResult && lastResult.url) {
      try { URL.revokeObjectURL(lastResult.url); } catch (_) {}
      lastResult.url = '';
    }
  }

  function stopRecordTimer() {
    if (recordTimer) {
      clearInterval(recordTimer);
      recordTimer = null;
    }
  }

  // ============ 浮层 DOM（幂等注入，照抄 js/pwa-install.js:1522-1556 的 ensureXxx 模式）============

  function ensureSheet() {
    var existing = document.getElementById(ROOT_ID);
    if (existing) return existing;

    var root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = ''
      + '<div class="cam-mask" id="cam-mask" style="z-index:' + Z_MASK + '"></div>'
      + '<div class="cam-sheet" id="cam-sheet" role="dialog" aria-modal="true" aria-labelledby="cam-title" style="z-index:' + Z_SHEET + '">'
      +   '<button type="button" class="cam-close" data-cam-act="close" aria-label="关闭">✕</button>'
      +   '<div class="cam-sheet-inner">'
      +     '<h2 class="cam-title" id="cam-title">拍照 / 录像</h2>'
      +     '<p class="cam-hint" id="cam-hint"></p>'
      +     '<div class="cam-body" id="' + BODY_ID + '"></div>'
      +   '</div>'
      + '</div>';

    // 事件委托：绑在根节点上，这样 render() 重写 innerHTML 不会丢事件，
    // 也避免每次重渲染都重新 addEventListener。
    root.addEventListener('click', onRootClick);

    try {
      document.body.appendChild(root);
    } catch (e) {
      errorLog('appendChild 失败:', e);
      return null;
    }
    return root;
  }

  function isOpen() {
    var sheet = document.getElementById('cam-sheet');
    return !!(sheet && sheet.classList.contains('is-open'));
  }

  function openSheetDom() {
    var mask = document.getElementById('cam-mask');
    var sheet = document.getElementById('cam-sheet');
    if (!mask || !sheet) return;
    // 双 rAF 等 layout 后再加 is-open，让 CSS 动画能真正触发
    // （项目既有写法，见 js/pwa-install.js:1162-1173；这不是 rAF 循环）
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
    var mask = document.getElementById('cam-mask');
    var sheet = document.getElementById('cam-sheet');
    try {
      if (mask) mask.classList.remove('is-open');
      if (sheet) sheet.classList.remove('is-open');
    } catch (_) {}
  }

  // ============ 渲染 ============

  function setState(next) {
    state = next;
    log('state →', next);
  }

  function buildIdleBody() {
    return ''
      + '<div class="cam-actions">'
      +   '<button type="button" class="cam-action" data-cam-act="photo">'
      +     '<span class="cam-action-icon">📷</span>'
      +     '<span class="cam-action-label">拍照</span>'
      +     '<span class="cam-action-sub">打开相机</span>'
      +   '</button>'
      +   '<button type="button" class="cam-action" data-cam-act="video">'
      +     '<span class="cam-action-icon">🎥</span>'
      +     '<span class="cam-action-label">录像</span>'
      +     '<span class="cam-action-sub">最长 ' + (MAX_RECORD_MS / 1000) + ' 秒</span>'
      +   '</button>'
      +   '<button type="button" class="cam-action" data-cam-act="album">'
      +     '<span class="cam-action-icon">🖼️</span>'
      +     '<span class="cam-action-label">相册</span>'
      +     '<span class="cam-action-sub">选择已有</span>'
      +   '</button>'
      + '</div>';
  }

  function buildLiveBody() {
    var isVideo = (kind === 'video');
    return ''
      + '<div class="cam-stage">'
      +   '<video class="cam-video" id="cam-video" playsinline autoplay muted></video>'
      +   '<div class="cam-loading" id="cam-loading">正在开启摄像头…</div>'
      +   '<div class="cam-rec-badge" id="cam-rec-badge" hidden>'
      +     '<span class="cam-rec-dot"></span><span id="cam-rec-time">00:00</span>'
      +   '</div>'
      + '</div>'
      + '<div class="cam-controls">'
      +   (isVideo
            ? '<button type="button" class="cam-btn" id="cam-rec-toggle" data-cam-act="rec-start">⏺ 开始录制</button>'
            : '<button type="button" class="cam-btn" data-cam-act="shoot">📷 拍照</button>')
      +   '<button type="button" class="cam-btn-secondary" data-cam-act="flip" id="cam-flip">🔄 切换</button>'
      +   '<button type="button" class="cam-btn-secondary" data-cam-act="cancel-live">返回</button>'
      + '</div>';
  }

  function buildPreviewBody() {
    var isVideo = (lastResult && lastResult.type === 'video');
    // source：'live' = 页面内采集（getUserMedia 合成的 blob，相册里没有）
    //         'file' = 来自系统相机 / 相册选择（本身已经在手机里了）
    var isLive = (lastResult && lastResult.source === 'live');

    var media = isVideo
      ? '<video class="cam-video" id="cam-preview-video" src="' + escapeHtml(lastResult.url) + '" controls playsinline preload="metadata"></video>'
      : '<img class="cam-preview-img" id="cam-preview-img" src="' + escapeHtml(lastResult.url) + '" alt="拍摄预览">';
    var meta = '';
    if (lastResult) {
      meta = (isVideo ? '🎥 视频' : '🖼️ 照片')
        + ' · ' + escapeHtml(String(lastResult.mime || ''))
        + (lastResult.size ? ' · ' + formatSize(lastResult.size) : '');
    }

    // 只有页面内采集的内容才需要「保存到相册」——走系统相机 / 相册选择拿到的文件
    // 本来就已经在相册里，再给个保存按钮既是无用功，也会让用户以为没存上。
    var saveRow = isLive
      ? '<div class="cam-controls">'
      +   '<button type="button" class="cam-btn" data-cam-act="save">💾 保存到相册</button>'
      + '</div>'
      : '';

    // 长按保存提示：这是**五端都一定有**的保底路径，所以恒定显示在照片上。
    //   · iOS：16+ 有已知回归——**代码调用** share() 时分享面板缺少「存储图像」
    //     （WebKit Bug 255544，只影响图片；MP4 视频正常）。而页面里以 <img> 呈现时
    //     用户**长按**仍能存入照片 → 这条提示是 iOS 照片最可靠的路径。
    //   · Android：长按 → 「下载图片」同样可用，且不受 share 是否被 ROM 裁剪影响。
    var longPressHint = (isLive && !isVideo)
      ? '<p class="cam-note">' + (isIOSPlatform()
          ? '💡 若分享面板里没有「存储图像」，可长按上方图片直接存入照片。'
          : '💡 也可以长按上方图片，选择「下载图片」保存。') + '</p>'
      : '';

    var sourceNote = isLive
      ? '仅在本机处理，不会上传到服务器。'
      : '该文件来自系统相机／相册，本身已保存在手机中。';

    // 「保存到相册」存在时把它作为主按钮，完成降为次按钮，避免两个蓝色主按钮并列
    var doneBtn = isLive
      ? '<button type="button" class="cam-btn-secondary" data-cam-act="done">✅ 完成</button>'
      : '<button type="button" class="cam-btn" data-cam-act="done">✅ 完成</button>';

    return ''
      + '<div class="cam-stage">' + media + '</div>'
      + '<p class="cam-meta">' + meta + '</p>'
      + '<p class="cam-note">' + sourceNote + '</p>'
      + saveRow
      + longPressHint
      + '<div class="cam-controls">'
      +   '<button type="button" class="cam-btn-secondary" data-cam-act="retake">🔄 重拍</button>'
      +   doneBtn
      + '</div>';
  }

  function buildInterruptedBody() {
    return ''
      + '<div class="cam-fallback">'
      +   '<div class="cam-fallback-icon">⏸️</div>'
      +   '<div class="cam-fallback-title">摄像头已暂停</div>'
      +   '<div class="cam-fallback-reason">页面切到后台时系统会收回摄像头，这是正常行为。</div>'
      + '</div>'
      + '<div class="cam-controls">'
      +   '<button type="button" class="cam-btn" data-cam-act="reopen">▶️ 重新开启摄像头</button>'
      +   '<button type="button" class="cam-btn-secondary" data-cam-act="cancel-live">返回</button>'
      + '</div>';
  }

  function buildErrorBody() {
    return ''
      + '<div class="cam-fallback">'
      +   '<div class="cam-fallback-icon">⚠️</div>'
      +   '<div class="cam-fallback-title">无法在页面内打开摄像头</div>'
      +   '<div class="cam-fallback-reason">' + escapeHtml(lastError || '未知原因') + '</div>'
      + '</div>'
      + '<div class="cam-controls">'
      +   '<button type="button" class="cam-btn" data-cam-act="fallback-camera">📷 用系统相机拍摄</button>'
      +   '<button type="button" class="cam-btn-secondary" data-cam-act="fallback-file">🖼️ 从相册选择</button>'
      + '</div>'
      + '<div class="cam-controls">'
      +   '<button type="button" class="cam-btn-secondary" data-cam-act="retry-live">🔄 重试页面内采集</button>'
      + '</div>';
  }

  function buildBody() {
    switch (state) {
      case 'live':        return buildLiveBody();
      case 'preview':     return buildPreviewBody();
      case 'interrupted': return buildInterruptedBody();
      case 'error':       return buildErrorBody();
      default:            return buildIdleBody();
    }
  }

  function render() {
    var body = document.getElementById(BODY_ID);
    if (!body) return;

    var hint = document.getElementById('cam-hint');

    if (state === 'live' || state === 'preview') {
      // 采集/预览态不显示平台提示，避免干扰
      if (hint) hint.hidden = true;
    } else {
      if (hint) {
        hint.hidden = false;
        hint.textContent = getHintText();
      }
    }

    try {
      body.innerHTML = buildBody();
    } catch (e) {
      errorLog('render 失败:', e);
      return;
    }

    if (state === 'live') {
      videoEl = document.getElementById('cam-video');
    }

    if (state === 'preview') {
      // 预览失败兜底：HEIC（iOS「保留原片」）在桌面浏览器是破图，
      // 损坏/空 blob 的视频也一样。不给提示的话用户只看到裂图，不知道发生了什么。
      var media = document.getElementById('cam-preview-img') || document.getElementById('cam-preview-video');
      if (media) {
        var markBroken = function () {
          var note = document.querySelector('.cam-note');
          if (note) note.textContent = '⚠️ 已成功选取，但该格式无法在当前浏览器预览。';
        };
        media.addEventListener('error', markBroken);
        // 图片可能在监听器挂上之前就已失败
        if (media.tagName === 'IMG' && media.complete && media.naturalWidth === 0) markBroken();
      }
    }
  }

  // 录像中的局部更新，不重建 innerHTML（重建会丢掉 <video> 的 srcObject）
  function updateRecordingUI() {
    var badge = document.getElementById('cam-rec-badge');
    var btn = document.getElementById('cam-rec-toggle');
    var recording = !!(recorder && recorder.state === 'recording');
    if (badge) badge.hidden = !recording;
    if (btn && recording) {
      btn.setAttribute('data-cam-act', 'rec-stop');
      btn.classList.add('is-recording');
      btn.textContent = '⏹ 停止录制';
    } else if (btn) {
      btn.setAttribute('data-cam-act', 'rec-start');
      btn.classList.remove('is-recording');
      btn.textContent = '⏺ 开始录制';
    }
  }

  function hideLoading() {
    var el = document.getElementById('cam-loading');
    if (el) el.hidden = true;
  }

  // ============ Level 1：getUserMedia 实时采集 ============

  /**
   * ⚠️ 必须从**同步的 click handler** 里调用（项目 v1.6.10 铁律，
   *    见 js/push-subscribe.js:797-882 / VERSION.md:70-72）。
   *    本函数同步发起 getUserMedia —— 前置不能有任何 await，
   *    否则 iOS 视为「已超出用户手势窗口」而静默拒绝。
   */
  function requestStream(k, facingMode) {
    var videoConstraint = {
      // 显式指定后摄：华为浏览器是系统应用，摄像头按顺序枚举，
      // 不指定时可能选中长焦摄像头且无法对焦。
      facingMode: { ideal: facingMode === 'user' ? 'user' : 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    };

    // ⚠️ 刻意**先只申请视频**，音频另行单独申请（见 attachAudioBestEffort）。
    //    原因：{video, audio} 合并申请在音频侧出问题时会把整个 Promise 拖住 ——
    //    实测 headless Chromium 下 audio:true 会永久 pending（既不 resolve 也不
    //    reject），真机上麦克风权限弹窗未响应、部分 Android WebView 回调丢失
    //    也是同样表现。拆开后视频不受音频影响，麦克风被拒/超时只损失声音。
    var p;
    try {
      // ← 同步调用，不 await
      p = navigator.mediaDevices.getUserMedia({ video: videoConstraint, audio: false });
    } catch (e) {
      return Promise.reject(e);
    }

    if (k !== 'video') return p;

    return p.then(function (stream) {
      attachAudioBestEffort(stream);
      return stream;   // 立即返回，不等音频
    });
  }

  /**
   * 尽力把音频轨挂到已有 stream 上。
   * 成功 → 录像带声音；失败 / 超时 / 用户拒绝 → 静默降级为纯画面，不影响预览与录制。
   */
  function attachAudioBestEffort(stream) {
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      warn('音频获取超时，本次仅录制画面');
    }, 5000);

    function finish(ok, aStream, errName) {
      if (done) {
        // 已超时：把迟到的音频轨放掉
        if (aStream) { try { aStream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} }); } catch (_) {} }
        return;
      }
      done = true;
      clearTimeout(timer);
      if (ok && aStream) {
        try {
          aStream.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
          log('音频轨已挂载');
        } catch (e) { warn('addTrack 失败:', e && e.name); }
      } else if (errName) {
        warn('音频获取失败（' + errName + '），本次仅录制画面');
      }
    }

    try {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (aStream) {
        finish(true, aStream, null);
      }, function (err) {
        finish(false, null, err && err.name);
      });
    } catch (e) {
      finish(false, null, e && e.name);
    }
  }

  /**
   * 校验 stream 真的出画面了。
   * 针对 WebKit Bug 273938（iOS 17.4.1~17.6.1，standalone PWA 下摄像头流无画面，
   * 只发 loadstart/suspend，同版本 Safari 浏览器内却正常）。
   */
  function checkVideoFrames(video, onOk, onFail) {
    clearBlackScreenTimer();
    var settled = false;

    function settleOk() {
      if (settled) return;
      settled = true;
      clearBlackScreenTimer();
      onOk();
    }
    function settleFail(name) {
      if (settled) return;
      settled = true;
      clearBlackScreenTimer();
      onFail({ name: name });
    }

    blackScreenTimer = setTimeout(function () {
      settleFail('NoVideoFrames');
    }, BLACK_SCREEN_TIMEOUT);

    function probe() {
      if (settled) return;
      // 等两帧再读，避免 loadedmetadata 时尺寸还是 0
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (settled) return;
          // ⚠️ 只看 videoWidth 会**漏报**：loadedmetadata 一解析完尺寸就有了，
          //    但此时可能一帧都没解出来。必须同时要求
          //    readyState >= 2（HAVE_CURRENT_DATA，真的解出了一帧）。
          //    不加这条时，iOS 上 play() 被拒 → 撤掉 loading 遮罩 → 用户盯着黑框，
          //    而且永远等不到错误提示。
          if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
            settleOk();
          }
          // 尺寸/数据未就绪则交给超时兜底
        });
      });
    }

    video.addEventListener('loadedmetadata', probe);
    video.addEventListener('playing', probe);
    video.addEventListener('error', function () { settleFail('VideoElementError'); });
  }

  function startLive(k, ev) {
    if (ev) { try { ev.preventDefault(); } catch (_) {} }
    kind = k;

    var cap = detectMediaCapability();
    if (!cap.canLive) {
      lastError = !cap.secureContext
        ? '当前不是 HTTPS 安全环境，浏览器不允许访问摄像头。请用 https:// 打开本页。'
        : '当前浏览器不支持网页摄像头（getUserMedia 不可用）。';
      releaseStream();
      setState('error');
      render();
      return;
    }
    if (k === 'video' && !cap.hasMediaRecorder) {
      lastError = '当前浏览器不支持网页录像（MediaRecorder 不可用），请改用系统相机录制。';
      setState('error');
      render();
      return;
    }

    chunks = [];
    recordAborted = false;
    setState('live');
    render();  // ← 同步：先把「正在开启摄像头」和 <video> 建出来

    // ← 同步发起 getUserMedia。不要在这之前插入任何 await / 定时器。
    var sid = ++_sid;   // 本次会话令牌

    // ⚠️ 必须带超时：getUserMedia 存在「既不 resolve 也不 reject」的挂起场景
    //    （实测 headless Chromium 下合并申请 audio 会永久 pending；真机上权限
    //    弹窗未响应、部分 Android WebView 回调丢失也会这样）。没有超时保护时
    //    界面会永远停在「正在开启摄像头…」，用户只能关掉浮层 —— 这是死路。
    var timer = setTimeout(function () {
      if (sid !== _sid) return;
      warn('getUserMedia 超时（' + STREAM_TIMEOUT + 'ms），按失败处理');
      _sid++;   // 让迟到的 resolve 作废
      onStreamFail({ name: 'TimeoutError' });
    }, STREAM_TIMEOUT);

    requestStream(k, facing).then(function (s) {
      if (sid !== _sid) {
        // 用户已返回 / 已开新会话 / 已超时 —— 把这个迟到的 stream 还回去，
        // 否则摄像头被悄悄占用、指示灯常亮，且会覆盖新会话的 stream 引用。
        try { s.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} }); } catch (_) {}
        warn('丢弃陈旧 stream（会话已切换）');
        return;
      }
      clearTimeout(timer);
      onStreamReady(s);
    }, function (err) {
      if (sid !== _sid) return;
      clearTimeout(timer);
      onStreamFail(err);
    });
  }

  function onStreamReady(s) {
    stream = s;
    if (!videoEl) videoEl = document.getElementById('cam-video');
    if (!videoEl) {
      warn('未找到 <video> 节点，放弃本次采集');
      releaseStream();
      setState('error');
      lastError = '页面结构异常，未找到预览节点。';
      render();
      return;
    }

    try { videoEl.srcObject = s; } catch (e) { warn('设置 srcObject 失败:', e && e.name); }

    checkVideoFrames(videoEl, function onOk() {
      flipRevertTo = null;   // 出画面了 → 本次切换成功，不再回滚
      hideLoading();
      var tp = document.getElementById('cam-tap-play');
      if (tp) tp.remove();
      log('实时预览就绪');
    }, function onFail(err) {
      warn('无画面，降级:', err && err.name);
      releaseStream();
      lastError = mapMediaError(err);
      setState('error');
      render();
    });

    var playP = videoEl.play();
    if (playP && typeof playP.catch === 'function') {
      playP.catch(function (e) {
        // iOS 自动播放策略可能拒绝。不能只 warn —— 那样用户会盯着黑框且
        // 没有任何提示（配合上面的 readyState 判据会走到超时 → error 态）。
        // 这里补一个「点击开始预览」覆盖层，让用户用手势再放一次。
        warn('video.play() 被拒:', e && e.name);
        showTapToPlay();
      });
    }
  }

  // play() 被自动播放策略拒绝时的兜底覆盖层
  function showTapToPlay() {
    var stage = document.querySelector('#cam-body .cam-stage');
    if (!stage || document.getElementById('cam-tap-play')) return;
    var el = document.createElement('button');
    el.type = 'button';
    el.id = 'cam-tap-play';
    el.className = 'cam-tap-play';
    el.textContent = '▶ 点击开始预览';
    el.setAttribute('data-cam-act', 'tap-play');
    try { stage.appendChild(el); } catch (_) {}
  }

  function onStreamFail(err) {
    errorLog('getUserMedia 失败:', err && err.name, err && err.message);
    // 切换前后摄失败 → 回滚 facing，保持内部状态与用户实际看到的画面一致
    if (flipRevertTo) {
      facing = flipRevertTo;
      flipRevertTo = null;
      warn('切换摄像头失败，回滚为 ' + facing);
    }
    releaseStream();
    lastError = mapMediaError(err);
    setState('error');
    render();
  }

  // ============ Level 1：拍照（canvas 截帧）============

  function shootPhoto() {
    if (!videoEl || !videoEl.videoWidth) {
      warn('画面尚未就绪，无法拍照');
      showToast('⚠️ 画面尚未就绪，请稍候再试');
      return;
    }
    var w = videoEl.videoWidth;
    var h = videoEl.videoHeight;
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    if (!ctx) {
      warn('canvas 2d 上下文不可用');
      showToast('⚠️ 当前设备不支持截帧');
      return;
    }
    try {
      ctx.drawImage(videoEl, 0, 0, w, h);
    } catch (e) {
      errorLog('drawImage 失败:', e);
      showToast('⚠️ 截帧失败');
      return;
    }

    function done(blob) {
      if (!blob) {
        warn('toBlob 返回空');
        showToast('⚠️ 截帧失败');
        return;
      }
      setResult({ type: 'photo', blob: blob, mime: blob.type || 'image/jpeg', source: 'live' });
      stopLiveAndGoPreview();
    }

    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob(function (blob) { done(blob); }, 'image/jpeg', 0.92);
    } else {
      // 极老内核兜底
      try {
        var dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        var parts = dataUrl.split(',');
        var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
        var bin = atob(parts[1]);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        done(new Blob([arr], { type: mime }));
      } catch (e) {
        errorLog('toDataURL 兜底失败:', e);
        showToast('⚠️ 截帧失败');
      }
    }
  }

  // ============ Level 1：录像（MediaRecorder）============

  function startRecording() {
    if (!stream || !window.MediaRecorder) return;

    var mime = pickMimeType();
    var rec = null;
    // 限码率：部分设备默认 8~12 Mbps，60s 就是 60~90MB 全压在 chunks 数组里，
    // iOS 上 WebContent 进程会直接被系统杀掉（表现为白屏，不是报错）。
    var recOpts = { videoBitsPerSecond: 2500000 };
    if (mime) recOpts.mimeType = mime;
    try {
      rec = new window.MediaRecorder(stream, recOpts);
    } catch (e) {
      warn('MediaRecorder 构造失败（mime=' + mime + '）:', e && e.name);
      try {
        rec = new window.MediaRecorder(stream);   // 不带 mimeType 再试一次
      } catch (e2) {
        errorLog('MediaRecorder 构造彻底失败:', e2);
        releaseStream();
        lastError = mapMediaError({ name: 'MediaRecorderUnsupported' });
        setState('error');
        render();
        return;
      }
    }

    chunks = [];
    recordAborted = false;

    rec.ondataavailable = function (e) {
      if (e && e.data && e.data.size) chunks.push(e.data);
    };
    rec.onerror = function (e) {
      errorLog('MediaRecorder error:', e && e.error);
      recordAborted = true;
      // 不能只 warn 后静默回 idle —— 用户需要知道为什么刚录的没了
      showToast('⚠️ 本机录像失败，请改用系统相机');
      stopRecording(true);
    };
    rec.onstop = function () { finalizeRecording(); };

    try {
      // isTypeSupported 返回 true 也不保证真能录（资源/编码器限制），
      // 所以这里必须 try/catch，且已挂 onerror 兜底。
      rec.start(RECORD_SLICE_MS);
    } catch (e) {
      errorLog('recorder.start 失败:', e);
      recorder = null;
      releaseStream();
      lastError = mapMediaError({ name: 'MediaRecorderUnsupported' });
      setState('error');
      render();
      return;
    }

    recorder = rec;
    recordStartTs = Date.now();
    stopRecordTimer();
    recordTimer = setInterval(function () {
      var elapsed = Date.now() - recordStartTs;
      var timeEl = document.getElementById('cam-rec-time');
      if (timeEl) timeEl.textContent = formatClock(elapsed);
      if (elapsed >= MAX_RECORD_MS) {
        log('达到最长录制时长，自动停止');
        stopRecording(false);
      }
    }, 500);

    updateRecordingUI();
    log('开始录制, mime=' + (rec.mimeType || mime || '(默认)'));
  }

  function stopRecording(aborted) {
    stopRecordTimer();
    if (!recorder) return;
    recordAborted = !!aborted;
    updateRecordingUI();
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch (e) {
      warn('recorder.stop 失败:', e && e.name);
      finalizeRecording();
    }
  }

  function finalizeRecording() {
    // 重入守卫：stopRecording 的 catch 分支和 onstop 都可能触发本函数，
    // 第二次进来时 recorder 已被置 null、chunks 已清空 → 会走「结果为空」
    // 分支把**已经进到 preview 的录像打回三宫格**（等于把刚录的视频丢了）。
    if (!recorder) return;

    stopRecordTimer();
    var mime = (recorder && recorder.mimeType) || pickMimeType() || 'video/webm';
    var blob = null;
    if (!recordAborted && chunks.length) {
      try {
        blob = new Blob(chunks, { type: mime });
      } catch (e) {
        errorLog('Blob 构造失败:', e);
      }
    }
    chunks = [];
    recorder = null;

    if (!blob || !blob.size) {
      warn('录制结果为空（aborted=' + recordAborted + '）');
      // 页面可能已被切后台 → 回到 idle，让用户重新选
      releaseStream();
      setState('idle');
      render();
      return;
    }

    setResult({ type: 'video', blob: blob, mime: mime, source: 'live' });
    stopLiveAndGoPreview();
  }

  // ============ 结果与状态切换 ============

  function setResult(r) {
    releaseObjectUrl();
    r.ts = Date.now();
    r.size = r.blob.size;
    r.url = '';
    try {
      r.url = URL.createObjectURL(r.blob);
    } catch (e) {
      errorLog('createObjectURL 失败:', e);
    }
    lastResult = r;
    log('采集完成:', r.type, r.mime, formatSize(r.size));
  }

  function stopLiveAndGoPreview() {
    releaseStream();
    setState('preview');
    render();
  }

  function cancelLive() {
    _sid++;   // 作废在途的 getUserMedia，防止迟到的 resolve 把界面拽回来
    stopRecordTimer();
    if (recorder) {
      recordAborted = true;
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_) {}
      recorder = null;
      chunks = [];
    }
    releaseStream();
  }

  function retake() {
    if (!lastResult) { setState('idle'); render(); return; }
    releaseObjectUrl();
    lastResult = null;
    var cap = detectMediaCapability();
    if (cap.canLive) {
      startLive(kind, null);
    } else {
      setState('idle');
      render();
    }
  }

  function flipCamera() {
    if (recorder && recorder.state === 'recording') {
      showToast('⚠️ 录制中无法切换摄像头');
      return;
    }
    // 先记下原值再翻转：切换失败时回滚，否则后续「重拍」会拿到错误的那颗摄像头
    // （iOS 上 facingMode 可能被忽略，画面没变但内部状态已经改了）。
    flipRevertTo = facing;
    facing = (facing === 'environment') ? 'user' : 'environment';
    log('切换摄像头 →', facing);
    cancelLive();
    startLive(kind, null);
  }

  // ============ Level 2 / 3：<input type="file"> 降级 ============

  /**
   * ⚠️ 必须在**用户手势的同步路径**里调用 —— iOS 会拦截非手势触发的 input.click()。
   *    因此降级**不能**在 getUserMedia 的 .catch 里自动执行，
   *    必须由用户在 error 态点「用系统相机拍摄」按钮来触发。
   */
  function openFileInput(useCapture, acceptOverride) {
    // 「相册」入口必须显式传 'image/*,video/*' —— 否则会沿用 kind 推出的
    // 'image/*'，导致相册里**选不到视频**（与模块头部声明的能力不符）。
    var accept = acceptOverride
      || (kind === 'photo' ? 'image/*' : (kind === 'video' ? 'video/*' : 'image/*,video/*'));
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    if (useCapture) {
      // 提示浏览器优先用摄像头。国产 ROM 普遍静默剥离该属性 →
      // 自然降级为文件选择器（其中仍有「相机」入口），不是错误路径。
      input.setAttribute('capture', 'environment');
    }
    // ⚠️ 不能 display:none —— 部分国产浏览器/Android WebView 对
    //    display:none 的 input.click() 会静默失败。用移出视口 + 透明代替。
    input.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;';

    try {
      document.body.appendChild(input);
    } catch (e) {
      errorLog('input 挂载失败:', e);
      return;
    }

    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      try { input.remove(); } catch (_) {}
    }

    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      cleanup();
      if (!f) return;
      onFilePicked(f);
    });

    // 用户取消选择时不会触发 change，留个兜底清理防 DOM 泄漏
    setTimeout(function () {
      if (!cleaned && (!input.files || !input.files.length)) cleanup();
    }, 120000);

    try {
      input.click();   // ← 同步，必须在手势内
    } catch (e) {
      errorLog('input.click 失败:', e);
      cleanup();
    }
  }

  function onFilePicked(file) {
    // 部分相机 App 在用户取消时会回传一个 0 字节文件 → 直接预览会出破图
    if (!file || !file.size) {
      warn('文件为空，忽略');
      showToast('⚠️ 文件为空，请重试');
      return;
    }
    var isVideo = /^video\//.test(file.type);
    var isImage = /^image\//.test(file.type);
    if (!isVideo && !isImage) {
      // 有些相机 App 回传的 type 为空，按当前 kind 兜底
      isVideo = (kind === 'video');
      isImage = !isVideo;
    }
    var type = isVideo ? 'video' : 'photo';
    // source='file'：来自系统相机 / 相册选择，本身已在手机里，不显示「保存到相册」
    setResult({ type: type, blob: file, mime: file.type || (isVideo ? 'video/*' : 'image/*'), source: 'file' });
    setState('preview');
    render();
  }

  // ============ 保存到系统相册（五平台分层降级）============
  //
  // 现实前提（不知道会误判成"没生效"）：
  //   · Web 平台**没有**直接写入相册的标准 API。唯一能进相册的路径是把文件交给
  //     系统分享面板，由用户在那里点「保存到相册 / 存储图像 / 存储视频」。
  //   · iOS 16+ 已知回归：**代码调用** share() 时分享面板缺少「存储图像」
  //     （WebKit Bug 255544，只影响图片；MP4 视频不受影响）→ 所以 iOS 照片额外
  //     保留「长按图片」这条并行路径。
  //   · iOS WebKit Bug 231995：走分享面板存图后 share() 的 Promise 可能**永不 resolve**，
  //     → 成功提示只是锦上添花，绝不能把必要收尾放在 then 里。
  //   · 国产 ROM（华为 / 小米 / vivo / OPPO）内核均为 Chromium 派生，share({files})
  //     大概率存在；缺失时退到 <a download> → 「下载」目录（Android 相册通常能索引到，
  //     但**不保证**出现在「相机胶卷」里）。
  //
  // 降级顺序：
  //   Level 1  navigator.share({ files:[file] })   唯一能进相册的路径
  //   Level 2  <a download>                        Android 保底 →「下载」目录
  //   Level 3  长按预览图                          五端都有的手工保底（UI 恒定提示）

  function isIOSPlatform() {
    var p = detectPlatformSafe();
    return p === 'ios-safari' || p === 'ios-other';
  }

  /**
   * 取裸 MIME 类型（去掉 ;codecs=... 参数）。
   * ⚠️ 交给系统的 File.type 必须是裸类型：MediaRecorder 给的 mimeType 形如
   *    'video/mp4;codecs=avc1.42001f,mp4a.40.2'，直接当 File.type 会让
   *    系统分享面板的 MIME 匹配认不出来，可能不给「存储视频」之类的目标。
   *    Blob 自身保留完整 mime 不变（预览播放需要它）。
   */
  function baseMime(mime) {
    return String(mime || '').split(';')[0].trim();
  }

  function buildFileName(r) {
    var d = new Date();
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
      + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    var mime = String(r.mime || '');
    var ext;
    if (r.type === 'video') {
      ext = /webm/i.test(mime) ? 'webm' : 'mp4';
    } else {
      ext = /png/i.test(mime) ? 'png' : 'jpg';
    }
    return '工地导航_' + stamp + '.' + ext;
  }

  /**
   * 同步构造 File。
   * ⚠️ 必须在 click 的**同步路径**里完成：navigator.share() 要求 transient user
   *    activation，点击后再 await 任何东西（哪怕只是把 blob 转 File 的异步封装）
   *    都会耗尽激活窗口并抛 NotAllowedError。
   */
  function buildFileForSave(r) {
    var type = baseMime(r.mime) || (r.type === 'video' ? 'video/mp4' : 'image/jpeg');
    return new File([r.blob], buildFileName(r), { type: type });
  }

  function saveToAlbum() {
    if (!lastResult || !lastResult.blob) {
      showToast('⚠️ 没有可保存的内容');
      return;
    }

    var file;
    try {
      file = buildFileForSave(lastResult);   // ← 同步，保住用户手势
    } catch (e) {
      errorLog('构造 File 失败:', e);
      showToast('⚠️ 保存失败，请重试');
      return;
    }

    var canShareFiles = false;
    try {
      canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    } catch (_) {}
    // canShare 存在但返回 false，或干脆没有 —— 都不代表 share 一定不行，
    // 但按标准它是最可靠的特性检测，尊重它的结论直接走保底。
    if (canShareFiles && typeof navigator.share === 'function') {
      var p;
      try {
        // ⚠️ 只传 files。带上 title / text / url 会让 iOS 把这次分享当成
        //    「分享文本或链接」，分享面板里的「存储图像」选项会消失。
        p = navigator.share({ files: [file] });
      } catch (e) {
        warn('share 同步抛错:', e && e.name);
        fallbackToDownload(file);
        return;
      }
      if (p && typeof p.then === 'function') {
        p.then(function () {
          // iOS Bug 231995 下这里可能永不执行 —— 所以不放任何必要逻辑
          showToast('✅ 已交给系统保存');
        }, function (err) {
          var name = (err && err.name) || '';
          // 用户主动取消 / 面板还没关时重复点击 → 都不算失败，别打扰用户
          if (name === 'AbortError' || name === 'InvalidStateError') return;
          warn('分享失败，走下载兜底:', name);
          fallbackToDownload(file);
        });
      }
      return;
    }

    fallbackToDownload(file);
  }

  function fallbackToDownload(file) {
    if (isIOSPlatform()) {
      // iOS 上 <a download> 只能落到「文件」App、进不了「照片」；而且已安装的
      // 独立窗口 PWA 里 download 常常根本无法完成（会停在没有浏览器控件的裸文档视图）。
      // 所以 iOS 不试下载，直接指向确定可用的长按路径。
      showToast((lastResult && lastResult.type === 'video')
        ? '⚠️ 本机无法直接存入相册，请改用系统相机录制'
        : '⚠️ 请长按上方图片，选择「存储到照片」');
      return;
    }

    var url = '';
    try {
      url = URL.createObjectURL(file);
      var a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.rel = 'noopener';
      a.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        try { a.remove(); } catch (_) {}
        try { URL.revokeObjectURL(url); } catch (_) {}
      }, 15000);
      showToast('📥 已保存到「下载」，可在相册的下载目录中查找');
    } catch (e) {
      errorLog('下载兜底失败:', e);
      if (url) { try { URL.revokeObjectURL(url); } catch (_) {} }
      showToast('⚠️ 保存失败，请长按图片保存');
    }
  }

  // ============ 错误映射 ============

  function mapMediaError(err) {
    var name = (err && err.name) || '';
    var msg = (err && err.message) || '';

    // 华为/鸿蒙「坚盾守护模式」：ArkWeb 直接禁用 getUserMedia
    if (/advancedSecurityMode/i.test(msg)) {
      return '鸿蒙「坚盾守护模式」已开启，该模式会禁用网页摄像头。请到「设置 → 隐私和安全 → 坚盾守护模式」中关闭后重试，或改用系统相机。';
    }

    switch (name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return '相机权限被拒绝。请在浏览器或系统设置中允许本站访问相机后重试。';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return '未找到可用摄像头。';
      case 'NotReadableError':
      case 'TrackStartError':
        return '摄像头被其他应用占用，请关闭其他正在使用相机的应用后重试。';
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return '摄像头不支持所需参数，请尝试切换前后摄像头。';
      case 'SecurityError':
        return '当前环境不安全，需要 https:// 才能访问摄像头。';
      case 'AbortError':
        return '摄像头启动被中断，请重试。';
      case 'TimeoutError':
        return '摄像头启动超时，可能是权限弹窗未响应、设备被其他应用占用，或当前浏览器不支持。请重试，或改用系统相机。';
      case 'NoVideoFrames':
        return '摄像头已开启但没有画面 —— 这是 iOS 独立窗口 PWA 的已知问题。请改用系统相机拍摄，或用 Safari 打开本页。';
      case 'VideoElementError':
        return '预览画面加载失败，请重试或改用系统相机。';
      case 'MediaRecorderUnsupported':
        return '当前浏览器不支持网页录像，请改用系统相机录制。';
      default:
        return '无法打开摄像头' + (name ? '（' + name + '）' : '') + '，请改用系统相机。';
    }
  }

  // ============ 事件分发 ============

  function onRootClick(e) {
    var node = e.target;
    // closest 在极老内核可能缺失，降级为向上遍历
    var btn = null;
    if (node && node.closest) {
      btn = node.closest('[data-cam-act]');
    } else {
      while (node && node !== this) {
        if (node.getAttribute && node.getAttribute('data-cam-act')) { btn = node; break; }
        node = node.parentNode;
      }
    }
    if (!btn || btn.disabled) return;

    var act = btn.getAttribute('data-cam-act');
    try { e.preventDefault(); } catch (_) {}
    try { e.stopPropagation(); } catch (_) {}

    // ⚠️ 本分发函数必须保持**同步**：下面 photo/video 分支会一路同步走到
    //    navigator.mediaDevices.getUserMedia()。绝不能改成 async / 加 await。
    switch (act) {
      case 'photo':           startLive('photo', e); break;
      case 'video':           startLive('video', e); break;
      case 'album':
        openFileInput(false, 'image/*,video/*');   // 相册：照片和视频都能选
        break;
      case 'shoot':           shootPhoto(); break;
      case 'rec-start':       startRecording(); break;
      case 'rec-stop':        stopRecording(false); break;
      case 'flip':            flipCamera(); break;
      case 'tap-play': {
        var tapVideo = document.getElementById('cam-video');
        if (tapVideo) {
          var pp = tapVideo.play();
          if (pp && typeof pp.catch === 'function') {
            pp.catch(function (e) { warn('tap-play 仍失败:', e && e.name); });
          }
        }
        var tapBtn = document.getElementById('cam-tap-play');
        if (tapBtn) tapBtn.remove();
        break;
      }
      case 'cancel-live':     cancelLive(); setState('idle'); render(); break;
      case 'reopen':          startLive(kind, e); break;
      case 'retry-live':      startLive(kind, e); break;
      case 'fallback-camera': openFileInput(true); break;
      case 'fallback-file':   openFileInput(false); break;
      case 'save':            saveToAlbum(); break;
      case 'retake':          retake(); break;
      case 'done':
        log('完成（仅预览，不保存）');
        close();
        break;
      case 'close':           close(); break;
      default: break;
    }
  }

  // ============ 生命周期 ============

  function init() {
    if (_initialized) return;
    _initialized = true;

    // 页面切后台：iOS/Android 都会收回摄像头，同时可能掐断录制。
    // 保住已录片段，并把界面切到「已暂停」，由用户手势重新开启。
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) return;

      if (recorder) {
        // 有录制在跑：先停录，让 finalizeRecording 出结果（可能是空 → 自动回 idle）
        log('切后台，停止录制以保住已录片段');
        stopRecording(false);
        return;
      }

      if (state === 'live') {
        log('切后台，释放摄像头');
        releaseStream();
        setState('interrupted');
        if (isOpen()) render();
      }
    });

    // 页面卸载时彻底释放，防止摄像头指示灯常亮 + objectURL 泄漏
    window.addEventListener('pagehide', function () {
      cancelLive();
      releaseObjectUrl();
    });

    log('v1.0.0 loaded; capability =', JSON.stringify(detectMediaCapability()));
  }

  function open() {
    if (!_initialized) init();

    // 幂等：浮层已开时直接返回。
    // 否则在 live 态重复 open() 会把 state 打回 idle 并重写 innerHTML ——
    // <video> 被销毁但 stream 还活着，摄像头继续亮且没有任何停止入口。
    if (isOpen()) {
      log('浮层已打开，忽略重复 open()');
      return;
    }

    var cap = detectMediaCapability();
    if (!cap.canLive) {
      warn('Level 1 不可用:', JSON.stringify(cap));
    }

    // 撞层防御：pwa-install.js 会在页面加载 3s 后自动弹安装引导（z-index 9999/10000）。
    // 本浮层 z-index 更高（10001/10002）已在视觉上压住它；这里再把已经弹出的收掉。
    // 注意 dismissGuide() 只移除 DOM 节点、不写冷却（DISMISS_KEY 在 pwa-install.js:1045
    // 只写不读），所以 3s 定时器之后仍可能再弹一次 —— 属既有行为，不去改 pwa-install.js。
    try {
      if (window.PWAInstall && typeof window.PWAInstall.dismissGuide === 'function') {
        window.PWAInstall.dismissGuide();
      }
    } catch (_) {}

    var root = ensureSheet();
    if (!root) return;

    setState('idle');
    lastError = null;
    render();
    openSheetDom();

    log('opened; platform=' + detectPlatformSafe());
  }

  function close() {
    cancelLive();
    closeSheetDom();
    setState('idle');
    // 需求是「仅本地预览，不做任何保存」→ 关闭即释放。
    // 不保留 lastResult：录像 blob 可达数十 MB，常驻内存会给 iOS 带来压力，
    // 而全项目没有任何调用方需要它在关闭后继续存活。
    releaseObjectUrl();
    lastResult = null;
    log('closed');
  }

  // ============ 对外 API ============

  window.CameraCapture = {
    open: open,
    close: close,
    getCapability: detectMediaCapability,
    getPlatform: detectPlatformSafe,
    // 仅反映「浮层当前是否持有预览结果」；close() 后为 null（不保存是本模块的既定需求）
    getLastResult: function () { return lastResult; },
    // 调试用：清空结果并释放 objectURL
    clearResult: function () { releaseObjectUrl(); lastResult = null; }
  };

  // 自动初始化（项目约定三态写法，照抄 js/location-queue-ui.js:532-536）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
