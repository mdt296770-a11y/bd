FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY scripts ./scripts
RUN mkdir -p uploads && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["sh","-c","node scripts/migrate.js && node src/server.js"]
