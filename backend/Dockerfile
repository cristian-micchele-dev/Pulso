FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
# tsconfig.build.json va SI O SI: `nest build` lo prefiere sobre tsconfig.json y
# es el unico que fija rootDir en ./src. Sin el, TypeScript 6 falla con TS5011
# porque la raiz quedaria implicita.
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node","dist/main.js"]
