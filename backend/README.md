# Car Journal Reminder Backend

后端独立服务说明（可直接用于单独后端仓库）。

## 1. 服务作用

这个后端提供提醒模块的基础在线能力：

- 健康检查：`GET/HEAD /healthz`
- 前端连通性检测：`GET/HEAD /api/ping`
- CORS 控制（允许前端站点跨域访问）
- 仪表盘图片 AI 识别：`POST /api/trip/ai-extract`
- 图片访问：`GET/HEAD /uploads/...`

当前不依赖数据库；提醒数据仍走 GitHub，耗油图片识别会把图片落盘到本地目录。

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
- 支持精确来源（如 `https://your-frontend.example.com`）和通配规则（如 `https://*.github.io`）
- 示例：

```bash
CORS_ORIGINS=https://your-frontend.example.com,https://your-pages.example.com
```

- 未设置时，默认允许以下来源：
  - `http://localhost:5173`
  - `http://127.0.0.1:5173`
  - `http://localhost:4173`
  - `http://127.0.0.1:4173`
  - `https://*.github.io`（覆盖 GitHub Pages）

### `APP_VERSION`（可选）

- 用于接口返回版本号，默认 `0.1.0`

### `ENABLE_PORT_FALLBACK`（可选）

- 端口占用时是否自动向上尝试新端口
- 默认：在未显式指定 `PORT` 时开启

### `MAX_PORT_FALLBACK_STEPS`（可选）

- 最大端口回退步数，默认 `20`

### `OPENAI_API_KEY`（耗油图片识别必填）

- 用于 `POST /api/trip/ai-extract` 调用 OpenAI 视觉能力

### `OPENAI_TRIP_IMAGE_MODEL`（可选）

- 识别模型，默认 `gpt-4.1-mini`

### `OPENAI_API_BASE_URL`（可选）

- OpenAI API 基地址，默认 `https://api.openai.com/v1`

### `TRIP_IMAGE_UPLOAD_DIR`（可选）

- 图片落盘目录
- 默认：`backend/uploads/trip-images`

### `MAX_TRIP_AI_JSON_BODY_BYTES`（可选）

- `POST /api/trip/ai-extract` 请求体大小限制（单位：字节）
- 默认：`0`（不设置显式上限，最终仍受机器内存限制）

## 4. API 说明

### `GET/HEAD /api/ping`

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

说明：
- `GET`：返回 JSON。
- `HEAD`：返回 `200` 且不返回响应体（用于监控探测）。

### `GET/HEAD /healthz`

在 `api/ping` 基础上增加：

```json
{
  "health": "ok"
}
```

说明：
- `GET`：返回 JSON（含 `health: "ok"`）。
- `HEAD`：返回 `200` 且不返回响应体（用于监控探测）。

### `POST /api/trip/ai-extract`

请求体示例：

```json
{
  "imageDataUrl": "data:image/jpeg;base64,...",
  "imageFileName": "dashboard.jpg"
}
```

响应示例：

```json
{
  "ok": true,
  "averageFuelConsumptionPer100Km": 12.8,
  "distanceKm": 5.7,
  "savedImagePath": "uploads/trip-images/1743779000000-abc123-dashboard.jpg",
  "savedImageUrl": "http://127.0.0.1:18080/uploads/trip-images/1743779000000-abc123-dashboard.jpg",
  "rawText": "{\"averageFuelConsumptionPer100Km\":12.8,\"distanceKm\":5.7}"
}
```

说明：
- 后端会先保存图片，再调用 OpenAI 识别。
- 返回值中的数值字段可能为 `null`（无法识别时）。

### `GET/HEAD /uploads/...`

- 读取已保存的图片文件（默认目录：`uploads/`）
- 可用于前端展示历史记录里的仪表盘图片

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

免费版提示：UptimeRobot 默认使用 `HEAD` 探测，当前后端已兼容 `HEAD /healthz`，无需升级套餐即可正常判定 `Up`。

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
- 若报 CORS 错误，确认 Render 环境变量 `CORS_ORIGINS` 已配置你的前端线上域名（例如 `https://foxmaybeoi1761640545.github.io`）

## 8. PAT 密封与 GitHub 代理（新增）

后端新增了“只处理不存储”的 PAT 密封与 GitHub Contents 代理能力：

- `POST /api/token/seal`
- `POST /api/github/contents/get`
- `POST /api/github/contents/list`
- `POST /api/github/contents/put`

### 新增环境变量

- `PAT_WRAP_KEY_BASE64`：32 字节主密钥（Base64 编码，必填）
- `PAT_WRAP_KEY_VERSION`：密钥版本号（可选，默认 `v1`）
- `MAX_SEAL_JSON_BODY_BYTES`：`/api/token/seal` 的 JSON 请求体上限（可选，默认 `32768`）
- `MAX_GITHUB_PROXY_BODY_BYTES`：GitHub 代理接口 JSON 请求体上限（可选，默认 `8388608`）

说明：

- 后端不会持久化保存 PAT，仅在单次请求内临时解密使用。
- 上述接口应仅通过 HTTPS 访问，且配合 `CORS_ORIGINS` 限制来源。
