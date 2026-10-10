(function(window, document) {
    const statusEl = document.getElementById('bootstrap-status');
    const errorEl = document.getElementById('bootstrap-error');
    const actionsEl = document.getElementById('bootstrap-actions');
    const spinnerEl = document.getElementById('bootstrap-spinner');
    const retryBtn = document.getElementById('bootstrap-retry-btn');
    const loginBtn = document.getElementById('bootstrap-login-btn');

    function setStatus(text) {
        if (statusEl) {
            statusEl.textContent = text;
        }
    }

    function showError(message) {
        if (spinnerEl) {
            spinnerEl.style.display = 'none';
        }
        if (errorEl) {
            errorEl.style.display = 'block';
            errorEl.textContent = message;
        }
        if (actionsEl) {
            actionsEl.classList.add('show');
        }
    }

    function hideError() {
        if (spinnerEl) {
            spinnerEl.style.display = 'block';
        }
        if (errorEl) {
            errorEl.style.display = 'none';
            errorEl.textContent = '';
        }
        if (actionsEl) {
            actionsEl.classList.remove('show');
        }
    }

    function normalizeBootstrapError(error) {
        const message = (error && error.message) || '任务初始化失败，请稍后重试';
        if (message.includes('网络不可用')) {
            return message;
        }
        if (message.includes('浏览器未拿到任何响应')) {
            if (/127\.0\.0\.1|localhost/i.test(window.location.origin)) {
                return `${message}。当前为本地联调环境，若浏览器 Console 已提示 CORS 或 Access-Control-Allow-Origin 重复值，请优先让后端修正 CORS，或改走本地同源代理 /api/v1/public/tasks/...`;
            }
            return `${message}。请优先检查 https://water-trans.cloud 是否已为当前 H5 来源放行 CORS`;
        }
        if (message.includes('HTML页面而不是JSON')) {
            return '任务接口返回内容异常，请检查 https://water-trans.cloud 是否可访问、是否返回 JSON，以及是否存在跨域限制';
        }
        return message;
    }

    function logBootstrapFailureSummary(error) {
        const currentStatus = statusEl ? statusEl.textContent : '';
        const currentHref = window.location.href;
        const message = (error && error.message) || '未知错误';

        console.group('[scan-bootstrap] 初始化失败摘要');
        console.error('错误消息:', message);
        console.table({
            href: currentHref,
            pageOrigin: window.location.origin,
            taskId: window.ScanTaskService && typeof window.ScanTaskService.parseTaskIdFromUrl === 'function'
                ? window.ScanTaskService.parseTaskIdFromUrl()
                : '',
            currentStatus,
            isMock: window.ScanTaskService && typeof window.ScanTaskService.isScanMockEnabled === 'function'
                ? window.ScanTaskService.isScanMockEnabled()
                : false
        });

        if (message.includes('浏览器未拿到任何响应')) {
            console.warn('阶段判断: 当前失败发生在任务接口第一跳请求阶段，任务数据适配、点位补齐和登录态初始化尚未开始。');
            console.warn('给后端的重点: 请先检查 water-trans.cloud 该接口的 CORS 响应头是否重复、是否正确放行当前页面来源。');
            console.warn('若浏览器 Console 已出现 Access-Control-Allow-Origin contains multiple values `*, *`，说明当前不是前端参数问题，而是服务端 CORS 头重复配置。');
        }

        console.groupEnd();
    }

    async function bootstrapScanTask() {
        hideError();

        const taskId = window.ScanTaskService.parseTaskIdFromUrl();
        const mockEnabled = Boolean(window.ScanTaskService.isScanMockEnabled && window.ScanTaskService.isScanMockEnabled());
        if (mockEnabled) {
            sessionStorage.setItem('scanMockEnabled', '1');
        } else {
            if (window.ScanTaskService && typeof window.ScanTaskService.clearScanMockState === 'function') {
                window.ScanTaskService.clearScanMockState();
            } else {
                sessionStorage.removeItem('scanMockEnabled');
            }
        }
        // #region debug-point A:bootstrap-entry
        fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"A",location:"scan-bootstrap.js:45",msg:"[DEBUG] bootstrap entry",data:{href:window.location.href,taskId,status:statusEl&&statusEl.textContent},ts:Date.now()})}).catch(()=>{});
        // #endregion
        if (!taskId) {
            showError('未获取到任务ID，请重新扫码后再试');
            return;
        }

        try {
            setStatus(mockEnabled ? '正在加载内部模拟任务...' : '正在查询任务信息...');
            const rawTask = await window.ScanTaskService.fetchPublicTaskByTaskId(taskId);
            // #region debug-point A:task-fetch-success
            fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"A",location:"scan-bootstrap.js:55",msg:"[DEBUG] task fetch success",data:{taskId,rawTask},ts:Date.now()})}).catch(()=>{});
            // #endregion

            setStatus('正在适配任务数据...');
            let taskContext = window.ScanTaskService.adaptPublicTaskToScanContext(rawTask);
            taskContext.taskId = taskContext.taskId || taskId;
            // #region debug-point C:adapt-task-context
            fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"C",location:"scan-bootstrap.js:61",msg:"[DEBUG] task context adapted",data:{taskId:taskContext.taskId,projectId:taskContext.projectId,projectName:taskContext.projectName,startPoint:taskContext.startPoint,endPoint:taskContext.endPoint,status:taskContext.status,statusText:taskContext.statusText},ts:Date.now()})}).catch(()=>{});
            // #endregion

            setStatus('正在补齐任务点位和项目数据...');
            taskContext = await window.ScanTaskService.enrichTaskContext(taskContext);
            // #region debug-point B:enrich-task-context
            fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"B",location:"scan-bootstrap.js:66",msg:"[DEBUG] task context enriched",data:{projectId:taskContext.projectId,projectName:taskContext.projectName,projectCenter:taskContext.projectCenter,startPoint:taskContext.startPoint,endPoint:taskContext.endPoint},ts:Date.now()})}).catch(()=>{});
            // #endregion

            setStatus('正在校验任务上下文...');
            window.ScanTaskService.validateTaskContext(taskContext);
            // #region debug-point C:validate-success
            fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"C",location:"scan-bootstrap.js:71",msg:"[DEBUG] validate task context success",data:{taskId:taskContext.taskId,endPoint:taskContext.endPoint},ts:Date.now()})}).catch(()=>{});
            // #endregion

            setStatus('正在初始化系统登录态...');
            try {
                await window.ScanTaskService.ensureDriverToken();
            } catch (tokenError) {
                console.warn('[scan-bootstrap] 系统 token 初始化失败，将继续进入首页:', tokenError);
                // #region debug-point D:driver-token-failed
                fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"D",location:"scan-bootstrap.js:78",msg:"[DEBUG] driver token init failed",data:{message:tokenError&&tokenError.message,stack:tokenError&&tokenError.stack},ts:Date.now()})}).catch(()=>{});
                // #endregion
            }

            setStatus('正在进入首页...');
            window.ScanTaskService.saveScanSessionContext(taskContext);
            // #region debug-point D:save-session-success
            fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"D",location:"scan-bootstrap.js:84",msg:"[DEBUG] save session context success",data:{taskId:taskContext.taskId,isLoggedIn:sessionStorage.getItem("isLoggedIn"),loginType:sessionStorage.getItem("loginType"),hasAuthToken:!!sessionStorage.getItem("authToken"),currentUser:sessionStorage.getItem("currentUser"),projectSelection:sessionStorage.getItem("projectSelection"),navigationRoute:sessionStorage.getItem("navigationRoute"),currentTaskContext:sessionStorage.getItem("currentTaskContext")},ts:Date.now()})}).catch(()=>{});
            // #endregion
            window.location.replace('index.html?scanEntry=1');
        } catch (error) {
            console.error('[scan-bootstrap] 初始化失败:', error);
            logBootstrapFailureSummary(error);
            // #region debug-point D:bootstrap-catch
            fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"D",location:"scan-bootstrap.js:89",msg:"[DEBUG] bootstrap catch",data:{message:error&&error.message,stack:error&&error.stack,status:statusEl&&statusEl.textContent},ts:Date.now()})}).catch(()=>{});
            // #endregion
            showError(normalizeBootstrapError(error));
        }
    }

    document.addEventListener('DOMContentLoaded', function() {
        retryBtn?.addEventListener('click', bootstrapScanTask);
        loginBtn?.addEventListener('click', function() {
            window.location.replace('login.html');
        });

        bootstrapScanTask();
    });
})(window, document);
