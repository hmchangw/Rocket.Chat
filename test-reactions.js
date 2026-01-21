const http = require('http');

const BASE_URL = 'localhost';
const PORT = 3000;

// Store auth tokens
const users = {
    jspalle: { username: 'jspalle', password: '1234', authToken: null, userId: null },
    ashwinit: { username: 'ashwinit', password: '1234', authToken: null, userId: null }
};

function makeRequest(method, path, data, headers = {}) {
    return new Promise((resolve, reject) => {
        const postData = data ? JSON.stringify(data) : '';

        const options = {
            hostname: BASE_URL,
            port: PORT,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                ...headers
            }
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(body) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });

        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

async function login(user) {
    console.log(`Logging in as ${user.username}...`);
    const result = await makeRequest('POST', '/api/v1/login', {
        user: user.username,
        password: user.password
    });

    if (result.data.status === 'success') {
        user.authToken = result.data.data.authToken;
        user.userId = result.data.data.userId;
        console.log(`  Logged in! userId: ${user.userId}`);
        return true;
    }
    console.log(`  Login failed:`, result.data);
    return false;
}

function getAuthHeaders(user) {
    return {
        'X-Auth-Token': user.authToken,
        'X-User-Id': user.userId
    };
}

async function getChannels(user) {
    const result = await makeRequest('GET', '/api/v1/channels.list', null, getAuthHeaders(user));
    return result.data.channels || [];
}

async function sendMessage(user, roomId, text) {
    const result = await makeRequest('POST', '/api/v1/chat.sendMessage', {
        message: { rid: roomId, msg: text }
    }, getAuthHeaders(user));
    return result.data.message;
}

async function getMessage(user, messageId) {
    const result = await makeRequest('GET', `/api/v1/chat.getMessage?msgId=${messageId}`, null, getAuthHeaders(user));
    return result.data.message;
}

// Use method.call/setReaction via REST endpoint (no shouldReact = toggle mode)
async function react(user, messageId, emoji) {
    return makeRequest('POST', '/api/v1/method.call/setReaction', {
        message: JSON.stringify({
            msg: 'method',
            method: 'setReaction',
            params: [emoji, messageId]
        })
    }, getAuthHeaders(user));
}

async function runTest() {
    console.log('\n========== REACTION RACE CONDITION TEST ==========\n');

    // 1. Login both users
    console.log('STEP 1: Logging in users...\n');
    await login(users.jspalle);
    await login(users.ashwinit);

    if (!users.jspalle.authToken || !users.ashwinit.authToken) {
        console.log('ERROR: Could not login users');
        return;
    }

    // 2. Get a channel
    console.log('\nSTEP 2: Finding a channel...\n');
    const channels = await getChannels(users.jspalle);
    if (channels.length === 0) {
        console.log('ERROR: No channels found. Please create a channel first.');
        return;
    }
    const channel = channels[0];
    console.log(`  Using channel: ${channel.name} (${channel._id})`);

    // 3. Send a test message
    console.log('\nSTEP 3: Sending test message...\n');
    const testMessage = await sendMessage(users.jspalle, channel._id, `Test message for reaction race condition - ${Date.now()}`);
    console.log(`  Message sent: ${testMessage._id}`);

    // 4. Simulate race condition - multiple rapid reactions from same user
    console.log('\nSTEP 4: Simulating SINGLE USER spam clicking (10 parallel requests)...\n');

    const singleUserPromises = [];
    for (let i = 0; i < 100; i++) {
        singleUserPromises.push(react(users.jspalle, testMessage._id, 'thumbsup'));
    }
    await Promise.all(singleUserPromises);
    console.log('  All 100 requests completed');

    // Check result
    let msg = await getMessage(users.jspalle, testMessage._id);
    console.log('\n  Result after single user spam:');
    console.log('  Reactions:', JSON.stringify(msg.reactions, null, 4));

    // 5. Simulate race condition - multiple users reacting simultaneously
    console.log('\nSTEP 5: Simulating MULTIPLE USERS reacting simultaneously (20 parallel requests)...\n');

    // First, send a fresh message
    const testMessage2 = await sendMessage(users.jspalle, channel._id, `Multi-user test - ${Date.now()}`);
    console.log(`  New message sent: ${testMessage2._id}`);

    const multiUserPromises = [];
    // 10 requests from jspalle
    for (let i = 0; i < 100; i++) {
        multiUserPromises.push(react(users.jspalle, testMessage2._id, 'heart'));
    }
    // 10 requests from ashwinit
    for (let i = 0; i < 100; i++) {
        multiUserPromises.push(react(users.ashwinit, testMessage2._id, 'heart'));
    }

    await Promise.all(multiUserPromises);
    console.log('  All 200 requests completed');

    // Check result
    msg = await getMessage(users.jspalle, testMessage2._id);
    console.log('\n  Result after multi-user spam:');
    console.log('  Reactions:', JSON.stringify(msg.reactions, null, 4));

    // 6. Verify results
    console.log('\n========== VERIFICATION ==========\n');

    const reactions = msg.reactions?.[':heart:'];
    if (!reactions) {
        console.log('ERROR: No reactions found!');
        return;
    }

    const usernames = reactions.usernames || [];
    const users_obj = reactions.users;

    // Check usernames for duplicates
    const uniqueUsernames = [...new Set(usernames)];
    const hasDuplicateUsernames = usernames.length !== uniqueUsernames.length;

    // Check users count
    let usersCount;
    let hasDuplicateUsers = false;
    if (Array.isArray(users_obj)) {
        usersCount = users_obj.length;
        // Check for duplicate user IDs in array
        const userIds = users_obj.map(u => u._id);
        const uniqueUserIds = [...new Set(userIds)];
        hasDuplicateUsers = usersCount !== uniqueUserIds.length;
        console.log(`  Users format: ARRAY (legacy)`);
        console.log(`  Users count: ${usersCount}`);
        console.log(`  Unique user IDs: ${uniqueUserIds.length}`);
        console.log(`  Has duplicate users: ${hasDuplicateUsers}`);
    } else if (users_obj && typeof users_obj === 'object') {
        usersCount = Object.keys(users_obj).length;
        console.log(`  Users format: OBJECT (new)`);
        console.log(`  Users count: ${usersCount}`);
        console.log(`  (Object keys are unique by definition - no duplicates possible)`);
    }

    console.log(`\n  Usernames: ${JSON.stringify(usernames)}`);
    console.log(`  Usernames count: ${usernames.length}`);
    console.log(`  Unique usernames: ${uniqueUsernames.length}`);
    console.log(`  Has duplicate usernames: ${hasDuplicateUsernames}`);

    console.log('\n========== TEST RESULT ==========\n');

    if (hasDuplicateUsernames || hasDuplicateUsers) {
        console.log('  FAILED: Duplicates found!');
        if (hasDuplicateUsernames) console.log('    - Duplicate usernames');
        if (hasDuplicateUsers) console.log('    - Duplicate users');
    } else if (usernames.length !== 2) {
        console.log(`  WARNING: Expected 2 usernames (jspalle, ashwinit), got ${usernames.length}`);
        console.log(`  Usernames: ${usernames.join(', ')}`);
    } else {
        console.log('  PASSED: No duplicates, correct count (2 users)!');
    }

    console.log('\n');
}

runTest().catch(console.error);
