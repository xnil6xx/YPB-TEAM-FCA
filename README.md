# xnil-ypb-fca

[![npm version](https://img.shields.io/npm/v/xnil-ypb-fca.svg)](https://www.npmjs.com/package/xnil-ypb-fca)
[![npm downloads](https://img.shields.io/npm/dm/xnil-ypb-fca.svg)](https://www.npmjs.com/package/xnil-ypb-fca)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/xnil-ypb-fca.svg)](https://nodejs.org)

**xnil-ypb-fca** is a Facebook Chat API (FCA) library for Node.js that allows you to automate and interact with Facebook Messenger programmatically. This library provides a complete interface to send/receive messages, manage conversations, handle events, and build chat bots without using Facebook's official API.

## What is Facebook Chat API (FCA)?

Facebook Chat API is an unofficial library that reverse-engineers Facebook Messenger's internal protocols to provide programmatic access to messaging features. Unlike the official Facebook Graph API (which has limited messaging capabilities), FCA allows:

- **Full Messenger Access** - Send and receive messages, attachments, stickers, and reactions
- **Real-Time Events** - Listen to messages, typing indicators, read receipts, and group events via MQTT
- **No App Review Required** - Works with your personal Facebook account credentials
- **Complete Thread Control** - Manage group chats, nicknames, themes, and admin settings

## Key Features

### Messaging
- Send text messages, attachments (images, videos, files), stickers, and emojis
- Reply to specific messages and forward messages
- Edit and unsend (delete) messages
- Send typing indicators and mark messages as read/delivered
- Handle message reactions

### Real-Time Listening
- MQTT-based event listener for instant message delivery
- Receive notifications for new messages, reactions, and read receipts
- Detect when users start/stop typing
- Get notified of group member joins, leaves, and admin changes

### Thread Management
- Get thread info (name, participants, images, settings)
- Load message history with pagination
- Change thread colors, emojis, and themes (including AI-generated themes)
- Rename groups and change group photos
- Add/remove participants and manage admin roles
- Pin/unpin messages and mute/unmute threads

### User Operations
- Get user profiles (name, profile picture, vanity URL)
- Search for users by name
- Get friends list and mutual friends
- Follow/unfollow users
- Block/unblock users

### Advanced Features
- Sticker search and sticker pack management
- Comment on Facebook posts
- Proxy support for connection routing
- Auto-reconnection with exponential backoff
- Session persistence via appstate

## Installation

**Requirements:** Node.js v18.0.0 or higher

```bash
npm install xnil-ypb-fca
```

## Quick Start

### 1. Get Your AppState

The appstate is a JSON file containing your Facebook session cookies. To get it:

1. Install a browser extension: "C3C FbState" (Chrome/Edge) or "Cookie-Editor" (Firefox)
2. Log in to Facebook in your browser
3. Export cookies and save as `appstate.json`:

```json
[
  { "key": "c_user", "value": "your-user-id" },
  { "key": "xs", "value": "your-xs-token" },
  { "key": "datr", "value": "your-datr-token" }
]
```

### 2. Create Your Bot

```javascript
const { login } = require("xnil-ypb-fca");

login({ appState: require("./appstate.json") }, (err, api) => {
  if (err) return console.error("Login failed:", err);

  console.log("Logged in successfully!");

  api.listenMqtt((err, event) => {
    if (err) return console.error(err);

    if (event.type === "message" || event.type === "message_reply") {
      console.log(`${event.senderID}: ${event.body}`);
      
      if (event.body === "/hello") {
        api.sendMessage("Hello! I'm a bot powered by xnil-ypb-fca", event.threadID);
      }
    }
  });
});
```

### 3. With Options

```javascript
const options = {
  selfListen: false,       // Don't receive own messages
  listenEvents: true,      // Receive group events (joins, leaves, etc)
  autoMarkRead: true,      // Auto mark messages as read
  autoMarkDelivery: true,  // Auto mark messages as delivered
  online: true,            // Appear online
  forceLogin: false        // Force new login (ignore saved session)
};

login({ appState: require("./appstate.json") }, options, (err, api) => {
  // Your bot code here
});
```

## API Reference

### Core Methods

| Method | Description |
|--------|-------------|
| `login(credentials, [options], callback)` | Authenticate with Facebook |
| `listenMqtt(callback)` | Start listening for real-time events |
| `logout(callback)` | End session and cleanup |
| `setOptions(options)` | Update runtime options |
| `getAppState()` | Get current session cookies |

### Messaging Methods

| Method | Description |
|--------|-------------|
| `sendMessage(message, threadID, [messageID], callback)` | Send a message (text, attachment, sticker) |
| `sendTypingIndicator(threadID, [isTyping], callback)` | Show/hide typing indicator |
| `unsendMessage(messageID, callback)` | Delete a sent message |
| `editMessage(text, messageID, callback)` | Edit a message |
| `setMessageReaction(reaction, messageID, callback)` | React to a message |
| `forwardAttachment(attachmentID, userOrUsers, callback)` | Forward an attachment |

### Thread Methods

| Method | Description |
|--------|-------------|
| `getThreadInfo(threadID, callback)` | Get thread details |
| `getThreadHistory(threadID, amount, timestamp, callback)` | Get message history |
| `getThreadList(limit, timestamp, tags, callback)` | List conversations |
| `getThreadPictures(threadID, offset, limit, callback)` | Get shared photos |
| `changeThreadColor(color, threadID, callback)` | Set thread color |
| `changeThreadEmoji(emoji, threadID, callback)` | Set thread emoji |
| `setTitle(newTitle, threadID, callback)` | Rename group |
| `changeGroupImage(image, threadID, callback)` | Set group photo |
| `muteThread(threadID, muteSeconds, callback)` | Mute notifications |

### User Methods

| Method | Description |
|--------|-------------|
| `getUserInfo(userID, callback)` | Get user profile |
| `getUserID(name, callback)` | Search user by name |
| `getFriendsList(callback)` | Get your friends |
| `addUserToGroup(userID, threadID, callback)` | Add member to group |
| `removeUserFromGroup(userID, threadID, callback)` | Remove member |
| `changeAdminStatus(threadID, userID, adminStatus, callback)` | Set admin status |
| `changeNickname(nickname, threadID, userID, callback)` | Set nickname |

### Other Methods

| Method | Description |
|--------|-------------|
| `markAsRead(threadID, callback)` | Mark thread as read |
| `markAsDelivered(threadID, messageID, callback)` | Mark as delivered |
| `markAsSeen(callback)` | Mark all as seen |
| `createPoll(title, options, threadID, callback)` | Create a poll |
| `searchForStickers(query, callback)` | Search stickers |
| `getStickerPackInfo(packID, callback)` | Get sticker pack |

## Event Types

When using `listenMqtt`, you'll receive events with these types:

| Event Type | Description |
|------------|-------------|
| `message` | New text message received |
| `message_reply` | Reply to a message |
| `message_reaction` | Someone reacted to a message |
| `message_unsend` | Message was deleted |
| `typ` | User started/stopped typing |
| `read` | Message was read |
| `read_receipt` | Read receipt received |
| `presence` | User online/offline status |
| `event` | Group events (name change, photo change, etc) |
| `log:subscribe` | User joined group |
| `log:unsubscribe` | User left group |

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `selfListen` | boolean | `false` | Receive your own messages |
| `listenEvents` | boolean | `true` | Receive group events |
| `autoMarkRead` | boolean | `true` | Auto mark as read |
| `autoMarkDelivery` | boolean | `false` | Auto mark as delivered |
| `online` | boolean | `true` | Show online status |
| `emitReady` | boolean | `false` | Emit ready event |
| `forceLogin` | boolean | `false` | Force new login |
| `userAgent` | string | (auto) | Custom user agent |
| `proxy` | string | `null` | HTTP/HTTPS proxy URL |

## Stability Features

This library includes production-ready stability improvements:

- **Memory Leak Prevention** - Proper cleanup of MQTT clients and event listeners
- **Reconnection Limits** - Max 100 reconnect attempts to prevent infinite loops
- **Exponential Backoff** - Smart reconnection delays (1s to 60s)
- **Session Auto-Cycling** - Refreshes connection every 4 hours
- **Error Handling** - Graceful handling of network errors and Facebook restrictions
- **Account Lock Detection** - Detects checkpoint and restriction errors

## Security Notice

Your `appstate.json` contains your Facebook session and should be treated like a password:

- Never commit it to version control (add to `.gitignore`)
- Never share it publicly
- Store securely in production (use environment variables or secrets manager)
- Regenerate if compromised

## Troubleshooting

**Login Failed / Invalid Session**
- Re-export your cookies from the browser
- Make sure you're logged into Facebook
- Clear browser cookies and login again

**Not Receiving Messages**
- Check that `listenMqtt` is running without errors
- Verify your account isn't restricted or checkpointed
- Check your internet connection

**Connection Keeps Dropping**
- The library auto-reconnects up to 100 times
- If it stops, your session may be invalid - get new appstate
- Check for Facebook account restrictions

**High Memory Usage**
- This version has memory leak fixes
- Restart your bot periodically for long-running deployments

## Documentation

- [Theme Features](THEME_FEATURES.md) - AI theme generation guide
- [Changelog](CHANGELOG.md) - Version history

## License

MIT License - see [LICENSE](LICENSE) file.

## Credits

Developed by **xnil6x** and **YPB Team**

Based on the Facebook Chat API community projects including ws3-fca and fca-unofficial.

---

**xnil-ypb-fca** - Reliable Facebook Messenger automation for Node.js
