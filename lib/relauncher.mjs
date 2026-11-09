/**
 * dsh-restart-button — the detached relauncher.
 *
 * Runs on a node binary (falling back to the app's own binary), so it starts no
 * shell and no PowerShell: security suites that block script execution leave it
 * alone. It asks the app to quit, waits until no app process is left, starts the
 * app again with a CLEANED environment, and only reports success once the very
 * process it started is visible. Every step lands in the log the settings page
 * can read.
 *
 * The environment matters: the dsh host runs the Electron binary in Node mode,
 * so ELECTRON_RUN_AS_NODE is inherited by everything it spawns — including the
 * app we start here, which would then run as Node and exit with code 0 without
 * ever showing a window. It is removed before every launch attempt.
 *
 * argv: <log> <pidFile> <cancelFile> <exe> <imageName> <port>
 */
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'

const [, , logPath, pidPath, cancelPath, exe, imageName] = process.argv
const exeDir = dirname(exe)

/** Append one line to the launcher log. */
function log(message) {
  try {
    appendFileSync(logPath, '[' + new Date().toISOString() + '] ' + message + '\n')
  } catch {
    /* the log is best-effort */
  }
}

/** Block without a busy loop. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Delay for the asynchronous wait loops. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Run one child and report its exit code, never throwing. */
function run(file, args, env) {
  try {
    execFileSync(file, args, { windowsHide: true, stdio: 'ignore', cwd: exeDir, env: env ?? appEnv() })
    return 0
  } catch (error) {
    return typeof error.status === 'number' ? error.status : -1
  }
}

/** The environment a GUI launch needs: everything except the Electron node-mode switch. */
function appEnv() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

const TARGET_IMAGE = imageName.endsWith('.exe') ? imageName : imageName + '.exe'

/**
 * Every pid running the app image, this launcher excluded.
 * The unfiltered listing is deliberate: tasklist exits 1 when a filter matches
 * nothing, which is indistinguishable from a real failure.
 * @returns the pid list, or null when the process list cannot be read.
 */
function appPids() {
  try {
    return execFileSync('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true })
      .toString()
      .split(/\r?\n/)
      .filter((line) => line.startsWith('"'))
      .map((line) => line.split('","'))
      .filter((fields) => fields.length >= 2 && fields[0].replace(/^"|"$/g, '').toLowerCase() === TARGET_IMAGE.toLowerCase())
      .map((fields) => Number(fields[1].replace(/"/g, '')))
      .filter((pid) => Number.isFinite(pid) && pid !== process.pid)
  } catch {
    return null
  }
}

/** Kill the app. Running on the app's own binary means killing by pid, or the
 *  launcher would take itself down with the first taskkill. */
function killApp(force) {
  const flags = force ? ['/f'] : []
  if (basename(process.execPath).toLowerCase() === TARGET_IMAGE.toLowerCase()) {
    let last = 0
    for (const pid of appPids() ?? []) last = run('taskkill', [...flags, '/pid', String(pid)])
    return last
  }
  return run('taskkill', [...flags, '/im', TARGET_IMAGE])
}

/**
 * Wait until one condition holds.
 * @param test - predicate, re-evaluated every 250 ms.
 * @param budgetMs - how long to keep waiting.
 * @returns whether the predicate became true in time.
 */
async function waitFor(test, budgetMs) {
  for (let waited = 0; waited < budgetMs; waited += 250) {
    if (test()) return true
    await delay(250)
  }
  return test()
}

log('launcher start pid=' + process.pid + ' binary=' + process.execPath)
try {
  writeFileSync(pidPath, String(process.pid), 'utf8')
} catch {
  /* informational only */
}
sleepSync(300)
if (existsSync(cancelPath)) {
  log('cancelled before quitting')
  process.exit(0)
}

const before = appPids()
if (before === null) {
  log('FAILED: cannot read the process list, nothing was touched')
  process.exit(1)
}
log('close request: closing ' + before.length + ' process(es)')
killApp(false)

let cleared = false
for (let attempt = 0; attempt < 20; attempt++) {
  const left = appPids()
  if (left === null) {
    log('FAILED: cannot read the process list while closing the app')
    process.exit(1)
  }
  if (left.length === 0) {
    cleared = true
    break
  }
  killApp(true)
  sleepSync(150)
}
if (!cleared) {
  log('FAILED: the app survived the forced close - not starting a second instance')
  process.exit(1)
}

/** Whether a pid that was not running before is on screen now. */
const freshPid = () => {
  const now = appPids()
  if (now === null) return false
  return now.some((pid) => !before.includes(pid))
}

const failures = []

// 1. The app's own executable, detached, with the node-mode switch removed.
try {
  const child = spawn(exe, [], { cwd: exeDir, env: appEnv(), detached: true, stdio: 'ignore', windowsHide: false })
  let exited
  child.on('error', (error) => failures.push('spawn error: ' + (error && error.message ? error.message : String(error))))
  child.on('exit', (code, signal) => { exited = 'code=' + code + ' signal=' + signal })
  child.unref()
  const mine = child.pid ?? 0
  const ok = await waitFor(() => {
    const now = appPids()
    return now !== null && (mine > 0 ? now.includes(mine) : freshPid())
  }, 6000)
  if (ok) {
    log('relaunched (pid ' + mine + ')')
    process.exit(0)
  }
  failures.push('spawn: no process appeared' + (exited === undefined ? '' : ' (' + exited + ')'))
} catch (error) {
  failures.push('spawn threw: ' + (error && error.message ? error.message : String(error)))
}

// 2. Through the shell's own command interpreter. Each fallback launches ONCE and
//    then waits: re-running it on every poll would start a second instance.
/** Launch once through one fallback and wait for a pid that was not there before. */
async function tryFallback(label, launch) {
  let code = -1
  try {
    code = launch()
  } catch (error) {
    failures.push(label + ': threw ' + (error && error.message ? error.message : String(error)))
    return false
  }
  if (code !== 0) {
    failures.push(label + ': exit ' + code)
    return false
  }
  if (await waitFor(freshPid, 5000)) {
    log('relaunched via ' + label)
    return true
  }
  failures.push(label + ': no new process appeared')
  return false
}

if (await tryFallback('cmd start', () => run('cmd.exe', ['/c', 'start', '', exe]))) process.exit(0)
if (await tryFallback('powershell', () => run('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', 'Start-Process -FilePath "' + exe + '" -WorkingDirectory "' + exeDir + '"']))) process.exit(0)
// Through the desktop shell, which launches with its own environment - the last
// resort when everything inherited from this process is being refused.
if (await tryFallback('explorer', () => run('explorer.exe', [exe]))) process.exit(0)

// Leave the user a way back when every launch path was refused.
try {
  execFileSync('explorer.exe', ['/select,' + exe], { windowsHide: true, stdio: 'ignore', cwd: exeDir })
  failures.push('opened the install folder so the app can be started by hand')
} catch {
  failures.push('could not open the install folder')
}
log('FAILED: the app did not start again. ' + failures.join(' | ') + ' | 请把 DeepSeek Harness 加入 360 / 火绒 白名单后重试')
process.exit(1)
