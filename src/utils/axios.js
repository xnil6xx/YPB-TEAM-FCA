/* eslint-disable no-prototype-builtins */
"use strict";

const axios = require("axios");
const { CookieJar } = require("tough-cookie");
const { wrapper } = require("axios-cookiejar-support");
const FormData = require("form-data");
const { getHeaders } = require("./headers");
const { getType } = require("./constants");
const { globalRateLimiter } = require("./rateLimiter");

const jar = new CookieJar();
const client = wrapper(axios.create({ jar }));

let proxyConfig = {};

/**
 * A utility to introduce a delay, used for retries.
 * @param {number} ms - The delay in milliseconds.
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Adapts the axios response/error to match the structure expected by the rest of the application.
 * @param {object} res - The axios response or error object.
 * @returns {object} An object that mimics the old 'request' library's response.
 */
function adaptResponse(res) {
    const response = res.response || res;
    return {
        ...response,
        body: response.data,
        statusCode: response.status,
        request: {
            uri: new URL(response.config.url),
            headers: response.config.headers,
            method: response.config.method.toUpperCase(),
            form: response.config.data,
            formData: response.config.data
        },
    };
}

/**
 * Performs a request with retry logic and exponential backoff.
 * @param {Function} requestFunction - A function that returns an axios promise.
 * @param {number} [retries=3] - The number of retries.
 * @param {string} [endpoint=''] - Endpoint identifier for rate limiting.
 * @param {string} [threadID=''] - Thread identifier for rate limiting.
 * @returns {Promise<object>}
 */
async function requestWithRetry(requestFunction, retries = 3, endpoint = '', threadID = '') {
    await globalRateLimiter.checkRateLimit();

    if (endpoint && globalRateLimiter.isEndpointOnCooldown(endpoint)) {
        const cooldown = globalRateLimiter.getEndpointCooldownRemaining(endpoint);
        console.warn(`Endpoint ${endpoint} on cooldown. Waiting ${cooldown}ms...`);
        await delay(cooldown);
    }

    if (threadID && globalRateLimiter.isThreadOnCooldown(threadID)) {
        const cooldown = globalRateLimiter.getCooldownRemaining(threadID);
        console.warn(`Thread ${threadID} on cooldown. Waiting ${cooldown}ms...`);
        await delay(cooldown);
    }

    const checkAndApplyRateLimitCooldowns = (responseBody) => {
        const ERROR_COOLDOWNS = {
            1545012: 60000,
            1675004: 30000,
            368: 90000
        };

        const applyCooldown = (errorCode) => {
            if (errorCode && ERROR_COOLDOWNS[errorCode]) {
                if (threadID) {
                    globalRateLimiter.setThreadCooldown(threadID, ERROR_COOLDOWNS[errorCode]);
                }
                if (endpoint) {
                    globalRateLimiter.setEndpointCooldown(endpoint, ERROR_COOLDOWNS[errorCode]);
                }
                console.warn(`Rate limit detected (error ${errorCode}). Applied cooldown.`);
                return true;
            }
            return false;
        };

        if (!responseBody || typeof responseBody !== 'object') {
            return false;
        }

        if (applyCooldown(responseBody.error)) {
            return true;
        }

        if (Array.isArray(responseBody)) {
            for (const item of responseBody) {
                if (item && typeof item === 'object') {
                    if (applyCooldown(item.error)) return true;
                    if (item.errors && Array.isArray(item.errors)) {
                        for (const err of item.errors) {
                            const code = err.code || err.extensions?.code;
                            if (applyCooldown(code)) return true;
                        }
                    }
                }
            }
        }

        if (responseBody.errors && Array.isArray(responseBody.errors)) {
            for (const err of responseBody.errors) {
                const code = err.code || err.extensions?.code;
                if (applyCooldown(code)) return true;
            }
        }

        return false;
    };

    for (let i = 0; i < retries; i++) {
        try {
            const res = await requestFunction();
            const adapted = adaptResponse(res);

            checkAndApplyRateLimitCooldowns(adapted.body);

            return adapted;
        } catch (error) {
            if (error.response) {
                const adapted = adaptResponse(error.response);
                checkAndApplyRateLimitCooldowns(adapted.body);
            }

            if (i === retries - 1) {
                console.error(`Request failed after ${retries} attempts:`, error.message);
                if (error.response) {
                    return adaptResponse(error.response);
                }
                throw error;
            }
            const backoffTime = (1 << i) * 1000 + Math.floor(Math.random() * 200);
            console.warn(`Request attempt ${i + 1} failed. Retrying in ${backoffTime}ms...`);
            await delay(backoffTime);
        }
    }
}

/**
 * Sets a proxy for all subsequent requests.
 * @param {string} proxyUrl - The proxy URL (e.g., "http://user:pass@host:port").
 */
function setProxy(proxyUrl) {
    if (proxyUrl) {
        try {
            const parsedProxy = new URL(proxyUrl);
            proxyConfig = {
                proxy: {
                    host: parsedProxy.hostname,
                    port: parsedProxy.port,
                    protocol: parsedProxy.protocol.replace(":", ""),
                    auth: parsedProxy.username && parsedProxy.password ? {
                        username: parsedProxy.username,
                        password: parsedProxy.password,
                    } : undefined,
                },
            };
        } catch (e) {
            console.error("Invalid proxy URL. Please use a full URL format (e.g., http://user:pass@host:port).");
            proxyConfig = {};
        }
    } else {
        proxyConfig = {};
    }
}

/**
 * A simple GET request without extra options.
 * @param {string} url - The URL to fetch.
 * @returns {Promise<object>} A promise that resolves with the response.
 */
function cleanGet(url) {
    const fn = () => client.get(url, { timeout: 60000, ...proxyConfig });
    return requestWithRetry(fn);
}

/**
 * Performs a GET request with query parameters and custom options.
 * @param {string} url
 * @param {object} reqJar
 * @param {object} qs - Query string parameters.
 * @param {object} options
 * @param {object} ctx
 * @param {object} customHeader
 * @returns {Promise<object>}
 */
async function get(url, reqJar, qs, options, ctx, customHeader) {
    const config = {
        headers: getHeaders(url, options, ctx, customHeader),
        timeout: 60000,
        params: qs,
        ...proxyConfig,
        validateStatus: (status) => status >= 200 && status < 600,
    };
    const endpoint = new URL(url).pathname;
    return requestWithRetry(async () => await client.get(url, config), 3, endpoint);
}

/**
 * Performs a POST request, automatically handling JSON or URL-encoded form data.
 * @param {string} url
 * @param {object} reqJar
 * @param {object} form - The form data object.
 * @param {object} options
 * @param {object} ctx
 * @param {object} customHeader
 * @returns {Promise<object>}
 */
async function post(url, reqJar, form, options, ctx, customHeader) {
    const headers = getHeaders(url, options, ctx, customHeader, 'xhr');
    let data = form;
    let contentType = headers['Content-Type'] || 'application/x-www-form-urlencoded';

    if (contentType.includes('json')) {
        data = JSON.stringify(form);
    } else {
        const transformedForm = new URLSearchParams();
        for (const key in form) {
            if (form.hasOwnProperty(key)) {
                let value = form[key];
                if (getType(value) === "Object") {
                    value = JSON.stringify(value);
                }
                transformedForm.append(key, value);
            }
        }
        data = transformedForm.toString();
    }

    headers['Content-Type'] = contentType;

    const config = {
        headers,
        timeout: 60000,
        ...proxyConfig,
        validateStatus: (status) => status >= 200 && status < 600,
    };
    const endpoint = new URL(url).pathname;
    return requestWithRetry(async () => await client.post(url, data, config), 3, endpoint);
}

/**
 * Performs a POST request with multipart/form-data.
 * @param {string} url
 * @param {object} reqJar
 * @param {object} form - The form data object, may contain readable streams.
 * @param {object} qs - Query string parameters.
 * @param {object} options
 * @param {object} ctx
 * @returns {Promise<object>}
 */
async function postFormData(url, reqJar, form, qs, options, ctx) {
    const formData = new FormData();
    for (const key in form) {
        if (form.hasOwnProperty(key)) {
            formData.append(key, form[key]);
        }
    }

    const customHeader = { "Content-Type": `multipart/form-data; boundary=${formData.getBoundary()}` };

    const config = {
        headers: getHeaders(url, options, ctx, customHeader, 'xhr'),
        timeout: 60000,
        params: qs,
        ...proxyConfig,
        validateStatus: (status) => status >= 200 && status < 600,
    };
    const endpoint = new URL(url).pathname;
    return requestWithRetry(async () => await client.post(url, formData, config), 3, endpoint);
}

module.exports = {
  cleanGet,
  get,
  post,
  postFormData,
  getJar: () => jar,
  setProxy,
};