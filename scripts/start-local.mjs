// Runs all of MandiMangoes on this computer with one command, on Windows, Mac or Linux:
// a private Postgres (downloaded by npm, nothing to install), the API with demo data,
// the shop and the staff panel, then opens them in the browser.
//
//   node scripts/start-local.mjs            (add --no-open to skip the browser)
//
// Ctrl+C or closing the window stops everything. Data is kept in .local/ between runs.
// It also shares the shop and panel on this Wi-Fi, so a phone on the same Wi-Fi can open them
// (add --no-wifi to keep everything on this computer only).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const local = path.join(root, '.local')
const DB_PORT = 54329
/** This computer's address on the home Wi-Fi (a private 192.168.x / 10.x / 172.16-31.x address), or null. */
function wifiAddress() {
  const all = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal)
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 9)
  const best = all.map((a) => a.address).sort((a, b) => rank(a) - rank(b))[0]
  return best && rank(best) < 9 ? best : null
}
const HOST = (!process.argv.includes('--no-wifi') && wifiAddress()) || 'localhost'
const SHOP = `http://${HOST}:5174`
const PANEL = `http://${HOST}:5173`
const API = `http://${HOST}:3000`
const LOCAL_API = 'http://localhost:3000'
const children = []

const say = (msg) => console.log(`\n==> ${msg}`)

/** Runs a command to completion (npm needs a shell on Windows). */
function run(cmd, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, { cwd, shell: true, stdio: 'inherit' })
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`"${cmd}" failed (exit ${code})`))))
  })
}

/** Starts a long-running command and keeps it until this script exits. */
function start(cmd, cwd, env = {}, quiet = false) {
  const p = spawn(cmd, { cwd, shell: true, stdio: quiet ? 'ignore' : 'inherit', env: { ...process.env, ...env } })
  children.push(p)
  p.on('exit', (code) => {
    if (!stopping) {
      console.error(`\n"${cmd}" stopped (exit ${code}). Stopping everything.`)
      stop(1)
    }
  })
  return p
}

async function waitFor(url, seconds = 120) {
  for (let i = 0; i < seconds; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`${url} did not answer after ${seconds} seconds`)
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`
  spawn(cmd, { shell: true, stdio: 'ignore', detached: true }).unref()
}

let stopping = false
let db = null
async function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const p of children) {
    try {
      if (process.platform === 'win32') spawn(`taskkill /pid ${p.pid} /T /F`, { shell: true, stdio: 'ignore' })
      else p.kill()
    } catch {}
  }
  await db?.stop().catch(() => {})
  process.exit(code)
}
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))

async function main() {
  const major = Number(process.versions.node.split('.')[0])
  if (major < 22) throw new Error(`Node 22 or newer is needed (this is ${process.versions.node})`)

  if (!existsSync(path.join(root, 'node_modules'))) {
    say('Installing the shop and staff panel (first run only, a few minutes)')
    await run('npm ci --no-audit --no-fund --loglevel=error', root)
  }
  if (!existsSync(path.join(root, 'mango-api', 'node_modules'))) {
    say('Installing the API (first run only)')
    await run('npm ci --no-audit --no-fund --loglevel=error', path.join(root, 'mango-api'))
  }
  mkdirSync(local, { recursive: true })
  if (!existsSync(path.join(local, 'node_modules', 'embedded-postgres'))) {
    say('Downloading the database (first run only)')
    writeFileSync(path.join(local, 'package.json'), '{ "private": true }\n')
    await run('npm install embedded-postgres@16.14.0-beta.17 --no-audit --no-fund --loglevel=error', local)
  }

  say('Starting the database')
  const req = createRequire(path.join(local, 'package.json'))
  const { default: EmbeddedPostgres } = await import(pathToFileURL(req.resolve('embedded-postgres')).href)
  const dataDir = path.join(local, 'pgdata')
  const fresh = !existsSync(dataDir)
  db = new EmbeddedPostgres({ databaseDir: dataDir, user: 'mango', password: 'mango', port: DB_PORT, persistent: true, onLog: () => {} })
  if (fresh) await db.initialise()
  await db.start()
  if (fresh) await db.createDatabase('mango')

  say('Starting the API (it adds demo stock and staff logins)')
  start('node src/index.js', path.join(root, 'mango-api'), {
    DATABASE_URL: `postgres://mango:mango@localhost:${DB_PORT}/mango`,
    NODE_ENV: 'development',
    COOKIE_SECURE: 'false',
    // The shop's test-mode pay buttons use /v1/dev.
    ENABLE_DEV_ROUTES: 'true',
    LOG_LEVEL: 'warn',
    // Pages opened by Wi-Fi address and by localhost are both allowed.
    ADMIN_ORIGIN: [PANEL, 'http://localhost:5173'].join(','),
    CUSTOMER_ORIGIN: [SHOP, 'http://localhost:5174'].join(','),
  })
  await waitFor(`${LOCAL_API}/ready`)

  say('Starting the shop and the staff panel')
  const lan = HOST === 'localhost' ? '' : ' --host 0.0.0.0'
  start(`npx vite --port 5173 --strictPort${lan}`, root, { VITE_API_URL: API }, true)
  start(`npx vite --config customer-app/vite.config.ts --port 5174 --strictPort${lan}`, root, { VITE_API_URL: API }, true)
  await waitFor('http://localhost:5174')
  await waitFor('http://localhost:5173')

  if (!process.argv.includes('--no-open')) {
    openBrowser(SHOP)
    openBrowser(PANEL)
  }
  console.log(`
MandiMangoes is running.
  Shop:         ${SHOP}   (the sign-in code shows on screen)
  Staff panel:  ${PANEL}   (manager@mandimangoes.test / manager123)

${
    HOST === 'localhost'
      ? ''
      : `
On your phone: join the same Wi-Fi as this computer, then open ${SHOP} in the browser.
(If Windows asks whether Node.js may use the network, tick Private networks and click Allow.)
`
  }
Leave this window open. Press Ctrl+C or close it to stop.`)
}

main().catch((err) => {
  console.error(`\nSomething went wrong: ${err.message}`)
  stop(1)
})
