// PX Dev — Unified Logger for Renderer Process
// Production-safe logging with context information

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

interface LogContext {
  [key: string]: unknown
}

class Logger {
  private isDev = import.meta.env.DEV

  private formatMessage(level: LogLevel, context: string, message: string, data?: LogContext): string {
    const timestamp = new Date().toISOString()
    return `[${timestamp}] [${level.toUpperCase()}] [${context}] ${message}`
  }

  info(context: string, message: string, data?: LogContext): void {
    if (this.isDev) {
      console.log(this.formatMessage('info', context, message), data ?? '')
    }
    // TODO: 生产环境可以发送到日志收集服务
  }

  warn(context: string, message: string, data?: LogContext): void {
    if (this.isDev) {
      console.warn(this.formatMessage('warn', context, message), data ?? '')
    }
  }

  error(context: string, message: string, error?: unknown): void {
    const errorData = error instanceof Error 
      ? { message: error.message, stack: error.stack }
      : { error }
    
    if (this.isDev) {
      console.error(this.formatMessage('error', context, message), errorData)
    } else {
      // 生产环境只记录到控制台（Electron主进程可以捕获）
      console.error(this.formatMessage('error', context, message))
    }
  }

  debug(context: string, message: string, data?: LogContext): void {
    if (this.isDev) {
      console.debug(this.formatMessage('debug', context, message), data ?? '')
    }
  }
}

export const logger = new Logger()
