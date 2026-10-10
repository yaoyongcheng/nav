/**
 * 管理端消息管理模块
 * 功能：存储、读取、标记已读以及筛选各类报警消息
 */

const AdminMessageManager = (function() {
    'use strict';

    // 消息存储键
    const STORAGE_KEY = 'admin_messages';
    const MAX_MESSAGES = 100; // 最多保存100条消息

    // 消息类型
    const MESSAGE_TYPES = {
        FENCE_ENTER_PROHIBIT: 'fence_enter_prohibit',  // 进入禁行区
        FENCE_LEAVE_SITE: 'fence_leave_site',          // 离开工地范围
        ROUTE_DEVIATION: 'route_deviation',            // 场外偏离路线
        ROAD_STATUS: 'road_status'                     // 路况变化
    };
    const DEDUPE_WINDOW_MS = 15000;
    const FILTER_TYPES = {
        ALL: 'all',
        ROAD: MESSAGE_TYPES.ROAD_STATUS,
        PROHIBIT: MESSAGE_TYPES.FENCE_ENTER_PROHIBIT,
        LEAVE_SITE: MESSAGE_TYPES.FENCE_LEAVE_SITE,
        ROUTE: MESSAGE_TYPES.ROUTE_DEVIATION
    };
    const MESSAGE_STATUS = {
        ACTIVE: 'active',
        UPDATED: 'updated',
        CLEARED: 'cleared'
    };

    /**
     * 获取所有消息
     * @returns {Array}
     */
    function getMessages() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.error('[消息管理器] 读取消息失败:', error);
            return [];
        }
    }

    /**
     * 保存消息列表
     * @param {Array} messages
     */
    function saveMessages(messages) {
        try {
            // 限制消息数量
            if (messages.length > MAX_MESSAGES) {
                messages = messages.slice(0, MAX_MESSAGES);
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
        } catch (error) {
            console.error('[消息管理器] 保存消息失败:', error);
        }
    }

    function normalizeTimestamp(value) {
        if (!value) {
            return new Date().toISOString();
        }

        if (value instanceof Date) {
            return value.toISOString();
        }

        const parsed = new Date(value);
        if (!isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }

        return new Date().toISOString();
    }

    function normalizeNumber(value) {
        if (value === undefined || value === null || value === '') {
            return null;
        }

        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function resolveProjectName(projectId) {
        if (!projectId) return '-';
        try {
            const currentUserStr = sessionStorage.getItem('currentUser');
            if (currentUserStr) {
                const currentUser = JSON.parse(currentUserStr);
                const projects = currentUser.projects || [];
                const project = projects.find(p => String(p.projectId) === String(projectId) || String(p.projectCode) === String(projectId));
                if (project && project.projectName) {
                    return project.projectName;
                }
            }
        } catch (error) {
            console.warn('[消息管理器] 解析项目名称失败:', error);
        }
        return projectId;
    }

    function resolveVehicleLabel(message) {
        return message.plateNumber || message.vehicleId || message.cameraId || '未知对象';
    }

    function normalizeEvaluation(evaluation) {
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

        return mapping[evaluation] || String(evaluation || '未知');
    }

    function buildDedupeKey(message) {
        switch (message.type) {
            case MESSAGE_TYPES.ROAD_STATUS:
                return [
                    message.type,
                    message.projectId || '',
                    message.cameraId || '',
                    message.evaluation || ''
                ].join('|');
            case MESSAGE_TYPES.FENCE_ENTER_PROHIBIT:
                return [
                    message.type,
                    message.plateNumber || message.vehicleId || '',
                    message.fenceId || message.fenceName || message.matchedRestrictedId || ''
                ].join('|');
            case MESSAGE_TYPES.FENCE_LEAVE_SITE:
                return [
                    message.type,
                    message.plateNumber || message.vehicleId || '',
                    message.fenceId || message.fenceName || message.matchedFenceId || ''
                ].join('|');
            case MESSAGE_TYPES.ROUTE_DEVIATION:
                return [
                    message.type,
                    message.plateNumber || message.vehicleId || '',
                    message.polylineId || message.lineName || 'default'
                ].join('|');
            default:
                return [
                    message.type || 'unknown',
                    message.vehicleId || '',
                    message.fenceId || '',
                    message.alarmType || ''
                ].join('|');
        }
    }

    function createMessageRecord(message) {
        const timestamp = normalizeTimestamp(message.timestamp || message.alarmTime || message.timeStr || message.time_str);
        const record = {
            id: generateId(),
            type: message.type,
            title: message.title,
            content: message.content,
            category: message.category || 'all',
            projectId: message.projectId || '',
            projectName: message.projectName || '',
            vehicleId: message.vehicleId || '',
            plateNumber: message.plateNumber || message.vehicleId || '',
            deviceId: message.deviceId || '',
            sourceId: message.sourceId || '',
            cameraId: message.cameraId || '',
            evaluation: message.evaluation || '',
            fenceId: message.fenceId || '',
            fenceName: message.fenceName || '',
            alarmType: message.alarmType || '',
            matchedFenceId: message.matchedFenceId || '',
            matchedRestrictedId: message.matchedRestrictedId || '',
            taskId: message.taskId || null,
            taskScope: message.taskScope !== undefined ? message.taskScope : null,
            polylineId: message.polylineId || null,
            lineName: message.lineName || '',
            description: message.description || '',
            latitude: normalizeNumber(message.latitude),
            longitude: normalizeNumber(message.longitude),
            timestamp,
            read: false,
            messageStatus: message.messageStatus || MESSAGE_STATUS.ACTIVE,
            sourceType: message.sourceType || '',
            eventId: message.eventId || '',
            eventType: message.eventType || '',
            updateCount: Number(message.updateCount || 0),
            raw: message.raw || null
        };

        record.dedupeKey = buildDedupeKey(record);
        return record;
    }

    function findRecentDuplicateIndex(messages, newMessage) {
        const newTime = new Date(newMessage.timestamp).getTime();
        return messages.findIndex(message => {
            if (message.dedupeKey !== newMessage.dedupeKey) {
                return false;
            }

            const oldTime = new Date(message.timestamp).getTime();
            if (!Number.isFinite(oldTime) || !Number.isFinite(newTime)) {
                return false;
            }

            return Math.abs(newTime - oldTime) <= DEDUPE_WINDOW_MS;
        });
    }

    /**
     * 添加新消息
     * @param {Object} message - 消息对象
     */
    function addMessage(message) {
        const messages = getMessages();
        const newMessage = createMessageRecord(message);

        const duplicateIndex = findRecentDuplicateIndex(messages, newMessage);
        if (duplicateIndex >= 0) {
            messages.splice(duplicateIndex, 1);
        }

        // 添加到列表开头（最新的在前面）
        messages.unshift(newMessage);
        saveMessages(messages);

        console.log('[消息管理器] 新消息已添加:', newMessage);

        // 触发消息更新事件
        dispatchMessageEvent();

        return newMessage;
    }

    function upsertMessageByEvent(message) {
        const messages = getMessages();
        const newMessage = createMessageRecord(message);
        const existingIndex = findEventMessageIndex(messages, newMessage);
        const isClearUpdate = newMessage.messageStatus === MESSAGE_STATUS.CLEARED;
        const isContentOnlyUpdate = newMessage.eventType === 'restricted_warning_update';

        if (existingIndex >= 0) {
            const existing = messages[existingIndex];
            
            // 如果是 ROAD_STATUS 消息且状态未发生变化，则不重复更新
            if (newMessage.type === MESSAGE_TYPES.ROAD_STATUS && existing.evaluation === newMessage.evaluation) {
                return existing;
            }

            const mergedMessage = {
                ...existing,
                ...newMessage,
                id: existing.id,
                // 同一事件出现新的推送或状态覆盖时，重新标记为未读，要求用户再次确认。
                read: false,
                updateCount: (existing.updateCount || 0) + 1
            };

            if (isContentOnlyUpdate) {
                mergedMessage.title = existing.title;
                mergedMessage.messageStatus = existing.messageStatus || MESSAGE_STATUS.ACTIVE;
            }

            if (isClearUpdate) {
                mergedMessage.title = existing.title;
                mergedMessage.content = existing.content;
            }

            messages.splice(existingIndex, 1);
            messages.unshift(mergedMessage);
            saveMessages(messages);
            dispatchMessageEvent();
            return mergedMessage;
        }

        if (isClearUpdate) {
            return null;
        }

        messages.unshift(newMessage);
        saveMessages(messages);
        dispatchMessageEvent();
        return newMessage;
    }

    function isSameVehicleMessage(left, right) {
        const leftKeys = [left.vehicleId, left.plateNumber, left.deviceId, left.sourceId].filter(Boolean).map(String);
        const rightKeys = [right.vehicleId, right.plateNumber, right.deviceId, right.sourceId].filter(Boolean).map(String);
        return leftKeys.some(key => rightKeys.includes(key));
    }

    function findEventMessageIndex(messages, newMessage) {
        const eventId = newMessage.eventId;
        const exactIndex = eventId ? messages.findIndex(item => item.eventId === eventId) : -1;
        if (exactIndex >= 0) {
            return exactIndex;
        }

        return messages.findIndex(item => {
            if (item.type !== newMessage.type) {
                return false;
            }
            if ((item.projectId || '') !== (newMessage.projectId || '')) {
                return false;
            }
            
            // 针对 ROAD_STATUS 消息，它没有 vehicle 信息，而是绑定 cameraId
            if (newMessage.type === MESSAGE_TYPES.ROAD_STATUS) {
                return String(item.cameraId || '') === String(newMessage.cameraId || '');
            }

            // 对于其他包含车辆类型的消息，必须属于同一辆车
            if (!isSameVehicleMessage(item, newMessage)) {
                return false;
            }

            if (newMessage.type === MESSAGE_TYPES.FENCE_ENTER_PROHIBIT) {
                return (newMessage.fenceId && item.fenceId === newMessage.fenceId) ||
                    (newMessage.matchedRestrictedId && item.matchedRestrictedId === newMessage.matchedRestrictedId) ||
                    (newMessage.fenceName && item.fenceName === newMessage.fenceName);
            }

            if (newMessage.type === MESSAGE_TYPES.FENCE_LEAVE_SITE) {
                return String(item.taskId || 'default') === String(newMessage.taskId || 'default');
            }

            if (newMessage.type === MESSAGE_TYPES.ROUTE_DEVIATION) {
                return String(item.polylineId || item.lineName || 'default') ===
                    String(newMessage.polylineId || newMessage.lineName || 'default');
            }

            return false;
        });
    }

    function mapAlarmEventToMessage(event) {
        if (!event) return null;

        let type = '';
        let title = '';
        let content = '';
        let category = 'all';

        switch (event.eventType) {
            case 'restricted_enter':
                type = MESSAGE_TYPES.FENCE_ENTER_PROHIBIT;
                title = '禁停区警告';
                content = `车辆 ${resolveVehicleLabel(event)} 已进入禁停区「${event.fenceName || '围栏区域'}」，请及时处理！`;
                category = 'fence';
                break;
            case 'restricted_warning_update':
                type = MESSAGE_TYPES.FENCE_ENTER_PROHIBIT;
                title = '禁停区警告';
                content = `车辆 ${resolveVehicleLabel(event)} 仍停留在禁停区「${event.fenceName || '围栏区域'}」，请尽快处理！`;
                category = 'fence';
                break;
            case 'restricted_exit_clear':
                type = MESSAGE_TYPES.FENCE_ENTER_PROHIBIT;
                title = '禁停区警告';
                content = `车辆 ${resolveVehicleLabel(event)} 已进入禁停区「${event.fenceName || '围栏区域'}」，请及时处理！`;
                category = 'fence';
                break;
            case 'fixed_exit_alarm':
                type = MESSAGE_TYPES.FENCE_LEAVE_SITE;
                title = '违规出场警告';
                content = `固定车辆 ${resolveVehicleLabel(event)} 已离开工地范围「${event.fenceName || '工地区域'}」，请及时处理！`;
                category = 'fence';
                break;
            case 'fixed_exit_clear':
                type = MESSAGE_TYPES.FENCE_LEAVE_SITE;
                title = '违规出场警告';
                content = `固定车辆 ${resolveVehicleLabel(event)} 已离开工地范围「${event.fenceName || '工地区域'}」，请及时处理！`;
                category = 'fence';
                break;
            case 'route_deviation_alarm':
                type = MESSAGE_TYPES.ROUTE_DEVIATION;
                title = '偏离路线警告';
                content = `固定车辆 ${resolveVehicleLabel(event)} 已偏离规定路线，请及时处理！`;
                category = 'route';
                break;
            case 'road_status_changed':
                type = MESSAGE_TYPES.ROAD_STATUS;
                title = '道路状态变化警告';
                content = `项目 ${resolveProjectName(event.projectId)} 摄像头 ${event.cameraId || '-'} 上报路况变更：${normalizeEvaluation(event.evaluation)}`;
                category = 'road';
                break;
            default:
                return null;
        }

        return {
            type,
            category,
            title,
            content,
            projectId: event.projectId,
            projectName: resolveProjectName(event.projectId),
            vehicleId: event.vehicleId,
            plateNumber: event.plateNumber,
            deviceId: event.deviceId,
            sourceId: event.sourceId,
            cameraId: event.cameraId,
            evaluation: normalizeEvaluation(event.evaluation),
            fenceId: event.fenceId,
            fenceName: event.fenceName,
            alarmType: event.alarmType,
            matchedFenceId: event.matchedFenceId,
            matchedRestrictedId: event.matchedRestrictedId,
            taskId: event.taskId,
            taskScope: event.taskScope,
            polylineId: event.polylineId,
            lineName: event.lineName,
            description: event.description,
            latitude: event.latitude,
            longitude: event.longitude,
            timestamp: event.eventTime,
            messageStatus: event.eventStatus || MESSAGE_STATUS.ACTIVE,
            sourceType: event.sourceType || '',
            eventId: event.eventId || '',
            eventType: event.eventType || '',
            raw: event.raw
        };
    }

    function handleAlarmEvent(event) {
        const message = mapAlarmEventToMessage(event);
        if (!message) {
            return null;
        }
        return upsertMessageByEvent(message);
    }

    /**
     * 添加围栏报警消息
     * @param {string} vehicleId - 车辆ID
     * @param {string} fenceId - 围栏ID
     * @param {string} fenceName - 围栏名称
     * @param {string} fenceType - 围栏类型
     * @param {string} eventType - 事件类型 enter/leave
     * @param {number} latitude - 纬度
     * @param {number} longitude - 经度
     */
    function addFenceAlertMessage(vehicleId, fenceId, fenceName, fenceType, eventType, latitude, longitude) {
        let payload = null;
        if (typeof vehicleId === 'object' && vehicleId !== null) {
            payload = { ...vehicleId };
        } else {
            payload = {
                vehicleId,
                plateNumber: vehicleId,
                fenceId,
                fenceName,
                fenceType,
                eventType,
                latitude,
                longitude
            };
        }

        let type, title, content;
        const normalizedFenceType = payload.fenceType;
        const normalizedEventType = payload.eventType;
        const vehicleLabel = resolveVehicleLabel(payload);
        const resolvedFenceName = payload.fenceName || '围栏区域';

        if (normalizedFenceType === 'prohibit' && normalizedEventType === 'enter') {
            type = MESSAGE_TYPES.FENCE_ENTER_PROHIBIT;
            title = '禁停区警告';
            content = `车辆 ${vehicleLabel} 已进入禁停区「${resolvedFenceName}」，请及时处理！`;
        } else if (normalizedFenceType === 'fence' && normalizedEventType === 'leave') {
            type = MESSAGE_TYPES.FENCE_LEAVE_SITE;
            title = '违规出场警告';
            content = `固定车辆 ${vehicleLabel} 已离开工地范围「${resolvedFenceName}」，请及时处理！`;
        } else {
            // 其他类型暂不处理
            return null;
        }

        return addMessage({
            type,
            category: 'fence',
            title,
            content,
            projectId: payload.projectId,
            vehicleId: payload.vehicleId || vehicleLabel,
            plateNumber: payload.plateNumber || vehicleLabel,
            deviceId: payload.deviceId,
            sourceId: payload.sourceId,
            fenceId: payload.fenceId,
            fenceName: resolvedFenceName,
            alarmType: payload.alarmType,
            matchedFenceId: payload.matchedFenceId,
            matchedRestrictedId: payload.matchedRestrictedId,
            taskId: payload.taskId,
            taskScope: payload.taskScope,
            polylineId: payload.polylineId,
            lineName: payload.lineName,
            description: payload.description,
            latitude: payload.latitude,
            longitude: payload.longitude,
            timestamp: payload.timestamp,
            raw: payload.raw
        });
    }

    function addRouteDeviationMessage(vehicleId, latitude, longitude) {
        let payload = null;
        if (typeof vehicleId === 'object' && vehicleId !== null) {
            payload = { ...vehicleId };
        } else {
            payload = {
                vehicleId,
                plateNumber: vehicleId,
                latitude,
                longitude
            };
        }

        const vehicleLabel = resolveVehicleLabel(payload);
        return addMessage({
            type: MESSAGE_TYPES.ROUTE_DEVIATION,
            category: 'route',
            title: '偏离路线警告',
            content: `固定车辆 ${vehicleLabel} 已偏离规定路线，请及时处理！`,
            projectId: payload.projectId,
            vehicleId: payload.vehicleId || vehicleLabel,
            plateNumber: payload.plateNumber || vehicleLabel,
            deviceId: payload.deviceId,
            sourceId: payload.sourceId,
            taskId: payload.taskId,
            taskScope: payload.taskScope,
            polylineId: payload.polylineId,
            lineName: payload.lineName,
            description: payload.description,
            latitude: payload.latitude,
            longitude: payload.longitude,
            timestamp: payload.timestamp,
            raw: payload.raw
        });
    }

    function addRoadStatusMessage(projectId, cameraId, evaluation) {
        let payload = null;
        if (typeof projectId === 'object' && projectId !== null) {
            payload = { ...projectId };
        } else {
            payload = { projectId, cameraId, evaluation };
        }

        const readableEvaluation = normalizeEvaluation(payload.evaluation);
        return addMessage({
            type: MESSAGE_TYPES.ROAD_STATUS,
            category: 'road',
            title: '道路状态变化警告',
            content: `项目 ${resolveProjectName(payload.projectId)} 摄像头 ${payload.cameraId || '-'} 上报路况变更：${readableEvaluation}`,
            projectId: payload.projectId,
            projectName: resolveProjectName(payload.projectId),
            cameraId: payload.cameraId,
            evaluation: readableEvaluation,
            vehicleId: payload.cameraId,
            timestamp: payload.timestamp,
            raw: payload.raw
        });
    }

    function getFilteredMessages(filterType) {
        const messages = getMessages();
        if (!filterType || filterType === FILTER_TYPES.ALL) {
            return messages;
        }
        return messages.filter(message => message.type === filterType);
    }

    function getMessageStats(sourceMessages) {
        const messages = Array.isArray(sourceMessages) ? sourceMessages : getMessages();
        const stats = {
            total: messages.length,
            unread: 0,
            road_status: 0,
            fence_enter_prohibit: 0,
            fence_leave_site: 0,
            route_deviation: 0
        };

        messages.forEach(message => {
            if (!message.read) {
                stats.unread++;
            }
            if (stats[message.type] !== undefined) {
                stats[message.type]++;
            }
        });

        return stats;
    }

    function getMessageMeta(type) {
        switch (type) {
            case MESSAGE_TYPES.FENCE_ENTER_PROHIBIT:
                return {
                    label: '禁停区',
                    iconClass: 'alert-red',
                    iconName: 'triangle-exclamation'
                };
            case MESSAGE_TYPES.FENCE_LEAVE_SITE:
                return {
                    label: '违规出厂',
                    iconClass: 'alert-orange',
                    iconName: 'truck'
                };
            case MESSAGE_TYPES.ROUTE_DEVIATION:
                return {
                    label: '偏离路线',
                    iconClass: 'alert-orange',
                    iconName: 'route'
                };
            case MESSAGE_TYPES.ROAD_STATUS:
                return {
                    label: '道路状态',
                    iconClass: 'alert-blue',
                    iconName: 'road'
                };
            default:
                return {
                    label: '消息',
                    iconClass: 'alert-blue',
                    iconName: 'circle-info'
                };
        }
    }

    /**
     * 获取未读消息数量
     * @returns {number}
     */
    function getUnreadCount() {
        const messages = getMessages();
        return messages.filter(m => !m.read).length;
    }

    /**
     * 标记消息为已读
     * @param {string} messageId - 消息ID
     */
    function markAsRead(messageId) {
        const messages = getMessages();
        const message = messages.find(m => m.id === messageId);
        if (message) {
            message.read = true;
            saveMessages(messages);
            dispatchMessageEvent();
        }
    }

    /**
     * 标记所有消息为已读
     */
    function markAllAsRead() {
        const messages = getMessages();
        messages.forEach(m => m.read = true);
        saveMessages(messages);
        dispatchMessageEvent();
    }

    /**
     * 删除消息
     * @param {string} messageId - 消息ID
     */
    function deleteMessage(messageId) {
        let messages = getMessages();
        messages = messages.filter(m => m.id !== messageId);
        saveMessages(messages);
        dispatchMessageEvent();
    }

    /**
     * 清空所有消息
     */
    function clearAllMessages() {
        saveMessages([]);
        dispatchMessageEvent();
    }

    /**
     * 生成唯一ID
     */
    function generateId() {
        return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * 触发消息更新事件
     */
    function dispatchMessageEvent() {
        const event = new CustomEvent('messageUpdated', {
            detail: {
                unreadCount: getUnreadCount(),
                totalCount: getMessages().length
            }
        });
        window.dispatchEvent(event);
    }

    /**
     * 格式化时间显示
     * @param {string} isoString - ISO时间字符串
     * @returns {string}
     */
    function formatTime(isoString) {
        const date = new Date(isoString);
        const now = new Date();
        const diff = now - date;

        // 1分钟内
        if (diff < 60 * 1000) {
            return '刚刚';
        }
        // 1小时内
        if (diff < 60 * 60 * 1000) {
            return Math.floor(diff / (60 * 1000)) + '分钟前';
        }
        // 今天
        if (date.toDateString() === now.toDateString()) {
            return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        }
        // 昨天
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return '昨天 ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        }
        // 更早
        return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
               date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }

    /**
     * 获取消息图标
     * @param {string} type - 消息类型
     * @returns {string}
     */
    function getMessageIcon(type) {
        switch (type) {
            case MESSAGE_TYPES.FENCE_ENTER_PROHIBIT:
                return 'images/工地数字导航小程序切图/管理/2X/我的/警告-红.png';
            case MESSAGE_TYPES.FENCE_LEAVE_SITE:
                return 'images/工地数字导航小程序切图/管理/2X/我的/警告-橙.png';
            case MESSAGE_TYPES.ROUTE_DEVIATION:
                return 'images/工地数字导航小程序切图/管理/2X/我的/警告-橙.png';
            case MESSAGE_TYPES.ROAD_STATUS:
                return 'images/工地数字导航小程序切图/管理/2X/我的/消息.png';
            default:
                return 'images/工地数字导航小程序切图/管理/2X/我的/消息.png';
        }
    }

    // 导出API
    return {
        getMessages,
        addMessage,
        addFenceAlertMessage,
        addRouteDeviationMessage,
        addRoadStatusMessage,
        upsertMessageByEvent,
        handleAlarmEvent,
        getFilteredMessages,
        getMessageStats,
        getMessageMeta,
        getUnreadCount,
        markAsRead,
        markAllAsRead,
        deleteMessage,
        clearAllMessages,
        formatTime,
        getMessageIcon,
        MESSAGE_TYPES,
        FILTER_TYPES,
        MESSAGE_STATUS
    };
})();

console.log('[消息管理器] 模块已加载');
