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

WORKDIR /app

# Ricardo's optional community CLI is Python-based. Keep Python in the runtime
# image (not just the build stage), and use a venv to avoid Debian's externally
# managed system-Python restrictions (PEP 668).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/scripts ./scripts

RUN mkdir -p /app/data

EXPOSE 3001

CMD ["npm", "start"]
