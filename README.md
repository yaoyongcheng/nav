# 工地数字导航（PWA 静态站）

工地数字导航系统的 H5 / PWA 端静态站点。纯静态、无构建步骤，可直接托管到任意静态服务器或 GitHub Pages。

## 入口

| 页面 | 说明 |
|---|---|
| `login.html` | **首页 / 登录**（快捷入口：🧭 地图导航、✏️ 进场登记、📹 视频监控、🔔 开启通知、📋 离线队列、📷 拍照录像） |
| `navigation.html` | 工地内导航（含语音播报 / GPS 纠偏） |
| `admin_index.html` | 管理端入口 |
| `offline.html` | Service Worker 离线兜底页 |

> iPhone 用户可用 **Safari** 打开后用「添加到主屏幕」安装为 PWA。

## 主要能力

- **PWA**：Service Worker 预缓存 + stale-while-revalidate；支持离线访问与添加到主屏幕
- **外部 App 唤起**（`js/app-launch.js`）：唤起高德地图 / 各厂商应用商店，适配苹果、华为、小米、vivo、OPPO
- **离线队列**：断网时表单入队 IndexedDB，恢复后自动补传
- **Web Push**：iOS 16.4+ / 安卓推送通知（依赖后端，静态托管下不可用）
- **相机采集**：拍照 / 录像 / 相册，三级降级（getUserMedia → 系统相机 → 文件选择器）

## 目录结构

```
├── *.html              页面（22 个）
├── css/ js/ icons/ images/
├── sw.js               Service Worker
├── manifest.json       PWA 清单
└── __app_version__     版本号（自动生成）
```

## 部署说明

- **纯静态**：把本目录整体传到任意静态托管即可，无需构建
- **子路径可直接用**：`manifest.json` 内的 `start_url` / `scope` / `id` / 图标路径均为**相对路径**，部署在 `/任意子目录/` 下 PWA 功能正常
- **后端依赖**：Web Push（`/api/push/*`）与离线队列（`/api/entry-records`）需要配套服务端，纯静态托管下这两项会走本地降级路径

## 版本

见 `__app_version__`（本项目由 main-9.4 的 `tools/bump-version.py` 自动生成，随关键文件变化）。

---

静态包来源：main-9.4 项目的 `tmp/deploy_static`（v1.6.23）
