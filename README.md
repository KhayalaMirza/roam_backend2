# Roam API — mock data (JSON)

Real responses captured from the Roam backend — same shape as the live API.
`index.json` lists every endpoint → file (method, URL, status, request body).

| Folder | Endpoint |
|---|---|
| `regions.json` | GET /v1/regions |
| `countries/index.json`, `countries/by-region/*.json` | GET /v1/countries[?regionId=] |
| `countries/{id}.json` (12) | GET /v1/countries/{id} |
| `cities/{id}.json` (28) | GET /v1/cities/{id} |
| `places/giza.json` | GET /v1/places/{id} |
| `tours/index.json`, `tours/by-region/*.json`, `tours/filtered-example.json`, `tours/empty-result.json`, `tours/index-eur.json` | GET /v1/tours?... |
| `tours/filters*.json` | GET /v1/tours/filters |
| `tours/{id}.json` (16) | GET /v1/tours/{id} |
| `auth/*.json` | POST /v1/auth/register, /login |
| `me/*.json` | GET /v1/me, PUT /v1/me/preferences |
| `favorites/*.json` | GET/POST/DELETE /v1/favorites |
| `requests/*.json` | quote, create (Request sent), list (all/pending/confirmed/past), detail |
| `ai/chat-1…5*.json` | POST /v1/ai/chat — free text → questions → ready → plan → "Make it cheaper" |
| `ai/plan-*.json`, `ai/plans-list.json`, `ai/discover.json` | Saved plans, Discover screen |
| `rates.json` | GET /v1/rates |
| `errors/*.json` | 400 validation, 401 login required / wrong password, 404 |

Tokens in `auth/*.json` are sample values from a local dev server — not valid anywhere else.
