# 原方案 + Render + UptimeRobot 前后端落地方案

更新时间：2026-03-31

本文面向当前仓库（前端 `Vite + Vue3 + TS`、静态部署 GitHub Pages），目标是在不自建云服务器的前提下，增加以下能力：

- 停车倒计时提醒
- 番茄钟提醒
- 定时邮件提醒

## 1. 现状与约束

当前项目是纯前端静态站点，核心数据在浏览器本地与 GitHub 仓库 JSON 文件中同步。该模式的优点是简单，但对“定时触发”有天然限制：

- 页面关闭后，前端计时器不再运行。
- 无后端常驻进程，无法稳定执行定时任务。
- 邮件发送需要服务端（且 Render Free 不支持 SMTP 常用端口 25/465/587）。

结论：要做“页面关闭后仍可触发”的提醒，必须补一个后端执行面。

## 2. 目标架构（推荐）

```txt
GitHub Pages (现有前端 SPA)
  ├─ 管理提醒（创建/取消/查询）
  ├─ 本地提醒（弹窗/声音/浏览器通知，页面打开时）
  └─ 调用 Reminder API
         |
         v
Render Free Web Service (新增后端 API)
  ├─ 无状态执行（零 Render 存储）
  ├─ 读写 GitHub JSON（推荐）
  ├─ 可选：外部 DB（非必须）
  ├─ 接收 UptimeRobot 周期触发
  ├─ 扫描到期任务并执行
  └─ 调用邮件服务商 HTTP API（Resend/SendGrid/Mailgun）
         ^
         |
UptimeRobot (免费 5 分钟巡检)
  ├─ Monitor A: /healthz（可用性）
  └─ Monitor B: /internal/tick?token=...（调度触发）
```

## 3. 为什么这样组合可行

1. GitHub Pages 继续托管前端，保持现有部署链路不变。  
2. Render Free 提供后端 API 运行环境。  
3. UptimeRobot 周期请求既可保活，也可充当“轻量外部调度器”。  
4. 邮件走 HTTP API（不是 SMTP），避开 Render Free 端口限制。

## 4. 平台限制（必须先接受）

以下限制直接影响产品体验与技术设计：

- Render Free 服务 15 分钟无流量会休眠，下一次请求唤醒约 1 分钟。
- Render Free 可能被平台随时重启，不能当作有 SLA 的生产稳定层。
- Free web service 的本地文件系统是临时的，重启/休眠/重部署后丢失。
- Free instance hours 为 workspace 级共享池，每月 750 小时；用尽会暂停该 workspace 下所有 Free web services。
- Render Free 不支持 SMTP 25/465/587 出站，邮件应改用第三方邮件 API。
- Render Free Postgres 有 30 天有效期（到期需升级，否则不可用），不适合长期稳定生产存储。
- UptimeRobot 免费监控间隔为 5 分钟，无法做到秒级/分钟级精确触发。

对业务含义：

- 番茄钟/停车提醒可以做，但“准点度”建议宣传为“分钟级近似触发”。
- 若需要强 SLA 与准点邮件，最终仍要升级到付费实例或专用调度服务。

## 5. 落地实施步骤

## 5.1 后端服务最小能力

建议新增一个独立后端目录（示例 `backend/`），用 Node.js（Express/Fastify/Koa 均可）实现：

必备接口：

- `GET /healthz`：健康检查（给 Render 健康探针 + UptimeRobot Monitor A）
- `GET /internal/tick?token=...`：由 UptimeRobot 触发一次“扫描到期任务”
- `POST /api/reminders`：创建提醒任务
- `GET /api/reminders?deviceId=...`：查询提醒任务
- `PATCH /api/reminders/:id/cancel`：取消任务

建议数据模型：

```ts
type Reminder = {
  id: string;
  deviceId: string;
  kind: 'parking' | 'pomodoro' | 'custom';
  title: string;
  notifyChannels: Array<'email' | 'web'>;
  emailTo?: string;
  triggerAtUnix: number;
  timezone: string; // 如 Asia/Shanghai
  status: 'pending' | 'fired' | 'cancelled' | 'failed';
  createdAtUnix: number;
  updatedAtUnix: number;
  firedAtUnix?: number;
  dedupeKey?: string;
};
```

## 5.2 调度执行逻辑（重点）

`/internal/tick` 每次执行流程：

1. 校验 `token`（防止被公网任意调用）。
2. 查询 `status=pending AND triggerAtUnix <= now + graceWindow` 的任务。
3. 对每个任务执行提醒（邮件/站内状态更新）。
4. 成功后原子更新为 `fired`，写入 `firedAtUnix`。
5. 失败写入错误原因并标记 `failed` 或重试计数。

关键要求：

- 幂等：同一任务不应重复发邮件。  
- 抢占保护：如果后端短时并发执行 `tick`，只能有一次真正消费到同一任务。  
- 漂移容忍：保活/调度不是实时，应用层应允许 1~10 分钟偏差。

## 5.3 Render 部署

1. 新建 `Web Service`，选择 Free 实例。  
2. 配置：
   - Build Command：`npm ci && npm run build`（按后端项目实际）
   - Start Command：`npm run start`
   - Health Check Path：`/healthz`
3. 环境变量（示例）：
   - `NODE_ENV=production`
   - `PORT=10000`（或由平台注入）
   - `CORS_ORIGINS=https://<your-user>.github.io`
   - `INTERNAL_TICK_TOKEN=<长随机串>`
   - `DATABASE_URL=<外部数据库连接串，可选>`
   - `EMAIL_PROVIDER_API_KEY=<邮件服务密钥>`
   - `EMAIL_FROM=<发件地址>`

注意：

- Free 实例重启会丢本地文件，禁止把提醒持久化到本地文件。
- 不要依赖 `sqlite` 本地文件存储（重启/休眠后丢数据）。

## 5.4 UptimeRobot 配置

创建两个 HTTP(s) Monitor：

1. Monitor A（可用性）
   - URL：`https://<render-service>/healthz`
   - Interval：5 分钟（免费）
   - 用途：保活 + 故障告警

2. Monitor B（调度触发）
   - URL：`https://<render-service>/internal/tick?token=<INTERNAL_TICK_TOKEN>`
   - Interval：5 分钟（免费）
   - 用途：执行一次“到期任务扫描”

建议：

- 两个监控可分开设置告警策略，避免调度接口偶发失败导致告警噪音过大。
- `token` 要足够长，且不要在前端暴露。

## 5.5 前端接入（基于本项目）

建议在设置页新增后端配置项（写入 localStorage）：

- `reminderApiBaseUrl`
- `reminderApiToken`（可选，如果你给前端 API 也做简单鉴权）
- `reminderDefaultEmail`

建议新增页面路由：

- `/#/reminder`：提醒中心（停车提醒、番茄钟、自定义提醒）

前端行为建议：

1. 创建提醒时：同时写本地和后端。  
2. 本地计时用于“页面开启时”的秒级体验；后端任务用于“页面关闭后”的兜底提醒。  
3. 若后端不可用，前端明确提示“仅本地提醒模式”。  
4. 邮件提醒作为兜底，不替代前端声音提醒。

## 5.6 零 Render 存储模式（推荐长期方案）

目标：Render 只做“无状态执行器”，不存提醒任务，不依赖 Render Free Postgres，也不依赖本地磁盘文件。

核心思路：

- 持久化统一放 GitHub 仓库（通过现有 PAT 能力写入）。
- 前端创建提醒后立即写 GitHub（不是“稍后备份”）。
- Render `tick` 仅拉取待执行任务，触发后把状态回写到 GitHub。

### 5.6.1 GitHub 目录约定

以现有 `githubRecordsDir` 为根目录，新增以下路径：

```txt
<githubRecordsDir>/
  reminders/
    entities/
      <reminderId>.json
    due-index/
      YYYY/MM/DD/HH/mm/
        <reminderId>.json
    devices/
      <deviceId>.json
    deliveries/
      <reminderId>/
        email.json
        web.json
```

各目录用途：

- `entities/`：提醒主记录（单条真相源）。
- `due-index/`：按分钟分桶的到期索引，供 `tick` 快速扫描。
- `devices/`：设备到提醒 ID 的轻量索引，方便前端按设备查询。
- `deliveries/`：投递回执（幂等凭据），防重复发送。

### 5.6.2 实体字段约定（entities）

```json
{
  "id": "rmd_01JXYZ...",
  "deviceId": "device_xxx",
  "kind": "parking",
  "title": "停车到时提醒",
  "note": "地库B2",
  "timezone": "Asia/Shanghai",
  "triggerAtUnix": 1775150400,
  "notifyChannels": ["email", "web"],
  "emailTo": "you@example.com",
  "status": "pending",
  "version": 1,
  "createdAtUnix": 1775146800,
  "updatedAtUnix": 1775146800,
  "firedAtUnix": null,
  "cancelledAtUnix": null,
  "lastError": null,
  "source": {
    "app": "car-journal-web",
    "deviceName": "iPhone-15"
  }
}
```

字段规则：

- `status`：`pending | fired | cancelled | failed`
- `version`：每次状态变更 `+1`，用于冲突审计。
- `triggerAtUnix`：UTC 秒级时间戳，前端展示时按本地时区格式化。
- `emailTo`：仅当 `notifyChannels` 包含 `email` 时必填。

### 5.6.3 后端接口契约（零存储版）

1. `POST /api/reminders`
   - 作用：创建提醒并写 `entities + due-index + devices`
   - 请求体：

```json
{
  "deviceId": "device_xxx",
  "kind": "pomodoro",
  "title": "番茄钟结束",
  "timezone": "Asia/Shanghai",
  "triggerAtUnix": 1775150400,
  "notifyChannels": ["email"],
  "emailTo": "you@example.com"
}
```

   - 响应：

```json
{
  "ok": true,
  "reminderId": "rmd_01JXYZ...",
  "status": "pending"
}
```

2. `GET /api/reminders?deviceId=<id>&status=pending`
   - 作用：先读 `devices/<deviceId>.json`，再批量读取 `entities`
   - 响应：

```json
{
  "ok": true,
  "items": [
    {
      "id": "rmd_01JXYZ...",
      "kind": "parking",
      "status": "pending",
      "triggerAtUnix": 1775150400
    }
  ]
}
```

3. `PATCH /api/reminders/:id/cancel`
   - 作用：将 `entities/<id>.json` 更新为 `cancelled`
   - 响应：

```json
{
  "ok": true,
  "id": "rmd_01JXYZ...",
  "status": "cancelled"
}
```

4. `GET /internal/tick?token=<INTERNAL_TICK_TOKEN>`
   - 作用：扫描 `due-index` 当前分钟与回看窗口（建议 10 分钟）并执行任务
   - 响应：

```json
{
  "ok": true,
  "scanned": 12,
  "fired": 9,
  "skipped": 2,
  "failed": 1
}
```

### 5.6.4 `tick` 执行规范（防重发）

对每个候选 `reminderId`：

1. 读取 `entities/<id>.json`，非 `pending` 直接跳过。
2. 若 `now < triggerAtUnix` 跳过（避免提前触发）。
3. 若需发邮件，先尝试创建 `deliveries/<id>/email.json`。
4. 若创建成功，再调用邮件服务 API；若发现已存在回执文件，视为已投递，跳过。
5. 成功后更新 `entities` 为 `fired`；失败写 `lastError` 并标记 `failed`（或保留 `pending` 等待重试）。

推荐回执文件内容：

```json
{
  "reminderId": "rmd_01JXYZ...",
  "channel": "email",
  "provider": "resend",
  "providerMessageId": "msg_xxx",
  "sentAtUnix": 1775150421
}
```

### 5.6.5 前端字段与配置约定

建议在现有配置中新增：

- `reminderApiBaseUrl`：后端地址，例如 `https://xxx.onrender.com`
- `reminderSyncToGithub`：默认 `true`，创建提醒即同步
- `reminderFallbackLocalOnly`：后端异常时是否降级本地模式
- `reminderDefaultNotifyChannels`：例如 `["web"]` 或 `["email","web"]`
- `reminderDefaultEmail`：默认收件邮箱

前端创建提醒时建议本地记录：

```json
{
  "id": "rmd_01JXYZ...",
  "localState": "scheduled",
  "createdAtUnix": 1775146800,
  "triggerAtUnix": 1775150400,
  "lastSyncAtUnix": 1775146802,
  "remoteStatus": "pending"
}
```

### 5.6.6 适用边界

该模式优点：

- 不依赖 Render 数据库，不受 Free Postgres 30 天到期影响。
- Render 重启不影响任务持久化。
- 与当前项目“GitHub JSON 同步”模式一致，学习成本低。

该模式限制：

- 批量任务场景下，GitHub API 调用次数会快速上升。
- 到点精度受 UptimeRobot 5 分钟间隔和冷启动影响。
- 适合个人/小团队和中低频提醒，不适合高并发调度系统。

## 6. 扩展细节与风险清单

## 6.1 存储选型

建议优先级：

- 第一优先：零 Render 存储（持久化在 GitHub 仓库）。
- 第二优先：长期托管数据库（Neon/Supabase 等）+ Render API 计算层。
- 验证期可选：Render Free Postgres（仅短期 PoC，30 天到期）。

不建议把“上线后长期运行”的核心提醒任务放在 Render Free Postgres。

## 6.2 安全

- `tick` 接口必须鉴权（token/HMAC/Basic Auth 至少一种）。
- CORS 只允许你的前端域名，避免 `*`。
- 邮件 API key 必须存后端环境变量，不进入前端。
- 对公开接口加基础限流（IP + deviceId 维度）。

## 6.3 准点度与用户预期

若用 UptimeRobot 免费 5 分钟间隔，应明确产品说明：

- 到点后通常在 0~5 分钟内触发。
- 冷启动、重启、网络波动时可能更晚。
- 不建议用于医疗/金融/法律等高时效场景。

## 6.4 幂等与重复发送

必须防止重复邮件：

- 零存储模式：使用 `deliveries/<reminderId>/<channel>.json` 作为唯一回执。
- 数据库模式：`deliveries` 表加唯一键 `UNIQUE(reminder_id, channel)`。
- 每次发送前先查“是否已有成功回执”。
- 状态更新使用条件更新（compare-and-set）避免并发重复触发。

## 6.5 时区

- 入库统一保存 `triggerAtUnix`（UTC 时间戳）。
- 同时保存用户时区（`Asia/Shanghai`）用于展示与审计。
- 前端显示时再转本地时区，避免夏令时/跨时区误差。

## 6.6 可观测性

至少准备：

- 后端结构化日志（tick 开始/结束、扫描数、发送成功数、失败数）。
- UptimeRobot 告警联系人。
- 每日人工查看一次失败任务数（可先做简化）。

## 7. 建议的迭代顺序

1. V1：前端本地提醒中心（停车+番茄钟），无后端。  
2. V2：接入 Render API + UptimeRobot `tick`，采用零 Render 存储模式。  
3. V3：补齐任务幂等、失败重试、告警仪表。  
4. V4（可选）：迁移付费调度/稳定实例，提升准点度和 SLA。

## 8. 执行清单（Checklist）

零 Render 存储路径（推荐）：

- [ ] 新增后端服务并部署到 Render Free
- [ ] 实现 `/healthz` 与 `/internal/tick`
- [ ] 实现 `entities + due-index + devices + deliveries` 四类 GitHub 文件写入
- [ ] `tick` 支持回看窗口扫描（建议 10 分钟）
- [ ] 邮件通道改 HTTP API（非 SMTP）
- [ ] UptimeRobot 创建 2 个监控并开启告警
- [ ] 前端设置页新增 `reminderApiBaseUrl` 与 `reminderSyncToGithub`
- [ ] 新增提醒中心页面（停车/番茄钟）
- [ ] 压测一次批量到期任务（验证不重复发）

数据库路径（可选）：

- [ ] 任务表支持 `pending/fired/cancelled/failed`
- [ ] 投递表增加 `UNIQUE(reminder_id, channel)` 约束

## 9. 参考文档

- Render Free 实例与限制：<https://render.com/docs/free>
- Render Cron Jobs（含最低 $1/月）：<https://render.com/docs/cronjobs>
- Render Pricing（含计划能力与计费）：<https://render.com/pricing>
- UptimeRobot Pricing（免费 5 分钟监控间隔）：<https://uptimerobot.com/pricing/>
- UptimeRobot 帮助中心（监控间隔）：<https://help.uptimerobot.com/en/articles/11360876-what-is-a-monitoring-interval-in-uptimerobot>
