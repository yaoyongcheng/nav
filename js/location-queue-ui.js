/**
 * 离线队列 UI 控制器（v1.6.13 重构：分 Tab 多业务展示）
 *
 * 职责：
 *   - 控制首页右下角「离线队列」按钮（#location-queue-btn）
 *   - 实时更新右上角红色 badge（#location-queue-badge），数字 = 全部 store 总和
 *   - 点击按钮弹窗：Tab 切换（全部 / 车辆位置 / 表单记录 / ...），列表 + 「立即同步」+「清空队列」+「关闭」
 *   - 启动时如果支持 Background Sync → 自动注册 'app-pending'
 *   - 5s 轮询一次 badge（弱网下看不到 SW 同步结果，靠这个同步 UI）
 *   - iOS fallback：监听 online / visibilitychange / pageshow 自动 drain
 *     （location-queue.js 内部已实现监听器；这里只 badge / 弹窗刷新）
 *
 * 依赖：js/location-queue.js（必须在之前加载，提供 OfflineQueue + LocationQueue）
 * 依赖：index.html 中 #location-queue-btn 按钮已存在
 *
 * 用法：在 index.html 引入此文件即可，无需手动调用任何 API
 */
(function () {
  'use strict';

  // ============ 工具 ============
  function $(id) { return document.getElementById(id); }

  function fmtTime(ts) {
    try {
      var d = new Date(ts);
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    } catch (e) { return '--:--:--'; }
  }

  function fmtCoord(v) {
    if (typeof v !== 'number') return '?';
    return v.toFixed(5);
  }

  // 业务 store → 显示标签映射
  // v1.6.13：内置 location-reports / entry-form-records，新增业务时在这里加一行即可
  const STORE_LABELS = {
    'location-reports': '🚗 车辆位置',
    'entry-form-records': '📋 表单记录',
  };

  function labelForStore(sn) {
    if (STORE_LABELS[sn]) return STORE_LABELS[sn];
    if (sn.indexOf('__legacy__:') === 0) return '🗄️ 旧数据';
    return '📦 ' + sn;
  }

  // 当前选中的 store filter（null = 全部）
  var _currentFilter = null;

  // ============ Badge 更新（全部 store 总和 + 顶部 banner 强提醒）============
  function updateBadge() {
    if (!window.OfflineQueue) return;
    window.OfflineQueue.countAll().then(function (n) {
      // 1. 按钮上的小红点 badge（兼容两套 id：旧 #location-queue-badge + 新 #qa-offline-queue-badge）
      var badges = ['location-queue-badge', 'qa-offline-queue-badge'];
      for (var i = 0; i < badges.length; i++) {
        var badge = $(badges[i]);
        if (!badge) continue;
        if (n > 0) {
          badge.textContent = n > 99 ? '99+' : String(n);
          badge.hidden = false;
        } else {
          badge.hidden = true;
        }
      }
      // 2. 顶部全局 banner（iPhone 上 Background Sync 不支持的强提醒）
      updateTopBanner(n);
    }).catch(function () { /* ignore */ });
  }

  // 顶部 banner：队列非空时显示在屏幕顶部
  // - 位置：fixed top（避开刘海）
  // - 点击 → openPanel()
  // - 视觉：橙色渐变背景，白字，明显但不遮挡地图（z-index 9998）
  function updateTopBanner(n) {
    var banner = $('offline-queue-top-banner');
    if (n <= 0) {
      if (banner) banner.style.display = 'none';
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'offline-queue-top-banner';
      banner.style.cssText =
        'position:fixed;top:env(safe-area-inset-top,0px);left:0;right:0;z-index:9998;' +
        'background:linear-gradient(135deg,#fa8c16,#d46b08);color:#fff;' +
        'padding:10px 14px;display:flex;align-items:center;justify-content:space-between;' +
        'box-shadow:0 2px 8px rgba(0,0,0,0.15);font-size:14px;font-weight:500;cursor:pointer;' +
        'font-family:-apple-system,BlinkMacSystemFont,Helvetica,sans-serif;';
      banner.innerHTML =
        '<span id="oqb-text">⚠️ 有数据待补发</span>' +
        '<span style="font-size:12px;opacity:0.9;">查看 →</span>';
      banner.addEventListener('click', openPanel);
      document.body.appendChild(banner);
    }
    banner.style.display = 'flex';
    var text = $('oqb-text');
    if (text) {
      text.textContent = '⚠️ 有 ' + n + ' 条数据待补发（' + (_isIOS() ? 'iOS 上需打开页面' : '网络恢复后') + '自动补发）';
    }
  }

  function _isIOS() {
    try {
      return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    } catch (_) { return false; }
  }

  // ============ 弹窗 DOM（lazy 创建）============
  function ensureModal() {
    var modal = $('location-queue-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'location-queue-modal';
    modal.innerHTML =
      '<div class="lqm-card" id="lqm-card">' +
        '<div class="lqm-header">' +
          '<span id="lqm-title">离线队列</span>' +
          '<button type="button" id="lqm-close-x" aria-label="关闭" style="background:none;border:none;font-size:20px;color:#999;cursor:pointer;line-height:1;-webkit-tap-highlight-color:transparent;touch-action:manipulation;">&times;</button>' +
        '</div>' +
        '<div class="lqm-tabs" id="lqm-tabs"></div>' +
        '<div class="lqm-status" id="lqm-status">加载中...</div>' +
        '<div class="lqm-list" id="lqm-list"></div>' +
        '<div class="lqm-ios-tip" id="lqm-ios-tip" style="display:none;">' +
          '📱 iOS 上需要保持页面打开或重新打开 App 才能自动补发' +
        '</div>' +
        '<div class="lqm-footer">' +
          '<button type="button" class="lqm-btn danger" id="lqm-clear">清空当前</button>' +
          '<button type="button" class="lqm-btn primary" id="lqm-sync">立即同步</button>' +
          '<button type="button" class="lqm-btn" id="lqm-close">关闭</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);

    // ============ v1.6.18 iOS PWA 关闭修复 ============
    // 原因：iOS Safari（尤其 PWA 模式）对动态 DOM 的 click 事件有时不触发；
    //       backdrop 点击判断 e.target === modal 在 iOS 上不准确。
    // 修复：
    //   1. click + pointerdown 双绑定（pointerdown 在 iOS WebKit 上响应更快）
    //   2. backdrop 判断改为 closest('.lqm-card')（更宽容）
    //   3. 下滑手势关闭（iOS 用户习惯）
    //   4. 遮罩透明度加重避免点透

    function onBackdropTap(e) {
      // 如果点击的不是 lqm-card 内部（即点击了 backdrop 区域）→ 关闭
      if (!e.target.closest || !e.target.closest('#lqm-card')) {
        closePanel();
      }
    }
    modal.addEventListener('click', onBackdropTap);
    modal.addEventListener('pointerdown', onBackdropTap);

    // 用 on + onclick 兜底（iOS 老版本可能 pointerdown 也不触发）
    var closeX = $('lqm-close-x');
    var closeBtn = $('lqm-close');
    function bindClose(el) {
      if (!el) return;
      el.onclick = function (e) {
        e.stopPropagation();
        closePanel();
        return false;
      };
      el.onpointerdown = function (e) {
        e.stopPropagation();
        closePanel();
        return false;
      };
    }
    bindClose(closeX);
    bindClose(closeBtn);

    $('lqm-clear').addEventListener('click', onClearClick);
    $('lqm-sync').addEventListener('click', onSyncClick);

    // ============ 下滑手势关闭（iOS PWA 友好）============
    var card = $('lqm-card');
    var touchStartY = 0;
    var touchStartX = 0;
    var touchMoved = false;
    card.addEventListener('touchstart', function (e) {
      var t = e.touches && e.touches[0];
      if (t) {
        touchStartY = t.clientY;
        touchStartX = t.clientX;
        touchMoved = false;
      }
    }, { passive: true });
    card.addEventListener('touchmove', function (e) {
      var t = e.touches && e.touches[0];
      if (!t) return;
      var dy = t.clientY - touchStartY;
      var dx = t.clientX - touchStartX;
      // 下滑超过 80px 且横向位移 < 60px（避免误触横向滚动）
      if (dy > 80 && Math.abs(dx) < 60) {
        touchMoved = true;
      }
    }, { passive: true });
    card.addEventListener('touchend', function () {
      if (touchMoved) {
        touchMoved = false;
        closePanel();
      }
    });

    return modal;
  }

  // ============ Tab 渲染（动态基于 store 列表）============
  function renderTabs(byStore, total) {
    var tabs = $('lqm-tabs');
    if (!tabs) return;
    var html = '';
    var allActive = _currentFilter == null;
    html += '<button type="button" class="lqm-tab' + (allActive ? ' active' : '') + '" data-store="">' +
      '全部 <span class="lqm-tab-num">' + total + '</span></button>';
    // 按固定顺序遍历 STORE_LABELS（保证 UI 稳定）
    Object.keys(STORE_LABELS).forEach(function (sn) {
      var cnt = (byStore[sn] || []).length;
      html += '<button type="button" class="lqm-tab' + (_currentFilter === sn ? ' active' : '') + '" data-store="' + sn + '">' +
        labelForStore(sn) + ' <span class="lqm-tab-num">' + cnt + '</span></button>';
    });
    // 其他未在 STORE_LABELS 里的 store（动态业务扩展）
    Object.keys(byStore).forEach(function (sn) {
      if (STORE_LABELS[sn] || sn.indexOf('__legacy__:') === 0) return;
      var cnt = (byStore[sn] || []).length;
      html += '<button type="button" class="lqm-tab' + (_currentFilter === sn ? ' active' : '') + '" data-store="' + sn + '">' +
        labelForStore(sn) + ' <span class="lqm-tab-num">' + cnt + '</span></button>';
    });
    tabs.innerHTML = html;
    // 绑定 tab 点击
    tabs.querySelectorAll('.lqm-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var store = tab.getAttribute('data-store');
        _currentFilter = store || null;
        renderPanel();
      });
    });
  }

  // ============ 列表项渲染 ============
  function renderItem(it) {
    var storeName = it.storeName || 'unknown';
    var storeLabel = labelForStore(storeName);
    var payload = it.payload || (it.body ? tryParseJSON(it.body) : {});
    var retryText = (it.retryCount || 0) > 0 ? '（已重试 ' + it.retryCount + ' 次）' : '';

    // 不同 store 类型的展示差异
    var body = '';
    if (storeName === 'location-reports') {
      // 车辆位置：车牌 + 经纬度
      body =
        '<div><span class="plate">' + (payload.PlateNumber || '?') + '</span>' +
          '<span class="retry">' + retryText + '</span>' +
          '<span style="float:right;color:#999;">' + fmtTime(it.timestamp) + '</span>' +
        '</div>' +
        '<div class="coords">' +
          '经度 ' + fmtCoord(payload.Longitude) + ' · 纬度 ' + fmtCoord(payload.Latitude) +
          (typeof payload.Direction === 'number' ? ' · 方向 ' + payload.Direction + '°' : '') +
        '</div>';
    } else if (storeName === 'entry-form-records') {
      // 表单：姓名 + 手机号 + 车牌
      body =
        '<div><span class="plate">' + (payload.name || '?') + '</span>' +
          '<span class="retry">' + retryText + '</span>' +
          '<span style="float:right;color:#999;">' + fmtTime(it.timestamp) + '</span>' +
        '</div>' +
        '<div class="coords">' +
          '📞 ' + (payload.phone || '?') +
          (payload.plateNumber ? ' · 🚗 ' + payload.plateNumber : '') +
          (payload.project ? ' · 📍 ' + payload.project : '') +
        '</div>';
    } else {
      // 通用：JSON 摘要 + label
      body =
        '<div><span class="plate">' + (it.label || storeName) + '</span>' +
          '<span class="retry">' + retryText + '</span>' +
          '<span style="float:right;color:#999;">' + fmtTime(it.timestamp) + '</span>' +
        '</div>' +
        '<div class="coords">' +
          '<code style="font-size:11px;color:#888;">' + JSON.stringify(payload).slice(0, 100) + '</code>' +
        '</div>';
    }
    return '<div class="lqm-item">' +
      '<div class="lqm-item-tag">' + storeLabel + '</div>' +
      body +
    '</div>';
  }

  function tryParseJSON(s) {
    try { return JSON.parse(s); } catch (e) { return {}; }
  }

  // ============ 弹窗渲染 ============
  function renderPanel() {
    if (!window.OfflineQueue) return;
    var list = $('lqm-list');
    var status = $('lqm-status');
    var title = $('lqm-title');
    if (!list || !status || !title) return;

    window.OfflineQueue.listAll().then(function (byStore) {
      // 过滤
      var allItems = [];
      Object.keys(byStore).forEach(function (sn) {
        byStore[sn].forEach(function (it) {
          // 给旧 DB 数据打 storeName 标签
          if (!it.storeName) it.storeName = sn;
          allItems.push(it);
        });
      });
      allItems.sort(function (a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });

      var filtered = _currentFilter
        ? allItems.filter(function (it) { return it.storeName === _currentFilter; })
        : allItems;
      var total = allItems.length;
      var n = filtered.length;

      // Tab 渲染（基于完整 store 列表，不过滤）
      renderTabs(byStore, total);

      // 标题 + 状态条
      var filterLabel = _currentFilter ? ' · ' + labelForStore(_currentFilter) : '';
      title.textContent = '离线队列' + filterLabel + ' (' + n + ' 条)';

      if (total === 0) {
        status.textContent = '✓ 当前队列为空，所有数据都已同步';
        status.style.color = '#52c41a';
      } else {
        var failedCount = allItems.filter(function (it) { return (it.retryCount || 0) > 0; }).length;
        if (failedCount > 0) {
          status.textContent = '⚠ 待同步 ' + total + ' 条，其中 ' + failedCount + ' 条已重试';
          status.style.color = '#fa8c16';
        } else {
          status.textContent = '⚠ 待同步 ' + total + ' 条（网络恢复后自动上传）';
          status.style.color = '#666';
        }
      }

      // 列表（最多 50 条）
      if (n === 0) {
        list.innerHTML = '<div class="lqm-empty">' +
          (_currentFilter ? '✓ 该业务无待同步数据' : '✓ 队列为空') +
        '</div>';
      } else {
        var showItems = filtered.slice(0, 50);
        var html = '';
        for (var i = 0; i < showItems.length; i++) {
          html += renderItem(showItems[i]);
        }
        if (n > 50) {
          html += '<div class="lqm-empty" style="color:#999;font-size:13px;">... 还有 ' + (n - 50) + ' 条未显示</div>';
        }
        list.innerHTML = html;
      }

      // 清空按钮文案：根据是否筛选切换
      var clearBtn = $('lqm-clear');
      if (clearBtn) {
        clearBtn.textContent = _currentFilter ? '清空该业务' : '清空全部';
      }
    }).catch(function (e) {
      status.textContent = '❌ 读取队列失败: ' + (e && e.message || e);
      status.style.color = '#ff4d4f';
      list.innerHTML = '';
    });
  }

  // ============ 弹窗事件 ============
  function openPanel() {
    _currentFilter = null;  // 打开时重置为全部
    ensureModal();
    $('location-queue-modal').classList.add('show');
    renderPanel();
    // iOS 提示：检测 iOS Safari 显示
    try {
      var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      var iosTip = $('lqm-ios-tip');
      if (iosTip) iosTip.style.display = isIOS ? 'block' : 'none';
    } catch (_) {}
  }

  function closePanel() {
    var modal = $('location-queue-modal');
    if (modal) modal.classList.remove('show');
  }

  function onSyncClick() {
    var status = $('lqm-status');
    if (status) {
      status.textContent = '⏳ 同步中...';
      status.style.color = '#1976d2';
    }
    var syncBtn = $('lqm-sync');
    if (syncBtn) syncBtn.disabled = true;

    // 优先让 SW 处理（Android Chrome + 主线程 message）
    var finished = false;
    var doneTimer = setTimeout(function () {
      if (finished) return;
      finished = true;
      // 兜底：主线程 drainNow
      if (window.OfflineQueue && typeof window.OfflineQueue.drainNow === 'function') {
        window.OfflineQueue.drainNow().then(function (r) {
          afterSync(r.total);
        }).catch(function () {
          afterSync({ ok: 0, fail: 0 });
        });
      } else {
        afterSync({ ok: 0, fail: 0 });
      }
    }, 5000);

    try {
      navigator.serviceWorker.ready.then(function (reg) {
        if (!reg || !reg.active) {
          clearTimeout(doneTimer);
          if (!finished) {
            finished = true;
            window.OfflineQueue.drainNow().then(function (r) { afterSync(r.total); }).catch(function () { afterSync({ ok: 0, fail: 0 }); });
          }
          return;
        }
        var onMsg = function (ev) {
          if (!ev || !ev.data) return;
          if (ev.data.type !== 'APP_DRAIN_DONE' && ev.data.type !== 'LOCATION_DRAIN_DONE') return;
          navigator.serviceWorker.removeEventListener('message', onMsg);
          clearTimeout(doneTimer);
          if (finished) return;
          finished = true;
          afterSync({ ok: ev.data.ok || 0, fail: ev.data.fail || 0 });
        };
        navigator.serviceWorker.addEventListener('message', onMsg);
        reg.active.postMessage({ type: 'APP_DRAIN_REQUEST' });
      }).catch(function () {
        clearTimeout(doneTimer);
        if (!finished) {
          finished = true;
          window.OfflineQueue.drainNow().then(function (r) { afterSync(r.total); }).catch(function () { afterSync({ ok: 0, fail: 0 }); });
        }
      });
    } catch (e) {
      clearTimeout(doneTimer);
      if (!finished) {
        finished = true;
        window.OfflineQueue.drainNow().then(function (r) { afterSync(r.total); }).catch(function () { afterSync({ ok: 0, fail: 0 }); });
      }
    }
  }

  function afterSync(r) {
    var syncBtn = $('lqm-sync');
    if (syncBtn) syncBtn.disabled = false;
    updateBadge();
    renderPanel();
    if (r && r.fail === 0 && r.ok === 0) {
      var status = $('lqm-status');
      if (status) {
        status.textContent = '⚠ 网络仍未恢复，稍后重试';
        status.style.color = '#fa8c16';
      }
    }
  }

  function onClearClick() {
    var msg = _currentFilter
      ? '确认清空「' + labelForStore(_currentFilter) + '」业务的所有离线数据？'
      : '确认清空所有离线队列？\n\n清空后未上传的数据将永久丢失。';
    if (!confirm(msg)) return;
    var p = _currentFilter
      ? window.OfflineQueue.clear(_currentFilter)
      : window.OfflineQueue.clear();
    p.then(function () {
      updateBadge();
      renderPanel();
    }).catch(function () {});
  }

  // ============ 初始化 ============
  function init() {
    // 兼容两套触发按钮：旧 #location-queue-btn（index.html 控制台） + 新 #qa-offline-queue（login.html 首页快捷入口）
    var btn1 = $('location-queue-btn');
    var btn2 = $('qa-offline-queue');
    if (btn1) btn1.addEventListener('click', openPanel);
    if (btn2) btn2.addEventListener('click', openPanel);
    if (!btn1 && !btn2) return;  // 没按钮就不启动轮询，避免空跑

    // 启动后立即更新 badge
    setTimeout(updateBadge, 1000);

    // 如果支持 Background Sync（Android Chrome / Edge 79+）→ 自动注册通用 tag 'app-pending'
    if (window.OfflineQueue && typeof window.OfflineQueue.hasBackgroundSync === 'function'
        && window.OfflineQueue.hasBackgroundSync()) {
      window.OfflineQueue.registerSync().catch(function () {});
    }

    // 监听网络恢复 → 立即更新 badge
    window.addEventListener('online', function () {
      setTimeout(updateBadge, 500);
    });

    // 定时轮询 badge（页面打开时每 5s 一次，弱网下看不到 SW 同步结果）
    setInterval(updateBadge, 5000);

    // 监听主线程 drain 完成事件 → 立即更新 badge
    if ('serviceWorker' in navigator) {
      try {
        navigator.serviceWorker.addEventListener('message', function (ev) {
          if (ev && ev.data && (ev.data.type === 'APP_DRAIN_DONE' || ev.data.type === 'LOCATION_DRAIN_DONE')) {
            updateBadge();
            // 如果弹窗已打开，自动刷新
            var modal = $('location-queue-modal');
            if (modal && modal.classList.contains('show')) renderPanel();
          }
        });
      } catch (_) {}
    }

    // 暴露给外部（调试用）
    window.LocationQueueUI = {
      open: openPanel,
      close: closePanel,
      updateBadge: updateBadge,
      refresh: renderPanel,
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
