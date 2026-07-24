# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3.13-debian@sha256:e95356cb8e1de62ad69ab3bd3584ba947013d27650a226804d2fc0af4e17dac2 AS build

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile \
    && bun run prisma:generate \
    && bun run build

FROM build AS runtime

ENV NODE_ENV=production \
    OBJECT_STORAGE_BACKEND=local \
    OBJECT_STORAGE_ROOT=/data/personalise-kings/objects

RUN mkdir -p /data/personalise-kings/objects \
    && chown -R bun:bun /app /data/personalise-kings

USER bun

FROM runtime AS proof

USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN bunx playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright
USER bun
