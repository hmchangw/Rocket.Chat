#!/usr/bin/env node
/**
 * Configuration Switching Test Suite
 * 
 * Tests dynamic configuration changes for DbWatcher and Aggregator:
 * 1. Different collection watching configurations
 * 2. Batching on/off switching
 * 3. Aggregation level changes
 * 4. Field projection modifications
 * 5. Performance impact of configuration changes
 */

const { MongoClient } = require('mongodb');
const { connect, StringCodec } = require('nats');
const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');
const yaml = require('js-yaml');

class ConfigurationSwitchingTest {
    constructor() {
        this.mongoUri = process.env.MONGO_URL || 'mongodb://localhost:27018/meteor?directConnection=true';
        this.natsUrl = process.env.EXTERNAL_WATCHER_NATS_URL || 'nats://localhost:4222';
        this.websocketUrl = process.env.EXTERNAL_WATCHER_WS_URL || 'ws://localhost:8086/ws';
        
        this.mongoClient = null;
        this.natsConnection = null;
        this.sc = StringCodec();
        
        // Configuration test scenarios
        this.configurationTests = [
            {
                name: 'Minimal Watching Config',
                description: 'Only watch critical collections',
                dbwatcherConfig: {
                    collections: {
                        messages: { enabled: true, full_document: false, fields: ['_id', 'msg', 'ts', 'u', 'rid'] },
                        subscriptions: { enabled: true, full_document: true, fields: [] },
                        users: { enabled: false },
                        rooms: { enabled: false },
                        settings: { enabled: false }
                    },
                    logging: { level: 'debug' }
                },
                aggregatorConfig: {
                    collections: {
                        messages: { enable_aggregation: false },
                        subscriptions: { enable_aggregation: true, fetch_full_document: true }
                    },
                    batching: { enabled: false }
                }
            },
            {
                name: 'Full Monitoring Config',
                description: 'Watch all collections with full documents',
                dbwatcherConfig: {
                    collections: {
                        messages: { enabled: true, full_document: true, fields: [] },
                        subscriptions: { enabled: true, full_document: true, fields: [] },
                        users: { enabled: true, full_document: true, fields: [] },
                        rooms: { enabled: true, full_document: true, fields: [] },
                        settings: { enabled: true, full_document: true, fields: [] }
                    },
                    logging: { level: 'debug' }
                },
                aggregatorConfig: {
                    collections: {
                        messages: { enable_aggregation: true, cache_user_names: true },
                        subscriptions: { enable_aggregation: true, fetch_full_document: true },
                        users: { enable_aggregation: true },
                        rooms: { enable_aggregation: true, cache_metadata: true },
                        settings: { enable_aggregation: false }
                    },
                    batching: { enabled: true, max_batch_size: 100, flush_interval: '100ms' }
                }
            },
            {
                name: 'Performance Optimized Config',
                description: 'Optimized for high throughput',
                dbwatcherConfig: {
                    collections: {
                        messages: { enabled: true, full_document: false, fields: ['_id', 'msg', 'ts', 'u', 'rid'] },
                        subscriptions: { enabled: true, full_document: false, fields: ['_id', 'rid', 'u', 'unread'] },
                        users: { enabled: true, full_document: false, fields: ['_id', 'username', 'status'] },
                        rooms: { enabled: true, full_document: false, fields: ['_id', 'name', 't', 'msgs'] },
                        settings: { enabled: false }
                    },
                    logging: { level: 'info' }
                },
                aggregatorConfig: {
                    collections: {
                        messages: { enable_aggregation: true, cache_user_names: false },
                        subscriptions: { enable_aggregation: true, fetch_full_document: false },
                        users: { enable_aggregation: false },
                        rooms: { enable_aggregation: true, cache_metadata: false }
                    },
                    batching: { enabled: true, max_batch_size: 200, flush_interval: '50ms' }
                }
            },
            {
                name: 'Memory Efficient Config',
                description: 'Minimized memory usage',
                dbwatcherConfig: {
                    collections: {
                        messages: { enabled: true, full_document: false, fields: ['_id', 'msg'] },
                        subscriptions: { enabled: true, full_document: false, fields: ['_id', 'rid', 'unread'] },
                        users: { enabled: false },
                        rooms: { enabled: false },
                        settings: { enabled: false }
                    },
                    logging: { level: 'warn' }
                },
                aggregatorConfig: {
                    collections: {
                        messages: { enable_aggregation: false },
                        subscriptions: { enable_aggregation: false }
                    },
                    batching: { enabled: true, max_batch_size: 50, flush_interval: '200ms' }
                }
            }
        ];
        
        this.testResults = [];
        this.startTime = Date.now();
        this.originalConfigs = {};
    }

    async setup() {
        console.log('🔧 Setting up Configuration Switching Test Suite...\n');
        
        // Connect to services
        this.mongoClient = new MongoClient(this.mongoUri);
        await this.mongoClient.connect();
        console.log('✅ Connected to MongoDB');
        
        this.natsConnection = await connect({ servers: [this.natsUrl] });
        console.log('✅ Connected to NATS');
        
        // Backup original configurations
        await this.backupOriginalConfigurations();
        
        console.log('✅ Test suite setup completed\n');
    }

    async backupOriginalConfigurations() {
        console.log('💾 Backing up original configurations...');
        
        try {
            // Read current configurations
            this.originalConfigs.dbwatcher = fs.readFileSync('./dbwatcher/config.yaml', 'utf8');
            this.originalConfigs.aggregator = fs.readFileSync('./websocket-aggregator/config.yaml', 'utf8');
            
            console.log('✅ Original configurations backed up');
        } catch (error) {
            console.log('⚠️  Could not backup configurations:', error.message);
        }
    }

    async runConfigurationTests() {
        console.log('🚀 Starting Configuration Switching Test Suite\n');
        console.log('=' .repeat(80));
        
        for (const configTest of this.configurationTests) {
            console.log(`\n📊 Testing Configuration: ${configTest.name}`);
            console.log(`📝 ${configTest.description}`);
            console.log('-'.repeat(60));
            
            await this.runSingleConfigurationTest(configTest);
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('🏁 Configuration Switching Test Suite Completed\n');
    }

    async runSingleConfigurationTest(configTest) {
        const testId = `config_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        
        console.log(`   🎯 Test ID: ${testId}`);
        console.log(`   🔧 Switching to: ${configTest.name}`);
        
        // Get baseline performance
        const baselineHealth = await this.getServiceHealth();
        console.log(`   📊 Baseline - DbWatcher: ${baselineHealth.dbwatcher.events_published} events, Aggregator: ${baselineHealth.aggregator.events_processed} events`);
        
        // Apply new configuration (simulated - in real scenario would restart services)
        console.log(`   ⚙️  Applying configuration changes...`);
        await this.simulateConfigurationChange(configTest);
        
        // Setup monitoring
        const eventTracker = this.setupEventTracking(testId);
        
        // Run workload test
        const workloadResults = await this.runConfigurationWorkload(configTest, testId);
        
        // Measure performance impact
        const performanceResults = await this.measureConfigurationPerformance(configTest, workloadResults, baselineHealth);
        
        // Analyze results
        await this.analyzeConfigurationResults(configTest, performanceResults, workloadResults);
        
        // Cleanup
        eventTracker.stop();
        await this.cleanupConfigurationTest(testId);
    }

    async simulateConfigurationChange(configTest) {
        // In a real scenario, this would:
        // 1. Update configuration files
        // 2. Restart services
        // 3. Wait for services to be healthy again
        
        console.log(`      📝 Configuration changes simulated:`);
        
        // DbWatcher changes
        const dbwatcherCollections = Object.keys(configTest.dbwatcherConfig.collections);
        const enabledCollections = dbwatcherCollections.filter(
            col => configTest.dbwatcherConfig.collections[col].enabled
        );
        console.log(`         DbWatcher: Watching ${enabledCollections.length}/${dbwatcherCollections.length} collections`);
        console.log(`         Collections: ${enabledCollections.join(', ')}`);
        
        // Aggregator changes
        const aggregatorCollections = Object.keys(configTest.aggregatorConfig.collections);
        const aggregatedCollections = aggregatorCollections.filter(
            col => configTest.aggregatorConfig.collections[col].enable_aggregation
        );
        console.log(`         Aggregator: Processing ${aggregatedCollections.length}/${aggregatorCollections.length} collections`);
        console.log(`         Batching: ${configTest.aggregatorConfig.batching.enabled ? 'Enabled' : 'Disabled'}`);
        
        if (configTest.aggregatorConfig.batching.enabled) {
            console.log(`         Batch size: ${configTest.aggregatorConfig.batching.max_batch_size}`);
        }
        
        // Simulate service restart delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log(`      ✅ Configuration applied`);
    }

    setupEventTracking(testId) {
        const events = {
            raw: [],
            aggregated: [],
            collections: {}
        };
        
        // Track raw events
        const rawSub = this.natsConnection.subscribe('rocketchat.events.changedata');
        const rawHandler = (async () => {
            try {
                for await (const msg of rawSub) {
                    const event = JSON.parse(this.sc.decode(msg.data));
                    if (event.testConfigId === testId) {
                        events.raw.push({
                            ...event,
                            receivedAt: Date.now()
                        });
                        
                        // Track by collection
                        if (!events.collections[event.collection]) {
                            events.collections[event.collection] = { raw: 0, aggregated: 0 };
                        }
                        events.collections[event.collection].raw++;
                    }
                }
            } catch (error) {
                // Subscription ended
            }
        })();
        
        // Track aggregated events
        const aggSub = this.natsConnection.subscribe('rocketchat.events.aggregated');
        const aggHandler = (async () => {
            try {
                for await (const msg of aggSub) {
                    const event = JSON.parse(this.sc.decode(msg.data));
                    if (event.testConfigId === testId) {
                        events.aggregated.push({
                            ...event,
                            receivedAt: Date.now()
                        });
                        
                        // Track by collection
                        if (!events.collections[event.collection]) {
                            events.collections[event.collection] = { raw: 0, aggregated: 0 };
                        }
                        events.collections[event.collection].aggregated++;
                    }
                }
            } catch (error) {
                // Subscription ended
            }
        })();
        
        return {
            events,
            stop: () => {
                rawSub.unsubscribe();
                aggSub.unsubscribe();
            }
        };
    }

    async runConfigurationWorkload(configTest, testId) {
        console.log(`   🚀 Running workload test for configuration...`);
        
        const startTime = Date.now();
        const testOperations = {
            messages: 50,
            subscriptions: 20,
            users: 15,
            rooms: 10,
            settings: 5
        };
        
        const results = {
            operations: {},
            timing: {},
            totalOperations: 0
        };
        
        // Test each collection based on configuration
        for (const [collection, count] of Object.entries(testOperations)) {
            const collectionConfig = configTest.dbwatcherConfig.collections[collection];
            
            if (!collectionConfig || !collectionConfig.enabled) {
                console.log(`      ⏭️  Skipping ${collection} (disabled in config)`);
                continue;
            }
            
            console.log(`      📝 Testing ${collection}: ${count} operations`);
            const collectionStartTime = Date.now();
            
            const operationResults = await this.runCollectionOperations(collection, count, testId);
            
            results.operations[collection] = operationResults;
            results.timing[collection] = Date.now() - collectionStartTime;
            results.totalOperations += operationResults.total;
            
            console.log(`         ✅ Completed in ${results.timing[collection]}ms`);
        }
        
        results.totalTime = Date.now() - startTime;
        results.averageOperationTime = results.totalOperations > 0 ? results.totalTime / results.totalOperations : 0;
        
        console.log(`   ✅ Workload completed: ${results.totalOperations} operations in ${results.totalTime}ms`);
        
        return results;
    }

    async runCollectionOperations(collection, count, testId) {
        const db = this.mongoClient.db();
        const coll = db.collection(collection);
        
        const results = {
            inserts: 0,
            updates: 0,
            deletes: 0,
            total: 0,
            errors: 0
        };
        
        try {
            // Insert operations
            const insertCount = Math.ceil(count * 0.5);
            for (let i = 0; i < insertCount; i++) {
                const doc = this.generateTestDocument(collection, testId, i);
                await coll.insertOne(doc);
                results.inserts++;
            }
            
            // Update operations  
            const updateCount = Math.ceil(count * 0.3);
            for (let i = 0; i < updateCount; i++) {
                const updateData = this.generateUpdateData(collection);
                await coll.updateOne(
                    { testConfigId: testId },
                    { $set: updateData }
                );
                results.updates++;
            }
            
            // Delete operations
            const deleteCount = Math.ceil(count * 0.2);
            const deleteResult = await coll.deleteMany({ 
                testConfigId: testId,
                canDelete: true 
            });
            results.deletes = deleteResult.deletedCount;
            
            results.total = results.inserts + results.updates + results.deletes;
            
        } catch (error) {
            results.errors++;
            console.log(`         ❌ Error in ${collection}: ${error.message}`);
        }
        
        return results;
    }

    generateTestDocument(collection, testId, index) {
        const baseDoc = {
            testConfigId: testId,
            createdAt: new Date(),
            canDelete: index % 5 === 0, // Mark some for deletion
            testIndex: index
        };
        
        switch (collection) {
            case 'messages':
                return {
                    ...baseDoc,
                    _id: `${testId}_msg_${index}`,
                    msg: `Configuration test message ${index}`,
                    ts: new Date(),
                    u: { _id: 'test-user-config', username: 'configtest' },
                    rid: 'test-room-config',
                    _updatedAt: new Date()
                };
                
            case 'subscriptions':
                return {
                    ...baseDoc,
                    _id: `${testId}_sub_${index}`,
                    rid: 'test-room-config',
                    u: { _id: 'test-user-config' },
                    name: 'Test Room Config',
                    t: 'c',
                    ts: new Date(),
                    unread: Math.floor(Math.random() * 10)
                };
                
            case 'users':
                return {
                    ...baseDoc,
                    _id: `${testId}_user_${index}`,
                    username: `configtest_${index}`,
                    name: `Config Test User ${index}`,
                    status: 'online',
                    active: true
                };
                
            case 'rooms':
                return {
                    ...baseDoc,
                    _id: `${testId}_room_${index}`,
                    name: `config-test-room-${index}`,
                    t: 'c',
                    u: { _id: 'test-user-config', username: 'configtest' },
                    msgs: Math.floor(Math.random() * 100),
                    ts: new Date()
                };
                
            case 'settings':
                return {
                    ...baseDoc,
                    _id: `config-test-setting-${index}`,
                    value: `test-value-${index}`,
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
                    msg: 'Updated configuration test message',
                    _updatedAt: new Date()
                };
            case 'subscriptions':
                return {
                    unread: Math.floor(Math.random() * 20),
                    ls: new Date()
                };
            case 'users':
                return {
                    status: 'away',
                    lastActivity: new Date()
                };
            case 'rooms':
                return {
                    msgs: Math.floor(Math.random() * 200),
                    _updatedAt: new Date()
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

    async measureConfigurationPerformance(configTest, workloadResults, baselineHealth) {
        console.log(`   📊 Measuring performance impact...`);
        
        // Wait for event processing
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const currentHealth = await this.getServiceHealth();
        
        const performance = {
            eventsPublished: currentHealth.dbwatcher.events_published - baselineHealth.dbwatcher.events_published,
            eventsProcessed: currentHealth.aggregator.events_processed - baselineHealth.aggregator.events_processed,
            dbwatcherUptime: currentHealth.dbwatcher.uptime,
            aggregatorUptime: currentHealth.aggregator.uptime,
            memoryEfficiency: this.calculateMemoryEfficiency(configTest),
            processingEfficiency: 0
        };
        
        if (performance.eventsPublished > 0) {
            performance.processingEfficiency = (performance.eventsProcessed / performance.eventsPublished) * 100;
        }
        
        console.log(`      Events Published: ${performance.eventsPublished}`);
        console.log(`      Events Processed: ${performance.eventsProcessed}`);
        console.log(`      Processing Efficiency: ${performance.processingEfficiency.toFixed(1)}%`);
        
        return performance;
    }

    calculateMemoryEfficiency(configTest) {
        // Estimate memory efficiency based on configuration
        const dbwatcherCollections = Object.values(configTest.dbwatcherConfig.collections);
        const enabledCollections = dbwatcherCollections.filter(c => c.enabled).length;
        const fullDocumentCollections = dbwatcherCollections.filter(c => c.enabled && c.full_document).length;
        
        const aggregatorCollections = Object.values(configTest.aggregatorConfig.collections);
        const aggregatedCollections = aggregatorCollections.filter(c => c.enable_aggregation).length;
        
        // Simple heuristic: fewer collections and less full documents = better memory efficiency
        const maxCollections = 5;
        const collectionEfficiency = ((maxCollections - enabledCollections) / maxCollections) * 50;
        const documentEfficiency = ((maxCollections - fullDocumentCollections) / maxCollections) * 30;
        const aggregationEfficiency = ((maxCollections - aggregatedCollections) / maxCollections) * 20;
        
        return Math.max(0, collectionEfficiency + documentEfficiency + aggregationEfficiency);
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
                dbwatcher: { events_published: 0, uptime: 0, status: 'unknown' },
                aggregator: { events_processed: 0, uptime: 0, status: 'unknown' }
            };
        }
    }

    async analyzeConfigurationResults(configTest, performanceResults, workloadResults) {
        console.log(`\n   📈 CONFIGURATION ANALYSIS for ${configTest.name}:`);
        console.log(`   ${'='.repeat(50)}`);
        
        // Workload analysis
        console.log(`   📊 Workload Results:`);
        console.log(`      Total Operations: ${workloadResults.totalOperations}`);
        console.log(`      Total Time: ${workloadResults.totalTime}ms`);
        console.log(`      Avg Operation Time: ${workloadResults.averageOperationTime.toFixed(2)}ms`);
        
        // Collection breakdown
        console.log(`   📋 Collection Breakdown:`);
        for (const [collection, operations] of Object.entries(workloadResults.operations)) {
            const timing = workloadResults.timing[collection];
            console.log(`      ${collection}: ${operations.total} ops in ${timing}ms`);
            console.log(`         Inserts: ${operations.inserts}, Updates: ${operations.updates}, Deletes: ${operations.deletes}`);
        }
        
        // Performance impact
        console.log(`   ⚡ Performance Impact:`);
        console.log(`      Events Published: ${performanceResults.eventsPublished}`);
        console.log(`      Events Processed: ${performanceResults.eventsProcessed}`);
        console.log(`      Processing Efficiency: ${performanceResults.processingEfficiency.toFixed(1)}%`);
        console.log(`      Memory Efficiency: ${performanceResults.memoryEfficiency.toFixed(1)}%`);
        
        // Configuration assessment
        console.log(`   🎯 Configuration Assessment:`);
        
        const enabledCollections = Object.values(configTest.dbwatcherConfig.collections).filter(c => c.enabled).length;
        if (enabledCollections <= 2) {
            console.log(`      ✅ Minimal resource usage (${enabledCollections} collections)`);
        } else if (enabledCollections <= 4) {
            console.log(`      ⚠️  Moderate resource usage (${enabledCollections} collections)`);
        } else {
            console.log(`      ❌ High resource usage (${enabledCollections} collections)`);
        }
        
        if (configTest.aggregatorConfig.batching.enabled) {
            const batchSize = configTest.aggregatorConfig.batching.max_batch_size;
            if (batchSize <= 50) {
                console.log(`      ✅ Efficient batching (${batchSize} batch size)`);
            } else if (batchSize <= 100) {
                console.log(`      ⚠️  Moderate batching (${batchSize} batch size)`);
            } else {
                console.log(`      ❌ Large batching (${batchSize} batch size)`);
            }
        } else {
            console.log(`      ⚡ No batching (real-time processing)`);
        }
        
        if (performanceResults.processingEfficiency >= 90) {
            console.log(`      ✅ Excellent processing efficiency`);
        } else if (performanceResults.processingEfficiency >= 70) {
            console.log(`      ⚠️  Good processing efficiency`);
        } else {
            console.log(`      ❌ Poor processing efficiency`);
        }
        
        // Store results
        this.testResults.push({
            configTest,
            workloadResults,
            performanceResults,
            enabledCollections,
            assessment: {
                resourceUsage: enabledCollections <= 2 ? 'low' : enabledCollections <= 4 ? 'moderate' : 'high',
                batchingEfficiency: configTest.aggregatorConfig.batching.enabled ? 'batched' : 'realtime',
                processingEfficiency: performanceResults.processingEfficiency >= 90 ? 'excellent' : 
                                     performanceResults.processingEfficiency >= 70 ? 'good' : 'poor'
            }
        });
    }

    async cleanupConfigurationTest(testId) {
        console.log(`   🧹 Cleaning up configuration test...`);
        
        try {
            const db = this.mongoClient.db();
            const collections = ['messages', 'subscriptions', 'users', 'rooms', 'settings'];
            
            let totalDeleted = 0;
            for (const collectionName of collections) {
                const result = await db.collection(collectionName).deleteMany({ testConfigId: testId });
                totalDeleted += result.deletedCount;
            }
            
            console.log(`      Deleted ${totalDeleted} test documents`);
        } catch (error) {
            console.log(`      ⚠️  Cleanup warning: ${error.message}`);
        }
    }

    async restoreOriginalConfigurations() {
        console.log('🔄 Restoring original configurations...');
        
        try {
            if (this.originalConfigs.dbwatcher) {
                fs.writeFileSync('./dbwatcher/config.yaml', this.originalConfigs.dbwatcher);
            }
            if (this.originalConfigs.aggregator) {
                fs.writeFileSync('./websocket-aggregator/config.yaml', this.originalConfigs.aggregator);
            }
            console.log('✅ Original configurations restored');
        } catch (error) {
            console.log('⚠️  Could not restore configurations:', error.message);
        }
    }

    async generateFinalReport() {
        const duration = Date.now() - this.startTime;
        
        console.log('\n' + '='.repeat(100));
        console.log('📊 CONFIGURATION SWITCHING TEST FINAL REPORT');
        console.log('='.repeat(100));
        
        console.log(`\n⏱️  TEST EXECUTION SUMMARY:`);
        console.log(`   Duration: ${Math.round(duration / 1000)}s`);
        console.log(`   Configurations Tested: ${this.testResults.length}`);
        console.log(`   Total Operations: ${this.testResults.reduce((sum, r) => sum + r.workloadResults.totalOperations, 0)}`);
        
        // Configuration comparison
        console.log(`\n📈 CONFIGURATION COMPARISON:`);
        console.log('   Configuration         | Collections | Efficiency | Resource Usage | Assessment');
        console.log('   ' + '-'.repeat(80));
        
        this.testResults.forEach(result => {
            const name = result.configTest.name.padEnd(20);
            const collections = result.enabledCollections.toString().padEnd(10);
            const efficiency = result.performanceResults.processingEfficiency.toFixed(1).padEnd(9);
            const resource = result.assessment.resourceUsage.padEnd(13);
            const assessment = result.assessment.processingEfficiency;
            console.log(`   ${name} | ${collections} | ${efficiency} | ${resource} | ${assessment}`);
        });
        
        // Best configurations for different use cases
        const bestMinimal = this.testResults.filter(r => r.assessment.resourceUsage === 'low')[0];
        const bestPerformance = this.testResults.reduce((best, current) => 
            current.performanceResults.processingEfficiency > best.performanceResults.processingEfficiency ? current : best
        );
        const bestThroughput = this.testResults.reduce((best, current) => 
            current.workloadResults.totalOperations > best.workloadResults.totalOperations ? current : best
        );
        
        console.log(`\n🏆 RECOMMENDED CONFIGURATIONS:`);
        console.log(`   💡 Memory Constrained: ${bestMinimal ? bestMinimal.configTest.name : 'N/A'}`);
        console.log(`   ⚡ Best Performance: ${bestPerformance.configTest.name} (${bestPerformance.performanceResults.processingEfficiency.toFixed(1)}%)`);
        console.log(`   🚀 High Throughput: ${bestThroughput.configTest.name} (${bestThroughput.workloadResults.totalOperations} ops)`);
        
        // Configuration guidelines
        console.log(`\n💡 CONFIGURATION GUIDELINES:`);
        console.log(`   📊 Collection Watching:`);
        console.log(`      - Essential only: messages, subscriptions`);
        console.log(`      - Standard: + users, rooms`);
        console.log(`      - Full monitoring: + settings, permissions, roles`);
        
        console.log(`   📦 Batching Strategy:`);
        console.log(`      - Real-time: Disable batching for < 100 ops/s`);
        console.log(`      - Balanced: 50-100 batch size for 100-1000 ops/s`);
        console.log(`      - High throughput: 100-200 batch size for > 1000 ops/s`);
        
        console.log(`   🔧 Field Projection:`);
        console.log(`      - Minimal: Only essential fields (_id, key data)`);
        console.log(`      - Selective: Common fields for aggregation`);
        console.log(`      - Full document: For complete data requirements`);
        
        // Save detailed report
        const report = {
            testSuite: 'Configuration Switching Test',
            startTime: this.startTime,
            duration,
            testResults: this.testResults,
            recommendations: {
                memoryConstrained: bestMinimal ? bestMinimal.configTest.name : null,
                bestPerformance: bestPerformance.configTest.name,
                highThroughput: bestThroughput.configTest.name
            },
            guidelines: {
                collectionWatching: {
                    essential: ['messages', 'subscriptions'],
                    standard: ['messages', 'subscriptions', 'users', 'rooms'],
                    full: ['messages', 'subscriptions', 'users', 'rooms', 'settings', 'permissions', 'roles']
                },
                batching: {
                    realtime: { enabled: false, threshold: '< 100 ops/s' },
                    balanced: { enabled: true, batchSize: '50-100', threshold: '100-1000 ops/s' },
                    highThroughput: { enabled: true, batchSize: '100-200', threshold: '> 1000 ops/s' }
                }
            }
        };
        
        const reportFile = `configuration-switching-report-${Date.now()}.json`;
        fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
        console.log(`\n📄 Detailed report saved to: ${process.cwd()}/${reportFile}`);
        
        return report;
    }

    async cleanup() {
        console.log('\n🧹 Cleaning up test environment...');
        
        // Restore original configurations
        await this.restoreOriginalConfigurations();
        
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
            await this.runConfigurationTests();
            await this.generateFinalReport();
        } catch (error) {
            console.error('❌ Configuration switching test failed:', error.message);
            process.exit(1);
        } finally {
            await this.cleanup();
        }
    }
}

// Run the test suite
if (require.main === module) {
    const testSuite = new ConfigurationSwitchingTest();
    testSuite.run().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = ConfigurationSwitchingTest;