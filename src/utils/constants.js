/* eslint-disable no-prototype-builtins */
"use strict";

const chalk = require("chalk");
const gradient = require("gradient-string");

const brandGradient = gradient(["#0061ff", "#681297"]);
const successGradient = gradient(["#00ff87", "#60efff"]);
const errorGradient = gradient(["#ff0000", "#ff006e"]);
const warnGradient = gradient(["#ffbe0b", "#fb5607"]);
const infoGradient = gradient(["#3a86ff", "#8338ec"]);
const debugGradient = gradient(["#06ffa5", "#00d9ff"]);

const ws = brandGradient("xnil6x");

let h;
const i = {};
const j = {
  _: "%",
  A: "%2",
  B: "000",
  C: "%7d",
  D: "%7b%22",
  E: "%2c%22",
  F: "%22%3a",
  G: "%2c%22ut%22%3a1",
  H: "%2c%22bls%22%3a",
  I: "%2c%22n%22%3a%22%",
  J: "%22%3a%7b%22i%22%3a0%7d",
  K: "%2c%22pt%22%3a0%2c%22vis%22%3a",
  L: "%2c%22ch%22%3a%7b%22h%22%3a%22",
  M: "%7b%22v%22%3a2%2c%22time%22%3a1",
  N: ".channel%22%2c%22sub%22%3a%5b",
  O: "%2c%22sb%22%3a1%2c%22t%22%3a%5b",
  P: "%2c%22ud%22%3a100%2c%22lc%22%3a0",
  Q: "%5d%2c%22f%22%3anull%2c%22uct%22%3a",
  R: ".channel%22%2c%22sub%22%3a%5b1%5d",
  S: "%22%2c%22m%22%3a0%7d%2c%7b%22i%22%3a",
  T: "%2c%22blc%22%3a1%2c%22snd%22%3a1%2c%22ct%22%3a",
  U: "%2c%22blc%22%3a0%2c%22snd%22%3a1%2c%22ct%22%3a",
  V: "%2c%22blc%22%3a0%2c%22snd%22%3a0%2c%22ct%22%3a",
  W: "%2c%22s%22%3a0%2c%22blo%22%3a0%7d%2c%22bl%22%3a%7b%22ac%22%3a",
  X: "%2c%22ri%22%3a0%7d%2c%22state%22%3a%7b%22p%22%3a0%2c%22ut%22%3a1",
  Y: "%2c%22pt%22%3a0%2c%22vis%22%3a1%2c%22bls%22%3a0%2c%22blc%22%3a0%2c%22snd%22%3a1%2c%22ct%22%3a",
  Z: "%2c%22sb%22%3a1%2c%22t%22%3a%5b%5d%2c%22f%22%3anull%2c%22uct%22%3a0%2c%22s%22%3a0%2c%22blo%22%3a0%7d%2c%22bl%22%3a%7b%22ac%22%3a",
};
(function () {
  const l = [];
  for (const m in j) {
    i[j[m]] = m;
    l.push(j[m]);
  }
  l.reverse();
  h = new RegExp(l.join("|"), "g");
})();

const NUM_TO_MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const NUM_TO_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function padZeros(val, len) {
  val = String(val);
  len = len || 2;
  while (val.length < len) val = "0" + val;
  return val;
}

function generateThreadingID(clientID) {
  const k = Date.now();
  const l = Math.floor(Math.random() * 4294967295);
  const m = clientID;
  return "<" + k + ":" + l + "-" + m + "@mail.projektitan.com>";
}

function binaryToDecimal(data) {
  let ret = "";
  while (data !== "0") {
    let end = 0;
    let fullName = "";
    let i = 0;
    for (; i < data.length; i++) {
      end = 2 * end + parseInt(data[i], 10);
      if (end >= 10) {
        fullName += "1";
        end -= 10;
      } else {
        fullName += "0";
      }
    }
    ret = end.toString() + ret;
    data = fullName.slice(fullName.indexOf("1"));
  }
  return ret;
}

function generateOfflineThreadingID() {
  const ret = Date.now();
  const value = Math.floor(Math.random() * 4294967295);
  const str = ("0000000000000000000000" + value.toString(2)).slice(-22);
  const msgs = ret.toString(2) + str;
  return binaryToDecimal(msgs);
}

function presenceEncode(str) {
  return encodeURIComponent(str)
    .replace(/([_A-Z])|%../g, function (m, n) {
      return n ? "%" + n.charCodeAt(0).toString(16) : m;
    })
    .toLowerCase()
    .replace(h, function (m) {
      return i[m];
    });
}

function presenceDecode(str) {
  return decodeURIComponent(
    str.replace(/[_A-Z]/g, function (m) {
      return j[m];
    })
  );
}

function generatePresence(userID) {
  const time = Date.now();
  return (
    "E" +
    presenceEncode(
      JSON.stringify({
        v: 3,
        time: parseInt(time / 1000, 10),
        user: userID,
        state: {
          ut: 0,
          t2: [],
          lm2: null,
          uct2: time,
          tr: null,
          tw: Math.floor(Math.random() * 4294967295) + 1,
          at: time,
        },
        ch: {
          ["p_" + userID]: 0,
        },
      })
    )
  );
}

function generateAccessiblityCookie() {
  const time = Date.now();
  return encodeURIComponent(
    JSON.stringify({
      sr: 0,
      "sr-ts": time,
      jk: 0,
      "jk-ts": time,
      kb: 0,
      "kb-ts": time,
      hcm: 0,
      "hcm-ts": time,
    })
  );
}

function getGUID() {
  let sectionLength = Date.now();
  const id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = Math.floor((sectionLength + Math.random() * 16) % 16);
    sectionLength = Math.floor(sectionLength / 16);
    const _guid = (c == "x" ? r : (r & 7) | 8).toString(16);
    return _guid;
  });
  return id;
}

function getFrom(str, startToken, endToken) {
  const start = str.indexOf(startToken) + startToken.length;
  if (start < startToken.length) return "";

  const lastHalf = str.substring(start);
  const end = lastHalf.indexOf(endToken);
  if (end === -1) {
    throw Error(
      "Could not find endTime `" + endToken + "` in the given string."
    );
  }
  return lastHalf.substring(0, end);
}

function makeParsable(html) {
  const withoutForLoop = html.replace(/for\s*\(\s*;\s*;\s*\)\s*;\s*/, "");
  const maybeMultipleObjects = withoutForLoop.split(/\}\r\n *\{/);
  if (maybeMultipleObjects.length === 1) return maybeMultipleObjects;

  return "[" + maybeMultipleObjects.join("},{") + "]";
}

function arrToForm(form) {
  return arrayToObject(
    form,
    function (v) {
      return v.name;
    },
    function (v) {
      return v.val;
    }
  );
}

function arrayToObject(arr, getKey, getValue) {
  return arr.reduce(function (acc, val) {
    acc[getKey(val)] = getValue(val);
    return acc;
  }, {});
}

function getSignatureID() {
  return Math.floor(Math.random() * 2147483648).toString(16);
}

function generateTimestampRelative() {
  const d = new Date();
  return d.getHours() + ":" + padZeros(d.getMinutes());
}

function getType(obj) {
  return Object.prototype.toString.call(obj).slice(8, -1);
}


let logging = true;
let logLevel = 'info';

const logLevels = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  silent: 5
};

function logOptions(bool) {
  logging = bool;
}

function setLogLevel(level) {
  if (logLevels.hasOwnProperty(level)) {
    logLevel = level;
  }
}

function getTimestamp() {
  const now = new Date();
  return chalk.gray.dim(`[${padZeros(now.getHours())}:${padZeros(now.getMinutes())}:${padZeros(now.getSeconds())}]`);
}

function shouldLog(level) {
  return logging && logLevels[level] >= logLevels[logLevel];
}

function trace(...args) {
  if (!shouldLog('trace')) return;
  console.log(getTimestamp(), ws, debugGradient("◆ TRACE"), chalk.cyan(...args));
}

function debug(...args) {
  if (!shouldLog('debug')) return;
  console.log(getTimestamp(), ws, debugGradient("◆ DEBUG"), chalk.blue(...args));
}

function info(...args) {
  if (!shouldLog('info')) return;
  console.log(getTimestamp(), ws, infoGradient("◆ INFO"), chalk.white(...args));
}

function log(...args) {
  if (!shouldLog('info')) return;
  console.log(getTimestamp(), ws, successGradient("◆ LOG"), chalk.green(...args));
}

function success(...args) {
  if (logging === false) return;
  console.log(getTimestamp(), ws, successGradient("✓ SUCCESS"), chalk.greenBright.bold(...args));
}

function warn(...args) {
  if (!shouldLog('warn')) return;
  console.warn(getTimestamp(), ws, warnGradient("⚠ WARNING"), chalk.yellow(...args));
}

function error(...args) {
  if (!shouldLog('error')) return;
  console.error(getTimestamp(), ws, errorGradient("✖ ERROR"), chalk.red.bold(...args));
}

function critical(...args) {
  if (!shouldLog('error')) return;
  console.error(getTimestamp(), ws, errorGradient("☠ CRITICAL"), chalk.bgRed.white.bold(...args));
}

function banner(message, color = 'cyan') {
  if (!shouldLog('info')) return;
  const line = '═'.repeat(message.length + 4);
  const colorFunc = chalk[color] || chalk.cyan;
  console.log(colorFunc(`╔${line}╗`));
  console.log(colorFunc(`║  ${message}  ║`));
  console.log(colorFunc(`╚${line}╝`));
}

function box(title, content, style = 'info') {
  if (!shouldLog('info')) return;
  const contentLines = Array.isArray(content) ? content : [content];
  const maxLength = Math.max(title.length, ...contentLines.map(l => String(l).length));
  const topLine = '┌─' + '─'.repeat(maxLength + 2) + '─┐';
  const bottomLine = '└─' + '─'.repeat(maxLength + 2) + '─┘';
  const titleLine = `│ ${chalk.bold(title)}${' '.repeat(maxLength - title.length + 1)} │`;
  
  const colorMap = {
    info: chalk.cyan,
    success: chalk.green,
    warn: chalk.yellow,
    error: chalk.red,
    debug: chalk.blue
  };
  
  const colorFunc = colorMap[style] || chalk.cyan;
  
  console.log(colorFunc(topLine));
  console.log(colorFunc(titleLine));
  console.log(colorFunc('├─' + '─'.repeat(maxLength + 2) + '─┤'));
  contentLines.forEach(line => {
    const paddedLine = String(line) + ' '.repeat(maxLength - String(line).length);
    console.log(colorFunc(`│ ${paddedLine} │`));
  });
  console.log(colorFunc(bottomLine));
}

module.exports = {
  ws,
  chalk,
  gradient,
  brandGradient,
  successGradient,
  errorGradient,
  warnGradient,
  infoGradient,
  debugGradient,
  logOptions,
  setLogLevel,
  trace,
  debug,
  info,
  log,
  success,
  warn,
  error,
  critical,
  banner,
  box,
  getRandom,
  padZeros,
  generateThreadingID,
  binaryToDecimal,
  generateOfflineThreadingID,
  presenceEncode,
  presenceDecode,
  generatePresence,
  generateAccessiblityCookie,
  getGUID,
  getFrom,
  makeParsable,
  arrToForm,
  arrayToObject, 
  getSignatureID,
  generateTimestampRelative,
  getType,
  NUM_TO_MONTH,
  NUM_TO_DAY,
};
