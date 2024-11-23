FROM node:14-bullseye-slim

ENV RC_VERSION=3.16.2 HOME=/app TERM=xterm METEOR_ALLOW_SUPERUSER=true

WORKDIR /app

RUN groupadd -r rocketchat && useradd -r -g rocketchat rocketchat \
    && apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl fontconfig git make openssh-server python3 vim \
            ## Cypress dependencies
            libgtk2.0-0 libgtk-3-0 libgbm-dev libgconf-2-4 libnss3 libxss1 libasound2 libxtst6 xauth xvfb \
        && aptMark="$(apt-mark showmanual)" && apt-get install -y --no-install-recommends \
            ## for the later purge because the g++ leads the critical vulnerability `CVE-2019-19814`
            libnotify-dev g++ build-essential \
        && rm -rf /var/lib/apt/lists/* \
    \
    \
    && curl https://install.meteor.com/?release=2.16 | sh \
    \
    && git clone --branch joe-test https://github.com/hmchangw/Rocket.Chat /app/Rocket.Chat \
    \
    && cd /app/Rocket.Chat \
    && meteor npm install \
    && cd /app/Rocket.Chat/ee/server/services \
    && meteor npm install && cd - \
    \
    \
    && cd /app/Rocket.Chat && METEOR_PROFILE=500 meteor build --server-only --directory /app \
    && cd /app/bundle/programs/server && npm install \
    \
    && aptMark="$(apt-mark showmanual)" \
    && apt list --installed 2>/dev/null | awk -F/ '/\/[a-z]+/ {print $1}' | xargs -r apt-mark auto \
    && apt-mark manual $aptMark \
    && find /usr/local -type f -executable -exec ldd '{}' ';' | awk '/=>/ { print $(NF-1) }' \
        | sort -u | xargs -r dpkg-query --search | cut -d: -f1 | sort -u | xargs -r apt-mark manual \
    && apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false \
    \
    && mkdir -p /app/meta/bundle /app/meta/ee /app/meta/meteor \
    && tar -zcf /app/meta/node_modules.tar.gz --directory /app/Rocket.Chat node_modules \
    && tar -zcf /app/meta/ee/node_modules.tar.gz --directory /app/Rocket.Chat/ee/server/services node_modules \
    && tar -zcf /app/meta/bundle/node_modules.tar.gz --directory /app/bundle/programs/server node_modules \
    && tar -zcf /app/meta/meteor/meteor-local.tar.gz --directory /app/Rocket.Chat .meteor/local \
    && mv /app/Rocket.Chat/.git /app/meta/.git \
    && mv /app/Rocket.Chat/package*.json /app/meta \
    && mv /app/Rocket.Chat/ee/server/services/package*.json /app/meta/ee \
    && mv /app/bundle/programs/server/package*.json /app/meta/bundle \
    && rm -rf /app/Rocket.Chat /app/bundle && mkdir -p /app/Rocket.Chat && mv /app/meta/.git /app/Rocket.Chat/.git \
    \
    && chown -R rocketchat:rocketchat /app && chmod -R ugo+rwX /app