# 用车记录本

基于 `Vite + Vue 3 + TypeScript` 的单页应用，用于记录：
- 加油记录
- 耗油记录

并按“加油增加、行驶减少”的方式估算当前剩余油量。

## 功能概览

- 四页面 SPA（Vue Router）
  - 首页 `/#/`
  - 加油记录页 `/#/fuel`
  - 耗油记录页 `/#/trip`
  - 用户管理页 `/#/profile`
  - 应用说明页 `/#/guide`
- 本地存储（localStorage）
  - 设备元信息（设备 ID / 设备名称）
  - 记录数据
  - 删除标记（record tombstones）
  - 剩余油量状态（自动估算 + 手动修正）
  - 剩余油量手动变更日志
  - 页面设置（不含 GitHub Token）
- GitHub Token 独立本地存储（仅浏览器本地，转换后保存）
- 首页设置区支持一键清空本地缓存（记录/油量日志/用户资料/页面设置），默认保留 PAT，可选同时清除
- 默认配置文件初始化（`public/config/app-config.json`）
- 前端直接调用 GitHub REST API（Repository Contents）提交记录 JSON（支持单条/批量）
- 用户管理页支持个人信息维护、头像 1:1 裁剪（512x512 PNG）、方/圆样式切换
- 处理后的头像与用户资料可通过 PAT 上传到用户仓库做私有管理
- 剩余油量每次变更（手动修正 / 记录引起的自动变化）都会写入独立日志文件（每条日志单文件）到目录 `fuel-balance-adjustments/`
- 支持多设备资料隔离（用户资料按设备 ID 独立存储）
- 支持记录跨设备共享一致（新增/修改 upsert + 删除 tombstone）
- 支持从 GitHub 拉取共享记录并按“记录更新时间 vs 删除时间”合并最终状态
- 支持“业务发生时间”（加油/耗油时间）与“记录创建时间”分离；业务时间留空时自动回退到记录创建时间
- 历史记录支持倒序展示、筛选、编辑、删除、导出 JSON/CSV
- 耗油页支持导入 JSON、批量提交与 GitHub 历史拉取
- 加油页与耗油页的一键提交/拉取按记录类型分开执行；首页提供全局一键提交/拉取
- 用户管理页支持从 GitHub 拉取 `profile.json` 与头像文件回填本地
- 响应式布局（桌面/平板/手机）

## 本地运行

```bash
npm install
npm run dev
```

默认地址：`http://localhost:5173`

## 构建

```bash
npm run build
npm run preview
```

## GitHub Pages 部署

项目支持通过 `VITE_BASE_PATH` 控制构建基路径。

已内置工作流文件：`.github/workflows/deploy-pages.yml`。

1. 在仓库 `Settings -> Pages` 中将 Source 设为 `GitHub Actions`。
2. 推送到 `main` 分支后会自动触发部署。
3. 工作流会自动设置：
   - `VITE_BASE_PATH=/<当前仓库名>/`
4. 部署完成后可在 `Actions` 页查看日志，并在 `Settings -> Pages` 查看站点链接。

如果需要手动构建，示例（仓库名 `car-journal`）：
- `VITE_BASE_PATH=/car-journal/ npm run build`

## GitHub Token 配置

在首页“页面设置”中填写以下字段：
- `githubOwner`
- `githubRepo`
- `githubBranch`（可留空，留空时使用仓库默认分支）
- `githubRecordsDir`
- `githubToken`（仅存浏览器本地 Token Vault，不写入配置文件）

Token 建议使用 Fine-grained PAT，并授予目标仓库 `Contents: Read and write` 权限。

提示：Token 不会写入 `public/config/app-config.json`，也不会随页面设置配置一起导出。
提示：PAT 在本地 Token Vault 保存一次后，后续保存设置时可留空，不需要重复输入。

## 默认配置文件修改

文件路径：`public/config/app-config.json`

支持字段：
- `pageTitle`（网页标题）
- `pageFavicon`（网页图标路径，建议使用相对路径如 `favicon.svg`）
- `defaultProvince`
- `defaultFuelType`
- `defaultFuelPrice`（可留空）
- `defaultAverageFuelConsumptionPer100Km`（可留空）
- `defaultDistanceKm`（可留空）
- `defaultTripNote`
- `defaultFuelNote`
- `githubOwner`
- `githubRepo`
- `githubBranch`（可留空，留空时使用仓库默认分支）
- `githubRecordsDir`
- `preferConfigOverLocalStorage`

启动加载顺序：
1. 读取 `public/config/app-config.json`
2. 读取 localStorage
3. 按 `preferConfigOverLocalStorage` 决定优先级

说明：
- 配置文件本体位于 `public/config/app-config.json`（部署后对应站点下 `/config/app-config.json`）。
- 未勾选 `preferConfigOverLocalStorage` 时，localStorage 优先，配置文件作为兜底默认值使用。
- 页面设置保存后会写入 localStorage 键：`car-journal-config-v1`。
- 三个数值默认项若留空，相关输入框将不预填，需在录入记录时手动填写。

若配置文件缺失，应用会使用内置默认值并正常运行。

## 记录保存与提交

### 本地保存
- 所有新增/编辑/删除都会立即写入 localStorage。
- 若记录曾提交过 GitHub，编辑后会自动标记为“未提交”，提示重新同步。
- 记录的“已提交”状态按 `owner/repo/branch/recordsDir` 目标独立维护；切换分支或目录后会自动按当前目标重新判定，避免误判为已提交。

### 提交到 GitHub
- 可对单条记录点击“提交到 GitHub”。
- 耗油页支持“多选提交”和“一键提交全部未提交（仅耗油）”。
- 加油页支持“一键提交全部未提交（仅加油）”。
- 首页支持“一键提交全部未提交（全类型）”。
- 使用 `PUT /repos/{owner}/{repo}/contents/{path}`。
- 记录文件路径：`<githubRecordsDir>/records/<record.id>.json`（同 ID 覆盖更新）。
- 删除标记路径：`<githubRecordsDir>/record-tombstones/<record.id>.json`。
- 若记录曾提交过，编辑后会再次提交同一路径，按更新时间覆盖为最新版本。

### 从 GitHub 拉取历史
- 耗油页支持点击“从 GitHub 拉取耗油历史（仅耗油）”。
- 加油页支持点击“从 GitHub 拉取加油历史（仅加油）”。
- 首页支持“一键拉取（全类型）”。
- 会读取共享记录目录 `records/` 与删除标记目录 `record-tombstones/`，并兼容旧版根目录 JSON。
- 合并时按 `recordId` 聚合，比较 `updatedAtUnix/deletedAtUnix` 决定最终状态（保留或删除）。
- 拉取结果会提示读取/新增/重复/无效数量。

JSON 内容中保留 `type` 字段，用于区分 `fuel` / `trip`。
同时保留 `occurredAt/occurredAtUnix`（业务发生时间）与 `createdAt/createdAtUnix`（记录创建时间），并新增 `updatedAt/updatedAtUnix` 与来源设备字段。

### 用户资料同步（用户管理页）
- 资料文件（设备隔离）：`<githubRecordsDir>/user-profile/devices/<deviceId>/profile.json`
- 头像文件（设备隔离）：`<githubRecordsDir>/user-profile/devices/<deviceId>/avatars/avatar-<unix>.png`
- 同步时会先处理头像为 1:1，再上传头像文件并写入资料 JSON 中的头像路径
- 拉取时优先读取当前设备路径；若不存在，兼容读取旧版 `user-profile/profile.json`

## 路由页面结构

- 首页 `/#/`
  - 概览仪表盘
  - 剩余油量与基准状态
  - 最近记录、累计统计
  - 快捷入口、全局一键提交/拉取、设置
- 用户管理页 `/#/profile`
  - 个人信息（昵称/邮箱/手机号/所在地/简介）
  - 头像 1:1 中心裁剪（512x512）与圆形/方形展示
  - 用户资料与头像同步到 GitHub，支持从 GitHub 拉取回填
- 应用说明页 `/#/guide`
  - 配置来源与优先级说明
  - GitHub 提交配置建议
  - 常见问题排查
- 加油记录页 `/#/fuel`
  - 顶部返回首页
  - 加油表单（自动补算 + 一致性检查 + 可选加油时间）
  - 历史记录（筛选/编辑/删除/导出/提交）
- 耗油记录页 `/#/trip`
  - 顶部返回首页
  - 耗油表单（自动计算耗油量 + 可选耗油时间）
  - 历史记录（筛选/编辑/删除/导出/导入/单条与批量提交/拉取 GitHub 历史）

## 剩余油量统计逻辑

- 无加油记录：显示“暂无加油记录”。
- 只要存在加油记录：自动建立统计基准（无需手动建基准）。
- 自动估算规则：
  - 从业务时间最早的加油记录开始
  - 加油：`remaining += fuelVolumeLiters`
  - 耗油：`remaining -= consumedFuelLiters`
- 支持负数结果：
  - 例如首次建账时车辆并非空油箱，后续可能出现 `remaining < 0`
  - 首页会提示异常，提醒可手动修正
- 支持手动修改“当前剩余油量”：
  - 系统会记录修正偏移量，后续新增记录仍会连续自动计算
  - 每次手动修改都会生成一条日志（记录时间戳、油量变更时间戳、剩余油量、自动估算值、修正量）
- 加油/耗油记录发生变更时（新增、删除、导入）：
  - 会同步重新计算剩余油量
  - 若剩余油量状态发生变化，会自动追加一条 `source=records` 日志
  - 日志本地持久化，并自动尝试提交到 GitHub 独立文件：`<githubRecordsDir>/fuel-balance-adjustments/<recordedAtUnix>-<adjustment.id>.json`
  - 若自动提交失败，可在首页点击“同步未提交油量日志”
- 首页“清除手动修正”会将修正偏移量归零，恢复为纯自动估算值

## 目录结构

```txt
public/
  config/app-config.json
src/
  assets/styles/main.css
  components/
    AppToast.vue
    PageHeader.vue
  composables/
    useStatistics.ts
  router/
    index.ts
  services/
    balanceService.ts
    brandingService.ts
    configService.ts
    githubTokenVaultService.ts
    githubService.ts
    localStorageService.ts
  stores/
    appStore.ts
  types/
    config.ts
    device.ts
    profile.ts
    records.ts
    store.ts
  utils/
    date.ts
    export.ts
    number.ts
  views/
    HomeView.vue
    FuelView.vue
    ProfileView.vue
    TripView.vue
  App.vue
  main.ts
```

## 提交规范

- 统一提交说明模板与历史提交总结见：[docs/COMMIT_CONVENTION.md](docs/COMMIT_CONVENTION.md)
- 提交正文要求中英双语（中文 6 行 + English 6 lines），不适用项填 `N/A`
- 可直接启用仓库模板：`git config commit.template .gitmessage`

## 扩展部署方案

- 原方案 + Render + UptimeRobot 前后端落地说明见：[docs/RENDER_UPTIMEROBOT_FULLSTACK_PLAN.md](docs/RENDER_UPTIMEROBOT_FULLSTACK_PLAN.md)
- 新手逐步实施（先做倒计时+在线提醒）见：[docs/ONLINE_REMINDER_RENDER_UPTIMEROBOT_GUIDE.md](docs/ONLINE_REMINDER_RENDER_UPTIMEROBOT_GUIDE.md)
