/**
 * dsh-restart-button — host half.
 *
 * Owns the button's persistent configuration (position, lock, background
 * colour, icon) in the DSH home, serves an uploaded icon, and exposes the
 * one-shot relaunch endpoint the button calls: it writes a launcher script and
 * starts it OUTSIDE this process tree, then answers immediately.
 * @module dsh-restart-button
 */
import { execFile, spawn } from 'node:child_process'
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
/** Scheduled task that carries the launcher; recreated on every click. */
const TASK_NAME = 'dsh-restart-button'

/** Built-in icon ids the browser half can draw. */
export const ICONS = ['rewind', 'power', 'refresh', 'cycle']
/** Configuration defaults; a field the user never touched keeps its default. */
const DEFAULTS = { right: 24, bottom: 128, locked: false, color: null, icon: 'rewind', customVersion: 0 }
/** Largest uploaded icon accepted, in bytes of image data. */
const ICON_MAX_BYTES = 2 * 1024 * 1024

/** DSH home, honouring the environment's override. */
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const CONFIG_PATH = join(DSH_HOME, 'restart-button.json')
/** Uploaded icons live beside the config; one file, replaced on every upload. */
const ICON_DIR = join(DSH_HOME, 'restart-button')
/** Working directory of the launcher; kept free of spaces so the task action needs no quoting. */
const WORK_DIR = join(process.env.LOCALAPPDATA ?? process.env.TEMP ?? DSH_HOME, 'dsh-restart-button')

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

/**
 * The launcher: ask the app to close, force what is left, then start it again.
 * Every step is logged, because once it runs there is no UI left to report into.
 * @param exe - the desktop executable to start again.
 * @param logPath - log the launcher appends its progress to.
 * @returns the script body.
 */
export function launcherScript(exe, logPath) {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$log = '" + logPath + "'",
    "function Write-Log($m) { Add-Content -LiteralPath $log -Value (('[{0}] {1}' -f (Get-Date).ToString('o'), $m)) }",
    "Write-Log ('launcher start pid=' + $PID)",
    'Start-Sleep -Milliseconds 600',
    "$procs = @(Get-Process -Name '" + IMAGE_NAME + "' -ErrorAction SilentlyContinue)",
    "Write-Log ('closing ' + $procs.Count + ' process(es): ' + ($procs.Id -join ','))",
    'foreach ($p in $procs) { try { [void]$p.CloseMainWindow() } catch {} }',
    'Start-Sleep -Milliseconds 2000',
    "$left = @(Get-Process -Name '" + IMAGE_NAME + "' -ErrorAction SilentlyContinue)",
    'foreach ($p in $left) { try { Stop-Process -Id $p.Id -Force } catch {} }',
    'Start-Sleep -Milliseconds 1500',
    'for ($i = 1; $i -le 3; $i++) {',
    "  try { Start-Process -FilePath '" + exe + "' -WorkingDirectory '" + dirname(exe) + "' } catch { Write-Log ('launch error: ' + $_.Exception.Message) }",
    '  Start-Sleep -Seconds 4',
    "  $now = @(Get-Process -Name '" + IMAGE_NAME + "' -ErrorAction SilentlyContinue)",
    "  if ($now.Count -gt 0) { Write-Log ('relaunched: ' + ($now.Id -join ',')); exit 0 }",
    "  Write-Log ('attempt ' + $i + ' produced no process')",
    '}',
    "Write-Log 'FAILED: the app is not running, start it manually'",
  ].join('\r\n')
}

/** Run one helper executable to completion. */
function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 20000, windowsHide: true }, (error) => (error === null ? resolve() : reject(error)))
  })
}

/**
 * Start the launcher outside this process tree and answer immediately.
 * @param dryRun - when true, prepare the launcher and report its paths without starting it.
 */
async function relaunch(dryRun) {
  const exe = resolveExe()
  if (exe === undefined) throw new Error('cannot locate ' + EXE_NAME)
  await mkdir(WORK_DIR, { recursive: true })
  const scriptPath = join(WORK_DIR, 'restart.ps1')
  const logPath = join(WORK_DIR, 'restart.log')
  await writeFile(scriptPath, launcherScript(exe, logPath), 'utf8')
  if (dryRun === true) return { ok: true, dryRun: true, exe: exe, script: scriptPath, log: logPath }
  const command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ' + scriptPath
  // A scheduled task is owned by the Task Scheduler service, so it survives the
  // teardown of the app process tree that a plain child process usually does not.
  try {
    await run('schtasks.exe', ['/create', '/tn', TASK_NAME, '/tr', command, '/sc', 'once', '/st', '23:59', '/f'])
    await run('schtasks.exe', ['/run', '/tn', TASK_NAME])
    return { ok: true, via: 'task', exe: exe, log: logPath }
  } catch {
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref()
    return { ok: true, via: 'process', exe: exe, log: logPath }
  }
}

/** Mount the endpoints. */
export function apply(ctx) {
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
        .then((body) => relaunch(body !== null && typeof body === 'object' && body.dryRun === true))
        .then((result) => writeJson(res, 200, result), (error) => writeJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) }))
    },
  }
  for (const route of [config, icon, restart]) ctx.effect(() => ctx.webServer.register(route), 'restart-button: ' + route.path)
}
