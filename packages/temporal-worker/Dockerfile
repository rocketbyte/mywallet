FROM node:20-slim

# Avoid Alpine - incompatible with Rust core of TypeScript SDK
WORKDIR /app

# Copy package files
COPY package.json ./
COPY packages/temporal-worker/package.json ./packages/temporal-worker/
COPY packages/temporal-workflows/package.json ./packages/temporal-workflows/

# Install dependencies (using npm install as package-lock.json is gitignored)
RUN npm install --workspace=@mywallet/temporal-worker --workspace=@mywallet/temporal-workflows

# Copy source code
COPY packages/temporal-worker ./packages/temporal-worker
COPY packages/temporal-workflows ./packages/temporal-workflows
COPY tsconfig.base.json ./

# Build
RUN npm run build --workspace=@mywallet/temporal-workflows
RUN npm run build --workspace=@mywallet/temporal-worker

# Create symlink so src imports can find dist (temporary workaround)
RUN cd packages/temporal-workflows && ln -sf dist src

# Set memory limit (80% of available memory)
ENV NODE_OPTIONS="--max-old-space-size=1600"

CMD ["node", "packages/temporal-worker/dist/worker.js"]
