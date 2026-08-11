// PX Dev — IPC 错误文案格式化测试
//
// 背景：本次「选择目录失败」bug 现场连续弹了 4 条**完全没有信息量**的提示，
// 排查者无法从界面得到任何线索。formatIpcError 负责把 Electron 的包装前缀剥掉，
// 只保留人类可读的原因，并拼在业务文案之后。

import { describe, it, expect } from 'vitest'
import { formatIpcError } from '@renderer/api/errors'

describe('formatIpcError', () => {
  it('① 剥离 Electron 远程调用包装前缀，保留主进程原因', () => {
    const err = new Error(
      "Error invoking remote method 'system:selectDirectory': IpcError: 打开目录选择对话框失败: EPERM",
    )
    expect(formatIpcError(err, '选择目录失败')).toBe('选择目录失败：打开目录选择对话框失败: EPERM')
  })

  it('② 仅有错误类名前缀时同样剥离', () => {
    const err = new TypeError("'get' on proxy: property 'system' is a read-only ...")
    expect(formatIpcError(err, '选择目录失败')).toBe(
      "选择目录失败：'get' on proxy: property 'system' is a read-only ...",
    )
  })

  it('③ 普通 Error 直接拼接原因', () => {
    expect(formatIpcError(new Error('权限不足'), '选择目录失败')).toBe('选择目录失败：权限不足')
  })

  it('④ 字符串异常也能处理', () => {
    expect(formatIpcError('磁盘不可用', '选择目录失败')).toBe('选择目录失败：磁盘不可用')
  })

  it('⑤ 无有效原因时退回业务文案，不产生「xxx：」空尾巴', () => {
    expect(formatIpcError(new Error(''), '选择目录失败')).toBe('选择目录失败')
    expect(formatIpcError(undefined, '选择目录失败')).toBe('选择目录失败')
    expect(formatIpcError(null, '选择目录失败')).toBe('选择目录失败')
    expect(formatIpcError({}, '选择目录失败')).toBe('选择目录失败')
  })

  it('⑥ 原因与业务文案重复时不做无意义的重复拼接', () => {
    expect(formatIpcError(new Error('选择目录失败'), '选择目录失败')).toBe('选择目录失败')
  })
})
