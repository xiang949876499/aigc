import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8')

describe('Electron main window menu', () => {
  it('disables the native application and window menus', () => {
    expect(mainSource).toMatch(/Menu\.setApplicationMenu\(null\)/)
    expect(mainSource).toMatch(/win\.setMenu\(null\)/)
    expect(mainSource).toMatch(/autoHideMenuBar:\s*true/)
  })

  it('registers local asset persistence IPC handlers', () => {
    expect(mainSource).toContain("ipcMain.handle('assets:save-from-url'")
    expect(mainSource).toContain('saveRemoteAsset')
    expect(mainSource).toContain("app.getPath('userData')")
  })
})
