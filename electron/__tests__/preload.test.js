import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf-8')

describe('Electron preload bridge', () => {
  it('exposes local asset persistence to the renderer', () => {
    expect(preloadSource).toContain('assets:')
    expect(preloadSource).toContain('saveFromURL')
    expect(preloadSource).toContain("ipcRenderer.invoke('assets:save-from-url'")
  })
})
