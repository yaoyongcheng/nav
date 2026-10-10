/**
 * 管理端车辆管理模块
 * 功能：显示和管理临时车辆和固定车辆
 * 作者：系统自动生成
 * 日期：2026-01-07
 */

const AdminVehicleManager = (function() {
    'use strict';

    // API配置
    const API_CONFIG = {
        baseURL: 'https://dmap.cscec3bxjy.cn/api/transport',
        endpoints: {
            tempVehicles: '/temp-vehicle/project-vehicles',    // 临时车辆
            fixedVehicles: '/tracker/project-locations',        // 固定车辆（设备位置）
            trackerOnline: '/tracker/online'                   // 固定车辆在线状态增强判断
        }
    };

    const ADMIN_TRANSPORT_IMAGE_BASE = 'images/工地数字导航小程序切图/管理/2X/运输管理/';
    const VEHICLE_ICON_FILES = Object.freeze({
        temp: '临时车.png',
        fixed: '固定车.png',
        alert: '报警车.png'
    });
    const VEHICLE_ICON_LAYOUT = Object.freeze({
        width: 39 * 0.62,
        height: 75 * 0.62
    });

    function isMeaningfulValue(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    function pickVehicleValue() {
        for (let i = 0; i < arguments.length; i++) {
            if (isMeaningfulValue(arguments[i])) {
                return arguments[i];
            }
        }
        return '';
    }

    function normalizeVehicleType(value, fallbackType) {
        if (value === 1 || value === '1' || value === 'fixed' || value === '固定车') {
            return 'fixed';
        }
        if (value === 0 || value === '0' || value === 2 || value === '2' || value === 'temp' || value === '临时车') {
            return 'temp';
        }
        return fallbackType || value || '';
    }

    function normalizeVehicleListResponse(result) {
        if (!result) return [];
        if (Array.isArray(result)) return result;
        if (Array.isArray(result.data)) return result.data;
        if (result.data && Array.isArray(result.data.list)) return result.data.list;
        if (result.data && Array.isArray(result.data.items)) return result.data.items;
        if (Array.isArray(result.list)) return result.list;
        if (Array.isArray(result.items)) return result.items;
        return [];
    }

    function formatVehicleDisplayValue(value, fallback) {
        if (!isMeaningfulValue(value)) {
            return fallback || '未知';
        }
        return String(value);
    }

    function normalizeCoordinateNumber(value) {
        if (!isMeaningfulValue(value)) {
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

    function resolveVehicleCoordinatePayload(options) {
        const rawLongitude = normalizeCoordinateNumber(options && options.rawLongitude);
        const rawLatitude = normalizeCoordinateNumber(options && options.rawLatitude);
        const displayLongitude = normalizeCoordinateNumber(options && options.displayLongitude);
        const displayLatitude = normalizeCoordinateNumber(options && options.displayLatitude);
        const explicitCoordSystem = String(options && options.explicitCoordSystem || '').trim().toLowerCase();
        const hasRawCoordinate = Number.isFinite(rawLongitude) && Number.isFinite(rawLatitude);
        const hasDisplayCoordinate = Number.isFinite(displayLongitude) && Number.isFinite(displayLatitude);

        if (hasDisplayCoordinate) {
            return {
                longitude: displayLongitude,
                latitude: displayLatitude,
                rawLongitude: hasRawCoordinate ? rawLongitude : null,
                rawLatitude: hasRawCoordinate ? rawLatitude : null,
                convertedLongitude: displayLongitude,
                convertedLatitude: displayLatitude,
                coordinateSystem: explicitCoordSystem && explicitCoordSystem.includes('wgs')
                    ? 'display_coordinate'
                    : 'gcj02',
                coordinateSource: hasRawCoordinate ? 'display_preferred' : 'display',
                inputCoordinateSystem: explicitCoordSystem || ''
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
                coordinateSource: 'raw_converted',
                inputCoordinateSystem: explicitCoordSystem || 'wgs84'
            };
        }

        return {
            longitude: null,
            latitude: null,
            rawLongitude: null,
            rawLatitude: null,
            convertedLongitude: null,
            convertedLatitude: null,
            coordinateSystem: explicitCoordSystem || '',
            coordinateSource: 'empty',
            inputCoordinateSystem: explicitCoordSystem || ''
        };
    }

    function isVehicleDebugEnabled() {
        try {
            return (typeof localStorage === 'undefined')
                ? true
                : localStorage.getItem('admin_vehicle_debug') !== 'false';
        } catch (error) {
            return true;
        }
    }

    function summarizeVehicleForDebug(vehicle, type) {
        if (!vehicle) return null;
        return {
            type: type || vehicle.type || '',
            projectId: vehicle.projectId || '',
            plateNumber: vehicle.plateNumber || '',
            deviceId: vehicle.deviceId || '',
            sourceId: vehicle.sourceId || '',
            longitude: vehicle.longitude,
            latitude: vehicle.latitude,
            rawLongitude: vehicle.rawLongitude,
            rawLatitude: vehicle.rawLatitude,
            coordinateSystem: vehicle.coordinateSystem || '',
            updatedAt: vehicle.updatedAt || '',
            inFence: vehicle.inFence,
            inRestricted: vehicle.inRestricted
        };
    }

    function logVehicleChain(stage, payload, level) {
        if (!isVehicleDebugEnabled()) {
            return;
        }

        const writer = (level && console[level]) ? console[level] : console.log;
        writer.call(console, `[车辆链路] ${stage}`, payload || {});
    }

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
                candidate.runtimeId,
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

    function summarizeVehicleAlarmState(vehicle, type) {
        if (!vehicle) return null;

        const resolvedType = type || vehicle.type || vehicle.vehicleType || '';
        const backendInRestricted = hasExplicitBoolean(vehicle.backendInRestricted)
            ? vehicle.backendInRestricted
            : (hasExplicitBoolean(vehicle.inRestricted) ? vehicle.inRestricted : undefined);
        const backendInFence = hasExplicitBoolean(vehicle.backendInFence)
            ? vehicle.backendInFence
            : (hasExplicitBoolean(vehicle.inFence) ? vehicle.inFence : undefined);
        const localInRestricted = hasExplicitBoolean(vehicle.localInRestricted)
            ? vehicle.localInRestricted
            : (hasExplicitBoolean(vehicle.localFenceInRestricted) ? vehicle.localFenceInRestricted : undefined);
        const localInFence = hasExplicitBoolean(vehicle.localInFence)
            ? vehicle.localInFence
            : (hasExplicitBoolean(vehicle.localFenceInFence) ? vehicle.localFenceInFence : undefined);
        const localConfirmedInRestricted = hasExplicitBoolean(vehicle.localConfirmedInRestricted)
            ? vehicle.localConfirmedInRestricted
            : (hasExplicitBoolean(vehicle.localFenceConfirmedInRestricted) ? vehicle.localFenceConfirmedInRestricted : undefined);
        const localConfirmedInFence = hasExplicitBoolean(vehicle.localConfirmedInFence)
            ? vehicle.localConfirmedInFence
            : (hasExplicitBoolean(vehicle.localFenceConfirmedInFence) ? vehicle.localFenceConfirmedInFence : undefined);

        return {
            type: resolvedType,
            runtimeId: vehicle.runtimeId || getMarkerPrimaryId(vehicle, resolvedType),
            vehicleId: vehicle.vehicleId || '',
            plateNumber: vehicle.plateNumber || '',
            deviceId: vehicle.deviceId || '',
            sourceId: vehicle.sourceId || '',
            projectId: vehicle.projectId || '',
            lastDataSource: vehicle.lastDataSource || '',
            sourceUpdatedAtMs: Number(vehicle.sourceUpdatedAtMs || 0),
            receivedAtMs: Number(vehicle.receivedAtMs || 0),
            lastSeenAt: Number(vehicle.lastSeenAt || 0),
            updatedAt: vehicle.updatedAt || '',
            backendInRestricted,
            backendInFence,
            localInRestricted,
            localInFence,
            localConfirmedInRestricted,
            localConfirmedInFence,
            effectiveInRestricted: hasExplicitBoolean(vehicle.effectiveInRestricted)
                ? vehicle.effectiveInRestricted
                : backendInRestricted,
            effectiveInFence: hasExplicitBoolean(vehicle.effectiveInFence)
                ? vehicle.effectiveInFence
                : backendInFence,
            alarmDecisionSource: vehicle.alarmDecisionSource || '',
            matchedFenceId: vehicle.matchedFenceId || vehicle.localFenceId || '',
            matchedRestrictedId: vehicle.matchedRestrictedId || vehicle.localMatchedRestrictedId || '',
            fenceId: vehicle.fenceId || vehicle.localFenceId || '',
            fenceName: vehicle.fenceName || vehicle.localFenceName || ''
        };
    }

    function resolveEffectiveAlertState(type, backendInRestricted, backendInFence, localInRestricted, localInFence) {
        let effectiveInRestricted = false;
        let effectiveInFence = true;
        let alarmDecisionSource = 'default';

        if (backendInRestricted === true || localInRestricted === true) {
            effectiveInRestricted = true;
            if (backendInRestricted === true && localInRestricted === true) {
                alarmDecisionSource = 'backend+local_fence';
            } else if (backendInRestricted === true) {
                alarmDecisionSource = 'backend';
            } else {
                alarmDecisionSource = 'local_fence';
            }
        } else if (backendInRestricted === false || localInRestricted === false) {
            effectiveInRestricted = false;
        }

        if (backendInFence === false || localInFence === false) {
            effectiveInFence = false;
            if (type === 'fixed' && !effectiveInRestricted) {
                if (backendInFence === false && localInFence === false) {
                    alarmDecisionSource = 'backend+local_fence';
                } else if (backendInFence === false) {
                    alarmDecisionSource = 'backend';
                } else {
                    alarmDecisionSource = 'local_fence';
                }
            }
        } else if (backendInFence === true || localInFence === true) {
            effectiveInFence = true;
        }

        return {
            effectiveInRestricted,
            effectiveInFence,
            alarmDecisionSource
        };
    }

    function getResolvedLocalAlertState(snapshot) {
        if (!snapshot) {
            return {
                localInRestricted: undefined,
                localInFence: undefined
            };
        }

        const localInRestricted = hasExplicitBoolean(snapshot.localFenceConfirmedInRestricted)
            ? snapshot.localFenceConfirmedInRestricted
            : (hasExplicitBoolean(snapshot.localFenceInRestricted) ? snapshot.localFenceInRestricted : undefined);
        const localInFence = hasExplicitBoolean(snapshot.localFenceConfirmedInFence)
            ? snapshot.localFenceConfirmedInFence
            : (hasExplicitBoolean(snapshot.localFenceInFence) ? snapshot.localFenceInFence : undefined);

        return {
            localInRestricted,
            localInFence
        };
    }

    function buildVehicleTraceCoreInfo(vehicle, type, meta) {
        if (!vehicle) return null;

        const resolvedType = type || vehicle.type || vehicle.vehicleType || '';
        const snapshot = summarizeVehicleAlarmState(vehicle, resolvedType) || {};
        const currentLng = vehicle.longitude !== undefined && vehicle.longitude !== null
            ? Number(vehicle.longitude)
            : undefined;
        const currentLat = vehicle.latitude !== undefined && vehicle.latitude !== null
            ? Number(vehicle.latitude)
            : undefined;

        return {
            chain: meta && meta.chain ? meta.chain : '',
            phase: meta && meta.phase ? meta.phase : '',
            type: resolvedType,
            runtimeId: snapshot.runtimeId || '',
            plateNumber: snapshot.plateNumber || '',
            deviceId: snapshot.deviceId || '',
            sourceId: snapshot.sourceId || '',
            projectId: snapshot.projectId || '',
            longitude: currentLng,
            latitude: currentLat,
            backendInRestricted: snapshot.backendInRestricted,
            backendInFence: snapshot.backendInFence,
            localInRestricted: snapshot.localInRestricted,
            localInFence: snapshot.localInFence,
            localConfirmedInRestricted: snapshot.localConfirmedInRestricted,
            localConfirmedInFence: snapshot.localConfirmedInFence,
            effectiveInRestricted: snapshot.effectiveInRestricted,
            effectiveInFence: snapshot.effectiveInFence,
            alarmDecisionSource: snapshot.alarmDecisionSource || '',
            matchedFenceId: snapshot.matchedFenceId || '',
            matchedRestrictedId: snapshot.matchedRestrictedId || '',
            fenceId: snapshot.fenceId || '',
            fenceName: snapshot.fenceName || '',
            updatedAt: snapshot.updatedAt || '',
            sourceUpdatedAtMs: snapshot.sourceUpdatedAtMs || 0,
            receivedAtMs: snapshot.receivedAtMs || 0,
            lastSeenAt: snapshot.lastSeenAt || 0,
            lastDataSource: snapshot.lastDataSource || '',
            traceAt: new Date().toISOString()
        };
    }

    function logVehicleTrace(stage, vehicleOrIdentifier, payload, level) {
        if (!isVehicleDebugEnabled() || !shouldTraceVehicle(vehicleOrIdentifier)) {
            return;
        }

        const writer = (level && console[level]) ? console[level] : console.log;
        writer.call(console, `[车辆报警调试] ${stage}`, payload || {});
    }

    function describeSnapshotDecision(current, incomingSourceUpdatedAtMs, incomingReceivedAtMs, incomingSource) {
        if (!current) {
            return 'no_existing_snapshot';
        }

        const existingSourceUpdatedAtMs = Number(current.sourceUpdatedAtMs || 0);
        const existingReceivedAtMs = Number(current.receivedAtMs || 0);

        if (incomingSourceUpdatedAtMs && existingSourceUpdatedAtMs && incomingSourceUpdatedAtMs !== existingSourceUpdatedAtMs) {
            return incomingSourceUpdatedAtMs > existingSourceUpdatedAtMs
                ? 'newer_source_updated_at'
                : 'older_source_updated_at';
        }

        if (incomingSourceUpdatedAtMs && !existingSourceUpdatedAtMs) {
            return 'incoming_has_source_updated_at';
        }

        if (!incomingSourceUpdatedAtMs && existingSourceUpdatedAtMs) {
            return 'existing_has_source_updated_at';
        }

        if (incomingReceivedAtMs !== existingReceivedAtMs) {
            return incomingReceivedAtMs > existingReceivedAtMs
                ? 'newer_received_at'
                : 'older_received_at';
        }

        const incomingPriority = getDataSourcePriority(incomingSource);
        const existingPriority = getDataSourcePriority(current.lastDataSource);
        if (incomingPriority !== existingPriority) {
            return incomingPriority > existingPriority
                ? 'higher_source_priority'
                : 'lower_source_priority';
        }

        return 'same_priority_same_timestamp';
    }

    function buildVehicleInfoContent(vehicle, type) {
        const vehicleTypeLabel = type === 'fixed' ? '固定车辆' : '临时车辆';
        const plateNumber = formatVehicleDisplayValue(vehicle.plateNumber, '未知');
        const deviceId = formatVehicleDisplayValue(vehicle.deviceId, '未知');
        const updatedAt = formatVehicleDisplayValue(vehicle.updatedAt, '未知');

        return `
<div style="padding:10px; min-width: 210px; line-height: 1.7;">
    <div style="font-weight: 600; margin-bottom: 6px;">${vehicleTypeLabel}</div>
    <div>车牌：${plateNumber}</div>
    <div>定位器：${deviceId}</div>
    <div>更新时间：${updatedAt}</div>
</div>`;
    }

    function mapTempVehicleItem(item) {
        const plateNumber = pickVehicleValue(item.plateNumber, item.plate_number);
        const deviceId = pickVehicleValue(item.deviceId, item.device_id, item.trackerId, item.tracker_id, item.trackerID, item.locatorId, item.locator_id);
        const coordinates = resolveVehicleCoordinatePayload({
            rawLongitude: pickVehicleValue(item.RawLongitude, item.rawLongitude, item.raw_longitude, item.RawLng),
            rawLatitude: pickVehicleValue(item.RawLatitude, item.rawLatitude, item.raw_latitude, item.RawLat),
            displayLongitude: pickVehicleValue(item.longitude, item.lng, item.lon, item.Longitude),
            displayLatitude: pickVehicleValue(item.latitude, item.lat, item.Latitude),
            explicitCoordSystem: pickVehicleValue(item.coordinateSystem, item.coordinate_system, item.coordType, item.coord_type, item.CoordType)
        });

        return {
            type: 'temp',
            plateNumber: plateNumber,
            deviceId: deviceId,
            sourceId: pickVehicleValue(item.sourceId, item.source_id, deviceId, plateNumber),
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            rawLatitude: coordinates.rawLatitude,
            rawLongitude: coordinates.rawLongitude,
            convertedLatitude: coordinates.convertedLatitude,
            convertedLongitude: coordinates.convertedLongitude,
            coordinateSystem: coordinates.coordinateSystem,
            coordinateSource: coordinates.coordinateSource,
            projectId: pickVehicleValue(item.projectId, item.project_id, item.projectID, item.ProjectId),
            updatedAt: pickVehicleValue(item.updatedAt, item.updated_at, item.updateTime, item.UpdateTime, item.last_active_time, item.lastActiveTime),
            taskName: pickVehicleValue(item.taskName, item.task_name, item.lineName, item.line_name, item.taskLineName),
            driverName: pickVehicleValue(item.driverName, item.driver_name),
            driverPhone: pickVehicleValue(item.driverPhone, item.driver_phone, item.phone),
            taskId: pickVehicleValue(item.taskId, item.task_id, item.taskID),
            taskScope: pickVehicleValue(item.taskScope, item.task_scope, item.workSiteScope, item.work_site_scope),
            lineName: pickVehicleValue(item.lineName, item.line_name, item.taskLineName),
            polylineId: pickVehicleValue(item.polylineId, item.polyline_id, item.taskPolylineId),
            matchedFenceId: pickVehicleValue(item.matchedFenceId, item.matched_fence_id, item.matchedFenceID),
            matchedRestrictedId: pickVehicleValue(item.matchedRestrictedId, item.matched_restricted_id, item.matchedRestrictedID),
            inRestricted: pickVehicleValue(item.inRestricted, item.in_restricted),
            inFence: pickVehicleValue(item.inFence, item.in_fence),
            fenceId: pickVehicleValue(item.fenceId, item.fence_id),
            fenceName: pickVehicleValue(item.fenceName, item.fence_name),
            vehicleType: normalizeVehicleType(item.vehicleType || item.vehicle_type, 'temp')
        };
    }

    function mapFixedVehicleItem(item) {
        const explicitCoordSystem = String(
            pickVehicleValue(
                item.coordinateSystem,
                item.coordinate_system,
                item.coordType,
                item.coord_type,
                item.CoordType,
                (typeof window !== 'undefined' && window.__ADMIN_FIXED_COORD_SYSTEM__) || '',
                (typeof localStorage !== 'undefined' && localStorage.getItem('admin_fixed_coord_system')) || ''
            ) || ''
        ).trim().toLowerCase();
        const coordinates = resolveVehicleCoordinatePayload({
            rawLongitude: pickVehicleValue(item.RawLongitude, item.rawLongitude, item.raw_longitude, item.RawLng),
            rawLatitude: pickVehicleValue(item.RawLatitude, item.rawLatitude, item.raw_latitude, item.RawLat),
            displayLongitude: pickVehicleValue(item.Longitude, item.longitude, item.lng, item.lon),
            displayLatitude: pickVehicleValue(item.Latitude, item.latitude, item.lat),
            explicitCoordSystem: explicitCoordSystem
        });
        const deviceId = pickVehicleValue(item.TrackerID, item.trackerID, item.DeviceID, item.tracker_id, item.trackerId, item.device_id, item.deviceId, 'unknown');
        const plateNumber = pickVehicleValue(item.PlateNumber, item.plate_number, item.plateNumber);

        return {
            type: 'fixed',
            deviceId: deviceId,
            sourceId: pickVehicleValue(item.sourceId, item.source_id, deviceId, plateNumber, item.trackerID),
            plateNumber: plateNumber,
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            rawLatitude: coordinates.rawLatitude,
            rawLongitude: coordinates.rawLongitude,
            convertedLatitude: coordinates.convertedLatitude,
            convertedLongitude: coordinates.convertedLongitude,
            coordinateSystem: coordinates.coordinateSystem,
            coordinateSource: coordinates.coordinateSource,
            direction: pickVehicleValue(item.Direction, item.direction, 0),
            updatedAt: pickVehicleValue(item.UpdatedAt, item.updated_at, item.updatedAt, item.UpdateTime, item.updateTime, item.last_active_time, item.lastActiveTime),
            taskName: pickVehicleValue(item.TaskName, item.task_name, item.taskName, item.LineName, item.line_name, item.lineName, item.taskLineName),
            driverName: pickVehicleValue(item.DriverName, item.driver_name, item.driverName),
            driverPhone: pickVehicleValue(item.Phone, item.phone, item.driver_phone, item.driverPhone),
            projectId: pickVehicleValue(item.ProjectId, item.project_id, item.projectId, item.projectID),
            taskId: pickVehicleValue(item.TaskID, item.task_id, item.taskId, item.taskID),
            taskScope: pickVehicleValue(item.TaskScope, item.task_scope, item.taskScope, item.workSiteScope, item.work_site_scope),
            lineName: pickVehicleValue(item.LineName, item.line_name, item.lineName, item.taskLineName),
            polylineId: pickVehicleValue(item.polylineId, item.polyline_id, item.taskPolylineId, item.task_polyline_id),
            matchedFenceId: pickVehicleValue(item.matchedFenceId, item.matched_fence_id, item.matchedFenceID),
            matchedRestrictedId: pickVehicleValue(item.matchedRestrictedId, item.matched_restricted_id, item.matchedRestrictedID),
            inRestricted: pickVehicleValue(item.inRestricted, item.in_restricted),
            inFence: pickVehicleValue(item.inFence, item.in_fence),
            workAttr: pickVehicleValue(item.workAttr, item.work_attr),
            vehicleType: normalizeVehicleType(item.VehicleType || item.vehicleType || item.vehicle_type, 'fixed')
        };
    }

    function getFenceMatchScore(result) {
        if (!result) return -1;
        return (result.inRestricted ? 2 : 0) + (result.inFence ? 1 : 0);
    }

    function resolveFenceCheckCandidate(vehicle, type) {
        if (typeof AdminFenceManager === 'undefined') {
            return null;
        }

        const currentLng = Number(vehicle.longitude);
        const currentLat = Number(vehicle.latitude);
        if (isNaN(currentLng) || isNaN(currentLat)) {
            return null;
        }

        const vehicleId = type === 'fixed' ? (vehicle.deviceId || 'unknown') : (vehicle.plateNumber || 'unknown');
        const currentResult = AdminFenceManager.checkVehicleFenceStatus(currentLat, currentLng, vehicleId, type);
        let best = {
            mode: 'current',
            position: [currentLng, currentLat],
            result: currentResult
        };

        if (type !== 'fixed') {
            return best;
        }

        const convertedLng = Number(vehicle.convertedLongitude);
        const convertedLat = Number(vehicle.convertedLatitude);
        if (isNaN(convertedLng) || isNaN(convertedLat)) {
            return best;
        }

        const currentScore = getFenceMatchScore(currentResult);
        const convertedResult = AdminFenceManager.checkVehicleFenceStatus(convertedLat, convertedLng, vehicleId, type);
        const convertedScore = getFenceMatchScore(convertedResult);

        if (convertedScore > currentScore) {
            best = {
                mode: 'converted',
                position: [convertedLng, convertedLat],
                result: convertedResult
            };
        }

        return best;
    }

    // 车辆数据
    let vehicleData = {
        temp: [],       // 临时车辆数据
        fixed: []       // 固定车辆数据
    };

    // 车辆运行时缓存：统一接收轮询与 WS，渲染层只读取该缓存的有效快照
    const vehicleRuntimeStore = {
        temp: new Map(),
        fixed: new Map()
    };

    // 车辆快速索引：支持按车牌号/定位器ID反查车辆与 marker
    const vehicleLookup = new Map();

    // 车辆标记
    let vehicleMarkers = {
        temp: [],       // 临时车辆标记
        fixed: []       // 固定车辆标记
    };

    // 筛选状态
    let filterState = {
        temp: true,     // 是否显示临时车
        fixed: true     // 是否显示固定车
    };

    // 地图实例
    let map = null;
    let hasBoundRealtimeListener = false;

    // 路线数据（用于吸附）
    let routePolylines = [];

    // 初始化标志
    let isInitialized = false;
    let isUIInitialized = false; // UI是否已初始化

    // 定时刷新
    let refreshTimer = null;
    let currentProjectId = null; // 当前项目ID
    const REFRESH_INTERVAL = 1000; // 刷新间隔1秒（与司机端上报间隔一致）
    const WS_POSITION_MODE = 'enhance_only'; // 轮询主链路，WS仅增强已显示车辆
    const POLLING_ALERT_ENABLED = true; // 轮询字段驱动报警展示
    const WS_ALERT_FALLBACK_ENABLED = false; // WS位置字段不稳定，默认不驱动报警展示
    const TEMP_VEHICLE_TTL_MS = 5000;
    const FIXED_VEHICLE_TTL_MS = 5000;
    const LOCAL_FENCE_CONFIRM_COUNT = 2;
    const LOCAL_FENCE_CONFIRM_MS = 1000;
    const FIXED_ONLINE_STATUS_CACHE_MS = 5000;
    const FIXED_ONLINE_PENDING_GRACE_MS = 3000;
    const FIXED_ONLINE_RETAIN_MS = 5000;
    let isLoadingVehicles = false;
    let hasPendingRefresh = false;
    const fixedVehicleOnlineStatusCache = new Map();
    let fixedVehicleOnlineCheckPromise = null;

    function getVehicleRuntimeStore(type) {
        return vehicleRuntimeStore[type] || vehicleRuntimeStore.temp;
    }

    function getVehicleTtl(type) {
        return type === 'fixed' ? FIXED_VEHICLE_TTL_MS : TEMP_VEHICLE_TTL_MS;
    }

    function isLocalSupplementField(key) {
        return key === 'localMatchedRestrictedId' ||
            key.startsWith('localFence');
    }

    function resolveDebouncedLocalBoolean(options) {
        const now = Number(options.now || Date.now());
        const nextCandidate = options.nextCandidate === true;
        const prevConfirmed = options.prevConfirmed === true;
        const prevCandidate = options.prevCandidate === true;
        const prevCount = Number(options.prevCount || 0);
        const prevSinceMs = Number(options.prevSinceMs || 0);
        const thresholdCount = Number(options.thresholdCount || LOCAL_FENCE_CONFIRM_COUNT);
        const thresholdMs = Number(options.thresholdMs || LOCAL_FENCE_CONFIRM_MS);
        const trackToken = options.trackToken === true;
        const nextToken = options.nextToken ? String(options.nextToken) : '';
        const prevToken = options.prevToken ? String(options.prevToken) : '';
        const keepsSequence = prevCount > 0 &&
            prevCandidate === nextCandidate &&
            (!trackToken || prevToken === nextToken);

        const stableCount = keepsSequence ? (prevCount + 1) : 1;
        const stableSinceMs = keepsSequence ? (prevSinceMs || now) : now;
        const stableDurationMs = Math.max(0, now - stableSinceMs);
        let confirmedValue = prevConfirmed;

        if (nextCandidate === prevConfirmed) {
            confirmedValue = nextCandidate;
        } else if (stableCount >= thresholdCount && stableDurationMs >= thresholdMs) {
            confirmedValue = nextCandidate;
        }

        return {
            confirmedValue,
            stableCount,
            stableSinceMs,
            stableDurationMs,
            token: nextToken
        };
    }

    function toTimestampMs(value, fallbackMs) {
        if (value === undefined || value === null || value === '') {
            return fallbackMs || 0;
        }

        if (typeof value === 'number' && isFinite(value)) {
            return value > 1e12 ? value : value * 1000;
        }

        const normalized = Date.parse(value);
        if (!isNaN(normalized)) {
            return normalized;
        }

        return fallbackMs || 0;
    }

    function shouldApplyVehicleValue(value) {
        return isMeaningfulValue(value) || typeof value === 'boolean' || typeof value === 'number' || Array.isArray(value);
    }

    function hasExplicitBoolean(value) {
        return value === true || value === false;
    }

    function getDataSourcePriority(source) {
        switch (source) {
            case 'polling':
                return 3;
            case 'ws':
                return 2;
            case 'local_fence':
                return 1;
            default:
                return 0;
        }
    }

    function resolveIncomingSourceUpdatedAtMs(incoming, meta) {
        const explicit = meta && typeof meta.sourceUpdatedAtMs === 'number'
            ? meta.sourceUpdatedAtMs
            : 0;
        if (explicit > 0) {
            return explicit;
        }

        return toTimestampMs(incoming && incoming.updatedAt, 0);
    }

    function shouldIncomingSnapshotWin(current, incomingSourceUpdatedAtMs, incomingReceivedAtMs, incomingSource) {
        if (!current) {
            return true;
        }

        const existingSourceUpdatedAtMs = Number(current.sourceUpdatedAtMs || 0);
        const existingReceivedAtMs = Number(current.receivedAtMs || 0);
        const incomingPriority = getDataSourcePriority(incomingSource);
        const existingPriority = getDataSourcePriority(current.lastDataSource);

        if (incomingSourceUpdatedAtMs && existingSourceUpdatedAtMs && incomingSourceUpdatedAtMs !== existingSourceUpdatedAtMs) {
            return incomingSourceUpdatedAtMs > existingSourceUpdatedAtMs;
        }

        if (incomingSourceUpdatedAtMs && !existingSourceUpdatedAtMs) {
            return true;
        }

        if (!incomingSourceUpdatedAtMs && existingSourceUpdatedAtMs) {
            return false;
        }

        if (incomingReceivedAtMs !== existingReceivedAtMs) {
            return incomingReceivedAtMs >= existingReceivedAtMs;
        }

        return incomingPriority >= existingPriority;
    }

    function deriveRenderableVehicleSnapshot(snapshot, type) {
        if (!snapshot) return null;

        const derived = {
            ...snapshot,
            type: type || snapshot.type || 'temp'
        };

        const backendInRestricted = hasExplicitBoolean(snapshot.inRestricted)
            ? snapshot.inRestricted
            : undefined;
        const backendInFence = hasExplicitBoolean(snapshot.inFence)
            ? snapshot.inFence
            : undefined;
        const resolvedLocalAlertState = getResolvedLocalAlertState(snapshot);
        const localInRestricted = resolvedLocalAlertState.localInRestricted;
        const localInFence = resolvedLocalAlertState.localInFence;
        const effectiveState = resolveEffectiveAlertState(
            derived.type,
            backendInRestricted,
            backendInFence,
            localInRestricted,
            localInFence
        );

        derived.backendInRestricted = backendInRestricted;
        derived.backendInFence = backendInFence;
        derived.localInRestricted = localInRestricted;
        derived.localInFence = localInFence;
        derived.localRawInRestricted = hasExplicitBoolean(snapshot.localFenceInRestricted)
            ? snapshot.localFenceInRestricted
            : undefined;
        derived.localRawInFence = hasExplicitBoolean(snapshot.localFenceInFence)
            ? snapshot.localFenceInFence
            : undefined;
        derived.localConfirmedInRestricted = hasExplicitBoolean(snapshot.localFenceConfirmedInRestricted)
            ? snapshot.localFenceConfirmedInRestricted
            : undefined;
        derived.localConfirmedInFence = hasExplicitBoolean(snapshot.localFenceConfirmedInFence)
            ? snapshot.localFenceConfirmedInFence
            : undefined;
        derived.effectiveInRestricted = effectiveState.effectiveInRestricted;
        derived.effectiveInFence = effectiveState.effectiveInFence;
        derived.alarmDecisionSource = effectiveState.alarmDecisionSource;
        derived.inRestricted = effectiveState.effectiveInRestricted;
        derived.inFence = effectiveState.effectiveInFence;
        derived.matchedRestrictedId = pickVehicleValue(
            snapshot.matchedRestrictedId,
            snapshot.localMatchedRestrictedId
        );
        derived.fenceId = pickVehicleValue(snapshot.fenceId, snapshot.localFenceId);
        derived.fenceName = pickVehicleValue(snapshot.fenceName, snapshot.localFenceName);
        derived.longitude = shouldApplyVehicleValue(snapshot.longitude)
            ? snapshot.longitude
            : snapshot.localFenceLongitude;
        derived.latitude = shouldApplyVehicleValue(snapshot.latitude)
            ? snapshot.latitude
            : snapshot.localFenceLatitude;
        derived.dataUpdatedAt = derived.updatedAt ||
            snapshot.dataUpdatedAt ||
            new Date(Number(snapshot.sourceUpdatedAtMs || snapshot.receivedAtMs || snapshot.lastSeenAt || Date.now())).toISOString();

        return derived;
    }

    function mergeVehicleSnapshot(existing, incoming, meta) {
        const current = existing ? { ...existing } : {};
        const source = meta && meta.source ? meta.source : 'unknown';
        const seenAt = meta && meta.seenAt ? meta.seenAt : Date.now();
        const incomingSourceUpdatedAtMs = resolveIncomingSourceUpdatedAtMs(incoming, meta);
        const overwriteExisting = shouldIncomingSnapshotWin(current, incomingSourceUpdatedAtMs, seenAt, source);
        const decisionReason = describeSnapshotDecision(current, incomingSourceUpdatedAtMs, seenAt, source);

        Object.keys(incoming || {}).forEach(key => {
            const value = incoming[key];
            if (!shouldApplyVehicleValue(value)) {
                return;
            }

            const forceSupplementUpdate = source === 'local_fence' && isLocalSupplementField(key);
            if (forceSupplementUpdate || overwriteExisting || !shouldApplyVehicleValue(current[key])) {
                current[key] = value;
            }
        });

        current.type = meta && meta.type ? meta.type : (incoming && incoming.type) || current.type || 'temp';
        current.projectId = (incoming && incoming.projectId) || current.projectId || currentProjectId || '';
        current.runtimeId = getMarkerPrimaryId(current, current.type);
        current.lastSeenAt = Math.max(Number(current.lastSeenAt || 0), seenAt);

        if (overwriteExisting) {
            current.receivedAtMs = seenAt;
            current.lastDataSource = source;
            if (incomingSourceUpdatedAtMs > 0) {
                current.sourceUpdatedAtMs = incomingSourceUpdatedAtMs;
            }
            current.dataUpdatedAtMs = Math.max(
                Number(current.sourceUpdatedAtMs || 0),
                Number(current.receivedAtMs || 0),
                Number(current.lastSeenAt || 0)
            );
            current.dataUpdatedAt = current.updatedAt ||
                current.dataUpdatedAt ||
                new Date(current.dataUpdatedAtMs || seenAt).toISOString();
        } else {
            current.receivedAtMs = Number(current.receivedAtMs || 0);
            current.sourceUpdatedAtMs = Number(current.sourceUpdatedAtMs || 0);
            current.dataUpdatedAtMs = Math.max(
                Number(current.sourceUpdatedAtMs || 0),
                Number(current.receivedAtMs || 0),
                Number(current.lastSeenAt || 0)
            );
            current.dataUpdatedAt = current.updatedAt ||
                current.dataUpdatedAt ||
                new Date(current.dataUpdatedAtMs || current.lastSeenAt || seenAt).toISOString();
        }

        if (source === 'polling') {
            current.lastPollAt = seenAt;
        } else if (source === 'ws') {
            current.lastWsAt = seenAt;
        } else if (source === 'local_fence') {
            current.lastLocalFenceAt = seenAt;
        }

        logVehicleTrace('缓存合并', current, {
            source,
            overwriteExisting,
            decisionReason,
            incoming: summarizeVehicleAlarmState(incoming, meta && meta.type),
            previous: summarizeVehicleAlarmState(existing, existing && existing.type),
            merged: summarizeVehicleAlarmState(current, current.type)
        });

        return current;
    }

    function upsertRuntimeVehicle(type, vehicle, meta) {
        const store = getVehicleRuntimeStore(type);
        const runtimeId = getMarkerPrimaryId(vehicle, type);
        if (!runtimeId) {
            return null;
        }

        const existing = store.get(String(runtimeId)) || null;
        const merged = mergeVehicleSnapshot(existing, vehicle, {
            ...(meta || {}),
            type
        });
        merged.runtimeId = runtimeId;
        store.set(String(runtimeId), merged);
        return merged;
    }

    function pruneRuntimeVehicles(type) {
        const store = getVehicleRuntimeStore(type);
        const ttlMs = getVehicleTtl(type);
        const now = Date.now();
        const fixedTrackerIdsToCheck = [];

        Array.from(store.entries()).forEach(([runtimeId, vehicle]) => {
            const lastSeenAt = Number(vehicle && vehicle.lastSeenAt ? vehicle.lastSeenAt : 0);
            const ageMs = lastSeenAt ? (now - lastSeenAt) : Number.MAX_SAFE_INTEGER;

            if (lastSeenAt && ageMs <= ttlMs) {
                return;
            }

            if (type === 'fixed') {
                const trackerId = String(vehicle && vehicle.deviceId ? vehicle.deviceId : runtimeId).trim();
                const onlineStatus = getFixedVehicleOnlineStatus(trackerId);

                if (onlineStatus && onlineStatus.online && ageMs <= (ttlMs + FIXED_ONLINE_RETAIN_MS)) {
                    logVehicleChain('固定车在线增强保留显示', {
                        trackerId,
                        ageMs,
                        ttlMs,
                        onlineCheckedAt: new Date(onlineStatus.checkedAt).toISOString(),
                        vehicle: summarizeVehicleForDebug(vehicle, type)
                    });
                    return;
                }

                if (!onlineStatus && trackerId && ageMs <= (ttlMs + FIXED_ONLINE_PENDING_GRACE_MS)) {
                    fixedTrackerIdsToCheck.push(trackerId);
                    return;
                }
            }

            const marker = findVehicleMarker(runtimeId) ||
                findVehicleMarker(vehicle && vehicle.plateNumber) ||
                findVehicleMarker(vehicle && vehicle.deviceId) ||
                findVehicleMarker(vehicle && vehicle.sourceId);
            if (marker) {
                stopVehicleBlink(marker);
            }

            store.delete(runtimeId);
            logVehicleChain('运行时车辆过期移除', {
                type,
                ttlMs,
                vehicle: summarizeVehicleForDebug(vehicle, type)
            }, 'warn');
            logVehicleTrace('车辆过期移除', vehicle, {
                type,
                runtimeId,
                ttlMs,
                ageMs,
                vehicle: summarizeVehicleAlarmState(vehicle, type)
            }, 'warn');
        });

        if (type === 'fixed' && fixedTrackerIdsToCheck.length > 0) {
            scheduleFixedVehicleOnlineCheck(fixedTrackerIdsToCheck);
        }
    }

    function isVehicleRenderableByFreshness(vehicle, type, now) {
        const ttlMs = getVehicleTtl(type);
        const lastSeenAt = Number(vehicle && vehicle.lastSeenAt ? vehicle.lastSeenAt : 0);
        if (!lastSeenAt) {
            return false;
        }

        const ageMs = now - lastSeenAt;
        if (ageMs <= ttlMs) {
            return true;
        }

        if (type !== 'fixed') {
            return false;
        }

        const trackerId = String(vehicle && vehicle.deviceId ? vehicle.deviceId : vehicle && vehicle.runtimeId ? vehicle.runtimeId : '').trim();
        const onlineStatus = getFixedVehicleOnlineStatus(trackerId);
        if (onlineStatus && onlineStatus.online && ageMs <= (ttlMs + FIXED_ONLINE_RETAIN_MS)) {
            return true;
        }

        return !onlineStatus && !!trackerId && ageMs <= (ttlMs + FIXED_ONLINE_PENDING_GRACE_MS);
    }

    function getRenderableVehicles(type) {
        const store = getVehicleRuntimeStore(type);
        const now = Date.now();

        return Array.from(store.values())
            .filter(vehicle => isVehicleRenderableByFreshness(vehicle, type, now))
            .map(vehicle => deriveRenderableVehicleSnapshot(vehicle, type))
            .sort((a, b) => Number(b.lastSeenAt || 0) - Number(a.lastSeenAt || 0));
    }

    function refreshVehicleDataFromRuntime() {
        pruneRuntimeVehicles('temp');
        pruneRuntimeVehicles('fixed');
        vehicleData.temp = getRenderableVehicles('temp');
        vehicleData.fixed = getRenderableVehicles('fixed');
        rebuildVehicleLookup();
        updateVehicleCount();
    }

    function syncVehicleAlertsFromRuntime(type) {
        const vehicles = vehicleData[type] || [];
        vehicles.forEach(vehicle => {
            const marker = findVehicleMarker(getMarkerPrimaryId(vehicle, type)) ||
                findVehicleMarker(vehicle.plateNumber) ||
                findVehicleMarker(vehicle.deviceId) ||
                findVehicleMarker(vehicle.sourceId);
            if (!marker) {
                return;
            }

            syncPollingAlertForVehicle(marker, vehicle, type, [vehicle.longitude, vehicle.latitude]);
        });
    }

    function refreshVehiclePresentation() {
        refreshVehicleDataFromRuntime();

        const tracedVehicle = vehicleData.temp.find(shouldTraceVehicle) || vehicleData.fixed.find(shouldTraceVehicle);
        if (tracedVehicle) {
            const tracedType = tracedVehicle.type || normalizeVehicleType(tracedVehicle.vehicleType, 'temp');
            logVehicleTrace('渲染快照', tracedVehicle, {
                renderable: summarizeVehicleAlarmState(tracedVehicle, tracedType),
                alertState: getRealtimeAlertState(tracedVehicle, tracedType)
            });
        }

        if (filterState.temp) {
            updateVehicleMarkers(vehicleData.temp, 'temp');
        } else {
            removeAllMarkersByType('temp');
        }

        if (filterState.fixed) {
            updateVehicleMarkers(vehicleData.fixed, 'fixed');
        } else {
            removeAllMarkersByType('fixed');
        }

        syncVehicleAlertsFromRuntime('temp');
        syncVehicleAlertsFromRuntime('fixed');
    }

    function clearRuntimeVehicleStore() {
        vehicleRuntimeStore.temp.clear();
        vehicleRuntimeStore.fixed.clear();
    }

    function getAuthHeaders() {
        const token = sessionStorage.getItem('authToken') || '';
        const headers = {
            'Content-Type': 'application/json'
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        return headers;
    }

    function getFixedVehicleOnlineStatus(trackerId) {
        if (!trackerId) return null;
        const cached = fixedVehicleOnlineStatusCache.get(String(trackerId));
        if (!cached) return null;

        if ((Date.now() - Number(cached.checkedAt || 0)) > FIXED_ONLINE_STATUS_CACHE_MS) {
            return null;
        }

        return cached;
    }

    async function fetchFixedVehicleOnlineStatuses(trackerIds) {
        const normalizedTrackerIds = Array.from(new Set(
            (trackerIds || [])
                .filter(Boolean)
                .map(id => String(id).trim())
                .filter(Boolean)
        ));
        if (!normalizedTrackerIds.length) {
            return [];
        }

        const query = new URLSearchParams();
        query.set('trackerId', normalizedTrackerIds.join(','));
        const url = `${API_CONFIG.baseURL}${API_CONFIG.endpoints.trackerOnline}?${query.toString()}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        return normalizeVehicleListResponse(result);
    }

    function scheduleFixedVehicleOnlineCheck(trackerIds) {
        const normalizedTrackerIds = Array.from(new Set(
            (trackerIds || [])
                .filter(Boolean)
                .map(id => String(id).trim())
                .filter(Boolean)
        ));
        if (!normalizedTrackerIds.length || fixedVehicleOnlineCheckPromise) {
            return;
        }

        fixedVehicleOnlineCheckPromise = fetchFixedVehicleOnlineStatuses(normalizedTrackerIds)
            .then(list => {
                const checkedAt = Date.now();
                normalizedTrackerIds.forEach(trackerId => {
                    fixedVehicleOnlineStatusCache.set(trackerId, {
                        trackerId,
                        online: false,
                        checkedAt
                    });
                });

                (list || []).forEach(item => {
                    const trackerId = String(
                        pickVehicleValue(item.trackerId, item.tracker_id, item.TrackerID, item.deviceId, item.device_id)
                    ).trim();
                    if (!trackerId) return;
                    fixedVehicleOnlineStatusCache.set(trackerId, {
                        trackerId,
                        online: !!item.online,
                        checkedAt
                    });
                });

                logVehicleChain('固定车在线状态增强完成', {
                    trackerIds: normalizedTrackerIds,
                    onlineCount: (list || []).filter(item => !!item.online).length,
                    checkedAt: new Date(checkedAt).toISOString()
                });
            })
            .catch(error => {
                logVehicleChain('固定车在线状态增强失败', {
                    trackerIds: normalizedTrackerIds,
                    error: error && error.message ? error.message : String(error)
                }, 'warn');
            })
            .finally(() => {
                fixedVehicleOnlineCheckPromise = null;
            });
    }

    /**
     * 初始化车辆管理器
     * @param {AMap.Map} mapInstance - 高德地图实例
     */
    function init(mapInstance) {
        // 防止重复初始化
        if (isInitialized) {
            console.log('[车辆管理器] 已经初始化，跳过重复初始化');
            return;
        }

        console.log('[车辆管理器] 初始化...');
        map = mapInstance;

        // 获取项目ID（使用与admin_index.js相同的逻辑）
        const projectSelection = sessionStorage.getItem('projectSelection');
        const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');

        let projectId = null;

        if (projectSelection) {
            try {
                const selection = JSON.parse(projectSelection);
                const projectName = selection.project;

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
                    // projectCode 才是API需要的项目ID
                    projectId = selectedProject.projectCode || selectedProject.id;
                    console.log('[车辆管理器] 项目信息:', {
                        name: projectName,
                        id: projectId
                    });
                }
            } catch (e) {
                console.error('[车辆管理器] 解析项目信息失败:', e);
            }
        }

        if (!projectId) {
            console.warn('[车辆管理器] 缺少项目ID，显示0辆车辆');
            // 初始化UI但不加载数据
            initUI();
            updateVehicleCount(); // 显示0辆
            isInitialized = true; // 标记为已初始化
            return;
        }

        console.log('[车辆管理器] 项目ID:', projectId);

        // 保存项目ID
        currentProjectId = projectId;
        clearRuntimeVehicleStore();
        fixedVehicleOnlineStatusCache.clear();
        vehicleLookup.clear();
        vehicleData = { temp: [], fixed: [] };

        // 初始化UI事件
        initUI();

        // 加载路线数据（用于吸附）
        loadRouteData();

        // 监听实时车辆位置更新
        bindRealtimeLocationListener();

        // 加载车辆数据
        loadVehicleData(projectId);

        // 启动定时刷新
        startAutoRefresh();

        // 标记为已初始化
        isInitialized = true;
    }

    function bindRealtimeLocationListener() {
        if (hasBoundRealtimeListener) {
            return;
        }

        window.addEventListener('vehicleLocationUpdate', function(e) {
            const detail = e.detail || {};
            handleRealtimeVehicleLocation(detail);
        });

        hasBoundRealtimeListener = true;
    }

    /**
     * 初始化UI事件
     */
    function initUI() {
        // 防止重复初始化UI
        if (isUIInitialized) {
            console.log('[车辆管理器] UI已初始化，跳过');
            return;
        }

        console.log('[车辆管理器] 初始化UI事件');

        // 车辆切换按钮（旧版，用于admin_index.html）
        const vehicleToggleBtn = document.getElementById('vehicle-toggle-btn');
        const vehicleLegend = document.getElementById('vehicle-legend');
        const filterBar = document.querySelector('.admin-filter-bar');

        // 工地监控页默认常显车辆图例，不再依赖切换按钮是否存在
        const isAdminDataPage = /admin_data\.html$/i.test(window.location.pathname);

        // 只在非工地监控页面时，默认隐藏车辆图例
        if (!isAdminDataPage) {
            if (vehicleLegend) {
                vehicleLegend.style.display = 'none';
            }
            if (filterBar) {
                filterBar.style.display = 'none';
            }
            if (vehicleToggleBtn) {
                vehicleToggleBtn.classList.remove('active');
            }
            console.log('[车辆管理器] 默认隐藏车辆图例和筛选栏');
        }

        if (vehicleToggleBtn && vehicleLegend) {
            vehicleToggleBtn.addEventListener('click', function() {
                // 获取当前显示状态
                const currentDisplay = window.getComputedStyle(vehicleLegend).display;
                const isVisible = currentDisplay !== 'none';

                // 切换显示状态
                if (isVisible) {
                    // 当前可见 → 隐藏
                    vehicleLegend.style.display = 'none';
                    if (filterBar) filterBar.style.display = 'none';
                    vehicleToggleBtn.classList.remove('active');
                    console.log('[车辆管理器] 隐藏车辆图例和筛选栏');
                } else {
                    // 当前隐藏 → 显示
                    vehicleLegend.style.display = 'block';
                    if (filterBar) filterBar.style.display = 'flex';
                    vehicleToggleBtn.classList.add('active');
                    console.log('[车辆管理器] 显示车辆图例和筛选栏');
                }
            });
        }

        // 使用事件委托绑定图例项点击事件
        if (vehicleLegend) {
            vehicleLegend.addEventListener('click', function(e) {
                // 找到最近的 legend-item 元素
                const legendItem = e.target.closest('.legend-item');
                if (!legendItem) return;

                // 确定是第几个图例项
                const legendItems = vehicleLegend.querySelectorAll('.legend-item');
                const index = Array.from(legendItems).indexOf(legendItem);

                if (index !== -1) {
                    const type = index === 0 ? 'temp' : 'fixed';
                    console.log('[车辆管理器] 点击图例项:', type, '索引:', index);
                    toggleVehicleFilter(type);
                }
            });
        }

        // 标记UI已初始化
        isUIInitialized = true;
    }

    /**
     * 加载路线数据（用于吸附）
     */
    function loadRouteData() {
        try {
            // 尝试从全局变量获取路线数据
            if (window.polylines && window.polylines.length > 0) {
                routePolylines = window.polylines;
                console.log('[车辆管理器] 路线数据已加载:', routePolylines.length, '条');
            } else {
                console.warn('[车辆管理器] 未找到路线数据，车辆将不会吸附到路线');
            }
        } catch (e) {
            console.error('[车辆管理器] 加载路线数据失败:', e);
        }
    }

    /**
     * 加载车辆数据
     * @param {string} projectId - 项目ID
     */
    async function loadVehicleData(projectId) {
        if (isLoadingVehicles) {
            hasPendingRefresh = true;
            logVehicleChain('轮询跳过-仍在加载', {
                projectId,
                hasPendingRefresh,
                markerCount: {
                    temp: vehicleMarkers.temp.length,
                    fixed: vehicleMarkers.fixed.length
                }
            }, 'warn');
            return;
        }

        console.log('[车辆管理器] 开始加载车辆数据...');
        logVehicleChain('轮询开始', {
            projectId,
            filterState: { ...filterState },
            markerCount: {
                temp: vehicleMarkers.temp.length,
                fixed: vehicleMarkers.fixed.length
            }
        });
        isLoadingVehicles = true;

        try {
            const tempPromise = fetchTempVehicles(projectId).then(tempData => {
                const seenAt = Date.now();
                (tempData || []).forEach(vehicle => {
                    const merged = upsertRuntimeVehicle('temp', vehicle, {
                        source: 'polling',
                        seenAt
                    });
                    logVehicleTrace('轮询链路', merged || vehicle, {
                        incoming: buildVehicleTraceCoreInfo(vehicle, 'temp', {
                            chain: 'polling',
                            phase: 'incoming'
                        }),
                        merged: buildVehicleTraceCoreInfo(merged || vehicle, 'temp', {
                            chain: 'polling',
                            phase: 'merged'
                        })
                    });
                });
            });

            const fixedPromise = fetchFixedVehicles(projectId).then(fixedData => {
                const seenAt = Date.now();
                (fixedData || []).forEach(vehicle => {
                    const merged = upsertRuntimeVehicle('fixed', vehicle, {
                        source: 'polling',
                        seenAt
                    });
                    logVehicleTrace('轮询链路', merged || vehicle, {
                        incoming: buildVehicleTraceCoreInfo(vehicle, 'fixed', {
                            chain: 'polling',
                            phase: 'incoming'
                        }),
                        merged: buildVehicleTraceCoreInfo(merged || vehicle, 'fixed', {
                            chain: 'polling',
                            phase: 'merged'
                        })
                    });
                });
            });

            await Promise.allSettled([tempPromise, fixedPromise]);
            refreshVehicleDataFromRuntime();

            console.log('[车辆管理器] 地图上已显示车辆:', {
                temp: vehicleMarkers.temp.length,
                fixed: vehicleMarkers.fixed.length
            });
            logVehicleChain('轮询完成', {
                projectId,
                vehicleCount: {
                    temp: vehicleData.temp.length,
                    fixed: vehicleData.fixed.length
                },
                markerCount: {
                    temp: vehicleMarkers.temp.length,
                    fixed: vehicleMarkers.fixed.length
                }
            });

            // 检查车辆是否在电子围栏内
            checkVehiclesInFence();
            refreshVehiclePresentation();

            console.log('[车辆管理器] 临时车辆:', vehicleData.temp.length, '辆');
            console.log('[车辆管理器] 固定车辆:', vehicleData.fixed.length, '辆');

        } catch (error) {
            console.error('[车辆管理器] 加载车辆数据失败:', error);
        } finally {
            isLoadingVehicles = false;
            if (hasPendingRefresh && currentProjectId) {
                hasPendingRefresh = false;
                setTimeout(() => {
                    loadVehicleData(currentProjectId);
                }, 0);
            }
        }
    }

    /**
     * 重建车辆索引，支持按车牌号/设备ID快速反查
     */
    function rebuildVehicleLookup() {
        vehicleLookup.clear();

        function addVehicleKeys(vehicle, type) {
            if (!vehicle) return;

            const snapshot = {
                ...vehicle,
                type
            };

            const keys = [
                vehicle.plateNumber,
                vehicle.deviceId,
                vehicle.vehicleId,
                vehicle.sourceId
            ].filter(Boolean);

            keys.forEach(key => {
                vehicleLookup.set(String(key), snapshot);
            });
        }

        vehicleData.temp.forEach(vehicle => addVehicleKeys(vehicle, 'temp'));
        vehicleData.fixed.forEach(vehicle => addVehicleKeys(vehicle, 'fixed'));
    }

    function getVehicleByIdentifier(identifier) {
        if (!identifier) return null;
        const normalized = String(identifier);
        const direct = vehicleLookup.get(normalized);
        if (direct) {
            return direct;
        }

        const runtimeMatches = ['temp', 'fixed'];
        for (let i = 0; i < runtimeMatches.length; i++) {
            const type = runtimeMatches[i];
            const store = getVehicleRuntimeStore(type);
            const matched = Array.from(store.values()).find(vehicle => {
                return [
                    vehicle.runtimeId,
                    vehicle.plateNumber,
                    vehicle.deviceId,
                    vehicle.vehicleId,
                    vehicle.sourceId
                ].filter(Boolean).map(String).includes(normalized);
            });
            if (matched) {
                return deriveRenderableVehicleSnapshot(matched, type);
            }
        }

        return null;
    }

    function findVehicleMarker(identifier) {
        if (!identifier) return null;
        const target = String(identifier);
        const allMarkers = vehicleMarkers.temp.concat(vehicleMarkers.fixed);

        return allMarkers.find(marker => {
            const extData = marker && marker.getExtData ? marker.getExtData() : null;
            if (!extData) return false;

            if (extData.vehicleId && String(extData.vehicleId) === target) return true;
            if (extData.plateNumber && String(extData.plateNumber) === target) return true;
            if (extData.deviceId && String(extData.deviceId) === target) return true;
            if (extData.sourceId && String(extData.sourceId) === target) return true;
            return Array.isArray(extData.alertKeys) && extData.alertKeys.some(key => String(key) === target);
        }) || null;
    }

    /**
     * 检查所有车辆是否在围栏内
     * 说明：围栏状态追踪仍由 AdminFenceManager 维护；
     * 报警展示主链路由轮询字段（inRestricted/inFence）驱动。
     */
    async function checkVehiclesInFence() {
        // 围栏状态追踪仍由 AdminFenceManager 维护，但不触发 UI 报警
        // 报警 UI 主链路改为轮询+本地射线法判定（WS 报警推送可后续恢复）
        if (typeof AdminFenceManager === 'undefined') {
            return;
        }

        try {
            for (const vehicle of vehicleData.temp) {
                if (vehicle.latitude && vehicle.longitude) {
                    const candidate = resolveFenceCheckCandidate(vehicle, 'temp');
                    applyLocalFenceState(vehicle, 'temp', candidate && candidate.result, candidate && candidate.position);
                }
            }
            for (const vehicle of vehicleData.fixed) {
                if (vehicle.latitude && vehicle.longitude) {
                    const candidate = resolveFenceCheckCandidate(vehicle, 'fixed');
                    applyLocalFenceState(vehicle, 'fixed', candidate && candidate.result, candidate && candidate.position);
                }
            }
        } catch (error) {
            console.error('[车辆管理器] 围栏状态追踪失败:', error);
        }
    }

    function applyLocalFenceState(vehicle, type, localFenceResult, resolvedPosition) {
        if (!localFenceResult) return;

        const now = Date.now();
        const rawInRestricted = !!localFenceResult.inRestricted;
        const rawInFence = !!localFenceResult.inFence;

        // 禁停区去抖 (InRestricted)
        const restrictedDebounce = resolveDebouncedLocalBoolean({
            now,
            nextCandidate: rawInRestricted,
            prevConfirmed: vehicle.localFenceConfirmedInRestricted,
            prevCandidate: vehicle.localFenceInRestrictedCandidate,
            prevCount: vehicle.localFenceInRestrictedCount,
            prevSinceMs: vehicle.localFenceInRestrictedSinceMs,
            thresholdCount: LOCAL_FENCE_CONFIRM_COUNT,
            thresholdMs: LOCAL_FENCE_CONFIRM_MS
        });

        // 电子围栏去抖 (InFence)
        const fenceDebounce = resolveDebouncedLocalBoolean({
            now,
            nextCandidate: rawInFence,
            prevConfirmed: vehicle.localFenceConfirmedInFence,
            prevCandidate: vehicle.localFenceInFenceCandidate,
            prevCount: vehicle.localFenceInFenceCount,
            prevSinceMs: vehicle.localFenceInFenceSinceMs,
            thresholdCount: LOCAL_FENCE_CONFIRM_COUNT,
            thresholdMs: LOCAL_FENCE_CONFIRM_MS
        });

        const inFence = fenceDebounce.confirmedValue;
        const inRestricted = restrictedDebounce.confirmedValue;
        const matchedRestrictedId = localFenceResult.matchedRestrictedId;
        const resolvedFence = Array.isArray(localFenceResult.currentFenceDetails) && localFenceResult.currentFenceDetails.length
            ? localFenceResult.currentFenceDetails[0]
            : null;

        if (resolvedPosition && resolvedPosition.length === 2) {
            vehicle.longitude = Number(resolvedPosition[0]);
            vehicle.latitude = Number(resolvedPosition[1]);
        }

        const localPatch = {
            plateNumber: vehicle.plateNumber || '',
            deviceId: vehicle.deviceId || '',
            sourceId: vehicle.sourceId || '',
            // 原始值记录
            localFenceInFence: rawInFence,
            localFenceInRestricted: rawInRestricted,
            // 确认值记录
            localFenceConfirmedInFence: inFence,
            localFenceConfirmedInRestricted: inRestricted,
            // 去抖状态追踪
            localFenceInFenceCandidate: rawInFence,
            localFenceInFenceCount: fenceDebounce.stableCount,
            localFenceInFenceSinceMs: fenceDebounce.stableSinceMs,
            localFenceInRestrictedCandidate: rawInRestricted,
            localFenceInRestrictedCount: restrictedDebounce.stableCount,
            localFenceInRestrictedSinceMs: restrictedDebounce.stableSinceMs,

            localMatchedRestrictedId: matchedRestrictedId,
            localFenceId: resolvedFence ? resolvedFence.fenceId : '',
            localFenceName: resolvedFence ? resolvedFence.fenceName : '',
            localFenceLongitude: resolvedPosition && resolvedPosition.length === 2 ? Number(resolvedPosition[0]) : undefined,
            localFenceLatitude: resolvedPosition && resolvedPosition.length === 2 ? Number(resolvedPosition[1]) : undefined
        };

        logVehicleTrace('本地射线链路', vehicle, {
            incoming: {
                ...buildVehicleTraceCoreInfo(vehicle, type, {
                    chain: 'local_fence',
                    phase: 'incoming'
                }),
                longitude: resolvedPosition && resolvedPosition.length === 2 ? Number(resolvedPosition[0]) : Number(vehicle.longitude),
                latitude: resolvedPosition && resolvedPosition.length === 2 ? Number(resolvedPosition[1]) : Number(vehicle.latitude),
                localInFence: inFence,
                localInRestricted: inRestricted,
                localRawInFence: rawInFence,
                localRawInRestricted: rawInRestricted,
                localFenceInRestrictedCount: restrictedDebounce.stableCount,
                matchedRestrictedId: matchedRestrictedId || '',
                fenceId: resolvedFence ? resolvedFence.fenceId : '',
                fenceName: resolvedFence ? resolvedFence.fenceName : ''
            },
            events: Array.isArray(localFenceResult.events) ? localFenceResult.events : []
        });

        upsertRuntimeVehicle(type, localPatch, {
            source: 'local_fence',
            seenAt: now
        });
    }

    function normalizeRealtimeVehicleType(value) {
        if (value === 1 || value === '1' || value === 'fixed' || value === '固定车') {
            return 'fixed';
        }
        return 'temp';
    }

    function getMarkerPrimaryId(vehicle, type) {
        if (type === 'fixed') {
            return vehicle.deviceId || vehicle.plateNumber || vehicle.vehicleId || '';
        }
        return vehicle.plateNumber || vehicle.deviceId || vehicle.vehicleId || '';
    }

    function getVehicleIconUrl(type, isAlerting) {
        if (isAlerting) {
            return `${ADMIN_TRANSPORT_IMAGE_BASE}${VEHICLE_ICON_FILES.alert}`;
        }

        return type === 'temp'
            ? `${ADMIN_TRANSPORT_IMAGE_BASE}${VEHICLE_ICON_FILES.temp}`
            : `${ADMIN_TRANSPORT_IMAGE_BASE}${VEHICLE_ICON_FILES.fixed}`;
    }

    function buildVehicleMarkerContent(type, isAlerting) {
        const width = VEHICLE_ICON_LAYOUT.width;
        const height = VEHICLE_ICON_LAYOUT.height;
        const glowInset = 0;
        const iconUrl = getVehicleIconUrl(type, isAlerting);

        return `
<div style="
    position: relative;
    width: ${width + glowInset}px;
    height: ${height + glowInset}px;
    display: flex;
    align-items: center;
    justify-content: center;
">
    <img src="${iconUrl}" style="
        position: relative;
        width: ${width}px;
        height: ${height}px;
        display: block;
    " />
</div>`;
    }

    function renderMarkerVisualState(marker) {
        if (!marker) return;

        const extData = marker.getExtData ? (marker.getExtData() || {}) : {};
        const isAlerting = !!(extData.wsAlertActive || extData.inRestricted);
        const content = buildVehicleMarkerContent(extData.type || 'temp', isAlerting);
        marker.setContent(content);
    }

    function setVehicleAlertState(identifierOrIdentifiers, isAlerting, extraState) {
        const identifiers = Array.isArray(identifierOrIdentifiers)
            ? identifierOrIdentifiers
            : [identifierOrIdentifiers];

        identifiers.filter(Boolean).forEach(identifier => {
            const marker = findVehicleMarker(identifier);
            if (!marker) return;

            const extData = marker.getExtData ? (marker.getExtData() || {}) : {};
            const merged = {
                ...extData,
                wsAlertActive: isAlerting,
                inRestricted: extraState && extraState.inRestricted !== undefined
                    ? !!extraState.inRestricted
                    : !!extData.inRestricted,
                inFence: extraState && extraState.inFence !== undefined
                    ? !!extraState.inFence
                    : extData.inFence,
                matchedRestrictedId: extraState && extraState.matchedRestrictedId !== undefined
                    ? extraState.matchedRestrictedId
                    : extData.matchedRestrictedId
            };

            if (marker.setExtData) {
                marker.setExtData(merged);
            }
            renderMarkerVisualState(marker);
        });
    }

    function mergeRealtimeVehicleData(baseVehicle, detail, type) {
        return {
            ...(baseVehicle || {}),
            type,
            sourceId: detail.sourceId || (baseVehicle && baseVehicle.sourceId) || '',
            plateNumber: detail.plateNumber || (baseVehicle && baseVehicle.plateNumber) || '',
            deviceId: detail.deviceId || (baseVehicle && baseVehicle.deviceId) || (type === 'fixed' ? (detail.sourceId || detail.plateNumber || '') : ''),
            latitude: detail.latitude !== undefined && detail.latitude !== null ? detail.latitude : (baseVehicle && baseVehicle.latitude),
            longitude: detail.longitude !== undefined && detail.longitude !== null ? detail.longitude : (baseVehicle && baseVehicle.longitude),
            rawLatitude: detail.rawLatitude !== undefined ? detail.rawLatitude : (baseVehicle && baseVehicle.rawLatitude),
            rawLongitude: detail.rawLongitude !== undefined ? detail.rawLongitude : (baseVehicle && baseVehicle.rawLongitude),
            convertedLatitude: detail.convertedLatitude !== undefined ? detail.convertedLatitude : (baseVehicle && baseVehicle.convertedLatitude),
            convertedLongitude: detail.convertedLongitude !== undefined ? detail.convertedLongitude : (baseVehicle && baseVehicle.convertedLongitude),
            coordinateSystem: detail.coordinateSystem || (baseVehicle && baseVehicle.coordinateSystem) || '',
            coordinateSource: detail.coordinateSource || (baseVehicle && baseVehicle.coordinateSource) || '',
            direction: detail.direction !== undefined ? detail.direction : (baseVehicle && baseVehicle.direction),
            updatedAt: detail.updatedAt || (baseVehicle && baseVehicle.updatedAt) || '',
            taskName: detail.taskName || detail.lineName || (baseVehicle && baseVehicle.taskName) || '',
            driverName: detail.driverName || (baseVehicle && baseVehicle.driverName) || '',
            driverPhone: detail.driverPhone || (baseVehicle && baseVehicle.driverPhone) || '',
            projectId: detail.projectId || (baseVehicle && baseVehicle.projectId) || currentProjectId || '',
            taskId: detail.taskId !== undefined ? detail.taskId : (baseVehicle && baseVehicle.taskId),
            taskScope: detail.taskScope !== undefined ? detail.taskScope : (baseVehicle && baseVehicle.taskScope),
            lineName: detail.lineName || (baseVehicle && baseVehicle.lineName) || '',
            description: detail.description || (baseVehicle && baseVehicle.description) || '',
            vehicleType: type,
            inRestricted: detail.inRestricted !== undefined
                ? !!detail.inRestricted
                : (baseVehicle ? baseVehicle.inRestricted : undefined),
            inFence: detail.inFence !== undefined
                ? !!detail.inFence
                : (baseVehicle ? baseVehicle.inFence : undefined),
            matchedRestrictedId: detail.matchedRestrictedId !== undefined ? detail.matchedRestrictedId : (baseVehicle && baseVehicle.matchedRestrictedId),
            matchedFenceId: detail.matchedFenceId !== undefined ? detail.matchedFenceId : (baseVehicle && baseVehicle.matchedFenceId),
            fenceId: detail.fenceId !== undefined ? detail.fenceId : (baseVehicle && baseVehicle.fenceId),
            fenceName: detail.fenceName !== undefined ? detail.fenceName : (baseVehicle && baseVehicle.fenceName)
        };
    }

    function getRealtimeAlertIdentifiers(detail, vehicle) {
        return Array.from(new Set([
            detail && detail.deviceId,
            detail && detail.plateNumber,
            detail && detail.sourceId,
            vehicle && vehicle.deviceId,
            vehicle && vehicle.plateNumber,
            vehicle && vehicle.sourceId
        ].filter(Boolean).map(String)));
    }

    function getRealtimeAlertState(detail, type) {
        if (!detail) return null;

        const effectiveInRestricted = hasExplicitBoolean(detail.effectiveInRestricted)
            ? detail.effectiveInRestricted
            : detail.inRestricted;
        const effectiveInFence = hasExplicitBoolean(detail.effectiveInFence)
            ? detail.effectiveInFence
            : detail.inFence;

        if (effectiveInRestricted === true) {
            return {
                alertType: 'fence_enter',
                fenceType: 'prohibit',
                eventType: 'enter'
            };
        }

        if (type === 'fixed' && effectiveInFence === false) {
            return {
                alertType: 'fence_leave',
                fenceType: 'fence',
                eventType: 'leave'
            };
        }

        return null;
    }

    function buildPollingAlertDetail(vehicle, type, state, position) {
        return {
            alertKey: getMarkerPrimaryId(vehicle, type) || vehicle.plateNumber || vehicle.deviceId || '',
            vehicleId: getMarkerPrimaryId(vehicle, type) || vehicle.plateNumber || vehicle.deviceId || '',
            projectId: currentProjectId,
            plateNumber: vehicle.plateNumber || '',
            deviceId: vehicle.deviceId || '',
            sourceId: vehicle.sourceId || '',
            vehicleType: type,
            latitude: position ? position[1] : vehicle.latitude,
            longitude: position ? position[0] : vehicle.longitude,
            fenceType: state.fenceType,
            eventType: state.eventType,
            alertType: state.alertType,
            taskName: vehicle.taskName || '',
            driverName: vehicle.driverName || '',
            driverPhone: vehicle.driverPhone || '',
            inRestricted: vehicle.inRestricted,
            inFence: vehicle.inFence,
            effectiveInRestricted: hasExplicitBoolean(vehicle.effectiveInRestricted) ? vehicle.effectiveInRestricted : vehicle.inRestricted,
            effectiveInFence: hasExplicitBoolean(vehicle.effectiveInFence) ? vehicle.effectiveInFence : vehicle.inFence,
            alarmDecisionSource: vehicle.alarmDecisionSource || '',
            matchedRestrictedId: vehicle.matchedRestrictedId,
            taskId: vehicle.taskId || null,
            taskScope: vehicle.taskScope !== undefined ? vehicle.taskScope : null,
            fenceId: vehicle.fenceId || vehicle.matchedFenceId || vehicle.matchedRestrictedId || '',
            fenceName: vehicle.fenceName || '',
            polylineId: vehicle.polylineId || null,
            lineName: vehicle.lineName || '',
            description: vehicle.description || '',
            eventTime: vehicle.updatedAt || vehicle.updateTime || new Date().toISOString()
        };
    }

    function syncPollingAlertForVehicle(marker, vehicle, type, position) {
        if (!POLLING_ALERT_ENABLED || typeof AdminAlertManager === 'undefined' || !marker) {
            return;
        }

        const activeAlertState = getRealtimeAlertState(vehicle, type);
        const identifiers = getRealtimeAlertIdentifiers(vehicle, vehicle);
        logVehicleTrace('报警判定', vehicle, {
            type,
            identifiers,
            activeAlertState,
            snapshot: summarizeVehicleAlarmState(vehicle, type)
        });
        if (!identifiers.length) {
            return;
        }

        if (activeAlertState) {
            const detail = buildPollingAlertDetail(vehicle, type, activeAlertState, position);
            const alreadyAlerting = identifiers.some(key => key && AdminAlertManager.isVehicleAlerting(key));
            const primaryAlertKey = identifiers[0];

            setVehicleAlertState(identifiers, true, {
                inRestricted: vehicle.inRestricted,
                inFence: vehicle.inFence,
                matchedRestrictedId: vehicle.matchedRestrictedId
            });

            // 地图上的图标/气泡/详情卡片统一由车辆缓存快照驱动，确保进入报警和解除报警完全同步。
            if (!alreadyAlerting) {
                AdminAlertManager.showAlertBubble(
                    primaryAlertKey,
                    position || [vehicle.longitude, vehicle.latitude],
                    activeAlertState.alertType,
                    detail
                );
            } else if (position) {
                AdminAlertManager.syncVehicleAlertPosition(identifiers, position, detail);
            }

            if (typeof AdminAlarmEventCenter !== 'undefined') {
                AdminAlarmEventCenter.inferEventFromStatus({
                    sourceType: 'polling_state',
                    projectId: currentProjectId,
                    vehicleId: primaryAlertKey,
                    plateNumber: detail.plateNumber,
                    deviceId: detail.deviceId,
                    sourceId: detail.sourceId,
                    vehicleType: type,
                    taskId: detail.taskId,
                    taskScope: detail.taskScope,
                    polylineId: detail.polylineId,
                    lineName: detail.lineName,
                    fenceId: detail.fenceId,
                    fenceName: detail.fenceName,
                    matchedRestrictedId: detail.matchedRestrictedId,
                    latitude: detail.latitude,
                    longitude: detail.longitude,
                    inRestricted: detail.inRestricted,
                    inFence: detail.inFence,
                    description: detail.description,
                    eventTime: detail.eventTime,
                    raw: vehicle
                });
            }
        } else {
            setVehicleAlertState(identifiers, false, {
                inRestricted: vehicle.inRestricted,
                inFence: vehicle.inFence,
                matchedRestrictedId: vehicle.matchedRestrictedId
            });

            identifiers.forEach(key => {
                if (key) {
                    AdminAlertManager.removeAlertBubble(key);
                }
            });

            if (typeof AdminAlarmEventCenter !== 'undefined') {
                AdminAlarmEventCenter.inferEventFromStatus({
                    sourceType: 'polling_state',
                    projectId: currentProjectId,
                    vehicleId: identifiers[0],
                    plateNumber: vehicle.plateNumber || '',
                    deviceId: vehicle.deviceId || '',
                    sourceId: vehicle.sourceId || '',
                    vehicleType: type,
                    taskId: vehicle.taskId || null,
                    taskScope: vehicle.taskScope !== undefined ? vehicle.taskScope : null,
                    polylineId: vehicle.polylineId || null,
                    lineName: vehicle.lineName || '',
                    fenceId: vehicle.fenceId || vehicle.matchedFenceId || vehicle.matchedRestrictedId || '',
                    fenceName: vehicle.fenceName || '',
                    matchedRestrictedId: vehicle.matchedRestrictedId,
                    latitude: position ? position[1] : vehicle.latitude,
                    longitude: position ? position[0] : vehicle.longitude,
                    inRestricted: vehicle.inRestricted,
                    inFence: vehicle.inFence,
                    description: vehicle.description || '',
                    eventTime: vehicle.updatedAt || vehicle.updateTime || new Date().toISOString(),
                    raw: vehicle
                });
            }
        }
    }

    function upsertVehicleData(type, vehicle) {
        const list = vehicleData[type];
        const primaryId = getMarkerPrimaryId(vehicle, type);
        const index = list.findIndex(item => getMarkerPrimaryId(item, type) === primaryId ||
            (vehicle.plateNumber && item.plateNumber === vehicle.plateNumber));

        if (index >= 0) {
            list[index] = {
                ...list[index],
                ...vehicle
            };
        } else {
            list.push(vehicle);
        }
    }

    function handleRealtimeVehicleLocation(detail) {
        if (!detail || !detail.projectId || !currentProjectId) {
            return;
        }

        if (String(detail.projectId) !== String(currentProjectId)) {
            logVehicleChain('WS位置忽略-项目不匹配', {
                currentProjectId,
                incomingProjectId: detail.projectId,
                detail: summarizeVehicleForDebug(detail, normalizeRealtimeVehicleType(detail.vehicleType))
            }, 'warn');
            return;
        }

        const type = normalizeRealtimeVehicleType(detail.vehicleType);
        logVehicleTrace('WS链路', detail, {
            incoming: buildVehicleTraceCoreInfo(detail, type, {
                chain: 'ws',
                phase: 'incoming'
            })
        });
        const lookupVehicle = getVehicleByIdentifier(detail.plateNumber) ||
            getVehicleByIdentifier(detail.deviceId) ||
            getVehicleByIdentifier(detail.sourceId);
        const mergedVehicle = mergeRealtimeVehicleData(lookupVehicle, detail, type);
        let marker = findVehicleMarker(detail.plateNumber) ||
            findVehicleMarker(detail.deviceId) ||
            findVehicleMarker(detail.sourceId);
        const hasPolledVehicle = !!lookupVehicle;

        // 当前验证结果表明 vehicle_location 不是全量稳定位置流，因此只增强已有车辆，不作为主显示来源。
        if (!hasPolledVehicle && !marker) {
            logVehicleChain('WS位置忽略-未命中轮询车辆', {
                detail: summarizeVehicleForDebug(detail, type)
            }, 'warn');
            return;
        }

        if (hasPolledVehicle) {
            const runtimeVehicle = upsertRuntimeVehicle(type, mergedVehicle, {
                source: 'ws',
                seenAt: Date.now()
            });
            logVehicleTrace('WS链路', runtimeVehicle || mergedVehicle, {
                lookup: buildVehicleTraceCoreInfo(lookupVehicle, type, {
                    chain: 'ws',
                    phase: 'lookup'
                }),
                incoming: buildVehicleTraceCoreInfo(detail, type, {
                    chain: 'ws',
                    phase: 'incoming'
                }),
                merged: buildVehicleTraceCoreInfo(runtimeVehicle || mergedVehicle, type, {
                    chain: 'ws',
                    phase: 'merged'
                })
            });
        }

        refreshVehiclePresentation();

        if (WS_ALERT_FALLBACK_ENABLED && typeof AdminAlertManager !== 'undefined') {
            const alertIdentifiers = getRealtimeAlertIdentifiers(detail, mergedVehicle);
            const activeAlertState = getRealtimeAlertState(detail, type);
            const alertPosition = (detail.longitude && detail.latitude)
                ? [detail.longitude, detail.latitude]
                : null;

            if (activeAlertState && alertIdentifiers.length > 0) {
                const alreadyAlerting = alertIdentifiers.some(key => key && AdminAlertManager.isVehicleAlerting(key));
                const primaryAlertKey = alertIdentifiers[0];
                const alertDetail = {
                    alertKey: primaryAlertKey,
                    vehicleId: primaryAlertKey,
                    projectId: detail.projectId,
                    plateNumber: mergedVehicle.plateNumber || detail.plateNumber || detail.sourceId,
                    deviceId: mergedVehicle.deviceId || detail.deviceId || '',
                    sourceId: mergedVehicle.sourceId || detail.sourceId || '',
                    vehicleType: type,
                    latitude: detail.latitude,
                    longitude: detail.longitude,
                    fenceType: activeAlertState.fenceType,
                    eventType: activeAlertState.eventType,
                    alertType: activeAlertState.alertType,
                    taskName: mergedVehicle.taskName || '',
                    driverName: mergedVehicle.driverName || '',
                    driverPhone: mergedVehicle.driverPhone || '',
                    inRestricted: detail.inRestricted,
                    inFence: detail.inFence,
                    matchedRestrictedId: detail.matchedRestrictedId
                };

                // 优先保证报警显示：只要实时状态明确处于报警态，就直接显示或更新。
                // 解除仍优先交给显式 fence_message/fence_alarm 事件处理，避免状态抖动导致误消失。
                if (!alreadyAlerting) {
                    AdminAlertManager.showAlertBubble(
                        primaryAlertKey,
                        alertPosition,
                        activeAlertState.alertType,
                        alertDetail
                    );
                } else if (alertPosition) {
                    AdminAlertManager.syncVehicleAlertPosition(alertIdentifiers, alertPosition, alertDetail);
                }
            }
        }
    }

    /**
     * 开始车辆报警效果（已废弃旧波纹逻辑，现由 AdminAlertManager 统一处理）
     * 保留此函数签名以兼容可能的外部调用，实际转发给 AdminAlertManager
     * @param {AMap.Marker} marker - 车辆标记
     * @param {Object} [detail] - 报警详情（可选）
     */
    function startVehicleBlink(marker, detail) {
        if (!marker) return;
        const extData = marker.getExtData();
        if (!extData) return;

        // 转发给 AdminAlertManager 处理气泡显示
        if (typeof AdminAlertManager !== 'undefined' && detail) {
            const position = marker.getPosition();
            AdminAlertManager.showAlertBubble(
                extData.vehicleId,
                [position.lng, position.lat],
                detail.alertType || 'fence_enter',
                detail
            );
        }
    }

    /**
     * 停止车辆报警效果（已废弃旧波纹逻辑，现由 AdminAlertManager 统一处理）
     * @param {AMap.Marker} marker - 车辆标记
     */
    function stopVehicleBlink(marker) {
        if (!marker) return;
        const extData = marker.getExtData();
        if (!extData) return;

        // 转发给 AdminAlertManager 移除气泡
        if (typeof AdminAlertManager !== 'undefined') {
            AdminAlertManager.removeAlertBubble(extData.vehicleId);
        }
    }
    /**
     * 获取临时车辆数据
     * @param {string} projectId - 项目ID
     * @returns {Promise<Array>}
     */
    async function fetchTempVehicles(projectId) {
        try {
            const url = `${API_CONFIG.baseURL}${API_CONFIG.endpoints.tempVehicles}?projectId=${projectId}`;
            console.log('[车辆管理器] 请求临时车辆:', url);

            // 获取token
            const token = sessionStorage.getItem('authToken') || '';
            const headers = {
                'Content-Type': 'application/json'
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch(url, {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('[车辆管理器] 临时车辆API响应:', result);

            // 解析返回数据
            const vehicleList = normalizeVehicleListResponse(result);
            if ((result.code === 200 || Array.isArray(result)) && vehicleList.length > 0) {
                const mappedList = vehicleList.map(mapTempVehicleItem);
                logVehicleChain('临时车接口成功', {
                    projectId,
                    count: mappedList.length,
                    sample: summarizeVehicleForDebug(mappedList[0], 'temp')
                });
                return mappedList;
            }

            logVehicleChain('临时车接口为空', {
                projectId,
                responseCode: result && result.code,
                rawCount: vehicleList.length
            }, 'warn');

            return [];
        } catch (error) {
            console.error('[车辆管理器] 获取临时车辆失败:', error);
            logVehicleChain('临时车接口失败', {
                projectId,
                error: error && error.message ? error.message : String(error)
            }, 'error');
            return [];
        }
    }

    /**
     * 获取固定车辆（设备）数据
     * @param {string} projectId - 项目ID
     * @returns {Promise<Array>}
     */
    async function fetchFixedVehicles(projectId) {
        try {
            const url = `${API_CONFIG.baseURL}${API_CONFIG.endpoints.fixedVehicles}?projectId=${projectId}`;
            console.log('[车辆管理器] 请求固定车辆:', url);

            // 获取token
            const token = sessionStorage.getItem('authToken') || '';
            const headers = {
                'Content-Type': 'application/json'
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch(url, {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('[车辆管理器] 固定车辆API响应:', result);
            console.log('[车辆管理器] 固定车辆第一条数据:', result.data?.[0]);

            // 解析返回数据
            const vehicleList = normalizeVehicleListResponse(result);
            if ((result.code === 200 || Array.isArray(result)) && vehicleList.length > 0) {
                const mappedList = vehicleList.map(mapFixedVehicleItem);
                logVehicleChain('固定车接口成功', {
                    projectId,
                    count: mappedList.length,
                    sample: summarizeVehicleForDebug(mappedList[0], 'fixed')
                });
                return mappedList;
            }

            logVehicleChain('固定车接口为空', {
                projectId,
                responseCode: result && result.code,
                rawCount: vehicleList.length
            }, 'warn');

            return [];
        } catch (error) {
            console.error('[车辆管理器] 获取固定车辆失败:', error);
            logVehicleChain('固定车接口失败', {
                projectId,
                error: error && error.message ? error.message : String(error)
            }, 'error');
            return [];
        }
    }

    /**
     * 更新车辆数量显示
     */
    function updateVehicleCount() {
        const legendItems = document.querySelectorAll('.vehicle-legend .legend-item span');
        if (legendItems.length >= 2) {
            legendItems[0].textContent = `临时车辆(${vehicleData.temp.length})`;
            legendItems[1].textContent = `固定车辆(${vehicleData.fixed.length})`;
        }
    }

    /**
     * 在地图上显示车辆（平滑更新版本）
     */
    function displayVehiclesOnMap() {
        if (!map) {
            console.warn('[车辆管理器] 地图实例不存在');
            return;
        }

        refreshVehiclePresentation();

        console.log('[车辆管理器] 地图上已显示车辆:', {
            temp: vehicleMarkers.temp.length,
            fixed: vehicleMarkers.fixed.length
        });
    }

    /**
     * 平滑更新车辆标记（不删除重建，而是更新位置）
     * @param {Array} vehicles - 车辆数据数组
     * @param {string} type - 'temp' 或 'fixed'
     */
    function updateVehicleMarkers(vehicles, type) {
        const markersArray = vehicleMarkers[type];
        const newMarkersArray = [];
        const processedIds = new Set();

        // 遍历新数据
        vehicles.forEach(vehicle => {
            const vehicleId = type === 'temp'
                ? vehicle.plateNumber
                : vehicle.deviceId;

            if (!vehicleId) return;

            processedIds.add(vehicleId);

            // 查找是否已有该车辆的marker
            const existingMarker = markersArray.find(m => {
                const extData = m.getExtData();
                return extData && (
                    extData.vehicleId === vehicleId ||
                    (vehicle.plateNumber && extData.plateNumber === vehicle.plateNumber)
                );
            });

            if (existingMarker) {
                // 已存在，平滑更新位置和角度
                updateVehicleMarker(existingMarker, vehicle, type);
                newMarkersArray.push(existingMarker);
            } else {
                // 不存在，创建新marker
                const newMarker = createVehicleMarker(vehicle, type);
                if (newMarker) {
                    newMarkersArray.push(newMarker);
                }
            }
        });

        // 移除不在新数据中的marker
        markersArray.forEach(marker => {
            const extData = marker.getExtData();
            if (extData && !processedIds.has(extData.vehicleId)) {
                // 停止闪烁
                stopVehicleBlink(marker);
                // 从地图移除
                map.remove(marker);
            }
        });

        // 更新标记数组
        vehicleMarkers[type] = newMarkersArray;
    }

    /**
     * 平滑更新现有车辆标记的位置和角度
     * @param {AMap.Marker} marker - 现有标记
     * @param {Object} vehicle - 新的车辆数据
     * @param {string} type - 车辆类型
     */
    function updateVehicleMarker(marker, vehicle, type) {
        let lng = vehicle.longitude;
        let lat = vehicle.latitude;
        let direction = vehicle.direction;  // 从后端获取的方向角度

        // 验证坐标有效性
        if (!lng || !lat || isNaN(lng) || isNaN(lat)) {
            return;
        }

        const newPosition = [lng, lat];
        const oldPosition = marker.getPosition();

        // 如果后端提供了方向角度，直接使用
        let angle = 0;
        if (direction !== undefined && direction !== null && !isNaN(direction)) {
            angle = direction;
        } else {
            // 如果没有方向角度，根据移动方向计算
            const distance = calculateDistance(
                oldPosition.lat, oldPosition.lng,
                lat, lng
            );

            if (distance > 0.5) {
                const dLng = (lng - oldPosition.lng) * Math.PI / 180;
                const lat1 = oldPosition.lat * Math.PI / 180;
                const lat2 = lat * Math.PI / 180;
                const y = Math.sin(dLng) * Math.cos(lat2);
                const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
                angle = Math.atan2(y, x) * 180 / Math.PI;
            } else {
                // 距离太小，保持原角度
                angle = marker.getAngle() || 0;
            }
        }

        // 直接设置位置和角度
        marker.setPosition(newPosition);
        marker.setAngle(angle);

        const extData = marker.getExtData ? (marker.getExtData() || {}) : {};
        const updatedExtData = {
            ...extData,
            type: type,
            sourceId: vehicle.sourceId || extData.sourceId || '',
            plateNumber: vehicle.plateNumber || extData.plateNumber || '',
            deviceId: vehicle.deviceId || extData.deviceId || '',
            vehicleType: type,
            taskName: vehicle.taskName || extData.taskName || '',
            driverName: vehicle.driverName || extData.driverName || '',
            driverPhone: vehicle.driverPhone || extData.driverPhone || '',
            updatedAt: vehicle.updatedAt || extData.updatedAt || '',
            projectId: vehicle.projectId || extData.projectId || currentProjectId || '',
            taskId: vehicle.taskId !== undefined ? vehicle.taskId : extData.taskId,
            taskScope: vehicle.taskScope !== undefined ? vehicle.taskScope : extData.taskScope,
            lineName: vehicle.lineName || extData.lineName || '',
            description: vehicle.description || extData.description || '',
            inRestricted: vehicle.inRestricted !== undefined ? !!vehicle.inRestricted : !!extData.inRestricted,
            inFence: vehicle.inFence !== undefined ? !!vehicle.inFence : !!extData.inFence,
            matchedRestrictedId: vehicle.matchedRestrictedId !== undefined ? vehicle.matchedRestrictedId : extData.matchedRestrictedId
        };
        const refreshedAlertKeys = Array.from(new Set([
            ...(Array.isArray(extData.alertKeys) ? extData.alertKeys : []),
            extData.vehicleId,
            updatedExtData.plateNumber,
            updatedExtData.deviceId,
            updatedExtData.sourceId
        ].filter(Boolean).map(String)));
        updatedExtData.alertKeys = refreshedAlertKeys;
        if (marker.setExtData) {
            marker.setExtData(updatedExtData);
        }
        renderMarkerVisualState(marker);

        // 同步报警气泡位置（如果该车辆正在报警）
        if (typeof AdminAlertManager !== 'undefined') {
            const followIdentifiers = Array.from(new Set([
                ...(Array.isArray(updatedExtData.alertKeys) ? updatedExtData.alertKeys : []),
                updatedExtData.vehicleId,
                updatedExtData.plateNumber,
                updatedExtData.deviceId,
                updatedExtData.sourceId
            ].filter(Boolean).map(String)));
            if (followIdentifiers.length > 0) {
                AdminAlertManager.syncVehicleAlertPosition(followIdentifiers, newPosition, updatedExtData);
            }
        }
    }

    /**
     * 移除指定类型的所有标记
     * @param {string} type - 'temp' 或 'fixed'
     */
    function removeAllMarkersByType(type) {
        vehicleMarkers[type].forEach(marker => {
            if (marker) {
                // 停止闪烁
                stopVehicleBlink(marker);
                // 从地图移除
                if (map) {
                    map.remove(marker);
                }
            }
        });
        vehicleMarkers[type] = [];
    }

    /**
     * 创建车辆标记
     * @param {Object} vehicle - 车辆数据
     * @param {string} type - 车辆类型 'temp' 或 'fixed'
     * @returns {AMap.Marker}
     */
    function createVehicleMarker(vehicle, type) {
        try {
            let lng = vehicle.longitude;
            let lat = vehicle.latitude;
            const isAdminDataPage = /admin_data\.html$/i.test(window.location.pathname);

            // 验证坐标有效性
            if (!lng || !lat || isNaN(lng) || isNaN(lat)) {
                console.warn('[车辆管理器] 无效坐标:', vehicle);
                logVehicleChain('创建标记失败-无效坐标', {
                    vehicle: summarizeVehicleForDebug(vehicle, type)
                }, 'error');
                return null;
            }

            // 管理监控页优先展示真实位置，避免围栏报警与显示位置产生错位
            const snappedResult = isAdminDataPage ? null : snapToRouteWithDirection([lng, lat]);
            let angle = 0; // 默认角度

            if (snappedResult) {
                lng = snappedResult.position[0];
                lat = snappedResult.position[1];
                angle = snappedResult.angle || 0; // 获取行进方向角度
                console.log('[车辆管理器] 车辆吸附:', [vehicle.longitude, vehicle.latitude], '->', snappedResult.position, '角度:', angle);
            }

            // 图标尺寸: 原始39x75, 缩小到0.62倍，减少禁停区高密度场景拥挤感
            const width = VEHICLE_ICON_LAYOUT.width;
            const height = VEHICLE_ICON_LAYOUT.height;
            const iconOffset = new AMap.Pixel(-width / 2, -height / 2);
            const initialContent = buildVehicleMarkerContent(type, !!vehicle.inRestricted);

            // 创建标记（带旋转角度）
            const marker = new AMap.Marker({
                position: [lng, lat],
                content: initialContent,
                offset: iconOffset,
                angle: angle, // 设置车头方向
                zIndex: 100,
                map: map
            });

            // 设置扩展数据（用于平滑更新时识别车辆）
            const vehicleId = getMarkerPrimaryId(vehicle, type);
            const alertKeys = [
                vehicle.plateNumber,
                vehicle.deviceId,
                vehicleId,
                vehicle.sourceId
            ].filter(Boolean).map(String);
            marker.setExtData({
                vehicleId: vehicleId,
                type: type,
                sourceId: vehicle.sourceId || '',
                plateNumber: vehicle.plateNumber || '',
                deviceId: vehicle.deviceId || '',
                vehicleType: type,
                taskName: vehicle.taskName || '',
                driverName: vehicle.driverName || '',
                driverPhone: vehicle.driverPhone || '',
                updatedAt: vehicle.updatedAt || '',
                projectId: vehicle.projectId || currentProjectId || '',
                taskId: vehicle.taskId || null,
                taskScope: vehicle.taskScope !== undefined ? vehicle.taskScope : null,
                lineName: vehicle.lineName || '',
                description: vehicle.description || '',
                alertKeys: Array.from(new Set(alertKeys)),
                wsAlertActive: false,
                inRestricted: !!vehicle.inRestricted,
                inFence: vehicle.inFence,
                matchedRestrictedId: vehicle.matchedRestrictedId,
                isViolating: false,
                blinkTimer: null
            });

            // 添加信息窗口
            const infoWindow = new AMap.InfoWindow({
                content: buildVehicleInfoContent(vehicle, type),
                offset: new AMap.Pixel(0, -30)
            });

            marker.on('click', function() {
                const markerExtData = marker.getExtData ? (marker.getExtData() || {}) : {};
                const alertIdentifiers = markerExtData.alertKeys || [markerExtData.vehicleId, markerExtData.plateNumber, markerExtData.deviceId];

                if (typeof AdminAlertManager !== 'undefined') {
                    const hasAlert = alertIdentifiers.some(key => key && AdminAlertManager.isVehicleAlerting(key));
                    if (hasAlert && typeof AdminAlertManager.openAlertDetailByIdentifier === 'function') {
                        const opened = alertIdentifiers.some(key => key && AdminAlertManager.openAlertDetailByIdentifier(key));
                        if (opened) {
                            return;
                        }
                    }
                }

                infoWindow.setContent(buildVehicleInfoContent(markerExtData, type));
                infoWindow.open(map, marker.getPosition());
            });

            return marker;
        } catch (error) {
            console.error('[车辆管理器] 创建车辆标记失败:', error);
            logVehicleChain('创建标记失败-异常', {
                type,
                vehicle: summarizeVehicleForDebug(vehicle, type),
                error: error && error.message ? error.message : String(error)
            }, 'error');
            return null;
        }
    }

    /**
     * 路线吸附算法
     * @param {Array} position - 原始位置 [lng, lat]
     * @returns {Array|null} - 吸附后的位置 [lng, lat] 或 null
     */
    function snapToRoute(position) {
        if (!routePolylines || routePolylines.length === 0) {
            return null;
        }

        const SNAP_THRESHOLD = 10; // 吸附阈值10米（与导航常规吸附阈值一致）
        let minDistance = Infinity;
        let closestPoint = null;

        // 遍历所有路线
        routePolylines.forEach(polyline => {
            const path = polyline.getPath();
            if (!path || path.length === 0) return;

            // 遍历路线上的所有点
            path.forEach(point => {
                const distance = calculateDistance(
                    position[1], position[0],
                    point.lat, point.lng
                );

                if (distance < minDistance) {
                    minDistance = distance;
                    closestPoint = [point.lng, point.lat];
                }
            });
        });

        // 如果最近距离在阈值内，返回吸附点
        if (minDistance <= SNAP_THRESHOLD) {
            return closestPoint;
        }

        return null;
    }

    /**
     * 路线吸附算法（带方向计算）
     * @param {Array} position - 原始位置 [lng, lat]
     * @returns {Object|null} - {position: [lng, lat], angle: number} 或 null
     */
    function snapToRouteWithDirection(position) {
        if (!routePolylines || routePolylines.length === 0) {
            return null;
        }

        const SNAP_THRESHOLD = 1; // 吸附阈值1米（仅用于纠正小误差）
        let minDistance = Infinity;
        let closestSegment = null;
        let closestProjection = null;

        // 遍历所有路线
        routePolylines.forEach(polyline => {
            const path = polyline.getPath();
            if (!path || path.length < 2) return;

            // 遍历路线上的所有线段
            for (let i = 0; i < path.length - 1; i++) {
                const segStart = path[i];
                const segEnd = path[i + 1];

                // 计算点到线段的最近距离和投影点
                const projection = projectPointToSegment(
                    position[0], position[1],
                    segStart.lng, segStart.lat,
                    segEnd.lng, segEnd.lat
                );

                if (projection.distance < minDistance) {
                    minDistance = projection.distance;
                    closestProjection = projection.point;
                    closestSegment = {
                        start: {lng: segStart.lng, lat: segStart.lat},
                        end: {lng: segEnd.lng, lat: segEnd.lat}
                    };
                }
            }
        });

        // 如果最近距离在阈值内，返回吸附点和方向
        if (minDistance <= SNAP_THRESHOLD && closestSegment && closestProjection) {
            // 计算线段的方向角度（从起点到终点）
            const angle = calculateSegmentAngle(
                closestSegment.start.lng,
                closestSegment.start.lat,
                closestSegment.end.lng,
                closestSegment.end.lat
            );

            return {
                position: closestProjection,
                angle: angle
            };
        }

        return null;
    }

    /**
     * 将点投影到线段上，返回最近点和距离
     * @param {number} px - 点的经度
     * @param {number} py - 点的纬度
     * @param {number} x1 - 线段起点经度
     * @param {number} y1 - 线段起点纬度
     * @param {number} x2 - 线段终点经度
     * @param {number} y2 - 线段终点纬度
     * @returns {Object} - {point: [lng, lat], distance: number}
     */
    function projectPointToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len2 = dx * dx + dy * dy;

        // 如果线段长度为0，返回起点
        if (len2 === 0) {
            const dist = calculateDistance(py, px, y1, x1);
            return {
                point: [x1, y1],
                distance: dist
            };
        }

        // 计算投影参数 t
        let t = ((px - x1) * dx + (py - y1) * dy) / len2;

        // 限制 t 在 [0, 1] 范围内
        t = Math.max(0, Math.min(1, t));

        // 计算投影点
        const projX = x1 + t * dx;
        const projY = y1 + t * dy;

        // 计算距离
        const dist = calculateDistance(py, px, projY, projX);

        return {
            point: [projX, projY],
            distance: dist
        };
    }

    /**
     * 计算线段的方向角度（用于车头朝向）
     * @param {number} lng1 - 起点经度
     * @param {number} lat1 - 起点纬度
     * @param {number} lng2 - 终点经度
     * @param {number} lat2 - 终点纬度
     * @returns {number} - 角度（度数，0-360，正北为0）
     */
    function calculateSegmentAngle(lng1, lat1, lng2, lat2) {
        const dLng = lng2 - lng1;
        const dLat = lat2 - lat1;

        // 使用 atan2 计算角度（弧度）
        let angleRad = Math.atan2(dLng, dLat);

        // 转换为度数
        let angleDeg = angleRad * 180 / Math.PI;

        // 确保角度在 0-360 范围内
        if (angleDeg < 0) {
            angleDeg += 360;
        }

        return angleDeg;
    }

    /**
     * 计算两点之间的距离（米）
     * @param {number} lat1 - 纬度1
     * @param {number} lng1 - 经度1
     * @param {number} lat2 - 纬度2
     * @param {number} lng2 - 经度2
     * @returns {number} - 距离（米）
     */
    function calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371000; // 地球半径（米）
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * 切换车辆类型筛选
     * @param {string} type - 'temp' 或 'fixed'
     */
    function toggleVehicleFilter(type) {
        filterState[type] = !filterState[type];

        // 更新UI样式
        const legendItems = document.querySelectorAll('.vehicle-legend .legend-item');
        const index = type === 'temp' ? 0 : 1;

        if (legendItems[index]) {
            if (filterState[type]) {
                legendItems[index].style.backgroundColor = 'rgba(42, 134, 255, 0.1)';
            } else {
                legendItems[index].style.backgroundColor = '#ffffff';
            }
        }

        // 重新显示车辆
        displayVehiclesOnMap();

        console.log('[车辆管理器] 筛选状态:', filterState);
    }

    /**
     * 清除所有车辆标记
     */
    function clearVehicleMarkers() {
        // 清除临时车标记
        vehicleMarkers.temp.forEach(marker => {
            if (marker) {
                // 停止闪烁
                stopVehicleBlink(marker);
                // 从地图移除
                if (map) {
                    map.remove(marker);
                }
            }
        });
        vehicleMarkers.temp = [];

        // 清除固定车标记
        vehicleMarkers.fixed.forEach(marker => {
            if (marker) {
                // 停止闪烁
                stopVehicleBlink(marker);
                // 从地图移除
                if (map) {
                    map.remove(marker);
                }
            }
        });
        vehicleMarkers.fixed = [];
    }

    /**
     * 刷新车辆数据
     */
    async function refresh() {
        if (currentProjectId) {
            await loadVehicleData(currentProjectId);
        }
    }

    /**
     * 启动自动刷新
     */
    function startAutoRefresh() {
        // 清除旧的定时器（如果存在）
        stopAutoRefresh();

        // 启动新的定时器
        refreshTimer = setInterval(() => {
            if (currentProjectId) {
                console.log('[车辆管理器] 定时刷新车辆数据...');
                loadVehicleData(currentProjectId);
            }
        }, REFRESH_INTERVAL);

        console.log(`[车辆管理器] 已启动定时刷新，间隔${REFRESH_INTERVAL / 1000}秒`);
    }

    /**
     * 停止自动刷新
     */
    function stopAutoRefresh() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
            console.log('[车辆管理器] 已停止定时刷新');
        }
    }

    /**
     * 销毁车辆管理器
     */
    function destroy() {
        stopAutoRefresh();
        clearVehicleMarkers();
        if (typeof AdminAlarmEventCenter !== 'undefined' &&
            typeof AdminAlarmEventCenter.resetState === 'function') {
            AdminAlarmEventCenter.resetState(currentProjectId ? { projectId: currentProjectId } : undefined);
        }
        vehicleData = { temp: [], fixed: [] };
        clearRuntimeVehicleStore();
        fixedVehicleOnlineStatusCache.clear();
        vehicleLookup.clear();
        currentProjectId = null;
        isInitialized = false;
        console.log('[车辆管理器] 已销毁');
    }

    // 导出API
    return {
        init: init,
        refresh: refresh,
        destroy: destroy,
        stopAutoRefresh: stopAutoRefresh,
        startAutoRefresh: startAutoRefresh,
        getVehicleData: () => vehicleData,
        getFilterState: () => filterState,
        hideAllVehicles: function() {
            // 隐藏所有车辆标记
            vehicleMarkers.temp.forEach(marker => {
                if (marker) marker.hide();
            });
            vehicleMarkers.fixed.forEach(marker => {
                if (marker) marker.hide();
            });
            console.log('[车辆管理器] 已隐藏所有车辆标记');
        },
        showAllVehicles: function() {
            // 显示所有车辆标记（根据筛选状态）
            if (filterState.temp) {
                vehicleMarkers.temp.forEach(marker => {
                    if (marker) marker.show();
                });
            }
            if (filterState.fixed) {
                vehicleMarkers.fixed.forEach(marker => {
                    if (marker) marker.show();
                });
            }
            console.log('[车辆管理器] 已显示所有车辆标记');
        },
        getVehicleByIdentifier: function(identifier) {
            return getVehicleByIdentifier(identifier);
        },
        handleRealtimeVehicleLocation: handleRealtimeVehicleLocation,
        findVehicleMarker: function(identifier) {
            return findVehicleMarker(identifier);
        },
        toggleVehicleLegend: function() {
            const vehicleLegend = document.getElementById('vehicle-legend');
            if (vehicleLegend) {
                const isVisible = vehicleLegend.style.display !== 'none';
                vehicleLegend.style.display = isVisible ? 'none' : 'flex';
            }
        },
        setVehicleAlertState: setVehicleAlertState
    };
})();

console.log('[车辆管理器] 模块已加载');
