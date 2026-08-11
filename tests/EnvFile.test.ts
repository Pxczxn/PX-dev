// PX Dev — .env 端口解析单元测试（Phase 4）
// 覆盖：链优先级、引号/注释/空格、非法值忽略、纯文本解析（不执行任何代码）

import { describe, it, expect } from 'vitest'
import {
  ENV_FILE_PRIORITY,
  parseEnvContent,
  pickEnvPort,
  pickPortFromEnvContent,
  toEnvPort,
} from '../src/main/discovery/utils/envFile'

/** 用内存 map 模拟 .env 文件读取 */
function reader(files: Record<string, string>) {
  return (file: string): string | undefined => files[file]
}

describe('parseEnvContent', () => {
  it('① 解析基本 KEY=VALUE，忽略注释行与空行', () => {
    const parsed = parseEnvContent(['# 注释', '', 'PORT=3000', 'NAME=demo'].join('\n'))
    expect(parsed.PORT).toBe('3000')
    expect(parsed.NAME).toBe('demo')
  })

  it('② 支持 export 前缀、等号周围空格、CRLF 换行', () => {
    const parsed = parseEnvContent('export PORT = 4000\r\nAPP_PORT=  4100  \r\n')
    expect(parsed.PORT).toBe('4000')
    expect(parsed.APP_PORT).toBe('4100')
  })

  it('③ 去掉包裹引号与行尾注释', () => {
    const parsed = parseEnvContent(['PORT="5173"', "VITE_PORT='5174'", 'APP_PORT=6000 # 备用'].join('\n'))
    expect(parsed.PORT).toBe('5173')
    expect(parsed.VITE_PORT).toBe('5174')
    expect(parsed.APP_PORT).toBe('6000')
  })

  it('④ 同名键后者覆盖前者（与 dotenv 一致）', () => {
    expect(parseEnvContent('PORT=3000\nPORT=3001').PORT).toBe('3001')
  })
})

describe('toEnvPort', () => {
  it('⑤ 非法值一律忽略，绝不乱猜', () => {
    expect(toEnvPort('3000')).toBe(3000)
    expect(toEnvPort('abc')).toBeUndefined()
    expect(toEnvPort('${BASE_PORT}')).toBeUndefined()
    expect(toEnvPort('0')).toBeUndefined()
    expect(toEnvPort('70000')).toBeUndefined()
    expect(toEnvPort('')).toBeUndefined()
    expect(toEnvPort(undefined)).toBeUndefined()
  })
})

describe('pickPortFromEnvContent', () => {
  it('⑥ 按 PORT > VITE_PORT > SERVER_PORT > APP_PORT 的键顺序取值', () => {
    expect(pickPortFromEnvContent('APP_PORT=9000\nPORT=3000')).toEqual({ port: 3000, key: 'PORT' })
    expect(pickPortFromEnvContent('APP_PORT=9000\nVITE_PORT=5174')).toEqual({
      port: 5174,
      key: 'VITE_PORT',
    })
    expect(pickPortFromEnvContent('SERVER_PORT=8081')).toEqual({ port: 8081, key: 'SERVER_PORT' })
  })

  it('⑦ 无端口键 / 值非法时返回 undefined', () => {
    expect(pickPortFromEnvContent('NAME=demo')).toBeUndefined()
    expect(pickPortFromEnvContent('PORT=not-a-number')).toBeUndefined()
  })
})

describe('pickEnvPort', () => {
  it('⑧ .env.local 覆盖 .env.development 覆盖 .env', () => {
    expect(ENV_FILE_PRIORITY).toEqual(['.env.local', '.env.development', '.env'])

    const all = reader({
      '.env': 'PORT=3000',
      '.env.development': 'PORT=3001',
      '.env.local': 'PORT=3002',
    })
    expect(pickEnvPort(all)).toEqual({ port: 3002, file: '.env.local', key: 'PORT' })

    const withoutLocal = reader({ '.env': 'PORT=3000', '.env.development': 'PORT=3001' })
    expect(pickEnvPort(withoutLocal)).toEqual({
      port: 3001,
      file: '.env.development',
      key: 'PORT',
    })

    expect(pickEnvPort(reader({ '.env': 'PORT=3000' }))).toEqual({
      port: 3000,
      file: '.env',
      key: 'PORT',
    })
  })

  it('⑨ 高优先级文件端口非法时，继续沿链回落', () => {
    const files = reader({ '.env.local': 'PORT=${X}', '.env': 'PORT=3000' })
    expect(pickEnvPort(files)).toEqual({ port: 3000, file: '.env', key: 'PORT' })
  })

  it('⑩ 整条链都没有 → undefined（推断失败不报错）', () => {
    expect(pickEnvPort(reader({}))).toBeUndefined()
  })
})
