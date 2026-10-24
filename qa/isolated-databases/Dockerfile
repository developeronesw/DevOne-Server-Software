FROM node:22-bookworm-slim AS runtime
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d && chmod 755 /usr/sbin/policy-rc.d \
 && apt-get update && apt-get install -y --no-install-recommends mariadb-server postgresql-16 libstdc++6 ca-certificates nginx acl curl python3 php8.3-fpm php8.3-cli php8.3-mysql php8.3-curl php8.3-gd php8.3-mbstring php8.3-xml php8.3-zip php8.3-intl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=runtime /usr/local/bin/node /usr/local/bin/node
RUN ln -s /usr/local/bin/node /usr/bin/node
WORKDIR /qa
COPY databases.js ./databases.mjs
COPY integration.mjs ./integration.mjs
CMD ["node", "integration.mjs"]
COPY agent/dist ./agent/dist
COPY scripts ./scripts
COPY package.json ./package.json
COPY wordpress-integration.mjs ./wordpress-integration.mjs
RUN php8.3 -l scripts/wordpress-install.php && python3 -m py_compile scripts/wordpress-extract.py && node --input-type=module -e "import {ensureWordPressArtifact} from './agent/dist/wordpress-artifact.js'; await ensureWordPressArtifact();"
COPY cms-integration.mjs ./cms-integration.mjs
COPY distributions ./distributions

COPY migration-integration.mjs ./migration-integration.mjs

COPY apps/api/dist ./apps/api/dist
COPY migration-server-integration.mjs ./migration-server-integration.mjs
