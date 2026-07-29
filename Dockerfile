FROM oven/bun@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS build

WORKDIR /src
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM ghcr.io/engels74/otpravkarr-docker@sha256:cdc6b2447c0f9f42a4f37c9599fc426a34ee82336d8a7c1a49f4b981bcc83da7

COPY --from=build --chown=1000:1000 /src/build /app/build
COPY --from=build --chown=1000:1000 /src/package.json /app/package.json

LABEL org.opencontainers.image.title="Otpravkarr" \
      org.opencontainers.image.description="Pinned local Otpravkarr production build"
