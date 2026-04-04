# 提醒后端部署流程（Render + UptimeRobot）

> 目标：你先在本地完成代码，然后把提醒后端部署到 Render，再用 UptimeRobot 做定时健康检查与可用性监控。

## 1. 最终架构

- 前端：`GitHub Pages`（或你当前静态托管）
- 后端：`Render Web Service`（Node）
- 监控与定时请求：`UptimeRobot HTTP(s) Monitor`

说明：
- UptimeRobot 不是业务后端，它负责“按周期请求你的后端健康接口”。
- 你的提醒逻辑（倒计时、页面在线提醒、铃声播放）主要仍在前端执行。

## 2. 先做本地准备（必须）

1. 本地确认后端可运行：
   - `cd backend`
   - `npm run start`
   - 打开 `http://localhost:18080/healthz`，应返回正常状态
2. 前端确认可连通后端探活：
   - `npm run dev`
   - 在页面设置里把 `reminderApiBaseUrl` 填成 `http://localhost:18080`
   - 在提醒页点击“检测后端连通性”
3. 本地构建检查：
   - `npm run build`
4. 提交并推送到 GitHub（Render 会基于仓库自动部署）

## 3. Render 部署后端（Web Service）

你截图的页面里，选择 `Web Services`（不是 Static Site / Cron Job）。

### 3.1 新建服务

1. Render 控制台 -> `New` -> `Web Service`
2. 连接你的 GitHub 仓库
3. 关键配置建议：
   - `Name`：`car-journal-reminder-api`（可自定义）
   - `Root Directory`：`backend`
   - `Runtime`：`Node`
   - `Build Command`：`npm install`
   - `Start Command`：`npm run start`
   - `Plan`：`Free`

### 3.2 环境变量

如果你的后端代码支持环境变量端口，一般 Render 会注入 `PORT`，服务需监听该端口。

建议至少检查：
- `NODE_ENV=production`
- 其他你后端实际需要的变量（若没有可留空）

### 3.3 部署后验证

Render 首次部署完成后会给你一个域名，类似：
- `https://car-journal-reminder-api.onrender.com`

立刻验证：
- `GET /healthz`
- `GET /api/ping`

例如：
- `https://car-journal-reminder-api.onrender.com/healthz`
- `https://car-journal-reminder-api.onrender.com/api/ping`

## 4. 前端接入 Render 后端

在前端页面设置中更新：
- `reminderApiBaseUrl=https://你的-render-域名`

然后到提醒页：
1. 点击“检测后端连通性”
2. 看状态是否“后端在线”
3. 创建一个短倒计时任务做端到端验证

## 5. UptimeRobot 配置定时探活

### 5.1 创建 Monitor

1. 登录 UptimeRobot
2. `+ New` -> 选择 `HTTP(s)`
3. 推荐配置：
   - `Friendly Name`：`car-journal-reminder-api-healthz`
   - `URL`：`https://你的-render-域名/healthz`
   - `Monitoring Interval`：`5 min`（免费档通常可选 5 分钟）
   - `Keyword Monitoring`：先关闭（保持简单）

### 5.2 验证监控

创建后等待 1-2 个周期，确认状态为 `Up`。

可选再加一个：
- `.../api/ping` 的 monitor，用于检测应用层返回。

## 6. 推荐上线顺序（避免踩坑）

1. 本地后端跑通
2. 本地前端连本地后端跑通
3. 推代码到 GitHub
4. Render 部署后端并验证 `healthz/ping`
5. 前端配置改为 Render 域名并回归测试
6. UptimeRobot 新建 monitor

## 7. 常见问题与定位

### 7.1 Render 显示在线，但前端检测失败

优先检查：
- `reminderApiBaseUrl` 是否带了多余路径
- 后端是否监听了 Render 分配的端口
- 接口路径是否正确（`/api/ping`）

### 7.2 后端偶发不可用

免费实例不等于 SLA 保障，可能出现：
- 平台重启
- 冷启动延迟
- 临时网络波动

UptimeRobot 只能“发现/触发请求”，不能提供企业级可用性承诺。

### 7.3 本地可用，线上铃声无声

这是浏览器策略问题，先在页面点击一次：
- “启用声音提醒（测试）”

### 7.4 本地后端显示监听成功，但前端仍是 “Failed to fetch”

优先检查这两项：
- 端口是否一致：提醒页 `reminderApiBaseUrl` 必须和后端实际监听端口一致（例如 `http://localhost:18080`）。
- CORS 是否放行：浏览器从 `http://localhost:5173` 请求后端时，后端响应里必须有 `Access-Control-Allow-Origin`。
- 浏览器是否拦截端口：例如 `10080` 会触发 `ERR_UNSAFE_PORT`，建议改用 `18080/10081/8080`。

当前仓库后端默认已放行：
- `http://localhost:5173`
- `http://127.0.0.1:5173`
- `http://localhost:4173`
- `http://127.0.0.1:4173`

若你自定义前端地址，可在启动后端前设置：
- `CORS_ORIGINS=http://你的前端地址1,http://你的前端地址2`

## 8. 你的当前代码对应点

- 提醒后端探活接口：`/healthz`、`/api/ping`
- 前端后端地址配置项：`reminderApiBaseUrl`
- 提醒页按钮：`检测后端连通性`

---

如果你后续要上“网页关闭后仍稳定提醒”，需要额外接入真正的推送链路（如 Web Push/邮件/短信/IM 机器人）。当前这套是“在线提醒优先”的低成本方案。
