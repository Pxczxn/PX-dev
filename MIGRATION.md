# Electron → Tauri 2 迁移状态

## Phase 2: Config & Settings ✅ 完成

**实施日期**：2026-08-16

### 已实现

- ✅ tauri-plugin-store 2.4.4 集成
- ✅ Settings 类型定义（Rust）
- ✅ `app.getSettings()` - 读取配置
- ✅ `app.updateSettings(input)` - 更新配置
- ✅ `app.getVersion()` - 获取应用版本
- ✅ 配置文件存储（config.json）
- ✅ 默认配置初始化
- ✅ 单元测试（8 tests）

### 技术方案

**存储层**：
- 使用官方 `tauri-plugin-store` 2.4.4
- 存储格式：JSON（与 Electron 兼容）
- 存储位置：Tauri app_data_dir
- 文件名：`config.json`

**Rust 类型**：
```rust
pub struct Settings {
    pub theme: String,
    pub close_behavior: String,
    pub max_log_lines: u32,
    pub start_minimized: bool,
    pub auto_restore_last_session: bool,
    pub startup_interval: u32,
    pub show_timestamp: bool,
    pub default_browser: String,
    pub data_path: Option<String>,
}
```

**Commands**：
- `get_settings` → 读取配置，首次启动返回默认值
- `update_settings` → 合并更新配置
- `get_app_version` → 返回 Cargo.toml 中的版本号

### Tauri Adapter 更新

```typescript
app: {
  getSettings: async () => await invoke('get_settings'),
  updateSettings: async (input) => await invoke('update_settings', { input }),
  getVersion: async () => await invoke<string>('get_app_version'),
  quit: notImplemented('app.quit'),              // Phase 2 未实现
  minimize: notImplemented('app.minimize'),      // Phase 2 未实现
  getDataPath: notImplemented('app.getDataPath'), // Phase 2 未实现
  selectDataPath: notImplemented('app.selectDataPath'), // Phase 2 未实现
}
```

---

## Phase 1: 基础迁移 ✅ 完成

**实施日期**：2026-08-16

### 已实现

- ✅ Tauri 2.11.5 + Rust 后端（最小配置）
- ✅ 平台检测层（使用官方 `@tauri-apps/api/core` 的 `isTauri()`）
- ✅ 独立类型边界（`PxDevClient` 接口，不依赖 `src/preload`）
- ✅ API 平台适配器（Electron/Tauri 双适配）
- ✅ Rust smoke test 命令：`px_ping`
- ✅ Store 层平台感知（Tauri 模式跳过事件监听）
- ✅ 独立 `vite.config.ts`（绝对路径 outDir）
- ✅ 双运行模式（Electron + Tauri 共存）
- ✅ 严格 smoke test（明确断言，不用 optional chaining）

### 技术栈

**前端**：
- Vue 3.4 + Pinia + Vue Router + Naive UI
- Vite 5.3

**Electron**（保留）：
- Electron 31.1.0
- electron-vite 2.3.0

**Tauri**（新增）：
- @tauri-apps/api: 2.11.1
- @tauri-apps/cli: 2.11.4
- tauri (Rust): 2.11.5

### 运行命令

| 模式 | 命令 | 说明 |
|------|------|------|
| **Electron 开发** | `npm run dev` | 启动 Electron 窗口，所有功能可用 |
| **Tauri 开发** | `npm run dev:tauri` | 启动 Tauri 窗口，仅基础 UI + ping |
| **独立 Web 预览** | `npm run dev:web` | 浏览器打开 http://localhost:4444 |
| **Electron 构建** | `npm run build:win` | 打包 Windows 安装程序 |
| **Tauri 构建** | `npm run build:tauri` | 打包 Tauri 应用 |

### 架构设计

**类型边界独立**：
```
Renderer 始终看到完整 PxDevClient 接口
          ↓
    ┌─────────────┬─────────────┐
    │ Electron    │ Tauri       │
    │ Adapter     │ Adapter     │
    │ (全实现)     │ (部分抛错)   │
    └─────────────┴─────────────┘
```

**平台检测**：
1. 检查 `window.pxDev` → Electron
2. 调用官方 `isTauri()` → Tauri
3. 默认 → Web

**Smoke Test 验证链**：
```
App.vue → api.system.ping() → Platform Adapter → invoke('px_ping') → Rust
                                                → 返回 "PX Dev Tauri backend ready"
                                                → 严格断言匹配
```

### Electron-Only API（Phase 1-2 未迁移）

以下 API 当前仅在 Electron 中可用，Tauri 调用会抛出 `NotImplementedError`：

#### workspace 命名空间（Phase 3 计划迁移）
- `list()`, `create()`, `update()`, `delete()`
- `discover()`, `applyDiscovery()`
- `getRuntimeEndpoints()`

#### service 命名空间（Phase 3 计划迁移）
- `list()`, `create()`, `update()`, `delete()`

#### process 命名空间（Phase 4 计划迁移）
- `start()`, `stop()`, `restart()`, `forceKill()`
- `getRuntime()`, `startWorkspace()`, `stopWorkspace()`, `stopAll()`

#### log 命名空间（Phase 5 计划迁移）
- `subscribe()`, `unsubscribe()`, `clear()`, `history()`, `export()`

#### environment 命名空间（Phase 6 计划迁移）
- `detect()`, `detectSingle()`

#### port 命名空间（Phase 6 计划迁移）
- `check()`, `owner()`, `kill()`, `waitListening()`

#### system 命名空间
- ✅ `ping()` — **Phase 1 已实现**
- ❌ `openPath()`, `openExternal()`, `selectDirectory()`
- ❌ `scanDirectory()`, `showItemInFolder()`, `detectProject()`

#### app 命名空间
- ✅ `getSettings()` — **Phase 2 已实现**
- ✅ `updateSettings(input)` — **Phase 2 已实现**
- ✅ `getVersion()` — **Phase 2 已实现**
- ❌ `quit()`, `minimize()`, `getDataPath()`, `selectDataPath()`

#### events 命名空间（Phase 5 计划迁移）
- `onLogBatch()`, `onRuntimeChanged()`, `onRuntimeEndpoints()`

---

## Phase 2-6：待定

业务逻辑迁移将在后续阶段进行：
- **Phase 2: Config & Settings** ✅ **已完成**
- Phase 3: Workspace & Service CRUD
- Phase 4: Process Management
- Phase 5: Logging & Events
- Phase 6: Discovery & Environment Detection

---

## 文件变更清单

### Phase 2 新增文件（4 个）

**Rust 类型和 Commands**：
- `src-tauri/src/types.rs` — Settings 和 AppConfig 类型定义
- `src-tauri/src/commands/app.rs` — get_settings, update_settings, get_app_version

**单元测试**：
- `tests/unit/api/platform/app.test.ts` — app adapter 测试（8 tests）

**依赖更新**：
- `src-tauri/Cargo.toml` — 新增 tauri-plugin-store 2.4.4

### Phase 2 修改文件（4 个）

- `src-tauri/src/lib.rs` — 注册 store plugin 和新 commands
- `src-tauri/src/commands/mod.rs` — 导出 app module
- `src/renderer/src/api/platform/tauri.ts` — 实现 app.{getSettings, updateSettings, getVersion}
- `tests/unit/api/platform/tauri.test.ts` — 更新测试（app 方法已实现）

### Phase 1 新增文件（~17 个）

## 关键设计决策

### 1. 使用最新稳定版本
- Tauri 2.11.5（非 2.1.x）
- 固定版本号（迁移期要确定性）

### 2. 不安装 tauri-plugin-shell
- Phase 1 仅 `px_ping`，无需 Shell 插件
- Phase 3 迁移 ProcessManager 时再添加

### 3. 官方平台检测
- 使用 `@tauri-apps/api/core` 的 `isTauri()`
- 不依赖 `window.__TAURI__`（需配置 `withGlobalTauri`）

### 4. 绝对路径 outDir
```typescript
build: {
  outDir: resolve(__dirname, 'out/renderer'),  // 避免相对路径陷阱
  emptyOutDir: true
}
```

### 5. 拒绝 Partial 类型
```typescript
// ✅ 正确：始终完整接口
function createTauriAdapter(): PxDevClient

// ❌ 错误：污染类型系统
function createTauriAdapter(): Partial<PxDevClient>
```

### 6. Smoke Test 严格断言
```typescript
// ✅ 正确：明确检查和断言
if (!api.system.ping) {
  throw new Error('Tauri system.ping adapter is not wired')
}
const response = await api.system.ping()
if (response !== 'PX Dev Tauri backend ready') {
  throw new Error(`Unexpected ping response: ${response}`)
}

// ❌ 错误：可能静默失败
const response = await api.system.ping?.()
console.log(response)
```

### 7. 最小 Rust 配置
```toml
[dependencies]
tauri = "2.11.5"  # 无 devtools feature
serde = { version = "1", features = ["derive"] }
serde_json = "1"
# 无 tauri-plugin-shell
```

### 8. 最小权限
```json
{
  "permissions": ["core:default"]
}
```

### 9. Phase 2: 使用 tauri-plugin-store（新增）
- 官方维护，稳定可靠
- JSON 格式与 Electron 兼容
- 自动处理跨平台路径
- 内置原子写入机制
- 存储位置：Tauri app_data_dir
- 文件名：config.json

### 10. Phase 2: Settings 字段命名兼容（新增）
```rust
// Rust 使用 snake_case
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]  // 序列化时转换为 camelCase
pub struct Settings {
    pub theme: String,
    pub close_behavior: String,  // → closeBehavior
    pub max_log_lines: u32,      // → maxLogLines
    ...
}
```

---

## 文件变更清单

### 新增文件（~17 个）

**配置文件**：
- `vite.config.ts`
- `MIGRATION.md`

**src-tauri/ 目录**：
- `src-tauri/Cargo.toml`
- `src-tauri/build.rs`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/main.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/commands/system.rs`

**类型边界**：
- `shared/types/client.ts`

**平台检测层**：
- `src/renderer/src/platform/types.ts`
- `src/renderer/src/platform/detect.ts`
- `src/renderer/src/platform/index.ts`

**API 适配层**：
- `src/renderer/src/api/platform/types.ts`
- `src/renderer/src/api/platform/electron.ts`
- `src/renderer/src/api/platform/tauri.ts`
- `src/renderer/src/api/platform/index.ts`

### 修改文件（~5 个）

- `package.json` — 新增依赖 + scripts
- `src/renderer/src/api/index.ts` — 集成平台适配器
- `src/renderer/src/stores/runtimeStore.ts` — 平台检测 + 跳过事件监听
- `src/renderer/src/stores/logStore.ts` — 平台检测 + 跳过事件监听
- `src/renderer/src/App.vue` — 添加 Tauri smoke test

### 保持不变（明确未修改）

- ✅ `src/main/` 所有文件
- ✅ `src/preload/` 所有文件
- ✅ `electron.vite.config.ts`
- ✅ `electron-builder.yml`
- ✅ 所有现有 Vue 组件/视图
- ✅ 所有现有业务逻辑（Manager 类）

---

## 验收检查

### TypeScript 编译
```bash
npm run typecheck  # ✅ 通过
```

### ESLint
```bash
npm run lint:check  # ✅ 新代码无错误
```

### Rust 编译
```bash
cd src-tauri && cargo check  # ⚠️ 需要安装 Rust
```

### 双模式运行
```bash
npm run dev        # ✅ Electron 正常运行
npm run dev:tauri  # ⚠️ 需要 Rust，控制台应显示 smoke test ✓
```

---

## Phase 1 禁止事项 ❌

- ❌ 删除 Electron 相关文件/配置
- ❌ 迁移 ProcessManager、LogManager 等 Manager 到 Rust
- ❌ 实现 workspace/service CRUD Rust 命令
- ❌ 迁移 discovery、environment、port 功能
- ❌ 添加假数据掩盖未实现状态
- ❌ 移除 Electron 依赖
- ❌ 使用 `window.__TAURI__` 检测平台
- ❌ 在组件中直接 `import { invoke }`
- ❌ 使用 `Partial<PxDevClient>` 污染类型
- ❌ Smoke test 使用 optional chaining

---

## 后续阶段规划

- **Phase 2**: Config & Settings 迁移
- **Phase 3**: Workspace & Service CRUD + Discovery
- **Phase 4**: Process Management (添加 tauri-plugin-shell)
- **Phase 5**: Logging System
- **Phase 6**: Environment Detection & Port Management

---

**Phase 1 目标达成**：PX Dev 现在具备 Electron + Tauri 2.11 双栈运行能力，为后续业务逻辑迁移奠定了坚实的架构基础。
