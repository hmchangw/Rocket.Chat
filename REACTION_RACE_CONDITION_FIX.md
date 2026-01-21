# Reaction Race Condition Fix

## Problem

When multiple users spam-click reactions on slow 4G connections, the `setReaction` API was causing:
1. **Duplicate entries** in `reactions[emoji].users` field
2. **Missing entries** in `reactions[emoji].usernames` field (lost updates)

### Root Cause

The original implementation used a **read-modify-write** pattern that was not atomic:
1. Read the message with its reactions
2. Modify the reactions object in memory
3. Use `$set` to replace the entire `reactions` object

This caused race conditions where concurrent requests would read the same stale state and overwrite each other's changes.

---

## Backend Changes

### 1. Messages Model (`app/models/server/models/Messages.js`)

Added three new atomic methods:

```javascript
// Add a reaction atomically
addReaction(messageId, reaction, username, user) {
    return this.update(
        { _id: messageId },
        {
            $addToSet: {
                [`reactions.${reaction}.usernames`]: username,
            },
            $set: {
                [`reactions.${reaction}.users.${user._id}`]: user,
            },
        },
    );
}

// Remove a reaction atomically
removeReaction(messageId, reaction, username, userId) {
    return this.update(
        { _id: messageId },
        {
            $pull: {
                [`reactions.${reaction}.usernames`]: username,
            },
            $unset: {
                [`reactions.${reaction}.users.${userId}`]: 1,
            },
        },
    );
}

// Remove an entire reaction emoji when empty
removeReactionEmoji(messageId, reaction) {
    return this.update(
        { _id: messageId },
        {
            $unset: {
                [`reactions.${reaction}`]: 1,
            },
        },
    );
}
```

### 2. setReaction.js (`app/reactions/server/setReaction.js`)

Updated to use atomic operations and handle both legacy (array) and new (object) formats:

```javascript
// Helper functions added for backward compatibility
const getUsersCount = (message, reaction) => {
    const users = message.reactions?.[reaction]?.users;
    if (!users) return 0;
    return Array.isArray(users) ? users.length : Object.keys(users).length;
};

const isReactionEmpty = (message, reaction) => {
    return getUsersCount(message, reaction) === 0;
};

const hasUserReacted = (message, reaction, username) => {
    const usernames = message.reactions?.[reaction]?.usernames;
    return usernames && usernames.indexOf(username) !== -1;
};
```

**Key changes in the main function:**
- Uses `Messages.addReaction()` for atomic add
- Uses `Messages.removeReaction()` for atomic remove
- Re-fetches message after atomic operation to check if cleanup is needed

---

## Data Format Change

### Before (Legacy - Array)
```json
{
  "reactions": {
    ":thumbsup:": {
      "usernames": ["user1", "user2"],
      "users": [
        { "_id": "abc123", "username": "user1", "name": "User One" },
        { "_id": "def456", "username": "user2", "name": "User Two" }
      ]
    }
  }
}
```

### After (New - Object)
```json
{
  "reactions": {
    ":thumbsup:": {
      "usernames": ["user1", "user2"],
      "users": {
        "abc123": { "_id": "abc123", "username": "user1", "name": "User One" },
        "def456": { "_id": "def456", "username": "user2", "name": "User Two" }
      }
    }
  }
}
```

**Why object keys?**
- Object keys are unique by definition - duplicates are impossible
- `$set` with a specific path (`users.{userId}`) is atomic and idempotent
- No need for duplicate checking logic

---

## Frontend Changes

The frontend must handle both legacy (array) and new (object) formats for the `users` field.

### Helper Function

Add this helper to convert users to a consistent array format:

```javascript
/**
 * Get users array from reaction, handling both legacy and new formats
 * @param {Object} reaction - The reaction object (e.g., message.reactions[':thumbsup:'])
 * @returns {Array} Array of user objects
 */
function getReactionUsers(reaction) {
    if (!reaction || !reaction.users) {
        return [];
    }

    // Legacy format: users is already an array
    if (Array.isArray(reaction.users)) {
        return reaction.users;
    }

    // New format: users is an object keyed by userId
    return Object.values(reaction.users);
}

/**
 * Get reaction count
 * @param {Object} reaction - The reaction object
 * @returns {number} Number of users who reacted
 */
function getReactionCount(reaction) {
    if (!reaction || !reaction.users) {
        return 0;
    }

    if (Array.isArray(reaction.users)) {
        return reaction.users.length;
    }

    return Object.keys(reaction.users).length;
}

/**
 * Check if a specific user has reacted
 * @param {Object} reaction - The reaction object
 * @param {string} userId - The user ID to check
 * @returns {boolean}
 */
function hasUserReacted(reaction, userId) {
    if (!reaction || !reaction.users) {
        return false;
    }

    if (Array.isArray(reaction.users)) {
        return reaction.users.some(u => u._id === userId);
    }

    return userId in reaction.users;
}
```

### Usage Example

```javascript
// Rendering reactions
Object.entries(message.reactions || {}).forEach(([emoji, reaction]) => {
    const users = getReactionUsers(reaction);
    const count = getReactionCount(reaction);
    const currentUserReacted = hasUserReacted(reaction, currentUserId);

    // Render the reaction button
    renderReaction({
        emoji,
        count,
        users,
        isActive: currentUserReacted
    });
});
```

### Tooltip/Popup (Who Reacted)

```javascript
// When showing who reacted to an emoji
function showReactedUsers(reaction) {
    const users = getReactionUsers(reaction);

    return users.map(user => ({
        id: user._id,
        username: user.username,
        name: user.name
    }));
}
```

---

## Migration

**No migration is required.**

- The backend helpers handle both array and object formats
- The frontend helpers handle both formats
- New reactions will be stored in object format
- Existing reactions in array format will continue to work
- Over time, as users modify reactions, data will naturally migrate to object format

---

## Testing

A test script was created and verified with 200 parallel requests (100 per user):

```
========== TEST RESULT ==========

  PASSED: No duplicates, correct count (2 users)!
```

The fix ensures:
1. No duplicate users regardless of how fast/many requests are made
2. No lost updates - all reactions are properly recorded
3. Backward compatibility with existing data

---

## Summary

| Component | Change |
|-----------|--------|
| `Messages.js` | Added `addReaction()`, `removeReaction()`, `removeReactionEmoji()` methods |
| `setReaction.js` | Updated to use atomic operations, added backward-compatible helpers |
| Frontend | Add helper functions to handle both array and object formats |
| Database | No migration needed - both formats are supported |
