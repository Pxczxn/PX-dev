// PX Dev — Main Process Logger
// Lightweight logger with levels; console-based with optional file output

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m', // green
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
}

const RESET_COLOR = '\x1b[0m'

class Logger {
  private minLevel: LogLevel = 'debug'
  private prefix: string

  constructor(prefix = 'PX-Dev') {
    this.prefix = prefix
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, args)
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, args)
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, args)
  }

  error(message: string, ...args: unknown[]): void {
    this.log('error', message, args)
  }

  private log(level: LogLevel, message: string, args: unknown[]): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return

    const timestamp = new Date().toISOString()
    const color = LEVEL_COLORS[level]
    const levelTag = level.toUpperCase().padEnd(5)

    const formatted = `${color}[${timestamp}] ${levelTag} [${this.prefix}]${RESET_COLOR} ${message}`

    switch (level) {
      case 'debug':
        console.debug(formatted, ...args)
        break
      case 'info':
        console.info(formatted, ...args)
        break
      case 'warn':
        console.warn(formatted, ...args)
        break
      case 'error':
        console.error(formatted, ...args)
        break
    }
  }

  /** Create a child logger with a sub-prefix */
  child(subPrefix: string): Logger {
    const child = new Logger(`${this.prefix}:${subPrefix}`)
    child.minLevel = this.minLevel
    return child
  }
}

/** Main process logger singleton */
export const logger = new Logger()

export { Logger }
export type { LogLevel }
