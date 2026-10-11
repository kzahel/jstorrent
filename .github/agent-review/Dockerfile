FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS node
FROM rust:1.97.0-bookworm@sha256:8fa55b2f3ddf97471ab6a767bfa3f37e6bad0986ba823e75fea57e2a2a5c3073
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && apt-get update && apt-get install -y --no-install-recommends \
    libayatana-appindicator3-dev librsvg2-dev libwebkit2gtk-4.1-dev \
    libssl-dev openssl patchelf python3 ca-certificates git \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g @openai/codex@0.160.0 \
 && chmod -R a+rX /usr/local/cargo /usr/local/rustup
ENV CARGO_HOME=/cache/cargo RUSTUP_HOME=/usr/local/rustup HOME=/home/reviewer
WORKDIR /workspace
# The controller supplies a non-root UID and no network for the review phase.
