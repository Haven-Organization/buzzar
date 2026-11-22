# Buzzar as a static site in nginx (Third Room #591).
#
#   docker build -t buzzar .
#   docker run -p 8080:80 buzzar        # then open http://localhost:8080
#
# The default homeserver and other settings come from config.json at build time; edit it before building.
# Put TLS in front (a reverse proxy) for anything but localhost: browsers only allow the microphone and
# SharedArrayBuffer on secure origins.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json yarn.lock ./
RUN HUSKY=0 yarn install --frozen-lockfile
COPY . .
RUN yarn vite build && yarn docs:build

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
