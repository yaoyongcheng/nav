/**
 * 管理端 WebSocket 消息推送模块
 * 连接后端 WebSocket 接收实时报警消息
 * 使用 localStorage 锁防止多页面重复连接
 */

const AdminWebSocket = (function() {
    'use strict';

    // 配置
    const CONFIG = {
        wsUrl: 'ws://124.222.203.97:12344/api/ws/notifications',
        reconnectInterval: 5000,  // 重连间隔 5秒
        maxReconnectAttempts: 10,  // 最大重连次数
        enabled: true,  // 启用 WebSocket 实时报警推送
        // 临时策略：后端 fence 报警推送语义未稳定，默认只关闭地图报警 UI 事件驱动。
        // 消息中心入库始终保留，避免漏记报警。
        // 可通过 localStorage.setItem('ws_alarm_event_enabled', 'true') 临时打开地图报警气泡。
        alarmEventEnabled: localStorage.getItem('ws_alarm_event_enabled') === 'true',
        lockKey: 'ws_connection_lock',
        lockTimeout: 10000  // 锁超时 10秒
    };

    // 状态
    let ws = null;
    let isConnected = false;
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let lockRefreshTimer = null;
    let currentProjectId = null;
    let tabId = Date.now() + '_' + Math.random().toString(36).substr(2, 6);

    /**
     * 尝试获取连接锁（防止多页面重复连接）
     */
    function acquireLock() {
        const lockData = localStorage.getItem(CONFIG.lockKey);
        if (lockData) {
            try {
                const lock = JSON.parse(lockData);
                // 如果锁未过期且不是自己的，放弃连接
                if (lock.tabId !== tabId && (Date.now() - lock.timestamp) < CONFIG.lockTimeout) {
                    return false;
                }
            } catch (e) {}
        }
        // 获取锁
        localStorage.setItem(CONFIG.lockKey, JSON.stringify({
            tabId: tabId,
            timestamp: Date.now()
        }));
        return true;
    }

    /**
     * 刷新锁
     */
    function refreshLock() {
        localStorage.setItem(CONFIG.lockKey, JSON.stringify({
            tabId: tabId,
            timestamp: Date.now()
        }));
    }

    /**
     * 释放锁
     */
    function releaseLock() {
        const lockData = localStorage.getItem(CONFIG.lockKey);
        if (lockData) {
            try {
                const lock = JSON.parse(lockData);
                if (lock.tabId === tabId) {
                    localStorage.removeItem(CONFIG.lockKey);
                }
            } catch (e) {
                localStorage.removeItem(CONFIG.lockKey);
            }
        }
    }

    function parsePayload(raw) {
        if (!raw) return {};
        if (typeof raw === 'string') {
            try {
                return JSON.parse(raw);
            } catch (error) {
                console.warn('[WebSocket] 解析 payload 字符串失败:', error, raw);
                return {};
            }
        }
        return raw;
    }

    function pickFirstDefined() {
        for (let i = 0; i < arguments.length; i++) {
            const value = arguments[i];
            if (value !== undefined && value !== null && value !== '') {
                return value;
            }
        }
        return '';
    }

    function normalizeBoolean(value) {
        if (value === undefined || value === null || value === '') {
            return undefined;
        }
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        const normalized = String(value).trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0') return false;
        return undefined;
    }

    function normalizeNumber(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function convertRawCoordinateToGcj02(rawLongitude, rawLatitude) {
        if (!Number.isFinite(rawLongitude) || !Number.isFinite(rawLatitude)) {
            return null;
        }

        if (typeof wgs84ToGcj02 === 'function') {
            const converted = wgs84ToGcj02(rawLongitude, rawLatitude);
            if (Array.isArray(converted) && converted.length === 2) {
                const convertedLongitude = Number(converted[0]);
                const convertedLatitude = Number(converted[1]);
                if (Number.isFinite(convertedLongitude) && Number.isFinite(convertedLatitude)) {
                    return {
                        longitude: convertedLongitude,
                        latitude: convertedLatitude
                    };
                }
            }
        }

        return {
            longitude: rawLongitude,
            latitude: rawLatitude
        };
    }

    function resolveVehicleCoordinates(data) {
        const rawLongitude = normalizeNumber(pickFirstDefined(
            data.rawLongitude,
            data.RawLongitude,
            data.raw_longitude,
            data.RawLng
        ));
        const rawLatitude = normalizeNumber(pickFirstDefined(
            data.rawLatitude,
            data.RawLatitude,
            data.raw_latitude,
            data.RawLat
        ));
        const displayLongitude = normalizeNumber(pickFirstDefined(
            data.longitude,
            data.lng,
            data.lon,
            data.Longitude
        ));
        const displayLatitude = normalizeNumber(pickFirstDefined(
            data.latitude,
            data.lat,
            data.Latitude
        ));
        const hasRawCoordinate = rawLongitude !== null && rawLatitude !== null;
        const hasDisplayCoordinate = displayLongitude !== null && displayLatitude !== null;

        if (hasDisplayCoordinate) {
            return {
                longitude: displayLongitude,
                latitude: displayLatitude,
                rawLongitude: hasRawCoordinate ? rawLongitude : null,
                rawLatitude: hasRawCoordinate ? rawLatitude : null,
                convertedLongitude: displayLongitude,
                convertedLatitude: displayLatitude,
                coordinateSystem: 'gcj02',
                coordinateSource: hasRawCoordinate ? 'display_preferred' : 'display'
            };
        }

        if (hasRawCoordinate) {
            const converted = convertRawCoordinateToGcj02(rawLongitude, rawLatitude);
            return {
                longitude: converted ? converted.longitude : rawLongitude,
                latitude: converted ? converted.latitude : rawLatitude,
                rawLongitude,
                rawLatitude,
                convertedLongitude: converted ? converted.longitude : rawLongitude,
                convertedLatitude: converted ? converted.latitude : rawLatitude,
                coordinateSystem: 'gcj02',
                coordinateSource: 'raw_converted'
            };
        }

        return {
            longitude: null,
            latitude: null,
            rawLongitude: null,
            rawLatitude: null,
            convertedLongitude: null,
            convertedLatitude: null,
            coordinateSystem: '',
            coordinateSource: 'empty'
        };
    }

    function emitConnectionStatus(status, extra) {
        if (typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent('adminWebSocketStatusChange', {
            detail: {
                status,
                projectId: currentProjectId || '',
                timestamp: new Date().toISOString(),
                ...(extra || {})
            }
        }));
    }

    function getResolvedWsUrl() {
        const overrideUrl = pickFirstDefined(
            (typeof window !== 'undefined' && window.__ADMIN_WS_URL__) || '',
            sessionStorage.getItem('admin_ws_url') || '',
            localStorage.getItem('admin_ws_url') || ''
        );
        const secureOverrideUrl = pickFirstDefined(
            (typeof window !== 'undefined' && window.__ADMIN_WSS_URL__) || '',
            sessionStorage.getItem('admin_wss_url') || '',
            localStorage.getItem('admin_wss_url') || ''
        );

        let resolved = overrideUrl || CONFIG.wsUrl;

        try {
            const url = new URL(resolved, window.location.href);
            if (window.location.protocol === 'https:' && url.protocol === 'ws:') {
                if (secureOverrideUrl) {
                    resolved = secureOverrideUrl;
                } else {
                    url.protocol = 'wss:';
                    resolved = url.toString();
                }
                console.warn('[WebSocket] 当前页面为 HTTPS，已尝试切换为安全 WebSocket 地址:', resolved);
            }
        } catch (error) {
            console.warn('[WebSocket] 解析 WebSocket 地址失败，继续使用原始地址:', resolved, error);
        }

        return resolved;
    }

    /**
     * 初始化 WebSocket 连接
     */
    function init() {
        if (!CONFIG.enabled) {
            console.log('[WebSocket] 已禁用，跳过连接');
            return;
        }

        currentProjectId = getProjectId();
        if (!currentProjectId) {
            console.log('[WebSocket] 未找到项目ID，延迟初始化');
            emitConnectionStatus('waiting_project');
            setTimeout(init, 3000);
            return;
        }

        // 尝试获取锁
        if (!acquireLock()) {
            console.log('[WebSocket] 其他页面已持有连接，本页面跳过连接');
            emitConnectionStatus('skipped_by_lock');
            // 定期检查锁是否过期，过期则接管
            setTimeout(init, CONFIG.lockTimeout + 1000);
            return;
        }

        console.log('[WebSocket] 初始化，项目ID:', currentProjectId, '页面ID:', tabId);
        connect();

        // 定时刷新锁
        lockRefreshTimer = setInterval(refreshLock, CONFIG.lockTimeout / 2);
    }

    /**
     * 获取项目ID
     */
    function getProjectId() {
        const projectSelection = sessionStorage.getItem('projectSelection');
        if (projectSelection) {
            try {
                const selection = JSON.parse(projectSelection);
                return selection.projectCode || selection.projectId;
            } catch (e) {}
        }

        const currentUser = sessionStorage.getItem('currentUser');
        if (currentUser) {
            try {
                const user = JSON.parse(currentUser);
                if (user.projects && user.projects.length > 0) {
                    return user.projects[0].projectCode || user.projects[0].id;
                }
            } catch (e) {}
        }

        return null;
    }

    /**
     * 建立 WebSocket 连接
     */
    function connect() {
        if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
            console.log('[WebSocket] 已连接或正在连接中');
            return;
        }

        try {
            const token = sessionStorage.getItem('authToken') || '';

            let wsUrl = getResolvedWsUrl();
            const params = [];
            if (token) {
                params.push(`token=${encodeURIComponent(token)}`);
            }
            if (currentProjectId) {
                params.push(`project_id=${encodeURIComponent(currentProjectId)}`);
            }
            if (params.length > 0) {
                wsUrl += '?' + params.join('&');
            }

            console.log('[WebSocket] 正在连接:', wsUrl);
            emitConnectionStatus('connecting', { wsUrl });
            ws = new WebSocket(wsUrl);

            ws.onopen = onOpen;
            ws.onmessage = onMessage;
            ws.onerror = onError;
            ws.onclose = onClose;

        } catch (error) {
            console.error('[WebSocket] 连接失败:', error);
            scheduleReconnect();
        }
    }

    /**
     * 连接成功
     */
    function onOpen(event) {
        console.log('[WebSocket] 连接成功');
        isConnected = true;
        reconnectAttempts = 0;
        emitConnectionStatus('connected');

        // 延迟发送订阅，给服务端一点处理时间
        setTimeout(function() {
            subscribe(currentProjectId);
        }, 500);
    }

    /**
     * 发送订阅信息
     */
    function subscribe(projectId) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.warn('[WebSocket] 未连接，无法订阅');
            return;
        }

        // SubscribeCommand 格式
        const subscribeMsg = {
            action: 'subscribe',
            project_ids: [projectId]
        };
        ws.send(JSON.stringify(subscribeMsg));
        console.log('[WebSocket] 已发送订阅:', subscribeMsg);
    }

    /**
     * 收到消息
     */
    function onMessage(event) {
        console.log('[WebSocket] 收到消息:', event.data);

        try {
            const message = JSON.parse(event.data);
            handleMessage(message);
        } catch (error) {
            console.warn('[WebSocket] 消息解析失败:', error);
        }
    }

    /**
     * 处理消息
     */
    function handleMessage(message) {
        const msgType = message.type || message.msgType || message.event;

        switch (msgType) {
            case 'fence_alert':
            case 'fence_enter':
            case 'fence_leave':
            case 'fence_alarm':
            case 'fence_message':
            case 'warning':
            case 'alarm':
                handleFenceAlert(message);
                break;

            // 固定车偏离规定场外道路
            case 'route_deviation':
            case 'deviation':
                handleRouteDeviation(message);
                break;

            // AI 摄像头道路状态变化
            case 'traffic_status':
                handleTrafficStatus(message);
                break;

            case 'vehicle_location':
            case 'gps':
            case 'vehicle_update':
            case 'location':
                handleVehicleLocation(message);
                break;

            case 'device_status':
                console.log('[WebSocket] 设备状态:', message);
                break;

            case 'subscribed':
            case 'connected':
            case 'pong':
                console.log('[WebSocket] 系统消息:', msgType);
                break;

            default:
                if (message.vehicleId || message.fenceId || message.plateNumber || message.source_id) {
                    handleFenceAlert(message);
                } else {
                    console.log('[WebSocket] 未知消息类型:', message);
                }
        }
    }

    /**
     * 处理围栏报警（电子围栏闯入 + 固定车违规出场）
     */
    function handleFenceAlert(message) {
        console.warn('[WebSocket] 围栏报警:', message);

        // 提取字段（兼容 PushMessage 和其他格式）
        const data = message.data ? parsePayload(message.data) : message;
        const vehicleId   = data.vehicleId   || data.plateNumber  || data.plate_number || data.vehicle_id  || message.source_id || '未知车辆';
        const plateNumber = data.plateNumber || data.plate_number || message.source_id || vehicleId;
        const fenceId     = data.fenceId     || data.fence_id     || '';
        const fenceName   = data.fenceName   || data.fence_name   || data.areaName    || '围栏区域';
        const fenceType   = data.fenceType   || data.fence_type   || data.areaType    || 'prohibit';
        const eventType   = data.eventType   || data.event_type   || data.event       || 'enter';
        const coordinates = resolveVehicleCoordinates(data);
        const alarmType   = data.alarmType   || data.alarm_type   || '';
        const msgType     = message.type || '';
        const inRestricted = normalizeBoolean(pickFirstDefined(data.inRestricted, data.in_restricted));
        const inFence = normalizeBoolean(pickFirstDefined(data.inFence, data.in_fence));
        const rawVehicleType = pickFirstDefined(data.vehicleType, data.vehicle_type, data.VehicleType);
        const normalizedVehicleType = (rawVehicleType === 1 || rawVehicleType === '1' || rawVehicleType === 'fixed' || rawVehicleType === '固定车')
            ? 'fixed'
            : 'temp';
        const sourceId = message.source_id || data.source_id || '';
        const resolvedDeviceId = pickFirstDefined(data.deviceId, data.device_id, data.DeviceID, data.trackerId, data.tracker_id, data.trackerID, data.TrackerID, '');
        const alertKey = String(resolvedDeviceId || sourceId || plateNumber || vehicleId);

        // 标准化类型字段
        if (alarmType === 'ROUTE_DEVIATION_EXTERNAL' || alarmType === 'ROUTE_DEVIATION_REGULATED') {
            handleRouteDeviation(message);
            return;
        }

        if (typeof AdminAlarmEventCenter === 'undefined') {
            console.warn('[WebSocket] AdminAlarmEventCenter 不可用，跳过 fence 报警处理');
            return;
        }

        AdminAlarmEventCenter.handleFenceAlarm({
            sourceType: 'ws_event',
            projectId: pickFirstDefined(message.project_id, data.project_id, data.projectId, data.ProjectId, data.projectID, ''),
            vehicleId: alertKey,
            plateNumber: plateNumber,
            deviceId: resolvedDeviceId,
            sourceId: sourceId,
            vehicleType: rawVehicleType !== undefined ? rawVehicleType : normalizedVehicleType,
            taskId: pickFirstDefined(data.taskId, data.task_id, data.taskID, null),
            taskScope: pickFirstDefined(data.taskScope, data.task_scope, data.workSiteScope, data.work_site_scope, null),
            polylineId: pickFirstDefined(data.polylineId, data.polyline_id, data.taskPolylineId, data.task_polyline_id, null),
            lineName: pickFirstDefined(data.lineName, data.line_name, data.taskLineName, ''),
            fenceId: fenceId,
            fenceName: fenceName,
            matchedFenceId: pickFirstDefined(data.matched_fence_id, data.matchedFenceId, data.matchedFenceID, ''),
            matchedRestrictedId: pickFirstDefined(data.matched_restricted_id, data.matchedRestrictedId, data.matchedRestrictedID, ''),
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            rawLatitude: coordinates.rawLatitude,
            rawLongitude: coordinates.rawLongitude,
            convertedLatitude: coordinates.convertedLatitude,
            convertedLongitude: coordinates.convertedLongitude,
            coordinateSystem: coordinates.coordinateSystem,
            coordinateSource: coordinates.coordinateSource,
            alarmType: alarmType,
            inRestricted: inRestricted,
            inFence: inFence,
            description: data.description || '',
            eventTime: pickFirstDefined(data.timeStr, data.time_str, data.lastRestrictedAlarmTime, ''),
            raw: message
        });
    }

    /**
     * 处理固定车偏离规定场外道路报警
     */
    function handleRouteDeviation(message) {
        console.warn('[WebSocket] 偏离路线报警:', message);

        const data = message.data ? parsePayload(message.data) : message;
        const plateNumber = data.plateNumber || data.plate_number || message.source_id || data.vehicleId || data.vehicle_id || '未知车辆';
        const coordinates = resolveVehicleCoordinates(data);

        if (typeof AdminAlarmEventCenter === 'undefined') {
            console.warn('[WebSocket] AdminAlarmEventCenter 不可用，跳过偏航报警处理');
            return;
        }

        AdminAlarmEventCenter.handleRouteDeviation({
            sourceType: 'ws_event',
            projectId: pickFirstDefined(message.project_id, data.project_id, data.projectId, data.ProjectId, data.projectID, ''),
            vehicleId: plateNumber,
            plateNumber: plateNumber,
            deviceId: pickFirstDefined(data.deviceId, data.device_id, data.DeviceID, data.trackerId, data.tracker_id, data.trackerID, data.TrackerID, ''),
            sourceId: message.source_id || data.source_id || '',
            vehicleType: pickFirstDefined(data.vehicleType, data.vehicle_type, data.VehicleType, 'fixed'),
            taskId: pickFirstDefined(data.taskId, data.task_id, data.taskID, null),
            taskScope: pickFirstDefined(data.taskScope, data.task_scope, data.workSiteScope, data.work_site_scope, null),
            polylineId: pickFirstDefined(data.polylineId, data.polyline_id, data.taskPolylineId, data.task_polyline_id, null),
            lineName: pickFirstDefined(data.lineName, data.line_name, data.taskLineName, ''),
            description: data.description || '',
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            rawLatitude: coordinates.rawLatitude,
            rawLongitude: coordinates.rawLongitude,
            convertedLatitude: coordinates.convertedLatitude,
            convertedLongitude: coordinates.convertedLongitude,
            coordinateSystem: coordinates.coordinateSystem,
            coordinateSource: coordinates.coordinateSource,
            eventTime: pickFirstDefined(data.timeStr, data.time_str, data.lastOutdoorRouteAlarmTime, ''),
            raw: message
        });
    }

    /**
     * 处理 AI 摄像头道路状态变化
     * traffic_status 消息格式：
     * {
     *   "type": "traffic_status",
     *   "project_id": "P000000049",
     *   "source_id": "CAM001",
     *   "data": {
     *     "area": "P000000049",
     *     "results": [{ "camera": "CAM001", "evaluation": "congested" }],
     *     "time": "..."
     *   }
     * }
     *
     * evaluation 枚举值（待后端确认完整列表，当前已知）：
     * - 'congested' / '拥堵'
     * - 'free' / '畅通'
     * - 'slow' / '缓行'
     * - 'blocked' / '阻断'
     */
    function handleTrafficStatus(message) {
        console.log('[WebSocket] 道路状态变化:', message);

        const data = message.data ? parsePayload(message.data) : message;
        const results = data.results || [];

        if (results.length === 0) {
            console.warn('[WebSocket] traffic_status 消息无 results 数据');
            return;
        }

        // 遍历每条摄像头状态变化，触发前端道路状态更新事件
        results.forEach(result => {
            const cameraId = result.camera;
            const evaluation = result.evaluation;

            if (!cameraId || !evaluation) {
                console.warn('[WebSocket] traffic_status result 缺少 camera 或 evaluation 字段:', result);
                return;
            }

            console.log(`[WebSocket] 摄像头 ${cameraId} 道路状态变化: ${evaluation}`);

            if (typeof AdminAlarmEventCenter !== 'undefined') {
                const payload = {
                    sourceType: 'ws_event',
                    projectId: message.project_id || data.area || '',
                    cameraId: cameraId,
                    evaluation: evaluation,
                    eventTime: data.time || result.time || '',
                    raw: {
                        message,
                        result
                    }
                };
                console.log('[WebSocket] 准备分发道路状态变化给报警中心:', payload);
                AdminAlarmEventCenter.handleRoadStatusChange(payload);
            } else {
                console.warn('[WebSocket] AdminAlarmEventCenter 未定义，无法分发道路状态消息');
            }
        });
    }

    /**
     * 处理车辆实时位置
     * vehicle_location 消息格式：
     * {
     *   "type": "vehicle_location",
     *   "project_id": "P000000049",
     *   "source_id": "鄂A12345",
     *   "data": {
     *     "plateNumber": "鄂A12345",
     *     "latitude": 30.5,
     *     "longitude": 114.3,
     *     "direction": 90,
     *     "updatedAt": "...",
     *     "inRestricted": false,
     *     "inFence": true,
     *     "vehicleType": 0
     *   }
     * }
     */
    function handleVehicleLocation(message) {
        const data = message.data ? parsePayload(message.data) : message;
        const projectId = pickFirstDefined(message.project_id, data.project_id, data.projectId, data.ProjectId, data.projectID, '');
        const plateNumber = pickFirstDefined(data.plateNumber, data.plate_number, data.PlateNumber, '');
        const deviceId = pickFirstDefined(data.deviceId, data.device_id, data.DeviceID, data.trackerId, data.tracker_id, data.trackerID, data.TrackerID, '');
        const identifier = pickFirstDefined(plateNumber, deviceId, message.source_id, data.source_id, '');
        const coordinates = resolveVehicleCoordinates(data);
        const latitude = coordinates.latitude;
        const longitude = coordinates.longitude;

        if (!projectId || !identifier || latitude === null || longitude === null) {
            console.warn('[WebSocket] vehicle_location 缺少必要字段:', message);
            return;
        }

        const detail = {
            projectId,
            sourceId: message.source_id || data.source_id || deviceId || plateNumber || identifier,
            plateNumber,
            latitude,
            longitude,
            rawLatitude: coordinates.rawLatitude,
            rawLongitude: coordinates.rawLongitude,
            convertedLatitude: coordinates.convertedLatitude,
            convertedLongitude: coordinates.convertedLongitude,
            coordinateSystem: coordinates.coordinateSystem,
            coordinateSource: coordinates.coordinateSource,
            direction: normalizeNumber(pickFirstDefined(data.direction, data.Direction)),
            updatedAt: pickFirstDefined(data.updatedAt, data.updated_at, data.UpdateTime, data.timeStr, data.time_str, ''),
            taskName: pickFirstDefined(data.taskName, data.task_name, data.TaskName, data.lineName, data.line_name, data.LineName, data.taskLineName, ''),
            driverName: pickFirstDefined(data.driverName, data.driver_name, data.DriverName, ''),
            driverPhone: pickFirstDefined(data.driverPhone, data.driver_phone, data.phone, data.Phone, ''),
            vehicleType: pickFirstDefined(data.vehicleType, data.vehicle_type, data.VehicleType),
            taskId: pickFirstDefined(data.taskId, data.task_id, data.taskID, null),
            taskScope: pickFirstDefined(data.taskScope, data.task_scope, data.workSiteScope, data.work_site_scope, null),
            polylineId: pickFirstDefined(data.polylineId, data.polyline_id, data.taskPolylineId, data.task_polyline_id, null),
            lineName: pickFirstDefined(data.lineName, data.line_name, data.LineName, data.taskLineName, ''),
            matchedRestrictedId: pickFirstDefined(data.matchedRestrictedId, data.matched_restricted_id, data.matchedRestrictedID, ''),
            inRestricted: normalizeBoolean(pickFirstDefined(data.inRestricted, data.in_restricted)),
            inFence: normalizeBoolean(pickFirstDefined(data.inFence, data.in_fence)),
            deviceId: deviceId,
            raw: message
        };

        console.log('[WebSocket] 车辆位置更新:', detail);

        window.dispatchEvent(new CustomEvent('vehicleLocationUpdate', {
            detail
        }));
    }

    /**
     * 连接错误
     */
    function onError(error) {
        console.error('[WebSocket] 连接错误:', error);
        emitConnectionStatus('error', {
            message: error && error.message ? error.message : ''
        });
    }

    /**
     * 连接关闭
     */
    function onClose(event) {
        console.log('[WebSocket] 连接关闭, code:', event.code, 'reason:', event.reason);
        isConnected = false;
        ws = null;
        emitConnectionStatus('closed', {
            code: event.code,
            reason: event.reason || ''
        });

        scheduleReconnect();
    }

    /**
     * 安排重连
     */
    function scheduleReconnect() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }

        if (reconnectAttempts >= CONFIG.maxReconnectAttempts) {
            console.warn('[WebSocket] 已达到最大重连次数，停止重连');
            releaseLock();
            return;
        }

        reconnectAttempts++;
        console.log(`[WebSocket] ${CONFIG.reconnectInterval / 1000}秒后尝试重连 (${reconnectAttempts}/${CONFIG.maxReconnectAttempts})`);
        emitConnectionStatus('reconnecting', {
            attempt: reconnectAttempts,
            maxAttempts: CONFIG.maxReconnectAttempts
        });

        reconnectTimer = setTimeout(() => {
            connect();
        }, CONFIG.reconnectInterval);
    }

    /**
     * 断开连接
     */
    function disconnect() {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }

        if (lockRefreshTimer) {
            clearInterval(lockRefreshTimer);
            lockRefreshTimer = null;
        }

        if (ws) {
            ws.close();
            ws = null;
        }

        isConnected = false;
        releaseLock();
        emitConnectionStatus('disconnected');
        console.log('[WebSocket] 已断开连接');
    }

    /**
     * 发送消息
     */
    function send(data) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.warn('[WebSocket] 未连接，无法发送消息');
            return false;
        }

        const message = typeof data === 'string' ? data : JSON.stringify(data);
        ws.send(message);
        return true;
    }

    // 页面加载后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(init, 500);
        });
    } else {
        setTimeout(init, 500);
    }

    // 页面卸载时断开连接并释放锁
    window.addEventListener('beforeunload', disconnect);

    // 导出API
    return {
        init,
        connect,
        disconnect,
        send,
        subscribe,
        isConnected: () => isConnected
    };

})();

console.log('[WebSocket] 模块已加载');
