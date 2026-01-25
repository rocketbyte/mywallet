FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY packages/backend-apis/package.json ./packages/backend-apis/
COPY packages/temporal-workflows/package.json ./packages/temporal-workflows/

# Install dependencies
RUN npm install --workspace=@mywallet/backend-apis --workspace=@mywallet/temporal-workflows --omit=dev

# Copy source code
COPY packages/backend-apis ./packages/backend-apis
COPY packages/temporal-workflows ./packages/temporal-workflows
COPY tsconfig.base.json ./

# Build
RUN npm run build --workspace=@mywallet/temporal-workflows
RUN npm run build --workspace=@mywallet/backend-apis

# Set memory limit
ENV NODE_OPTIONS="--max-old-space-size=1600"

EXPOSE 3000

CMD ["node", "packages/backend-apis/dist/index.js"]
