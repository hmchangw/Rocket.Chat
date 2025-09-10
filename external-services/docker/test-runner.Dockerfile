# Test runner container for running external services tests
FROM node:18-alpine

WORKDIR /tests

# Install required packages
RUN apk add --no-cache bash curl jq

# Copy test files and package.json (from context root)
COPY package.json ./
COPY test-*.js ./
COPY integration-test.js ./
COPY performance-comparison-test.js ./

# Install dependencies
RUN npm install

# Create enhanced test script
COPY docker/test-runner.sh /usr/local/bin/test-runner.sh
RUN chmod +x /usr/local/bin/test-runner.sh

# Default command
CMD ["/usr/local/bin/test-runner.sh"]