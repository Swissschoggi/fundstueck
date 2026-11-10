FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm run typecheck

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/app/data
ENV ENABLE_PLUGINS=false
ENV FUNDSTUECK_RICARDO_VENV=/app/.venvs/ricardo
# Camoufox (the patched Firefox build the Ricardo community CLI drives) runs
# its own content-process sandbox, which self-tests by creating a Linux user
# namespace (clone(CLONE_NEWUSER)). Docker's default seccomp profile blocks
# that syscall, so without this the browser fails to launch with
# "CanCreateUserNamespace() clone() failure: EPERM" on every container
# runtime (Docker Engine, Docker Desktop, most managed container platforms)
# unless the operator also grants extra capabilities/seccomp exceptions at
# `docker run`/compose time — which most deployment targets (Fly.io,
# Railway, plain `docker run`, etc.) don't expose by default. Disabling
# Firefox's own content sandbox here is the one fix that works the same way
# everywhere the image runs. It only affects the Ricardo adapter's browser
# process, nothing else in Fundstück, and only matters if ricardo.ch itself
# were ever compromised to serve malicious script content. If you'd rather
# keep the sandbox active, remove this line and instead run the container
# with `cap_add: [SYS_ADMIN]` + `security_opt: [seccomp:unconfined]`.
ENV MOZ_DISABLE_CONTENT_SANDBOX=1

WORKDIR /app

# Ricardo's optional community CLI is Python-based. Keep Python in the runtime
# image (not just the build stage), and use a venv to avoid Debian's externally
# managed system-Python restrictions (PEP 668).
#
# The extra lib* / fonts-liberation packages below are headless Firefox's
# (camoufox's) own runtime dependencies — without them the browser process
# crashes immediately on launch with errors like
# "libgtk-3.so.0: cannot open shared object file: No such file or directory"
# (XPCOM glue load failure), which install-ricardo.sh's venv setup cannot
# detect or fix on its own since these are OS-level packages, not Python
# ones. This is the same dependency set `playwright install-deps firefox`
# installs; it's listed explicitly here because the Ricardo venv (and hence
# the `playwright` package it would run from) doesn't exist yet at image
# build time — install-ricardo.sh only creates it on demand, from the
# settings UI.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 python3-venv \
       libgtk-3-0 libx11-xcb1 libasound2 libdbus-glib-1-2 libxt6 \
       libxrender1 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
       libnss3 libnspr4 libcups2 libdrm2 libgbm1 libpango-1.0-0 \
       libpangocairo-1.0-0 libatk1.0-0 libatk-bridge2.0-0 libcairo2 \
       libgdk-pixbuf-2.0-0 fonts-liberation libxss1 libxtst6 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/scripts ./scripts

RUN mkdir -p /app/data

EXPOSE 3001

CMD ["npm", "start"]
