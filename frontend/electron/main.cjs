const electronModule = require('electron')
const { spawn } = require('node:child_process')
const { appendFileSync, existsSync, mkdirSync } = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

function appendBootstrapLine(message) {
  const line = `[${new Date().toISOString()}] ${message}`

  try {
    appendFileSync(path.join(os.tmpdir(), 'orion-electron-bootstrap.log'), `${line}\n`, 'utf8')
  } catch {
    // Ignore bootstrap logging failures.
  }
}

if (
  (!electronModule || typeof electronModule === 'string' || !electronModule.app) &&
  process.env.ORION_ELECTRON_RELAUNCHED !== '1'
) {
  appendBootstrapLine(
    `electron module unavailable; relaunching without ELECTRON_RUN_AS_NODE=${process.env.ELECTRON_RUN_AS_NODE ?? 'unset'}`,
  )

  const relaunchedEnv = { ...process.env, ORION_ELECTRON_RELAUNCHED: '1' }
  delete relaunchedEnv.ELECTRON_RUN_AS_NODE

  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    env: relaunchedEnv,
    stdio: 'ignore',
    windowsHide: false,
  })

  child.unref()
  process.exit(0)
}

const { app, BrowserWindow, dialog, ipcMain, shell } = electronModule

const APP_NAME = 'Hotloop'
const APP_USER_MODEL_ID = 'com.orcrobotics.orionconsole'

const DEFAULT_BRIDGE_HOST = process.env.ORION_BRIDGE_HOST ?? '127.0.0.1'
const DEFAULT_BRIDGE_PORT = Number.parseInt(process.env.ORION_BRIDGE_PORT ?? '8765', 10)
const DEV_SERVER_URL = process.env.ORION_ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:5173'
const BRIDGE_STARTUP_TIMEOUT_MS = 5000
const BRIDGE_POLL_INTERVAL_MS = 250
const BRIDGE_PORT_SEARCH_RANGE = 12
const MIN_COMPATIBLE_BRIDGE_API_VERSION = 2

let bridgeHost = DEFAULT_BRIDGE_HOST
let bridgePort = DEFAULT_BRIDGE_PORT

let mainWindow = null
let bridgeProcess = null
let bridgeOwnedByApp = false
let appIsQuitting = false
let bridgeStartupPromise = null
let lastBridgeError = null

function getBridgeBaseUrl() {
  return `http://${bridgeHost}:${bridgePort}`
}

function syncBridgeEnvironment() {
  process.env.ORION_BRIDGE_HOST = bridgeHost
  process.env.ORION_BRIDGE_PORT = String(bridgePort)
}

syncBridgeEnvironment()

const singleInstanceLock = app.requestSingleInstanceLock()

if (!singleInstanceLock) {
  appendBootstrapLine('another ORION Console instance is already running; exiting duplicate process')
  app.quit()
  process.exit(0)
}

function getBootstrapLogPath() {
  return path.join(os.tmpdir(), 'orion-electron-bootstrap.log')
}

function getRuntimeLogPath() {
  const userDataDir = app.getPath('userData')
  mkdirSync(userDataDir, { recursive: true })
  return path.join(userDataDir, 'orion-electron.log')
}

function logRuntime(message) {
  const line = `[${new Date().toISOString()}] ${message}`
  console.log(line)

  try {
    appendFileSync(getBootstrapLogPath(), `${line}\n`, 'utf8')
  } catch {
    // Ignore bootstrap logging failures.
  }

  try {
    appendFileSync(getRuntimeLogPath(), `${line}\n`, 'utf8')
  } catch {
    // Ignore logging failures so bootstrap never depends on filesystem writes.
  }
}

app.setName(APP_NAME)
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}
app.on('second-instance', () => {
  logRuntime('second-instance received')

  if (!mainWindow) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
})

function resolveBridgeScriptPath() {
  return path.resolve(__dirname, '..', '..', 'telemetry_bridge.py')
}

function resolveRendererEntry() {
  return path.join(app.getAppPath(), 'dist', 'index.html')
}

function resolveWindowIconPath() {
  const iconFileName = process.platform === 'win32' ? 'icon.ico' : 'icon.png'

  if (app.isPackaged) {
    return path.join(process.resourcesPath, iconFileName)
  }

  return path.resolve(__dirname, '..', 'build', iconFileName)
}

function getBridgeBinaryName() {
  return process.platform === 'win32' ? 'orion-telemetry-bridge.exe' : 'orion-telemetry-bridge'
}

function resolveBridgeExecutablePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bridge', getBridgeBinaryName())
  }

  return path.resolve(__dirname, '..', 'bridge-dist', getBridgeBinaryName())
}

function getPythonCandidates() {
  if (process.env.ORION_PYTHON_EXECUTABLE) {
    return [{ command: process.env.ORION_PYTHON_EXECUTABLE, args: [] }]
  }

  if (process.platform === 'win32') {
    return [
      { command: 'py', args: ['-3'] },
      { command: 'python', args: [] },
    ]
  }

  return [
    { command: 'python3', args: [] },
    { command: 'python', args: [] },
  ]
}

function canRunCommand(command, args) {
  return new Promise((resolve) => {
    const probe = spawn(command, [...args, '--version'], {
      stdio: 'ignore',
    })

    probe.once('error', () => {
      resolve(false)
    })

    probe.once('exit', (code) => {
      resolve(code === 0)
    })
  })
}

async function resolvePythonCommand() {
  for (const candidate of getPythonCandidates()) {
    if (await canRunCommand(candidate.command, candidate.args)) {
      return candidate
    }
  }

  return null
}

function runPython(pythonCommand, args) {
  return new Promise((resolve) => {
    let output = ''
    const child = spawn(pythonCommand.command, [...pythonCommand.args, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    child.stdout?.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.once('error', (error) => resolve({ ok: false, output: error.message }))
    child.once('exit', (code) => resolve({ ok: code === 0, output }))
  })
}

// Running from source needs pynetworktables in the selected interpreter; the
// bundled bridge executable ships it. Install requirements.txt once if missing.
async function ensurePythonBridgeDependencies(pythonCommand) {
  const probe = await runPython(pythonCommand, ['-c', 'import networktables'])
  if (probe.ok) {
    return true
  }

  const requirementsPath = path.resolve(__dirname, '..', '..', 'requirements.txt')
  logRuntime(`python bridge dependencies missing; installing ${requirementsPath}`)
  const install = await runPython(pythonCommand, ['-m', 'pip', 'install', '-r', requirementsPath])
  logRuntime(`[bridge][pip] ${install.output.trim().split('\n').slice(-3).join(' | ')}`)

  if (!install.ok) {
    lastBridgeError = `Python is missing pynetworktables and pip install failed. Run: pip install -r requirements.txt`
    return false
  }

  return true
}

async function canLaunchLocalBridge() {
  if (existsSync(resolveBridgeExecutablePath())) {
    return true
  }

  return Boolean(await resolvePythonCommand())
}

function canBindPort(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once('error', () => {
      resolve(false)
    })

    server.once('listening', () => {
      server.close(() => resolve(true))
    })

    server.listen(port, host)
  })
}

async function inspectBridgePort(host, port) {
  const baseUrl = `http://${host}:${port}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1200)

  try {
    const response = await fetch(`${baseUrl}/api/bridge/connection`, {
      cache: 'no-store',
      signal: controller.signal,
    })

    if (!response.ok) {
      return { healthy: false, compatible: false, apiVersion: null }
    }

    const payload = await response.json()
    const bridgeStatus = payload?.bridgeStatus ?? null
    const apiVersion =
      typeof bridgeStatus?.bridgeApiVersion === 'number'
        ? bridgeStatus.bridgeApiVersion
        : null
    const compatible =
      (apiVersion !== null && apiVersion >= MIN_COMPATIBLE_BRIDGE_API_VERSION) ||
      Array.isArray(bridgeStatus?.discoveredCameraFeeds)

    return {
      healthy: true,
      compatible,
      apiVersion,
    }
  } catch {
    return { healthy: false, compatible: false, apiVersion: null }
  } finally {
    clearTimeout(timeout)
  }
}

async function resolveBridgeRuntimePort() {
  const defaultInspection = await inspectBridgePort(DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT)
  if (defaultInspection.compatible) {
    return DEFAULT_BRIDGE_PORT
  }

  if (!defaultInspection.healthy && (await canBindPort(DEFAULT_BRIDGE_HOST, DEFAULT_BRIDGE_PORT))) {
    return DEFAULT_BRIDGE_PORT
  }

  if (defaultInspection.healthy && !defaultInspection.compatible) {
    logRuntime(
      `stale bridge detected on ${DEFAULT_BRIDGE_HOST}:${DEFAULT_BRIDGE_PORT}; searching for alternate port`,
    )

    if (!(await canLaunchLocalBridge())) {
      logRuntime(
        'no compatible local bridge runtime is available in this session; keeping the existing bridge target',
      )
      return DEFAULT_BRIDGE_PORT
    }
  }

  for (let offset = 1; offset <= BRIDGE_PORT_SEARCH_RANGE; offset += 1) {
    const candidatePort = DEFAULT_BRIDGE_PORT + offset
    const inspection = await inspectBridgePort(DEFAULT_BRIDGE_HOST, candidatePort)

    if (inspection.compatible) {
      return candidatePort
    }

    if (!inspection.healthy && (await canBindPort(DEFAULT_BRIDGE_HOST, candidatePort))) {
      return candidatePort
    }
  }

  return DEFAULT_BRIDGE_PORT
}

async function isBridgeHealthy() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1200)

  try {
    const response = await fetch(`${getBridgeBaseUrl()}/health`, {
      cache: 'no-store',
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForBridgeHealth(timeoutMs) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await isBridgeHealthy()) {
      return true
    }

    await new Promise((resolve) => setTimeout(resolve, BRIDGE_POLL_INTERVAL_MS))
  }

  return false
}

async function startBridgeIfNeededInternal() {
  const baseUrl = getBridgeBaseUrl()
  logRuntime(`checking bridge health at ${baseUrl}`)
  const bridgeInspection = await inspectBridgePort(bridgeHost, bridgePort)
  if (bridgeInspection.compatible) {
    bridgeOwnedByApp = false
    logRuntime('bridge already healthy; reusing existing instance')
    return true
  }

  if (bridgeInspection.healthy && !bridgeInspection.compatible) {
    logRuntime(`incompatible bridge detected at ${baseUrl}; waiting for a compatible local bridge`)
    return false
  }

  if (bridgeProcess && !bridgeProcess.killed) {
    logRuntime('bridge process already running; waiting for health')
    return waitForBridgeHealth(BRIDGE_STARTUP_TIMEOUT_MS)
  }

  const bridgeExecutablePath = resolveBridgeExecutablePath()
  const hasBridgeExecutable = existsSync(bridgeExecutablePath)

  let launchCommand = null
  let launchArgs = []
  let launchCwd = null

  if (hasBridgeExecutable) {
    launchCommand = bridgeExecutablePath
    launchArgs = ['--host', bridgeHost, '--port', String(bridgePort)]
    launchCwd = path.dirname(bridgeExecutablePath)
    logRuntime(`using bundled bridge executable: ${bridgeExecutablePath}`)
  } else {
    const pythonCommand = await resolvePythonCommand()
    if (!pythonCommand) {
      const message = app.isPackaged
        ? 'O binario do telemetry bridge nao foi encontrado dentro do pacote desktop.'
        : 'Hotloop precisa de Python 3 instalado ou de um bridge standalone compilado para iniciar o telemetry bridge local.'

      logRuntime(`bridge startup skipped: ${message}`)
      lastBridgeError = message
      return false
    }

    if (!(await ensurePythonBridgeDependencies(pythonCommand))) {
      return false
    }

    const scriptPath = resolveBridgeScriptPath()
    launchCommand = pythonCommand.command
    launchArgs = [
      ...pythonCommand.args,
      scriptPath,
      '--host',
      bridgeHost,
      '--port',
      String(bridgePort),
    ]
    launchCwd = path.dirname(scriptPath)
    logRuntime(`using python bridge source: ${scriptPath}`)
  }

  let startupErrorShown = false
  let stderrBuffer = ''

  bridgeOwnedByApp = true
  lastBridgeError = null
  logRuntime(`starting bridge: ${launchCommand} ${launchArgs.join(' ')}`)
  bridgeProcess = spawn(launchCommand, launchArgs, {
    cwd: launchCwd,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  bridgeProcess.stdout?.on('data', (chunk) => {
    logRuntime(`[bridge][stdout] ${chunk.toString().trimEnd()}`)
  })

  bridgeProcess.stderr?.on('data', (chunk) => {
    const text = chunk.toString()
    stderrBuffer += text
    logRuntime(`[bridge][stderr] ${text.trimEnd()}`)
  })

  bridgeProcess.once('error', (error) => {
    if (appIsQuitting || startupErrorShown) {
      return
    }

    startupErrorShown = true
    logRuntime(`bridge process error: ${error.message}`)
  })

  bridgeProcess.once('exit', (code, signal) => {
    bridgeProcess = null
    logRuntime(`bridge process exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`)

    if (!bridgeOwnedByApp || appIsQuitting || startupErrorShown || code === 0) {
      return
    }

    startupErrorShown = true

    const summary =
      stderrBuffer.trim() ||
      `O telemetry bridge foi encerrado com codigo ${code ?? 'desconhecido'}${signal ? ` (${signal})` : ''}.`

    logRuntime(`telemetry bridge interrupted: ${summary}`)
    lastBridgeError = summary.split('\n').filter(Boolean).pop() ?? summary
  })

  const bridgeReady = await waitForBridgeHealth(BRIDGE_STARTUP_TIMEOUT_MS)
  logRuntime(`bridge ready result: ${bridgeReady}`)

  if (!bridgeReady && !appIsQuitting && !startupErrorShown) {
    startupErrorShown = true
    logRuntime(
      `bridge not ready yet: ${
        stderrBuffer.trim() || 'Hotloop interface will stay available while the backend retries.'
      }`,
    )
  }

  return bridgeReady
}

async function startBridgeIfNeeded() {
  if (bridgeStartupPromise) {
    return bridgeStartupPromise
  }

  bridgeStartupPromise = (async () => {
    try {
      return await startBridgeIfNeededInternal()
    } finally {
      bridgeStartupPromise = null
    }
  })()

  return bridgeStartupPromise
}

function stopOwnedBridge() {
  if (!bridgeOwnedByApp || !bridgeProcess || bridgeProcess.killed) {
    return
  }

  logRuntime('stopping owned bridge process')
  bridgeProcess.kill()

  setTimeout(() => {
    if (bridgeProcess && !bridgeProcess.killed) {
      bridgeProcess.kill('SIGKILL')
    }
  }, 1500).unref()
}

ipcMain.handle('orion:restart-bridge', async () => {
  const ready = await startBridgeIfNeeded()
  return {
    ok: ready,
    bridgeBaseUrl: getBridgeBaseUrl(),
    error: ready ? null : lastBridgeError,
  }
})

function createMainWindow() {
  logRuntime('creating main window')
  const window = new BrowserWindow({
    title: APP_NAME,
    width: 1600,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    autoHideMenuBar: true,
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#0f1418',
    icon: resolveWindowIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    logRuntime(`opening external url: ${url}`)
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.once('ready-to-show', () => {
    logRuntime('main window ready to show')
    window.show()
  })

  window.webContents.on('did-finish-load', () => {
    logRuntime('renderer finished loading')
  })

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logRuntime(
      `renderer failed to load: code=${errorCode} description=${errorDescription} url=${validatedURL}`,
    )
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    logRuntime(`renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`)
  })

  window.on('closed', () => {
    logRuntime('main window closed')
  })

  if (app.isPackaged) {
    logRuntime(`loading packaged renderer from ${resolveRendererEntry()}`)
    void window.loadFile(resolveRendererEntry()).catch((error) => {
      logRuntime(`loadFile rejected: ${error.stack ?? error.message}`)
      dialog.showErrorBox('Falha ao carregar interface', error.message)
    })
  } else {
    logRuntime(`loading dev renderer from ${DEV_SERVER_URL}`)
    void window.loadURL(DEV_SERVER_URL).catch((error) => {
      logRuntime(`loadURL rejected: ${error.stack ?? error.message}`)
      dialog.showErrorBox('Falha ao carregar interface', error.message)
    })
  }

  return window
}

app.on('before-quit', () => {
  appIsQuitting = true
  logRuntime('before-quit received')
  stopOwnedBridge()
})

app.whenReady().then(async () => {
  try {
    logRuntime('app ready')
    bridgePort = await resolveBridgeRuntimePort()
    syncBridgeEnvironment()
    logRuntime(`bridge runtime target selected: ${getBridgeBaseUrl()}`)
    void startBridgeIfNeeded().catch((error) => {
      logRuntime(`background bridge startup failed: ${error.stack ?? error.message ?? String(error)}`)
    })
    mainWindow = createMainWindow()

    app.on('activate', () => {
      logRuntime('app activate event')
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    logRuntime(`whenReady bootstrap failed: ${message}`)
    dialog.showErrorBox('Falha ao iniciar Hotloop', message)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  logRuntime('window-all-closed received')
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

process.on('uncaughtException', (error) => {
  logRuntime(`uncaught exception: ${error.stack ?? error.message}`)
})

process.on('unhandledRejection', (reason) => {
  logRuntime(`unhandled rejection: ${String(reason)}`)
})
