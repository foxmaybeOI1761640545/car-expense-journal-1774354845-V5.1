# 提醒后端（到点自动推送版）部署指南（Render Free + UptimeRobot）
更新时间：2026-04-03

本文对应当前后端实现（`backend/src/server.mjs`），目标是让你把“锁屏 Push + 到点自动推送（tick 扫描）”完整跑起来。

## 1. 功能范围与架构
- 前端（GitHub Pages）：创建/取消提醒、Push 订阅、本地提醒兜底。
- 后端（Render Web Service）：处理 API、扫描到期提醒、发送 Web Push。
- 持久化（GitHub 仓库）：提醒实体、订阅、投递回执（后端不使用本地磁盘存储业务数据）。
- 调度（UptimeRobot）：按 5 分钟调用 `/internal/tick`。

当前代码中的核心接口：
- `GET /healthz`
- `GET /api/ping`
- `POST /api/token/seal`
- `GET /api/push/vapid-public-key`
- `POST /api/push/subscriptions/upsert`
- `POST /api/push/subscriptions/remove`
- `POST /api/push/test-send`
- `POST /api/reminders/upsert`
- `PATCH /api/reminders/:id/cancel`
- `GET /internal/tick?token=...`

## 2. 部署前准备
### 2.1 账号与服务
- GitHub（已有仓库）
- Render（Free Web Service）
- UptimeRobot（Free HTTP(s) Monitor）

### 2.2 GitHub Token（PAT）权限
`TICK_GITHUB_TOKEN` 对应 PAT 需要至少：
- Repository `Contents: Read and write`

建议只授权目标仓库，降低风险。

### 2.3 生成密钥与令牌
1. 生成 `PAT_WRAP_KEY_BASE64`（32 字节 Base64）：
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

2. 生成 `INTERNAL_TICK_TOKEN`：
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

3. 生成 VAPID 密钥对：
```bash
npx web-push generate-vapid-keys
```
把输出里的 `publicKey`、`privateKey` 分别写到：
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

`VAPID_SUBJECT` 参考：`mailto:you@example.com`

## 3. Render 部署流程（新后端）
### 3.1 新建 Web Service
- `New` -> `Web Service`
- 连接你的仓库
- 关键参数建议：
  - `Root Directory`: `backend`
  - `Runtime`: `Node`
  - `Build Command`: `npm install`
  - `Start Command`: `npm run start`
  - `Plan`: `Free`

### 3.2 环境变量配置（详细）
以下按“必填优先”分组。

#### A. 必填（自动推送主链路）
| 变量名 | 是否必填 | 默认值 | 参考值（可直接套） | 说明 |
|---|---|---|---|---|
| `PAT_WRAP_KEY_BASE64` | 是 | 无 | `Kq...`（32字节base64） | 用于 `/api/token/seal`；前端保存 sealed token 需要它。 |
| `VAPID_PUBLIC_KEY` | 是 | 无 | `B...` | Web Push 公钥。 |
| `VAPID_PRIVATE_KEY` | 是 | 无 | `...` | Web Push 私钥。 |
| `VAPID_SUBJECT` | 是 | 无 | `mailto:you@example.com` | Web Push 必填标识。 |
| `INTERNAL_TICK_TOKEN` | 是 | 无 | `8f5c...` | 保护 `/internal/tick`。 |
| `TICK_GITHUB_TOKEN` | 是 | 无 | `github_pat_...` | tick 扫描时访问 GitHub 的 token。支持明文 PAT 或 sealed token。 |
| `TICK_GITHUB_OWNER` | 是 | 无 | `foxmaybeOI1761640545` | 目标仓库 owner。 |
| `TICK_GITHUB_REPO` | 是 | 无 | `car-expense-journal-1774354845-V5.1` | 目标仓库名。 |
| `TICK_GITHUB_RECORDS_DIR` | 是 | 无 | `data/records` | 与前端配置一致。 |
| `CORS_ORIGINS` | 是（生产建议） | 见代码内默认 | `https://<你的用户名>.github.io,http://localhost:5173` | 允许前端跨域调用后端。 |

#### B. 推荐填写
| 变量名 | 是否必填 | 默认值 | 参考值 | 说明 |
|---|---|---|---|---|
| `PORT` | Render 自动注入 | `18080`（本地） | Render 自动管理 | 不建议手动改。 |
| `APP_VERSION` | 否 | `0.1.0` | `reminder-autopush-v1` | 便于日志识别版本。 |
| `TICK_GITHUB_BRANCH` | 否 | 空 | `records/live-data` | 不填则用默认分支。建议显式填。 |
| `PAT_WRAP_KEY_VERSION` | 否 | `v1` | `v1` | token seal 版本标签。 |

#### C. 调优参数（可保持默认）
| 变量名 | 默认值 | 范围 | 说明 |
|---|---|---|---|
| `TICK_MAX_ENTITY_FILES` | `500` | `10-5000` | 每次 tick 最多扫描的提醒文件数。 |
| `TICK_MAX_DUE_REMINDERS` | `50` | `1-1000` | 每次 tick 最多处理到期提醒数。 |
| `TICK_DUE_LOOKBACK_SECONDS` | `604800` | `60-31536000` | 到期回看窗口（秒）。 |
| `TICK_PUSH_TTL_SECONDS` | `600` | `60-86400` | Push TTL。 |
| `MAX_PUSH_JSON_BODY_BYTES` | `131072` | `4096-2097152` | Push 接口最大 JSON body。 |
| `MAX_REMINDER_JSON_BODY_BYTES` | `131072` | `4096-2097152` | Reminder 接口最大 JSON body。 |
| `MAX_GITHUB_PROXY_BODY_BYTES` | `8388608` | `32768-33554432` | GitHub 代理接口 body 限制。 |
| `MAX_SEAL_JSON_BODY_BYTES` | `32768` | `1024-262144` | token seal body 限制。 |
| `ENABLE_PORT_FALLBACK` | `true/false`（按环境推断） | - | 端口占用时是否自动尝试+1端口。 |
| `MAX_PORT_FALLBACK_STEPS` | `20` | `0-200` | 端口回退最多尝试次数。 |

### 3.3 一份可直接参考的 Render 环境变量模板
```env
APP_VERSION=reminder-autopush-v1
PAT_WRAP_KEY_VERSION=v1
PAT_WRAP_KEY_BASE64=<32-byte-base64>

VAPID_PUBLIC_KEY=<your-vapid-public-key>
VAPID_PRIVATE_KEY=<your-vapid-private-key>
VAPID_SUBJECT=mailto:you@example.com

INTERNAL_TICK_TOKEN=<random-hex-token>

TICK_GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxx
TICK_GITHUB_OWNER=foxmaybeOI1761640545
TICK_GITHUB_REPO=car-expense-journal-1774354845-V5.1
TICK_GITHUB_BRANCH=records/live-data
TICK_GITHUB_RECORDS_DIR=data/records

CORS_ORIGINS=https://<your-github-username>.github.io,http://localhost:5173,http://127.0.0.1:5173

TICK_MAX_ENTITY_FILES=500
TICK_MAX_DUE_REMINDERS=50
TICK_DUE_LOOKBACK_SECONDS=604800
TICK_PUSH_TTL_SECONDS=600
```

## 4. UptimeRobot 配置（自动触发 tick）
建议创建两个 Monitor：

1. 健康检查
- Type: `HTTP(s)`
- URL: `https://<你的render域名>/healthz`
- Interval: `5 minutes`

2. 到点扫描触发
- Type: `HTTP(s)`
- URL: `https://<你的render域名>/internal/tick?token=<INTERNAL_TICK_TOKEN>`
- Interval: `5 minutes`

说明：
- 这条 tick monitor 既用于“触发扫描”，也可顺带减少 Free 实例休眠影响。
- 免费方案下提醒延迟通常是分钟级（常见 0-5 分钟）。

## 5. 前端联动配置
在前端设置页确保以下配置一致：
- `reminderApiBaseUrl=https://<你的render域名>`
- `githubOwner/repo/branch/recordsDir` 与后端 tick 默认配置一致

启用锁屏 Push 后，前端会自动同步本地 pending 提醒到后端。

## 6. 部署后验证清单
### 6.1 基础连通
- `GET /healthz` 返回 200
- `GET /api/ping` 返回 200

### 6.2 Push 能力
- 提醒页点击“启用锁屏 Push 提醒”成功
- 点击“发送 Push 测试”可收到通知

### 6.3 自动推送链路
1. 创建一个 1-2 分钟后的提醒
2. 等待下一次 tick（或手动请求 `/internal/tick?token=...`）
3. 检查是否收到系统通知
4. 检查 GitHub 中是否出现：
   - `data/records/reminders/entities/<reminderId>.json`
   - `data/records/reminders/deliveries/<reminderId>/push.json`

## 7. 常见问题与排障
### 7.1 `/internal/tick` 返回 503
- 文案 `INTERNAL_TICK_TOKEN is not configured.`：未配置 `INTERNAL_TICK_TOKEN`
- 文案 `Push VAPID is not configured.`：VAPID 三项缺失或非法

### 7.2 `/internal/tick` 返回 401
- URL 里的 `token` 与环境变量 `INTERNAL_TICK_TOKEN` 不一致

### 7.3 `/internal/tick` 返回 400（Tick GitHub context is incomplete）
- 缺少 `TICK_GITHUB_TOKEN / OWNER / REPO / RECORDS_DIR` 中至少一项

### 7.4 前端提示后端可用，但自动推送不触发
- 检查 reminder 是否 `notificationEnabled=true`
- 检查设备订阅文件是否存在且 `enabled=true`
- 检查 UptimeRobot 是否真的在调用 tick URL

### 7.5 推送偶发延迟
- Free 方案正常现象，主要由 5 分钟调度粒度与平台波动导致
- 可通过降低业务预期、保持实例活跃、减少 tick 每次扫描负载来优化体感

## 8. 安全建议
- `INTERNAL_TICK_TOKEN` 不要写进公开仓库
- PAT 最小权限、定期轮换
- 若不希望明文 PAT 落在 Render 环境，可改用 sealed token，并确保 `PAT_WRAP_KEY_BASE64` 稳定不变
