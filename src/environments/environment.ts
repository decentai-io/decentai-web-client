// Development (`npm start`, port 4200). The engine's address is not
// here: EngineService resolves it — what the person entered, then
// `assets/config.json`, then this page's own origin — and the Connect
// screen asks when none answers. The engine's CORS_ALLOW_ORIGINS names
// http://localhost:4200 by default, so the development server may call
// it from here.
export const environment = {
  production: false,
};
