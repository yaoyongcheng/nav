(function(window, document) {
    'use strict';

    var DEFAULT_ENDPOINT = 'https://dmap.cscec3bxjy.cn/api/map/amap/apikey';
    var SDK_VERSION = '2.0';
    var SDK_URL = 'https://webapi.amap.com/maps';

    var amapConfigPromise = null;
    var amapReadyPromise = null;

    function getLoaderOptions() {
        var options = window.AMapLoaderConfig || {};
        try {
            if (!options.endpoint && typeof MapConfig !== 'undefined' && MapConfig && MapConfig.amapConfigEndpoint) {
                options.endpoint = MapConfig.amapConfigEndpoint;
            }
        } catch (e) {}
        return options;
    }

    function getConfigEndpoint() {
        var options = getLoaderOptions();
        return options.endpoint || DEFAULT_ENDPOINT;
    }

    function getRequestHeaders() {
        var headers = {
            'Accept': 'application/json'
        };
        var token = '';

        try {
            token = sessionStorage.getItem('authToken') || '';
        } catch (e) {}

        if (token) {
            headers.Authorization = 'Bearer ' + token;
        }

        return headers;
    }

    function normalizeConfig(payload) {
        var data = payload && payload.data ? payload.data : {};
        var key = data.key || payload.key;
        var securityJsCode = data.securityJsCode || data.securityJscode || data.securityjsCode || data.securitysCode || payload.securityJsCode;

        if (!key || !securityJsCode) {
            throw new Error('高德地图配置返回不完整');
        }

        return {
            key: key,
            securityJsCode: securityJsCode
        };
    }

    function fetchAmapConfig() {
        if (amapConfigPromise) {
            return amapConfigPromise;
        }

        amapConfigPromise = fetch(getConfigEndpoint(), {
            method: 'GET',
            headers: getRequestHeaders(),
            credentials: 'include'
        }).then(function(response) {
            if (!response.ok) {
                throw new Error('高德地图配置接口请求失败: HTTP ' + response.status);
            }
            return response.json();
        }).then(function(payload) {
            if (payload && typeof payload.code !== 'undefined' && Number(payload.code) !== 200) {
                throw new Error(payload.message || '高德地图配置接口返回失败');
            }
            return normalizeConfig(payload);
        }).catch(function(error) {
            amapConfigPromise = null;
            throw error;
        });

        return amapConfigPromise;
    }

    function injectAmapScript(config) {
        if (window.AMap) {
            return Promise.resolve(window.AMap);
        }

        if (amapReadyPromise) {
            return amapReadyPromise;
        }

        amapReadyPromise = new Promise(function(resolve, reject) {
            window._AMapSecurityConfig = Object.assign({}, window._AMapSecurityConfig, {
                securityJsCode: config.securityJsCode
            });

            var existingScript = document.querySelector('script[data-amap-sdk="true"]');
            if (existingScript) {
                existingScript.addEventListener('load', function() { resolve(window.AMap); }, { once: true });
                existingScript.addEventListener('error', function() { reject(new Error('高德地图 SDK 加载失败')); }, { once: true });
                return;
            }

            var script = document.createElement('script');
            script.src = SDK_URL + '?v=' + encodeURIComponent(SDK_VERSION) + '&key=' + encodeURIComponent(config.key);
            script.async = true;
            script.setAttribute('data-amap-sdk', 'true');

            script.onload = function() {
                if (!window.AMap) {
                    reject(new Error('高德地图 SDK 已加载，但 AMap 对象不存在'));
                    return;
                }
                resolve(window.AMap);
            };

            script.onerror = function() {
                reject(new Error('高德地图 SDK 加载失败'));
            };

            document.head.appendChild(script);
        }).catch(function(error) {
            amapReadyPromise = null;
            throw error;
        });

        return amapReadyPromise;
    }

    window.fetchAmapConfig = fetchAmapConfig;
    window.ensureAmapReady = function() {
        return fetchAmapConfig().then(function(config) {
            return injectAmapScript(config).then(function(amap) {
                window.dispatchEvent(new CustomEvent('amap:ready', { detail: config }));
                return amap;
            });
        }).catch(function(error) {
            window.__lastAmapLoadError = error;
            console.error('[AMapLoader] 高德地图加载失败:', error);
            window.dispatchEvent(new CustomEvent('amap:error', { detail: error }));
            throw error;
        });
    };
})(window, document);
