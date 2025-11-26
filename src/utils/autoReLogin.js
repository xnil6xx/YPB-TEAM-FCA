"use strict";

const utils = require('./index');

class AutoReLoginManager {
    constructor() {
        this.credentials = null;
        this.loginOptions = null;
        this.loginCallback = null;
        this.isReLoggingIn = false;
        this.pendingRequests = [];
        this.maxRetries = 3;
        this.retryCount = 0;
        this.onReLoginSuccess = null;
        this.onReLoginFailure = null;
        this.enabled = false;
    }

    setCredentials(credentials, options, callback) {
        this.credentials = credentials;
        this.loginOptions = options || {};
        this.loginCallback = callback;
        this.enabled = true;
    }

    isEnabled() {
        return this.enabled && this.credentials !== null;
    }

    async handleSessionExpiry(api, fbLink, ERROR_RETRIEVING) {
        if (!this.isEnabled()) {
            utils.warn("AutoReLogin", "Auto re-login not enabled. Credentials not stored.");
            return false;
        }

        if (this.isReLoggingIn) {
            utils.log("AutoReLogin", "Re-login already in progress. Queuing request...");
            return new Promise((resolve, reject) => {
                this.pendingRequests.push({ resolve, reject });
            });
        }

        if (this.retryCount >= this.maxRetries) {
            utils.error("AutoReLogin", `Maximum re-login attempts (${this.maxRetries}) exceeded`);
            if (this.onReLoginFailure) {
                this.onReLoginFailure(new Error("Max re-login retries exceeded"));
            }
            return false;
        }

        this.isReLoggingIn = true;
        this.retryCount++;
        utils.log("AutoReLogin", `Starting automatic re-login (attempt ${this.retryCount}/${this.maxRetries})...`);

        try {
            await this.pauseAPIRequests();

            const loginHelperModel = require('../engine/models/loginHelper');
            const setOptionsModel = require('../engine/models/setOptions');
            const buildAPIModel = require('../engine/models/buildAPI');

            await new Promise((resolve, reject) => {
                loginHelperModel(
                    this.credentials,
                    this.loginOptions,
                    (loginError, newApi) => {
                        if (loginError) {
                            reject(loginError);
                            return;
                        }
                        
                        if (api) {
                            api.ctx = newApi.ctx;
                            api.defaultFuncs = newApi.defaultFuncs;
                            
                            if (api.tokenRefreshManager) {
                                api.tokenRefreshManager.resetFailureCount();
                            }
                        }
                        
                        resolve(newApi);
                    },
                    setOptionsModel,
                    buildAPIModel,
                    api,
                    fbLink,
                    ERROR_RETRIEVING
                );
            });

            utils.log("AutoReLogin", "Re-login successful! Session restored.");
            this.retryCount = 0;
            this.isReLoggingIn = false;

            this.resolvePendingRequests(true);

            if (this.onReLoginSuccess) {
                this.onReLoginSuccess();
            }

            return true;
        } catch (error) {
            utils.error("AutoReLogin", `Re-login failed:`, error.message);
            this.isReLoggingIn = false;

            if (this.retryCount >= this.maxRetries) {
                this.resolvePendingRequests(false);
                if (this.onReLoginFailure) {
                    this.onReLoginFailure(error);
                }
                return false;
            }

            const backoffDelay = Math.min(30000, Math.pow(2, this.retryCount) * 1000);
            utils.log("AutoReLogin", `Retrying re-login in ${backoffDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffDelay));

            return await this.handleSessionExpiry(api, fbLink, ERROR_RETRIEVING);
        }
    }

    async pauseAPIRequests() {
        utils.log("AutoReLogin", "Pausing API requests during re-login...");
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    resolvePendingRequests(success) {
        utils.log("AutoReLogin", `Resolving ${this.pendingRequests.length} pending requests (success: ${success})`);
        
        this.pendingRequests.forEach(({ resolve, reject }) => {
            if (success) {
                resolve(true);
            } else {
                reject(new Error("Re-login failed"));
            }
        });
        
        this.pendingRequests = [];
    }

    setReLoginSuccessCallback(callback) {
        this.onReLoginSuccess = callback;
    }

    setReLoginFailureCallback(callback) {
        this.onReLoginFailure = callback;
    }

    disable() {
        this.enabled = false;
        this.credentials = null;
        this.loginOptions = null;
        this.loginCallback = null;
        utils.log("AutoReLogin", "Auto re-login disabled and credentials cleared");
    }

    reset() {
        this.retryCount = 0;
        this.isReLoggingIn = false;
        this.pendingRequests = [];
    }
}

const globalAutoReLoginManager = new AutoReLoginManager();

module.exports = {
    AutoReLoginManager,
    globalAutoReLoginManager
};
