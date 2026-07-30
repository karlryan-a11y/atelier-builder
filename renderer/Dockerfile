# Playwright's official image ships Chromium + all its system libs at a pinned version, so the
# headless browser "just works" on the box. Keep this tag in sync with the playwright dep version.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app
ENV NODE_ENV=production

# Install deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Build the TypeScript service.
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
