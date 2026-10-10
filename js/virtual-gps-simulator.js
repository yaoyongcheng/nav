/**
 * 虚拟GPS模拟器 - 用于测试导航功能
 * 使用：VirtualGPS.start() 开始, VirtualGPS.stop() 停止
 */

const VirtualGPS = {
    isRunning: false,
    timerId: null,
    routePoints: [],
    currentIndex: 0,
    speed: 30,
    routeLabel: '',

    start(speedKmh = 30) {
        if (this.isRunning) {
            console.warn('[虚拟GPS] 已在运行中');
            return;
        }

        const points = this.getRoutePoints();
        if (!points || points.length === 0) {
            console.error('[虚拟GPS] 未找到导航路线，请先开始导航');
            return;
        }

        // 停止真实GPS
        if (typeof NavGPS !== 'undefined' && NavGPS.stopWatch) {
            NavGPS.stopWatch();
            console.log('[虚拟GPS] 已停止真实GPS');
        }

        this.routePoints = points;
        this.currentIndex = 0;
        this.speed = speedKmh;
        this.isRunning = true;
        this.routeLabel = 'navigation_path';

        console.log(`%c[虚拟GPS] 🚗 启动模拟`, 'color: blue; font-weight: bold');
        console.log(`  路线点数: ${points.length}, 速度: ${speedKmh} km/h`);

        this.updatePosition();
        this.timerId = setInterval(() => this.updatePosition(), this.calculateInterval());
    },

    getRoutePoints() {
        if (typeof NavCore !== 'undefined' && NavCore.getNavigationPath) {
            return NavCore.getNavigationPath();
        }
        if (window.navigationPath) {
            return window.navigationPath;
        }
        return null;
    },

    normalizePoint(point) {
        if (Array.isArray(point) && point.length >= 2) {
            const lng = Number(point[0]);
            const lat = Number(point[1]);
            if (Number.isFinite(lng) && Number.isFinite(lat)) {
                return [lng, lat];
            }
        }

        if (point && typeof point === 'object') {
            const lng = Number(point.lng ?? point.longitude);
            const lat = Number(point.lat ?? point.latitude);
            if (Number.isFinite(lng) && Number.isFinite(lat)) {
                return [lng, lat];
            }
        }

        return null;
    },

    normalizeRoutePoints(points) {
        if (!Array.isArray(points)) return [];
        return points
            .map(point => this.normalizePoint(point))
            .filter(Boolean);
    },

    startWithPoints(points, speedKmh = 30, label = 'manual_points') {
        if (this.isRunning) {
            console.warn('[虚拟GPS] 已在运行中，请先执行 VirtualGPS.stop()');
            return;
        }

        const normalizedPoints = this.normalizeRoutePoints(points);
        if (normalizedPoints.length < 2) {
            console.error('[虚拟GPS] 自定义路线至少需要两个有效坐标点');
            return;
        }

        this.routePoints = normalizedPoints;
        this.currentIndex = 0;
        this.speed = speedKmh;
        this.isRunning = true;
        this.routeLabel = label;

        console.log(`%c[虚拟GPS] 🧪 启动自定义路线模拟`, 'color: #7b61ff; font-weight: bold');
        console.log(`  标签: ${label}, 路线点数: ${normalizedPoints.length}, 速度: ${speedKmh} km/h`);

        this.updatePosition();
        this.timerId = setInterval(() => this.updatePosition(), this.calculateInterval());
    },

    resolveReporterIdentity() {
        let plateNumber = '';
        let projectId = '';

        if (typeof window.VehicleLocationReporter !== 'undefined') {
            const status = window.VehicleLocationReporter.getStatus();
            plateNumber = status.licensePlate || '';
            projectId = status.projectId || '';
        }

        if (!plateNumber || !projectId) {
            const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
            const projectSelection = JSON.parse(sessionStorage.getItem('projectSelection') || '{}');

            plateNumber = plateNumber || currentUser.licensePlate || '';

            if (!projectId) {
                if (projectSelection.projectCode) {
                    projectId = projectSelection.projectCode;
                } else if (projectSelection.projectId) {
                    projectId = projectSelection.projectId;
                } else if (typeof projectSelection.project === 'object' && projectSelection.project?.projectCode) {
                    projectId = projectSelection.project.projectCode;
                }
            }
        }

        return {
            plateNumber,
            projectId
        };
    },

    calculateInterval() {
        const avgDistance = 8;
        const speedMs = (this.speed * 1000) / 3600;
        return Math.max(800, (avgDistance / speedMs) * 1000);
    },

    updatePosition() {
        if (this.currentIndex >= this.routePoints.length) {
            console.log('%c[虚拟GPS] ✅ 已到达终点', 'color: green; font-weight: bold');
            this.stop();
            return;
        }

        const point = this.routePoints[this.currentIndex];
        window.lastGpsPosIndex = [point[0], point[1]];

        // 计算方向（基于前后两点）
        let heading = 0;
        if (this.currentIndex > 0) {
            const prevPoint = this.routePoints[this.currentIndex - 1];
            heading = this.calculateBearing(prevPoint, point);
        }

        // 触发导航更新
        if (typeof window.NavCore !== 'undefined' && typeof window.NavCore.onGPSUpdate === 'function') {
            window.NavCore.onGPSUpdate(point, 10, heading);
        }

        if (typeof window.VehicleLocationReporter !== 'undefined') {
            window.VehicleLocationReporter.updatePosition({
                latitude: point[1],
                longitude: point[0],
                direction: heading || window.currentMapRotation || 1,
                accuracy: 10,
                source: 'virtual_gps',
                isNavigating: Boolean(window.NavCore && typeof window.NavCore.getStatus === 'function' && window.NavCore.getStatus().isNavigating),
                reportedAt: new Date().toISOString()
            });
        }

        // 触发位置上报（让管理端能看到）
        this.reportToServer();

        const progress = ((this.currentIndex / this.routePoints.length) * 100).toFixed(1);
        console.log(`[虚拟GPS] 📍 ${progress}% [${this.currentIndex}/${this.routePoints.length}]`, {
            label: this.routeLabel || 'navigation_path',
            point
        });

        this.currentIndex++;
    },

    async reportToServer() {
        try {
            // 优先使用吸附后的位置
            let position = window.snappedPosition || window.lastGpsPosIndex;
            if (!position) return;

            const { plateNumber, projectId } = this.resolveReporterIdentity();

            if (!plateNumber || !projectId) {
                console.warn('[虚拟GPS] 缺少车牌号或项目ID，无法上报位置');
                return;
            }

            // 与真实上报保持一致，后端要求 direction 不能为 0
            const direction = window.currentMapRotation || 1;

            const response = await fetch('https://dmap.cscec3bxjy.cn/api/transport/temp-vehicle/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    Latitude: position[1],
                    Longitude: position[0],
                    PlateNumber: plateNumber,
                    ProjectId: projectId,
                    Direction: direction
                })
            });

            if (response.ok) {
                console.log('[虚拟GPS] ✓ 位置已上报到服务器');
            } else {
                console.warn('[虚拟GPS] 位置上报失败:', response.status);
            }
        } catch (e) {
            console.warn('[虚拟GPS] 位置上报异常:', e.message);
        }
    },

    async reportPoint(point, options = {}) {
        const normalizedPoint = this.normalizePoint(point);
        if (!normalizedPoint) {
            console.error('[虚拟GPS] 无效坐标点，无法单点上报');
            return;
        }

        const { plateNumber, projectId } = this.resolveReporterIdentity();
        if (!plateNumber || !projectId) {
            console.warn('[虚拟GPS] 缺少车牌号或项目ID，无法单点上报');
            return;
        }

        const direction = Number(options.direction || window.currentMapRotation || 1) || 1;
        window.lastGpsPosIndex = [normalizedPoint[0], normalizedPoint[1]];

        if (typeof window.VehicleLocationReporter !== 'undefined') {
            window.VehicleLocationReporter.updatePosition({
                latitude: normalizedPoint[1],
                longitude: normalizedPoint[0],
                direction,
                accuracy: options.accuracy || 10,
                source: options.source || 'virtual_gps_manual',
                isNavigating: !!options.isNavigating,
                reportedAt: new Date().toISOString()
            });
        }

        const response = await fetch('https://dmap.cscec3bxjy.cn/api/transport/temp-vehicle/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                Latitude: normalizedPoint[1],
                Longitude: normalizedPoint[0],
                PlateNumber: plateNumber,
                ProjectId: projectId,
                Direction: direction
            })
        });

        if (response.ok) {
            console.log('[虚拟GPS] ✓ 单点位置已上报', {
                plateNumber,
                projectId,
                point: normalizedPoint
            });
        } else {
            console.warn('[虚拟GPS] 单点位置上报失败:', response.status);
        }
    },

    calculateBearing(from, to) {
        const [lng1, lat1] = from;
        const [lng2, lat2] = to;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const lat1Rad = lat1 * Math.PI / 180;
        const lat2Rad = lat2 * Math.PI / 180;
        const y = Math.sin(dLng) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
        let brng = Math.atan2(y, x) * 180 / Math.PI;
        return (brng + 360) % 360;
    },

    stop() {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        this.isRunning = false;
        this.routeLabel = '';
        console.log('%c[虚拟GPS] ⏹️ 已停止', 'color: red; font-weight: bold');
    },

    setSpeed(speedKmh) {
        this.speed = speedKmh;
        console.log(`[虚拟GPS] 速度设置为 ${speedKmh} km/h`);
        if (this.isRunning && this.timerId) {
            clearInterval(this.timerId);
            this.timerId = setInterval(() => this.updatePosition(), this.calculateInterval());
        }
    },

    status() {
        console.log({
            运行中: this.isRunning,
            当前点: this.currentIndex,
            总点数: this.routePoints.length,
            速度: this.speed + ' km/h',
            进度: ((this.currentIndex / this.routePoints.length) * 100).toFixed(1) + '%'
        });
    }
};

window.VirtualGPS = VirtualGPS;
console.log('%c虚拟GPS已加载', 'color: blue; font-weight: bold');
console.log('使用：VirtualGPS.start() 开始, VirtualGPS.stop() 停止');
