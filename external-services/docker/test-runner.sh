#!/bin/bash

# Enhanced test runner for external-services with debug logging
set -e

echo "🚀 ROCKET.CHAT EXTERNAL SERVICES TEST RUNNER"
echo "=============================================="
echo ""

# Test configuration
MONGO_URL="mongodb://mongo:27017/meteor?directConnection=true"
NATS_URL="nats://nats:4222"
WEBSOCKET_URL="ws://websocket-aggregator:8083/ws"
DBWATCHER_URL="http://dbwatcher:8082"
AGGREGATOR_URL="http://websocket-aggregator:8084"

echo "🔧 Environment Configuration:"
echo "  MongoDB: $MONGO_URL"
echo "  NATS: $NATS_URL"
echo "  WebSocket: $WEBSOCKET_URL"
echo "  DbWatcher Health: $DBWATCHER_URL/health"
echo "  Aggregator Health: $AGGREGATOR_URL/health"
echo ""

# Function to wait for service
wait_for_service() {
    local service_name="$1"
    local url="$2"
    local max_attempts=30
    local attempt=1
    
    echo "⏳ Waiting for $service_name..."
    while [ $attempt -le $max_attempts ]; do
        if curl -f "$url" >/dev/null 2>&1; then
            echo "✅ $service_name is ready"
            return 0
        fi
        echo "   Attempt $attempt/$max_attempts - waiting..."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo "❌ $service_name failed to become ready after $max_attempts attempts"
    return 1
}

# Function to show service logs
show_service_logs() {
    echo ""
    echo "📋 Current Service Status:"
    echo "=========================="
    
    echo ""
    echo "🗄️ DbWatcher Health:"
    curl -s "$DBWATCHER_URL/health" | jq . || echo "❌ DbWatcher not responding"
    
    echo ""
    echo "🔄 Aggregator Health:"
    curl -s "$AGGREGATOR_URL/health" | jq . || echo "❌ Aggregator not responding"
    
    echo ""
}

# Function to run a test with enhanced logging
run_test() {
    local test_name="$1"
    local test_file="$2"
    local test_description="$3"
    
    echo ""
    echo "🧪 Running Test: $test_name"
    echo "📝 Description: $test_description"
    echo "🗂️ File: $test_file"
    echo "----------------------------------------"
    
    # Set environment variables
    export MONGO_URL="$MONGO_URL"
    export EXTERNAL_WATCHER_NATS_URL="$NATS_URL"
    export EXTERNAL_WATCHER_WS_URL="$WEBSOCKET_URL"
    export USE_EXTERNAL_DBWATCHER="true"
    
    # Run the test
    if timeout 300 node "$test_file"; then
        echo "✅ $test_name: PASSED"
        return 0
    else
        echo "❌ $test_name: FAILED"
        return 1
    fi
}

# Function to insert test data and watch for events
test_event_flow() {
    echo ""
    echo "🔄 Testing Complete Event Flow"
    echo "=============================="
    
    # Generate a unique test ID
    TEST_ID="test_$(date +%s)_$$"
    echo "🎯 Test ID: $TEST_ID"
    
    # Show current logs before insertion
    echo ""
    echo "📊 Pre-insertion Service Status:"
    curl -s "$DBWATCHER_URL/health" | jq .events_published || echo "0"
    curl -s "$AGGREGATOR_URL/health" | jq .events_processed || echo "0"
    
    echo ""
    echo "📝 Inserting test message into MongoDB..."
    
    # Use mongosh to insert a test document
    docker exec external-mongo mongosh --quiet --eval "
        use meteor;
        db.messages.insertOne({
            _id: '$TEST_ID',
            msg: 'Test message for event flow verification',
            ts: new Date(),
            u: { _id: 'test-user', username: 'testuser' },
            rid: 'test-room',
            testEventFlow: true,
            insertedAt: new Date()
        });
        print('✅ Test message inserted');
    "
    
    echo "⏳ Waiting 10 seconds for event processing..."
    sleep 10
    
    echo ""
    echo "📊 Post-insertion Service Status:"
    curl -s "$DBWATCHER_URL/health" | jq .events_published || echo "0"
    curl -s "$AGGREGATOR_URL/health" | jq .events_processed || echo "0"
    
    echo ""
    echo "🧹 Cleaning up test data..."
    docker exec external-mongo mongosh --quiet --eval "
        use meteor;
        db.messages.deleteOne({_id: '$TEST_ID'});
        print('✅ Test message cleaned up');
    "
    
    echo "✅ Event flow test completed"
}

# Main execution
echo "🏥 Checking Service Health..."
echo "============================="

# Wait for all services to be ready
wait_for_service "DbWatcher" "$DBWATCHER_URL/health"
wait_for_service "Aggregator" "$AGGREGATOR_URL/health"

# Show initial service status
show_service_logs

# Run tests based on arguments
case "${1:-all}" in
    "new")
        run_test "New DbWatcher Test" "test-new-dbwatcher.js" "Test external microservice-based watcher"
        ;;
    "integration")
        run_test "Integration Test" "integration-test.js" "End-to-end integration testing"
        ;;
    "flow")
        test_event_flow
        ;;
    "all")
        echo ""
        echo "🎯 Running All Tests"
        echo "===================="
        
        # Test event flow first
        test_event_flow
        
        # Run the main tests
        run_test "New DbWatcher Test" "test-new-dbwatcher.js" "Test external microservice-based watcher"
        run_test "Integration Test" "integration-test.js" "End-to-end integration testing"
        
        echo ""
        echo "🏁 All Tests Completed!"
        ;;
    *)
        echo "Usage: $0 [new|integration|flow|all]"
        echo ""
        echo "Options:"
        echo "  new         - Run new DbWatcher test only"
        echo "  integration - Run integration test only"
        echo "  flow        - Test event flow by inserting data"
        echo "  all         - Run all tests (default)"
        exit 1
        ;;
esac

# Show final service status
show_service_logs

echo ""
echo "🎉 Test runner completed successfully!"