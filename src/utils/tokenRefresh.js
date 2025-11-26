"use strict";

const utils = require('./index');

/**
 * Token Refresh Manager
 * Automatically refreshes fb_dtsg, lsd, and other tokens to prevent expiration
 */

class TokenRefreshManager {
    constructor() {
        this.refreshInterval = null;
        this.REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
        this.lastRefresh = Date.now();
        this.failureCount = 0;
        this.MAX_FAILURES = 3;
        this.onSessionExpiry = null;
        this.onCheckpointDetected = null;
        this.autoReLoginManager = null;
        this.api = null;
        this.fbLink = null;
        this.ERROR_RETRIEVING = null;
    }

    /**
     * Start automatic token refresh
     * @param {Object} ctx - Application context
     * @param {Object} defaultFuncs - Default functions
     * @param {string} fbLink - Facebook link
     */
    startAutoRefresh(ctx, defaultFuncs, fbLink) {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        this.refreshInterval = setInterval(async () => {
            try {
                await this.refreshTokens(ctx, defaultFuncs, fbLink);
                utils.log("TokenRefresh", "Tokens refreshed successfully");
            } catch (error) {
                utils.error("TokenRefresh", "Failed to refresh tokens:", error.message);
            }
        }, this.REFRESH_INTERVAL_MS);

        utils.log("TokenRefresh", "Auto-refresh enabled (every 24 hours)");
    }

    /**
     * Set API and link references for auto-relogin
     * @param {Object} api - API instance
     * @param {string} fbLink - Facebook link
     * @param {string} ERROR_RETRIEVING - Error message
     */
    setAPIReferences(api, fbLink, ERROR_RETRIEVING) {
        this.api = api;
        this.fbLink = fbLink;
        this.ERROR_RETRIEVING = ERROR_RETRIEVING;
    }

    /**
     * Detect checkpoint or session errors with specific markers
     * @param {string} html - HTML response
     * @param {Error} error - Error object
     * @param {string} responseUrl - Response URL for redirect detection
     * @returns {object} Detection result
     */
    detectCheckpoint(html, error, responseUrl = null) {
        if (responseUrl) {
            if (responseUrl.includes('/checkpoint/') || responseUrl.includes('/login/') || responseUrl.includes('/login.php')) {
                return { detected: true, type: 'url_redirect' };
            }
        }
        
        if (html) {
            if (html.includes('id="checkpoint_') || html.includes('name="checkpoint"')) {
                return { detected: true, type: 'checkpoint_form' };
            }
            
            if (html.includes('id="login_form"') && html.includes('name="email"') && html.includes('name="pass"')) {
                return { detected: true, type: 'login_page' };
            }
            
            if (html.includes('security check') && html.includes('verify')) {
                return { detected: true, type: 'security_checkpoint' };
            }
            
            if (html.includes('session has expired') || html.includes('Please log in')) {
                return { detected: true, type: 'session_expired' };
            }
        }
        
        if (error && error.message) {
            const errorMsg = error.message.toLowerCase();
            if (errorMsg.includes('checkpoint')) {
                return { detected: true, type: 'error_checkpoint' };
            }
            if (errorMsg.includes('session expired') || errorMsg.includes('session_expired')) {
                return { detected: true, type: 'error_session_expired' };
            }
            if (errorMsg.includes('invalid session') || errorMsg.includes('invalid_session')) {
                return { detected: true, type: 'error_invalid_session' };
            }
        }
        
        return { detected: false, type: null };
    }

    /**
     * Manually refresh tokens with retry logic
     * @param {Object} ctx - Application context
     * @param {Object} defaultFuncs - Default functions
     * @param {string} fbLink - Facebook link
     * @param {number} retryCount - Current retry attempt (internal use)
     * @returns {Promise<boolean>}
     */
    async refreshTokens(ctx, defaultFuncs, fbLink, retryCount = 0) {
        const MAX_RETRIES = 3;
        const RETRY_DELAYS = [2000, 5000, 10000];
        
        try {
            const resp = await utils.get(fbLink, ctx.jar, null, ctx.globalOptions, { noRef: true });
            
            const html = resp.body;
            const responseUrl = resp.request && resp.request.uri ? resp.request.uri.href : null;
            
            if (!html) {
                throw new Error("Empty response from Facebook");
            }

            const checkpoint = this.detectCheckpoint(html, null, responseUrl);
            if (checkpoint.detected) {
                utils.warn("TokenRefresh", `Checkpoint detected: ${checkpoint.type}`);
                
                if (this.onCheckpointDetected && typeof this.onCheckpointDetected === 'function') {
                    this.onCheckpointDetected(checkpoint.type);
                }
                
                if (this.autoReLoginManager && this.autoReLoginManager.isEnabled() && this.api) {
                    utils.log("TokenRefresh", "Triggering auto-relogin due to checkpoint...");
                    const reloginSuccess = await this.attemptRelogin(this.api, this.fbLink, this.ERROR_RETRIEVING);
                    if (reloginSuccess) {
                        return true;
                    }
                }
                
                throw new Error(`Checkpoint required: ${checkpoint.type}`);
            }

            const dtsgMatch = html.match(/"DTSGInitialData",\[],{"token":"([^"]+)"/);
            if (dtsgMatch) {
                ctx.fb_dtsg = dtsgMatch[1];
                ctx.ttstamp = "2";
                for (let i = 0; i < ctx.fb_dtsg.length; i++) {
                    ctx.ttstamp += ctx.fb_dtsg.charCodeAt(i);
                }
            } else {
                throw new Error("Failed to extract fb_dtsg token");
            }

            const lsdMatch = html.match(/"LSD",\[],{"token":"([^"]+)"/);
            if (lsdMatch) {
                ctx.lsd = lsdMatch[1];
            }

            const jazoestMatch = html.match(/jazoest=(\d+)/);
            if (jazoestMatch) {
                ctx.jazoest = jazoestMatch[1];
            }

            const revisionMatch = html.match(/"client_revision":(\d+)/);
            if (revisionMatch) {
                ctx.__rev = revisionMatch[1];
            }

            this.lastRefresh = Date.now();
            this.failureCount = 0;
            return true;
        } catch (error) {
            this.failureCount++;
            utils.error("TokenRefresh", `Refresh failed (attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, error.message);
            
            const checkpoint = this.detectCheckpoint(null, error);
            if (checkpoint.detected) {
                utils.warn("TokenRefresh", `Checkpoint detected in error: ${checkpoint.type}`);
                
                if (this.onCheckpointDetected && typeof this.onCheckpointDetected === 'function') {
                    this.onCheckpointDetected(checkpoint.type);
                }
            }
            
            if (this.failureCount >= this.MAX_FAILURES) {
                utils.error("TokenRefresh", `Maximum failures (${this.MAX_FAILURES}) reached. Session may be expired.`);
                if (this.onSessionExpiry && typeof this.onSessionExpiry === 'function') {
                    this.onSessionExpiry(error);
                }
                return false;
            }
            
            if (retryCount < MAX_RETRIES) {
                const delay = RETRY_DELAYS[retryCount];
                utils.log("TokenRefresh", `Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return await this.refreshTokens(ctx, defaultFuncs, fbLink, retryCount + 1);
            }
            
            return false;
        }
    }

    /**
     * Set auto-relogin manager reference
     * @param {Object} autoReLoginManager - AutoReLoginManager instance
     */
    setAutoReLoginManager(autoReLoginManager) {
        this.autoReLoginManager = autoReLoginManager;
    }

    /**
     * Attempt auto-relogin using the AutoReLoginManager
     * @param {Object} api - API instance
     * @param {string} fbLink - Facebook link
     * @param {string} ERROR_RETRIEVING - Error message for retrieving
     * @returns {Promise<boolean>}
     */
    async attemptRelogin(api, fbLink, ERROR_RETRIEVING) {
        try {
            if (!this.autoReLoginManager || !this.autoReLoginManager.isEnabled()) {
                utils.warn("TokenRefresh", "AutoReLoginManager not available or not enabled");
                return false;
            }
            
            utils.log("TokenRefresh", "Triggering auto-relogin via AutoReLoginManager");
            const success = await this.autoReLoginManager.handleSessionExpiry(api, fbLink, ERROR_RETRIEVING);
            
            if (success) {
                this.resetFailureCount();
                utils.log("TokenRefresh", "Auto-relogin completed successfully");
                return true;
            } else {
                utils.error("TokenRefresh", "Auto-relogin failed");
                return false;
            }
        } catch (error) {
            utils.error("TokenRefresh", "Auto-relogin error:", error.message);
            return false;
        }
    }

    /**
     * Set callback for checkpoint detection
     * @param {Function} callback - Callback function to trigger on checkpoint
     */
    setCheckpointCallback(callback) {
        this.onCheckpointDetected = callback;
    }

    /**
     * Stop automatic token refresh
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
            utils.log("TokenRefresh", "Auto-refresh disabled");
        }
    }

    /**
     * Get time until next refresh
     * @returns {number} Milliseconds until next refresh
     */
    getTimeUntilNextRefresh() {
        if (!this.refreshInterval) return -1;
        return Math.max(0, this.REFRESH_INTERVAL_MS - (Date.now() - this.lastRefresh));
    }

    /**
     * Check if tokens need immediate refresh
     * @returns {boolean}
     */
    needsImmediateRefresh() {
        return (Date.now() - this.lastRefresh) >= this.REFRESH_INTERVAL_MS;
    }

    /**
     * Set callback for session expiry detection
     * @param {Function} callback - Callback function to trigger on session expiry
     */
    setSessionExpiryCallback(callback) {
        this.onSessionExpiry = callback;
    }

    /**
     * Reset failure count (useful after successful re-login)
     */
    resetFailureCount() {
        this.failureCount = 0;
    }

    /**
     * Get current failure count
     * @returns {number}
     */
    getFailureCount() {
        return this.failureCount;
    }
}

module.exports = {
    TokenRefreshManager
};
