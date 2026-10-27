# NanoTrees HTTP API

The optional HTTP service lets Python, scripts and other applications analyze trees, compute meanings, export figures and run nanosyntactic spellout. It uses the editor's parser, semantics, derivation engine, scene geometry and exporters. The website still works entirely in the browser; this service runs separately.

## Local launch

Use Node.js 22 and npm. From the repository root:

```sh
npm ci
npx playwright install --with-deps chromium
npm run build:api
npm run start:api
```

The default address is **http://127.0.0.1:3000**. Open **/docs** for a short guide, **/openapi.json** for the OpenAPI 3.1 specification, or **/v1/capabilities** for the current defaults, supported fonts, limits and eight spellout configurations. `/health` checks that the HTTP service is running. Chromium starts on the first processing request; health alone does not test it.

`build:api` produces `dist-api/server.js` and `dist-api/renderer/`. Rebuild after changing the implementation. The service needs its production npm dependencies and Playwright Chromium at runtime. It does not require the Vite development server or an open editor tab.

## Docker launch

With Docker and Compose installed, run from the repository root:

```sh
docker compose -f compose.api.yaml up --build -d
curl http://127.0.0.1:3000/health
docker compose -f compose.api.yaml logs -f api
```

Stop it with:

```sh
docker compose -f compose.api.yaml down
```

`Dockerfile.api` builds the API and installs matching Playwright Chromium and its system libraries. The runtime uses the unprivileged `node` user. Compose binds port 3000 to **127.0.0.1 on the host**, provides an init process and 256 MB of shared memory. No data volume is needed: requests and generated files are not persisted.

To use a different local port or an API key:

```sh
PORT=3100 NANOTREES_API_KEY='replace-with-your-key' \
  docker compose -f compose.api.yaml up --build -d
```

These commands start a local service. They do not publish a public endpoint. Public access requires separate hosting, HTTPS and suitable access controls; GitHub Pages continues to serve the browser application.

## Requests and responses

Send UTF-8 JSON with `Content-Type: application/json`. Paths are versioned under `/v1`. Each request is independent: there are no saved canvases, sessions or changes to the user's browser project.

| Method and path | Response |
| --- | --- |
| `GET /health` | HTTP service status. |
| `GET /docs` | Short HTML guide. |
| `GET /openapi.json` | Machine-readable request schemas and response descriptions. |
| `GET /v1/capabilities` | Formats, fonts, effective application defaults, limits and eight algorithm configurations. |
| `POST /v1/trees/analyze` | A flat display graph and semantic results as JSON. |
| `POST /v1/trees/render` | The requested SVG, PNG, PDF or LaTeX file directly. |
| `POST /v1/nanosyntax/derive` | Derivation steps, final source, surface expressions and completion status as JSON. |

When `NANOTREES_API_KEY` is set, all `/v1/` requests need `Authorization: Bearer YOUR_KEY`. Health, documentation, the specification and renderer assets remain accessible without a key. CORS preflight does not require authentication. The examples below assume the default local service without a key; add that header when using one.

## Export a tree

```sh
curl --fail-with-body http://127.0.0.1:3000/v1/trees/render \
  -H 'Content-Type: application/json' \
  -d '{"source":"[S [NP John] [VP runs]]","format":"svg"}' \
  -o tree.svg
```

| Field | Default and purpose |
| --- | --- |
| `source` | Required bracket-notation tree, with the same expressions, meanings, movement references and source styling as the editor. |
| `format` | `svg` (default), `png`, `pdf` or `latex`. |
| `build` | Partial structural settings; omitted values inherit application defaults. |
| `style` | Partial visual settings; omitted values inherit application defaults. |
| `scale` | PNG scale, 1–6; default 2. Other formats use their native vector/text output. |
| `transparent` | Default false; applies to SVG, PNG and PDF. |
| `embedFonts` | Default true; controls SVG font embedding. PDF always uses the existing font-embedding exporter. |
| `latex.format` | `forest` (default), `qtree` or `tikz` for exact layout. |
| `latex.standalone` | Default true; false returns a fragment for an existing document. |

For example, a transparent PNG with traces:

```json
{
  "source": "[CP [DP#wh what] [TP [DP you] [VP saw #wh]]]",
  "format": "png",
  "scale": 3,
  "transparent": true,
  "build": {"chains": "traces"},
  "style": {"font": "libertinus", "fontSize": 22, "arrowColor": "#a43727"}
}
```

The response is a file with the corresponding `Content-Type` and `Content-Disposition`. `X-NanoTrees-Width` and `X-NanoTrees-Height` report the sheet dimensions in CSS pixels before PNG scaling. PDF is vector output. SVG, PNG, PDF and exact-layout TikZ reuse the editor's scene; editable Forest and tikz-qtree let LaTeX lay out the hierarchy.

The API supports the bundled font IDs reported by `/v1/capabilities`, including `cmu`, `libertinus`, `garamond`, `times`, `charis`, `noto-serif`, `noto-sans`, `roboto` and `caveat`. `times` uses Tinos in the server environment. Fonts installed on a caller's computer are unavailable to the service.

## Analyze structure and semantics

```sh
curl --fail-with-body http://127.0.0.1:3000/v1/trees/analyze \
  -H 'Content-Type: application/json' \
  -d '{"source":"[S [DP Mary $mary : e$] [VP sleeps $λx. sleep(x) : <e,t>$]]"}'
```

The JSON contains:

- `root`: the root node's key.
- `nodes`: labels and rich-text runs, children and parents as keys, node kind, chain/copy information, features, glosses, spellout and meanings when present.
- `arrows`: endpoints as keys, arrowhead/line type, chain and head-movement metadata when present.
- `warnings`: semantic errors associated with node keys.
- `build`: the effective build settings used for analysis.

This is a display graph: terminal expressions can be separate `leaf` nodes. A syntactic terminal's label remains a syntactic label. Multidominance is represented by multiple parents referring to one key, avoiding JSON cycles. Keys identify nodes within this result; do not treat them as permanent database identifiers across edits.

`meaning` includes `text`, rich-text `runs`, `type`, and, for computed meanings, `computed`, `source` and the composition `rule` where applicable. Invalid composition includes `error`. In the example, the root computes `sleep(mary)` of type `t` by Functional Application. Analysis retains type and rule metadata regardless of the visual `types`/`rules` switches. `build.semantics.compute=false` disables inferred meanings; `build.semantics.show=false` omits meanings altogether.

Both analysis and rendering accept `build` settings for `mode` (`manual` or `xbar`), `chains` (`copies`, `traces`, `multidominance`), X-bar settings, movement-arrow switches, indices, empty positions, lexical-tree arrows and semantics. `style` accepts the editor's `TreeStyle` fields, such as spacing, font, colours, line patterns, copy appearance and `circlePhrasalSpellout`. Exact field names and numeric bounds are in `/openapi.json`; current defaults are in `/v1/capabilities`. Unknown fields are rejected to make misspellings visible.

## Run nanosyntactic spellout

Supply an S-tree and the lexicon for that request. Entries use ordinary tree code; phrasal expressions belong on their phrase with `;spell=`.

```sh
curl --fail-with-body http://127.0.0.1:3000/v1/nanosyntax/derive \
  -H 'Content-Type: application/json' \
  -d '{
    "source": "[F2 [F1]]",
    "lexicon": [
      {"id": "word", "source": "[F2P;spell=\"word\" [F2] [F1P [F1]]]"}
    ],
    "algorithm": {
      "movement": "caha2025",
      "closure": "early",
      "backtracking": "aux-only"
    }
  }'
```

Each lexical entry requires `source`. `expression` may be supplied explicitly; otherwise it is read from `;spell=` on the lexical root. An explicit expression takes precedence. Optional `id` values must be unique; omitted IDs become `l1`, `l2`, etc.

Three independent binary choices provide **eight configurations**:

| Setting | Values |
| --- | --- |
| `movement` | `starke2018`: spec-to-spec then complement movement; `caha2025`: the published evacuation procedure, beginning with the closest labelled non-remnant constituent. |
| `closure` | `late`: keep growing AUX while it lexicalizes; `early`: close AUX as soon as it lexicalizes. |
| `backtracking` | `aux-only`: merge F in the reopened auxiliary workspace; `multiple-merge`: try F independently in every reopened workspace. |

`algorithm` can also name a preset: `starke2018`, `caha2019`, `caha2019mm` or `caha2025`. The default is `caha2025` (2025 movement, early closure, AUX-only backtracking). A partial settings object inherits missing values from that default. The detailed algorithm explanations, source links and implementation limits are in [Nanosyntax](nanosyntax.md), including the discussion of Multiple Merge in Caha 2019 and chapter 7 of the 2025 volume.

The result includes `steps`, final `source`, `surface` expressions, effective `algorithm`, `complete`, `limited`, `unresolved` and `warnings`. Steps contain source snapshots, operation descriptions and lexicalization information. While workspaces remain independent, a step's `workspaces` array supplies their separate tree sources. These sources can be passed individually to `/v1/trees/render`; the API does not compose a whole canvas image.

Step sources follow the editor's movement display: lower copies appear only on their own movement step, and disappear on subsequent lexicalization steps. Unmatched domains receive `;spellfail=yes`. A successful complete derivation uses its actual final step rather than appending a duplicate Fully lexicalised snapshot.

**A partial derivation returns HTTP 200 with `complete=false`.** Check that flag. Missing lexical entries are a linguistic result, not a transport failure. `limited=true` means a configured search/trace limit was reached; inspect warnings. Optional `options.maxAttempts` (1–1,800) and `options.maxSteps` (3–700) can lower the search bounds. Invalid source or an unsupported S-tree returns HTTP 422.

## Python example

Install the client dependency with `python -m pip install requests`:

```python
from pathlib import Path
import requests

base = "http://127.0.0.1:3000"
client = requests.Session()
# If configured on the server:
# client.headers["Authorization"] = "Bearer YOUR_KEY"

response = client.post(
    f"{base}/v1/trees/render",
    json={"source": "[S [NP John] [VP runs]]", "format": "pdf"},
    timeout=75,
)
response.raise_for_status()
Path("tree.pdf").write_bytes(response.content)

response = client.post(
    f"{base}/v1/nanosyntax/derive",
    json={
        "source": "[F2 [F1]]",
        "lexicon": [{"source": '[F2P;spell="word" [F2] [F1P [F1]]]'}],
        "algorithm": "caha2025",
    },
    timeout=75,
)
response.raise_for_status()
result = response.json()
print(result["complete"], result["surface"], result["warnings"])
for step in result["steps"]:
    print(step["source"])
```

## Configuration and execution limits

Set environment variables before `npm run start:api`. Compose forwards the `NANOTREES_*` variables listed below; its `PORT` selects the host port while the container keeps port 3000.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` locally; `0.0.0.0` inside Docker | Listening interface. |
| `PORT` | `3000` | Listening port; 0 selects an available port for local testing. |
| `NANOTREES_API_KEY` | Unset | Optional shared bearer key for `/v1/`. |
| `NANOTREES_ALLOWED_ORIGINS` | `*` | Comma-separated browser origins. CORS controls browsers; it does not replace authentication for scripts. |
| `NANOTREES_CONCURRENCY` | `2` | Active Chromium jobs, 1–8. |
| `NANOTREES_QUEUE_LIMIT` | `16` | Waiting jobs, 0–100. |
| `NANOTREES_TIMEOUT_MS` | `30000` | Execution deadline and, separately, queue-wait deadline, 1,000–120,000 ms. |
| `PW_CHROMIUM_PATH` | Playwright-managed executable | Optional custom Chromium path for local launch. |

Each job runs in its own browser context. Browser requests are limited to the service's renderer/font assets and in-memory data/blob resources. Inputs and results are not saved. Chromium adds a memory/CPU cost compared with opening the static website, and derivation search varies with the tree and lexicon. Queue and deadline limits bound concurrent work; a saturated queue returns 503. A client disconnect does not immediately cancel a job; its execution deadline still applies.

Request bounds: 1 MiB JSON, 50,000 characters per source, 96 bracket levels, 400 display nodes for analysis/rendering, and 128 lexical entries. The derivation engine also limits S-trees to 180 input nodes. Images are limited to 16,777,216 pixels and 16,384 pixels per side, including PNG scale. Font size is 6–96 px. Other numeric/style bounds are recorded in the specification.

Errors use this shape:

```json
{"error":{"code":"INVALID_TREE","message":"…","details":{"line":1,"col":3}}}
```

`details` is optional and depends on the error. Statuses include 400 for malformed JSON/settings, 401 for a missing/incorrect configured key, 403 for a disallowed browser origin, 413 for oversized bodies, 415 for the wrong content type, 422 for invalid/too-complex trees or oversized images, 503 for renderer/queue unavailability, and 504 for execution timeouts. A missing Chromium installation returns `RENDERER_UNAVAILABLE` with an installation hint.

## Verification and code

```sh
npm run typecheck
npm test -- tests/api.test.ts
npm run test:api
```

The HTTP contract tests cover validation, authentication, CORS, bounds and error handling. `test:api` builds the service, starts it on a temporary port and makes real HTTP requests through Chromium: semantic composition, shared-node JSON, SVG/PNG/PDF, all three LaTeX exporters, all eight rule combinations, invalid input and partial/limited derivations. Install Chromium before running that integration check.

`api/server.ts` defines HTTP transport, `api/schema.ts` validates requests, `api/backend.ts` manages Chromium jobs, and `api/renderer/main.ts` calls the shared editor core and exporters. The two Vite API configs build the server and its browser renderer separately from the frontend. The GitHub Pages deployment remains the frontend build.
