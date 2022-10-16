FROM node:14-alpine AS builder

WORKDIR /workspaces/http-public

COPY package*.json ./

RUN npm ci

COPY . .

RUN rm -rf dist

RUN npm test

RUN npm run build

FROM node:14-alpine

WORKDIR /usr/app

COPY --from=builder /workspaces/http-public/package*.json ./
COPY --from=builder /workspaces/http-public/dist ./dist

RUN npm ci --only=production

EXPOSE 1111

CMD exec node dist/bin/index.js server \
                -t $HTTP_PUBLIC_TOKEN \
                -n $HTTP_PUBLIC_HOST
