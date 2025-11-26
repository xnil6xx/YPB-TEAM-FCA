"use strict";

const log = require("npmlog");
const utils = require("../utils");

module.exports = function (defaultFuncs, api, ctx) {
  return function fetchThemeData(themeID, callback) {
    let resolveFunc, rejectFunc;
    const promise = new Promise((resolve, reject) => {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    const done = callback || function (err, data) {
      if (err) return rejectFunc(err);
      resolveFunc(data);
    };

    if (!themeID) {
      done({ error: "Theme ID is a required parameter" });
      return promise;
    }

    const payload = {
      av: ctx.userID,
      __user: ctx.userID,
      __a: 1,
      __req: utils.getSignatureID(),
      fb_dtsg: ctx.fb_dtsg,
      lsd: ctx.fb_dtsg,
      jazoest: ctx.jazoest,
      fb_api_caller_class: "RelayModern",
      fb_api_req_friendly_name: "MWPThreadThemeProviderQuery",
      variables: JSON.stringify({ id: themeID.toString() }),
      server_timestamps: true,
      doc_id: "9734829906576883"
    };

    defaultFuncs
      .post("https://www.facebook.com/api/graphql/", ctx.jar, payload)
      .then(utils.parseAndCheckLogin(ctx, defaultFuncs))
      .then((res) => {
        if (res.errors) throw res.errors;

        const data = res?.data?.messenger_thread_theme;
        if (!data) throw new Error("Theme data could not be located in the response");

        const output = {
          id: data.id,
          name: data.accessibility_label,
          description: data.description,
          colors: data.gradient_colors || [data.fallback_color],
          backgroundImage: data.background_asset?.image?.uri || null
        };

        done(null, output);
      })
      .catch((err) => {
        log.error("fetchThemeData", err);
        done(err);
      });

    return promise;
  };
};
