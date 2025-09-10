#!/usr/bin/env node

/**
 * Stress Test for 3-Service Architecture
 * Tests the performance and scalability of the new decoupled architecture
 * 
 * Flow: DbWatcher → NATS → Aggregator → NATS → Broadcast Service → WebSocket Clients
 */

const { MongoClient } = require('mongodb');
const NATS = require('nats');
const WebSocket = require('ws');
const { performance } = require('perf_hooks');

const CONFIG = {
    mongodb: {
        url: process.env.MONGO_URL || 'mongodb://localhost:27018/meteor?directConnection=true',
        database: 'meteor'
    },
    nats: {
        url: process.env.EXTERNAL_WATCHER_NATS_URL || 'nats://localhost:4222',
        subjects: {
            raw: 'rocketchat.events.changedata',
            aggregated: 'rocketchat.events.aggregated'
        }
    },
    broadcast: {
        websocket: process.env.EXTERNAL_WATCHER_WS_URL || 'ws://localhost:8086/ws'
    },
    stress: {
        clients: parseInt(process.env.STRESS_TEST_CLIENTS) || 50,
        messageRate: parseInt(process.env.STRESS_MESSAGE_RATE) || 100,
        duration: parseInt(process.env.STRESS_DURATION) || 30,
        collections: ['messages', 'subscriptions', 'users', 'rooms']
    }
};

class ThreeServiceStressTest {
    constructor() {
        this.results = {
            architecture: '3services-stress',
            config: CONFIG.stress,
            startTime: Date.now(),
            metrics: {
                operations: 0,
                websocketClients: 0,
                eventsReceived: 0,
                eventsBroadcast: 0,
                errors: 0,
                latencies: []
            },
            performance: {}
        };
        
        this.mongoClient = null;
        this.natsClient = null;
        this.websocketClients = [];
        this.testDocuments = [];
        this.operationCount = 0;
    }

    async runStressTest() {
        console.log('\n🔥 STARTING 3-SERVICE ARCHITECTURE STRESS TEST');
        console.log('================================================================================');
        console.log(`📊 Configuration:`);
        console.log(`   WebSocket Clients: ${CONFIG.stress.clients}`);
        console.log(`   Message Rate: ${CONFIG.stress.messageRate} operations/second`);
        console.log(`   Duration: ${CONFIG.stress.duration} seconds`);
        console.log(`   Collections: ${CONFIG.stress.collections.join(', ')}`);
        console.log('================================================================================\n');
        
        try {
            await this.connectToServices();
            await this.setupWebSocketClients();
            await this.setupEventMonitoring();
            await this.runStressWorkload();
            await this.measureResults();
            
            this.generateStressReport();
            
        } catch (error) {
            console.error('❌ Stress test failed:', error);
            this.results.error = error.message;
        } finally {
            await this.cleanup();
        }
        
        return this.results;
    }

    async connectToServices() {
        console.log('🔌 Connecting to services...');
        
        // Connect to MongoDB
        this.mongoClient = new MongoClient(CONFIG.mongodb.url);
        await this.mongoClient.connect();
        this.database = this.mongoClient.db(CONFIG.mongodb.database);
        console.log('   ✅ MongoDB connected');
        
        // Connect to NATS
        this.natsClient = await NATS.connect({
            servers: [CONFIG.nats.url],
            timeout: 10000
        });
        console.log('   ✅ NATS connected');
        
        console.log();
    }

    async setupWebSocketClients() {
        console.log(`🌐 Setting up ${CONFIG.stress.clients} WebSocket clients...`);
        
        const connectionPromises = [];
        
        for (let i = 0; i < CONFIG.stress.clients; i++) {
            const promise = this.createWebSocketClient(i);
            connectionPromises.push(promise);
            
            // Stagger connections to avoid overwhelming the server
            if (i % 10 === 0 && i > 0) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        const results = await Promise.allSettled(connectionPromises);
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        
        this.results.metrics.websocketClients = successful;
        
        console.log(`   ✅ WebSocket clients: ${successful} connected, ${failed} failed`);
        console.log();
    }

    createWebSocketClient(clientId) {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(CONFIG.broadcast.websocket);
            const client = {
                id: clientId,
                ws: ws,
                eventsReceived: 0,
                connected: false,
                connectionTime: null
            };
            
            const timeout = setTimeout(() => {
                reject(new Error(`Client ${clientId} connection timeout`));
            }, 5000);
            
            ws.on('open', () => {
                clearTimeout(timeout);
                client.connected = true;
                client.connectionTime = Date.now();
                this.websocketClients.push(client);
                resolve(client);
            });
            
            ws.on('message', (data) => {
                try {
                    const event = JSON.parse(data.toString());
                    client.eventsReceived++;
                    this.results.metrics.eventsBroadcast++;
                    
                    // Record latency if this is a test event
                    if (event.testStamp) {
                        const latency = Date.now() - event.testStamp;
                        this.results.metrics.latencies.push(latency);
                    }
                } catch (error) {
                    // Ignore parsing errors for ping/pong messages
                }
            });
            
            ws.on('error', (error) => {
                clearTimeout(timeout);
                this.results.metrics.errors++;
                reject(error);
            });
            
            ws.on('close', () => {
                client.connected = false;
            });
        });
    }

    async setupEventMonitoring() {
        console.log('📡 Setting up event monitoring...');
        
        // Monitor aggregated events
        const aggSub = this.natsClient.subscribe(CONFIG.nats.subjects.aggregated);
        
        (async () => {
            for await (const msg of aggSub) {
                this.results.metrics.eventsReceived++;
            }
        })();
        
        console.log('   ✅ Event monitoring active');
        console.log();
    }

    async runStressWorkload() {
        console.log('🔥 Starting stress workload...');
        
        const startTime = performance.now();
        const endTime = startTime + (CONFIG.stress.duration * 1000);
        const intervalMs = 1000 / CONFIG.stress.messageRate;
        
        let nextOperationTime = startTime;
        
        while (performance.now() < endTime) {
            const currentTime = performance.now();
            
            if (currentTime >= nextOperationTime) {
                // Perform database operation
                await this.performDatabaseOperation();
                
                nextOperationTime = currentTime + intervalMs;
                this.operationCount++;
                
                // Log progress
                if (this.operationCount % 100 === 0) {
                    const elapsed = (currentTime - startTime) / 1000;
                    const rate = this.operationCount / elapsed;
                    console.log(`   📈 Operations: ${this.operationCount}, Rate: ${Math.round(rate)}/s, Clients: ${this.websocketClients.filter(c => c.connected).length}`);
                }
            } else {
                // Wait until next operation time
                await new Promise(resolve => setTimeout(resolve, Math.max(1, nextOperationTime - currentTime)));
            }
        }
        
        this.results.metrics.operations = this.operationCount;
        
        console.log('   ✅ Stress workload completed');
        
        // Wait for event propagation
        console.log('   ⏳ Waiting for event propagation...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        console.log();
    }

    async performDatabaseOperation() {
        const collection = CONFIG.stress.collections[Math.floor(Math.random() * CONFIG.stress.collections.length)];
        const operationType = ['insert', 'update'][Math.floor(Math.random() * 2)];
        
        try {
            if (operationType === 'insert') {
                const doc = this.generateTestDocument(collection);
                await this.database.collection(collection).insertOne(doc);
                this.testDocuments.push({ collection, _id: doc._id });
            } else if (operationType === 'update' && this.testDocuments.length > 0) {
                const randomDoc = this.testDocuments[Math.floor(Math.random() * this.testDocuments.length)];
                if (randomDoc.collection === collection) {
                    await this.database.collection(collection).updateOne(
                        { _id: randomDoc._id },
                        { $set: { updatedAt: new Date(), testStamp: Date.now() } }
                    );
                }
            }
        } catch (error) {
            this.results.metrics.errors++;
        }
    }

    generateTestDocument(collection) {
        const timestamp = Date.now();
        
        switch (collection) {
            case 'messages':
                return {
                    _id: `stress-msg-${timestamp}-${Math.random()}`,
                    msg: `Stress test message ${timestamp}`,
                    ts: new Date(),
                    u: { _id: `user-${timestamp}`, username: `testuser${timestamp}` },
                    rid: `room-${timestamp % 10}`,
                    testStamp: timestamp,
                    stressTest: true
                };
                
            case 'subscriptions':
                return {
                    _id: `stress-sub-${timestamp}-${Math.random()}`,
                    rid: `room-${timestamp % 10}`,
                    u: { _id: `user-${timestamp}` },
                    name: `Test Room ${timestamp}`,
                    t: 'c',
                    ts: new Date(),
                    testStamp: timestamp,
                    stressTest: true
                };
                
            case 'users':
                return {
                    _id: `stress-user-${timestamp}-${Math.random()}`,
                    username: `stressuser${timestamp}`,
                    name: `Stress User ${timestamp}`,
                    emails: [{ address: `stress${timestamp}@test.com`, verified: true }],
                    createdAt: new Date(),
                    testStamp: timestamp,
                    stressTest: true
                };
                
            case 'rooms':
                return {
                    _id: `stress-room-${timestamp}-${Math.random()}`,
                    name: `stress-room-${timestamp}`,
                    t: 'c',
                    ts: new Date(),
                    u: { _id: `user-${timestamp}`, username: `creator${timestamp}` },
                    testStamp: timestamp,
                    stressTest: true
                };
                
            default:
                return {
                    _id: `stress-doc-${timestamp}-${Math.random()}`,
                    testStamp: timestamp,
                    stressTest: true
                };
        }
    }

    async measureResults() {
        console.log('📊 Measuring stress test results...');
        
        const totalDuration = Date.now() - this.results.startTime;
        const connectedClients = this.websocketClients.filter(c => c.connected).length;
        
        // Calculate latency statistics
        const latencies = this.results.metrics.latencies.sort((a, b) => a - b);
        const latencyStats = {
            count: latencies.length,
            min: latencies.length > 0 ? latencies[0] : 0,
            max: latencies.length > 0 ? latencies[latencies.length - 1] : 0,
            avg: latencies.length > 0 ? latencies.reduce((a, b) => a + b) / latencies.length : 0,
            p50: latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0,
            p95: latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0,
            p99: latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)] : 0
        };
        
        this.results.performance = {
            totalDuration: totalDuration,
            operationsPerSecond: (this.results.metrics.operations / totalDuration) * 1000,
            eventsPerSecond: (this.results.metrics.eventsReceived / totalDuration) * 1000,
            broadcastsPerSecond: (this.results.metrics.eventsBroadcast / totalDuration) * 1000,
            connectedClients: connectedClients,
            latencyStats: latencyStats,
            errorRate: (this.results.metrics.errors / this.results.metrics.operations) * 100
        };
        
        console.log(`   📈 Total Operations: ${this.results.metrics.operations}`);
        console.log(`   📈 Operations/sec: ${Math.round(this.results.performance.operationsPerSecond)}`);
        console.log(`   📈 Events Received: ${this.results.metrics.eventsReceived}`);
        console.log(`   📈 Events Broadcast: ${this.results.metrics.eventsBroadcast}`);
        console.log(`   📈 Connected Clients: ${connectedClients}/${CONFIG.stress.clients}`);
        console.log(`   📈 Error Rate: ${this.results.performance.errorRate.toFixed(2)}%`);
        console.log();
    }

    generateStressReport() {
        console.log('📋 3-SERVICE ARCHITECTURE STRESS TEST REPORT');
        console.log('================================================================================');
        
        const perf = this.results.performance;
        
        console.log();
        console.log('🔥 STRESS TEST RESULTS:');
        console.log(`   Duration: ${Math.round(perf.totalDuration / 1000)}s`);
        console.log(`   Operations: ${this.results.metrics.operations} (${Math.round(perf.operationsPerSecond)}/s)`);
        console.log(`   Events Processed: ${this.results.metrics.eventsReceived} (${Math.round(perf.eventsPerSecond)}/s)`);
        console.log(`   WebSocket Broadcasts: ${this.results.metrics.eventsBroadcast} (${Math.round(perf.broadcastsPerSecond)}/s)`);
        console.log(`   Connected Clients: ${perf.connectedClients}/${CONFIG.stress.clients}`);
        console.log(`   Error Rate: ${perf.errorRate.toFixed(2)}%`);
        
        console.log();
        console.log('⚡ LATENCY STATISTICS:');
        console.log(`   Samples: ${perf.latencyStats.count}`);
        console.log(`   Min: ${Math.round(perf.latencyStats.min)}ms`);
        console.log(`   Avg: ${Math.round(perf.latencyStats.avg)}ms`);
        console.log(`   P50: ${Math.round(perf.latencyStats.p50)}ms`);
        console.log(`   P95: ${Math.round(perf.latencyStats.p95)}ms`);
        console.log(`   P99: ${Math.round(perf.latencyStats.p99)}ms`);
        console.log(`   Max: ${Math.round(perf.latencyStats.max)}ms`);
        
        console.log();
        console.log('🎯 PERFORMANCE ASSESSMENT:');
        
        // Performance thresholds for assessment
        const assessments = [
            {
                metric: 'Operations/sec',
                value: perf.operationsPerSecond,
                good: 50,
                excellent: 100,
                unit: '/s'
            },
            {
                metric: 'P95 Latency',
                value: perf.latencyStats.p95,
                good: 500,
                excellent: 200,
                unit: 'ms',
                lowerIsBetter: true
            },
            {
                metric: 'Error Rate',
                value: perf.errorRate,
                good: 5,
                excellent: 1,
                unit: '%',
                lowerIsBetter: true
            },
            {
                metric: 'Client Connectivity',
                value: (perf.connectedClients / CONFIG.stress.clients) * 100,
                good: 90,
                excellent: 95,
                unit: '%'
            }
        ];
        
        assessments.forEach(({ metric, value, good, excellent, unit, lowerIsBetter }) => {
            let status, icon;
            
            if (lowerIsBetter) {
                if (value <= excellent) {
                    status = 'Excellent';
                    icon = '🟢';
                } else if (value <= good) {
                    status = 'Good';
                    icon = '🟡';
                } else {
                    status = 'Needs Improvement';
                    icon = '🔴';
                }
            } else {
                if (value >= excellent) {
                    status = 'Excellent';
                    icon = '🟢';
                } else if (value >= good) {
                    status = 'Good';
                    icon = '🟡';
                } else {
                    status = 'Needs Improvement';
                    icon = '🔴';
                }
            }
            
            console.log(`   ${icon} ${metric}: ${Math.round(value)}${unit} (${status})`);
        });
        
        console.log();
        console.log(`🏆 OVERALL ASSESSMENT: ${this.getOverallAssessment()}`);
        console.log();
    }

    getOverallAssessment() {
        const perf = this.results.performance;
        
        const scores = [
            perf.operationsPerSecond >= 100 ? 2 : perf.operationsPerSecond >= 50 ? 1 : 0,
            perf.latencyStats.p95 <= 200 ? 2 : perf.latencyStats.p95 <= 500 ? 1 : 0,
            perf.errorRate <= 1 ? 2 : perf.errorRate <= 5 ? 1 : 0,
            (perf.connectedClients / CONFIG.stress.clients) >= 0.95 ? 2 : (perf.connectedClients / CONFIG.stress.clients) >= 0.90 ? 1 : 0
        ];
        
        const totalScore = scores.reduce((a, b) => a + b);
        const maxScore = scores.length * 2;
        
        if (totalScore >= maxScore * 0.8) {
            return '🟢 EXCELLENT - 3-Service architecture performing optimally';
        } else if (totalScore >= maxScore * 0.6) {
            return '🟡 GOOD - 3-Service architecture performing well with minor issues';
        } else {
            return '🔴 NEEDS IMPROVEMENT - 3-Service architecture requires optimization';
        }
    }

    async cleanup() {
        console.log('🧹 Cleaning up stress test...');
        
        // Close WebSocket clients
        for (const client of this.websocketClients) {
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.close();
            }
        }
        
        // Remove test documents (in batches to avoid overwhelming the database)
        const batchSize = 100;
        for (let i = 0; i < this.testDocuments.length; i += batchSize) {
            const batch = this.testDocuments.slice(i, i + batchSize);
            
            const deletePromises = [];
            for (const doc of batch) {
                const promise = this.database.collection(doc.collection)
                    .deleteOne({ _id: doc._id })
                    .catch(() => {}); // Ignore errors
                deletePromises.push(promise);
            }
            
            await Promise.allSettled(deletePromises);
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

// Run the stress test
if (require.main === module) {
    const test = new ThreeServiceStressTest();
    test.runStressTest().then(results => {
        // Save results to file
        const fs = require('fs');
        const reportFile = `stress-test-3services-${Date.now()}.json`;
        fs.writeFileSync(reportFile, JSON.stringify(results, null, 2));
        console.log(`📄 Detailed results saved to: ${reportFile}`);
        
        process.exit(0);
    }).catch(error => {
        console.error('Stress test execution failed:', error);
        process.exit(1);
    });
}

module.exports = ThreeServiceStressTest;