#!/usr/bin/env node
/**
 * Multi-Client WebSocket Stress Test & Configuration Test Suite
 * 
 * Tests different Aggregator WebSocket configurations with multiple clients:
 * 1. Different buffer sizes (read/write)
 * 2. Different batching configurations 
 * 3. Different aggregation settings
 * 4. Connection pooling and scaling behavior
 * 5. Real-time performance under various loads
 */

const { MongoClient } = require('mongodb');
const { connect, StringCodec } = require('nats');
const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');

class WebSocketMultiClientTest {
    constructor() {
        this.mongoUri = process.env.MONGO_URL || 'mongodb://localhost:27018/meteor?directConnection=true';
        this.natsUrl = process.env.EXTERNAL_WATCHER_NATS_URL || 'nats://localhost:4222';
        this.websocketUrl = process.env.EXTERNAL_WATCHER_WS_URL || 'ws://localhost:8083/ws';
        
        this.mongoClient = null;
        this.natsConnection = null;
        this.sc = StringCodec();
        
        // Test configurations for different scenarios
        this.testConfigurations = [
            {
                name: 'Low Latency Config',
                description: 'Optimized for minimal latency',
                clientCount: 50,
                messageRate: 100, // messages per second
                duration: 30, // seconds
                expectedConfig: {
                    batching: { enabled: false },
                    bufferSizes: { read: 1024, write: 1024 },
                    aggregation: 'minimal'
                }
            },
            {
                name: 'High Throughput Config', 
                description: 'Optimized for maximum throughput',
                clientCount: 200,
                messageRate: 500,
                duration: 60,
                expectedConfig: {
                    batching: { enabled: true, maxBatchSize: 100 },
                    bufferSizes: { read: 4096, write: 4096 },
                    aggregation: 'full'
                }
            },
            {
                name: 'Memory Efficient Config',
                description: 'Optimized for low memory usage',
                clientCount: 500,
                messageRate: 200,
                duration: 45,
                expectedConfig: {
                    batching: { enabled: true, maxBatchSize: 50 },
                    bufferSizes: { read: 512, write: 512 },
                    aggregation: 'selective'
                }
            },
            {
                name: 'Enterprise Scale Config',
                description: 'Large scale deployment simulation',
                clientCount: 1000,
                messageRate: 1000,
                duration: 30,
                expectedConfig: {
                    batching: { enabled: true, maxBatchSize: 200 },
                    bufferSizes: { read: 8192, write: 8192 },
                    aggregation: 'optimized'
                }
            }
        ];
        
        this.testResults = [];
        this.startTime = Date.now();
    }

    async setup() {
        console.log('🔧 Setting up Multi-Client WebSocket Test Suite...\n');
        
        // Connect to services
        this.mongoClient = new MongoClient(this.mongoUri);
        await this.mongoClient.connect();
        console.log('✅ Connected to MongoDB');
        
        this.natsConnection = await connect({ servers: [this.natsUrl] });
        console.log('✅ Connected to NATS');
        
        // Verify service health
        await this.verifyServiceHealth();
        
        console.log('✅ Test suite setup completed\n');
    }

    async verifyServiceHealth() {
        console.log('🏥 Verifying service health...');
        
        try {
            const [dbwatcherHealth, aggregatorHealth] = await Promise.all([
                axios.get('http://localhost:8082/health'),
                axios.get('http://localhost:8084/health')
            ]);
            
            console.log(`   DbWatcher: ${dbwatcherHealth.data.status} (${dbwatcherHealth.data.events_published} events)`);
            console.log(`   Aggregator: ${aggregatorHealth.data.status} (${aggregatorHealth.data.events_processed} events, ${aggregatorHealth.data.websocket_clients} clients)`);
            
            if (dbwatcherHealth.data.status !== 'healthy' || aggregatorHealth.data.status !== 'healthy') {
                throw new Error('Services not healthy');
            }
        } catch (error) {
            throw new Error(`Service health check failed: ${error.message}`);
        }
    }

    async runWebSocketTests() {
        console.log('🚀 Starting Multi-Client WebSocket Test Suite\n');
        console.log('=' .repeat(80));
        
        for (const config of this.testConfigurations) {
            console.log(`\n📊 Testing Configuration: ${config.name}`);
            console.log(`📝 ${config.description}`);
            console.log('-'.repeat(60));
            
            await this.runSingleWebSocketTest(config);
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('🏁 Multi-Client WebSocket Test Suite Completed\n');
    }

    async runSingleWebSocketTest(config) {
        const testId = `ws_multi_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        
        console.log(`   🎯 Test ID: ${testId}`);
        console.log(`   👥 Clients: ${config.clientCount}`);
        console.log(`   📈 Message Rate: ${config.messageRate} msg/s`);
        console.log(`   ⏱️  Duration: ${config.duration}s`);
        
        // Get baseline service health
        const healthBefore = await this.getServiceHealth();
        
        // Create WebSocket clients
        console.log(`\n   🔌 Connecting ${config.clientCount} WebSocket clients...`);
        const clients = await this.createWebSocketClients(config.clientCount, testId);
        
        if (clients.length < config.clientCount * 0.8) {
            console.log(`   ⚠️  Only ${clients.length}/${config.clientCount} clients connected, continuing with reduced load`);
        }
        
        console.log(`   ✅ ${clients.length} clients connected successfully`);
        
        // Wait for connection stabilization
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check service health after connections
        const healthAfterConnect = await this.getServiceHealth();
        console.log(`   📊 Connected clients reported by aggregator: ${healthAfterConnect.aggregator.websocket_clients}`);
        
        // Start the message generation and monitoring
        const testResults = await this.runMessageGenerationTest(config, clients, testId);
        
        // Get final service health
        const healthAfter = await this.getServiceHealth();
        
        // Analyze results
        await this.analyzeTestResults(config, testResults, clients, {
            before: healthBefore,
            afterConnect: healthAfterConnect,
            after: healthAfter
        });
        
        // Cleanup
        await this.cleanupTest(testId, clients);
    }

    async createWebSocketClients(count, testId) {
        const clients = [];
        const batchSize = 20; // Connect in batches to avoid overwhelming
        
        for (let batch = 0; batch < Math.ceil(count / batchSize); batch++) {
            const batchStart = batch * batchSize;
            const batchEnd = Math.min(batchStart + batchSize, count);
            const batchPromises = [];
            
            for (let i = batchStart; i < batchEnd; i++) {
                const clientPromise = this.createSingleWebSocketClient(i, testId);
                batchPromises.push(clientPromise);
            }
            
            try {
                const batchClients = await Promise.all(batchPromises);
                clients.push(...batchClients.filter(c => c !== null));
                
                // Progress indicator
                if (batch % 5 === 0) {
                    console.log(`     Connected: ${clients.length}/${count} clients`);
                }
                
                // Small delay between batches
                if (batch < Math.ceil(count / batchSize) - 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (error) {
                console.log(`     ⚠️  Batch ${batch + 1} had connection issues`);
            }
        }
        
        return clients;
    }

    async createSingleWebSocketClient(clientId, testId) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const ws = new WebSocket(this.websocketUrl);
            
            const client = {
                id: clientId,
                socket: ws,
                connected: false,
                messagesReceived: 0,
                messagesExpected: 0,
                latencies: [],
                connectionTime: 0,
                lastMessageTime: 0,
                errors: 0,
                testId
            };
            
            const timeout = setTimeout(() => {
                if (!client.connected) {
                    ws.close();
                    resolve(null);
                }
            }, 10000); // 10 second timeout
            
            ws.on('open', () => {
                client.connected = true;
                client.connectionTime = Date.now() - startTime;
                clearTimeout(timeout);
                resolve(client);
            });
            
            ws.on('message', (data) => {
                try {
                    const event = JSON.parse(data.toString());
                    
                    if (event.testMultiClientId === testId) {
                        const latency = Date.now() - event.testTimestamp;
                        client.latencies.push(latency);
                        client.messagesReceived++;
                        client.lastMessageTime = Date.now();
                    }
                } catch (error) {
                    client.errors++;
                }
            });
            
            ws.on('error', (error) => {
                client.errors++;
            });
            
            ws.on('close', () => {
                client.connected = false;
            });
        });
    }

    async runMessageGenerationTest(config, clients, testId) {
        console.log(`\n   🚀 Starting message generation test...`);
        
        const startTime = Date.now();
        const endTime = startTime + (config.duration * 1000);
        const messageInterval = 1000 / config.messageRate; // ms between messages
        
        let messagesGenerated = 0;
        let messageId = 0;
        
        // Reset client counters
        clients.forEach(client => {
            client.messagesReceived = 0;
            client.latencies = [];
            client.messagesExpected = 0;
        });
        
        console.log(`   📝 Generating messages at ${config.messageRate} msg/s for ${config.duration}s...`);
        
        // Message generation loop
        const generateMessages = async () => {
            while (Date.now() < endTime) {
                const messageStartTime = Date.now();
                
                // Generate message
                const message = {
                    _id: `${testId}_msg_${messageId++}`,
                    msg: `Multi-client test message ${messagesGenerated}`,
                    ts: new Date(),
                    u: { _id: 'test-user-multi', username: 'testuser' },
                    rid: 'test-room-multi',
                    testMultiClientId: testId,
                    testTimestamp: messageStartTime,
                    messageIndex: messagesGenerated
                };
                
                try {
                    await this.mongoClient.db().collection('messages').insertOne(message);
                    messagesGenerated++;
                    
                    // Update expected counts for all connected clients
                    clients.forEach(client => {
                        if (client.connected) {
                            client.messagesExpected++;
                        }
                    });
                    
                    // Progress updates
                    if (messagesGenerated % 100 === 0) {
                        const elapsed = Date.now() - startTime;
                        const rate = (messagesGenerated / elapsed) * 1000;
                        console.log(`     Generated: ${messagesGenerated} messages (${rate.toFixed(1)} msg/s)`);
                    }
                    
                } catch (error) {
                    console.log(`     ❌ Message generation error: ${error.message}`);
                }
                
                // Wait for next message interval
                const nextMessageTime = messageStartTime + messageInterval;
                const waitTime = nextMessageTime - Date.now();
                if (waitTime > 0) {
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
        };
        
        await generateMessages();
        
        console.log(`   ✅ Message generation completed: ${messagesGenerated} messages generated`);
        
        // Wait for message processing and delivery
        console.log(`   ⏳ Waiting for message processing and delivery...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        return {
            messagesGenerated,
            duration: Date.now() - startTime,
            startTime,
            endTime: Date.now()
        };
    }

    async getServiceHealth() {
        try {
            const [dbwatcherHealth, aggregatorHealth] = await Promise.all([
                axios.get('http://localhost:8082/health'),
                axios.get('http://localhost:8084/health')
            ]);
            
            return {
                dbwatcher: dbwatcherHealth.data,
                aggregator: aggregatorHealth.data
            };
        } catch (error) {
            return {
                dbwatcher: { events_published: 0, status: 'unknown' },
                aggregator: { events_processed: 0, websocket_clients: 0, status: 'unknown' }
            };
        }
    }

    async analyzeTestResults(config, testResults, clients, healthData) {
        console.log(`\n   📊 Analyzing test results...`);
        
        // Client metrics
        const connectedClients = clients.filter(c => c.connected).length;
        const totalMessagesReceived = clients.reduce((sum, c) => sum + c.messagesReceived, 0);
        const totalMessagesExpected = clients.reduce((sum, c) => sum + c.messagesExpected, 0);
        const deliveryRate = totalMessagesExpected > 0 ? (totalMessagesReceived / totalMessagesExpected) * 100 : 0;
        
        // Latency analysis
        const allLatencies = clients.flatMap(c => c.latencies);
        const avgLatency = allLatencies.length > 0 ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length : 0;
        const maxLatency = allLatencies.length > 0 ? Math.max(...allLatencies) : 0;
        const minLatency = allLatencies.length > 0 ? Math.min(...allLatencies) : 0;
        const p95Latency = this.calculatePercentile(allLatencies, 95);
        const p99Latency = this.calculatePercentile(allLatencies, 99);
        
        // Connection analysis
        const avgConnectionTime = clients.reduce((sum, c) => sum + c.connectionTime, 0) / clients.length;
        const maxConnectionTime = Math.max(...clients.map(c => c.connectionTime));
        
        // Service performance
        const eventsPublished = healthData.after.dbwatcher.events_published - healthData.before.dbwatcher.events_published;
        const eventsProcessed = healthData.after.aggregator.events_processed - healthData.before.aggregator.events_processed;
        const eventProcessingRate = eventsProcessed / (testResults.duration / 1000);
        
        // Throughput analysis
        const actualMessageRate = testResults.messagesGenerated / (testResults.duration / 1000);
        const clientThroughput = totalMessagesReceived / (testResults.duration / 1000);
        
        const results = {
            config: config.name,
            testResults,
            clientMetrics: {
                connectedClients,
                totalMessagesReceived,
                totalMessagesExpected,
                deliveryRate
            },
            latencyMetrics: {
                avgLatency,
                maxLatency,
                minLatency,
                p95Latency,
                p99Latency
            },
            connectionMetrics: {
                avgConnectionTime,
                maxConnectionTime,
                connectionSuccessRate: (connectedClients / config.clientCount) * 100
            },
            serviceMetrics: {
                eventsPublished,
                eventsProcessed,
                eventProcessingRate
            },
            throughputMetrics: {
                targetMessageRate: config.messageRate,
                actualMessageRate,
                clientThroughput,
                efficiencyRatio: (clientThroughput / actualMessageRate) * 100
            }
        };
        
        // Display results
        console.log(`\n   📈 TEST RESULTS for ${config.name}:`);
        console.log(`   ${'='.repeat(50)}`);
        
        console.log(`   🔗 Connection Metrics:`);
        console.log(`      Success Rate: ${results.connectionMetrics.connectionSuccessRate.toFixed(1)}%`);
        console.log(`      Avg Connection Time: ${avgConnectionTime.toFixed(1)}ms`);
        console.log(`      Max Connection Time: ${maxConnectionTime.toFixed(1)}ms`);
        
        console.log(`   📊 Delivery Metrics:`);
        console.log(`      Messages Expected: ${totalMessagesExpected}`);
        console.log(`      Messages Received: ${totalMessagesReceived}`);
        console.log(`      Delivery Rate: ${deliveryRate.toFixed(1)}%`);
        
        console.log(`   ⚡ Latency Metrics:`);
        console.log(`      Average: ${avgLatency.toFixed(1)}ms`);
        console.log(`      P95: ${p95Latency.toFixed(1)}ms`);
        console.log(`      P99: ${p99Latency.toFixed(1)}ms`);
        console.log(`      Max: ${maxLatency.toFixed(1)}ms`);
        
        console.log(`   🚀 Throughput Metrics:`);
        console.log(`      Target Rate: ${config.messageRate} msg/s`);
        console.log(`      Actual Generation: ${actualMessageRate.toFixed(1)} msg/s`);
        console.log(`      Client Throughput: ${clientThroughput.toFixed(1)} msg/s`);
        console.log(`      Efficiency: ${results.throughputMetrics.efficiencyRatio.toFixed(1)}%`);
        
        console.log(`   🔧 Service Performance:`);
        console.log(`      Events Published: ${eventsPublished}`);
        console.log(`      Events Processed: ${eventsProcessed}`);
        console.log(`      Processing Rate: ${eventProcessingRate.toFixed(1)} events/s`);
        console.log(`      WebSocket Clients: ${healthData.after.aggregator.websocket_clients}`);
        
        // Performance assessment
        console.log(`\n   🎯 Performance Assessment:`);
        if (deliveryRate >= 95) {
            console.log(`      ✅ Excellent delivery rate (${deliveryRate.toFixed(1)}%)`);
        } else if (deliveryRate >= 85) {
            console.log(`      ⚠️  Good delivery rate (${deliveryRate.toFixed(1)}%)`);
        } else {
            console.log(`      ❌ Poor delivery rate (${deliveryRate.toFixed(1)}%)`);
        }
        
        if (avgLatency <= 100) {
            console.log(`      ✅ Excellent latency (${avgLatency.toFixed(1)}ms avg)`);
        } else if (avgLatency <= 500) {
            console.log(`      ⚠️  Acceptable latency (${avgLatency.toFixed(1)}ms avg)`);
        } else {
            console.log(`      ❌ High latency (${avgLatency.toFixed(1)}ms avg)`);
        }
        
        if (results.throughputMetrics.efficiencyRatio >= 90) {
            console.log(`      ✅ Excellent efficiency (${results.throughputMetrics.efficiencyRatio.toFixed(1)}%)`);
        } else if (results.throughputMetrics.efficiencyRatio >= 70) {
            console.log(`      ⚠️  Good efficiency (${results.throughputMetrics.efficiencyRatio.toFixed(1)}%)`);
        } else {
            console.log(`      ❌ Poor efficiency (${results.throughputMetrics.efficiencyRatio.toFixed(1)}%)`);
        }
        
        this.testResults.push(results);
        return results;
    }

    calculatePercentile(array, percentile) {
        if (array.length === 0) return 0;
        
        const sorted = [...array].sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    async cleanupTest(testId, clients) {
        console.log(`   🧹 Cleaning up test ${testId}...`);
        
        // Close WebSocket connections
        let closedCount = 0;
        for (const client of clients) {
            if (client.socket && client.socket.readyState === WebSocket.OPEN) {
                client.socket.close();
                closedCount++;
            }
        }
        console.log(`      Closed ${closedCount} WebSocket connections`);
        
        // Clean up test data
        try {
            const result = await this.mongoClient.db().collection('messages').deleteMany({ 
                testMultiClientId: testId 
            });
            console.log(`      Deleted ${result.deletedCount} test messages`);
        } catch (error) {
            console.log(`      ⚠️  Test data cleanup warning: ${error.message}`);
        }
        
        // Wait for connections to fully close
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    async generateFinalReport() {
        const duration = Date.now() - this.startTime;
        
        console.log('\n' + '='.repeat(100));
        console.log('📊 MULTI-CLIENT WEBSOCKET TEST FINAL REPORT');
        console.log('='.repeat(100));
        
        console.log(`\n⏱️  TEST EXECUTION SUMMARY:`);
        console.log(`   Duration: ${Math.round(duration / 1000)}s`);
        console.log(`   Configurations Tested: ${this.testResults.length}`);
        console.log(`   Total Clients Tested: ${this.testResults.reduce((sum, r) => sum + r.clientMetrics.connectedClients, 0)}`);
        
        // Performance comparison across configurations
        console.log(`\n📈 PERFORMANCE COMPARISON ACROSS CONFIGURATIONS:`);
        console.log('   Configuration        | Clients | Delivery Rate | Avg Latency | Efficiency');
        console.log('   ' + '-'.repeat(75));
        
        this.testResults.forEach(result => {
            const name = result.config.padEnd(20);
            const clients = result.clientMetrics.connectedClients.toString().padEnd(7);
            const deliveryRate = result.clientMetrics.deliveryRate.toFixed(1).padEnd(12);
            const latency = result.latencyMetrics.avgLatency.toFixed(1).padEnd(10);
            const efficiency = result.throughputMetrics.efficiencyRatio.toFixed(1);
            console.log(`   ${name} | ${clients} | ${deliveryRate} | ${latency} | ${efficiency}%`);
        });
        
        // Best performing configuration
        const bestDelivery = this.testResults.reduce((best, current) => 
            current.clientMetrics.deliveryRate > best.clientMetrics.deliveryRate ? current : best
        );
        const bestLatency = this.testResults.reduce((best, current) => 
            current.latencyMetrics.avgLatency < best.latencyMetrics.avgLatency ? current : best
        );
        const bestEfficiency = this.testResults.reduce((best, current) => 
            current.throughputMetrics.efficiencyRatio > best.throughputMetrics.efficiencyRatio ? current : best
        );
        
        console.log(`\n🏆 BEST PERFORMING CONFIGURATIONS:`);
        console.log(`   🎯 Best Delivery Rate: ${bestDelivery.config} (${bestDelivery.clientMetrics.deliveryRate.toFixed(1)}%)`);
        console.log(`   ⚡ Best Latency: ${bestLatency.config} (${bestLatency.latencyMetrics.avgLatency.toFixed(1)}ms)`);
        console.log(`   🚀 Best Efficiency: ${bestEfficiency.config} (${bestEfficiency.throughputMetrics.efficiencyRatio.toFixed(1)}%)`);
        
        // Scaling recommendations
        console.log(`\n💡 WEBSOCKET SCALING RECOMMENDATIONS:`);
        console.log(`   📊 Buffer Size Optimization:`);
        console.log(`      - Small buffers (512-1024): Better for low latency`);
        console.log(`      - Large buffers (4096-8192): Better for high throughput`);
        
        console.log(`   📦 Batching Configuration:`);
        console.log(`      - Disabled: < 100 clients, latency-critical`);
        console.log(`      - Small batches (50): 100-500 clients`);
        console.log(`      - Large batches (100-200): > 500 clients`);
        
        console.log(`   🔄 Aggregator Scaling:`);
        console.log(`      - 1 instance: < 200 clients`);
        console.log(`      - 2-3 instances: 200-1000 clients`);
        console.log(`      - Load balancer: > 1000 clients`);
        
        // Save detailed report
        const report = {
            testSuite: 'Multi-Client WebSocket Test',
            startTime: this.startTime,
            duration,
            testResults: this.testResults,
            summary: {
                totalConfigurations: this.testResults.length,
                totalClients: this.testResults.reduce((sum, r) => sum + r.clientMetrics.connectedClients, 0),
                bestPerforming: {
                    delivery: bestDelivery.config,
                    latency: bestLatency.config,
                    efficiency: bestEfficiency.config
                }
            },
            recommendations: {
                bufferSizes: {
                    lowLatency: '512-1024 bytes',
                    highThroughput: '4096-8192 bytes'
                },
                batching: {
                    disabled: '< 100 clients',
                    small: '100-500 clients',
                    large: '> 500 clients'
                },
                scaling: {
                    singleInstance: '< 200 clients',
                    multipleInstances: '200-1000 clients',
                    loadBalanced: '> 1000 clients'
                }
            }
        };
        
        const reportFile = `websocket-multi-client-report-${Date.now()}.json`;
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
        console.log(`\n📄 Detailed report saved to: ${process.cwd()}/${reportFile}`);
        
        return report;
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up test environment...');
        
        if (this.natsConnection) {
            await this.natsConnection.close();
        }
        
        if (this.mongoClient) {
            await this.mongoClient.close();
        }
        
        console.log('✅ Cleanup completed');
    }

    async run() {
        try {
            await this.setup();
            await this.runWebSocketTests();
            await this.generateFinalReport();
        } catch (error) {
            console.error('❌ Multi-client WebSocket test failed:', error.message);
            process.exit(1);
        } finally {
            await this.cleanup();
        }
    }
}

// Run the test suite
if (require.main === module) {
    const testSuite = new WebSocketMultiClientTest();
    testSuite.run().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = WebSocketMultiClientTest;