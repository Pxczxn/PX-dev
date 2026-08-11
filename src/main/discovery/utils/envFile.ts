// PX Dev — .env 文件端口解析（Phase 4）
//
// 安全红线：**纯文本正则解析**，绝不 require()/import()/eval 陌生项目的文件。
// 只提取端口相关的四个键，其余键一律不落库、不外泄（避免把 SECRET/TOKEN 带进发现结果）。

/** .env 链优先级：越靠前越优先（与 Vite / CRA 的加载顺序一致） */
export const ENV_FILE_PRIORITY: readonly string[] = ['.env.local', '.env.development', '.env']

/** 端口键优先级：同一个文件里多个键同时存在时按此顺序取第一个 */
export const ENV_PORT_KEYS: readonly string[] = ['PORT', 'VITE_PORT', 'SERVER_PORT', 'APP_PORT']

/** 一次命中的 env 端口 */
export interface EnvPortHit {
  port: number
  /** 命中的文件名，如 '.env.local' */
  file: string
  /** 命中的键名，如 'PORT' */
  key: string
}

/** KEY=VALUE 行；允许 `export ` 前缀与键前后空格 */
const ENV_LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/

/**
 * 解析 .env 文本为键值对（同名键后者覆盖前者，与 dotenv 一致）。
 * 处理：注释行、行尾注释、单/双引号包裹、`export` 前缀、空值。
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const matched = ENV_LINE_RE.exec(line)
    if (!matched) continue

    const key = matched[1]
    result[key] = normalizeEnvValue(matched[2])
  }
  return result
}

/** 去掉包裹引号与行尾注释 */
function normalizeEnvValue(raw: string): string {
  const value = raw.trim()
  const quote = value[0]
  if ((quote === '"' || quote === "'") && value.length >= 2) {
    const closing = value.indexOf(quote, 1)
    // 引号内的 # 不算注释
    if (closing > 0) return value.slice(1, closing)
  }
  // 行尾注释必须以空白开头（`PORT=3000 # 说明`），避免误伤 `PASS=a#b`
  return value.replace(/\s+#.*$/, '').trim()
}

/** 合法端口：1–65535 的纯十进制整数；`${BASE_PORT}` / 'abc' 等一律忽略（宁缺勿猜） */
export function toEnvPort(value?: string): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const port = Number.parseInt(value, 10)
  return port >= 1 && port <= 65535 ? port : undefined
}

/** 从单个 .env 文本里取端口，按 ENV_PORT_KEYS 顺序 */
export function pickPortFromEnvContent(
  content: string,
): { port: number; key: string } | undefined {
  const parsed = parseEnvContent(content)
  for (const key of ENV_PORT_KEYS) {
    const port = toEnvPort(parsed[key])
    if (port !== undefined) return { port, key }
  }
  return undefined
}

/**
 * 沿 `.env.local > .env.development > .env` 链取第一个有效端口。
 * @param readFile 读取实现，返回 undefined 表示文件不存在或读失败
 * @param files    自定义文件链（默认 ENV_FILE_PRIORITY）
 */
export function pickEnvPort(
  readFile: (file: string) => string | undefined,
  files: readonly string[] = ENV_FILE_PRIORITY,
): EnvPortHit | undefined {
  for (const file of files) {
    const content = readFile(file)
    if (content === undefined) continue
    const hit = pickPortFromEnvContent(content)
    if (hit) return { port: hit.port, file, key: hit.key }
  }
  return undefined
}
