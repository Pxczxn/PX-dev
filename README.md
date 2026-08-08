# PX Dev

> 本地开发环境与项目进程管理工具

## 技术栈

- **Electron** + **electron-vite** — 桌面应用框架
- **Vue 3** + **TypeScript** — Renderer UI
- **Naive UI** — 组件库
- **Pinia** — 状态管理
- **Zod** — 运行时 schema 校验
- **tree-kill** — 跨平台进程树终止
- **Vitest** — 单元测试

## 开发命令

```bash
# 安装依赖
npm install

# 开发模式（启动 Electron + 热重载）
npm run dev

# 类型检查
npm run typecheck

# Lint
npm run lint

# 单元测试
npm test

# 构建
npm run build

# 打包为安装包
npm run build:win
```

## 目录结构

```
px-dev/
├─ src/
│  ├─ main/          # Main Process (Node.js)
│  ├─ preload/       # Preload (contextBridge)
│  └─ renderer/      # Renderer (Vue 3)
├─ shared/           # 三端共享类型/Schema/常量
├─ tests/            # 单元测试
└─ docs/             # 设计文档
```

## 架构设计

详见 `docs/system_design.md`
