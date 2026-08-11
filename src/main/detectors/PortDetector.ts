// PX Dev — 静态端口探测原语（Phase 4，纯函数 + 只读文本）
//
// 唯一事实来源：三个 Scanner 与 WorkspaceDiscoveryManager 的端口推断全部委托本模块，
// 避免出现「Scanner 一套、discovery 另一套」的分叉。
//
// 安全红线：解析陌生项目的配置文件**只用文本正则**，
// 绝不 require()/import()/eval，绝不执行任何被扫描项目的代码。
//
// 六路来源与优先级（见 endpointPriority.ENDPOINT_PRIORITY）：
//   command(40) > config(30) > env(20) > framework-default(10)
// framework-default 恒为 low 可信度，UI 需标灰并表述为「推测端口」。
//
// 失败策略：任何一路解析不出来只是少一条候选，绝不抛错、绝不猜值（宁低勿高）。

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type {
  DetectedEndpoint,
  DetectedEndpointSource,
  DiscoveryConfidence,
  DiscoveryProjectType,
} from '@shared/types'
import { FRAMEWORK_DEFAULT_PORTS } from '@shared/constants/defaults'
import { normalizeEndpoints, pickPrimaryPort } from '../discovery/utils/endpointPriority'
import { ENV_FILE_PRIORITY, pickEnvPort } from '../discovery/utils/envFile'

/** 静态端口探测的输入上下文（全部可选字段缺失时只会少几路来源，不影响返回） */
export interface PortDetectionContext {
  /** 项目目录绝对路径（读配置文件的基准） */
  rootPath: string
  /** 推荐命令的可执行文件基名，如 'npm' / 'mvnw' */
  command?: string
  /** 推荐参数数组，如 ['run','dev'] */
  args?: string[]
  /** package.json 的 scripts（Node 项目）；命令来源会解析选中的启动脚本正文 */
  scripts?: Record<string, string>
  /** 已知存在的配置文件名列表（来自 Scanner）；命中的候选会被优先读取，减少无谓 I/O */
  configFiles?: string[]
  /** 框架标识，如 'vite' / 'spring-boot'，用于框架默认端口兜底 */
  framework?: string
  /** 项目类型，用于 Java 项目在认不出框架时仍兜底 8080（保持既有行为） */
  projectType?: DiscoveryProjectType
  /** 直接提供 .env* 内容（键为文件名），提供后该来源不再读盘（测试 / 复用） */
  envFileContent?: Record<string, string>
  /** 注入文本读取实现（入参为相对 rootPath 的 POSIX 路径），默认走 fs */
  readTextFile?: (relativePath: string) => string | undefined
}

/** 单个文件最多读取 512KB，避免误读巨型文件拖慢扫描 */
const MAX_READ_BYTES = 512 * 1024

/** Vite 配置候选名 */
const VITE_CONFIG_FILES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mts',
  'vite.config.cts',
  'vite.config.mjs',
]

/** Next / Nuxt 配置候选名 */
const META_FRAMEWORK_CONFIG_FILES = [
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'nuxt.config.ts',
  'nuxt.config.js',
  'nuxt.config.mjs',
]

/** Spring 配置候选名（顶层与标准 resources 目录都看一眼） */
const SPRING_PROPERTIES_FILES = [
  'src/main/resources/application.properties',
  'application.properties',
]

const SPRING_YAML_FILES = [
  'src/main/resources/application.yml',
  'src/main/resources/application.yaml',
  'application.yml',
  'application.yaml',
]

/** Nest 入口文件候选名（`app.listen(3000)`） */
const NEST_ENTRY_FILES = ['src/main.ts', 'src/main.js']

/** Java 项目认不出框架时的兜底端口（保持 Maven/Gradle Scanner 的既有行为） */
const JAVA_FALLBACK_PORT = 8080

/** 命令行端口参数正则；按数组顺序取第一个命中 */
const COMMAND_PORT_PATTERNS: readonly RegExp[] = [
  /--port[=\s]+(\d+)/,
  /-Dserver\.port=(\d+)/,
  /--server\.port=(\d+)/,
  /(?:^|\s)-p[=\s](\d+)(?=\s|$)/,
  // `PORT=3000 vite` 这类行内环境变量（沿用改造前 NodeProjectScanner 的能力）
  /(?:^|\s)PORT=(\d+)(?=\s|$)/,
]

/** 合法端口：1–65535 的整数 */
function toPort(raw: string | undefined): number | undefined {
  if (!raw || !/^\d+$/.test(raw)) return undefined
  const port = Number.parseInt(raw, 10)
  return port >= 1 && port <= 65535 ? port : undefined
}

/** 组装一条本地 HTTP 端点（结构固定，便于 UI 直接渲染 / 打开） */
function toEndpoint(
  port: number,
  source: DetectedEndpointSource,
  confidence: DiscoveryConfidence,
): DetectedEndpoint {
  return {
    type: 'local',
    protocol: 'http',
    host: 'localhost',
    port,
    url: `http://localhost:${port}`,
    source,
    confidence,
  }
}

/** 默认读取实现：只读文本、限制大小、任何异常都视为「文件不存在」 */
function createDefaultReader(rootPath: string): (relativePath: string) => string | undefined {
  return (relativePath: string): string | undefined => {
    const target = join(rootPath, relativePath)
    try {
      if (!existsSync(target)) return undefined
      const content = readFileSync(target, 'utf-8')
      return content.length > MAX_READ_BYTES ? content.slice(0, MAX_READ_BYTES) : content
    } catch {
      // 权限 / 长路径 / 二进制解码失败：当作没有该文件
      return undefined
    }
  }
}

/** 给读取实现套一层兜底：注入的 reader 抛错也只当作「文件不存在」 */
function toSafeReader(
  read: (relativePath: string) => string | undefined,
): (relativePath: string) => string | undefined {
  return (relativePath: string): string | undefined => {
    try {
      return read(relativePath)
    } catch {
      return undefined
    }
  }
}

// ============ 来源 1：命令行参数 ============

/**
 * 解析启动命令中的显式端口。
 * 待扫描文本 = 推荐参数 + 被推荐参数引用的 npm script 正文 + dev/start/serve 脚本正文。
 */
function collectCommandTexts(ctx: PortDetectionContext): string[] {
  const texts: string[] = []
  const args = ctx.args ?? []
  if (args.length > 0) texts.push(args.join(' '))

  const scripts = ctx.scripts ?? {}
  // `npm run dev:web` → 参数里的 dev:web 就是脚本名，取其正文继续找端口
  for (const arg of args) {
    const body = scripts[arg]
    if (body) texts.push(body)
  }
  // 兜底：dev > start > serve（与 CommandRecommender.DEV_SCRIPT_PRIORITY 一致）
  for (const name of ['dev', 'start', 'serve']) {
    const body = scripts[name]
    if (body && !texts.includes(body)) texts.push(body)
  }
  return texts
}

function fromCommand(ctx: PortDetectionContext): DetectedEndpoint[] {
  for (const text of collectCommandTexts(ctx)) {
    for (const pattern of COMMAND_PORT_PATTERNS) {
      const port = toPort(pattern.exec(text)?.[1])
      // 命令行显式写死的端口，可信度最高
      if (port !== undefined) return [toEndpoint(port, 'command', 'high')]
    }
  }
  return []
}

// ============ 来源 2：配置文件 ============

/** `server: { ... port: 5174 ... }`；不执行配置，纯文本正则 */
const VITE_SERVER_PORT_RE = /server\s*:\s*\{[^}]*?\bport\s*:\s*(\d+)/
/** `devServer: { port: 4000 }`（Nuxt2 / webpack 风格） */
const DEV_SERVER_PORT_RE = /devServer\s*:\s*\{[^}]*?\bport\s*:\s*(\d+)/
/** 兜底：任意 `port: 1234` 字面量；可能落在 preview/proxy 上，故降为 medium */
const LOOSE_PORT_RE = /\bport\s*:\s*(\d+)/

/** 把「扫描器已确认存在」的配置文件排到候选前面，其余保持原顺序 */
function orderByKnown(files: readonly string[], known?: string[]): string[] {
  if (!known || known.length === 0) return [...files]
  return [...files].sort((a, b) => Number(known.includes(b)) - Number(known.includes(a)))
}

function fromJsConfig(
  read: (file: string) => string | undefined,
  files: readonly string[],
): DetectedEndpoint[] {
  for (const file of files) {
    const content = read(file)
    if (content === undefined) continue

    const strict = toPort(VITE_SERVER_PORT_RE.exec(content)?.[1] ?? DEV_SERVER_PORT_RE.exec(content)?.[1])
    if (strict !== undefined) return [toEndpoint(strict, 'config', 'high')]

    // `port: Number(process.env.PORT) || 4000` 这类表达式命中的是兜底分支：
    // 只可能匹配到字面量数字，匹配不到就放弃（绝不猜）
    const loose = toPort(LOOSE_PORT_RE.exec(content)?.[1])
    if (loose !== undefined) return [toEndpoint(loose, 'config', 'medium')]
  }
  return []
}

/** application.properties：`server.port=8081` */
const PROPERTIES_PORT_RE = /^[ \t]*server\.port[ \t]*=[ \t]*(\d+)/m

function fromSpringProperties(read: (file: string) => string | undefined): DetectedEndpoint[] {
  for (const file of SPRING_PROPERTIES_FILES) {
    const content = read(file)
    if (content === undefined) continue
    const port = toPort(PROPERTIES_PORT_RE.exec(content)?.[1])
    if (port !== undefined) return [toEndpoint(port, 'config', 'high')]
  }
  return []
}

/**
 * 缩进感知地从 YAML 里取 `server.port`：
 * - 支持多文档（`---` 分隔）：取**第一个**命中的文档；多个文档给出不同端口时降为 medium
 * - 支持扁平键 `server.port: 8080` 与内联对象 `server: { port: 8080 }`
 * - 只认 `server:` 顶层块下的直接子键 `port:`，避免误取 `management.server.port` 之类
 */
export function parseYamlServerPort(content: string): { port: number; ambiguous: boolean } | undefined {
  const documents = content.split(/^---\s*$/m)
  const found: number[] = []

  for (const doc of documents) {
    const port = parseServerPortInDocument(doc)
    if (port !== undefined) found.push(port)
  }

  if (found.length === 0) return undefined
  const ambiguous = new Set(found).size > 1
  return { port: found[0], ambiguous }
}

function parseServerPortInDocument(doc: string): number | undefined {
  // 内联对象 / 扁平键先行
  const inline = toPort(/^[ \t]*server[ \t]*:[ \t]*\{[^}]*?\bport[ \t]*:[ \t]*(\d+)/m.exec(doc)?.[1])
  if (inline !== undefined) return inline
  const flat = toPort(/^[ \t]*server\.port[ \t]*:[ \t]*["']?(\d+)["']?/m.exec(doc)?.[1])
  if (flat !== undefined) return flat

  const lines = doc.split(/\r?\n/)
  let serverIndent = -1

  for (const rawLine of lines) {
    const line = stripYamlComment(rawLine)
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length

    if (serverIndent >= 0) {
      // 退回到同级或更外层缩进 → server 块结束
      if (indent <= serverIndent) {
        serverIndent = -1
      } else {
        const port = toPort(/^\s*port\s*:\s*["']?(\d+)["']?\s*$/.exec(line)?.[1])
        if (port !== undefined) return port
        continue
      }
    }

    if (/^\s*server\s*:\s*$/.test(line)) serverIndent = indent
  }
  return undefined
}

/** 去掉 YAML 行尾注释（简化处理：不支持引号内含 # 的极端场景，命中失败只会少一条候选） */
function stripYamlComment(line: string): string {
  const index = line.indexOf('#')
  if (index < 0) return line
  if (index === 0) return ''
  return /\s/.test(line[index - 1]) ? line.slice(0, index) : line
}

function fromSpringYaml(read: (file: string) => string | undefined): DetectedEndpoint[] {
  for (const file of SPRING_YAML_FILES) {
    const content = read(file)
    if (content === undefined) continue
    const hit = parseYamlServerPort(content)
    if (hit) return [toEndpoint(hit.port, 'config', hit.ambiguous ? 'medium' : 'high')]
  }
  return []
}

/** Nest 入口：`await app.listen(3000)` */
const NEST_LISTEN_RE = /\.listen\(\s*(\d+)/

function fromNestEntry(
  ctx: PortDetectionContext,
  read: (file: string) => string | undefined,
): DetectedEndpoint[] {
  if (ctx.framework !== 'nest') return []
  for (const file of NEST_ENTRY_FILES) {
    const content = read(file)
    if (content === undefined) continue
    const port = toPort(NEST_LISTEN_RE.exec(content)?.[1])
    // `app.listen(process.env.PORT ?? 3000)` 解析不到就跳过，medium 是因为入口可能被覆盖
    if (port !== undefined) return [toEndpoint(port, 'config', 'medium')]
  }
  return []
}

function fromConfig(
  ctx: PortDetectionContext,
  read: (file: string) => string | undefined,
): DetectedEndpoint[] {
  return [
    ...fromJsConfig(read, orderByKnown(VITE_CONFIG_FILES, ctx.configFiles)),
    ...fromJsConfig(read, orderByKnown(META_FRAMEWORK_CONFIG_FILES, ctx.configFiles)),
    ...fromSpringProperties(read),
    ...fromSpringYaml(read),
    ...fromNestEntry(ctx, read),
  ]
}

// ============ 来源 3：.env 链 ============

function fromEnv(
  ctx: PortDetectionContext,
  read: (file: string) => string | undefined,
): DetectedEndpoint[] {
  const override = ctx.envFileContent
  const readEnv = override
    ? (file: string): string | undefined => override[file]
    : (file: string): string | undefined => read(file)

  const hit = pickEnvPort(readEnv, ENV_FILE_PRIORITY)
  // .env 是「可能生效」的配置（受 NODE_ENV / 框架加载顺序影响），故为 medium
  return hit ? [toEndpoint(hit.port, 'env', 'medium')] : []
}

// ============ 来源 4：框架默认 ============

function fromFrameworkDefault(ctx: PortDetectionContext): DetectedEndpoint[] {
  const byFramework = ctx.framework ? FRAMEWORK_DEFAULT_PORTS[ctx.framework] : undefined
  const port = byFramework ?? (ctx.projectType === 'java' ? JAVA_FALLBACK_PORT : undefined)
  // 框架默认值恒为 low：UI 必须标灰并表述为「推测端口」
  return port === undefined ? [] : [toEndpoint(port, 'framework-default', 'low')]
}

// ============ 对外入口 ============

/**
 * 静态端口探测：六路来源合并 → 去重 → 按优先级/可信度排序。
 * 一条都推断不出时返回空数组（上层据此让 detectedPort 保持 undefined，不影响创建）。
 */
export function detectStaticPorts(ctx: PortDetectionContext): DetectedEndpoint[] {
  const read = toSafeReader(ctx.readTextFile ?? createDefaultReader(ctx.rootPath))
  const candidates = [
    ...fromCommand(ctx),
    ...fromConfig(ctx, read),
    ...fromEnv(ctx, read),
    ...fromFrameworkDefault(ctx),
  ]
  return normalizeEndpoints(candidates)
}

/** 便捷方法：直接拿到快照端口（= 排序后第一个带 port 的端点） */
export function detectStaticPort(ctx: PortDetectionContext): number | undefined {
  return pickPrimaryPort(detectStaticPorts(ctx))
}

/** 命名空间形式的对外接口，对应设计文档的 `PortDetector.detectStatic(ctx)` */
export const PortDetector = {
  detectStatic: detectStaticPorts,
  detectStaticPort,
} as const
