(function(window) {
    'use strict';

    const TASK_TYPE_NAME_MAP = {
        '1': '水泥运输',
        '2': '沙石运输（砂石运输）',
        '3': '钢筋运输',
        '4': '渣土运输',
        '5': '商品混凝土运输',
        '6': '其他 / 水平运输任务'
    };

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function padNumber(value) {
        return String(value).padStart(2, '0');
    }

    function parseDate(value) {
        if (!value) {
            return null;
        }

        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) {
            return null;
        }

        return date;
    }

    function formatDate(value) {
        const date = parseDate(value);
        if (!date) {
            return '-';
        }

        return `${date.getMonth() + 1}月${date.getDate()}日`;
    }

    function formatTimeValue(value) {
        const date = parseDate(value);
        if (!date) {
            return '';
        }

        return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
    }

    function formatTimeRange(startTime, endTime) {
        const startText = formatTimeValue(startTime);
        const endText = formatTimeValue(endTime);
        if (startText && endText) {
            return `${startText} - ${endText}`;
        }

        return startText || endText || '-';
    }

    function normalizeStatusCode(value) {
        if (value === null || value === undefined || value === '') {
            return '';
        }

        const text = String(value).trim();
        if (/^-?\d+$/.test(text)) {
            return String(Number(text));
        }
        return text;
    }

    function getStatusGroup(statusCode, statusGroup) {
        const explicitGroup = String(statusGroup || '').trim();
        if (explicitGroup) {
            return explicitGroup;
        }

        const code = normalizeStatusCode(statusCode);
        if (['3', '4', '5'].includes(code)) {
            return 'success';
        }
        if (['-4', '-3', '-2', '-1'].includes(code)) {
            return 'danger';
        }
        return 'default';
    }

    function getStatusClass(statusCode, statusGroup) {
        return `status-${getStatusGroup(statusCode, statusGroup)}`;
    }

    function getTaskColor(statusCode, statusGroup) {
        const group = getStatusGroup(statusCode, statusGroup);
        if (group === 'success') {
            return 'green';
        }
        if (group === 'danger') {
            return 'red';
        }
        return 'gray';
    }

    function buildSequentialTaskName(displayIndex) {
        const index = Number(displayIndex);
        if (Number.isInteger(index) && index > 0) {
            return `任务${index}`;
        }
        return '任务1';
    }

    function isScanDerivedTask(task) {
        const safeTask = task || {};
        if (safeTask.fromScan === true) {
            return true;
        }

        const source = String(safeTask.source || '').trim();
        return source === 'scan-task' || source === 'public-task-api';
    }

    function resolveTaskTypeText(taskContext) {
        const explicitTypeText = String(taskContext && taskContext.taskTypeText || '').trim();
        if (explicitTypeText) {
            return explicitTypeText;
        }

        const taskTypeId = String(taskContext && taskContext.taskTypeId || '').trim();
        return TASK_TYPE_NAME_MAP[taskTypeId] || '';
    }

    function normalizeScanPoint(point, fallbackName) {
        const safePoint = point || {};
        return {
            name: safePoint.name || fallbackName || '',
            date: '-',
            time: '-',
            location: Array.isArray(safePoint.location) ? safePoint.location : null
        };
    }

    function normalizePosition(position) {
        if (Array.isArray(position) && position.length >= 2) {
            const lng = Number(position[0]);
            const lat = Number(position[1]);
            if (Number.isFinite(lng) && Number.isFinite(lat)) {
                return [lng, lat];
            }
        }

        if (position && typeof position === 'object') {
            const lng = Number(position.lng);
            const lat = Number(position.lat);
            if (Number.isFinite(lng) && Number.isFinite(lat)) {
                return [lng, lat];
            }
        }

        return null;
    }

    function readSessionJson(key) {
        try {
            const text = sessionStorage.getItem(key);
            return text ? JSON.parse(text) : null;
        } catch (error) {
            console.warn('[TaskCardRenderer] 读取会话数据失败:', key, error);
            return null;
        }
    }

    function getCachedCurrentPosition() {
        try {
            if (typeof window.NavDataStore !== 'undefined' &&
                typeof window.NavDataStore.getCurrentPosition === 'function') {
                const cached = window.NavDataStore.getCurrentPosition();
                if (Array.isArray(cached) && cached.length >= 2) {
                    return cached;
                }
            }
        } catch (error) {
            console.warn('[TaskCardRenderer] 读取 NavDataStore 当前位置失败:', error);
        }

        const rawPosition = readSessionJson('currentPosition');
        return Array.isArray(rawPosition) && rawPosition.length >= 2 ? rawPosition : null;
    }

    function buildFallbackNavigablePoints() {
        const collected = [];
        const appendPoint = function(feature) {
            if (!feature || !feature.geometry || !feature.geometry.coordinates) {
                return;
            }

            const position = normalizePosition(feature.geometry.coordinates);
            const name = (feature.displayName || feature.fullDisplayName || feature.rawName || feature.name || '').trim();
            if (!name || !position) {
                return;
            }

            collected.push({
                name,
                displayName: feature.displayName || name,
                fullDisplayName: feature.fullDisplayName || feature.displayName || name,
                rawName: feature.rawName || feature.name || name,
                position
            });
        };

        const processedData = readSessionJson('processedKMLData');
        if (processedData && Array.isArray(processedData.features)) {
            processedData.features.forEach(appendPoint);
        }

        const kmlData = readSessionJson('kmlData');
        if (Array.isArray(kmlData)) {
            kmlData.forEach(function(layer) {
                if (layer && Array.isArray(layer.features)) {
                    layer.features.forEach(appendPoint);
                }
            });
        }

        return collected;
    }

    function getNavigablePointsFromSession() {
        if (typeof window.PointNameUtils !== 'undefined' &&
            typeof window.PointNameUtils.getAllNavigablePointsFromSession === 'function') {
            const points = window.PointNameUtils.getAllNavigablePointsFromSession();
            if (Array.isArray(points) && points.length > 0) {
                return points;
            }
        }

        return buildFallbackNavigablePoints();
    }

    function findNavigablePointByName(name, sourcePoints) {
        const target = String(name || '').trim();
        if (!target) {
            return null;
        }

        if (typeof window.PointNameUtils !== 'undefined' &&
            typeof window.PointNameUtils.findPointByName === 'function') {
            return window.PointNameUtils.findPointByName(target, sourcePoints);
        }

        const lowerTarget = target.toLowerCase();
        return (Array.isArray(sourcePoints) ? sourcePoints : []).find(function(point) {
            const candidates = [
                point && point.displayName,
                point && point.fullDisplayName,
                point && point.rawName,
                point && point.name
            ].filter(Boolean);
            return candidates.some(function(candidate) {
                return String(candidate).trim().toLowerCase() === lowerTarget;
            });
        }) || null;
    }

    function resolveTaskNavigationPoint(point, fallbackName) {
        const safePoint = point || {};
        const sourcePosition = normalizePosition(safePoint.location || safePoint.position);
        const sourceName = String(safePoint.name || fallbackName || '').trim();

        const matchedPoint = sourceName
            ? findNavigablePointByName(sourceName, getNavigablePointsFromSession())
            : null;
        const matchedPosition = matchedPoint ? normalizePosition(matchedPoint.position || matchedPoint.location) : null;
        const matchedName = matchedPoint
            ? String(matchedPoint.displayName || matchedPoint.fullDisplayName || matchedPoint.rawName || matchedPoint.name || '').trim()
            : '';

        // 优先按当前项目里的同名导航点纠偏，避免任务名称与 point_id 指向的旧点位不一致。
        if (Array.isArray(matchedPosition)) {
            return {
                name: sourceName || matchedName || fallbackName || '',
                position: matchedPosition
            };
        }

        if (Array.isArray(sourcePosition)) {
            return {
                name: sourceName || fallbackName || '',
                position: sourcePosition
            };
        }

        return {
            name: sourceName || matchedName || fallbackName || '',
            position: matchedPosition
        };
    }

    function buildTaskNavigationRoute(task) {
        const sourceTask = task || {};
        const endPoint = resolveTaskNavigationPoint(sourceTask.endPoint, '任务终点');
        if (!Array.isArray(endPoint.position)) {
            throw new Error('任务终点缺失，无法进入导航');
        }

        const cachedCurrentPosition = getCachedCurrentPosition();

        const route = {
            source: 'task',
            start: {
                name: '我的位置',
                position: cachedCurrentPosition,
                isMyLocation: true
            },
            waypoints: [],
            end: {
                name: endPoint.name || '任务终点',
                position: endPoint.position
            }
        };

        const startPoint = resolveTaskNavigationPoint(sourceTask.startPoint, '任务起点');
        if (Array.isArray(startPoint.position)) {
            route.waypoints.push({
                name: startPoint.name || '任务起点',
                position: startPoint.position
            });
        }

        route.meta = {
            taskId: sourceTask && (sourceTask.id || sourceTask.taskId)
                ? String(sourceTask.id || sourceTask.taskId)
                : '',
            taskSource: sourceTask && sourceTask.source ? String(sourceTask.source) : '',
            fromScan: isScanDerivedTask(sourceTask),
            realStartPosition: Array.isArray(cachedCurrentPosition) ? cachedCurrentPosition : null,
            taskStartName: startPoint.name || '任务起点',
            taskStartPosition: Array.isArray(startPoint.position) ? startPoint.position : null,
            taskEndName: endPoint.name || '任务终点',
            taskEndPosition: Array.isArray(endPoint.position) ? endPoint.position : null,
            allowReachableSimulatedStart: isScanDerivedTask(sourceTask)
        };

        // #region debug-point A:task-card-route
        fetch("http://127.0.0.1:7777/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:"nav-route-regression",runId:"pre-fix",hypothesisId:"C",location:"task-card-renderer.js:290",msg:"[DEBUG] built task navigation route",data:{taskId:sourceTask&&sourceTask.id,cachedCurrentPosition:getCachedCurrentPosition(),startPoint:sourceTask&&sourceTask.startPoint,resolvedStartPoint:startPoint,endPoint:sourceTask&&sourceTask.endPoint,resolvedEndPoint:endPoint,route},ts:Date.now()})}).catch(()=>{});
        // #endregion

        return route;
    }

    function buildTaskCardDataFromScanContext(taskContext, options) {
        if (!taskContext || !taskContext.taskId) {
            return null;
        }

        const safeOptions = options || {};
        const statusCode = normalizeStatusCode(taskContext.statusCode || taskContext.status);
        const statusText = taskContext.statusText || '未知状态';
        const statusGroup = getStatusGroup(statusCode, taskContext.statusGroup);
        const startTimeSource = taskContext.entryStartTime;
        const startTimeEndSource = taskContext.entryEndTime;
        const endTimeSource = taskContext.exitStartTime;
        const endTimeEndSource = taskContext.exitEndTime;

        const startPoint = normalizeScanPoint(taskContext.startPoint, '无');
        startPoint.date = formatDate(startTimeSource);
        startPoint.time = formatTimeRange(startTimeSource, startTimeEndSource);

        const endPoint = normalizeScanPoint(taskContext.endPoint, '任务终点');
        endPoint.date = formatDate(endTimeSource);
        endPoint.time = formatTimeRange(endTimeSource, endTimeEndSource);

        return {
            id: String(taskContext.taskId),
            name: buildSequentialTaskName(safeOptions.displayIndex),
            type: resolveTaskTypeText(taskContext),
            description: taskContext.reason || taskContext.taskDetail || '暂无任务详情',
            startPoint,
            endPoint,
            status: statusText,
            statusCode,
            statusGroup,
            color: getTaskColor(statusCode, statusGroup),
            canNavigate: Array.isArray(endPoint.location),
            source: 'scan-task',
            fromScan: true
        };
    }

    function createTaskCard(task, options) {
        const safeTask = task || {};
        const safeOptions = options || {};
        const startPoint = safeTask.startPoint || {};
        const endPoint = safeTask.endPoint || {};
        const statusText = safeTask.status || '未知';
        const statusClass = getStatusClass(safeTask.statusCode, safeTask.statusGroup);
        const detailExpanded = !!safeOptions.detailExpanded;
        const canNavigate = !!safeTask.canNavigate;
        const card = document.createElement('div');

        card.className = `task-card task-${safeTask.color || getTaskColor(safeTask.statusCode, safeTask.statusGroup)} task-status-${statusClass.replace('status-', '')}`;
        card.dataset.taskId = String(safeTask.id || '');
        if (safeTask.source) {
            card.dataset.taskSource = safeTask.source;
        }

        card.innerHTML = `
            <div class="task-card-header">
                <div class="task-card-left">
                    <div class="task-card-name">${escapeHtml(safeTask.name || '未命名任务')}</div>
                    <div class="task-card-type">${escapeHtml(safeTask.type || '')}</div>
                </div>
                <div class="task-card-status ${statusClass}">${escapeHtml(statusText)}</div>
            </div>

            <div class="task-timeline timeline-horizontal">
                <div class="timeline-row start-row">
                    <div class="timeline-point start"></div>
                    <div class="timeline-info">
                        <div class="timeline-location">${escapeHtml(startPoint.name || '')}</div>
                        <div class="timeline-date">${escapeHtml(startPoint.date || '-')}</div>
                        <div class="timeline-time">${escapeHtml(startPoint.time || '-')}</div>
                    </div>
                </div>
                <div class="timeline-status">
                    <span class="status-badge">${escapeHtml(statusText)}</span>
                </div>
                <div class="timeline-separator" aria-hidden="true"></div>
                <div class="timeline-row end-row">
                    <div class="timeline-point end"></div>
                    <div class="timeline-info end-info">
                        <div class="timeline-location">${escapeHtml(endPoint.name || '')}</div>
                        <div class="timeline-date">${escapeHtml(endPoint.date || '-')}</div>
                        <div class="timeline-time">${escapeHtml(endPoint.time || '-')}</div>
                    </div>
                    <button class="task-card-nav timeline-nav${canNavigate ? '' : ' is-disabled'}" data-task-id="${escapeHtml(safeTask.id || '')}" aria-label="开始导航" type="button"${canNavigate ? '' : ' disabled'}>
                        <img class="nav-icon" src="images/工地数字导航小程序切图/司机/2X/导航/定位-1.png" alt="" aria-hidden="true" />
                    </button>
                </div>
            </div>

            <div class="task-detail-section">
                <div class="task-detail-header" data-task-id="${escapeHtml(safeTask.id || '')}">
                    <div class="task-detail-title">任务详情</div>
                    <i class="fas fa-chevron-down task-detail-toggle${detailExpanded ? ' expanded' : ''}"></i>
                </div>
                <div class="task-detail-content${detailExpanded ? ' expanded' : ''}">
                    <div class="task-detail-text">${escapeHtml(safeTask.description || '暂无任务详情')}</div>
                </div>
            </div>
        `;

        const detailHeader = card.querySelector('.task-detail-header');
        const detailContent = card.querySelector('.task-detail-content');
        const detailToggle = card.querySelector('.task-detail-toggle');
        if (detailHeader && detailContent && detailToggle) {
            detailHeader.addEventListener('click', function() {
                detailContent.classList.toggle('expanded');
                detailToggle.classList.toggle('expanded');
                if (typeof safeOptions.onToggleDetail === 'function') {
                    safeOptions.onToggleDetail(safeTask, detailContent.classList.contains('expanded'), {
                        card,
                        detailContent,
                        detailToggle
                    });
                }
            });
        }

        const navBtn = card.querySelector('.timeline-nav');
        if (navBtn) {
            navBtn.addEventListener('click', function(event) {
                event.stopPropagation();
                if (typeof safeOptions.onNavigate === 'function') {
                    safeOptions.onNavigate(safeTask, event);
                }
            });
        }

        return card;
    }

    window.TaskCardRenderer = {
        buildTaskNavigationRoute,
        createTaskCard,
        buildTaskCardDataFromScanContext,
        getStatusClass,
        getTaskColor
    };
})(window);
