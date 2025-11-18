FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY src ./src
COPY i18n ./i18n
ENV NODE_ENV=production
ENV STORAGE_ROOT=/data
VOLUME ["/data"]
CMD ["node", "src/index.js"]
