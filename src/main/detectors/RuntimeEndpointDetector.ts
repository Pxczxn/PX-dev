// PX Dev — 运行时端点识别原语（Phase 5，纯函数 + 只读文本）
//
// 职责边界（红线）：
// - **静态**端口（package.json / vite.config / .env / 框架默认）归 `PortDetector`；
// - **运行时**端点（子进程 stdout/stderr 日志里打印出来的 URL）归本模块；
//   两者互不重叠，不存在第二套端口识别逻辑。
// - 排序 / 去重 / 优先级一律复用 `discovery/utils/endpointPriority`，本文件不自己实现比较器。
//
// 安全红线：纯字符串处理，无任何 IO、无 require/import/eval，绝不执行被扫描项目的代码。
//
// 性能红线：本模块会在 LogManager.flush()（80ms 节流）里被**同步**调用，因此
// - 所有正则**预编译为模块级常量**；
// - 单次调用最多处理 200 行、每行最多 2000 字符（超出截断）；
// - 单次调用最多产出 10 个端点（防日志洪水）。

import type { DetectedEndpoint, DetectedEndpointType, DiscoveryConfidence } from '@shared/types'
import { normalizeEndpoints } from '../discovery/utils/endpointPriority'

// ============ 限额常量 ============

/** 单次解析最多处理的行数（超出部分直接丢弃） */
export const MAX_LINES_PER_PARSE = 200

/** 单行最多参与匹配的字符数（防御超长单行日志） */
export const MAX_LINE_LENGTH = 2000

/** 单次解析最多产出的端点数（防日志洪水） */
export const MAX_ENDPOINTS_PER_PARSE = 10

// ============ 预编译正则（模块级常量，禁止在函数内 new RegExp） ============

/** ANSI SGR 转义序列，如 `\u001b[32m` / `\u001b[0m` */
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

/**
 * 带标签的 URL 行：Vite / Next / Nuxt / CRA / webpack-dev-server 都是这个形状。
 *   `➜  Local:   http://localhost:5173/`
 *   `- Local:        http://localhost:3000`
 *   `Local:            http://localhost:3000`
 *   `➜  Network: http://192.168.1.8:5173/`
 *   `On Your Network:  http://192.168.1.8:3000`
 * 命中标签即视为高可信（框架显式宣告的可访问地址）。
 */
const LABELED_URL_PATTERN =
  /(?:local|network|external|on your network)\s*:\s*(https?:\/\/[^\s,;'"`]+)/gi

/**
 * Spring Boot（Servlet 栈）：
 *   `Tomcat started on port(s): 8080 (http) with context path ''`
 *   `Tomcat started on port 8080 (http)`（Spring Boot 3.x 措辞）
 */
const TOMCAT_PORT_PATTERN = /tomcat started on port(?:\(s\))?\s*:?\s*(\d{1,5})/i

/**
 * Spring Boot（Reactive 栈）：
 *   `Netty started on port 8080`
 *   `Netty started on port(s): 8080`
 */
const NETTY_PORT_PATTERN = /netty started on port(?:\(s\))?\s*:?\s*(\d{1,5})/i

/**
 * Nest / 通用 Node 服务的监听宣告（无 URL 形态）：
 *   `Nest application successfully started` 之后的 `... listening on port 3000`
 *   `Server listening on 4000`
 * 无框架标签背书，归为 medium。
 */
const LISTENING_PORT_PATTERN = /listening on\s*(?:port\s*)?:?\s*(\d{2,5})(?!\d)/i

/**
 * 通用兜底 URL：只认本地回环与 IPv4 字面量，绝不匹配任意域名
 * （避免把日志里的文档链接 / CDN 地址误判成服务端点）。
 */
const GENERIC_URL_PATTERN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?(?:\/[^\s,;'"`]*)?/gi

/** 从完整 URL 里拆出 protocol / host / port */
const URL_PARTS_PATTERN = /^(https?):\/\/([^/:\s]+)(?::(\d{1,5}))?(\/[^\s]*)?$/i

/** 判定为「本机」的 host 白名单 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

// ============ 工具函数 ============

/** 剥离 ANSI 转义序列（框架彩色输出必经的第一步） */
export function stripAnsi(text: string): string {
  if (!text) return ''
  // 全局正则用于 replace 时 lastIndex 会被自动重置，无状态残留风险
  return text.replace(ANSI_PATTERN, '')
}

/**
 * host → 端点类型。
 * 单一判定规则：localhost / 127.0.0.1 / 0.0.0.0 → local，其余 IPv4 → network。
 * 带标签的行也走同一规则，避免出现「按标签判」和「按 host 判」两套结论。
 */
export function classifyHost(host: string): DetectedEndpointType {
  const normalized = host.trim().toLowerCase()
  if (!normalized) return 'unknown'
  return LOCAL_HOSTS.has(normalized) ? 'local' : 'network'
}

/** 去掉 URL 尾部的标点与多余斜杠，得到稳定的可打开地址 */
function normalizeUrl(raw: string): string {
  let url = raw.trim()
  // 日志里常见的行尾标点：`http://localhost:3000/.` / `(http://localhost:3000)`
  url = url.replace(/[),.;:'"`]+$/, '')
  // 统一去掉根路径尾斜杠，保证 `http://a:1/` 与 `http://a:1` 去重后只剩一条
  if (url.endsWith('/')) {
    url = url.slice(0, -1)
  }
  return url
}

/** 端口字符串 → 合法端口号；越界返回 undefined（宁缺勿错） */
function toPort(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const port = Number.parseInt(raw, 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined
  return port
}

/**
 * 由完整 URL 构造端点；解析失败返回 null（绝不猜值）。
 */
function endpointFromUrl(rawUrl: string, confidence: DiscoveryConfidence): DetectedEndpoint | null {
  const url = normalizeUrl(rawUrl)
  const parts = URL_PARTS_PATTERN.exec(url)
  if (!parts) return null

  const protocol = parts[1].toLowerCase() as 'http' | 'https'
  const host = parts[2].toLowerCase()
  const port = toPort(parts[3])
  const type = classifyHost(host)
  if (type === 'unknown') return null

  return {
    type,
    protocol,
    host,
    ...(port === undefined ? {} : { port }),
    url,
    source: 'runtime-log',
    confidence,
  }
}

/** 由「只有端口号」的日志（Tomcat / Netty / listening on）构造本机端点 */
function endpointFromPort(port: number, confidence: DiscoveryConfidence): DetectedEndpoint {
  return {
    type: 'local',
    protocol: 'http',
    host: 'localhost',
    port,
    url: `http://localhost:${port}`,
    source: 'runtime-log',
    confidence,
  }
}

/** 解析单行（已剥离 ANSI）：返回该行命中的所有端点候选 */
function parseLine(line: string): DetectedEndpoint[] {
  const hits: DetectedEndpoint[] = []

  // ① 带标签的 URL —— 框架显式宣告，high
  LABELED_URL_PATTERN.lastIndex = 0
  for (const match of line.matchAll(LABELED_URL_PATTERN)) {
    const endpoint = endpointFromUrl(match[1], 'high')
    if (endpoint) hits.push(endpoint)
  }

  // ② Spring Boot Tomcat / Netty —— 显式宣告端口，high
  const tomcat = toPort(TOMCAT_PORT_PATTERN.exec(line)?.[1])
  if (tomcat !== undefined) hits.push(endpointFromPort(tomcat, 'high'))

  const netty = toPort(NETTY_PORT_PATTERN.exec(line)?.[1])
  if (netty !== undefined) hits.push(endpointFromPort(netty, 'high'))

  // ③ Nest / 通用 `listening on ... 3000` —— 无框架背书，medium
  const listening = toPort(LISTENING_PORT_PATTERN.exec(line)?.[1])
  if (listening !== undefined) hits.push(endpointFromPort(listening, 'medium'))

  // ④ 通用兜底 URL —— medium
  GENERIC_URL_PATTERN.lastIndex = 0
  for (const match of line.matchAll(GENERIC_URL_PATTERN)) {
    const endpoint = endpointFromUrl(match[0], 'medium')
    if (endpoint) hits.push(endpoint)
  }

  return hits
}

// ============ 对外 API ============

/** parse 的可选限额（默认值即红线值，测试可下调以验证截断行为） */
export interface RuntimeEndpointParseOptions {
  /** 最多处理的行数，默认 200 */
  maxLines?: number
  /** 最多产出的端点数，默认 10 */
  maxEndpoints?: number
}

/**
 * 从一段日志文本中解析运行时端点。
 *
 * 产出的 `source` 恒为 `'runtime-log'`，因此会被既有 `endpointRank()`
 * 自动排到所有静态来源之前（rank 50 > command 40 > config 30 > env 20 > default 10）。
 *
 * @param text 一段日志文本（可含多行、可含 ANSI 色码）
 * @returns 已去重 + 排序 + 截断的端点列表；识别不到时返回空数组（绝不抛错）
 */
export function parseRuntimeEndpoints(
  text: string,
  options: RuntimeEndpointParseOptions = {},
): DetectedEndpoint[] {
  if (typeof text !== 'string' || text.length === 0) return []

  const maxLines = options.maxLines ?? MAX_LINES_PER_PARSE
  const maxEndpoints = options.maxEndpoints ?? MAX_ENDPOINTS_PER_PARSE

  const lines = stripAnsi(text).split(/\r?\n/)
  const limit = Math.min(lines.length, Math.max(0, maxLines))

  const candidates: DetectedEndpoint[] = []
  for (let i = 0; i < limit; i++) {
    const line = lines[i].length > MAX_LINE_LENGTH ? lines[i].slice(0, MAX_LINE_LENGTH) : lines[i]
    if (!line) continue
    candidates.push(...parseLine(line))
  }

  if (candidates.length === 0) return []

  // 去重 + 排序完全复用 endpointPriority：
  // 同 source 时 dedupeEndpoints 退化为「按 confidence 保留更高者」，
  // 正好等价于规格里的「同 (host, port) 去重，保留 confidence 更高者」。
  const normalized = normalizeEndpoints(candidates)
  return normalized.length > maxEndpoints ? normalized.slice(0, maxEndpoints) : normalized
}

/**
 * 首选可打开 URL：第一个 `type==='local'` 的 url，否则第一个 `network` 的 url。
 * 入参应为已排序的端点列表（parseRuntimeEndpoints 的返回值即满足）。
 */
export function pickPrimaryUrl(endpoints: DetectedEndpoint[]): string | undefined {
  const local = endpoints.find((e) => e.type === 'local' && !!e.url)
  if (local?.url) return local.url
  return endpoints.find((e) => e.type === 'network' && !!e.url)?.url
}

/** 首选端点（与 pickPrimaryUrl 同口径，供 Registry 取 runtimePort） */
export function pickPrimaryEndpoint(endpoints: DetectedEndpoint[]): DetectedEndpoint | undefined {
  return (
    endpoints.find((e) => e.type === 'local' && !!e.url) ??
    endpoints.find((e) => e.type === 'network' && !!e.url)
  )
}

/** 命名空间形式的对外接口，对应设计文档的 `RuntimeEndpointDetector.parse(text)` */
export const RuntimeEndpointDetector = {
  parse: parseRuntimeEndpoints,
  stripAnsi,
  classifyHost,
  pickPrimaryUrl,
  pickPrimaryEndpoint,
} as const
