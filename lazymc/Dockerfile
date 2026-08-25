FROM rust:1.82-bookworm AS builder
WORKDIR /src
# Pin a specific lazymc release tag instead of tracking master, so builds are
# reproducible. Bump this deliberately when you want to pick up upstream
# changes.
ARG LAZYMC_REF=v0.2.11
RUN git clone --branch "$LAZYMC_REF" --depth 1 https://github.com/timvisee/lazymc.git .
# Patches the status monitor to: (1) log the real underlying error instead
# of silently discarding it, and (2) fall back to a lenient JSON parse that
# strips Forge's forgeData/modinfo mod-list field when the strict decoder
# can't handle it (large modpacks use a shape lazymc's protocol crate
# doesn't understand). See patches/monitor.rs.
COPY lazymc/patches/monitor.rs src/monitor.rs
RUN cargo build --release

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gettext-base \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /lazymc
COPY --from=builder /src/target/release/lazymc /usr/local/bin/lazymc
COPY lazymc/lazymc.toml.template ./lazymc.toml.template
COPY lazymc/entrypoint.sh /entrypoint.sh
COPY lazymc/bridge/wake.sh ./bridge/wake.sh
RUN chmod +x /entrypoint.sh ./bridge/wake.sh \
    && mkdir -p ./serverdir \
    && printf 'server-ip=\nserver-port=25565\n' > ./serverdir/server.properties

EXPOSE 25565
ENTRYPOINT ["/entrypoint.sh"]
