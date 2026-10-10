/**
 * 视频悬浮球（左下角，红/橙色）
 * - 与表单悬浮球 (js/floating-ball.js) 并存，互不干扰
 * - 点击弹出全屏视频播放器
 * - 双协议播放策略：
 *    1. iPhone Safari / Mac Safari：原生 HLS
 *    2. Chrome / Edge / Firefox / Android：hls.js 解码 HLS
 *    3. 兜底：FMP4 直通反代
 *
 * 视频源（ZLMediaKit RTP 推流）：
 *   HLS:  /rtp/34020000001110000001_34020000001320000005/hls.m3u8?originTypeStr=rtp_push
 *   FMP4: /rtp/34020000001110000001_34020000001320000005.live.mp4?originTypeStr=rtp_push
 */
(function () {
  'use strict';

  const POSITION_KEY = 'fv_ball_position_v1';
  const STREAM_NAME = '34020000001110000001_34020000001320000005';
  const HLS_PROXY_URL = `/api/video/hls/${STREAM_NAME}/hls.m3u8`;
  const FMP4_PROXY_URL =
    `/api/video/stream?path=rtp%2F${STREAM_NAME}.live.mp4&originTypeStr=rtp_push`;

  // ============ 工具函数 ============
  function loadJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  // ============ 创建悬浮球 ============
  function createBall() {
    const ball = document.createElement('div');
    ball.className = 'fv-ball fv-pulse';
    ball.id = 'fv-ball';
    ball.innerHTML = '📹';
    ball.title = '点击播放监控视频';
    document.body.appendChild(ball);

    const savedPos = loadJSON(POSITION_KEY);
    if (savedPos && Number.isFinite(savedPos.x) && Number.isFinite(savedPos.y)) {
      ball.style.left = savedPos.x + 'px';
      ball.style.top = savedPos.y + 'px';
      ball.style.right = 'auto';
      ball.style.bottom = 'auto';
    }

    makeDraggable(ball, () => {
      snapToEdge(ball);
      savePosition(ball);
    });

    let dragMoved = false;
    ball.addEventListener('mousedown', () => { dragMoved = false; });
    ball.addEventListener('touchstart', () => { dragMoved = false; }, { passive: true });

    ball.addEventListener('click', () => {
      if (ball.dataset.dragged === '1') {
        ball.dataset.dragged = '';
        return;
      }
      openPlayer();
    });
    ball.addEventListener('touchend', (e) => {
      if (ball.dataset.dragged === '1') {
        ball.dataset.dragged = '';
        return;
      }
      e.preventDefault();
      setTimeout(openPlayer, 50);
    });

    return ball;
  }

  // ============ 拖拽实现 ============
  function makeDraggable(el, onEnd) {
    let startX, startY, origX, origY;
    let moved = false;
    function start(e) {
      const point = e.touches ? e.touches[0] : e;
      startX = point.clientX;
      startY = point.clientY;
      const rect = el.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;
      moved = false;
      el.classList.add('fv-dragging');
      e.preventDefault?.();
    }
    function move(e) {
      if (startX === undefined) return;
      const point = e.touches ? e.touches[0] : e;
      const dx = point.clientX - startX;
      const dy = point.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      let newX = origX + dx;
      let newY = origY + dy;
      newX = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, newX));
      newY = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, newY));
      el.style.left = newX + 'px';
      el.style.top = newY + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      e.preventDefault?.();
    }
    function end() {
      el.classList.remove('fv-dragging');
      if (moved) {
        el.dataset.dragged = '1';
        setTimeout(() => { el.dataset.dragged = ''; }, 100);
      }
      startX = startY = undefined;
      if (typeof onEnd === 'function') onEnd();
    }
    el.addEventListener('mousedown', start);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
    el.addEventListener('touchstart', start, { passive: false });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    el.addEventListener('dragstart', (e) => e.preventDefault());
  }
  function snapToEdge(el) {
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const snap = centerX < window.innerWidth / 2 ? 16 : window.innerWidth - rect.width - 16;
    el.style.transition = 'left 0.3s, top 0.3s';
    el.style.left = snap + 'px';
    setTimeout(() => { el.style.transition = ''; }, 300);
  }
  function savePosition(el) {
    const rect = el.getBoundingClientRect();
    saveJSON(POSITION_KEY, { x: rect.left, y: rect.top });
  }

  // ============ HLS.js 动态加载（多 CDN fallback） ============
  // 多 CDN 顺序：jsdelivr → unpkg → cdnjs
  // 任一可用即返回，保证弱网/4G 环境下 hls.js 能加载成功
  const HLSJS_CDN_LIST = [
    'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js',
    'https://unpkg.com/hls.js@1.5.13/dist/hls.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js',
  ];

  function tryLoadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => {
        if (window.Hls) resolve(window.Hls);
        else reject(new Error('脚本加载但 Hls 未挂载: ' + src));
      };
      s.onerror = () => reject(new Error('脚本加载失败: ' + src));
      document.head.appendChild(s);
    });
  }

  function loadHlsJs() {
    if (window.Hls) return Promise.resolve(window.Hls);
    // 顺序尝试 CDN，任一可用即返回
    return HLSJS_CDN_LIST.reduce(
      (p, src) => p.catch(() => tryLoadScript(src)),
      Promise.reject(new Error('hls.js 全部 CDN 不可用'))
    );
  }

  // ============ 视频播放器 ============
  function openPlayer() {
    if (document.getElementById('fv-player-root')) return;

    const root = document.createElement('div');
    root.id = 'fv-player-root';
    root.className = 'fv-player-root';
    root.innerHTML = `
      <div class="fv-player-header">
        <div class="fv-player-title">
          <span class="fv-dot"></span>
          <span>实时监控 · HLS</span>
        </div>
        <div class="fv-player-actions">
          <button class="fv-action-btn fv-fullscreen" id="fv-fs-btn" aria-label="全屏" title="全屏">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>
            </svg>
          </button>
          <button class="fv-action-btn fv-close" id="fv-close-btn" aria-label="关闭" title="关闭">×</button>
        </div>
      </div>
      <div class="fv-video-wrap">
        <div class="fv-video-box">
          <div class="fv-status fv-status-loading" id="fv-status">
            <div class="fv-spinner"></div>
            <div>正在连接视频源…</div>
          </div>
          <video id="fv-video"
                 autoplay
                 muted
                 playsinline
                 x5-playsinline
                 x5-video-player-type="h5"
                 webkit-playsinline></video>
          <!-- 自定义控件（绕开 iOS PWA native 全屏接管） -->
          <div class="fv-controls" id="fv-controls">
            <button class="fv-play-btn" id="fv-play-btn" aria-label="播放/暂停" title="播放/暂停">
              <svg class="fv-icon-pause" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1"/>
                <rect x="14" y="5" width="4" height="14" rx="1"/>
              </svg>
              <svg class="fv-icon-play" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" style="display:none;">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>
            <span class="fv-time" id="fv-time">00:00</span>
            <span class="fv-live-tag">
              <span class="fv-live-dot"></span>直播
            </span>
            <button class="fv-mute-btn" id="fv-mute-btn" aria-label="静音切换" title="静音切换">
              <svg class="fv-icon-vol" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
              </svg>
              <svg class="fv-icon-mute" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style="display:none;">
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.17v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="fv-source">源：${STREAM_NAME}（HLS 协议）</div>
      </div>
    `;
    document.body.appendChild(root);

    const videoEl = root.querySelector('#fv-video');
    const statusEl = root.querySelector('#fv-status');
    const playBtn = root.querySelector('#fv-play-btn');
    const muteBtn = root.querySelector('#fv-mute-btn');
    const fsBtn = root.querySelector('#fv-fs-btn');
    const timeEl = root.querySelector('#fv-time');
    let hlsInstance = null;

    // ============ 推流中断检测（被动事件驱动） ============
    // 思路：用浏览器原生 video 事件 + buffer 健康检查
    //      waiting/stalled → 缓冲耗尽在等待
    //      playing/canplay → 缓冲恢复可播放
    //      progress/timeupdate → 周期检查缓冲区间
    //      持续 30 秒缓冲耗尽 → 判定推流中断
    // 优势：零额外网络请求，不与 TS 切片下载争抢带宽；
    //      浏览器原生事件比主动 fetch 更准确反映播放状态。
    let stallSince = null;         // 缓冲耗尽的起始时间戳
    const STALL_TIMEOUT_MS = 30000;// 30 秒判定为推流中断
    let stallCheckTimer = null;    // 兜底超时检查 timer（每秒一次）

    // ============ 自动重试机制 ============
    // 触发：stall 超时 / hls.js 致命网络错误 / 原生 video error
    // 策略：指数退避 5→10→20→40→封顶 40，最多 8 次（约 4 分钟）
    //       成功恢复（loadedmetadata + playing）后重置计数
    //       用户点"停止重连"或关闭播放器立即终止
    const RETRY_DELAYS_MS = [5000, 10000, 20000, 40000]; // 后续封顶 40s
    const RETRY_MAX_COUNT = 8;
    let retryState = {
      count: 0,           // 已重试次数
      nextDelay: 0,       // 下一次延迟（ms）
      timer: null,        // setTimeout 句柄
      retrying: false,    // 是否处于"等待重试中"状态（影响 UI 展示）
      cancelled: false,   // 用户主动取消（关闭播放器或点"停止重连"）
    };

    function scheduleAutoRetry(reason) {
      // 用户已取消 → 不再自动重试
      if (retryState.cancelled) return;
      // 已达上限 → 停止自动重试，错误页保持显示，等待用户手动
      if (retryState.count >= RETRY_MAX_COUNT) {
        return;
      }
      // 计算本次延迟
      const idx = Math.min(retryState.count, RETRY_DELAYS_MS.length - 1);
      const delay = RETRY_DELAYS_MS[idx];
      retryState.count += 1;
      retryState.nextDelay = delay;
      retryState.retrying = true;

      // UI：展示倒计时 + 可取消按钮
      showRetryWaiting(reason, delay, retryState.count, RETRY_MAX_COUNT);

      retryState.timer = setTimeout(() => {
        retryState.timer = null;
        if (retryState.cancelled) return;
        doRetry();
      }, delay);
    }

    function cancelAutoRetry() {
      retryState.cancelled = true;
      if (retryState.timer !== null) {
        clearTimeout(retryState.timer);
        retryState.timer = null;
      }
      retryState.retrying = false;
    }

    function resetAutoRetry() {
      // 重置重试状态（成功恢复时调用）
      if (retryState.timer !== null) {
        clearTimeout(retryState.timer);
        retryState.timer = null;
      }
      retryState.count = 0;
      retryState.nextDelay = 0;
      retryState.retrying = false;
      // 注意：cancelled 只在 close()/用户主动停止时置 true，不在这里清除
    }

    function doRetry() {
      // 真正执行重连：销毁旧实例 + 重置 video src + 走三层 fallback
      retryState.retrying = false;
      if (hlsInstance) {
        try { hlsInstance.destroy(); } catch (e) {}
        hlsInstance = null;
      }
      videoEl.removeAttribute('src');
      try { videoEl.load(); } catch (e) {}
      // loadVideo 内部会重置 stallSince 并启动 watcher
      loadVideo();
    }

    // 重连成功回调：让 stall 检测、retry 计数都回到干净状态
    function onPlaybackRecovered() {
      resetAutoRetry();
    }

    function onStallStart() {
      // 已被错误页接管则不再判定
      if (statusEl.classList.contains('fv-status-error')) return;
      if (stallSince === null) {
        stallSince = Date.now();
        showLoading('缓冲中…');
        statusEl.classList.remove('fv-hidden');
      }
    }

    function onStallEnd() {
      if (stallSince !== null) {
        stallSince = null;
        hideStatus();
      }
    }

    function checkBufferHealth() {
      if (statusEl.classList.contains('fv-status-error')) return;
      const buf = videoEl.buffered;
      if (buf.length === 0) {
        onStallStart();
        return;
      }
      const bufferedEnd = buf.end(buf.length - 1);
      const ahead = bufferedEnd - videoEl.currentTime;
      // 缓冲 < 1 秒视为即将耗尽
      if (ahead < 1) {
        onStallStart();
      } else {
        onStallEnd();
      }
    }

    function startStallWatcher() {
      stopStallWatcher();
      stallSince = null;
      // 每秒兜底检查超时（即使事件没触发也能判定）
      stallCheckTimer = setInterval(() => {
        if (stallSince !== null && Date.now() - stallSince >= STALL_TIMEOUT_MS) {
          showStallError();
        }
      }, 1000);
    }

    function stopStallWatcher() {
      if (stallCheckTimer !== null) {
        clearInterval(stallCheckTimer);
        stallCheckTimer = null;
      }
      stallSince = null;
    }

    function showError(msg) {
      statusEl.className = 'fv-status fv-status-error';
      statusEl.innerHTML = `
        <div class="fv-icon">⚠️</div>
        <div class="fv-msg">${msg}</div>
        <div class="fv-retry-row" style="display:flex;gap:8px;margin-top:12px;justify-content:center;flex-wrap:wrap;">
          <button class="fv-btn-retry" id="fv-retry-btn" style="
            padding:8px 18px;border:none;border-radius:8px;
            background:#f44336;color:#fff;font-size:13px;cursor:pointer;
          ">立即重试</button>
          <button class="fv-btn-stop" id="fv-stop-retry-btn" style="
            padding:8px 18px;border:none;border-radius:8px;
            background:#666;color:#fff;font-size:13px;cursor:pointer;
          ">停止重连</button>
        </div>
      `;
      const retryBtn = root.querySelector('#fv-retry-btn');
      const stopBtn = root.querySelector('#fv-stop-retry-btn');
      // 错误页通常由 hls.js 致命错误触发，统一按 network 处理
      scheduleAutoRetry('network');
      retryBtn?.addEventListener('click', () => {
        if (retryState.timer !== null) {
          clearTimeout(retryState.timer);
          retryState.timer = null;
        }
        retryState.retrying = false;
        showLoading('正在重新连接…');
        startStallWatcher();
        loadVideo();
      });
      stopBtn?.addEventListener('click', () => {
        cancelAutoRetry();
        statusEl.innerHTML = `
          <div class="fv-icon">⚠️</div>
          <div class="fv-msg">${msg}<br/><small style="opacity:0.75;">已停止自动重连。</small></div>
          <button class="fv-btn-retry" id="fv-restart-btn" style="
            margin-top:10px;padding:8px 18px;border:none;border-radius:8px;
            background:#1976d2;color:#fff;font-size:13px;cursor:pointer;
          ">重新启动自动重连</button>
        `;
        statusEl.querySelector('#fv-restart-btn')?.addEventListener('click', () => {
          retryState.cancelled = false;
          retryState.count = 0;
          scheduleAutoRetry('network');
        });
      });
    }

    // 上游推流中断：明确的错误状态 + 检查清单 + 自动重试 + 手动按钮
    function showStallError() {
      stopStallWatcher();
      statusEl.className = 'fv-status fv-status-error';
      statusEl.innerHTML = `
        <div class="fv-icon">📡</div>
        <div class="fv-msg">
          <strong>上游推流已中断</strong><br/>
          <small style="opacity:0.75;font-size:11px;display:inline-block;margin-top:6px;line-height:1.6;">
            请检查：<br/>
            · 摄像头是否在线 / 电源正常<br/>
            · 推流软件（OBS / EasyNVR）是否断开<br/>
            · 现场网络是否通畅<br/>
            · ZLMediaKit 服务状态
          </small>
        </div>
        <div class="fv-retry-row" style="display:flex;gap:8px;margin-top:12px;justify-content:center;flex-wrap:wrap;">
          <button class="fv-btn-retry" id="fv-reprobe-btn" style="
            padding:8px 18px;border:none;border-radius:8px;
            background:#f44336;color:#fff;font-size:13px;cursor:pointer;
          ">立即重试</button>
          <button class="fv-btn-stop" id="fv-stop-retry-btn" style="
            padding:8px 18px;border:none;border-radius:8px;
            background:#666;color:#fff;font-size:13px;cursor:pointer;
          ">停止重连</button>
        </div>
      `;
      const reprobeBtn = root.querySelector('#fv-reprobe-btn');
      const stopBtn = root.querySelector('#fv-stop-retry-btn');

      // 触发自动重试（5/10/20/40 退避，最多 8 次）
      scheduleAutoRetry('stall');

      // 立即重试：跳过本次延迟，立刻连接
      reprobeBtn?.addEventListener('click', () => {
        if (retryState.timer !== null) {
          clearTimeout(retryState.timer);
          retryState.timer = null;
        }
        retryState.retrying = false;
        showLoading('正在重新连接…');
        doRetry();
      });

      // 停止重连：终止所有后续自动重试，错误页保持显示
      stopBtn?.addEventListener('click', () => {
        cancelAutoRetry();
        statusEl.className = 'fv-status fv-status-error';
        statusEl.innerHTML = `
          <div class="fv-icon">📡</div>
          <div class="fv-msg">
            <strong>上游推流已中断</strong><br/>
            <small style="opacity:0.75;font-size:11px;display:inline-block;margin-top:6px;line-height:1.6;">
              已停止自动重连。<br/>
              请检查摄像头 / 推流软件 / 网络 / ZLMediaKit 后手动重试。
            </small>
          </div>
          <button class="fv-btn-retry" id="fv-reprobe-btn-2" style="
            margin-top:10px;padding:8px 18px;border:none;border-radius:8px;
            background:#f44336;color:#fff;font-size:13px;cursor:pointer;
          ">重新探测</button>
        `;
        root.querySelector('#fv-reprobe-btn-2')?.addEventListener('click', () => {
          // 用户重新启动：清 cancelled、走一次重试流程
          retryState.cancelled = false;
          retryState.count = 0;
          showLoading('正在重新连接…');
          doRetry();
        });
      });
    }

    // 重连等待页：显示倒计时 + 立即重试 + 停止重连
    function showRetryWaiting(reason, delayMs, attempt, maxAttempts) {
      statusEl.className = 'fv-status fv-status-loading';
      const reasonText =
        reason === 'stall' ? '上游推流中断' :
        reason === 'network' ? '网络错误' :
        reason === 'media' ? '媒体错误' : '连接中断';
      let remaining = Math.ceil(delayMs / 1000);
      statusEl.innerHTML = `
        <div class="fv-spinner"></div>
        <div>${reasonText}，<span id="fv-retry-countdown">${remaining}</span> 秒后自动重连…<br/>
          <small style="opacity:0.7;font-size:11px;">（第 ${attempt}/${maxAttempts} 次）</small>
        </div>
        <div class="fv-retry-row" style="display:flex;gap:8px;margin-top:10px;justify-content:center;">
          <button class="fv-btn-retry" id="fv-immediate-btn" style="
            padding:6px 14px;border:none;border-radius:6px;
            background:#1976d2;color:#fff;font-size:12px;cursor:pointer;
          ">立即重试</button>
          <button class="fv-btn-stop" id="fv-stop-auto-btn" style="
            padding:6px 14px;border:none;border-radius:6px;
            background:#666;color:#fff;font-size:12px;cursor:pointer;
          ">停止重连</button>
        </div>
      `;
      // 倒计时每秒更新
      const cdEl = statusEl.querySelector('#fv-retry-countdown');
      const cdTimer = setInterval(() => {
        remaining -= 1;
        if (cdEl) cdEl.textContent = String(Math.max(0, remaining));
        if (remaining <= 0) clearInterval(cdTimer);
      }, 1000);
      // 把倒计时 timer 挂在 retryState 上，便于取消时清理
      retryState._cdTimer = cdTimer;

      // 立即重试
      statusEl.querySelector('#fv-immediate-btn')?.addEventListener('click', () => {
        if (retryState._cdTimer) {
          clearInterval(retryState._cdTimer);
          retryState._cdTimer = null;
        }
        if (retryState.timer !== null) {
          clearTimeout(retryState.timer);
          retryState.timer = null;
        }
        retryState.retrying = false;
        doRetry();
      });
      // 停止重连
      statusEl.querySelector('#fv-stop-auto-btn')?.addEventListener('click', () => {
        if (retryState._cdTimer) {
          clearInterval(retryState._cdTimer);
          retryState._cdTimer = null;
        }
        cancelAutoRetry();
        // 切到"已停止"错误页
        statusEl.className = 'fv-status fv-status-error';
        statusEl.innerHTML = `
          <div class="fv-icon">📡</div>
          <div class="fv-msg">
            <strong>已停止自动重连</strong><br/>
            <small style="opacity:0.75;font-size:11px;display:inline-block;margin-top:6px;">
              请检查摄像头 / 推流软件 / 网络后手动重试。
            </small>
          </div>
          <button class="fv-btn-retry" id="fv-restart-retry-btn" style="
            margin-top:10px;padding:8px 18px;border:none;border-radius:8px;
            background:#1976d2;color:#fff;font-size:13px;cursor:pointer;
          ">重新启动自动重连</button>
        `;
        statusEl.querySelector('#fv-restart-retry-btn')?.addEventListener('click', () => {
          retryState.cancelled = false;
          retryState.count = 0;
          scheduleAutoRetry(reason);
        });
      });
    }

    function showLoading(text) {
      statusEl.className = 'fv-status fv-status-loading';
      statusEl.innerHTML = `
        <div class="fv-spinner"></div>
        <div>${text}</div>
      `;
    }

    function hideStatus() {
      statusEl.classList.add('fv-hidden');
    }

    async function loadVideo() {
      showLoading('正在连接视频源…');
      // 重试前先重置 stall 监测，避免沿用旧序列号
      startStallWatcher();
      // 标记：本次是新连接尝试，重连成功后由 onPlaybackRecovered 清零重试计数
      // 若本次连接再次失败（stall/error），scheduleAutoRetry 看到 count>0 会按退避策略继续
      // 策略1：原生 HLS（iPhone Safari / iPad Safari / Mac Safari / Android 系统浏览器等）
      if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        showLoading('正在加载 HLS 直播流…');
        videoEl.src = HLS_PROXY_URL;
        videoEl.load();
        return;
      }
      // 策略2：Chrome / Edge / Firefox / 微信 / QQ 用 hls.js
      try {
        const Hls = await loadHlsJs();
        if (!Hls.isSupported()) throw new Error('当前浏览器不支持 hls.js');
        showLoading('正在加载 HLS 直播流…');
        if (hlsInstance) {
          hlsInstance.destroy();
          hlsInstance = null;
        }
        hlsInstance = new Hls({
          liveDurationInfinity: true,
          enableWorker: true,
          // 增大缓冲，缓解卡顿
          maxBufferLength: 60,         // 前向缓冲 60 秒
          maxMaxBufferLength: 600,     // 最大缓冲 600 秒
          maxBufferSize: 60 * 1000 * 1000, // 60MB
          liveSyncDuration: 30,        // live 同步窗口 30 秒
          liveMaxLatencyDurationCount: 20, // 最大滞后 20 个切片
          lowLatencyMode: false,       // 关低延迟模式（牺牲延迟换流畅）
          backBufferLength: 30,        // 后向缓冲 30 秒
        });
        hlsInstance.loadSource(HLS_PROXY_URL);
        hlsInstance.attachMedia(videoEl);
        hlsInstance.on(Hls.Events.ERROR, (evt, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                // 致命网络错误：让上层走自动重试（5/10/20/40 退避）
                showError('网络错误，请检查代理服务。');
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                // hls.js 内置恢复一次；若仍失败再走 showError 触发重试
                try { hlsInstance?.recoverMediaError(); } catch (e) {}
                // 给内置恢复 5 秒窗口，若仍 fatal 会再次触发本回调
                // timer 句柄挂到实例上，便于 close() 清理
                if (hlsInstance._mediaProbeTimer) {
                  clearTimeout(hlsInstance._mediaProbeTimer);
                }
                hlsInstance._mediaProbeTimer = setTimeout(() => {
                  if (hlsInstance && hlsInstance.error) {
                    // 仍未恢复：升级为可重试错误
                    showError('媒体错误，已停止。');
                  }
                }, 5000);
                break;
              default:
                showError('播放错误：' + (data.details || '未知'));
                hlsInstance?.destroy();
                hlsInstance = null;
            }
          }
        });
        return;
      } catch (e) {
        // hls.js 全部 CDN 加载失败 → 兜底用 FMP4
        console.error('[fv] hls.js init failed:', e);
        showLoading('正在加载视频流…');
        videoEl.src = FMP4_PROXY_URL;
        videoEl.load();
      }
    }

    // 监听 video 事件 → 被动驱动 stall 检测
    videoEl.addEventListener('loadedmetadata', () => {
      hideStatus();
      videoEl.play().catch(() => {});
      // 元数据就绪 → 视为连接成功，清零重试计数
      onPlaybackRecovered();
    });
    videoEl.addEventListener('playing', () => {
      // 真正开始播放 → 双保险，确保从 stall 恢复后清零计数
      onPlaybackRecovered();
    });
    videoEl.addEventListener('error', () => {
      // 仅在没使用 hls.js 时显示原生错误
      if (!hlsInstance) {
        showError('视频加载失败。<br/>可能原因：上游流断开 / 网络不可达 / 浏览器不支持。');
      }
    });
    videoEl.addEventListener('waiting', () => {
      // 缓冲耗尽在等待数据
      onStallStart();
    });
    videoEl.addEventListener('stalled', () => {
      // 数据获取停滞
      onStallStart();
    });
    videoEl.addEventListener('playing', () => {
      // 恢复播放
      onStallEnd();
    });
    videoEl.addEventListener('canplay', () => {
      // 可以播放（缓冲恢复）
      onStallEnd();
    });
    videoEl.addEventListener('progress', () => {
      // 正在下载新数据
      checkBufferHealth();
    });
    videoEl.addEventListener('timeupdate', () => {
      // 播放进度更新（4-66Hz），检查一次避免高频
      checkBufferHealth();
    });

    // 关闭
    function close() {
      // 终止所有自动重试（timer + 倒计时 ui）
      cancelAutoRetry();
      if (retryState._cdTimer) {
        clearInterval(retryState._cdTimer);
        retryState._cdTimer = null;
      }
      // 清掉 hls.js MEDIA_ERROR 的 5 秒探测 timer
      if (hlsInstance && hlsInstance._mediaProbeTimer) {
        clearTimeout(hlsInstance._mediaProbeTimer);
        hlsInstance._mediaProbeTimer = null;
      }
      // 清掉自动隐藏控件的 timer
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      // 清掉 fullscreenchange 监听（避免跨播放器泄漏）
      if (typeof fsChangeHandler === 'function') {
        document.removeEventListener('fullscreenchange', fsChangeHandler);
        document.removeEventListener('webkitfullscreenchange', fsChangeHandler);
      }
      stopStallWatcher();
      videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.load();
      if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
      }
      root.classList.add('fv-hiding');
      setTimeout(() => root.remove(), 200);
      document.removeEventListener('keydown', escHandler);
    }
    // ============ 自定义控件事件绑定 ============
    // 背景说明：iOS PWA standalone 模式下 <video controls> 会被 iOS 系统接管进入
    // native 全屏播放，导致我们页面的所有按钮（关闭/全屏）失效。
    // 解决：移除 controls，用自己的按钮 + Web Fullscreen API。
    const videoBox = root.querySelector('.fv-video-box');

    function togglePlay() {
      if (videoEl.paused) videoEl.play().catch(() => {});
      else videoEl.pause();
    }
    function updatePlayBtn() {
      const pauseIcon = playBtn.querySelector('.fv-icon-pause');
      const playIcon = playBtn.querySelector('.fv-icon-play');
      if (videoEl.paused) {
        pauseIcon.style.display = 'none';
        playIcon.style.display = '';
      } else {
        pauseIcon.style.display = '';
        playIcon.style.display = 'none';
      }
    }
    function toggleMute() {
      videoEl.muted = !videoEl.muted;
      const volIcon = muteBtn.querySelector('.fv-icon-vol');
      const muteIcon = muteBtn.querySelector('.fv-icon-mute');
      if (volIcon) volIcon.style.display = videoEl.muted ? 'none' : '';
      if (muteIcon) muteIcon.style.display = videoEl.muted ? '' : 'none';
    }
    function updateMuteBtn() {
      const volIcon = muteBtn.querySelector('.fv-icon-vol');
      const muteIcon = muteBtn.querySelector('.fv-icon-mute');
      if (volIcon) volIcon.style.display = videoEl.muted ? 'none' : '';
      if (muteIcon) muteIcon.style.display = videoEl.muted ? '' : 'none';
    }
    function isFullscreen() {
      return !!(document.fullscreenElement || document.webkitFullscreenElement);
    }
    function toggleFullscreen() {
      // 整个播放器容器进入全屏（不是仅 video），避免 iOS native 全屏接管
      if (isFullscreen()) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) exit.call(document);
      } else {
        const req = root.requestFullscreen || root.webkitRequestFullscreen;
        if (req) req.call(root);
        else if (videoEl.webkitEnterFullscreen) videoEl.webkitEnterFullscreen();
      }
    }
    function updateFsBtn() {
      fsBtn.classList.toggle('fv-fs-active', isFullscreen());
      fsBtn.title = isFullscreen() ? '退出全屏' : '全屏';
    }
    function formatTime(sec) {
      sec = Math.max(0, Math.floor(sec || 0));
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      const pad = (n) => String(n).padStart(2, '0');
      return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    // 自动隐藏控件：播放中 3s 无活动则隐藏
    let hideTimer = null;
    const HIDE_DELAY_MS = 3000;
    function showControls() {
      root.classList.remove('fv-controls-hidden');
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
      if (!videoEl.paused && !statusEl.classList.contains('fv-status-error')) {
        hideTimer = setTimeout(() => {
          root.classList.add('fv-controls-hidden');
        }, HIDE_DELAY_MS);
      }
    }

    // 按钮事件（stopPropagation 避免冒泡到 root 触发"点背景关闭"）
    playBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); showControls(); });
    muteBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMute(); });
    fsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); });
    root.querySelector('#fv-close-btn').addEventListener('click', (e) => { e.stopPropagation(); close(); });

    // 点击视频区域 → 切换播放/暂停 + 显示控件
    videoBox.addEventListener('click', (e) => {
      if (e.target.closest('.fv-controls')) return; // 控件内部点击不切换
      togglePlay();
      showControls();
    });

    // 任何活动 → 重置隐藏计时器
    ['mousemove', 'touchstart', 'touchmove'].forEach((ev) => {
      root.addEventListener(ev, showControls, { passive: true });
    });

    // 视频状态 → 同步 UI
    videoEl.addEventListener('play', () => { updatePlayBtn(); showControls(); });
    videoEl.addEventListener('pause', () => {
      updatePlayBtn();
      root.classList.remove('fv-controls-hidden'); // 暂停时控件常驻
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    });
    videoEl.addEventListener('volumechange', updateMuteBtn);

    // 全屏状态变化（标准 + WebKit）
    const fsChangeHandler = updateFsBtn;
    document.addEventListener('fullscreenchange', fsChangeHandler);
    document.addEventListener('webkitfullscreenchange', fsChangeHandler);

    // 时间显示（HLS 直播没有总时长，只显示已播放时间）
    videoEl.addEventListener('timeupdate', () => {
      if (timeEl) timeEl.textContent = formatTime(videoEl.currentTime);
    });

    // 点击 root 背景（video-box 之外的黑色区域）→ 关闭
    root.addEventListener('click', (e) => {
      if (e.target === root) close();
    });

    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', escHandler);

    // 初始化状态
    updatePlayBtn();
    updateMuteBtn();
    showControls();

    loadVideo();
  }

  // ============ 暴露 API ============
  // 仅暴露 API，不再自动创建悬浮球（按钮入口由调用方负责）
  window.FloatingVideo = {
    open: openPlayer
  };
})();