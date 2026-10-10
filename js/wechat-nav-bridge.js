(function () {
    const state = {
        payload: null,
        wxReady: false,
        opening: false
    };

    const elements = {};

    function getNavigationConfig() {
        if (typeof MapConfig === 'undefined' || !MapConfig.navigationConfig) {
            return {};
        }
        return MapConfig.navigationConfig;
    }

    function parsePayload() {
        const params = new URLSearchParams(window.location.search);
        const payloadText = params.get('payload');
        if (!payloadText) return null;

        try {
            const raw = JSON.parse(decodeURIComponent(payloadText));
            const destLng = Number(raw.destLng);
            const destLat = Number(raw.destLat);
            const fromLng = Number(raw.fromLng);
            const fromLat = Number(raw.fromLat);

            if (!Number.isFinite(destLng) || !Number.isFinite(destLat)) {
                return null;
            }

            return {
                gateName: raw.gateName || '目的地',
                destLng,
                destLat,
                fromLng: Number.isFinite(fromLng) ? fromLng : null,
                fromLat: Number.isFinite(fromLat) ? fromLat : null,
                autoOpen: raw.autoOpen !== false
            };
        } catch (error) {
            console.error('[WechatNavBridge] 解析导航参数失败:', error);
            return null;
        }
    }

    function isWechatEnvironment() {
        return /MicroMessenger/i.test(window.navigator.userAgent || '');
    }

    function setStatus(text) {
        if (elements.statusText) {
            elements.statusText.textContent = text;
        }
    }

    function fillPage() {
        if (!state.payload) {
            setStatus('地图导航暂不可用');
            console.error('[WechatNavBridge] 未收到有效导航参数');
            return;
        }

        if (elements.gateName) {
            elements.gateName.textContent = state.payload.gateName;
        }
        console.log('[WechatNavBridge] 导航参数已载入:', state.payload);
    }

    function getSignApiUrl() {
        const config = getNavigationConfig();
        return config.wechatLocationSignApiUrl || '';
    }

    function getLocationScale() {
        const config = getNavigationConfig();
        return Number(config.externalNavigationLocationScale) || 18;
    }

    async function fetchWechatSignConfig() {
        const signApiUrl = getSignApiUrl();
        if (!signApiUrl) {
            throw new Error('SIGN_API_URL_MISSING');
        }

        const currentUrl = window.location.href.split('#')[0];
        const joiner = signApiUrl.includes('?') ? '&' : '?';
        const requestUrl = `${signApiUrl}${joiner}url=${encodeURIComponent(currentUrl)}`;
        const response = await fetch(requestUrl, {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`SIGN_API_HTTP_${response.status}`);
        }

        const data = await response.json();
        const rawConfig = data && (data.data || data.result || data.config || data);
        const config = rawConfig ? {
            appId: rawConfig.appId || rawConfig.appid,
            timestamp: rawConfig.timestamp,
            nonceStr: rawConfig.nonceStr || rawConfig.noncestr || rawConfig.nonce_str,
            signature: rawConfig.signature
        } : null;

        if (!config || !config.appId || !config.timestamp || !config.nonceStr || !config.signature) {
            throw new Error('SIGN_API_INVALID_RESPONSE');
        }

        return {
            appId: String(config.appId),
            timestamp: Number(config.timestamp),
            nonceStr: String(config.nonceStr),
            signature: String(config.signature)
        };
    }

    async function ensureWechatReady() {
        if (state.wxReady) return;

        if (!isWechatEnvironment()) {
            throw new Error('NOT_WECHAT_ENV');
        }

        if (typeof wx === 'undefined') {
            throw new Error('WX_JSSDK_UNAVAILABLE');
        }

        const signConfig = await fetchWechatSignConfig();

        await new Promise((resolve, reject) => {
            let settled = false;

            wx.config({
                debug: false,
                appId: signConfig.appId,
                timestamp: signConfig.timestamp,
                nonceStr: signConfig.nonceStr,
                signature: signConfig.signature,
                jsApiList: ['openLocation']
            });

            wx.ready(() => {
                if (settled) return;
                settled = true;
                state.wxReady = true;
                resolve();
            });

            wx.error((error) => {
                if (settled) return;
                settled = true;
                console.error('[WechatNavBridge] 微信 JSSDK 初始化失败:', error);
                reject(new Error('WX_CONFIG_ERROR'));
            });
        });
    }

    function openLocation() {
        return new Promise((resolve, reject) => {
            wx.openLocation({
                latitude: state.payload.destLat,
                longitude: state.payload.destLng,
                name: state.payload.gateName,
                address: state.payload.gateName,
                scale: getLocationScale(),
                success: resolve,
                fail: reject,
                cancel: reject
            });
        });
    }

    async function tryOpenNavigation() {
        if (state.opening || !state.payload) return;

        state.opening = true;
        setStatus('正在跳转地图导航...');

        try {
            await ensureWechatReady();
            console.log('[WechatNavBridge] 微信 JSSDK 初始化完成，准备调用 openLocation');
            await openLocation();
            setStatus('正在打开地图应用...');
            console.log('[WechatNavBridge] wx.openLocation 调用成功');
        } catch (error) {
            console.error('[WechatNavBridge] 打开地图失败:', error);
            setStatus('请稍候...');
        } finally {
            state.opening = false;
        }
    }

    function initElements() {
        elements.statusText = document.getElementById('bridge-status-text');
        elements.gateName = document.getElementById('bridge-gate-name');
    }

    function init() {
        initElements();
        state.payload = parsePayload();
        fillPage();

        if (!state.payload) {
            return;
        }

        if (!isWechatEnvironment()) {
            console.log('[WechatNavBridge] 当前为网页环境，仅展示统一中转页。');
        }

        if (state.payload.autoOpen) {
            window.setTimeout(tryOpenNavigation, 300);
        }
    }

    document.addEventListener('DOMContentLoaded', init);
})();
