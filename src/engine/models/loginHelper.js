"use strict";

const utils = require('../../utils');
const axios = require("axios");
const path = require('path');
const fs = require('fs');
const qs = require("querystring");
const { normalizeCookieHeaderString, setJarFromPairs } = require('../../utils/formatters/value/formatCookie');
const { parseRegion, genTotp } = require('../../utils/auth-helpers');
const { generateUserAgentByPersona, cachePersonaData } = require('../../utils/user-agents');

/**
 * The main login helper function, orchestrating the login process.
 *
 * @param {object} credentials User credentials or appState.
 * @param {object} globalOptions Global options for the API.
 * @param {function} callback The final callback function.
 * @param {function} setOptionsFunc Reference to the setOptions function from models.
 * @param {function} buildAPIFunc Reference to the buildAPI function from models.
 * @param {object} initialApi The initial API object to extend.
 * @param {function} fbLinkFunc A function to generate Facebook links.
 * @param {string} errorRetrievingMsg The error message for retrieving user ID.
 * @returns {Promise<void>}
 */
async function loginHelper(credentials, globalOptions, callback, setOptionsFunc, buildAPIFunc, initialApi, fbLinkFunc, errorRetrievingMsg) {
    let ctx = null;
    let defaultFuncs = null;
    let api = initialApi;

    try {
        const jar = utils.getJar();
        utils.log("Logging in...");

        const persona = globalOptions.persona || 'desktop';
        const personaSwitched = globalOptions.cachedPersona && globalOptions.cachedPersona !== persona;

        if (personaSwitched) {
            const oldPersona = globalOptions.cachedPersona;
            utils.log(`Persona switched from ${oldPersona} to ${persona}, clearing ALL cached fingerprints`);

            delete globalOptions.cachedUserAgent;
            delete globalOptions.cachedSecChUa;
            delete globalOptions.cachedSecChUaFullVersionList;
            delete globalOptions.cachedSecChUaPlatform;
            delete globalOptions.cachedSecChUaPlatformVersion;
            delete globalOptions.cachedBrowser;

            delete globalOptions.cachedAndroidUA;
            delete globalOptions.cachedAndroidVersion;
            delete globalOptions.cachedAndroidDevice;
            delete globalOptions.cachedAndroidBuildId;
            delete globalOptions.cachedAndroidResolution;
            delete globalOptions.cachedAndroidFbav;
            delete globalOptions.cachedAndroidFbbv;
            delete globalOptions.cachedAndroidLocale;
            delete globalOptions.cachedAndroidCarrier;

            delete globalOptions.cachedLocale;
            delete globalOptions.cachedTimezone;
        }

        const needsDesktopCache = (persona === 'desktop') && !globalOptions.cachedUserAgent;
        const needsAndroidCache = (persona === 'android' || persona === 'mobile') && !globalOptions.cachedAndroidUA;

        if (needsDesktopCache || needsAndroidCache) {
            const personaData = generateUserAgentByPersona(persona, globalOptions);
            cachePersonaData(globalOptions, personaData);
            globalOptions.cachedPersona = persona;

            if (persona === 'desktop') {
                utils.log("Using desktop persona with browser:", personaData.browser);
            } else {
                utils.log("Using Android/Orca mobile persona");
            }

            const { getRandomLocale, getRandomTimezone } = require('../../utils/headers');
            if (!globalOptions.cachedLocale) {
                globalOptions.cachedLocale = getRandomLocale();
            }
            if (!globalOptions.cachedTimezone) {
                globalOptions.cachedTimezone = getRandomTimezone();
            }
        } else {
            if (persona === 'desktop' && globalOptions.cachedUserAgent) {
                utils.log("Using cached desktop persona");
            } else if ((persona === 'android' || persona === 'mobile') && globalOptions.cachedAndroidUA) {
                utils.log("Using cached Android/Orca mobile persona");
            }
        }

        let appState = credentials.appState;

        if (!appState && !credentials.email && !credentials.password) {
            try {
                const { hydrateJarFromDB } = require('../../database/appStateBackup');
                const restored = await hydrateJarFromDB(jar, null);
                if (restored) {
                    utils.log("Restored AppState from database backup");
                }
            } catch (dbErr) {
                utils.warn("Failed to restore AppState from database:", dbErr.message);
            }
        }

        if (appState) {
            let cookieStrings = [];
            if (Array.isArray(appState)) {
                cookieStrings = appState.map(c => [c.name || c.key, c.value].join('='));
            } else if (typeof appState === 'string') {
                cookieStrings = normalizeCookieHeaderString(appState);

                if (cookieStrings.length === 0) {
                    cookieStrings = appState.split(';').map(s => s.trim()).filter(Boolean);
                }
            } else {
                throw new Error("Invalid appState format. Please provide an array of cookie objects or a cookie string.");
            }

            setJarFromPairs(jar, cookieStrings);
            utils.log("Cookies set for facebook.com and messenger.com domains");

        } else if (credentials.email && credentials.password) {

            if (credentials.totpSecret) {
                utils.log("TOTP secret detected, will generate 2FA code if needed");
            }

            const url = "https://api.facebook.com/method/auth.login";
            const params = {
                access_token: "350685531728|62f8ce9f74b12f84c123cc23437a4a32",
                format: "json",
                sdk_version: 2,
                email: credentials.email,
                locale: "en_US",
                password: credentials.password,
                generate_session_cookies: 1,
                sig: "c1c640010993db92e5afd11634ced864",
            }

            if (credentials.totpSecret) {
                try {
                    const totpCode = await genTotp(credentials.totpSecret);
                    params.credentials_type = "two_factor";
                    params.twofactor_code = totpCode;
                    utils.log("TOTP code generated successfully");
                } catch (totpError) {
                    utils.warn("Failed to generate TOTP code:", totpError.message);
                }
            }

            const query = qs.stringify(params);
            const xurl = `${url}?${query}`;
            try {
                const resp = await axios.get(xurl);
                if (resp.status !== 200) {
                    throw new Error("Wrong password / email");
                }
                let cstrs = resp.data["session_cookies"].map(c => `${c.name}=${c.value}`);
                setJarFromPairs(jar, cstrs);
                utils.log("Login successful with email/password");
            } catch (e) {
                if (credentials.totpSecret && !params.twofactor_code) {
                    throw new Error("2FA required but TOTP code generation failed");
                }
                throw new Error("Wrong password / email");
            }
        } else {
                throw new Error("No cookie or credentials found. Please provide cookies or credentials.");
        }

        if (!api) {
            api = {
                setOptions: setOptionsFunc.bind(null, globalOptions),
                getAppState() {
                    const appState = utils.getAppState(jar);
                    if (!Array.isArray(appState)) return [];
                    const uniqueAppState = appState.filter((item, index, self) => self.findIndex((t) => t.key === item.key) === index);
                    return uniqueAppState.length > 0 ? uniqueAppState : appState;
                },
            };
        }

        const resp = await utils.get(fbLinkFunc(), jar, null, globalOptions, { noRef: true }).then(utils.saveCookies(jar));
        const extractNetData = (html) => {
            const allScriptsData = [];
            const scriptRegex = /<script type="application\/json"[^>]*>(.*?)<\/script>/g;
            let match;
            while ((match = scriptRegex.exec(html)) !== null) {
                try {
                    allScriptsData.push(JSON.parse(match[1]));
                } catch (e) {
                    utils.error(`Failed to parse a JSON blob from HTML`, e.message);
                }
            }
            return allScriptsData;
        };

        const netData = extractNetData(resp.body);

        const [newCtx, newDefaultFuncs] = await buildAPIFunc(resp.body, jar, netData, globalOptions, fbLinkFunc, errorRetrievingMsg);
        ctx = newCtx;
        defaultFuncs = newDefaultFuncs;

        const region = parseRegion(resp.body);
        ctx.region = region;
        utils.log("Detected Facebook region:", region);

        try {
            const { backupAppStateSQL } = require('../../database/appStateBackup');
            await backupAppStateSQL(jar, ctx.userID);
        } catch (backupErr) {
            utils.warn("Failed to backup AppState to database:", backupErr.message);
        }
        api.message = new Map();
        api.timestamp = {};

        /**
         * Loads API modules from the apis directory.
         *
         * @returns {void}
         */
        const loadApiModules = () => {
            const apiPath = path.join(__dirname, '..', '..', 'apis');

            if (!fs.existsSync(apiPath)) {
                utils.error('API directory not found:', apiPath);
                return;
            }

            const helperModules = ['mqttDeltaValue'];

            fs.readdirSync(apiPath)
                .filter(file => file.endsWith('.js'))
                .forEach(file => {
                    const moduleName = path.basename(file, '.js');

                    if (helperModules.includes(moduleName)) {
                        return;
                    }

                    const fullPath = path.join(apiPath, file);
                    try {
                        const moduleExport = require(fullPath);
                        if (typeof moduleExport === 'function') {
                            api[moduleName] = moduleExport(defaultFuncs, api, ctx);
                        }
                    } catch (e) {
                        utils.error(`Failed to load API module ${moduleName}:`, e);
                    }
                });
        };

        api.getCurrentUserID = () => ctx.userID;
        api.getOptions = (key) => key ? globalOptions[key] : globalOptions;
        loadApiModules();

        if (api.nickname && typeof api.nickname === 'function') {
            api.changeNickname = api.nickname;
        }

        try {
            const models = require('../../database/models');
            const threadDataModule = require('../../database/threadData');
            const userDataModule = require('../../database/userData');
            
            models.syncAll().then(() => {
                utils.log("Database synchronized successfully");
            }).catch(err => {
                utils.warn("Failed to sync database:", err.message);
            });

            api.threadData = threadDataModule(api);
            api.userData = userDataModule(api);
            utils.log("Database methods initialized");
        } catch (dbError) {
            utils.warn("Database initialization failed (optional feature):", dbError.message);
        }

        api.ctx = ctx;
        api.defaultFuncs = defaultFuncs;
        api.globalOptions = globalOptions;

        const { TokenRefreshManager } = require('../../utils/tokenRefresh');
        if (api.tokenRefreshManager) {
            api.tokenRefreshManager.stopAutoRefresh();
        } else {
            api.tokenRefreshManager = new TokenRefreshManager();
        }

        const { globalAutoReLoginManager } = require('../../utils/autoReLogin');

        if (globalOptions.autoReLogin !== false) {
            globalAutoReLoginManager.setCredentials(credentials, globalOptions, callback);
            utils.log("AutoReLogin", "Auto re-login enabled with stored credentials");

            api.tokenRefreshManager.setSessionExpiryCallback((error) => {
                utils.warn("TokenRefresh", "Session expiry detected. Triggering auto re-login...");
                globalAutoReLoginManager.handleSessionExpiry(api, fbLinkFunc(), errorRetrievingMsg);
            });
        }

        api.tokenRefreshManager.startAutoRefresh(ctx, defaultFuncs, fbLinkFunc());

        api.refreshTokens = () => api.tokenRefreshManager.refreshTokens(ctx, defaultFuncs, fbLinkFunc());
        api.getTokenRefreshStatus = () => ({
            lastRefresh: api.tokenRefreshManager.lastRefresh,
            nextRefresh: api.tokenRefreshManager.getTimeUntilNextRefresh(),
            failureCount: api.tokenRefreshManager.getFailureCount()
        });
        api.enableAutoReLogin = (enable = true) => {
            if (enable) {
                globalAutoReLoginManager.setCredentials(credentials, globalOptions, callback);
            } else {
                globalAutoReLoginManager.disable();
            }
        };
        api.isAutoReLoginEnabled = () => globalAutoReLoginManager.isEnabled();

        return callback(null, api);
    } catch (error) {
        utils.error("loginHelper", error.error || error);
        return callback(error);
    }
}

module.exports = loginHelper;
