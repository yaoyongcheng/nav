// 任务页面逻辑

// 检查登录状态
function checkLoginStatus() {
    const isLoggedIn = sessionStorage.getItem('isLoggedIn');
    const currentUser = sessionStorage.getItem('currentUser');

    if (!isLoggedIn || !currentUser) {
        // 未登录，跳转到登录页
        window.location.href = 'login.html';
        return false;
    }

    return true;
}

// 页面加载时检查登录
if (!checkLoginStatus()) {
    throw new Error('Unauthorized');
}

function initTaskPageLocationReporting() {
    if (typeof window.VehicleLocationReporter === 'undefined') {
        return;
    }

    try {
        window.VehicleLocationReporter.init();
        window.VehicleLocationReporter.refreshContext();
        window.VehicleLocationReporter.start();
        console.log('[任务页面] 已启动位置上报器');
    } catch (error) {
        console.warn('[任务页面] 启动位置上报器失败:', error);
    }
}

class TaskManager {
    constructor() {
        this.tasks = [];
        this.pendingNavigationTask = null;
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadTasks();
    }

    bindEvents() {
        // 底部导航切换
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const page = item.getAttribute('data-page');

                // 更新导航栏状态
                const navItems = document.querySelectorAll('.nav-item');
                navItems.forEach(nav => {
                    const img = nav.querySelector('.nav-icon-img');
                    const text = nav.querySelector('.nav-text');

                    if (nav === item) {
                        nav.classList.add('active');
                        img.src = img.getAttribute('data-active');
                        text.style.color = '#5BA8E3';
                    } else {
                        nav.classList.remove('active');
                        img.src = img.getAttribute('data-inactive');
                        text.style.color = '#666666';
                    }
                });

                // 页面跳转
                this.navigateTo(page);
            });
        });

        // 导航弹窗按钮
        document.getElementById('nav-dialog-confirm').addEventListener('click', () => {
            this.confirmNavigation();
        });

        document.getElementById('nav-dialog-cancel').addEventListener('click', () => {
            this.closeNavigationDialog();
        });

        // 点击遮罩层关闭弹窗
        document.querySelector('.nav-dialog-overlay').addEventListener('click', () => {
            this.closeNavigationDialog();
        });
    }

    /**
     * 加载任务列表
     * 读取扫码任务历史，并按扫码时间倒序显示
     */
    async loadTasks() {
        try {
            console.log('[任务页面] 开始加载扫码任务列表...');
            this.tasks = this.getScanTaskCardList();
            console.log('[任务页面] 扫码任务数:', this.tasks.length);

            if (this.tasks.length === 0) {
                this.showEmpty();
                return;
            }

            this.renderTasks();
        } catch (error) {
            console.error('[任务页面] 加载任务失败:', error);
            this.tasks = this.getScanTaskCardList();
            if (this.tasks.length > 0) {
                this.renderTasks();
                return;
            }
            this.showEmpty();
        }
    }

    normalizePlateNumber(plateNumber) {
        if (!plateNumber) return '';
        return String(plateNumber)
            .trim()
            .replace(/\s+/g, '')
            .toUpperCase();
    }

    normalizePhoneNumber(phone) {
        if (!phone) return '';
        return String(phone)
            .trim()
            .replace(/\D+/g, '');
    }

    buildScanTaskOwnerProfile(source) {
        const safeSource = source || {};
        const plateNumber = this.normalizePlateNumber(
            safeSource.plateNumber || safeSource.licensePlate || safeSource.ownerPlateNumber
        );
        const driverId = String(safeSource.driverId || safeSource.ownerDriverId || '').trim();
        const phone = this.normalizePhoneNumber(safeSource.phone || safeSource.ownerPhone);
        const driverName = String(safeSource.driverName || safeSource.username || '').trim();
        let ownerKey = String(safeSource.ownerKey || safeSource.driverKey || '').trim();

        if (!ownerKey) {
            if (plateNumber) {
                ownerKey = `plate:${plateNumber}`;
            } else if (driverId) {
                ownerKey = `driver:${driverId}`;
            } else if (phone) {
                ownerKey = `phone:${phone}`;
            } else if (driverName) {
                ownerKey = `name:${driverName}`;
            }
        }

        return {
            ownerKey,
            plateNumber,
            driverId,
            phone,
            driverName
        };
    }

    getDriverScopedScanTaskHistoryKey(ownerKey) {
        return ownerKey ? `scanTaskHistory:${ownerKey}` : '';
    }

    getActiveScanTaskOwner() {
        try {
            const currentTaskText = sessionStorage.getItem('currentTaskContext');
            if (currentTaskText) {
                const currentTask = JSON.parse(currentTaskText);
                const ownerProfile = this.buildScanTaskOwnerProfile(currentTask);
                if (ownerProfile.ownerKey || ownerProfile.plateNumber || ownerProfile.driverId || ownerProfile.phone) {
                    return ownerProfile;
                }
            }
        } catch (error) {
            console.warn('[任务页面] 读取当前任务司机标识失败:', error);
        }

        try {
            const vehicleInfo = JSON.parse(sessionStorage.getItem('vehicleInfo') || '{}');
            const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
            return this.buildScanTaskOwnerProfile({
                ownerKey: currentUser.driverKey || vehicleInfo.driverKey || '',
                plateNumber: vehicleInfo.licensePlate || currentUser.licensePlate || '',
                driverId: vehicleInfo.driverId || currentUser.driverId || '',
                phone: currentUser.phone || '',
                driverName: vehicleInfo.driverName || currentUser.username || ''
            });
        } catch (error) {
            console.warn('[任务页面] 读取登录态司机标识失败:', error);
            return this.buildScanTaskOwnerProfile({});
        }
    }

    isTaskOwnedByActiveDriver(task, activeOwner) {
        if (!task || !activeOwner) {
            return false;
        }

        const taskOwner = this.buildScanTaskOwnerProfile(task);
        if (activeOwner.ownerKey && taskOwner.ownerKey) {
            return activeOwner.ownerKey === taskOwner.ownerKey;
        }
        if (activeOwner.plateNumber && taskOwner.plateNumber) {
            return activeOwner.plateNumber === taskOwner.plateNumber;
        }
        if (activeOwner.driverId && taskOwner.driverId) {
            return activeOwner.driverId === taskOwner.driverId;
        }
        if (activeOwner.phone && taskOwner.phone) {
            return activeOwner.phone === taskOwner.phone;
        }
        if (activeOwner.driverName && taskOwner.driverName) {
            return activeOwner.driverName === taskOwner.driverName;
        }
        return false;
    }

    /**
     * 获取项目ID
     */
    getProjectId() {
        try {
            const projectSelection = sessionStorage.getItem('projectSelection');

            if (!projectSelection) {
                console.warn('[任务页面] 未找到projectSelection');
                return null;
            }

            const selection = JSON.parse(projectSelection);
            console.log('[任务页面] projectSelection完整数据:', selection);

            // 优先使用projectSelection中直接保存的projectCode
            if (selection.projectCode) {
                console.log('[任务页面] 从projectSelection获取projectCode:', selection.projectCode);
                return selection.projectCode;
            }

            // 如果projectSelection中没有projectCode，尝试从currentUser.projects中查找
            const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
            console.log('[任务页面] currentUser完整数据:', currentUser);

            const projectName = selection.project;
            console.log('[任务页面] 要查找的项目名称:', projectName);

            const userProjects = currentUser.projects || [];
            console.log('[任务页面] 用户项目列表:', userProjects);

            const selectedProject = userProjects.find(p => p.projectName === projectName);
            console.log('[任务页面] 找到的项目:', selectedProject);

            if (selectedProject) {
                const projectId = selectedProject.projectCode || selectedProject.id;
                console.log('[任务页面] 从currentUser.projects获取projectId:', projectId);
                return projectId;
            }

            console.warn('[任务页面] 无法获取项目ID');
            return null;
        } catch (error) {
            console.error('[任务页面] 获取项目ID失败:', error);
            return null;
        }
    }

    /**
     * 获取车牌号
     * 从多个位置尝试获取：vehicleInfo、projectSelection、currentUser
     */
    getPlateNumber() {
        try {
            // 1. 优先从 vehicleInfo 获取（登录时保存的车辆信息）
            const vehicleInfo = sessionStorage.getItem('vehicleInfo');
            if (vehicleInfo) {
                const vehicle = JSON.parse(vehicleInfo);
                if (vehicle.licensePlate) {
                    console.log('[任务页面] 从vehicleInfo获取车牌号:', vehicle.licensePlate);
                    return vehicle.licensePlate;
                }
            }

            // 2. 尝试从 projectSelection 获取
            const projectSelection = sessionStorage.getItem('projectSelection');
            if (projectSelection) {
                const selection = JSON.parse(projectSelection);
                if (selection.vehicle) {
                    console.log('[任务页面] 从projectSelection获取车牌号:', selection.vehicle);
                    return selection.vehicle;
                }
            }

            // 3. 最后尝试从 currentUser 获取
            const currentUser = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
            if (currentUser.licensePlate) {
                console.log('[任务页面] 从currentUser获取车牌号:', currentUser.licensePlate);
                return currentUser.licensePlate;
            }

            console.warn('[任务页面] 未在任何位置找到车牌号');
            return null;
        } catch (error) {
            console.error('[任务页面] 获取车牌号失败:', error);
            return null;
        }
    }

    /**
     * 获取项目下所有任务
     * 旧链路保留，当前任务页不再主动调用
     */
    async fetchProjectTasks(projectId) {
        try {
            const token = sessionStorage.getItem('authToken');
            const headers = {
                'accept': 'application/json'
            };

            if (token && token.trim() !== '') {
                headers['Authorization'] = `Bearer ${token}`;
                console.log('[任务页面] 使用token请求');
            }

            const url = `https://dmap.cscec3bxjy.cn/api/transport/tasks/project/${projectId}?page=1&page_size=1000`;
            console.log('[任务页面] 请求URL:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('[任务页面] 任务列表响应:', result);

            if (result.code === 200 && result.data) {
                return result.data.list || result.data || [];
            }

            return [];
        } catch (error) {
            console.error('[任务页面] 获取项目任务失败:', error);
            return [];
        }
    }

    /**
     * 获取任务详情
     * 旧链路保留，当前任务页不再主动调用
     */
    async fetchTaskDetail(taskId) {
        try {
            const token = sessionStorage.getItem('authToken');
            const headers = {
                'Content-Type': 'application/json'
            };

            // 只在token存在且不为空时才添加Authorization header
            if (token && token.trim() !== '') {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const url = `https://dmap.cscec3bxjy.cn/api/transport/tasks/${taskId}`;
            console.log('[任务页面] 请求任务详情（内网测试）:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: headers,
                credentials: 'omit'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            console.log('[任务页面] 任务详情响应:', result);
            console.log('[任务页面] ========== 任务详情完整数据 ==========');
            console.log(JSON.stringify(result.data, null, 2));
            console.log('[任务页面] ==========================================');

            if (result.code === 200 && result.data) {
                return result.data;
            }

            return null;
        } catch (error) {
            console.error('[任务页面] 获取任务详情失败:', taskId, error);
            return null;
        }
    }

    /**
     * 根据点位ID获取点位详细信息（使用首页的点位接口）
     * @param {number} pointId - 点位ID
     * @returns {Promise<Object|null>} 点位详细信息
     * 旧链路保留，当前任务页不再主动调用
     */
    async fetchPointDetail(pointId) {
        try {
            const token = sessionStorage.getItem('authToken');
            const headers = {
                'Content-Type': 'application/json'
            };

            // 只在token存在且不为空时才添加Authorization header
            if (token && token.trim() !== '') {
                headers['Authorization'] = `Bearer ${token}`;
            }

            // 使用首页的地图API点位查询接口（HTTPS可用）
            const url = `https://dmap.cscec3bxjy.cn/api/map/points/${pointId}`;
            console.log('[任务页面] 请求点位详情:', url);

            const response = await fetch(url, {
                method: 'GET',
                headers: headers,
                credentials: 'omit'
            });

            if (!response.ok) {
                console.warn('[任务页面] 点位详情请求失败:', response.status);
                return null;
            }

            const result = await response.json();
            console.log('[任务页面] 点位详情响应:', result);

            if (result.code === 200 && result.data) {
                return result.data;
            }

            return null;
        } catch (error) {
            console.error('[任务页面] 获取点位详情失败:', pointId, error);
            return null;
        }
    }


    /**
     * 转换API数据为前端格式
     */
    convertTaskData(apiData) {
        // 状态映射 (0=草稿, 1=已下发, 2=进行中, 3=已完成, 4=已取消)
        const statusMap = {
            0: '草稿',
            1: '已下发',
            2: '进行中',
            3: '已完成',
            4: '已取消'
        };

        // 状态对应的颜色 (0=草稿, 1=已下发, 2=进行中, 3=已完成, 4=已取消)
        const colorMap = {
            0: 'gray',   // 草稿
            1: 'blue',   // 已下发
            2: 'green',  // 进行中
            3: 'gray',   // 已完成
            4: 'gray'    // 已取消
        };

        const status = statusMap[apiData.status] || '未知';
        const color = colorMap[apiData.status] || 'blue';

        // 默认值
        let startLocationName = '起点';
        let endLocationName = '终点';
        let startLongitude = 118.796877;
        let startLatitude = 32.060255;
        let endLongitude = 118.806877;
        let endLatitude = 32.070255;

        // 使用起点信息（从start_point ID查询得到）
        if (apiData.startPointInfo) {
            const point = apiData.startPointInfo;
            startLocationName = point.name || point.point_name || '起点';
            startLongitude = point.longitude || point.lng || startLongitude;
            startLatitude = point.latitude || point.lat || startLatitude;

            console.log('[任务页面] 使用起点信息:', {
                name: startLocationName,
                longitude: startLongitude,
                latitude: startLatitude
            });
        } else {
            console.warn('[任务页面] 未获取到起点信息，使用默认坐标');
        }

        // 使用终点信息（从end_point ID查询得到）
        if (apiData.endPointInfo) {
            const point = apiData.endPointInfo;
            endLocationName = point.name || point.point_name || '终点';
            endLongitude = point.longitude || point.lng || endLongitude;
            endLatitude = point.latitude || point.lat || endLatitude;

            console.log('[任务页面] 使用终点信息:', {
                name: endLocationName,
                longitude: endLongitude,
                latitude: endLatitude
            });
        } else {
            console.warn('[任务页面] 未获取到终点信息，使用默认坐标');
        }

        return {
            id: apiData.id,
            name: apiData.task_name || '未命名任务',
            type: apiData.task_name || '运输任务',
            description: apiData.task_detail || '暂无任务详情',
            startPoint: {
                name: startLocationName,
                date: this.formatDate(apiData.entry_start_time),
                time: this.formatTimeRange(apiData.entry_start_time, apiData.entry_end_time),
                location: [startLongitude, startLatitude]
            },
            endPoint: {
                name: endLocationName,
                date: this.formatDate(apiData.exit_start_time),
                time: this.formatTimeRange(apiData.exit_start_time, apiData.exit_end_time),
                location: [endLongitude, endLatitude]
            },
            status: status,
            color: color
        };
    }

    getScanTaskCardData() {
        try {
            const taskContextText = sessionStorage.getItem('currentTaskContext');
            if (!taskContextText || !window.TaskCardRenderer || typeof window.TaskCardRenderer.buildTaskCardDataFromScanContext !== 'function') {
                return null;
            }

            const taskContext = JSON.parse(taskContextText);
            return window.TaskCardRenderer.buildTaskCardDataFromScanContext(taskContext, {
                displayIndex: 1
            });
        } catch (error) {
            console.warn('[任务页面] 读取扫码任务上下文失败:', error);
            return null;
        }
    }

    getScanTaskCardList() {
        try {
            const renderer = window.TaskCardRenderer;
            if (!renderer || typeof renderer.buildTaskCardDataFromScanContext !== 'function') {
                return [];
            }

            const history = this.readScanTaskHistory();
            return history
                .map((taskContext, index) => renderer.buildTaskCardDataFromScanContext(taskContext, {
                    displayIndex: index + 1
                }))
                .filter(Boolean);
        } catch (error) {
            console.warn('[任务页面] 构建扫码任务列表失败:', error);
            return [];
        }
    }

    readScanTaskHistory() {
        const uniqueTaskMap = new Map();
        const activeOwner = this.getActiveScanTaskOwner();

        try {
            const currentTaskText = sessionStorage.getItem('currentTaskContext');
            if (currentTaskText) {
                const currentTask = JSON.parse(currentTaskText);
                if (currentTask && currentTask.taskId) {
                    uniqueTaskMap.set(String(currentTask.taskId), {
                        ...currentTask,
                        scannedAt: currentTask.scannedAt || sessionStorage.getItem('loginTime') || new Date().toISOString()
                    });
                }
            }
        } catch (error) {
            console.warn('[任务页面] 读取当前扫码任务失败:', error);
        }

        const scopedStorageKey = this.getDriverScopedScanTaskHistoryKey(activeOwner.ownerKey);
        [window.localStorage, window.sessionStorage].forEach((storage) => {
            try {
                if (!storage || !scopedStorageKey) {
                    return;
                }

                const historyText = storage.getItem(scopedStorageKey);
                const historyList = JSON.parse(historyText || '[]');
                if (Array.isArray(historyList)) {
                    historyList.forEach(task => {
                        if (task && task.taskId) {
                            uniqueTaskMap.set(String(task.taskId), task);
                        }
                    });
                }
            } catch (error) {
                console.warn('[任务页面] 读取司机隔离扫码任务历史失败:', error);
            }
        });

        [window.localStorage, window.sessionStorage].forEach((storage) => {
            try {
                const historyText = storage ? storage.getItem('scanTaskHistory') : '';
                const historyList = JSON.parse(historyText || '[]');
                if (Array.isArray(historyList)) {
                    historyList.forEach(task => {
                        if (task && task.taskId && this.isTaskOwnedByActiveDriver(task, activeOwner)) {
                            uniqueTaskMap.set(String(task.taskId), task);
                        }
                    });
                }
            } catch (error) {
                console.warn('[任务页面] 读取扫码任务历史失败:', error);
            }
        });

        return Array.from(uniqueTaskMap.values()).sort((left, right) => {
            const leftTime = new Date(left && left.scannedAt ? left.scannedAt : 0).getTime();
            const rightTime = new Date(right && right.scannedAt ? right.scannedAt : 0).getTime();
            return rightTime - leftTime;
        });
    }

    mergeScanTaskIntoTasks(tasks) {
        const scanTaskList = this.getScanTaskCardList();
        if (!Array.isArray(tasks) || tasks.length === 0) {
            return scanTaskList;
        }

        const merged = [...scanTaskList];
        tasks.forEach(task => {
            if (!merged.some(item => String(item && item.id) === String(task && task.id))) {
                merged.push(task);
            }
        });
        return merged;
    }

    /**
     * 格式化日期
     * @param {string} dateTimeStr - ISO格式的日期时间字符串
     * @returns {string} 格式化后的日期，如 "9月26日"
     */
    formatDate(dateTimeStr) {
        if (!dateTimeStr) return '-';

        try {
            const date = new Date(dateTimeStr);
            const month = date.getMonth() + 1;
            const day = date.getDate();
            return `${month}月${day}日`;
        } catch (e) {
            return '-';
        }
    }

    /**
     * 格式化时间范围
     * @param {string} startTime - 开始时间
     * @param {string} endTime - 结束时间
     * @returns {string} 格式化后的时间范围，如 "15:30 - 16:30"
     */
    formatTimeRange(startTime, endTime) {
        if (!startTime || !endTime) return '-';

        try {
            const start = new Date(startTime);
            const end = new Date(endTime);

            const startStr = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
            const endStr = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;

            return `${startStr} - ${endStr}`;
        } catch (e) {
            return '-';
        }
    }

    /**
     * 渲染任务列表
     */
    renderTasks() {
        const taskList = document.getElementById('task-list');
        const taskEmpty = document.getElementById('task-empty');

        if (!this.tasks || this.tasks.length === 0) {
            this.showEmpty();
            return;
        }

        taskEmpty.style.display = 'none';
        taskList.style.display = '';
        taskList.innerHTML = '';

        this.tasks.forEach(task => {
            const taskCard = this.createTaskCard(task);
            taskList.appendChild(taskCard);
        });
    }

    /**
     * 创建任务卡片
     *
     * 显示字段说明 (所有字段均由后端提供):
     *
     * 【卡片头部】
     * - task.name: 任务名称 (卡片顶部,大号字体)
     * - task.type: 任务类型 (任务名称下方,蓝色字体)
     *
     * 【展开区域】
     * - task.description: 任务详情 (展开后显示的完整描述文本)
     *
     * 【时间轴区域】
     * - task.startPoint.name: 起点地点名称
     * - task.startPoint.date: 起点日期
     * - task.startPoint.time: 起点时间段
     * - task.status: 任务状态 (时间轴中间的绿色徽章)
     * - task.endPoint.name: 终点地点名称
     * - task.endPoint.date: 终点日期
     * - task.endPoint.time: 终点时间段
     *
     * 【卡片颜色】
     * - task.color: 'green' = 正在进行的任务 (头部浅绿色背景)
     * - task.color: 'pink' = 时间紧急的任务 (头部浅红色背景)
     * - task.color: 'blue' = 其他状态任务 (头部白色背景)
     */
    createTaskCard(task) {
        if (window.TaskCardRenderer && typeof window.TaskCardRenderer.createTaskCard === 'function') {
            return window.TaskCardRenderer.createTaskCard(task, {
                onNavigate: (cardTask) => this.showNavigationDialog(cardTask)
            });
        }

        const card = document.createElement('div');
        card.textContent = task && task.name ? task.name : '任务';
        return card;
    }

    /**
     * 将状态文本映射为样式类 (0=草稿, 1=已下发, 2=进行中, 3=已完成, 4=已取消)
     */
    getStatusClass(statusText) {
        const t = (statusText || '').trim();
        if (t === '草稿') return 'status-draft';
        if (t === '已下发') return 'status-assigned';
        if (t === '进行中') return 'status-in-progress';
        if (t === '已完成') return 'status-completed';
        if (t === '已取消') return 'status-cancelled';
        return 'status-assigned'; // 默认为已下发
    }

    /**
     * 切换任务详情展开/收起
     */
    toggleTaskDetail(headerElement) {
        const card = headerElement.closest('.task-card');
        const content = card.querySelector('.task-detail-content');
        const toggle = card.querySelector('.task-detail-toggle');

        content.classList.toggle('expanded');
        toggle.classList.toggle('expanded');
    }

    /**
     * 显示导航确认弹窗
     */
    showNavigationDialog(task) {
        const dialog = document.getElementById('nav-confirm-dialog');
        const projectEl = document.getElementById('nav-dialog-project');
        const locationEl = document.getElementById('nav-dialog-location');

        // 获取项目名称（上方浅色小字）
        let projectName = '项目名称';
        try {
            const projectSelection = sessionStorage.getItem('projectSelection');
            if (projectSelection) {
                const selection = JSON.parse(projectSelection);
                projectName = selection.project || '项目名称';
            }
        } catch (error) {
            console.error('[导航弹窗] 获取项目名称失败:', error);
        }

        // 设置目的地信息
        projectEl.textContent = projectName;
        locationEl.textContent = (task.endPoint && task.endPoint.name) || '任务终点';
        this.pendingNavigationTask = task || null;

        // 保存任务信息供确认时使用
        dialog.dataset.taskId = task.id;

        // 起点信息
        if (task.startPoint && Array.isArray(task.startPoint.location)) {
            dialog.dataset.startLat = task.startPoint.location[1];
            dialog.dataset.startLng = task.startPoint.location[0];
            dialog.dataset.startName = task.startPoint.name || '';
        } else {
            dialog.dataset.startLat = '';
            dialog.dataset.startLng = '';
            dialog.dataset.startName = '';
        }

        // 终点信息
        dialog.dataset.endLat = task.endPoint && Array.isArray(task.endPoint.location) ? task.endPoint.location[1] : '';
        dialog.dataset.endLng = task.endPoint && Array.isArray(task.endPoint.location) ? task.endPoint.location[0] : '';
        dialog.dataset.endName = (task.endPoint && task.endPoint.name) || '';

        dialog.classList.add('show');
    }

    /**
     * 关闭导航确认弹窗
     */
    closeNavigationDialog() {
        const dialog = document.getElementById('nav-confirm-dialog');
        dialog.classList.remove('show');
    }

    /**
     * 确认导航
     */
    async confirmNavigation() {
        const dialog = document.getElementById('nav-confirm-dialog');
        const taskId = dialog.dataset.taskId;
        let pendingTask = this.pendingNavigationTask;

        this.closeNavigationDialog();
        this.pendingNavigationTask = null;

        if (!pendingTask) {
            console.warn('[任务导航] 未找到待导航任务，取消导航');
            return;
        }

        console.log('[任务导航] 跳转到导航页面，出发地: 我的位置，目的地:', pendingTask.endPoint && pendingTask.endPoint.name);

        try {
            if (window.ScanTaskService && typeof window.ScanTaskService.enrichTaskContext === 'function') {
                pendingTask = await window.ScanTaskService.enrichTaskContext(pendingTask);
            }

            const navigationRoute = window.TaskCardRenderer &&
                typeof window.TaskCardRenderer.buildTaskNavigationRoute === 'function'
                ? window.TaskCardRenderer.buildTaskNavigationRoute(pendingTask)
                : null;

            if (!navigationRoute) {
                throw new Error('未找到任务导航构造函数');
            }

            sessionStorage.setItem('navigationRoute', JSON.stringify(navigationRoute));
            console.log('[任务导航] 导航数据已按统一逻辑写入 sessionStorage');

            sessionStorage.setItem('currentTaskId', taskId);
            sessionStorage.setItem('navigationReferrer', 'index.html');
        } catch (e) {
            console.warn('[任务导航] 保存导航数据失败:', e);
            return;
        }

        window.location.href = 'navigation.html';
    }

    /**
     * 显示空状态
     */
    showEmpty() {
        const taskList = document.getElementById('task-list');
        const taskEmpty = document.getElementById('task-empty');

        taskList.style.display = 'none';
        taskEmpty.style.display = 'flex';
    }

    /**
     * 页面导航
     */
    navigateTo(page) {
        switch(page) {
            case 'index':
                window.location.href = 'index.html';
                break;
            case 'task':
                // 当前页面，不需要跳转
                break;
            case 'profile':
                window.location.href = 'profile.html';
                break;
        }
    }

    /**
     * 刷新任务列表
     * 提供给外部调用的方法
     */
    async refresh() {
        await this.loadTasks();
    }
}

// 初始化任务管理器
initTaskPageLocationReporting();
const taskManager = new TaskManager();

// 暴露到全局，方便调试和外部调用
window.taskManager = taskManager;
