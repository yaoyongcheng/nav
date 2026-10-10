/**
 * main-9.4 / PWA 注册 + 安装引导浮层（v1.5.8.2 · 全平台自动识别桌面快捷方式）
 * ============================================================
 *
 * 核心架构（v1.5.0 重构，v1.5.1 优化，v1.5.2 鸿蒙增强，v1.5.5 鸿蒙指引精简，v1.5.6 OPPO 适配，v1.5.7 OPPO 书签中转，v1.5.8 通用安装冷却，v1.5.8.1 鸿蒙自动识别，v1.5.8.2 全平台自动识别）:
 *   - "能力检测为主，UA 为辅"：能否装 PWA 看 beforeinstallprompt 事件，
 *     UA 仅决定用什么文案。这样避免国产 ROM 浏览器伪装成 Chrome 时的误判。
 *   - v1.5.1 关键改动:
 *     · 移除 buttonAllowedPlatforms 限制：所有 Android 平台（含小米/OPPO/Vivo/华为）
 *       只要浏览器真的触发 beforeinstallprompt 就显示一键安装按钮
 *     · 国产 ROM preset 增加 bodyInstalled 变体：能力检测通过时显示简短说明
 *     · 文案去除所有"切 Chrome / 安装 Chrome"建议：尊重原生 ROM 浏览器
 *     · 新增华为/鸿蒙专属分支优化（HarmonyOS 4+ / NEXT 步骤）
 *   - v1.5.2 关键改动（鸿蒙 NEXT 适配，**不影响其他机型**）:
 *     · 一键安装按钮 onClick 改为异步：先尝试鸿蒙私有 API
 *       （window.huawei.installShortcut / navigator.installShortcut /
 *        window.HMSCore.installShortcut），失败再降级到标准 deferredPrompt.prompt()
 *     · 三种 API 用特性检测（typeof === 'function'），其他机型不会探测到这些 API，
 *       走标准 deferredPrompt 路径，行为与 v1.5.1 完全一致
 *     · 鸿蒙场景：私有 API + deferredPrompt 都失败时，弹出「鸿蒙手动添加」引导浮层
 *       （4 步图文 + 复制链接备用），引导用户走浏览器菜单「网站变应用」
 *     · 其他机型：行为不变（私有 API 探测候选数组为空 → 跳过）
 *   - v1.5.3/v1.5.3.1/v1.5.4 关键改动（鸿蒙桌面快捷方式冷却，**不影响其他机型**）:
 *     · manifest shortcuts URL 加 ?from=homescreen → URL 参数自动标记冷却
 *     · localStorage.m94-harmony-homescreen-installed 持久化冷却 key
 *     · 启动时检测 URL 参数 / display-mode / 冷却标记,任一满足则不弹引导
 *   - v1.5.5 关键改动（鸿蒙指引精简，**不影响其他机型**）:
 *     · 删除指引中"💡 关键提示"绿色框（manifest shortcuts 长篇说明）
 *     · 删除指引中"其他升级路径"灰色框（备案域/HAP 打包提示）
 *     · 步骤从 4 步精简为 3 步；顶部橙色说明精简为单行
 *     · showHarmonyManualGuide() 仅做文案精简,所有机型分支逻辑未动
 *   - v1.5.6 关键改动（OPPO ColorOS 14+ "网站变应用" 适配，**不影响其他机型**）:
 *     · manifest 字段全部从相对路径改成绝对路径（id/start_url/scope/icons/src/shortcuts.url/screenshots.src）
 *     · display_override 补全 standalone + browser fallback
 *     · 'oppo' preset 按 ColorOS 版本号分支（UA 解析 ColorOS 版本,14+ 走"网站变应用",13 走"添加到桌面"）
 *     · buildGuide() 增加 else if (platform === 'oppo') 分支,显示"我已添加到桌面"按钮
 *     · handlePrimaryAction 增加 mark-oppo-installed action,写 localStorage 冷却
 *     · shouldShowNow 增加 isOPPO && hasOppoInstalled() 冷却判断（与鸿蒙冷却独立）
 *     · 新增 OPPO_INSTALLED_KEY = 'm94-oppo-installed' 冷却键 + 读写函数
 *     · 其他 9 个手机平台分支（xiaomi/vivo/huawei-harmony/android-*）一行未动
 *   - v1.5.7 关键改动（OPPO HeyTap 书签中转路径，**不影响其他机型**）:
 *     · 'oppo' preset 重写为 HeyTap 书签中转路径（⋮ 收藏 → ⋮ 书签收藏 → 长按 → 添加到桌面）
 *     · 删 v1.5.6 的 ColorOS 14+/13 分支判断（实测均不可行）
 *     · 删 v1.5.6 的 isColorOS14Plus UA 探测代码（不再需要）
 *     · 诚实告知用户：HeyTap 创建的是书签快捷方式(打开仍带浏览器 UI),非独立 App,推送不生效
 *     · vivo 同步改造为书签中转路径（实测 vivo i 浏览器也没有"添加到桌面"原生菜单，必须先收藏再长按书签 → 添加到桌面）
 *     · 新增 VIVO_INSTALLED_KEY 冷却键 + mark/has/clear VIVOInstalled 函数
 *     · buildGuide() 增加 else if (platform === 'vivo') 分支
 *     · handlePrimaryAction 增加 mark-vivo-installed action
 *     · shouldShowNow 增加 isVivo && hasVivoInstalled() 冷却判断（与 OPPO/鸿蒙独立）
 *     · 其他 9 个手机平台分支（in-app / ios 系 / xiaomi / vivo / huawei-harmony / android 系 / desktop）一行未动
 *     · buildGuide()/handlePrimaryAction/shouldShowNow/OPPO_INSTALLED_KEY 全部保留
 *   - v1.5.8 关键改动（通用安装冷却，**对所有 12 个平台分支生效**）:
 *     · 新增 PWA_INSTALLED_KEY = 'm94-pwa-installed' 通用冷却键（与原 4 个平台键隔离）
 *     · 新增 markPwaInstalled / hasPwaInstalled / clearPwaInstalled 三个函数（命名对称）
 *     · shouldShowNow() 增加通用冷却判断：hasPwaInstalled() 返回 true → 跳过引导
 *     · 一键安装（native-install action）用户确认 accepted 时自动调用 markPwaInstalled()
 *       → 不再依赖 platform 专用键（小米/OPPO/vivo/鸿蒙）也能统一记录
 *     · 除 in-app 强制跳浏览器分支外，其他 11 个 preset 全部增加 secondaryBtn
 *       （label: '我已添加到桌面,不再提示', action: mark-pwa-installed），
 *       用户走完手动添加流程后点 secondary 即可全局冷却
 *     · renderGuide secondaryBtn 处理器扩展支持 mark-pwa-installed action
 *     · window.PWAInstall 暴露 markPwaInstalled/hasPwaInstalled/clearPwaInstalled API
 *     · 原 4 个平台冷却键（m94-harmony-homescreen-installed / m94-oppo-installed /
 *       m94-vivo-installed / m94-xiaomi-installed）保留作为语义辅助，
 *       仅供历史分析/诊断使用，行为完全兼容
 *     · 不影响显示逻辑（isStandalone 早返回 + 平台键冷却仍生效，互为冗余）
 *   - v1.5.8.1 关键改动（自动识别「桌面快捷方式二次回访」，**用户无需点击任何按钮**）:
 *     · 用户原始诉求：「如果已经添加了桌面快捷方式，那么不再需要用户去点击不再提示的按钮」
 *     · 鸿蒙/OPPO/vivo/小米通过「书签中转」创建的桌面图标，浏览器打开时：
 *       - document.referrer 几乎必然为空字符串（桌面图标不是从网页跳转）
 *       - URL 未必带 ?from=homescreen（manifest shortcuts 在国产 ROM 浏览器不一定被解析）
 *       - isStandalone === false（不是真正 PWA 实例）
 *     · 新增 detectDesktopShortcutRevisit() 函数，综合 4 个条件自动判定：
 *       ① window.top === window（排除 iframe）
 *       ② document.referrer === ''（桌面图标的典型特征）
 *       ③ localStorage.m94-last-visit-ts 存在（排除浏览器冷启动直接访问）
 *       ④ 时间差 < 30 天（REVISIT_WINDOW_MS，超过视为清理过 localStorage）
 *     · 命中后自动 markPwaInstalled() → shouldShowNow() 自然返回 false → 不弹引导
 *     · 每次页面加载时 setLastVisitTs(Date.now()) → 下次启动时本函数可识别
 *     · 鸿蒙 showHarmonyManualGuide 的 primary/secondary 都改用 mark-pwa-installed 通用键
 *     · window.PWAInstall 暴露 detectDesktopShortcutRevisit / getLastVisitTs API
 *     · 启动调试日志新增 referrer / lastVisitTs / shortcutRevisit 字段
 *     · 行为完全兼容 v1.5.8：未命中条件时原有逻辑不变
 *   - v1.5.8.2 关键改动（**全平台**自动识别「桌面快捷方式二次回访」，用户无需点击任何按钮）:
 *     · 用户诉求：「华为的安装指引已经改好了， 其他的机型的安装指引也不需要用户点击我已添加到桌面」
 *     · v1.5.8.1 注释曾标"鸿蒙"，实际 detectDesktopShortcutRevisit() 是**完全平台无关**的函数
 *       （判定依据：document.referrer + localStorage 时间戳，跟 UA 无关）
 *     · v1.5.8.2 强化：明确所有 12 个 preset 受益，浮层里的「我已添加到桌面」按钮仅作为兜底
 *     · 适用范围（已实测可识别）:
 *       - iOS Safari（添加到主屏幕）→ 走 isStandalone 早返回
 *       - iOS Chrome/Edge → 用户手动添加书签到桌面 + 二次访问命中
 *       - Android Chrome / Edge / Samsung / Firefox → 原生 prompt 安装 + 二次访问命中
 *       - 鸿蒙 HarmonyOS / 华为浏览器 → 书签中转桌面图标 + 二次访问命中
 *       - OPPO HeyTap / vivo OriginOS / 小米澎湃 → 书签中转桌面图标 + 二次访问命中
 *       - 桌面 Chrome / Edge → 原生 prompt 安装 + 二次访问命中
 *     · 所有 11 个非 in-app preset 都已经配 mark-pwa-installed secondaryBtn（v1.5.8 已完成）
 *     · 启动段自动判定逻辑 v1.5.8.1 已就绪，v1.5.8.2 仅做语义升级 + 注释对齐
 *     · 行为完全兼容 v1.5.8.1：未命中条件时原有逻辑不变
 *   - 分层策略:
 *       1. detectCapability()  ← beforeinstallprompt 捕获态
 *       2. detectPlatform()    ← UA 字符串（仅文案分支）
 *       3. buildGuide()        ← (capability, platform) → 引导内容
 *   - 数据驱动: 所有分支文案集中在 GUIDE_PRESETS，新增平台只改表，不动逻辑
 *
 * 分支清单（10 个）:
 *   微信/WebView → 强制跳浏览器
 *   iOS Safari   → 分享→添加到主屏幕（iOS 永远不发 beforeinstallprompt）
 *   iOS 非 Safari → 复制链接去 Safari
 *   小米澎湃 OS   → 浏览器已支持一键安装（cap 决定显示按钮 or 降级步骤）
 *   OPPO ColorOS  → HeyTap 需通过书签中转创建桌面图标（v1.5.7 实测路径）
 *   Vivo OriginOS → 浏览器已支持一键安装
 *   华为 HarmonyOS → 浏览器已支持一键安装（鸿蒙 4+ / NEXT 专属步骤）
 *   Android Chrome → 原生 prompt 一键安装
 *   Android Samsung / Edge / Firefox → 浏览器步骤
 *   桌面 Chrome/Edge → 地址栏 ⊕ 安装
 *
 * 职责（保持原 IIFE + try/catch 隔离约束，异常不冒泡影响主流程）:
 *   - 不修改 css/login.css / css/style.css
 *   - DOM 追加到 document.body 末尾, position fixed, z-index 9999
 *   - 关闭时彻底从 DOM 移除（display: none + remove），不会吃掉 canvas 触摸事件
 *   - 不用 100vh（iOS Safari 高度 bug），用 max-height 限制
 *   - safe-area-inset-bottom 给内部容器，视觉中心不偏移
 *   - 纯 CSS transition 做动画，不引入任何 rAF 循环
 *
 * 与 v1.4.x 兼容:
 *   - window.PWAInstall.showGuide / dismissGuide / isInstalled / hasNativePrompt 全部保留
 *   - getPlatform() 保留旧值，新增 xiaomi / oppo / vivo
 *   - localStorage key: m94-pwa-dismissed（不变）
 *   - 命名空间: m94-*（不变）
 */

(function () {
  'use strict';

  // ============================================================
  // 工具
  // ============================================================

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () {
        return fallbackCopy(text);
      });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok ? Promise.resolve() : Promise.reject(new Error('execCommand copy failed'));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  // ============================================================
  // 鸿蒙 NEXT 浏览器私有安装 API（v1.5.2 新增，不影响其他机型）
  // 背景：HarmonyOS NEXT 华为浏览器走自家快捷方式通道，不会响应
  //       标准 W3C beforeinstallprompt。需要主动调用以下 API 之一：
  //         · window.huawei.installShortcut(opts)
  //         · navigator.installShortcut(opts)
  //         · window.HMSCore.installShortcut(opts)
  // 设计原则：
  //   - 严格特性检测：typeof !== 'function' 的 API 不会出现在候选列表
  //   - 三种 API 名称依次探测：第一个可用就用，第一个失败尝试下一个
  //   - 所有候选失败 → 返回 {ok:false}，调用方降级到 deferredPrompt.prompt()
  //   - 非鸿蒙 UA 上三个 API 全部不存在 → 候选列表为空，直接返回 ok:false，
  //     调用方跳过私有 API 阶段，行为与 v1.5.1 完全一致
  // ============================================================

  function isHarmonyOSBrowser() {
    return isHarmonyOS || isHuaweiBrowser;
  }

  // v1.5.2 关键判定：当前页面是否在临时隧道域上
  // 鸿蒙浏览器对临时域（*.trycloudflare.com / *.ngrok.io / *.localhost.run 等）
  // 会**接住** deferredPrompt.prompt() 调用但弹它自己的"从菜单安装"提示，
  // 真正的系统层安装依然静默拒绝。
  // 因此鸿蒙 + 临时域场景必须跳过标准 prompt，立即显示手动引导。
  function isTemporaryTunnelDomain() {
    try {
      var host = location.hostname.toLowerCase();
      // 常见临时隧道/内网穿透域
      if (host.endsWith('.trycloudflare.com')) return true;
      if (host.endsWith('.ngrok.io') || host.endsWith('.ngrok-free.app')) return true;
      if (host.endsWith('.ngrok.app')) return true;
      if (host.endsWith('.cloudflare.com') && host.includes('try')) return true;
      if (host.endsWith('.localhost.run')) return true;
      if (host.endsWith('.serveo.net')) return true;
      if (host.endsWith('.loca.lt')) return true;
      // 本机 IP（局域网 / 真机调试）
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(host)) return true;
      if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
      return false;
    } catch (e) { return false; }
  }

  // 鸿蒙 NEXT + 临时域 = 必走手动引导
  function shouldSkipStandardPrompt() {
    return isHarmonyOSBrowser() && isTemporaryTunnelDomain();
  }

  function getHarmonyInstallCandidates() {
    var list = [];
    try {
      if (window.huawei && typeof window.huawei.installShortcut === 'function') {
        list.push(function (opts) { return window.huawei.installShortcut(opts); });
      }
    } catch (e) {}
    try {
      if (typeof navigator.installShortcut === 'function') {
        list.push(function (opts) { return navigator.installShortcut(opts); });
      }
    } catch (e) {}
    try {
      if (window.HMSCore && typeof window.HMSCore.installShortcut === 'function') {
        list.push(function (opts) { return window.HMSCore.installShortcut(opts); });
      }
    } catch (e) {}
    return list;
  }

  // 异步读取 manifest 的入口与图标，给鸿蒙私有 API 喂完整 opts
  // 失败时全部走默认值（start_url = 当前 URL、icon 留空由浏览器兜底）
  function readManifestForInstall() {
    return fetch('./manifest.json', { cache: 'no-cache' })
      .then(function (res) { return res && res.ok ? res.json() : null; })
      .then(function (m) {
        if (!m) return null;
        var base = location.href.substring(0, location.href.lastIndexOf('/') + 1);
        function abs(p) { try { return new URL(p, base).href; } catch (e) { return p; } }
        var icon = '';
        if (m.icons && m.icons[0] && m.icons[0].src) icon = abs(m.icons[0].src);
        var url = m.start_url ? abs(m.start_url) : location.href;
        return {
          name: m.short_name || m.name || '工地数字导航',
          url: url,
          icon: icon,
        };
      })
      .catch(function () { return null; });
  }

  // 探测并尝试鸿蒙私有安装；返回 { ok, source, error? }
  //   source ∈ {'harmony-private-1', 'harmony-private-2', 'harmony-private-3', 'none'}
  function tryHarmonyPrivateInstall() {
    var candidates = getHarmonyInstallCandidates();
    if (!candidates.length) {
      try { console.info('[PWA] Harmony private API not detected'); } catch (e) {}
      return Promise.resolve({ ok: false, source: 'none' });
    }

    return readManifestForInstall().then(function (manifest) {
      var opts = manifest || {
        name: '工地数字导航',
        url: location.href,
        icon: '',
      };
      // 尝试每个候选 API
      var p = Promise.resolve({ ok: false, source: 'none' });
      candidates.forEach(function (fn, idx) {
        p = p.then(function (prev) {
          if (prev && prev.ok) return prev;
          var tag = 'harmony-private-' + (idx + 1);
          try {
            return Promise.resolve(fn(opts)).then(function (result) {
              try { console.info('[PWA] ' + tag + ' succeeded'); } catch (e) {}
              return { ok: true, source: tag, result: result };
            }).catch(function (err) {
              try { console.warn('[PWA] ' + tag + ' failed:', err && err.message || err); } catch (e) {}
              return { ok: false, source: tag, error: err };
            });
          } catch (err) {
            return { ok: false, source: tag, error: err };
          }
        });
      });
      return p;
    });
  }

  // ============================================================
  // 平台检测（UA 字符串 → 平台 ID）
  // 注意：仅用于文案分支，不用于判断"能否装 PWA"
  // ============================================================

  var ua = navigator.userAgent || '';
  var platform = navigator.platform || '';

  // iOS 家族（含 iPadOS 13+ 伪装 Mac）
  var isIOS = /iPad|iPhone|iPod/.test(ua)
    || (platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  var isCriOS = /CriOS/.test(ua);
  var isEdgiOS = /EdgiOS/.test(ua);
  var isFxiOS = /FxiOS/.test(ua);
  var isiOSSafari = isIOS && !isCriOS && !isEdgiOS && !isFxiOS;

  // Android 基础
  var isAndroid = /Android/i.test(ua);

  // Android 主流浏览器
  var isSamsungBrowser = /SamsungBrowser/i.test(ua);
  var isEdgeAndroid = isAndroid && /EdgA/i.test(ua);
  var isFirefoxAndroid = isAndroid && /Firefox/i.test(ua);
  var isChromeAndroid = isAndroid && /Chrome/i.test(ua)
    && !isSamsungBrowser && !isEdgeAndroid && !isFirefoxAndroid;

  // 国产 ROM（UA 关键字）
  var isXiaomiBrowser = /Xiaomi|MiuiBrowser|MiBrowser/i.test(ua);  // 小米浏览器
  var isXiaomiHyperOS = /HyperOS/i.test(ua);                        // 澎湃 OS
  var isXiaomi = isXiaomiBrowser || isXiaomiHyperOS
    || /Build\/[\w.]+; (?:MIUI|HyperOS)/i.test(ua);                 // 兜底：系统 ROM 标识
  var isXiaomi = isXiaomi || (isAndroid && /; MIUI |; HyperOS /i.test(ua));

  var isOPPO = /OppoBrowser|ColorOS|HeyTapBrowser|HeyTap/i.test(ua)
    || (isAndroid && /; ColorOS /i.test(ua));
  var isVivo = /VivoBrowser|OriginOS/i.test(ua)
    || (isAndroid && /; OriginOS /i.test(ua));

  var isHarmonyOS = /HarmonyOS|OpenHarmony/i.test(ua);
  var isHuaweiBrowser = /HuaweiBrowser/i.test(ua);

  // 微信 / QQ / 企业微信（内置 WebView，无 beforeinstallprompt）
  var isInAppBrowser = /MicroMessenger|MQQBrowser|\bQQ\/|wxwork/i.test(ua);

  // Standalone 模式判断（已装 PWA）
  var isStandalone = false;
  try {
    if (typeof navigator.standalone === 'boolean' && navigator.standalone) {
      isStandalone = true;
    } else if (window.matchMedia) {
      if (window.matchMedia('(display-mode: standalone)').matches) isStandalone = true;
      else if (window.matchMedia('(display-mode: fullscreen)').matches) isStandalone = true;
      else if (window.matchMedia('(display-mode: minimal-ui)').matches) isStandalone = true;
    }
  } catch (e) { /* matchMedia 异常兜底 */ }

  // file:// 协议下 navigator.serviceWorker 与 storage 都不可靠
  if (location.protocol === 'file:') {
    try { console.info('[PWA] file:// 协议, PWA 功能禁用'); } catch (e) {}
    return;
  }

  // ============================================================
  // detectPlatform(): UA → 平台 ID（仅文案分支用）
  // ============================================================

  function detectPlatform() {
    if (isInAppBrowser) return 'in-app';
    if (isIOS && isiOSSafari) return 'ios-safari';
    if (isIOS) return 'ios-other';
    if (isXiaomi) return 'xiaomi';
    if (isOPPO) return 'oppo';
    if (isVivo) return 'vivo';
    if (isHuaweiBrowser || isHarmonyOS) return 'huawei-harmony';
    if (isChromeAndroid) return 'android-chrome';
    if (isSamsungBrowser) return 'android-samsung';
    if (isEdgeAndroid) return 'android-edge';
    if (isFirefoxAndroid) return 'android-firefox';
    if (isAndroid) return 'android-other';
    return 'desktop';
  }

  // ============================================================
  // 引导内容预设（数据驱动）
  // 每个预设是一个对象：
  //   title    : 浮层标题
  //   bodyHtml : 文案 HTML（用 m94-pwa-step / .key 等类）
  //   hint     : 底部小灰字提示
  //   primaryBtn : { label, action, value? } 或 null
  // ============================================================

  var GUIDE_PRESETS = {
    'in-app': {
      title: '请在浏览器中打开',
      bodyHtml: ''
        + '<p class="m94-pwa-desc">微信 / QQ 内无法直接安装,请先切换到浏览器:</p>'
        + '<ol class="m94-pwa-steps">'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">1</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '点击右上角 <span class="key">⋯</span> → <span class="key">在浏览器中打开</span>'
        +     '</div>'
        +   '</li>'
        + '</ol>',
      hint: '打开后再按提示一键安装',
      primaryBtn: null,
    },

    'ios-safari': {
      title: '添加到主屏幕',
      bodyHtml: ''
        + '<p class="m94-pwa-desc">点击图标即可全屏打开,无需每次输入地址</p>'
        + '<ol class="m94-pwa-steps">'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">1</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '点击底部 <span class="key">分享</span> 按钮 '
        +       '<span class="key" style="font-size:18px;font-weight:700;margin:0 2px">↑</span>'
        +     '</div>'
        +   '</li>'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">2</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '选择 <span class="key">添加到主屏幕</span> 即可'
        +     '</div>'
        +   '</li>'
        + '</ol>',
      hint: null,
      primaryBtn: null,
      // v1.5.8 新增：通用冷却 secondary 按钮（iOS 走完「分享→添加到主屏幕」后点此确认）
      secondaryBtn: { label: '我已添加到桌面,不再提示', action: 'mark-pwa-installed' },
    },

    'ios-other': {
      title: '请使用 Safari 打开',
      bodyHtml: ''
        + '<p class="m94-pwa-desc">iOS 仅 Safari 浏览器支持添加到主屏幕。请复制下方链接后切换到 Safari 打开:</p>'
        + '<p class="m94-pwa-url">' + escapeHtml(location.href) + '</p>',
      hint: null,
      primaryBtn: { label: '复制链接', action: 'copy-url', value: location.href },
      // v1.5.8 新增：通用冷却 secondary 按钮
      secondaryBtn: { label: '我已添加到桌面,不再提示', action: 'mark-pwa-installed' },
    },

    // ====== 国产 Android ROM 单独分支（v1.5.0 新增，v1.5.1 去 Chrome 化） ======
    // 关键：preset 同时提供 bodyHtml（降级步骤，按钮未触发时显示）
    //       和 bodyInstalled（能力检测通过时显示的简短说明）
    //       buildGuide 根据 cap.canInstall 自动切换，避免引导用户切浏览器

    'xiaomi': {
      title: '添加到主屏幕',
      // 降级步骤（浏览器未触发 beforeinstallprompt 时显示）
      bodyHtml: ''
        + '<p class="m94-pwa-desc">点击桌面图标即可直接进入,像 App 一样使用。</p>'
        + '<ol class="m94-pwa-steps">'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">1</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '打开小米浏览器菜单(底部 <span class="key">≡</span> 或右上角 <span class="key">⋮</span>)'
        +     '</div>'
        +   '</li>'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">2</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '找到 <span class="key">添加到桌面</span> 或 <span class="key">添加书签到桌面</span>'
        +     '</div>'
        +   '</li>'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">3</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '确认添加即可'
        +     '</div>'
        +   '</li>'
        + '</ol>',
      // 安装态（小米浏览器触发 beforeinstallprompt 时显示）
      bodyInstalled: ''
        + '<p class="m94-pwa-desc">小米浏览器已支持 <b>一键安装</b>。点击下方按钮,系统会自动将本应用添加到桌面,像 App 一样使用。</p>'
        + '<p class="m94-pwa-desc" style="font-size:12px;color:#64748B;margin-top:10px">'
        +   '安装完成后从桌面图标进入,可全屏打开并接收消息推送'
        + '</p>',
      hint: null,
      primaryBtn: { action: 'native-install' },
      // v1.5.8 改动：统一收敛为通用冷却键 mark-pwa-installed
      // （之前 v1.6.3 用 mark-xiaomi-installed 平台专用键,保留平台键作为语义辅助记录）
      secondaryBtn: { label: '我已添加到桌面,不再提示', action: 'mark-pwa-installed' },
    },

    'oppo': {
      title: '添加到桌面',
      bodyHtml: ''
        + '<p class="m94-pwa-desc">OPPO HeyTap 需通过书签中转创建桌面图标:</p>'
        + '<ol class="m94-pwa-steps">'
        +   '<li><span class="key">☰</span> → <span class="key">收藏</span>（先存为书签）</li>'
        +   '<li><span class="key">☰</span> → <span class="key">书签收藏</span> → <span class="key">长按</span> → <span class="key">添加到桌面</span></li>'
        + '</ol>'
        + '<p class="m94-pwa-desc" style="font-size:12px;color:#64748B;margin-top:10px">'
        +   '⚠️ 创建的是书签快捷方式（非独立 App），推送/快捷菜单不生效。'
        + '</p>',
      hint: null,
      primaryBtn: { action: 'mark-oppo-installed' },
      // v1.5.8 新增：通用冷却 secondary 按钮（与 OPPO 平台键独立,
      //   即使用户未点击 primary 也能直接走全局冷却）
      secondaryBtn: { label: '我已添加到桌面,不再提示', action: 'mark-pwa-installed' },
    },

    'vivo': {
      title: '添加到桌面',
      bodyHtml: ''
        + '<p class="m94-pwa-desc">vivo i 浏览器需通过书签中转创建桌面图标:</p>'
        + '<ol class="m94-pwa-steps">'
        +   '<li><span class="key">☰</span> → <span class="key">收藏</span>（先存为书签）</li>'
        +   '<li><span class="key">☰</span> → <span class="key">书签/收藏</span> → <span class="key">长按</span> → <span class="key">添加到桌面</span></li>'
        + '</ol>'
        + '<p class="m94-pwa-desc" style="font-size:12px;color:#64748B;margin-top:10px">'
        +   '⚠️ 创建的是书签快捷方式（非独立 App），推送/快捷菜单不生效。'
        + '</p>',
      hint: null,
      primaryBtn: { action: 'mark-vivo-installed' },
      // v1.5.8 新增：通用冷却 secondary 按钮（与 vivo 平台键独立）
      secondaryBtn: { label: '我已添加到桌面,不再提示', action: 'mark-pwa-installed' },
    },

    // ====== 华为 / 鸿蒙（v1.5.1 独立分支） ======

    'huawei-harmony': {
      title: '添加到主屏幕',
      bodyHtml: ''
        + '<p class="m94-pwa-desc">点击桌面图标即可直接进入,像 App 一样使用。</p>'
        + '<ol class="m94-pwa-steps">'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">1</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '打开华为浏览器菜单(右上角 <span class="key">⋮</span> 或底部 <span class="key">≡</span>)'
        +     '</div>'
        +   '</li>'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">2</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '找到 <span class="key">添加到桌面</span> 或 <span class="key">添加书签到桌面</span> 或 <span class="key">网站变应用</span>'
        +     '</div>'
        +   '</li>'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">3</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '确认添加,鸿蒙会自动创建独立的应用图标'
        +     '</div>'
        +   '</li>'
        + '</ol>'
        + '<p class="m94-pwa-desc" style="font-size:12px;color:#64748B;margin-top:10px">'
        +   'HarmonyOS 4+ / 鸿蒙 NEXT 系统均支持'
        + '</p>',
      bodyInstalled: ''
        + '<p class="m94-pwa-desc">华为浏览器已支持 <b>一键安装</b>。点击下方按钮,鸿蒙系统会自动将本应用添加到桌面,像 App 一样使用。</p>'
        + '<p class="m94-pwa-desc" style="font-size:12px;color:#64748B;margin-top:10px">'
        +   'HarmonyOS 4+ / 鸿蒙 NEXT 会创建独立的应用图标,点击直接全屏打开'
        + '</p>',
      hint: null,
      primaryBtn: { action: 'native-install' },
      // v1.5.8 新增：通用冷却 secondary 按钮
      secondaryBtn: { label: '我已添加到桌面,不再提示', action: 'mark-pwa-installed' },
    },

    'android-chrome': {
      title: '添加到主屏幕',
      bodyHtml: ''
        + '<p class="m94-pwa-desc">点击桌面图标即可直接进入,像 App 一样使用。</p>'
        + '<ol class="m94-pwa-steps">'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">1</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '点右上角 <span class="key">⋮</span> → 选择 <span class="key">安装应用</span> 或 <span class="key">添加到主屏幕</span>'
        +     '</div>'
        +   '</li>'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">2</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '弹出确认框,点 <span class="key">安装</span>'
        +     '</div>'
        +   '</li>'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">3</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '系统跳到启动器页面,选 <span class="key">添加到主屏幕</span> → 点 <span class="key">添加</span> 即可'
        +     '</div>'
        +   '</li>'
        + '</ol>',
      hint: null,
      primaryBtn: { label: '一键安装', action: 'native-install' },
    },

    'android-samsung': {
      title: '添加到主屏幕',
      bodyHtml: ''
        + '<p class="m94-pwa-desc">点击桌面图标即可直接进入,像 App 一样使用。</p>'
        + '<ol class="m94-pwa-steps">'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">1</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '点底部 <span class="key">≡</span> → 选择 <span class="key">将页面添加到主屏幕</span>'
        +     '</div>'
        +   '</li>'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">2</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '弹出确认框,点 <span class="key">添加</span> 即可'
        +     '</div>'
        +   '</li>'
        + '</ol>',
      hint: null,
      primaryBtn: null,
      // v1.5.8 新增：通用冷却 secondary 按钮
      secondaryBtn: { label: '我已添加到桌面,不再提示', action: 'mark-pwa-installed' },
    },

    'android-edge': {
      title: '添加到主屏幕',
      bodyHtml: ''
        + '<p class="m94-pwa-desc">点击桌面图标即可直接进入,像 App 一样使用。</p>'
        + '<ol class="m94-pwa-steps">'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">1</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '点底部 <span class="key">⋯</span> → 选择 <span class="key">添加到主屏幕</span>'
        +     '</div>'
        +   '</li>'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">2</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '弹出确认框,点 <span class="key">添加</span> 即可'
        +     '</div>'
        +   '</li>'
        + '</ol>',
      hint: null,
      primaryBtn: null,
      // v1.5.8 新增：通用冷却 secondary 按钮
      secondaryBtn: { label: '我已添加到桌面,不再提示', action: 'mark-pwa-installed' },
    },

    'android-firefox': {
      title: '添加到主屏幕',
      bodyHtml: ''
        + '<p class="m94-pwa-desc">点击桌面图标即可直接进入,像 App 一样使用。</p>'
        + '<ol class="m94-pwa-steps">'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">1</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '点右上角 <span class="key">⋮</span> → 选择 <span class="key">添加到主屏幕</span>'
        +     '</div>'
        +   '</li>'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">2</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '弹出确认框,点 <span class="key">添加</span> 即可'
        +     '</div>'
        +   '</li>'
        + '</ol>',
      hint: null,
      primaryBtn: null,
    },

    'android-other': {
      title: '添加到主屏幕',
      bodyHtml: ''
        + '<p class="m94-pwa-desc">点击桌面图标即可直接进入,像 App 一样使用。多数 Android 浏览器菜单中含 <span class="key">添加到主屏幕</span> 选项。</p>'
        + '<ol class="m94-pwa-steps">'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">1</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '打开浏览器菜单,找到 <span class="key">添加到主屏幕</span> 或 <span class="key">添加书签到桌面</span>'
        +     '</div>'
        +   '</li>'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">2</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '确认添加即可'
        +     '</div>'
        +   '</li>'
        + '</ol>'
        + '<p class="m94-pwa-desc" style="font-size:12px;color:#64748B;margin-top:10px">'
        +   '推荐使用 Chrome / Samsung Internet / Edge 获得最佳体验'
        + '</p>',
      hint: null,
      primaryBtn: null,
      // v1.5.8 新增：通用冷却 secondary 按钮
      secondaryBtn: { label: '我已添加到桌面,不再提示', action: 'mark-pwa-installed' },
    },

    'desktop': {
      title: '安装到桌面',
      bodyHtml: ''
        + '<p class="m94-pwa-desc">Chrome / Edge 地址栏右侧可点击 <span class="key">⊕</span> 安装图标,把本应用安装到桌面。</p>'
        + '<p class="m94-pwa-desc" style="font-size:12px;color:#64748B;margin-top:8px">'
        +   '如未显示安装图标,可打开 DevTools → Application → Service Workers 确认是否已激活'
        + '</p>',
      hint: null,
      primaryBtn: { label: '一键安装', action: 'native-install' },
      // v1.5.8 新增：通用冷却 secondary 按钮
      secondaryBtn: { label: '我已添加到桌面,不再提示', action: 'mark-pwa-installed' },
    },
  };

  // ============================================================
  // 冷却逻辑
  // ============================================================

  var DISMISS_KEY = 'm94-pwa-dismissed';
  // v1.5.3 新增：鸿蒙用户已创建桌面快捷方式后,持久化冷却不再打扰
  // 触发：用户在鸿蒙桌面快捷方式引导浮层点"我已添加到桌面,不再提示"
  // 清除路径：浏览器设置 → 清除网站数据 / localStorage.clear() / 应用内调用 PWAInstall.clearHarmonyHomescreenInstalled()
  var HARMONY_HOMESCREEN_KEY = 'm94-harmony-homescreen-installed';
  // v1.5.6 新增：OPPO 用户走"网站变应用/添加到桌面"后持久化冷却，不再打扰
  var OPPO_INSTALLED_KEY = 'm94-oppo-installed';
  var VIVO_INSTALLED_KEY = 'm94-vivo-installed';
  var XIAOMI_INSTALLED_KEY = 'm94-xiaomi-installed';
  var forceShow = /[?&]install=1\b/.test(location.search);

  function hasHarmonyHomescreenInstalled() {
    try { return localStorage.getItem(HARMONY_HOMESCREEN_KEY) === 'true'; }
    catch (e) { return false; }
  }

  function markHarmonyHomescreenInstalled() {
    try { localStorage.setItem(HARMONY_HOMESCREEN_KEY, 'true'); return true; }
    catch (e) { return false; }
  }

  function clearHarmonyHomescreenInstalled() {
    try { localStorage.removeItem(HARMONY_HOMESCREEN_KEY); return true; }
    catch (e) { return false; }
  }

  // v1.5.6 新增：OPPO 桌面图标冷却（与鸿蒙冷却键独立，不影响鸿蒙逻辑）
  function hasOppoInstalled() {
    try { return localStorage.getItem(OPPO_INSTALLED_KEY) === 'true'; }
    catch (e) { return false; }
  }

  function markOppoInstalled() {
    try { localStorage.setItem(OPPO_INSTALLED_KEY, 'true'); return true; }
    catch (e) { return false; }
  }

  function clearOppoInstalled() {
    try { localStorage.removeItem(OPPO_INSTALLED_KEY); return true; }
    catch (e) { return false; }
  }

  // v1.6.2 新增：vivo 桌面图标冷却（与 OPPO 冷却键独立，行为相同但语义隔离，方便以后差异化）
  function hasVivoInstalled() {
    try { return localStorage.getItem(VIVO_INSTALLED_KEY) === 'true'; }
    catch (e) { return false; }
  }

  function markVivoInstalled() {
    try { localStorage.setItem(VIVO_INSTALLED_KEY, 'true'); return true; }
    catch (e) { return false; }
  }

  function clearVivoInstalled() {
    try { localStorage.removeItem(VIVO_INSTALLED_KEY); return true; }
    catch (e) { return false; }
  }

  // v1.6.3 新增：xiaomi 桌面图标冷却（小米 preset 加 secondary 按钮后的冷却键，
  // 与 OPPO/vivo 隔离，独立语义）
  function hasXiaomiInstalled() {
    try { return localStorage.getItem(XIAOMI_INSTALLED_KEY) === 'true'; }
    catch (e) { return false; }
  }

  function markXiaomiInstalled() {
    try { localStorage.setItem(XIAOMI_INSTALLED_KEY, 'true'); return true; }
    catch (e) { return false; }
  }

  function clearXiaomiInstalled() {
    try { localStorage.removeItem(XIAOMI_INSTALLED_KEY); return true; }
    catch (e) { return false; }
  }

  // v1.5.8 新增：通用安装冷却键（覆盖所有 12 个平台分支）
  // 与原 4 个平台专用键（harmony/oppo/vivo/xiaomi）并存，互不冲突。
  // 设计动机：用户走完"添加到桌面"手动流程后，无论浏览器是否触发
  //   beforeinstallprompt / native-install，都需要一条统一的关闭路径。
  // 触发场景：
  //   1. 一键安装 native-install action，deferredPrompt.userChoice.outcome === 'accepted'
  //   2. 任何 preset 的 secondaryBtn（label: 我已添加到桌面,不再提示）
  //   3. URL 参数 ?installed=1 / ?from=homescreen 等（自动标记路径见下方启动段）
  // 清除路径：浏览器设置 → 清除网站数据 / localStorage.clear() / PWAInstall.clearPwaInstalled()
  var PWA_INSTALLED_KEY = 'm94-pwa-installed';

  function hasPwaInstalled() {
    try { return localStorage.getItem(PWA_INSTALLED_KEY) === 'true'; }
    catch (e) { return false; }
  }

  function markPwaInstalled() {
    try { localStorage.setItem(PWA_INSTALLED_KEY, 'true'); return true; }
    catch (e) { return false; }
  }

  function clearPwaInstalled() {
    try { localStorage.removeItem(PWA_INSTALLED_KEY); return true; }
    catch (e) { return false; }
  }

  // v1.5.8.1 新增：自动识别「从桌面快捷方式二次回访」→ 用户无需点击任何按钮
  // 核心洞察：
  //   - 鸿蒙/OPPO/vivo/小米 通过「收藏→书签→长按→添加桌面」创建的快捷方式，
  //     本质是浏览器书签的桌面图标，点击打开时 **document.referrer 几乎必然为空字符串**
  //     （桌面图标不是从任何网页跳转过来的）
  //   - 真正 PWA standalone 模式打开，referrer 也通常是空字符串
  //   - 从其他网站跳转过来 referrer 是完整 URL
  //   - 浏览器冷启动 + 直接访问 URL，referrer 也是空字符串 → 但此时 lastVisitTs 不存在
  // 综合判定：referrer 为空 + 存在历史访问时间戳 + 时间差 < 30 天
  //   → 视为从桌面快捷方式回访 → 自动 markPwaInstalled() → shouldShowNow 返回 false
  var LAST_VISIT_KEY = 'm94-last-visit-ts';
  // 30 天上限：超过则视为清理过 localStorage / 长时间未用 → 重新走引导流程
  var REVISIT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

  function getLastVisitTs() {
    try {
      var v = localStorage.getItem(LAST_VISIT_KEY);
      if (!v) return 0;
      var n = parseInt(v, 10);
      return isNaN(n) ? 0 : n;
    } catch (e) { return 0; }
  }

  function setLastVisitTs(ts) {
    try { localStorage.setItem(LAST_VISIT_KEY, String(ts || Date.now())); return true; }
    catch (e) { return false; }
  }

  /**
   * 检测当前是否从桌面快捷方式二次回访
   * 返回 true → 调用方应自动 markPwaInstalled() + 跳过引导
   * 返回 false → 走原有 shouldShowNow() 流程
   */
  function detectDesktopShortcutRevisit() {
    try {
      // 1. referrer 必须为空字符串（鸿蒙书签桌面图标的典型特征）
      //    注意：window.top !== window 时（嵌套在 iframe） referrer 可能为空 → 排除
      if (window.top !== window) return false;
      if (typeof document.referrer !== 'string' || document.referrer !== '') return false;

      // 2. 必须存在历史访问时间戳（说明不是浏览器冷启动直接访问 URL）
      var lastTs = getLastVisitTs();
      if (!lastTs) return false;

      // 3. 时间差必须在合理窗口内（30 天以内）
      var now = Date.now();
      var delta = now - lastTs;
      if (delta < 0) return false;            // 系统时间回退 → 兜底
      if (delta > REVISIT_WINDOW_MS) return false;

      // 4. forceShow 强制弹 → 跳过自动判定
      if (forceShow) return false;

      // 5. 已经 standalone → 走 isStandalone 早返回路径，不重复处理
      if (isStandalone) return false;

      // 6. URL 参数 ?install=1 等特殊标记 → 跳过自动判定（让引导浮层处理）
      //    这部分由 shouldShowNow 的 forceShow 处理

      // 全部命中 → 桌面快捷方式二次回访
      try { console.info('[PWA] detected desktop shortcut revisit (referrer empty, last visit ' +
        Math.round(delta / 1000) + 's ago)'); } catch (e) {}
      return true;
    } catch (e) { return false; }
  }

  function shouldShowNow() {
    if (forceShow) return true;
    if (isStandalone) return false;
    // v1.5.3 新增：鸿蒙用户已创建桌面快捷方式 → 跳过引导
    if (isHarmonyOSBrowser() && hasHarmonyHomescreenInstalled()) return false;
    // v1.5.6 新增：OPPO 用户已添加桌面图标 → 跳过引导（与鸿蒙逻辑独立,不影响其他手机）
    if (isOPPO && hasOppoInstalled()) return false;
    // v1.6.2 新增：vivo 用户已添加桌面图标 → 跳过引导（与 OPPO/鸿蒙逻辑独立）
    if (isVivo && hasVivoInstalled()) return false;
    // v1.6.3 新增：xiaomi 用户已通过书签/手动方式添加桌面图标 → 跳过引导（与 OPPO/vivo/鸿蒙逻辑独立）
    if (isXiaomi && hasXiaomiInstalled()) return false;
    // v1.5.8 新增：通用安装冷却 → 跳过引导（覆盖所有 12 个平台分支，
    //   包括 in-app / ios 系 / android 系 / desktop，与 4 个平台键互为冗余/兜底）
    if (hasPwaInstalled()) return false;
    return true;
  }

  // ============================================================
  // beforeinstallprompt 捕获 (Android / Desktop / 部分国产 ROM)
  // 关键：在脚本加载时立即注册监听器，确保不错过早期触发的事件
  // ============================================================

  var deferredPrompt = null;
  var promptCaptureTime = 0;  // 记录捕获时间，便于调试

  try {
    window.addEventListener('beforeinstallprompt', function (e) {
      try { e.preventDefault(); } catch (err) {}
      deferredPrompt = e;
      promptCaptureTime = Date.now();
      try { console.info('[PWA] beforeinstallprompt captured, can install natively'); } catch (err2) {}
    });
  } catch (e) { /* addEventListener 异常兜底 */ }

  try {
    window.addEventListener('appinstalled', function () {
      try { console.info('[PWA] appinstalled'); } catch (e) {}
      deferredPrompt = null;
      // v1.5.8 新增：appinstalled 事件触发时同时写通用冷却键
      // （与 userChoice.outcome === 'accepted' 路径冗余，覆盖所有 PWA 安装来源）
      try { markPwaInstalled(); } catch (e) {}
      try { dismissGuide(); } catch (e) {}
    });
  } catch (e) {}

  // ============================================================
  // detectCapability(): 当前能否原生安装 PWA
  // ============================================================

  function detectCapability() {
    return {
      canInstall: !!deferredPrompt,
      isStandalone: isStandalone,
      isInApp: isInAppBrowser,
    };
  }

  // ============================================================
  // buildGuide(): (platform, capability) → 引导内容
  // 关键改动：能力检测决定 primaryBtn 是否显示，UA 决定文案
  // ============================================================

  function buildGuide() {
    var platform = detectPlatform();
    var cap = detectCapability();
    var preset = GUIDE_PRESETS[platform] || GUIDE_PRESETS['android-other'];

    // 决定使用哪份正文：
    //   - 能力检测通过（浏览器已触发 beforeinstallprompt）→ 用 bodyInstalled（简短说明）
    //   - 否则 → 用 bodyHtml（降级步骤，引导用户走浏览器菜单）
    var canInstall = cap.canInstall;
    var bodyHtml = (canInstall && preset.bodyInstalled) ? preset.bodyInstalled : preset.bodyHtml;

    // 决定主按钮（v1.5.1 改造：完全去掉 platform 白名单，由能力检测驱动）
    // 规则：
    //   - in-app / iOS：永远不显示一键安装按钮（平台限制）
    //   - 所有 Android / Desktop：只要 beforeinstallprompt 真触发了，就显示按钮
    //     这意味着小米/OPPO/Vivo/华为 浏览器触发 prompt 时，按钮会出现
    var primaryBtn = null;
    var isIOSFamily = (platform === 'ios-safari' || platform === 'ios-other');
    var isInApp = (platform === 'in-app');

    if (!isIOSFamily && !isInApp && canInstall && preset.primaryBtn && preset.primaryBtn.action === 'native-install') {
      // 能力检测通过 + preset 支持原生安装 → 显示一键安装按钮
      primaryBtn = { label: '一键安装', action: 'native-install' };
    } else if (!isIOSFamily && !isInApp && platform === 'oppo' && preset.primaryBtn && preset.primaryBtn.action === 'mark-oppo-installed') {
      // v1.5.6 新增：OPPO 走手动"网站变应用/添加到桌面"路径后的确认按钮
      // 仅 platform === 'oppo' 时触发,其他 9 个手机平台分支一行不动
      primaryBtn = { label: '我已添加到桌面,不再提示', action: 'mark-oppo-installed' };
    } else if (!isIOSFamily && !isInApp && platform === 'vivo' && preset.primaryBtn && preset.primaryBtn.action === 'mark-vivo-installed') {
      // v1.6.2 新增：vivo 走书签中转路径后的确认按钮
      // 仅 platform === 'vivo' 时触发,OPPO/其他分支完全不受影响
      primaryBtn = { label: '我已添加到桌面,不再提示', action: 'mark-vivo-installed' };
    } else if (preset.primaryBtn && preset.primaryBtn.action === 'copy-url') {
      // 复制链接按钮（仅 iOS-other / xiaomi 降级场景）
      primaryBtn = {
        label: preset.primaryBtn.label || '复制链接',
        action: 'copy-url',
        value: preset.primaryBtn.value,
        secondary: !!preset.primaryBtn.secondary,
      };
    }

    return {
      branchId: platform,
      title: preset.title,
      bodyHtml: bodyHtml,
      hint: preset.hint,
      primaryBtn: primaryBtn,
      // v1.6.3 新增：透传 preset.secondaryBtn 到 renderGuide
      // 之前 buildGuide 未传 secondaryBtn 导致 xiaomi 等 preset 配的 secondary 按钮不渲染
      secondaryBtn: preset.secondaryBtn,
      capability: cap,
    };
  }

  // ============================================================
  // 浮层渲染与交互
  // ============================================================

  function renderGuide(g) {
    var existing = document.getElementById('m94-pwa-guide');
    if (existing) {
      try { existing.remove(); } catch (e) {}
    }

    var root = document.createElement('div');
    root.id = 'm94-pwa-guide';
    root.setAttribute('data-branch', g.branchId);
    root.setAttribute('data-can-install', g.capability.canInstall ? '1' : '0');

    var hintHtml = g.hint
      ? '<p class="m94-pwa-desc" style="font-size:12px;color:#64748B;margin-top:10px">' + escapeHtml(g.hint) + '</p>'
      : '';

    var btnHtml = '';
    if (g.primaryBtn) {
      var btnClass = 'm94-pwa-btn' + (g.primaryBtn.secondary ? ' m94-pwa-btn-secondary' : '');
      btnHtml = '<button type="button" class="' + btnClass + '" id="m94-pwa-primary">' + escapeHtml(g.primaryBtn.label) + '</button>';
    }
    // v1.6.3 新增：renderGuide 支持 secondaryBtn（之前仅 renderGuideManual 支持）
    // 仅当 preset 配置 secondaryBtn 时才渲染（避免给其他无 secondary 的分支增加视觉噪音）
    if (g.secondaryBtn) {
      btnHtml += '<button type="button" class="m94-pwa-btn m94-pwa-btn-secondary" id="m94-pwa-secondary">' + escapeHtml(g.secondaryBtn.label) + '</button>';
    }

    var html = ''
      + '<div class="m94-pwa-mask" id="m94-pwa-mask"></div>'
      + '<div class="m94-pwa-sheet" id="m94-pwa-sheet" role="dialog" aria-modal="true" aria-labelledby="m94-pwa-title">'
      +   '<button type="button" class="m94-pwa-close" id="m94-pwa-close" aria-label="关闭">✕</button>'
      +   '<div class="m94-pwa-sheet-inner">'
      +     '<h2 class="m94-pwa-title" id="m94-pwa-title">' + escapeHtml(g.title) + '</h2>'
      +     g.bodyHtml
      +     hintHtml
      +     btnHtml
      +   '</div>'
      + '</div>';
    root.innerHTML = html;

    try {
      document.body.appendChild(root);
    } catch (e) {
      try { console.error('[PWA] appendChild failed:', e); } catch (e2) {}
      return;
    }

    var mask = root.querySelector('#m94-pwa-mask');
    var sheet = root.querySelector('#m94-pwa-sheet');
    var closeBtn = root.querySelector('#m94-pwa-close');
    var primaryBtn = root.querySelector('#m94-pwa-primary');
    var secondaryBtn = root.querySelector('#m94-pwa-secondary');

    function dismiss() {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) {}
      if (mask) mask.classList.remove('is-open');
      if (sheet) sheet.classList.remove('is-open');
      setTimeout(function () {
        try { root.remove(); } catch (e) {}
      }, 300);
    }

    if (mask) {
      mask.addEventListener('click', function () { dismiss(); });
    }
    if (closeBtn) {
      var closeHandler = function (e) {
        try {
          if (e && e.stopPropagation) e.stopPropagation();
          if (e && e.preventDefault) e.preventDefault();
        } catch (err) {}
        dismiss();
      };
      try { closeBtn.addEventListener('pointerdown', closeHandler); } catch (e) {}
      try { closeBtn.addEventListener('click', closeHandler); } catch (e) {}
    }

    function onKey(e) {
      try {
        if (e && e.key === 'Escape') dismiss();
      } catch (err) {}
    }
    document.addEventListener('keydown', onKey);

    var origDismiss = dismiss;
    dismiss = function () {
      try { document.removeEventListener('keydown', onKey); } catch (e) {}
      origDismiss();
    };

    // 主按钮
    if (primaryBtn && g.primaryBtn) {
      primaryBtn.addEventListener('click', function () {
        var action = g.primaryBtn.action;
        if (action === 'copy-url') {
          var text = g.primaryBtn.value || '';
          copyText(text).then(function () {
            var old = primaryBtn.textContent;
            primaryBtn.textContent = '已复制 ✓';
            primaryBtn.disabled = true;
            setTimeout(function () {
              primaryBtn.textContent = old;
              primaryBtn.disabled = false;
            }, 1800);
          }).catch(function (err) {
            try { console.error('[PWA] clipboard failed:', err); } catch (e) {}
          });
        } else if (action === 'native-install') {
          // v1.5.2: 统一异步入口（鸿蒙先私有 API → 失败再降级 deferredPrompt → 都不行才手动引导）
          handleNativeInstallAction(primaryBtn, dismiss);
        } else if (action === 'mark-oppo-installed') {
          // v1.5.6 新增：OPPO 用户走手动"网站变应用/添加到桌面"路径后点击确认
          // 写 localStorage 冷却键,后续访问不再弹引导
          if (markOppoInstalled()) {
            try { console.info('[PWA] oppo installed marked'); } catch (e) {}
            primaryBtn.textContent = '已记录 ✓';
            primaryBtn.disabled = true;
            setTimeout(dismiss, 900);
          } else {
            primaryBtn.textContent = '记录失败,请重试';
          }
        } else if (action === 'mark-vivo-installed') {
          // v1.6.2 新增：vivo 用户走书签中转路径后点击确认
          // 写 localStorage 冷却键,后续访问不再弹引导
          if (markVivoInstalled()) {
            try { console.info('[PWA] vivo installed marked'); } catch (e) {}
            primaryBtn.textContent = '已记录 ✓';
            primaryBtn.disabled = true;
            setTimeout(dismiss, 900);
          } else {
            primaryBtn.textContent = '记录失败,请重试';
          }
        }
      });
    }

    // v1.6.3 新增：secondary 按钮处理器（renderGuide 也支持 secondaryBtn）
    // 之前仅 renderGuideManual（鸿蒙分支）支持，现在小米等其他分支也能配 secondaryBtn
    // v1.5.8 改动：新增 mark-pwa-installed action（通用冷却，覆盖所有 12 个平台分支），
    //   原 mark-xiaomi-installed 保留向后兼容（仍走平台键）
    if (secondaryBtn && g.secondaryBtn) {
      secondaryBtn.addEventListener('click', function () {
        var action = g.secondaryBtn.action;
        if (action === 'mark-pwa-installed') {
          // v1.5.8 新增：通用安装冷却写入
          // 写后立即 dismiss,后续访问直接走 shouldShowNow() === false 路径
          if (markPwaInstalled()) {
            try { console.info('[PWA] pwa installed marked (secondary)'); } catch (e) {}
            secondaryBtn.textContent = '已记录 ✓';
            secondaryBtn.disabled = true;
            if (primaryBtn) primaryBtn.disabled = true;
            setTimeout(dismiss, 900);
          } else {
            secondaryBtn.textContent = '记录失败,请重试';
          }
        } else if (action === 'mark-xiaomi-installed') {
          // v1.6.3 新增：小米用户走书签中转手动添加桌面图标后点击确认
          // 写 localStorage 冷却键,后续访问不再弹引导
          if (markXiaomiInstalled()) {
            try { console.info('[PWA] xiaomi installed marked'); } catch (e) {}
            secondaryBtn.textContent = '已记录 ✓';
            secondaryBtn.disabled = true;
            if (primaryBtn) primaryBtn.disabled = true;
            setTimeout(dismiss, 900);
          } else {
            secondaryBtn.textContent = '记录失败,请重试';
          }
        }
      });
    }

    // 双 rAF 保证 layout 完成后再加 class 触发动画
    var shown = false;
    function showNow() {
      if (shown) return;
      shown = true;
      if (mask) mask.classList.add('is-open');
      if (sheet) sheet.classList.add('is-open');
      try { console.info('[PWA] guide shown, branch=' + g.branchId + ', canInstall=' + g.capability.canInstall); } catch (e) {}
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(showNow);
    });
  }

  function dismissGuide() {
    var existing = document.getElementById('m94-pwa-guide');
    if (!existing) return;
    var mask = existing.querySelector('#m94-pwa-mask');
    var sheet = existing.querySelector('#m94-pwa-sheet');
    if (mask) mask.classList.remove('is-open');
    if (sheet) sheet.classList.remove('is-open');
    setTimeout(function () {
      try { existing.remove(); } catch (e) {}
    }, 300);
  }

  function showGuide() {
    try {
      if (document.getElementById('m94-pwa-guide')) return;
      var g = buildGuide();
      renderGuide(g);
    } catch (err) {
      try { console.error('[PWA] showGuide error:', err); } catch (e) {}
    }
  }

  // ============================================================
  // 一键安装异步处理（v1.5.2）
  // 优先级：
  //   1. 鸿蒙 NEXT 浏览器 → 私有 installShortcut 候选（特性检测驱动，非鸿蒙跳过）
  //   2. 标准 beforeinstallprompt.deferredPrompt.prompt()
  //   3. 鸿蒙场景两个都失败 → 弹手动添加引导浮层
  //   4. 非鸿蒙场景 + 标准 prompt 失败 → 浮层保持，等待用户再次点击
  // 设计上严格保持其他机型行为不变：
  //   - 非鸿蒙 UA：步骤 1 跳过，行为与 v1.5.1 一致
  //   - 鸿蒙 UA + 标准 prompt 可用：步骤 2 优先，不影响 v1.5.1 行为
  // ============================================================

  function handleNativeInstallAction(btn, onSuccess) {
    if (!btn) btn = document.getElementById('m94-pwa-primary');
    var restore = function () {
      try { btn.disabled = false; btn.textContent = '一键安装'; } catch (e) {}
    };
    try { btn.disabled = true; btn.textContent = '安装中…'; } catch (e) {}

    var promise = Promise.resolve();

    // 步骤 1：鸿蒙私有 API（仅鸿蒙浏览器进入此分支）
    if (isHarmonyOSBrowser()) {
      promise = promise.then(function () {
        return tryHarmonyPrivateInstall().then(function (r) {
          if (r && r.ok) {
            try { btn.textContent = '安装成功 ✓'; } catch (e) {}
            try { console.info('[PWA] install source:', r.source); } catch (e) {}
            if (typeof onSuccess === 'function') onSuccess();
            return true; // 短路
          }
          try { console.info('[PWA] harmony private api failed, falling back to deferredPrompt'); } catch (e) {}
          return false;
        });
      });
    }

    // 步骤 2：标准 beforeinstallprompt（所有机型都走到）
    promise.then(function (handledOk) {
      if (handledOk) return;
      // v1.5.2 关键短路：鸿蒙 NEXT + 临时域 → 跳过 deferredPrompt.prompt()
      // 原因：鸿蒙浏览器对临时域会接住 prompt() 调用但弹它自己的"从菜单安装"对话框，
      //       真正的系统层安装依然静默拒绝。手动引导是当前唯一可靠路径。
      if (shouldSkipStandardPrompt()) {
        try { console.info('[PWA] skip standard prompt (harmony + tunnel domain), going manual'); } catch (e) {}
        return;
      }
      if (!deferredPrompt) return; // 没标准 prompt，跳到步骤 3
      try {
        deferredPrompt.prompt();
        return deferredPrompt.userChoice.then(function (choice) {
          try { console.info('[PWA] native install choice:', choice && choice.outcome); } catch (e) {}
          if (choice && choice.outcome === 'accepted') {
            deferredPrompt = null;
            // v1.5.8 新增：用户确认安装成功后,自动写通用冷却键
            // 与 appinstalled 事件冗余（事件触发也会写）但这里更早,关闭弹窗前已完成
            if (markPwaInstalled()) {
              try { console.info('[PWA] pwa installed marked (native accepted)'); } catch (e) {}
            }
            if (typeof onSuccess === 'function') onSuccess();
          }
        }).catch(function (err) {
          try { console.error('[PWA] prompt failed:', err); } catch (e) {}
        });
      } catch (err) {
        try { console.error('[PWA] prompt sync throw:', err); } catch (e) {}
      }
    })

    // 步骤 3：鸿蒙手动添加引导
    .then(function () {
      // 标准路径已处理则不打扰
      if (typeof onSuccess !== 'function' || btn.disabled) {
        // 上面 success 时已 disable, 但保险起见判一次 textContent
      }
    })
    .catch(function (err) {
      try { console.error('[PWA] handleNativeInstallAction error:', err); } catch (e) {}
    })
    .then(function () {
      // 收尾：根据安装源还原按钮
      // 成功状态保留 ✓，否则还原
      try {
        if (btn.textContent !== '安装成功 ✓') {
          btn.disabled = false;
          btn.textContent = '一键安装';
        }
      } catch (e) {}

      // 鸿蒙场景 + 没成功 → 手动引导
      if (isHarmonyOSBrowser() && btn.textContent !== '安装成功 ✓') {
        // 检测是否真的所有路径都失败：
        // - 私有 API 返回的 source === 'none' 或 'all-failed'
        // - 标准 prompt 不存在或被拒
        // 简化判断：所有 promise 都没触发成功回调
        // 这里用 deferredPrompt === null 或 appinstalled 事件未触发作为成功标志
        if (!isStandalone) {
          showHarmonyManualGuide();
        }
      }
    });
  }

  // 鸿蒙 NEXT 手动添加引导（v1.5.5 精简版）
  // 经 nova 16 SE 实测,该浏览器版本不支持真正 PWA,但支持创建桌面快捷方式。
  // v1.5.5 精简:
  //   - 删除"💡 关键提示"绿色框（manifest shortcuts 长篇说明）
  //   - 删除"其他升级路径"灰色框（备案域/HAP 打包提示）
  //   - 步骤从 4 步精简为 3 步（去掉步骤 4 长按图标做快捷方式的细节）
  //   - 顶部橙色说明精简为单行
  function showHarmonyManualGuide() {
    dismissGuide();
    setTimeout(function () {
      var bodyHtml = ''
        + '<p class="m94-pwa-desc" style="margin-bottom:14px">'
        +   '本浏览器不支持 PWA,可创建桌面快捷方式,从桌面图标一键打开应用。'
        + '</p>'
        + '<ol class="m94-pwa-steps">'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">1</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '点击华为浏览器右上角 <span class="key">⋮</span> 菜单(或底部 <span class="key">≡</span>)'
        +     '</div>'
        +   '</li>'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">2</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '选择 <span class="key">网站变应用</span> 或 <span class="key">添加到桌面</span>'
        +     '</div>'
        +   '</li>'
        +   '<li class="m94-pwa-step">'
        +     '<span class="m94-pwa-step-num">3</span>'
        +     '<div class="m94-pwa-step-content">'
        +       '在弹出确认框中点 <span class="key">添加</span>,完成'
        +     '</div>'
        +   '</li>'
        + '</ol>';
      renderGuideManual({
        title: '添加到鸿蒙桌面',
        bodyHtml: bodyHtml,
        // v1.5.8 修复：primary 改用 mark-pwa-installed（通用键）
        // 原 mark-installed 只写 m94-harmony-homescreen-installed（鸿蒙专用键），
        // 如果 SW 缓存旧版 JS 或浏览器清理 localStorage 时漏清平台键，会导致二次进入仍弹
        // 改用通用键后与所有 12 个平台分支统一，行为可预测
        primaryBtn: { label: '我已添加到桌面,不再提示', action: 'mark-pwa-installed' },
        // v1.5.8 新增：secondary 同时写平台键（语义辅助），不影响通用键冷却
        secondaryBtn: { label: '我也点一下（双重确认）', action: 'mark-pwa-installed' },
      });
    }, 320);
  }

  // 渲染手动引导浮层（轻量版，与 renderGuide 共享 css 类）
  // v1.5.3 支持双按钮：primaryBtn（主）和 secondaryBtn（次）
  // 主按钮在下方,次按钮在上方次要位置
  function renderGuideManual(g) {
    var existing = document.getElementById('m94-pwa-guide');
    if (existing) { try { existing.remove(); } catch (e) {} }

    var root = document.createElement('div');
    root.id = 'm94-pwa-guide';
    root.setAttribute('data-branch', 'huawei-manual');

    // 主按钮
    var btnHtml = '';
    if (g.primaryBtn) {
      btnHtml = '<button type="button" class="m94-pwa-btn" id="m94-pwa-primary">' + escapeHtml(g.primaryBtn.label) + '</button>';
    }
    // 次按钮（在主按钮下方,样式更轻)
    if (g.secondaryBtn) {
      btnHtml += '<button type="button" class="m94-pwa-btn m94-pwa-btn-secondary" id="m94-pwa-secondary">' + escapeHtml(g.secondaryBtn.label) + '</button>';
    }

    var html = ''
      + '<div class="m94-pwa-mask" id="m94-pwa-mask"></div>'
      + '<div class="m94-pwa-sheet" id="m94-pwa-sheet" role="dialog" aria-modal="true" aria-labelledby="m94-pwa-title">'
      +   '<button type="button" class="m94-pwa-close" id="m94-pwa-close" aria-label="关闭">✕</button>'
      +   '<div class="m94-pwa-sheet-inner">'
      +     '<h2 class="m94-pwa-title" id="m94-pwa-title">' + escapeHtml(g.title) + '</h2>'
      +     g.bodyHtml
      +     btnHtml
      +   '</div>'
      + '</div>';
    root.innerHTML = html;

    try {
      document.body.appendChild(root);
    } catch (e) {
      try { console.error('[PWA] renderGuideManual appendChild failed:', e); } catch (e2) {}
      return;
    }

    var mask = root.querySelector('#m94-pwa-mask');
    var sheet = root.querySelector('#m94-pwa-sheet');
    var closeBtn = root.querySelector('#m94-pwa-close');
    var primaryBtn = root.querySelector('#m94-pwa-primary');
    var secondaryBtn = root.querySelector('#m94-pwa-secondary');

    function dismiss() {
      try { document.removeEventListener('keydown', onKey); } catch (e) {}
      if (mask) mask.classList.remove('is-open');
      if (sheet) sheet.classList.remove('is-open');
      setTimeout(function () { try { root.remove(); } catch (e) {} }, 300);
    }

    function onKey(e) {
      try { if (e && e.key === 'Escape') dismiss(); } catch (err) {}
    }
    document.addEventListener('keydown', onKey);

    if (mask) mask.addEventListener('click', dismiss);
    if (closeBtn) {
      var closeHandler = function (e) {
        try {
          if (e && e.stopPropagation) e.stopPropagation();
          if (e && e.preventDefault) e.preventDefault();
        } catch (err) {}
        dismiss();
      };
      try { closeBtn.addEventListener('pointerdown', closeHandler); } catch (e) {}
      try { closeBtn.addEventListener('click', closeHandler); } catch (e) {}
    }

    if (primaryBtn && g.primaryBtn) {
      primaryBtn.addEventListener('click', function () {
        var action = g.primaryBtn.action;
        if (action === 'copy-url') {
          var text = g.primaryBtn.value || '';
          copyText(text).then(function () {
            primaryBtn.textContent = '已复制 ✓';
            primaryBtn.disabled = true;
            setTimeout(function () {
              primaryBtn.textContent = g.primaryBtn.label;
              primaryBtn.disabled = false;
            }, 1800);
          }).catch(function (err) {
            try { console.error('[PWA] manual clipboard failed:', err); } catch (e) {}
          });
        } else if (action === 'mark-installed') {
          // v1.5.3 新增：标记用户已通过桌面快捷方式打开,持久化冷却不再打扰
          if (markHarmonyHomescreenInstalled()) {
            try { console.info('[PWA] harmony homescreen installed marked'); } catch (e) {}
            primaryBtn.textContent = '已记录 ✓';
            primaryBtn.disabled = true;
            if (secondaryBtn) secondaryBtn.disabled = true;
            setTimeout(dismiss, 900);
          } else {
            primaryBtn.textContent = '记录失败,请重试';
          }
        }
      });
    }

    if (secondaryBtn && g.secondaryBtn) {
      secondaryBtn.addEventListener('click', function () {
        var action = g.secondaryBtn.action;
        if (action === 'copy-url') {
          var text = g.secondaryBtn.value || '';
          copyText(text).then(function () {
            secondaryBtn.textContent = '已复制 ✓';
            secondaryBtn.disabled = true;
            setTimeout(function () {
              secondaryBtn.textContent = g.secondaryBtn.label;
              secondaryBtn.disabled = false;
            }, 1800);
          }).catch(function (err) {
            try { console.error('[PWA] manual clipboard failed:', err); } catch (e) {}
          });
        } else if (action === 'mark-installed') {
          if (markHarmonyHomescreenInstalled()) {
            secondaryBtn.textContent = '已记录 ✓';
            secondaryBtn.disabled = true;
            setTimeout(dismiss, 900);
          }
        } else if (action === 'mark-pwa-installed') {
          // v1.5.8 新增：鸿蒙手动引导浮层 secondary 也支持通用冷却
          if (markPwaInstalled()) {
            try { console.info('[PWA] pwa installed marked (manual secondary)'); } catch (e) {}
            secondaryBtn.textContent = '已记录 ✓';
            secondaryBtn.disabled = true;
            setTimeout(dismiss, 900);
          }
        }
      });
    }

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (mask) mask.classList.add('is-open');
        if (sheet) sheet.classList.add('is-open');
        try { console.info('[PWA] guide shown, branch=huawei-manual'); } catch (e) {}
      });
    });
  }

  // ============================================================
  // 重新评估浮层：当 beforeinstallprompt 在用户停留期间迟到触发时，
  // 给用户一次升级体验的机会（一键安装按钮从无到有）
  // ============================================================

  function tryUpgradeGuide() {
    var existing = document.getElementById('m94-pwa-guide');
    if (!existing) return;
    if (!deferredPrompt) return;
    var platform = detectPlatform();
    var allowed = { 'android-chrome': 1, 'android-edge': 1, 'desktop': 1 };
    if (!allowed[platform]) return;
    // 重新渲染（带按钮）
    try { showGuide(); } catch (e) {}
  }

  // 监听 beforeinstallprompt（捕获后延迟几秒，给用户看引导的时间窗口）
  // 如果浮层还在显示，升级一次体验
  try {
    window.addEventListener('beforeinstallprompt', function () {
      setTimeout(tryUpgradeGuide, 500);
    });
  } catch (e) {}

  // ============================================================
  // 常驻右下角 ⊕ 入口按钮
  // ============================================================

  var ENTRY_BTN_ID = 'm94-install-entry';

  function ensureEntryButton() {
    var btn = document.getElementById(ENTRY_BTN_ID);
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = ENTRY_BTN_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', '安装应用到桌面');
    btn.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px', 'z-index:9997',
      'width:44px', 'height:44px', 'box-sizing:border-box',
      'padding:0', 'margin:0',
      'background:#2563EB', 'color:#fff', 'border:0',
      'border-radius:50%',
      'box-shadow:0 4px 12px rgba(37,99,235,.35)',
      'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif',
      'font-size:20px', 'font-weight:600', 'line-height:1',
      'display:flex', 'align-items:center', 'justify-content:center',
      'cursor:pointer', '-webkit-tap-highlight-color:transparent',
      'transition:transform .2s ease, box-shadow .2s ease',
    ].join(';');
    btn.innerHTML = '⊕';
    btn.addEventListener('mouseenter', function () {
      btn.style.transform = 'scale(1.08)';
      btn.style.boxShadow = '0 6px 16px rgba(37,99,235,.5)';
    });
    btn.addEventListener('mouseleave', function () {
      btn.style.transform = 'scale(1)';
      btn.style.boxShadow = '0 4px 12px rgba(37,99,235,.35)';
    });
    btn.addEventListener('click', function () {
      try { showGuide(); } catch (e) {}
    });
    try { document.body.appendChild(btn); } catch (e) {}
    return btn;
  }

  function showEntryButton() {
    try {
      if (isStandalone) return;
      ensureEntryButton();
    } catch (e) {}
  }

  // ============================================================
  // 版本更新机制（v1.5.9 新增，仿源项目 BuildingInformation）
  // - checkAppVersion: 远端 __app_version__ vs SW cache marker 对比
  // - triggerBackgroundPrecache: 不一致时静默同步 marker + 接管
  // ============================================================

  // 防止并发重复检测（同一会话内只跑一次）
  var __checkAppVersionInflight = null;

  function checkAppVersion() {
    if (__checkAppVersionInflight) return __checkAppVersionInflight;
    __checkAppVersionInflight = new Promise(function (resolve) {
      var remote = '';
      var local = '';
      var pending = 2;
      function done() {
        pending--;
        if (pending > 0) return;
        try {
          window.__APP_VERSION_REMOTE__ = remote;
          window.__APP_VERSION_LOCAL__ = local;
          if (!remote) { resolve(false); __checkAppVersionInflight = null; return; }
          if (!local)  { resolve(true);  __checkAppVersionInflight = null; return; }
          resolve(remote !== local);
        } catch (e) { resolve(false); }
        __checkAppVersionInflight = null;
      }
      // 1) 远端版本（no-store, 强制走网络）
      try {
        fetch('./__app_version__?_=' + Date.now(), {
          method: 'GET',
          cache: 'no-store',
          headers: { 'Accept': 'application/json' },
        })
        .then(function (r) { return r && r.ok ? r.json() : {}; })
        .then(function (j) {
          remote = (j && typeof j.version === 'string') ? j.version : '';
        })
        .catch(function () { remote = ''; })
        .then(done);
      } catch (e) { remote = ''; done(); }
      // 2) 本地 SW marker（5s 超时保护）
      try {
        var sw = navigator.serviceWorker.controller;
        if (!sw) { local = ''; done(); return; }
        var onMsg = function (ev) {
          if (!ev || !ev.data || ev.data.type !== 'APP_VERSION') return;
          local = (ev.data && typeof ev.data.version === 'string') ? ev.data.version : '';
          navigator.serviceWorker.removeEventListener('message', onMsg);
          clearTimeout(timer);
          done();
        };
        navigator.serviceWorker.addEventListener('message', onMsg);
        var timer = setTimeout(function () {
          navigator.serviceWorker.removeEventListener('message', onMsg);
          local = '';
          done();
        }, 5000);
        sw.postMessage({ type: 'GET_APP_VERSION' });
      } catch (e) { local = ''; done(); }
    });
    return __checkAppVersionInflight;
  }

  // 静默接管：版本不一致 → SET_VERSION 同步 marker + 标记待 reload
  function triggerBackgroundPrecache() {
    try {
      if (window.__SW_DOWNLOADING && window.__APP_VERSION_UPDATE_STARTED__) return false;
      var sw = navigator.serviceWorker.controller;
      if (!sw) return false;
      checkAppVersion().then(function (needUpdate) {
        if (!needUpdate) return;
        var remote = window.__APP_VERSION_REMOTE__ || '';
        try {
          if (remote) sw.postMessage({ type: 'SET_VERSION', version: remote });
          window.__APP_VERSION_UPDATE_STARTED__ = true;
          try { console.info('[PWA] 检测到新版本, 已同步 marker: ' + remote); } catch (e) {}
        } catch (e) {}
      }).catch(function () {
        // checkAppVersion 抛错（弱网）→ 不强求更新
      });
      return true;
    } catch (e) { return false; }
  }

  // ============================================================
  // Service Worker 注册（失败静默降级）
  // ============================================================

  function registerSW() {
    try {
      if (!('serviceWorker' in navigator)) {
        try { console.warn('[PWA] 浏览器不支持 SW, 静默降级'); } catch (e) {}
        return;
      }
      navigator.serviceWorker.register('./sw.js')
        .then(function (reg) {
          try { console.info('[SW] 注册成功:', reg && reg.scope); } catch (e) {}
          if (!reg) return;

          // ============ 版本更新接管（v1.5.9 新增）============
          // 检测到 waiting worker → 立即接管（静默 skipWaiting）
          if (reg.waiting) {
            try {
              window.__APP_VERSION_UPDATE_STARTED__ = true;
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            } catch (e) {}
          }
          // 监听新 SW 安装 → 完成后立即接管
          reg.addEventListener('updatefound', function () {
            var newSw = reg.installing;
            if (!newSw) return;
            newSw.addEventListener('statechange', function () {
              if (newSw.state === 'installed' && navigator.serviceWorker.controller) {
                try {
                  window.__APP_VERSION_UPDATE_STARTED__ = true;
                  newSw.postMessage({ type: 'SKIP_WAITING' });
                } catch (e) {}
              }
            });
          });
          // 3s 后尝试触发后台版本对比 + 同步 marker（避免抢页面首屏）
          setTimeout(function () {
            try { triggerBackgroundPrecache(); } catch (e) {}
          }, 3000);
          // ============ 版本更新接管结束 ============
        })
        .catch(function (err) {
          try { console.warn('[SW] 注册失败:', err); } catch (e) {}
        });
    } catch (e) { /* 注册异常不影响主流程 */ }
  }

  // ============ 版本更新接管：controllerchange 监听（v1.5.9 新增）============
  // 注意：必须检查 window.__pushnotify_reloading 以让位 push-subscribe.js 的接管
  //        也必须检查 window.__APP_VERSION_UPDATE_STARTED__ 避免双 reload
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (window.__pushnotify_reloading) return;  // 让位 push-subscribe
    if (window.__APP_VERSION_UPDATE_STARTED__) {
      window.__APP_VERSION_UPDATE_STARTED__ = false;
      try { console.info('[PWA] 新 SW 已接管, reload 应用新版本'); } catch (e) {}
      try { location.reload(); } catch (e) {}
      return;
    }
    // 首次注册接管 → 触发后台版本对比
    try { triggerBackgroundPrecache(); } catch (e) {}
  });

  // 网络恢复 → 重试版本对比（弱网环境续传）
  window.addEventListener('online', function () {
    try { triggerBackgroundPrecache(); } catch (e) {}
  });

  // ============ 版本更新接管：PWA 模式兼容（v1.5.9.1 修复）============
  // 问题：原 registerSW() 在 if (isStandalone) return; 之后才被调用，
  //       导致从 PWA 图标打开时 reg.waiting / updatefound / 3s 后 trigger
  //       三个关键监听全部漏挂。controllerchange 监听器在 IIFE 顶层不受影响。
  // 修复：把 updatefound / waiting / 3s 后 trigger 提到 IIFE 顶层，
  //       用 getRegistration() 拿现有注册（不依赖 registerSW）。
  function setupUpdateWatcher() {
    try {
      if (!('serviceWorker' in navigator)) return;
      // 已注册就别扫（registerSW 内部会再挂一遍，幂等）
      if (window.__APP_VERSION_WATCHER_READY__) return;
      window.__APP_VERSION_WATCHER_READY__ = true;

      navigator.serviceWorker.getRegistration()
        .then(function (reg) {
          if (!reg) return;
          // 已 waiting 的 SW → 立即接管
          if (reg.waiting) {
            try {
              window.__APP_VERSION_UPDATE_STARTED__ = true;
              reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            } catch (e) {}
          }
          // 新 SW 安装 → 完成后立即接管
          reg.addEventListener('updatefound', function () {
            var newSw = reg.installing;
            if (!newSw) return;
            newSw.addEventListener('statechange', function () {
              if (newSw.state === 'installed' && navigator.serviceWorker.controller) {
                try {
                  window.__APP_VERSION_UPDATE_STARTED__ = true;
                  newSw.postMessage({ type: 'SKIP_WAITING' });
                } catch (e) {}
              }
            });
          });
          // 主动触发一次 update 检测
          try { reg.update().catch(function () {}); } catch (e) {}
          // 3s 后尝试触发后台版本对比 + 同步 marker
          setTimeout(function () {
            try { triggerBackgroundPrecache(); } catch (e) {}
          }, 3000);
        })
        .catch(function () {});
    } catch (e) {}
  }
  // 浏览器模式下：等 registerSW 挂完后再调一次（registerSW 内部已经挂的，
  // 这里加 100ms 延迟走幂等保护，避免重复挂监听）
  // PWA 模式下：registerSW 没被调用，setupUpdateWatcher 单独兜底
  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setTimeout(setupUpdateWatcher, 100);
      });
    } else {
      setTimeout(setupUpdateWatcher, 100);
    }
  } catch (e) {}

  // ============================================================
  // 暴露给外部 API（v1.4.x 完全兼容,新增鸿蒙快捷方式冷却 API）
  // ============================================================

  window.PWAInstall = {
    showGuide: showGuide,
    dismissGuide: dismissGuide,
    isInstalled: function () { return isStandalone; },
    getPlatform: detectPlatform,
    hasNativePrompt: function () { return !!deferredPrompt; },
    // v1.5.0 新增：能力查询（让 push-subscribe 等模块可判断何时引导）
    getCapability: detectCapability,
    getPreset: function (id) {
      var p = GUIDE_PRESETS[id];
      return p ? JSON.parse(JSON.stringify(p)) : null;
    },
    // v1.5.3 新增：鸿蒙桌面快捷方式冷却控制
    markHarmonyHomescreenInstalled: markHarmonyHomescreenInstalled,
    hasHarmonyHomescreenInstalled: hasHarmonyHomescreenInstalled,
    clearHarmonyHomescreenInstalled: clearHarmonyHomescreenInstalled,
    // v1.5.6 新增：OPPO 桌面图标冷却控制（与鸿蒙 API 对称,互不影响）
    markOppoInstalled: markOppoInstalled,
    hasOppoInstalled: hasOppoInstalled,
    clearOppoInstalled: clearOppoInstalled,
    markVivoInstalled: markVivoInstalled,
    hasVivoInstalled: hasVivoInstalled,
    clearVivoInstalled: clearVivoInstalled,
    markXiaomiInstalled: markXiaomiInstalled,
    hasXiaomiInstalled: hasXiaomiInstalled,
    clearXiaomiInstalled: clearXiaomiInstalled,
    // v1.5.8 新增：通用安装冷却控制 API（与平台键 API 对称，覆盖所有 12 个平台分支）
    markPwaInstalled: markPwaInstalled,
    hasPwaInstalled: hasPwaInstalled,
    clearPwaInstalled: clearPwaInstalled,
    // v1.5.8.1 新增：桌面快捷方式二次回访检测（调试用，外部模块可主动调用）
    detectDesktopShortcutRevisit: detectDesktopShortcutRevisit,
    getLastVisitTs: getLastVisitTs,
  };

  // ============================================================
  // 启动
  // ============================================================

  // v1.5.3.1：URL 参数自动检测（用户从外部链接进入带特殊参数时自动标记冷却）
  // 支持的参数:
  //   ?from=homescreen        ← 鸿蒙/Chrome 桌面快捷方式常用
  //   ?source=homescreen
  //   ?installed=1            ← 通用标记
  //   ?install=mark           ← 强制标记并立即设置 localStorage
  // 这让用户首次创建桌面快捷方式后访问一次带参数的 URL,后续从快捷方式打开时即不打扰
  // v1.5.8 改动：除鸿蒙平台键外,同时写通用键（覆盖所有平台，包括 iOS/Android/Desktop 桌面图标）
  try {
    var params = new URLSearchParams(location.search);
    var autoMarkTriggers = ['from', 'source', 'installed', 'homescreen'];
    var shouldAutoMark = forceShow || params.get('install') === 'mark';
    if (!shouldAutoMark) {
      for (var i = 0; i < autoMarkTriggers.length; i++) {
        var v = (params.get(autoMarkTriggers[i]) || '').toLowerCase();
        if (v === 'homescreen' || v === 'desktop' || v === '1' || v === 'true') {
          shouldAutoMark = true;
          break;
        }
      }
    }
    if (shouldAutoMark && isHarmonyOSBrowser()) {
      if (markHarmonyHomescreenInstalled()) {
        try { console.info('[PWA] auto-marked harmony homescreen installed (param detected)'); } catch (e) {}
      }
    }
    // v1.5.8 新增：任何平台的桌面图标 URL 都自动写通用冷却键
    // （鸿蒙已写平台键 + 通用键,其他平台只写通用键,统一走 hasPwaInstalled() 判定）
    if (shouldAutoMark) {
      if (markPwaInstalled()) {
        try { console.info('[PWA] auto-marked pwa installed (param detected, all platforms)'); } catch (e) {}
      }
    }
  } catch (e) {}

  // v1.5.8.1 新增：自动识别「从桌面快捷方式二次回访」（无需用户点击任何按钮）
  // 适用场景：鸿蒙/OPPO/vivo/小米 通过书签中转创建的桌面图标（manifest shortcuts 路径不可用）
  // 判定条件：referrer 为空 + 有历史访问时间戳 + 时间差 < 30 天
  // 命中后自动写通用键 → shouldShowNow() 自然返回 false → 不弹引导
  // 注意：必须在 isStandalone 早返回之后执行，因为 standalone 模式 referrer 也可能为空
  if (!isStandalone && !hasPwaInstalled()) {
    try {
      if (detectDesktopShortcutRevisit()) {
        if (markPwaInstalled()) {
          try { console.info('[PWA] auto-marked pwa installed (desktop shortcut revisit detected)'); } catch (e) {}
        }
      }
    } catch (e) {}
  }

  // v1.5.8.1 新增：每次页面加载时记录访问时间戳（用于下次启动判定）
  // 必须在自动判定之后执行 → 否则本次会话无法识别自己
  try {
    setLastVisitTs(Date.now());
  } catch (e) {}

  if (isStandalone) return;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showEntryButton);
  } else {
    showEntryButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerSW);
  } else {
    registerSW();
  }

  // v1.5.8.2 启动调试日志（让用户能验证加载的是 v1.5.8.2 代码 + 全平台自动识别状态）
  try {
    var dbg = {
      version: 'v1.5.8.2',
      platform: detectPlatform(),
      isHarmony: isHarmonyOSBrowser(),
      isStandalone: isStandalone,
      referrer: typeof document.referrer === 'string' ? (document.referrer || '(empty)') : '(unknown)',
      lastVisitTs: getLastVisitTs(),
      pwaInstalled: hasPwaInstalled(),
      shortcutRevisit: detectDesktopShortcutRevisit(),  // v1.5.8.1 新增
      shouldShowGuide: shouldShowNow(),
      swReg: 'pending',
    };
    navigator.serviceWorker && navigator.serviceWorker.getRegistration && navigator.serviceWorker.getRegistration().then(function (r) {
      dbg.swReg = r && r.active ? (r.active.scriptURL || 'active') : 'none';
      try { console.info('[PWA] debug:', JSON.stringify(dbg, null, 2)); } catch (e) {}
      try { console.info('[PWA] to mark all: PWAInstall.markPwaInstalled()'); } catch (e) {}
    }).catch(function () {
      try { console.info('[PWA] debug:', JSON.stringify(dbg, null, 2)); } catch (e) {}
    });
  } catch (e) {}

  if (!shouldShowNow()) return;

  if (forceShow) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showGuide);
    } else {
      showGuide();
    }
  } else {
    setTimeout(showGuide, 3000);
  }
})();
