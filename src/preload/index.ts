// PX Dev — Preload Entry
// contextBridge.exposeInMainWorld('pxDev', api)

import { contextBridge } from 'electron'
import { createPxDevAPI } from './api'

const api = createPxDevAPI()

contextBridge.exposeInMainWorld('pxDev', api)
