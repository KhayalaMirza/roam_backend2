# Roam API — Postman ilə işləmək

> **Əvvəlcə bunu bilin:** GitHub yalnız kodu saxlayır, serveri işə salmır.
> Postman-da `connect ECONNREFUSED 127.0.0.1:3000` xətası o deməkdir ki, kompüterinizdə **3000 portunda server işləmir**.
> Aşağıdakı 3 yoldan birini seçib serveri işə salın, sonra Postman dərhal işləyəcək.

| Yol | Nə lazımdır | Data | Nə vaxt seçməli |
|---|---|---|---|
| **A. Mock server** | Yalnız Node.js | Hazır nümunə data (dəyişmir) | Ən tez — 1 dəqiqə |
| **B. Real backend (Docker)** | Docker Desktop | Real PostgreSQL, hər şey yazılır | Tam yoxlama |
| **C. Postman Cloud Mock** | Yalnız Postman hesabı | Hazır nümunə data | Heç nə quraşdırmaq istəmirsinizsə |

---

## A. Mock server (heç nə quraşdırmadan, yalnız Node.js)

1. Node.js quraşdırın (18 və ya daha yeni): https://nodejs.org → **LTS**.
2. Terminalda layihənin `roam` qovluğuna keçin və işə salın:

   ```bash
   cd roam
   node mock/server.js
   ```

3. Terminalda bu yazı görünməlidir: `Roam MOCK API on http://localhost:3000`
4. Brauzerdə yoxlayın: http://localhost:3000/v1/tours → turların JSON-u görünməlidir.
5. Terminalı **bağlamayın** — server açıq qaldıqca işləyir. Dayandırmaq: `Ctrl + C`.

Mock rejimdə: bütün GET endpoint-ləri (16 tur, 12 ölkə, 28 şəhər, 78 məkan) işləyir; login/register, favorites, requests və AI söhbəti nümunə cavab qaytarır. Favorites/requests üçün `Authorization: Bearer <istənilən mətn>` kifayətdir.

## B. Real backend (Docker)

1. **Docker Desktop** quraşdırın və açın: https://www.docker.com/products/docker-desktop
2. Terminalda:

   ```bash
   cd roam/backend
   docker compose up --build
   ```

3. İlk dəfə 2–4 dəqiqə çəkir. `API on http://localhost:3000/v1` yazısını gözləyin.
   - Baza, cədvəllər, turlar/ölkələr/şəhərlər və admin hesabı **avtomatik** yaradılır.
   - Admin: `admin@roam.app` / `admin12345`
4. Yoxlayın: http://localhost:3000/health → `{"status":"ok"}` · Bütün endpoint-lər: http://localhost:3000/docs
5. Dayandırmaq: `Ctrl + C` və ya `docker compose down`.

`.env` faylı məcburi deyil. Öz ayarlarınızı vermək istəsəniz `backend/env.example.txt`-i `backend/.env` adı ilə köçürüb redaktə edin.

Problemlər:
- **`port is already allocated` (5432 və ya 3000)** — kompüterdə başqa PostgreSQL və ya proqram həmin portu tutur. Onu dayandırın və ya `docker-compose.yml`-da `"5433:5432"` / `"3001:3000"` edin (onda Postman-da `baseUrl` = `http://localhost:3001`).
- **`Cannot connect to the Docker daemon`** — Docker Desktop açıq deyil.
- Başqa xəta → `docker compose logs api` çıxışını göndərin.

## C. Postman Cloud Mock (heç nə quraşdırmadan)

1. Postman → **Import** → `postman/Roam-Mock.postman_collection.json`
2. Kolleksiyanın yanında **⋯ → Mock collection → Create Mock Server**
3. Verilən URL-i (`https://xxxx.mock.pstmn.io`) kopyalayın → kolleksiya **Variables** → `baseUrl` → yapışdırın → **Save**
4. İstənilən sorğunu göndərin.

---

## Postman-da işləmək (A və B üçün)

1. Postman → **Import** → `postman/Roam.postman_collection.json`
2. Kolleksiya → **Variables**: `baseUrl` = `http://localhost:3000` (dəyişməyə ehtiyac yoxdur).
3. Qovluqları yuxarıdan aşağı göndərin, və ya kolleksiyada **Run** → hamısı birdən (44 sorğu).
   - **Register** tokeni avtomatik saxlayır — sonrakı sorğular onu özü istifadə edir.
4. Cavabı **Visualize** tabında açın — turlar, şəhərlər, AI planı kart və cədvəl kimi görünür.

### Əsas endpoint-lər

Base URL: `http://localhost:3000/v1`

| Ekran | Metod və URL |
|---|---|
| Region chip-ləri | `GET /regions` |
| Bütün turlar (Home) | `GET /tours` |
| Region üzrə turlar | `GET /tours?region=africa` |
| Filtr | `GET /tours?region=africa&budgetMax=1500&duration=4-7&type=nature&sort=price_asc` |
| Filtr ekranının seçimləri | `GET /tours/filters?regionId=africa` |
| Tur detalı | `GET /tours/{tourId}` — məs. `/tours/pyramids-nile-cruise` |
| Ölkələr | `GET /countries` · `GET /countries?regionId=asia` |
| Ölkə detalı + şəhərlər | `GET /countries/{countryId}` — məs. `/countries/egypt` |
| Şəhər detalı + məkanlar + otellər | `GET /cities/{cityId}` — məs. `/cities/cairo` |
| Məkan | `GET /places/{placeId}` — məs. `/places/giza` |
| Şəhərin turları | `GET /tours?city=cairo` |
| Valyuta | `GET /tours?currency=EUR` · `GET /rates` |
| Qeydiyyat / Login | `POST /auth/register` · `POST /auth/login` |
| Profil | `GET /me` · `PATCH /me` *(token)* |
| Favorites | `GET /favorites` · `POST /favorites` · `DELETE /favorites?type=tour&itemId=...` *(token)* |
| Tur sorğusu | `GET /requests/quote?tourId=...&adults=2` · `POST /requests` · `GET /requests` *(token)* |
| AI planlayıcı | `GET /ai/discover` · `POST /ai/chat` · `POST /ai/plans` |

### ID-lər

- **Regionlar:** `europe`, `asia`, `middle-east`, `africa`
- **Ölkə → şəhərlər:**
  `georgia` → `tbilisi`, `kazbegi`, `batumi` · `turkey` → `istanbul`, `cappadocia`, `antalya` · `italy` → `rome`, `florence` · `japan` → `tokyo`, `kyoto`, `osaka` · `indonesia` → `bali`, `nusa-penida` · `thailand` → `bangkok`, `phuket` · `uae` → `dubai`, `abu-dhabi` · `jordan` → `amman`, `petra` · `egypt` → `cairo`, `luxor`, `hurghada` · `morocco` → `marrakech`, `chefchaouen` · `kenya` → `nairobi`, `maasai-mara` · `tanzania` → `zanzibar`, `arusha`
- **Turlar:** `pyramids-nile-cruise`, `red-sea-escape`, `marrakech-sahara`, `blue-city-hikes`, `kenya-big-five`, `zanzibar-serengeti`, `tbilisi-kazbegi`, `batumi-weekend`, `istanbul-cappadocia`, `antalya-coast`, `roman-holiday`, `japan-golden-route`, `bali-island-hopping`, `thailand-temples-beaches`, `dubai-desert`, `petra-wadi-rum`
- **Məkan ID-ləri:** `GET /cities/{id}` cavabındakı `places[].id`

### Token tələb edən sorğular

Postman kolleksiyasında token avtomatik qoyulur. Əl ilə sorğu yazırsınızsa:
**Authorization** tab → **Bearer Token** → `POST /auth/login` cavabındakı `accessToken`.

### AI söhbəti nümunəsi

```http
POST /v1/ai/chat
Content-Type: application/json

{ "messages": [ { "role": "user", "content": "2 people, 5 days, around 1,500 AZN. Nature and city walks" } ] }
```
Cavabdakı `slots`-u növbəti sorğuda geri göndərin; plan üçün `"action": "create_plan"` əlavə edin.

---

## GitHub-a yükləyəndə

Gizli fayllar (`.gitignore`, `.github/`, `backend/.env.example`) brauzerdən yükləmədə bəzən düşmür — **terminaldan** yükləyin:

```bash
cd roam
git init && git add -A && git commit -m "Roam backend"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main --force
```
