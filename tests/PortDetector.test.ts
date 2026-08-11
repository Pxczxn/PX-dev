// PX Dev — 静态端口探测单元测试（Phase 4）
//
// 覆盖：六路来源各自命中、优先级排序、可信度、动态配置不乱猜、真实目录 fixture。
// 安全约束回归：全部解析走文本正则，测试里出现的配置文件内容**不会被执行**。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  detectStaticPort,
  detectStaticPorts,
  PortDetector,
  parseYamlServerPort,
} from '../src/main/detectors/PortDetector'
import {
  ENDPOINT_PRIORITY,
  endpointRank,
  pickPrimaryPort,
  sortEndpoints,
} from '../src/main/discovery/utils/endpointPriority'
import type { DetectedEndpoint } from '@shared/types'

/** 用内存 map 模拟项目文件，彻底避开读盘 */
function fakeFiles(files: Record<string, string>) {
  return (relativePath: string): string | undefined => files[relativePath]
}

/** 找出指定来源的端点 */
function bySource(endpoints: DetectedEndpoint[], source: string): DetectedEndpoint | undefined {
  return endpoints.find((e) => e.source === source)
}

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pxdev-port-test-'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('PortDetector — 来源 1：command', () => {
  it('① scripts 里的 `vite --port 5174` → source=command、confidence=high', () => {
    const endpoints = detectStaticPorts({
      rootPath: tempDir,
      command: 'npm',
      args: ['run', 'dev'],
      scripts: { dev: 'vite --port 5174' },
      readTextFile: fakeFiles({}),
    })

    expect(endpoints[0]).toMatchObject({
      type: 'local',
      protocol: 'http',
      host: 'localhost',
      port: 5174,
      url: 'http://localhost:5174',
      source: 'command',
      confidence: 'high',
    })
  })

  it('②-1 `-p 4000` 短参数命中', () => {
    const port = detectStaticPort({
      rootPath: tempDir,
      args: ['run', 'dev'],
      scripts: { dev: 'next dev -p 4000' },
      readTextFile: fakeFiles({}),
    })
    expect(port).toBe(4000)
  })

  it('②-2 `-Dserver.port=9090` / `--server.port=9091` 命中（Java 风格）', () => {
    expect(
      detectStaticPort({
        rootPath: tempDir,
        command: 'mvn',
        args: ['spring-boot:run', '-Dserver.port=9090'],
        readTextFile: fakeFiles({}),
      }),
    ).toBe(9090)

    expect(
      detectStaticPort({
        rootPath: tempDir,
        command: 'java',
        args: ['-jar', 'app.jar', '--server.port=9091'],
        readTextFile: fakeFiles({}),
      }),
    ).toBe(9091)
  })

  it('②-3 行内环境变量 `PORT=3000 vite`（保留改造前 NodeProjectScanner 的能力）', () => {
    expect(
      detectStaticPort({
        rootPath: tempDir,
        args: ['run', 'dev'],
        scripts: { dev: 'PORT=3000 vite' },
        readTextFile: fakeFiles({}),
      }),
    ).toBe(3000)
  })

  it('②-4 `npm run dev:web` 会继续解析被引用脚本的正文', () => {
    expect(
      detectStaticPort({
        rootPath: tempDir,
        command: 'npm',
        args: ['run', 'dev:web'],
        scripts: { 'dev:web': 'vite --port 5180' },
        readTextFile: fakeFiles({}),
      }),
    ).toBe(5180)
  })
})

describe('PortDetector — 来源 2：config', () => {
  it('③ vite.config.ts 的 server.port → source=config、confidence=high', () => {
    const endpoints = detectStaticPorts({
      rootPath: tempDir,
      scripts: { dev: 'vite' },
      framework: 'vite',
      readTextFile: fakeFiles({
        'vite.config.ts': [
          "import { defineConfig } from 'vite'",
          'export default defineConfig({',
          '  server: {',
          '    host: true,',
          '    port: 4000,',
          '  },',
          '})',
        ].join('\n'),
      }),
    })

    const config = bySource(endpoints, 'config')
    expect(config?.port).toBe(4000)
    expect(config?.confidence).toBe('high')
    // 排序后 config 在 framework-default 之前
    expect(endpoints[0].source).toBe('config')
    expect(pickPrimaryPort(endpoints)).toBe(4000)
  })

  it('③-2 nuxt.config 的 devServer.port 命中', () => {
    expect(
      detectStaticPort({
        rootPath: tempDir,
        framework: 'nuxt',
        readTextFile: fakeFiles({
          'nuxt.config.ts': 'export default defineNuxtConfig({ devServer: { port: 3100 } })',
        }),
      }),
    ).toBe(3100)
  })

  it('③-3 application.properties 的 server.port', () => {
    const endpoints = detectStaticPorts({
      rootPath: tempDir,
      framework: 'spring-boot',
      projectType: 'java',
      readTextFile: fakeFiles({
        'src/main/resources/application.properties':
          '# 应用配置\nspring.application.name=demo\nserver.port=8081\n',
      }),
    })
    const config = bySource(endpoints, 'config')
    expect(config?.port).toBe(8081)
    expect(config?.confidence).toBe('high')
    expect(pickPrimaryPort(endpoints)).toBe(8081)
  })

  it('③-4 application.yml 缩进感知：只取 server: 下的直接子键 port', () => {
    const endpoints = detectStaticPorts({
      rootPath: tempDir,
      framework: 'spring-boot',
      projectType: 'java',
      readTextFile: fakeFiles({
        'src/main/resources/application.yml': [
          'spring:',
          '  datasource:',
          '    port: 3306',
          'server:',
          '  port: 8082',
          '  servlet:',
          '    context-path: /api',
        ].join('\n'),
      }),
    })
    expect(bySource(endpoints, 'config')?.port).toBe(8082)
  })

  it('③-5 application.yml 多文档：取第一个 server.port，值不一致时降为 medium', () => {
    const single = parseYamlServerPort(['server:', '  port: 8083', '---', 'server:', '  port: 8083'].join('\n'))
    expect(single).toEqual({ port: 8083, ambiguous: false })

    const multi = parseYamlServerPort(
      ['server:', '  port: 8083', '---', 'spring:', '  profiles: prod', 'server:', '  port: 9000'].join('\n'),
    )
    expect(multi).toEqual({ port: 8083, ambiguous: true })

    const endpoints = detectStaticPorts({
      rootPath: tempDir,
      framework: 'spring-boot',
      projectType: 'java',
      readTextFile: fakeFiles({
        'src/main/resources/application.yaml': [
          'server:',
          '  port: 8083',
          '---',
          'server:',
          '  port: 9000',
        ].join('\n'),
      }),
    })
    const config = bySource(endpoints, 'config')
    expect(config?.port).toBe(8083)
    expect(config?.confidence).toBe('medium')
  })

  it('③-6 Nest 入口 `app.listen(3200)`', () => {
    expect(
      detectStaticPort({
        rootPath: tempDir,
        framework: 'nest',
        readTextFile: fakeFiles({
          'src/main.ts': 'async function bootstrap() { await app.listen(3200) }',
        }),
      }),
    ).toBe(3200)
  })
})

describe('PortDetector — 来源 3：env', () => {
  it('④ .env 含 PORT=3000 → 3000、source=env、confidence=medium', () => {
    const endpoints = detectStaticPorts({
      rootPath: tempDir,
      readTextFile: fakeFiles({ '.env': 'PORT=3000' }),
    })
    expect(endpoints[0]).toMatchObject({ port: 3000, source: 'env', confidence: 'medium' })
  })

  it('④-2 env 链优先级：.env.local > .env.development > .env', () => {
    expect(
      detectStaticPort({
        rootPath: tempDir,
        readTextFile: fakeFiles({
          '.env': 'PORT=3000',
          '.env.development': 'PORT=3001',
          '.env.local': 'PORT=3002',
        }),
      }),
    ).toBe(3002)
  })

  it('④-3 envFileContent 覆盖读盘（供上层复用已读内容）', () => {
    expect(
      detectStaticPort({
        rootPath: tempDir,
        envFileContent: { '.env': 'VITE_PORT=5199' },
        readTextFile: fakeFiles({ '.env': 'PORT=3000' }),
      }),
    ).toBe(5199)
  })
})

describe('PortDetector — 来源 4：framework-default', () => {
  it('⑤ 什么都没有时按框架默认兜底，且**恒为 low**', () => {
    const cases: [string, number][] = [
      ['vite', 5173],
      ['vue', 5173],
      ['next', 3000],
      ['nuxt', 3000],
      ['nest', 3000],
      ['express', 3000],
      ['cra', 3000],
      ['angular', 4200],
      ['spring-boot', 8080],
    ]

    for (const [framework, port] of cases) {
      const endpoints = detectStaticPorts({
        rootPath: tempDir,
        framework,
        readTextFile: fakeFiles({}),
      })
      expect(endpoints).toHaveLength(1)
      expect(endpoints[0]).toMatchObject({
        port,
        source: 'framework-default',
        confidence: 'low',
      })
    }
  })

  it('⑤-2 认不出框架的 Java 项目仍兜底 8080（保持 Maven/Gradle 既有行为）', () => {
    expect(
      detectStaticPort({ rootPath: tempDir, projectType: 'java', readTextFile: fakeFiles({}) }),
    ).toBe(8080)
  })

  it('⑤-3 无框架、无配置 → 空数组（推断失败不影响创建）', () => {
    expect(
      detectStaticPorts({ rootPath: tempDir, projectType: 'node', readTextFile: fakeFiles({}) }),
    ).toEqual([])
    expect(
      detectStaticPort({ rootPath: tempDir, projectType: 'node', readTextFile: fakeFiles({}) }),
    ).toBeUndefined()
  })
})

describe('PortDetector — 优先级合并', () => {
  it('⑥ command > config > env > framework-default，detectedPort 取 command 值', () => {
    const endpoints = detectStaticPorts({
      rootPath: tempDir,
      command: 'npm',
      args: ['run', 'dev'],
      scripts: { dev: 'vite --port 5174' },
      framework: 'vite',
      readTextFile: fakeFiles({
        'vite.config.ts': 'export default { server: { port: 4000 } }',
        '.env': 'PORT=3000',
      }),
    })

    expect(endpoints.map((e) => e.source)).toEqual([
      'command',
      'config',
      'env',
      'framework-default',
    ])
    expect(endpoints.map((e) => e.port)).toEqual([5174, 4000, 3000, 5173])
    expect(endpoints.map((e) => e.confidence)).toEqual(['high', 'high', 'medium', 'low'])
    expect(pickPrimaryPort(endpoints)).toBe(5174)
  })

  it('⑥-2 同端口多来源 → 去重后只保留优先级最高的那条', () => {
    const endpoints = detectStaticPorts({
      rootPath: tempDir,
      framework: 'vite',
      readTextFile: fakeFiles({ 'vite.config.ts': 'export default { server: { port: 5173 } }' }),
    })
    expect(endpoints).toHaveLength(1)
    expect(endpoints[0]).toMatchObject({ port: 5173, source: 'config', confidence: 'high' })
  })

  it('⑥-3 ENDPOINT_PRIORITY 与排序函数：runtime-log / user 天然排在静态来源之前（Phase 5 衔接）', () => {
    expect(ENDPOINT_PRIORITY).toEqual({
      user: 60,
      'runtime-log': 50,
      command: 40,
      config: 30,
      env: 20,
      'framework-default': 10,
    })
    expect(endpointRank('runtime-log')).toBeGreaterThan(endpointRank('command'))

    const mixed: DetectedEndpoint[] = [
      { type: 'local', port: 10, source: 'framework-default', confidence: 'low' },
      { type: 'local', port: 40, source: 'command', confidence: 'high' },
      { type: 'local', port: 50, source: 'runtime-log', confidence: 'high' },
      { type: 'local', port: 60, source: 'user', confidence: 'high' },
      { type: 'local', port: 30, source: 'config', confidence: 'high' },
      { type: 'local', port: 20, source: 'env', confidence: 'medium' },
    ]
    expect(sortEndpoints(mixed).map((e) => e.port)).toEqual([60, 50, 40, 30, 20, 10])
  })
})

describe('PortDetector — 动态配置与异常输入', () => {
  it('⑦ `Number(process.env.PORT)` 等表达式解析不出时不乱猜，只回落框架默认 low', () => {
    const endpoints = detectStaticPorts({
      rootPath: tempDir,
      framework: 'vite',
      readTextFile: fakeFiles({
        'vite.config.ts': [
          'export default defineConfig({',
          '  server: {',
          '    port: Number(process.env.PORT) || undefined,',
          '  },',
          '})',
        ].join('\n'),
        '.env': 'PORT=${BASE_PORT}',
      }),
    })

    expect(endpoints).toHaveLength(1)
    expect(endpoints[0]).toMatchObject({ port: 5173, source: 'framework-default', confidence: 'low' })
  })

  it('⑦-2 越界端口一律忽略', () => {
    expect(
      detectStaticPorts({
        rootPath: tempDir,
        scripts: { dev: 'vite --port 99999' },
        readTextFile: fakeFiles({}),
      }),
    ).toEqual([])
  })

  it('⑦-3 读文件抛错时不影响整体（降级为无端点）', () => {
    const endpoints = detectStaticPorts({
      rootPath: tempDir,
      projectType: 'node',
      readTextFile: () => {
        throw new Error('EACCES')
      },
    })
    expect(endpoints).toEqual([])
  })
})

describe('PortDetector — 真实目录 fixture', () => {
  it('⑧ web/vite.config.ts 写死 server.port=5174 → detectedPort=5174、confidence=high', () => {
    const webDir = join(tempDir, 'web')
    mkdirSync(webDir, { recursive: true })
    writeFileSync(
      join(webDir, 'vite.config.ts'),
      [
        "import { defineConfig } from 'vite'",
        '',
        'export default defineConfig({',
        '  server: {',
        '    port: 5174,',
        '    open: false,',
        '  },',
        '})',
        '',
      ].join('\n'),
    )

    const endpoints = PortDetector.detectStatic({
      rootPath: webDir,
      command: 'npm',
      args: ['run', 'dev'],
      scripts: { dev: 'vite' },
      framework: 'vite',
      configFiles: ['package.json', 'vite.config.ts'],
    })

    expect(pickPrimaryPort(endpoints)).toBe(5174)
    expect(endpoints[0]).toMatchObject({
      port: 5174,
      source: 'config',
      confidence: 'high',
      url: 'http://localhost:5174',
    })
  })

  it('⑧-2 真实 .env 文件在无配置时生效', () => {
    writeFileSync(join(tempDir, '.env'), '# 本地端口\nPORT=3010\n')
    expect(
      PortDetector.detectStaticPort({ rootPath: tempDir, projectType: 'node' }),
    ).toBe(3010)
  })

  it('⑧-3 目录内什么都没有 → 空数组，不抛错', () => {
    expect(PortDetector.detectStatic({ rootPath: join(tempDir, '不存在的目录') })).toEqual([])
  })
})
