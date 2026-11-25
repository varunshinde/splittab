FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
# Locked install only — never fall back to an unlocked `npm install`, which
# could resolve different (unaudited) dependency versions.
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
# Run as the unprivileged node user shipped with the image, not root.
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
