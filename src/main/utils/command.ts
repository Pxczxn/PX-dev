// PX Dev — Command Builder
// Structured command parsing + Windows .cmd remapping

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

/**
 * Build a structured command from a Service definition.
 *
 * - structured mode (default): command + args split, Windows auto-appends .cmd
 * - shell mode: shell:true, command passed as-is
 *
 * @param service - Service definition with command, args, cwd, env
 * @returns BuiltCommand ready for child_process.spawn()
 */
export function buildCommand(service: Service): BuiltCommand {
  const cwd = service.cwd
  const env: NodeJS.ProcessEnv = { ...process.env, ...service.env }
  const shellMode = service.shellMode ?? false

  let executable: string
  let args: string[]

  if (shellMode) {
    // Shell mode: pass entire command + args as a single string to shell
    executable = service.command
    args = service.args ?? []
  } else {
    // Structured mode: split executable + args, apply Windows .cmd remapping
    executable = resolveExecutable(service.command)
    args = service.args ?? []
  }

  logger.debug(`buildCommand: executable=${executable}, args=${JSON.stringify(args)}, shell=${shellMode}`)

  return {
    executable,
    args,
    options: {
      cwd,
      env,
      shell: shellMode,
      windowsHide: true,
    },
  }
}

/**
 * Resolve an executable name, applying Windows .cmd remapping.
 * On Windows, npm/pnpm/yarn need .cmd suffix when shell:false.
 */
function resolveExecutable(command: string): string {
  // Only remap on Windows
  if (process.platform === 'win32') {
    const lower = command.toLowerCase()
    // Check if already has an extension
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
 * Spawn a child process using a BuiltCommand.
 * Thin wrapper around child_process.spawn for consistency.
 */
export function spawnCommand(built: BuiltCommand) {
  return spawn(built.executable, built.args, built.options)
}
