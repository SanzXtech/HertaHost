import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const filterPatterns = [
'Closing open session','Closing session','SessionEntry','pendingPreKey',
'_chains:','currentRatchet:','ephemeralKeyPair:','<Buffer','indexInfo:',
'registrationId:','chainKey:','rootKey:','baseKey:','remoteIdentityKey:',
'previousCounter:','chainType:','messageKeys:','pubKey:','privKey:',
'lastRemoteEphemeralKey:','baseKeyType:','closed:','used:','created:',
'Caught exception:','AxiosError:','socket hang up','ECONNRESET',
'_writableState:','_events:','_options:','transitional:','Symbol(',
'_currentRequest:','_header:','highWaterMark:','[cause]:','Session error',
'Failed to decrypt message','Failed to decrypt','Bad MAC','Bad MAC Error',
'{}','config:','request:','adapter:',
'transformRequest:','transformResponse:','xsrfCookieName:','validateStatus:',
'env:','headers:','Object [AxiosHeaders]','responseType:','method:',
'url:','allowAbsoluteUrls:','data: undefined','_maxListeners:','corked:',
'onwrite:','writelen:','bufferedIndex:','pendingcb:','_ended:','_ending:',
'_redirectCount:','_redirects:','_requestBodyLength:','_eventsCount:',
'_onNativeResponse:','_currentUrl:','_timeout:','maxRedirects:','protocol:',
'path:','agents:','auth:','family:','beforeRedirect:','hostname:','port:',
'agent:','nativeProtocols:','pathname:','outputData:','outputSize:',
'writable:','destroyed:','chunkedEncoding:','shouldKeepAlive:','sendDate:',
'_removedConnection:','_contentLength:','_hasBody:','_trailer:','finished:',
'_headerSent:','_closed:','_keepAliveTimeout:','socketPath:','maxHeaderSize:',
'insecureHTTPParser:','aborted:','timeoutCb:','upgradeOrConnect:','parser:',
'maxHeadersCount:','reusedSocket:','host:','_redirectable:','code:',
'doDecryptWhisperMessage','decryptWithSessions','session_cipher.js',
'_asyncQueueExecutor','queue_job.js','libsignal/src','verifyMAC',
'crypto.js:87','at Object.verifyMAC','at SessionCipher','at async SessionCipher',
'at async _asyncQueueExecutor','in favor of incoming prekey','prekey bundle',
'Total file sesi','Terdeteksi','file sampah','Anti Spam Case','signedKeyId','preKeyId'
]

const origLog = console.log
const origError = console.error
const utilInspect = require('util').inspect
const chalkModule = require('chalk')

const shouldFilter = (args) => {
try {
const str = args.map(a => {
if (typeof a === 'string') return a
if (a === null || a === undefined) return ''
if (typeof a === 'object') {
try {
return utilInspect(a,{ depth:3,maxStringLength:1000 })
} catch {
return String(a)
}
}
return String(a)
}).join(' ')
for (const p of filterPatterns) if (str.includes(p)) return true
} catch {}
return false
}

console.log = (...args) => {
for (const arg of args) {
if (arg && typeof arg === 'object') {
if (arg.constructor && arg.constructor.name === 'SessionEntry') return
if (arg._chains || arg.currentRatchet || arg.indexInfo || arg.registrationId) return
}
}
if (shouldFilter(args)) return
const str = args.map(a => typeof a === 'string' ? a : String(a)).join(' ')
const suppress = [
'Skipping system participant',
'Received @lid event',
'handleWelcomeLeave called',
'Processing action:',
'[GRUP UPDATE]',
'bot is not admin according'
]
for (const s of suppress) if (str.includes(s)) return
if (/\bGROUP\b|\bPRIVATE\b/i.test(str)) return origLog.call(console, chalkModule.cyan(str))
if (/\bERROR\b|\bError\b/.test(str) && !shouldFilter(args)) return origLog.call(console, chalkModule.red(str))
origLog.apply(console, args)
}

console.error = (...args) => {
for (const arg of args) {
if (arg && typeof arg === 'object') {
if (arg.constructor && arg.constructor.name === 'SessionEntry') return
if (arg._chains || arg.currentRatchet || arg.indexInfo || arg.registrationId) return
}
}
if (shouldFilter(args)) return
origError.apply(console, args)
}

import chalk from 'chalk'
import axios from 'axios'
import { fileURLToPath } from 'url'
import cluster from 'cluster'
import { join, dirname } from 'path'
import fs from 'fs-extra'
import Readline from 'readline'
import { config } from 'dotenv'
import express from 'express'

const sleep = async (ms) => new Promise(r => setTimeout(r, ms))

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const rl = Readline.createInterface(process.stdin, process.stdout)
const PORT = process.env.PORT || 4000
const HOST = '0.0.0.0'

app.all('/', (req, res) => {
const html = fs.readFileSync('./index.html','utf-8')
res.end(html)
})

app.listen(PORT, HOST, () => {
console.log(chalk.green(`🌐 Port ${PORT} is open`))
console.log(chalk.green(`🌐 Keep Alive on`))
})

config()

let error = 0
let isRunning = false

function start(file) {
if (isRunning) return
isRunning = true
let args = [join(__dirname, file), ...process.argv.slice(2)]

cluster.setupMaster({
exec: join(__dirname, file),
args: args.slice(1)
})

let p = cluster.fork()

p.on('message', async (data) => {
switch (data) {
case 'reset':
p.process.kill()
isRunning = false
start.apply(this, arguments)
break
case 'null':
p.process.kill()
isRunning = false
start.apply(this, arguments)
console.log(chalk.yellowBright.bold(`System error total: ${error}`))
break
case 'SIGKILL':
p.process.kill()
isRunning = false
start.apply(this, arguments)
break
case 'uptime':
p.send(process.uptime())
break
}
})

p.on('exit', async (_, code) => {
if (code !== 0) {
console.error(chalk.yellow(`⟳ Restarting process... (exit code: ${code})`))
}

if (error > 4) {
console.log(chalk.yellowBright.bold(`⚠️  Multiple errors detected (${error}), throttling restart for 1 hour`))
setInterval(async () => {
error = 0
p.process.kill()
isRunning = false
start.apply(this, arguments)
console.log(chalk.yellowBright.bold(`✅ Throttle period ended, resuming...`))
}, 60000 * 60)
} else {
setInterval(() => { error = 0 }, 60000 * 5)

if (code == null || code === 0) {
error += 1
p.process.kill()
isRunning = false
start.apply(this, arguments)
console.log(chalk.yellowBright.bold(`System error total: ${error}`))
} else if (code === 'SIGKILL' || code === 'SIGBUS' || code === 'SIGABRT') {
p.process.kill()
isRunning = false
start.apply(this, arguments)
}
}

isRunning = false
})

p.on('unhandledRejection', async () => {
console.error(chalk.red(`❌ Unhandled promise rejection. Script will restart...`))
await sleep(10000)
error += 1
p.process.kill()
isRunning = false
start.apply(this, arguments)
console.log(chalk.yellowBright.bold(`System error total: ${error}`))
})

p.on('error', async (err) => {
console.error(chalk.red(`❌ Error: ${err}`))
await sleep(10000)
error += 1
p.process.kill()
isRunning = false
start.apply(this, arguments)
})
}

start('main.js')

function keepAlive() {
const url = 'https://a7189f57-1f15-4060-b97e-853222c15d2e-00-uy10zij1nl6y.teams.replit.dev'
if (/(\/\/|\.)undefined\./.test(url)) return
setInterval(async () => {
const response = await axios(url)
if (error < 5) console.log(chalk.yellowBright.bold('Server wake-up! --', response.status))
}, 1000 * 60)
}

keepAlive()
