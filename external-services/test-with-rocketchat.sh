#!/bin/bash

# Test Script for External DbWatcher with Real Rocket.Chat
# This script tests the external services connected to Rocket.Chat's MongoDB

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${PURPLE}🚀 ROCKET.CHAT EXTERNAL DBWATCHER INTEGRATION TEST${NC}"
echo -e "${PURPLE}===================================================${NC}\n"

# Configuration
EXTERNAL_SERVICES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROCKETCHAT_DIR="/home/ashu/Downloads/Rocket.Chat"

# Check if Rocket.Chat is running
check_rocketchat() {
    echo -e "${BLUE}🔍 Checking Rocket.Chat Status...${NC}"
    
    if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Rocket.Chat is not running on port 3000${NC}"
        echo -e "${CYAN}Please start Rocket.Chat first:${NC}"
        echo "   cd $ROCKETCHAT_DIR"
        echo "   meteor"
        echo ""
        return 1
    else
        echo -e "${GREEN}✅ Rocket.Chat is running${NC}"
        return 0
    fi
}

# Check MongoDB connectivity
check_mongodb() {
    echo -e "${BLUE}🗄️  Checking MongoDB Connectivity...${NC}"
    
    # Test connection to Rocket.Chat's MongoDB
    if timeout 10s node -e "
        const {MongoClient} = require('mongodb');
        const client = new MongoClient('mongodb://localhost:27018/meteor');
        client.connect()
            .then(() => {
                console.log('✅ MongoDB Connected (meteor database)');
                return client.db().collection('users').countDocuments();
            })
            .then(count => {
                console.log(\`📊 Found \${count} users in database\`);
                client.close();
            })
            .catch(err => {
                console.error('❌ MongoDB Error:', err.message);
                process.exit(1);
            });
    " 2>/dev/null; then
        echo -e "${GREEN}✅ MongoDB is accessible${NC}"
        return 0
    else
        echo -e "${RED}❌ Cannot connect to MongoDB${NC}"
        echo -e "${CYAN}Make sure Rocket.Chat is running (it starts MongoDB on port 3001)${NC}"
        return 1
    fi
}

# Start external services for Rocket.Chat integration
start_external_services() {
    echo -e "${BLUE}🐳 Starting External Services for Rocket.Chat Integration...${NC}"
    
    cd "$EXTERNAL_SERVICES_DIR"
    
    # Stop any existing services
    docker-compose -f docker-compose.rocketchat.yml down 2>/dev/null || true
    
    # Start services connected to Rocket.Chat MongoDB
    echo -e "${CYAN}Starting NATS, Valkey, DbWatcher, and WebSocket Aggregator...${NC}"
    docker-compose -f docker-compose.rocketchat.yml up -d --build
    
    echo -e "${BLUE}⏳ Waiting for services to be ready...${NC}"
    sleep 20
    
    # Check service health
    local services=("NATS:http://localhost:8222/healthz" "DbWatcher:http://localhost:8082/health" "Aggregator:http://localhost:8084/health")
    
    for service_info in "${services[@]}"; do
        IFS=':' read -r service_name service_url <<< "$service_info"
        
        echo -n "Checking $service_name..."
        local attempts=0
        while [ $attempts -lt 30 ]; do
            if curl -s "$service_url" > /dev/null 2>&1; then
                echo -e " ${GREEN}✅${NC}"
                break
            fi
            echo -n "."
            sleep 2
            attempts=$((attempts + 1))
        done
        
        if [ $attempts -eq 30 ]; then
            echo -e " ${RED}❌${NC}"
            echo -e "${RED}Service $service_name failed to start${NC}"
            return 1
        fi
    done
    
    echo -e "${GREEN}✅ All external services are running${NC}"
    return 0
}

# Test external services functionality
test_external_services() {
    echo -e "${BLUE}🧪 Testing External Services Functionality...${NC}"
    
    cd "$EXTERNAL_SERVICES_DIR"
    
    # Set environment for external services
    export USE_EXTERNAL_DBWATCHER=true
    export EXTERNAL_WATCHER_NATS_URL="nats://rocketchat:rocket123@localhost:4222"
    export EXTERNAL_WATCHER_WS_URL="ws://localhost:8083/ws"
    export EXTERNAL_WATCHER_NATS_SUBJECT="rocketchat.events.aggregated"
    export MONGO_URL="mongodb://localhost:27018/meteor"
    
    echo -e "${CYAN}Environment Configuration:${NC}"
    echo "  USE_EXTERNAL_DBWATCHER: $USE_EXTERNAL_DBWATCHER"
    echo "  MONGO_URL: $MONGO_URL"
    echo "  NATS_URL: $EXTERNAL_WATCHER_NATS_URL"
    echo "  WebSocket_URL: $EXTERNAL_WATCHER_WS_URL"
    echo ""
    
    # Run external watcher test
    echo -e "${BLUE}Running External DbWatcher Test...${NC}"
    if node test-new-dbwatcher.js; then
        echo -e "${GREEN}✅ External DbWatcher test passed${NC}"
    else
        echo -e "${RED}❌ External DbWatcher test failed${NC}"
        return 1
    fi
    
    return 0
}

# Monitor debug logs
monitor_logs() {
    echo -e "${BLUE}📋 Monitoring Debug Logs (30 seconds)...${NC}"
    echo -e "${CYAN}You can see detailed event processing in real-time${NC}"
    echo ""
    
    cd "$EXTERNAL_SERVICES_DIR"
    
    # Show logs from all services
    echo -e "${YELLOW}=== DbWatcher Logs ===${NC}"
    docker-compose -f docker-compose.rocketchat.yml logs --tail=10 dbwatcher
    
    echo -e "${YELLOW}=== WebSocket Aggregator Logs ===${NC}"
    docker-compose -f docker-compose.rocketchat.yml logs --tail=10 websocket-aggregator
    
    echo -e "${YELLOW}=== NATS Logs ===${NC}"
    docker-compose -f docker-compose.rocketchat.yml logs --tail=10 nats
    
    echo ""
    echo -e "${CYAN}To monitor live logs, run:${NC}"
    echo "   docker-compose -f docker-compose.rocketchat.yml logs -f dbwatcher"
    echo "   docker-compose -f docker-compose.rocketchat.yml logs -f websocket-aggregator"
}

# Show service URLs
show_service_info() {
    echo -e "${BLUE}🔗 Service Information:${NC}"
    echo ""
    echo -e "${CYAN}Health Check Endpoints:${NC}"
    echo "   📊 DbWatcher Health:        http://localhost:8082/health"
    echo "   🔄 WebSocket Aggregator:    http://localhost:8084/health"
    echo "   📡 NATS Monitoring:         http://localhost:8222/connz"
    echo ""
    echo -e "${CYAN}Debug & Monitoring:${NC}"
    echo "   📋 Monitoring Dashboard:    http://localhost:8090"
    echo "   🔍 Real-time Event Stream:  ws://localhost:8083/ws"
    echo ""
    echo -e "${CYAN}Docker Service Management:${NC}"
    echo "   🐳 View Services:          docker-compose -f docker-compose.rocketchat.yml ps"
    echo "   📋 View Logs:             docker-compose -f docker-compose.rocketchat.yml logs -f"
    echo "   🛑 Stop Services:         docker-compose -f docker-compose.rocketchat.yml down"
    echo ""
}

# Integration test with real Rocket.Chat data
test_integration() {
    echo -e "${BLUE}🔄 Running Integration Test with Real Rocket.Chat Data...${NC}"
    
    cd "$EXTERNAL_SERVICES_DIR"
    
    # Set environment for integration test
    export USE_EXTERNAL_DBWATCHER=true
    export EXTERNAL_WATCHER_NATS_URL="nats://rocketchat:rocket123@localhost:4222"
    export EXTERNAL_WATCHER_WS_URL="ws://localhost:8083/ws"
    export MONGO_URL="mongodb://localhost:27018/meteor"
    
    echo -e "${CYAN}This test will create real data in your Rocket.Chat database...${NC}"
    read -p "Continue? (y/N): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if node integration-test.js; then
            echo -e "${GREEN}✅ Integration test completed successfully${NC}"
        else
            echo -e "${RED}❌ Integration test failed${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}Integration test skipped${NC}"
    fi
    
    return 0
}

# Performance test
test_performance() {
    echo -e "${BLUE}🚀 Running Performance Test...${NC}"
    echo -e "${YELLOW}⚠️  This will insert test data into your Rocket.Chat database${NC}"
    
    read -p "Continue with performance test? (y/N): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cd "$EXTERNAL_SERVICES_DIR"
        
        export MONGO_URL="mongodb://localhost:27018/meteor"
        
        if node performance-comparison-test.js; then
            echo -e "${GREEN}✅ Performance test completed${NC}"
        else
            echo -e "${RED}❌ Performance test failed${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}Performance test skipped${NC}"
    fi
}

# Cleanup
cleanup() {
    echo -e "${BLUE}🧹 Cleanup Options:${NC}"
    echo "1. Stop external services only"
    echo "2. Stop external services and remove volumes"
    echo "3. Leave services running"
    
    read -p "Choose option (1-3): " -n 1 -r
    echo
    
    case $REPLY in
        1)
            docker-compose -f docker-compose.rocketchat.yml down
            echo -e "${GREEN}✅ External services stopped${NC}"
            ;;
        2)
            docker-compose -f docker-compose.rocketchat.yml down -v
            echo -e "${GREEN}✅ External services stopped and volumes removed${NC}"
            ;;
        3)
            echo -e "${CYAN}Services left running for continued testing${NC}"
            ;;
        *)
            echo -e "${YELLOW}No cleanup performed${NC}"
            ;;
    esac
}

# Main execution
main() {
    echo -e "${BLUE}Starting External DbWatcher Integration Test...${NC}\n"
    
    # Step 1: Check prerequisites
    if ! check_rocketchat; then
        exit 1
    fi
    
    if ! check_mongodb; then
        exit 1
    fi
    
    # Step 2: Start external services
    if ! start_external_services; then
        echo -e "${RED}❌ Failed to start external services${NC}"
        exit 1
    fi
    
    show_service_info
    
    # Step 3: Test services
    if ! test_external_services; then
        echo -e "${RED}❌ External services test failed${NC}"
        exit 1
    fi
    
    # Step 4: Show debug logs
    monitor_logs
    
    # Step 5: Optional integration test
    echo -e "\n${BLUE}Optional Tests:${NC}"
    test_integration
    
    # Step 6: Optional performance test
    test_performance
    
    # Final status
    echo -e "\n${GREEN}🎉 External DbWatcher Integration Test Completed!${NC}"
    echo -e "${CYAN}Your Rocket.Chat is now running with external DbWatcher services.${NC}"
    echo -e "${CYAN}Monitor the system performance and check debug logs for detailed information.${NC}"
    
    # Cleanup option
    echo ""
    cleanup
}

# Handle script interruption
trap cleanup INT TERM

# Run main function
main "$@"