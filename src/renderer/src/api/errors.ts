// PX Dev — IPC 错误文案格式化
//
// 主进程抛出的异常经 ipcRenderer.invoke 回到渲染层时会被 Electron 包装成：
//   Error invoking remote method 'system:selectDirectory': IpcError: 打开目录选择对话框失败: xxx
// 直接把整串丢给用户既冗长又难读；但只显示「选择目录失败」又完全丢掉了原因，
// 用户和排查者都无从下手（本次 bug 现场就是一连串没有信息量的「选择目录失败」）。
//
// 这里统一把包装前缀剥掉，只保留人类可读的原因，并拼在业务文案后面。

/** Electron 对远程调用异常的包装前缀 */
const REMOTE_METHOD_PREFIX = /^Error invoking remote method '[^']*':\s*/
/** 常见错误类名前缀，如 `IpcError: ` / `TypeError: ` */
const ERROR_NAME_PREFIX = /^[A-Za-z]*Error:\s*/

/**
 * 把任意异常转换为「业务文案：具体原因」形式的可读提示。
 *
 * @param err      catch 到的异常（可能是 Error、字符串或任意值）
 * @param fallback 业务侧文案，如「选择目录失败」
 * @returns 形如「选择目录失败：打开目录选择对话框失败: 权限不足」的提示文本；
 *          无法提取到有效原因时原样返回 fallback
 */
export function formatIpcError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''

  let reason = raw.replace(REMOTE_METHOD_PREFIX, '')
  // 前缀可能叠加两层（Electron 包装 + 主进程错误类名），逐层剥离
  reason = reason.replace(ERROR_NAME_PREFIX, '').trim()

  if (!reason || reason === fallback) {
    return fallback
  }

  return `${fallback}：${reason}`
}
