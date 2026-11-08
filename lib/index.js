/**
 * dsh-restart-button — host half.
 *
 * Owns the button's persistent configuration (position, lock, background
 * colour, icon) in the DSH home, serves an uploaded icon, and runs the
 * one-shot restart as an observable job: launch, verify the launcher really
 * started, cancel on request, and give up on its own after a timeout so the
 * button can never spin forever.
 * @module dsh-restart-button
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Stable cordis plugin name (matches cordis.patch.yml insert id). */
export const name = 'restart-button'
/** The route registry this plugin registers into. */
export const inject = ['webServer']

/** Image name Windows knows the desktop app by, without its extension. */
const IMAGE_NAME = 'DeepSeek Harness'
/** Executable the launcher starts again. */
const EXE_NAME = IMAGE_NAME + '.exe'
/** Built-in icon ids the browser half can draw. */
export const ICONS = ['rewind', 'power', 'refresh', 'cycle']
/** Configuration defaults; a field the user never touched keeps its default. */
const DEFAULTS = { right: 24, bottom: 128, locked: false, color: null, icon: 'rewind', customVersion: 0 }
/** Largest uploaded icon accepted, in bytes of image data. */
const ICON_MAX_BYTES = 2 * 1024 * 1024
/** How long the launcher is given to prove it started. */
const START_VERIFY_MS = 1200
/** How long a launched restart may stay unproven before it is cancelled. */
const TIMEOUT_MS = 45000

/** DSH home, honouring the environment's override. */
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const CONFIG_PATH = join(DSH_HOME, 'restart-button.json')
/** Uploaded icons live beside the config; one file, replaced on every upload. */
const ICON_DIR = join(DSH_HOME, 'restart-button')
/** Working directory of the launcher; kept free of spaces so no quoting is needed. */
const WORK_DIR = join(process.env.LOCALAPPDATA ?? process.env.TEMP ?? DSH_HOME, 'dsh-restart-button')
const LAUNCHER_PATH = join(WORK_DIR, 'relauncher.mjs')
const LAUNCH_LOG = join(WORK_DIR, 'relaunch.log')
const PID_PATH = join(WORK_DIR, 'relauncher.pid')
const CANCEL_PATH = join(WORK_DIR, 'cancel.marker')

/** Clamp one inset into a sane pixel range. */
function clampInset(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 0), 20000) : fallback
}

/** Normalise one stored field, accepting only the values the schema allows. */
function normalise(raw) {
  const source = raw === null || typeof raw !== 'object' ? {} : raw
  return {
    right: clampInset(source.right, DEFAULTS.right),
    bottom: clampInset(source.bottom, DEFAULTS.bottom),
    locked: source.locked === true,
    color: typeof source.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(source.color) ? source.color.toLowerCase() : null,
    icon: ICONS.includes(source.icon) || source.icon === 'custom' ? source.icon : DEFAULTS.icon,
    customVersion: typeof source.customVersion === 'number' && Number.isFinite(source.customVersion) ? source.customVersion : 0,
  }
}

/** Read the persisted configuration, falling back to the defaults. */
async function readConfig() {
  try {
    return normalise(JSON.parse(await readFile(CONFIG_PATH, 'utf8')))
  } catch {
    return normalise(undefined)
  }
}

/** Merge one patch into the persisted configuration. */
async function patchConfig(patch) {
  const merged = normalise({ ...(await readConfig()), ...(patch === null || typeof patch !== 'object' ? {} : patch) })
  try {
    await mkdir(DSH_HOME, { recursive: true })
    await writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8')
  } catch {
    /* a failed write only costs the preference */
  }
  return merged
}

/** Write one JSON response. */
function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Collect a request body as one buffer. */
async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** Read and parse one JSON request body, or undefined when there is none. */
async function readJson(req, limit = 64 * 1024) {
  const text = (await readBody(req, limit)).toString('utf8')
  return text.length === 0 ? undefined : JSON.parse(text)
}

/** Map a mime type onto the extension the icon file is stored under. */
const ICON_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }

/** Store one uploaded icon and point the configuration at it. */
async function storeIcon(dataUrl) {
  if (typeof dataUrl !== 'string') throw new Error('dataUrl required')
  const match = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl)
  if (match === null) throw new Error('unsupported image encoding')
  const extension = ICON_TYPES[match[1]]
  if (extension === undefined) throw new Error('unsupported image type: ' + match[1])
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (bytes.length === 0 || bytes.length > ICON_MAX_BYTES) throw new Error('image must be between 1 byte and 2 MB')
  await mkdir(ICON_DIR, { recursive: true })
  for (const existing of await readdir(ICON_DIR).catch(() => [])) {
    if (existing.startsWith('icon.')) await rm(join(ICON_DIR, existing), { force: true })
  }
  await writeFile(join(ICON_DIR, 'icon.' + extension), bytes)
  return patchConfig({ icon: 'custom', customVersion: Date.now() })
}

/** Serve the stored icon, or 404 when the user never uploaded one. */
async function serveIcon(res) {
  const files = await readdir(ICON_DIR).catch(() => [])
  const name = files.find((entry) => entry.startsWith('icon.'))
  if (name === undefined) return writeJson(res, 404, { ok: false, error: 'no icon' })
  const extension = name.slice(name.lastIndexOf('.') + 1)
  const type = Object.keys(ICON_TYPES).find((key) => ICON_TYPES[key] === extension) ?? 'application/octet-stream'
  const bytes = await readFile(join(ICON_DIR, name))
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(bytes)
}

/** Resolve the desktop executable the launcher restarts. */
function resolveExe() {
  const candidates = [
    process.env.DSH_DESKTOP_EXE,
    join(dirname(process.execPath), EXE_NAME),
    process.resourcesPath === undefined ? undefined : join(dirname(process.resourcesPath), EXE_NAME),
  ]
  const found = candidates.find((candidate) => typeof candidate === 'string' && existsSync(candidate))
  return found === undefined ? candidates[1] : found
}

/** The in-flight restart, as the status route reports it. */
const job = { phase: 'idle', startedAt: 0, deadline: 0, message: '', pid: 0 }
/** Reads the GUI's listening port; set once the webServer service is up. */
let ctxPort = () => 0
/** Watchdog that cancels a restart that never takes effect. */
let watchdog

/** Snapshot of the job for the browser. */
function jobSnapshot() {
  return {
    phase: job.phase,
    startedAt: job.startedAt,
    deadline: job.deadline,
    message: job.message,
    remainingMs: job.deadline === 0 ? 0 : Math.max(0, job.deadline - Date.now()),
  }
}

/** Stop the launcher and freeze the job in a terminal phase. */
async function stopJob(phase, message) {
  if (watchdog !== undefined) {
    clearTimeout(watchdog)
    watchdog = undefined
  }
  try {
    await writeFile(CANCEL_PATH, phase, 'utf8')
  } catch {
    /* the marker is best-effort */
  }
  // Once the launcher has started closing the app, killing it would leave the app
  // closed with nothing to start it again: only stop a launcher that has not
  // committed to the cycle yet.
  const progress = await readFile(LAUNCH_LOG, 'utf8').catch(() => '')
  const committed = progress.includes('closing') || progress.includes('relaunch')
  if (job.pid > 0 && !committed) {
    try {
      process.kill(job.pid)
    } catch {
      /* already gone */
    }
  }
  if (job.pid > 0 && !committed) job.pid = 0
  job.phase = phase
  job.message = message
  job.deadline = 0
  return jobSnapshot()
}

/** Start the launcher and prove that it really ran. */
async function startJob() {
  if (job.phase === 'launched' && Date.now() < job.deadline) return { ok: true, ...jobSnapshot() }
  const exe = resolveExe()
  if (exe === undefined) throw new Error('cannot locate ' + EXE_NAME)
  await mkdir(WORK_DIR, { recursive: true })
  await rm(CANCEL_PATH, { force: true })
  await rm(LAUNCH_LOG, { force: true })
  await writeFile(LAUNCHER_PATH, await launcherSource(), 'utf8')
  job.phase = 'starting'
  job.startedAt = Date.now()
  job.deadline = 0
  job.message = ''
  const port = String(ctxPort())
  const launcherBinary = await resolveLauncherBinary()
  // The host itself runs the Electron binary in node mode, so the switch is in its
  // environment. It must reach a launcher that needs it, and must never reach the
  // app: a GUI started with it runs as Node and exits immediately.
  const launcherEnv = { ...process.env }
  if (launcherBinary.electron) launcherEnv.ELECTRON_RUN_AS_NODE = '1'
  else delete launcherEnv.ELECTRON_RUN_AS_NODE
  const child = spawn(launcherBinary.binary, [LAUNCHER_PATH, LAUNCH_LOG, PID_PATH, CANCEL_PATH, exe, IMAGE_NAME, port], {
    env: launcherEnv,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
  job.pid = child.pid ?? 0
  await new Promise((resolve) => setTimeout(resolve, START_VERIFY_MS))
  const log = await readFile(LAUNCH_LOG, 'utf8').catch(() => '')
  if (!log.includes('launcher start')) {
    const snapshot = await stopJob('blocked', '启动器没有跑起来（多半被 360 / 火绒 之类的安全软件拦下了），应用没有被关闭。')
    return { ok: false, ...snapshot }
  }
  job.phase = 'launched'
  job.deadline = Date.now() + TIMEOUT_MS
  watchdog = setTimeout(() => {
    if (job.phase === 'launched') stopJob('timeout', '重启超过 ' + Math.round(TIMEOUT_MS / 1000) + ' 秒没有生效，已自动终止。可稍后重试，或手动退出应用。')
  }, TIMEOUT_MS)
  if (typeof watchdog.unref === 'function') watchdog.unref()
  return { ok: true, ...jobSnapshot() }
}

/** Fold the launcher's terminal log lines into the job state. */
async function refreshFromLog() {
  if (job.phase !== 'launched' && job.phase !== 'starting') return
  const text = await readFile(LAUNCH_LOG, 'utf8').catch(() => '')
  if (text.length === 0) return
  const lines = text.split('\n').filter((line) => line.length > 0)
  const last = lines[lines.length - 1] ?? ''
  const fail = lines.find((line) => line.includes('FAILED'))
  if (last.includes('relaunched')) {
    if (watchdog !== undefined) {
      clearTimeout(watchdog)
      watchdog = undefined
    }
    job.phase = 'done'
    job.message = '应用已经重新拉起。'
    job.deadline = 0
    return
  }
  if (fail !== undefined) {
    if (watchdog !== undefined) {
      clearTimeout(watchdog)
      watchdog = undefined
    }
    job.phase = 'failed'
    job.message = fail.replace(/^\[[^\]]+\]\s*/, '')
    job.deadline = 0
    return
  }
  if (last.includes('cancelled')) {
    job.phase = 'cancelled'
    job.message = '本次重启已终止，应用没有被关闭。'
    job.deadline = 0
  }
}

/** Read the launcher log tail, for the settings page and for diagnosis. */
async function readLogTail() {
  const text = await readFile(LAUNCH_LOG, 'utf8').catch(() => '')
  return text.split('\n').filter((line) => line.length > 0).slice(-6)
}

/** Mount the endpoints. */
export function apply(ctx) {
  if (typeof ctx.webServer.port === 'number') ctxPort = () => ctx.webServer.port
  const config = {
    kind: 'exact',
    path: '/api/restart-button/config',
    handler: (req, res) => {
      if (req.method === 'GET') {
        readConfig().then((value) => writeJson(res, 200, value), (error) => writeJson(res, 500, { ok: false, error: String(error) }))
        return
      }
      readJson(req)
        .then((body) => patchConfig(body))
        .then((value) => writeJson(res, 200, { ok: true, config: value }), (error) => writeJson(res, 400, { ok: false, error: String(error) }))
    },
  }
  const icon = {
    kind: 'exact',
    path: '/api/restart-button/icon',
    handler: (req, res) => {
      if (req.method !== 'POST') {
        serveIcon(res).catch((error) => writeJson(res, 500, { ok: false, error: String(error) }))
        return
      }
      readJson(req, 4 * 1024 * 1024)
        .then((body) => storeIcon(body === null || body === undefined ? undefined : body.dataUrl))
        .then((value) => writeJson(res, 200, { ok: true, config: value }), (error) => writeJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) }))
    },
  }
  const restart = {
    kind: 'exact',
    path: '/api/restart-button/restart',
    handler: (req, res) => {
      readJson(req)
        .then((body) => (body !== null && typeof body === 'object' && body.dryRun === true ? { ok: true, dryRun: true, exe: resolveExe(), launcher: LAUNCHER_PATH, log: LAUNCH_LOG } : startJob()))
        .then((result) => writeJson(res, 200, result), (error) => writeJson(res, 500, { ok: false, phase: 'failed', message: String(error && error.message ? error.message : error) }))
    },
  }
  const status = {
    kind: 'exact',
    path: '/api/restart-button/status',
    handler: (req, res) => {
      refreshFromLog()
        .then(() => {
          if (job.phase === 'launched' && job.deadline > 0 && Date.now() > job.deadline) {
            return stopJob('timeout', '重启超过 ' + Math.round(TIMEOUT_MS / 1000) + ' 秒没有生效，已自动终止。')
          }
          return jobSnapshot()
        })
        .then((snapshot) => writeJson(res, 200, snapshot), (error) => writeJson(res, 500, { ok: false, phase: 'failed', message: String(error) }))
    },
  }
  const cancel = {
    kind: 'exact',
    path: '/api/restart-button/cancel',
    handler: (req, res) => {
      readFile(LAUNCH_LOG, 'utf8')
        .catch(() => '')
        .then(async (text) => {
          // Past the close request the app may already be shutting down: cancelling
          // then would leave it closed, so the job keeps going instead.
          if (text.includes('close request')) return { ok: false, ...(await stopJob('irreversible', '已经发出关闭指令，这次重启无法取消——应用会重新打开。')) }
          return { ok: true, ...(await stopJob('cancelled', '已终止本次重启，应用没有被关闭。')) }
        })
        .then((snapshot) => writeJson(res, 200, snapshot), (error) => writeJson(res, 500, { ok: false, message: String(error) }))
    },
  }
  const log = {
    kind: 'exact',
    path: '/api/restart-button/log',
    handler: (req, res) => {
      readLogTail().then((lines) => writeJson(res, 200, { lines }), () => writeJson(res, 200, { lines: [] }))
    },
  }
  for (const route of [config, icon, restart, status, cancel, log]) ctx.effect(() => ctx.webServer.register(route), 'restart-button: ' + route.path)
}

/** The launcher source, written next to the log on every attempt. */
/** Resolve a standalone node binary; falling back keeps the app binary path working. */
async function resolveLauncherBinary() {
  if (typeof process.env.DSH_NODE === 'string' && existsSync(process.env.DSH_NODE)) return { binary: process.env.DSH_NODE, electron: false }
  const roots = join(homedir(), '.dsh', 'dsh-runtimes')
  const entries = await readdir(roots).catch(() => [])
  for (const entry of entries) {
    const candidate = join(roots, entry, 'dependencies', 'node', 'bin', 'node.exe')
    if (existsSync(candidate)) return { binary: candidate, electron: false }
  }
  return { binary: process.execPath, electron: true }
}

/** The relauncher shipped beside this module, copied to the work dir on every attempt. */
const LAUNCHER_FILE = new URL('./relauncher.mjs', import.meta.url)

/** Read the relauncher source from the package. */
async function launcherSource() {
  return readFile(LAUNCHER_FILE, 'utf8')
}
