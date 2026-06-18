const { execFileSync } = require('node:child_process')

const commandLine = process.env.FUNASR_CLI || 'funasr'
const commandMatch = commandLine.match(/"([^"]+)"|'([^']+)'|(\S+)/)
const command = commandMatch?.[1] || commandMatch?.[2] || commandMatch?.[3] || 'funasr'
const locator = process.platform === 'win32' ? 'where.exe' : 'which'

function getPythonVersion() {
  try {
    const output = execFileSync('python', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim()
    return output.match(/Python\s+(\d+)\.(\d+)/)?.slice(1, 3).map(Number) || null
  } catch {
    return null
  }
}

try {
  const resolved = execFileSync(locator, [command], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim()
  console.log(`FunASR CLI found: ${resolved.split(/\r?\n/)[0]}`)
} catch {
  console.error(`FunASR CLI not found: ${command}`)
  const version = getPythonVersion()
  if (version && (version[0] > 3 || (version[0] === 3 && version[1] >= 13))) {
    console.error('Current Python is 3.13+. FunASR dependencies may fail to build there.')
    console.error('Recommended setup:')
    console.error('  conda create -n funasr python=3.10 -y')
    console.error('  conda activate funasr')
    console.error('  pip install -U funasr')
    console.error('  setx FUNASR_CLI "%USERPROFILE%\\anaconda3\\envs\\funasr\\Scripts\\funasr.exe"')
  } else {
    console.error('Install it with: pip install -U funasr')
  }
  console.error('If it is installed in a custom location, set FUNASR_CLI to the executable path.')
  process.exitCode = 1
}
