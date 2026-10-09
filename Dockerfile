FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY shared ./shared
COPY public ./public
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
