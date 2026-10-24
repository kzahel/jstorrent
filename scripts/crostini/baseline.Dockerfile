FROM ubuntu:22.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl git pkg-config libssl-dev xz-utils \
    && rm -rf /var/lib/apt/lists/*
# Toolchain version matches the native release workflow, isolated from host libc.
ENV RUSTUP_HOME=/opt/rustup RUSTUP_TOOLCHAIN=1.97.0 PATH=/opt/cargo/bin:/opt/node/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs -o /tmp/rustup-init.sh \
    && CARGO_HOME=/opt/cargo sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain 1.97.0 \
    && rm /tmp/rustup-init.sh
RUN curl --proto '=https' --tlsv1.2 -fsSL https://nodejs.org/dist/v22.22.0/node-v22.22.0-linux-x64.tar.xz -o /tmp/node.tar.xz \
    && curl --proto '=https' --tlsv1.2 -fsSL https://nodejs.org/dist/v22.22.0/SHASUMS256.txt -o /tmp/node-sums \
    && cd /tmp && awk '$2 == "node-v22.22.0-linux-x64.tar.xz" {print $1 "  node.tar.xz"}' node-sums | sha256sum -c - \
    && mkdir /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1 \
    && rm /tmp/node.tar.xz /tmp/node-sums
WORKDIR /build
