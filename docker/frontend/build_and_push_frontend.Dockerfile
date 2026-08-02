# syntax=docker/dockerfile:1
# Keep this syntax directive! It's used to enable Docker BuildKit

################################
# BUILDER-BASE
################################

# 1. force platform to the current architecture to increase build speed time on multi-platform builds
FROM --platform=$BUILDPLATFORM node:22.14.0-bookworm-slim AS builder-base
COPY src/frontend /frontend

RUN cd /frontend \
    && npm ci \
    && ESBUILD_BINARY_PATH="" NODE_OPTIONS="--max-old-space-size=4096" JOBS=1 npm run build

################################
# RUNTIME
################################
FROM nginxinc/nginx-unprivileged:stable-bookworm-perl AS runtime

LABEL org.opencontainers.image.title=ketos-frontend
LABEL org.opencontainers.image.authors=['Ketos']
LABEL org.opencontainers.image.licenses=MIT
LABEL org.opencontainers.image.url=https://git.ketos.test/ketos/ketos
LABEL org.opencontainers.image.source=https://git.ketos.test/ketos/ketos

COPY --from=builder-base --chown=nginx /frontend/build /usr/share/nginx/html
COPY --chown=nginx ./docker/frontend/start-nginx.sh /start-nginx.sh
COPY --chown=nginx ./docker/frontend/default.conf.template /etc/nginx/conf.d/default.conf.template
RUN chmod +x /start-nginx.sh
ENTRYPOINT ["/start-nginx.sh"]
