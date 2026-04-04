# PAT 迁移到后端处理（后端不存储）实施文档
更新时间：2026-04-01

## 1. 结论
可以迁移，而且是更合理的方向。

但要注意一个关键点：
- 如果只把“加密”搬到后端，而 GitHub API 仍由前端直连，那么前端迟早还是要拿到明文 PAT，安全收益非常有限。
- 真正可落地的方案是：前端只保存“密文 PAT”，所有 GitHub 请求改为走后端代理；后端每次请求中临时解密并转发给 GitHub，完成后立即丢弃，不做任何持久化。

这满足你的要求：后端不存储，只处理。

补充结论：
- 可以把加解密逻辑都放到后端。
- 可以对业务参数再做一层“应用层加密/密封”，但它主要提升混淆和日志暴露防护，不替代 HTTPS。
- 运行时明文无法做到绝对 0（GitHub 接口最终需要明文 Bearer），但可以把暴露窗口缩到“单请求、短时、仅内存”。

## 2. 当前现状（本仓库）
当前 PAT 相关链路主要在以下文件：
- `src/services/githubTokenVaultService.ts`：前端本地“可逆转换”存储。
- `src/stores/appStore.ts`：`state.githubToken` 持有明文 token，并传给 GitHub 服务层。
- `src/services/githubService.ts`：前端直接携带 `Authorization: Bearer <PAT>` 调 GitHub API。
- `src/views/SettingsView.vue`：设置页录入 PAT。

这意味着：
- PAT 明文会进入前端运行时内存。
- GitHub API 直连时，浏览器端直接持有并使用 PAT。

## 3. 目标与边界
目标：
- 前端不再持久化明文 PAT，只存密文（sealed token）。
- 前端不再直接调用 GitHub API，而是调用你的 Render 后端。
- 后端无数据库、无文件落盘、无 token 持久缓存；仅在单次请求内临时解密处理。

非目标：
- 后端替你长期托管 PAT。
- 绕过浏览器被 XSS 后的全部风险（XSS 仍可利用当前会话发请求）。

### 3.1 你这次问题的直接回答
1. 可以将加解密逻辑都放后端吗？
- 可以，且推荐这样做。

2. 参数再加一层加解密是否更好？
- 可以做，但要明确收益：主要是“额外混淆 + 降低中间层日志明文暴露概率”。
- 这不是核心安全边界，核心边界仍是 `HTTPS + 后端鉴权 + 严格日志脱敏`。

3. 不存储的前提下，能否解决运行时明文问题？
- 无法彻底消除，但可以显著降低风险。
- 原因是：调用 GitHub 时，`Authorization: Bearer <PAT>` 必须在某个时刻以明文出现在进程内存中。

## 4. 目标架构（无存储）
数据流分两段：

1) PAT 入库（前端本地仅存密文）
- 前端用户输入 PAT。
- 前端调用 `POST /api/token/seal`（HTTPS）。
- 后端用服务端密钥加密后返回 `sealedToken`。
- 前端仅保存 `sealedToken` 到 localStorage（或 IndexedDB），不保存明文。

2) GitHub 业务请求
- 前端发业务请求到后端（附带 `sealedToken` + 业务参数）。
- 后端在内存中解密 PAT，调用 GitHub REST API，返回结果。
- 请求结束后丢弃明文变量，不写库、不落盘。

## 5. 后端改造（建议）
基于现有 `backend/src/server.mjs` 增加以下接口。

### 5.1 Token 密封接口
`POST /api/token/seal`

请求：
```json
{
  "pat": "<github-pat-token>"
}
```

响应：
```json
{
  "ok": true,
  "sealedToken": "<base64url-payload>",
  "keyVersion": "v1"
}
```

约束：
- `pat` 只在请求内存中使用。
- 禁止记录请求体日志。
- 仅允许 HTTPS + 受信任 Origin（`CORS_ORIGINS`）。

### 5.2 GitHub 代理接口（最小集）
建议先做三个通用接口，覆盖你现有 `githubService.ts` 大部分能力：

1. `POST /api/github/contents/get`
2. `POST /api/github/contents/put`
3. `POST /api/github/contents/list`

通用请求字段（示例）：
```json
{
  "sealedToken": "<sealed>",
  "owner": "xxx",
  "repo": "xxx",
  "branch": "records/live-data",
  "path": "data/records/records/xxx.json"
}
```

后端行为：
- 解密 `sealedToken` 得到 PAT（仅内存）。
- 构造 GitHub API 请求并转发。
- 返回必要业务结果，不把 PAT 回传给前端。

### 5.3 加密实现建议
建议使用 Node `crypto` 的 `AES-256-GCM`：
- 环境变量：`PAT_WRAP_KEY_BASE64`（32 字节主密钥，Base64 编码）
- 每次 seal 生成随机 `iv`（12 字节）
- 结果包含：`keyVersion`、`iv`、`ciphertext`、`tag`、`iat`
- 使用 `base64url` 输出 payload

可选增强：
- 在密文中加入 `exp`（过期时间）减少长期泄漏风险。
- 支持 `keyVersion` 轮换（`v1`,`v2`）。

### 5.4 参数加密（应用层）可选方案
如果你希望“参数也再加一层”，建议采用“会话公钥 + 请求信封”模式：

1. `POST /api/crypto/session`
- 后端生成短期会话（例如 5 分钟有效），返回 `sessionId + publicKey + expiresAt`。

2. 前端用 `publicKey` 加密业务 payload
- 发送给后端：`{ sessionId, encryptedPayload }`。

3. 后端用私钥解密后再执行业务
- 包括解析 `sealedToken`、调用 GitHub、回包。

注意：
- 这是“应用层额外保护”，不是 HTTPS 的替代品。
- 若前端被 XSS 控制，攻击者依然可利用当前会话调用接口。
- 因此该层应视为“加分项”，不是“核心安全项”。

## 6. 前端改造（迁移步骤）
建议分阶段，避免一次改太多。

### 阶段 A：引入后端密封，但暂不删旧逻辑
1. 新增 `src/services/backendPatVaultService.ts`
   - `sealGithubToken(pat: string): Promise<{ sealedToken: string; keyVersion: string }>`
2. 新增本地存储键（示例）
   - `car-journal-github-token-sealed-v1`
3. 调整设置页保存逻辑（`src/views/SettingsView.vue`）
   - 用户点击保存时，将输入 PAT 发到 `/api/token/seal`
   - 成功后仅存 `sealedToken`
   - 清空输入框
4. `appStore` 状态改造
   - 从 `githubToken`（明文）迁移为 `githubTokenSealed`

### 阶段 B：GitHub 请求全部改走后端
1. 新增 `src/services/backendGithubService.ts`
2. 将 `src/services/githubService.ts` 的调用入口逐步替换为后端代理调用
3. 让 `store` 同步流程只传 `sealedToken`，不再读取明文 token

### 阶段 C：清理旧前端可逆转换方案
1. 下线 `src/services/githubTokenVaultService.ts` 的读写入口
2. 执行一次迁移脚本：
   - 如果检测到旧 token（明文或旧 vault），提示用户重新输入 PAT 并重新密封
3. 更新 UI 文案：
   - “Token 不在浏览器明文保存；由后端临时解密处理，不落盘”

## 7. 环境变量与部署
后端新增环境变量（Render）：
- `PAT_WRAP_KEY_BASE64=<32-byte-key-in-base64>`
- `PAT_WRAP_KEY_VERSION=v1`
- `CORS_ORIGINS=<你的前端 origin 列表>`
- `APP_VERSION=<可选>`

注意：
- `CORS_ORIGINS` 必须是 origin，不带路径。
- 所有请求必须走 `https://`。

## 8. 安全与合规注意事项
必须做：
- 禁止记录 `pat` / `sealedToken` / `Authorization` 到日志。
- 对请求体大小设限（例如 32KB）。
- 对路径参数做白名单或严格校验（防止越权写仓库路径）。
- 对错误信息脱敏（不要回显 GitHub 原始敏感头）。

建议做：
- 增加请求频率限制（按 IP + Origin）。
- 为代理接口增加业务级操作白名单（只允许项目需要的 GitHub API）。
- 对 `sessionId` / `nonce` 做一次性校验，防重放。
- 关键接口增加时间窗签名（`timestamp + nonce + HMAC`）。

### 8.1 运行时明文最小化（无存储前提）
下面措施不需要后端存储，也能显著收敛风险：

1. 解密“晚一点”
- 在真正发 GitHub 请求前一刻才解密，不提前放入全局状态。

2. 生命周期“短一点”
- 明文 token 只存在于单函数局部变量，响应结束立即释放引用。

3. 覆写“快一点”
- 对 `Buffer` 形式敏感字节在使用后执行 `fill(0)`（尽力而为）。

4. 暴露面“少一点”
- 禁止调试日志、错误堆栈、监控面板输出敏感字段。

5. 权限“窄一点”
- PAT 权限最小化，建议仅开 `Contents: Read and write` 等必要权限。

## 9. 验收清单
- [ ] 设置页输入 PAT 后，本地只出现 `sealedToken`，不出现明文 PAT。
- [ ] 浏览器 Network 面板中，不再有前端直连 `api.github.com` 的业务请求。
- [ ] 后端日志中不出现 PAT 或密文 token。
- [ ] 同步记录、拉取记录、头像/铃声同步都可通过后端代理正常执行。
- [ ] 清空缓存后，sealed token 可按选项清除或保留。

## 10. 回滚方案
若迁移中断，可临时回滚到现有模式：
- 保留旧 `githubService.ts` 直连路径（feature flag 控制）。
- 新增配置开关示例：`useBackendGithubProxy`。
- 仅在后端稳定后再切换默认值。

## 11. 关键提醒
“后端不存储”不等于“零风险”：
- 如果前端存在 XSS，攻击者仍可借当前会话调用你的后端代理。
- 但该方案显著降低了“PAT 明文长期滞留在浏览器本地存储”的风险，并统一了调用治理点（限流、审计、白名单）到后端。

## 12. 推荐落地优先级
1. 必做（先上线）
- 前端只存 `sealedToken`
- GitHub 调用全部改后端代理
- 后端临时解密、绝不持久化
- 全链路日志脱敏 + HTTPS + CORS + 限流

2. 次优先（第二阶段）
- 请求签名（`timestamp + nonce + HMAC`）
- `sealedToken` 过期与密钥轮换

3. 进阶（第三阶段）
- 参数应用层加密（会话公钥/信封）
- 更细粒度的仓库路径白名单与操作策略
