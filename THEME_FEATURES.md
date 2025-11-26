# Theme Management Features

This document explains the theme-related features in xnil6x v4.2.5.

## 📚 Documentation

- **[README](README.md)** - Getting started and overview
- **[API Reference](API_REFERENCE.md)** - Complete API documentation
- **[Bot Testing](BOT_TESTING.md)** - Test bot examples
- **[Contributing](CONTRIBUTING.md)** - Contribution guidelines
- **[Changelog](CHANGELOG.md)** - Version history

---

## Available Functions

### 1. `getTheme(threadID)`
Retrieves all available Facebook Messenger themes.

```javascript
const themes = await api.getTheme(threadID);
console.log(`Found ${themes.length} themes!`);
themes.forEach(theme => {
  console.log(`- ${theme.name} (ID: ${theme.id})`);
});
```

**Returns:** Array of theme objects with `id`, `name`, `theme_idx`, and `accessibility_label`.

### 2. `getThemeInfo(threadID)`
Gets the current theme information for a specific thread.

```javascript
const info = await api.getThemeInfo(threadID);
console.log(`Thread: ${info.threadName}`);
console.log(`Color: ${info.color}`);
console.log(`Emoji: ${info.emoji}`);
console.log(`Theme ID: ${info.theme_id}`);
```

**Returns:** Object containing thread name, color, emoji, theme_id, and more.

### 3. `createAITheme(prompt)`
Generates AI-powered custom themes based on a text prompt.

```javascript
try {
  const aiThemes = await api.createAITheme("sunset ocean vibes");
  console.log(`Generated ${aiThemes.length} AI themes!`);
} catch (e) {
  if (e.code === 'FEATURE_UNAVAILABLE') {
    console.log("AI themes not available for this account");
  }
}
```

**Important:** AI theme generation is restricted by Facebook to specific accounts/regions. If unavailable for your account, you'll receive a `FEATURE_UNAVAILABLE` error - this is normal and not a bug.

### 4. `setThreadThemeMqtt(threadID, themeID)`
Applies a theme to a conversation thread.

```javascript
const themes = await api.getTheme(threadID);
const blueTheme = themes.find(t => t.name.includes("Blue"));
await api.setThreadThemeMqtt(threadID, blueTheme.id);
console.log("Theme applied!");
```

## Complete Example

See `examples/theme-usage-example.js` for a full working example.

## Error Handling

### Error 1545012 Fix with Automatic Retry

**New in v4.2.4:** Error 1545012 ("Not part of conversation") now includes intelligent retry logic to handle temporary Facebook API glitches.

**What changed:**
- The API now automatically retries up to 3 times with exponential backoff (1s, 2s, 3s)
- Between retries, it verifies your bot's membership using `getThreadInfo`
- If the bot is confirmed NOT in the group, it fails immediately
- If the bot IS in the group, it retries automatically

**Why this matters:**
Facebook often returns error 1545012 even when your bot IS in the group due to:
- Stale thread membership cache on Facebook's side
- Recent re-joins not yet propagated
- Temporary backend hiccups

This fix masks transient errors while still catching real "not in group" cases.

```javascript
try {
  await api.sendMessage("Hello", threadID);
} catch (err) {
  if (err.code === 1545012) {
    if (err.verified) {
      console.log(`Confirmed: Bot is NOT in conversation ${err.threadID}`);
    } else {
      console.log(`Error persisted after ${err.attempts} retries for ${err.threadID}`);
    }
  }
}
```

The error now includes:
- `code`: 1545012
- `threadID`: The thread you tried to message
- `messageID`: The generated message ID
- `timestamp`: When the error occurred
- `attempts`: Number of retry attempts made
- `verified`: Whether membership was verified via getThreadInfo

## Testing

Run the comprehensive test suite:

```bash
node test/theme-complete-test.js
```

This validates all theme functionality and clearly distinguishes between working features and Facebook-imposed restrictions.

## Notes

- **Standard themes**: Always work for all accounts (93+ themes available)
- **AI themes**: May not be available depending on your Facebook account's region/permissions
- **MQTT required**: Theme operations require an active MQTT connection via `api.listenMqtt()`

---

## See Also

- **[API Reference](API_REFERENCE.md)** - Complete documentation of all API methods including theme functions
- **[Bot Testing](BOT_TESTING.md)** - Test the theme commands with the test bot
- **[README](README.md)** - Main project documentation
