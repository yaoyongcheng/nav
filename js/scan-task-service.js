(function(window) {
    const APP_API_BASE = 'https://dmap.cscec3bxjy.cn';
    const PUBLIC_TASK_API_BASE = 'https://water-trans.cloud';
    const PUBLIC_TASK_PROXY_PATH = '/api/v1/public/tasks';
    const SUCCESS_CODES = new Set([0, 200, '0', '200']);
    const TASK_STATUS_MAP = {
        '-4': '未完成',
        '-3': '未执行',
        '-2': '已过期',
        '-1': '被拒绝',
        '0': '草稿',
        '1': '待一审',
        '2': '待二审',
        '3': '审核通过',
        '4': '待执行',
        '5': '执行中',
        '6': '已完成'
    };
    const TASK_STATUS_GROUP_MAP = {
        '-4': 'danger',
        '-3': 'danger',
        '-2': 'danger',
        '-1': 'danger',
        '0': 'default',
        '1': 'default',
        '2': 'default',
        '3': 'success',
        '4': 'success',
        '5': 'success',
        '6': 'default'
    };
    const TASK_MODE_MAP = {
        0: '进场',
        1: '出场'
    };
    const CAR_TYPE_MAP = {
        0: '小型车',
        1: '大型车'
    };
    const TASK_TYPE_NAME_MAP = {
        '1': '水泥运输',
        '2': '沙石运输（砂石运输）',
        '3': '钢筋运输',
        '4': '渣土运输',
        '5': '商品混凝土运输',
        '6': '其他 / 水平运输任务'
    };
    const SCAN_TASK_MOCK_STORAGE_KEY = 'scanTaskMockPayload';
    const SCAN_TASK_HISTORY_STORAGE_KEY = 'scanTaskHistory';
    const PROJECT_POINTS_CACHE = new Map();
    const DEFAULT_SCAN_MOCK_RESPONSE = {
        code: 0,
        message: 'ok',
        data: {
            task_id: '202606100001',
            task_type_id: '1',
            task_name: '统计运输任务',
            task_start: '2号楼-入口',
            task_start_id: 9014,
            task_end: '9号楼-入口',
            task_end_id: 9007,
            project_id: 'P000000021',
            drive_id: '李方法|13000000000',
            plate: '渝E66767',
            car_type: 0,
            task_mode: 0,
            status: 4,
            reason: '内部模拟任务，用于验证扫码登录主链路',
            pre_in_time: '2026-06-10T08:56:00Z',
            pre_out_time: '2026-06-10T12:56:00Z'
        }
    };

    function getValue(source, path) {
        if (!source || !path) return undefined;
        const keys = path.split('.');
        let current = source;
        for (let i = 0; i < keys.length; i += 1) {
            if (current == null) return undefined;
            current = current[keys[i]];
        }
        return current;
    }

    function getFirstValue(source, paths) {
        for (let i = 0; i < paths.length; i += 1) {
            const value = getValue(source, paths[i]);
            if (value !== undefined && value !== null && value !== '') {
                return value;
            }
        }
        return null;
    }

    function toNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function normalizeText(value, fallback = '') {
        if (value === null || value === undefined) return fallback;
        const text = String(value).trim();
        return text || fallback;
    }

    function normalizePlateNumber(value) {
        return normalizeText(value).replace(/\s+/g, '').toUpperCase();
    }

    function normalizePhoneNumber(value) {
        return normalizeText(value).replace(/\D+/g, '');
    }

    function buildTaskOwnerProfile(taskContext) {
        const plateNumber = normalizePlateNumber(taskContext && taskContext.plateNumber);
        const driverId = normalizeText(taskContext && taskContext.driverId);
        const phone = normalizePhoneNumber(taskContext && taskContext.phone);
        const driverName = normalizeText(taskContext && taskContext.driverName);
        let ownerKey = '';

        if (plateNumber) {
            ownerKey = `plate:${plateNumber}`;
        } else if (driverId) {
            ownerKey = `driver:${driverId}`;
        } else if (phone) {
            ownerKey = `phone:${phone}`;
        } else if (driverName) {
            ownerKey = `name:${driverName}`;
        }

        return {
            ownerKey,
            plateNumber,
            driverId,
            phone,
            driverName
        };
    }

    function isSuccessCode(code) {
        return code === undefined || code === null || SUCCESS_CODES.has(code);
    }

    function unwrapResponseData(payload) {
        if (!payload || typeof payload !== 'object') {
            return payload;
        }
        if (payload.data !== undefined && payload.data !== null) {
            return payload.data;
        }
        return payload;
    }

    function isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function looksLikeTaskPayload(payload) {
        if (!isPlainObject(payload)) {
            return false;
        }

        return Boolean(
            getFirstValue(payload, [
                'task_id',
                'taskId',
                'id',
                'project_id',
                'projectId',
                'end_point',
                'endPoint',
                'task_end',
                'taskEnd'
            ])
        );
    }

    function ensureSuccessResponse(response, payload, fallbackMessage) {
        if (!response.ok || !isSuccessCode(payload && payload.code)) {
            throw new Error(
                (payload && (payload.message || payload.msg || payload.error)) ||
                fallbackMessage
            );
        }
    }

    function safeDecode(text) {
        try {
            return decodeURIComponent(text);
        } catch (error) {
            return text;
        }
    }

    function cloneValue(value) {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            return value;
        }
    }

    function isEnabledFlag(value) {
        const normalized = normalizeText(value).toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
    }

    function readStorageFlag(storage, key) {
        try {
            return storage ? storage.getItem(key) : '';
        } catch (error) {
            return '';
        }
    }

    function readStorageJson(storage, key) {
        try {
            const rawValue = storage ? storage.getItem(key) : '';
            if (!rawValue) {
                return null;
            }
            return JSON.parse(rawValue);
        } catch (error) {
            return null;
        }
    }

    function removeStorageItem(storage, key) {
        try {
            if (storage) {
                storage.removeItem(key);
            }
        } catch (error) {
            // Ignore storage cleanup failures.
        }
    }

    function findNavigablePointByName(name) {
        if (!name || typeof window.PointNameUtils === 'undefined') {
            return null;
        }

        const allPoints = typeof window.PointNameUtils.getAllNavigablePointsFromSession === 'function'
            ? window.PointNameUtils.getAllNavigablePointsFromSession()
            : [];
        if (!Array.isArray(allPoints) || allPoints.length === 0) {
            return null;
        }

        return typeof window.PointNameUtils.findPointByName === 'function'
            ? window.PointNameUtils.findPointByName(name, allPoints)
            : null;
    }

    function isScanMockEnabled() {
        const params = new URLSearchParams(window.location.search);
        const urlFlag = params.get('mock_scan') || params.get('mockScan');
        if (isEnabledFlag(urlFlag)) {
            return true;
        }

        if (isEnabledFlag(window.__SCAN_TASK_MOCK_ENABLED__)) {
            return true;
        }

        const sessionStorageFlag = readStorageFlag(window.sessionStorage, 'scanMockEnabled');
        return isEnabledFlag(sessionStorageFlag);
    }

    function clearScanMockState() {
        removeStorageItem(window.sessionStorage, 'scanMockEnabled');
        removeStorageItem(window.localStorage, 'scanMockEnabled');
        removeStorageItem(window.sessionStorage, SCAN_TASK_MOCK_STORAGE_KEY);
        removeStorageItem(window.localStorage, SCAN_TASK_MOCK_STORAGE_KEY);
    }

    function getInjectedScanMockPayload() {
        if (window.__SCAN_TASK_MOCK_PAYLOAD__) {
            return window.__SCAN_TASK_MOCK_PAYLOAD__;
        }

        const sessionPayload = readStorageJson(window.sessionStorage, SCAN_TASK_MOCK_STORAGE_KEY);
        if (sessionPayload) {
            return sessionPayload;
        }

        return readStorageJson(window.localStorage, SCAN_TASK_MOCK_STORAGE_KEY);
    }

    function getMockTaskResponse(taskId) {
        const injectedPayload = getInjectedScanMockPayload();
        let payload = cloneValue(injectedPayload || DEFAULT_SCAN_MOCK_RESPONSE);
        if (!payload || typeof payload !== 'object') {
            throw new Error('内部模拟任务数据无效');
        }

        if (!payload.data || typeof payload.data !== 'object') {
            if (looksLikeTaskPayload(payload)) {
                payload = {
                    code: payload.code ?? 0,
                    message: payload.message || payload.msg || 'ok',
                    data: payload
                };
            } else {
                payload = {
                    code: 0,
                    message: 'ok',
                    data: {}
                };
            }
        }

        payload.code = payload.code ?? 0;
        payload.message = payload.message || 'ok';
        payload.data.task_id = normalizeText(taskId || payload.data.task_id || DEFAULT_SCAN_MOCK_RESPONSE.data.task_id);
        payload.data.task_name = payload.data.task_name || DEFAULT_SCAN_MOCK_RESPONSE.data.task_name;
        payload.data.reason = payload.data.reason || DEFAULT_SCAN_MOCK_RESPONSE.data.reason;
        return payload;
    }

    function extractParamValue(text, key) {
        if (!text) return '';
        const reg = new RegExp(`(?:^|[?&])${key}=([^&#]*)`, 'i');
        const match = String(text).match(reg);
        if (!match || !match[1]) {
            return '';
        }
        return safeDecode(match[1]);
    }

    function extractTaskIdFromText(text) {
        const decoded = safeDecode(normalizeText(text));
        if (!decoded) {
            return '';
        }

        const nestedQuery = extractParamValue(decoded, 'query');
        if (nestedQuery) {
            const nestedTaskId = extractTaskIdFromText(nestedQuery);
            if (nestedTaskId) {
                return nestedTaskId;
            }
        }

        const directMatch = decoded.match(/(?:^|[?&#/;,\s=])(task_id|taskId|id)=([^&#;,\s]+)/i);
        if (directMatch && directMatch[2]) {
            return directMatch[2];
        }

        const pathMatch = decoded.match(/\/by-task-id\/([^/?#]+)/i) || decoded.match(/\/tasks\/([^/?#]+)/i);
        if (pathMatch && pathMatch[1]) {
            return pathMatch[1];
        }

        if (/^[A-Za-z0-9_-]+$/.test(decoded)) {
            return decoded;
        }

        return '';
    }

    function parseTaskIdFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return normalizeText(
            params.get('task_id') ||
            params.get('taskId') ||
            params.get('id') ||
            extractTaskIdFromText(window.location.href)
        );
    }

    function buildPublicTaskRequestCandidates(taskId) {
        const encodedTaskId = encodeURIComponent(taskId);
        const requestPath = `${PUBLIC_TASK_PROXY_PATH}/by-task-id/${encodedTaskId}`;
        const normalizedBase = normalizeText(PUBLIC_TASK_API_BASE).replace(/\/+$/, '');
        if (!normalizedBase) {
            return [];
        }

        return [{
            url: `${normalizedBase}${requestPath}`,
            source: 'public-api-domain'
        }];
    }

    function isLikelyFetchTransportError(error) {
        const message = normalizeText(error && error.message).toLowerCase();
        return (
            message.includes('failed to fetch') ||
            message.includes('networkerror') ||
            message.includes('load failed') ||
            message.includes('network request failed')
        );
    }

    function isLocalDevOrigin(origin) {
        return /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(normalizeText(origin));
    }

    function isCrossOriginRequest(requestUrl) {
        try {
            return new URL(requestUrl, window.location.href).origin !== window.location.origin;
        } catch (error) {
            return false;
        }
    }

    function inferPublicTaskFailureStage(requestUrl, error) {
        const message = normalizeText(error && error.message).toLowerCase();
        if (message.includes('html页面而不是json') || message.includes('无法解析的内容')) {
            return 'response-parse';
        }
        if (message.includes('返回为空')) {
            return 'empty-response';
        }
        if (message.includes('结构不符合扫码需求')) {
            return 'payload-shape';
        }
        if (message.includes('failed to fetch') || message.includes('networkerror') || message.includes('load failed')) {
            return isCrossOriginRequest(requestUrl) ? 'cors-or-network' : 'network-before-response';
        }
        return 'unknown';
    }

    function buildPublicTaskFailureSuggestions(requestUrl, error) {
        const origin = normalizeText(window.location && window.location.origin, '未知来源');
        const suggestions = [];
        const stage = inferPublicTaskFailureStage(requestUrl, error);
        const crossOrigin = isCrossOriginRequest(requestUrl);
        const localDev = isLocalDevOrigin(origin);

        if (stage === 'cors-or-network') {
            if (crossOrigin) {
                suggestions.push('检查浏览器当前报错是否包含 blocked by CORS policy 或 Access-Control-Allow-Origin。');
                suggestions.push('让后端确认响应头里 Access-Control-Allow-Origin 只返回一个值，不要出现 `*, *` 这类重复值。');
                suggestions.push(`让后端确认是否已对当前页面来源 ${origin} 放行，或改为同源代理 /api/v1/public/tasks/...。`);
            } else {
                suggestions.push('当前为同源请求，优先检查本地代理或上游服务是否可达。');
            }
            if (localDev && crossOrigin) {
                suggestions.push('当前是本地联调环境，若后端 CORS 尚未修复，建议启动 tools/local-scan-proxy-server.cjs 并改走同源 /api/v1/public/tasks/...。');
            }
        }

        if (stage === 'response-parse') {
            suggestions.push('检查接口是否返回了 HTML 错页、登录页或网关默认页，而不是 JSON。');
        }

        if (stage === 'empty-response') {
            suggestions.push('检查上游服务是否返回了空 body，或网关是否吞掉了响应体。');
        }

        if (stage === 'payload-shape') {
            suggestions.push('检查返回 JSON 是否至少包含 task_id、project_id/projectCode、task_end/task_end_id 等关键字段。');
        }

        if (!suggestions.length) {
            suggestions.push('检查浏览器 Console 与 Network 的首条报错，再确认是 CORS、TLS/网关还是返回结构问题。');
        }

        return suggestions;
    }

    function logPublicTaskFetchFailureDiagnostics(requestUrl, error, extra = {}) {
        const origin = normalizeText(window.location && window.location.origin, '未知来源');
        const message = normalizeText(error && error.message, 'unknown');
        const stage = inferPublicTaskFailureStage(requestUrl, error);
        const diagnostic = {
            pageOrigin: origin,
            requestUrl,
            crossOrigin: isCrossOriginRequest(requestUrl),
            localDevOrigin: isLocalDevOrigin(origin),
            online: typeof navigator !== 'undefined' ? navigator.onLine : null,
            stage,
            errorMessage: message,
            recommendedAction: isLocalDevOrigin(origin) && isCrossOriginRequest(requestUrl)
                ? '本地联调优先改走同源代理 /api/v1/public/tasks/...'
                : '让后端检查 CORS 响应头、网关和返回内容'
        };

        console.group('[ScanTaskService] 任务接口失败诊断');
        console.error('原始错误:', error);
        console.table(diagnostic);
        const suggestions = buildPublicTaskFailureSuggestions(requestUrl, error);
        suggestions.forEach((item, index) => {
            console.warn(`排查建议 ${index + 1}: ${item}`);
        });
        if (extra && Object.keys(extra).length) {
            console.info('附加上下文:', extra);
        }
        console.groupEnd();
    }

    function buildPublicTaskFetchFailureMessage(requestUrl, error) {
        const pageOrigin = normalizeText(window.location && window.location.origin, '未知来源');
        const message = normalizeText(error && error.message);
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

        if (isOffline) {
            return '任务接口网络请求失败：当前设备网络不可用，请检查网络后重试';
        }

        if (isLikelyFetchTransportError(error)) {
            return `任务接口网络请求失败：浏览器未拿到任何响应。当前页面来源 ${pageOrigin} 正在请求 ${requestUrl}，这通常表示 CORS 未放行、OPTIONS 预检失败、证书链异常，或目标服务暂时不可达`;
        }

        return message || '任务查询失败';
    }

    function normalizeDateTime(value) {
        const text = normalizeText(value);
        if (!text) {
            return '';
        }

        const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
        if (isoMatch) {
            return `${isoMatch[1]} ${isoMatch[2]}`;
        }

        return text;
    }

    function normalizeStatusCode(statusValue) {
        if (statusValue === null || statusValue === undefined || statusValue === '') {
            return '';
        }

        const normalized = normalizeText(statusValue);
        if (/^-?\d+$/.test(normalized)) {
            return String(Number(normalized));
        }
        return normalized;
    }

    function resolveTaskStatusMeta(statusValue, explicitStatusText) {
        const statusCode = normalizeStatusCode(statusValue);
        const explicitText = normalizeText(explicitStatusText);
        const statusText = explicitText || TASK_STATUS_MAP[statusCode] || statusCode || '未知状态';
        const statusGroup = TASK_STATUS_GROUP_MAP[statusCode] || 'default';
        return {
            statusCode,
            statusText,
            statusGroup
        };
    }

    function getTaskStatusText(statusValue) {
        return resolveTaskStatusMeta(statusValue).statusText;
    }

    function getTaskModeText(modeValue) {
        if (modeValue === null || modeValue === undefined || modeValue === '') {
            return '';
        }
        if (typeof modeValue === 'string' && TASK_MODE_MAP[modeValue] === undefined) {
            return normalizeText(modeValue);
        }
        return TASK_MODE_MAP[modeValue] || normalizeText(modeValue);
    }

    function getCarTypeText(carTypeValue) {
        if (carTypeValue === null || carTypeValue === undefined || carTypeValue === '') {
            return '';
        }
        if (typeof carTypeValue === 'string' && CAR_TYPE_MAP[carTypeValue] === undefined) {
            return normalizeText(carTypeValue);
        }
        return CAR_TYPE_MAP[carTypeValue] || normalizeText(carTypeValue);
    }

    function formatTaskTimeRange(startTime, endTime) {
        const normalizedStart = normalizeDateTime(startTime);
        const normalizedEnd = normalizeDateTime(endTime);
        if (normalizedStart && normalizedEnd) {
            return `${normalizedStart} - ${normalizedEnd}`;
        }
        return normalizedStart || normalizedEnd || '';
    }

    function buildTaskTitle() {
        return '任务';
    }

    function buildTaskDetail(rawTask, statusText, taskModeText) {
        const reason = normalizeText(getFirstValue(rawTask, ['reason']));
        if (reason) {
            return reason;
        }

        const explicitDetail = normalizeText(getFirstValue(rawTask, ['task_detail', 'taskDetail', 'description', 'remark']));
        return explicitDetail;
    }

    function getTaskTypeText(rawTask) {
        const typeId = normalizeText(getFirstValue(rawTask, ['task_type_id', 'taskTypeId', 'task_type id']));
        return TASK_TYPE_NAME_MAP[typeId] || '';
    }

    function buildDriverName(rawTask) {
        return normalizeText(
            getFirstValue(rawTask, ['driver_name', 'driverName', 'drive_name', 'driveName']),
            '扫码司机'
        );
    }

    function parseDriverIdentity(rawTask) {
        const identityText = normalizeText(
            getFirstValue(rawTask, ['drive_id', 'driver_id', 'driverId', 'drive id'])
        );
        const explicitDriverName = buildDriverName(rawTask);
        const explicitPhone = normalizeText(getFirstValue(rawTask, ['phone', 'driver_phone', 'driverPhone']));
        if (!identityText) {
            return {
                driverId: '',
                driverName: explicitDriverName,
                phone: explicitPhone
            };
        }

        const parts = identityText.split('|').map((item) => normalizeText(item)).filter(Boolean);
        const derivedName = parts[0] || identityText;
        const derivedPhone = parts.find((item) => /^1\d{10}$/.test(item)) || '';

        return {
            driverId: identityText,
            driverName: explicitDriverName !== '扫码司机' ? explicitDriverName : derivedName,
            phone: explicitPhone || derivedPhone
        };
    }

    function buildPlateNumber(rawTask) {
        return normalizeText(
            getFirstValue(rawTask, ['plate_number', 'plateNumber', 'license_plate', 'licensePlate', 'plate']),
            ''
        );
    }

    function setPointLocation(point, longitude, latitude, options = {}) {
        if (!point) {
            return;
        }

        const rawLongitude = toNumber(longitude);
        const rawLatitude = toNumber(latitude);
        if (!Number.isFinite(rawLongitude) || !Number.isFinite(rawLatitude)) {
            point.location = null;
            return;
        }

        point.rawLongitude = rawLongitude;
        point.rawLatitude = rawLatitude;

        let finalLongitude = rawLongitude;
        let finalLatitude = rawLatitude;
        if (options.convertFromWgs84 && typeof wgs84ToGcj02 === 'function') {
            const converted = wgs84ToGcj02(rawLongitude, rawLatitude);
            finalLongitude = converted[0];
            finalLatitude = converted[1];
        }

        point.longitude = finalLongitude;
        point.latitude = finalLatitude;
        point.location = [finalLongitude, finalLatitude];
        point.coordSystem = options.coordSystem || (options.convertFromWgs84 ? 'gcj02' : 'raw');
    }

    async function fetchPublicTaskByTaskId(taskId) {
        if (isScanMockEnabled()) {
            const mockPayload = getMockTaskResponse(taskId);
            const mockData = unwrapResponseData(mockPayload);
            // #region debug-point C:scan-mock-task
            fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"nav-route-regression",runId:"pre-fix",hypothesisId:"C",location:"scan-task-service.js:533",msg:"[DEBUG] using scan mock task payload",data:{requestedTaskId:taskId,mockPayload,mockData,localMockEnabled:readStorageFlag(window.localStorage,'scanMockEnabled'),sessionMockEnabled:readStorageFlag(window.sessionStorage,'scanMockEnabled')},ts:Date.now()})}).catch(()=>{});
            // #endregion
            if (!looksLikeTaskPayload(mockData)) {
                throw new Error('内部模拟任务数据缺少关键字段');
            }
            return mockData;
        }

        const candidates = buildPublicTaskRequestCandidates(taskId);
        let lastError = null;

        if (!candidates.length) {
            throw new Error('未配置可用的任务接口地址');
        }

        for (let i = 0; i < candidates.length; i += 1) {
            const candidate = candidates[i];
            // #region debug-point A:task-api-request
            fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"A",location:"scan-task-service.js:298",msg:"[DEBUG] request public task api",data:{taskId,url:candidate.url,source:candidate.source},ts:Date.now()})}).catch(()=>{});
            // #endregion
            try {
                const response = await fetch(candidate.url, {
                    method: 'GET'
                });
                const responseText = await response.text();
                const trimmedText = normalizeText(responseText);
                let data = {};
                if (responseText) {
                    try {
                        data = JSON.parse(responseText);
                    } catch (parseError) {
                        const looksLikeHtml = /^<!doctype html>|^<html/i.test(trimmedText);
                        throw new Error(
                            looksLikeHtml
                                ? '任务接口返回了HTML页面而不是JSON，请检查 https://water-trans.cloud 是否返回正确接口数据'
                                : '任务接口返回了无法解析的内容'
                        );
                    }
                }
                const responseData = unwrapResponseData(data);
                // #region debug-point A:task-api-response
                fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"A",location:"scan-task-service.js:306",msg:"[DEBUG] public task api response",data:{taskId,url:candidate.url,source:candidate.source,status:response.status,ok:response.ok,code:data&&data.code,message:data&&data.message,data:data&&data.data},ts:Date.now()})}).catch(()=>{});
                // #endregion
                if (!trimmedText) {
                    throw new Error('任务接口返回为空');
                }
                if (!looksLikeTaskPayload(responseData)) {
                    throw new Error(
                        '任务接口返回结构不符合扫码需求'
                    );
                }
                ensureSuccessResponse(response, data, '任务查询失败');
                return responseData;
            } catch (error) {
                logPublicTaskFetchFailureDiagnostics(candidate.url, error, {
                    taskId,
                    requestSource: candidate.source
                });
                const normalizedErrorMessage = buildPublicTaskFetchFailureMessage(candidate.url, error);
                lastError = new Error(normalizedErrorMessage);
                // #region debug-point A:task-api-error
                fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"A",location:"scan-task-service.js:318",msg:"[DEBUG] public task api failed",data:{taskId,url:candidate.url,source:candidate.source,message:error&&error.message,normalizedErrorMessage,stack:error&&error.stack,pageOrigin:window.location&&window.location.origin||'',online:typeof navigator!=='undefined'?navigator.onLine:null,userAgent:typeof navigator!=='undefined'?navigator.userAgent:''},ts:Date.now()})}).catch(()=>{});
                // #endregion
            }
        }

        throw lastError || new Error('任务查询失败');
    }

    function buildPointFromRaw(rawTask, nestedKeys, nameKeys, lngKeys, latKeys, idKeys) {
        const nested = getFirstValue(rawTask, nestedKeys);
        const source = nested && typeof nested === 'object' ? nested : rawTask;

        const point = {
            id: getFirstValue(source, idKeys),
            name: normalizeText(getFirstValue(source, nameKeys)),
            longitude: toNumber(getFirstValue(source, lngKeys)),
            latitude: toNumber(getFirstValue(source, latKeys))
        };

        if (!point.name && !Number.isFinite(point.longitude) && !Number.isFinite(point.latitude)) {
            return null;
        }

        if (Number.isFinite(point.longitude) && Number.isFinite(point.latitude)) {
            point.location = [point.longitude, point.latitude];
        } else {
            point.location = null;
        }

        return point;
    }

    function resolveProjectCenter(taskContext) {
        const projectLng = toNumber(getFirstValue(taskContext, ['projectLongitude', 'longitude', 'projectLng']));
        const projectLat = toNumber(getFirstValue(taskContext, ['projectLatitude', 'latitude', 'projectLat']));
        if (Number.isFinite(projectLng) && Number.isFinite(projectLat)) {
            return [projectLng, projectLat];
        }

        if (taskContext.endPoint && Array.isArray(taskContext.endPoint.location)) {
            return taskContext.endPoint.location;
        }

        if (taskContext.startPoint && Array.isArray(taskContext.startPoint.location)) {
            return taskContext.startPoint.location;
        }

        return [116.397428, 39.90923];
    }

    function adaptPublicTaskToScanContext(rawTask) {
        const status = getFirstValue(rawTask, ['status', 'task_status', 'taskStatus']);
        const driverIdentity = parseDriverIdentity(rawTask);
        const statusMeta = resolveTaskStatusMeta(
            status,
            getFirstValue(rawTask, ['status_name', 'statusName', 'task_status_name', 'taskStatusName'])
        );
        const statusText = statusMeta.statusText;
        const taskMode = getFirstValue(rawTask, ['task_mode', 'taskMode', 'task mode']);
        const taskModeText = getTaskModeText(taskMode);
        const carType = getFirstValue(rawTask, ['car_type', 'carType', 'car _type']);
        const carTypeText = getCarTypeText(carType);
        const taskTypeText = getTaskTypeText(rawTask);
        const startPoint = buildPointFromRaw(
            rawTask,
            ['startPoint', 'start_point', 'loadingPoint', 'loading_point', 'pickupPoint', 'pickup_point'],
            ['name', 'point_name', 'startPointName', 'start_point_name', 'loadingPointName', 'loading_point_name', 'task_start', 'taskStart'],
            ['longitude', 'lng', 'lon', 'startPointLongitude', 'start_point_longitude', 'loadingPointLongitude', 'loading_point_longitude', 'task_start_longitude', 'taskStartLongitude'],
            ['latitude', 'lat', 'startPointLatitude', 'start_point_latitude', 'loadingPointLatitude', 'loading_point_latitude', 'task_start_latitude', 'taskStartLatitude'],
            ['id', 'point_id', 'startPointId', 'start_point_id', 'loadingPointId', 'loading_point_id', 'task_start_id', 'taskStartId']
        );

        const endPoint = buildPointFromRaw(
            rawTask,
            ['endPoint', 'end_point', 'unloadingPoint', 'unloading_point', 'dropoffPoint', 'dropoff_point', 'destinationPoint'],
            ['name', 'point_name', 'endPointName', 'end_point_name', 'unloadingPointName', 'unloading_point_name', 'destinationName', 'task_end', 'taskEnd'],
            ['longitude', 'lng', 'lon', 'endPointLongitude', 'end_point_longitude', 'unloadingPointLongitude', 'unloading_point_longitude', 'destinationLongitude', 'task_end_longitude', 'taskEndLongitude'],
            ['latitude', 'lat', 'endPointLatitude', 'end_point_latitude', 'unloadingPointLatitude', 'unloading_point_latitude', 'destinationLatitude', 'task_end_latitude', 'taskEndLatitude'],
            ['id', 'point_id', 'endPointId', 'end_point_id', 'unloadingPointId', 'unloading_point_id', 'destinationPointId', 'task_end_id', 'taskEndId', 'task _end_id']
        );

        const taskContext = {
            taskId: normalizeText(getFirstValue(rawTask, ['task_id', 'taskId', 'id'])),
            taskName: buildTaskTitle(rawTask, taskModeText),
            taskDetail: buildTaskDetail(rawTask, statusText, taskModeText),
            status: statusMeta.statusCode,
            statusCode: statusMeta.statusCode,
            statusText: statusMeta.statusText,
            statusGroup: statusMeta.statusGroup,
            projectId: normalizeText(getFirstValue(rawTask, ['project_id', 'projectId'])),
            projectCode: normalizeText(getFirstValue(rawTask, ['project_code', 'projectCode', 'project_id', 'projectId'])),
            projectName: normalizeText(getFirstValue(rawTask, ['project_name', 'projectName']), '扫码项目'),
            projectLongitude: toNumber(getFirstValue(rawTask, ['project_longitude', 'projectLongitude'])),
            projectLatitude: toNumber(getFirstValue(rawTask, ['project_latitude', 'projectLatitude'])),
            provinceId: normalizeText(getFirstValue(rawTask, ['province_id', 'provinceId'])),
            provinceName: normalizeText(getFirstValue(rawTask, ['province_name', 'provinceName'])),
            taskTypeId: normalizeText(getFirstValue(rawTask, ['task_type_id', 'taskTypeId', 'task_type id'])),
            taskTypeText,
            taskMode: taskMode === null || taskMode === undefined || taskMode === '' ? null : taskMode,
            taskModeText,
            driverId: driverIdentity.driverId,
            driverName: driverIdentity.driverName,
            phone: driverIdentity.phone,
            plateNumber: buildPlateNumber(rawTask),
            vehicleId: normalizeText(getFirstValue(rawTask, ['vehicle_id', 'vehicleId'])),
            carType: carType === null || carType === undefined || carType === '' ? null : carType,
            carTypeText,
            supplyName: normalizeText(getFirstValue(rawTask, ['supply_name', 'supplyName'])),
            supplyCount: getFirstValue(rawTask, ['supply_count', 'supplyCount']),
            reason: normalizeText(getFirstValue(rawTask, ['reason'])),
            startPoint,
            endPoint,
            preInTime: normalizeDateTime(getFirstValue(rawTask, ['pre_in_time', 'preInTime', 'pre in time'])),
            preOutTime: normalizeDateTime(getFirstValue(rawTask, ['pre_out_time', 'preOutTime', 'pre out time'])),
            entryStartTime: normalizeDateTime(getFirstValue(rawTask, ['entry_start_time', 'entryStartTime']))
                || normalizeDateTime(getFirstValue(rawTask, ['pre_in_time', 'preInTime', 'pre in time'])),
            entryEndTime: normalizeDateTime(getFirstValue(rawTask, ['entry_end_time', 'entryEndTime'])),
            exitStartTime: normalizeDateTime(getFirstValue(rawTask, ['exit_start_time', 'exitStartTime']))
                || normalizeDateTime(getFirstValue(rawTask, ['pre_out_time', 'preOutTime', 'pre out time'])),
            exitEndTime: normalizeDateTime(getFirstValue(rawTask, ['exit_end_time', 'exitEndTime'])),
            scannedAt: new Date().toISOString(),
            fromScan: true,
            source: 'public-task-api'
        };

        taskContext.projectCenter = resolveProjectCenter(taskContext);
        return taskContext;
    }

    async function fetchMapPointById(pointId) {
        if (!pointId) {
            return null;
        }

        const token = await ensureDriverToken().catch(() => sessionStorage.getItem('authToken'));
        const headers = {
            'Content-Type': 'application/json'
        };
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        // #region debug-point B:map-point-request
        fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"B",location:"scan-task-service.js:434",msg:"[DEBUG] request map point",data:{pointId,hasToken:!!token,url:`${APP_API_BASE}/api/map/points/${encodeURIComponent(pointId)}`},ts:Date.now()})}).catch(()=>{});
        // #endregion

        const response = await fetch(`${APP_API_BASE}/api/map/points/${encodeURIComponent(pointId)}`, {
            method: 'GET',
            headers,
            credentials: 'omit'
        });

        const data = await response.json().catch(() => ({}));
        // #region debug-point B:map-point-response
        fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"B",location:"scan-task-service.js:444",msg:"[DEBUG] map point response",data:{pointId,status:response.status,ok:response.ok,code:data&&data.code,message:data&&data.message,data:data&&data.data},ts:Date.now()})}).catch(()=>{});
        // #endregion
        ensureSuccessResponse(response, data, '点位坐标查询失败');
        return unwrapResponseData(data);
    }

    async function fetchProjectPointByName(projectId, pointName) {
        const normalizedProjectId = normalizeText(projectId);
        const normalizedPointName = normalizeText(pointName);
        if (!normalizedProjectId || !normalizedPointName) {
            return null;
        }

        let pointList = PROJECT_POINTS_CACHE.get(normalizedProjectId);
        if (!Array.isArray(pointList)) {
            const token = await ensureDriverToken().catch(() => sessionStorage.getItem('authToken'));
            const headers = {
                'Content-Type': 'application/json'
            };
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }

            const response = await fetch(`${APP_API_BASE}/api/map/points?page=1&page_size=1000&project_id=${encodeURIComponent(normalizedProjectId)}`, {
                method: 'GET',
                headers,
                credentials: 'omit'
            });
            const payload = await response.json().catch(() => ({}));
            ensureSuccessResponse(response, payload, '项目点位查询失败');
            const responseData = unwrapResponseData(payload);
            pointList = Array.isArray(responseData && responseData.list)
                ? responseData.list
                : (Array.isArray(responseData) ? responseData : []);
            PROJECT_POINTS_CACHE.set(normalizedProjectId, pointList);
        }

        return pointList.find((item) => {
            const candidateName = normalizeText(getFirstValue(item, ['point_name', 'pointName', 'name']));
            return candidateName === normalizedPointName;
        }) || null;
    }

    async function resolvePointLocationIfNeeded(point, fallbackLabel, projectId) {
        if (!point) {
            return point;
        }

        if (!point.id) {
            return point;
        }

        const detail = await fetchMapPointById(point.id);
        if (!detail) {
            return point;
        }

        // #region debug-point B:task-point-detail
        fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"nav-route-failure",runId:"pre-fix",hypothesisId:"B",location:"scan-task-service.js:757",msg:"[DEBUG] fetched task point detail",data:{pointId:point.id,fallbackLabel,detail},ts:Date.now()})}).catch(()=>{});
        // #endregion
        const originalPointName = normalizeText(point.name, fallbackLabel);
        const detailPointName = normalizeText(getFirstValue(detail, ['point_name', 'pointName', 'name']), fallbackLabel);
        let matchedByName = null;

        if (originalPointName && originalPointName !== detailPointName) {
            matchedByName = findNavigablePointByName(originalPointName);
            if (!matchedByName) {
                matchedByName = await fetchProjectPointByName(projectId, originalPointName);
            }
        }

        point.name = originalPointName || detailPointName;

        if (matchedByName && Array.isArray(matchedByName.position) && matchedByName.position.length >= 2) {
            setPointLocation(
                point,
                matchedByName.position[0],
                matchedByName.position[1],
                {
                    convertFromWgs84: false,
                    coordSystem: 'gcj02'
                }
            );
        } else {
            setPointLocation(
                point,
                getFirstValue(detail, ['longitude', 'lng', 'lon']),
                getFirstValue(detail, ['latitude', 'lat']),
                {
                    convertFromWgs84: false,
                    coordSystem: 'gcj02'
                }
            );
        }
        // #region debug-point B:task-point-resolved
        fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"nav-route-regression",runId:"pre-fix",hypothesisId:"C",location:"scan-task-service.js:792",msg:"[DEBUG] resolved task point location",data:{pointId:point.id,originalPointName,detailPointName,matchedByName:matchedByName?{name:matchedByName.displayName||matchedByName.name,position:matchedByName.position}:null,name:point.name,location:point.location,coordSystem:point.coordSystem,rawLongitude:point.rawLongitude,rawLatitude:point.rawLatitude},ts:Date.now()})}).catch(()=>{});
        // #endregion
        return point;
    }

    async function fillTaskPointLocations(taskContext) {
        if (!taskContext) {
            return taskContext;
        }

        if (taskContext.startPoint) {
            await resolvePointLocationIfNeeded(taskContext.startPoint, '任务起点', taskContext.projectId || taskContext.projectCode);
        }
        if (taskContext.endPoint) {
            await resolvePointLocationIfNeeded(taskContext.endPoint, '任务终点', taskContext.projectId || taskContext.projectCode);
        }

        taskContext.projectCenter = resolveProjectCenter(taskContext);
        return taskContext;
    }

    async function fetchPublicKey() {
        const response = await fetch(`${APP_API_BASE}/api/user/auth/public-key`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json().catch(() => ({}));
        ensureSuccessResponse(response, data, '获取公钥失败');
        const responseData = unwrapResponseData(data);
        if (!responseData || !responseData.public_key) {
            throw new Error('获取公钥失败');
        }

        return responseData.public_key;
    }

    function encryptLoginData(publicKey, username, password) {
        if (typeof JSEncrypt === 'undefined') {
            throw new Error('JSEncrypt 未加载');
        }

        const encryptor = new JSEncrypt();
        encryptor.setPublicKey(publicKey);
        const encrypted = encryptor.encrypt(JSON.stringify({ username, password }));
        if (!encrypted) {
            throw new Error('登录信息加密失败');
        }
        return encrypted;
    }

    async function ensureDriverToken() {
        const cachedToken = sessionStorage.getItem('authToken');
        if (cachedToken) {
            // #region debug-point D:driver-token-cache-hit
            fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"D",location:"scan-task-service.js:517",msg:"[DEBUG] driver token cache hit",data:{hasToken:true},ts:Date.now()})}).catch(()=>{});
            // #endregion
            return cachedToken;
        }

        const publicKey = await fetchPublicKey();
        // #region debug-point D:driver-token-public-key
        fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"D",location:"scan-task-service.js:523",msg:"[DEBUG] fetched public key",data:{hasPublicKey:!!publicKey},ts:Date.now()})}).catch(()=>{});
        // #endregion
        const encryptedData = encryptLoginData(publicKey, 'Driver', 'Driver@2026');
        const response = await fetch(`${APP_API_BASE}/api/user/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ encrypted_data: encryptedData })
        });

        const data = await response.json().catch(() => ({}));
        // #region debug-point D:driver-token-login-response
        fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"D",location:"scan-task-service.js:534",msg:"[DEBUG] driver token login response",data:{status:response.status,ok:response.ok,code:data&&data.code,message:data&&data.message,hasData:!!(data&&data.data)},ts:Date.now()})}).catch(()=>{});
        // #endregion
        ensureSuccessResponse(response, data, '获取系统认证失败');
        const responseData = unwrapResponseData(data);
        const token = responseData && (responseData.access_token || responseData.token || responseData);
        if (!token) {
            throw new Error('认证返回缺少 token');
        }

        sessionStorage.setItem('authToken', token);
        return token;
    }

    function looksLikeProjectId(value) {
        if (!value || typeof value !== 'string') return false;
        return /^P\d+$/i.test(value.trim());
    }

    async function fillProjectContextIfNeeded(taskContext) {
        if (!taskContext.projectCode && !taskContext.projectId) {
            return taskContext;
        }

        const hasRealProjectName = taskContext.projectName
            && taskContext.projectName !== '扫码项目'
            && !looksLikeProjectId(taskContext.projectName);
        const hasRealProvinceName = taskContext.provinceName && taskContext.provinceName !== '未知省份';
        const hasProjectCenterCoordinates =
            Number.isFinite(taskContext.projectLongitude) &&
            Number.isFinite(taskContext.projectLatitude);
        if (hasRealProjectName && hasRealProvinceName && hasProjectCenterCoordinates) {
            return taskContext;
        }

        try {
            const token = await ensureDriverToken();
            const projectCode = taskContext.projectCode || taskContext.projectId;
            // #region debug-point D:project-request
            fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"D",location:"scan-task-service.js:560",msg:"[DEBUG] request project context",data:{projectCode,hasToken:!!token},ts:Date.now()})}).catch(()=>{});
            // #endregion
            const response = await fetch(`${APP_API_BASE}/api/project/projects/code/${encodeURIComponent(projectCode)}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json().catch(() => ({}));
            // #region debug-point D:project-response
            fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"scan-login-stuck",runId:"pre-fix",hypothesisId:"D",location:"scan-task-service.js:570",msg:"[DEBUG] project context response",data:{projectCode,status:response.status,ok:response.ok,code:data&&data.code,message:data&&data.message,data:data&&data.data},ts:Date.now()})}).catch(()=>{});
            // #endregion
            if (!response.ok || !isSuccessCode(data.code) || !unwrapResponseData(data)) {
                return taskContext;
            }

            const project = unwrapResponseData(data);
            taskContext.projectId = taskContext.projectId || normalizeText(project.id);
            taskContext.projectCode = taskContext.projectCode || normalizeText(projectCode);
            taskContext.projectName = hasRealProjectName
                ? taskContext.projectName
                : normalizeText(project.name || project.project_name || project.projectName, '扫码项目');
            taskContext.provinceId = taskContext.provinceId || normalizeText(project.province_id);
            taskContext.provinceName = taskContext.provinceName || normalizeText(project.province_name, '未知省份');
            taskContext.projectLongitude = taskContext.projectLongitude ?? toNumber(project.longitude || project.lng);
            taskContext.projectLatitude = taskContext.projectLatitude ?? toNumber(project.latitude || project.lat);
            taskContext.projectCenter = resolveProjectCenter(taskContext);
            return taskContext;
        } catch (error) {
            console.warn('[ScanTaskService] 补齐项目上下文失败:', error);
            return taskContext;
        }
    }

    async function enrichTaskContext(taskContext) {
        let nextContext = taskContext;
        nextContext = await fillTaskPointLocations(nextContext);
        nextContext = await fillProjectContextIfNeeded(nextContext);
        nextContext.projectCenter = resolveProjectCenter(nextContext);
        return nextContext;
    }

    function buildScanCurrentUser(taskContext) {
        const ownerProfile = buildTaskOwnerProfile(taskContext);
        const project = {
            id: taskContext.projectId || taskContext.projectCode || null,
            projectCode: taskContext.projectCode || taskContext.projectId || '',
            projectName: taskContext.projectName || '扫码项目',
            provinceId: taskContext.provinceId || null,
            province: taskContext.provinceName || '未知省份',
            longitude: taskContext.projectCenter ? taskContext.projectCenter[0] : null,
            latitude: taskContext.projectCenter ? taskContext.projectCenter[1] : null
        };

        return {
            username: taskContext.driverName || '扫码司机',
            phone: taskContext.phone || '',
            driverId: ownerProfile.driverId || '',
            driverKey: ownerProfile.ownerKey || '',
            role: 'driver',
            isDriver: true,
            isAdmin: false,
            licensePlate: ownerProfile.plateNumber || '',
            projects: [project],
            scanLogin: true,
            taskId: taskContext.taskId
        };
    }

    function buildProjectSelection(taskContext) {
        const projectCenter = taskContext.projectCenter
            ? {
                longitude: taskContext.projectCenter[0],
                latitude: taskContext.projectCenter[1]
            }
            : null;

        return {
            province: taskContext.provinceName || '未知省份',
            project: taskContext.projectName || '扫码项目',
            projectCode: taskContext.projectCode || taskContext.projectId || '',
            projectId: taskContext.projectId || taskContext.projectCode || null,
            longitude: taskContext.projectCenter ? taskContext.projectCenter[0] : null,
            latitude: taskContext.projectCenter ? taskContext.projectCenter[1] : null,
            projectCenter,
            fullProject: {
                projectCode: taskContext.projectCode || taskContext.projectId || '',
                projectId: taskContext.projectId || taskContext.projectCode || null,
                name: taskContext.projectName || '扫码项目',
                longitude: taskContext.projectCenter ? taskContext.projectCenter[0] : null,
                latitude: taskContext.projectCenter ? taskContext.projectCenter[1] : null
            },
            vehicle: taskContext.plateNumber || '',
            timestamp: new Date().toISOString(),
            fromScan: true
        };
    }

    function buildVehicleInfo(taskContext) {
        const ownerProfile = buildTaskOwnerProfile(taskContext);
        return {
            licensePlate: ownerProfile.plateNumber || '',
            driverName: taskContext.driverName || '扫码司机',
            driverId: ownerProfile.driverId || '',
            driverKey: ownerProfile.ownerKey || '',
            carType: taskContext.carType,
            carTypeText: taskContext.carTypeText || '',
            type: 'driver',
            timestamp: new Date().toISOString(),
            fromScan: true
        };
    }

    function buildTaskNavigationRoute(taskContext) {
        if (!taskContext.endPoint || !Array.isArray(taskContext.endPoint.location)) {
            throw new Error('任务终点缺失，无法进入导航');
        }

        let cachedCurrentPosition = null;
        try {
            const rawPosition = sessionStorage.getItem('currentPosition');
            const parsedPosition = rawPosition ? JSON.parse(rawPosition) : null;
            if (Array.isArray(parsedPosition) && parsedPosition.length >= 2) {
                cachedCurrentPosition = parsedPosition;
            }
        } catch (e) {
            console.warn('[ScanTaskService] 读取缓存当前位置失败:', e);
        }

        const route = {
            source: 'task',
            start: {
                name: '我的位置',
                position: cachedCurrentPosition,
                isMyLocation: true
            },
            waypoints: [],
            end: {
                name: taskContext.endPoint.name || '任务终点',
                position: taskContext.endPoint.location
            }
        };

        const taskStartPosition = taskContext.startPoint && Array.isArray(taskContext.startPoint.location)
            ? taskContext.startPoint.location
            : null;

        if (taskContext.startPoint && Array.isArray(taskContext.startPoint.location)) {
            route.waypoints.push({
                name: taskContext.startPoint.name || '任务起点',
                position: taskContext.startPoint.location
            });
        }

        route.meta = {
            taskId: taskContext && taskContext.taskId ? String(taskContext.taskId) : '',
            taskSource: 'scan-task',
            realStartPosition: Array.isArray(cachedCurrentPosition) ? cachedCurrentPosition : null,
            taskStartName: taskContext.startPoint && taskContext.startPoint.name
                ? taskContext.startPoint.name
                : '任务起点',
            taskStartPosition,
            taskEndName: taskContext.endPoint.name || '任务终点',
            taskEndPosition: taskContext.endPoint.location,
            allowReachableSimulatedStart: true
        };

        // #region debug-point A:scan-task-route
        fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"nav-route-failure",runId:"pre-fix",hypothesisId:"A",location:"scan-task-service.js:1014",msg:"[DEBUG] built scan task navigation route",data:{taskId:taskContext&&taskContext.taskId,route},ts:Date.now()})}).catch(()=>{});
        // #endregion

        return route;
    }

    function clearScanRelatedStorage() {
        [
            'navigationRoute',
            'routePlanningData',
            'currentTaskId',
            'currentTaskContext',
            'vehicleInfo',
            'scanEntry',
            'scanTask',
            'scanFallback',
            'scanBootstrapError',
            'navigationReferrer',
            'pointSelectionReferrer'
        ].forEach((key) => sessionStorage.removeItem(key));
    }

    function getScanTaskHistoryStorageKey(ownerKey) {
        const normalizedOwnerKey = normalizeText(ownerKey);
        return normalizedOwnerKey ? `${SCAN_TASK_HISTORY_STORAGE_KEY}:${normalizedOwnerKey}` : SCAN_TASK_HISTORY_STORAGE_KEY;
    }

    function readStoredScanTaskHistory(ownerKey) {
        const uniqueTaskMap = new Map();
        const storageKey = getScanTaskHistoryStorageKey(ownerKey);

        [window.localStorage, window.sessionStorage].forEach((storage) => {
            try {
                const rawValue = storage ? storage.getItem(storageKey) : '';
                if (!rawValue) {
                    return;
                }

                const parsed = JSON.parse(rawValue);
                if (!Array.isArray(parsed)) {
                    return;
                }

                parsed.forEach((task) => {
                    if (task && task.taskId) {
                        uniqueTaskMap.set(String(task.taskId), task);
                    }
                });
            } catch (error) {
                // Ignore corrupt cache and continue reading other storage.
            }
        });

        return Array.from(uniqueTaskMap.values()).sort((left, right) => {
            const leftTime = new Date(left && left.scannedAt ? left.scannedAt : 0).getTime();
            const rightTime = new Date(right && right.scannedAt ? right.scannedAt : 0).getTime();
            return rightTime - leftTime;
        });
    }

    function writeStoredScanTaskHistory(taskList, ownerKey) {
        const safeList = Array.isArray(taskList) ? taskList : [];
        const storageKey = getScanTaskHistoryStorageKey(ownerKey);
        let writeSucceeded = false;

        try {
            window.localStorage.setItem(storageKey, JSON.stringify(safeList));
            writeSucceeded = true;
        } catch (error) {
            console.warn('[ScanTaskService] 保存本地扫码任务列表失败:', error);
        }

        try {
            window.sessionStorage.setItem(storageKey, JSON.stringify(safeList));
            writeSucceeded = true;
        } catch (error) {
            console.warn('[ScanTaskService] 保存会话扫码任务列表失败:', error);
        }

        if (!writeSucceeded) {
            console.warn('[ScanTaskService] 未能保存扫码任务列表');
        }
    }

    function saveScannedTaskToHistory(taskContext) {
        if (!taskContext || !taskContext.taskId) {
            return;
        }

        const ownerProfile = buildTaskOwnerProfile(taskContext);
        if (!ownerProfile.ownerKey) {
            console.warn('[ScanTaskService] 缺少司机唯一标识，跳过持久化扫码任务历史:', taskContext.taskId);
            return;
        }

        const normalizedTask = {
            ...taskContext,
            ownerKey: ownerProfile.ownerKey,
            ownerPlateNumber: ownerProfile.plateNumber,
            ownerDriverId: ownerProfile.driverId,
            ownerPhone: ownerProfile.phone,
            scannedAt: normalizeText(taskContext.scannedAt) || new Date().toISOString()
        };
        const existingList = readStoredScanTaskHistory(ownerProfile.ownerKey);
        const filteredList = existingList.filter((item) => String(item && item.taskId) !== String(normalizedTask.taskId));
        filteredList.unshift(normalizedTask);
        writeStoredScanTaskHistory(filteredList, ownerProfile.ownerKey);
    }

    function recordProjectVisit(projectId) {
        if (!projectId) {
            console.warn('[ScanTaskService][项目统计] 缺失 projectId，无法记录项目访问');
            return;
        }
        const token = sessionStorage.getItem('authToken');
        if (!token) {
            console.warn('[ScanTaskService][项目统计] 缺失 token，无法记录项目访问');
            return;
        }
        try {
            console.log(`[ScanTaskService][项目统计] 准备记录项目访问, projectId: ${projectId}`);
            fetch(`${APP_API_BASE}/api/project/projects/${projectId}/visit`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                keepalive: true
            }).then(res => {
                if (res.ok) {
                    console.log(`[ScanTaskService][项目统计] 项目访问记录成功, projectId: ${projectId}`);
                } else {
                    console.warn(`[ScanTaskService][项目统计] 项目访问记录失败, 状态码: ${res.status}`);
                }
            }).catch(e => console.error('[ScanTaskService][项目统计] 记录访问异常:', e));
        } catch (error) {
            console.error('[ScanTaskService][项目统计] 记录访问异常:', error);
        }
    }

    function saveScanSessionContext(taskContext) {
        clearScanRelatedStorage();

        const normalizedTaskContext = {
            ...taskContext,
            ...buildTaskOwnerProfile(taskContext),
            scannedAt: normalizeText(taskContext && taskContext.scannedAt) || new Date().toISOString()
        };

        const currentUser = buildScanCurrentUser(normalizedTaskContext);
        const projectSelection = buildProjectSelection(normalizedTaskContext);
        const vehicleInfo = buildVehicleInfo(normalizedTaskContext);
        sessionStorage.setItem('isLoggedIn', 'true');
        sessionStorage.setItem('loginType', 'scan');
        sessionStorage.setItem('loginTime', new Date().toISOString());
        sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
        sessionStorage.setItem('projectSelection', JSON.stringify(projectSelection));
        sessionStorage.setItem('vehicleInfo', JSON.stringify(vehicleInfo));
        sessionStorage.setItem('currentTaskId', String(normalizedTaskContext.taskId));
        sessionStorage.setItem('currentTaskContext', JSON.stringify(normalizedTaskContext));
        sessionStorage.setItem('scanEntry', '1');
        sessionStorage.setItem('scanTask', '1');
        
        // 记录项目访问
        if (projectSelection && (projectSelection.projectId || projectSelection.projectCode)) {
            recordProjectVisit(projectSelection.projectId || projectSelection.projectCode);
        }
        
        saveScannedTaskToHistory(normalizedTaskContext);
    }

    function saveFallbackScanSessionContext(taskId, options = {}) {
        clearScanRelatedStorage();

        const fallbackProject = {
            id: null,
            projectCode: '',
            projectName: '扫码项目',
            provinceId: null,
            province: '未知省份',
            longitude: null,
            latitude: null
        };
        const existingUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
        const existingSelection = JSON.parse(sessionStorage.getItem('projectSelection') || '{}');
        const existingProject = (existingUser.projects && existingUser.projects[0]) || {};
        const project = {
            ...fallbackProject,
            ...existingProject,
            projectCode: existingSelection.projectCode || existingProject.projectCode || '',
            projectName: existingSelection.project || existingProject.projectName || '扫码项目',
            longitude: existingSelection.longitude ?? existingProject.longitude ?? null,
            latitude: existingSelection.latitude ?? existingProject.latitude ?? null
        };
        const currentUser = {
            username: existingUser.username || options.driverName || '扫码司机',
            phone: existingUser.phone || options.phone || '',
            role: 'driver',
            isDriver: true,
            isAdmin: false,
            licensePlate: existingUser.licensePlate || options.plateNumber || '',
            projects: [project],
            scanLogin: true,
            taskId: taskId || ''
        };
        const projectSelection = {
            province: existingSelection.province || project.province || '未知省份',
            project: existingSelection.project || project.projectName || '扫码项目',
            projectCode: existingSelection.projectCode || project.projectCode || '',
            projectId: existingSelection.projectId || project.id || null,
            longitude: existingSelection.longitude ?? project.longitude ?? null,
            latitude: existingSelection.latitude ?? project.latitude ?? null,
            projectCenter: existingSelection.projectCenter || null,
            fullProject: existingSelection.fullProject || {
                projectCode: project.projectCode || '',
                projectId: project.id || null,
                name: project.projectName || '扫码项目',
                longitude: project.longitude ?? null,
                latitude: project.latitude ?? null
            },
            vehicle: existingSelection.vehicle || options.plateNumber || '',
            timestamp: new Date().toISOString(),
            fromScan: true,
            degraded: true
        };

        sessionStorage.setItem('isLoggedIn', 'true');
        sessionStorage.setItem('loginType', 'scan');
        sessionStorage.setItem('loginTime', new Date().toISOString());
        sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
        sessionStorage.setItem('projectSelection', JSON.stringify(projectSelection));
        if (taskId) {
            sessionStorage.setItem('currentTaskId', String(taskId));
        }
        sessionStorage.setItem('scanFallback', '1');
        if (options.errorMessage) {
            sessionStorage.setItem('scanBootstrapError', String(options.errorMessage));
        } else {
            sessionStorage.removeItem('scanBootstrapError');
        }

        // 记录项目访问
        if (projectSelection && (projectSelection.projectId || projectSelection.projectCode)) {
            recordProjectVisit(projectSelection.projectId || projectSelection.projectCode);
        }
    }

    function validateTaskContext(taskContext) {
        if (!taskContext.taskId) {
            throw new Error('未识别到任务ID');
        }

        if (!taskContext.projectId && !taskContext.projectCode) {
            throw new Error('任务项目信息不完整');
        }

        if (!taskContext.endPoint || !Array.isArray(taskContext.endPoint.location)) {
            throw new Error('任务终点信息不完整');
        }
    }

    window.ScanTaskService = {
        isScanMockEnabled,
        parseTaskIdFromUrl,
        fetchPublicTaskByTaskId,
        adaptPublicTaskToScanContext,
        enrichTaskContext,
        ensureDriverToken,
        fillProjectContextIfNeeded,
        buildTaskNavigationRoute,
        clearScanMockState,
        readStoredScanTaskHistory,
        saveScanSessionContext,
        saveFallbackScanSessionContext,
        validateTaskContext
    };
})(window);
