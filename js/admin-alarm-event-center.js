/**
 * 管理端报警事件中心
 * 作用：
 * 1. 统一接收 WS 事件、轮询状态补偿、路况变化；
 * 2. 标准化为统一报警事件；
 * 3. 维护首次/持续/解除三态；
 * 4. 同步分发给消息中心与地图报警 UI。
 */

window.AdminAlarmEventCenter = (function() {
    'use strict';

    const EVENT_STATUS = {
        ACTIVE: 'active',
        UPDATED: 'updated',
        CLEARED: 'cleared'
    };

    const EVENT_TYPES = {
        ROAD_STATUS_CHANGED: 'road_status_changed',
        RESTRICTED_ENTER: 'restricted_enter',
        RESTRICTED_WARNING_UPDATE: 'restricted_warning_update',
        RESTRICTED_EXIT_CLEAR: 'restricted_exit_clear',
        FIXED_EXIT_ALARM: 'fixed_exit_alarm',
        FIXED_EXIT_CLEAR: 'fixed_exit_clear',
        ROUTE_DEVIATION_ALARM: 'route_deviation_alarm'
    };

    const activeEvents = new Map();
    const statusSnapshots = new Map();

    function getVehicleTraceTarget() {
        try {
            if (typeof localStorage === 'undefined') {
                return '';
            }
            return String(localStorage.getItem('admin_vehicle_trace') || '').trim().toLowerCase();
        } catch (error) {
            return '';
        }
    }

    function normalizeTraceKey(value) {
        if (value === undefined || value === null) return '';
        return String(value).trim().toLowerCase();
    }

    function shouldTraceVehicle(candidate) {
        const target = getVehicleTraceTarget();
        if (!target) {
            return false;
        }
        if (target === 'all' || target === '*') {
            return true;
        }

        const keys = [];
        if (typeof candidate === 'string' || typeof candidate === 'number') {
            keys.push(candidate);
        } else if (candidate && typeof candidate === 'object') {
            keys.push(
                candidate.vehicleId,
                candidate.plateNumber,
                candidate.deviceId,
                candidate.sourceId
            );
        }

        return keys
            .map(normalizeTraceKey)
            .filter(Boolean)
            .includes(target);
    }

    function logAlarmTrace(stage, vehicleOrIdentifier, payload, level) {
        if (!shouldTraceVehicle(vehicleOrIdentifier)) {
            return;
        }

        const writer = (level && console[level]) ? console[level] : console.log;
        writer.call(console, `[报警状态机] ${stage}`, payload || {});
    }

    function normalizeTimestamp(value) {
        if (!value) return new Date().toISOString();
        const parsed = new Date(value);
        return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    }

    function normalizeVehicleType(value) {
        if (value === 1 || value === '1' || value === 'fixed' || value === '固定车') {
            return 'fixed';
        }
        return 'temp';
    }

    function normalizeTaskScope(value) {
        if (value === undefined || value === null || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : value;
    }

    function isFixedIndoorAlarmScope(vehicleType, taskScope) {
        return vehicleType === 'fixed' && (taskScope === 0 || taskScope === null);
    }

    function buildEventId(base) {
        switch (base.eventType) {
            case EVENT_TYPES.ROAD_STATUS_CHANGED:
                return [
                    base.eventType,
                    base.projectId || '',
                    base.cameraId || ''
                ].join('|');
            case EVENT_TYPES.RESTRICTED_ENTER:
            case EVENT_TYPES.RESTRICTED_WARNING_UPDATE:
            case EVENT_TYPES.RESTRICTED_EXIT_CLEAR:
                return [
                    'restricted',
                    base.projectId || '',
                    base.vehicleId || base.plateNumber || '',
                    base.fenceId || base.fenceName || base.matchedRestrictedId || ''
                ].join('|');
            case EVENT_TYPES.FIXED_EXIT_ALARM:
            case EVENT_TYPES.FIXED_EXIT_CLEAR:
                return [
                    'fixed_exit',
                    base.projectId || '',
                    base.vehicleId || base.plateNumber || '',
                    base.taskId || 'default'
                ].join('|');
            case EVENT_TYPES.ROUTE_DEVIATION_ALARM:
                return [
                    base.eventType,
                    base.projectId || '',
                    base.vehicleId || base.plateNumber || '',
                    base.polylineId || base.lineName || 'default'
                ].join('|');
            default:
                return [
                    base.eventType || 'unknown',
                    base.projectId || '',
                    base.vehicleId || base.plateNumber || ''
                ].join('|');
        }
    }

    function buildSnapshotKey(payload) {
        return [
            payload.projectId || '',
            payload.vehicleId || payload.plateNumber || payload.deviceId || payload.sourceId || ''
        ].join('|');
    }

    function getSnapshotState(payload) {
        const snapshotKey = buildSnapshotKey(payload);
        return {
            snapshotKey,
            prev: statusSnapshots.get(snapshotKey) || {}
        };
    }

    function buildCurrentStatus(payload, normalizedVehicleType, normalizedTaskScope, prev) {
        const curr = {
            inRestricted: payload.inRestricted === true,
            inFence: payload.inFence === true,
            vehicleType: normalizedVehicleType,
            taskScope: normalizedTaskScope,
            taskId: payload.taskId || null,
            fenceId: payload.fenceId || '',
            fenceName: payload.fenceName || '',
            matchedRestrictedId: payload.matchedRestrictedId || ''
        };

        if (payload.inRestricted === undefined) {
            switch (payload.alarmType) {
                case 'ENTER_RESTRICTED':
                case 'RESTRICTED_WARNING':
                    curr.inRestricted = true;
                    break;
                case 'EXIT_RESTRICTED':
                case 'EXIT_INDOOR_WORK_SITE':
                case 'OUT_OF_FENCE_ON_INDOOR_TASK':
                case 'ENTER_FENCE':
                    curr.inRestricted = false;
                    break;
                default:
                    curr.inRestricted = prev.inRestricted === true;
                    break;
            }
        }

        if (payload.inFence === undefined) {
            switch (payload.alarmType) {
                case 'ENTER_RESTRICTED':
                case 'RESTRICTED_WARNING':
                case 'EXIT_RESTRICTED':
                case 'ENTER_FENCE':
                    curr.inFence = true;
                    break;
                case 'EXIT_INDOOR_WORK_SITE':
                case 'OUT_OF_FENCE_ON_INDOOR_TASK':
                    curr.inFence = false;
                    break;
                default:
                    curr.inFence = prev.inFence === true;
                    break;
            }
        }

        return curr;
    }

    function createEvent(base) {
        const event = {
            eventType: base.eventType,
            eventStatus: base.eventStatus || EVENT_STATUS.ACTIVE,
            eventId: '',
            projectId: base.projectId || '',
            vehicleId: base.vehicleId || '',
            plateNumber: base.plateNumber || base.vehicleId || '',
            deviceId: base.deviceId || '',
            sourceId: base.sourceId || '',
            vehicleType: normalizeVehicleType(base.vehicleType),
            taskScope: normalizeTaskScope(base.taskScope),
            taskId: base.taskId || null,
            polylineId: base.polylineId || null,
            lineName: base.lineName || '',
            fenceId: base.fenceId || '',
            fenceName: base.fenceName || '',
            matchedRestrictedId: base.matchedRestrictedId || '',
            matchedFenceId: base.matchedFenceId || '',
            cameraId: base.cameraId || '',
            evaluation: base.evaluation || '',
            latitude: base.latitude !== undefined && base.latitude !== null ? Number(base.latitude) : null,
            longitude: base.longitude !== undefined && base.longitude !== null ? Number(base.longitude) : null,
            alarmType: base.alarmType || '',
            description: base.description || '',
            eventTime: normalizeTimestamp(base.eventTime || base.timestamp || base.alarmTime),
            sourceType: base.sourceType || 'unknown',
            raw: base.raw || null
        };

        event.eventId = buildEventId(event);
        return event;
    }

    function getFenceUiPayload(event) {
        return {
            vehicleId: event.vehicleId || event.plateNumber,
            alertKey: event.vehicleId || event.plateNumber,
            projectId: event.projectId,
            taskId: event.taskId,
            taskScope: event.taskScope,
            polylineId: event.polylineId,
            lineName: event.lineName,
            description: event.description,
            alarmTime: event.eventTime,
            plateNumber: event.plateNumber,
            deviceId: event.deviceId,
            sourceId: event.sourceId,
            vehicleType: event.vehicleType,
            fenceType: event.eventType === EVENT_TYPES.RESTRICTED_ENTER ||
                       event.eventType === EVENT_TYPES.RESTRICTED_WARNING_UPDATE ||
                       event.eventType === EVENT_TYPES.RESTRICTED_EXIT_CLEAR
                ? 'prohibit'
                : 'fence',
            eventType: event.eventStatus === EVENT_STATUS.CLEARED ? 'leave' : 'enter',
            alertType: event.eventType === EVENT_TYPES.RESTRICTED_ENTER ||
                       event.eventType === EVENT_TYPES.RESTRICTED_WARNING_UPDATE ||
                       event.eventType === EVENT_TYPES.RESTRICTED_EXIT_CLEAR
                ? 'fence_enter'
                : 'fence_leave',
            alarmType: event.alarmType,
            fenceName: event.fenceName,
            latitude: event.latitude,
            longitude: event.longitude,
            matchedRestrictedId: event.matchedRestrictedId,
            raw: event.raw,
            eventStatus: event.eventStatus
        };
    }

    function getRouteUiPayload(event) {
        return {
            vehicleId: event.vehicleId || event.plateNumber,
            alertKey: event.vehicleId || event.plateNumber,
            projectId: event.projectId,
            taskId: event.taskId,
            taskScope: event.taskScope,
            polylineId: event.polylineId,
            lineName: event.lineName,
            plateNumber: event.plateNumber,
            deviceId: event.deviceId,
            vehicleType: event.vehicleType,
            latitude: event.latitude,
            longitude: event.longitude,
            description: event.description,
            raw: event.raw,
            eventStatus: event.eventStatus
        };
    }

    function updateActiveEvent(event) {
        if (event.eventStatus === EVENT_STATUS.CLEARED) {
            activeEvents.delete(event.eventId);
            return;
        }
        activeEvents.set(event.eventId, event);
    }

    function pushToUi(event) {
        if (typeof window === 'undefined') return;

        switch (event.eventType) {
            case EVENT_TYPES.RESTRICTED_ENTER:
            case EVENT_TYPES.RESTRICTED_WARNING_UPDATE:
            case EVENT_TYPES.RESTRICTED_EXIT_CLEAR:
            case EVENT_TYPES.FIXED_EXIT_ALARM:
            case EVENT_TYPES.FIXED_EXIT_CLEAR:
                window.dispatchEvent(new CustomEvent('fenceAlert', {
                    detail: getFenceUiPayload(event)
                }));
                break;
            case EVENT_TYPES.ROUTE_DEVIATION_ALARM:
                window.dispatchEvent(new CustomEvent('routeDeviation', {
                    detail: getRouteUiPayload(event)
                }));
                break;
            default:
                break;
        }
    }

    function pushRoadStatusEvent(event) {
        if (typeof window === 'undefined') return;
        window.dispatchEvent(new CustomEvent('trafficStatusChange', {
            detail: {
                cameraId: event.cameraId,
                evaluation: event.evaluation,
                projectId: event.projectId,
                raw: event.raw
            }
        }));
    }

    function dispatch(event) {
        updateActiveEvent(event);

        if (typeof AdminMessageManager !== 'undefined') {
            AdminMessageManager.handleAlarmEvent(event);
        }

        if (event.eventType === EVENT_TYPES.ROAD_STATUS_CHANGED) {
            pushRoadStatusEvent(event);
            return event;
        }

        pushToUi(event);
        return event;
    }

    function createAndDispatch(base) {
        const event = createEvent(base);
        return dispatch(event);
    }

    function createAndDispatchSequence(events) {
        if (!Array.isArray(events) || events.length === 0) {
            return null;
        }

        const dispatched = [];
        events.forEach(item => {
            if (!item) return;
            const result = createAndDispatch(item);
            if (result) {
                dispatched.push(result);
            }
        });

        if (dispatched.length === 0) return null;
        return dispatched.length === 1 ? dispatched[0] : dispatched;
    }

    function dispatchFenceStatusTransition(base, prev, curr, persistSnapshot) {
        if (persistSnapshot) {
            const snapshotKey = buildSnapshotKey(base);
            statusSnapshots.set(snapshotKey, curr);
        }

        const prevInRestricted = prev.inRestricted === true;
        const prevWasOutsideFence = prev.inFence === false;
        const wasFixedIndoor = isFixedIndoorAlarmScope(prev.vehicleType, prev.taskScope);
        const isFixedIndoor = isFixedIndoorAlarmScope(curr.vehicleType, curr.taskScope);
        const restrictedFenceId = curr.fenceId || curr.matchedRestrictedId || prev.fenceId || prev.matchedRestrictedId || '';
        const restrictedFenceName = curr.fenceName || prev.fenceName || '';
        const restrictedMatchedId = curr.matchedRestrictedId || prev.matchedRestrictedId || curr.fenceId || prev.fenceId || '';
        const fixedExitTaskId = curr.taskId || prev.taskId || base.taskId || null;
        const eventsToDispatch = [];

        // 先解除旧状态，避免同一时刻旧报警和新报警并存。
        if (prevInRestricted && !curr.inRestricted) {
            eventsToDispatch.push({
                ...base,
                fenceId: restrictedFenceId,
                fenceName: restrictedFenceName,
                matchedRestrictedId: restrictedMatchedId,
                eventType: EVENT_TYPES.RESTRICTED_EXIT_CLEAR,
                eventStatus: EVENT_STATUS.CLEARED,
                alarmType: 'STATE_RESTRICTED_EXIT'
            });
        }

        if (wasFixedIndoor && prevWasOutsideFence && (!isFixedIndoor || curr.inFence || curr.inRestricted)) {
            eventsToDispatch.push({
                ...base,
                taskId: fixedExitTaskId,
                fenceId: '',
                fenceName: '',
                eventType: EVENT_TYPES.FIXED_EXIT_CLEAR,
                eventStatus: EVENT_STATUS.CLEARED,
                alarmType: 'STATE_FIXED_RETURN'
            });
        }

        // 再根据当前真实状态决定需要激活的唯一报警。
        if (curr.inRestricted && !prevInRestricted) {
            eventsToDispatch.push({
                ...base,
                fenceId: restrictedFenceId,
                fenceName: restrictedFenceName,
                matchedRestrictedId: restrictedMatchedId,
                eventType: EVENT_TYPES.RESTRICTED_ENTER,
                eventStatus: EVENT_STATUS.ACTIVE,
                alarmType: 'STATE_RESTRICTED_ENTER'
            });
            return createAndDispatchSequence(eventsToDispatch);
        }

        if (curr.inRestricted && prevInRestricted) {
            eventsToDispatch.push({
                ...base,
                fenceId: restrictedFenceId,
                fenceName: restrictedFenceName,
                matchedRestrictedId: restrictedMatchedId,
                eventType: EVENT_TYPES.RESTRICTED_WARNING_UPDATE,
                eventStatus: EVENT_STATUS.UPDATED,
                alarmType: 'STATE_RESTRICTED_WARNING'
            });
            return createAndDispatchSequence(eventsToDispatch);
        }

        if (isFixedIndoor && curr.inFence === false && prev.inFence !== false) {
            eventsToDispatch.push({
                ...base,
                taskId: fixedExitTaskId,
                fenceId: '',
                fenceName: '',
                eventType: EVENT_TYPES.FIXED_EXIT_ALARM,
                eventStatus: EVENT_STATUS.ACTIVE,
                alarmType: 'STATE_FIXED_EXIT'
            });
        }

        if (!prevInRestricted && !eventsToDispatch.length && isFixedIndoor && curr.inFence === false && prevWasOutsideFence) {
            logAlarmTrace('状态无变化-固定车持续离场', base, {
                sourceType: base.sourceType,
                prev,
                curr
            });
            return null;
        }

        logAlarmTrace('状态转移', base, {
            sourceType: base.sourceType,
            prev,
            curr,
            eventsToDispatch: eventsToDispatch.map(item => ({
                eventType: item.eventType,
                eventStatus: item.eventStatus,
                fenceId: item.fenceId || '',
                matchedRestrictedId: item.matchedRestrictedId || '',
                alarmType: item.alarmType || ''
            }))
        });
        return createAndDispatchSequence(eventsToDispatch);
    }

    function getStandardEvaluation(val) {
        const mapping = {
            free: '畅通',
            slow: '缓行',
            congested: '拥堵',
            blocked: '阻断',
            '畅通': '畅通',
            '缓行': '缓行',
            '拥堵': '拥堵',
            '阻断': '阻断'
        };
        return mapping[val] || String(val || '未知');
    }

    function handleRoadStatusChange(payload) {
        if (!payload || !payload.projectId || !payload.cameraId || !payload.evaluation) {
            return null;
        }

        // 使用 sessionStorage 作为全局路况状态缓存，避免页面刷新或进入消息中心时重复推送
        const cacheKey = `road_status_${payload.projectId}_${payload.cameraId}`;
        const newStatus = getStandardEvaluation(payload.evaluation);
        
        try {
            const oldStatus = sessionStorage.getItem(cacheKey);
            
            // 状态没有变化，忽略
            if (oldStatus !== null && oldStatus === newStatus) {
                console.log(`[报警中心] 摄像头 ${payload.cameraId} 状态未变(${newStatus})，拦截推送`);
                return null;
            }

            const isFirstSeen = (oldStatus === null);
            sessionStorage.setItem(cacheKey, newStatus);

            // 如果是首次加载缓存（进入页面第一次获取到的状态），且来源是轮询，
            // 说明这大概率是历史遗留状态，我们只做缓存更新，不推送消息，避免进入页面时刷屏。
            // 如果来源是 ws_event，说明是实时发生的变更，应该正常推送。
            if (isFirstSeen && payload.sourceType === 'polling_state') {
                console.log(`[报警中心] 摄像头 ${payload.cameraId} 首次轮询加载状态(${newStatus})，建立缓存，不推送`);
                return null;
            }
        } catch (error) {
            console.warn('[报警中心] 路况状态缓存读取失败', error);
        }

        return createAndDispatch({
            eventType: EVENT_TYPES.ROAD_STATUS_CHANGED,
            eventStatus: EVENT_STATUS.ACTIVE,
            sourceType: payload.sourceType || 'unknown',
            projectId: payload.projectId,
            cameraId: payload.cameraId,
            evaluation: newStatus,
            description: payload.description || '道路状态实时推送',
            eventTime: payload.eventTime || payload.timestamp,
            raw: payload.raw
        });
    }

    function handleFenceAlarm(payload) {
        if (!payload) return null;

        logAlarmTrace('WS报警入站', payload, {
            payload
        });

        const normalizedVehicleType = normalizeVehicleType(payload.vehicleType);
        const normalizedTaskScope = normalizeTaskScope(payload.taskScope);
        const vehicleId = String(payload.vehicleId || payload.deviceId || payload.plateNumber || payload.sourceId || '');
        const snapshotContext = getSnapshotState({
            projectId: payload.projectId || '',
            vehicleId
        });
        const prev = snapshotContext.prev;
        const base = {
            sourceType: payload.sourceType || 'ws_event',
            projectId: payload.projectId || '',
            vehicleId,
            plateNumber: payload.plateNumber || vehicleId,
            deviceId: payload.deviceId || '',
            sourceId: payload.sourceId || '',
            vehicleType: normalizedVehicleType,
            taskScope: normalizedTaskScope,
            taskId: payload.taskId || null,
            polylineId: payload.polylineId || null,
            lineName: payload.lineName || '',
            fenceId: payload.fenceId || '',
            fenceName: payload.fenceName || '',
            matchedRestrictedId: payload.matchedRestrictedId || '',
            matchedFenceId: payload.matchedFenceId || '',
            latitude: payload.latitude,
            longitude: payload.longitude,
            alarmType: payload.alarmType || '',
            description: payload.description || '',
            eventTime: payload.eventTime || payload.timestamp,
            raw: payload.raw
        };
        if (payload.alarmType === 'ROUTE_DEVIATION_REGULATED' || payload.alarmType === 'ROUTE_DEVIATION_EXTERNAL') {
            return createAndDispatch({
                ...base,
                eventType: EVENT_TYPES.ROUTE_DEVIATION_ALARM,
                eventStatus: EVENT_STATUS.ACTIVE
            });
        }

        const curr = buildCurrentStatus(payload, normalizedVehicleType, normalizedTaskScope, prev);
        return dispatchFenceStatusTransition(base, prev, curr, true);
    }

    function handleRouteDeviation(payload) {
        if (!payload) return null;
        return createAndDispatch({
            eventType: EVENT_TYPES.ROUTE_DEVIATION_ALARM,
            eventStatus: EVENT_STATUS.ACTIVE,
            sourceType: payload.sourceType || 'ws_event',
            projectId: payload.projectId || '',
            vehicleId: String(payload.vehicleId || payload.plateNumber || payload.deviceId || payload.sourceId || ''),
            plateNumber: payload.plateNumber || payload.vehicleId || '',
            deviceId: payload.deviceId || '',
            sourceId: payload.sourceId || '',
            vehicleType: payload.vehicleType,
            taskScope: payload.taskScope,
            taskId: payload.taskId || null,
            polylineId: payload.polylineId || null,
            lineName: payload.lineName || '',
            latitude: payload.latitude,
            longitude: payload.longitude,
            description: payload.description || '',
            eventTime: payload.eventTime || payload.timestamp,
            raw: payload.raw
        });
    }

    function inferEventFromStatus(payload) {
        if (!payload) return null;

        logAlarmTrace('缓存状态推断入站', payload, {
            payload
        });

        const normalizedVehicleType = normalizeVehicleType(payload.vehicleType);
        const normalizedTaskScope = normalizeTaskScope(payload.taskScope);
        const vehicleId = String(payload.vehicleId || payload.deviceId || payload.plateNumber || payload.sourceId || '');
        if (!vehicleId) return null;

        const snapshotContext = getSnapshotState({
            projectId: payload.projectId,
            vehicleId
        });
        const prev = snapshotContext.prev;
        const curr = buildCurrentStatus(payload, normalizedVehicleType, normalizedTaskScope, prev);

        const base = {
            sourceType: payload.sourceType || 'polling_state',
            projectId: payload.projectId || '',
            vehicleId,
            plateNumber: payload.plateNumber || vehicleId,
            deviceId: payload.deviceId || '',
            sourceId: payload.sourceId || '',
            vehicleType: normalizedVehicleType,
            taskScope: normalizedTaskScope,
            taskId: payload.taskId || null,
            polylineId: payload.polylineId || null,
            lineName: payload.lineName || '',
            fenceId: payload.fenceId || '',
            fenceName: payload.fenceName || '',
            matchedRestrictedId: payload.matchedRestrictedId || '',
            latitude: payload.latitude,
            longitude: payload.longitude,
            description: payload.description || '',
            eventTime: payload.eventTime || payload.timestamp,
            raw: payload.raw
        };
        return dispatchFenceStatusTransition(base, prev, curr, true);
    }

    function resetState(filter) {
        if (!filter || (!filter.projectId && !filter.vehicleId)) {
            activeEvents.clear();
            statusSnapshots.clear();
            return;
        }

        const targetProjectId = filter.projectId ? String(filter.projectId) : null;
        const targetVehicleId = filter.vehicleId ? String(filter.vehicleId) : null;

        Array.from(activeEvents.keys()).forEach(key => {
            const parts = String(key).split('|');
            const projectId = parts[1] || '';
            const vehicleId = parts[2] || '';
            if ((targetProjectId === null || projectId === targetProjectId) &&
                (targetVehicleId === null || vehicleId === targetVehicleId)) {
                activeEvents.delete(key);
            }
        });

        Array.from(statusSnapshots.keys()).forEach(key => {
            const parts = String(key).split('|');
            const projectId = parts[0] || '';
            const vehicleId = parts[1] || '';
            if ((targetProjectId === null || projectId === targetProjectId) &&
                (targetVehicleId === null || vehicleId === targetVehicleId)) {
                statusSnapshots.delete(key);
            }
        });
    }

    function getActiveEvents() {
        return Array.from(activeEvents.values());
    }

    return {
        EVENT_STATUS,
        EVENT_TYPES,
        handleFenceAlarm,
        handleRouteDeviation,
        handleRoadStatusChange,
        inferEventFromStatus,
        getActiveEvents,
        resetState
    };
})();

window.resetAdminAlarmState = function(filter) {
    if (typeof AdminAlarmEventCenter !== 'undefined' &&
        typeof AdminAlarmEventCenter.resetState === 'function') {
        AdminAlarmEventCenter.resetState(filter);
        console.log('[报警事件中心] 已重置报警状态', filter || 'all');
    }
};

console.log('[报警事件中心] 模块已加载');
