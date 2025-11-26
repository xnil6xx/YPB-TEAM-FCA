"use strict";

const utils = require('../utils');

function formatData(data) {
  return {
    userID: utils.formatID(data.uid.toString()),
    photoUrl: data.photo,
    indexRank: data.index_rank,
    name: data.text,
    isVerified: data.is_verified,
    profileUrl: data.path,
    category: data.category,
    score: data.score,
    type: data.type
  };
}

module.exports = (defaultFuncs, api, ctx) => {
  return async function getUserID(name, callback) {
    let resolveFunc = () => {};
    let rejectFunc = () => {};
    const returnPromise = new Promise((resolve, reject) => {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = (err, result) => {
        if (err) return rejectFunc(err);
        resolveFunc(result);
      };
    }

    if (!name || typeof name !== 'string') {
      const error = { error: "getUserID: name parameter must be a non-empty string" };
      utils.error("getUserID", error);
      return callback(error);
    }

    try {
      const form = {
        value: name.toLowerCase(),
        viewer: ctx.userID,
        rsp: "search",
        context: "search",
        path: "/home.php",
        request_id: ctx.clientID || utils.getGUID()
      };

      const res = await defaultFuncs.get("https://www.facebook.com/ajax/typeahead/search.php", ctx.jar, form)
        .then(utils.parseAndCheckLogin(ctx, defaultFuncs));

      if (res.error) {
        throw res;
      }

      if (!res.payload || !res.payload.entries) {
        const error = { 
          error: "getUserID: No results found. This may be due to Facebook security restrictions or account checkpoint.",
          details: "Your account may require verification. Please visit facebook.com to verify."
        };
        throw error;
      }

      const data = res.payload.entries;
      
      if (data.length === 0) {
        utils.warn(`getUserID: No user found with name "${name}"`);
      }

      callback(null, data.map(formatData));
    } catch (err) {
      if (err.error && typeof err.error === 'string' && err.error.includes('checkpoint')) {
        err.friendlyMessage = "Account checkpoint required - Please verify your account on facebook.com";
      }
      utils.error("getUserID", err);
      callback(err);
    }

    return returnPromise;
  };
};
