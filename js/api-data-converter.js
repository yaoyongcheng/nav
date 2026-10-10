/**
 * API数据转换模块
 * 将后端API返回的点、线、面数据转换为地图可用的features格式
 */

const APIDataConverter = {
    /**
     * 调试模式 - 打印详细的数据解析信息
     */
    debug: true,

    mapIconBasePath: 'images/工地数字导航小程序切图/地图icon',

    mapIconDefinitions: Object.freeze({
        default: { down: 'Property 1=建筑-up.png', up: '建筑-down.png' },
        entrance: { down: 'Property 1=出入口up.png', up: '出入口-down.png' },
        yard: { down: 'Property 1=堆场-up.png', up: '堆场-down.png' },
        workshop: { down: 'Property 1=加工区-up.png', up: '加工区-down.png' },
        building: { down: 'Property 1=建筑-up.png', up: '建筑-down.png' },
        storage: { down: 'Property 1=库房.png', up: '库房-down.png' },
        material: { down: 'Property 1=周转材料堆场.png', up: '周转材料堆场-down.png' },
        camera: { down: 'Property 1=监控up-1.png', up: '监控-down.png' },
        aiCamera: { down: 'Property 1=AI监控.png', up: 'AI-down.png' }
    }),

    iconIdTypeMap: Object.freeze({
        1: 'building',
        2: 'entrance',
        3: 'yard',
        4: 'workshop',
        5: 'building',
        6: 'material',
        7: 'storage',
        8: 'camera',
        9: 'aiCamera'
    }),

    /**
     * 打印调试信息
     */
    log(...args) {
        if (this.debug) {
            console.log('[APIDataConverter]', ...args);
        }
    },

    /**
     * 主转换函数 - 将API数据转换为features数组
     * @param {Array} points - 点数据数组
     * @param {Array} polylines - 线数据数组
     * @param {Array} polygons - 面数据数组
     * @returns {Array} features数组
     */
    convert(points, polylines, polygons) {
        const features = [];

        this.log('=== 开始数据转换 ===');
        this.log('点数据数量:', points?.length || 0);
        this.log('线数据数量:', polylines?.length || 0);
        this.log('面数据数量:', polygons?.length || 0);

        // 转换点
        if (points && points.length > 0) {
            this.log('\n--- 点数据解析 ---');
            points.forEach((point, index) => {
                // 过滤掉 new_point / new point / 新建 Point / 点位xx 类型的点（不区分大小写）
                const pointName = (point.point_name || point.name || '').toLowerCase();
                if (pointName.includes('new_point') || pointName.includes('new point') || pointName.includes('新建 point') || pointName.includes('新建point')) {
                    this.log(`点[${index}] 跳过(newpoint类型): ${point.point_name}`);
                    return;
                }
                // 过滤掉"点位"开头后跟数字的点（如：点位1、点位 20、点位 236_2）
                if (/^点位\s*[\d_]+$/i.test(point.point_name || point.name || '')) {
                    this.log(`点[${index}] 跳过(点位xx类型): ${point.point_name}`);
                    return;
                }
                // 过滤掉 point_type 为 3 的点（AI摄像头对应的点位，避免冗余渲染）
                if (point.point_type === 3) {
                    this.log(`点[${index}] 跳过(AI摄像头点位): ${point.point_name}, point_type=${point.point_type}`);
                    return;
                }

                const feature = this.convertPoint(point, index);
                if (feature) {
                    features.push(feature);
                }
            });
        }

        // 转换线
        if (polylines && polylines.length > 0) {
            this.log('\n--- 线数据解析 ---');
            polylines.forEach((line, index) => {
                const feature = this.convertPolyline(line, index);
                if (feature) {
                    features.push(feature);
                }
            });
        }

        // 转换面
        if (polygons && polygons.length > 0) {
            this.log('\n--- 面数据解析 ---');
            polygons.forEach((polygon, index) => {
                const feature = this.convertPolygon(polygon, index);
                if (feature) {
                    features.push(feature);
                }
            });
        }

        this.log('\n=== 转换完成 ===');
        this.log('总features数量:', features.length);

        return features;
    },

    /**
     * 转换单个点数据
     */
    convertPoint(point, index) {
        this.log(`\n点[${index}] 原始数据:`, JSON.stringify(point, null, 2));

        // 解析坐标
        const lng = parseFloat(point.longitude);
        const lat = parseFloat(point.latitude);

        if (isNaN(lng) || isNaN(lat)) {
            this.log(`点[${index}] 坐标无效: lng=${point.longitude}, lat=${point.latitude}`);
            return null;
        }

        // 解析名称 - API使用 point_name，保留完整名称（包含区块前缀）
        let name = point.point_name || point.name || '未命名点';

        const pointType = this.normalizePointType(point.point_type);
        const isTextPoint = pointType === '0';

        // 根据icon_id获取本地图标路径
        const iconInfo = this.getIconByIconId(point.icon_id, point.icon_name, name);
        const downIcon = iconInfo.downIcon;
        const upIcon = iconInfo.upIcon;
        const iconType = iconInfo.iconType;
        
        // 解析文字样式
        const textColor = this.parseColor(point.text_color, '#333333');
        const textSize = parseInt(point.text_size) || 12;
        const textFrameColor = this.parseColor(point.text_frame_color, '#FFFFFF');

        const feature = {
            name: name,
            type: '点',  // 添加中文type字段，用于marker匹配
            description: point.description || '',
            geometry: {
                type: 'point',
                coordinates: [lng, lat]
            },
            properties: {
                id: point.id,
                icon: downIcon,
                upIcon: upIcon,
                downIcon: downIcon,
                iconId: point.icon_id,
                iconType: iconType,
                iconName: point.icon_name,
                pointType: pointType,
                isTextPoint: isTextPoint,
                zIndex: point.z_index || 0,
                // 文字样式
                textColor: textColor,
                textSize: textSize,
                textFrameColor: textFrameColor,
                // 保留原始数据
                ...point
            }
        };

        this.log(`点[${index}] 转换结果:`, {
            name: feature.name,
            coordinates: feature.geometry.coordinates,
            iconType: iconType,
            downIcon: downIcon,
            textColor: textColor
        });

        return feature;
    },

    /**
     * 转换单个线数据
     */
    convertPolyline(line, index) {
        this.log(`\n线[${index}] 原始数据:`, JSON.stringify(line, null, 2));

        // 解析名称
        const name = line.line_name || line.name || '未命名线';

        // 解析坐标
        const coordsField = line.line_position || line.coordinates || line.path;
        if (!coordsField) {
            this.log(`线[${index}] "${name}" 缺少坐标数据`);
            return null;
        }

        const coords = this.parseCoordinates(coordsField, `线[${index}] ${name}`);
        if (!coords || coords.length < 2) {
            this.log(`线[${index}] "${name}" 坐标解析失败或点数不足`);
            return null;
        }

        // 解析样式
        const strokeColor = this.parseColor(line.line_color, '#9AE59D');
        const strokeWeight = parseInt(line.line_width) || 3;
        const strokeOpacity = parseFloat(line.line_opacity) || 1;

        const feature = {
            name: name,
            type: '线',  // 添加中文type字段
            description: line.description || '',
            geometry: {
                type: 'line',
                coordinates: coords,
                style: {
                    strokeColor: strokeColor,
                    strokeWeight: strokeWeight,
                    strokeOpacity: strokeOpacity
                }
            },
            properties: {
                id: line.id,
                zIndex: line.z_index || 0
            }
        };

        this.log(`线[${index}] 转换结果:`, {
            name: feature.name,
            pointCount: coords.length,
            style: feature.geometry.style
        });

        return feature;
    },

    /**
     * 转换单个面数据
     */
    convertPolygon(polygon, index) {
        this.log(`\n面[${index}] 原始数据:`, JSON.stringify(polygon, null, 2));

        // 解析名称
        const name = polygon.polygon_name || polygon.name || '未命名面';

        // 解析坐标
        const coordsField = polygon.pg_position || polygon.coordinates || polygon.path;
        if (!coordsField) {
            this.log(`面[${index}] "${name}" 缺少坐标数据`);
            return null;
        }

        const coords = this.parseCoordinates(coordsField, `面[${index}] ${name}`);
        if (!coords || coords.length < 3) {
            this.log(`面[${index}] "${name}" 坐标解析失败或点数不足`);
            return null;
        }

        const areaType = polygon.area_type;
        const isProhibit = areaType === 1;
        const isFence = areaType === 0;
        const useUnifiedZoneStyle = typeof shouldUseUnifiedZoneStyle === 'function' && shouldUseUnifiedZoneStyle(polygon);
        const unifiedZoneStyle = useUnifiedZoneStyle && typeof getUnifiedZoneStyle === 'function'
            ? getUnifiedZoneStyle()
            : null;
        const prohibitZoneStyle = typeof getUnifiedZoneStyle === 'function'
            ? getUnifiedZoneStyle()
            : { fillColor: '#FFA8A8', fillOpacity: 0.2, strokeColor: '#FF6D6D', strokeWeight: 1, textColor: '#E94242', textFrameColor: '#FFFFFF', textSize: 10, textWeight: 'bold' };
        const fillColor = useUnifiedZoneStyle
            ? unifiedZoneStyle.fillColor
            : isProhibit
                ? prohibitZoneStyle.fillColor
                : this.parseColor(
                    polygon.pg_color,
                    isFence ? 'transparent' : '#FFFFFF'
                );
        const fillOpacity = useUnifiedZoneStyle
            ? unifiedZoneStyle.fillOpacity
            : isProhibit
                ? prohibitZoneStyle.fillOpacity
                : isFence
                    ? 0
                    : 1;
        const strokeColor = useUnifiedZoneStyle
            ? unifiedZoneStyle.strokeColor
            : isProhibit
                ? prohibitZoneStyle.strokeColor
                : this.parseColor(
                    polygon.pg_frame_color,
                    'transparent'
                );
        const strokeWeight = useUnifiedZoneStyle
            ? unifiedZoneStyle.strokeWeight
            : isProhibit
                ? prohibitZoneStyle.strokeWeight
                : polygon.pg_frame_width !== undefined
                    ? (parseInt(polygon.pg_frame_width) || 0)
                    : 0;
        
        this.log(`面[${index}] 样式:`, {
            fillColor: fillColor,
            fillOpacity: fillOpacity,
            strokeColor: strokeColor,
            strokeWeight: strokeWeight
        });

        // 解析文字样式
        const textColor = useUnifiedZoneStyle
            ? unifiedZoneStyle.textColor
            : isProhibit
                ? prohibitZoneStyle.textColor
                : this.parseColor(polygon.text_color, '#c8c8c8');
        const textSize = useUnifiedZoneStyle
            ? (unifiedZoneStyle.textSize || 10)
            : isProhibit
                ? (prohibitZoneStyle.textSize || 10)
                : (parseInt(polygon.text_size) || 10);
        const textFrameColor = useUnifiedZoneStyle
            ? unifiedZoneStyle.textFrameColor
            : isProhibit
                ? prohibitZoneStyle.textFrameColor
                : this.parseColor(polygon.text_frame_color, '#FFFFFF');
        const textWeight = useUnifiedZoneStyle
            ? (unifiedZoneStyle.textWeight || 'bold')
            : isProhibit
                ? (prohibitZoneStyle.textWeight || 'bold')
                : 'normal';

        const feature = {
            name: name,
            type: '面',  // 添加中文type字段
            description: polygon.description || '',
            geometry: {
                type: 'polygon',
                coordinates: coords,
                style: {
                    fillColor: fillColor,
                    fillOpacity: fillOpacity,
                    strokeColor: strokeColor,
                    strokeWeight: strokeWeight
                }
            },
            properties: {
                id: polygon.id,
                zIndex: polygon.z_index || 0,
                area_type: polygon.area_type,
                polygon_name: polygon.polygon_name,
                pg_color: polygon.pg_color,
                pg_opacity: polygon.pg_opacity,
                pg_frame_color: polygon.pg_frame_color,
                pg_frame_width: polygon.pg_frame_width,
                // 文字样式
                text_color: textColor,
                text_size: textSize,
                text_frame_color: textFrameColor,
                text_weight: textWeight
            }
        };

        this.log(`面[${index}] 转换结果:`, {
            name: feature.name,
            pointCount: coords.length,
            style: feature.geometry.style
        });

        return feature;
    },

    /**
     * 解析坐标字符串为数组
     * 支持格式:
     * 1. "lng,lat;lng,lat;..." (分号分隔)
     * 2. [[lng,lat],[lng,lat],...] (JSON数组)
     * 3. "[lng,lat],[lng,lat],..." (字符串形式的数组)
     */
    parseCoordinates(coordsField, label) {
        this.log(`${label} 坐标原始值:`, coordsField);
        this.log(`${label} 坐标类型:`, typeof coordsField);

        let coords = [];

        try {
            if (typeof coordsField === 'string') {
                const trimmed = coordsField.trim();

                // 格式1: 分号分隔 "lng,lat;lng,lat;..."
                if (trimmed.includes(';') && !trimmed.startsWith('[')) {
                    coords = trimmed.split(';')
                        .filter(p => p.trim())
                        .map(point => {
                            const [lng, lat] = point.split(',').map(Number);
                            return [lng, lat];
                        })
                        .filter(p => !isNaN(p[0]) && !isNaN(p[1]));
                    this.log(`${label} 解析为分号格式, 点数:`, coords.length);
                }
                // 格式2/3: JSON数组
                else if (trimmed.startsWith('[')) {
                    coords = JSON.parse(trimmed);
                    this.log(`${label} 解析为JSON格式, 点数:`, coords.length);
                }
                // 其他格式尝试
                else {
                    this.log(`${label} 未知字符串格式:`, trimmed.substring(0, 100));
                }
            } else if (Array.isArray(coordsField)) {
                coords = coordsField;
                this.log(`${label} 已是数组格式, 点数:`, coords.length);
            }
        } catch (e) {
            this.log(`${label} 坐标解析错误:`, e.message);
            return null;
        }

        // 验证坐标格式
        if (!Array.isArray(coords) || coords.length === 0) {
            return null;
        }

        // 确保每个坐标点是 [lng, lat] 格式
        const validCoords = coords.filter(coord => {
            return Array.isArray(coord) &&
                   coord.length >= 2 &&
                   !isNaN(coord[0]) &&
                   !isNaN(coord[1]);
        });

        return validCoords;
    },

    /**
     * 解析颜色值
     */
    parseColor(color, defaultColor) {
        if (!color) return defaultColor;

        // 已经是有效的颜色格式
        if (color.startsWith('#') || color.startsWith('rgb')) {
            return color;
        }

        // 尝试添加#前缀
        if (/^[0-9a-fA-F]{6}$/.test(color)) {
            return '#' + color;
        }

        return defaultColor;
    },

    /**
     * 从图标URL解析图标类型
     */
    parseIconType(iconUrl) {
        if (!iconUrl) return 'default';

        // 从URL中提取文件名
        const match = iconUrl.match(/\/([^\/]+?)(?:_down|_up)?\.png$/i);
        if (match) {
            return match[1];
        }

        return 'default';
    },

    /**
     * 根据 icon_id / icon_name / point_name 获取根目录地图图标路径
     * 优先级：
     * 1. icon_name 关键词
     * 2. 已知 icon_id 映射
     * 3. point_name 关键词兜底
     */
    getIconByIconId(iconId, iconName = '', pointName = '') {
        const iconType = this.resolveIconType(iconId, iconName, pointName);
        const iconFiles = this.mapIconDefinitions[iconType] || this.mapIconDefinitions.default;

        return {
            downIcon: `${this.mapIconBasePath}/${iconFiles.down}`,
            upIcon: `${this.mapIconBasePath}/${iconFiles.up}`,
            iconType: iconType
        };
    },

    resolveIconType(iconId, iconName = '', pointName = '') {
        const normalizedIconName = this.normalizeIconText(iconName);
        const normalizedPointName = this.normalizeIconText(pointName);

        return (
            this.resolveIconTypeByText(normalizedIconName) ||
            this.iconIdTypeMap[iconId] ||
            this.resolveIconTypeByText(normalizedPointName) ||
            'default'
        );
    },

    resolveIconTypeByText(text) {
        if (!text) return '';

        if ((text.includes('ai') && (text.includes('监控') || text.includes('摄像头'))) || text.includes('ai监控')) {
            return 'aiCamera';
        }
        if (text.includes('监控') || text.includes('摄像头')) {
            return 'camera';
        }
        if (text.includes('周转材料')) {
            return 'material';
        }
        if (text.includes('库房')) {
            return 'storage';
        }
        if (text.includes('材料堆场') || text.includes('堆料场')) {
            return 'yard';
        }
        if (text.includes('材料堆放')) {
            return 'material';
        }
        if (text.includes('堆场')) {
            return 'yard';
        }
        if (text.includes('加工')) {
            return 'workshop';
        }
        if (text.includes('出入口') || text.includes('gate') || text.includes('门')) {
            return 'entrance';
        }
        if (text.includes('建筑')) {
            return 'building';
        }

        return '';
    },

    normalizeIconText(text) {
        return String(text || '').trim().toLowerCase().replace(/\s+/g, '');
    },

    normalizePointType(pointType) {
        return pointType === undefined || pointType === null ? '' : String(pointType);
    },

    /**
     * 打印数据摘要报告
     */
    printSummary(points, polylines, polygons) {
        console.log('\n========== API数据摘要报告 ==========');
        
        console.log('\n【点数据字段】');
        if (points && points.length > 0) {
            console.log('字段列表:', Object.keys(points[0]));
            console.log('示例数据:', points[0]);
        } else {
            console.log('无点数据');
        }

        console.log('\n【线数据字段】');
        if (polylines && polylines.length > 0) {
            console.log('字段列表:', Object.keys(polylines[0]));
            console.log('示例数据:', polylines[0]);
        } else {
            console.log('无线数据');
        }

        console.log('\n【面数据字段】');
        if (polygons && polygons.length > 0) {
            console.log('字段列表:', Object.keys(polygons[0]));
            console.log('示例数据:', polygons[0]);
        } else {
            console.log('无面数据');
        }

        console.log('\n=====================================');
    }
};

// 导出到全局
window.APIDataConverter = APIDataConverter;
