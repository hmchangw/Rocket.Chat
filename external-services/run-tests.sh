#!/bin/bash

# Rocket.Chat External DbWatcher Test Runner
# This script orchestrates testing of both old and new DbWatcher implementations

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${PURPLE}🚀 ROCKET.CHAT DBWATCHER TESTING SUITE${NC}"
echo -e "${PURPLE}=========================================${NC}\n"

# Configuration
EXTERNAL_SERVICES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROCKETCHAT_DIR="/home/ashu/Downloads/Rocket.Chat"
DOCKER_COMPOSE_FILE="${EXTERNAL_SERVICES_DIR}/docker/docker-compose.yml"

# Default test mode
TEST_MODE="both"
SKIP_DOCKER=false
CLEANUP_AFTER=true

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --mode)
            TEST_MODE="$2"
            shift 2
            ;;
        --skip-docker)
            SKIP_DOCKER=true
            shift
            ;;
        --no-cleanup)
            CLEANUP_AFTER=false
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --mode <old|new|both|perf|integration>  Test mode (default: both)"
            echo "  --skip-docker           Skip Docker services startup"
            echo "  --no-cleanup           Don't cleanup after tests"
            echo "  --help                 Show this help message"
            echo ""
            echo "Test Modes:"
            echo "  old          - Test internal MongoDB oplog watcher only"
            echo "  new          - Test external microservice watcher only"
            echo "  both         - Test both implementations (default)"
            echo "  perf         - Run comprehensive performance comparison"
            echo "  integration  - Run end-to-end integration tests"
            echo ""
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Function to check if a service is running
check_service() {
    local service_name=$1
    local health_url=$2
    local max_attempts=${3:-30}
    local attempt=0
    
    echo -n "Checking ${service_name}..."
    
    while [ $attempt -lt $max_attempts ]; do
        if curl -s "${health_url}" > /dev/null 2>&1; then
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo -e " ${RED}✗${NC}"
    return 1
}

# Function to wait for MongoDB
wait_for_mongodb() {
    echo -n "Waiting for MongoDB..."
    local attempt=0
    local max_attempts=30
    
    while [ $attempt -lt $max_attempts ]; do
        if mongosh --eval "db.runCommand('ping')" > /dev/null 2>&1; then
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo -e " ${RED}✗${NC}"
    return 1
}

# Function to install Node.js dependencies
install_dependencies() {
    echo -e "${BLUE}📦 Installing Node.js dependencies...${NC}"
    
    cd "${EXTERNAL_SERVICES_DIR}"
    
    # Check if package.json exists, create it if not
    if [ ! -f package.json ]; then
        echo -e "${YELLOW}Creating package.json...${NC}"
        cat > package.json << EOF
{
  "name": "rocketchat-external-dbwatcher-tests",
  "version": "1.0.0",
  "description": "Test suite for Rocket.Chat external DbWatcher",
  "main": "test-old-dbwatcher.js",
  "scripts": {
    "test:old": "node test-old-dbwatcher.js",
    "test:new": "node test-new-dbwatcher.js",
    "test:both": "node test-old-dbwatcher.js && node test-new-dbwatcher.js"
  },
  "dependencies": {
    "mongodb": "^6.0.0",
    "nats": "^2.15.1",
    "ws": "^8.13.0",
    "axios": "^1.4.0"
  }
}
EOF
    fi
    
    # Install dependencies
    if command -v meteor &> /dev/null; then
        echo "Using meteor npm..."
        cd "${ROCKETCHAT_DIR}"
        meteor npm install mongodb nats ws axios
        cd "${EXTERNAL_SERVICES_DIR}"
    else
        echo "Using regular npm..."
        npm install
    fi
    
    echo -e "${GREEN}✅ Dependencies installed${NC}"
}

# Function to start external services
start_external_services() {
    if [ "$SKIP_DOCKER" = true ]; then
        echo -e "${YELLOW}⏭️  Skipping Docker services startup${NC}"
        return 0
    fi
    
    echo -e "${BLUE}🐳 Starting external services with Docker Compose...${NC}"
    
    cd "${EXTERNAL_SERVICES_DIR}/docker"
    
    # Build and start services
    docker-compose down -v 2>/dev/null || true
    docker-compose up -d --build
    
    echo -e "${BLUE}⏳ Waiting for services to be ready...${NC}"
    
    # Wait for each service
    if ! check_service "MongoDB" "mongodb://localhost:27017" 60; then
        echo -e "${RED}❌ MongoDB failed to start${NC}"
        return 1
    fi
    
    if ! check_service "Valkey" "http://localhost:6379" 30; then
        echo -e "${YELLOW}⚠️  Valkey not responding (may still work)${NC}"
    fi
    
    if ! check_service "NATS" "http://localhost:8222/healthz" 30; then
        echo -e "${RED}❌ NATS failed to start${NC}"
        return 1
    fi
    
    if ! check_service "DbWatcher" "http://localhost:8082/health" 60; then
        echo -e "${RED}❌ DbWatcher failed to start${NC}"
        return 1
    fi
    
    if ! check_service "WebSocket Aggregator" "http://localhost:8084/health" 60; then
        echo -e "${RED}❌ WebSocket Aggregator failed to start${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ All external services are ready${NC}\n"
    
    # Show service status
    echo -e "${CYAN}📊 Service Status:${NC}"
    docker-compose ps
    echo ""
    
    return 0
}

# Function to run old DbWatcher test
run_old_test() {
    echo -e "${BLUE}🔬 Running Old DbWatcher Test (Internal Implementation)${NC}"
    echo -e "${BLUE}====================================================${NC}\n"
    
    cd "${EXTERNAL_SERVICES_DIR}"
    
    # Set environment for old watcher
    export USE_EXTERNAL_DBWATCHER=false
    export DISABLE_DB_WATCH=false
    export MONGO_URL="mongodb://localhost:27017/rocketchat"
    
    # Run test
    if node test-old-dbwatcher.js; then
        echo -e "\n${GREEN}✅ Old DbWatcher test completed successfully${NC}"
        return 0
    else
        echo -e "\n${RED}❌ Old DbWatcher test failed${NC}"
        return 1
    fi
}

# Function to run new DbWatcher test
run_new_test() {
    echo -e "${BLUE}🔬 Running New DbWatcher Test (External Microservices)${NC}"
    echo -e "${BLUE}======================================================${NC}\n"
    
    cd "${EXTERNAL_SERVICES_DIR}"
    
    # Set environment for new watcher
    export USE_EXTERNAL_DBWATCHER=true
    export EXTERNAL_WATCHER_NATS_URL="nats://localhost:4222"
    export EXTERNAL_WATCHER_WS_URL="ws://localhost:8086/ws"
    export EXTERNAL_WATCHER_NATS_SUBJECT="rocketchat.events.aggregated"
    export MONGO_URL="mongodb://localhost:27017/rocketchat"
    
    # Run test
    if node test-new-dbwatcher.js; then
        echo -e "\n${GREEN}✅ New DbWatcher test completed successfully${NC}"
        return 0
    else
        echo -e "\n${RED}❌ New DbWatcher test failed${NC}"
        return 1
    fi
}

# Function to run performance comparison test
run_performance_test() {
    echo -e "${BLUE}🚀 Running Performance Comparison Test${NC}"
    echo -e "${BLUE}=====================================${NC}\n"
    
    cd "${EXTERNAL_SERVICES_DIR}"
    
    # Set environment
    export MONGO_URL="mongodb://localhost:27017/rocketchat"
    
    # Run performance comparison
    if node performance-comparison-test.js; then
        echo -e "\n${GREEN}✅ Performance comparison completed successfully${NC}"
        return 0
    else
        echo -e "\n${RED}❌ Performance comparison failed${NC}"
        return 1
    fi
}

# Function to run integration test
run_integration_test() {
    echo -e "${BLUE}🔄 Running Integration Test Suite${NC}"
    echo -e "${BLUE}================================${NC}\n"
    
    cd "${EXTERNAL_SERVICES_DIR}"
    
    # Set environment for integration test
    export USE_EXTERNAL_DBWATCHER=true
    export EXTERNAL_WATCHER_NATS_URL="nats://localhost:4222"
    export EXTERNAL_WATCHER_WS_URL="ws://localhost:8086/ws"
    export EXTERNAL_WATCHER_NATS_SUBJECT="rocketchat.events.aggregated"
    export MONGO_URL="mongodb://localhost:27017/rocketchat"
    
    # Run integration test
    if node integration-test.js; then
        echo -e "\n${GREEN}✅ Integration test completed successfully${NC}"
        return 0
    else
        echo -e "\n${RED}❌ Integration test failed${NC}"
        return 1
    fi
}

# Function to generate comparison report
generate_comparison_report() {
    echo -e "${PURPLE}📊 Generating Comparison Report...${NC}"
    
    cd "${EXTERNAL_SERVICES_DIR}"
    
    # Find the most recent test reports
    OLD_REPORT=$(ls -t old-dbwatcher-test-report-*.json 2>/dev/null | head -n1)
    NEW_REPORT=$(ls -t new-dbwatcher-test-report-*.json 2>/dev/null | head -n1)
    
    if [[ -n "$OLD_REPORT" && -n "$NEW_REPORT" ]]; then
        cat > comparison-report.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>DbWatcher Comparison Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; text-align: center; border-bottom: 2px solid #007acc; padding-bottom: 20px; }
        .comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin: 40px 0; }
        .test-section { background: #f9f9f9; padding: 20px; border-radius: 8px; }
        .test-section h2 { color: #007acc; margin-top: 0; }
        .metric { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
        .metric:last-child { border-bottom: none; }
        .success { color: #28a745; font-weight: bold; }
        .failure { color: #dc3545; font-weight: bold; }
        .summary { background: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .events-chart { margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f2f2f2; font-weight: bold; }
        .chart { height: 200px; background: #f0f0f0; border-radius: 4px; margin: 10px 0; display: flex; align-items: end; padding: 10px; }
        .bar { background: #007acc; margin: 0 2px; flex: 1; min-height: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Rocket.Chat DbWatcher Comparison Report</h1>
        
        <div class="summary">
            <h2>📊 Executive Summary</h2>
            <p>This report compares the performance and reliability of Rocket.Chat's internal MongoDB oplog-based watcher versus the new external microservice-based watcher system.</p>
        </div>
        
        <div class="comparison">
            <div class="test-section">
                <h2>🔧 Internal (Old) DbWatcher</h2>
                <div id="old-metrics"></div>
            </div>
            
            <div class="test-section">
                <h2>⚡ External (New) DbWatcher</h2>
                <div id="new-metrics"></div>
            </div>
        </div>
        
        <div class="summary">
            <h2>📈 Performance Comparison</h2>
            <table>
                <thead>
                    <tr>
                        <th>Metric</th>
                        <th>Internal Watcher</th>
                        <th>External Watcher</th>
                        <th>Improvement</th>
                    </tr>
                </thead>
                <tbody id="comparison-table">
                </tbody>
            </table>
        </div>
        
        <div class="summary">
            <h2>🎯 Recommendations</h2>
            <div id="recommendations"></div>
        </div>
    </div>

    <script>
        // This would be populated with actual data from the JSON reports
        console.log('Comparison report generated');
    </script>
</body>
</html>
EOF
        
        echo -e "${GREEN}✅ Comparison report generated: comparison-report.html${NC}"
        echo -e "${CYAN}📄 Old report: ${OLD_REPORT}${NC}"
        echo -e "${CYAN}📄 New report: ${NEW_REPORT}${NC}"
    else
        echo -e "${YELLOW}⚠️  Could not find both test reports for comparison${NC}"
    fi
}

# Function to cleanup
cleanup() {
    if [ "$CLEANUP_AFTER" = false ]; then
        echo -e "${YELLOW}⏭️  Skipping cleanup (--no-cleanup flag)${NC}"
        return 0
    fi
    
    echo -e "${BLUE}🧹 Cleaning up...${NC}"
    
    if [ "$SKIP_DOCKER" = false ]; then
        cd "${EXTERNAL_SERVICES_DIR}/docker"
        docker-compose down -v 2>/dev/null || true
        echo -e "${GREEN}✅ Docker services stopped${NC}"
    fi
    
    # Clean up any test data from MongoDB (if accessible)
    if mongosh --eval "
        use rocketchat;
        db.messages.deleteMany({testMarker: {\$exists: true}});
        db.messages.deleteMany({loadTest: true});
        db.messages.deleteMany({pipelineTest: true});
        db.users.deleteMany({testMarker: {\$exists: true}});
        db.rooms.deleteMany({testMarker: {\$exists: true}});
        db.subscriptions.deleteMany({testMarker: {\$exists: true}});
        print('Test data cleanup completed');
    " 2>/dev/null; then
        echo -e "${GREEN}✅ Test data cleaned up${NC}"
    fi
}

# Function to show monitoring dashboard info
show_monitoring_info() {
    if [ "$SKIP_DOCKER" = false ]; then
        echo -e "${CYAN}📊 Monitoring Dashboard Available:${NC}"
        echo -e "${CYAN}   http://localhost:8090${NC}"
        echo -e "${CYAN}   Real-time monitoring of external services${NC}\n"
    fi
}

# Main execution
main() {
    echo -e "${BLUE}Test Mode: ${TEST_MODE}${NC}"
    echo -e "${BLUE}Skip Docker: ${SKIP_DOCKER}${NC}"
    echo -e "${BLUE}Cleanup After: ${CLEANUP_AFTER}${NC}\n"
    
    # Install dependencies
    install_dependencies
    
    # Test results
    OLD_TEST_RESULT=0
    NEW_TEST_RESULT=0
    
    # Run tests based on mode
    case $TEST_MODE in
        "old")
            # Ensure MongoDB is available
            if ! wait_for_mongodb; then
                echo -e "${RED}❌ MongoDB is not available${NC}"
                exit 1
            fi
            
            if run_old_test; then
                OLD_TEST_RESULT=1
            fi
            ;;
            
        "new")
            if start_external_services; then
                show_monitoring_info
                if run_new_test; then
                    NEW_TEST_RESULT=1
                fi
            else
                echo -e "${RED}❌ Failed to start external services${NC}"
                exit 1
            fi
            ;;
            
        "both")
            # First run old test
            if ! wait_for_mongodb; then
                echo -e "${RED}❌ MongoDB is not available${NC}"
                exit 1
            fi
            
            if run_old_test; then
                OLD_TEST_RESULT=1
            fi
            
            echo -e "\n${PURPLE}============================================${NC}\n"
            
            # Then run new test
            if start_external_services; then
                show_monitoring_info
                if run_new_test; then
                    NEW_TEST_RESULT=1
                fi
            else
                echo -e "${RED}❌ Failed to start external services${NC}"
                NEW_TEST_RESULT=0
            fi
            
            # Generate comparison report
            if [[ $OLD_TEST_RESULT -eq 1 && $NEW_TEST_RESULT -eq 1 ]]; then
                generate_comparison_report
            fi
            ;;
            
        "perf")
            # Run performance comparison test
            if start_external_services; then
                show_monitoring_info
                if run_performance_test; then
                    echo -e "${GREEN}✅ Performance comparison test completed successfully${NC}"
                    exit 0
                else
                    echo -e "${RED}❌ Performance comparison test failed${NC}"
                    exit 1
                fi
            else
                echo -e "${RED}❌ Failed to start external services${NC}"
                exit 1
            fi
            ;;
            
        "integration")
            # Run integration test
            if start_external_services; then
                show_monitoring_info
                if run_integration_test; then
                    echo -e "${GREEN}✅ Integration test completed successfully${NC}"
                    exit 0
                else
                    echo -e "${RED}❌ Integration test failed${NC}"
                    exit 1
                fi
            else
                echo -e "${RED}❌ Failed to start external services${NC}"
                exit 1
            fi
            ;;
            
        *)
            echo -e "${RED}❌ Invalid test mode: ${TEST_MODE}${NC}"
            exit 1
            ;;
    esac
    
    # Cleanup
    cleanup
    
    # Final results
    echo -e "\n${PURPLE}🏁 FINAL RESULTS${NC}"
    echo -e "${PURPLE}================${NC}"
    
    if [ $OLD_TEST_RESULT -eq 1 ]; then
        echo -e "${GREEN}✅ Old DbWatcher: PASSED${NC}"
    elif [ "$TEST_MODE" = "old" ] || [ "$TEST_MODE" = "both" ]; then
        echo -e "${RED}❌ Old DbWatcher: FAILED${NC}"
    fi
    
    if [ $NEW_TEST_RESULT -eq 1 ]; then
        echo -e "${GREEN}✅ New DbWatcher: PASSED${NC}"
    elif [ "$TEST_MODE" = "new" ] || [ "$TEST_MODE" = "both" ]; then
        echo -e "${RED}❌ New DbWatcher: FAILED${NC}"
    fi
    
    # Exit with appropriate code
    case $TEST_MODE in
        "old")
            exit $((1 - OLD_TEST_RESULT))
            ;;
        "new")
            exit $((1 - NEW_TEST_RESULT))
            ;;
        "both")
            if [[ $OLD_TEST_RESULT -eq 1 && $NEW_TEST_RESULT -eq 1 ]]; then
                echo -e "\n${GREEN}🎉 Both implementations tested successfully!${NC}"
                exit 0
            else
                exit 1
            fi
            ;;
    esac
}

# Handle script interruption
trap cleanup INT TERM EXIT

# Run main function
main "$@"