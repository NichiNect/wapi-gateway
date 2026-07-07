# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
# Copy package.json and yarn.lock
COPY package.json yarn.lock ./
# Install all dependencies (including devDependencies)
RUN yarn install --frozen-lockfile
# Copy source code
COPY . .
# Build the TypeScript project
RUN yarn build
# Prune node_modules to contain only production dependencies
RUN yarn install --production --frozen-lockfile


# Stage 2: Production
FROM node:20-alpine AS runner
# Install tini for signal forwarding and zombie process reaping
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production

# Copy compiled files and production node_modules from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Create auth directory and ensure node user has permissions
RUN mkdir -p auth && chown -R node:node /app

# Switch to non-root user
USER node

# Expose port (adjust if your Fastify app uses a different port)
EXPOSE ${APP_PORT}

# Use tini as the entrypoint
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "dist/index.js"]
