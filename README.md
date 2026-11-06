# Roam — Backend + iOS API client

> **Postman ilə yoxlamaq üçün → [POSTMAN.md](POSTMAN.md)** (ən tez yol: `node mock/server.js`, sonra `http://localhost:3000/v1/tours`)

Bu repo “Roam — Tour Application: Məhsul və Dizayn Planı” sənədindəki (bölmə 9 və 11) backend-in tam işlək versiyasıdır, üstəlik Swift iOS tətbiqi üçün hazır API client paketi.

```
roam/
├── backend/          NestJS 11 + PostgreSQL 16 + Drizzle ORM (REST API, /v1)
├── ios/RoamAPI/      Swift Package: Codable modellər + async/await client + Keychain token saxlama
├── postman/          Roam.postman_collection.json (Visualize ilə) + Roam-Mock (Postman cloud mock)
├── mock/             Hazır JSON data (101 endpoint) + server.js — Node.js ilə serversiz API
├── POSTMAN.md        Postman təlimatı (addım-addım)
├── .github/workflows GitHub Actions: hər push-da backend testləri
└── openapi.json      Bütün endpoint-lərin OpenAPI 3 sxemi (swift-openapi-generator ilə də istifadə oluna bilər)
```

## Tez başlanğıc

```bash
cd backend
# (istəyə bağlı) cp .env.example .env — öz ayarlarınız üçün
docker compose up --build       # API + PostgreSQL, data avtomatik yüklənir — bu kifayətdir
# və ya Docker-siz: docker compose up -d db (və ya öz PostgreSQL-iniz), sonra:
npm ci
npm run build
npm run db:migrate
npm run db:seed                 # 4 region, 12 ölkə, 28 şəhər, 78 məkan, 16 tur + admin
npm start                       # http://localhost:3000/v1 — Swagger: /docs
npm test                        # 44 e2e test (real Postgres üzərində, roam_test bazası)
```

Tam Docker: `docker compose up --build` (miqrasiyalar start zamanı avtomatik işləyir).

## Postman ilə yoxlama

1. Serveri işə salın (yuxarıdakı addımlar) — `http://localhost:3000/health` → `{"status":"ok"}`.
2. Postman → **Import** → `postman/Roam.postman_collection.json`.
3. Kolleksiya → **Variables**: `baseUrl` (default `http://localhost:3000`), `adminPassword` = `.env`-dəki `ADMIN_PASSWORD`.
4. Qovluqları yuxarıdan aşağı işə salın, ya da **Run collection** ilə hamısını birdən. *Register* tokeni saxlayır, sonrakı sorğular onu avtomatik istifadə edir.

## Sənəddəki qərarların backend-də qarşılığı

| Sənəd tələbi | Necə həll olunub |
|---|---|
| Vahid məlumat mənbəyi | Bütün kataloq bir `CatalogStore`-dan oxunur; Home, Countries, Favorites və AI eyni tur obyektini (eyni ID, qiymət, `isFavorite`) qaytarır |
| Qiymətlər bazada AZN | Bütün məbləğlər AZN-də saxlanır; cavablarda `priceAZN` + seçilmiş valyutada `price: {amount, currency, formatted}` (“980 AZN”, “€495”, “$576”) |
| Valyuta Profile-dan | `PATCH /me {currency}` → bütün cavablar avtomatik o valyutada; qonaq üçün `?currency=EUR` |
| Kurs gündə bir dəfə | CBAR XML-i hər gün 10:05 (Bakı) çəkilir, bazada saxlanır; əlçatmazsa son kurs/fallback; `GET /rates` cihazda keşlənir |
| Request ≠ bron, ödəniş yoxdur | `POST /requests` → `TR-2481` nömrəsi, 3 addımlı “What happens next”, operatora həmişə AZN məbləği gedir |
| Status dəyişəndə push | Operator `PATCH /admin/requests/:id` → APNs push (token-based .p8) |
| Qonaq rejimi | Kataloq və AI açıqdır; favorite/sorğu/plan saxlama `401 {error: "LoginRequired"}` qaytarır → tətbiq login pəncərəsini açır |
| Validasiya (sahə altında qırmızı mətn) | Xətalar `fields: {email: "Enter a valid email address."}` formatında gəlir |
| Filtr → Travel preferences | “Show results”-da `PUT /me/preferences`; AI planlayıcı bunları default kimi götürür |
| AI açarı mobil tətbiqdə olmasın | Claude API yalnız backend-dədir; cavab struktur JSON; büdcəni **model yox, server** City “Daily budget” və məkan qiymətlərindən hesablayır |
| Turlar admin paneldən idarə olunur | `PUT/DELETE /admin/catalog/{regions|countries|cities|places|stays|tours}/:id` (admin rolu) |

## Endpoint-lər (qısa)

**Auth** — `POST /auth/register`, `/login`, `/google`, `/apple`, `/refresh` (rotating, reuse detection), `/logout`, `/forgot-password`, `/reset-password`

**Kataloq** (qonaq üçün açıq) — `GET /regions`, `/countries?regionId=`, `/countries/:id`, `/cities/:id`, `/places/:id`, `/tours?region=&country=&city=&budgetMin=&budgetMax=&currency=&duration=&type=&sort=&q=&page=&limit=`, `/tours/filters?regionId=`, `/tours/:id`

**Profile** — `GET/PATCH/DELETE /me`, `PUT /me/preferences`, `POST /me/password`, `POST /me/devices`, `DELETE /me/devices/:token`

**Favorites** — `GET /favorites?type=&q=&region=&maxPrice=&category=`, `POST /favorites`, `DELETE /favorites?type=&itemId=`, `DELETE /favorites/:id`

**Sorğular** — `GET /requests/quote`, `POST /requests`, `GET /requests?status=all|pending|confirmed|past`, `GET /requests/:id`, `POST /requests/:id/cancel`

**AI** — `GET /ai/discover`, `POST /ai/chat`, `POST/GET /ai/plans`, `GET/DELETE /ai/plans/:id`

**Digər** — `GET /rates`, `GET /health`; Admin/operator: `GET /admin/requests`, `PATCH /admin/requests/:id`, `POST /admin/rates/refresh`, `PUT /admin/rates`

Tam sxem: `openapi.json` və ya işləyən serverdə `/docs`.

## AI planlayıcı necə işləyir

1. Tətbiq bütün söhbəti `POST /ai/chat`-ə göndərir (server stateless-dir), əvvəlki cavabdakı `slots`-u geri qaytarır.
2. Cavab: `reply`, `quickReplies` (chip-lər), `slotChips` (“2 people · 5 days · 1,500 AZN · Nature”), `missingSlots`, `readyToPlan`.
3. “Create my plan” → `action: "create_plan"`. Plan gün-gün, real `cityId`/`placeId`-lərlə gəlir; Stay/Food/Transport/Activities (+Flights) bölgüsü serverdə hesablanır; `relatedTours` real turlardır.
4. “Make it cheaper” / “Add one more day” → `plan.draft`-ı da göndərin. “Save plan” → `POST /ai/plans {draft, slots}`.

`ANTHROPIC_API_KEY` verilməyibsə, planlayıcı daxili qayda əsaslı mühərriklə işləyir (slot çıxarma + büdcəyə uyğun istiqamət seçimi) — inkişaf və testlər üçün açarsız da tam axın işləyir. Açar verildikdə Claude structured outputs ilə istifadə olunur, uğursuz olarsa avtomatik fallback.

Qonaq limiti (sənəddəki açıq sual): `AI_GUEST_DAILY_LIMIT` (default 10/gün/IP), istifadəçi üçün `AI_USER_DAILY_LIMIT`.

## iOS: `ios/RoamAPI` paketi

Xcode → File → Add Package Dependencies → Add Local… → `ios/RoamAPI`. iOS 17+, Swift 6.

```swift
import RoamAPI

let api = RoamClient(baseURL: URL(string: "http://localhost:3000/v1")!) // tokenlər Keychain-də

// Home
var filter = TourFilter()
filter.region = "africa"
let page = try await api.tours(filter)              // page.activeFilterCount → filter badge

// Login + favorite
_ = try await api.login(email: "yusif@example.com", password: "password123")
try await api.addFavorite(.tour, itemId: "pyramids-nile-cruise")

// AI
var messages = [ChatMessage(role: .user, content: "2 people, 5 days, around 1,500 AZN. Nature")]
let turn = try await api.chat(messages: messages)   // turn.quickReplies, turn.slotChips

// Xəta → sahə altında qırmızı mətn
do { _ = try await api.register(fullName: name, email: email, password: pw, acceptTerms: agreed) }
catch let e as RoamError { emailError = e.fieldErrors["email"] }
```

- `RoamError.loginRequired` → login pəncərəsini göstərin (qonaq rejimi).
- Access token bitməmiş avtomatik yenilənir; 401-də bir dəfə refresh + retry, paralel 401-lərdə tək refresh.
- Push: `api.registerPushToken(deviceToken, sandbox: true)`.
- Simulator-da `http://localhost` üçün Info.plist-də yalnız `NSAllowsLocalNetworking` istifadə edin; production HTTPS olmalıdır.
- Testlər (`swift test` və ya Xcode) real backend cavablarından götürülmüş fixture-larla model uyğunluğunu yoxlayır.

## Production üçün qeydlər

- `JWT_SECRET` (≥32 simvol) production-da məcburidir; olmasa server başlamır.
- Sign in with Apple/Google: `APPLE_AUDIENCES` (bundle ID) və `GOOGLE_CLIENT_IDS` (iOS client ID) doldurulmalıdır.
- E-poçt (şifrə bərpası, operator bildirişləri): `MAIL_WEBHOOK_URL` istənilən provayderə (Resend/SES/Postmark) kiçik relay; verilməyibsə log-a yazılır.
- Operatorlar sorğuları `GET /admin/requests`-dən, əlavə olaraq `OPERATOR_WEBHOOK_URL` (CRM/Slack) və `OPERATOR_EMAIL` vasitəsilə alır.
- App Store tələbi: hesab silmə `DELETE /me` ilə tətbiq daxilindən mümkündür.
- Seed-dəki qiymətlər demo üçün təxminidir; şəkillər boşdur (dizayndakı illustrasiyalar istifadə olunur) — admin API ilə real məlumat yüklənməlidir.
