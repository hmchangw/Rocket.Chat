#!/usr/bin/env node

/**
 * Test for 3-Service Architecture 
 * Tests: DbWatcher → NATS → Aggregator → NATS → Broadcast Service → WebSocket Clients
 * 
 * Architecture Flow:
 * 1. DbWatcher monitors MongoDB changes → publishes to "rocketchat.events.changedata"
 * 2. Aggregator subscribes to "rocketchat.events.changedata" → enriches data → publishes to "rocketchat.events.aggregated"
 * 3. Broadcast Service subscribes to "rocketchat.events.aggregated" → broadcasts to WebSocket clients
 */

const { MongoClient } = require('mongodb');
const NATS = require('nats');
const WebSocket = require('ws');
const { performance } = require('perf_hooks');

// Configuration for 3-service architecture
const CONFIG = {
    mongodb: {
        url: process.env.MONGO_URL || 'mongodb://localhost:27018/meteor?directConnection=true',
        database: 'meteor'
    },
    nats: {
        url: process.env.EXTERNAL_WATCHER_NATS_URL || 'nats://localhost:4222',
        subjects: {
            raw: 'rocketchat.events.changedata',      // DbWatcher → Aggregator
            aggregated: 'rocketchat.events.aggregated' // Aggregator → Broadcast Service
        }
    },
    services: {
        dbwatcher: {
            health: process.env.DBWATCHER_HEALTH_URL || 'http://localhost:8082/health'
        },
        aggregator: {
            health: process.env.AGGREGATOR_HEALTH_URL || 'http://localhost:8084/health'
        },
        broadcast: {
            health: process.env.BROADCAST_HEALTH_URL || 'http://localhost:8087/health',
            websocket: process.env.EXTERNAL_WATCHER_WS_URL || 'ws://localhost:8086/ws'
        }
    }
};

class ThreeServiceArchitectureTest {
    constructor() {
        this.testResults = {
            architecture: '3-services',
            startTime: Date.now(),
            services: {},
            flow: {},
            performance: {},
            errors: []
        };
        
        this.mongoClient = null;
        this.natsClient = null;
        this.rawEventsReceived = [];
        this.aggregatedEventsReceived = [];
        this.websocketEventsReceived = [];
        this.testDocuments = [];
    }

    async runTest() {
        console.log('\n🚀 STARTING 3-SERVICE ARCHITECTURE TEST');
        console.log('================================================================================\n');
        
        try {
            // Test architecture components
            await this.testServiceHealth();
            await this.connectToServices();
            await this.setupEventListeners();
            await this.testEventFlow();
            await this.testWebSocketBroadcasting();
            await this.measurePerformance();
            
            this.generateReport();
            
        } catch (error) {
            console.error('❌ Test failed:', error);
            this.testResults.errors.push(error.message);
        } finally {
            await this.cleanup();
        }
        
        return this.testResults;
    }

    async testServiceHealth() {
        console.log('🏥 Testing Service Health...');
        
        const services = ['dbwatcher', 'aggregator', 'broadcast'];
        
        for (const service of services) {
            try {
                const response = await fetch(CONFIG.services[service].health);
                const health = await response.json();
                
                this.testResults.services[service] = {
                    status: health.status || 'unknown',
                    healthy: response.status === 200,
                    uptime: health.uptime || 0,
                    url: CONFIG.services[service].health
                };
                
                console.log(`   ✅ ${service.toUpperCase()}: ${health.status} (uptime: ${Math.round(health.uptime)}s)`);
                
            } catch (error) {
                this.testResults.services[service] = {
                    status: 'error',
                    healthy: false,
                    error: error.message
                };
                console.log(`   ❌ ${service.toUpperCase()}: ${error.message}`);
            }
        }
        
        console.log();
    }

    async connectToServices() {
        console.log('🔌 Connecting to Services...');
        
        // Connect to MongoDB
        this.mongoClient = new MongoClient(CONFIG.mongodb.url);
        await this.mongoClient.connect();
        this.database = this.mongoClient.db(CONFIG.mongodb.database);
        console.log('   ✅ Connected to MongoDB');
        
        // Connect to NATS
        this.natsClient = await NATS.connect({
            servers: [CONFIG.nats.url],
            timeout: 10000
        });
        console.log('   ✅ Connected to NATS');
        
        console.log();
    }

    async setupEventListeners() {
        console.log('🎧 Setting up Event Listeners...');
        
        // Listen to raw events (DbWatcher → Aggregator)
        const rawSub = this.natsClient.subscribe(CONFIG.nats.subjects.raw);
        console.log(`   📥 Subscribed to raw events: ${CONFIG.nats.subjects.raw}`);
        
        (async () => {
            for await (const msg of rawSub) {
                try {
                    const event = JSON.parse(msg.data);
                    this.rawEventsReceived.push({
                        ...event,
                        receivedAt: Date.now(),
                        subject: msg.subject
                    });
                    console.log(`   📨 Raw event: ${event.collection}.${event.action} (id: ${event.id})`);
                } catch (error) {
                    console.log(`   ❌ Failed to parse raw event: ${error.message}`);
                }
            }
        })();
        
        // Listen to aggregated events (Aggregator → Broadcast Service)
        const aggSub = this.natsClient.subscribe(CONFIG.nats.subjects.aggregated);
        console.log(`   📥 Subscribed to aggregated events: ${CONFIG.nats.subjects.aggregated}`);
        
        (async () => {
            for await (const msg of aggSub) {
                try {
                    const event = JSON.parse(msg.data);
                    this.aggregatedEventsReceived.push({
                        ...event,
                        receivedAt: Date.now(),
                        subject: msg.subject
                    });
                    console.log(`   📨 Aggregated event: ${event.collection}.${event.action} (enriched: ${event.enriched})`);
                } catch (error) {
                    console.log(`   ❌ Failed to parse aggregated event: ${error.message}`);
                }
            }
        })();
        
        console.log();
    }

    async testEventFlow() {
        console.log('🔄 Testing End-to-End Event Flow...');
        
        const startTime = performance.now();
        
        // Test 1: Insert Document
        console.log('   1️⃣ Testing INSERT event flow...');
        const insertDoc = {
            _id: `test-3services-${Date.now()}`,
            msg: 'Test message for 3-service architecture',
            ts: new Date(),
            u: { _id: 'test-user', username: 'testuser' },
            rid: 'test-room',
            testType: '3services-insert'
        };
        
        await this.database.collection('messages').insertOne(insertDoc);
        this.testDocuments.push({ collection: 'messages', _id: insertDoc._id });
        
        // Wait for event propagation
        await this.waitForEventPropagation(insertDoc._id, 2000);
        
        // Test 2: Update Document  
        console.log('   2️⃣ Testing UPDATE event flow...');
        await this.database.collection('messages').updateOne(
            { _id: insertDoc._id },
            { $set: { msg: 'Updated message for 3-service test', updatedAt: new Date() } }
        );
        
        await this.waitForEventPropagation(insertDoc._id, 2000);
        
        // Test 3: Delete Document
        console.log('   3️⃣ Testing DELETE event flow...');
        await this.database.collection('messages').deleteOne({ _id: insertDoc._id });
        
        await this.waitForEventPropagation(insertDoc._id, 2000);
        
        const endTime = performance.now();
        this.testResults.flow.totalTime = endTime - startTime;
        
        // Analyze event flow
        this.analyzeEventFlow(insertDoc._id);
        
        console.log();
    }

    async waitForEventPropagation(documentId, timeout = 2000) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            // Check if both raw and aggregated events received
            const rawEvent = this.rawEventsReceived.find(e => e.id === documentId);
            const aggEvent = this.aggregatedEventsReceived.find(e => e.id === documentId);
            
            if (rawEvent && aggEvent) {
                console.log(`     ✅ Event propagated through architecture (${Date.now() - startTime}ms)`);
                return;
            }
            
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log(`     ⚠️ Event propagation timeout (${timeout}ms)`);
    }

    analyzeEventFlow(documentId) {
        const rawEvents = this.rawEventsReceived.filter(e => e.id === documentId);
        const aggEvents = this.aggregatedEventsReceived.filter(e => e.id === documentId);
        
        console.log('   📊 Event Flow Analysis:');
        console.log(`     Raw Events Received: ${rawEvents.length}`);
        console.log(`     Aggregated Events Received: ${aggEvents.length}`);
        
        if (rawEvents.length > 0 && aggEvents.length > 0) {
            const latency = aggEvents[0].receivedAt - rawEvents[0].receivedAt;
            console.log(`     Aggregation Latency: ${latency}ms`);
            
            this.testResults.flow.eventAnalysis = {
                documentId,
                rawEvents: rawEvents.length,
                aggregatedEvents: aggEvents.length,
                aggregationLatency: latency,
                success: rawEvents.length > 0 && aggEvents.length > 0
            };
        }
    }

    async testWebSocketBroadcasting() {
        console.log('🌐 Testing WebSocket Broadcasting...');
        
        return new Promise((resolve) => {
            const ws = new WebSocket(CONFIG.services.broadcast.websocket);
            const broadcastStartTime = performance.now();
            
            ws.on('open', () => {
                console.log('   🔗 Connected to Broadcast Service WebSocket');
                
                // Test WebSocket by inserting a new document
                setTimeout(async () => {
                    const testDoc = {
                        _id: `websocket-test-${Date.now()}`,
                        msg: 'WebSocket broadcast test',
                        ts: new Date(),
                        u: { _id: 'ws-user', username: 'wsuser' },
                        rid: 'ws-room',
                        testType: '3services-websocket'
                    };
                    
                    await this.database.collection('messages').insertOne(testDoc);
                    this.testDocuments.push({ collection: 'messages', _id: testDoc._id });
                }, 500);
            });
            
            ws.on('message', (data) => {
                try {
                    const event = JSON.parse(data.toString());
                    this.websocketEventsReceived.push({
                        ...event,
                        receivedAt: Date.now()
                    });
                    
                    console.log(`   📨 WebSocket event: ${event.collection}.${event.action} (id: ${event.id})`);
                    
                    if (event.testType === '3services-websocket') {
                        const broadcastLatency = performance.now() - broadcastStartTime;
                        console.log(`   ⚡ WebSocket broadcast latency: ${Math.round(broadcastLatency)}ms`);
                        
                        this.testResults.flow.websocketBroadcast = {
                            success: true,
                            latency: broadcastLatency,
                            eventsReceived: this.websocketEventsReceived.length
                        };
                        
                        ws.close();
                        resolve();
                    }
                } catch (error) {
                    console.log(`   ❌ Failed to parse WebSocket message: ${error.message}`);
                }
            });
            
            ws.on('error', (error) => {
                console.log(`   ❌ WebSocket error: ${error.message}`);
                this.testResults.flow.websocketBroadcast = {
                    success: false,
                    error: error.message
                };
                resolve();
            });
            
            // Timeout after 10 seconds
            setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
                resolve();
            }, 10000);
        });
    }

    async measurePerformance() {
        console.log('📊 Measuring Performance...');
        
        this.testResults.performance = {
            rawEventsReceived: this.rawEventsReceived.length,
            aggregatedEventsReceived: this.aggregatedEventsReceived.length,
            websocketEventsReceived: this.websocketEventsReceived.length,
            eventFlowLatency: this.testResults.flow.eventAnalysis?.aggregationLatency || 0,
            websocketLatency: this.testResults.flow.websocketBroadcast?.latency || 0,
            totalTestTime: Date.now() - this.testResults.startTime
        };
        
        console.log(`   📈 Raw Events: ${this.testResults.performance.rawEventsReceived}`);
        console.log(`   📈 Aggregated Events: ${this.testResults.performance.aggregatedEventsReceived}`);
        console.log(`   📈 WebSocket Events: ${this.testResults.performance.websocketEventsReceived}`);
        console.log(`   ⚡ Event Flow Latency: ${this.testResults.performance.eventFlowLatency}ms`);
        console.log(`   ⚡ WebSocket Latency: ${Math.round(this.testResults.performance.websocketLatency)}ms`);
        
        console.log();
    }

    generateReport() {
        console.log('📋 3-SERVICE ARCHITECTURE TEST REPORT');
        console.log('================================================================================');
        
        const allServicesHealthy = Object.values(this.testResults.services).every(s => s.healthy);
        const eventFlowWorking = this.testResults.flow.eventAnalysis?.success;
        const websocketWorking = this.testResults.flow.websocketBroadcast?.success;
        
        console.log();
        console.log('🏆 ARCHITECTURE VALIDATION:');
        console.log(`   Services Health: ${allServicesHealthy ? '✅ All services healthy' : '❌ Some services unhealthy'}`);
        console.log(`   Event Flow (DbWatcher → Aggregator): ${eventFlowWorking ? '✅ Working' : '❌ Failed'}`);
        console.log(`   Broadcasting (Aggregator → Broadcast Service): ${websocketWorking ? '✅ Working' : '❌ Failed'}`);
        
        console.log();
        console.log('⚡ PERFORMANCE METRICS:');
        console.log(`   Event Processing Latency: ${this.testResults.performance.eventFlowLatency}ms`);
        console.log(`   WebSocket Broadcast Latency: ${Math.round(this.testResults.performance.websocketLatency)}ms`);
        console.log(`   Total Test Duration: ${Math.round(this.testResults.performance.totalTestTime / 1000)}s`);
        
        console.log();
        console.log('📊 SERVICE STATUS:');
        Object.entries(this.testResults.services).forEach(([service, status]) => {
            const icon = status.healthy ? '✅' : '❌';
            console.log(`   ${icon} ${service.toUpperCase()}: ${status.status} (uptime: ${Math.round(status.uptime || 0)}s)`);
        });
        
        const overallSuccess = allServicesHealthy && eventFlowWorking && websocketWorking;
        console.log();
        console.log(`🎯 OVERALL RESULT: ${overallSuccess ? '✅ 3-SERVICE ARCHITECTURE WORKING PERFECTLY' : '❌ ARCHITECTURE ISSUES DETECTED'}`);
        console.log();
    }

    async cleanup() {
        console.log('🧹 Cleaning up test environment...');
        
        // Remove test documents
        for (const doc of this.testDocuments) {
            try {
                await this.database.collection(doc.collection).deleteOne({ _id: doc._id });
            } catch (error) {
                // Ignore cleanup errors
            }
        }
        
        // Close connections
        if (this.mongoClient) {
            await this.mongoClient.close();
        }
        
        if (this.natsClient) {
            await this.natsClient.close();
        }
        
        console.log('   ✅ Cleanup completed');
    }
}

// Run the test
if (require.main === module) {
    const test = new ThreeServiceArchitectureTest();
    test.runTest().then(results => {
        process.exit(results.errors.length > 0 ? 1 : 0);
    }).catch(error => {
        console.error('Test execution failed:', error);
        process.exit(1);
    });
}

module.exports = ThreeServiceArchitectureTest;