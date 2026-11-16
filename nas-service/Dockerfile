# 零依赖：镜像里只装 Node.js，不需要 npm install
FROM node:20-alpine

ENV PORT=3000
ENV DATA_DIR=/data/images
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "/app/server.js"]
