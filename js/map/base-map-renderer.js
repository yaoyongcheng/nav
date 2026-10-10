(function(global) {
    'use strict';

    function isValidCoord(value) {
        return value != null && !isNaN(value) && isFinite(value);
    }

    function isValidPoint(point) {
        if (!point) {
            return false;
        }

        const lng = Array.isArray(point) ? point[0] : point.lng;
        const lat = Array.isArray(point) ? point[1] : point.lat;
        return isValidCoord(lng) && isValidCoord(lat);
    }

    function filterValidPath(coords) {
        if (!Array.isArray(coords)) {
            return [];
        }

        return coords.filter(isValidPoint);
    }

    function getPointRenderInfo(feature, polygonNameMap) {
        const pointRecord = typeof global.PointNameUtils !== 'undefined'
            ? global.PointNameUtils.buildPointRecord(feature, polygonNameMap)
            : null;
        const shouldShowPointName = typeof global.isValidFeatureName === 'function'
            ? global.isValidFeatureName(feature.name)
            : !!feature.name;
        const fallbackMapLabelName = typeof global.PointNameUtils !== 'undefined'
            ? global.PointNameUtils.getPointDisplaySuffix(
                (pointRecord && pointRecord.rawName) || feature.name || ''
            )
            : feature.name;
        const displayName = shouldShowPointName
            ? ((pointRecord && pointRecord.mapLabelName) || fallbackMapLabelName || feature.name)
            : '';
        const isBlockPoint = !!(
            pointRecord &&
            pointRecord.polygonId &&
            !pointRecord.isEntrance
        );

        return {
            pointRecord,
            displayName,
            fallbackMapLabelName,
            isBlockPoint
        };
    }

    function getPolygonLabelName(feature, polygonNameMap) {
        if (typeof global.PointNameUtils !== 'undefined') {
            if (typeof global.PointNameUtils.getPolygonDisplayName === 'function') {
                return global.PointNameUtils.getPolygonDisplayName(feature, polygonNameMap) || feature.name || '';
            }

            const polygonId = typeof global.PointNameUtils.getPolygonId === 'function'
                ? global.PointNameUtils.getPolygonId(feature)
                : null;
            if (polygonId && polygonNameMap instanceof Map) {
                return polygonNameMap.get(String(polygonId)) || feature.name || '';
            }
        }

        return feature.name || '';
    }

    function bindPointMarkerClick(marker, feature, handler) {
        if (typeof handler !== 'function') {
            return;
        }

        setTimeout(function() {
            const markerDom = marker.getContentDom ? marker.getContentDom() : null;
            if (!markerDom) {
                return;
            }

            const clickableDom = markerDom.querySelector('.kml-icon-marker') || markerDom.querySelector('.kml-text-marker') || markerDom.querySelector('.kml-label');
            if (!clickableDom) {
                return;
            }

            clickableDom.addEventListener('click', function(event) {
                handler(feature, marker, event);
            });
        }, 100);
    }

    function bindBlockPointVisibility(map, blockPointMarkers, zoomThreshold) {
        if (!map || !Array.isArray(blockPointMarkers) || blockPointMarkers.length === 0) {
            return null;
        }

        const applyVisibility = function() {
            const zoom = map.getZoom();
            const shouldShow = zoom >= zoomThreshold;

            blockPointMarkers.forEach(marker => {
                if (shouldShow) {
                    if (!marker.getMap()) {
                        marker.setMap(map);
                    }
                } else if (marker.getMap()) {
                    marker.setMap(null);
                }
            });
        };

        map.on('zoomchange', applyVisibility);
        applyVisibility();
        return applyVisibility;
    }

    function renderFeatures(params) {
        const map = params && params.map;
        const features = params && Array.isArray(params.features) ? params.features : [];
        const fileName = params && params.fileName ? params.fileName : 'KML';
        const layerStore = params && Array.isArray(params.layerStore) ? params.layerStore : null;
        const options = Object.assign({
            interactive: true,
            showPolygonLabels: true,
            showLines: true,
            showPoints: true,
            showBlockPoints: true,
            blockPointShowZoom: 18,
            pointMarkerZIndex: 100,
            lineZIndex: null,
            pointOffset: null,
            pointPointerEvents: null,
            storeLayer: true,
            polygonFilter: null,
            lineFilter: null,
            pointFilter: null,
            onPolygonClick: null,
            onPointClick: null
        }, params && params.options ? params.options : {});

        if (!map || features.length === 0) {
            return {
                layer: null,
                layerMarkers: [],
                blockPointMarkers: [],
                polylines: [],
                allCoordinates: [],
                zoomHandler: null
            };
        }

        const layerId = 'kml-' + Date.now();
        const layerMarkers = [];
        const blockPointMarkers = [];
        const polylines = [];
        const allCoordinates = [];
        const polygonNameMap = typeof global.PointNameUtils !== 'undefined'
            ? global.PointNameUtils.buildPolygonNameMap(features)
            : new Map();

        const points = features.filter(feature => feature && feature.geometry && feature.geometry.type === 'point');
        const lines = features.filter(feature => feature && feature.geometry && feature.geometry.type === 'line');
        const polygons = features.filter(feature => feature && feature.geometry && feature.geometry.type === 'polygon');
        const filteredPolygons = typeof options.polygonFilter === 'function'
            ? polygons.filter(options.polygonFilter)
            : polygons;

        const polygonsWithArea = filteredPolygons.map((feature, index) => ({
            feature,
            area: typeof global.calculatePolygonArea === 'function'
                ? global.calculatePolygonArea(feature.geometry.coordinates)
                : index
        })).sort((a, b) => b.area - a.area);

        polygonsWithArea.forEach(({ feature }, index) => {
            const validPath = filterValidPath(feature.geometry.coordinates);
            if (validPath.length < 3) {
                return;
            }

            allCoordinates.push(...validPath);

            const polyStyle = feature.geometry.style || {
                fillColor: global.MapConfig && global.MapConfig.routeStyles && global.MapConfig.routeStyles.polygon
                    ? global.MapConfig.routeStyles.polygon.fillColor
                    : '#CCCCCC',
                strokeColor: global.MapConfig && global.MapConfig.routeStyles && global.MapConfig.routeStyles.polygon
                    ? global.MapConfig.routeStyles.polygon.strokeColor
                    : 'transparent',
                strokeWeight: global.MapConfig && global.MapConfig.routeStyles && global.MapConfig.routeStyles.polygon
                    ? global.MapConfig.routeStyles.polygon.strokeWeight
                    : 0
            };

            const rawFeatureZIndex = (feature.properties && Number.isFinite(parseInt(feature.properties.zIndex, 10)))
                ? parseInt(feature.properties.zIndex, 10)
                : index;
            const featureZIndex = 10 + Math.max(0, rawFeatureZIndex);
            const styleOpacity = (polyStyle.fillOpacity !== undefined && polyStyle.fillOpacity !== null)
                ? parseFloat(polyStyle.fillOpacity)
                : 0.85;
            const normalizedOpacity = isNaN(styleOpacity)
                ? 0.85
                : Math.max(0, Math.min(1, styleOpacity));
            const strokeColor = polyStyle.strokeColor || 'transparent';
            const strokeWeight = Number.isFinite(parseInt(polyStyle.strokeWeight, 10))
                ? Math.max(parseInt(polyStyle.strokeWeight, 10), 0)
                : 0;
            const strokeOpacity = strokeColor === 'transparent' || strokeWeight <= 0 ? 0 : 1;

            const polygon = new AMap.Polygon({
                path: validPath,
                strokeColor: strokeColor,
                strokeWeight: strokeWeight,
                strokeOpacity: strokeOpacity,
                fillColor: polyStyle.fillColor || '#CCCCCC',
                fillOpacity: normalizedOpacity,
                zIndex: featureZIndex,
                map: map
            });

            polygon.setExtData({
                name: feature.name,
                type: feature.type,
                description: feature.description,
                properties: feature.properties || {}
            });

            if (options.interactive && typeof options.onPolygonClick === 'function') {
                polygon.on('click', function() {
                    options.onPolygonClick(feature, polygon);
                });
            }

            layerMarkers.push(polygon);

            const polygonLabelName = getPolygonLabelName(feature, polygonNameMap);
            if (options.showPolygonLabels &&
                typeof global.isValidFeatureName === 'function' &&
                global.isValidFeatureName(polygonLabelName) &&
                typeof global.calculatePolygonCenter === 'function') {
                const center = global.calculatePolygonCenter(validPath);
                const textColor = (feature.properties && feature.properties.text_color) || '#c8c8c8';
                const textSize = (feature.properties && feature.properties.text_size) || 10;
                const textFrameColor = (feature.properties && feature.properties.text_frame_color) || '#FFFFFF';
                const textWeight = (feature.properties && feature.properties.text_weight) || 'normal';
                const textMarker = new AMap.Text({
                    text: polygonLabelName,
                    position: center,
                    anchor: 'center',
                    style: {
                        'background-color': 'transparent',
                        'border': 'none',
                        'color': textColor,
                        'font-size': textSize + 'px',
                        'font-weight': textWeight,
                        'text-align': 'center',
                        'padding': '0',
                        'text-shadow': `-1px -1px 0 ${textFrameColor}, 1px -1px 0 ${textFrameColor}, -1px 1px 0 ${textFrameColor}, 1px 1px 0 ${textFrameColor}`
                    },
                    zIndex: featureZIndex + 1,
                    map: map
                });

                textMarker.setExtData({
                    name: polygonLabelName,
                    type: '面标签',
                    parentType: feature.type
                });

                layerMarkers.push(textMarker);
            }
        });

        if (options.showLines) {
            lines.forEach(feature => {
                if (typeof options.lineFilter === 'function' && !options.lineFilter(feature)) {
                    return;
                }

                const validPath = filterValidPath(feature.geometry.coordinates);
                if (validPath.length < 2) {
                    return;
                }

                allCoordinates.push(...validPath);

                const polyline = new AMap.Polyline({
                    path: validPath,
                    strokeColor: '#9AE59D',
                    strokeWeight: 3,
                    strokeOpacity: 1,
                    zIndex: Number.isFinite(options.lineZIndex)
                        ? options.lineZIndex
                        : ((feature.properties && feature.properties.zIndex) || 50),
                    map: map
                });

                polyline.setExtData({
                    name: feature.name || '未命名线',
                    type: feature.type || '线',
                    description: feature.description || '',
                    lineId: feature.properties && feature.properties.id,
                    coordinates: validPath
                });

                polylines.push(polyline);
                layerMarkers.push(polyline);
            });
        }

        if (options.showPoints) {
            points.forEach(feature => {
                if (typeof options.pointFilter === 'function' && !options.pointFilter(feature)) {
                    return;
                }

                const point = feature.geometry.coordinates;
                if (!isValidPoint(point)) {
                    return;
                }

                allCoordinates.push(point);

                const pointInfo = getPointRenderInfo(feature, polygonNameMap);
                const pointerEvents = options.pointPointerEvents || (options.interactive ? 'auto' : 'none');
                const allowBlockPoint = options.showBlockPoints || !pointInfo.isBlockPoint;
                if (!allowBlockPoint) {
                    return;
                }

                const shouldMountOnMap = !pointInfo.isBlockPoint ||
                    !options.showBlockPoints ||
                    map.getZoom() >= options.blockPointShowZoom;

                const marker = new AMap.Marker({
                    position: point,
                    map: shouldMountOnMap ? map : null,
                    title: pointInfo.displayName,
                    content: global.createNamedPointMarkerContent(
                        feature.name,
                        feature.geometry.style,
                        feature.properties,
                        pointInfo.displayName,
                        {
                            interactive: options.interactive,
                            pointerEvents: pointerEvents
                        }
                    ),
                    offset: options.pointOffset || new AMap.Pixel(-9, -25),
                    zIndex: options.pointMarkerZIndex
                });

                marker.setExtData({
                    name: feature.name,
                    displayName: pointInfo.pointRecord ? pointInfo.pointRecord.displayName : feature.name,
                    mapLabelName: pointInfo.pointRecord
                        ? (pointInfo.pointRecord.mapLabelName || pointInfo.fallbackMapLabelName)
                        : pointInfo.displayName,
                    type: feature.type,
                    description: feature.description,
                    properties: feature.properties || {},
                    isBlockPoint: pointInfo.isBlockPoint
                });

                if (pointInfo.isBlockPoint) {
                    blockPointMarkers.push(marker);
                }

                layerMarkers.push(marker);

                if (options.interactive && typeof options.onPointClick === 'function') {
                    bindPointMarkerClick(marker, feature, options.onPointClick);
                }
            });
        }

        const zoomHandler = options.showBlockPoints
            ? bindBlockPointVisibility(map, blockPointMarkers, options.blockPointShowZoom)
            : null;

        const layer = {
            id: layerId,
            name: fileName,
            markers: layerMarkers,
            blockPointMarkers: blockPointMarkers,
            visible: true,
            features: features,
            zoomHandler: zoomHandler
        };

        if (options.storeLayer !== false && layerStore) {
            layerStore.push(layer);
        }

        return {
            layer,
            layerMarkers,
            blockPointMarkers,
            polylines,
            allCoordinates,
            zoomHandler
        };
    }

    global.BaseMapRenderer = {
        renderFeatures
    };
})(window);
