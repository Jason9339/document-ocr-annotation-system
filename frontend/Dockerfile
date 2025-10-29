# Frontend development image
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=development

# Install dependencies using lockfile for reproducibility
COPY frontend/package.json frontend/package-lock.json /tmp/
RUN cd /tmp \
    && npm ci \
    && mkdir -p /app \
    && cp -r /tmp/node_modules /app/node_modules \
    && rm -rf /tmp/*

# App source mounted at runtime for hot reload
