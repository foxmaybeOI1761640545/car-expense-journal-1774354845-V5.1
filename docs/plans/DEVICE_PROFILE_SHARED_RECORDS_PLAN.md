# 同仓库多设备：设备资料隔离 + 记录共享一致 方案设计

更新时间：2026-03-26

## 1. 目标定义（按你给出的场景）

同一个用户在不同设备使用同一个 `githubOwner/repo/branch/recordsDir` 时：

1. 设备资料隔离  
   每台设备可以有不同的昵称、头像、个性化信息、当前位置等。
2. 业务记录共享一致  
   加油/耗油记录在设备间保持一致（新增、修改、删除都能同步）。

## 2. 当前实现与核心缺口

## 2.1 当前实现

1. 用户资料是单份文件  
   `data/records/user-profile/profile.json`（固定路径，不区分设备）。
2. 记录为追加文件  
   `data/records/<unix>-<recordId>.json`（同 id 可能出现多个版本）。
3. 拉取逻辑是导入 + 去重  
   主要按 `record.id` 去重，偏“新增同步”，不是完整双向一致。

## 2.2 与目标的差距

1. 资料无法按设备隔离（天然互相覆盖）。
2. 记录修改/删除无法稳定传播（只靠新增和 id 去重不够）。

## 3. 推荐总体架构（建议采用）

把数据拆成两个域：

1. `Device-scoped`（设备域，隔离）
   - 用户资料（昵称、头像、位置、个性化字段）
2. `Shared`（共享域，一致）
   - 加油/耗油记录
   - 与记录一致性相关的删除标记/版本信息

## 4. 存储结构设计（同一仓库内）

以 `recordsDir = data/records` 为例：

```text
data/records/
  records/                                  # 共享记录（新结构）
    <recordId>.json
  record-tombstones/                        # 共享删除标记（可选但推荐）
    <recordId>.json
  user-profile/
    devices/                                # 设备隔离资料
      <deviceId>/
        profile.json
        avatars/
          avatar-<unix>.png
    index.json                              # 设备索引（可选，建议）
```

兼容旧结构：

- 继续读取根目录旧记录文件 `data/records/*.json`（排除已知系统目录）。
- 继续兼容旧 profile：`data/records/user-profile/profile.json`（仅作为迁移来源）。

## 5. 数据模型建议

## 5.1 本地设备标识（只存在本地）

```ts
interface DeviceMeta {
  deviceId: string;       // 首次启动生成 UUID，持久化 localStorage
  deviceName: string;     // 用户可改，如“我的手机”
  createdAt: string;
  updatedAt: string;
}
```

说明：

- 不使用硬件唯一 ID（浏览器不可可靠获取，也有隐私问题）。
- 清缓存后会变新设备（正常行为，需 UI 提示）。

## 5.2 设备资料（远端按设备存）

`user-profile/devices/<deviceId>/profile.json`：

```ts
interface DeviceProfilePayload {
  schemaVersion: 2;
  deviceId: string;
  deviceName?: string;
  displayName: string;
  email?: string;
  phone?: string;
  location?: string;
  bio?: string;
  avatarStyle: 'round' | 'square';
  avatarPath?: string;
  avatarMimeType?: string;
  avatarUpdatedAt?: string;
  updatedAt: string;
}
```

## 5.3 共享记录（建议升级）

建议把记录改成“稳定文件路径 + 更新时间”：

```ts
interface SharedRecordEnvelope {
  schemaVersion: 2;
  recordId: string;
  updatedAt: string;
  updatedAtUnix: number;
  sourceDeviceId: string;
  sourceDeviceName?: string;
  deleted?: boolean; // 可选，若放 tombstone 文件可不放这里
  data?: FuelRecord | TripRecord;
}
```

文件路径：

- `records/<recordId>.json`

删除时：

- 写入 `record-tombstones/<recordId>.json`，包含 `deletedAtUnix`、`sourceDeviceId`。

## 6. 同步策略设计

## 6.1 设备资料同步（隔离）

1. 同步到 GitHub（当前设备）
   - 只写当前 `deviceId` 路径。
2. 从 GitHub 拉取（当前设备）
   - 只读当前 `deviceId` 路径。
3. 当前设备路径不存在时
   - 若存在 legacy `user-profile/profile.json`，作为初始化来源并提示“是否迁移到本设备资料”。

结果：

- A 设备和 B 设备互不覆盖昵称/头像/位置。

## 6.2 记录同步（共享一致）

1. 新增/修改
   - 始终写 `records/<recordId>.json`，覆盖同一 id 文件（带 sha 更新）。
2. 删除
   - 写 `record-tombstones/<recordId>.json`。
3. 拉取
   - 读取 `records/` 全量。
   - 读取 `record-tombstones/`。
   - 以 `recordId` 为键合并，按 `updatedAtUnix/deletedAtUnix` 决定最终状态。
4. 本地落地
   - 最终状态是删除 -> 本地删除该记录。
   - 最终状态是存在 -> 本地 upsert（不是仅新增）。

## 7. 冲突处理规则（必须定义）

## 默认规则（推荐）

1. Last Write Wins（按 `updatedAtUnix`）。
2. 并发冲突（PUT 返回 409）
   - 先 GET 最新远端。
   - 若远端更新时间更新 -> 本地标记冲突并提示“远端更新已存在，请重新编辑”。
   - 若本地更“新” -> 允许用户点击“强制覆盖提交”。

## 8. 迁移策略（避免一次性大爆炸）

## Phase A：先上设备资料隔离（低风险）

1. 新增 `deviceId/deviceName` 本地存储。
2. profile/avatar 改为设备路径。
3. legacy profile 读取兼容。

## Phase B：再上记录一致性升级（中风险）

1. 新增 `records/<id>.json` 写入通道。
2. 拉取逻辑支持新旧双读。
3. 删除改为 tombstone。
4. 完成后可增加“历史数据迁移工具”把旧散文件整理为新结构。

## 9. 代码改造清单（按现仓库）

1. `src/types/`
   - 新增 `device.ts`
   - 扩展 `records.ts`（更新时间、源设备字段）
2. `src/services/localStorageService.ts`
   - 增加 `DeviceMeta` 读写 API
3. `src/services/githubService.ts`
   - 新增设备资料路径计算
   - profile/avatar 的 submit/fetch 支持 `deviceId`
   - 新增 records v2 路径与 tombstone API
4. `src/stores/appStore.ts`
   - 初始化设备元信息
   - `syncUserProfileToGithub/syncUserProfileFromGithub` 改为设备化
   - `syncRecordsFromGithub` 改为“upsert + 删除合并”
5. `src/views/SettingsView.vue` / `src/views/ProfileView.vue`
   - 展示“当前设备名/设备 ID（部分隐藏）”
   - 设备重命名入口
6. `src/views/GuideView.vue` + `README.md`
   - 增补同步语义文档

## 10. 验收用例（建议至少覆盖）

1. A/B 设备同仓库
   - A 设置昵称“车主手机”，B 设置“车主电脑”，互不覆盖。
2. A 新增加油记录
   - B 拉取后可见。
3. A 修改一条已有记录
   - B 拉取后同 id 数据更新。
4. A 删除一条记录
   - B 拉取后该记录消失。
5. B 清缓存重装
   - 生成新 `deviceId`，但记录拉取仍完整；资料按新设备独立保存。

## 11. 开发成本预估

1. Phase A（设备资料隔离）：0.5~1 天
2. Phase B（记录一致性升级）：1.5~2.5 天
3. 联调与回归：0.5~1 天

总计：约 2.5~4.5 天

---

## 最终建议

先做 Phase A，再做 Phase B。  
这样你可以先快速解决“同仓库下不同设备资料互相覆盖”的核心痛点，再把记录同步从“追加去重”升级到“可修改可删除的一致模型”。
