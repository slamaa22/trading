FROM node:22-alpine

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source and static assets
COPY src ./src
COPY public ./public
COPY README.md ./

# Ensure persistent data directory exists
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3400

EXPOSE 3400

CMD ["node", "src/server.js"]
