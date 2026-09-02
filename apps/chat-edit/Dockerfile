FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node apps/chat-edit/server.js ./server.js
COPY --chown=node:node apps/chat-edit/public ./public
COPY --chown=node:node shared ./node_modules/@scrambo/shared

USER node
EXPOSE 8080
CMD ["node", "server.js"]
