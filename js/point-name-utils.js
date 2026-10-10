(function(global) {
    'use strict';

    function trimText(value) {
        return typeof value === 'string' ? value.trim() : '';
    }

    function splitNameParts(name) {
        return trimText(name)
            .split('-')
            .map(part => trimText(part))
            .filter(Boolean);
    }

    function getFeatureProperty(source, keys) {
        if (!source || !Array.isArray(keys)) {
            return undefined;
        }

        for (const key of keys) {
            if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
                return source[key];
            }
            if (source.properties && source.properties[key] !== undefined && source.properties[key] !== null && source.properties[key] !== '') {
                return source.properties[key];
            }
        }

        return undefined;
    }

    function getPointName(source) {
        return trimText(
            getFeatureProperty(source, ['rawName', 'displayName', 'name', 'point_name']) ||
            ''
        );
    }

    function getPointCoordinates(source) {
        if (!source) {
            return null;
        }

        if (Array.isArray(source.position) && source.position.length >= 2) {
            return source.position;
        }

        if (source.geometry && Array.isArray(source.geometry.coordinates) && source.geometry.coordinates.length >= 2) {
            return source.geometry.coordinates;
        }

        const lng = Number(getFeatureProperty(source, ['longitude', 'lng']));
        const lat = Number(getFeatureProperty(source, ['latitude', 'lat']));

        if (Number.isFinite(lng) && Number.isFinite(lat)) {
            return [lng, lat];
        }

        return null;
    }

    function getPointType(source) {
        const pointType = getFeatureProperty(source, ['pointType', 'point_type']);
        return pointType === undefined || pointType === null ? '' : String(pointType);
    }

    function getPointIconId(source) {
        const iconId = getFeatureProperty(source, ['iconId', 'icon_id']);
        return iconId === undefined || iconId === null ? '' : String(iconId);
    }

    function getPolygonId(source) {
        const polygonId = getFeatureProperty(source, ['polygonId', 'polygon_id']);
        return polygonId === undefined || polygonId === null || polygonId === '' ? '' : String(polygonId);
    }

    function isDefaultGeneratedAreaName(name) {
        const value = trimText(name);
        if (!value) {
            return false;
        }

        const patterns = [
            /^区块\s*\d+$/i,
            /^区域\s*\d+$/i,
            /^面\s*\d+$/i,
            /^polygon\s*\d*$/i,
            /^new\s+polygon\s*\d*$/i,
            /^area\s*\d+$/i,
            /^shape\s*\d+$/i,
            /^layer\s*\d+$/i
        ];

        return patterns.some(pattern => pattern.test(value));
    }

    function isMeaningfulPointName(name) {
        const value = trimText(name);
        if (!value) {
            return false;
        }

        if (/^new[_\s]?point$/i.test(value)) {
            return false;
        }

        if (/^点位\s*[\d_]+$/i.test(value)) {
            return false;
        }

        return true;
    }

    function stripDefaultGeneratedPrefix(name) {
        const value = trimText(name);
        const parts = splitNameParts(value);

        if (parts.length <= 1) {
            return value;
        }

        const prefix = trimText(parts.slice(0, -1).join('-'));
        const suffix = trimText(parts[parts.length - 1] || '');

        if (isDefaultGeneratedAreaName(prefix)) {
            return suffix || value;
        }

        return value;
    }

    function getPointDisplaySuffix(name) {
        const value = trimText(name);
        if (!value) {
            return '';
        }

        const lastDashIndex = value.lastIndexOf('-');
        if (lastDashIndex === -1) {
            return stripDefaultGeneratedPrefix(value);
        }

        const suffix = trimText(value.slice(lastDashIndex + 1));
        return suffix || stripDefaultGeneratedPrefix(value);
    }

    function getPointGroupName(source, polygonNameMap) {
        const rawName = getPointName(source);
        const value = trimText(rawName);
        if (!value) {
            return '';
        }

        const lastDashIndex = value.lastIndexOf('-');
        if (lastDashIndex !== -1) {
            return trimText(value.slice(0, lastDashIndex));
        }
        return '';
    }

    function getPointGroupType(source, polygonNameMap) {
        const groupName = getPointGroupName(source, polygonNameMap);
        if (groupName && !isDefaultGeneratedAreaName(groupName)) {
            return 'area';
        }
        return 'building';
    }

    function getPointFullDisplayName(source, polygonNameMap) {
        const rawName = getPointName(source);
        const value = trimText(rawName);
        if (!value) {
            return '';
        }

        const groupName = getPointGroupName(source, polygonNameMap);
        const suffix = getPointDisplaySuffix(rawName);

        if (!groupName) {
            return suffix || value;
        }

        if (isDefaultGeneratedAreaName(groupName)) {
            return suffix || value;
        }

        return value;
    }

    function buildPolygonNameMap(features) {
        const polygonNameMap = new Map();

        (features || []).forEach(feature => {
            if (!feature || !feature.geometry || feature.geometry.type !== 'polygon') {
                return;
            }

            const polygonId = getFeatureProperty(feature, ['id']);
            const polygonName = trimText(getFeatureProperty(feature, ['name', 'polygon_name']) || feature.name || '');
            if (polygonId !== undefined && polygonId !== null && polygonName) {
                polygonNameMap.set(String(polygonId), polygonName);
            }
        });

        return polygonNameMap;
    }

    function getPolygonDisplayName(source, polygonNameMap) {
        const polygonId = getPolygonId(source);
        const polygonName = polygonId && polygonNameMap instanceof Map
            ? trimText(polygonNameMap.get(String(polygonId)) || '')
            : '';

        if (!polygonName || isDefaultGeneratedAreaName(polygonName)) {
            return '';
        }

        return polygonName;
    }

    function isEntrancePoint(source, pointSuffix) {
        const pointType = getPointType(source);
        const iconId = getPointIconId(source);
        const iconType = trimText(getFeatureProperty(source, ['iconType', 'icon_type']) || '');
        const suffix = trimText(pointSuffix);
        const rawName = getPointName(source);

        if (pointType === '0') {
            return false;
        }

        if (iconId === '2') {
            return true;
        }

        if (iconType === 'entrance') {
            return true;
        }

        if (suffix === '入口') {
            return true;
        }

        if (rawName.endsWith('-入口')) {
            return true;
        }

        return false;
    }

    function buildPointDisplayInfo(source, polygonNameMap) {
        const rawName = getPointName(source);
        const polygonName = getPolygonDisplayName(source, polygonNameMap);
        const pointSuffix = getPointDisplaySuffix(rawName);
        const entrance = isEntrancePoint(source, pointSuffix);
        const groupName = getPointGroupName(source, polygonNameMap);
        const groupType = getPointGroupType(source, polygonNameMap);
        const fullDisplayName = getPointFullDisplayName(source, polygonNameMap);
        const navDisplayName = trimText(fullDisplayName || rawName);
        const shouldCollapseEntranceLabel = entrance && (
            !!polygonName ||
            (!!groupName && !isDefaultGeneratedAreaName(groupName))
        );

        return {
            rawName: rawName,
            fullDisplayName: fullDisplayName || rawName,
            navDisplayName: navDisplayName || rawName,
            mapLabelName: shouldCollapseEntranceLabel
            ? pointSuffix
            : (pointSuffix || fullDisplayName || rawName),
            pointSuffix: pointSuffix,
            polygonName: polygonName,
            groupName: groupName,
            groupType: groupType,
            isEntrance: entrance
        };
    }

    function buildPointRecord(source, polygonNameMap) {
        const coords = getPointCoordinates(source);
        const displayInfo = buildPointDisplayInfo(source, polygonNameMap);

        return {
            id: getFeatureProperty(source, ['id']) || '',
            name: displayInfo.navDisplayName,
            rawName: displayInfo.rawName,
            fullDisplayName: displayInfo.fullDisplayName,
            displayName: displayInfo.navDisplayName,
            mapLabelName: displayInfo.mapLabelName,
            pointSuffix: displayInfo.pointSuffix,
            polygonId: getPolygonId(source),
            polygonName: displayInfo.polygonName,
            groupName: displayInfo.groupName,
            groupType: displayInfo.groupType,
            description: trimText(getFeatureProperty(source, ['description']) || ''),
            position: coords,
            pointType: getPointType(source),
            iconId: getPointIconId(source),
            isEntrance: displayInfo.isEntrance,
            geometry: source && source.geometry ? source.geometry : undefined,
            properties: source && source.properties ? source.properties : undefined
        };
    }

    function isNavigablePoint(source) {
        const geometryType = source && source.geometry ? source.geometry.type : '';
        if (geometryType && geometryType !== 'point') {
            return false;
        }

        const name = getPointName(source);
        if (!isMeaningfulPointName(name)) {
            return false;
        }

        const pointType = getPointType(source);
        if (pointType === '0' || pointType === '3') {
            return false;
        }

        return true;
    }

    function dedupePoints(points) {
        const uniqueMap = new Map();

        (points || []).forEach(point => {
            if (!point || !point.displayName || !Array.isArray(point.position)) {
                return;
            }

            const key = [
                point.id || '',
                point.rawName || '',
                point.displayName,
                point.position[0],
                point.position[1]
            ].join('|');

            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, point);
            }
        });

        return Array.from(uniqueMap.values());
    }

    function getProcessedKmlData() {
        try {
            const raw = sessionStorage.getItem('processedKMLData');
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            console.warn('[PointNameUtils] 解析 processedKMLData 失败:', error);
            return null;
        }
    }

    function getStructuredKmlData() {
        try {
            const raw = sessionStorage.getItem('kmlData');
            return raw ? JSON.parse(raw) : [];
        } catch (error) {
            console.warn('[PointNameUtils] 解析 kmlData 失败:', error);
            return [];
        }
    }

    function getNavigablePointsFromProcessedData(processedData) {
        const features = processedData && Array.isArray(processedData.features) ? processedData.features : [];
        const polygonNameMap = buildPolygonNameMap(features);

        return dedupePoints(
            features
                .filter(feature => isNavigablePoint(feature))
                .map(feature => buildPointRecord(feature, polygonNameMap))
        );
    }

    function getNavigablePointsFromStructuredData(kmlDataArray) {
        const records = [];

        (Array.isArray(kmlDataArray) ? kmlDataArray : []).forEach(kmlData => {
            const points = Array.isArray(kmlData && kmlData.points) ? kmlData.points : [];
            points.forEach(point => {
                if (!isNavigablePoint(point)) {
                    return;
                }

                records.push(buildPointRecord(point, new Map()));
            });
        });

        return dedupePoints(records);
    }

    function getAllNavigablePointsFromSession() {
        const processedData = getProcessedKmlData();
        const processedPoints = getNavigablePointsFromProcessedData(processedData);

        if (processedPoints.length > 0) {
            return processedPoints;
        }

        return getNavigablePointsFromStructuredData(getStructuredKmlData());
    }

    function findPointByName(name, points) {
        const target = trimText(name);
        if (!target) {
            return null;
        }

        const sourcePoints = Array.isArray(points) ? points : getAllNavigablePointsFromSession();

        return sourcePoints.find(point => point.displayName === target) ||
            sourcePoints.find(point => point.fullDisplayName === target) ||
            sourcePoints.find(point => point.rawName === target) ||
            sourcePoints.find(point => point.pointSuffix === target) ||
            sourcePoints.find(point => trimText(point.displayName).toLowerCase() === target.toLowerCase()) ||
            sourcePoints.find(point => trimText(point.fullDisplayName).toLowerCase() === target.toLowerCase()) ||
            sourcePoints.find(point => trimText(point.rawName).toLowerCase() === target.toLowerCase()) ||
            sourcePoints.find(point => trimText(point.pointSuffix).toLowerCase() === target.toLowerCase()) ||
            null;
    }

    global.PointNameUtils = {
        buildPointDisplayInfo: buildPointDisplayInfo,
        buildPointRecord: buildPointRecord,
        getPolygonDisplayName: getPolygonDisplayName,
        buildPolygonNameMap: buildPolygonNameMap,
        dedupePoints: dedupePoints,
        findPointByName: findPointByName,
        getAllNavigablePointsFromSession: getAllNavigablePointsFromSession,
        getNavigablePointsFromProcessedData: getNavigablePointsFromProcessedData,
        getNavigablePointsFromStructuredData: getNavigablePointsFromStructuredData,
        getPointCoordinates: getPointCoordinates,
        getPointDisplaySuffix: getPointDisplaySuffix,
        getPointFullDisplayName: getPointFullDisplayName,
        getPointGroupName: getPointGroupName,
        getPointGroupType: getPointGroupType,
        getPointName: getPointName,
        getPointType: getPointType,
        getPolygonId: getPolygonId,
        isDefaultGeneratedAreaName: isDefaultGeneratedAreaName,
        isEntrancePoint: isEntrancePoint,
        isMeaningfulPointName: isMeaningfulPointName,
        isNavigablePoint: isNavigablePoint,
        splitNameParts: splitNameParts,
        stripDefaultGeneratedPrefix: stripDefaultGeneratedPrefix,
        trimText: trimText
    };
})(window);
