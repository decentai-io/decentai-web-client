// Container / self-hosted build (Dockerfile, Caddyfile): the app's
// files served by Caddy on a port of their own. The engine's address is
// not here: EngineService resolves it — what the person entered, then
// `assets/config.json` beside the app's files (the container's to
// write), then this page's own origin — and the Connect screen asks
// when none answers. One image runs on any host without a rebuild.
export const environment = {
  production: true,
};
