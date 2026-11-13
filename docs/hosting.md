# Hosting the web client

The web client is a static Angular application: files, served from
anywhere, that speak to a DecentAI engine somewhere else. The engine is
headless — an API, with no page of its own — so the two are hosted
apart, on different origins, and the only things that tie them together
are the engine's address, which the app needs, and the app's origin,
which the engine needs.

## Which engine

The app decides which engine to speak to once, as it starts, in this
order (`src/app/services/engine.service.ts`):

1. **The address the person entered**, kept in the browser
   (`localStorage`). The first screen asks for it when nothing else
   names one, as the app on a phone does; **Change** on the sign-in page
   sets another.
2. **The deployment's word**: `assets/config.json`, served beside the
   app's files:

   ```json
   {
     "engine": "https://api.example.com"
   }
   ```

   Written when the app is deployed, so that nobody is asked. The file
   is read afresh on every start (never cached by the service worker),
   so changing it on the host changes every browser's engine on its
   next load — unless a person chose one themselves, which wins.
3. **The page's own origin.** For a deployment whose own reverse proxy
   serves the engine's paths beside the app's files on one address —
   the engine brings no such proxy, but one a deployment chose keeps
   working with no configuration. The app asks that origin whether an engine answers
   there (`Auth:Join:status`) and shows the first screen when none does.

The address is the engine as a browser reaches it: `http://localhost:4280`
for `python deploy/setup/setup.py` on this computer, `https://api.example.com`
on a server, where whatever terminates TLS in front of the engine
answers. It may carry a path (`https://example.com/decentai`) where the
engine is served under one.

## What the engine needs to know

The browser calls the engine's API server across origins, with the
session token as an `Authorization: Bearer` header (the chat socket
offers it as a subprotocol). The API server answers only the origins
named in `AI_API_ORIGINS`: every origin the app is served from, exactly
as the browser's address bar shows it, and nothing wider. Its
`AI_API_APP_URL` is the app's address too: the links it mails
(`/invitation`, `/reset`, `/signup`) and a provider's return after an
account is connected (`/oauth/done`) are made from it. Its own
`AI_API_URL` is the address you give the app.

On one computer the engine's defaults already name the container
(`http://localhost:4300`) and the development server
(`http://localhost:4200`). The desktop app carries these files and serves
them itself, from its own origins (`http://tauri.localhost` on Windows,
`tauri://localhost` on macOS), which are added to `AI_API_ORIGINS` where it is used. On a server,
`https://` and the app's domain
([deploying](https://github.com/decentai-io/decentai-engine/blob/main/documentation/operating.md#3-on-a-server)
in the engine's repository).

## The session

Signing in answers with a token, which the app keeps itself: in
`localStorage` with **Keep me signed in on this device**, so it outlives
the browser being closed; in `sessionStorage` otherwise, so it goes with
the tab. Signing out, and a token the engine refuses, drop it. No cookie
is involved. Files are fetched
with the token too — a link or an `<img>` carries none — and shown or
saved from a blob.

## Its own container

```bash
docker compose up -d --build
```

publishes `http://localhost:4300` (`PORT` and `LISTEN` in the
environment change that). Set `ENGINE_URL` and the container writes it
into `assets/config.json` as it starts, so nobody is asked:

```bash
ENGINE_URL=https://api.example.com docker compose up -d --build
```

The image (`Dockerfile`) is Caddy serving the built files on port 80,
plain HTTP; TLS is for whatever is in front of it. `Caddyfile` sends
the headers a page should carry — no sniffing, no framing, the
permissions the chat needs — and the client-side routes fall back to
the page.

## A static host

`npx ng build --configuration container` (or `production`) writes
`dist/decentai/browser/`: upload it to any static host — GitHub Pages,
an object store behind a CDN, a plain web server. Two things to see to:

- **Every path falls back to `index.html`.** The app's routes
  (`/ai/chats`, `/settings`) are the page's, decided in the browser. On
  GitHub Pages, copy `index.html` to `404.html`; on other hosts, a
  rewrite rule.
- **`assets/config.json` names the engine**, as above, so that the app
  needs no first screen there. Write it after the build, into
  `dist/decentai/browser/assets/config.json`.

Served under a path (`https://you.github.io/decentai/`), build with
`--base-href /decentai/`.

## Releases

A release is a version tag, `v0.6.0`, pushed on a commit whose tests
passed (`.github/workflows/release.yml` refuses one whose tests did
not). It publishes two things, built from the same files:

- **The image**, `ghcr.io/decentai-io/decentai-web-client`, under the
  version and `latest`, for Intel and ARM. To run one rather than build
  this checkout:

  ```bash
  WEB_CLIENT_VERSION=0.6.0 docker compose pull
  WEB_CLIENT_VERSION=0.6.0 docker compose up -d --no-build
  ```

- **The files**, `decentai-web-client-0.6.0.zip` on the GitHub release,
  for a static host: unzip, write `assets/config.json`, upload.

The package is private until made public once, on GitHub, after the
first release. The engine is released by its own repository; a web
client and an engine released under the same number go together.

## The page's own policy

`index.html` carries a `Content-Security-Policy` meta tag, so that the
policy holds wherever the files are served — a static host sends no
header of its own. It allows the page's own files, the two Google hosts
that serve the IBM Plex fonts, pictures from `data:` addresses and from
blobs of its own, media from blobs of its own, and
`connect-src * ws: wss:`, because the engine's address is chosen at
run time. A deployment that knows its engine may tighten that line to
the engine alone, in both its forms:

```
connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://api.example.com wss://api.example.com
```

(`http://` and `ws://` for an engine in plain HTTP.) The container's
`Caddyfile` adds `frame-ancestors 'none'`, which a meta tag cannot
carry; a static host that lets you set headers may add the same.

## Developing

```bash
npm start
```

serves the app at `http://localhost:4200`, where changes reload in the
page. Its first screen asks for the engine's address — the Compose
stack's `http://localhost:4280`, or an API server started by hand at
`http://localhost:8000`, whose `AI_API_ORIGINS` must name
`http://localhost:4200`.
