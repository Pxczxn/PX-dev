// PX Dev — Command Builder
// 结构化命令解析 + Windows .cmd 重映射 + 批处理脚本 shell 兼容

import { spawn } from 'child_process'
import type { Service } from '@shared/types'
import { WINDOWS_CMD_REMAP } from '@shared/constants/defaults'
import { logger } from './logger'

export interface BuiltCommand {
  executable: string
  args: string[]
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    shell: boolean
    windowsHide: boolean
  }
}

/** Windows 批处理脚本扩展名 */
const WINDOWS_BATCH_EXT = /\.(cmd|bat)$/i

/**
 * cmd.exe 下必须加引号才能安全传递的字符。
 *
 * 包含空白字符与 shell 元字符：一旦命中，就用双引号包裹整个实参，
 * 否则 cmd.exe 会把它当成多个 token 或语法结构（重定向 / 管道 / 转义）来解析。
 */
const CMD_SPECIAL_CHARS = /[\s&|<>^"()%!,;=]/

/**
 * 判断可执行文件是否为 Windows 批处理脚本（.cmd / .bat）。
 *
 * 自 Node 18.20.2 / 20.12.2 起（CVE-2024-27980 的缓解措施），
 * `child_process.spawn()` 在 **shell 为 false** 时拒绝直接执行 .cmd / .bat，
 * 并**同步抛出** `Error: spawn EINVAL`。因此这类脚本必须走 shell:true。
 *
 * @param executable 已完成重映射的可执行文件名或路径
 * @param platform   目标平台，默认当前平台（显式传入便于跨平台单测）
 */
export function isWindowsBatchScript(
  executable: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'win32' && WINDOWS_BATCH_EXT.test(executable)
}

/**
 * 为 cmd.exe 转义单个 token（可执行文件名或实参）。
 *
 * 背景：当 spawn 使用 shell:true 时，Node 只是把 `[file, ...args]` 用空格拼成一整行
 * 交给 `cmd.exe /d /s /c "<整行>"`，**不会**为任何实参补引号。
 * 所以带空格的路径（如 `C:\Program Files\...`）或带元字符的参数必须由我们自己包裹，
 * 否则会被 cmd 拆散成多个参数，导致命令行语义被破坏。
 *
 * 规则：
 * - 空串 → `""`（保留「显式空参数」语义，不能被 cmd 吞掉）
 * - 不含特殊字符 → 原样返回（保持命令行可读性）
 * - 其余 → 双引号包裹，内部的 `"` 转义为 `\"`（MSVCRT 命令行解析约定）
 *
 * 注意：cmd.exe 的 `%VAR%` 在双引号内仍会展开，这是 cmd 的固有行为，
 * 无法在命令行层面彻底规避；PX Dev 的命令来源是用户自己的服务配置，风险可控。
 */
export function quoteForCmd(value: string): string {
  if (value === '') {
    return '""'
  }
  if (!CMD_SPECIAL_CHARS.test(value)) {
    return value
  }
  return `"${value.replace(/"/g, '\\"')}"`
}

/**
 * 从 Service 定义构建结构化命令。
 *
 * - structured 模式（默认）：command 与 args 分离，Windows 下按表重映射为 .cmd
 * - shell 模式：shell:true，command 原样交给 shell 解析
 *
 * ⚠️ Windows 关键修复：structured 模式下若重映射结果是 .cmd / .bat（例如
 * `npm` → `npm.cmd`），必须强制切换到 shell:true，否则新版 Node 会直接抛
 * `spawn EINVAL`。切换后同步对可执行文件与全部实参做 cmd 转义。
 *
 * 关于「shell 模式下 args 被拼进 executable、返回的 args 为空数组」：
 * Node 在 shell:true 时内部就是执行 `[file, ...args].join(' ')` 再交给 cmd.exe，
 * 且**不会**转义任何实参（Node 22+ 为此新增了 DEP0190 弃用警告）。
 * 既然转义必须由我们自己完成，就干脆把命令行一次拼好：
 * 语义与 Node 的内部拼接完全等价，同时避免触发该弃用警告。
 *
 * @param service  服务定义（command、args、cwd、env）
 * @param platform 目标平台，默认当前平台（显式传入便于跨平台单测）
 * @returns 可直接交给 child_process.spawn() 的参数三元组
 * @throws Error 当启动命令为空时
 */
export function buildCommand(
  service: Service,
  platform: NodeJS.Platform = process.platform,
): BuiltCommand {
  const command = typeof service.command === 'string' ? service.command.trim() : ''
  if (command === '') {
    throw new Error('启动命令为空：请在服务配置中填写「启动命令」')
  }

  const cwd = service.cwd
  const env: NodeJS.ProcessEnv = { ...process.env, ...service.env }
  const shellMode = service.shellMode ?? false

  // 防御性过滤：配置文件损坏时 args 可能混入非字符串元素，spawn 会因此抛错
  let args: string[] = (service.args ?? []).filter(
    (item): item is string => typeof item === 'string',
  )
  let executable: string
  let shell = shellMode

  if (shellMode) {
    // Shell 模式：用户显式选择由 shell 解析整条命令，此处不改写命令内容本身，
    // 只是把实参提前拼进命令行（与 Node 内部行为一致，见下方说明）。
    executable = args.length > 0 ? [command, ...args].join(' ') : command
    args = []
  } else {
    // 结构化模式：拆分可执行文件与实参，并应用 Windows .cmd 重映射
    executable = resolveExecutable(command, platform)

    if (isWindowsBatchScript(executable, platform)) {
      // 批处理脚本无法在 shell:false 下 spawn（EINVAL），改走 cmd.exe 并自行转义
      shell = true
      executable = [quoteForCmd(executable), ...args.map(quoteForCmd)].join(' ')
      args = []
    }
  }

  logger.debug(
    `buildCommand: executable=${executable}, args=${JSON.stringify(args)}, shell=${shell}`,
  )

  return {
    executable,
    args,
    options: {
      cwd,
      env,
      shell,
      windowsHide: true,
    },
  }
}

/**
 * 解析可执行文件名，应用 Windows .cmd 重映射。
 * Windows 下 npm / pnpm / yarn 等实际是 .cmd 包装脚本，需要补后缀。
 *
 * @param command  用户配置的命令名
 * @param platform 目标平台
 */
export function resolveExecutable(command: string, platform: NodeJS.Platform): string {
  // 仅在 Windows 上重映射
  if (platform === 'win32') {
    const lower = command.toLowerCase()
    // 已带扩展名的命令不再重映射
    const hasExt = /\.(exe|cmd|bat|ps1)$/i.test(command)
    if (!hasExt) {
      const remapped = WINDOWS_CMD_REMAP[lower]
      if (remapped) {
        return remapped
      }
    }
  }
  return command
}

/**
 * 用 BuiltCommand 启动子进程。
 * child_process.spawn 的轻量包装，保证调用方式统一。
 */
export function spawnCommand(built: BuiltCommand) {
  return spawn(built.executable, built.args, built.options)
}
