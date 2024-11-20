# Step 1: Use Ubuntu 22.04 as the base image
FROM ubuntu:22.04

# Set environment variables
ENV RC_VERSION=3.16.2 HOME=/app TERM=xterm METEOR_ALLOW_SUPERUSER=true

# Set working directory
WORKDIR /app

RUN groupadd -r rocketchat && useradd -r -g rocketchat rocketchat \
    \
    && apt-get update && apt-get install -y --no-install-recommends \
    xz-utils openssl libssl-dev ca-certificates curl fontconfig git make openssh-server python3 vim  \
    ## Cypress dependencies
    libgtk2.0-0 libgtk-3-0 libgbm-dev libgconf-2-4 libnss3 libxss1 libasound2 libxtst6 xauth xvfb \
    && aptMark="$(apt-mark showmanual)" && apt-get install -y --no-install-recommends \
    ## for the later purge because the g++ leads the critical vulnerability `CVE-2019-19814`
    libnotify-dev g++ build-essential \
    && rm -rf /var/lib/apt/lists/* \
    \
    && curl -fsSL https://nodejs.org/dist/v14.21.3/node-v14.21.3-linux-x64.tar.xz -o node-v14.21.3-linux-x64.tar.xz && \
    tar -xJf node-v14.21.3-linux-x64.tar.xz && \
    mv node-v14.21.3-linux-x64 /usr/local/nodejs && \
    ln -s /usr/local/nodejs/bin/node /usr/local/bin/node && \
    ln -s /usr/local/nodejs/bin/npm /usr/local/bin/npm \
    \
    && npm install -g node-gyp-cache && npm config set node_gyp node-gyp-cache \
    \
    \
    # clone source code and install dependencies
    && curl https://install.meteor.com/?release=2.16 | sh \
    && git clone --branch joe-test https://github.com/hmchangw/Rocket.Chat /app/Rocket.Chat \
    && cd /app/Rocket.Chat && meteor npm install \
    && cd /app/Rocket.Chat/ee/server/services && npm install && cd - \
    \
    \
    # run precheck and tests
    ## adopt dummy sound card for e2e test
    && echo 'pcm.!default {\n type hw\n card 0\n}\n\nctl.!default {\n type hw\n card 0\n}' > /app/.asoundrc \
    # && meteor npm run lint && meteor npm run translation-check && meteor npm run typecheck \
    # && meteor npm run testunit -- --exclude app/models/server/models/Sessions.tests.js \
    && (TEST_MODE=true meteor run & sleep 7m) && METEOR_PROFILE=500 meteor npm run test && pkill node \
    \
    # generate app bundle artifacts
    && METEOR_PROFILE=500 meteor build --server-only --directory /app \
    && cd /app/bundle/programs/server && npm install \
    \
    \
    # purge build-deps
    && apt-mark auto '.*' > /dev/null && apt-mark manual $aptMark > /dev/null \
    && find /usr/local -type f -executable -exec ldd '{}' ';' | awk '/=>/ { print $(NF-1) }' | sort -u | xargs -r dpkg-query --search | cut -d: -f1 | sort -u | xargs -r apt-mark manual \
    && apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false \
    \
    # keep the .git folder and compressed node_modules as well as purge source code
    && chown -R rocketchat:rocketchat /app/Rocket.Chat && chmod -R ugo+rwX /app/Rocket.Chat \
    && mkdir -p /app/meta/bundle /app/meta/ee /app/meta/meteor && mv /app/Rocket.Chat/.git /app/meta/.git \
    && tar -zcf /app/meta/node_modules.tar.gz --directory /app/Rocket.Chat node_modules \
    && tar -zcf /app/meta/ee/node_modules.tar.gz --directory /app/Rocket.Chat/ee/server/services node_modules \
    && tar -zcf /app/meta/bundle/node_modules.tar.gz --directory /app/bundle/programs/server node_modules \
    && tar -zcf /app/meta/meteor/meteor-local.tar.gz --directory /app/Rocket.Chat .meteor/local \
    && mv /app/Rocket.Chat/package*.json /app/meta \
    && mv /app/Rocket.Chat/ee/server/services/package*.json /app/meta/ee \
    && mv /app/bundle/programs/server/package*.json /app/meta/bundle \
    && rm -rf /app/Rocket.Chat /app/bundle && mkdir -p /app/Rocket.Chat && mv /app/meta/.git /app/Rocket.Chat/.git \
    \
    # grant file access permission for all users (also require setting the `HOME=/app` to share caches across users)
    && chown -R rocketchat:rocketchat /app && chmod -R ugo+rwX /app
