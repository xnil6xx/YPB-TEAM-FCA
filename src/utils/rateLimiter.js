"use strict";

/**
 * Adaptive Rate Limiting Manager
 * Prevents overwhelming Facebook servers and manages request cooldowns
 * Enhanced with behavioral modeling and context-aware throttling
 */

class RateLimiter {
    constructor() {
        this.threadCooldowns = new Map();
        this.endpointCooldowns = new Map();
        this.requestCounts = new Map();
        this.errorCache = new Map();
        this.requestHistory = new Map();
        this.behavioralMetrics = new Map();
        this.checkpointMode = false;
        this.ERROR_CACHE_TTL = 300000; // 5 minutes
        this.COOLDOWN_DURATION = 60000; // 60 seconds
        this.MAX_REQUESTS_PER_MINUTE = 60;
        this.MAX_CONCURRENT_REQUESTS = 8;
        this.BURST_THRESHOLD = 5;
        this.BURST_WINDOW_MS = 10000;
        this.activeRequests = 0;
        this.QUIET_HOURS = { start: 2, end: 6 };
    }

    /**
     * Check if a thread is on cooldown
     * @param {string} threadID - Thread identifier
     * @returns {boolean}
     */
    isThreadOnCooldown(threadID) {
        const cooldownEnd = this.threadCooldowns.get(threadID);
        if (!cooldownEnd) return false;

        const now = Date.now();
        if (now >= cooldownEnd) {
            this.threadCooldowns.delete(threadID);
            return false;
        }
        return true;
    }

    /**
     * Put a thread on cooldown
     * @param {string} threadID - Thread identifier
     * @param {number} duration - Cooldown duration in milliseconds
     */
    setThreadCooldown(threadID, duration = null) {
        const cooldownDuration = duration || this.COOLDOWN_DURATION;
        this.threadCooldowns.set(threadID, Date.now() + cooldownDuration);
    }

    /**
     * Check if an endpoint is on cooldown
     * @param {string} endpoint - Endpoint identifier
     * @returns {boolean}
     */
    isEndpointOnCooldown(endpoint) {
        const cooldownEnd = this.endpointCooldowns.get(endpoint);
        if (!cooldownEnd) return false;

        const now = Date.now();
        if (now >= cooldownEnd) {
            this.endpointCooldowns.delete(endpoint);
            return false;
        }
        return true;
    }

    /**
     * Put an endpoint on cooldown
     * @param {string} endpoint - Endpoint identifier
     * @param {number} duration - Cooldown duration in milliseconds
     */
    setEndpointCooldown(endpoint, duration = null) {
        const cooldownDuration = duration || this.COOLDOWN_DURATION;
        this.endpointCooldowns.set(endpoint, Date.now() + cooldownDuration);
    }

    /**
     * Check if an error should be suppressed from logging
     * @param {string} key - Error cache key
     * @returns {boolean}
     */
    shouldSuppressError(key) {
        const cachedTime = this.errorCache.get(key);
        if (!cachedTime) {
            this.errorCache.set(key, Date.now());
            return false;
        }

        if (Date.now() - cachedTime > this.ERROR_CACHE_TTL) {
            this.errorCache.set(key, Date.now());
            return false;
        }
        return true;
    }

    /**
     * Adaptive delay based on error type and retry count
     * @param {number} retryCount - Current retry attempt
     * @param {number} errorCode - Facebook error code
     * @returns {number} Delay in milliseconds
     */
    getAdaptiveDelay(retryCount, errorCode = null) {
        const baseDelays = [2000, 5000, 10000];

        if (errorCode === 1545012 || errorCode === 1675004) {
            return baseDelays[Math.min(retryCount, baseDelays.length - 1)] * 1.5;
        }

        return baseDelays[Math.min(retryCount, baseDelays.length - 1)];
    }

    /**
     * Get current hour for circadian rhythm
     * @returns {number}
     */
    getCurrentHour() {
        return new Date().getHours();
    }

    /**
     * Check if currently in quiet hours
     * @returns {boolean}
     */
    isQuietHours() {
        const hour = this.getCurrentHour();
        return hour >= this.QUIET_HOURS.start && hour < this.QUIET_HOURS.end;
    }

    /**
     * Get circadian multiplier based on time of day
     * @returns {number}
     */
    getCircadianMultiplier() {
        const hour = this.getCurrentHour();
        if (hour >= 2 && hour < 6) return 3.0;
        if (hour >= 0 && hour < 2) return 2.0;
        if (hour >= 6 && hour < 9) return 1.2;
        if (hour >= 9 && hour < 18) return 1.0;
        if (hour >= 18 && hour < 22) return 1.1;
        return 1.5;
    }

    /**
     * Get context-aware delay based on conversation context
     * @param {object} context - Request context
     * @returns {Promise<number>}
     */
    async getContextAwareDelay(context = {}) {
        const { threadID, messageType = 'text', hasAttachment = false, isReply = false } = context;
        
        let baseDelay = 200;
        
        if (hasAttachment) {
            baseDelay += Math.random() * 1500 + 500;
        }
        
        if (isReply) {
            baseDelay += Math.random() * 300;
        }
        
        const circadianMultiplier = this.getCircadianMultiplier();
        baseDelay *= circadianMultiplier;
        
        if (this.checkpointMode) {
            baseDelay *= 5;
        }
        
        if (threadID && this.detectBurst(threadID)) {
            baseDelay *= 2;
        }
        
        const variance = baseDelay * 0.3;
        const finalDelay = baseDelay + (Math.random() * variance - variance / 2);
        
        return Math.max(200, Math.floor(finalDelay));
    }

    /**
     * Detect burst activity in thread
     * @param {string} threadID
     * @returns {boolean}
     */
    detectBurst(threadID) {
        const now = Date.now();
        const history = this.requestHistory.get(threadID) || [];
        const recentRequests = history.filter(time => (now - time) < this.BURST_WINDOW_MS);
        return recentRequests.length >= this.BURST_THRESHOLD;
    }

    /**
     * Record request for burst detection
     * @param {string} threadID
     */
    recordRequest(threadID) {
        const now = Date.now();
        const history = this.requestHistory.get(threadID) || [];
        history.push(now);
        const cleaned = history.filter(time => (now - time) < this.BURST_WINDOW_MS);
        this.requestHistory.set(threadID, cleaned);
    }

    /**
     * Track behavioral metrics
     * @param {string} threadID
     * @param {string} action
     * @param {object} metadata
     */
    trackBehavior(threadID, action, metadata = {}) {
        const metrics = this.behavioralMetrics.get(threadID) || {
            messageCount: 0,
            replyCount: 0,
            attachmentCount: 0,
            lastActivity: 0,
            avgResponseTime: 0,
            responseTimes: []
        };
        
        switch (action) {
            case 'message':
                metrics.messageCount++;
                break;
            case 'reply':
                metrics.replyCount++;
                if (metadata.responseTime) {
                    metrics.responseTimes.push(metadata.responseTime);
                    if (metrics.responseTimes.length > 10) {
                        metrics.responseTimes.shift();
                    }
                    metrics.avgResponseTime = metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length;
                }
                break;
            case 'attachment':
                metrics.attachmentCount++;
                break;
        }
        
        metrics.lastActivity = Date.now();
        this.behavioralMetrics.set(threadID, metrics);
    }

    /**
     * Add stochastic delay to simulate human behavior
     * @param {object} context - Request context
     * @returns {Promise<void>}
     */
    async addStochasticDelay(context = {}) {
        const delay = await this.getContextAwareDelay(context);
        await new Promise(resolve => setTimeout(resolve, delay));
        if (context.threadID) {
            this.recordRequest(context.threadID);
        }
    }

    /**
     * Add humanized delay to simulate human behavior
     * @param {number} min - Minimum delay in milliseconds
     * @param {number} max - Maximum delay in milliseconds
     * @returns {Promise<void>}
     */
    async addHumanizedDelay(min = 200, max = 600) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * Enter checkpoint-aware backoff mode
     * @param {number} duration - Duration in milliseconds
     */
    enterCheckpointMode(duration = 3600000) {
        this.checkpointMode = true;
        setTimeout(() => {
            this.checkpointMode = false;
        }, duration);
    }

    /**
     * Check if can make request based on rate limiting and add humanized delay
     * @param {boolean|object} skipHumanDelayOrContext - Skip the humanized delay if boolean, or context object
     * @returns {Promise<void>}
     */
    async checkRateLimit(skipHumanDelayOrContext = false) {
        while (this.activeRequests >= this.MAX_CONCURRENT_REQUESTS) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const isContextObject = typeof skipHumanDelayOrContext === 'object' && skipHumanDelayOrContext !== null;
        const skipHumanDelay = typeof skipHumanDelayOrContext === 'boolean' ? skipHumanDelayOrContext : false;
        const context = isContextObject ? skipHumanDelayOrContext : {};

        if (!skipHumanDelay) {
            if (isContextObject) {
                await this.addStochasticDelay(context);
            } else {
                await this.addHumanizedDelay();
            }
        }

        this.activeRequests++;

        setTimeout(() => {
            this.activeRequests = Math.max(0, this.activeRequests - 1);
        }, 1000);
    }

    /**
     * Clear expired entries from cache
     */
    cleanup() {
        const now = Date.now();

        for (const [key, time] of this.errorCache.entries()) {
            if (now - time > this.ERROR_CACHE_TTL) {
                this.errorCache.delete(key);
            }
        }

        for (const [key, time] of this.threadCooldowns.entries()) {
            if (now >= time) {
                this.threadCooldowns.delete(key);
            }
        }

        for (const [key, time] of this.endpointCooldowns.entries()) {
            if (now >= time) {
                this.endpointCooldowns.delete(key);
            }
        }

        for (const [threadID, history] of this.requestHistory.entries()) {
            const cleaned = history.filter(time => (now - time) < this.BURST_WINDOW_MS);
            if (cleaned.length === 0) {
                this.requestHistory.delete(threadID);
            } else {
                this.requestHistory.set(threadID, cleaned);
            }
        }

        for (const [threadID, metrics] of this.behavioralMetrics.entries()) {
            if ((now - metrics.lastActivity) > 3600000) {
                this.behavioralMetrics.delete(threadID);
            }
        }
    }

    /**
     * Get cooldown remaining time for thread
     * @param {string} threadID - Thread identifier
     * @returns {number} Remaining milliseconds
     */
    getCooldownRemaining(threadID) {
        const cooldownEnd = this.threadCooldowns.get(threadID);
        if (!cooldownEnd) return 0;
        return Math.max(0, cooldownEnd - Date.now());
    }

    /**
     * Get cooldown remaining time for endpoint
     * @param {string} endpoint - Endpoint identifier
     * @returns {number} Remaining milliseconds
     */
    getEndpointCooldownRemaining(endpoint) {
        const cooldownEnd = this.endpointCooldowns.get(endpoint);
        if (!cooldownEnd) return 0;
        return Math.max(0, cooldownEnd - Date.now());
    }
}

const globalRateLimiter = new RateLimiter();

setInterval(() => globalRateLimiter.cleanup(), 60000);

module.exports = {
    RateLimiter,
    globalRateLimiter
};
