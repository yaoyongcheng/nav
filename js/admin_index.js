// 管理员导航页面 JavaScript
// map 变量已在 config.js 中声明，这里直接使用

// 管理监控页统一交给 AdminRoadStatusSync 管理道路状态，避免与 kml-handler 的旧轮询重复执行。
window.disableAutoDriverRoadStatusPolling = true;
window.useUnifiedAdminRoadStatusSync = true;

// 全局变量：存储地图点位数据和摄像头标记
let mapPoints = [];  // 存储所有地图点位数据
let cameraMarkers = [];  // 存储摄像头标记
let isCameraLayerVisible = false;  // 摄像头图层是否可见
let pendingAdminCameraSelection = null;

function isAlarmFencePolygon(source) {
    if (!source) return false;

    const areaType = typeof normalizeAreaType === 'function'
        ? normalizeAreaType(source.area_type ?? source.areaType ?? source.type)
        : source.area_type ?? source.areaType ?? source.type;

    if (areaType === 1 || areaType === '1' || areaType === 'prohibit') {
        return true;
    }

    return typeof shouldUseUnifiedZoneStyle === 'function' && shouldUseUnifiedZoneStyle(source);
}

// 工地监控页统一为全显模式，保留状态变量仅做兼容
let currentAdminDataMode = 'all';

const ADMIN_DEVICE_SEARCH_PAGE = 'admin_device_search.html';
const ADMIN_PENDING_CAMERA_SELECTION_KEY = 'adminPendingCameraSelection';
const ADMIN_PENDING_VEHICLE_DETAIL_KEY = 'adminPendingVehicleDetail';

const ADMIN_TRANSPORT_IMAGE_BASE = 'images/工地数字导航小程序切图/管理/2X/运输管理/';
const ROAD_STATUS_ICON_BASE = 'images/工地数字导航小程序切图/地图icon/';
const ADMIN_TRANSPORT_IMAGE_FILES = Object.freeze({
    play: '播放.png',
    monitor: '监控.png'
});
const ROAD_STATUS_ICON_FILES = Object.freeze({
    2: 'icon-拥堵.png',
    3: 'icon-阻断.png'
});
const ROAD_STATUS_COLORS = Object.freeze({
    0: '#9AE59D',
    1: '#FAAD14',
    2: '#F5222D',
    3: '#8C8C8C'
});
const CAMERA_MARKER_LAYOUT = Object.freeze({
    pinWidth: 32,
    pinHeight: 44,
    markerWidth: 104,
    markerHeight: 72,
    labelTop: 41,
    labelMaxWidth: 96,
    labelFontSize: 11,
    labelLineHeight: 14,
    bubbleWidth: 72,
    bubbleHeight: 26,
    bubbleRadius: 6,
    bubbleFontSize: 11,
    bubbleIconSize: 12,
    bubbleGap: -1,
    minScale: 0.56
});
const CAMERA_MARKER_DISPLAY = Object.freeze({
    pinMinZoom: 16,
    bubbleMinZoom: 17
});

function getAdminTransportImagePath(fileName) {
    return `${ADMIN_TRANSPORT_IMAGE_BASE}${fileName}`;
}

function getRoadStatusIconPath(status) {
    const fileName = ROAD_STATUS_ICON_FILES[status];
    return fileName ? `${ROAD_STATUS_ICON_BASE}${fileName}` : '';
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatAdminDetailValue(value) {
    if (value === undefined || value === null) return '无';
    const text = String(value).trim();
    return text ? text : '无';
}

function formatAdminDetailTime(value) {
    const normalized = formatAdminDetailValue(value);
    if (normalized === '无') return '无';

    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
        return normalized;
    }

    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${month}月${day}日 ${hours}:${minutes}`;
}

function getAdminTaskStatusPresentation(statusText) {
    const text = formatAdminDetailValue(statusText);
    if (text.includes('逾期')) {
        return { text, className: 'status-overdue' };
    }
    if (text.includes('进行')) {
        return { text, className: 'status-ongoing' };
    }
    if (text.includes('完成')) {
        return { text, className: 'status-completed' };
    }
    return { text, className: 'status-default' };
}

function normalizeAdminVehicleDetail(rawDetail) {
    const detail = rawDetail || {};
    return {
        vehicleType: formatAdminDetailValue(detail.vehicleType || detail.attribute || detail.vehicle_type_name || detail.vehicleTypeName),
        taskType: formatAdminDetailValue(detail.taskType || detail.task_name || detail.taskName),
        plateNumber: formatAdminDetailValue(detail.plateNumber || detail.plate_number || detail.plateNumberDisplay),
        locator: formatAdminDetailValue(detail.locator || detail.vehicle_id || detail.vehicleId || detail.tracker_id || detail.trackerId),
        driverName: formatAdminDetailValue(detail.driverName || detail.driver_name),
        phone: formatAdminDetailValue(detail.phone || detail.contact || detail.mobile),
        exitTime: formatAdminDetailTime(detail.exitTime || detail.exit_time),
        entryTime: formatAdminDetailTime(detail.entryTime || detail.entry_time),
        taskStatus: getAdminTaskStatusPresentation(detail.taskStatus || detail.task_status || detail.statusText || detail.status_text)
    };
}

function setAdminVehicleDetailValue(elementId, value, extraClass) {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.textContent = value;
    if (element.classList.contains('admin-detail-status')) {
        element.classList.remove('status-ongoing', 'status-overdue', 'status-completed', 'status-default');
        if (extraClass) {
            element.classList.add(extraClass);
        }
    }
}

function showAdminVehicleDetailSheet(rawDetail) {
    const sheet = document.getElementById('admin-vehicle-detail-sheet');
    if (!sheet) return;

    const detail = normalizeAdminVehicleDetail(rawDetail);
    setAdminVehicleDetailValue('admin-detail-vehicle-type', detail.vehicleType);
    setAdminVehicleDetailValue('admin-detail-task-type', detail.taskType);
    setAdminVehicleDetailValue('admin-detail-plate-number', detail.plateNumber);
    setAdminVehicleDetailValue('admin-detail-locator', detail.locator);
    setAdminVehicleDetailValue('admin-detail-driver-name', detail.driverName);
    setAdminVehicleDetailValue('admin-detail-phone', detail.phone);
    setAdminVehicleDetailValue('admin-detail-exit-time', detail.exitTime);
    setAdminVehicleDetailValue('admin-detail-entry-time', detail.entryTime);
    setAdminVehicleDetailValue('admin-detail-task-status', detail.taskStatus.text, detail.taskStatus.className);
    sheet.classList.add('visible');
}

function hideAdminVehicleDetailSheet() {
    const sheet = document.getElementById('admin-vehicle-detail-sheet');
    if (sheet) {
        sheet.classList.remove('visible');
    }
}

function consumePendingAdminSelections() {
    const vehicleDetailStr = sessionStorage.getItem(ADMIN_PENDING_VEHICLE_DETAIL_KEY);
    if (vehicleDetailStr) {
        try {
            showAdminVehicleDetailSheet(JSON.parse(vehicleDetailStr));
        } catch (error) {
            console.error('[工地监控] 解析车辆详情失败:', error);
        }
        sessionStorage.removeItem(ADMIN_PENDING_VEHICLE_DETAIL_KEY);
    }

    const pendingCameraStr = sessionStorage.getItem(ADMIN_PENDING_CAMERA_SELECTION_KEY);
    if (pendingCameraStr) {
        try {
            pendingAdminCameraSelection = JSON.parse(pendingCameraStr);
        } catch (error) {
            console.error('[工地监控] 解析监控搜索结果失败:', error);
            pendingAdminCameraSelection = null;
        }
        sessionStorage.removeItem(ADMIN_PENDING_CAMERA_SELECTION_KEY);
    }
}

function consumePendingAdminCameraSelection() {
    if (!pendingAdminCameraSelection) return;

    const cameraDetail = pendingAdminCameraSelection;
    pendingAdminCameraSelection = null;
    showCameraInfo(cameraDetail.id, cameraDetail.camera_name || cameraDetail.name || '监控设备', cameraDetail);
}

function isAdminDataPageContext() {
    return /admin_data\.html$/i.test(window.location.pathname);
}

function shouldUseUnifiedAdminRoadStatusSync() {
    return window.useUnifiedAdminRoadStatusSync === true &&
        window.AdminRoadStatusSync &&
        typeof window.AdminRoadStatusSync.init === 'function';
}

async function ensureAdminDataUnifiedDisplay() {
    const vehicleLegend = document.getElementById('vehicle-legend');
    if (vehicleLegend) {
        vehicleLegend.style.display = 'flex';
    }

    currentAdminDataMode = 'all';

    if (typeof AdminVehicleManager !== 'undefined' && typeof AdminVehicleManager.showAllVehicles === 'function') {
        AdminVehicleManager.showAllVehicles();
    }

    if (!isCameraLayerVisible) {
        await showCameraLayer();
    }
}

// ==================== 道路状态管理全局变量 ====================

// 路段状态缓存：Map<`${start_id}_${end_id}`, ai_road_status>
// 用于轮询时对比前后状态，只更新有变化的路段
const roadStatusCache = new Map();

// 阻断图标缓存：Map<`${start_id}_${end_id}`, AMap.Marker>
// 用于管理地图上的路况状态图标（拥堵/阻断），状态恢复时精确移除
const blockedRoadMarkers = new Map();

// 道路状态轮询定时器
let roadStatusPollTimer = null;

// 轮询间隔：3秒，与司机端导航保持一致
const ROAD_STATUS_POLL_INTERVAL = 3000;

// evaluation 文字 → ai_road_status 数字映射
// ⚠️ evaluation 枚举值待后端确认完整列表，当前已知值如下
const EVALUATION_STATUS_MAP = {
    // 英文枚举（待后端确认）
    'free':      0,
    'slow':      1,
    'congested': 2,
    'blocked':   3,
    // 中文兼容
    '畅通': 0,
    '缓行': 1,
    '拥堵': 2,
    '阻断': 3,
};

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async function() {
    // 检查登录状态
    checkLoginStatus();

    try {
        if (typeof window.ensureAmapReady === 'function') {
            await window.ensureAmapReady();
        }
    } catch (error) {
        alert('高德地图加载失败，请稍后重试');
        return;
    }

    // 初始化地图
    initMap();

    // 初始化事件监听
    initEventListeners();

    // 处理从设备搜索或车辆列表跳转过来的待展示数据
    consumePendingAdminSelections();

    // 加载项目地图数据
    loadProjectMapData();
});

// 检查登录状态
function checkLoginStatus() {
    const isLoggedIn = sessionStorage.getItem('isLoggedIn');
    const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
    
    if (!isLoggedIn || (currentUser.role !== 'manager' && !currentUser.isAdmin)) {
        // 未登录或不是管理员，跳转到登录页
        window.location.href = 'login.html';
        return;
    }
    
    console.log('管理员已登录:', currentUser);
}

// 初始化地图
function initMap() {
    // 获取项目中心点（如果有）
    const projectCenter = getProjectCenter();

    // 创建地图实例
    map = new AMap.Map('map-container', {
        zoom: MapConfig.mapConfig.zoom,
        center: projectCenter || [114.305215, 30.593099], // 优先使用项目中心，否则默认武汉
        mapStyle: 'amap://styles/normal',
        viewMode: '2D',
        pitch: 0,
        rotation: 0,
        showLabel: true,
        features: ['bg', 'road', 'building', 'point']
    });

    console.log('管理员地图初始化完成，中心点:', projectCenter || '默认');

    // 监听地图加载完成事件
    map.on('complete', function() {
        console.log('[管理员首页] 地图加载完成');

        // 检查是否从搜索页返回并选择了位置
        const selectedLocationStr = sessionStorage.getItem('selectedLocation');
        if (selectedLocationStr) {
            try {
                const selectedLocation = JSON.parse(selectedLocationStr);
                console.log('[管理员首页] 从搜索页返回，选中的位置:', selectedLocation);

                // 清除标记，避免重复处理
                sessionStorage.removeItem('selectedLocation');

                // 保存待处理的位置，等待KML数据加载完成后处理
                window.pendingSelectedLocation = selectedLocation;
            } catch (e) {
                console.error('[管理员首页] 处理选中位置失败:', e);
            }
        }
    });
}

// 获取项目中心点
function getProjectCenter() {
    try {
        const projectSelection = sessionStorage.getItem('projectSelection');
        const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
        const parseProjectCenter = (candidate) => {
            if (!candidate) {
                return null;
            }

            if (Array.isArray(candidate) && candidate.length >= 2) {
                const lng = parseFloat(candidate[0]);
                const lat = parseFloat(candidate[1]);
                return isFinite(lng) && isFinite(lat) ? [lng, lat] : null;
            }

            const lng = parseFloat(
                candidate.longitude ?? candidate.lng ?? candidate.lon ?? candidate.centerLng
            );
            const lat = parseFloat(
                candidate.latitude ?? candidate.lat ?? candidate.centerLat
            );
            return isFinite(lng) && isFinite(lat) ? [lng, lat] : null;
        };

        if (projectSelection) {
            const selection = JSON.parse(projectSelection);
            const projectName = selection.project;
            const directSelectionCenter =
                parseProjectCenter(selection.projectCenter) ||
                parseProjectCenter(selection.fullProject) ||
                parseProjectCenter(selection);

            if (directSelectionCenter) {
                return directSelectionCenter;
            }

            // 从用户的项目列表中找到选择的项目
            const userProjects = currentUser.projects || [];

            // 优先使用 projectCode 精确匹配，避免重名项目混淆
            let selectedProject = null;
            if (selection.projectCode) {
                selectedProject = userProjects.find(p =>
                    (p.projectCode === selection.projectCode) || (p.id === selection.projectCode)
                );
            }

            // 如果projectCode匹配失败，回退到名称匹配
            if (!selectedProject) {
                selectedProject = userProjects.find(p => p.projectName === projectName);
            }

            if (selectedProject) {
                return parseProjectCenter(selectedProject);
            }
        }
    } catch (e) {
        console.error('获取项目中心点失败:', e);
    }
    return null;
}

// 加载项目地图数据（点、线、面）- 使用与司机端相同的处理逻辑
async function loadProjectMapData() {
    try {
        // 1. 获取项目选择信息
        const projectSelection = sessionStorage.getItem('projectSelection');
        const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
        
        let projectId = null;
        let projectName = '所有项目';
        let projectCenter = null;
        const parseProjectCenter = (candidate) => {
            if (!candidate) {
                return null;
            }

            if (Array.isArray(candidate) && candidate.length >= 2) {
                const lng = parseFloat(candidate[0]);
                const lat = parseFloat(candidate[1]);
                return isFinite(lng) && isFinite(lat) ? [lng, lat] : null;
            }

            const lng = parseFloat(
                candidate.longitude ?? candidate.lng ?? candidate.lon ?? candidate.centerLng
            );
            const lat = parseFloat(
                candidate.latitude ?? candidate.lat ?? candidate.centerLat
            );
            return isFinite(lng) && isFinite(lat) ? [lng, lat] : null;
        };
        
        if (projectSelection) {
            const selection = JSON.parse(projectSelection);
            projectName = selection.project;
            const directSelectionCenter =
                parseProjectCenter(selection.projectCenter) ||
                parseProjectCenter(selection.fullProject) ||
                parseProjectCenter(selection);

            if (directSelectionCenter) {
                projectCenter = directSelectionCenter;
            }

            // 从用户的项目列表中找到选择的项目
            const userProjects = currentUser.projects || [];
            console.log('[管理端] 用户项目列表:', userProjects);
            console.log('[管理端] 选择的项目名称:', projectName);
            console.log('[管理端] 选择的项目Code:', selection.projectCode);

            // 优先使用 projectCode 精确匹配，避免重名项目混淆
            let selectedProject = null;
            if (selection.projectCode) {
                selectedProject = userProjects.find(p =>
                    (p.projectCode === selection.projectCode) || (p.id === selection.projectCode)
                );
                console.log('[管理端] 通过projectCode匹配:', selectedProject ? '成功' : '失败');
            }

            // 如果projectCode匹配失败，回退到名称匹配
            if (!selectedProject) {
                selectedProject = userProjects.find(p => p.projectName === projectName);
                console.log('[管理端] 通过projectName匹配:', selectedProject ? '成功' : '失败');
            }

            if (selectedProject) {
                // projectCode 才是API需要的项目ID
                projectId = selectedProject.projectCode || selectedProject.id;
                const selectedProjectCenter = parseProjectCenter(selectedProject);
                if (selectedProjectCenter) {
                    projectCenter = selectedProjectCenter;
                }
                console.log('[管理端] 选择的项目:', {
                    name: projectName,
                    id: projectId,
                    center: projectCenter,
                    fullProject: selectedProject
                });
            } else {
                console.warn('[管理端] 未在用户项目列表中找到匹配项目:', projectName);
            }
        }

        // 2. 准备请求headers
        const baseURL = 'https://dmap.cscec3bxjy.cn/api/map';
        const headers = {
            'Content-Type': 'application/json'
        };

        const token = sessionStorage.getItem('authToken') || '';
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        // 3. 获取当前启用的地图版本号
        if (!projectId) {
            console.warn('[管理端] 没有项目ID，无法获取地图');
            alert('请先选择项目');
            return;
        }
        
        let versionId = null;
        try {
            console.log('[管理端] 获取项目地图版本...');
            const versionRes = await fetch(`${baseURL}/map-versions/project/${projectId}/active`, { headers });
            
            if (versionRes.ok) {
                const versionData = await versionRes.json();
                console.log('[管理端] 版本信息:', versionData);

                if (versionData.code === 200 && versionData.data) {
                    // 使用 MapVersion_Id 字段（bigint类型）
                    versionId = versionData.data.MapVersion_Id || versionData.data.id;
                    console.log('[管理端] 当前启用版本ID:', versionId);
                    if (typeof window.setProjectActiveMapVersion === 'function') {
                        window.setProjectActiveMapVersion(projectId, versionId);
                    }
                }
            }
        } catch (e) {
            console.warn('[管理端] 获取版本信息失败:', e);
        }
        
        // 如果没有版本号，提示无地图
        if (!versionId) {
            console.warn('[管理端] 该项目没有启用的地图版本');
            alert('该项目暂无地图数据');
            
            // 即使没有地图数据，如果有项目中心也设置地图中心
            if (projectCenter && map) {
                map.setCenter(projectCenter);
                map.setZoom(MapConfig.mapConfig.zoom);
            }
            return;
        }

        // 4. 构建请求URL：管理端首页地图改用项目级全量接口，避免分页遗漏
        let pointsUrl = `${baseURL}/points/project/${encodeURIComponent(projectId)}?map_version_id=${encodeURIComponent(versionId)}`;
        let polylinesUrl = `${baseURL}/polylines/project/${encodeURIComponent(projectId)}?map_version_id=${encodeURIComponent(versionId)}`;
        let polygonsUrl = `${baseURL}/polygons/project/${encodeURIComponent(projectId)}?map_version_id=${encodeURIComponent(versionId)}`;

        console.log('[管理端] 项目ID:', projectId, '版本ID:', versionId);
        console.log('[管理端] 请求URL:', { pointsUrl, polylinesUrl, polygonsUrl });

        // 5. 并行请求数据
        console.log('[管理端] 请求地图数据...');
        const [pointsRes, polylinesRes, polygonsRes] = await Promise.all([
            fetch(pointsUrl, { headers }),
            fetch(polylinesUrl, { headers }),
            fetch(polygonsUrl, { headers })
        ]);

        if (!pointsRes.ok || !polylinesRes.ok || !polygonsRes.ok) {
            console.error('[管理端] API请求失败');
            return;
        }

        // 6. 解析数据
        const pointsData = await pointsRes.json();
        const polylinesData = await polylinesRes.json();
        const polygonsData = await polygonsRes.json();

        let points = pointsData.data?.list || pointsData.data || [];
        let polylines = polylinesData.data?.list || polylinesData.data || [];
        let polygons = polygonsData.data?.list || polygonsData.data || [];

        // 保存点位数据到全局变量（供摄像头功能使用）
        mapPoints = points;
        console.log('[管理端] 保存点位数据:', mapPoints.length, '个点');

        // 【新增】过滤数据：只保留当前版本的数据，去除其他版本的重复数据
        console.log('[管理端] ========== 数据版本过滤 ==========');
        console.log('[管理端] 当前请求的版本ID:', versionId);
        console.log('[管理端] 过滤前数据量 - 点:', points.length, '线:', polylines.length, '面:', polygons.length);

        // 【新增】打印点数据示例，查看字段
        if (points.length > 0) {
            console.log('[管理端] ========== 点数据字段检查 ==========');
            console.log('[管理端] 点数据示例 (完整对象):', points[0]);
            console.log('[管理端] 点数据所有字段名:', Object.keys(points[0]));
            console.log('[管理端] 检查版本字段:');
            console.log('  - map_version_id:', points[0].map_version_id);
            console.log('  - MapVersion_Id:', points[0].MapVersion_Id);
            console.log('  - version_id:', points[0].version_id);
            console.log('  - mapVersionId:', points[0].mapVersionId);
            console.log('[管理端] ==========================================');
        }

        // 统计点数据的版本分布（尝试多个可能的字段名）
        const pointVersions = {};
        points.forEach(point => {
            const v = point.map_version_id || point.MapVersion_Id || point.version_id || '无版本字段';
            pointVersions[v] = (pointVersions[v] || 0) + 1;
        });
        console.log('[管理端] 点数据版本分布:', pointVersions);

        // 统计线数据的版本分布
        const lineVersions = {};
        polylines.forEach(line => {
            const v = line.map_version_id || '无版本字段';
            lineVersions[v] = (lineVersions[v] || 0) + 1;
        });
        console.log('[管理端] 线数据版本分布:', lineVersions);

        // 统计面数据的版本分布
        const polygonVersions = {};
        polygons.forEach(polygon => {
            const v = polygon.map_version_id || '无版本字段';
            polygonVersions[v] = (polygonVersions[v] || 0) + 1;
        });
        console.log('[管理端] 面数据版本分布:', polygonVersions);

        // 过滤点数据（新的 /points 接口返回的数据包含 map_version_id 字段）
        const pointsBeforeFilter = points.length;
        points = points.filter(point => {
            const versionField = point.map_version_id || point.MapVersion_Id || point.version_id;
            // 如果没有版本字段，保留该数据
            if (!versionField) return true;
            // 只保留匹配当前版本的数据
            return versionField == versionId;
        });
        const pointsFiltered = pointsBeforeFilter - points.length;

        // 过滤线数据
        const linesBeforeFilter = polylines.length;
        polylines = polylines.filter(line => {
            if (!line.map_version_id) return true;
            return line.map_version_id == versionId;
        });
        const linesFiltered = linesBeforeFilter - polylines.length;

        // 过滤面数据
        const polygonsBeforeFilter = polygons.length;
        polygons = polygons.filter(polygon => {
            if (!polygon.map_version_id) return true;
            return polygon.map_version_id == versionId;
        });
        const polygonsFiltered = polygonsBeforeFilter - polygons.length;

        let latestFencePolygons = [];
        try {
            const projectSelection = JSON.parse(sessionStorage.getItem('projectSelection') || '{}');
            const fenceProjectId = typeof normalizeFenceProjectId === 'function'
                ? normalizeFenceProjectId(projectSelection)
                : (projectSelection.projectCode || projectSelection.projectId || '');
            const fenceVersionId = typeof resolveFenceMapVersionId === 'function'
                ? await resolveFenceMapVersionId(fenceProjectId)
                : String(versionId || '');

            if (fenceProjectId && typeof fetchFenceProjectData === 'function') {
                latestFencePolygons = await fetchFenceProjectData(fenceProjectId, fenceVersionId);
            }
        } catch (fenceError) {
            console.warn('[管理端] 获取新围栏数据用于 polygon 去重失败:', fenceError);
        }

        const polygonsBeforeFenceDedup = polygons.length;
        if (typeof filterDuplicateFencePolygons === 'function' && latestFencePolygons.length > 0) {
            polygons = filterDuplicateFencePolygons(polygons, latestFencePolygons, '[管理端]');
        }
        const duplicateFencePolygonsRemoved = polygonsBeforeFenceDedup - polygons.length;

        // 禁停区统一交给 /fence-polygons 覆盖层绘制，避免管理端主图混入普通区块链路后重复叠加
        const alarmFencePolygons = polygons.filter(polygon => isAlarmFencePolygon(polygon));
        polygons = polygons.filter(polygon => !isAlarmFencePolygon(polygon));

        console.log('[管理端] 过滤后数据量 - 点:', points.length, '线:', polylines.length, '面:', polygons.length);
        console.log('[管理端] 已过滤 - 点:', pointsFiltered, '个, 线:', linesFiltered, '条, 面:', polygonsFiltered, '个');
        console.log('[管理端] 已按新围栏清单剔除的旧 polygons 数量:', duplicateFencePolygonsRemoved);
        console.log('[管理端] 已转交围栏覆盖层渲染的报警区域数量:', alarmFencePolygons.length);
        console.log('[管理端] =====================================');

        console.log('[管理端] 数据加载成功:', {
            点数量: points.length,
            线数量: polylines.length,
            面数量: polygons.length
        });

        // 7. 使用 APIDataConverter 转换数据（与司机端相同）
        let features = [];
        if (window.APIDataConverter) {
            features = APIDataConverter.convert(points, polylines, polygons);
            console.log('[管理端] 转换后的features数量:', features.length);
        } else {
            console.warn('[管理端] APIDataConverter 不可用，使用简单显示');
            displayMapDataSimple(points, polylines, polygons);
            return;
        }

        // 8. 对线数据进行分割处理（与司机端相同）
        let processedFeatures = features;
        if (typeof processLineIntersections === 'function') {
            try {
                processedFeatures = processLineIntersections(features);
                console.log('[管理端] 线段分割完成，处理后features数量:', processedFeatures.length);
            } catch (e) {
                console.warn('[管理端] 线段分割失败，使用原始数据:', e);
                processedFeatures = features;
            }
        }

        // 8. 构建KML数据对象
        const kmlData = {
            features: processedFeatures,
            fileName: `${projectName} (API数据)`
        };

        // 9. 使用 displayKMLFeatures 显示地图数据（与司机端相同）
        if (processedFeatures.length > 0 && typeof displayKMLFeatures === 'function') {
            window.isFirstKMLImport = true;
            window.kmlData = kmlData;

            console.log('[管理端] 调用displayKMLFeatures显示地图数据');
            displayKMLFeatures(processedFeatures, kmlData.fileName);

            // 保存路线数据到全局变量（供车辆管理器使用）
            window.polylines = window.polylines || [];

            // 地图数据加载完成后，处理待选中的位置（如果有）
            if (typeof handlePendingSelectedLocation === 'function') {
                setTimeout(() => {
                    handlePendingSelectedLocation();
                }, 300);
            }

            // 初始化车辆管理器（延迟一点确保地图完全加载）
            setTimeout(async () => {
                if (typeof AdminVehicleManager !== 'undefined' && map) {
                    console.log('[管理端] 初始化车辆管理器');
                    AdminVehicleManager.init(map);
                }

                // 初始化围栏管理器
                if (typeof AdminFenceManager !== 'undefined' && map && projectId) {
                    console.log('[管理端] 初始化围栏管理器');
                    AdminFenceManager.init(map, projectId);
                }

                // 初始化报警 UI 管理器
                if (typeof AdminAlertManager !== 'undefined' && map) {
                    console.log('[管理端] 初始化报警管理器');
                    AdminAlertManager.init(map);
                }

                if (isAdminDataPageContext()) {
                    await ensureAdminDataUnifiedDisplay();
                }

                if (shouldUseUnifiedAdminRoadStatusSync()) {
                    console.log('[管理端] 通过 AdminRoadStatusSync 统一初始化道路状态...');
                    await window.AdminRoadStatusSync.init({
                        pollInterval: ROAD_STATUS_POLL_INTERVAL
                    });
                    console.log('[管理端] AdminRoadStatusSync 初始化完成');
                } else {
                    // 【修复】等待道路状态加载完成后再启动轮询，避免竞态条件
                    console.log('[管理端] 自动加载道路状态颜色...');
                    await autoLoadRoadStatus();
                    console.log('[管理端] 道路状态初始加载完成');

                    // 【修复】初始加载完成后再启动轮询
                    startRoadStatusPolling();

                    // 建立摄像头缓存（供 WebSocket traffic_status 消息使用）
                    buildCameraCache(projectId);
                }

                if (isAdminDataPageContext()) {
                    consumePendingAdminCameraSelection();
                }
            }, 500);
        } else {
            console.warn('[管理端] 无地图数据或displayKMLFeatures不可用');
        }

        // 10. 如果有项目中心，设置地图中心和缩放级别
        if (projectCenter && map) {
            console.log('[管理端] 设置地图中心为项目位置:', projectCenter);
            map.setCenter(projectCenter);
            map.setZoom(MapConfig.mapConfig.zoom);
        }

    } catch (error) {
        console.error('[管理端] 加载地图数据失败:', error);
    }
}

// 简单显示数据（备用方案，当 APIDataConverter 不可用时）
function displayMapDataSimple(points, polylines, polygons) {
    if (!map) return;

    // 初始化全局 polylines 数组
    window.polylines = window.polylines || [];

    // 显示点
    points.forEach(point => {
        try {
            const lng = parseFloat(point.longitude);
            const lat = parseFloat(point.latitude);
            if (isNaN(lng) || isNaN(lat)) return;

            const pointName = (point.point_name || point.name || '').toLowerCase();
            if (pointName.includes('new_point') || pointName.includes('new point')) return;

            const marker = new AMap.Marker({
                position: [lng, lat],
                title: point.point_name || point.name || ''
            });
            marker.setMap(map);
        } catch (e) {
            console.warn('创建点标记失败:', e);
        }
    });

    // 显示线
    polylines.forEach(line => {
        try {
            const coordsField = line.line_position || line.coordinates;
            if (!coordsField) return;

            const path = parseLineCoordinates(coordsField);
            if (!path || path.length < 2) return;

            const polyline = new AMap.Polyline({
                path: path,
                strokeColor: line.line_color || '#9AE59D',
                strokeWeight: parseInt(line.line_width) || 4
            });
            polyline.setMap(map);

            // 保存到全局数组（供车辆管理器使用）
            window.polylines.push(polyline);
        } catch (e) {
            console.warn('创建线失败:', e);
        }
    });

    // 普通地图面由 /polygons 返回；安全围栏改由 /fence-polygons 单独覆盖渲染
    polygons
        .filter(poly => !(typeof isSafetyFenceAreaType === 'function' && isSafetyFenceAreaType(poly.area_type)))
        .forEach(poly => {
        try {
            const coordsField = poly.pg_position || poly.coordinates;
            if (!coordsField) return;

            const path = parseLineCoordinates(coordsField);
            if (!path || path.length < 3) return;

            const fillColor = poly.pg_color || '#FFFFFF';
            const strokeColor = poly.pg_frame_color || 'transparent';
            const strokeWeight = poly.pg_frame_width !== undefined ? (parseInt(poly.pg_frame_width, 10) || 0) : 0;

            const polygon = new AMap.Polygon({
                path: path,
                fillColor: fillColor,
                fillOpacity: 1,
                strokeColor: strokeColor,
                strokeWeight: strokeWeight,
                strokeOpacity: (strokeColor === 'transparent' || strokeWeight <= 0) ? 0 : 1,
                zIndex: 10 + Math.max(0, parseInt(poly.z_index, 10) || 0)
            });
            polygon.setMap(map);
        } catch (e) {
            console.warn('创建面失败:', e);
        }
    });

    if (typeof loadAndRenderSafetyFenceOverlays === 'function') {
        loadAndRenderSafetyFenceOverlays();
    }

    console.log('[管理端] 简单模式地图数据显示完成');
}

// 解析线/面坐标（支持 "lng,lat;lng,lat;..." 格式）- 备用
function parseLineCoordinates(coordsField) {
    if (!coordsField) return null;

    try {
        if (typeof coordsField === 'string') {
            const trimmed = coordsField.trim();
            if (trimmed.includes(';')) {
                return trimmed.split(';')
                    .filter(p => p.trim())
                    .map(point => {
                        const [lng, lat] = point.split(',').map(Number);
                        return [lng, lat];
                    })
                    .filter(p => !isNaN(p[0]) && !isNaN(p[1]));
            } else if (trimmed.startsWith('[')) {
                return JSON.parse(trimmed);
            }
        } else if (Array.isArray(coordsField)) {
            return coordsField;
        }
    } catch (e) {
        console.warn('坐标解析失败:', e);
    }
    return null;
}

// 初始化事件监听
function initEventListeners() {
    const searchInput = document.getElementById('search-input');
    const searchBox = document.querySelector('.search-box');
    const detailCloseBtn = document.getElementById('admin-vehicle-detail-close');

    // 底部导航切换
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', function() {
            const page = this.dataset.page;
            handleNavigation(page);
        });
    });
    
    // 筛选项点击
    const filterItems = document.querySelectorAll('.filter-item');
    filterItems.forEach(item => {
        item.addEventListener('click', function() {
            const filterType = this.querySelector('span').textContent;
            console.log('筛选:', filterType);

            // 如果是车辆筛选，切换车辆图例显示
            if (filterType === '车辆') {
                if (typeof AdminVehicleManager !== 'undefined') {
                    AdminVehicleManager.toggleVehicleLegend();
                }
            }
            // TODO: 实现任务类型和任务状态筛选功能
        });
    });

    if (isAdminDataPageContext() && (searchInput || searchBox)) {
        const openAdminDeviceSearch = function() {
            sessionStorage.setItem('searchReferrer', 'admin_data.html');
            window.location.href = ADMIN_DEVICE_SEARCH_PAGE;
        };

        if (searchInput) {
            searchInput.addEventListener('click', openAdminDeviceSearch);
        }

        if (searchBox) {
            searchBox.addEventListener('click', function(event) {
                if (event.target === searchInput) return;
                openAdminDeviceSearch();
            });
        }
    }

    if (detailCloseBtn) {
        detailCloseBtn.addEventListener('click', function() {
            hideAdminVehicleDetailSheet();
        });
    }

    const detailSheet = document.getElementById('admin-vehicle-detail-sheet');
    if (detailSheet) {
        detailSheet.addEventListener('click', function(e) {
            if (e.target === detailSheet) {
                hideAdminVehicleDetailSheet();
            }
        });
    }
    
    // 右侧控制按钮
    const locateBtn = document.getElementById('locate-btn');
    const cameraBtn = document.getElementById('camera-btn');
    const vehicleToggleBtn = document.getElementById('vehicle-toggle-btn');
    const switchProjectBtn = document.getElementById('switch-project-btn');
    const vehicleLegend = document.getElementById('vehicle-legend');

    // 定位按钮 - 定位到当前位置
    if (locateBtn) {
        locateBtn.addEventListener('click', function() {
            console.log('[定位] 开始获取当前位置...');
            locateToCurrentPosition();
        });
    }

    // 摄像头按钮（旧版）
    if (cameraBtn) {
        cameraBtn.addEventListener('click', function() {
            console.log('[摄像头] 切换摄像头图层显示');
            toggleCameraLayer();
        });
    }

    if (isAdminDataPageContext() && vehicleLegend) {
        vehicleLegend.style.display = 'flex';
    }

    // 切换项目按钮 - 已移除，功能转移至管理员"我的"页面

    // 车辆切换按钮 - 已移到 admin-vehicle-manager.js 中处理
    // 相关逻辑在车辆管理器模块中统一管理

    // 底部卡片展开/收起
    const bottomCard = document.getElementById('bottom-card');
    const cardHandle = document.getElementById('card-handle');
    const mapControls = document.querySelector('.admin-map-controls');
    
    if (cardHandle && bottomCard) {
        cardHandle.addEventListener('click', function() {
            bottomCard.classList.toggle('expanded');
            
            // 卡片展开时，右侧按钮和车辆图例上移
            if (bottomCard.classList.contains('expanded')) {
                if (mapControls) mapControls.classList.add('card-expanded');
                if (vehicleLegend) vehicleLegend.classList.add('card-expanded');
            } else {
                if (mapControls) mapControls.classList.remove('card-expanded');
                if (vehicleLegend) vehicleLegend.classList.remove('card-expanded');
            }
        });
    }
    
    // 起点终点输入框点击 - 跳转到点位选择页面
    const startLocation = document.getElementById('start-location');
    const endLocation = document.getElementById('end-location');
    
    if (startLocation) {
        startLocation.addEventListener('click', function() {
            sessionStorage.setItem('selectingPointType', 'start');
            sessionStorage.setItem('navigationReferrer', 'admin_index.html');
            window.location.href = 'point-selection.html';
        });
    }

    if (endLocation) {
        endLocation.addEventListener('click', function() {
            sessionStorage.setItem('selectingPointType', 'end');
            sessionStorage.setItem('navigationReferrer', 'admin_index.html');
            window.location.href = 'point-selection.html';
        });
    }
    
    // 添加途径点按钮
    const addWaypointBtn = document.getElementById('add-waypoint-btn');
    if (addWaypointBtn) {
        addWaypointBtn.addEventListener('click', function() {
            console.log('添加途径点功能待实现');
            // TODO: 实现添加途径点功能
        });
    }
}

// 处理导航切换
function handleNavigation(page) {
    console.log('导航到:', page);
    
    // 根据不同页面跳转
    switch(page) {
        case 'admin-navigation':
            // 判断当前在哪个页面
            if (window.location.pathname.includes('admin_index.html') ||
                (window.location.pathname.endsWith('/') && !window.location.pathname.includes('admin_data'))) {
                // 当前就是导航页面
            } else {
                window.location.href = 'admin_index.html';
            }
            break;
        case 'admin-data':
            // 跳转到工地监控页面
            if (window.location.pathname.includes('admin_data.html')) {
                // 当前就是工地监控页面
            } else {
                window.location.href = 'admin_data.html';
            }
            break;
        case 'admin-transport':
            window.location.href = 'admin_transport.html';
            break;
        case 'admin-profile':
            window.location.href = 'admin_profile.html';
            break;
    }
}

// ==================== 摄像头功能相关函数 ====================

/**
 * 切换摄像头图层显示
 */
async function toggleCameraLayer() {
    if (isCameraLayerVisible) {
        // 隐藏摄像头图层
        hideCameraLayer();
    } else {
        // 显示摄像头图层
        await showCameraLayer();
    }
}

/**
 * 显示摄像头图层
 */
function getCameraDebugSummary(camera) {
    if (!camera || typeof camera !== 'object') {
        return camera;
    }

    return {
        id: camera.id,
        camera_id: camera.camera_id || camera.CameraId || '',
        camera_name: camera.camera_name || camera.name || '',
        project_id: camera.project_id || camera.projectId || '',
        point_id: camera.point_id,
        pointId: camera.pointId,
        install_location: camera.install_location,
        camera_type: camera.camera_type,
        start_id: camera.start_id,
        end_id: camera.end_id,
        c_point: camera.c_point,
        status: camera.status,
        has_video_stream: !!(camera.video_stream_url || camera.url),
        video_stream_url: camera.video_stream_url || camera.url || '',
        keys: Object.keys(camera)
    };
}

function logCameraApiDiagnostics(projectId, cameras, responseMeta) {
    const list = Array.isArray(cameras) ? cameras : [];
    const missingPointId = [];
    const matchedPointField = [];
    const hasVideoStream = [];

    list.forEach(camera => {
        const summary = getCameraDebugSummary(camera);
        if (summary.point_id || summary.pointId) {
            matchedPointField.push(summary);
        } else {
            missingPointId.push(summary);
        }
        if (summary.has_video_stream) {
            hasVideoStream.push(summary);
        }
    });

    console.groupCollapsed(`[摄像头诊断] project=${projectId} cameras接口诊断`);
    console.log('[摄像头诊断] 接口元信息:', responseMeta || {});
    console.log('[摄像头诊断] 摄像头总数:', list.length);
    console.log('[摄像头诊断] 带 point_id/pointId 数量:', matchedPointField.length);
    console.log('[摄像头诊断] 缺少 point_id/pointId 数量:', missingPointId.length);
    console.log('[摄像头诊断] 带视频流数量:', hasVideoStream.length);
    if (list.length > 0) {
        console.log('[摄像头诊断] 第一条记录字段名:', Object.keys(list[0]));
        console.log('[摄像头诊断] 前3条记录摘要:', list.slice(0, 3).map(getCameraDebugSummary));
    }
    if (missingPointId.length > 0) {
        console.warn('[摄像头诊断] 缺少 point_id 的摄像头摘要（前10条）:', missingPointId.slice(0, 10));
        console.warn('[摄像头诊断] 这通常表示数据库未绑定地图点位，或接口未返回 point_id 字段');
    }
    console.groupEnd();
}

function getCameraBusinessId(record) {
    if (!record || typeof record !== 'object') return '';
    return record.camera_id || record.CameraId || '';
}

function getEffectiveCameraPointId(record) {
    if (!record || typeof record !== 'object') return null;
    return record.point_id || record.pointId || null;
}

function buildMergedCameraBindings(projectId, roadlines, cameras) {
    const roadlineList = Array.isArray(roadlines) ? roadlines : [];
    const cameraList = Array.isArray(cameras) ? cameras : [];
    const roadlineByCameraId = new Map();
    const merged = [];
    const seenCameraKeys = new Set();
    const diagnostics = {
        projectId,
        roadlineCount: roadlineList.length,
        cameraCount: cameraList.length,
        roadlinesWithCameraId: 0,
        mergedCount: 0,
        roadlineOnlyCount: 0,
        cameraOnlyCount: 0,
        usedRoadlinePointIdCount: 0,
        usedCameraPointIdFallbackCount: 0,
        missingPointIdCount: 0,
        conflictPointIdCount: 0,
        duplicateRoadlineCameraIds: []
    };

    roadlineList.forEach((roadline, index) => {
        const cameraId = getCameraBusinessId(roadline);
        if (!cameraId) return;
        diagnostics.roadlinesWithCameraId++;

        const existing = roadlineByCameraId.get(cameraId);
        if (!existing) {
            roadlineByCameraId.set(cameraId, roadline);
            return;
        }

        diagnostics.duplicateRoadlineCameraIds.push({
            cameraId,
            keptRoadlineId: existing.id,
            skippedRoadlineId: roadline.id,
            keptPointId: getEffectiveCameraPointId(existing),
            skippedPointId: getEffectiveCameraPointId(roadline),
            keptIndex: existing.__sourceIndex,
            skippedIndex: index
        });

        const existingPointId = getEffectiveCameraPointId(existing);
        const currentPointId = getEffectiveCameraPointId(roadline);
        if (!existingPointId && currentPointId) {
            roadlineByCameraId.set(cameraId, roadline);
        }
    });

    cameraList.forEach(camera => {
        const cameraId = getCameraBusinessId(camera);
        const roadline = cameraId ? roadlineByCameraId.get(cameraId) : null;
        const roadlinePointId = getEffectiveCameraPointId(roadline);
        const cameraPointId = getEffectiveCameraPointId(camera);
        const mergedPointId = roadlinePointId || cameraPointId || null;

        if (roadlinePointId && cameraPointId && String(roadlinePointId) !== String(cameraPointId)) {
            diagnostics.conflictPointIdCount++;
            console.warn('[摄像头绑定] roadline.point_id 与 camera.point_id 不一致，按 roadline 优先:', {
                projectId,
                cameraId,
                roadlineId: roadline && roadline.id,
                roadlinePointId,
                cameraPointId
            });
        }

        if (roadlinePointId) {
            diagnostics.usedRoadlinePointIdCount++;
        } else if (cameraPointId) {
            diagnostics.usedCameraPointIdFallbackCount++;
        } else {
            diagnostics.missingPointIdCount++;
        }

        const mergedCamera = Object.assign({}, roadline || {}, camera, {
            project_id: projectId,
            camera_id: cameraId || getCameraBusinessId(roadline),
            point_id: mergedPointId,
            pointId: mergedPointId,
            line_id: (roadline && roadline.line_id) || camera.line_id || camera.lineId || null,
            lineId: (roadline && roadline.line_id) || camera.line_id || camera.lineId || null,
            start_id: (roadline && roadline.start_id) || camera.start_id || camera.StartId || null,
            end_id: (roadline && roadline.end_id) || camera.end_id || camera.EndId || null,
            c_point: (roadline && (roadline.c_point || roadline.CPoint)) || camera.c_point || camera.CPoint || null,
            _bindingSource: roadline ? 'roadline+camera' : 'camera-only',
            _roadlineId: roadline && roadline.id ? roadline.id : null
        });

        merged.push(mergedCamera);
        if (cameraId) {
            seenCameraKeys.add(cameraId);
        }
    });

    roadlineByCameraId.forEach((roadline, cameraId) => {
        if (!cameraId || seenCameraKeys.has(cameraId)) return;

        const pointId = getEffectiveCameraPointId(roadline);
        if (pointId) {
            diagnostics.usedRoadlinePointIdCount++;
        } else {
            diagnostics.missingPointIdCount++;
        }

        merged.push(Object.assign({}, roadline, {
            project_id: projectId,
            camera_id: cameraId,
            point_id: pointId,
            pointId: pointId,
            _bindingSource: 'roadline-only',
            _roadlineId: roadline.id || null
        }));
        diagnostics.roadlineOnlyCount++;
        seenCameraKeys.add(cameraId);
    });

    diagnostics.cameraOnlyCount = merged.filter(item => item._bindingSource === 'camera-only').length;
    diagnostics.mergedCount = merged.length;

    console.groupCollapsed(`[摄像头绑定] project=${projectId} roadline+cameras 合并结果`);
    console.log('[摄像头绑定] 合并统计:', diagnostics);
    if (diagnostics.duplicateRoadlineCameraIds.length > 0) {
        console.warn('[摄像头绑定] 发现重复 camera_id 的 roadline（前10条）:', diagnostics.duplicateRoadlineCameraIds.slice(0, 10));
    }
    console.log('[摄像头绑定] 前10条合并结果摘要:', merged.slice(0, 10).map(item => ({
        camera_id: item.camera_id,
        point_id: item.point_id,
        start_id: item.start_id,
        end_id: item.end_id,
        line_id: item.line_id,
        camera_name: item.camera_name,
        has_video_stream: !!(item.video_stream_url || item.url),
        bindingSource: item._bindingSource
    })));
    console.groupEnd();

    return merged;
}

async function fetchMergedCameraBindings(projectId) {
    const [roadlines, cameras] = await Promise.all([
        fetchRoadlines(projectId),
        fetchCameras(projectId)
    ]);

    const boundRoadlines = Array.isArray(roadlines)
        ? roadlines.filter(item => getCameraBusinessId(item))
        : [];

    console.log('[摄像头绑定] 原始数据统计:', {
        projectId,
        roadlines: Array.isArray(roadlines) ? roadlines.length : 0,
        boundRoadlines: boundRoadlines.length,
        cameras: Array.isArray(cameras) ? cameras.length : 0
    });

    return buildMergedCameraBindings(projectId, boundRoadlines, cameras);
}

async function showCameraLayer() {
    try {
        console.log('[摄像头] 开始显示摄像头图层');

        // 获取当前项目ID
        const projectId = getCurrentProjectId();
        if (!projectId) {
            alert('请先选择项目');
            return;
        }

        console.log('[摄像头] 当前项目ID:', projectId);
        console.log('[摄像头] 当前地图点位数量:', Array.isArray(mapPoints) ? mapPoints.length : 0);
        console.log('[摄像头] 当前已存在摄像头标记数量:', Array.isArray(cameraMarkers) ? cameraMarkers.length : 0);

        // 获取 roadline 绑定关系 + 摄像头详情的合并结果
        const cameras = await fetchMergedCameraBindings(projectId);
        if (!cameras || cameras.length === 0) {
            console.warn('[摄像头] 该项目暂无摄像头数据');
            return;
        }

        console.log('[摄像头] 获取到摄像头数量:', cameras.length);
        logCameraApiDiagnostics(projectId, cameras, { source: 'showCameraLayer' });

        // 保存摄像头数据到全局变量
        window.camerasData = cameras;

        // 在地图上显示摄像头
        await displayCamerasOnMap(cameras);

        isCameraLayerVisible = true;

        // 设置按钮为选中状态
        const cameraBtn = document.getElementById('camera-btn');
        if (cameraBtn) {
            cameraBtn.classList.add('active');
        }

        // 自动更新所有摄像头控制的路段颜色（改为从 roadlines 接口获取 ai_road_status）
        console.log('[摄像头] 开始自动更新所有路段颜色...');
        await autoLoadRoadStatus();
        console.log('[摄像头] 所有路段颜色更新完成');

        // 监听地图缩放事件，统一做显隐控制（不重建标记，保持固定像素大小）
        if (!window.cameraZoomListener) {
            window.cameraZoomListener = function() {
                if (isCameraLayerVisible) {
                    applyCameraMarkerVisibilityByZoom();
                }
            };
            map.on('zoomend', window.cameraZoomListener);
        }

        console.log('[摄像头] 摄像头图层显示完成');

    } catch (error) {
        console.error('[摄像头] 显示摄像头图层失败:', error);
    }
}

/**
 * 隐藏摄像头图层
 */
function hideCameraLayer() {
    console.log('[摄像头] 隐藏摄像头图层');

    // 移除所有摄像头标记
    cameraMarkers.forEach(marker => {
        if (marker) {
            marker.setMap(null);
        }
    });

    cameraMarkers = [];
    isCameraLayerVisible = false;

    // 移除按钮选中状态
    const cameraBtn = document.getElementById('camera-btn');
    if (cameraBtn) {
        cameraBtn.classList.remove('active');
    }

    console.log('[摄像头] 摄像头图层已隐藏');
}

/**
 * 启动道路状态定时轮询
 * 与司机端导航保持相同频率（3秒），感知编辑器修改和 AI 摄像头状态变化
 */
function startRoadStatusPolling() {
    if (roadStatusPollTimer) {
        clearInterval(roadStatusPollTimer);
    }
    roadStatusPollTimer = setInterval(async () => {
        await autoLoadRoadStatus();
    }, ROAD_STATUS_POLL_INTERVAL);
    console.log(`[道路状态轮询] 已启动，间隔 ${ROAD_STATUS_POLL_INTERVAL / 1000} 秒`);
}

/**
 * 停止道路状态轮询
 */
function stopRoadStatusPolling() {
    if (roadStatusPollTimer) {
        clearInterval(roadStatusPollTimer);
        roadStatusPollTimer = null;
        console.log('[道路状态轮询] 已停止');
    }
}

/**
 * 建立摄像头 ID 缓存
 * key: camera_id（业务ID字符串，与 WebSocket traffic_status 消息中的 camera 字段对应）
 * value: 完整摄像头对象（含 start_id、end_id）
 * @param {string} projectId - 项目ID
 */
async function buildCameraCache(projectId) {
    try {
        const cameras = Array.isArray(window.camerasData) && window.camerasData.length > 0
            ? window.camerasData
            : await fetchMergedCameraBindings(projectId);
        window.cameraIdMap = {};
        if (cameras && cameras.length > 0) {
            cameras.forEach(cam => {
                // camera_id 是业务ID（varchar），与 WS 消息中的 camera 字段对应
                // id 是主键（integer），用于调用 GET /cameras/{id}
                const key = cam.camera_id || cam.CameraId;
                if (key) {
                    window.cameraIdMap[key] = cam;
                }
            });
        }
        console.log('[摄像头缓存] 已建立，共', Object.keys(window.cameraIdMap).length, '个摄像头');
    } catch (e) {
        console.warn('[摄像头缓存] 建立失败:', e);
        window.cameraIdMap = {};
    }
}

/**
 * 添加路况状态图标（拥堵/阻断）
 * @param {number} startId - 路段起点ID
 * @param {number} endId - 路段终点ID
 * @param {Array} midCoord - 图标放置坐标 [lng, lat]
 * @param {number} status - 路况状态
 */
function addBlockedMarker(startId, endId, midCoord, status) {
    console.log('[路况图标] addBlockedMarker 被调用, map:', !!map, 'midCoord:', midCoord, 'status:', status);
    if (!map || !midCoord) {
        console.warn('[路况图标] 无法添加图标：map 或 midCoord 为空', { map: !!map, midCoord, status });
        return;
    }
    const key = `${startId}_${endId}`;
    // 先移除旧的（避免重复）
    removeBlockedMarker(startId, endId);

    const iconPath = getRoadStatusIconPath(status);
    if (!iconPath) {
        console.warn('[路况图标] 当前状态无需显示图标:', status);
        return;
    }
    
    try {
        // 注意：content 里不能用模板字符串嵌套，onerror 属性用单引号包裹函数体
        const imgContent = '<img src="' + iconPath + '" style="width:18px;height:18px;display:block;" alt="路况" onerror="this.style.display=\'none\';console.error(\'[路况图标] 图片加载失败\')" />';
        const marker = new AMap.Marker({
            position: midCoord,
            content: imgContent,
            offset: new AMap.Pixel(-9, -9),
            zIndex: 150,
            map: map
        });
        blockedRoadMarkers.set(key, marker);
        console.log(`[路况图标] ✓ 已添加: ${key}, 状态=${status}, 坐标:`, midCoord, '当前图标总数:', blockedRoadMarkers.size);
    } catch (e) {
        console.error('[路况图标] ✗ 创建 Marker 失败:', e);
    }
}

/**
 * 移除路况状态图标
 * @param {number} startId - 路段起点ID
 * @param {number} endId - 路段终点ID
 */
function removeBlockedMarker(startId, endId) {
    const key = `${startId}_${endId}`;
    if (blockedRoadMarkers.has(key)) {
        if (map) map.remove(blockedRoadMarkers.get(key));
        blockedRoadMarkers.delete(key);
        console.log(`[路况图标] 已移除: ${key}`);
    }
}

/**
 * 监听 WebSocket traffic_status 推送的道路状态变化
 * 通过摄像头缓存反查路段信息，实时更新道路颜色
 */
window.addEventListener('trafficStatusChange', async function(e) {
    if (shouldUseUnifiedAdminRoadStatusSync()) {
        return;
    }

    const { cameraId, evaluation, projectId: messageProjectId } = e.detail;

    if (!cameraId || !evaluation) return;

    const currentProjectId = getCurrentProjectId();
    if (currentProjectId && messageProjectId &&
        String(currentProjectId) !== String(messageProjectId)) {
        console.log('[道路状态WS] 忽略非当前项目消息:', {
            currentProjectId,
            messageProjectId,
            cameraId
        });
        return;
    }

    // 查摄像头缓存
    let cam = window.cameraIdMap && window.cameraIdMap[cameraId];

    // 缓存未命中，重新拉取摄像头列表
    if (!cam) {
        console.warn('[道路状态WS] 摄像头缓存未命中，重新拉取:', cameraId);
        const projectId = messageProjectId || currentProjectId;
        if (projectId) {
            await buildCameraCache(projectId);
            cam = window.cameraIdMap && window.cameraIdMap[cameraId];
        }
    }

    if (!cam) {
        console.warn('[道路状态WS] 找不到摄像头:', cameraId);
        return;
    }

    // 从摄像头数据中取路段信息
    const startId = cam.start_id || cam.StartId;
    const endId   = cam.end_id   || cam.EndId;

    if (!startId || !endId) {
        console.warn('[道路状态WS] 摄像头缺少路段信息 start_id/end_id:', cam);
        return;
    }

    // evaluation 文字 → ai_road_status 数字
    const aiRoadStatus = EVALUATION_STATUS_MAP[evaluation];
    if (aiRoadStatus === undefined) {
        console.warn('[道路状态WS] 未知 evaluation 值:', evaluation,
            '（待后端确认枚举，当前已知: free/slow/congested/blocked 或 畅通/缓行/拥堵/阻断）');
        return;
    }

    console.log(`[道路状态WS] 实时更新: camera=${cameraId}, evaluation=${evaluation}, status=${aiRoadStatus}, 路段=${startId}->${endId}`);

    await updateRoadSegmentStatus(startId, endId, aiRoadStatus);

    // 重构 KML 图，确保阻断路段不参与路线规划
    if (typeof buildKMLGraph === 'function') {
        buildKMLGraph();
    }
});

/**
 * 自动加载并显示道路状态颜色（不显示摄像头标记）
 * 数据来源：GET /api/video/roadlines?project_id={id}，使用 ai_road_status 字段
 */
async function autoLoadRoadStatus() {
    try {
        // 【修复】只在折线数量变化时清空道路图缓存，避免每次轮询都重建图结构
        const currentPolylineCount = window.polylines ? window.polylines.length : 0;
        if (window._lastPolylineCount === undefined) {
            window._lastPolylineCount = currentPolylineCount;
            window.roadGraph = null; // 首次加载时清空
        } else if (currentPolylineCount !== window._lastPolylineCount) {
            console.log('[道路状态] 检测到折线数量变化（旧:', window._lastPolylineCount, '新:', currentPolylineCount, '），清空道路图缓存');
            window.roadGraph = null;
            window._lastPolylineCount = currentPolylineCount;
        }

        console.log('[道路状态] ========== 开始自动加载道路状态 ==========');

        const projectId = getCurrentProjectId();
        if (!projectId) {
            console.warn('[道路状态] 未找到项目ID，无法加载道路状态');
            return;
        }

        console.log('[道路状态] 当前项目ID:', projectId);

        // 从 roadlines 接口获取路段控制数据（含 ai_road_status）
        const roadlines = await fetchRoadlines(projectId);
        if (!roadlines || roadlines.length === 0) {
            console.warn('[道路状态] 该项目暂无路段控制数据，无法更新道路状态');
            return;
        }

        console.log('[道路状态] 获取到路段控制数据:', roadlines.length, '条');

        // 对比缓存，只更新有变化的路段（避免全量重绘）
        let updatedCount = 0;
        let hasChange = false;
        for (const roadline of roadlines) {
            if (!roadline.start_id || !roadline.end_id) continue;

            const cacheKey = `${roadline.start_id}_${roadline.end_id}`;
            // 注意：不能用 || 0，因为 parseInt(null)||0 会把阻断(3)误判为畅通(0)
            // 用 isNaN 兜底，确保 null/undefined/非数字 才回退到 0
            const parsed = parseInt(roadline.ai_road_status);
            const newStatus = isNaN(parsed) ? 0 : parsed;
            const oldStatus = roadStatusCache.get(cacheKey);

            // 首次加载（缓存为空）或状态有变化时才更新
            if (oldStatus === undefined || oldStatus !== newStatus) {
                // 传入 line_id 和 c_point，优先通过 line_id 直接定位折线
                // c_point 字段名兼容 snake_case 和大驼峰两种格式
                await updateRoadSegmentStatus(
                    roadline.start_id,
                    roadline.end_id,
                    roadline.ai_road_status,
                    roadline.line_id,
                    roadline.c_point || roadline.CPoint
                );
                updatedCount++;
                hasChange = true;
            }
        }

        if (updatedCount > 0) {
            console.log(`[道路状态] ✓ 路段颜色更新完成，共更新 ${updatedCount} 个路段`);
        } else {
            console.log('[道路状态] 所有路段状态无变化，跳过重绘');
        }

        // 有路段状态变化时，重新构建KML图，确保阻断道路不参与路线规划
        if (hasChange && typeof buildKMLGraph === 'function') {
            console.log('[道路状态] 重新构建KML图，排除阻断道路...');
            buildKMLGraph();
            console.log('[道路状态] ✓ KML图重新构建完成');
        }

        console.log('[道路状态] ========== 道路状态加载完成 ==========');

    } catch (error) {
        console.error('[道路状态] 自动加载道路状态失败:', error);
    }
}

/**
 * 获取路段控制列表（roadlines）
 * @param {string} projectId - 项目ID
 * @returns {Promise<Array>}
 */
async function fetchRoadlines(projectId) {
    try {
        const url = `https://dmap.cscec3bxjy.cn/api/video/roadlines?page=1&page_size=1000&project_id=${projectId}`;
        console.log('[路段控制] 请求URL:', url);

        const token = sessionStorage.getItem('authToken') || '';
        const headers = { 'accept': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const response = await fetch(url, { method: 'GET', headers });

        if (!response.ok) {
            console.warn('[路段控制] 请求失败，状态码:', response.status);
            return [];
        }

        const data = await response.json();
        console.log('[路段控制] API完整响应:', JSON.stringify(data, null, 2));

        // 兼容多种响应格式
        if (data.code === 200 && data.data) {
            const list = data.data.list || data.data.items || data.data;
            console.log('[路段控制] 解析到数据条数:', Array.isArray(list) ? list.length : '非数组:' + typeof list);
            if (Array.isArray(list) && list.length > 0) {
                console.log('[路段控制] 第一条记录字段名:', Object.keys(list[0]));
                console.log('[路段控制] 第一条记录完整数据:', list[0]);
            }
            return Array.isArray(list) ? list : [];
        }

        // 有些接口直接返回数组
        if (Array.isArray(data)) {
            console.log('[路段控制] 接口直接返回数组，条数:', data.length);
            if (data.length > 0) {
                console.log('[路段控制] 第一条记录字段名:', Object.keys(data[0]));
                console.log('[路段控制] 第一条记录完整数据:', data[0]);
            }
            return data;
        }

        console.warn('[路段控制] 未识别的响应格式，code:', data.code, 'data:', data.data);
        return [];
    } catch (error) {
        console.error('[路段控制] 获取失败:', error);
        return [];
    }
}

/**
 * 获取当前项目ID
 */
function getCurrentProjectId() {
    try {
        const projectSelection = sessionStorage.getItem('projectSelection');
        const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');

        if (projectSelection) {
            const selection = JSON.parse(projectSelection);
            const projectName = selection.project;

            // 从用户的项目列表中找到选择的项目
            const userProjects = currentUser.projects || [];

            // 优先使用 projectCode 精确匹配
            let selectedProject = null;
            if (selection.projectCode) {
                selectedProject = userProjects.find(p =>
                    (p.projectCode === selection.projectCode) || (p.id === selection.projectCode)
                );
            }

            // 如果projectCode匹配失败，回退到名称匹配
            if (!selectedProject) {
                selectedProject = userProjects.find(p => p.projectName === projectName);
            }

            if (selectedProject) {
                return selectedProject.projectCode || selectedProject.id;
            }
        }
    } catch (e) {
        console.error('[摄像头] 获取项目ID失败:', e);
    }
    return null;
}

/**
 * 获取摄像头列表
 * @param {string} projectId - 项目ID
 * @returns {Promise<Array>} 摄像头列表
 */
async function fetchCameras(projectId) {
    try {
        const url = `https://dmap.cscec3bxjy.cn/api/video/cameras?page=1&page_size=1000&project_id=${projectId}`;
        console.log('[摄像头] 请求URL:', url);

        const token = sessionStorage.getItem('authToken') || '';
        const headers = {
            'accept': 'application/json'
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(url, {
            method: 'GET',
            headers: headers
        });

        console.log('[摄像头] 接口响应状态:', {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            projectId: projectId
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('[摄像头] API响应:', data);

        if (data.code === 200 && data.data) {
            // 返回摄像头列表
            const list = data.data.list || data.data.items || data.data;
            logCameraApiDiagnostics(projectId, list, {
                source: 'fetchCameras',
                code: data.code,
                page: data.data.page,
                page_size: data.data.page_size,
                total: data.data.total
            });
            return list;
        }

        console.warn('[摄像头] cameras接口返回非200业务码或无data:', {
            projectId,
            code: data.code,
            message: data.message,
            data: data.data
        });
        return [];
    } catch (error) {
        console.error('[摄像头] 获取摄像头列表失败:', error);
        throw error;
    }
}

/**
 * 通过pointid获取点位的经纬度
 * @param {string} pointId - 点位ID
 * @returns {Object|null} {longitude, latitude}
 */
function getCameraPosition(pointId) {
    if (!pointId || !mapPoints || mapPoints.length === 0) {
        console.warn('[摄像头] 无法查询点位，pointId:', pointId, 'mapPoints:', mapPoints?.length);
        return null;
    }

    // 在地图点位数据中查找匹配的点
    const point = mapPoints.find(p =>
        p.point_id === pointId ||
        p.id === pointId ||
        p.Point_Id === pointId ||
        String(p.point_id) === String(pointId) ||
        String(p.id) === String(pointId)
    );

    if (point) {
        const lng = parseFloat(point.longitude);
        const lat = parseFloat(point.latitude);

        if (!isNaN(lng) && !isNaN(lat)) {
            console.log('[摄像头] 找到点位坐标:', pointId, '->', [lng, lat]);
            return { longitude: lng, latitude: lat };
        }
    }

    console.warn('[摄像头] 未找到点位:', pointId, '可用点位样本:', (mapPoints || []).slice(0, 10).map(p => ({
        id: p.id,
        point_id: p.point_id,
        Point_Id: p.Point_Id,
        point_name: p.point_name || p.name || ''
    })));
    return null;
}

/**
 * 在地图上显示摄像头标记
 * @param {Array} cameras - 摄像头列表
 */
async function displayCamerasOnMap(cameras) {
    if (!map) {
        console.error('[摄像头] 地图实例不存在');
        return;
    }

    ensureCameraMarkerStyles();
    console.log('[摄像头] 开始在地图上显示摄像头...');
    const displayStats = {
        total: Array.isArray(cameras) ? cameras.length : 0,
        success: 0,
        missingPointId: 0,
        missingPosition: 0,
        detailFetchUsed: 0,
        detailFetchResolvedName: 0,
        videoStreamCount: 0,
        aiCameraCount: 0
    };

    for (const camera of cameras) {
        try {
            const cameraSummary = getCameraDebugSummary(camera);
            console.log('[摄像头] 处理摄像头记录:', cameraSummary);

            // point_id 优先以 roadline 绑定为准，camera.point_id 兜底
            const pointId = getEffectiveCameraPointId(camera);
            if (!pointId) {
                displayStats.missingPointId++;
                console.warn('[摄像头] 摄像头缺少point_id，跳过显示:', {
                    id: camera.id,
                    name: camera.camera_name,
                    point_id: camera.point_id,
                    pointId: camera.pointId,
                    install_location: camera.install_location,
                    camera_id: camera.camera_id,
                    bindingSource: camera._bindingSource,
                    完整数据: camera
                });
                console.warn('[摄像头] 诊断结论: roadline.point_id 与 camera.point_id 均为空，通常是绑定关系未落库或接口未透出该字段');
                continue;
            }

            // 获取点位的经纬度
            const position = getCameraPosition(pointId);
            if (!position) {
                displayStats.missingPosition++;
                console.warn('[摄像头] 无法获取摄像头位置:', camera.id, 'pointId:', pointId);
                console.warn('[摄像头] 诊断结论: 摄像头有 point_id，但当前地图点库无法匹配，可能是地图版本不一致或绑定旧点位');
                continue;
            }

            // 获取摄像头详情（包含名称）
            let cameraName = camera.camera_name || camera.name || '未命名摄像头';

            // 如果没有名称，尝试获取详情
            if (!camera.camera_name && !camera.name) {
                displayStats.detailFetchUsed++;
                const details = await getCameraDetails(camera.id);
                if (details && details.camera_name) {
                    cameraName = details.camera_name;
                    displayStats.detailFetchResolvedName++;
                }
            }

            if (camera.camera_type === 1) {
                displayStats.aiCameraCount++;
            }
            if (camera.video_stream_url || camera.url) {
                displayStats.videoStreamCount++;
            }

            const markerPosition = [position.longitude, position.latitude];
            const viewAction = function() {
                showCameraInfo(camera.id, cameraName, camera);
            };

            const initialLayout = getCameraMarkerRuntimeLayout(map && map.getZoom ? map.getZoom() : getCameraMarkerMaxZoom());

            // AI 监控点位图标
            const monitorMarker = new AMap.Marker({
                position: markerPosition,
                content: createCameraMonitorPinContent(cameraName, initialLayout),
                offset: new AMap.Pixel(
                    -Math.round(initialLayout.markerWidth / 2),
                    -initialLayout.pinHeight
                ),
                extData: {
                    type: 'camera-monitor',
                    markerRole: 'pin',
                    cameraId: camera.id,
                    cameraName: cameraName,
                    pointId: pointId
                }
            });

            // 查看/播放卡片气泡
            const actionMarker = new AMap.Marker({
                position: markerPosition,
                content: createCameraViewBubbleContent(cameraName, initialLayout),
                offset: new AMap.Pixel(
                    -Math.round(initialLayout.bubbleWidth / 2),
                    -(initialLayout.pinHeight + initialLayout.bubbleGap + initialLayout.bubbleHeight)
                ),
                extData: {
                    type: 'camera-action',
                    markerRole: 'bubble',
                    cameraId: camera.id,
                    cameraName: cameraName,
                    pointId: pointId
                }
            });

            monitorMarker.on('click', viewAction);
            actionMarker.on('click', viewAction);

            monitorMarker.setMap(map);
            actionMarker.setMap(map);
            cameraMarkers.push(monitorMarker, actionMarker);
            displayStats.success++;

            console.log('[摄像头] 添加标记:', cameraName, 'at', [position.longitude, position.latitude]);

        } catch (error) {
            console.error('[摄像头] 创建摄像头标记失败:', error, camera);
        }
    }

    applyCameraMarkerVisibilityByZoom();
    window.lastCameraDisplayStats = displayStats;
    console.log('[摄像头] 显示统计:', displayStats);
    console.log('[摄像头] 共添加', cameraMarkers.length, '个摄像头标记');
}

function getCameraMarkerMaxZoom() {
    if (map && typeof map.getZooms === 'function') {
        const zoomRange = map.getZooms();
        if (Array.isArray(zoomRange) && zoomRange.length >= 2) {
            return Number(zoomRange[1]) || 20;
        }
    }
    return 20;
}

function getCameraMarkerScale(zoom) {
    const maxZoom = getCameraMarkerMaxZoom();
    const minZoom = CAMERA_MARKER_DISPLAY.pinMinZoom;
    if (zoom >= maxZoom) {
        return 1;
    }
    if (zoom <= minZoom) {
        return CAMERA_MARKER_LAYOUT.minScale;
    }

    const progress = (zoom - minZoom) / Math.max(maxZoom - minZoom, 1);
    return CAMERA_MARKER_LAYOUT.minScale + progress * (1 - CAMERA_MARKER_LAYOUT.minScale);
}

function getCameraMarkerRuntimeLayout(zoom) {
    const scale = getCameraMarkerScale(zoom);
    return {
        scale,
        pinWidth: Math.round(CAMERA_MARKER_LAYOUT.pinWidth * scale),
        pinHeight: Math.round(CAMERA_MARKER_LAYOUT.pinHeight * scale),
        markerWidth: Math.round(CAMERA_MARKER_LAYOUT.markerWidth * scale),
        markerHeight: Math.round(CAMERA_MARKER_LAYOUT.markerHeight * scale),
        labelTop: Math.round(CAMERA_MARKER_LAYOUT.labelTop * scale),
        labelMaxWidth: Math.round(CAMERA_MARKER_LAYOUT.labelMaxWidth * scale),
        labelFontSize: Math.max(9, Math.round(CAMERA_MARKER_LAYOUT.labelFontSize * scale)),
        labelLineHeight: Math.max(11, Math.round(CAMERA_MARKER_LAYOUT.labelLineHeight * scale)),
        bubbleWidth: Math.round(CAMERA_MARKER_LAYOUT.bubbleWidth * scale),
        bubbleHeight: Math.round(CAMERA_MARKER_LAYOUT.bubbleHeight * scale),
        bubbleRadius: Math.max(4, Math.round(CAMERA_MARKER_LAYOUT.bubbleRadius * scale)),
        bubbleFontSize: Math.max(9, Math.round(CAMERA_MARKER_LAYOUT.bubbleFontSize * scale)),
        bubbleIconSize: Math.max(9, Math.round(CAMERA_MARKER_LAYOUT.bubbleIconSize * scale)),
        bubbleGap: Math.round(CAMERA_MARKER_LAYOUT.bubbleGap * scale)
    };
}

function syncCameraMarkerByZoom(marker, zoom) {
    if (!marker) return;

    const extData = marker.getExtData ? (marker.getExtData() || {}) : {};
    const role = extData.markerRole;
    const shouldShow = role === 'bubble'
        ? zoom >= CAMERA_MARKER_DISPLAY.bubbleMinZoom
        : zoom >= CAMERA_MARKER_DISPLAY.pinMinZoom;

    if (!shouldShow) {
        marker.hide();
        return;
    }

    const layout = getCameraMarkerRuntimeLayout(zoom);
    const cameraName = extData.cameraName || '未命名摄像头';

    if (role === 'bubble') {
        marker.setContent(createCameraViewBubbleContent(cameraName, layout));
        marker.setOffset(new AMap.Pixel(
            -Math.round(layout.bubbleWidth / 2),
            -(layout.pinHeight + layout.bubbleGap + layout.bubbleHeight)
        ));
    } else {
        marker.setContent(createCameraMonitorPinContent(cameraName, layout));
        marker.setOffset(new AMap.Pixel(
            -Math.round(layout.markerWidth / 2),
            -layout.pinHeight
        ));
    }

    marker.show();
}

function applyCameraMarkerVisibilityByZoom() {
    if (!map || !Array.isArray(cameraMarkers) || cameraMarkers.length === 0) {
        return;
    }

    const zoom = map.getZoom ? map.getZoom() : 0;
    cameraMarkers.forEach(marker => syncCameraMarkerByZoom(marker, zoom));
}

function ensureCameraMarkerStyles() {
    if (document.getElementById('camera-marker-styles')) {
        return;
    }

    const style = document.createElement('style');
    style.id = 'camera-marker-styles';
    style.textContent = `
        .camera-marker-hit-area {
            cursor: pointer;
            user-select: none;
        }
    `;
    document.head.appendChild(style);
}

function createCameraMonitorPinContent(cameraName, layout) {
    const safeName = escapeHtml(cameraName || '监控点位');
    const runtimeLayout = layout || getCameraMarkerRuntimeLayout(map && map.getZoom ? map.getZoom() : getCameraMarkerMaxZoom());
    return `
        <div class="camera-marker-hit-area" title="${safeName}" style="
            position: relative;
            width: ${runtimeLayout.markerWidth}px;
            height: ${runtimeLayout.markerHeight}px;
            display: flex;
            align-items: flex-start;
            justify-content: center;
        ">
            <img src="${getAdminTransportImagePath(ADMIN_TRANSPORT_IMAGE_FILES.monitor)}" alt="${safeName}" style="
                position: absolute;
                top: 0;
                left: 50%;
                transform: translateX(-50%);
                width: ${runtimeLayout.pinWidth}px;
                height: ${runtimeLayout.pinHeight}px;
                display: block;
                object-fit: contain;
                filter: drop-shadow(0 3px 6px rgba(74, 61, 215, 0.18));
            ">
            <div style="
                position: absolute;
                top: ${runtimeLayout.labelTop}px;
                left: 50%;
                transform: translateX(-50%);
                width: ${runtimeLayout.labelMaxWidth}px;
                color: #6f5cff;
                font-size: ${runtimeLayout.labelFontSize}px;
                line-height: ${runtimeLayout.labelLineHeight}px;
                font-weight: 600;
                text-align: center;
                white-space: normal;
                word-break: break-all;
                overflow: visible;
                text-shadow:
                    -1px -1px 0 rgba(255, 255, 255, 0.95),
                    1px -1px 0 rgba(255, 255, 255, 0.95),
                    -1px 1px 0 rgba(255, 255, 255, 0.95),
                    1px 1px 0 rgba(255, 255, 255, 0.95);
            ">${safeName}</div>
        </div>
    `;
}

function createCameraViewBubbleContent(cameraName, layout) {
    const safeName = escapeHtml(cameraName || '查看监控');
    const runtimeLayout = layout || getCameraMarkerRuntimeLayout(map && map.getZoom ? map.getZoom() : getCameraMarkerMaxZoom());
    const bubblePaddingX = Math.max(5, Math.round(runtimeLayout.bubbleWidth * 0.12));
    const bubbleGap = Math.max(3, Math.round(runtimeLayout.bubbleWidth * 0.05));
    return `
        <div class="camera-marker-hit-area" title="查看 ${safeName}" style="
            width: ${runtimeLayout.bubbleWidth}px;
            height: ${runtimeLayout.bubbleHeight}px;
            padding: 0 ${bubblePaddingX}px;
            box-sizing: border-box;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: ${bubbleGap}px;
            border-radius: ${runtimeLayout.bubbleRadius}px;
            background: rgba(255, 255, 255, 0.98);
            border: 2px solid #6f5cff;
            box-shadow: 0 3px 8px rgba(111, 92, 255, 0.14);
            color: #6f5cff;
            font-size: ${runtimeLayout.bubbleFontSize}px;
            font-weight: 700;
            line-height: 1;
            white-space: nowrap;
        ">
            <span style="transform: translateY(-0.5px);">查看</span>
            <img src="${getAdminTransportImagePath(ADMIN_TRANSPORT_IMAGE_FILES.play)}" alt="播放" style="
                width: ${runtimeLayout.bubbleIconSize}px;
                height: ${runtimeLayout.bubbleIconSize}px;
                display: block;
                object-fit: contain;
            ">
        </div>
    `;
}

/**
 * 获取摄像头详情
 * @param {string} cameraId - 摄像头ID
 * @returns {Promise<Object|null>} 摄像头详情
 */
async function getCameraDetails(cameraId) {
    try {
        const url = `https://dmap.cscec3bxjy.cn/api/video/cameras/${cameraId}`;
        console.log('[摄像头] 获取详情URL:', url);

        const token = sessionStorage.getItem('authToken') || '';
        const headers = {
            'accept': 'application/json'
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(url, {
            method: 'GET',
            headers: headers
        });

        console.log('[摄像头] 详情接口响应状态:', {
            cameraId,
            ok: response.ok,
            status: response.status,
            statusText: response.statusText
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('[摄像头] 详情接口响应数据:', data);

        if (data.code === 200 && data.data) {
            console.log('[摄像头] 详情接口字段名:', Object.keys(data.data));
            return data.data;
        }

        return null;
    } catch (error) {
        console.error('[摄像头] 获取摄像头详情失败:', error);
        return null;
    }
}

/**
 * 显示摄像头信息窗口
 * @param {string} cameraId - 摄像头ID
 * @param {string} cameraName - 摄像头名称
 * @param {Object} cameraData - 摄像头数据（包含start_id, end_id, c_point）
 */
async function showCameraInfo(cameraId, cameraName, cameraData) {
    console.log('[摄像头] ========== 点击摄像头 ==========');
    console.log('[摄像头] cameraId:', cameraId);
    console.log('[摄像头] cameraName:', cameraName);
    console.log('[摄像头] cameraData 完整数据:', cameraData);
    console.log('[摄像头] start_id:', cameraData.start_id);
    console.log('[摄像头] end_id:', cameraData.end_id);
    console.log('[摄像头] c_point:', cameraData.c_point);

    try {
        // 处理路段状态：从 roadlines 接口获取该摄像头对应路段的 ai_road_status
        if (cameraData.start_id && cameraData.end_id) {
            console.log('[摄像头] ✓ 摄像头有路段控制数据，开始更新路段状态...');
            // 通过 roadlines 接口查找该摄像头绑定的路段状态
            const projectId = getCurrentProjectId();
            if (projectId) {
                const roadlines = await fetchRoadlines(projectId);
                const matched = roadlines.find(r =>
                    String(r.start_id) === String(cameraData.start_id) &&
                    String(r.end_id) === String(cameraData.end_id)
                );
                if (matched) {
                    await updateRoadSegmentStatus(
                        matched.start_id,
                        matched.end_id,
                        matched.ai_road_status,
                        matched.line_id,
                        (matched.c_point > 0 ? matched.c_point : null) || (matched.CPoint > 0 ? matched.CPoint : null)
                    );
                } else {
                    console.warn('[摄像头] 未在 roadlines 中找到匹配路段，跳过颜色更新');
                }
            }
        } else {
            console.warn('[摄像头] ✗ 摄像头缺少路段控制数据，跳过路段状态更新');
        }

        // 获取视频流URL
        const videoUrl = cameraData.video_stream_url || cameraData.url || '暂无视频流';
        console.log('[摄像头] 视频流检查:', {
            cameraId,
            cameraName,
            point_id: cameraData.point_id,
            pointId: cameraData.pointId,
            hasVideoStream: videoUrl !== '暂无视频流',
            video_stream_url: cameraData.video_stream_url,
            url: cameraData.url
        });

        if (videoUrl !== '暂无视频流') {
            // 显示内嵌视频播放器弹窗
            showVideoPlayer(cameraName, videoUrl, cameraId, cameraData);
        } else {
            // 无视频流时显示信息窗口
            const infoContent = `
                <div style="padding: 10px; min-width: 200px;">
                    <h3 style="margin: 0 0 10px 0; color: #333;">${cameraName}</h3>
                    <p style="margin: 5px 0;"><strong>摄像头ID:</strong> ${cameraId}</p>
                    <p style="margin: 5px 0;"><strong>类型:</strong> ${cameraData.camera_type === 1 ? 'AI识别' : '普通'}</p>
                    <p style="margin: 5px 0; color: #999;">暂无视频流</p>
                </div>
            `;

            // 创建信息窗口
            const infoWindow = new AMap.InfoWindow({
                content: infoContent,
                offset: new AMap.Pixel(0, -30)
            });

            const marker = cameraMarkers.find(m => m.getExtData().cameraId === cameraId);
            if (marker) {
                infoWindow.open(map, marker.getPosition());
            }
        }

        console.log('[摄像头] 视频流URL:', videoUrl);

    } catch (error) {
        console.error('[摄像头] 显示摄像头信息失败:', error);
        alert('显示摄像头信息失败');
    }
}

/**
 * 获取最佳播放URL
 * 该ZLMediaKit服务器的.live.mp4可被Chrome/Edge原生播放，优先使用
 * @param {string} url - 原始视频流URL
 * @returns {string} 用于播放的URL
 */
function convertToHlsUrl(url) {
    // .live.flv → .live.mp4（Chrome可原生播放）
    if (url.includes('.live.flv')) {
        return url.replace('.live.flv', '.live.mp4');
    }
    // .live.m3u8 → .live.mp4
    if (url.includes('.live.m3u8')) {
        return url.replace('.live.m3u8', '.live.mp4');
    }
    // .flv → .mp4
    if (url.includes('.flv')) {
        return url.replace('.flv', '.mp4');
    }
    // .m3u8 → .mp4
    if (url.includes('.m3u8')) {
        return url.replace('.m3u8', '.mp4');
    }
    // 已经是.mp4或其他，直接返回
    return url;
}

/**
 * 显示内嵌视频播放器弹窗（使用flv.js播放ZLMediaKit流）
 * @param {string} cameraName - 摄像头名称
 * @param {string} videoUrl - 视频流URL
 * @param {string} cameraId - 摄像头ID
 * @param {Object} cameraData - 摄像头数据
 */
function showVideoPlayer(cameraName, videoUrl, cameraId, cameraData) {
    // 移除已有的播放器弹窗
    const existing = document.getElementById('video-player-overlay');
    if (existing) {
        destroyVideoPlayer();
        existing.remove();
    }

    const hlsUrl = convertToHlsUrl(videoUrl);
    const safeUrl = hlsUrl.replace(/'/g, '&#39;').replace(/"/g, '&quot;');

    const overlay = document.createElement('div');
    overlay.id = 'video-player-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';

    overlay.innerHTML = `
        <div style="background:#fff;border-radius:12px;width:90%;max-width:800px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:linear-gradient(135deg,#1890ff,#096dd9);color:#fff;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="font-size:18px;">📹</span>
                    <span style="font-size:16px;font-weight:600;">${cameraName}</span>
                    <span style="font-size:12px;background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:10px;">${cameraData.camera_type === 1 ? 'AI识别' : '普通'}</span>
                </div>
                <button id="video-player-close-btn" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;">&times;</button>
            </div>
            <div style="background:#000;position:relative;">
                <video id="camera-video-player" autoplay controls playsinline muted
                    style="width:100%;max-height:450px;display:block;">
                </video>
                <div id="video-loading-msg" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#fff;text-align:center;">
                    <div style="width:30px;height:30px;border:3px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 10px;"></div>
                    <p style="margin:0;font-size:14px;">正在连接视频流...</p>
                </div>
                <div id="video-error-msg" style="display:none;color:#fff;padding:60px 20px;text-align:center;flex-direction:column;align-items:center;gap:10px;">
                    <span style="font-size:40px;">⚠</span>
                    <p style="margin:0;font-size:16px;">视频流加载失败</p>
                    <p style="margin:0;font-size:12px;color:#aaa;">请检查摄像头是否在线</p>
                </div>
            </div>
            <div style="padding:10px 20px;background:#f5f5f5;font-size:12px;color:#666;word-break:break-all;">
                ${safeUrl}
            </div>
        </div>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;

    document.body.appendChild(overlay);

    // 初始化HLS播放器
    initHlsPlayer(hlsUrl);

    // 关闭按钮
    document.getElementById('video-player-close-btn').addEventListener('click', function() {
        destroyVideoPlayer();
        overlay.remove();
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            destroyVideoPlayer();
            overlay.remove();
        }
    });
}

// 全局播放器实例引用
let hlsPlayerInstance = null;  // flv.js 实例复用此变量

/**
 * 初始化视频播放器
 * 策略：优先原生<video>播放.mp4 → 失败时尝试flv.js播放.flv备用
 */
function initHlsPlayer(url) {
    const videoElement = document.getElementById('camera-video-player');
    const loadingMsg = document.getElementById('video-loading-msg');
    const errorMsg = document.getElementById('video-error-msg');

    if (!videoElement) return;

    console.log('[视频播放] 播放地址:', url);

    function showError(msg) {
        console.error('[视频播放] 错误:', msg);
        if (loadingMsg) loadingMsg.style.display = 'none';
        if (errorMsg) errorMsg.style.display = 'flex';
    }

    // ===== 优先：原生 <video> 播放 .mp4（Chrome/Edge 可直接播放 ZLMediaKit MP4流）=====
    if (url.includes('.mp4')) {
        console.log('[视频播放] 使用原生video播放MP4直播流');
        videoElement.src = url;
        videoElement.onloadedmetadata = function() {
            console.log('[视频播放] MP4流元数据加载成功');
            if (loadingMsg) loadingMsg.style.display = 'none';
        };
        videoElement.onerror = function() {
            // MP4失败时回退到flv.js播放.flv
            console.warn('[视频播放] MP4原生播放失败，尝试flv.js回退');
            videoElement.onerror = null; // 先移除，避免 src='' 再次触发
            const flvUrl = url.replace('.live.mp4', '.live.flv').replace('.mp4', '.flv');
            if (typeof flvjs !== 'undefined' && flvjs.isSupported()) {
                videoElement.src = '';
                const flvPlayer = flvjs.createPlayer({
                    type: 'flv', url: flvUrl, isLive: true, hasAudio: true, hasVideo: true
                }, { enableWorker: false, stashInitialSize: 128 });
                hlsPlayerInstance = flvPlayer;
                flvPlayer.attachMediaElement(videoElement);
                flvPlayer.load();
                flvPlayer.play();
                flvPlayer.on(flvjs.Events.ERROR, function(errType) { showError('视频加载失败: ' + errType); });
                flvPlayer.on(flvjs.Events.MEDIA_INFO, function() { if (loadingMsg) loadingMsg.style.display = 'none'; });
            } else {
                showError('视频无法播放，请检查网络或复制地址到浏览器打开');
            }
        };
        videoElement.play().catch(function(e) { console.warn('[视频播放] 自动播放受限:', e); });
        return;
    }

    // ===== 备用：flv.js 播放 .flv =====
    if (url.includes('.flv') && typeof flvjs !== 'undefined' && flvjs.isSupported()) {
        console.log('[视频播放] 使用 flv.js 播放 HTTP-FLV');
        const flvPlayer = flvjs.createPlayer({
            type: 'flv', url: url, isLive: true, hasAudio: true, hasVideo: true
        }, { enableWorker: false, stashInitialSize: 128 });
        hlsPlayerInstance = flvPlayer;
        flvPlayer.attachMediaElement(videoElement);
        flvPlayer.load();
        flvPlayer.play();
        flvPlayer.on(flvjs.Events.ERROR, function(errType) { showError('FLV加载失败: ' + errType); });
        flvPlayer.on(flvjs.Events.MEDIA_INFO, function() { if (loadingMsg) loadingMsg.style.display = 'none'; });
        return;
    }

    // ===== 最终回退：hls.js 播放 m3u8 =====
    if (url.includes('.m3u8')) {
        if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
            videoElement.src = url;
            videoElement.onloadedmetadata = function() { if (loadingMsg) loadingMsg.style.display = 'none'; };
            videoElement.onerror = function() { showError('HLS流加载失败'); };
            videoElement.play().catch(function(e) { console.warn('[视频播放] 自动播放受限:', e); });
        } else if (typeof Hls !== 'undefined' && Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
            hlsPlayerInstance = hls;
            hls.loadSource(url);
            hls.attachMedia(videoElement);
            hls.on(Hls.Events.MANIFEST_PARSED, function() {
                if (loadingMsg) loadingMsg.style.display = 'none';
                videoElement.play().catch(function(e) { console.warn('[视频播放] 自动播放受限:', e); });
            });
            hls.on(Hls.Events.ERROR, function(event, data) { if (data.fatal) showError('HLS错误'); });
        } else {
            showError('浏览器不支持该视频格式');
        }
        return;
    }

    showError('不支持的视频格式: ' + url);
}

/**
 * 尝试HLS播放（兼容旧调用）
 */
function tryHlsPlayback(url, videoElement, loadingMsg, errorMsg) {
    initHlsPlayer(url);
}

/**
 * 销毁HLS播放器实例
 */
function destroyVideoPlayer() {
    if (hlsPlayerInstance) {
        try {
            hlsPlayerInstance.destroy();
        } catch (e) {
            console.warn('[视频播放] 销毁播放器时出错:', e);
        }
        hlsPlayerInstance = null;
    }
    
    // 清理video元素
    const videoElement = document.getElementById('camera-video-player');
    if (videoElement) {
        videoElement.onerror = null;          // 防止 src='' 触发回退逻辑
        videoElement.onloadedmetadata = null;
        videoElement.pause();
        videoElement.src = '';
        videoElement.load();
    }
}

/**
 * 更新路段状态颜色
 * @param {number} startId - 起点ID
 * @param {number} endId - 终点ID
 * @param {number} cPoint - 检测点ID
 */
async function updateRoadSegmentStatus(startId, endId, aiRoadStatus, lineId, cPoint) {
    try {
        console.log('[路段状态] ========== 开始更新路段状态 ==========');
        console.log('[路段状态] start_id:', startId, 'end_id:', endId, 'ai_road_status:', aiRoadStatus, 'line_id:', lineId, 'c_point:', cPoint);

        // 根据 ai_road_status 确定颜色
        // 0=畅通-绿, 1=缓行-黄, 2=拥堵-橘, 3=阻断-红
        let color = ROAD_STATUS_COLORS[0]; // 默认绿色（畅通）
        const parsed = parseInt(aiRoadStatus);
        const status = isNaN(parsed) ? 0 : parsed;
        if (status === 0) {
            color = ROAD_STATUS_COLORS[0]; // 畅通-绿色
            console.log('[路段状态] ✓ 匹配到状态: 畅通(0) -> 绿色');
        } else if (status === 1) {
            color = ROAD_STATUS_COLORS[1]; // 缓行-黄色
            console.log('[路段状态] ✓ 匹配到状态: 缓行(1) -> 黄色');
        } else if (status === 2) {
            color = ROAD_STATUS_COLORS[2]; // 拥堵-红色
            console.log('[路段状态] ✓ 匹配到状态: 拥堵(2) -> 红色');
        } else if (status === 3) {
            color = ROAD_STATUS_COLORS[3]; // 阻断-灰色（道路禁行色值）
            console.log('[路段状态] ✓ 匹配到状态: 阻断(3) -> 禁行灰色');
        } else {
            console.warn('[路段状态] ✗ 未知的 ai_road_status 值:', aiRoadStatus, '使用默认绿色');
        }

        console.log('[路段状态] 最终使用颜色:', color);

        // 提前读取 prevStatus，确保 handleBlockedMarker 拿到的是调用前的旧值
        const prevStatus = roadStatusCache.get(`${startId}_${endId}`);

        // ===== 方案1：通过 line_id 直接找折线（最精确）=====
        if (lineId) {
            const result = updatePolylineColorByLineId(lineId, color);
            if (result.updated) {
                console.log('[路段状态] ✓ 通过 line_id 直接更新折线颜色成功');
                // 图标坐标直接来自折线本身，最准确，无需查 API
                const iconCoord = result.midCoord;
                console.log('[路段状态] 折线中点坐标:', iconCoord);
                await handleBlockedMarker(startId, endId, status, prevStatus, null, iconCoord);
                roadStatusCache.set(`${startId}_${endId}`, status);
                console.log('[路段状态] ========== 路段状态更新完成 ==========');
                return;
            }
            console.warn('[路段状态] line_id 匹配失败，降级到坐标匹配');
        }

        // ===== 方案2：通过 CPoint 坐标匹配（降级方案）=====
        // CPoint 是折线上的中间检测点，用它的坐标找最近的折线
        if (cPoint) {
            console.log('[路段状态] 尝试通过 CPoint 坐标匹配...');
            const cPointData = await getPointDetails(cPoint);
            if (cPointData) {
                const [cLng, cLat] = (typeof wgs84ToGcj02 === 'function')
                    ? wgs84ToGcj02(cPointData.longitude, cPointData.latitude)
                    : [cPointData.longitude, cPointData.latitude];
                const result = updatePolylineColorByNearestPoint([cLng, cLat], color);
                if (result.updated) {
                    console.log('[路段状态] ✓ 通过 CPoint 坐标匹配更新折线颜色成功');
                    // 图标坐标直接来自匹配到的折线，最准确
                    await handleBlockedMarker(startId, endId, status, prevStatus, null, result.midCoord);
                    roadStatusCache.set(`${startId}_${endId}`, status);
                    console.log('[路段状态] ========== 路段状态更新完成 ==========');
                    return;
                }
            }
            console.warn('[路段状态] CPoint 坐标匹配失败，降级到起终点 Dijkstra');
        }

        // ===== 方案3：通过起终点坐标 Dijkstra（最后兜底）=====
        // 旧脏数据可能 start_id/end_id 为空，直接跳过避免无效请求
        if (!startId || !endId) {
            console.warn('[路段状态] start_id 或 end_id 为空，跳过 Dijkstra 兜底');
            return;
        }

        const startPoint = await getPointDetails(startId);
        const endPoint = await getPointDetails(endId);

        if (!startPoint || !endPoint) {
            console.warn('[路段状态] ✗ 无法获取起点或终点坐标');
            return;
        }

        const [startLng, startLat] = (typeof wgs84ToGcj02 === 'function')
            ? wgs84ToGcj02(startPoint.longitude, startPoint.latitude)
            : [startPoint.longitude, startPoint.latitude];
        const [endLng, endLat] = (typeof wgs84ToGcj02 === 'function')
            ? wgs84ToGcj02(endPoint.longitude, endPoint.latitude)
            : [endPoint.longitude, endPoint.latitude];

        const startCoord = [startLng, startLat];
        const endCoord = [endLng, endLat];

        console.log('[路段状态] 起点坐标(GCJ02):', startCoord);
        console.log('[路段状态] 终点坐标(GCJ02):', endCoord);

        // 处理阻断图标：使用折线路径中点（直接来自地图，最准确）
        const polylineMidCoord = updatePolylineColorByCoords(startCoord, endCoord, color);
        await handleBlockedMarker(startId, endId, status, prevStatus, null, polylineMidCoord);
        roadStatusCache.set(`${startId}_${endId}`, status);

        console.log('[路段状态] ========== 路段状态更新完成 ==========');

    } catch (error) {
        console.error('[路段状态] ✗ 更新失败:', error);
    }
}

/**
 * 处理阻断图标的添加/移除
 * 图标坐标由调用方直接从地图折线取得后传入，无需再查 API
 * @param {number} prevStatus - 调用前的旧状态
 * @param {Array|null} midCoord - 图标坐标（直接来自折线路径中点）
 */
async function handleBlockedMarker(startId, endId, status, prevStatus, cPoint, midCoord) {
    console.log(`[路况图标] handleBlockedMarker 被调用: status=${status}, prevStatus=${prevStatus}, midCoord=${JSON.stringify(midCoord)}`);

    if (status === 2 || status === 3) {
        if (midCoord) {
            console.log('[路况图标] 准备放置图标，坐标:', midCoord, '状态:', status);
            addBlockedMarker(startId, endId, midCoord, status);
        } else {
            console.error('[路况图标] ✗ 无法获取图标坐标（折线未匹配到）');
        }
    } else if (prevStatus === 2 || prevStatus === 3) {
        console.log(`[路况图标] 状态从${prevStatus}变为${status}，移除图标`);
        removeBlockedMarker(startId, endId);
    } else {
        console.log(`[路况图标] status=${status} 无需显示图标，prevStatus=${prevStatus} 也无需移除`);
    }
}

/**
 * 通过 line_id 获取对应折线的中点坐标
 * 一条原始折线可能被分割成多个子段，取所有子段的整体中点
 * @param {number|string} lineId
 * @returns {Array|null} [lng, lat] 或 null
 */
function getPolylineMidCoordByLineId(lineId) {
    if (!window.polylines || window.polylines.length === 0) return null;

    const targetId = String(lineId);
    const allPoints = [];

    window.polylines.forEach(polyline => {
        if (!polyline || typeof polyline.getExtData !== 'function') return;
        const extData = polyline.getExtData();
        if (extData && String(extData.lineId) === targetId) {
            const path = polyline.getPath();
            if (path) {
                path.forEach(pt => allPoints.push([pt.lng, pt.lat]));
            }
        }
    });

    if (allPoints.length === 0) return null;

    // 取所有点的中间那个点作为图标位置
    const midIndex = Math.floor(allPoints.length / 2);
    return allPoints[midIndex];
}

/**
 * 通过 line_id 直接找到对应折线并更新颜色（最精确方案）
 * @param {number|string} lineId - 折线的 ID（对应 roadline.line_id）
 * @param {string} color - 目标颜色
 * @returns {boolean} 是否成功更新
 */
/**
 * 通过 line_id 直接找到对应折线并更新颜色（最精确方案）
 * @returns {{ updated: boolean, midCoord: Array|null }} 是否成功更新 + 折线中点坐标
 */
function updatePolylineColorByLineId(lineId, color) {
    if (!window.polylines || window.polylines.length === 0) {
        console.warn('[路段颜色] window.polylines 为空');
        return { updated: false, midCoord: null };
    }

    const targetId = String(lineId);
    let updatedCount = 0;
    const allPoints = [];

    window.polylines.forEach((polyline, idx) => {
        if (!polyline || typeof polyline.getExtData !== 'function') return;
        const extData = polyline.getExtData();
        if (extData && String(extData.lineId) === targetId) {
            polyline.setOptions({ strokeColor: color });
            updatedCount++;
            console.log(`[路段颜色] ✓ line_id=${targetId} 匹配折线[${idx}]，颜色更新为:`, color);
            // 收集所有匹配折线的路径点，用于计算中点
            const path = polyline.getPath ? polyline.getPath() : null;
            if (path) path.forEach(pt => allPoints.push([pt.lng, pt.lat]));
        }
    });

    if (updatedCount === 0) {
        console.warn('[路段颜色] ✗ 未找到 line_id =', targetId, '的折线');
        return { updated: false, midCoord: null };
    }

    // 去重：分割后相邻段共享端点，去掉重复点，还原原始折线的节点序列
    // 例如：[A,X, X,B, B,C] → 去重 → [A, X, B, C]
    const DEDUP_THRESHOLD = 0.000001; // 约0.1米，用于判断两点是否重合
    const uniquePoints = [];
    for (const pt of allPoints) {
        const last = uniquePoints[uniquePoints.length - 1];
        if (!last ||
            Math.abs(pt[0] - last[0]) > DEDUP_THRESHOLD ||
            Math.abs(pt[1] - last[1]) > DEDUP_THRESHOLD) {
            uniquePoints.push(pt);
        }
    }

    // 取去重后序列的中间节点，即原始折线的中间顶点
    // 对于3节点折线（A→B→C），去重后取索引1的点B，正好是道路中段
    const midCoord = uniquePoints.length > 0
        ? uniquePoints[Math.floor(uniquePoints.length / 2)]
        : null;
    console.log(`[路段颜色] ✓ line_id=${targetId} 共更新 ${updatedCount} 条折线，去重节点数:${uniquePoints.length}，中间节点:`, midCoord);
    return { updated: true, midCoord };
}

/**
 * 通过折线上某个点的坐标找最近的折线并更新颜色（降级方案）
 * 适用于 CPoint 是折线中间点的场景
 * @param {Array} coord - 坐标 [lng, lat]（GCJ02）
 * @param {string} color - 目标颜色
 * @returns {boolean} 是否成功更新
 */
/**
 * 通过折线上某个点的坐标找最近的折线并更新颜色（降级方案）
 * @returns {{ updated: boolean, midCoord: Array|null }} 是否成功更新 + 折线中点坐标
 */
function updatePolylineColorByNearestPoint(coord, color) {
    if (!window.polylines || window.polylines.length === 0) {
        console.warn('[路段颜色] window.polylines 为空');
        return { updated: false, midCoord: null };
    }

    const THRESHOLD = 0.0002; // 约20米，中间点匹配阈值放宽
    let bestPolyline = null;
    let bestDist = Infinity;
    let bestIdx = -1;

    window.polylines.forEach((polyline, idx) => {
        if (!polyline || typeof polyline.getPath !== 'function') return;
        const path = polyline.getPath();
        if (!path) return;

        // 遍历折线上的每个点，找距离最近的
        for (const pt of path) {
            const dist = Math.sqrt(
                Math.pow(pt.lng - coord[0], 2) +
                Math.pow(pt.lat - coord[1], 2)
            );
            if (dist < bestDist) {
                bestDist = dist;
                bestPolyline = polyline;
                bestIdx = idx;
            }
        }
    });

    if (!bestPolyline || bestDist > THRESHOLD) {
        console.warn('[路段颜色] ✗ 未找到距离坐标', coord, '足够近的折线，最近距离:', bestDist);
        return { updated: false, midCoord: null };
    }

    bestPolyline.setOptions({ strokeColor: color });

    // 取匹配折线路径的中间点作为图标位置（直接来自地图折线，最准确）
    const path = bestPolyline.getPath();
    const allPoints = path ? Array.from(path).map(pt => [pt.lng, pt.lat]) : [];
    const midCoord = allPoints.length > 0 ? allPoints[Math.floor(allPoints.length / 2)] : null;

    console.log(`[路段颜色] ✓ CPoint 坐标匹配折线[${bestIdx}]，距离:`, bestDist, '颜色更新为:', color, '中点坐标:', midCoord);
    return { updated: true, midCoord };
}

// 点坐标缓存：避免对同一个点 ID 重复请求
// 只缓存成功的结果，失败（404等）不缓存，避免污染后续查询
const _adminPointCache = new Map();

/**
 * 获取点详情（带缓存，404 的点记为 null 不再重复请求）
 * @param {number} pointId - 点ID
 * @returns {Promise<Object|null>}
 */
async function getPointDetails(pointId) {
    // 命中缓存直接返回
    if (_adminPointCache.has(pointId)) {
        return _adminPointCache.get(pointId);
    }

    try {
        const url = `https://dmap.cscec3bxjy.cn/api/map/points/${pointId}`;

        const token = sessionStorage.getItem('authToken') || '';
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'accept': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            console.warn('[点详情] ✗ 请求失败，状态码:', response.status, 'pointId:', pointId);
            // 失败不缓存，下次轮询可以重试
            return null;
        }

        const data = await response.json();

        if (data.code === 200 && data.data) {
            _adminPointCache.set(pointId, data.data);  // 只缓存成功结果
            return data.data;
        }

        // 接口返回但数据格式不对，也不缓存
        return null;
    } catch (error) {
        console.error('[点详情] ✗ 获取失败:', error);
        // 网络错误不缓存，下次可以重试
        return null;
    }
}

/**
 * 通过坐标更新线段颜色（优化版：使用最短路径算法精确显色）
 * @param {Array} startCoord - 起点坐标 [lng, lat]
 * @param {Array} endCoord - 终点坐标 [lng, lat]
 * @param {string} color - 颜色
 */
function updatePolylineColorByCoords(startCoord, endCoord, color) {
    console.log('[路段颜色] ========== 通过最短路径算法精确显色 ==========');

    if (!window.polylines || window.polylines.length === 0) {
        console.warn('[路段颜色] ✗ 没有线段数据');
        return null;
    }

    console.log('[路段颜色] 总线段数:', window.polylines.length);
    console.log('[路段颜色] 起点坐标:', startCoord);
    console.log('[路段颜色] 终点坐标:', endCoord);
    console.log('[路段颜色] 目标颜色:', color);

    // 1. 构建图结构（如果还没有构建）
    if (!window.roadGraph) {
        console.log('[路段颜色] 构建道路图结构...');
        window.roadGraph = buildRoadGraph(window.polylines);
        console.log('[路段颜色] ✓ 道路图构建完成，节点数:', Object.keys(window.roadGraph.nodes).length);
    }

    // 2. 在图中查找起点和终点对应的节点
    const COORD_THRESHOLD = 0.00001; // 坐标匹配阈值（约1米）
    const startNodeId = findNearestNode(window.roadGraph.nodes, startCoord, COORD_THRESHOLD);
    const endNodeId = findNearestNode(window.roadGraph.nodes, endCoord, COORD_THRESHOLD);

    if (!startNodeId || !endNodeId) {
        console.warn('[路段颜色] ✗ 未找到起点或终点对应的节点');
        return null;
    }

    console.log('[路段颜色] ✓ 找到起点节点:', startNodeId);
    console.log('[路段颜色] ✓ 找到终点节点:', endNodeId);

    // 3. 使用 Dijkstra 算法计算最短路径
    const path = dijkstraShortestPath(window.roadGraph, startNodeId, endNodeId);

    if (!path || path.length === 0) {
        console.warn('[路段颜色] ✗ 未找到从起点到终点的路径');
        return null;
    }

    console.log('[路段颜色] ✓ 最短路径节点序列:', path);

    // 4. 根据路径中的节点，更新相应的线段颜色，同时收集所有路径点
    let updatedCount = 0;
    const allPathPoints = [];
    for (let i = 0; i < path.length - 1; i++) {
        const fromNode = path[i];
        const toNode = path[i + 1];

        const polylineIndices = window.roadGraph.edges[fromNode]?.[toNode];

        if (polylineIndices && polylineIndices.length > 0) {
            polylineIndices.forEach(index => {
                const polyline = window.polylines[index];
                if (polyline) {
                    polyline.setOptions({ strokeColor: color });
                    updatedCount++;
                    console.log(`[路段颜色] ✓ 更新线段[${index}] (${fromNode} -> ${toNode}) 颜色:`, color);
                    // 收集路径点用于计算中点
                    const pts = polyline.getPath ? polyline.getPath() : null;
                    if (pts) pts.forEach(pt => allPathPoints.push([pt.lng, pt.lat]));
                }
            });
        }
    }

    if (updatedCount === 0) {
        console.warn('[路段颜色] ✗ 未更新任何线段');
        console.log('[路段颜色] ========== 精确显色完成 ==========');
        return null;
    }

    console.log(`[路段颜色] ✓ 共更新了 ${updatedCount} 条线段`);
    console.log('[路段颜色] ========== 精确显色完成 ==========');

    // 返回路径折线的几何中心坐标（平均经纬度，比取中间索引更准确地落在道路中段）
    if (allPathPoints.length === 0) return null;
    const avgLng = allPathPoints.reduce((s, p) => s + p[0], 0) / allPathPoints.length;
    const avgLat = allPathPoints.reduce((s, p) => s + p[1], 0) / allPathPoints.length;
    return [avgLng, avgLat];
}

/**
 * 构建道路图结构
 * @param {Array} polylines - 线段数组
 * @returns {Object} { nodes: {nodeId: [lng, lat]}, edges: {fromNode: {toNode: [polylineIndices]}} }
 */
function buildRoadGraph(polylines) {
    const nodes = {}; // nodeId -> [lng, lat]
    const edges = {}; // fromNode -> toNode -> [polylineIndices]
    const MERGE_THRESHOLD = 0.000001; // 节点合并阈值（约0.1米）

    polylines.forEach((polyline, polylineIndex) => {
        const path = polyline.getPath();
        if (!path || path.length < 2) return;

        // 提取起点和终点
        const start = [path[0].lng, path[0].lat];
        const end = [path[path.length - 1].lng, path[path.length - 1].lat];

        // 查找或创建起点节点
        const startNodeId = findOrCreateNode(nodes, start, MERGE_THRESHOLD);
        // 查找或创建终点节点
        const endNodeId = findOrCreateNode(nodes, end, MERGE_THRESHOLD);

        // 添加边（双向）
        addEdge(edges, startNodeId, endNodeId, polylineIndex);
        addEdge(edges, endNodeId, startNodeId, polylineIndex);
    });

    return { nodes, edges };
}

/**
 * 查找或创建节点
 * @param {Object} nodes - 节点集合
 * @param {Array} coord - 坐标 [lng, lat]
 * @param {number} threshold - 合并阈值
 * @returns {string} 节点ID
 */
function findOrCreateNode(nodes, coord, threshold) {
    // 查找是否有距离很近的节点（可以合并）
    for (const [nodeId, nodeCoord] of Object.entries(nodes)) {
        const dist = Math.sqrt(
            Math.pow(coord[0] - nodeCoord[0], 2) +
            Math.pow(coord[1] - nodeCoord[1], 2)
        );
        if (dist < threshold) {
            return nodeId;
        }
    }

    // 创建新节点
    const nodeId = `${coord[0].toFixed(6)}_${coord[1].toFixed(6)}`;
    nodes[nodeId] = coord;
    return nodeId;
}

/**
 * 添加边
 * @param {Object} edges - 边集合
 * @param {string} fromNode - 起点节点ID
 * @param {string} toNode - 终点节点ID
 * @param {number} polylineIndex - 线段索引
 */
function addEdge(edges, fromNode, toNode, polylineIndex) {
    if (!edges[fromNode]) {
        edges[fromNode] = {};
    }
    if (!edges[fromNode][toNode]) {
        edges[fromNode][toNode] = [];
    }
    edges[fromNode][toNode].push(polylineIndex);
}

/**
 * 查找距离最近的节点
 * @param {Object} nodes - 节点集合
 * @param {Array} coord - 坐标 [lng, lat]
 * @param {number} threshold - 阈值
 * @returns {string|null} 节点ID
 */
function findNearestNode(nodes, coord, threshold) {
    let nearestNodeId = null;
    let minDist = Infinity;

    for (const [nodeId, nodeCoord] of Object.entries(nodes)) {
        const dist = Math.sqrt(
            Math.pow(coord[0] - nodeCoord[0], 2) +
            Math.pow(coord[1] - nodeCoord[1], 2)
        );
        if (dist < minDist) {
            minDist = dist;
            nearestNodeId = nodeId;
        }
    }

    // 只有距离小于阈值才返回
    if (minDist < threshold) {
        return nearestNodeId;
    }

    return null;
}

/**
 * Dijkstra 最短路径算法
 * @param {Object} graph - 图结构 { nodes, edges }
 * @param {string} startNode - 起点节点ID
 * @param {string} endNode - 终点节点ID
 * @returns {Array|null} 路径节点序列
 */
function dijkstraShortestPath(graph, startNode, endNode) {
    const distances = {}; // 节点 -> 从起点到该节点的最短距离
    const previous = {};  // 节点 -> 前驱节点
    const unvisited = new Set(Object.keys(graph.nodes));

    // 初始化距离
    for (const node of unvisited) {
        distances[node] = Infinity;
    }
    distances[startNode] = 0;

    while (unvisited.size > 0) {
        // 找到未访问节点中距离最小的节点
        let currentNode = null;
        let minDist = Infinity;
        for (const node of unvisited) {
            if (distances[node] < minDist) {
                minDist = distances[node];
                currentNode = node;
            }
        }

        if (currentNode === null || minDist === Infinity) {
            // 无法到达任何未访问节点
            break;
        }

        // 如果到达终点，提前结束
        if (currentNode === endNode) {
            break;
        }

        unvisited.delete(currentNode);

        // 更新相邻节点的距离
        const neighbors = graph.edges[currentNode] || {};
        for (const [neighbor, polylineIndices] of Object.entries(neighbors)) {
            if (!unvisited.has(neighbor)) continue;

            // 计算边的长度（使用线段的实际长度）
            const edgeLength = calculateEdgeLength(
                graph.nodes[currentNode],
                graph.nodes[neighbor]
            );

            const altDistance = distances[currentNode] + edgeLength;
            if (altDistance < distances[neighbor]) {
                distances[neighbor] = altDistance;
                previous[neighbor] = currentNode;
            }
        }
    }

    // 如果无法到达终点
    if (distances[endNode] === Infinity) {
        console.warn('[Dijkstra] 无法从起点到达终点');
        return null;
    }

    // 回溯路径
    const path = [];
    let current = endNode;
    while (current !== undefined) {
        path.unshift(current);
        current = previous[current];
    }

    return path;
}

/**
 * 计算边的长度（Haversine距离）
 * @param {Array} coord1 - 坐标1 [lng, lat]
 * @param {Array} coord2 - 坐标2 [lng, lat]
 * @returns {number} 距离（米）
 */
function calculateEdgeLength(coord1, coord2) {
    const R = 6371000; // 地球半径（米）
    const lat1 = coord1[1] * Math.PI / 180;
    const lat2 = coord2[1] * Math.PI / 180;
    const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
    const dLng = (coord2[0] - coord1[0]) * Math.PI / 180;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

// ==================== 定位功能 ====================

/**
 * 定位到当前位置
 * 使用浏览器地理位置API获取当前位置，并在地图上显示
 */
function locateToCurrentPosition() {
    if (!map) {
        console.error('[定位] 地图实例不存在');
        alert('地图未加载完成，请稍后再试');
        return;
    }

    // 检查浏览器是否支持地理位置
    if (!navigator.geolocation) {
        console.error('[定位] 浏览器不支持地理位置');
        alert('您的浏览器不支持定位功能');
        return;
    }

    // 显示定位中提示
    const locateBtn = document.getElementById('locate-btn');
    if (locateBtn) {
        locateBtn.classList.add('locating');
    }

    console.log('[定位] 正在获取当前位置...');

    // 获取当前位置
    navigator.geolocation.getCurrentPosition(
        // 成功回调
        function(position) {
            const lng = position.coords.longitude;
            const lat = position.coords.latitude;
            console.log('[定位] 获取到WGS84坐标:', lng, lat);

            // WGS84 转 GCJ02（高德地图使用GCJ02坐标系）
            let gcjCoord = [lng, lat];
            if (typeof CoordinateConvert !== 'undefined' && CoordinateConvert.wgs84togcj02) {
                gcjCoord = CoordinateConvert.wgs84togcj02(lng, lat);
                console.log('[定位] 转换为GCJ02坐标:', gcjCoord);
            } else {
                // 如果没有坐标转换工具，使用高德API转换
                AMap.convertFrom([lng, lat], 'gps', function(status, result) {
                    if (status === 'complete' && result.locations && result.locations.length > 0) {
                        const gcjLng = result.locations[0].lng;
                        const gcjLat = result.locations[0].lat;
                        console.log('[定位] 高德API转换后坐标:', gcjLng, gcjLat);
                        showCurrentLocation([gcjLng, gcjLat]);
                    } else {
                        // 转换失败，直接使用原坐标（可能有偏差）
                        console.warn('[定位] 坐标转换失败，使用原坐标');
                        showCurrentLocation([lng, lat]);
                    }
                });
                return;
            }

            showCurrentLocation(gcjCoord);
        },
        // 失败回调
        function(error) {
            console.error('[定位] 获取位置失败:', error);
            if (locateBtn) {
                locateBtn.classList.remove('locating');
            }

            let errorMsg = '定位失败';
            switch(error.code) {
                case error.PERMISSION_DENIED:
                    errorMsg = '您拒绝了定位权限，请在浏览器设置中允许定位';
                    break;
                case error.POSITION_UNAVAILABLE:
                    errorMsg = '无法获取位置信息';
                    break;
                case error.TIMEOUT:
                    errorMsg = '定位超时，请重试';
                    break;
            }
            alert(errorMsg);
        },
        // 选项
        {
            enableHighAccuracy: true, // 高精度
            timeout: 10000, // 超时时间10秒
            maximumAge: 0 // 不使用缓存
        }
    );
}

/**
 * 在地图上显示当前位置
 * @param {Array} coord - GCJ02坐标 [lng, lat]
 */
function showCurrentLocation(coord) {
    const locateBtn = document.getElementById('locate-btn');
    if (locateBtn) {
        locateBtn.classList.remove('locating');
    }

    console.log('[定位] 显示当前位置:', coord);

    // 移除之前的定位标记
    if (window.currentLocationMarker) {
        window.currentLocationMarker.setMap(null);
    }

    // 创建定位标记
    const markerContent = document.createElement('div');
    markerContent.className = 'current-location-marker';
    markerContent.innerHTML = `
        <div class="location-dot"></div>
        <div class="location-pulse"></div>
    `;

    // 添加样式（如果还没有添加）
    if (!document.getElementById('current-location-styles')) {
        const style = document.createElement('style');
        style.id = 'current-location-styles';
        style.textContent = `
            .current-location-marker {
                position: relative;
                width: 24px;
                height: 24px;
            }
            .location-dot {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 12px;
                height: 12px;
                background: #4A90E2;
                border: 3px solid white;
                border-radius: 50%;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
                z-index: 2;
            }
            .location-pulse {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 40px;
                height: 40px;
                background: rgba(74, 144, 226, 0.3);
                border-radius: 50%;
                animation: pulse 2s ease-out infinite;
                z-index: 1;
            }
            @keyframes pulse {
                0% {
                    transform: translate(-50%, -50%) scale(0.5);
                    opacity: 1;
                }
                100% {
                    transform: translate(-50%, -50%) scale(1.5);
                    opacity: 0;
                }
            }
            .admin-control-btn.locating {
                animation: locating-spin 1s linear infinite;
            }
            @keyframes locating-spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }

    // 创建标记
    window.currentLocationMarker = new AMap.Marker({
        position: coord,
        content: markerContent,
        anchor: 'center',
        zIndex: 200
    });

    window.currentLocationMarker.setMap(map);

    // 将地图中心移动到当前位置
    map.setCenter(coord);
    map.setZoom(MapConfig.mapConfig.zoom);

    console.log('[定位] ✓ 定位完成');
}
