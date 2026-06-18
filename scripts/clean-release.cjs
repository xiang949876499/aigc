const fs = require('node:fs')
const path = require('node:path')

const releaseDir = path.join(__dirname, '..', 'release')

for (const name of ['win-unpacked', '__uninstaller-nsis-aigc-app.exe']) {
  const target = path.join(releaseDir, name)
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch {
    // ignore
  }
}
