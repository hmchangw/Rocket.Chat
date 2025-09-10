#!/usr/bin/env node
/**
 * Integration Test Suite
 * 
 * Comprehensive end-to-end testing of the entire external DbWatcher system
 * including Rocket.Chat integration, client notifications, and real-time updates.
 */

const { MongoClient } = require('mongodb');
const { connect, StringCodec } = require('nats');
const WebSocket = require('ws');
const axios = require('axios');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class IntegrationTestSuite {
    constructor() {
        this.mongoUri = process.env.MONGO_URL || 'mongodb://localhost:27018/meteor';
        this.natsUrl = 'nats://localhost:4222';
        this.websocketUrl = 'ws://localhost:8083/ws';
        
        this.mongoClient = null;
        this.natsConnection = null;
        this.websocket = null;
        this.sc = StringCodec();
        
        this.testResults = [];
        this.notifications = [];
        this.clientEvents = [];
        this.performanceMetrics = {};
        this.startTime = Date.now();
        
        this.services = {
            dbwatcher: 'http://localhost:8082',
            aggregator: 'http://localhost:8084',
            nats: 'http://localhost:8222',
            monitoring: 'http://localhost:8090'
        };
    }

    async setup() {
        console.log('🔧 Setting up Integration Test Environment...\n');

        // Environment setup
        process.env.USE_EXTERNAL_DBWATCHER = 'true';
        process.env.EXTERNAL_WATCHER_NATS_URL = this.natsUrl;
        process.env.EXTERNAL_WATCHER_WS_URL = this.websocketUrl;

        // Connect to services
        try {
            this.mongoClient = new MongoClient(this.mongoUri);
            await this.mongoClient.connect();
            console.log('✅ MongoDB connected');

            this.natsConnection = await connect({ servers: [this.natsUrl] });
            console.log('✅ NATS connected');

        } catch (error) {
            console.error('❌ Service connection failed:', error.message);
            process.exit(1);
        }
    }

    async testServiceHealth() {
        console.log('🏥 Testing Service Health & Readiness...\n');

        const healthChecks = [
            { name: 'DbWatcher', url: `${this.services.dbwatcher}/health`, expectedFields: ['events_published', 'mongodb_connected'] },
            { name: 'Aggregator', url: `${this.services.aggregator}/health`, expectedFields: ['events_processed', 'websocket_clients'] },
            { name: 'NATS', url: `${this.services.nats}/connz`, expectedFields: ['num_connections'] },
            { name: 'Monitoring', url: `${this.services.monitoring}`, expectedStatus: 200 }
        ];

        let allHealthy = true;

        for (const check of healthChecks) {
            try {
                const response = await axios.get(check.url, { timeout: 5000 });
                
                if (response.status === 200) {
                    const data = response.data;
                    
                    // Validate expected fields
                    if (check.expectedFields) {
                        const missingFields = check.expectedFields.filter(field => !(field in data));
                        if (missingFields.length > 0) {
                            console.log(`   ⚠️  ${check.name}: Missing fields - ${missingFields.join(', ')}`);
                            this.addTestResult(`${check.name} Health Check`, false, `Missing fields: ${missingFields.join(', ')}`);
                            allHealthy = false;
                            continue;
                        }
                    }
                    
                    console.log(`   ✅ ${check.name}: Healthy`);
                    this.addTestResult(`${check.name} Health Check`, true, 'Service healthy');
                } else {
                    console.log(`   ❌ ${check.name}: HTTP ${response.status}`);
                    this.addTestResult(`${check.name} Health Check`, false, `HTTP ${response.status}`);
                    allHealthy = false;
                }
            } catch (error) {
                console.log(`   ❌ ${check.name}: ${error.message}`);
                this.addTestResult(`${check.name} Health Check`, false, error.message);
                allHealthy = false;
            }
        }

        if (allHealthy) {
            console.log('\n✅ All services are healthy and ready for integration testing');
        } else {
            console.log('\n❌ Some services are not healthy - tests may fail');
        }

        return allHealthy;
    }

    async testRealTimeEventFlow() {
        console.log('\n🔄 Testing Real-Time Event Flow...\n');

        const testId = `integration_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Setup event listeners
        await this.setupEventListeners(testId);

        // Test scenario: User sends message in room
        const testScenario = {
            userId: `user_${testId}`,
            roomId: `room_${testId}`,
            messageText: `Integration test message - ${testId}`
        };

        console.log('   📝 Test Scenario:');
        console.log(`      User: ${testScenario.userId}`);
        console.log(`      Room: ${testScenario.roomId}`);
        console.log(`      Message: ${testScenario.messageText}`);

        try {
            const db = this.mongoClient.db();
            
            // Step 1: Create user
            console.log('\n   1️⃣  Creating test user...');
            const usersCollection = db.collection('users');
            await usersCollection.insertOne({
                _id: testScenario.userId,
                username: `testuser_${testId.substr(-8)}`,
                name: `Test User ${testId.substr(-8)}`,
                status: 'online',
                createdAt: new Date(),
                _updatedAt: new Date(),
                integrationTest: testId
            });
            console.log('      ✅ User created');

            // Step 2: Create room
            console.log('   2️⃣  Creating test room...');
            const roomsCollection = db.collection('rooms');
            await roomsCollection.insertOne({
                _id: testScenario.roomId,
                name: `test-room-${testId.substr(-8)}`,
                t: 'c', // channel
                u: { _id: testScenario.userId, username: `testuser_${testId.substr(-8)}` },
                ts: new Date(),
                msgs: 0,
                _updatedAt: new Date(),
                integrationTest: testId
            });
            console.log('      ✅ Room created');

            // Step 3: Create subscription
            console.log('   3️⃣  Creating subscription...');
            const subscriptionsCollection = db.collection('subscriptions');
            await subscriptionsCollection.insertOne({
                rid: testScenario.roomId,
                u: { _id: testScenario.userId, username: `testuser_${testId.substr(-8)}` },
                name: `test-room-${testId.substr(-8)}`,
                t: 'c',
                ts: new Date(),
                open: true,
                alert: false,
                unread: 0,
                _updatedAt: new Date(),
                integrationTest: testId
            });
            console.log('      ✅ Subscription created');

            // Step 4: Send message
            console.log('   4️⃣  Sending test message...');
            const messagesCollection = db.collection('messages');
            const messageResult = await messagesCollection.insertOne({
                msg: testScenario.messageText,
                ts: new Date(),
                u: { _id: testScenario.userId, username: `testuser_${testId.substr(-8)}` },
                rid: testScenario.roomId,
                _updatedAt: new Date(),
                integrationTest: testId
            });
            console.log('      ✅ Message sent');

            // Step 5: Update subscription (new message)
            console.log('   5️⃣  Updating subscription with new message...');
            await subscriptionsCollection.updateOne(
                { rid: testScenario.roomId },
                { 
                    $set: { 
                        ls: new Date(),
                        lm: messageResult.insertedId,
                        _updatedAt: new Date()
                    },
                    $inc: { unread: 1 }
                }
            );
            console.log('      ✅ Subscription updated');

            // Wait for event processing
            console.log('   ⏳ Waiting for event processing (15 seconds)...');
            await new Promise(resolve => setTimeout(resolve, 15000));

            // Analyze results
            this.analyzeEventFlow(testId);

        } catch (error) {
            console.error('   ❌ Event flow test failed:', error.message);
            this.addTestResult('Real-Time Event Flow', false, error.message);
        }
    }

    async setupEventListeners(testId) {
        console.log('   🎧 Setting up event listeners...');

        // NATS listener for raw events
        const rawEventsSub = this.natsConnection.subscribe('rocketchat.events.changedata');
        (async () => {
            try {
                for await (const msg of rawEventsSub) {
                    const event = JSON.parse(this.sc.decode(msg.data));
                    if (event.data && event.data.integrationTest === testId) {
                        console.log(`      📡 Raw event: ${event.collection} ${event.action}`);
                        this.clientEvents.push({ ...event, type: 'raw', receivedAt: Date.now() });
                        break; // Exit after receiving our test event
                    }
                }
            } catch (err) {
                console.log('      ❌ Raw events subscription error:', err.message);
            }
        })();

        // NATS listener for aggregated events
        const aggEventsSub = this.natsConnection.subscribe('rocketchat.events.aggregated');
        (async () => {
            try {
                for await (const msg of aggEventsSub) {
                    const event = JSON.parse(this.sc.decode(msg.data));
                    if (event.data && event.data.integrationTest === testId) {
                        console.log(`      🔄 Aggregated event: ${event.collection} ${event.action} (enriched: ${event.enriched})`);
                        this.clientEvents.push({ ...event, type: 'aggregated', receivedAt: Date.now() });
                        break; // Exit after receiving our test event
                    }
                }
            } catch (err) {
                console.log('      ❌ Aggregated events subscription error:', err.message);
            }
        })();

        // WebSocket listener
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.close();
        }

        this.websocket = new WebSocket(this.websocketUrl);
        
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);
            
            this.websocket.on('open', () => {
                console.log('      🔌 WebSocket connected');
                clearTimeout(timeout);
                resolve();
            });

            this.websocket.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
        });

        this.websocket.on('message', (data) => {
            try {
                const event = JSON.parse(data.toString());
                if (event.data && event.data.integrationTest === testId) {
                    console.log(`      📨 WebSocket event: ${event.collection} ${event.action}`);
                    this.clientEvents.push({ ...event, type: 'websocket', receivedAt: Date.now() });
                    
                    // Simulate client notification
                    this.notifications.push({
                        type: 'message',
                        userId: event.data.u?._id,
                        roomId: event.data.rid,
                        timestamp: Date.now(),
                        source: 'websocket'
                    });
                }
            } catch (error) {
                // Ignore parsing errors
            }
        });

        console.log('      ✅ All event listeners configured');
    }

    analyzeEventFlow(testId) {
        console.log('\n   📊 Analyzing Event Flow Results...');

        const rawEvents = this.clientEvents.filter(e => e.type === 'raw' && e.data?.integrationTest === testId);
        const aggregatedEvents = this.clientEvents.filter(e => e.type === 'aggregated' && e.data?.integrationTest === testId);
        const websocketEvents = this.clientEvents.filter(e => e.type === 'websocket' && e.data?.integrationTest === testId);
        const notifications = this.notifications.filter(n => n.timestamp > this.startTime);

        console.log(`      📋 Raw Events: ${rawEvents.length}`);
        console.log(`      🔄 Aggregated Events: ${aggregatedEvents.length}`);
        console.log(`      📨 WebSocket Events: ${websocketEvents.length}`);
        console.log(`      🔔 Notifications: ${notifications.length}`);

        // Expected events: user creation, room creation, subscription creation, message, subscription update
        const expectedEventCount = 5;
        const totalEventsReceived = rawEvents.length + aggregatedEvents.length + websocketEvents.length;

        if (totalEventsReceived >= expectedEventCount) {
            console.log('      ✅ Event flow working correctly');
            this.addTestResult('Real-Time Event Flow', true, 
                `${totalEventsReceived} events processed, ${notifications.length} notifications`);
        } else {
            console.log(`      ⚠️  Lower than expected event count (got ${totalEventsReceived}, expected ~${expectedEventCount})`);
            this.addTestResult('Real-Time Event Flow', false, 
                `Only ${totalEventsReceived} events received (expected ~${expectedEventCount})`);
        }

        // Performance metrics
        if (rawEvents.length > 0 && aggregatedEvents.length > 0) {
            const processingDelay = aggregatedEvents[0].receivedAt - rawEvents[0].receivedAt;
            console.log(`      ⚡ Processing Delay: ${processingDelay}ms`);
            this.performanceMetrics.processingDelay = processingDelay;
        }
    }

    async testClientNotificationSystem() {
        console.log('\n🔔 Testing Client Notification System...\n');

        // This would typically test the HorizontalBroadcast service
        // For now, we'll verify WebSocket-based notifications
        
        const notificationTestId = `notify_${Date.now()}`;
        
        try {
            const db = this.mongoClient.db();
            
            // Create a message that should trigger notifications
            console.log('   📢 Creating notification-triggering message...');
            const messagesCollection = db.collection('messages');
            
            const messageData = {
                msg: `@testuser Notification test message - ${notificationTestId}`,
                ts: new Date(),
                u: { _id: 'notif_sender', username: 'notif_sender' },
                rid: 'notification_test_room',
                mentions: [{ _id: 'testuser', username: 'testuser' }],
                _updatedAt: new Date(),
                notificationTest: notificationTestId
            };
            
            await messagesCollection.insertOne(messageData);
            console.log('   ✅ Notification message created');

            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Check for WebSocket events that could trigger notifications
            const notificationEvents = this.clientEvents.filter(e => 
                e.data && e.data.notificationTest === notificationTestId
            );

            if (notificationEvents.length > 0) {
                console.log(`   ✅ Notification system: ${notificationEvents.length} events processed`);
                this.addTestResult('Client Notification System', true, 
                    `${notificationEvents.length} notification events`);
            } else {
                console.log('   ⚠️  No notification events detected');
                this.addTestResult('Client Notification System', false, 'No notification events detected');
            }

            // Clean up
            await messagesCollection.deleteOne({ notificationTest: notificationTestId });

        } catch (error) {
            console.error('   ❌ Notification test failed:', error.message);
            this.addTestResult('Client Notification System', false, error.message);
        }
    }

    async testPerformanceUnderLoad() {
        console.log('\n🚀 Testing Performance Under Load...\n');

        const loadTestId = `perf_${Date.now()}`;
        const messagesPerBatch = 100;
        const numberOfBatches = 10;
        const totalMessages = messagesPerBatch * numberOfBatches;

        console.log(`   🎯 Load Test Parameters:`);
        console.log(`      Messages per batch: ${messagesPerBatch}`);
        console.log(`      Number of batches: ${numberOfBatches}`);
        console.log(`      Total messages: ${totalMessages}`);

        const loadTestStart = Date.now();
        const eventCountBefore = this.clientEvents.length;

        try {
            const db = this.mongoClient.db();
            const messagesCollection = db.collection('messages');

            console.log('\n   📊 Executing load test...');

            for (let batch = 0; batch < numberOfBatches; batch++) {
                const batchStart = Date.now();
                const messages = [];

                for (let i = 0; i < messagesPerBatch; i++) {
                    messages.push({
                        msg: `Load test message ${batch}-${i} - ${loadTestId}`,
                        ts: new Date(),
                        u: { _id: `perf_user_${i % 10}`, username: `perfuser${i % 10}` },
                        rid: `perf_room_${i % 5}`,
                        _updatedAt: new Date(),
                        performanceTest: loadTestId,
                        batchId: batch
                    });
                }

                const result = await messagesCollection.insertMany(messages);
                const batchDuration = Date.now() - batchStart;
                
                console.log(`   ✅ Batch ${batch + 1}/${numberOfBatches}: ${result.insertedCount} messages in ${batchDuration}ms`);
                
                // Small delay to allow event processing
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            const insertionDuration = Date.now() - loadTestStart;
            console.log(`\n   📈 Insertion Performance:`);
            console.log(`      Total time: ${insertionDuration}ms`);
            console.log(`      Messages/second: ${Math.round((totalMessages / insertionDuration) * 1000)}`);

            // Wait for event processing
            console.log('\n   ⏳ Waiting for event processing (20 seconds)...');
            await new Promise(resolve => setTimeout(resolve, 20000));

            const totalTestDuration = Date.now() - loadTestStart;
            const eventCountAfter = this.clientEvents.length;
            const eventsProcessed = eventCountAfter - eventCountBefore;

            console.log(`   📊 Event Processing Performance:`);
            console.log(`      Events processed: ${eventsProcessed}`);
            console.log(`      Processing rate: ${Math.round((eventsProcessed / totalTestDuration) * 1000)} events/second`);
            console.log(`      Event coverage: ${Math.round((eventsProcessed / totalMessages) * 100)}%`);

            // Store performance metrics
            this.performanceMetrics.loadTest = {
                totalMessages,
                insertionDuration,
                eventsProcessed,
                totalDuration: totalTestDuration,
                messagesPerSecond: Math.round((totalMessages / insertionDuration) * 1000),
                eventsPerSecond: Math.round((eventsProcessed / totalTestDuration) * 1000),
                eventCoverage: Math.round((eventsProcessed / totalMessages) * 100)
            };

            if (eventsProcessed >= totalMessages * 0.8) { // 80% coverage threshold
                this.addTestResult('Performance Under Load', true, 
                    `${eventsProcessed}/${totalMessages} events processed (${Math.round((eventsProcessed / totalMessages) * 100)}%)`);
            } else {
                this.addTestResult('Performance Under Load', false, 
                    `Low event coverage: ${Math.round((eventsProcessed / totalMessages) * 100)}%`);
            }

            // Clean up
            console.log('\n   🧹 Cleaning up load test data...');
            const cleanupResult = await messagesCollection.deleteMany({ performanceTest: loadTestId });
            console.log(`   ✅ Cleaned up ${cleanupResult.deletedCount} messages`);

        } catch (error) {
            console.error('   ❌ Performance test failed:', error.message);
            this.addTestResult('Performance Under Load', false, error.message);
        }
    }

    async testFailoverAndRecovery() {
        console.log('\n🛡️  Testing Failover & Recovery Scenarios...\n');

        // Test scenario: Simulate temporary NATS disconnection
        console.log('   🔌 Testing NATS reconnection resilience...');
        
        try {
            // Close NATS connection temporarily
            if (this.natsConnection) {
                await this.natsConnection.close();
                console.log('   ❌ NATS connection closed (simulating failure)');
            }

            // Wait a bit
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Reconnect
            this.natsConnection = await connect({ servers: [this.natsUrl] });
            console.log('   ✅ NATS connection restored');

            // Test that services can still communicate
            const testSubject = 'failover.test';
            const sub = this.natsConnection.subscribe(testSubject, { max: 1 });
            this.natsConnection.publish(testSubject, this.sc.encode(JSON.stringify({ test: 'recovery' })));
            
            const msgIterator = sub[Symbol.asyncIterator]();
            const msgResult = await msgIterator.next();
            const data = JSON.parse(this.sc.decode(msgResult.value.data));
            
            if (data.test === 'recovery') {
                console.log('   ✅ NATS communication restored successfully');
                this.addTestResult('NATS Failover Recovery', true, 'Connection and communication restored');
            } else {
                this.addTestResult('NATS Failover Recovery', false, 'Communication test failed');
            }

        } catch (error) {
            console.error('   ❌ Failover test failed:', error.message);
            this.addTestResult('NATS Failover Recovery', false, error.message);
        }
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up integration test environment...\n');

        try {
            // Close WebSocket
            if (this.websocket) {
                this.websocket.close();
                console.log('   ✅ WebSocket closed');
            }

            // Close NATS
            if (this.natsConnection) {
                await this.natsConnection.close();
                console.log('   ✅ NATS connection closed');
            }

            // Clean up test data
            if (this.mongoClient) {
                const db = this.mongoClient.db();
                
                const cleanupResults = await Promise.allSettled([
                    db.collection('messages').deleteMany({ integrationTest: { $exists: true } }),
                    db.collection('users').deleteMany({ integrationTest: { $exists: true } }),
                    db.collection('rooms').deleteMany({ integrationTest: { $exists: true } }),
                    db.collection('subscriptions').deleteMany({ integrationTest: { $exists: true } }),
                    db.collection('messages').deleteMany({ notificationTest: { $exists: true } }),
                    db.collection('messages').deleteMany({ performanceTest: { $exists: true } })
                ]);

                let totalDeleted = 0;
                cleanupResults.forEach(result => {
                    if (result.status === 'fulfilled') {
                        totalDeleted += result.value.deletedCount || 0;
                    }
                });

                console.log(`   🗑️  Cleaned up ${totalDeleted} test documents`);
                
                await this.mongoClient.close();
                console.log('   ✅ MongoDB connection closed');
            }

            this.addTestResult('Cleanup', true, 'All resources cleaned up successfully');

        } catch (error) {
            console.error('   ❌ Cleanup failed:', error.message);
            this.addTestResult('Cleanup', false, error.message);
        }
    }

    addTestResult(testName, success, details = '') {
        this.testResults.push({
            testName,
            success,
            details,
            timestamp: Date.now()
        });
    }

    generateIntegrationReport() {
        console.log('\n' + '='.repeat(70));
        console.log('📊 INTEGRATION TEST REPORT');
        console.log('='.repeat(70));

        const totalTests = this.testResults.length;
        const successfulTests = this.testResults.filter(r => r.success).length;
        const failedTests = totalTests - successfulTests;
        const testDuration = Date.now() - this.startTime;

        console.log(`\nTest Summary:`);
        console.log(`  📋 Total Tests: ${totalTests}`);
        console.log(`  ✅ Successful: ${successfulTests}`);
        console.log(`  ❌ Failed: ${failedTests}`);
        console.log(`  ⏱️  Duration: ${Math.round(testDuration / 1000)}s`);
        console.log(`  📈 Success Rate: ${Math.round((successfulTests / totalTests) * 100)}%`);
        console.log(`  📨 Total Events: ${this.clientEvents.length}`);
        console.log(`  🔔 Notifications: ${this.notifications.length}`);

        console.log('\nDetailed Results:');
        this.testResults.forEach((result, index) => {
            const status = result.success ? '✅' : '❌';
            console.log(`  ${index + 1}. ${status} ${result.testName}`);
            if (result.details) {
                console.log(`     📝 ${result.details}`);
            }
        });

        if (Object.keys(this.performanceMetrics).length > 0) {
            console.log('\nPerformance Metrics:');
            
            if (this.performanceMetrics.processingDelay) {
                console.log(`  ⚡ Event Processing Delay: ${this.performanceMetrics.processingDelay}ms`);
            }
            
            if (this.performanceMetrics.loadTest) {
                const lt = this.performanceMetrics.loadTest;
                console.log(`  🚀 Load Test Results:`);
                console.log(`     📊 Messages/second: ${lt.messagesPerSecond}`);
                console.log(`     ⚡ Events/second: ${lt.eventsPerSecond}`);
                console.log(`     🎯 Event Coverage: ${lt.eventCoverage}%`);
            }
        }

        console.log('\nEvent Flow Analysis:');
        const eventTypes = {};
        this.clientEvents.forEach(event => {
            const key = `${event.collection}-${event.action}`;
            eventTypes[key] = (eventTypes[key] || 0) + 1;
        });

        Object.entries(eventTypes).forEach(([type, count]) => {
            console.log(`  📋 ${type}: ${count} events`);
        });

        if (failedTests === 0) {
            console.log('\n🎉 ALL INTEGRATION TESTS PASSED!');
            console.log('   The external DbWatcher system is fully functional and ready for production.');
        } else {
            console.log(`\n⚠️  ${failedTests} test(s) failed.`);
            console.log('   Review the issues above before deploying to production.');
        }

        console.log('\n' + '='.repeat(70));

        // Save detailed report
        const reportPath = path.join(__dirname, `integration-test-report-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify({
            summary: {
                totalTests,
                successfulTests,
                failedTests,
                successRate: Math.round((successfulTests / totalTests) * 100),
                duration: testDuration,
                eventsReceived: this.clientEvents.length,
                notifications: this.notifications.length,
                timestamp: new Date().toISOString()
            },
            results: this.testResults,
            events: this.clientEvents,
            notifications: this.notifications,
            performanceMetrics: this.performanceMetrics,
            environment: {
                nodeVersion: process.version,
                mongoUri: this.mongoUri.replace(/\/\/.*@/, '//***@'),
                natsUrl: this.natsUrl,
                websocketUrl: this.websocketUrl
            }
        }, null, 2));

        console.log(`📄 Detailed report saved to: ${reportPath}`);
    }

    async run() {
        console.log('🔬 ROCKET.CHAT INTEGRATION TEST SUITE');
        console.log('Comprehensive end-to-end testing of external DbWatcher system\n');

        try {
            await this.setup();
            
            const servicesHealthy = await this.testServiceHealth();
            if (!servicesHealthy) {
                console.log('\n⚠️  Some services are not healthy. Continuing with tests...\n');
            }

            await this.testRealTimeEventFlow();
            await this.testClientNotificationSystem();
            await this.testPerformanceUnderLoad();
            await this.testFailoverAndRecovery();
            
        } catch (error) {
            console.error('❌ Integration test execution failed:', error);
            this.addTestResult('Test Execution', false, error.message);
        } finally {
            await this.cleanup();
            this.generateIntegrationReport();
        }
    }
}

// Run the test if this file is executed directly
if (require.main === module) {
    const suite = new IntegrationTestSuite();
    suite.run().catch(console.error);
}

module.exports = IntegrationTestSuite;