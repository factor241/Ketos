# syntax=docker/dockerfile:1
#
# Ketos stand image: builds the Ketos CLI and Web bundles from this checkout
# and runs `ketos web` together with Syncthing and bd inside one container.
# Model credentials arrive only as environment variables (compose env_file);
# they are never copied into an image layer.

# Base images are pinned by digest; refresh both with `docker pull` and the
# new `RepoDigests` value when the Node 24 line moves.
FROM node:24-bookworm@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4 AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.7.0
WORKDIR /app
COPY . .
# The ignore file keeps every .env out of the context; fail the build if one slips in.
RUN test ! -e /app/docker/stand/.env \
 && leaked="$(find /app -path /app/node_modules -prune -o \( -name '.env' -o -name '.env.*' -o -name '*.env' -o -name '.envrc' \) ! -name '*.example' -print)" \
 && test -z "$leaked" || { echo "secret files in the build context: $leaked" >&2; exit 1; }
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

FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
COPY docker/stand/stand.patch.yml /usr/local/share/ketos-stand/stand.patch.yml
COPY docker/stand/docker-entrypoint.sh /usr/local/bin/ketos-stand-entrypoint.sh
COPY docker/stand/syncthing-bootstrap.mjs /usr/local/share/ketos-stand/syncthing-bootstrap.mjs
COPY docker/stand/ensure-stignore.mjs /usr/local/share/ketos-stand/ensure-stignore.mjs
COPY docker/stand/run-with-redacted-log.sh /usr/local/share/ketos-stand/run-with-redacted-log.sh

# Pin Syncthing to one official release verified by checksum per architecture:
# Debian's package (1.19.2) predates relay tokens and would join public relays.
# The MPL-2.0 license travels with the binary; docker/stand/README.md links the
# corresponding source.
ARG SYNCTHING_VERSION=2.1.5
ARG SYNCTHING_SHA256_ARM64=3666f3069feeee3651e185f867759206059755101797bdd69ea5317610130855
ARG SYNCTHING_SHA256_AMD64=3d222b609f7ab2944e02748cb10488b4160d446b49e0eafc107ef2a525ab3486
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      arm64) st_sha256="$SYNCTHING_SHA256_ARM64" ;; \
      amd64) st_sha256="$SYNCTHING_SHA256_AMD64" ;; \
      *) echo "unsupported TARGETARCH for syncthing: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && curl -fsSLo /tmp/syncthing.tgz "https://github.com/syncthing/syncthing/releases/download/v${SYNCTHING_VERSION}/syncthing-linux-${TARGETARCH}-v${SYNCTHING_VERSION}.tar.gz" \
 && echo "${st_sha256}  /tmp/syncthing.tgz" | sha256sum -c - \
 && tar -xzf /tmp/syncthing.tgz -C /tmp \
 && install -m 0755 "/tmp/syncthing-linux-${TARGETARCH}-v${SYNCTHING_VERSION}/syncthing" /usr/local/bin/syncthing \
 && mkdir -p /usr/local/share/doc/syncthing \
 && install -m 0644 "/tmp/syncthing-linux-${TARGETARCH}-v${SYNCTHING_VERSION}/LICENSE.txt" /usr/local/share/doc/syncthing/LICENSE.txt \
 && rm -rf "/tmp/syncthing-linux-${TARGETARCH}-v${SYNCTHING_VERSION}" /tmp/syncthing.tgz \
 && syncthing --version

# Pin Beads to one release verified by checksum per architecture: the stand
# ships exactly this build of `bd`, and the MIT notice travels with it.
ARG BD_VERSION=1.3.1
ARG BD_SHA256_ARM64=c3b32c71a6c0cd6358a12c28272b17e6818db991da192f87df52339c222e423a
ARG BD_SHA256_AMD64=3219443a9734b89b93fb16ee8d65844759fa1b3cd3cf139c606b7353cfb0715c
ARG TARGETARCH
RUN chmod +x /usr/local/bin/ketos-stand-entrypoint.sh \
 && case "$TARGETARCH" in \
      arm64) bd_sha256="$BD_SHA256_ARM64" ;; \
      amd64) bd_sha256="$BD_SHA256_AMD64" ;; \
      *) echo "unsupported TARGETARCH for bd: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && curl -fsSLo /tmp/bd.tgz "https://github.com/gastownhall/beads/releases/download/v${BD_VERSION}/beads_${BD_VERSION}_linux_${TARGETARCH}.tar.gz" \
 && echo "${bd_sha256}  /tmp/bd.tgz" | sha256sum -c - \
 && tar -xzf /tmp/bd.tgz -C /tmp bd LICENSE \
 && install -m 0755 /tmp/bd /usr/local/bin/bd \
 && mkdir -p /usr/local/share/doc/beads \
 && install -m 0644 /tmp/LICENSE /usr/local/share/doc/beads/LICENSE \
 && rm -f /tmp/bd.tgz /tmp/bd /tmp/LICENSE \
 && bd version

ENV DSH_HOME=/data/ketos
# Beads telemetry is off in every profile: the CLI must never report usage.
ENV BD_DISABLE_METRICS=1 DO_NOT_TRACK=1
WORKDIR /workspace
EXPOSE 3080 8384
ENTRYPOINT ["/usr/local/bin/ketos-stand-entrypoint.sh"]
