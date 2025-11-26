"use strict";

const utils = require('../utils');

const allowedProperties = {
  attachment: true,
  url: true,
  sticker: true,
  emoji: true,
  emojiSize: true,
  body: true,
  mentions: true,
  location: true,
};

module.exports = (defaultFuncs, api, ctx) => {
  function detectAttachmentType(attachment) {
    const path = attachment.path || '';
    const ext = path.toLowerCase().split('.').pop();
    
    const audioTypes = ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'opus', 'flac'];
    const videoTypes = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'wmv', 'flv'];
    const imageTypes = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'];
    
    if (audioTypes.includes(ext)) {
      return { voice_clip: "true" };
    } else if (videoTypes.includes(ext)) {
      return { video: "true" };
    } else if (imageTypes.includes(ext)) {
      return { image: "true" };
    }
    
    return { file: "true" };
  }

  async function uploadSingleAttachment(attachment) {
    if (!utils.isReadableStream(attachment)) {
      throw new Error("Attachment should be a readable stream and not " + utils.getType(attachment) + ".");
    }
    
    const uploadType = detectAttachmentType(attachment);
    const oksir = await defaultFuncs.postFormData("https://upload.facebook.com/ajax/mercury/upload.php", ctx.jar, {
      upload_1024: attachment,
      ...uploadType
    }, {}).then(utils.parseAndCheckLogin(ctx, defaultFuncs));
    
    if (oksir.error) {
      throw new Error(JSON.stringify(oksir));
    }
    return oksir.payload.metadata[0];
  }

  async function uploadAttachment(attachments) {
    const CONCURRENT_UPLOADS = 3;
    
    const uploadPromises = [];
    const uploads = [];
    
    for (let i = 0; i < attachments.length; i += CONCURRENT_UPLOADS) {
      const batch = attachments.slice(i, i + CONCURRENT_UPLOADS);
      const batchPromises = batch.map(attachment => uploadSingleAttachment(attachment));
      const batchResults = await Promise.all(batchPromises);
      uploads.push(...batchResults);
    }
    
    return uploads;
  }

  async function getUrl(url) {
    const resData = await defaultFuncs.post("https://www.facebook.com/message_share_attachment/fromURI/", ctx.jar, {
      image_height: 960,
      image_width: 960,
      uri: url
    }).then(utils.parseAndCheckLogin(ctx, defaultFuncs));
    if (!resData || resData.error || !resData.payload){
        throw new Error("Invalid url");
    }
    return resData.payload.share_data.share_params;
  }

  async function sendContent(form, threadID, isSingleUser, messageAndOTID, callback) {
    if (utils.getType(threadID) === "Array") {
      for (var i = 0; i < threadID.length; i++) {
        form["specific_to_list[" + i + "]"] = "fbid:" + threadID[i];
      }
      form["specific_to_list[" + threadID.length + "]"] = "fbid:" + ctx.userID;
      form["client_thread_id"] = "root:" + messageAndOTID;
      utils.log("sendMessage", "Sending message to multiple users: " + threadID);
    } else {
      if (isSingleUser) {
        form["specific_to_list[0]"] = "fbid:" + threadID;
        form["specific_to_list[1]"] = "fbid:" + ctx.userID;
        form["other_user_fbid"] = threadID;
      } else {
        form["thread_fbid"] = threadID;
      }
    }

    if (ctx.globalOptions.pageID) {
      form["author"] = "fbid:" + ctx.globalOptions.pageID;
      form["specific_to_list[1]"] = "fbid:" + ctx.globalOptions.pageID;
      form["creator_info[creatorID]"] = ctx.userID;
      form["creator_info[creatorType]"] = "direct_admin";
      form["creator_info[labelType]"] = "sent_message";
      form["creator_info[pageID]"] = ctx.globalOptions.pageID;
      form["request_user_id"] = ctx.globalOptions.pageID;
      form["creator_info[profileURI]"] =
        "https://www.facebook.com/profile.php?id=" + ctx.userID;
    }

    const resData = await defaultFuncs.post("https://www.facebook.com/messaging/send/", ctx.jar, form).then(utils.parseAndCheckLogin(ctx, defaultFuncs));
    if (!resData) {
      throw new Error("Send message failed.");
    }
    if (resData.error) {
      if (resData.error === 1545012) {
        utils.warn("sendMessage", "Got error 1545012. This might mean that you're not part of the conversation " + threadID);
      }
      throw new Error(JSON.stringify(resData));
    }
    const messageInfo = resData.payload.actions.reduce((p, v) => {
        return { threadID: v.thread_fbid, messageID: v.message_id, timestamp: v.timestamp } || p;
    }, null);
    return messageInfo;
  }

  return async (msg, threadID, callback, replyToMessage, isGroup) => {
    if (!callback && (utils.getType(threadID) === "Function" || utils.getType(threadID) === "AsyncFunction")) {
      throw new Error("Pass a threadID as a second argument.");
    }
    if (!replyToMessage && utils.getType(callback) === "String") {
      replyToMessage = callback;
      callback = undefined;
    }

    let resolveFunc = () => {};
    let rejectFunc = () => {};
    let returnPromise = new Promise((resolve, reject) => {
      resolveFunc = resolve;
      rejectFunc = reject;
    });

    if (!callback) {
      callback = (err, data) => {
        if (err) return rejectFunc(err);
        resolveFunc(data);
      };
    }

    let msgType = utils.getType(msg);
    let threadIDType = utils.getType(threadID);
    let messageIDType = utils.getType(replyToMessage);
    if (msgType !== "String" && msgType !== "Object") {
      return callback(new Error("Message should be of type string or object and not " + msgType + "."));
    }
    if (threadIDType !== "Array" && threadIDType !== "Number" && threadIDType !== "String") {
      return callback(new Error("ThreadID should be of type number, string, or array and not " + threadIDType + "."));
    }
    if (replyToMessage && messageIDType !== 'String') {
      return callback(new Error("MessageID should be of type string and not " + threadIDType + "."));
    }
    if (msgType === "String") {
      msg = { body: msg };
    }
    let disallowedProperties = Object.keys(msg).filter(prop => !allowedProperties[prop]);
    if (disallowedProperties.length > 0) {
      return callback(new Error("Dissallowed props: `" + disallowedProperties.join(", ") + "`"));
    }

    try {
      let messageAndOTID = utils.generateOfflineThreadingID();
      let form = {
        client: "mercury",
        action_type: "ma-type:user-generated-message",
        author: "fbid:" + ctx.userID,
        timestamp: Date.now(),
        timestamp_absolute: "Today",
        timestamp_relative: utils.generateTimestampRelative(),
        timestamp_time_passed: "0",
        is_unread: false,
        is_cleared: false,
        is_forward: false,
        is_filtered_content: false,
        is_filtered_content_bh: false,
        is_filtered_content_account: false,
        is_filtered_content_quasar: false,
        is_filtered_content_invalid_app: false,
        is_spoof_warning: false,
        source: "source:chat:web",
        "source_tags[0]": "source:chat",
        ...(msg.body && {
            body: msg.body
        }),
        html_body: false,
        ui_push_phase: "V3",
        status: "0",
        offline_threading_id: messageAndOTID,
        message_id: messageAndOTID,
        threading_id: utils.generateThreadingID(ctx.clientID),
        "ephemeral_ttl_mode:": "0",
        manual_retry_cnt: "0",
        has_attachment: !!(msg.attachment || msg.url || msg.sticker),
        signatureID: utils.getSignatureID(),
        ...(replyToMessage && {
            replied_to_message_id: replyToMessage
        })
      };

      if (msg.location) {
        if (!msg.location.latitude || !msg.location.longitude) {
          return callback(new Error("location property needs both latitude and longitude"));
        }
        form["location_attachment[coordinates][latitude]"] = msg.location.latitude;
        form["location_attachment[coordinates][longitude]"] = msg.location.longitude;
        form["location_attachment[is_current_location]"] = !!msg.location.current;
      }
      if (msg.sticker) {
        form["sticker_id"] = msg.sticker;
      }
      if (msg.attachment) {
        form.image_ids = [];
        form.gif_ids = [];
        form.file_ids = [];
        form.video_ids = [];
        form.audio_ids = [];
        if (utils.getType(msg.attachment) !== "Array") {
          msg.attachment = [msg.attachment];
        }
        const files = await uploadAttachment(msg.attachment);
        files.forEach(file => {
            const type = Object.keys(file)[0];
            form["" + type + "s"].push(file[type]);
        }); 
      }
      if (msg.url) {
        form["shareable_attachment[share_type]"] = "100";
        const params = await getUrl(msg.url);
        form["shareable_attachment[share_params]"] = params;
      }
      if (msg.emoji) {
        if (!msg.emojiSize) {
          msg.emojiSize = "medium";
        }
        if (msg.emojiSize !== "small" && msg.emojiSize !== "medium" && msg.emojiSize !== "large") {
          return callback(new Error("emojiSize property is invalid"));
        }
        if (form.body && form.body !== "") {
          return callback(new Error("body is not empty"));
        }
        form.body = msg.emoji;
        form["tags[0]"] = "hot_emoji_size:" + msg.emojiSize;
      } 
      if (msg.mentions) {
        for (let i = 0; i < msg.mentions.length; i++) {
          const mention = msg.mentions[i];
          const tag = mention.tag;
          if (typeof tag !== "string") {
            return callback(new Error("Mention tags must be strings."));
          }
          const offset = msg.body.indexOf(tag, mention.fromIndex || 0);
          if (offset < 0) utils.warn("handleMention", 'Mention for "' + tag + '" not found in message string.');
          if (!mention.id) utils.warn("handleMention", "Mention id should be non-null.");
          const id = mention.id || 0;
          const emptyChar = '\u200E';
          form["body"] = emptyChar + msg.body;
          form["profile_xmd[" + i + "][offset]"] = offset + 1;
          form["profile_xmd[" + i + "][length]"] = tag.length;
          form["profile_xmd[" + i + "][id]"] = id;
          form["profile_xmd[" + i + "][type]"] = "p";
        }
      }

      const isSingleUser = (utils.getType(isGroup) !== "Boolean") ? (threadID.toString().length <= 15) : !isGroup;
      const result = await sendContent(form, threadID, isSingleUser, messageAndOTID);
      callback(null, result);
    } catch (err) {
      callback(err);
    }
    return returnPromise;
  };
};