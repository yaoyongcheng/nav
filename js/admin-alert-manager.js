/**
 * 管理端报警 UI 管理模块
 * 负责在地图上展示三类车辆报警的气泡和详情卡片：
 * 1. 电子围栏闯入（禁行区）- fence_enter_prohibit
 * 2. 固定车违规出场（离开工地范围）- fence_leave_site
 * 3. 固定车偏离规定场外道路 - route_deviation
 *
 * 触发方式：监听 window 自定义事件 'fenceAlert' 和 'routeDeviation'
 * 气泡样式：白底红框，底部红色三角指向车辆，点击展开详情卡片
 */

const AdminAlertManager = (function () {
    'use strict';

    // 运输服务接口基础 URL
    const TRANSPORT_API_BASE = 'https://dmap.cscec3bxjy.cn/api/transport';
    const VEHICLE_TYPE_MAP = {
        0: '临时车',
        1: '固定车',
        2: '临时车',
        fixed: '固定车',
        temp: '临时车',
        '固定车': '固定车',
        '临时车': '临时车'
    };
    const ALERT_STYLE = {
        bubbleBorder: '#FFD6D6',
        bubbleBackground: '#FFFFFF',
        bubbleText: '#808080',
        cardBorder: '#FFD6D6',
        cardBackground: '#FFFFFF',
        cardTitle: '#4E5969',
        cardLabel: '#808080',
        cardValue: '#4E5969',
        separator: '#FFFFFF',
        close: '#808080'
    };
    const ALERT_LAYOUT = {
        bubbleWidth: 84,
        bubbleHeight: 28,
        bubblePointer: 8,
        detailWidth: 208,
        detailPointer: 9,
        detailOffsetY: 192 // 详情卡底部尖端固定锚定到车辆同一点
    };
    const FENCE_ALERT_UI_MODE = 'runtime_cache';

    function isMeaningful(value) {
        return value !== undefined && value !== null && String(value).trim() !== '' && String(value).trim() !== '-';
    }

    function pickFirstMeaningful() {
        for (let i = 0; i < arguments.length; i++) {
            if (isMeaningful(arguments[i])) {
                return arguments[i];
            }
        }
        return '';
    }

    function normalizeVehicleType(value) {
        if (value === 1 || value === '1' || value === 'fixed' || value === '固定车') {
            return 'fixed';
        }
        if (value === 0 || value === '0' || value === 2 || value === '2' || value === 'temp' || value === '临时车') {
            return 'temp';
        }
        return value || '';
    }

    function mergeAlertDetail(baseDetail, incomingDetail) {
        const merged = { ...(baseDetail || {}) };
        const source = incomingDetail || {};

        Object.keys(source).forEach(key => {
            const value = source[key];
            if (isMeaningful(value) || typeof value === 'boolean' || typeof value === 'number' || Array.isArray(value)) {
                merged[key] = value;
            } else if (!Object.prototype.hasOwnProperty.call(merged, key)) {
                merged[key] = value;
            }
        });

        const normalizedVehicleType = normalizeVehicleType(
            pickFirstMeaningful(merged.vehicleType, merged.vehicleSourceType)
        );

        return {
            ...merged,
            alertKey: pickFirstMeaningful(merged.alertKey, merged.deviceId, merged.plateNumber, merged.vehicleId, merged.sourceId),
            vehicleId: pickFirstMeaningful(merged.vehicleId, merged.deviceId, merged.plateNumber, merged.sourceId),
            projectId: pickFirstMeaningful(merged.projectId, merged.project_id, merged.projectID),
            plateNumber: pickFirstMeaningful(merged.plateNumber, merged.plate_number, merged.vehicleId),
            deviceId: pickFirstMeaningful(
                merged.deviceId,
                merged.device_id,
                merged.trackerID,
                merged.tracker_name,
                merged.trackerName,
                merged.tracker_id,
                merged.trackerId
            ),
            taskId: pickFirstMeaningful(merged.taskId, merged.task_id, merged.taskID),
            taskName: pickFirstMeaningful(merged.taskName, merged.task_name, merged.lineName, merged.line_name, merged.taskLineName),
            lineName: pickFirstMeaningful(merged.lineName, merged.line_name, merged.taskLineName),
            driverName: pickFirstMeaningful(merged.driverName, merged.driver_name),
            driverPhone: pickFirstMeaningful(merged.driverPhone, merged.driver_phone, merged.phone),
            polylineId: pickFirstMeaningful(merged.polylineId, merged.polyline_id, merged.taskPolylineId),
            taskScope: pickFirstMeaningful(merged.taskScope, merged.task_scope, merged.workSiteScope, merged.work_site_scope),
            vehicleType: normalizedVehicleType || merged.vehicleType || '',
            vehicleTypeText: pickFirstMeaningful(
                merged.vehicleTypeText,
                VEHICLE_TYPE_MAP[normalizedVehicleType],
                VEHICLE_TYPE_MAP[merged.vehicleType]
            )
        };
    }

    function needsAlertDetailEnrichment(detail) {
        if (!detail) return false;
        return !(
            isMeaningful(detail.taskName) &&
            isMeaningful(detail.driverName) &&
            isMeaningful(detail.driverPhone) &&
            isMeaningful(detail.deviceId)
        );
    }

    // 地图实例
    let map = null;

    // 当前所有报警气泡
    // Map<alertKey, { bubbleMarker, detailMarker, alertType, detail, position, aliases }>
    const alertBubbles = new Map();

    // 当前展开详情的车辆ID
    let openDetailVehicleId = null;

    /**
     * 初始化
     * @param {AMap.Map} mapInstance
     */
    function init(mapInstance) {
        map = mapInstance;

        // 监听围栏报警事件（来自 admin-websocket.js）
        window.addEventListener('fenceAlert', function (e) {
            const detail = e.detail || {};
            handleFenceAlertUI(detail);
        });

        // 监听偏离路线报警事件
        window.addEventListener('routeDeviation', function (e) {
            const detail = e.detail || {};
            handleRouteDeviationUI(detail);
        });

        console.log('[报警管理器] 初始化完成');
    }

    /**
     * 处理围栏报警 UI
     * 电子围栏闯入（prohibit + enter）→ 显示气泡
     * 固定车违规出场（fence + leave）→ 显示气泡
     * 离开禁行区（prohibit + leave）→ 解除报警
     */
    function handleFenceAlertUI(detail) {
        if (FENCE_ALERT_UI_MODE === 'runtime_cache') {
            return;
        }

        const { vehicleId, fenceType, eventType, latitude, longitude } = detail;

        if (!vehicleId) return;

        if (eventType === 'enter' && fenceType === 'prohibit') {
            // 电子围栏闯入
            const pos = (latitude && longitude) ? [longitude, latitude] : null;
            showAlertBubble(vehicleId, pos, 'fence_enter', detail);

        } else if (eventType === 'leave' && fenceType === 'fence') {
            // 固定车违规出场
            const pos = (latitude && longitude) ? [longitude, latitude] : null;
            showAlertBubble(vehicleId, pos, 'fence_leave', detail);

        } else if (eventType === 'leave' && fenceType === 'prohibit') {
            // 离开禁行区，解除报警
            removeAlertBubble(vehicleId, {
                nextVehicleState: {
                    inRestricted: false,
                    inFence: detail.inFence
                }
            });
            removeAlertBubble(detail.plateNumber, {
                nextVehicleState: {
                    inRestricted: false,
                    inFence: detail.inFence
                }
            });
            removeAlertBubble(detail.deviceId, {
                nextVehicleState: {
                    inRestricted: false,
                    inFence: detail.inFence
                }
            });
        } else if (eventType === 'enter' && fenceType === 'fence') {
            // 回到工地范围，解除违规出场报警
            removeAlertBubble(vehicleId, {
                nextVehicleState: {
                    inFence: true,
                    inRestricted: detail.inRestricted
                }
            });
            removeAlertBubble(detail.plateNumber, {
                nextVehicleState: {
                    inFence: true,
                    inRestricted: detail.inRestricted
                }
            });
            removeAlertBubble(detail.deviceId, {
                nextVehicleState: {
                    inFence: true,
                    inRestricted: detail.inRestricted
                }
            });
        }
    }

    /**
     * 处理偏离路线报警 UI
     */
    function handleRouteDeviationUI(detail) {
        const { vehicleId, latitude, longitude } = detail;
        if (!vehicleId) {
            console.warn('[报警管理器] 偏离路线报警缺少必要字段');
            return;
        }
        const pos = (latitude && longitude) ? [longitude, latitude] : null;
        showAlertBubble(vehicleId, pos, 'route_deviation', detail);
    }

    function getRequestHeaders() {
        const token = sessionStorage.getItem('authToken') || '';
        const headers = {
            'Content-Type': 'application/json'
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        return headers;
    }

    function getProjectId(detail) {
        if (detail && detail.projectId) {
            return detail.projectId;
        }

        if (detail && detail.raw && detail.raw.project_id) {
            return detail.raw.project_id;
        }

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
        } catch (error) {
            console.warn('[报警管理器] 获取项目ID失败:', error);
        }

        return null;
    }

    async function fetchJson(url) {
        const response = await fetch(url, {
            method: 'GET',
            headers: getRequestHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response.json();
    }

    function extractList(data) {
        if (!data) return [];
        if (Array.isArray(data)) return data;
        if (Array.isArray(data.list)) return data.list;
        if (Array.isArray(data.items)) return data.items;
        return [];
    }

    function pickTaskId(task) {
        return task && (task.id || task.task_id || task.taskId);
    }

    function mapTaskDetail(task, baseDetail) {
        const vehicle = task.vehicle || {};
        const normalizedBase = mergeAlertDetail({}, baseDetail);
        const rawVehicleType = pickFirstMeaningful(
            normalizedBase.vehicleType,
            normalizedBase.vehicleSourceType,
            task.vehicle_type,
            vehicle.vehicle_type
        );
        const normalizedVehicleType = normalizeVehicleType(rawVehicleType);
        const resolvedVehicleTypeText = pickFirstMeaningful(
            normalizedBase.vehicleTypeText,
            VEHICLE_TYPE_MAP[normalizedVehicleType],
            VEHICLE_TYPE_MAP[rawVehicleType],
            '未知'
        );

        return mergeAlertDetail(normalizedBase, {
            taskId: pickTaskId(task) || normalizedBase.taskId || null,
            taskName: pickFirstMeaningful(task.task_name, task.taskName, normalizedBase.taskName, normalizedBase.lineName, '-'),
            plateNumber: pickFirstMeaningful(task.plate_number, normalizedBase.plateNumber, normalizedBase.vehicleId, '-'),
            deviceId: pickFirstMeaningful(
                normalizedBase.deviceId,
                vehicle.tracker_name,
                vehicle.trackerName,
                vehicle.tracker_id,
                vehicle.trackerId,
                vehicle.device_id,
                vehicle.deviceId
            ),
            vehicleType: normalizedVehicleType || rawVehicleType,
            vehicleTypeText: resolvedVehicleTypeText,
            driverName: pickFirstMeaningful(normalizedBase.driverName, task.driver_name, vehicle.driver_name, '-'),
            driverPhone: pickFirstMeaningful(normalizedBase.driverPhone, task.phone, vehicle.phone, '-'),
            routeName: pickFirstMeaningful(task.line_name, normalizedBase.lineName, ''),
            routePolylineId: task.route_polyline_id || normalizedBase.polylineId || null,
            taskScope: task.task_scope !== undefined ? task.task_scope : normalizedBase.taskScope
        });
    }

    function pickVehicleId(vehicle) {
        return vehicle && (vehicle.vehicle_id || vehicle.vehicleId || vehicle.id);
    }

    function mapVehicleDetail(vehicle, baseDetail) {
        const normalizedBase = mergeAlertDetail({}, baseDetail);
        const rawVehicleType = pickFirstMeaningful(
            normalizedBase.vehicleType,
            vehicle.vehicle_type,
            vehicle.vehicleType
        );
        const normalizedVehicleType = normalizeVehicleType(rawVehicleType);

        return mergeAlertDetail(normalizedBase, {
            vehicleId: pickFirstMeaningful(normalizedBase.vehicleId, pickVehicleId(vehicle)),
            plateNumber: pickFirstMeaningful(vehicle.plate_number, vehicle.plateNumber, normalizedBase.plateNumber, '-'),
            deviceId: pickFirstMeaningful(
                normalizedBase.deviceId,
                vehicle.tracker_name,
                vehicle.trackerName,
                vehicle.tracker_id,
                vehicle.trackerId,
                vehicle.device_id,
                vehicle.deviceId,
                '-'
            ),
            taskName: pickFirstMeaningful(normalizedBase.taskName, '暂无任务'),
            vehicleType: normalizedVehicleType || rawVehicleType,
            vehicleTypeText: pickFirstMeaningful(
                normalizedBase.vehicleTypeText,
                VEHICLE_TYPE_MAP[normalizedVehicleType],
                VEHICLE_TYPE_MAP[rawVehicleType],
                '未知'
            ),
            driverName: pickFirstMeaningful(normalizedBase.driverName, vehicle.driver_name, vehicle.driverName, '-'),
            driverPhone: pickFirstMeaningful(normalizedBase.driverPhone, vehicle.phone, vehicle.driver_phone, vehicle.driverPhone, '-')
        });
    }

    function chooseTaskFromList(taskList, detail) {
        if (!Array.isArray(taskList) || taskList.length === 0) {
            return null;
        }

        const normalizedPlate = String(detail.plateNumber || detail.vehicleId || '').trim();
        const normalizedLineName = String(detail.lineName || '').trim();
        const targetPolylineId = detail.polylineId !== undefined && detail.polylineId !== null
            ? String(detail.polylineId)
            : '';
        const targetTaskScope = detail.taskScope !== undefined && detail.taskScope !== null
            ? String(detail.taskScope)
            : '';

        let bestTask = null;
        let bestScore = -1;

        taskList.forEach(item => {
            let score = 0;
            if (String(item.plate_number || '').trim() === normalizedPlate) score += 10;
            if (targetPolylineId && String(item.route_polyline_id || item.polyline_id || '') === targetPolylineId) score += 6;
            if (normalizedLineName && String(item.line_name || item.task_name || '').trim() === normalizedLineName) score += 4;
            if (targetTaskScope && String(item.task_scope) === targetTaskScope) score += 3;
            if (item.status === 2 || item.status === '2') score += 3;
            if (item.status === 1 || item.status === '1') score += 1;

            if (score > bestScore) {
                bestTask = item;
                bestScore = score;
            }
        });

        return bestTask || taskList[0];
    }

    function filterTaskListByDetail(taskList, plateNumber, status) {
        if (!Array.isArray(taskList) || taskList.length === 0) {
            return [];
        }

        return taskList.filter(item => {
            const matchesPlate = !plateNumber || String(item.plate_number || item.plateNumber || '').trim() === String(plateNumber).trim();
            const matchesStatus = status === undefined || status === null || status === ''
                ? true
                : String(item.status) === String(status);
            return matchesPlate && matchesStatus;
        });
    }

    async function fetchTaskList(projectId, plateNumber, status) {
        if (!projectId) {
            return [];
        }

        // 优先尝试历史筛选参数；若后端不支持，则回退为文档明确可用的项目任务列表后前端本地匹配。
        if (plateNumber) {
            try {
                const query = new URLSearchParams();
                query.set('plate_number', plateNumber);
                if (status !== undefined && status !== null && status !== '') {
                    query.set('status', String(status));
                }

                const filteredUrl = `${TRANSPORT_API_BASE}/tasks/project/${encodeURIComponent(projectId)}?${query.toString()}`;
                const filteredResult = await fetchJson(filteredUrl);
                const filteredList = extractList(filteredResult.data);
                if (filteredList.length > 0) {
                    return filteredList;
                }
            } catch (error) {
                console.warn('[报警管理器] 任务筛选查询失败，回退项目任务列表本地匹配:', {
                    projectId,
                    plateNumber,
                    status,
                    error: error && error.message ? error.message : error
                });
            }
        }

        const url = `${TRANSPORT_API_BASE}/tasks/project/${encodeURIComponent(projectId)}`;
        const result = await fetchJson(url);
        return filterTaskListByDetail(extractList(result.data), plateNumber, status);
    }

    async function fetchTaskDetail(taskId) {
        if (!taskId) return null;
        const url = `${TRANSPORT_API_BASE}/tasks/${encodeURIComponent(taskId)}`;
        const result = await fetchJson(url);
        return result && result.data ? result.data : null;
    }

    function chooseVehicleFromList(vehicleList, detail) {
        if (!Array.isArray(vehicleList) || vehicleList.length === 0) {
            return null;
        }

        const targetPlate = String(detail.plateNumber || detail.vehicleId || '').trim();
        const targetDevice = String(detail.deviceId || detail.trackerID || detail.trackerId || '').trim();

        let bestVehicle = null;
        let bestScore = -1;

        vehicleList.forEach(item => {
            let score = 0;
            if (targetPlate && String(item.plate_number || item.plateNumber || '').trim() === targetPlate) score += 10;
            if (targetDevice && String(
                item.tracker_name || item.trackerName || item.tracker_id || item.trackerId || item.device_id || item.deviceId || ''
            ).trim() === targetDevice) score += 8;

            if (score > bestScore) {
                bestScore = score;
                bestVehicle = item;
            }
        });

        return bestVehicle || vehicleList[0];
    }

    async function fetchVehicleList(projectId, plateNumber, deviceId) {
        if (!projectId || (!plateNumber && !deviceId)) {
            return [];
        }

        const query = new URLSearchParams();
        query.set('project_ids', projectId);
        query.set('keyword', plateNumber || deviceId);

        const url = `${TRANSPORT_API_BASE}/vehicles?${query.toString()}`;
        const result = await fetchJson(url);
        let vehicleList = extractList(result.data);

        if ((!vehicleList || vehicleList.length === 0) && deviceId && plateNumber && deviceId !== plateNumber) {
            const deviceQuery = new URLSearchParams();
            deviceQuery.set('project_ids', projectId);
            deviceQuery.set('keyword', deviceId);
            const fallbackUrl = `${TRANSPORT_API_BASE}/vehicles?${deviceQuery.toString()}`;
            const fallbackResult = await fetchJson(fallbackUrl);
            vehicleList = extractList(fallbackResult.data);
        }

        return vehicleList;
    }

    async function fetchVehicleDetail(vehicleId) {
        if (!vehicleId) return null;
        const url = `${TRANSPORT_API_BASE}/vehicles/${encodeURIComponent(vehicleId)}`;
        const result = await fetchJson(url);
        return result && result.data ? result.data : null;
    }

    async function fetchAlertTaskDetail(detail) {
        const projectId = getProjectId(detail);
        if (!projectId) {
            return null;
        }

        if (detail.taskId) {
            const directTask = await fetchTaskDetail(detail.taskId);
            if (directTask) {
                return directTask;
            }
        }

        const plateNumber = detail.plateNumber || detail.vehicleId;
        if (!plateNumber) {
            return null;
        }

        // 先查进行中(status=2)，再回退到已下发(status=1)，最后回退到项目全部任务
        let selectedTask = null;
        const inProgressTasks = await fetchTaskList(projectId, plateNumber, 2);
        selectedTask = chooseTaskFromList(inProgressTasks, detail);

        if (!selectedTask) {
            const issuedTasks = await fetchTaskList(projectId, plateNumber, 1);
            selectedTask = chooseTaskFromList(issuedTasks, detail);
        }

        if (!selectedTask) {
            const allTasks = await fetchTaskList(projectId, plateNumber);
            selectedTask = chooseTaskFromList(allTasks, detail);
        }

        if (!selectedTask) {
            return null;
        }

        const selectedTaskId = pickTaskId(selectedTask);
        if (selectedTaskId) {
            const fullTask = await fetchTaskDetail(selectedTaskId);
            return fullTask || selectedTask;
        }

        return selectedTask;
    }

    async function fetchAlertVehicleDetail(detail) {
        const projectId = getProjectId(detail);
        const plateNumber = detail.plateNumber || detail.vehicleId;
        const deviceId = detail.deviceId || detail.trackerID || detail.trackerId || '';
        if (!projectId || (!plateNumber && !deviceId)) {
            return null;
        }

        let vehicleId = detail.vehicleId && /^\d+$/.test(String(detail.vehicleId))
            ? detail.vehicleId
            : null;

        if (!vehicleId) {
            const vehicleList = await fetchVehicleList(projectId, plateNumber, deviceId);
            const selectedVehicle = chooseVehicleFromList(vehicleList, detail);
            let resolvedVehicle = selectedVehicle;

            if (!resolvedVehicle && typeof AdminVehicleManager !== 'undefined' && typeof AdminVehicleManager.getVehicleByIdentifier === 'function') {
                resolvedVehicle = AdminVehicleManager.getVehicleByIdentifier(deviceId) || AdminVehicleManager.getVehicleByIdentifier(plateNumber);
            }

            vehicleId = pickVehicleId(resolvedVehicle || selectedVehicle);
            if (!vehicleId && resolvedVehicle) {
                return resolvedVehicle;
            }
            if (!vehicleId && selectedVehicle) {
                return selectedVehicle;
            }
        }

        if (!vehicleId) {
            return null;
        }

        return fetchVehicleDetail(vehicleId);
    }

    function refreshOpenDetailCardIfNeeded(alertKey) {
        if (openDetailVehicleId !== alertKey) {
            return;
        }

        const alertData = alertBubbles.get(alertKey);
        if (!alertData) {
            return;
        }

        if (!alertData.detailMarker) {
            openDetailCard(alertKey);
            return;
        }

        if (typeof alertData.detailMarker.setContent === 'function') {
            alertData.detailMarker.setContent(buildDetailCardHtml(alertData.detail, alertKey, false));
        }
    }

    async function enrichAlertDetailAsync(detail, vehicleId) {
        const alertKey = getAlertKey(detail, vehicleId);
        const alertData = alertBubbles.get(alertKey);
        if (!alertData) {
            return;
        }

        if (alertData.detailLoading || alertData.detailLoaded) {
            return;
        }

        if (!needsAlertDetailEnrichment(alertData.detail)) {
            alertData.detailLoaded = true;
            alertBubbles.set(alertKey, alertData);
            return;
        }

        alertData.detailLoading = true;
        alertBubbles.set(alertKey, alertData);

        try {
            const baseDetail = mergeAlertDetail(alertData.detail, detail);
            let enrichedDetail = null;
            const taskDetail = await fetchAlertTaskDetail(baseDetail);

            if (taskDetail) {
                enrichedDetail = mapTaskDetail(taskDetail, baseDetail);
            } else {
                const vehicleDetail = await fetchAlertVehicleDetail(baseDetail);
                if (vehicleDetail) {
                    enrichedDetail = mapVehicleDetail(vehicleDetail, baseDetail);
                }
            }

            const latest = alertBubbles.get(alertKey);
            if (!latest) {
                return;
            }

            if (enrichedDetail) {
                latest.detail = mergeAlertDetail(latest.detail || detail || {}, enrichedDetail);
                latest.aliases = getAlertAliases(latest.detail, alertKey);
            }

            latest.detailLoaded = true;
            latest.detailLoading = false;
            alertBubbles.set(alertKey, latest);
            refreshOpenDetailCardIfNeeded(alertKey);
        } catch (error) {
            const latest = alertBubbles.get(alertKey);
            if (latest) {
                latest.detailLoading = false;
                latest.detailLoaded = true;
                alertBubbles.set(alertKey, latest);
            }
            console.warn('[报警管理器] 补齐报警详情失败:', {
                alertKey,
                error: error && error.message ? error.message : error
            });
        }
    }

    function getAlertKey(detail, vehicleId) {
        return String(
            (detail && (detail.alertKey || detail.deviceId || detail.plateNumber || detail.vehicleId || detail.sourceId)) ||
            vehicleId ||
            ''
        );
    }

    function getAlertAliases(detail, vehicleId) {
        return Array.from(new Set([
            vehicleId,
            detail && detail.alertKey,
            detail && detail.vehicleId,
            detail && detail.plateNumber,
            detail && detail.deviceId,
            detail && detail.sourceId
        ].filter(Boolean).map(String)));
    }

    function getVehicleRuntimeContext(identifier) {
        if (!identifier || typeof AdminVehicleManager === 'undefined') {
            return { vehicle: null, marker: null };
        }

        const marker = typeof AdminVehicleManager.findVehicleMarker === 'function'
            ? AdminVehicleManager.findVehicleMarker(identifier)
            : null;
        const vehicle = typeof AdminVehicleManager.getVehicleByIdentifier === 'function'
            ? AdminVehicleManager.getVehicleByIdentifier(identifier)
            : null;

        return { vehicle, marker };
    }

    function resolveVehicleContext(detail, fallbackPosition) {
        const result = {
            position: fallbackPosition ? [...fallbackPosition] : null,
            mergedDetail: mergeAlertDetail({}, detail || {})
        };

        if (typeof AdminVehicleManager === 'undefined') {
            return result;
        }

        const identifiers = getAlertAliases(detail || {}, detail && detail.vehicleId);
        for (const identifier of identifiers) {
            const context = getVehicleRuntimeContext(identifier);
            const marker = context.marker;
            const vehicle = context.vehicle;

            if (!result.position && vehicle && isMeaningful(vehicle.longitude) && isMeaningful(vehicle.latitude)) {
                result.position = [Number(vehicle.longitude), Number(vehicle.latitude)];
            }

            if (marker && typeof marker.getPosition === 'function') {
                const pos = marker.getPosition();
                if (!result.position) {
                    result.position = [pos.lng, pos.lat];
                }
                const extData = marker.getExtData ? marker.getExtData() : {};
                result.mergedDetail = mergeAlertDetail(
                    mergeAlertDetail(result.mergedDetail, vehicle || {}),
                    {
                        ...extData,
                        vehicleId: pickFirstMeaningful(extData.vehicleId, result.mergedDetail.vehicleId, identifier),
                        plateNumber: pickFirstMeaningful(extData.plateNumber, vehicle && vehicle.plateNumber, result.mergedDetail.plateNumber),
                        deviceId: pickFirstMeaningful(extData.deviceId, vehicle && vehicle.deviceId, result.mergedDetail.deviceId),
                        sourceId: pickFirstMeaningful(extData.sourceId, vehicle && vehicle.sourceId, result.mergedDetail.sourceId),
                        taskName: pickFirstMeaningful(result.mergedDetail.taskName, extData.taskName, vehicle && vehicle.taskName),
                        driverName: pickFirstMeaningful(extData.driverName, vehicle && vehicle.driverName, result.mergedDetail.driverName),
                        driverPhone: pickFirstMeaningful(extData.driverPhone, vehicle && vehicle.driverPhone, result.mergedDetail.driverPhone),
                        vehicleType: pickFirstMeaningful(
                            normalizeVehicleType(extData.type),
                            normalizeVehicleType(extData.vehicleType),
                            vehicle && normalizeVehicleType(vehicle.type),
                            vehicle && normalizeVehicleType(vehicle.vehicleType),
                            result.mergedDetail.vehicleType
                        )
                    }
                );
                return result;
            }

            if (vehicle) {
                result.mergedDetail = mergeAlertDetail(result.mergedDetail, vehicle);
            }
        }

        return result;
    }

    /**
     * 在地图上显示报警气泡
     * @param {string} vehicleId - 车辆ID（用于唯一标识）
     * @param {Array} position - [lng, lat]
     * @param {string} alertType - 'fence_enter' | 'fence_leave' | 'route_deviation'
     * @param {Object} detail - 完整报警数据
     */
    function showAlertBubble(vehicleId, position, alertType, detail) {
        const alertKey = getAlertKey(detail, vehicleId);
        const aliases = getAlertAliases(detail || {}, vehicleId);
        const resolved = resolveVehicleContext(detail || {}, position);
        const finalDetail = mergeAlertDetail({}, resolved.mergedDetail);
        const rawAlertPosition = (detail && detail.longitude && detail.latitude)
            ? [detail.longitude, detail.latitude]
            : null;
        const finalPosition = rawAlertPosition || resolved.position;

        if (!finalPosition) {
            console.warn('[报警管理器] 无法定位报警车辆，缺少位置与车辆标记:', alertKey, detail);
            return;
        }

        const existingKey = findAlertKey(alertKey);
        if (existingKey) {
            const existing = alertBubbles.get(existingKey);
            if (existing) {
                const mergedAliases = Array.from(new Set([...(existing.aliases || []), ...aliases]));
                const mergedDetail = mergeAlertDetail(existing.detail, finalDetail);
                existing.alertType = alertType;
                existing.aliases = mergedAliases;
                existing.detail = mergedDetail;
                existing.position = [...finalPosition];
                alertBubbles.set(existingKey, existing);
                updateBubblePosition(existingKey, finalPosition);

                console.log(`[报警管理器] 更新现有报警气泡: ${existingKey} (${alertType})`);
                if (!existing.detailLoaded && !existing.detailLoading) {
                    enrichAlertDetailAsync(existing.detail, existingKey);
                }
                return;
            }
        }

        const plateNumber = finalDetail.plateNumber || alertKey;
        const showIntrusionTag = alertType === 'fence_enter';
        const bubbleWidth = showIntrusionTag ? 116 : ALERT_LAYOUT.bubbleWidth;
        const bubbleBodyHtml = showIntrusionTag
            ? `
                <div style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 6px;
                    width: 100%;
                    overflow: hidden;
                ">
                    <span style="
                        min-width: 0;
                        flex: 1;
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    ">${plateNumber}</span>
                    <span style="
                        flex-shrink: 0;
                        color: ${ALERT_STYLE.bubbleBorder};
                        font-weight: 600;
                    ">闯入</span>
                </div>
            `
            : plateNumber;

        // 气泡 HTML：白底红框，底部红色三角指针
        // 整体宽度固定，尖端指向统一锚点
        const bubbleHtml = `
<div style="
    position: relative;
    display: inline-block;
    cursor: pointer;
    user-select: none;
    animation: alertBubbleIn 180ms ease-out;
">
    <style>
        @keyframes alertBubbleIn {
            from { transform: translateY(6px) scale(0.96); opacity: 0; }
            to   { transform: translateY(0) scale(1); opacity: 1; }
        }
    </style>
    <div style="
        background: ${ALERT_STYLE.bubbleBackground};
        border: 1px solid ${ALERT_STYLE.bubbleBorder};
        border-radius: 6px;
        width: ${bubbleWidth}px;
        height: ${ALERT_LAYOUT.bubbleHeight}px;
        box-sizing: border-box;
        padding: 3px 7px;
        font-size: 13px;
        font-weight: 500;
        color: ${ALERT_STYLE.bubbleText};
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(255, 214, 214, 0.6);
        font-family: 'PingFang SC', 'Helvetica Neue', Arial, sans-serif;
        letter-spacing: 0;
        line-height: 20px;
    ">${bubbleBodyHtml}</div>
    <div style="
        position: absolute;
        bottom: -${ALERT_LAYOUT.bubblePointer}px;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 7px solid transparent;
        border-right: 7px solid transparent;
        border-top: ${ALERT_LAYOUT.bubblePointer}px solid ${ALERT_STYLE.bubbleBorder};
    "></div>
    <div style="
        position: absolute;
        bottom: -${ALERT_LAYOUT.bubblePointer - 2}px;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-top: ${ALERT_LAYOUT.bubblePointer - 1}px solid ${ALERT_STYLE.bubbleBackground};
    "></div>
</div>`;

        // 尖端锚点固定指向车辆统一位置
        const bubbleMarker = new AMap.Marker({
            position: finalPosition,
            content: bubbleHtml,
            offset: new AMap.Pixel(
                -Math.round(bubbleWidth / 2),
                -(ALERT_LAYOUT.bubbleHeight + ALERT_LAYOUT.bubblePointer)
            ),
            zIndex: 200,
            map: map
        });

        // 点击气泡切换详情卡片
        bubbleMarker.on('click', function () {
            toggleDetailCard(alertKey);
        });

        alertBubbles.set(alertKey, {
            bubbleMarker,
            detailMarker: null,
            alertType,
            detail: finalDetail,
            position: [...finalPosition],
            aliases,
            detailLoading: false,
            detailLoaded: !needsAlertDetailEnrichment(finalDetail)
        });

        if (needsAlertDetailEnrichment(finalDetail)) {
            enrichAlertDetailAsync(finalDetail, alertKey);
        }

        console.log(`[报警管理器] 显示报警气泡: ${alertKey} (${alertType})`);
    }

    /**
     * 切换详情卡片显示/隐藏
     */
    function toggleDetailCard(vehicleId) {
        const alertData = alertBubbles.get(vehicleId);
        if (!alertData) return;

        if (openDetailVehicleId === vehicleId && alertData.detailMarker) {
            // 已展开 → 关闭
            closeDetailCard(vehicleId);
        } else {
            // 关闭其他已展开的详情
            if (openDetailVehicleId && openDetailVehicleId !== vehicleId) {
                closeDetailCard(openDetailVehicleId);
            }
            // 展开当前
            openDetailCard(vehicleId);
        }
    }

    /**
     * 展开详情卡片
     */
    function openDetailCard(vehicleId) {
        const alertData = alertBubbles.get(vehicleId);
        if (!alertData) return;

        const { detail, position } = alertData;
        const detailHtml = buildDetailCardHtml(detail, vehicleId, true);

        // 底部尖端锚点与车牌气泡保持一致，始终指向车辆同一点
        const detailMarker = new AMap.Marker({
            position: position,
            content: detailHtml,
            offset: new AMap.Pixel(
                -Math.round(ALERT_LAYOUT.detailWidth / 2),
                -ALERT_LAYOUT.detailOffsetY
            ),
            zIndex: 300,
            map: map
        });

        if (alertData.bubbleMarker) {
            alertData.bubbleMarker.hide();
        }

        // 绑定关闭按钮点击（通过 DOM 事件，因为 AMap.Marker 的 click 事件不能精确区分子元素）
        detailMarker.on('click', function (e) {
            // 通过 originEvent 获取原生事件目标
            const nativeTarget = e.originEvent && e.originEvent.target;
            if (nativeTarget) {
                const closeBtn = nativeTarget.closest
                    ? nativeTarget.closest(`#alert-detail-close-${vehicleId}`)
                    : (nativeTarget.id === `alert-detail-close-${vehicleId}` ? nativeTarget : null);
                if (closeBtn) {
                    closeDetailCard(vehicleId);
                }
            }
        });

        alertData.detailMarker = detailMarker;
        alertBubbles.set(vehicleId, alertData);
        openDetailVehicleId = vehicleId;

        console.log(`[报警管理器] 展开详情卡片: ${vehicleId}`);
    }

    /**
     * 构建详情行 HTML
     */
    function buildDetailRow(label, value) {
        return `
<div style="
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 0;
    font-size: 12px;
">
    <span style="color: ${ALERT_STYLE.cardLabel}; min-width: 56px; flex-shrink: 0;">${label}</span>
    <span style="color: ${ALERT_STYLE.cardValue}; font-weight: 500; text-align: right; word-break: break-all;">${value}</span>
</div>`;
    }

    function buildDetailCardHtml(detail, vehicleId, withAnimation) {
        const plateNumber = detail && detail.plateNumber ? detail.plateNumber : vehicleId;
        const deviceId = detail && detail.deviceId ? detail.deviceId : '-';
        const vehicleTypeText = (detail && detail.vehicleTypeText) || VEHICLE_TYPE_MAP[detail && detail.vehicleType] || '临时车';
        const taskName = (detail && (detail.taskName || detail.lineName)) || '-';
        const driverName = detail && detail.driverName ? detail.driverName : '-';
        const driverPhone = detail && detail.driverPhone ? detail.driverPhone : '-';
        const animationStyle = withAnimation ? 'animation: alertDetailIn 220ms ease-out;' : '';
        const animationBlock = withAnimation ? `
    <style>
        @keyframes alertDetailIn {
            from { transform: translateY(8px) scale(0.97); opacity: 0; }
            to   { transform: translateY(0) scale(1); opacity: 1; }
        }
    </style>` : '';

        return `
<div style="
    background: ${ALERT_STYLE.cardBackground};
    border: 1px solid ${ALERT_STYLE.cardBorder};
    border-radius: 8px;
    width: ${ALERT_LAYOUT.detailWidth}px;
    box-shadow: 0 4px 12px rgba(255, 214, 214, 0.45);
    font-family: 'PingFang SC', 'Helvetica Neue', Arial, sans-serif;
    position: relative;
    overflow: visible;
    ${animationStyle}
">
    ${animationBlock}
    <!-- 标题行 -->
    <div style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px 6px;
    ">
        <span style="font-size: 15px; font-weight: 500; color: ${ALERT_STYLE.cardTitle};">详情</span>
        <span
            id="alert-detail-close-${vehicleId}"
            style="
                font-size: 18px;
                color: ${ALERT_STYLE.close};
                cursor: pointer;
                line-height: 1;
                padding: 0 2px;
                font-weight: normal;
            "
        >×</span>
    </div>
    <!-- 内容行 -->
    <div style="padding: 2px 12px 10px;">
        ${buildDetailRow('运输任务', taskName)}
        ${buildDetailRow('车牌号', plateNumber)}
        ${buildDetailRow('定位器', deviceId)}
        ${buildDetailRow('车辆类型', vehicleTypeText)}
        ${buildDetailRow('司机姓名', driverName)}
        ${buildDetailRow('联系电话', driverPhone)}
    </div>
    <!-- 底部三角指针 -->
    <div style="
        position: absolute;
        bottom: -${ALERT_LAYOUT.detailPointer}px;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 8px solid transparent;
        border-right: 8px solid transparent;
        border-top: ${ALERT_LAYOUT.detailPointer}px solid ${ALERT_STYLE.cardBorder};
    "></div>
    <div style="
        position: absolute;
        bottom: -${ALERT_LAYOUT.detailPointer - 2}px;
        left: 50%;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 7px solid transparent;
        border-right: 7px solid transparent;
        border-top: ${ALERT_LAYOUT.detailPointer - 1}px solid ${ALERT_STYLE.cardBackground};
    "></div>
</div>`;
    }

    /**
     * 关闭详情卡片
     */
    function closeDetailCard(vehicleId) {
        const alertData = alertBubbles.get(vehicleId);
        if (!alertData) return;

        if (alertData.detailMarker) {
            map.remove(alertData.detailMarker);
            alertData.detailMarker = null;
            alertBubbles.set(vehicleId, alertData);
        }

        if (alertData.bubbleMarker) {
            alertData.bubbleMarker.show();
        }

        if (openDetailVehicleId === vehicleId) {
            openDetailVehicleId = null;
        }

        console.log(`[报警管理器] 关闭详情卡片: ${vehicleId}`);
    }

    /**
     * 移除报警气泡（报警解除时调用）
     * @param {string} vehicleId
     */
    function removeAlertBubble(vehicleId, options) {
        const targetKey = findAlertKey(vehicleId);
        if (!targetKey) return;
        const alertData = alertBubbles.get(targetKey);
        if (!alertData) return;
        const normalizedOptions = (typeof options === 'object' && options !== null) ? options : {};
        const nextVehicleState = normalizedOptions.nextVehicleState || null;

        if (alertData.bubbleMarker) {
            map.remove(alertData.bubbleMarker);
        }
        if (alertData.detailMarker) {
            map.remove(alertData.detailMarker);
        }

        alertBubbles.delete(targetKey);

        if (openDetailVehicleId === targetKey) {
            openDetailVehicleId = null;
        }

        console.log(`[报警管理器] 移除报警气泡: ${targetKey}`);
    }

    function findAlertKey(identifier) {
        if (!identifier) return null;
        const target = String(identifier);
        if (alertBubbles.has(target)) return target;

        for (const [key, data] of alertBubbles.entries()) {
            if (Array.isArray(data.aliases) && data.aliases.some(alias => String(alias) === target)) {
                return key;
            }
        }
        return null;
    }

    /**
     * 更新气泡和详情卡片的位置（车辆移动时同步调用）
     * @param {string} vehicleId
     * @param {Array} newPosition - [lng, lat]
     */
    function updateBubblePosition(vehicleId, newPosition) {
        const targetKey = findAlertKey(vehicleId);
        if (!targetKey) return;
        const alertData = alertBubbles.get(targetKey);
        if (!alertData) return;

        if (alertData.bubbleMarker) {
            alertData.bubbleMarker.setPosition(newPosition);
        }
        if (alertData.detailMarker) {
            alertData.detailMarker.setPosition(newPosition);
        }

        alertData.position = [...newPosition];
        alertBubbles.set(targetKey, alertData);
    }

    /**
     * 车辆移动时按别名同步报警气泡位置，并补充详情字段
     */
    function syncVehicleAlertPosition(identifiers, newPosition, vehicleInfo) {
        if (!Array.isArray(identifiers)) return;

        identifiers.forEach(identifier => {
            const targetKey = findAlertKey(identifier);
            if (!targetKey) return;

            const alertData = alertBubbles.get(targetKey);
            if (!alertData) return;

            if (vehicleInfo) {
                alertData.aliases = Array.from(new Set([
                    ...(alertData.aliases || []),
                    ...getAlertAliases(vehicleInfo, targetKey)
                ]));
                alertData.detail = mergeAlertDetail(alertData.detail, vehicleInfo);
                alertData.detailLoaded = alertData.detailLoaded || !needsAlertDetailEnrichment(alertData.detail);
            }

            alertData.position = [...newPosition];
            alertBubbles.set(targetKey, alertData);
            updateBubblePosition(targetKey, newPosition);
        });
    }

    /**
     * 清除所有报警气泡
     */
    function clearAll() {
        const ids = Array.from(alertBubbles.keys());
        ids.forEach(id => removeAlertBubble(id));
    }

    /**
     * 获取当前所有报警车辆ID
     */
    function getAlertVehicleIds() {
        return Array.from(alertBubbles.keys());
    }

    /**
     * 检查某车辆是否处于报警状态
     */
    function isVehicleAlerting(vehicleId) {
        return !!findAlertKey(vehicleId);
    }

    function openAlertDetailByIdentifier(identifier) {
        const targetKey = findAlertKey(identifier);
        if (!targetKey) return false;
        toggleDetailCard(targetKey);
        return true;
    }

    return {
        init,
        showAlertBubble,
        removeAlertBubble,
        updateBubblePosition,
        syncVehicleAlertPosition,
        clearAll,
        getAlertVehicleIds,
        isVehicleAlerting,
        openAlertDetailByIdentifier
    };
})();

console.log('[报警管理器] 模块已加载');
