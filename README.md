# DecentAI web client

The web app for [DecentAI](https://github.com/decentai-io/decentai): an
Angular single-page application, one of the platform's clients. It speaks
only to the DecentAI engine's Data Core — sign-in, the app gateway, file
storage and the chat's WebSocket — at whatever address that engine has.

## How it fits with the engine

The engine (the `decentai` repository) is headless: an API at
`http://localhost:4280` on a computer of your own, with no page of its
own. This repository is the page. It is served on its own — its
container, a static host, the development server — and told the
engine's address: on its first screen, as the app on a phone asks, or by
a file written when it is deployed. The browser then calls the engine
across origins, with the session token the sign-in handed it
([hosting](docs/hosting.md)).

Keep the two repositories side by side:

```text
decentai/              the engine: python deploy/setup/setup.py starts it
decentai-web-client/   this repository
```

## Run it

Start the engine first (`python deploy/setup/setup.py` in `decentai`), then,
here:

```bash
docker compose up -d --build
```

Open `http://localhost:4300`. The first screen asks for the engine's
address: `http://localhost:4280`, which the engine's script printed.
Then, the first time, it asks for the first run's code (the script
printed it too), and you name your organization and choose your own
email and password; after that it is the sign-in page, and
**Change** there picks another engine.

To skip the first screen, name the engine when the container starts:
`ENGINE_URL=http://localhost:4280 docker compose up -d --build`. The
engine must allow the app's origin: its `AI_API_ORIGINS` names
`http://localhost:4300` and `http://localhost:4200` by default; the
desktop app's two (`http://tauri.localhost`, `tauri://localhost`), which
carries this web client inside it, are added there when it is used; another port here (`PORT`) is another
origin to name there.

## Develop

```bash
npm install
npm start
```

`npm start` runs the development server at `http://localhost:4200`;
changes reload in the page. Its first screen asks for the engine's
address as above.

## Test

```bash
npm test
```

Runs the unit tests in Chrome through Karma. Without a window,
`npx ng test --watch=false --browsers=ChromeHeadless`, as CI does.

## Build

```bash
npm run build
```

`npx ng build --configuration container` is the build the container
serves (`Dockerfile`, `Caddyfile`). The same files go on any static host
— GitHub Pages, an object store — with `assets/config.json` naming the
engine ([hosting](docs/hosting.md)).

## Design

Every screen follows [the design language](docs/design-language.md); the
identity itself, the mark, the lockups and their colours, is in
[the brand guide](docs/brand.md), and its files in `src/assets/brand/`.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
