#!/usr/bin/env node
/**
 * Comprehensive CRUD Operations Test Suite
 * Tests insert, update, delete operations across different DbWatcher and Aggregator configurations
 */

const { MongoClient } = require('mongodb');
const { connect, StringCodec } = require('nats');
const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');

class CRUDOperationsTest {
    constructor() {
        this.mongoUri = process.env.MONGO_URL || 'mongodb://localhost:27018/meteor?directConnection=true';
        this.natsUrl = process.env.EXTERNAL_WATCHER_NATS_URL || 'nats://localhost:4222';
        this.websocketUrl = process.env.EXTERNAL_WATCHER_WS_URL || 'ws://localhost:8083/ws';
        this.dbwatcherHealthUrl = 'http://localhost:8082/health';
        this.aggregatorHealthUrl = 'http://localhost:8084/health';
        
        this.mongoClient = null;
        this.natsConnection = null;
        this.websockets = [];
        this.sc = StringCodec();
        this.testResults = [];
        this.startTime = Date.now();
        
        // Event tracking
        this.capturedEvents = {
            raw: [],
            aggregated: [],
            websocket: []
        };
        
        // Test configurations
        this.testConfigurations = [
            {
                name: 'Messages - Basic Fields Only',
                collection: 'messages',
                operations: ['insert', 'update', 'delete'],
                expectedFields: ['_id', 'msg', 'ts', 'u', 'rid', '_updatedAt']
            },
            {
                name: 'Subscriptions - Full Document',
                collection: 'subscriptions', 
                operations: ['insert', 'update', 'delete'],
                expectedFields: ['_id', 'rid', 'u', 'name', 't', 'ts', 'ls', 'unread']
            },
            {
                name: 'Users - Cached Names',
                collection: 'users',
                operations: ['insert', 'update', 'delete'],
                expectedFields: ['_id', 'username', 'name', 'status', 'statusConnection']
            },
            {
                name: 'Rooms - Metadata Caching',
                collection: 'rooms',
                operations: ['insert', 'update', 'delete'],
                expectedFields: ['_id', 'name', 't', 'u', 'msgs', 'ts']
            },
            {
                name: 'Settings - Pass-through Mode',
                collection: 'settings',
                operations: ['insert', 'update', 'delete'],
                expectedFields: []
            }
        ];
    }

    async setup() {
        console.log('🔧 Setting up CRUD Operations Test Suite...\n');
        
        // Connect to MongoDB
        this.mongoClient = new MongoClient(this.mongoUri);
        await this.mongoClient.connect();
        console.log('✅ Connected to MongoDB');
        
        // Connect to NATS
        this.natsConnection = await connect({ servers: [this.natsUrl] });
        console.log('✅ Connected to NATS');
        
        // Setup event listeners
        await this.setupEventListeners();
        
        // Verify services are healthy
        await this.verifyServiceHealth();
        
        console.log('✅ Test suite setup completed\n');
    }

    async setupEventListeners() {
        console.log('🎧 Setting up event listeners...');
        
        // Raw events from DbWatcher
        const rawEventsSub = this.natsConnection.subscribe('rocketchat.events.changedata');
        (async () => {
            try {
                for await (const msg of rawEventsSub) {
                    const event = JSON.parse(this.sc.decode(msg.data));
                    if (event.testCRUDOperation) {
                        this.capturedEvents.raw.push({
                            ...event,
                            receivedAt: Date.now(),
                            source: 'nats-raw'
                        });
                        console.log(`      📡 Raw NATS: ${event.collection} ${event.action} (id: ${event.id})`);
                    }
                }
            } catch (err) {
                console.log('      ❌ Raw events subscription error:', err.message);
            }
        })();
        
        // Aggregated events from Aggregator
        const aggEventsSub = this.natsConnection.subscribe('rocketchat.events.aggregated');
        (async () => {
            try {
                for await (const msg of aggEventsSub) {
                    const event = JSON.parse(this.sc.decode(msg.data));
                    if (event.testCRUDOperation) {
                        this.capturedEvents.aggregated.push({
                            ...event,
                            receivedAt: Date.now(),
                            source: 'nats-aggregated'
                        });
                        console.log(`      🔄 Aggregated NATS: ${event.collection} ${event.action} (enriched: ${event.enriched})`);
                    }
                }
            } catch (err) {
                console.log('      ❌ Aggregated events subscription error:', err.message);
            }
        })();
        
        console.log('✅ Event listeners configured');
    }

    async verifyServiceHealth() {
        console.log('🏥 Verifying service health...');
        
        const dbwatcherHealth = await axios.get(this.dbwatcherHealthUrl);
        const aggregatorHealth = await axios.get(this.aggregatorHealthUrl);
        
        console.log(`   DbWatcher: ${dbwatcherHealth.data.status} (events: ${dbwatcherHealth.data.events_published})`);
        console.log(`   Aggregator: ${aggregatorHealth.data.status} (events: ${aggregatorHealth.data.events_processed})`);
        
        if (dbwatcherHealth.data.status !== 'healthy' || aggregatorHealth.data.status !== 'healthy') {
            throw new Error('Services not healthy - cannot proceed with tests');
        }
    }

    async runCRUDTests() {
        console.log('🧪 Starting CRUD Operations Test Suite\n');
        console.log('=' .repeat(80));
        
        for (const config of this.testConfigurations) {
            console.log(`\n📋 Testing Configuration: ${config.name}`);
            console.log('-'.repeat(60));
            
            await this.testConfigurationCRUD(config);
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('🏁 CRUD Operations Test Suite Completed\n');
    }

    async testConfigurationCRUD(config) {
        const testId = `crud_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const collection = this.mongoClient.db().collection(config.collection);
        
        // Clear captured events for this test
        this.capturedEvents.raw = [];
        this.capturedEvents.aggregated = [];
        this.capturedEvents.websocket = [];
        
        const testDoc = this.generateTestDocument(config.collection, testId);
        const startTime = Date.now();
        
        console.log(`   🎯 Test ID: ${testId}`);
        console.log(`   📊 Collection: ${config.collection}`);
        console.log(`   🔧 Operations: ${config.operations.join(', ')}`);
        
        try {
            // INSERT Operation
            if (config.operations.includes('insert')) {
                console.log(`\n   1️⃣  INSERT Operation:`);
                console.log(`      📝 Inserting document...`);
                
                await collection.insertOne(testDoc);
                console.log(`      ✅ Document inserted`);
                
                await this.waitForEvents(2000); // Wait 2 seconds for processing
                this.analyzeEvents('INSERT', config, testId);
            }
            
            // UPDATE Operation
            if (config.operations.includes('update')) {
                console.log(`\n   2️⃣  UPDATE Operation:`);
                console.log(`      📝 Updating document...`);
                
                const updateData = this.generateUpdateData(config.collection);
                await collection.updateOne(
                    { _id: testDoc._id },
                    { $set: updateData }
                );
                console.log(`      ✅ Document updated`);
                
                await this.waitForEvents(2000);
                this.analyzeEvents('UPDATE', config, testId);
            }
            
            // DELETE Operation  
            if (config.operations.includes('delete')) {
                console.log(`\n   3️⃣  DELETE Operation:`);
                console.log(`      📝 Deleting document...`);
                
                await collection.deleteOne({ _id: testDoc._id });
                console.log(`      ✅ Document deleted`);
                
                await this.waitForEvents(2000);
                this.analyzeEvents('DELETE', config, testId);
            }
            
            const duration = Date.now() - startTime;
            this.addTestResult(config.name, true, `All operations completed in ${duration}ms`);
            
        } catch (error) {
            console.log(`      ❌ Test failed: ${error.message}`);
            this.addTestResult(config.name, false, error.message);
        }
        
        // Clean up any remaining test data
        await this.cleanupTestData(collection, testId);
    }

    generateTestDocument(collection, testId) {
        const baseDoc = {
            _id: testId,
            testCRUDOperation: true,
            createdAt: new Date(),
            testCollection: collection
        };
        
        switch (collection) {
            case 'messages':
                return {
                    ...baseDoc,
                    msg: `Test message for CRUD operations - ${testId}`,
                    ts: new Date(),
                    u: { _id: 'test-user-crud', username: 'testuser' },
                    rid: 'test-room-crud',
                    _updatedAt: new Date()
                };
                
            case 'subscriptions':
                return {
                    ...baseDoc,
                    rid: 'test-room-crud',
                    u: { _id: 'test-user-crud' },
                    name: 'Test Room',
                    t: 'c',
                    ts: new Date(),
                    ls: new Date(),
                    unread: 0,
                    alert: false,
                    open: true
                };
                
            case 'users':
                return {
                    ...baseDoc,
                    username: `testuser_${testId.slice(-8)}`,
                    name: 'Test User CRUD',
                    status: 'online',
                    statusConnection: 'online',
                    active: true
                };
                
            case 'rooms':
                return {
                    ...baseDoc,
                    name: `test-room-${testId.slice(-8)}`,
                    t: 'c',
                    u: { _id: 'test-user-crud', username: 'testuser' },
                    msgs: 0,
                    ts: new Date(),
                    _updatedAt: new Date()
                };
                
            case 'settings':
                return {
                    ...baseDoc,
                    _id: `test-setting-${testId.slice(-8)}`,
                    value: 'test-value',
                    type: 'string',
                    public: false
                };
                
            default:
                return baseDoc;
        }
    }

    generateUpdateData(collection) {
        switch (collection) {
            case 'messages':
                return {
                    msg: 'Updated test message',
                    _updatedAt: new Date(),
                    edited: true
                };
                
            case 'subscriptions':
                return {
                    unread: 5,
                    alert: true,
                    ls: new Date()
                };
                
            case 'users':
                return {
                    status: 'away',
                    statusConnection: 'away',
                    lastLogin: new Date()
                };
                
            case 'rooms':
                return {
                    msgs: 10,
                    _updatedAt: new Date(),
                    description: 'Updated test room'
                };
                
            case 'settings':
                return {
                    value: 'updated-test-value',
                    updatedAt: new Date()
                };
                
            default:
                return { updatedAt: new Date() };
        }
    }

    async waitForEvents(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    analyzeEvents(operation, config, testId) {
        const rawEvents = this.capturedEvents.raw.filter(e => e._id === testId || e.id === testId);
        const aggEvents = this.capturedEvents.aggregated.filter(e => e._id === testId || e.id === testId);
        
        console.log(`      📊 Event Analysis for ${operation}:`);
        console.log(`         Raw Events: ${rawEvents.length}`);
        console.log(`         Aggregated Events: ${aggEvents.length}`);
        
        if (rawEvents.length > 0) {
            const latestRaw = rawEvents[rawEvents.length - 1];
            console.log(`         Raw Event: ${latestRaw.action} (${latestRaw.operationType})`);
            
            if (latestRaw.data) {
                const fieldCount = Object.keys(latestRaw.data).length;
                console.log(`         Raw Data Fields: ${fieldCount}`);
            }
            
            if (latestRaw.diff) {
                const diffCount = Object.keys(latestRaw.diff).length;
                console.log(`         Diff Fields: ${diffCount}`);
            }
        }
        
        if (aggEvents.length > 0) {
            const latestAgg = aggEvents[aggEvents.length - 1];
            console.log(`         Aggregated: enriched=${latestAgg.enriched}`);
            
            if (latestAgg.data) {
                const fieldCount = Object.keys(latestAgg.data).length;
                console.log(`         Aggregated Data Fields: ${fieldCount}`);
            }
        }
        
        // Validate expected behavior based on configuration
        this.validateEventBehavior(operation, config, rawEvents, aggEvents);
    }

    validateEventBehavior(operation, config, rawEvents, aggEvents) {
        const issues = [];
        
        // Check if we received any events
        if (rawEvents.length === 0) {
            issues.push(`No raw events received for ${operation}`);
        }
        
        // Check operation type mapping
        if (rawEvents.length > 0) {
            const rawEvent = rawEvents[rawEvents.length - 1];
            const expectedAction = this.getExpectedAction(operation);
            
            if (rawEvent.action !== expectedAction) {
                issues.push(`Expected action '${expectedAction}', got '${rawEvent.action}'`);
            }
        }
        
        // Check aggregation behavior based on collection config
        const shouldAggregate = this.shouldCollectionAggregate(config.collection);
        
        if (shouldAggregate && aggEvents.length === 0) {
            issues.push(`Expected aggregated events but none received`);
        }
        
        if (issues.length > 0) {
            console.log(`         ⚠️  Issues: ${issues.join(', ')}`);
        } else {
            console.log(`         ✅ Event behavior as expected`);
        }
    }

    getExpectedAction(operation) {
        switch (operation) {
            case 'INSERT': return 'insert';
            case 'UPDATE': return 'update';
            case 'DELETE': return 'remove';
            default: return operation.toLowerCase();
        }
    }

    shouldCollectionAggregate(collection) {
        // Based on default aggregator config
        const aggregatedCollections = ['messages', 'subscriptions', 'rooms'];
        return aggregatedCollections.includes(collection);
    }

    async cleanupTestData(collection, testId) {
        try {
            await collection.deleteMany({ 
                $or: [
                    { _id: testId },
                    { testCRUDOperation: true }
                ]
            });
        } catch (error) {
            console.log(`      ⚠️  Cleanup warning: ${error.message}`);
        }
    }

    addTestResult(testName, success, details) {
        this.testResults.push({
            testName,
            success,
            details,
            timestamp: Date.now()
        });
    }

    async generateReport() {
        const duration = Date.now() - this.startTime;
        const successCount = this.testResults.filter(r => r.success).length;
        const totalTests = this.testResults.length;
        const successRate = Math.round((successCount / totalTests) * 100);
        
        const report = {
            testSuite: 'CRUD Operations Test Suite',
            startTime: this.startTime,
            duration: duration,
            totalTests: totalTests,
            successfulTests: successCount,
            failedTests: totalTests - successCount,
            successRate: successRate,
            testResults: this.testResults,
            eventSummary: {
                totalRawEvents: this.capturedEvents.raw.length,
                totalAggregatedEvents: this.capturedEvents.aggregated.length,
                totalWebSocketEvents: this.capturedEvents.websocket.length
            },
            testedConfigurations: this.testConfigurations.map(config => ({
                name: config.name,
                collection: config.collection,
                operations: config.operations
            }))
        };
        
        console.log('\n' + '='.repeat(80));
        console.log('📊 CRUD OPERATIONS TEST REPORT');
        console.log('='.repeat(80));
        console.log(`\nTest Summary:`);
        console.log(`  📋 Total Tests: ${totalTests}`);
        console.log(`  ✅ Successful: ${successCount}`);
        console.log(`  ❌ Failed: ${totalTests - successCount}`);
        console.log(`  ⏱️  Duration: ${Math.round(duration / 1000)}s`);
        console.log(`  📈 Success Rate: ${successRate}%`);
        
        console.log(`\nEvent Summary:`);
        console.log(`  📡 Raw Events: ${report.eventSummary.totalRawEvents}`);
        console.log(`  🔄 Aggregated Events: ${report.eventSummary.totalAggregatedEvents}`);
        console.log(`  🌐 WebSocket Events: ${report.eventSummary.totalWebSocketEvents}`);
        
        console.log(`\nDetailed Results:`);
        this.testResults.forEach((result, index) => {
            const status = result.success ? '✅' : '❌';
            console.log(`  ${index + 1}. ${status} ${result.testName}`);
            console.log(`     📝 ${result.details}`);
        });
        
        // Save detailed report
        const reportFile = `crud-operations-test-report-${Date.now()}.json`;
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
        console.log(`\n📄 Detailed report saved to: ${process.cwd()}/${reportFile}`);
        
        return report;
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up test environment...');
        
        if (this.natsConnection) {
            await this.natsConnection.close();
            console.log('✅ NATS connection closed');
        }
        
        if (this.mongoClient) {
            // Clean up any remaining test data
            const db = this.mongoClient.db();
            const collections = ['messages', 'subscriptions', 'users', 'rooms', 'settings'];
            
            for (const collectionName of collections) {
                try {
                    await db.collection(collectionName).deleteMany({ testCRUDOperation: true });
                } catch (error) {
                    // Ignore cleanup errors
                }
            }
            
            await this.mongoClient.close();
            console.log('✅ MongoDB connection closed');
        }
        
        this.websockets.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });
        
        console.log('✅ Test environment cleaned up');
    }

    async run() {
        try {
            await this.setup();
            await this.runCRUDTests();
            await this.generateReport();
        } catch (error) {
            console.error('❌ Test execution failed:', error.message);
            process.exit(1);
        } finally {
            await this.cleanup();
        }
    }
}

// Run the test suite
if (require.main === module) {
    const testSuite = new CRUDOperationsTest();
    testSuite.run().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = CRUDOperationsTest;