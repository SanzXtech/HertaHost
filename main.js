process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

const filterPatterns = [
  'Closing open session','Closing session:','SessionEntry','pendingPreKey','_chains:',
  'currentRatchet:','ephemeralKeyPair:','<Buffer','indexInfo:','registrationId:',
  'chainKey:','rootKey:','baseKey:','remoteIdentityKey:','previousCounter:',
  'chainType:','messageKeys:','pubKey:','privKey:','lastRemoteEphemeralKey:',
  'baseKeyType:','closed:','used:','created:','AxiosError:','socket hang up',
  'ECONNRESET','_writableState:','_events:','_options:','transitional:',
  'Symbol(','_currentRequest:','_header:','highWaterMark:','[cause]:',
  'Session error:','Failed to decrypt','Bad MAC','doDecryptWhisperMessage',
  'decryptWithSessions','session_cipher.js','libsignal/src','verifyMAC'
];

const utilInspect = require("util").inspect;
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

const shouldFilter = (args) => {
  try {
    const str = args.map(a => {
      if (typeof a === "string") return a;
      if (a === null || a === undefined) return "";
      if (typeof a === "object") return utilInspect(a, { depth: 2, maxStringLength: 500 });
      return String(a);
    }).join(" ");
    return filterPatterns.some(p => str.includes(p));
  } catch {
    return false;
  }
};

console.log = (...args) => { if (!shouldFilter(args)) originalConsoleLog(...args); };
console.error = (...args) => { if (!shouldFilter(args)) originalConsoleError(...args); };

import "./settings.js";
import { QueueManager } from "./lib/queue/QueueIntegration.js";
let queueManager;

const {
  makeInMemoryStore,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  MessageRetryMap,
  fetchLatestBaileysVersion
} = await import("baileys");

import fs, { readdirSync, existsSync, readFileSync, watch, statSync } from "fs";
import logg from "pino";
import { Socket, smsg, protoType } from "./lib/simple.js";
import CFonts from "cfonts";
import path, { join, dirname, basename } from "path";
import { memberUpdate } from "./message/group.js";
import { antiCall } from "./message/anticall.js";
import { connectionUpdate } from "./message/connection.js";
import { Function } from "./message/function.js";
import NodeCache from "node-cache";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import syntaxerror from "syntax-error";
import { format } from "util";
import chokidar from "chokidar";
import chalk from "chalk";

const { proto } = require("baileys");

const __dirname = dirname(fileURLToPath(import.meta.url));
global.__require = dir => createRequire(dir);
protoType();

const msgRetryCounterCache = new NodeCache();
const processedMessagesCache = new NodeCache({ stdTTL: 10, checkperiod: 5 });

CFonts.say("fearless", { font: "chrome", align: "left", gradient: ["red","magenta"] });

global.reloadHandler = async function () {
  for (const filename of Object.keys(global.plugins || {})) {
    try { await global.reload(null, filename); } catch {}
  }
};

const pluginFolder = path.join(__dirname, "./plugins");

const pluginFilter = filename => /\.js$/.test(filename);
global.plugins = {};

async function filesInit(folderPath) {
  const files = readdirSync(folderPath);
  for (let file of files) {
    const filePath = join(folderPath, file);
    const fileStat = statSync(filePath);
    if (fileStat.isDirectory()) {
      await filesInit(filePath);
    } else if (pluginFilter(file)) {
      try {
        const module = await import("file://" + filePath);
        global.plugins[file] = module.default || module;
      } catch {
        delete global.plugins[file];
      }
    }
  }
}

await filesInit(pluginFolder);

global.reload = async (_ev, filename) => {
  if (!pluginFilter(filename)) return;
  let dir = global.__filename(join(filename), true);
  if (!existsSync(dir)) return delete global.plugins[filename];
  let err = syntaxerror(readFileSync(dir), filename, { sourceType: "module", allowAwaitOutsideFunction: true });
  if (!err) {
    const module = await import(`${global.__filename(dir)}?update=${Date.now()}`);
    global.plugins[filename] = module.default || module;
    global.plugins = Object.fromEntries(Object.entries(global.plugins).sort(([a],[b]) => a.localeCompare(b)));
  }
};

chokidar.watch(pluginFolder, { ignoreInitial: true, depth: 99 })
  .on("change", p => p.endsWith(".js") && global.reload(null, basename(p)));

watch(pluginFolder, global.reload);

const connectToWhatsApp = async () => {
  await (await import("./message/database.js")).default();

  const { state, saveCreds } = await useMultiFileAuthState(session);
  const store = makeInMemoryStore({ logger: logg().child({ level: "fatal" }) });
  const { version } = await fetchLatestBaileysVersion();

  const auth = {
    creds: state.creds,
    keys: makeCacheableSignalKeyStore(state.keys, logg().child({ level: "fatal" }))
  };

  global.conn = Socket({
    version,
    printQRInTerminal: !global.pairingCode,
    logger: logg({ level: "fatal" }),
    auth,
    browser: ["Ubuntu","Chrome"],
    keepAliveIntervalMs: 20000,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    msgRetryCounterCache
  });

  store.bind(conn.ev);

  if (global.pairingCode && !state.creds.registered) {
    const code = await conn.requestPairingCode(global.pairingCode);
    console.log("PAIRING CODE:", code);
  }

  conn.ev.on("connection.update", async update => {
    if (update.connection === "open") {
      if (!queueManager) {
        queueManager = new QueueManager(global.owner || [], false);
        queueManager.initializeAdminDetector(conn, global.func);
      } else {
        queueManager.onReconnect(conn);
      }
    }
    if (update.connection === "close" && !update.isNewLogin) {
      setTimeout(connectToWhatsApp, 3000);
    }
    await connectionUpdate(connectToWhatsApp, conn, update);
  });

  conn.ev.on("creds.update", saveCreds);

  const registerModule = await import("./message/register.js");
  const handlerModule = await import("./handler.js");

  conn.ev.process(async events => {
    if (events["messages.upsert"]) {
      for (const m of events["messages.upsert"].messages || []) {
        if (!m || m.key.fromMe) continue;
        if (processedMessagesCache.has(m.key.id)) continue;
        processedMessagesCache.set(m.key.id, true);

        let msg = await smsg(conn, m);

        if (msg.isGroup) {
          const meta = await conn.groupMetadata(msg.chat).catch(() => null);
          if (meta?.participants) {
            const botJid = conn.decodeJid(conn.user.id);
            const bot = meta.participants.find(p => conn.decodeJid(p.id) === botJid);
            msg.isBotAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");
          }
        }

        await conn.readMessages([{ remoteJid: msg.chat, id: msg.key.id, participant: msg.isGroup ? msg.sender : undefined }]);
        await conn.sendPresenceUpdate("composing", msg.chat);

        await registerModule.register(msg);

        if (queueManager) {
          await queueManager.enqueueWithOptimization(conn, msg, () =>
            handlerModule.handler(conn, msg, events["messages.upsert"], store)
          );
        } else {
          await handlerModule.handler(conn, msg, events["messages.upsert"], store);
        }

        if (global.db?.data) global.db.write();
      }
    }

    if (events.call) antiCall(db, events.call, conn);
    if (events["group-participants.update"]) memberUpdate(conn, events["group-participants.update"]);
  });

  Function(conn);
  return conn;
};

connectToWhatsApp();

process.on("uncaughtException", err => {
  const e = String(err);
  if (!["timeout","rate-overlimit","Connection Closed","Timed Out"].some(x => e.includes(x)))
    console.log("Caught exception:", err);
});
