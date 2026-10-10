/**
 * 悬浮球 + 表单暂存
 * - 可拖拽悬浮按钮（位置记忆）
 * - 点击弹出表单（10项字段）
 * - 实时自动保存到 localStorage
 * - 下次打开自动恢复数据
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'fb_form_draft_v1';
  const POSITION_KEY = 'fb_ball_position_v1';

  // 10 项表单字段（工地进场登记场景）
  const FIELDS = [
    { key: 'name', label: '司机姓名', type: 'text', placeholder: '请输入姓名', required: true },
    { key: 'phone', label: '联系电话', type: 'tel', placeholder: '11位手机号', required: true, pattern: '^1[3-9]\\d{9}$' },
    { key: 'plate', label: '车牌号', type: 'text', placeholder: '例如：鄂A12345', required: true },
    { key: 'company', label: '所属公司', type: 'text', placeholder: '物流/运输公司' },
    { key: 'project', label: '进场项目', type: 'select', options: ['', '武汉天河机场项目', '光谷综合体项目', '雄楚大街改造', '汉阳大道扩建', '其他'] },
    { key: 'entryDate', label: '进场日期', type: 'date', required: true },
    { key: 'entryTime', label: '进场时间', type: 'time', required: true },
    { key: 'cargo', label: '货物类型', type: 'select', options: ['', '建材钢材', '水泥砂石', '土方', '设备机械', '其他'] },
    { key: 'weight', label: '货物重量（吨）', type: 'number', placeholder: '0.0', step: '0.1', min: '0' },
    { key: 'remark', label: '备注', type: 'textarea', placeholder: '特殊说明（最多 200 字）', maxlength: '200' }
  ];

  // ============ 工具函数 ============
  function debounce(fn, ms) {
    let t = null;
    function debounced(...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        t = null;
        fn.apply(this, args);
      }, ms);
    }
    // 立即执行挂起的调用（用于 blur 等需要同步落盘的场景）
    debounced.flush = function (...args) {
      if (t) {
        clearTimeout(t);
        t = null;
        fn.apply(this, args);
      }
    };
    return debounced;
  }

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
      return true;
    } catch (e) {
      console.warn('[FB] 保存失败:', e);
      return false;
    }
  }

  function removeKey(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {}
  }

  // ============ 关闭浮层（v1.6.13 提升到 module 级，供 submitForm / _enqueueEntryForm 使用）============
  function closeFbModal() {
    var root = document.getElementById('fb-modal-root');
    if (!root) return;
    root.classList.add('fb-hiding');
    setTimeout(function () {
      if (root && root.parentNode) root.parentNode.removeChild(root);
    }, 200);
  }

  // ============ 创建悬浮球 ============
  function createBall() {
    const ball = document.createElement('div');
    ball.className = 'fb-ball fb-pulse';
    ball.id = 'fb-ball';
    ball.innerHTML = '✏️';
    ball.title = '点击填写进场登记';
    document.body.appendChild(ball);

    // 恢复位置
    const savedPos = loadJSON(POSITION_KEY);
    if (savedPos && Number.isFinite(savedPos.x) && Number.isFinite(savedPos.y)) {
      ball.style.left = savedPos.x + 'px';
      ball.style.top = savedPos.y + 'px';
      ball.style.right = 'auto';
      ball.style.bottom = 'auto';
    }

    // 拖拽逻辑
    makeDraggable(ball, () => {
      // 拖拽结束时吸附到边缘
      snapToEdge(ball);
      savePosition(ball);
    });

    // 点击打开表单（区分点击 vs 拖拽）
    let dragMoved = false;
    ball.addEventListener('click', () => {
      if (!dragMoved) openForm();
    });
    ball.addEventListener('touchend', () => {
      // 触摸端 click 在某些情况下不触发
      if (!dragMoved) {
        setTimeout(() => openForm(), 50);
      }
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
      el.classList.add('fb-dragging');
      // 禁用文字选中
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
      // 边界
      newX = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, newX));
      newY = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, newY));
      el.style.left = newX + 'px';
      el.style.top = newY + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      e.preventDefault?.();
    }

    function end() {
      el.classList.remove('fb-dragging');
      // 标记本次是否移动（用于区分点击）
      if (moved) {
        el.dataset.dragged = '1';
        setTimeout(() => { el.dataset.dragged = ''; }, 100);
      }
      startX = startY = undefined;
      if (typeof onEnd === 'function') onEnd();
    }

    // 鼠标
    el.addEventListener('mousedown', start);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);

    // 触摸
    el.addEventListener('touchstart', start, { passive: false });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);

    // 阻止拖拽时选中文本
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

  // ============ 表单模态框 ============
  function openForm() {
    // 避免重复打开
    if (document.getElementById('fb-modal-root')) return;

    const existing = loadJSON(STORAGE_KEY);
    const hasDraft = existing && Object.keys(existing).length > 0;

    const root = document.createElement('div');
    root.id = 'fb-modal-root';
    root.className = 'fb-backdrop';
    root.innerHTML = `
        <div class="fb-modal" role="dialog" aria-modal="true">
          <div class="fb-header">
            <div>
              <h2>🚛 进场登记</h2>
              <div class="fb-sub">填写内容自动保存到本地</div>
            </div>
            <div class="fb-save-indicator" id="fb-save-ind">
              <span class="fb-save-dot"></span>
              <span id="fb-save-text">已保存</span>
            </div>
            <button class="fb-close" id="fb-close-btn" aria-label="关闭">×</button>
          </div>
          ${hasDraft ? `
            <div style="padding:0 20px;padding-top:14px;">
              <div class="fb-restore-banner">
                <span>📋</span>
                <span>检测到上次未提交的草稿，已自动恢复</span>
                <button id="fb-clear-btn">清除</button>
              </div>
            </div>
          ` : ''}
          <form class="fb-form" id="fb-form" autocomplete="off">
            ${FIELDS.map((f, i) => renderField(f, i)).join('')}
          </form>
          <div class="fb-actions">
            <button class="fb-btn fb-btn-secondary" id="fb-reset-btn" type="button">重置</button>
            <button class="fb-btn fb-btn-primary" id="fb-submit-btn" type="button">提交</button>
          </div>
        </div>
      `;
    document.body.appendChild(root);

    // 关闭（v1.6.13 提取到 module 级，submitForm / _enqueueEntryForm 也要用）
    root.querySelector('#fb-close-btn').addEventListener('click', closeFbModal);
    root.addEventListener('click', (e) => {
      if (e.target === root) closeFbModal(); // 点击遮罩关闭
    });

    // 重置
    root.querySelector('#fb-reset-btn').addEventListener('click', () => {
      if (confirm('确定要清空所有已填写的内容吗？')) {
        removeKey(STORAGE_KEY);
        root.querySelectorAll('input, select, textarea').forEach(el => {
          if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
          else el.value = '';
        });
        showSavedIndicator('已重置');
      }
    });

    // 清除按钮（恢复横幅上的）
    const clearBtn = root.querySelector('#fb-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        removeKey(STORAGE_KEY);
        root.querySelectorAll('input, select, textarea').forEach(el => { el.value = ''; });
        showSavedIndicator('已清除');
        clearBtn.closest('.fb-restore-banner')?.remove();
      });
    }

    // 提交（v1.6.13 改造：真 fetch + OfflineQueue 入队）
    root.querySelector('#fb-submit-btn').addEventListener('click', () => {
      const data = collectFormData();
      const validation = validateForm(data);
      if (!validation.ok) {
        showToast('⚠️ ' + validation.msg);
        return;
      }
      // fire-and-forget：submitForm 内部处理 UI 状态 + 成功/失败分支
      submitForm(data);
    });

    // 自动填充已有数据
    if (hasDraft) {
      FIELDS.forEach(f => {
        const el = root.querySelector(`[name="${f.key}"]`);
        if (el && existing[f.key] != null) el.value = existing[f.key];
      });
    }

    // 自动保存（提取为独立函数，供 debounce 与 blur 共用）
    function saveDraft() {
      const data = collectFormData();
      const isEmpty = Object.values(data).every(v => !String(v).trim());
      if (isEmpty) {
        removeKey(STORAGE_KEY);
      } else {
        saveJSON(STORAGE_KEY, data);
        showSavedIndicator('已自动保存');
      }
    }

    const debouncedSave = debounce(saveDraft, 400);

    root.querySelectorAll('input, select, textarea').forEach(el => {
      el.addEventListener('input', debouncedSave);
      el.addEventListener('change', debouncedSave);
      // 失焦立即落盘：避免 400ms debounce 窗口内离开页面导致草稿丢失
      el.addEventListener('blur', () => {
        debouncedSave.flush();
        saveDraft();
      });
    });

    // ESC 关闭
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        closeFbModal();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    function showSavedIndicator(text) {
      const ind = root.querySelector('#fb-save-ind');
      const txt = root.querySelector('#fb-save-text');
      if (!ind) return;
      txt.textContent = text;
      ind.classList.add('fb-show');
      setTimeout(() => ind.classList.remove('fb-show'), 1500);
    }
  }

  // ============ 渲染字段 ============
  function renderField(f, index) {
    const required = f.required ? '<span class="fb-req">*</span>' : '';
    let input;
    if (f.type === 'select') {
      input = `
        <select class="fb-select" name="${f.key}">
          ${f.options.map(opt => `<option value="${opt}">${opt || '请选择'}</option>`).join('')}
        </select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea class="fb-textarea" name="${f.key}" placeholder="${f.placeholder || ''}" ${f.maxlength ? `maxlength="${f.maxlength}"` : ''}></textarea>`;
    } else {
      const attrs = [
        `type="${f.type}"`,
        `name="${f.key}"`,
        `class="fb-input"`,
        f.placeholder ? `placeholder="${f.placeholder}"` : '',
        f.pattern ? `pattern="${f.pattern}"` : '',
        f.step ? `step="${f.step}"` : '',
        f.min ? `min="${f.min}"` : ''
      ].filter(Boolean).join(' ');
      input = `<input ${attrs} />`;
    }
    return `
      <div class="fb-field">
        <label class="fb-label">${f.label}${required}</label>
        ${input}
      </div>
    `;
  }

  // ============ 数据收集与验证 ============
  function collectFormData() {
    const data = {};
    const form = document.getElementById('fb-form');
    if (!form) return data;
    FIELDS.forEach(f => {
      const el = form.querySelector(`[name="${f.key}"]`);
      if (el) data[f.key] = el.value;
    });
    return data;
  }

  function validateForm(data) {
    for (const f of FIELDS) {
      if (f.required && !String(data[f.key] || '').trim()) {
        return { ok: false, msg: `请填写：${f.label}` };
      }
    }
    const phone = data.phone || '';
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
      return { ok: false, msg: '手机号格式不正确' };
    }
    return { ok: true };
  }

  // ============ 真实提交（v1.6.13 改造：真 fetch + OfflineQueue 离线入队）============
  // v1.6.11 ~ v1.6.12 是 setTimeout(800ms) 模拟，已废弃
  // v1.6.13 起：真 fetch POST /api/entry-records
  //   - 成功（2xx）：清草稿 + 关闭浮层 + 成功提示
  //   - 网络错误 / 5xx：入队 entry-form-records store + "📦 已暂存离线" 提示
  //   - 4xx 业务错误：直接提示，不入队（重试无意义）
  // v1.6.14：URL 从 v1.6.13 的 mock（http://127.0.0.1:9，端口9 connection refused）改为本地 mock server
  //   启动 mock：python mock/entry-records-server.py 8861
  //   POST /api/entry-records → 200 {ok:true, id, received}
  //   GET  /api/entry-records → 200 {count, items}（查看已收到记录）
  //   GET  /__mock_health     → 200 健康检查
  // v1.6.17：URL 改为公网，让手机通过 cloudflared 也能提交
  //   - 反代主机 cloudflared-8861 tunnel：python mock/entry-records-server.py 8861
  //   - 公网域名 founder-rural-herein-directive.trycloudflare.com（quick tunnel 会过期，重启会变）
  //   - 何时换真实后端：把这里改成生产 URL 即可
  // v1.6.18：改为相对路径，走主 cloudflared 隧道（端口 8860 反代到 mock:8861）
  //   - 不再依赖写死的 trycloudflare 子域名
  //   - 公网域名换了也不影响浮动球提交
  //   - 何时换真实后端：把这里改成生产 URL，或在 start-http-helper.py 里改 MOCK_UPSTREAM_PORT
  const ENTRY_FORM_API_URL = '/api/entry-records';

  async function submitForm(data) {
    const btn = document.getElementById('fb-submit-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '提交中...';
    }
    try {
      let resp;
      try {
        resp = await fetch(ENTRY_FORM_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } catch (networkErr) {
        // 网络错误（DNS / 连接拒绝 / 超时）→ 入队
        await _enqueueEntryForm(data);
        return;
      }
      if (resp && resp.ok) {
        // 成功
        showToast('✅ 提交成功！');
        removeKey(STORAGE_KEY);
        setTimeout(closeFbModal, 800);
        return;
      }
      if (resp && resp.status >= 400 && resp.status < 500) {
        // 4xx 业务错误（用户输入有误 / 权限不足）：不入队，提示用户
        let msg = '提交失败（HTTP ' + resp.status + '）';
        try {
          const body = await resp.text();
          if (body) msg += '：' + body.slice(0, 80);
        } catch (_) {}
        showToast('⚠️ ' + msg);
        return;
      }
      // 5xx：服务端临时异常 → 入队
      await _enqueueEntryForm(data);
    } catch (e) {
      try { console.error('[FB] submitForm failed:', e); } catch (_) {}
      showToast('⚠️ 提交异常：' + (e && e.message || e));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '提交';
      }
    }
  }

  // 写入 OfflineQueue 的 entry-form-records store
  async function _enqueueEntryForm(data) {
    if (typeof window.OfflineQueue === 'undefined' || typeof window.OfflineQueue.enqueue !== 'function') {
      showToast('⚠️ 离线队列未就绪，请重试');
      try { console.error('[FB] OfflineQueue not loaded'); } catch (_) {}
      return;
    }
    try {
      await window.OfflineQueue.enqueue({
        storeName: 'entry-form-records',
        url: ENTRY_FORM_API_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: data,
        label: '进场登记',
      });
      showToast('📦 已暂存离线，恢复网络后自动提交');
      removeKey(STORAGE_KEY);
      setTimeout(closeFbModal, 800);
    } catch (e) {
      try { console.error('[FB] enqueue failed:', e); } catch (_) {}
      showToast('⚠️ 暂存失败：' + (e && e.message || e));
    }
  }

  // ============ Toast 提示 ============
  function showToast(text) {
    const t = document.createElement('div');
    t.className = 'fb-toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1500);
  }

  // ============ 暴露 API ============
  // 仅暴露 API，不再自动创建悬浮球（按钮入口由调用方负责）
  window.FloatingBall = {
    open: openForm,
    clearDraft: () => removeKey(STORAGE_KEY),
    getDraft: () => loadJSON(STORAGE_KEY)
  };
})();