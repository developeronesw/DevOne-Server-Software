FROM node:22-bookworm-slim AS runtime
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN printf '#!/bin/sh\nexit 101\n' > /usr/sbin/policy-rc.d && chmod 755 /usr/sbin/policy-rc.d \
 && apt-get update && apt-get install -y --no-install-recommends mariadb-server postgresql-16 libstdc++6 ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=runtime /usr/local/bin/node /usr/local/bin/node
WORKDIR /qa
COPY databases.js ./databases.mjs
COPY integration.mjs ./integration.mjs
CMD ["node", "integration.mjs"]
