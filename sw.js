/**
 * PWA Service Worker v1.6.11
 * - 完整的预缓存（应用 shell + 关键 JS/CSS）
 * - 跨域 CDN 资源缓存（no-cors opaque 模式）
 * - stale-while-revalidate 运行时策略
 * - networkFirst API 策略 + 离线 503 响应
 * - 导航请求离线降级到 offline.html
 * - Web Push: push / notificationclick / notificationclose 事件处理
 * - iOS 16.4+ PWA 桌面角标：push 事件内调用 self.navigator.setAppBadge
 *   让 iPhone 主屏幕图标显示未读消息数（系统级持久化，关闭 PWA 也保留）
 *
 * v1.6.22 变更:
 * - PRECACHE_URLS 新增 './js/app-launch.js' 与 './css/app-launch.css'
 *   （外部 App 唤起模块；不预缓存会导致 PWA 重启后走 SWR、旧版 JS 仍生效）
 * - SW_VERSION 由 tools/bump-version.py 统一注入
 *
 * v1.6.13 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/ios-badge.js v1.2.0
 * - ios-badge.js v1.2.0 修复「主线程清零后 SW 仍按旧值累加」问题
 *   · 现象: 10 → 打开PWA(主线程清零)→ 关闭 → 5条push → 15
 *   · 根因: 旧 v1.1.0 仅用 postMessage(controller) 通知 SW 校准，但 iOS PWA
 *     冷启动时 controller 经常是 null → 消息被静默丢弃 → SW 内部 Cache
 *     仍是 10 → push 累加 10+5=15
 * - v1.2.0: 主线程直接写入 SW 共享的 'badge-tracker' Cache
 *   · push handler 已经在读这个 Cache 累加，主线程也写同一份 → 共享单一真实源
 *   · 即使 postMessage 失败，下次 push 时 SW 也能读到主线程的最新值
 * - 行为兼容 v1.6.12：SW 内部 push handler 零改动，仅版本号升级触发客户端更新
 * - SW_VERSION 升级 v20261008-4d5e6f7a8b9c → v20261008-5e6f7a8b9c0d
 *
 * v1.6.12 变更:
 * - 修复 iOS PWA 桌面角标「连发多条 push 只显示 1」的根本问题
 * - v1.6.11 用 setAppBadge(payload.value) 是「设值」语义，被后到的 push 覆盖
 *   · 服务端 payload.badge 是图标 URL（不是数字），pickBadgeCount 永远落到默认 1
 *   · 5 条 push → setAppBadge(1) 调 5 次 → 角标始终是 1
 * - v1.6.12: SW 自身维护「累计未读数」计数器（用 Cache API 持久化）
 *   · push 事件: getStoredBadge() + payload 自带增量 → 累加 → setStoredBadge → setAppBadge
 *   · 主线程可 postMessage BADGE_SET / BADGE_CLEAR 让 SW 校准或清零
 *   · PWA 关闭时连续 5 条 push → 角标累加为 5（而非 1）
 *   · PWA 打开时主线程从服务端拉真实数 → postMessage BADGE_SET 覆盖 SW 缓存
 *   · 标记全部已读 → postMessage BADGE_CLEAR → SW clearAppBadge + 计数器归 0
 * - 行为完全兼容 v1.6.11：未传 unread 的旧 push payload 走默认 +1 路径
 * - PRECACHE_URLS 保持不变
 * - SW_VERSION 升级 v20261008-3c0d2aaa66fc → v20261008-4d5e6f7a8b9c
 *
 * v1.6.11 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/ios-badge.js v1.0.0（新增的 iOS PWA 桌面角标模块）
 * - push 事件 handler 中在 showNotification 之外增加 setAppBadge 调用
 *   · 解析 payload 中多种字段名（badge / unread / unreadCount / badgeCount / count / data.unread）
 *   · 默认 +1，可由后端在 push payload 里带具体数字精确控制
 *   · try/catch 包裹，setAppBadge 在不支持环境静默失败（不影响通知）
 * - PRECACHE_URLS 新增 './js/ios-badge.js'
 * - SW_VERSION 升级 v20260926-0f1d85ff0adc → v20261008-3c0d2aaa66fc
 * - 行为完全兼容 v1.6.10：未携带 unread 字段的 push payload 走默认 +1 路径
 *   旧的 showNotification + notificationclick 链路零变化
 *
 * v1.6.10 变更:
 *
 * v1.6.10 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/push-subscribe.js v1.4.11.4
 * - 真正修复 iOS 17+ PWA 弹窗不弹出：click handler 不再用 async function
 * - 之前的 v1.4.11.3 用 `async function` 包裹 click handler，但 async 函数本身就是异步的
 * - v1.4.11.4：click handler 改为同步 function，Notification.requestPermission()
 *   直接在同步路径里调用（不 await 前置），用 .then() 链驱动后续流程
 * - 这才是 iOS WebKit「short running user-generated event handler」要求的正确写法
 * - 提供 push-debug.html 诊断页（6 个测试按钮）让用户能看到真实状态
 *
 * v1.6.9 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/push-subscribe.js v1.4.11.3
 * - 修复 iOS 17+ PWA 系统权限弹窗不弹出的根本问题：click handler 拆分两步走
 * - iOS WebKit 严格规则要求 Notification.requestPermission() 必须在用户手势的
 *   「short running」同步窗口内调用；如果先 await 任何东西都会被静默 deny
 * - 新拆分：completeSubscription() 只负责订阅流程；权限请求放在 click handler 同步路径
 * - 配合 v1.6.8 的 controllerchange 条件 reload 修复，彻底解决 iOS PWA 弹窗不弹
 *
 * v1.6.8 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/push-subscribe.js v1.4.11.2
 * - 修复 iOS PWA 无限 reload 问题：controllerchange 监听器改为只在 reg.waiting 存在时才 reload
 * - 修复 iOS PWA 首次启动 SW 接管 controller 触发的 reload 死循环（导致权限弹窗永远被 reload 打断）
 * - pushManager.subscribe() 加 reload 防重入 sessionStorage 标记，防止 AbortError 重试时无限 reload
 * - 删除 message 字段误匹配（只匹配 name），避免 UnknownError / NotAllowedError 误触发 reload
 * - 行为完全兼容 v1.6.7：Android Chrome / 桌面浏览器 controllerchange 流程不变
 *
 * v1.6.7 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/push-subscribe.js v1.4.11（iOS PWA 订阅修复）
 * - iOS 16.6+ / 17.x PWA 模式下 Web Push 订阅静默失败的根因修复
 * - getSWRegistration() 始终等 navigator.serviceWorker.ready
 * - iOS PWA 授权后延迟 500ms 再 subscribe
 * - subscribe() 返回 null 或抛 AbortError / InvalidStateError / NotAllowedError 时自动 reload
 * - init() 检测 permission=granted 但无 subscription 时自动完成 subscribe（reload 恢复路径）
 * - 行为兼容 v1.6.6：Android Chrome / 桌面浏览器 push 流程不变
 *
 * v1.6.6 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/pwa-install.js v1.5.8.2（全平台自动识别桌面快捷方式二次回访）
 * - 明确 detectDesktopShortcutRevisit() 是平台无关函数（v1.5.8.1 注释仅写鸿蒙，实际所有 12 个平台分支都受益）
 * - 适用范围：iOS Safari/Chrome、Android Chrome/Edge/Samsung/Firefox、鸿蒙/OPPO/vivo/小米、桌面 Chrome/Edge
 * - 浮层里「我已添加到桌面」secondaryBtn 仅作为兜底（自动识别是主路径）
 * - 行为完全兼容 v1.6.5：未命中条件时原有 shouldShowNow 逻辑不变
 *
 * v1.6.5 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/pwa-install.js v1.5.8.1（自动识别桌面快捷方式二次回访）
 * - 用户从鸿蒙/OPPO/vivo/小米桌面图标进入时无需再点任何按钮，自动跳过引导
 * - 判定逻辑：referrer 空 + 有历史访问时间戳 + 时间差 < 30 天
 * - 新增 localStorage.m94-last-visit-ts 时间戳键（每次页面加载自动写入）
 * - 鸿蒙 showHarmonyManualGuide primary/secondary 都改用 mark-pwa-installed 通用键
 * - 行为完全兼容 v1.6.4：未命中条件时原有 shouldShowNow 逻辑不变
 *
 * v1.6.4 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/pwa-install.js v1.5.8（通用安装冷却）
 * - 新增 localStorage.m94-pwa-installed 通用冷却键
 * - 所有 12 个平台分支（除 in-app 外）preset 增加 secondaryBtn「我已添加到桌面,不再提示」
 * - 一键安装 accepted + appinstalled 事件触发时自动写通用冷却键
 * - URL 参数 ?from=homescreen / ?installed=1 等命中时自动写通用冷却键
 *   （不依赖鸿蒙检测,所有平台通用）
 * - 行为完全兼容 v1.6.3：原 4 个平台专用冷却键（harmony/oppo/vivo/xiaomi）保留,
 *   仅作为语义辅助;通用键与平台键互为冗余/兜底,后续访问不再弹引导
 *
 * v1.6.3 变更:
 * - xiaomi preset 增加 secondary 按钮"我已添加到桌面,不再提示"（action: mark-xiaomi-installed）
 * - 用户通过书签中转手动添加桌面图标后,点 secondary 写 localStorage 冷却键
 * - 下次从桌面快捷方式进入不再弹安装引导（避免重复打扰）
 * - renderGuide 扩展支持 secondaryBtn（之前仅 renderGuideManual 支持）
 * - 新增 XIAOMI_INSTALLED_KEY 冷却键 + mark/has/clear 函数（与 OPPO/vivo 隔离）
 * - shouldShowNow 增加 isXiaomi && hasXiaomiInstalled() 冷却判断
 * - window.PWAInstall 暴露 mark/has/clearXiaomiInstalled API
 * - 行为兼容 v1.6.2：其他 10 个手机平台分支零影响（renderGuide 扩展是 aditive，未配 secondaryBtn 的分支无变化）
 *
 * v1.6.2 变更:
 * - vivo preset 同步改造为书签中转路径（与 OPPO HeyTap 相同的"先收藏再长按"流程）
 * - 实测 vivo i 浏览器没有"添加到桌面"原生菜单，必须走书签中转
 * - 新增 VIVO_INSTALLED_KEY 冷却键（与 OPPO 隔离，方便后续差异化）
 * - 新增 mark/has/clear VIVOInstalled 函数 + buildGuide/handlePrimaryAction/shouldShowNow 分支
 * - 行为兼容 v1.6.1：其他 10 个手机平台分支零影响
 *
 * v1.6.1 变更:
 * - OPPO 引导语菜单图标从三竖点 ⋮ 换成三横杠 hamburger ☰（U+2630）
 * - 与 OPPO HeyTap 真机浏览器底部菜单按钮样式一致
 * - 行为完全兼容 v1.6.0：仅文案字符替换
 *
 * v1.6.0 变更:
 * - **重大修复**: isOPPO UA 检测正则补全 HeyTapBrowser / HeyTap 关键词
 * - 之前仅匹配 OppoBrowser|ColorOS，但 ColorOS 14 真机 HeyTap 浏览器 UA 不含这两个词
 *   （只有 HeyTapBrowser/14.x），导致真机 detectPlatform 落到 android-chrome 分支
 *   → 浮层文案完全是 Chrome 路径，跟 OPPO 真机菜单对不上，用户找不到入口
 * - 新正则 /OppoBrowser|ColorOS|HeyTapBrowser|HeyTap/i 兼容:
 *   · 老 ColorOS 内置浏览器（OppoBrowser 标识）
 *   · ColorOS 系统版本号（部分 UA 出现）
 *   · 新 HeyTap 浏览器（HeyTapBrowser/14.x 主标识）
 *   · HeyTap 通用简称（兜底）
 * - 行为兼容 v1.5.9：仅 OPPO 检测精度提升
 *
 * v1.5.9 变更:
 * - 精简 OPPO 分支引导文案：4 步压缩为 2 步（去重「再次点击 ⋮」与「桌面出现图标」冗余）
 * - 诚实提示精简为单行
 * - 行为完全兼容 v1.5.8：仅文案调整
 *
 * v1.5.8 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/pwa-install.js v1.5.8（修复注释里「星斜杠」序列误闭合导致的 SyntaxError）
 * - v1.5.7 文件第 46 行注释含「ios 系 / xiaomi」与「android 系 / desktop」，
 *   原始写法是 ios-asterisk/xiaomi，asterisk 与紧邻的斜杠被 JS 引擎误判为块注释结束符，
 *   后续内容被当代码解析 → 报语法错误 → 整个 IIFE 不执行 → window.PWAInstall 未定义 → 浮层不渲染
 * - 已改为「ios 系 / android 系」避开星号与斜杠相邻
 * - 行为完全兼容 v1.5.7：OPPO HeyTap 书签中转路径不变
 *
 * v1.5.7 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/pwa-install.js v1.5.7（OPPO HeyTap 书签中转路径）
 * - 行为完全兼容 v1.5.6：仅版本号 + 预缓存清理标识变化
 *
 * v1.5.6 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/pwa-install.js v1.5.5（鸿蒙指引精简）
 * - 删除指引中"💡 关键提示"绿色框（manifest shortcuts 长篇说明）
 * - 删除指引中"其他升级路径"灰色框（备案域/HAP 打包提示）
 * - 步骤从 4 步精简为 3 步；顶部橙色说明精简为单行
 * - 行为完全兼容 v1.5.4：仅版本号 + 预缓存清理标识变化
 *
 * v1.5.4 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/pwa-install.js v1.5.4（manifest shortcuts URL 加 ?from=homescreen 触发自动标记）
 * - 行为完全兼容 v1.5.3.1：仅版本号 + 预缓存清理标识变化
 *
 * v1.5.3.1 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/pwa-install.js v1.5.3.1（URL 参数自动标记冷却）
 * - 行为完全兼容 v1.5.3：仅版本号 + 预缓存清理标识变化
 *
 * v1.5.3 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/pwa-install.js v1.5.3（鸿蒙桌面快捷方式冷却）
 * - 行为完全兼容 v1.5.2：仅版本号 + 预缓存清理标识变化
 *
 * v1.5.2 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/pwa-install.js v1.5.2（鸿蒙私有 API + 手动降级引导）
 * - 行为完全兼容 v1.5.1：仅版本号 + 预缓存清理标识变化
 *
 * v1.5.1 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/pwa-install.js v1.5.1（去 Chrome 化 + 鸿蒙专属优化）
 *
 * v1.5.0 变更:
 * - 升级 SW 版本号让旧 PWA 拉到 js/pwa-install.js v1.5.0（能力检测优先 + 国产 ROM 分支）
 *
 * v1.4.10 变更:
 * - 引导浮层增加「🔄 立即重试」按钮，点击触发 location.reload()
 * - 监听 visibilitychange：从后台切回 PWA 时，若浮层在显示，自动 reload
 * - 让 iOS 重新读取 Notification.permission（部分版本 reload 即可生效，无需杀进程）
 *
 * v1.4.9 变更:
 * - 永久拒绝引导文案修正为 iPhone 设置 → 通知 → 工地导航 → 允许通知
 *   （按用户实测：PWA 安装后设置里显示 PWA 应用名，不是 Safari）
 *
 * v1.4.8 变更:
 * - 修复「永久拒绝后再次点击按钮无响应」bug：
 *   再次点击时实时检查 Notification.permission === 'denied' → 弹引导浮层
 *   告知用户去 iPhone 设置开启，而非静默无动作
 *
 * v1.4.7 变更:
 * - 「开启通知」按钮可见性区分：
 *   - 浏览器模式（Safari/Chrome 普通网页）：CSS 默认隐藏
 *   - PWA 模式（主屏幕图标打开）：CSS media query 显示，JS 兜底强制 display:flex
 *
 * v1.4.6 变更:
 * - 恢复首页「开启通知」按钮节点（用户反馈希望显示）
 *
 * v1.4.5 变迁:
 * - 修复两个 bug：
 *   (1) 首次操作页面不再自动弹权限框（移除 onFirstGesture 自动触发）
 *   (2) 选了「不允许」按钮不变「禁止」，保持「开启通知」态
 *
 * v1.4.4 变更:
 * - 移除首页「开启通知」按钮节点（按用户要求，浏览器/PWA 都隐藏）
 *
 * v1.4.3 变更:
 * - 升级版本号让旧 PWA 拿到最新 js/push-subscribe.js（按钮状态以实时 Notification.permission 为权威）
 *
 * v1.4.2 变更:
 * - 预缓存新增 js/push-subscribe.js（iOS 首次手势触发订阅 + 首页「开启通知」按钮 UI 绑定）
 *
 * v1.4.1 变更:
 * - 新增 push 事件：显示系统通知（支持离线 / 锁屏 / 关闭状态）
 * - 新增 notificationclick：聚焦已有窗口或开新窗口 + 跳转目标 URL
 * - 新增 notificationclose：预留埋点
 *
 * v1.3.0 变更:
 * - 加入 js/floating-video.js + css/floating-video.css 到预缓存
 *   （之前漏掉，导致 PWA 重启后 floating-video 走 SWR，旧版 JS 仍生效）
 * - 版本号升级让旧缓存失效
 */

const SW_VERSION = 'v20261014-d916de606436';
const STATIC_CACHE = `static-${SW_VERSION}`;
const RUNTIME_CACHE = `runtime-${SW_VERSION}`;
const CDN_CACHE = `cdn-${SW_VERSION}`;

// 预缓存：应用核心资源（应用 shell）
const PRECACHE_URLS = [
  './',
  './login.html',
  './index.html',
  './admin_index.html',
  './offline.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/shortcut-login.png',
  './css/login.css',
  './css/pwa-install.css',
  './css/floating-ball.css',
  './css/floating-video.css',
  './js/login.js',
  './js/pwa-install.js',
  './js/floating-ball.js',
  './js/floating-video.js',
  './js/push-subscribe.js',
  './js/ios-badge.js',
  './push-debug.html',
  // v1.6.11 新增：离线队列模块（必须预缓存，断网时主线程需要它们做 IndexedDB 入队）
  './js/location-queue.js',
  './js/location-queue-ui.js',
  './js/vehicle-location-reporter.js',
  // v1.6.21 新增：相机采集模块（必须预缓存，否则 PWA 重启后走 SWR，旧版 JS 仍生效
  // —— 同 v1.3.0 floating-video 踩过的坑，见本文件上方注释）
  './js/camera-capture.js',
  './css/camera-capture.css',
  // v1.6.22 新增：外部 App 唤起模块（同上，必须预缓存）
  './js/app-launch.js',
  './css/app-launch.css',
  // v1.6.23 新增：蓝牙连接模块（同上，必须预缓存）
  './js/bluetooth.js',
  './css/bluetooth.css'
];

// CDN 域名白名单（这些资源缓存到专用 CDN_CACHE）
const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'res.wx.qq.com'
];

// ============ v1.6.12: iOS PWA 桌面角标累计计数器 ============
// 用一个独立 Cache 存「当前未读数」，跨 SW 重启/PWA 关闭都保留
// push 事件里 read → add → write → setAppBadge，实现真正的累加
const BADGE_CACHE = 'badge-tracker';
const BADGE_KEY = './__badge_count__';

async function getStoredBadge() {
  try {
    const cache = await caches.open(BADGE_CACHE);
    const resp = await cache.match(BADGE_KEY);
    if (!resp) return 0;
    const txt = await resp.text();
    const n = parseInt(txt, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (e) {
    return 0;
  }
}

async function setStoredBadge(n) {
  try {
    const cache = await caches.open(BADGE_CACHE);
    await cache.put(
      BADGE_KEY,
      new Response(String(Math.max(0, n | 0)), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      })
    );
  } catch (e) {
    // 缓存写失败不影响 setAppBadge
  }
}

async function addAndSetBadge(inc) {
  // 读取旧值 → 累加 → 写回 → setAppBadge
  const cur = await getStoredBadge();
  const incNum = Number.isFinite(inc) ? Math.max(0, inc | 0) : 1;
  const next = cur + incNum;
  await setStoredBadge(next);
  if (self.navigator && typeof self.navigator.setAppBadge === 'function') {
    if (next > 0) {
      await self.navigator.setAppBadge(next);
    } else if (typeof self.navigator.clearAppBadge === 'function') {
      await self.navigator.clearAppBadge();
    }
  }
  return next;
}

// ============ 安装事件 ============
self.addEventListener('install', (event) => {
  console.log(`[SW] 安装 ${SW_VERSION}`);
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] 部分预缓存失败（已忽略）:', err.message);
        // 即使部分失败也要继续，不阻塞 SW 激活
        return Promise.resolve();
      }))
      .then(() => self.skipWaiting())
  );
});

// ============ 激活事件 ============
self.addEventListener('activate', (event) => {
  console.log(`[SW] 激活 ${SW_VERSION}`);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.endsWith(SW_VERSION))
            .map((k) => {
              console.log(`[SW] 清理旧缓存: ${k}`);
              return caches.delete(k);
            })
      ))
      .then(() => self.clients.claim())
  );
});

// ============ 请求拦截 ============
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 跨域 CDN 资源 → 缓存到 CDN_CACHE（opaque 模式）
  if (CDN_HOSTS.includes(url.host)) {
    event.respondWith(staleWhileRevalidateOpaque(request, CDN_CACHE));
    return;
  }

  // 跨域非 CDN 请求（其他外部资源）→ 直接走网络
  if (url.origin !== self.location.origin) {
    return;
  }

  // API/代理请求 → network-first
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/proxy/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 导航请求（HTML 页面）→ navigationHandler（支持离线降级）
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(navigationHandler(request));
    return;
  }

  // 同源静态资源 → SWR
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

// 导航请求：网络优先，失败时降级到缓存页面，最后到 offline.html
async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    // 同步更新缓存
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // 离线：尝试缓存匹配
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    // 命中预缓存的 login.html（应用 shell）
    const precached = await caches.match('./login.html');
    if (precached) return precached;
    // 最后降级到 offline.html
    const offline = await caches.match('./offline.html');
    if (offline) return offline;
    return new Response('离线且无降级页面', { status: 503 });
  }
}

// stale-while-revalidate（透明响应）
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // 优先返回缓存（即使后台正在更新）
  if (cached) {
    // 后台异步更新，不阻塞当前返回
    networkFetch.catch(() => {});
    return cached;
  }
  // 无缓存：等待网络
  const networkResponse = await networkFetch;
  if (networkResponse) return networkResponse;
  // 彻底失败 → 通用离线响应
  return new Response('资源不可用', { status: 503 });
}

// stale-while-revalidate（opaque 响应，用于跨域 CDN）
async function staleWhileRevalidateOpaque(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)  // 默认 cors 模式
    .then((response) => {
      // 即使 opaque (status=0) 也缓存
      if (response && (response.ok || response.type === 'opaque')) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkFetch.catch(() => {});
    return cached;
  }
  const networkResponse = await networkFetch;
  if (networkResponse) return networkResponse;
  return new Response('CDN 资源不可用', { status: 503 });
}

// network-first（API）
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // 缓存成功的 API 响应
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(request);
    if (cached) {
      // 标记来自缓存
      const body = await cached.clone().json().catch(() => ({ success: false }));
      return new Response(
        JSON.stringify({ ...body, _fromCache: true, message: '离线缓存数据' }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'X-From-Cache': 'true' } }
      );
    }
    return new Response(
      JSON.stringify({ success: false, error: 'offline', message: '网络不可用，请检查连接' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ============ 消息处理 ============
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => event.source.postMessage({ type: 'CACHE_CLEARED' }))
    );
  }
  // v1.6.12 新增：主线程校准 iOS PWA 桌面角标
  // BADGE_SET: 主线程从服务端拉到真实未读数（如 syncFromServer 完成后）
  // BADGE_CLEAR: 主线程清零（如 markAllAsRead 后）
  if (event.data && (event.data.type === 'BADGE_SET' || event.data.type === 'BADGE_CLEAR')) {
    const target = (event.data.type === 'BADGE_CLEAR') ? 0
      : (Number.isFinite(event.data.value) ? Math.max(0, event.data.value | 0) : 0);
    event.waitUntil((async () => {
      try {
        await setStoredBadge(target);
        if (target > 0 && self.navigator && typeof self.navigator.setAppBadge === 'function') {
          await self.navigator.setAppBadge(target);
        } else if (self.navigator && typeof self.navigator.clearAppBadge === 'function') {
          await self.navigator.clearAppBadge();
        }
        if (event.source) {
          event.source.postMessage({ type: 'BADGE_SET_DONE', value: target, ok: true });
        }
      } catch (e) {
        if (event.source) {
          event.source.postMessage({ type: 'BADGE_SET_DONE', value: target, ok: false, error: String(e && e.message || e) });
        }
      }
    })());
  }
  // v1.6.11 新增：返回 SW 内部版本号（默认 SW_VERSION，回退到 cache marker）
  if (event.data && event.data.type === 'GET_APP_VERSION' && event.source) {
    event.waitUntil((async () => {
      try {
        let v = SW_VERSION;
        try {
          const cache = await caches.open(STATIC_CACHE);
          const resp = await cache.match('./__app_version_marker__');
          if (resp) v = (await resp.text()) || SW_VERSION;
        } catch (_) { /* cache miss → 用 SW_VERSION */ }
        event.source.postMessage({ type: 'APP_VERSION', version: String(v || SW_VERSION) });
      } catch (e) {
        try { event.source.postMessage({ type: 'APP_VERSION', version: SW_VERSION }); } catch (_) {}
      }
    })());
  }
  // v1.6.11 新增：写入版本号 marker 到 STATIC_CACHE（防止 SW_VERSION 字面量与远端不一致）
  if (event.data && event.data.type === 'SET_VERSION'
      && typeof event.data.version === 'string' && event.data.version.length > 0) {
    event.waitUntil((async () => {
      const ver = String(event.data.version);
      try {
        const cache = await caches.open(STATIC_CACHE);
        await cache.put(
          './__app_version_marker__',
          new Response(ver, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
        );
        if (event.source) {
          event.source.postMessage({ type: 'APP_VERSION_SET', version: ver, ok: true });
        }
      } catch (e) {
        if (event.source) {
          event.source.postMessage({ type: 'APP_VERSION_SET', version: ver, ok: false });
        }
      }
    })());
  }
  // v1.6.13 新增：主线程请求 SW 立即消费离线队列（通用 APP_DRAIN_REQUEST）
  // 兼容旧 LOCATION_DRAIN_REQUEST（返回 LOCATION_DRAIN_DONE）
  if (event.data && event.source) {
    const reqType = event.data.type;
    if (reqType === 'APP_DRAIN_REQUEST' || reqType === 'LOCATION_DRAIN_REQUEST') {
      event.waitUntil((async () => {
        try {
          const result = await drainAllPending();
          const respType = reqType === 'LOCATION_DRAIN_REQUEST' ? 'LOCATION_DRAIN_DONE' : 'APP_DRAIN_DONE';
          event.source.postMessage({
            type: respType,
            ok: result.total.ok,
            fail: result.total.fail,
            byStore: result.byStore,
            networkDown: !!result.networkDown,
          });
        } catch (e) {
          try {
            const respType = reqType === 'LOCATION_DRAIN_REQUEST' ? 'LOCATION_DRAIN_DONE' : 'APP_DRAIN_DONE';
            event.source.postMessage({ type: respType, ok: 0, fail: 0, error: String(e && e.message || e) });
          } catch (_) {}
        }
      })());
    }
  }
});

// ============ Web Push 推送处理 ============
// v1.4.0 新增：接收 Push Service 转发的推送，显示系统通知
// 即使浏览器关闭 / PWA 已杀 / 锁屏，也能触发（依赖 Push Service 缓存）
// v1.6.11 新增：push 事件内调用 navigator.setAppBadge 让 iOS 16.4+ PWA
//   桌面图标角标显示未读数（即使 PWA 没打开也能设置，iOS 系统级持久化）
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    // 后端可能发的是 text，不是 JSON
    try { payload = { title: '通知', body: event.data.text() }; } catch (_) {}
  }

  const title = payload.title || '主工地数字导航';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-192.png',
    tag: payload.tag || 'main-9.4-push',
    renotify: !!payload.tag,         // 同 tag 的推送不重复提示音
    requireInteraction: false,
    data: {
      url: payload.url || '/login.html',
      ts: Date.now(),
    },
    // 振动模式（支持的设备）：[震动, 暂停, 震动]
    vibrate: [200, 100, 200],
  };

  // v1.6.12：解析 payload 中的「本次新增」未读数字段
  // 兼容多种字段命名：badge / unread / badgeCount / count
  // 注意：payload.badge 在本项目里是图标 URL 字符串（不是数字），
  //       parseInt 后会是 NaN，所以本函数实际总是返回默认 1
  function pickBadgeCount(p) {
    if (!p || typeof p !== 'object') return 1;
    const candidates = [
      p.unread, p.unreadCount, p.badgeCount, p.count,
      p.data && p.data.unread,
      p.data && p.data.badgeCount
    ];
    for (let i = 0; i < candidates.length; i++) {
      const v = candidates[i];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
      if (typeof v === 'string') {
        const n = parseInt(v, 10);
        if (Number.isFinite(n) && n >= 0) return n;
      }
    }
    return 1; // 默认 +1
  }

  const badgeInc = pickBadgeCount(payload);

  event.waitUntil((async () => {
    try {
      await self.registration.showNotification(title, options);
    } catch (err) {
      console.warn('[SW] showNotification 失败:', err && err.message);
    }
    // iOS 16.4+ Safari PWA 桌面角标：累加而非覆盖
    // v1.6.11 bug: 直接 setAppBadge(inc) → 后到的 push 覆盖前面的
    // v1.6.12 修复: getStoredBadge → +inc → setStoredBadge → setAppBadge
    try {
      const next = await addAndSetBadge(badgeInc);
      console.info('[SW] push 累加角标:', badgeInc, '→ 当前总数 =', next);
    } catch (err) {
      // 累加失败兜底：用老的 setAppBadge 路径，避免完全没反应
      try {
        if (self.navigator && typeof self.navigator.setAppBadge === 'function') {
          await self.navigator.setAppBadge(badgeInc);
        }
      } catch (_) {}
    }
  })());
});

// ============ 点击通知 → 打开或聚焦应用 ============
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/login.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 已有窗口 → 聚焦并导航
      for (const client of windowClients) {
        if ('focus' in client) {
          return client.focus().then((focused) => {
            if ('navigate' in focused) return focused.navigate(targetUrl);
            // 老浏览器只能 postMessage 让页面自己处理
            focused.postMessage({ type: 'PUSH_NAVIGATE', url: targetUrl });
            return focused;
          });
        }
      }
      // 没有窗口 → 新开一个
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

// 通知关闭（可选：埋点用）
self.addEventListener('notificationclose', (event) => {
  // 留空；如需埋点在此 event.waitUntil(fetch('/api/push/closed', {...}))
});

// ============ 通用离线请求队列（v1.6.13 重构：多 store 通用）============
// SW 上下文独立实现 IndexedDB 操作（与主线程 location-queue.js / OfflineQueue 共享 Schema）
// - DB 名：m94-offline-queue（v2 多 store）
// - 旧 DB m94-location-queue（v1 单 store）保留读取兼容
const OFFLINE_QUEUE_DB = 'm94-offline-queue';
const OFFLINE_QUEUE_DB_VERSION = 2;
const OFFLINE_QUEUE_INDEX = 'by_timestamp';
const OFFLINE_QUEUE_MAX_RETRY = 5;
// 已注册的 store 名（与主线程 OfflineQueue.registerStore 列表保持一致）
const OFFLINE_QUEUE_STORES = ['location-reports', 'entry-form-records'];

function swOpenDB() {
  return new Promise(function (resolve, reject) {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported in SW'));
      return;
    }
    const req = indexedDB.open(OFFLINE_QUEUE_DB, OFFLINE_QUEUE_DB_VERSION);
    req.onupgradeneeded = function (event) {
      const db = event.target.result;
      for (const storeName of OFFLINE_QUEUE_STORES) {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex(OFFLINE_QUEUE_INDEX, 'timestamp', { unique: false });
        }
      }
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

function swDbReqToPromise(req) {
  return new Promise(function (resolve, reject) {
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

async function swReadStore(db, storeName) {
  const items = await swDbReqToPromise(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
  items.sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });
  return items;
}

async function swDeleteItem(db, storeName, id) {
  return swDbReqToPromise(db.transaction(storeName, 'readwrite').objectStore(storeName).delete(id));
}

async function swUpdateItem(db, storeName, item) {
  return swDbReqToPromise(db.transaction(storeName, 'readwrite').objectStore(storeName).put(item));
}

// 单 store drain（按时间顺序逐条重试）
// item 结构：{id, storeName, url, method, headers, body, label, timestamp, retryCount, lastAttemptAt}
async function swDrainStore(db, storeName) {
  let ok = 0, fail = 0, http4xx = 0, giveup = 0, networkDown = false;
  let items;
  try {
    items = await swReadStore(db, storeName);
  } catch (e) {
    console.error('[SW] swDrainStore(' + storeName + '): read failed:', e);
    return { ok: 0, fail: 0, http4xx: 0, giveup: 0, networkDown: false };
  }
  for (const item of items) {
    try {
      const resp = await fetch(item.url, {
        method: item.method || 'POST',
        headers: item.headers || {},
        body: item.body || undefined,
      });
      if (resp && resp.ok) {
        try { await swDeleteItem(db, storeName, item.id); } catch (_) {}
        ok++;
      } else if (resp && resp.status >= 400 && resp.status < 500) {
        // 4xx：业务错误，不重试
        try { await swDeleteItem(db, storeName, item.id); } catch (_) {}
        http4xx++;
        fail++;
        console.warn('[SW] swDrainStore(' + storeName + '): HTTP ' + resp.status + ' → drop #' + item.id);
      } else {
        // 5xx：retry 计数 + 超过上限丢弃
        item.retryCount = (item.retryCount || 0) + 1;
        if (item.retryCount >= OFFLINE_QUEUE_MAX_RETRY) {
          try { await swDeleteItem(db, storeName, item.id); } catch (_) {}
          giveup++;
          fail++;
          console.warn('[SW] swDrainStore(' + storeName + '): gave up #' + item.id);
        } else {
          item.lastAttemptAt = Date.now();
          try { await swUpdateItem(db, storeName, item); } catch (_) {}
          fail++;
        }
        break;  // 失败时停止本次 drain，等下次 sync / 触发
      }
    } catch (networkErr) {
      console.info('[SW] swDrainStore(' + storeName + '): network still down');
      networkDown = true;
      break;
    }
  }
  if (ok > 0 || fail > 0) {
    console.info('[SW] swDrainStore(' + storeName + '): ok=' + ok + ' fail=' + fail + ' 4xx=' + http4xx + ' giveup=' + giveup);
  }
  return { ok: ok, fail: fail, http4xx: http4xx, giveup: giveup, networkDown: networkDown };
}

// SW 上下文内的通用 drain 函数（Background Sync 或主线程 APP_DRAIN_REQUEST 触发）
// 遍历全部 store 依次 drain；网络断时停止后续 store
async function drainAllPending() {
  let db;
  try {
    db = await swOpenDB();
  } catch (e) {
    console.error('[SW] drainAllPending: open DB failed:', e);
    return { byStore: {}, total: { ok: 0, fail: 0 } };
  }
  const byStore = {};
  let totalOk = 0, totalFail = 0, networkDown = false;
  for (const storeName of OFFLINE_QUEUE_STORES) {
    const r = await swDrainStore(db, storeName);
    byStore[storeName] = r;
    totalOk += r.ok;
    totalFail += r.fail;
    if (r.networkDown) {
      networkDown = true;
      break;
    }
  }
  if (totalOk > 0 || totalFail > 0) {
    console.info('[SW] drainAllPending: ok=' + totalOk + ' fail=' + totalFail);
  }
  return { byStore: byStore, total: { ok: totalOk, fail: totalFail }, networkDown: networkDown };
}

// Background Sync 事件监听（Android Chrome / Edge 79+）
// v1.6.13：通用 tag 'app-pending'；保留 'location-reports' 向后兼容旧 LocationQueue 注册
self.addEventListener('sync', (event) => {
  if (event.tag === 'app-pending' || event.tag === 'location-reports') {
    console.log('[SW] Background Sync fired: ' + event.tag);
    event.waitUntil(drainAllPending());
  }
});