FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install --production

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
COPY knexfile.js migrations seeds ./
COPY src ./src
EXPOSE 3000
CMD ["node", "src/server.js"]
