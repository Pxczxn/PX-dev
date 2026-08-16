# Electron → Tauri 2 迁移状态

## Phase 2: Config & Settings ✅ 完成（增强版）

**实施日期**：2026-08-16  
**最后更新**：2026-08-16（架构增强）

### 已实现

- ✅ tauri-plugin-store 2.4.4 集成（精确版本锁定）
- ✅ **ConfigStore 统一配置管理层**
- ✅ **类型安全的 Settings（Theme/CloseBehavior 枚举）**
- ✅ **SettingsPatch 类型（替代手写 match）**
- ✅ **Settings 校验（范围检查：maxLogLines 500-50000, startupInterval 0-30000）**
- ✅ `app.getSettings()` - 读取配置
- ✅ `app.updateSettings(input)` - 更新配置
- ✅ `app.getVersion()` - 获取应用版本
- ✅ 配置自动初始化（version + settings + workspaces + services）
- ✅ Rust 单元测试（7 tests）
- ✅ TypeScript 单元测试（8 tests）

### 技术方案

**架构分层**：
```
Commands (app.rs)
    ↓
ConfigStore (统一配置管理)
    ↓ ensure_initialized()
    ↓ get_settings()
    ↓ update_settings(patch)
tauri-plugin-store
    ↓
config.json
```

**ConfigStore 职责**：
- ✅ 统一配置初始化（逐字段补缺失，而非仅检查 version flag）
- ✅ 防止部分初始化问题（无论先调用 get 还是 update）
- ✅ 自动版本迁移（`open()` 时自动调用 `migrate_if_needed()`）
- ✅ Settings 校验和默认值应用
- ✅ 为 Phase 3 Workspace/Service CRUD 提供基础

**ConfigStore 架构保证**：
```rust
impl ConfigStore {
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        // 1. 打开 store
        // 2. ensure_initialized() — 逐字段补缺失
        //    - version 不存在 → 补
        //    - settings 不存在 → 补
        //    - workspaces 不存在 → 补
        //    - services 不存在 → 补
        // 3. migrate_if_needed() — 自动版本迁移
        // 4. 返回已初始化 + 已迁移的 ConfigStore
    }
}

// Commands 只需调用 ConfigStore::open()，无需关心初始化
```

**类型安全**：
```rust
// 枚举类型，编译期检查
pub enum Theme { Light, Dark, System }
pub enum CloseBehavior { Tray, Quit, Ask }

// SettingsPatch：部分更新专用类型
pub struct SettingsPatch {
    pub theme: Option<Theme>,
    pub close_behavior: Option<CloseBehavior>,
    pub max_log_lines: Option<u32>,
    ...
}

// 自动校验
impl Settings {
    pub fn validate(&mut self) -> Result<(), String> {
        // maxLogLines: 500 ~ 50000
        // startupInterval: 0 ~ 30000
    }
}
```

**serde 自动转换**：
```rust
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]  // Rust snake_case ↔ JSON camelCase
pub struct Settings { ... }

#[serde(rename_all = "lowercase")]  // Theme::Dark → "dark"
pub enum Theme { ... }
```

### Commands 实现

**简化的 Command 层**（不再关心初始化逻辑）：
```rust
#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<Settings, String> {
    let store = ConfigStore::open(&app)?;
    store.get_settings()  // 自动 ensure_initialized
}

#[tauri::command]
pub async fn update_settings(
    app: AppHandle,
    input: serde_json::Value,
) -> Result<Settings, String> {
    let store = ConfigStore::open(&app)?;
    let patch: SettingsPatch = serde_json::from_value(input)?;
    store.update_settings(patch)  // 自动校验 + 保存
}
```

### 测试覆盖

**Rust 单元测试（7 tests）**：
- ✅ Settings 默认值
- ✅ maxLogLines 范围校验（500-50000）
- ✅ startupInterval 范围校验（0-30000）
- ✅ SettingsPatch 应用逻辑
- ✅ Theme/CloseBehavior serde 序列化
- ✅ ConfigStore version 常量

**TypeScript 单元测试（8 tests）**：
- ✅ getSettings 调用
- ✅ updateSettings 调用
- ✅ getVersion 调用
- ✅ 未实现方法抛出 NotImplementedError
- ✅ Phase 1 px_ping 仍然工作

### 已知限制（Phase 2）

**配置损坏恢复**（未实现，非阻塞）：
- Electron ConfigManager 有 `config.json → config.json.bak → DEFAULT_CONFIG` 降级机制
- Rust ConfigStore 当前配置反序列化失败直接返回 Error
- 未来可独立补充，不影响当前迁移进度

**为 Phase 3 的要求**：
- ✅ **必须通过 ConfigStore 访问配置**（禁止 `app.store()` 直接访问）
- ✅ Workspace/Service CRUD 都应调用 `ConfigStore::open()` 获取实例
- ✅ 避免每个 Command 重复初始化逻辑

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

### Phase 2 新增文件（6 个）

**Rust 架构层**：
- `src-tauri/src/types.rs` — Settings/SettingsPatch/Theme/CloseBehavior 类型 + 校验逻辑 + 7 个单元测试
- `src-tauri/src/config/mod.rs` — 配置管理模块入口
- `src-tauri/src/config/store.rs` — ConfigStore 统一配置管理层

**Commands**：
- `src-tauri/src/commands/app.rs` — get_settings, update_settings, get_app_version（简化版，委托给 ConfigStore）

**单元测试**：
- `tests/unit/api/platform/app.test.ts` — app adapter 测试（8 tests）

**依赖更新**：
- `src-tauri/Cargo.toml` — 精确锁定 tauri-plugin-store =2.4.4

### Phase 2 修改文件（4 个）

- `src-tauri/src/lib.rs` — 导出 config 模块
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
    pub theme: Theme,                // → theme
    pub close_behavior: CloseBehavior, // → closeBehavior
    pub max_log_lines: Option<u32>,  // → maxLogLines
    ...
}
```

### 11. Phase 2: ConfigStore 统一初始化（新增）
- 所有 Commands 通过 `ConfigStore::open()` 访问配置
- `ensure_initialized()` 确保 version/settings/workspaces/services 完整
- 防止部分初始化问题（无论先调用哪个 API）
- 为 Phase 3 Workspace/Service CRUD 提供统一入口

### 12. Phase 2: 类型安全校验优于运行时检查（新增）
```rust
// ✅ 正确：编译期类型检查
pub enum Theme { Light, Dark, System }
pub enum CloseBehavior { Tray, Quit, Ask }

// ❌ 错误：运行时字符串检查
pub struct Settings {
    pub theme: String,  // 可能是 "西红柿炒鸡蛋"
    pub close_behavior: String,
}
```

### 13. Phase 2: SettingsPatch 专用类型（新增）
```rust
// 部分更新专用类型，所有字段 Option
pub struct SettingsPatch {
    pub theme: Option<Theme>,
    pub max_log_lines: Option<u32>,
    ...
}

impl SettingsPatch {
    pub fn apply_to(&self, settings: &mut Settings) {
        // 只更新提供的字段
    }
}
```

### 14. Phase 2: Settings 范围校验（新增）
- maxLogLines: 500 ~ 50000（与 Electron Zod 校验一致）
- startupInterval: 0 ~ 30000（与 Electron Zod 校验一致）
- 非法值拒绝并返回错误，保持 Electron/Tauri 语义一致

### 15. Phase 2: Rust 单元测试与 npm test 平等（新增）
- `cargo test` — 7 tests（types + config）
- `npm test` — 24 tests（platform + api）
- 后续每个 Phase 都需要同时维护两侧测试

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
