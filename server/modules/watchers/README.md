# External DbWatcher Integration

This module provides a complete external microservice-based database watcher system to replace Rocket.Chat's internal MongoDB oplog watcher, addressing performance issues with high-activity deployments.

## Overview

The external watcher system decouples database change monitoring from the main Rocket.Chat application by using:

- **DbWatcher Service (Golang)**: Watches MongoDB collections and publishes raw change events to NATS
- **WebSocket Service (Golang)**: Aggregates change data with Valkey cache and publishes enriched events
- **HorizontalBroadcast Service**: Distributes notifications to clients
- **NATS Message Bus**: High-performance event streaming between services

## Architecture

```
MongoDB Changes → DbWatcher (Go) → NATS (changedata) → 
WebSocket Service (Go) → Valkey Cache → NATS (aggregated) → 
Rocket.Chat → HorizontalBroadcast → Clients
```

## Environment Variables

### Required Variables

```bash
USE_EXTERNAL_DBWATCHER=true                           # Enable external watcher
EXTERNAL_WATCHER_NATS_URL=nats://localhost:4222       # NATS server URL
EXTERNAL_WATCHER_WS_URL=ws://localhost:8080           # WebSocket service URL
EXTERNAL_WATCHER_NATS_SUBJECT=rocketchat.events.aggregated  # NATS subject
```

### Optional Variables

```bash
EXTERNAL_WATCHER_CONNECTION_TIMEOUT=10000             # Connection timeout (ms)
EXTERNAL_WATCHER_RETRY_ATTEMPTS=5                     # Retry attempts
EXTERNAL_WATCHER_RETRY_DELAY=2000                     # Retry delay (ms)
EXTERNAL_WATCHER_ENABLE_HEALTH_CHECK=true             # Enable health monitoring
EXTERNAL_WATCHER_HEALTH_CHECK_INTERVAL=30000          # Health check interval (ms)
EXTERNAL_WATCHER_COLLECTION_MAPPINGS={}               # Custom collection mappings (JSON)
```

### Legacy Variables (Overridden)

When `USE_EXTERNAL_DBWATCHER=true`, these variables are ignored:

```bash
DISABLE_DB_WATCH=true/false                           # Ignored - external watcher overrides
```

## Setup Instructions

### 1. Install Dependencies

The NATS client is automatically installed when you use the external watcher.

### 2. Configure Environment

Set the required environment variables in your deployment:

```bash
export USE_EXTERNAL_DBWATCHER=true
export EXTERNAL_WATCHER_NATS_URL=nats://your-nats-server:4222
export EXTERNAL_WATCHER_WS_URL=ws://your-websocket-service:8080
```

### 3. Deploy Microservices

Ensure your Golang microservices are deployed and running:

- DbWatcher service connected to MongoDB
- WebSocket service connected to Valkey cache
- NATS server running and accessible
- All services can communicate with each other

### 4. Start Rocket.Chat

The system will automatically:

1. Detect external watcher configuration
2. Attempt to connect to NATS
3. Subscribe to aggregated events
4. Process and broadcast events to clients
5. Fall back to internal watcher if external services fail

## Monitoring & Debugging

### Global Debug Objects

```javascript
// Access bootstrap status
global.watcherBootstrap.getStatus()

// Access external watcher API
global.externalWatcherAPI.status()
global.externalWatcherAPI.health()
global.externalWatcherAPI.detailed()

// Access external watcher instance (if running)
global.externalDbWatcher.getHealthStatus()
global.externalDbWatcher.getDebugInfo()
```

### Health Check API

The system exposes several monitoring endpoints:

```javascript
// Get basic status
await global.externalWatcherAPI.status()

// Get health check results
await global.externalWatcherAPI.health()

// Get detailed system information
await global.externalWatcherAPI.detailed()

// Get performance metrics
await global.externalWatcherAPI.metrics()

// Restart external watcher (debugging)
await global.externalWatcherAPI.restart()
```

### Log Messages

Monitor these log messages for status:

```
External Watcher: Connected to NATS server
External Watcher Integration: Successfully connected
ExternalWatcherBootstrap: External watcher initialized successfully
```

Error messages indicate fallback to internal watcher:

```
Failed to initialize external watcher, falling back to internal watcher
ExternalWatcherBootstrap: External watcher failed, falling back to internal watcher
```

## Fallback Mechanism

The system includes robust fallback handling:

1. **Configuration Validation**: Validates all required settings before initialization
2. **Connection Timeout**: Times out if external services don't respond
3. **Graceful Degradation**: Automatically falls back to internal watcher on failure
4. **Health Monitoring**: Continuously monitors external service health
5. **Restart Capability**: Can restart external watcher without full application restart

## Collection Mappings

The system maps Rocket.Chat collections to external service collections:

| Internal Collection | External Collection | Full Document |
|-------------------|-------------------|---------------|
| messages | messages | No |
| subscriptions | subscriptions | Yes |
| users | users | No |
| settings | settings | Yes |
| permissions | permissions | Yes |
| roles | roles | Yes |
| rooms | rooms | No |
| livechat-inquiry | livechatInquiry | Yes |
| ... | ... | ... |

Custom mappings can be provided via `EXTERNAL_WATCHER_COLLECTION_MAPPINGS` environment variable.

## Performance Benefits

### Before (Internal Watcher)

- Direct MongoDB oplog tailing
- 40+ fields watched per subscription change
- No batching or throttling
- CPU/memory spikes under load
- Single point of failure

### After (External Watcher)

- Dedicated watcher microservices
- Configurable field monitoring
- Event batching and aggregation
- Valkey caching layer
- Horizontal scaling capability
- Graceful degradation

## Troubleshooting

### Common Issues

1. **NATS Connection Failed**
   - Check `EXTERNAL_WATCHER_NATS_URL` is correct
   - Verify NATS server is running and accessible
   - Check network connectivity

2. **No Events Received**
   - Verify DbWatcher service is publishing to correct NATS subject
   - Check WebSocket service is aggregating and republishing events
   - Monitor NATS message flow

3. **Fallback to Internal Watcher**
   - Check external service availability
   - Review connection timeout settings
   - Examine error logs for specific failure reasons

### Debug Commands

```javascript
// Check configuration
global.externalWatcherAPI.config()

// Monitor health status
setInterval(() => global.externalWatcherAPI.health(), 5000)

// Get detailed diagnostics
global.externalWatcherAPI.detailed()

// Force restart (testing)
global.externalWatcherAPI.restart()
```

### Log Level Configuration

Set appropriate log levels for debugging:

```bash
# Enable debug logging
export LOG_LEVEL=debug

# Or disable debug logging in production
export LOG_LEVEL=info
```

## Files Overview

- `ExternalWatcherAdapter.ts` - Core interfaces and types
- `ExternalWatcherConfig.ts` - Configuration management
- `NatsClient.ts` - NATS client implementation
- `ExternalWatcherService.ts` - Main service class
- `ExternalWatcherIntegration.ts` - Rocket.Chat integration layer
- `ExternalWatcherBootstrap.ts` - Initialization and fallback logic
- `ExternalWatcherHealthCheck.ts` - Health monitoring
- `ExternalWatcherAPI.ts` - Debugging and monitoring API

## Migration Path

1. **Deploy microservices** in your infrastructure
2. **Test configuration** with `USE_EXTERNAL_DBWATCHER=true` on staging
3. **Monitor performance** and health metrics
4. **Gradual rollout** to production instances
5. **Keep internal watcher** as emergency fallback

The external watcher can be enabled/disabled without code changes - just modify the environment variable and restart Rocket.Chat.