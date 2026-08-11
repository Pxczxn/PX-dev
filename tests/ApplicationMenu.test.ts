import { describe, expect, it } from 'vitest'
import { createApplicationMenuTemplate } from '../src/main/menu/applicationMenu'

describe('application menu', () => {
  it('uses Chinese top-level labels instead of Electron defaults', () => {
    const labels = createApplicationMenuTemplate().map((item) => item.label)

    expect(labels).toEqual(['文件', '编辑', '视图', '窗口', '帮助'])
  })

  it('keeps the common edit and view actions available', () => {
    const template = createApplicationMenuTemplate()
    const editMenu = template.find((item) => item.label === '编辑')
    const viewMenu = template.find((item) => item.label === '视图')

    expect(editMenu?.submenu).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '撤销', role: 'undo' }),
        expect.objectContaining({ label: '复制', role: 'copy' }),
        expect.objectContaining({ label: '粘贴', role: 'paste' }),
      ]),
    )
    expect(viewMenu?.submenu).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '重新加载', role: 'reload' }),
        expect.objectContaining({ label: '切换开发者工具', role: 'toggleDevTools' }),
      ]),
    )
  })
})
