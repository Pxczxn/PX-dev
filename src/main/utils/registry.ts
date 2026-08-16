// PX Dev — Windows Registry Helper
// Stores the data directory path in HKCU\Software\PXDev\DataPath
// This is read BEFORE any config file is loaded, so the path itself
// can live outside the data directory it points to.

import { execSync } from 'child_process'
import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

const REG_KEY = 'HKCU\\Software\\PXDev'
const REG_VALUE = 'DataPath'

function isPortable(): boolean {
  // In packaged app, the userData path contains the product name and version.
  // For a portable install, userData sits next to the .exe.
  // We detect portability by checking if the exe exists alongside userData.
  const exeDir = app.isPackaged
    ? join(process.resourcesPath, '..')
    : ''
  const exeNextToUserData = existsSync(join(app.getPath('userData'), '..', 'PX Dev.exe'))
    || existsSync(join(app.getPath('userData'), '..', 'PX Dev (Setup) 0.1.0.exe'))
  return exeNextToUserData
}

/** Read data path from Windows registry. Returns null if not set. */
export function getDataPathFromRegistry(): string | null {
  if (process.platform !== 'win32') return null

  try {
    const output = execSync(
      `reg query "${REG_KEY}" /v ${REG_VALUE} 2>nul`,
      { encoding: 'utf-8', windowsHide: true },
    )
    const match = output.match(/DataPath\s+REG_SZ\s+(.+)/)
    if (match) {
      const path = match[1].trim()
      return path.length > 0 ? path : null
    }
    return null
  } catch {
    return null
  }
}

/** Write data path to Windows registry. */
export function setDataPathInRegistry(path: string): void {
  if (process.platform !== 'win32') return

  try {
    // Ensure key exists, then set value
    execSync(
      `reg add "${REG_KEY}" /v ${REG_VALUE} /t REG_SZ /d "${path}" /f`,
      { encoding: 'utf-8', windowsHide: true },
    )
  } catch (err) {
    console.error('[Registry] failed to write DataPath:', err)
    throw err
  }
}

/** Delete data path from Windows registry. */
export function clearDataPathInRegistry(): void {
  if (process.platform !== 'win32') return

  try {
    execSync(
      `reg delete "${REG_KEY}" /v ${REG_VALUE} /f 2>nul`,
      { encoding: 'utf-8', windowsHide: true },
    )
  } catch {
    // Ignore if key/value doesn't exist
  }
}

export { isPortable }
