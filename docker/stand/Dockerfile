# syntax=docker/dockerfile:1
#
# Ketos stand image: builds the Ketos CLI and Web bundles from this checkout
# and runs `ketos web` together with Syncthing and bd inside one container.
# Model credentials arrive only as environment variables (compose env_file);
# they are never copied into an image layer.

FROM node:24-bookworm AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.7.0
WORKDIR /app
COPY . .
# CI=true makes the postinstall lefthook installer a no-op; the client build
# still needs a Git HEAD, so snapshot the copied tree as one local commit.
ENV CI=true
RUN git init -q \
 && git config user.email stand@ketos.invalid \
 && git config user.name "Ketos Stand" \
 && git add -A \
 && git commit -qm "ketos stand build snapshot"
RUN pnpm install --frozen-lockfile
RUN pnpm run build \
 && rm -rf /app/.git

FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl syncthing \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
COPY docker/stand/stand.patch.yml /usr/local/share/ketos-stand/stand.patch.yml
COPY docker/stand/docker-entrypoint.sh /usr/local/bin/ketos-stand-entrypoint.sh
RUN chmod +x /usr/local/bin/ketos-stand-entrypoint.sh \
 && curl -fsSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash \
 && bd version

ENV DSH_HOME=/data/ketos
WORKDIR /workspace
EXPOSE 3080 8384
ENTRYPOINT ["/usr/local/bin/ketos-stand-entrypoint.sh"]
