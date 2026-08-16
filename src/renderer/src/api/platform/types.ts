/**
 * Phase 1: API 未实现错误
 * Tauri Adapter 中尚未迁移的方法统一抛出此错误
 */
export class NotImplementedError extends Error {
  constructor(method: string, phase: string = 'Phase 1') {
    super(`${method} is not implemented in Tauri migration ${phase}`)
    this.name = 'NotImplementedError'
  }
}

/**
 * 创建抛出 NotImplementedError 的函数
 */
export function notImplemented(method: string): (..._args: any[]) => never {
  return (..._args: any[]) => {
    throw new NotImplementedError(method)
  }
}
