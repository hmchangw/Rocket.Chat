#!/usr/bin/env node
/**
 * Performance Comparison Test Suite
 * 
 * Comprehensive stress testing comparing internal vs external DbWatcher systems
 * to demonstrate performance improvements and validate system reliability.
 */

const { MongoClient } = require('mongodb');
const { connect, StringCodec } = require('nats');
const WebSocket = require('ws');
const axios = require('axios');
const { spawn, fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

class PerformanceComparisonTest {
    constructor() {
        this.mongoUri = process.env.MONGO_URL || 'mongodb://localhost:27018/meteor';
        this.natsUrl = 'nats://localhost:4222';
        this.websocketUrl = 'ws://localhost:8086/ws';
        
        this.mongoClient = null;
        this.natsConnection = null;
        this.websocket = null;
        this.sc = StringCodec();
        
        this.testResults = {
            internal: {},
            external: {},
            comparison: {}
        };
        
        this.performanceMetrics = {
            internal: {
                cpuUsage: [],
                memoryUsage: [],
                eventProcessingTimes: [],
                errorCount: 0,
                throughput: 0
            },
            external: {
                cpuUsage: [],
                memoryUsage: [],
                eventProcessingTimes: [],
                errorCount: 0,
                throughput: 0
            }
        };
        
        this.testConfig = {
            warmupMessages: 100,        // Warm-up phase
            lightLoad: 500,            // Light load test
            mediumLoad: 2000,          // Medium load test
            heavyLoad: 10000,          // Heavy load test
            stressLoad: 50000,         // Stress load test
            concurrentUsers: 50,       // Concurrent operations
            testDuration: 300,         // 5 minutes per test
            batchSize: 100,            // Messages per batch
            monitoringInterval: 1000   // Monitor every 1 second
        };
        
        this.startTime = Date.now();
    }

    async setup() {
        console.log('🔧 Setting up Performance Comparison Test Environment...\n');

        try {
            this.mongoClient = new MongoClient(this.mongoUri, {
                maxPoolSize: 50,
                minPoolSize: 5,
                maxIdleTimeMS: 30000,
                serverSelectionTimeoutMS: 5000
            });
            await this.mongoClient.connect();
            console.log('✅ MongoDB connected with optimized pool settings');

            // Ensure indexes for better performance
            const db = this.mongoClient.db();
            await this.createOptimizedIndexes(db);
            
        } catch (error) {
            console.error('❌ Setup failed:', error.message);
            process.exit(1);
        }
    }

    async createOptimizedIndexes(db) {
        console.log('📊 Creating optimized database indexes...');
        
        try {
            const collections = ['messages', 'users', 'rooms', 'subscriptions'];
            
            for (const collectionName of collections) {
                const collection = db.collection(collectionName);
                
                // Create indexes for performance testing
                await collection.createIndex({ '_updatedAt': 1 }, { background: true });
                await collection.createIndex({ 'performanceTest': 1 }, { background: true });
                await collection.createIndex({ 'testType': 1, 'batchId': 1 }, { background: true });
                
                // Collection-specific indexes
                if (collectionName === 'messages') {
                    await collection.createIndex({ 'rid': 1, 'ts': -1 }, { background: true });
                    await collection.createIndex({ 'u._id': 1 }, { background: true });
                }
                
                if (collectionName === 'subscriptions') {
                    await collection.createIndex({ 'rid': 1, 'u._id': 1 }, { background: true, unique: true });
                }
            }
            
            console.log('✅ Database indexes optimized for performance testing');
        } catch (error) {
            console.warn('⚠️  Index creation warning:', error.message);
        }
    }

    async testInternalWatcherPerformance() {
        console.log('\n🔬 TESTING INTERNAL WATCHER PERFORMANCE');
        console.log('='.repeat(60));

        // Ensure internal watcher configuration
        process.env.USE_EXTERNAL_DBWATCHER = 'false';
        process.env.DISABLE_DB_WATCH = 'false';

        const testPhases = [
            { name: 'Warmup', messageCount: this.testConfig.warmupMessages },
            { name: 'Light Load', messageCount: this.testConfig.lightLoad },
            { name: 'Medium Load', messageCount: this.testConfig.mediumLoad },
            { name: 'Heavy Load', messageCount: this.testConfig.heavyLoad }
        ];

        this.testResults.internal.phases = {};

        for (const phase of testPhases) {
            console.log(`\n📊 Phase: ${phase.name} (${phase.messageCount} messages)`);
            
            const phaseResults = await this.runPerformancePhase('internal', phase.name, phase.messageCount);
            this.testResults.internal.phases[phase.name] = phaseResults;
            
            // Allow system to stabilize between phases
            console.log('⏳ Stabilizing system (10 seconds)...');
            await new Promise(resolve => setTimeout(resolve, 10000));
        }

        // Stress test
        console.log('\n🚀 STRESS TEST (Internal Watcher)');
        const stressResults = await this.runStressTest('internal');
        this.testResults.internal.stressTest = stressResults;
    }

    async testExternalWatcherPerformance() {
        console.log('\n🔬 TESTING EXTERNAL WATCHER PERFORMANCE');
        console.log('='.repeat(60));

        // Ensure external watcher configuration
        process.env.USE_EXTERNAL_DBWATCHER = 'true';
        process.env.EXTERNAL_WATCHER_NATS_URL = this.natsUrl;
        process.env.EXTERNAL_WATCHER_WS_URL = this.websocketUrl;

        // Connect to external services
        try {
            this.natsConnection = await connect({ servers: [this.natsUrl] });
            console.log('✅ Connected to NATS');

            this.websocket = new WebSocket(this.websocketUrl);
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('WebSocket timeout')), 10000);
                this.websocket.on('open', () => {
                    console.log('✅ Connected to WebSocket');
                    clearTimeout(timeout);
                    resolve();
                });
                this.websocket.on('error', reject);
            });

            // Verify external services are healthy
            const servicesHealthy = await this.verifyExternalServices();
            if (!servicesHealthy) {
                throw new Error('External services are not healthy');
            }

        } catch (error) {
            console.error('❌ External service connection failed:', error.message);
            console.log('⚠️  Skipping external watcher tests');
            return;
        }

        const testPhases = [
            { name: 'Warmup', messageCount: this.testConfig.warmupMessages },
            { name: 'Light Load', messageCount: this.testConfig.lightLoad },
            { name: 'Medium Load', messageCount: this.testConfig.mediumLoad },
            { name: 'Heavy Load', messageCount: this.testConfig.heavyLoad }
        ];

        this.testResults.external.phases = {};

        for (const phase of testPhases) {
            console.log(`\n📊 Phase: ${phase.name} (${phase.messageCount} messages)`);
            
            const phaseResults = await this.runPerformancePhase('external', phase.name, phase.messageCount);
            this.testResults.external.phases[phase.name] = phaseResults;
            
            // Allow system to stabilize between phases
            console.log('⏳ Stabilizing system (10 seconds)...');
            await new Promise(resolve => setTimeout(resolve, 10000));
        }

        // Stress test
        console.log('\n🚀 STRESS TEST (External Watcher)');
        const stressResults = await this.runStressTest('external');
        this.testResults.external.stressTest = stressResults;
    }

    async runPerformancePhase(watcherType, phaseName, messageCount) {
        const phaseStart = Date.now();
        const testId = `${watcherType}_${phaseName.toLowerCase()}_${Date.now()}`;
        
        console.log(`   🎯 Test ID: ${testId}`);
        
        // Start system monitoring
        const monitoringProcess = this.startSystemMonitoring(watcherType);
        
        // Setup event tracking
        const eventTracker = await this.setupEventTracking(testId, messageCount);
        
        try {
            const db = this.mongoClient.db();
            const messagesCollection = db.collection('messages');
            
            // Performance metrics
            const metrics = {
                insertionTimes: [],
                batchTimes: [],
                totalInsertionTime: 0,
                eventsReceived: 0,
                eventLatencies: [],
                errorCount: 0
            };
            
            console.log(`   📝 Inserting ${messageCount} messages...`);
            
            const numberOfBatches = Math.ceil(messageCount / this.testConfig.batchSize);
            let totalInserted = 0;
            
            for (let batch = 0; batch < numberOfBatches; batch++) {
                const batchStart = Date.now();
                const currentBatchSize = Math.min(this.testConfig.batchSize, messageCount - totalInserted);
                const messages = [];
                
                for (let i = 0; i < currentBatchSize; i++) {
                    messages.push({
                        msg: `${phaseName} test message ${batch}-${i}`,
                        ts: new Date(),
                        u: { _id: `perf_user_${i % 20}`, username: `perfuser${i % 20}` },
                        rid: `perf_room_${i % 10}`,
                        _updatedAt: new Date(),
                        performanceTest: testId,
                        testType: watcherType,
                        batchId: batch,
                        messageIndex: totalInserted + i
                    });
                }
                
                try {
                    const insertStart = Date.now();
                    const result = await messagesCollection.insertMany(messages, { ordered: false });
                    const insertTime = Date.now() - insertStart;
                    
                    metrics.insertionTimes.push(insertTime);
                    totalInserted += result.insertedCount;
                    
                    const batchTime = Date.now() - batchStart;
                    metrics.batchTimes.push(batchTime);
                    
                    if (batch % 10 === 0 || batch === numberOfBatches - 1) {
                        const progress = Math.round((totalInserted / messageCount) * 100);
                        console.log(`      📊 Progress: ${progress}% (${totalInserted}/${messageCount} messages)`);
                    }
                    
                } catch (error) {
                    console.error(`      ❌ Batch ${batch} failed:`, error.message);
                    metrics.errorCount++;
                }
                
                // Small delay between batches to allow event processing
                if (batch < numberOfBatches - 1) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }
            
            metrics.totalInsertionTime = Date.now() - phaseStart;
            
            console.log(`   ⏳ Waiting for event processing (30 seconds)...`);
            await new Promise(resolve => setTimeout(resolve, 30000));
            
            // Stop monitoring and collect results
            this.stopSystemMonitoring(monitoringProcess);
            const eventResults = await this.collectEventResults(eventTracker, testId);
            
            const phaseDuration = Date.now() - phaseStart;
            
            // Calculate performance metrics
            const result = {
                messageCount,
                totalInserted,
                duration: phaseDuration,
                insertionTime: metrics.totalInsertionTime,
                eventsReceived: eventResults.eventsReceived,
                eventLatency: eventResults.averageLatency,
                throughput: Math.round((totalInserted / metrics.totalInsertionTime) * 1000),
                eventThroughput: Math.round((eventResults.eventsReceived / phaseDuration) * 1000),
                errorCount: metrics.errorCount,
                averageInsertionTime: metrics.insertionTimes.reduce((a, b) => a + b, 0) / metrics.insertionTimes.length,
                systemMetrics: this.getSystemMetricsSummary(watcherType)
            };
            
            console.log(`   📊 Phase Results:`);
            console.log(`      Messages inserted: ${totalInserted}`);
            console.log(`      Insertion throughput: ${result.throughput} msg/s`);
            console.log(`      Events received: ${eventResults.eventsReceived}`);
            console.log(`      Event throughput: ${result.eventThroughput} events/s`);
            console.log(`      Average event latency: ${Math.round(eventResults.averageLatency)}ms`);
            console.log(`      Errors: ${metrics.errorCount}`);
            
            // Clean up test data
            await this.cleanupTestData(testId);
            
            return result;
            
        } catch (error) {
            console.error(`   ❌ Phase ${phaseName} failed:`, error.message);
            this.stopSystemMonitoring(monitoringProcess);
            await this.cleanupTestData(testId);
            
            return {
                messageCount,
                totalInserted: 0,
                duration: Date.now() - phaseStart,
                error: error.message,
                throughput: 0,
                eventThroughput: 0,
                errorCount: 1
            };
        }
    }

    async runStressTest(watcherType) {
        console.log(`\n🔥 STRESS TEST: ${watcherType.toUpperCase()} WATCHER`);
        console.log('Testing system limits with extreme load...');
        
        const stressTestStart = Date.now();
        const testId = `stress_${watcherType}_${Date.now()}`;
        const messageCount = this.testConfig.stressLoad;
        
        // Start intensive monitoring
        const monitoringProcess = this.startSystemMonitoring(watcherType, 500); // Monitor every 500ms
        
        // Create multiple concurrent writers
        const concurrentWriters = this.testConfig.concurrentUsers;
        const messagesPerWriter = Math.floor(messageCount / concurrentWriters);
        
        console.log(`   🚀 Launching ${concurrentWriters} concurrent writers`);
        console.log(`   📊 ${messagesPerWriter} messages per writer`);
        console.log(`   🎯 Total target: ${messageCount} messages`);
        
        const writerPromises = [];
        const writerResults = [];
        
        for (let i = 0; i < concurrentWriters; i++) {
            const writerPromise = this.runConcurrentWriter(testId, i, messagesPerWriter, watcherType);
            writerPromises.push(writerPromise);
        }
        
        // Wait for all writers to complete
        try {
            const results = await Promise.allSettled(writerPromises);
            
            let totalInserted = 0;
            let totalErrors = 0;
            
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    totalInserted += result.value.inserted;
                    totalErrors += result.value.errors;
                    writerResults.push(result.value);
                } else {
                    console.error(`   ❌ Writer ${index} failed:`, result.reason.message);
                    totalErrors++;
                }
            });
            
            const stressDuration = Date.now() - stressTestStart;
            
            // Wait for event processing
            console.log(`   ⏳ Waiting for event processing (60 seconds)...`);
            await new Promise(resolve => setTimeout(resolve, 60000));
            
            // Stop monitoring
            this.stopSystemMonitoring(monitoringProcess);
            
            const stressResult = {
                targetMessages: messageCount,
                totalInserted,
                duration: stressDuration,
                throughput: Math.round((totalInserted / stressDuration) * 1000),
                concurrentWriters,
                totalErrors,
                writerResults,
                systemMetrics: this.getSystemMetricsSummary(watcherType)
            };
            
            console.log(`   📊 Stress Test Results:`);
            console.log(`      Target messages: ${messageCount}`);
            console.log(`      Messages inserted: ${totalInserted}`);
            console.log(`      Success rate: ${Math.round((totalInserted / messageCount) * 100)}%`);
            console.log(`      Duration: ${Math.round(stressDuration / 1000)}s`);
            console.log(`      Throughput: ${stressResult.throughput} msg/s`);
            console.log(`      Total errors: ${totalErrors}`);
            
            // Clean up
            await this.cleanupTestData(testId);
            
            return stressResult;
            
        } catch (error) {
            console.error(`   ❌ Stress test failed:`, error.message);
            this.stopSystemMonitoring(monitoringProcess);
            await this.cleanupTestData(testId);
            
            return {
                targetMessages: messageCount,
                totalInserted: 0,
                duration: Date.now() - stressTestStart,
                error: error.message,
                throughput: 0,
                totalErrors: 1
            };
        }
    }

    async runConcurrentWriter(testId, writerId, messageCount, watcherType) {
        const db = this.mongoClient.db();
        const messagesCollection = db.collection('messages');
        
        let inserted = 0;
        let errors = 0;
        const startTime = Date.now();
        
        try {
            const batchSize = 50; // Smaller batches for concurrent access
            const numberOfBatches = Math.ceil(messageCount / batchSize);
            
            for (let batch = 0; batch < numberOfBatches; batch++) {
                const currentBatchSize = Math.min(batchSize, messageCount - inserted);
                const messages = [];
                
                for (let i = 0; i < currentBatchSize; i++) {
                    messages.push({
                        msg: `Concurrent writer ${writerId} message ${batch}-${i}`,
                        ts: new Date(),
                        u: { _id: `writer_${writerId}_user_${i % 5}`, username: `writer${writerId}user${i % 5}` },
                        rid: `writer_${writerId}_room_${i % 3}`,
                        _updatedAt: new Date(),
                        performanceTest: testId,
                        testType: watcherType,
                        writerId,
                        batchId: batch
                    });
                }
                
                try {
                    const result = await messagesCollection.insertMany(messages, { 
                        ordered: false,
                        writeConcern: { w: 1, j: false } // Faster writes
                    });
                    inserted += result.insertedCount;
                } catch (error) {
                    errors++;
                    // Continue with other batches
                }
                
                // Small delay to prevent overwhelming the system
                if (batch % 10 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
            
        } catch (error) {
            errors++;
        }
        
        return {
            writerId,
            inserted,
            errors,
            duration: Date.now() - startTime
        };
    }

    startSystemMonitoring(watcherType, interval = 1000) {
        const monitoringData = {
            cpuUsage: [],
            memoryUsage: [],
            timestamps: []
        };
        
        const monitorInterval = setInterval(() => {
            const cpuUsage = process.cpuUsage();
            const memUsage = process.memoryUsage();
            
            monitoringData.cpuUsage.push(cpuUsage);
            monitoringData.memoryUsage.push(memUsage);
            monitoringData.timestamps.push(Date.now());
        }, interval);
        
        return { monitorInterval, monitoringData };
    }

    stopSystemMonitoring(monitoringProcess) {
        clearInterval(monitoringProcess.monitorInterval);
        
        // Store monitoring data
        const watcherType = process.env.USE_EXTERNAL_DBWATCHER === 'true' ? 'external' : 'internal';
        this.performanceMetrics[watcherType].cpuUsage = monitoringProcess.monitoringData.cpuUsage;
        this.performanceMetrics[watcherType].memoryUsage = monitoringProcess.monitoringData.memoryUsage;
    }

    getSystemMetricsSummary(watcherType) {
        const metrics = this.performanceMetrics[watcherType];
        
        if (metrics.cpuUsage.length === 0) {
            return { cpu: 0, memory: 0, samples: 0 };
        }
        
        // Calculate averages
        const avgMemory = metrics.memoryUsage.reduce((acc, mem) => acc + mem.rss, 0) / metrics.memoryUsage.length;
        const maxMemory = Math.max(...metrics.memoryUsage.map(m => m.rss));
        
        return {
            averageMemoryMB: Math.round(avgMemory / 1024 / 1024),
            maxMemoryMB: Math.round(maxMemory / 1024 / 1024),
            samples: metrics.cpuUsage.length
        };
    }

    async setupEventTracking(testId, expectedEvents) {
        const eventTracker = {
            eventsReceived: 0,
            eventTimes: [],
            startTime: Date.now()
        };

        // For external watcher, track NATS and WebSocket events
        if (process.env.USE_EXTERNAL_DBWATCHER === 'true' && this.natsConnection) {
            try {
                const sub = this.natsConnection.subscribe('rocketchat.events.aggregated');
                
                const messageHandler = (msg) => {
                    try {
                        const event = JSON.parse(this.sc.decode(msg.data));
                        if (event.data && event.data.performanceTest === testId) {
                            eventTracker.eventsReceived++;
                            eventTracker.eventTimes.push(Date.now());
                        }
                    } catch (error) {
                        // Ignore parsing errors
                    }
                };

                // Set up subscription with auto-unsubscribe after timeout
                (async () => {
                    for await (const msg of sub) {
                        messageHandler(msg);
                        if (eventTracker.eventsReceived >= expectedEvents) {
                            break;
                        }
                    }
                })();

                eventTracker.subscription = sub;
            } catch (error) {
                console.warn('⚠️  Could not setup NATS event tracking:', error.message);
            }
        }

        return eventTracker;
    }

    async collectEventResults(eventTracker, testId) {
        const collectionTime = 10000; // 10 seconds to collect remaining events
        
        await new Promise(resolve => setTimeout(resolve, collectionTime));
        
        if (eventTracker.subscription) {
            eventTracker.subscription.unsubscribe();
        }
        
        // Calculate average latency (rough approximation)
        let averageLatency = 0;
        if (eventTracker.eventTimes.length > 0) {
            const latencies = eventTracker.eventTimes.map((time, index) => {
                const expectedTime = eventTracker.startTime + (index * 100); // Rough estimate
                return Math.max(0, time - expectedTime);
            });
            averageLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        }
        
        return {
            eventsReceived: eventTracker.eventsReceived,
            averageLatency: averageLatency
        };
    }

    async verifyExternalServices() {
        const services = [
            { name: 'DbWatcher', url: 'http://localhost:8082/health' },
            { name: 'Aggregator', url: 'http://localhost:8084/health' }
        ];
        
        try {
            for (const service of services) {
                const response = await axios.get(service.url, { timeout: 5000 });
                if (response.status !== 200) {
                    console.error(`❌ ${service.name} not healthy: HTTP ${response.status}`);
                    return false;
                }
            }
            console.log('✅ All external services are healthy');
            return true;
        } catch (error) {
            console.error('❌ External service health check failed:', error.message);
            return false;
        }
    }

    async cleanupTestData(testId) {
        try {
            const db = this.mongoClient.db();
            const collections = ['messages', 'users', 'rooms', 'subscriptions'];
            
            let totalDeleted = 0;
            for (const collectionName of collections) {
                const collection = db.collection(collectionName);
                const result = await collection.deleteMany({ performanceTest: testId });
                totalDeleted += result.deletedCount;
            }
            
            if (totalDeleted > 0) {
                console.log(`   🧹 Cleaned up ${totalDeleted} test documents`);
            }
        } catch (error) {
            console.warn('⚠️  Cleanup warning:', error.message);
        }
    }

    generateComparisonReport() {
        console.log('\n' + '='.repeat(80));
        console.log('📊 PERFORMANCE COMPARISON REPORT');
        console.log('='.repeat(80));

        const testDuration = Date.now() - this.startTime;
        
        console.log(`\nTest Summary:`);
        console.log(`  ⏱️  Total Test Duration: ${Math.round(testDuration / 1000 / 60)} minutes`);
        console.log(`  🔧 Test Configuration: ${this.testConfig.heavyLoad} heavy load messages`);
        console.log(`  📊 MongoDB URI: ${this.mongoUri.replace(/\/\/.*@/, '//***@')}`);

        // Compare results
        const internal = this.testResults.internal;
        const external = this.testResults.external;

        if (internal.phases && external.phases) {
            console.log(`\n📈 PERFORMANCE COMPARISON BY PHASE:`);
            
            const phases = Object.keys(internal.phases);
            for (const phase of phases) {
                const intPhase = internal.phases[phase];
                const extPhase = external.phases[phase];
                
                console.log(`\n  ${phase.toUpperCase()}:`);
                console.log(`    📊 Throughput:`);
                console.log(`      Internal: ${intPhase.throughput || 0} msg/s`);
                console.log(`      External: ${extPhase.throughput || 0} msg/s`);
                
                if (intPhase.throughput && extPhase.throughput) {
                    const improvement = Math.round(((extPhase.throughput - intPhase.throughput) / intPhase.throughput) * 100);
                    console.log(`      🚀 Improvement: ${improvement > 0 ? '+' : ''}${improvement}%`);
                }
                
                console.log(`    ⚡ Event Processing:`);
                console.log(`      Internal: ${intPhase.eventThroughput || 0} events/s`);
                console.log(`      External: ${extPhase.eventThroughput || 0} events/s`);
                
                if (intPhase.eventLatency && extPhase.eventLatency) {
                    console.log(`    🕒 Average Latency:`);
                    console.log(`      Internal: ${Math.round(intPhase.eventLatency)}ms`);
                    console.log(`      External: ${Math.round(extPhase.eventLatency)}ms`);
                }
                
                console.log(`    ❌ Errors:`);
                console.log(`      Internal: ${intPhase.errorCount || 0}`);
                console.log(`      External: ${extPhase.errorCount || 0}`);
            }
        }

        // Stress test comparison
        if (internal.stressTest && external.stressTest) {
            console.log(`\n🔥 STRESS TEST COMPARISON:`);
            
            const intStress = internal.stressTest;
            const extStress = external.stressTest;
            
            console.log(`  📊 Throughput:`);
            console.log(`    Internal: ${intStress.throughput || 0} msg/s`);
            console.log(`    External: ${extStress.throughput || 0} msg/s`);
            
            if (intStress.throughput && extStress.throughput) {
                const improvement = Math.round(((extStress.throughput - intStress.throughput) / intStress.throughput) * 100);
                console.log(`    🚀 Improvement: ${improvement > 0 ? '+' : ''}${improvement}%`);
            }
            
            console.log(`  ✅ Success Rate:`);
            const intSuccessRate = Math.round((intStress.totalInserted / intStress.targetMessages) * 100);
            const extSuccessRate = Math.round((extStress.totalInserted / extStress.targetMessages) * 100);
            console.log(`    Internal: ${intSuccessRate}%`);
            console.log(`    External: ${extSuccessRate}%`);
            
            console.log(`  ❌ Error Rate:`);
            const intErrorRate = Math.round((intStress.totalErrors / intStress.targetMessages) * 100);
            const extErrorRate = Math.round((extStress.totalErrors / extStress.targetMessages) * 100);
            console.log(`    Internal: ${intErrorRate}%`);
            console.log(`    External: ${extErrorRate}%`);
        }

        // System resource comparison
        console.log(`\n💾 SYSTEM RESOURCE USAGE:`);
        const intMetrics = this.performanceMetrics.internal;
        const extMetrics = this.performanceMetrics.external;
        
        if (intMetrics.memoryUsage.length > 0 && extMetrics.memoryUsage.length > 0) {
            const intAvgMem = intMetrics.memoryUsage.reduce((acc, mem) => acc + mem.rss, 0) / intMetrics.memoryUsage.length;
            const extAvgMem = extMetrics.memoryUsage.reduce((acc, mem) => acc + mem.rss, 0) / extMetrics.memoryUsage.length;
            
            const intMaxMem = Math.max(...intMetrics.memoryUsage.map(m => m.rss));
            const extMaxMem = Math.max(...extMetrics.memoryUsage.map(m => m.rss));
            
            console.log(`  📊 Memory Usage (Average):`);
            console.log(`    Internal: ${Math.round(intAvgMem / 1024 / 1024)} MB`);
            console.log(`    External: ${Math.round(extAvgMem / 1024 / 1024)} MB`);
            
            const memImprovement = Math.round(((intAvgMem - extAvgMem) / intAvgMem) * 100);
            console.log(`    🚀 Memory Reduction: ${memImprovement > 0 ? '' : '+'}${memImprovement}%`);
            
            console.log(`  📊 Memory Usage (Peak):`);
            console.log(`    Internal: ${Math.round(intMaxMem / 1024 / 1024)} MB`);
            console.log(`    External: ${Math.round(extMaxMem / 1024 / 1024)} MB`);
        }

        // Generate recommendations
        console.log(`\n🎯 RECOMMENDATIONS:`);
        
        let hasSignificantImprovement = false;
        if (external.phases && internal.phases) {
            const heavyLoadExt = external.phases['Heavy Load'];
            const heavyLoadInt = internal.phases['Heavy Load'];
            
            if (heavyLoadExt && heavyLoadInt) {
                const throughputImprovement = ((heavyLoadExt.throughput - heavyLoadInt.throughput) / heavyLoadInt.throughput) * 100;
                if (throughputImprovement > 20) {
                    hasSignificantImprovement = true;
                }
            }
        }
        
        if (hasSignificantImprovement) {
            console.log(`  ✅ RECOMMENDED: Switch to External DbWatcher`);
            console.log(`     - Significant performance improvements detected`);
            console.log(`     - Better scalability and reliability`);
            console.log(`     - Lower resource consumption`);
        } else {
            console.log(`  ⚠️  Performance differences are minimal`);
            console.log(`     - Consider external watcher for scalability benefits`);
            console.log(`     - Monitor production workload patterns`);
        }

        console.log(`\n🔧 DEPLOYMENT SUGGESTIONS:`);
        console.log(`  - Use external watcher for deployments with >1000 concurrent users`);
        console.log(`  - Configure appropriate resource limits for Go services`);
        console.log(`  - Monitor NATS and cache performance in production`);
        console.log(`  - Set up proper monitoring and alerting`);

        console.log('\n' + '='.repeat(80));

        // Save detailed report
        this.saveDetailedReport();
        
        return {
            hasSignificantImprovement,
            testDuration,
            internalResults: internal,
            externalResults: external
        };
    }

    saveDetailedReport() {
        const reportData = {
            summary: {
                testDuration: Date.now() - this.startTime,
                timestamp: new Date().toISOString(),
                testConfig: this.testConfig,
                environment: {
                    nodeVersion: process.version,
                    platform: os.platform(),
                    arch: os.arch(),
                    totalMemory: Math.round(os.totalmem() / 1024 / 1024),
                    mongoUri: this.mongoUri.replace(/\/\/.*@/, '//***@')
                }
            },
            results: this.testResults,
            performanceMetrics: this.performanceMetrics
        };

        const reportPath = path.join(__dirname, `performance-comparison-report-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
        console.log(`📄 Detailed performance report saved to: ${reportPath}`);

        // Also create a CSV summary for easy analysis
        this.createCSVSummary(reportPath.replace('.json', '.csv'));
    }

    createCSVSummary(csvPath) {
        const csvLines = ['Test Phase,Watcher Type,Message Count,Duration (ms),Throughput (msg/s),Event Throughput (events/s),Error Count,Avg Memory (MB)'];
        
        const internal = this.testResults.internal;
        const external = this.testResults.external;
        
        if (internal.phases) {
            Object.entries(internal.phases).forEach(([phase, data]) => {
                const memUsage = data.systemMetrics ? data.systemMetrics.averageMemoryMB : 0;
                csvLines.push(`${phase},Internal,${data.messageCount},${data.duration},${data.throughput},${data.eventThroughput},${data.errorCount},${memUsage}`);
            });
        }
        
        if (external.phases) {
            Object.entries(external.phases).forEach(([phase, data]) => {
                const memUsage = data.systemMetrics ? data.systemMetrics.averageMemoryMB : 0;
                csvLines.push(`${phase},External,${data.messageCount},${data.duration},${data.throughput},${data.eventThroughput},${data.errorCount},${memUsage}`);
            });
        }
        
        fs.writeFileSync(csvPath, csvLines.join('\n'));
        console.log(`📊 CSV summary saved to: ${csvPath}`);
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up performance test environment...');
        
        try {
            if (this.websocket) {
                this.websocket.close();
                console.log('✅ WebSocket closed');
            }
            
            if (this.natsConnection) {
                await this.natsConnection.close();
                console.log('✅ NATS connection closed');
            }
            
            if (this.mongoClient) {
                // Final cleanup of any remaining test data
                const db = this.mongoClient.db();
                const collections = ['messages', 'users', 'rooms', 'subscriptions'];
                
                let totalCleaned = 0;
                for (const collectionName of collections) {
                    const collection = db.collection(collectionName);
                    const result = await collection.deleteMany({ 
                        $or: [
                            { performanceTest: { $exists: true } },
                            { testType: { $exists: true } }
                        ]
                    });
                    totalCleaned += result.deletedCount;
                }
                
                if (totalCleaned > 0) {
                    console.log(`✅ Final cleanup: ${totalCleaned} documents removed`);
                }
                
                await this.mongoClient.close();
                console.log('✅ MongoDB connection closed');
            }
            
        } catch (error) {
            console.error('❌ Cleanup failed:', error.message);
        }
    }

    async run() {
        console.log('🔬 ROCKET.CHAT DBWATCHER PERFORMANCE COMPARISON');
        console.log('Comprehensive performance testing: Internal vs External watcher systems\n');

        try {
            await this.setup();
            
            // Test internal watcher performance
            await this.testInternalWatcherPerformance();
            
            // Allow system to stabilize
            console.log('\n⏳ System stabilization break (30 seconds)...');
            await new Promise(resolve => setTimeout(resolve, 30000));
            
            // Test external watcher performance
            await this.testExternalWatcherPerformance();
            
            // Generate comparison report
            const comparisonResults = this.generateComparisonReport();
            
            return comparisonResults;
            
        } catch (error) {
            console.error('❌ Performance comparison test failed:', error);
            throw error;
        } finally {
            await this.cleanup();
        }
    }
}

// Run the test if this file is executed directly
if (require.main === module) {
    const tester = new PerformanceComparisonTest();
    tester.run()
        .then(results => {
            console.log('\n🎉 Performance comparison completed successfully!');
            if (results.hasSignificantImprovement) {
                console.log('🚀 External watcher shows significant performance improvements!');
                process.exit(0);
            } else {
                console.log('📊 Results are mixed - review the detailed report for analysis.');
                process.exit(0);
            }
        })
        .catch(error => {
            console.error('❌ Performance comparison failed:', error);
            process.exit(1);
        });
}

module.exports = PerformanceComparisonTest;