"use strict";
const utils = require('../utils');
const mqtt = require('mqtt');
const websocket = require('websocket-stream');
const HttpsProxyAgent = require('https-proxy-agent');
const EventEmitter = require('events');
const { parseDelta } = require('./mqttDeltaValue');

let form = {};
let getSeqID;

const topics = [
    "/legacy_web", "/webrtc", "/rtc_multi", "/onevc", "/br_sr", "/sr_res",
    "/t_ms", "/thread_typing", "/orca_typing_notifications", "/notify_disconnect",
    "/orca_presence", "/inbox", "/mercury", "/messaging_events",
    "/orca_message_notifications", "/pp", "/webrtc_response"
];

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function getRandomReconnectTime() {
    const min = 26 * 60 * 1000;
    const max = 60 * 60 * 1000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function calculate(previousTimestamp, currentTimestamp){
    return Math.floor(previousTimestamp + (currentTimestamp - previousTimestamp) + 300);
}

/**
 * @param {Object} ctx
 * @param {Object} api
 * @param {string} threadID
 */
function markAsRead(ctx, api, threadID) {
    if (ctx.globalOptions.autoMarkRead && threadID) {
        api.markAsRead(threadID, (err) => {
            if (err) utils.error("autoMarkRead", err);
        });
    }
}

/**
 * @param {Object} defaultFuncs
 * @param {Object} api
 * @param {Object} ctx
 * @param {Function} globalCallback
 */
async function listenMqtt(defaultFuncs, api, ctx, globalCallback, scheduleReconnect) {
    function isEndingLikeError(msg) {
        return /No subscription existed|client disconnecting|socket hang up|ECONNRESET/i.test(msg || "");
    }

    const chatOn = ctx.globalOptions.online;
    const region = ctx.region;
    const foreground = false;
    const sessionID = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER) + 1;
    const cid = ctx.clientID;
    const cachedUA = ctx.globalOptions.cachedUserAgent || ctx.globalOptions.userAgent;
    const username = {
        u: ctx.userID,
        s: sessionID,
        chat_on: chatOn,
        fg: foreground,
        d: cid,
        ct: 'websocket',
        aid: ctx.mqttAppID,
        mqtt_sid: '',
        cp: 3,
        ecp: 10,
        st: [],
        pm: [],
        dc: '',
        no_auto_fg: true,
        gas: null,
        pack: [],
        a: cachedUA
    };
    const cookies = ctx.jar.getCookiesSync('https://www.facebook.com').join('; ');
    let host;
    const domain = "wss://edge-chat.messenger.com/chat";
    if (region) {
        host = `${domain}?region=${region.toLowerCase()}&sid=${sessionID}&cid=${cid}`;
    } else {
        host = `${domain}?sid=${sessionID}&cid=${cid}`;
    }

    utils.log("Connecting to MQTT...", host);

    const cachedSecChUa = ctx.globalOptions.cachedSecChUa || '"Chromium";v="131", "Not;A=Brand";v="99", "Google Chrome";v="131"';
    const cachedSecChUaPlatform = ctx.globalOptions.cachedSecChUaPlatform || '"Windows"';
    const cachedLocale = ctx.globalOptions.cachedLocale || 'en-US,en;q=0.9';

    const options = {
        clientId: 'mqttwsclient',
        protocolId: 'MQIsdp',
        protocolVersion: 3,
        username: JSON.stringify(username),
        clean: true,
        wsOptions: {
            headers: {
                'Cookie': cookies,
                'Origin': 'https://www.facebook.com',
                'User-Agent': username.a,
                'Referer': 'https://www.facebook.com/',
                'Host': new URL(host).hostname,
                'Connection': 'Upgrade',
                'Pragma': 'no-cache',
                'Cache-Control': 'no-cache',
                'Upgrade': 'websocket',
                'Sec-WebSocket-Version': '13',
                'Accept-Encoding': 'gzip, deflate, br',
                'Accept-Language': cachedLocale,
                'Sec-Ch-Ua': cachedSecChUa,
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': cachedSecChUaPlatform,
                'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits'
            },
            origin: 'https://www.facebook.com',
            protocolVersion: 13,
            binaryType: 'arraybuffer'
        },
        keepalive: 60,
        reschedulePings: true,
        connectTimeout: 10000,
        reconnectPeriod: 0
    };

    if (ctx.globalOptions.proxy) options.wsOptions.agent = new HttpsProxyAgent(ctx.globalOptions.proxy);
    const mqttClient = new mqtt.Client(_ => websocket(host, [], options.wsOptions), options);
    mqttClient.publishSync = mqttClient.publish.bind(mqttClient);
    mqttClient.publish = (topic, message, opts = {}, callback = () => {}) => new Promise((resolve, reject) => {
        try {
            mqttClient.publishSync(topic, message, opts, (err, data) => {
                if (err) {
                    callback(err);
                    return reject(err);
                }
                callback(null, data);
                resolve(data);
            });
        } catch (syncErr) {
            callback(syncErr);
            reject(syncErr);
        }
    });
    ctx.mqttClient = mqttClient;

    mqttClient.on('error', (err) => {
        const msg = String(err && err.message ? err.message : err || "");

        if ((ctx._ending || ctx._cycling) && isEndingLikeError(msg)) {
            utils.log("MQTT", "Expected error during shutdown: " + msg);
            return;
        }

        if (ctx._tmsTimeout) {
            clearTimeout(ctx._tmsTimeout);
            ctx._tmsTimeout = null;
        }

        if (/Not logged in|Not logged in\.|blocked the login|checkpoint|401|403/i.test(msg)) {
            try { mqttClient.end(true); } catch (_) { }
            try { if (ctx._autoCycleTimer) clearInterval(ctx._autoCycleTimer); } catch (_) { }
            ctx._ending = true;
            ctx.mqttClient = undefined;
            ctx.loggedIn = false;
            utils.error("MQTT", "Authentication error detected:", msg);
            globalCallback({ 
                type: "account_inactive",
                reason: /blocked|checkpoint/i.test(msg) ? "login_blocked" : "not_logged_in",
                error: msg,
                requiresReLogin: true,
                timestamp: Date.now()
            });
            return;
        }

        utils.error("MQTT error:", msg);
        try { mqttClient.end(true); } catch (_) { }

        if (ctx._ending || ctx._cycling) {
            utils.log("MQTT", "Skipping reconnect: already ending or cycling");
            return;
        }

        if (ctx.globalOptions.autoReconnect) {
            ctx._reconnectAttempts = (ctx._reconnectAttempts || 0) + 1;
            const maxReconnectAttempts = 100;
            
            if (ctx._reconnectAttempts > maxReconnectAttempts) {
                utils.error("MQTT", `Max reconnect attempts (${maxReconnectAttempts}) reached. Stopping.`);
                ctx._ending = true;
                globalCallback({ type: "stop_listen", error: "Max reconnect attempts exceeded" });
                return;
            }
            
            const baseDelay = (ctx._mqttOpt && ctx._mqttOpt.reconnectDelayMs) || 2000;
            const maxBackoff = 30000;
            const backoffDelay = Math.min(baseDelay * Math.pow(1.5, ctx._reconnectAttempts), maxBackoff);
            const jitter = Math.floor(Math.random() * 1000);
            const d = backoffDelay + jitter;
            utils.warn("MQTT", `Auto-reconnecting in ${d}ms (attempt ${ctx._reconnectAttempts}/${maxReconnectAttempts}) due to error`);
            scheduleReconnect(d);
        } else {
            globalCallback({ type: "stop_listen", error: msg || "Connection refused" });
        }
    });

    mqttClient.on('connect', async () => {
        if (!ctx._mqttConnected) {
            utils.log("MQTT connected successfully");
            ctx._mqttConnected = true;
        }
        ctx._cycling = false;
        ctx._reconnectAttempts = 0;
        ctx.loggedIn = true;

        topics.forEach(topic => mqttClient.subscribe(topic));

        const queue = { 
            sync_api_version: 11, 
            max_deltas_able_to_process: 100, 
            delta_batch_size: 500, 
            encoding: "JSON", 
            entity_fbid: ctx.userID,
            initial_titan_sequence_id: ctx.lastSeqId,
            device_params: null
        };

        let topic;
        if (ctx.syncToken) {
            topic = "/messenger_sync_get_diffs";
            queue.last_seq_id = ctx.lastSeqId;
            queue.sync_token = ctx.syncToken;
        } else {
            topic = "/messenger_sync_create_queue";
        }

        mqttClient.publish(topic, JSON.stringify(queue), { qos: 1, retain: false });
        mqttClient.publish("/foreground_state", JSON.stringify({ foreground: chatOn }), { qos: 1 });
        mqttClient.publish("/set_client_settings", JSON.stringify({ make_user_available_when_in_foreground: true }), { qos: 1 });

        const tmsTimeoutDelay = 30000;
        ctx._tmsTimeout = setTimeout(() => {
            ctx._tmsTimeout = null;
            if (ctx._ending || ctx._cycling) return;
            if (!ctx.globalOptions.autoReconnect) {
                utils.warn("MQTT", "t_ms timeout but autoReconnect is disabled");
                return;
            }
            utils.warn("MQTT", `t_ms timeout after ${tmsTimeoutDelay}ms, will cycle connection`);
            try { mqttClient.end(true); } catch (_) { }
            const baseDelay = (ctx._mqttOpt && ctx._mqttOpt.reconnectDelayMs) || 3000;
            scheduleReconnect(baseDelay);
        }, tmsTimeoutDelay);

        ctx.tmsWait = function() {
            if (ctx._tmsTimeout) {
                clearTimeout(ctx._tmsTimeout);
                ctx._tmsTimeout = null;
            }
            if (ctx.globalOptions.emitReady) {
                globalCallback(null, { type: "ready", timestamp: Date.now() });
            }
            delete ctx.tmsWait;
        };
    });

    mqttClient.on('message', async (topic, message, _packet) => {
        try {
            let jsonMessage = Buffer.isBuffer(message) ? Buffer.from(message).toString() : message;
            try { jsonMessage = JSON.parse(jsonMessage); } catch (_) { jsonMessage = {}; }

            if (jsonMessage.type === "jewel_requests_add") {
                globalCallback(null, { 
                    type: "friend_request_received", 
                    actorFbId: jsonMessage.from.toString(), 
                    timestamp: Date.now().toString() 
                });
            } else if (jsonMessage.type === "jewel_requests_remove_old") {
                globalCallback(null, { 
                    type: "friend_request_cancel", 
                    actorFbId: jsonMessage.from.toString(), 
                    timestamp: Date.now().toString() 
                });
            } else if (topic === "/t_ms") {
                if (ctx.tmsWait && typeof ctx.tmsWait === "function") ctx.tmsWait();

                if (jsonMessage.firstDeltaSeqId && jsonMessage.syncToken) {
                    ctx.lastSeqId = jsonMessage.firstDeltaSeqId;
                    ctx.syncToken = jsonMessage.syncToken;
                }
                if (jsonMessage.lastIssuedSeqId) {
                    ctx.lastSeqId = parseInt(jsonMessage.lastIssuedSeqId);
                }

                if (jsonMessage.deltas) {
                    for (const delta of jsonMessage.deltas) {
                        parseDelta(defaultFuncs, api, ctx, globalCallback, { delta });
                    }
                }
            } else if (topic === "/thread_typing" || topic === "/orca_typing_notifications") {
                const typ = {
                    type: "typ",
                    isTyping: !!jsonMessage.state,
                    from: jsonMessage.sender_fbid.toString(),
                    threadID: utils.formatID((jsonMessage.thread || jsonMessage.sender_fbid).toString())
                };
                globalCallback(null, typ);
            } else if (topic === "/orca_presence") {
                if (!ctx.globalOptions.updatePresence && jsonMessage.list) {
                    for (const data of jsonMessage.list) {
                        globalCallback(null, { 
                            type: "presence", 
                            userID: String(data.u), 
                            timestamp: data.l * 1000, 
                            statuses: data.p 
                        });
                    }
                }
            }
        } catch (ex) {
            utils.error("MQTT message parse error:", ex && ex.message ? ex.message : ex);
        }
    });

    mqttClient.on('close', () => {
        utils.warn("MQTT", "Connection closed");
        if (ctx._tmsTimeout) {
            clearTimeout(ctx._tmsTimeout);
            ctx._tmsTimeout = null;
        }
        if (ctx._ending || ctx._cycling) {
            utils.log("MQTT", "Skipping reconnect on close: already ending or cycling");
            return;
        }

        if (ctx.globalOptions.autoReconnect) {
            ctx._reconnectAttempts = (ctx._reconnectAttempts || 0) + 1;
            const maxReconnectAttempts = 100;
            
            if (ctx._reconnectAttempts > maxReconnectAttempts) {
                utils.error("MQTT", `Max reconnect attempts (${maxReconnectAttempts}) reached on close. Stopping.`);
                ctx._ending = true;
                if (typeof globalCallback === "function") {
                    globalCallback({ type: "stop_listen", error: "Max reconnect attempts exceeded" });
                }
                return;
            }
            
            const baseDelay = (ctx._mqttOpt && ctx._mqttOpt.reconnectDelayMs) || 2000;
            const maxBackoff = 30000;
            const backoffDelay = Math.min(baseDelay * Math.pow(1.5, ctx._reconnectAttempts - 1), maxBackoff);
            const jitter = Math.floor(Math.random() * 500);
            const d = backoffDelay + jitter;
            utils.warn("MQTT", `Reconnecting in ${d}ms (attempt ${ctx._reconnectAttempts}/${maxReconnectAttempts})`);
            scheduleReconnect(d);
        }
    });

    mqttClient.on('disconnect', () => {
        utils.log("MQTT", "Disconnected");
        if (ctx._tmsTimeout) {
            clearTimeout(ctx._tmsTimeout);
            ctx._tmsTimeout = null;
        }
    });

    mqttClient.on('offline', () => {
        utils.warn("MQTT", "Connection went offline");
        if (ctx._tmsTimeout) {
            clearTimeout(ctx._tmsTimeout);
            ctx._tmsTimeout = null;
        }
        if (!ctx._ending && !ctx._cycling && ctx.globalOptions.autoReconnect) {
            try { mqttClient.end(true); } catch (_) { }
        }
    });
}

const MQTT_DEFAULTS = { 
    cycleMs: 4 * 60 * 60 * 1000, 
    reconnectDelayMs: 3000, 
    autoReconnect: true, 
    reconnectAfterStop: false 
};

function mqttConf(ctx, overrides) {
    ctx._mqttOpt = Object.assign({}, MQTT_DEFAULTS, ctx._mqttOpt || {}, overrides || {});
    if (typeof ctx._mqttOpt.autoReconnect === "boolean") {
        ctx.globalOptions.autoReconnect = ctx._mqttOpt.autoReconnect;
    }
    return ctx._mqttOpt;
}

module.exports = (defaultFuncs, api, ctx, opts) => {
    const identity = () => {};
    let globalCallback = identity;

    function emitAuthError(reason, detail) {
        try { if (ctx._autoCycleTimer) clearInterval(ctx._autoCycleTimer); } catch (_) { }
        try { ctx._ending = true; } catch (_) { }
        try { if (ctx.mqttClient) ctx.mqttClient.end(true); } catch (_) { }
        ctx.mqttClient = undefined;
        ctx.loggedIn = false;
        
        const msg = detail || reason;
        utils.error("AUTH", `Authentication error -> ${reason}: ${msg}`);
        
        if (typeof globalCallback === "function") {
            globalCallback({
                type: "account_inactive",
                reason: reason,
                error: msg,
                requiresReLogin: true,
                timestamp: Date.now()
            }, null);
        }
    }

    function installPostGuard() {
        if (ctx._postGuarded) return defaultFuncs.post;
        const rawPost = defaultFuncs.post && defaultFuncs.post.bind(defaultFuncs);
        if (!rawPost) return defaultFuncs.post;

        function postSafe(...args) {
            const lastArg = args[args.length - 1];
            const hasCallback = typeof lastArg === 'function';
            
            if (hasCallback) {
                const originalCallback = args[args.length - 1];
                args[args.length - 1] = function(err, ...cbArgs) {
                    if (err) {
                        const msg = (err && err.error) || (err && err.message) || String(err || "");
                        if (/Not logged in|Not logged in\.|blocked the login|checkpoint|security check/i.test(msg)) {
                            emitAuthError(
                                /blocked|checkpoint|security/i.test(msg) ? "login_blocked" : "not_logged_in",
                                msg
                            );
                        }
                    }
                    return originalCallback(err, ...cbArgs);
                };
                return rawPost(...args);
            } else {
                const result = rawPost(...args);
                if (result && typeof result.catch === 'function') {
                    return result.catch(err => {
                        const msg = (err && err.error) || (err && err.message) || String(err || "");
                        if (/Not logged in|Not logged in\.|blocked the login|checkpoint|security check/i.test(msg)) {
                            emitAuthError(
                                /blocked|checkpoint|security/i.test(msg) ? "login_blocked" : "not_logged_in",
                                msg
                            );
                        }
                        throw err;
                    });
                }
                return result;
            }
        }
        defaultFuncs.post = postSafe;
        ctx._postGuarded = true;
        utils.log("MQTT", "PostSafe guard installed for anti-automation detection");
        return postSafe;
    }

    function scheduleReconnect(delayMs) {
        if (ctx._ending) {
            utils.log("MQTT", "scheduleReconnect: skipping because _ending is true");
            return;
        }
        
        if (ctx._reconnectTimer) {
            clearTimeout(ctx._reconnectTimer);
            ctx._reconnectTimer = null;
            utils.log("MQTT", "Cleared existing reconnect timer");
        }
        
        if (ctx.mqttClient) {
            try {
                const oldClient = ctx.mqttClient;
                ctx.mqttClient = undefined;
                
                oldClient.removeAllListeners('connect');
                oldClient.removeAllListeners('message');
                oldClient.removeAllListeners('close');
                oldClient.removeAllListeners('disconnect');
                oldClient.removeAllListeners('offline');
                
                oldClient.on('error', (err) => {
                    utils.log("MQTT", "Error during client teardown (expected):", err && err.message ? err.message : err);
                });
                
                oldClient.end(true, () => {
                    try {
                        oldClient.removeAllListeners();
                    } catch (_) { }
                });
            } catch (_) { }
            utils.log("MQTT", "Cleaned up old MQTT client");
        }
        
        if (ctx._tmsTimeout) {
            clearTimeout(ctx._tmsTimeout);
            ctx._tmsTimeout = null;
        }
        
        ctx._cycling = true;
        
        const d = (ctx._mqttOpt && ctx._mqttOpt.reconnectDelayMs) || 2000;
        const ms = typeof delayMs === "number" ? delayMs : d;
        
        utils.warn("MQTT", `Scheduling reconnect in ${ms}ms`);
        ctx._reconnectTimer = setTimeout(() => {
            ctx._reconnectTimer = null;
            ctx._consecutiveSeqIDFailures = ctx._consecutiveSeqIDFailures || 0;
            
            if (ctx._consecutiveSeqIDFailures >= 10) {
                utils.error("MQTT", "Too many consecutive getSeqID failures (10+), stopping reconnect loop");
                ctx._ending = true;
                ctx._cycling = false;
                if (typeof globalCallback === "function") {
                    globalCallback({ type: "stop_listen", error: "Max consecutive getSeqID failures reached" });
                }
                return;
            }
            
            getSeqIDWrapper();
        }, ms);
    }

    let conf = mqttConf(ctx, opts);
    installPostGuard();

    getSeqID = async () => {
        try {
            form = {
                av: ctx.globalOptions.pageID,
                queries: JSON.stringify({
                    o0: {
                        doc_id: "3336396659757871",
                        query_params: {
                            limit: 1,
                            before: null,
                            tags: ["INBOX"],
                            includeDeliveryReceipts: false,
                            includeSeqID: true
                        }
                    }
                })
            };
            utils.log("MQTT", "Getting sequence ID...");
            ctx.t_mqttCalled = false;
            const resData = await defaultFuncs.post("https://www.facebook.com/api/graphqlbatch/", ctx.jar, form).then(utils.parseAndCheckLogin(ctx, defaultFuncs));
            
            if (utils.getType(resData) !== "Array") {
                throw { error: "Not logged in" };
            }
            if (!Array.isArray(resData) || !resData.length) {
                throw { error: "getSeqID: empty response" };
            }
            
            const lastRes = resData[resData.length - 1];
            if (lastRes && lastRes.successful_results === 0) {
                throw { error: "getSeqID: no successful results" };
            }
            
            const syncSeqId = resData[0] && resData[0].o0 && resData[0].o0.data && resData[0].o0.data.viewer && resData[0].o0.data.viewer.message_threads && resData[0].o0.data.viewer.message_threads.sync_sequence_id;
            if (syncSeqId) {
                ctx.lastSeqId = syncSeqId;
                ctx._consecutiveSeqIDFailures = 0;
                ctx._cycling = false;
                utils.log("MQTT", "getSeqID ok -> listenMqtt()");
                listenMqtt(defaultFuncs, api, ctx, globalCallback, scheduleReconnect);
            } else {
                throw { error: "getSeqID: no sync_sequence_id found" };
            }
        } catch (err) {
            const detail = (err && err.detail && err.detail.message) ? ` | detail=${err.detail.message}` : "";
            const msg = ((err && err.error) || (err && err.message) || String(err || "")) + detail;
            
            if (/Not logged in/i.test(msg)) {
                utils.error("MQTT", "Auth error in getSeqID: Not logged in");
                return emitAuthError("not_logged_in", msg);
            }
            if (/blocked the login|checkpoint|security check/i.test(msg)) {
                utils.error("MQTT", "Auth error in getSeqID: Login blocked");
                return emitAuthError("login_blocked", msg);
            }
            
            utils.error("MQTT", "getSeqID error:", msg);
            ctx._consecutiveSeqIDFailures = (ctx._consecutiveSeqIDFailures || 0) + 1;
            
            if (ctx._consecutiveSeqIDFailures >= 10) {
                utils.error("MQTT", `getSeqID failed ${ctx._consecutiveSeqIDFailures} times consecutively. Stopping reconnect loop.`);
                ctx._ending = true;
                ctx._cycling = false;
                if (typeof globalCallback === "function") {
                    globalCallback({ type: "stop_listen", error: "Max consecutive getSeqID failures reached" });
                }
                return;
            }
            
            if (ctx.globalOptions.autoReconnect && !ctx._ending) {
                const baseDelay = (ctx._mqttOpt && ctx._mqttOpt.reconnectDelayMs) || 2000;
                const backoffDelay = Math.min(baseDelay * Math.pow(1.5, ctx._consecutiveSeqIDFailures), 30000);
                utils.warn("MQTT", `getSeqID failed (${ctx._consecutiveSeqIDFailures}/10), will retry in ${backoffDelay}ms`);
                scheduleReconnect(backoffDelay);
            }
        }
    };

    function getSeqIDWrapper() {
        if (ctx._ending) {
            utils.log("MQTT", "getSeqIDWrapper: skipping because _ending is true");
            return Promise.resolve();
        }
        
        utils.log("MQTT", "getSeqID call");
        return getSeqID()
            .then(() => { 
                utils.log("MQTT", "getSeqID done");
            })
            .catch(e => { 
                utils.error("MQTT", `getSeqID error in wrapper: ${e && e.message ? e.message : e}`);
            });
    }

    function isConnected() {
        return !!(ctx.mqttClient && ctx.mqttClient.connected);
    }

    function unsubAll(cb) {
        if (!isConnected()) return cb && cb();
        let pending = topics.length;
        if (!pending) return cb && cb();
        let fired = false;
        topics.forEach(t => {
            ctx.mqttClient.unsubscribe(t, () => {
                if (--pending === 0 && !fired) { 
                    fired = true; 
                    cb && cb(); 
                }
            });
        });
    }

    function endQuietly(next) {
        const finish = () => {
            try { 
                ctx.mqttClient && ctx.mqttClient.removeAllListeners(); 
            } catch (_) { }
            if (ctx._tmsTimeout) {
                clearTimeout(ctx._tmsTimeout);
                ctx._tmsTimeout = null;
            }
            if (ctx._reconnectTimer) {
                clearTimeout(ctx._reconnectTimer);
                ctx._reconnectTimer = null;
            }
            ctx.mqttClient = undefined;
            ctx.lastSeqId = null;
            ctx.syncToken = undefined;
            ctx.t_mqttCalled = false;
            ctx._ending = false;
            next && next();
        };
        try {
            if (ctx.mqttClient) {
                if (isConnected()) { 
                    try { 
                        ctx.mqttClient.publish("/browser_close", "{}"); 
                    } catch (_) { } 
                }
                ctx.mqttClient.end(true, finish);
            } else finish();
        } catch (_) { 
            finish(); 
        }
    }

    function delayedReconnect() {
        const d = conf.reconnectDelayMs;
        utils.log("MQTT", `Reconnect in ${d}ms`);
        setTimeout(() => getSeqIDWrapper(), d);
    }

    function forceCycle() {
        if (ctx._cycling) return;
        ctx._cycling = true;
        ctx._ending = true;
        utils.warn("MQTT", "Force cycle begin");
        unsubAll(() => endQuietly(() => delayedReconnect()));
    }

    return (callback) => {
        class MessageEmitter extends EventEmitter {
            stopListening(callback2) {
                const cb = callback2 || function() {};
                utils.log("MQTT", "Stop requested");
                globalCallback = identity;

                if (ctx._autoCycleTimer) {
                    clearInterval(ctx._autoCycleTimer);
                    ctx._autoCycleTimer = null;
                    utils.log("MQTT", "Auto-cycle cleared");
                }

                if (ctx._reconnectTimer) {
                    clearTimeout(ctx._reconnectTimer);
                    ctx._reconnectTimer = null;
                    utils.log("MQTT", "Reconnect timer cleared");
                }

                if (ctx._tmsTimeout) {
                    clearTimeout(ctx._tmsTimeout);
                    ctx._tmsTimeout = null;
                    utils.log("MQTT", "TMS timeout cleared");
                }

                ctx._ending = true;
                ctx._reconnectAttempts = 0;
                unsubAll(() => endQuietly(() => {
                    utils.log("MQTT", "Stopped successfully");
                    cb();
                    conf = mqttConf(ctx, conf);
                    if (conf.reconnectAfterStop) delayedReconnect();
                }));
            }

            async stopListeningAsync() {
                return new Promise(resolve => { 
                    this.stopListening(resolve); 
                });
            }
        }

        const msgEmitter = new MessageEmitter();

        globalCallback = callback || function(error, message) {
            if (error) { 
                utils.error("MQTT", "Emit error");
                return msgEmitter.emit("error", error); 
            }
            if (message && (message.type === "message" || message.type === "message_reply")) {
                markAsRead(ctx, api, message.threadID);
            }
            msgEmitter.emit("message", message);
        };

        conf = mqttConf(ctx, conf);

        if (!ctx.firstListen) ctx.lastSeqId = null;
        ctx.syncToken = undefined;
        ctx.t_mqttCalled = false;

        if (ctx._autoCycleTimer) { 
            clearInterval(ctx._autoCycleTimer); 
            ctx._autoCycleTimer = null; 
        }

        if (conf.cycleMs && conf.cycleMs > 0) {
            ctx._autoCycleTimer = setInterval(forceCycle, conf.cycleMs);
            utils.log("MQTT", `Auto-cycle enabled: ${conf.cycleMs}ms`);
        } else {
            utils.log("MQTT", "Auto-cycle disabled");
        }

        if (!ctx.firstListen || !ctx.lastSeqId) {
            getSeqIDWrapper();
        } else {
            utils.log("MQTT", "Starting listenMqtt");
            listenMqtt(defaultFuncs, api, ctx, globalCallback, scheduleReconnect);
        }

        if (ctx.firstListen) {
            api.markAsReadAll().catch(err => {
                utils.error("Failed to mark all messages as read on startup:", err);
            });
        }

        ctx.firstListen = false;

        api.stopListening = msgEmitter.stopListening;
        api.stopListeningAsync = msgEmitter.stopListeningAsync;
        return msgEmitter;
    };
};
