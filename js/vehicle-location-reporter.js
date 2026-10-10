/**
 * 车辆位置上报模块
 * 功能：司机进入系统后，每隔1秒上报一次车辆位置信息
 * 作者：系统自动生成
 * 日期：2026-01-07
 */

// 位置上报配置
const LocationReporterConfig = {
    reportInterval: 1000,           // 上报间隔（毫秒）1秒
    apiUrl: 'https://dmap.cscec3bxjy.cn/api/transport/temp-vehicle/report',
    enabled: true,                  // 是否启用上报
    maxRetries: 3,                  // 最大重试次数
    retryDelay: 2000               // 重试延迟（毫秒）
};

const REPORTER_STORAGE_KEYS = {
    snapshot: 'vehicle_location_reporter_snapshot'
};
const SNAPSHOT_MAX_AGE_MS = 5000;
const SNAPSHOT_STALE_REUSE_MS = 15000;
const SNAPSHOT_SOURCE_HOLD_MS = 4000;
const BACKGROUND_WATCH_OPTIONS = {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 3000
};

// 上报器状态
let reporterState = {
    isRunning: false,               // 是否正在运行
    timerId: null,                  // 定时器ID
    watchId: null,                  // 后台定位监听ID
    lifecycleBound: false,          // 生命周期事件是否已绑定
    lastReportTime: null,           // 最后上报时间
    reportCount: 0,                 // 上报次数
    failCount: 0,                   // 失败次数
    currentUser: null,              // 当前用户信息
    projectId: null,                // 项目ID
    lastPosition: null,             // 最后的GPS位置
    latestSnapshot: null,           // 最近一次位置快照
    lastSnapshotTime: 0             // 最近一次位置快照时间
};

function clearPersistedSnapshot() {
    try {
        sessionStorage.removeItem(REPORTER_STORAGE_KEYS.snapshot);
    } catch (error) {
        console.warn('[位置上报器] 清理持久化快照失败:', error);
    }
}

function persistSnapshot(snapshot, projectId) {
    if (!snapshot || !projectId) {
        clearPersistedSnapshot();
        return;
    }

    try {
        sessionStorage.setItem(REPORTER_STORAGE_KEYS.snapshot, JSON.stringify({
            ...snapshot,
            projectId,
            savedAt: Date.now()
        }));
    } catch (error) {
        console.warn('[位置上报器] 持久化位置快照失败:', error);
    }
}

function loadPersistedSnapshot(projectId) {
    try {
        const raw = sessionStorage.getItem(REPORTER_STORAGE_KEYS.snapshot);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (!parsed || String(parsed.projectId || '') !== String(projectId || '')) {
            return null;
        }

        const savedAt = Number(parsed.savedAt || 0);
        if (!savedAt || (Date.now() - savedAt) > SNAPSHOT_MAX_AGE_MS) {
            return null;
        }

        return normalizeSnapshot(parsed);
    } catch (error) {
        console.warn('[位置上报器] 读取持久化位置快照失败:', error);
        return null;
    }
}

function resetSnapshotState(clearPersisted) {
    reporterState.latestSnapshot = null;
    reporterState.lastSnapshotTime = 0;
    reporterState.lastPosition = null;
    if (clearPersisted) {
        clearPersistedSnapshot();
    }
}

function shouldStopForGeolocationError(error) {
    if (!error) return false;
    return error.code === 1 || /permission|denied|权限/i.test(error.message || '');
}

function parseSnapshotTimestamp(value, fallbackMs) {
    if (!value) {
        return fallbackMs || 0;
    }

    if (typeof value === 'number' && isFinite(value)) {
        return value > 1e12 ? value : value * 1000;
    }

    const parsed = Date.parse(value);
    return isNaN(parsed) ? (fallbackMs || 0) : parsed;
}

function getSnapshotSourcePriority(source) {
    switch (String(source || '').trim()) {
        case 'nav_snapped':
            return 5;
        case 'nav_gps':
        case 'nav_start':
            return 4;
        case 'home_gps':
            return 3;
        case 'reporter_watch_gps':
            return 2;
        case 'browser_geolocation':
            return 1;
        default:
            return 0;
    }
}

function shouldReplaceSnapshot(existingSnapshot, incomingSnapshot) {
    if (!existingSnapshot) {
        return true;
    }

    const now = Date.now();
    const existingPriority = getSnapshotSourcePriority(existingSnapshot.source);
    const incomingPriority = getSnapshotSourcePriority(incomingSnapshot.source);
    const existingTimestamp = parseSnapshotTimestamp(
        existingSnapshot.reportedAt,
        reporterState.lastSnapshotTime || 0
    );
    const incomingTimestamp = parseSnapshotTimestamp(
        incomingSnapshot.reportedAt,
        now
    );
    const existingAgeMs = existingTimestamp > 0 ? Math.max(0, now - existingTimestamp) : Number.MAX_SAFE_INTEGER;

    if (incomingPriority < existingPriority && existingAgeMs <= SNAPSHOT_SOURCE_HOLD_MS) {
        return false;
    }

    if (incomingPriority > existingPriority) {
        return true;
    }

    return incomingTimestamp >= existingTimestamp;
}

function buildSnapshotFromCoords(latitude, longitude, extra) {
    if (!isFinite(latitude) || !isFinite(longitude)) {
        return null;
    }

    return normalizeSnapshot({
        latitude,
        longitude,
        direction: extra && extra.direction,
        accuracy: extra && extra.accuracy,
        source: extra && extra.source,
        isNavigating: extra && extra.isNavigating,
        reportedAt: extra && extra.reportedAt
    });
}

function buildSnapshotFromBrowserPosition(position, source, isNavigating) {
    if (!position || !position.coords) {
        return null;
    }

    const rawLat = Number(position.coords.latitude);
    const rawLng = Number(position.coords.longitude);
    if (!isFinite(rawLat) || !isFinite(rawLng)) {
        return null;
    }

    let latitude = rawLat;
    let longitude = rawLng;

    if (typeof wgs84ToGcj02 === 'function') {
        const converted = wgs84ToGcj02(rawLng, rawLat);
        if (Array.isArray(converted) && converted.length === 2) {
            longitude = Number(converted[0]);
            latitude = Number(converted[1]);
        }
    }

    return buildSnapshotFromCoords(latitude, longitude, {
        direction: position.coords.heading || window.currentMapRotation || 1,
        accuracy: position.coords.accuracy || null,
        source,
        isNavigating: !!isNavigating,
        reportedAt: new Date().toISOString()
    });
}

function clearBackgroundLocationWatch() {
    if (reporterState.watchId !== null && navigator.geolocation && typeof navigator.geolocation.clearWatch === 'function') {
        navigator.geolocation.clearWatch(reporterState.watchId);
    }
    reporterState.watchId = null;
}

function ensureBackgroundLocationWatch() {
    if (reporterState.watchId !== null) {
        return;
    }

    if (!navigator.geolocation || typeof navigator.geolocation.watchPosition !== 'function') {
        console.warn('[位置上报器] 当前环境不支持后台定位监听');
        return;
    }

    try {
        reporterState.watchId = navigator.geolocation.watchPosition(
            (position) => {
                const snapshot = buildSnapshotFromBrowserPosition(position, 'reporter_watch_gps', false);
                if (!snapshot) {
                    return;
                }

                updateLatestSnapshot(snapshot);
            },
            (error) => {
                console.warn('[位置上报器] 后台定位监听失败:', error);
                if (shouldStopForGeolocationError(error)) {
                    stopLocationReporting({
                        preserveSnapshot: false,
                        reason: 'location_permission_lost'
                    });
                }
            },
            BACKGROUND_WATCH_OPTIONS
        );

        console.log('[位置上报器] 已启动后台定位监听');
    } catch (error) {
        reporterState.watchId = null;
        console.warn('[位置上报器] 启动后台定位监听失败:', error);
    }
}

function getReporterContext() {
    const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
    const projectSelection = JSON.parse(sessionStorage.getItem('projectSelection') || '{}');

    // 验证用户是否是司机
    if (!currentUser.isDriver && currentUser.role !== 'driver') {
        return {
            valid: false,
            reason: '当前用户不是司机，不启动位置上报'
        };
    }

    // 验证必要信息
    if (!currentUser.licensePlate) {
        return {
            valid: false,
            reason: '缺少车牌号信息，无法上报'
        };
    }

    // 获取项目ID（优先从projectSelection.projectCode获取）
    let projectId = null;
    if (projectSelection.projectCode) {
        projectId = projectSelection.projectCode;
    } else if (projectSelection.projectId) {
        projectId = projectSelection.projectId;
    } else if (projectSelection.project) {
        if (typeof projectSelection.project === 'object' && projectSelection.project.projectCode) {
            projectId = projectSelection.project.projectCode;
        } else {
            const projectName = projectSelection.project;
            const userProjects = currentUser.projects || [];
            const foundProject = userProjects.find(p => p.projectName === projectName);
            if (foundProject) {
                projectId = foundProject.projectCode || foundProject.id;
            }
        }
    }

    if (!projectId) {
        return {
            valid: false,
            reason: '缺少项目ID，无法上报',
            currentUser,
            projectSelection
        };
    }

    return {
        valid: true,
        currentUser,
        projectId,
        projectSelection
    };
}

function bindReporterLifecycle() {
    if (reporterState.lifecycleBound) {
        return;
    }

    reporterState.lifecycleBound = true;

    // 页面恢复可见时同步上下文，避免切换项目后继续使用旧项目ID
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            refreshReporterContext();
            if (reporterState.isRunning) {
                ensureBackgroundLocationWatch();
            }
        }
    });

    // 页面卸载前停止定时器，避免旧页面残留日志干扰排查
    window.addEventListener('beforeunload', function() {
        stopLocationReporting({
            preserveSnapshot: true,
            reason: 'page_unload'
        });
    });
}

function refreshReporterContext() {
    const previousProjectId = reporterState.projectId;
    const context = getReporterContext();

    if (!context.valid) {
        reporterState.currentUser = null;
        reporterState.projectId = null;
        resetSnapshotState(true);
        console.warn('[位置上报器]', context.reason);
        if (context.projectSelection) {
            console.warn('[位置上报器] projectSelection:', context.projectSelection);
        }
        return false;
    }

    reporterState.currentUser = context.currentUser;
    reporterState.projectId = context.projectId;

    if (previousProjectId && String(previousProjectId) !== String(context.projectId)) {
        console.log('[位置上报器] 检测到项目切换，清理旧项目位置快照:', previousProjectId, '->', context.projectId);
        resetSnapshotState(true);
    }

    if (!reporterState.latestSnapshot) {
        const persistedSnapshot = loadPersistedSnapshot(context.projectId);
        if (persistedSnapshot) {
            reporterState.latestSnapshot = persistedSnapshot;
            reporterState.lastSnapshotTime = Date.now();
            reporterState.lastPosition = {
                latitude: persistedSnapshot.latitude,
                longitude: persistedSnapshot.longitude
            };
            console.log('[位置上报器] 已恢复最近一次位置快照');
        }
    }

    console.log('[位置上报器] 上下文已同步:', {
        plateNumber: context.currentUser.licensePlate,
        projectId: context.projectId
    });

    return true;
}

function normalizeSnapshot(snapshot) {
    if (!snapshot) return null;

    const latitude = Number(snapshot.latitude);
    const longitude = Number(snapshot.longitude);

    if (isNaN(latitude) || isNaN(longitude)) {
        return null;
    }

    let direction = Number(snapshot.direction);
    if (!isFinite(direction) || direction <= 0) {
        direction = 1;
    }

    return {
        latitude,
        longitude,
        direction,
        accuracy: snapshot.accuracy != null ? Number(snapshot.accuracy) : null,
        source: snapshot.source || 'unknown',
        isNavigating: Boolean(snapshot.isNavigating),
        reportedAt: snapshot.reportedAt || new Date().toISOString()
    };
}

function updateLatestSnapshot(snapshot) {
    const normalized = normalizeSnapshot(snapshot);
    if (!normalized) {
        return false;
    }

    if (!shouldReplaceSnapshot(reporterState.latestSnapshot, normalized)) {
        return true;
    }

    reporterState.latestSnapshot = normalized;
    reporterState.lastSnapshotTime = Date.now();
    reporterState.lastPosition = {
        latitude: normalized.latitude,
        longitude: normalized.longitude
    };
    persistSnapshot(normalized, reporterState.projectId);

    return true;
}

/**
 * 初始化位置上报器
 * 在司机进入首页后调用
 */
function initVehicleLocationReporter() {
    console.log('[位置上报器] 开始初始化...');

    bindReporterLifecycle();

    // 检查是否已经在运行
    if (reporterState.isRunning) {
        refreshReporterContext();
        console.log('[位置上报器] 已经在运行中');
        return;
    }

    if (!refreshReporterContext()) {
        return;
    }

    console.log('[位置上报器] 初始化成功');
    console.log('[位置上报器] 车牌号:', reporterState.currentUser.licensePlate);
    console.log('[位置上报器] 项目ID:', reporterState.projectId);
    console.log('[位置上报器] 上报间隔:', LocationReporterConfig.reportInterval / 1000, '秒');

    // 注意：不在此处启动定时上报
    // 等待用户点击定位按钮或GPS定位成功后再启动
    console.log('[位置上报器] 等待GPS定位...');
}

/**
 * 启动位置上报
 * 当GPS定位成功后调用
 * @param {Object} position - GPS位置对象 {latitude, longitude}
 */
function startLocationReporting(position) {
    if (!LocationReporterConfig.enabled) {
        console.log('[位置上报器] 上报功能已禁用');
        return;
    }

    if (!refreshReporterContext()) {
        console.warn('[位置上报器] 上下文无效，无法启动上报');
        return;
    }

    if (position) {
        updateLatestSnapshot(position);
    }

    if (reporterState.isRunning) {
        console.log('[位置上报器] 已经在运行中');
        return;
    }

    console.log('[位置上报器] 启动定时上报...');

    ensureBackgroundLocationWatch();

    // 立即执行一次上报
    reportVehicleLocation();

    // 启动定时器，每1秒上报一次
    reporterState.timerId = setInterval(() => {
        reportVehicleLocation();
    }, LocationReporterConfig.reportInterval);

    reporterState.isRunning = true;
    console.log('[位置上报器] 定时上报已启动');
}

/**
 * 停止位置上报
 */
function stopLocationReporting(options) {
    const normalizedOptions = typeof options === 'object' && options !== null
        ? options
        : {};
    const preserveSnapshot = !!normalizedOptions.preserveSnapshot;

    if (!reporterState.isRunning) {
        console.log('[位置上报器] 未在运行');
        if (!preserveSnapshot) {
            resetSnapshotState(true);
        }
        return;
    }

    if (reporterState.timerId) {
        clearInterval(reporterState.timerId);
        reporterState.timerId = null;
    }

    clearBackgroundLocationWatch();

    reporterState.isRunning = false;

    if (!preserveSnapshot) {
        resetSnapshotState(true);
    }

    console.log('[位置上报器] 已停止上报');
    console.log('[位置上报器] 统计信息 - 总上报次数:', reporterState.reportCount, '失败次数:', reporterState.failCount);
}

/**
 * 上报车辆位置
 * 获取当前GPS位置并上报到后端
 */
async function reportVehicleLocation() {
    try {
        if (!refreshReporterContext()) {
            console.warn('[位置上报器] 上下文无效，跳过本次上报');
            return;
        }

        // 获取当前GPS位置
        const position = await getCurrentGPSPosition();

        if (!position) {
            console.warn('[位置上报器] 无法获取GPS位置，跳过本次上报');
            return;
        }

        const { latitude, longitude } = position;
        const plateNumber = reporterState.currentUser.licensePlate;
        const projectId = reporterState.projectId;
        const direction = position.direction || window.currentMapRotation || 1;

        console.log('[位置上报器] 准备上报:', {
            latitude,
            longitude,
            plateNumber,
            projectId,
            source: position.source || 'unknown',
            accuracy: position.accuracy,
            time: new Date().toLocaleTimeString()
        });

        // 构建请求数据（注意：后端Go接口要求首字母大写）
        const requestData = {
            Latitude: latitude,
            Longitude: longitude,
            PlateNumber: plateNumber,
            ProjectId: projectId,
            Direction: direction  // 车辆方向角度（相对正北），不能为0
        };

        console.log('[位置上报器] 发送请求数据:', JSON.stringify(requestData, null, 2));

        // 发送上报请求
        const response = await fetch(LocationReporterConfig.apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            // 尝试读取错误响应
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            try {
                const errorData = await response.json();
                console.error('[位置上报器] 服务器返回错误:', errorData);
                errorMessage += ` - ${JSON.stringify(errorData)}`;
            } catch (e) {
                // 无法解析JSON错误信息
            }
            throw new Error(errorMessage);
        }

        const result = await response.json();

        // 更新状态
        reporterState.lastReportTime = new Date();
        reporterState.reportCount++;
        reporterState.lastPosition = {
            latitude,
            longitude
        };

        console.log('[位置上报器] 上报成功:', result);
        console.log('[位置上报器] 累计上报次数:', reporterState.reportCount);

    } catch (error) {
        reporterState.failCount++;
        console.error('[位置上报器] 上报失败:', error);
        console.error('[位置上报器] 失败次数:', reporterState.failCount);

        // v1.6.11 新增：失败入队（弱网/断网下保留位置，网络恢复后自动重发）
        try {
            if (typeof LocationQueue !== 'undefined' && typeof LocationQueue.enqueue === 'function') {
                LocationQueue.enqueue(requestData).then(function (id) {
                    try { console.warn('[位置上报器] 已入队离线队列 #' + id + ' (plate=' + requestData.PlateNumber + ')'); } catch (_) {}
                }).catch(function (qe) {
                    try { console.error('[位置上报器] 入队失败:', qe); } catch (_) {}
                });
            }
        } catch (_) { /* 入队异常不影响主流程 */ }

        if (shouldStopForGeolocationError(error)) {
            console.warn('[位置上报器] 定位权限不可用，停止持续上报');
            stopLocationReporting({
                preserveSnapshot: false,
                reason: 'location_permission_lost'
            });
        }

        // 注意：上报失败不停止定时器，会在下个周期继续尝试
    }
}

/**
 * 获取当前GPS位置
 * @returns {Promise<{latitude: number, longitude: number}>}
 */
function getCurrentGPSPosition() {
    return new Promise((resolve, reject) => {
        // 优先使用由首页/导航页统一推送的最新位置快照
        if (reporterState.latestSnapshot && (Date.now() - reporterState.lastSnapshotTime) <= SNAPSHOT_MAX_AGE_MS) {
            resolve({
                latitude: reporterState.latestSnapshot.latitude,
                longitude: reporterState.latestSnapshot.longitude,
                direction: reporterState.latestSnapshot.direction,
                source: reporterState.latestSnapshot.source,
                isNavigating: reporterState.latestSnapshot.isNavigating,
                accuracy: reporterState.latestSnapshot.accuracy,
                reportedAt: reporterState.latestSnapshot.reportedAt
            });
            return;
        }

        if (reporterState.latestSnapshot && (Date.now() - reporterState.lastSnapshotTime) <= SNAPSHOT_STALE_REUSE_MS) {
            resolve({
                latitude: reporterState.latestSnapshot.latitude,
                longitude: reporterState.latestSnapshot.longitude,
                direction: reporterState.latestSnapshot.direction,
                source: reporterState.latestSnapshot.source,
                isNavigating: reporterState.latestSnapshot.isNavigating,
                accuracy: reporterState.latestSnapshot.accuracy,
                reportedAt: reporterState.latestSnapshot.reportedAt
            });
            return;
        }

        if (reporterState.latestSnapshot) {
            resetSnapshotState(true);
        }

        // 优先使用导航吸附后的位置（如果在导航中）
        if (window.NavCore && typeof window.NavCore.getStatus === 'function') {
            const navStatus = window.NavCore.getStatus();
            if (navStatus.isNavigating && window.snappedPosition) {
                // 使用吸附后的高精度位置
                resolve({
                    latitude: window.snappedPosition[1],
                    longitude: window.snappedPosition[0],
                    direction: window.currentMapRotation || 1,
                    source: 'nav_snapped',
                    isNavigating: true
                });
                return;
            }
        }

        // 如果不在导航中，使用全局的GPS位置
        if (window.lastGpsPosIndex) {
            const lnglat = window.lastGpsPosIndex;
            resolve({
                latitude: lnglat[1],
                longitude: lnglat[0],
                direction: window.currentMapRotation || 1,
                source: 'home_gps',
                isNavigating: false
            });
            return;
        }

        // 如果没有实时定位，使用浏览器原生定位获取一次
        if (!navigator.geolocation) {
            reject(new Error('浏览器不支持定位'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const snapshot = buildSnapshotFromBrowserPosition(position, 'browser_geolocation', false);
                if (!snapshot) {
                    reject(new Error('浏览器定位结果无效'));
                    return;
                }

                updateLatestSnapshot(snapshot);
                resolve(snapshot);
            },
            (error) => {
                console.error('[位置上报器] GPS定位失败:', error);
                reject(error);
            },
            {
                enableHighAccuracy: true,
                timeout: 8000,
                maximumAge: 3000  // 允许使用3秒内的缓存
            }
        );
    });
}

/**
 * 获取上报器状态
 * @returns {Object} 上报器状态信息
 */
function getReporterStatus() {
    return {
        isRunning: reporterState.isRunning,
        reportCount: reporterState.reportCount,
        failCount: reporterState.failCount,
        lastReportTime: reporterState.lastReportTime,
        lastSnapshotTime: reporterState.lastSnapshotTime,
        licensePlate: reporterState.currentUser?.licensePlate,
        projectId: reporterState.projectId,
        latestSnapshot: reporterState.latestSnapshot
    };
}

function updateReporterPosition(position) {
    const updated = updateLatestSnapshot(position);
    if (!updated) {
        return false;
    }

    if (!reporterState.isRunning) {
        startLocationReporting(position);
    }

    return true;
}

// 导出到全局作用域
window.VehicleLocationReporter = {
    init: initVehicleLocationReporter,
    refreshContext: refreshReporterContext,
    updatePosition: updateReporterPosition,
    start: startLocationReporting,
    stop: stopLocationReporting,
    getStatus: getReporterStatus
};

// ============ 离线队列：iOS Safari 降级触发器（v1.6.11 新增）============
// iOS Safari 不支持 Background Sync API，必须靠这些事件主动消费队列
function setupOfflineQueueTriggers() {
    if (typeof window.LocationQueue === 'undefined') return;

    // 补设点 1：网络恢复（navigator.onLine 从 false → true 时触发）
    window.addEventListener('online', function () {
        try { console.info('[位置上报器] online 事件, 消费离线队列'); } catch (_) {}
        window.LocationQueue.drain().then(function (r) {
            try { console.info('[位置上报器] online drain:', r); } catch (_) {}
        }).catch(function () {});
    });

    // 补设点 2：页面从后台切回前台（PWA 切回 / 浏览器 tab 切回）
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
            try { console.info('[位置上报器] visibilitychange=visible, 消费离线队列'); } catch (_) {}
            window.LocationQueue.drain().catch(function () {});
        }
    });

    // 补设点 3：pageshow（兼容浏览器 BFCache + Safari 后台恢复）
    window.addEventListener('pageshow', function (e) {
        if (e && e.persisted) {
            try { console.info('[位置上报器] pageshow BFCache, 消费离线队列'); } catch (_) {}
            window.LocationQueue.drain().catch(function () {});
        }
    });
}

try { setupOfflineQueueTriggers(); } catch (e) { /* 启动失败不影响主流程 */ }

console.log('[位置上报器] 模块已加载');
