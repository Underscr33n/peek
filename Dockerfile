FROM node:24-alpine
WORKDIR /app
COPY server.mjs index.html ./
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["node", "server.mjs"]
