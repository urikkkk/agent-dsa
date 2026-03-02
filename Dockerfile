FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY agent/package.json agent/
RUN npm ci -w shared -w agent --ignore-scripts

# Copy source
COPY shared/ shared/
COPY agent/ agent/
COPY tsconfig.base.json ./

# Default: run the polling agent
CMD ["npx", "tsx", "agent/src/index.ts"]
