# Minimal image for the WARP relay. Railway can also build it with zero config
# via Nixpacks (it auto-detects package.json), but this Dockerfile makes the
# deploy reproducible on any platform.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY server.js ./
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
