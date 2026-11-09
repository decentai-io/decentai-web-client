# The web client, built and served as files, on a port of its own. It
# speaks to a DecentAI engine somewhere else: the address the person
# enters on its first screen, or the one ENGINE_URL writes into
# assets/config.json as the container starts (docs/hosting.md).
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx ng build --configuration container

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist/decentai/browser /srv
# The deployment's word on where the engine is, written as the container
# starts: ENGINE_URL set, assets/config.json names it and nobody is
# asked; unset, the file is left as built (it names nothing) and the
# first screen asks. The address is written as a JSON string, so a
# quote in it cannot escape the file.
COPY <<'EOF' /usr/local/bin/serve
#!/bin/sh
set -e
if [ -n "$ENGINE_URL" ]; then
  printf '{\n  "engine": "%s"\n}\n' "$(printf '%s' "$ENGINE_URL" | sed 's/\\/\\\\/g; s/"/\\"/g')" > /srv/assets/config.json
fi
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
EOF
# Docker on Windows may write the script above with Windows line
# endings, and `#!/bin/sh` followed by a carriage return names no
# shell: the container then cannot start. Plain line endings, always.
RUN sed -i 's/\r$//' /usr/local/bin/serve && chmod +x /usr/local/bin/serve
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:2019/config/ || exit 1
CMD ["/usr/local/bin/serve"]
