// driver-road-status.js
// 司机端道路状态显示功能
// 数据来源：GET /api/video/roadlines?project_id={id}
// 状态字段：ai_road_status (0=畅通 1=缓行 2=拥堵 3=阻断)

// 司机端路段状态缓存：Map<`${start_id}_${end_id}`, ai_road_status>
// 只在状态变化时才更新，避免每次轮询都重复请求点坐标
const driverRoadStatusCache = new Map();

const DRIVER_ROAD_STATUS_COLORS = Object.freeze({
    0: '#9AE59D',
    1: '#FAAD14',
    2: '#F5222D',
    3: '#8C8C8C'
});
const DRIVER_ROAD_STATUS_ICON_BASE = 'images/工地数字导航小程序切图/地图icon/';
const DRIVER_ROAD_STATUS_ICON_FILES = Object.freeze({
    2: 'icon-拥堵.png',
    3: 'icon-阻断.png'
});

// 司机端路况图标缓存：Map<`${start_id}_${end_id}`, AMap.Marker>
// 用于管理地图上的拥堵/阻断提示图标，状态恢复时精确移除
const driverBlockedRoadMarkers = new Map();

function getDriverRoadStatusIconPath(status) {
    const fileName = DRIVER_ROAD_STATUS_ICON_FILES[status];
    return fileName ? `${DRIVER_ROAD_STATUS_ICON_BASE}${fileName}` : '';
}

/**
 * 自动加载道路状态并显示颜色
 * 在KML数据加载完成后调用
 */
async function autoLoadDriverRoadStatus() {
    // 只在折线数量变化时清空道路图缓存
    const currentPolylineCount = window.polylines ? window.polylines.length : 0;
    if (window._lastDriverPolylineCount === undefined) {
        window._lastDriverPolylineCount = currentPolylineCount;
        window.driverRoadGraph = null;
    } else if (currentPolylineCount !== window._lastDriverPolylineCount) {
        console.log('[司机端道路状态] 检测到折线数量变化，清空道路图缓存');
        window.driverRoadGraph = null;
        window._lastDriverPolylineCount = currentPolylineCount;
    }

    console.log('[司机端道路状态] 开始自动加载道路状态...');

    try {
        const roadlines = await fetchAllRoadlines();

        if (!roadlines || roadlines.length === 0) {
            console.warn('[司机端道路状态] 没有路段控制数据');
            if (typeof window.onRoadStatusLoaded === 'function') {
                window.onRoadStatusLoaded();
            }
            return;
        }

        console.log(`[司机端道路状态] 获取到 ${roadlines.length} 条路段控制数据`);

        for (const roadline of roadlines) {
            if (!roadline.start_id || !roadline.end_id) continue;

            const cacheKey = `${roadline.start_id}_${roadline.end_id}`;
            const newStatus = parseInt(roadline.ai_road_status) || 0;
            const oldStatus = driverRoadStatusCache.get(cacheKey);

            // 状态没变化则跳过，避免重复请求
            if (oldStatus !== undefined && oldStatus === newStatus) continue;

            await updateDriverRoadSegmentStatus(
                roadline.start_id,
                roadline.end_id,
                roadline.ai_road_status,
                roadline.line_id,
                (roadline.c_point > 0 ? roadline.c_point : null) || (roadline.CPoint > 0 ? roadline.CPoint : null)
            );

            driverRoadStatusCache.set(cacheKey, newStatus);
        }

        console.log('[司机端道路状态] 道路状态加载完成');

        if (typeof window.onRoadStatusLoaded === 'function') {
            window.onRoadStatusLoaded();
        }
    } catch (error) {
        console.error('[司机端道路状态] 加载失败:', error);
        if (typeof window.onRoadStatusLoaded === 'function') {
            window.onRoadStatusLoaded();
        }
    }
}

/**
 * 获取所有路段控制数据（roadlines）
 * @returns {Promise<Array>}
 */
async function fetchAllRoadlines() {
    try {
        const projectId = getCurrentProjectIdDriver();

        if (!projectId) {
            console.warn('[获取路段] 无法获取项目ID');
            return [];
        }

        const url = `https://dmap.cscec3bxjy.cn/api/video/roadlines?page=1&page_size=1000&project_id=${projectId}`;
        console.log('[获取路段] 请求URL:', url);

        const token = sessionStorage.getItem('authToken') || '';
        const headers = { 'accept': 'application/json' };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(url, { method: 'GET', headers });

        if (!response.ok) {
            console.warn('[获取路段] 请求失败，状态码:', response.status);
            return [];
        }

        const data = await response.json();
        console.log('[获取路段] API完整响应:', JSON.stringify(data, null, 2));

        // 兼容多种响应格式
        if (data.code === 200 && data.data) {
            const list = data.data.list || data.data.items || data.data;
            console.log('[获取路段] 解析到数据条数:', Array.isArray(list) ? list.length : '非数组:' + typeof list);
            return Array.isArray(list) ? list : [];
        }

        // 有些接口直接返回数组
        if (Array.isArray(data)) {
            console.log('[获取路段] 接口直接返回数组，条数:', data.length);
            return data;
        }

        console.warn('[获取路段] 未识别的响应格式:', data);
        return [];
    } catch (error) {
        console.error('[获取路段] 请求失败:', error);
        return [];
    }
}

/**
 * 获取当前项目ID（司机端）
 * @returns {string|null}
 */
function getCurrentProjectIdDriver() {
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
        console.error('[司机端] 获取项目ID失败:', e);
    }
    return null;
}

/**
 * 更新道路段状态颜色
 * @param {number} startId - 起点ID
 * @param {number} endId - 终点ID
 * @param {number|null} aiRoadStatus - AI道路状态值 (0=畅通 1=缓行 2=拥堵 3=阻断)
 */
async function updateDriverRoadSegmentStatus(startId, endId, aiRoadStatus, lineId, cPoint) {
    try {
        console.log('[司机端路段状态] 更新路段:', { startId, endId, aiRoadStatus, lineId, cPoint });

        // 根据 ai_road_status 确定颜色
        // 0=畅通-绿, 1=缓行-黄, 2=拥堵-橘, 3=阻断-红
        let color = DRIVER_ROAD_STATUS_COLORS[0]; // 默认绿色（畅通）
        const status = parseInt(aiRoadStatus);
        if (status === 0) {
            color = DRIVER_ROAD_STATUS_COLORS[0]; // 畅通-绿色
        } else if (status === 1) {
            color = DRIVER_ROAD_STATUS_COLORS[1]; // 缓行-黄色
        } else if (status === 2) {
            color = DRIVER_ROAD_STATUS_COLORS[2]; // 拥堵-红色
        } else if (status === 3) {
            color = DRIVER_ROAD_STATUS_COLORS[3]; // 阻断-灰色（道路禁行色值）
        }

        console.log('[司机端路段状态] ai_road_status:', aiRoadStatus, '-> 颜色:', color);

        // 提前读取旧状态，用于判断是否需要移除阻断图标
        const cacheKey = `${startId}_${endId}`;
        const prevStatus = driverRoadStatusCache.get(cacheKey);

        // ===== 方案1：通过 line_id 直接找折线（最精确）=====
        if (lineId) {
            const result = updateDriverPolylineColorByLineId(lineId, color);
            if (result.updated) {
                console.log('[司机端路段状态] ✓ 通过 line_id 直接更新折线颜色成功');
                // 图标坐标直接来自折线本身，最准确
                await handleDriverBlockedMarker(startId, endId, status, prevStatus, result.midCoord);
                driverRoadStatusCache.set(cacheKey, status);
                return;
            }
            console.warn('[司机端路段状态] line_id 匹配失败，降级到坐标匹配');
        }

        // ===== 方案2：通过 CPoint 坐标匹配（降级方案）=====
        if (cPoint) {
            console.log('[司机端路段状态] 尝试通过 CPoint 坐标匹配...');
            const cPointData = await getDriverPointDetails(cPoint);
            if (cPointData) {
                const [cLng, cLat] = (typeof wgs84ToGcj02 === 'function')
                    ? wgs84ToGcj02(cPointData.longitude, cPointData.latitude)
                    : [cPointData.longitude, cPointData.latitude];
                const result = updateDriverPolylineColorByNearestPoint([cLng, cLat], color);
                if (result.updated) {
                    console.log('[司机端路段状态] ✓ 通过 CPoint 坐标匹配更新折线颜色成功');
                    await handleDriverBlockedMarker(startId, endId, status, prevStatus, result.midCoord);
                    driverRoadStatusCache.set(cacheKey, status);
                    return;
                }
            }
            console.warn('[司机端路段状态] CPoint 坐标匹配失败，降级到起终点 Dijkstra');
        }

        // ===== 方案3：通过起终点坐标 Dijkstra（最后兜底）=====
        const startPoint = await getDriverPointDetails(startId);
        const endPoint = await getDriverPointDetails(endId);

        if (!startPoint || !endPoint) {
            console.warn('[司机端路段状态] 无法获取起点或终点坐标');
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

        console.log('[司机端路段状态] 起点坐标(GCJ02):', startCoord, '终点坐标(GCJ02):', endCoord);

        // 通过坐标查找并更新线段颜色，返回折线路径中点
        const polylineMidCoord = updateDriverPolylineColorByCoords(startCoord, endCoord, color);

        // 处理阻断图标（坐标来自折线本身，最准确）
        await handleDriverBlockedMarker(startId, endId, status, prevStatus, polylineMidCoord);
        driverRoadStatusCache.set(cacheKey, status);

    } catch (error) {
        console.error('[司机端路段状态] 更新失败:', error);
    }
}

/**
 * 处理司机端路况图标的添加/移除
 * 图标坐标由调用方直接从地图折线取得后传入，无需再查 API
 */
async function handleDriverBlockedMarker(startId, endId, status, prevStatus, midCoord) {
    if (status === 2 || status === 3) {
        if (midCoord) {
            addDriverBlockedMarker(startId, endId, midCoord, status);
        } else {
            console.error('[司机端路况图标] 无法获取图标坐标（折线未匹配到）');
        }
    } else if (prevStatus === 2 || prevStatus === 3) {
        // 旧状态是拥堵/阻断，新状态不是 → 移除图标
        removeDriverBlockedMarker(startId, endId);
    }
}

/**
 * 通过 line_id 直接找到对应折线并更新颜色（司机端）
 * @returns {{ updated: boolean, midCoord: Array|null }}
 */
function updateDriverPolylineColorByLineId(lineId, color) {
    if (!window.polylines || window.polylines.length === 0) return { updated: false, midCoord: null };

    const targetId = String(lineId);
    let updatedCount = 0;
    const allPoints = [];

    window.polylines.forEach((polyline, idx) => {
        if (!polyline || typeof polyline.getExtData !== 'function') return;
        const extData = polyline.getExtData();
        if (extData && String(extData.lineId) === targetId) {
            polyline.setOptions({ strokeColor: color });
            updatedCount++;
            console.log(`[司机端路段颜色] ✓ line_id=${targetId} 匹配折线[${idx}]，颜色:`, color);
            const path = polyline.getPath ? polyline.getPath() : null;
            if (path) path.forEach(pt => allPoints.push([pt.lng, pt.lat]));
        }
    });

    if (updatedCount === 0) return { updated: false, midCoord: null };

    // 去重：分割后相邻段共享端点，去掉重复点，还原原始折线的节点序列
    // 例如：[A,X, X,B, B,C] → 去重 → [A, X, B, C]
    const DEDUP_THRESHOLD = 0.000001;
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
    const midCoord = uniquePoints.length > 0
        ? uniquePoints[Math.floor(uniquePoints.length / 2)]
        : null;
    return { updated: true, midCoord };
}

/**
 * 通过折线上某个点的坐标找最近的折线并更新颜色（司机端降级方案）
 * @returns {{ updated: boolean, midCoord: Array|null }}
 */
function updateDriverPolylineColorByNearestPoint(coord, color) {
    if (!window.polylines || window.polylines.length === 0) return { updated: false, midCoord: null };

    const THRESHOLD = 0.0002; // 约20米
    let bestPolyline = null;
    let bestDist = Infinity;
    let bestIdx = -1;

    window.polylines.forEach((polyline, idx) => {
        if (!polyline || typeof polyline.getPath !== 'function') return;
        const path = polyline.getPath();
        if (!path) return;

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
        console.warn('[司机端路段颜色] ✗ 未找到距离坐标', coord, '足够近的折线，最近距离:', bestDist);
        return { updated: false, midCoord: null };
    }

    bestPolyline.setOptions({ strokeColor: color });
    const path = bestPolyline.getPath();
    const allPoints = path ? Array.from(path).map(pt => [pt.lng, pt.lat]) : [];
    // 取几何中心（平均经纬度）
    let midCoord = null;
    if (allPoints.length > 0) {
        const avgLng = allPoints.reduce((s, p) => s + p[0], 0) / allPoints.length;
        const avgLat = allPoints.reduce((s, p) => s + p[1], 0) / allPoints.length;
        midCoord = [avgLng, avgLat];
    }
    console.log(`[司机端路段颜色] ✓ CPoint 坐标匹配折线[${bestIdx}]，距离:`, bestDist, '颜色:', color);
    return { updated: true, midCoord };
}

// 点坐标缓存：避免对同一个点 ID 重复请求（包括 404 的脏数据）
const _driverPointCache = new Map();

/**
 * 获取点详情（带缓存，404 的点记为 null 不再重复请求）
 * @param {number} pointId - 点ID
 * @returns {Promise<Object|null>}
 */
async function getDriverPointDetails(pointId) {
    // 命中缓存直接返回（null 也缓存，避免重复 404 请求）
    if (_driverPointCache.has(pointId)) {
        return _driverPointCache.get(pointId);
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
            // 失败不缓存，下次轮询可以重试
            return null;
        }

        const data = await response.json();

        if (data.code === 200 && data.data) {
            _driverPointCache.set(pointId, data.data);  // 只缓存成功结果
            return data.data;
        }

        return null;
    } catch (error) {
        console.error('[司机端点详情] 获取失败:', error);
        return null;
    }
}

/**
 * 通过坐标更新线段颜色（使用最短路径算法）
 * @param {Array} startCoord - 起点坐标 [lng, lat]
 * @param {Array} endCoord - 终点坐标 [lng, lat]
 * @param {string} color - 颜色
 */
function updateDriverPolylineColorByCoords(startCoord, endCoord, color) {
    console.log('[司机端路段颜色] 开始更新路段颜色:', { startCoord, endCoord, color });

    if (!window.polylines || window.polylines.length === 0) {
        console.warn('[司机端路段颜色] window.polylines 为空或未定义');
        return null;
    }

    console.log('[司机端路段颜色] 当前 polylines 数量:', window.polylines.length);

    // 构建图结构（如果还没有构建）
    if (!window.driverRoadGraph) {
        console.log('[司机端路段颜色] 构建道路图...');
        window.driverRoadGraph = buildDriverRoadGraph(window.polylines);
        console.log('[司机端路段颜色] 道路图构建完成，节点数:', Object.keys(window.driverRoadGraph.nodes).length);
    }

    // 在图中查找起点和终点对应的节点
    const COORD_THRESHOLD = 0.00001; // 坐标匹配阈值（约1米）
    const startNodeId = findDriverNearestNode(window.driverRoadGraph.nodes, startCoord, COORD_THRESHOLD);
    const endNodeId = findDriverNearestNode(window.driverRoadGraph.nodes, endCoord, COORD_THRESHOLD);

    if (!startNodeId && startNodeId !== 0) {
        console.warn('[司机端路段颜色] 未找到起点对应的节点');
        return null;
    }

    if (!endNodeId && endNodeId !== 0) {
        console.warn('[司机端路段颜色] 未找到终点对应的节点');
        return null;
    }

    console.log('[司机端路段颜色] 找到节点:', { startNodeId, endNodeId });

    // 使用 Dijkstra 算法计算最短路径
    const path = dijkstraDriverShortestPath(window.driverRoadGraph, startNodeId, endNodeId);

    if (!path || path.length === 0) {
        console.warn('[司机端路段颜色] 未找到路径');
        return null;
    }

    console.log('[司机端路段颜色] 找到路径，节点数:', path.length);

    // 根据路径中的节点，更新相应的线段颜色，同时收集路径点
    let updatedCount = 0;
    const allPathPoints = [];
    for (let i = 0; i < path.length - 1; i++) {
        const fromNode = path[i];
        const toNode = path[i + 1];

        // 查找连接这两个节点的线段
        const polylineIndices = window.driverRoadGraph.edges[fromNode]?.[toNode];

        if (polylineIndices && polylineIndices.length > 0) {
            polylineIndices.forEach(index => {
                const polyline = window.polylines[index];
                if (polyline) {
                    polyline.setOptions({
                        strokeColor: color
                    });
                    updatedCount++;
                    // 收集路径点用于计算中点
                    const pts = polyline.getPath ? polyline.getPath() : null;
                    if (pts) pts.forEach(pt => allPathPoints.push([pt.lng, pt.lat]));
                }
            });
        }
    }

    console.log('[司机端路段颜色] 更新完成，共更新了', updatedCount, '条线段');
    // 返回路径折线的几何中心坐标（平均经纬度，比取中间索引更准确地落在道路中段）
    if (allPathPoints.length === 0) return null;
    const avgLng = allPathPoints.reduce((s, p) => s + p[0], 0) / allPathPoints.length;
    const avgLat = allPathPoints.reduce((s, p) => s + p[1], 0) / allPathPoints.length;
    return [avgLng, avgLat];
}

/**
 * 构建道路图结构
 * @param {Array} polylines - 线段数组
 * @returns {Object}
 */
function buildDriverRoadGraph(polylines) {
    const nodes = {}; // nodeId -> [lng, lat]
    const edges = {}; // fromNode -> toNode -> [polylineIndices]
    let nodeIdCounter = 0;

    polylines.forEach((polyline, polylineIndex) => {
        if (!polyline || typeof polyline.getPath !== 'function') {
            return;
        }

        const path = polyline.getPath();
        if (!path || path.length < 2) {
            return;
        }

        // 获取起点和终点
        const startPos = path[0];
        const endPos = path[path.length - 1];

        const startCoord = [startPos.lng, startPos.lat];
        const endCoord = [endPos.lng, endPos.lat];

        // 查找或创建节点
        const startNodeId = findDriverOrCreateNode(nodes, startCoord, 0.00001, nodeIdCounter);
        if (startNodeId >= nodeIdCounter) nodeIdCounter = startNodeId + 1;

        const endNodeId = findDriverOrCreateNode(nodes, endCoord, 0.00001, nodeIdCounter);
        if (endNodeId >= nodeIdCounter) nodeIdCounter = endNodeId + 1;

        // 添加边（双向）
        if (!edges[startNodeId]) edges[startNodeId] = {};
        if (!edges[startNodeId][endNodeId]) edges[startNodeId][endNodeId] = [];
        edges[startNodeId][endNodeId].push(polylineIndex);

        if (!edges[endNodeId]) edges[endNodeId] = {};
        if (!edges[endNodeId][startNodeId]) edges[endNodeId][startNodeId] = [];
        edges[endNodeId][startNodeId].push(polylineIndex);
    });

    return { nodes, edges };
}

/**
 * 查找或创建节点
 * @param {Object} nodes - 节点对象
 * @param {Array} coord - 坐标 [lng, lat]
 * @param {number} threshold - 阈值
 * @param {number} nextId - 下一个节点ID
 * @returns {number}
 */
function findDriverOrCreateNode(nodes, coord, threshold, nextId) {
    // 查找是否已存在相近的节点
    for (const nodeId in nodes) {
        const node = nodes[nodeId];
        const distance = Math.sqrt(
            Math.pow(node[0] - coord[0], 2) +
            Math.pow(node[1] - coord[1], 2)
        );
        if (distance < threshold) {
            return parseInt(nodeId);
        }
    }

    // 创建新节点
    nodes[nextId] = coord;
    return nextId;
}

/**
 * 查找最近的节点
 * @param {Object} nodes - 节点对象
 * @param {Array} coord - 坐标 [lng, lat]
 * @param {number} threshold - 阈值
 * @returns {number|null}
 */
function findDriverNearestNode(nodes, coord, threshold) {
    let nearestNodeId = null;
    let minDistance = threshold;

    for (const nodeId in nodes) {
        const node = nodes[nodeId];
        const distance = Math.sqrt(
            Math.pow(node[0] - coord[0], 2) +
            Math.pow(node[1] - coord[1], 2)
        );
        if (distance < minDistance) {
            minDistance = distance;
            nearestNodeId = parseInt(nodeId);
        }
    }

    return nearestNodeId;
}

/**
 * Dijkstra最短路径算法
 * @param {Object} graph - 图结构
 * @param {number} startNode - 起点节点ID
 * @param {number} endNode - 终点节点ID
 * @returns {Array|null}
 */
function dijkstraDriverShortestPath(graph, startNode, endNode) {
    const distances = {};
    const previous = {};
    const unvisited = new Set();

    // 初始化
    for (const nodeId in graph.nodes) {
        const id = parseInt(nodeId);
        distances[id] = Infinity;
        previous[id] = null;
        unvisited.add(id);
    }
    distances[startNode] = 0;

    while (unvisited.size > 0) {
        // 找到未访问节点中距离最小的
        let currentNode = null;
        let minDistance = Infinity;

        for (const nodeId of unvisited) {
            if (distances[nodeId] < minDistance) {
                minDistance = distances[nodeId];
                currentNode = nodeId;
            }
        }

        if (currentNode === null || minDistance === Infinity) {
            break;
        }

        unvisited.delete(currentNode);

        if (currentNode === endNode) {
            break;
        }

        // 更新邻居节点的距离
        const neighbors = graph.edges[currentNode] || {};
        for (const neighborId in neighbors) {
            const neighbor = parseInt(neighborId);
            if (unvisited.has(neighbor)) {
                const currentCoord = graph.nodes[currentNode];
                const neighborCoord = graph.nodes[neighbor];
                const distance = Math.sqrt(
                    Math.pow(neighborCoord[0] - currentCoord[0], 2) +
                    Math.pow(neighborCoord[1] - currentCoord[1], 2)
                );

                const newDistance = distances[currentNode] + distance;
                if (newDistance < distances[neighbor]) {
                    distances[neighbor] = newDistance;
                    previous[neighbor] = currentNode;
                }
            }
        }
    }

    // 重构路径
    if (distances[endNode] === Infinity) {
        return null;
    }

    const path = [];
    let currentNode = endNode;
    while (currentNode !== null) {
        path.unshift(currentNode);
        currentNode = previous[currentNode];
    }

    return path;
}

/**
 * 添加路况提示图标（司机端导航总览页面）
 * @param {number} startId - 路段起点ID
 * @param {number} endId - 路段终点ID
 * @param {Array} coord - 图标放置坐标 [lng, lat]
 * @param {number} status - 路况状态
 */
function addDriverBlockedMarker(startId, endId, coord, status) {
    if (!map || !coord) {
        console.warn('[司机端路况图标] 无法添加图标：map 或 coord 为空');
        return;
    }
    const key = `${startId}_${endId}`;
    // 先移除旧的（避免重复）
    removeDriverBlockedMarker(startId, endId);

    const iconPath = getDriverRoadStatusIconPath(status);
    if (!iconPath) {
        console.warn('[司机端路况图标] 当前状态无需显示图标:', status);
        return;
    }

    try {
        const imgContent = '<img src="' + iconPath + '" style="width:18px;height:18px;display:block;" alt="路况" onerror="this.style.display=\'none\';console.error(\'[司机端路况图标] 图片加载失败\')" />';
        const marker = new AMap.Marker({
            position: coord,
            content: imgContent,
            offset: new AMap.Pixel(-9, -9),
            zIndex: 150,
            map: map
        });
        driverBlockedRoadMarkers.set(key, marker);
        console.log(`[司机端路况图标] ✓ 已添加: ${key}, 状态=${status}, 坐标:`, coord, '当前总数:', driverBlockedRoadMarkers.size);
    } catch (e) {
        console.error('[司机端路况图标] ✗ 创建 Marker 失败:', e);
    }
}

/**
 * 移除路况提示图标（司机端）
 * @param {number} startId - 路段起点ID
 * @param {number} endId - 路段终点ID
 */
function removeDriverBlockedMarker(startId, endId) {
    const key = `${startId}_${endId}`;
    if (driverBlockedRoadMarkers.has(key)) {
        const marker = driverBlockedRoadMarkers.get(key);
        if (map) map.remove(marker);
        driverBlockedRoadMarkers.delete(key);
        console.log(`[司机端路况图标] 已移除: ${key}`);
    }
}

/**
 * 获取折线中点坐标（通过 line_id 匹配）
 * @param {number|string} lineId
 * @returns {Array|null} [lng, lat] 或 null
 */
function getDriverPolylineMidCoordByLineId(lineId) {
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
    return allPoints[Math.floor(allPoints.length / 2)];
}

/**
 * 重置司机端道路状态（供外部模块调用）
 * 在地图重新加载时调用，确保新折线的颜色被重新应用
 * 解决 driverRoadStatusCache 是模块级 const 变量、外部无法直接访问的问题
 */
function resetDriverRoadStatus() {
    driverBlockedRoadMarkers.forEach(marker => {
        if (map && marker) {
            try {
                map.remove(marker);
            } catch (error) {
                console.warn('[司机端道路状态] 清理旧路况图标失败:', error);
            }
        }
    });
    driverBlockedRoadMarkers.clear();
    driverRoadStatusCache.clear();
    window.driverRoadGraph = null;
    window._lastDriverPolylineCount = undefined;
    console.log('[司机端道路状态] 已重置缓存，下次轮询将重新应用所有道路状态');
}
