# 🏓 Summer Table Tennis Championship 2026

A single-page web app for running a **single-elimination table tennis tournament**, deployed as an Azure Static Web App with Entra ID (Azure AD) admin authentication.

🌐 **Live:** [tabletennis.threatninja.at](https://tabletennis.threatninja.at)

---

## ✨ What it does

- 👥 **Register players** (up to 16)
- 🎲 **Auto-generate the bracket** — handles non-power-of-2 player counts via byes
- 📝 **Enter match results** — best of 3 sets, automatic winner advancement
- 🏆 **Crown a champion** — confetti included
- 📖 **Bilingual rules page** (English & German)
- 🌓 **Light/dark theme toggle**

### Two access levels

| Role | Who | Can do |
|---|---|---|
| 👁️ **Viewer** | Anyone, no sign-in | See players, bracket, live results — read-only |
| 🛡️ **Admin** | Any account in the **`threatninja.at`** Entra tenant | Everything: add/remove players, generate bracket, enter scores, reset tournament |

Sign-in is enforced by Azure Static Web Apps + Entra ID; the API double-checks the tenant claim server-side.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                    │
│    index.html  ←──  fetch /api/state (poll every 15s)       │
│       │                                                     │
│       └── admin actions ──► PUT /api/state (signed-in only) │
└──────────────────────────────────────────┬──────────────────┘
                                           │
┌──────────────────────────────────────────▼──────────────────┐
│  Azure Static Web App  (swa-tabletennis-2026, Free SKU)     │
│   ├── Static frontend (index.html)                          │
│   ├── Built-in auth → Entra ID (single-tenant)              │
│   └── Managed Functions API  →  /api/state                  │
│         GET   anonymous     → returns tournament JSON       │
│         PUT   authenticated → validates tid, writes blob    │
└──────────────────────────────────────────┬──────────────────┘
                                           │
┌──────────────────────────────────────────▼──────────────────┐
│  Azure Blob Storage  (sttabletennis2026 / state / tournament.json)
│      Single JSON document — players, matches, status, champion
└─────────────────────────────────────────────────────────────┘
```

### Tech stack

- **Frontend:** Single self-contained `index.html` (vanilla HTML/CSS/JS, no build step)
- **Backend:** Azure Functions (Node 20) — one HTTP function: `api/state`
- **Auth:** Azure Static Web Apps built-in OIDC with an Entra ID app registration (single-tenant)
- **Storage:** Azure Blob Storage, one JSON blob, accessed via the app's service principal (managed identity is not available on Free SKU)
- **Hosting:** Azure Static Web Apps (Free SKU, West Europe)
- **CI/CD:** GitHub Actions (`Azure/static-web-apps-deploy@v1`) — push to `main` auto-deploys

---

## 📁 Repository layout

```
.
├── index.html                          # The entire frontend app
├── staticwebapp.config.json            # SWA auth + route guards
├── api/                                # Azure Functions API
│   ├── host.json
│   ├── package.json                    # @azure/identity, @azure/storage-blob
│   └── state/
│       ├── function.json               # HTTP trigger, methods: GET, PUT
│       └── index.js                    # Handler — auth check + blob R/W
└── .github/workflows/                  # Auto-deploy on push to main
    └── azure-static-web-apps-*.yml
```

---

## 🔌 API

Single endpoint: `/api/state`

| Method | Auth | Description |
|---|---|---|
| `GET` | Anonymous | Returns the current tournament state JSON. Returns the default empty tournament if the blob does not exist yet. |
| `PUT` | Required (Entra ID, `threatninja.at` tenant) | Replaces the tournament state. Server validates the `tid` claim from `x-ms-client-principal` before writing. Body is sanitized to a whitelist of fields. |

State shape:

```jsonc
{
  "players":  [ { "id": "...", "name": "...", "eliminated": false, "seed": 1 } ],
  "matches":  [ { "id": "r1_m0", "round": 1, "position": 0,
                  "player1": "...", "player2": "...",
                  "sets": [...], "winner": "...", "completed": true } ],
  "rounds":   4,
  "status":   "registration | in_progress | completed",
  "champion": "<playerId> | null"
}
```

---

## 🚀 Deployment

The site auto-deploys on every push to `main` via GitHub Actions. No manual steps needed.

### One-time Azure setup that's already in place

- **Resource group:** `rg-tabletennis` (West Europe)
- **Static Web App:** `swa-tabletennis-2026` (linked to this GitHub repo, branch `main`)
- **Storage account:** `sttabletennis2026` with private blob container `state`
- **Entra app registration:** `TableTennis-SWA-Auth` (single-tenant, redirect URIs for both the `*.azurestaticapps.net` and `tabletennis.threatninja.at` hostnames)
- **Custom domain:** `tabletennis.threatninja.at` bound to the SWA

### App settings on the SWA

| Setting | Purpose |
|---|---|
| `AAD_CLIENT_ID` | Entra app client ID — used for both sign-in and blob access |
| `AAD_CLIENT_SECRET` | Entra app client secret |
| `AAD_TENANT_ID` | `b24c82d6-b961-4584-b030-8e90c039fa28` (threatninja.at) |
| `STORAGE_ACCOUNT` | `sttabletennis2026` |

The Entra app's service principal has **Storage Blob Data Contributor** on the storage account.

---

## 🔐 Security model

- Sign-in is single-tenant by `openIdIssuer` — only `threatninja.at` accounts can complete the OIDC flow.
- The `staticwebapp.config.json` requires the `authenticated` role on any non-GET request to `/api/state`.
- The Function itself re-validates the `tid` claim from the SWA-supplied `x-ms-client-principal` header before writing — defense in depth.
- Blob public access is disabled; storage is reached only via the Entra service principal credential.
- All admin-only UI actions (`addPlayer`, `removePlayer`, `generateBracket`, `submitScore`, `resetTournament`) are also guarded client-side, but the server is the source of truth.

---

## 🛠️ Local development

The frontend works fully standalone — just open `index.html` in a browser to play with the UI (calls to `/api/state` will fail, but the rest renders). For full local dev with the API:

```bash
# Install the Azure Static Web Apps CLI and Functions Core Tools
npm i -g @azure/static-web-apps-cli azure-functions-core-tools@4

# From the repo root, install API deps
cd api && npm install && cd ..

# Run frontend + API together (auth is emulated)
swa start . --api-location api
```

You'll need to set the same app settings (`AAD_CLIENT_ID`, `AAD_CLIENT_SECRET`, `AAD_TENANT_ID`, `STORAGE_ACCOUNT`) as environment variables for the local API to reach Azure Storage.

---

## 📜 Tournament rules (TL;DR)

- 16 players max, single elimination
- Bracket size rounds up to the next power of 2; top seeds get byes
- Matches are best of 3 sets, first to 11 with a 2-point margin
- Loser is eliminated immediately; winner advances
- Last player standing is the champion 🏆

Full rules (EN & DE) are inside the **Rules** tab in the app.

---

🦞 Built with ❤️ by Shelldon
