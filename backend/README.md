# Car Journal Reminder Backend

后端独立服务说明（可直接用于单独后端仓库）。

## 1. 服务作用

这个后端提供提醒模块的基础在线能力：

- 健康检查：`GET /healthz`
- 前端连通性检测：`GET /api/ping`
- CORS 控制（允许前端站点跨域访问）

当前不依赖数据库，状态为无状态服务。

## 2. 本地启动

### 环境要求

- Node.js 20+

### 安装与运行

```bash
npm install
npm run start
```

默认端口是 `18080`。

注意：不要用 `10080` 作为浏览器访问端口，Chrome/Edge 可能拦截并报 `ERR_UNSAFE_PORT`。

## 3. 环境变量

### `PORT`

- 含义：服务监听端口
- 默认：`18080`
- Render 上会自动注入，无需手填

### `CORS_ORIGINS`

- 含义：允许跨域的来源（逗号分隔）
- 示例：

```bash
CORS_ORIGINS=https://your-frontend.example.com,https://your-pages.example.com
```

- 未设置时，默认允许本地开发来源：
  - `http://localhost:5173`
  - `http://127.0.0.1:5173`
  - `http://localhost:4173`
  - `http://127.0.0.1:4173`

### `APP_VERSION`（可选）

- 用于接口返回版本号，默认 `0.1.0`

### `ENABLE_PORT_FALLBACK`（可选）

- 端口占用时是否自动向上尝试新端口
- 默认：在未显式指定 `PORT` 时开启

### `MAX_PORT_FALLBACK_STEPS`（可选）

- 最大端口回退步数，默认 `20`

## 4. API 说明

### `GET /api/ping`

响应示例：

```json
{
  "ok": true,
  "service": "car-journal-reminder-backend",
  "version": "0.1.0",
  "serverTimeUnix": 1774978603,
  "uptimeSeconds": 210
}
```

### `GET /healthz`

在 `api/ping` 基础上增加：

```json
{
  "health": "ok"
}
```

## 5. Render 部署（后端单仓库）

1. 在 Render 选择 `New Web Service`
2. 连接这个后端仓库
3. 配置：
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm run start`
4. 环境变量建议：
   - `APP_VERSION=1.0.0`（可选）
   - `CORS_ORIGINS=<你的前端线上域名>`
5. Deploy 完成后，先访问：
   - `https://<your-render-domain>/api/ping`
   - `https://<your-render-domain>/healthz`

## 6. UptimeRobot 配置（保活 + 监控）

1. 新建 `HTTP(s)` Monitor
2. URL 填：`https://<your-render-domain>/healthz`
3. 监控间隔：`5 min`
4. 告警按需开启（邮件/Telegram 等）

说明：UptimeRobot 只能帮助监控与定期触发，不等于 SLA 保障。

## 7. 常见问题

### 前端显示后端离线，但浏览器能直接打开 `/api/ping`

- 先检查前端配置的后端 URL 是否和实际端口一致（例如 `18080`）
- 再检查 `CORS_ORIGINS` 是否包含前端来源

### `EADDRINUSE` 端口被占用

- 换端口启动（PowerShell）：`$env:PORT=18081; npm run start`
- 换端口启动（Linux/macOS）：`PORT=18081 npm run start`
- 或结束占用该端口的进程

### Render 可访问但前端请求失败

- 确认前端调用地址是 `https://...`（不要混用 http）
- 确认 Render 环境变量 `CORS_ORIGINS` 已配置你的前端线上域名
