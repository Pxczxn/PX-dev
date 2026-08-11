// PX Dev — discovery 侧的 detectors 桥接
//
// discovery 模块统一从这里取探测原语，物理实现仍在 src/main/detectors（唯一事实来源）。
// 与 discovery/scanners/index.ts 同一套约定：后续调整目录结构只需改这一处。

export * from '../../detectors'
