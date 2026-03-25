# 跨设备同步隔离可行性分析（决策草案）

更新时间：2026-03-26

## 1. 需求目标（你当前想要的能力）

你希望在「同一个 GitHub 仓库」下，用户使用不同设备时可以选择：

1. 跨设备同步数据（共享）。
2. 不跨设备同步数据（隔离）。

并希望在存储结构里增加设备相关字段，支持这类控制。

## 2. 现状梳理（基于当前代码）

### 2.1 记录数据（fuel/trip）

- 上传时每条记录是一个独立 JSON 文件，写入 `githubRecordsDir` 根目录。
- 拉取时读取目录下 JSON 文件并导入本地，按 `record.id` 去重。
- 当前并没有设备字段。

关键位置：

- `src/services/githubService.ts`
  - `submitRecordToGithub`
  - `fetchRecordsFromGithub`
- `src/stores/appStore.ts`
  - `syncRecordsFromGithub`
  - `mergeRecords`
  - `sanitizeRecord`

### 2.2 用户资料（profile/avatar）

- 资料固定写入：`data/records/user-profile/profile.json`
- 头像写入：`data/records/user-profile/avatars/avatar-*.png`
- 当前是单份资料，不区分设备。

关键位置：

- `src/services/githubService.ts`
  - `submitUserProfileToGithub`
  - `fetchUserProfileFromGithub`
  - `uploadUserAvatarToGithub`

### 2.3 一个必须提前说明的边界

当前记录同步是「追加 + 按 id 去重」，不是「双向最终一致」：

- 新增记录可同步。
- 同一条记录在 A 设备被编辑后，B 设备已存在同 id 时会被跳过，不会自动覆盖。
- 删除也不会自动传播到其他设备。

这与“是否跨设备同步”是两个维度，需要在方案中明确预期。

## 3. 能否区分“设备”？

结论：可以做到“应用内设备身份”，但不能拿到可靠硬件唯一 ID。

Web 端现实约束：

- 浏览器不会提供稳定硬件 ID（隐私限制）。
- User-Agent 可变且可伪造，不可作为唯一标识。
- 可行方式是本地生成并持久化 `deviceId`（例如 UUID）。

推荐方式：

- 首次启动生成 `deviceId`，保存到 localStorage。
- 支持用户自定义 `deviceName`（如“我的手机”“家里电脑”）。
- 清缓存/更换浏览器会生成新设备 ID（属于可接受行为，需要在 UI 提示）。

## 4. 方案对比

## 方案 A：记录增加设备字段 + 拉取时按策略过滤（推荐 MVP）

### 核心思路

- 每条记录新增可选字段：`sourceDeviceId`、`sourceDeviceName`。
- 本地新增同步策略：`deviceSyncMode`
  - `all`（默认，跨设备共享）
  - `self-only`（仅同步本设备）
- 拉取时按策略过滤。

### 示例字段

```json
{
  "id": "fuel-xxx",
  "type": "fuel",
  "sourceDeviceId": "dev_2f8c7b1a",
  "sourceDeviceName": "我的手机"
}
```

### 优点

- 改动小，符合“多一个字段”的诉求。
- 不改变现有目录结构。
- 向后兼容：历史记录无设备字段时可按“legacy 记录”处理。

### 缺点

- 只能控制“拉取可见范围”，不能自动解决编辑/删除跨设备一致性问题。
- profile/avatar 仍是共享单份（除非做二期）。

## 方案 B：按设备目录隔离（强隔离）

### 核心思路

- 路径改为设备命名空间，例如：
  - `data/records/devices/<deviceId>/...`
- 拉取时按设备目录读取。

### 优点

- 物理隔离清晰，概念直观。
- 数据不会混杂。

### 缺点

- 改动大，需要调整读取逻辑（当前只读根目录 JSON）。
- 迁移成本高，需要兼容历史目录。

## 方案 C：配置层隔离（不同 recordsDir/branch）

### 核心思路

- 每个设备配置不同 `githubRecordsDir` 或不同 `branch`。

### 优点

- 几乎不改代码，短期可用。

### 缺点

- 用户操作成本高，容易配置错。
- 无法在 UI 中平滑切换“共享/隔离”。

## 5. 推荐落地路径（建议你这样决策）

## Phase 1（建议先做）

目标：先满足“同仓库下可选择跨设备同步或隔离”。

实施点：

1. 本地设备身份
   - 新增 `deviceId/deviceName` 本地持久化。
2. 记录字段
   - `AppRecord` 增加 `sourceDeviceId/sourceDeviceName`（可选）。
3. 拉取策略
   - 新增 `deviceSyncMode: all | self-only`。
   - `syncRecordsFromGithub` 导入前按模式过滤。
4. 设置页
   - 增加“数据同步范围”开关。

预期效果：

- 同仓库下，不同设备可各自决定是否看见其他设备记录。

## Phase 2（可选）

目标：把 profile/avatar 也做成可隔离。

建议做法（二选一）：

1. 设备独立 profile 文件路径（推荐）
   - `user-profile/devices/<deviceId>/profile.json`
   - `user-profile/devices/<deviceId>/avatars/...`
2. 单文件多设备 map（复杂度更高，不优先）

## 6. 关键兼容策略

1. 历史记录没有 `sourceDeviceId` 时：
   - 建议视为 `legacy-shared`，在 `all` 与 `self-only` 下都可见（避免“数据丢失感”）。
2. 默认模式：
   - 建议默认 `all`，避免升级后用户误以为记录消失。
3. 模式切换提示：
   - 从 `all` 切到 `self-only` 时，提示“仅影响拉取显示范围，不删除远端数据”。

## 7. 改造范围评估

预估改动文件：

- `src/types/records.ts`（记录字段）
- `src/types/config.ts`（同步模式配置）
- `src/services/localStorageService.ts`（设备身份存储）
- `src/stores/appStore.ts`（生成字段、拉取过滤、初始化）
- `src/services/githubService.ts`（记录字段透传）
- `src/views/HomeView.vue` / `src/views/SettingsView.vue`（设置入口）
- `src/views/GuideView.vue` / `README.md`（行为说明）

工作量估计：

- Phase 1：约 0.5~1.5 天（含联调与回归）
- Phase 2：约 1~2 天（取决于 profile 隔离方案）

## 8. 风险与注意事项

1. 清缓存会生成新 `deviceId`，需给用户可编辑 `deviceName` 作为可读标识。
2. 当前同步模型本身不处理跨设备“编辑覆盖/删除传播”，若你希望强一致，需要另立专题。
3. 不建议上传完整 UA 指纹，避免隐私与不稳定性问题。

## 9. 你现在需要拍板的 4 个决策

1. 本期只做记录隔离，还是连 profile/avatar 一起做？
2. `self-only` 模式下，历史（无设备字段）记录是否继续显示？
3. 默认模式是否保持 `all`？
4. 设备标识是否允许用户在设置页重命名？

---

## 结论（简版）

可实现，且推荐先做「方案 A + Phase 1」：  
即先加设备字段并按拉取策略过滤，成本低、风险可控、能快速满足“同仓库下可选择同步或不同步”的核心诉求。
