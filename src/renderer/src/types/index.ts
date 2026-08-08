// PX Dev — Renderer Global Type Declarations
// Exposes window.pxDev typed API to all renderer components

import type { PxDevAPI } from '../../../preload/api'

declare global {
  interface Window {
    pxDev: PxDevAPI
  }
}

export {}
