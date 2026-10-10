// admin-road-status-sync.js
// 管理端导航页道路状态同步：
// 1. 轮询 roadlines 感知编辑器/后端状态变化
// 2. 监听 WebSocket traffic_status 实时更新指定项目/摄像头对应路段
// 3. 道路状态变化后同步重建 KML 图，确保后续路线规划避开阻断路段

window.AdminRoadStatusSync = (function() {
    'use strict';

    const EVALUATION_STATUS_MAP = {
        free: 0,
        slow: 1,
        congested: 2,
        blocked: 3,
        '畅通': 0,
        '缓行': 1,
        '拥堵': 2,
        '阻断': 3
    };
    const STATUS_EVALUATION_MAP = {
        0: 'free',
        1: 'slow',
        2: 'congested',
        3: 'blocked'
    };

    const state = {
        pollTimer: null,
        pollInterval: 3000,
        roadStatusCache: new Map(),
        cameraIdMap: {},
        cameraCacheProjectId: null,
        initializedProjectId: null,
        hasBoundWsListener: false,
        lastPolylineCount: undefined,
        isApplyingRoadlines: false
    };

    function getCurrentProjectId() {
        try {
            const projectSelection = sessionStorage.getItem('projectSelection');
            const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');

            if (projectSelection) {
                const selection = JSON.parse(projectSelection);
                const projectName = selection.project;
                const userProjects = currentUser.projects || [];

                let selectedProject = null;
                if (selection.projectCode) {
                    selectedProject = userProjects.find(p =>
                        (p.projectCode === selection.projectCode) || (p.id === selection.projectCode)
                    );
                }

                if (!selectedProject) {
                    selectedProject = userProjects.find(p => p.projectName === projectName);
                }

                if (selectedProject) {
                    return selectedProject.projectCode || selectedProject.id;
                }
            }
        } catch (e) {
            console.error('[管理导航道路状态] 获取项目ID失败:', e);
        }
        return null;
    }

    function getRequestHeaders() {
        const token = sessionStorage.getItem('authToken') || '';
        const headers = {
            accept: 'application/json'
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        return headers;
    }

    function isPolylineReady() {
        return Array.isArray(window.polylines) && window.polylines.length > 0;
    }

    function invalidateDriverGraphIfNeeded() {
        const currentPolylineCount = isPolylineReady() ? window.polylines.length : 0;

        if (state.lastPolylineCount === undefined) {
            state.lastPolylineCount = currentPolylineCount;
            window.driverRoadGraph = null;
            return;
        }

        if (currentPolylineCount !== state.lastPolylineCount) {
            console.log('[管理导航道路状态] 检测到折线数量变化，清空司机端道路图缓存');
            state.lastPolylineCount = currentPolylineCount;
            window.driverRoadGraph = null;
        }
    }

    function rebuildRoutingGraph(reason) {
        if (typeof resetKMLGraph === 'function') {
            resetKMLGraph();
        }

        if (typeof buildKMLGraph === 'function') {
            const success = buildKMLGraph();
            console.log('[管理导航道路状态] KML图已重建:', {
                reason,
                success: success !== false
            });
        }
    }

    async function fetchRoadlines(projectId) {
        try {
            const url = `https://dmap.cscec3bxjy.cn/api/video/roadlines?page=1&page_size=1000&project_id=${projectId}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: getRequestHeaders()
            });

            if (!response.ok) {
                console.warn('[管理导航道路状态] 获取 roadlines 失败，状态码:', response.status);
                return [];
            }

            const data = await response.json();
            if (data.code === 200 && data.data) {
                const list = data.data.list || data.data.items || data.data;
                return Array.isArray(list) ? list : [];
            }

            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.error('[管理导航道路状态] 获取 roadlines 失败:', error);
            return [];
        }
    }

    async function fetchCameras(projectId) {
        try {
            const url = `https://dmap.cscec3bxjy.cn/api/video/cameras?page=1&page_size=1000&project_id=${projectId}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: getRequestHeaders()
            });

            if (!response.ok) {
                console.warn('[管理导航道路状态] 获取 cameras 失败，状态码:', response.status);
                return [];
            }

            const data = await response.json();
            if (data.code === 200 && data.data) {
                const list = data.data.list || data.data.items || data.data;
                return Array.isArray(list) ? list : [];
            }

            return Array.isArray(data) ? data : [];
        } catch (error) {
            console.error('[管理导航道路状态] 获取 cameras 失败:', error);
            return [];
        }
    }

    async function buildCameraCache(projectId, forceRefresh) {
        if (!projectId) return {};

        if (!forceRefresh &&
            state.cameraCacheProjectId === projectId &&
            Object.keys(state.cameraIdMap).length > 0) {
            return state.cameraIdMap;
        }

        const cameras = await fetchCameras(projectId);
        state.cameraIdMap = {};
        cameras.forEach(cam => {
            const key = cam.camera_id || cam.CameraId;
            if (key) {
                state.cameraIdMap[key] = cam;
            }
        });
        state.cameraCacheProjectId = projectId;

        console.log('[管理导航道路状态] 摄像头缓存已建立:', {
            projectId,
            count: Object.keys(state.cameraIdMap).length
        });

        return state.cameraIdMap;
    }

    async function applyRoadlineStatus(roadline, source) {
        if (typeof updateDriverRoadSegmentStatus !== 'function') {
            console.warn('[管理导航道路状态] updateDriverRoadSegmentStatus 不可用，跳过更新');
            return false;
        }

        const startId = roadline.start_id;
        const endId = roadline.end_id;
        if (!startId || !endId) return false;

        const cacheKey = `${startId}_${endId}`;
        const parsed = parseInt(roadline.ai_road_status, 10);
        const newStatus = isNaN(parsed) ? 0 : parsed;
        const oldStatus = state.roadStatusCache.get(cacheKey);

        if (oldStatus !== undefined && oldStatus === newStatus) {
            return false;
        }

        await updateDriverRoadSegmentStatus(
            startId,
            endId,
            roadline.ai_road_status,
            roadline.line_id,
            (roadline.c_point > 0 ? roadline.c_point : null) || (roadline.CPoint > 0 ? roadline.CPoint : null)
        );

        state.roadStatusCache.set(cacheKey, newStatus);
        
        if (typeof AdminAlarmEventCenter !== 'undefined' && roadline.camera_id) {
            AdminAlarmEventCenter.handleRoadStatusChange({
                sourceType: source === 'websocket' ? 'ws_event' : 'polling_state',
                projectId: getCurrentProjectId(),
                cameraId: roadline.camera_id,
                evaluation: STATUS_EVALUATION_MAP[newStatus] || String(newStatus),
                eventTime: roadline.updated_at || roadline.update_time || new Date().toISOString(),
                raw: roadline
            });
        }
        console.log('[管理导航道路状态] 路段状态已更新:', {
            source,
            startId,
            endId,
            status: newStatus
        });
        return true;
    }

    async function loadRoadStatus(source) {
        const projectId = getCurrentProjectId();
        if (!projectId) {
            console.warn('[管理导航道路状态] 无法加载道路状态，未找到项目ID');
            return;
        }

        if (state.isApplyingRoadlines) {
            return;
        }

        state.isApplyingRoadlines = true;
        try {
            invalidateDriverGraphIfNeeded();

            const roadlines = await fetchRoadlines(projectId);
            if (!roadlines || roadlines.length === 0) {
                console.warn('[管理导航道路状态] 未获取到 roadlines 数据');
                return;
            }

            let hasChange = false;
            for (const roadline of roadlines) {
                const changed = await applyRoadlineStatus(roadline, source || 'polling');
                if (changed) {
                    hasChange = true;
                }
            }

            if (hasChange) {
                rebuildRoutingGraph(source || 'polling');
            }
        } finally {
            state.isApplyingRoadlines = false;
        }
    }

    async function handleTrafficStatusChange(detail) {
        if (!detail) return;

        const currentProjectId = getCurrentProjectId();
        const messageProjectId = detail.projectId || currentProjectId;

        if (!currentProjectId || !messageProjectId) {
            return;
        }

        if (String(currentProjectId) !== String(messageProjectId)) {
            console.log('[管理导航道路状态] 忽略非当前项目 traffic_status 消息:', {
                currentProjectId,
                messageProjectId
            });
            return;
        }

        const evaluation = detail.evaluation;
        const cameraId = detail.cameraId;
        if (!evaluation || !cameraId) return;

        const aiRoadStatus = EVALUATION_STATUS_MAP[evaluation];
        if (aiRoadStatus === undefined) {
            console.warn('[管理导航道路状态] 未知 evaluation 值:', evaluation);
            return;
        }

        let cam = state.cameraIdMap[cameraId];
        if (!cam || String(state.cameraCacheProjectId) !== String(messageProjectId)) {
            await buildCameraCache(messageProjectId, true);
            cam = state.cameraIdMap[cameraId];
        }

        if (!cam) {
            console.warn('[管理导航道路状态] 未找到摄像头缓存:', {
                projectId: messageProjectId,
                cameraId
            });
            return;
        }

        const startId = cam.start_id || cam.StartId;
        const endId = cam.end_id || cam.EndId;
        if (!startId || !endId) {
            console.warn('[管理导航道路状态] 摄像头缺少路段信息:', cam);
            return;
        }

        const cacheKey = `${startId}_${endId}`;
        const oldStatus = state.roadStatusCache.get(cacheKey);
        if (oldStatus !== undefined && oldStatus === aiRoadStatus) {
            return;
        }

        await updateDriverRoadSegmentStatus(
            startId,
            endId,
            aiRoadStatus,
            cam.line_id || cam.lineId || null,
            (cam.c_point > 0 ? cam.c_point : null) || (cam.CPoint > 0 ? cam.CPoint : null)
        );

        state.roadStatusCache.set(cacheKey, aiRoadStatus);
        rebuildRoutingGraph('websocket');

        console.log('[管理导航道路状态] 已处理 traffic_status:', {
            projectId: messageProjectId,
            cameraId,
            startId,
            endId,
            aiRoadStatus
        });
    }

    function startPolling() {
        if (state.pollTimer) {
            clearInterval(state.pollTimer);
        }

        state.pollTimer = setInterval(async () => {
            await loadRoadStatus('polling');
        }, state.pollInterval);

        console.log('[管理导航道路状态] 轮询已启动，间隔:', state.pollInterval);
    }

    function stopPolling() {
        if (state.pollTimer) {
            clearInterval(state.pollTimer);
            state.pollTimer = null;
        }
    }

    function bindWebSocketListenerOnce() {
        if (state.hasBoundWsListener) return;

        window.addEventListener('trafficStatusChange', async function(e) {
            await handleTrafficStatusChange(e.detail);
        });

        state.hasBoundWsListener = true;
    }

    async function init(options) {
        const config = options || {};
        if (config.pollInterval > 0) {
            state.pollInterval = config.pollInterval;
        }

        const projectId = getCurrentProjectId();
        if (!projectId) {
            console.warn('[管理导航道路状态] 初始化失败，未找到项目ID');
            return false;
        }

        if (!isPolylineReady()) {
            console.warn('[管理导航道路状态] 折线尚未就绪，延迟重试初始化');
            setTimeout(() => init(config), 500);
            return false;
        }

        stopPolling();
        bindWebSocketListenerOnce();

        if (String(state.initializedProjectId) !== String(projectId)) {
            state.roadStatusCache.clear();
            state.cameraIdMap = {};
            state.cameraCacheProjectId = null;
            state.lastPolylineCount = undefined;
        }

        state.initializedProjectId = projectId;

        if (typeof resetDriverRoadStatus === 'function') {
            resetDriverRoadStatus();
        }
        await buildCameraCache(projectId, true);
        await loadRoadStatus('init');
        startPolling();

        console.log('[管理导航道路状态] 初始化完成:', {
            projectId,
            pollInterval: state.pollInterval
        });
        return true;
    }

    return {
        init,
        stopPolling,
        reload: () => loadRoadStatus('manual'),
        rebuildRoutingGraph
    };
})();
