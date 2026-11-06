import { parseCbarXml } from '../src/rates/rates.service';
import { bearer, createTestApp, registerUser, resetDatabase, TestCtx } from './helpers';

const futureDate = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);

describe('Roam API (e2e)', () => {
  let ctx: TestCtx;
  let user: { accessToken: string; refreshToken: string; user: { id: string } };
  let admin: { accessToken: string };

  beforeAll(async () => {
    await resetDatabase();
    ctx = await createTestApp();
    user = await registerUser(ctx, 'yusif@example.com');
    const a = await ctx.http().post('/v1/auth/login').send({ email: 'admin@roam.app', password: 'admin12345' }).expect(200);
    admin = a.body;
  });

  afterAll(async () => {
    await ctx?.app.close();
  });

  describe('health & rates', () => {
    it('GET /health', async () => {
      const res = await ctx.http().get('/health').expect(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /v1/rates returns AZN-based rates', async () => {
      const res = await ctx.http().get('/v1/rates').expect(200);
      expect(res.body.base).toBe('AZN');
      expect(res.body.rates.AZN).toBe(1);
      expect(res.body.aznPer.USD).toBeCloseTo(1.7);
    });

    it('parses CBAR XML', () => {
      const xml = `<ValCurs><ValType Type="Xarici valyutalar"><Valute Code="USD"><Nominal>1</Nominal><Name>1 ABŞ dolları</Name><Value>1.7000</Value></Valute><Valute Code="EUR"><Nominal>1</Nominal><Name>1 Avro</Name><Value>1.9843</Value></Valute></ValType></ValCurs>`;
      expect(parseCbarXml(xml)).toEqual({ usd: 1.7, eur: 1.9843 });
    });
  });

  describe('catalog (guest)', () => {
    it('lists region chips starting with All', async () => {
      const res = await ctx.http().get('/v1/regions').expect(200);
      expect(res.body.map((r: { name: string }) => r.name)).toEqual(['All', 'Europe', 'Asia', 'Middle East', 'Africa']);
    });

    it('lists countries by region with city counts', async () => {
      const res = await ctx.http().get('/v1/countries?regionId=africa').expect(200);
      const egypt = res.body.find((c: { id: string }) => c.id === 'egypt');
      expect(egypt).toMatchObject({ name: 'Egypt', cityCount: 3, subtitle: '3 cities' });
      expect(res.body.every((c: { region: { id: string } }) => c.region.id === 'africa')).toBe(true);
    });

    it('country detail has info cards and cities', async () => {
      const res = await ctx.http().get('/v1/countries/egypt').expect(200);
      expect(res.body.info.map((i: { title: string }) => i.title)).toEqual(['Currency', 'Language', 'Best season']);
      expect(res.body.cities.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['Cairo', 'Luxor', 'Hurghada']));
    });

    it('city detail has budget, transport and places with Free / +price labels', async () => {
      const res = await ctx.http().get('/v1/cities/cairo').expect(200);
      expect(res.body.dailyBudgetLabel).toBe('~85 AZN / person');
      expect(res.body.recommendedStayLabel).toBe('3 days');
      expect(res.body.transport).toEqual(['Metro', 'Ride-hailing', 'Taxi']);
      const giza = res.body.places.find((p: { id: string }) => p.id === 'giza');
      const khan = res.body.places.find((p: { id: string }) => p.id === 'khan-el-khalili');
      expect(giza.priceLabel).toBe('+25 AZN');
      expect(khan.priceLabel).toBe('Free');
      expect(res.body.stays.length).toBeGreaterThan(0);
    });

    it('home list filters by region', async () => {
      const res = await ctx.http().get('/v1/tours?region=africa').expect(200);
      expect(res.body.total).toBeGreaterThan(0);
      expect(res.body.items.every((t: { region: { id: string } }) => t.region.id === 'africa')).toBe(true);
      expect(res.body.activeFilterCount).toBe(1);
      const pyr = res.body.items.find((t: { id: string }) => t.id === 'pyramids-nile-cruise');
      expect(pyr).toMatchObject({ durationLabel: '5 days / 4 nights', priceLabel: 'From 980 AZN / person', locationLabel: 'Egypt · Cairo' });
    });

    it('applies country, budget (in display currency), duration, type and sort together', async () => {
      const res = await ctx.http().get('/v1/tours?region=africa&country=egypt,morocco&budgetMin=200&budgetMax=600&currency=EUR&duration=4-7&type=city_walks&sort=price_asc').expect(200);
      expect(res.body.activeFilterCount).toBe(5);
      expect(res.body.currency).toBe('EUR');
      for (const t of res.body.items) {
        expect(['egypt', 'morocco']).toContain(t.country.id);
        expect(t.days).toBeGreaterThanOrEqual(4);
        expect(t.days).toBeLessThanOrEqual(7);
        expect(t.price.currency).toBe('EUR');
        expect(t.price.amount).toBeLessThanOrEqual(600);
        expect(t.price.formatted.startsWith('€')).toBe(true);
      }
      const prices = res.body.items.map((t: { priceAZN: number }) => t.priceAZN);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    });

    it('returns an empty state when nothing matches', async () => {
      const res = await ctx.http().get('/v1/tours?budgetMax=10').expect(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.emptyState).toEqual({ title: 'No tours match your filters', action: 'Reset filters' });
    });

    it('rejects invalid filter values with field errors', async () => {
      const res = await ctx.http().get('/v1/tours?type=space').expect(400);
      expect(res.body.fields.type).toBeDefined();
    });

    it('filter sheet options follow the region', async () => {
      const res = await ctx.http().get('/v1/tours/filters?regionId=africa').expect(200);
      expect(res.body.countries.map((c: { id: string }) => c.id).sort()).toEqual(['egypt', 'kenya', 'morocco', 'tanzania']);
      expect(res.body.durations.map((d: { label: string }) => d.label)).toEqual(['Any', '1–3 days', '4–7 days', '8+ days']);
      expect(res.body.budget.max).toBeGreaterThan(res.body.budget.min);
    });

    it('tour detail has breadcrumb, itinerary, stays, budget and map', async () => {
      const res = await ctx.http().get('/v1/tours/pyramids-nile-cruise').expect(200);
      expect(res.body.breadcrumb.map((b: { name: string }) => b.name)).toEqual(['Africa', 'Egypt', 'Cairo']);
      expect(res.body.itinerary[0].title).toBe('Giza Pyramids & Sphinx');
      const camel = res.body.itinerary[0].items.find((i: { name: string }) => i.name === 'Camel ride');
      expect(camel).toMatchObject({ included: false, optional: true, priceLabel: '+35 AZN' });
      expect(res.body.stays[0].name).toBe('Nile View Hotel');
      expect(res.body.included).toContain('Train Cairo–Luxor');
      expect(res.body.budget.packagePrice.formatted).toBe('980 AZN');
      expect(res.body.map.points.length).toBeGreaterThan(3);
    });

    it('tours in Countries are the same objects as on Home', async () => {
      const home = await ctx.http().get('/v1/tours?city=cairo').expect(200);
      const detail = await ctx.http().get('/v1/cities/cairo').expect(200);
      expect(detail.body.tourCount).toBe(home.body.total);
    });

    it('404s for unknown items', async () => {
      await ctx.http().get('/v1/tours/nope').expect(404);
      await ctx.http().get('/v1/countries/nope').expect(404);
    });
  });

  describe('auth', () => {
    it('validates register fields individually', async () => {
      const res = await ctx.http().post('/v1/auth/register').send({ fullName: '', email: 'bad', password: 'short', acceptTerms: false }).expect(400);
      expect(res.body.error).toBe('ValidationError');
      expect(res.body.fields).toMatchObject({
        fullName: 'Enter your full name.',
        email: 'Enter a valid email address.',
        password: 'Password must be at least 8 characters.',
        acceptTerms: 'Please accept the Terms and Privacy Policy.',
      });
    });

    it('rejects duplicate email (case-insensitive)', async () => {
      const res = await ctx.http().post('/v1/auth/register').send({ fullName: 'X', email: 'YUSIF@example.com', password: 'password123', acceptTerms: true }).expect(409);
      expect(res.body.fields.email).toBeDefined();
    });

    it('logs in and rejects wrong password', async () => {
      await ctx.http().post('/v1/auth/login').send({ email: 'yusif@example.com', password: 'wrongpass' }).expect(401);
      const ok = await ctx.http().post('/v1/auth/login').send({ email: 'Yusif@Example.com', password: 'password123' }).expect(200);
      expect(ok.body.user.initials).toBe('YN');
    });

    it('rotates refresh tokens and detects reuse', async () => {
      const u = await registerUser(ctx, 'rotate@example.com');
      const r1 = await ctx.http().post('/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(200);
      // Reusing the old token revokes the whole family
      await ctx.http().post('/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
      await ctx.http().post('/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
    });

    it('logout revokes the refresh token', async () => {
      const u = await registerUser(ctx, 'logout@example.com');
      await ctx.http().post('/v1/auth/logout').send({ refreshToken: u.refreshToken }).expect(204);
      await ctx.http().post('/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
    });

    it('forgot → reset password flow', async () => {
      await registerUser(ctx, 'forgot@example.com');
      ctx.mail.send.mockClear();
      await ctx.http().post('/v1/auth/forgot-password').send({ email: 'forgot@example.com' }).expect(204);
      await ctx.http().post('/v1/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(204);
      expect(ctx.mail.send).toHaveBeenCalledTimes(1);
      const body = (ctx.mail.send.mock.calls[0] as unknown as [string, string, string])[2];
      const token = body.match(/token=([\w-]+)/)![1];
      await ctx.http().post('/v1/auth/reset-password').send({ token, newPassword: 'newpassword1' }).expect(204);
      await ctx.http().post('/v1/auth/reset-password').send({ token, newPassword: 'newpassword2' }).expect(400);
      await ctx.http().post('/v1/auth/login').send({ email: 'forgot@example.com', password: 'newpassword1' }).expect(200);
    });

    it('Google sign-in creates a user; Apple links by verified email', async () => {
      const g = await ctx
        .http()
        .post('/v1/auth/google')
        .send({ idToken: JSON.stringify({ sub: 'g-1', email: 'gina@example.com', emailVerified: true, name: 'Gina Aliyeva' }) })
        .expect(200);
      expect(g.body.isNewUser).toBe(true);
      expect(g.body.user.fullName).toBe('Gina Aliyeva');
      const a = await ctx
        .http()
        .post('/v1/auth/apple')
        .send({ identityToken: JSON.stringify({ sub: 'a-1', email: 'gina@example.com', emailVerified: true, name: null }) })
        .expect(200);
      expect(a.body.isNewUser).toBe(false);
      expect(a.body.user.id).toBe(g.body.user.id);
      const me = await ctx.http().get('/v1/me').set(bearer(a.body.accessToken)).expect(200);
      expect(me.body.authProviders).toEqual(['google', 'apple']);
    });

    it('rejects garbage bearer tokens with 401', async () => {
      await ctx.http().get('/v1/tours').set(bearer('garbage')).expect(401);
    });
  });

  describe('guest mode restrictions', () => {
    it('requires login to favorite, request or save a plan', async () => {
      const r1 = await ctx.http().post('/v1/favorites').send({ type: 'tour', itemId: 'pyramids-nile-cruise' }).expect(401);
      expect(r1.body.error).toBe('LoginRequired');
      await ctx.http().post('/v1/requests').send({}).expect(401);
      await ctx.http().post('/v1/ai/plans').send({}).expect(401);
    });
  });

  describe('favorites', () => {
    it('hearts tours and places; state is shared across screens', async () => {
      const h = bearer(user.accessToken);
      await ctx.http().post('/v1/favorites').set(h).send({ type: 'tour', itemId: 'pyramids-nile-cruise' }).expect(201);
      await ctx.http().post('/v1/favorites').set(h).send({ type: 'tour', itemId: 'pyramids-nile-cruise' }).expect(201); // idempotent
      await ctx.http().post('/v1/favorites').set(h).send({ type: 'tour', itemId: 'bali-island-hopping' }).expect(201);
      await ctx.http().post('/v1/favorites').set(h).send({ type: 'place', itemId: 'giza' }).expect(201);
      await ctx.http().post('/v1/favorites').set(h).send({ type: 'place', itemId: 'nope' }).expect(404);

      const home = await ctx.http().get('/v1/tours?region=africa').set(h).expect(200);
      expect(home.body.items.find((t: { id: string }) => t.id === 'pyramids-nile-cruise').isFavorite).toBe(true);
      const city = await ctx.http().get('/v1/cities/cairo').set(h).expect(200);
      expect(city.body.places.find((p: { id: string }) => p.id === 'giza').isFavorite).toBe(true);

      const list = await ctx.http().get('/v1/favorites').set(h).expect(200);
      expect(list.body.counts).toEqual({ tours: 2, places: 1 });
      expect(list.body.tours[0].tour.id).toBe('bali-island-hopping'); // recently added first
      expect(list.body.places[0].place).toMatchObject({ name: 'Giza Pyramids', city: { name: 'Cairo' }, country: { name: 'Egypt' } });

      const under = await ctx.http().get('/v1/favorites?type=tour&maxPrice=1000').set(h).expect(200);
      expect(under.body.tours.map((f: { tour: { id: string } }) => f.tour.id)).toEqual(['pyramids-nile-cruise']);
      const search = await ctx.http().get('/v1/favorites?type=tour&q=bali').set(h).expect(200);
      expect(search.body.tours).toHaveLength(1);

      await ctx.http().delete('/v1/favorites?type=tour&itemId=bali-island-hopping').set(h).expect(200);
      const after = await ctx.http().get('/v1/favorites').set(h).expect(200);
      expect(after.body.counts.tours).toBe(1);
    });

    it('shows an empty state for a new user', async () => {
      const u = await registerUser(ctx, 'empty@example.com');
      const res = await ctx.http().get('/v1/favorites').set(bearer(u.accessToken)).expect(200);
      expect(res.body.emptyState).toEqual({ title: 'No favorites yet', action: 'Explore tours' });
    });
  });

  describe('profile & currency', () => {
    it('updates phone, currency and travel preferences', async () => {
      const h = bearer(user.accessToken);
      const res = await ctx
        .http()
        .patch('/v1/me')
        .set(h)
        .send({ phone: '+994 50 123 45 67', currency: 'EUR' })
        .expect(200);
      expect(res.body).toMatchObject({ phone: '+994 50 123 45 67', currency: 'EUR', initials: 'YN', language: 'English' });

      const tours = await ctx.http().get('/v1/tours?region=africa').set(h).expect(200);
      expect(tours.body.currency).toBe('EUR');
      expect(tours.body.items[0].priceLabel).toMatch(/^From €/);

      const prefs = await ctx.http().put('/v1/me/preferences').set(h).send({ regions: ['africa'], budgetMin: 250, budgetMax: 1250, travelTypes: ['sea'] }).expect(200);
      expect(prefs.body.preferences.regions).toEqual([{ id: 'africa', name: 'Africa' }]);
      expect(prefs.body.preferences.budgetMax.currency).toBe('EUR');
      expect(prefs.body.preferences.budgetMaxAZN).toBeGreaterThan(1250); // stored in AZN

      await ctx.http().put('/v1/me/preferences').set(h).send({ budgetMin: 900, budgetMax: 100 }).expect(400);
      await ctx.http().patch('/v1/me').set(h).send({ currency: 'AZN' }).expect(200);
    });

    it('changes password and rejects a wrong current password', async () => {
      const u = await registerUser(ctx, 'pw@example.com');
      await ctx.http().post('/v1/me/password').set(bearer(u.accessToken)).send({ currentPassword: 'nope', newPassword: 'newpassword1' }).expect(400);
      const ok = await ctx.http().post('/v1/me/password').set(bearer(u.accessToken)).send({ currentPassword: 'password123', newPassword: 'newpassword1' }).expect(200);
      expect(ok.body.accessToken).toBeDefined();
      await ctx.http().post('/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
    });

    it('registers APNs device tokens', async () => {
      const token = 'a'.repeat(64);
      await ctx.http().post('/v1/me/devices').set(bearer(user.accessToken)).send({ token, environment: 'sandbox' }).expect(204);
      await ctx.http().post('/v1/me/devices').set(bearer(user.accessToken)).send({ token: 'xyz' }).expect(400);
    });
  });

  describe('tour requests', () => {
    let requestId: string;

    it('quotes 980 AZN × 2 adults = 1,960 AZN', async () => {
      const res = await ctx.http().get('/v1/requests/quote?tourId=pyramids-nile-cruise&adults=2&currency=AZN').set(bearer(user.accessToken)).expect(200);
      expect(res.body.total.formatted).toBe('1,960 AZN');
      expect(res.body.lines[0].label).toBe('980 AZN × 2 adults');
      expect(res.body.note).toBe('No payment in the app.');
    });

    it('validates dates and contact details', async () => {
      const h = bearer(user.accessToken);
      const r1 = await ctx.http().post('/v1/requests').set(h).send({ tourId: 'pyramids-nile-cruise', flexible: false, adults: 2, children: 0 }).expect(400);
      expect(r1.body.fields.startDate).toBeDefined();
      const r2 = await ctx.http().post('/v1/requests').set(h).send({ tourId: 'pyramids-nile-cruise', flexible: false, startDate: '2020-01-01', adults: 2, children: 0 }).expect(400);
      expect(r2.body.fields.startDate).toMatch(/future/);
      const r3 = await ctx.http().post('/v1/requests').set(h).send({ tourId: 'pyramids-nile-cruise', flexible: true, adults: 0, children: 0 }).expect(400);
      expect(r3.body.fields.adults).toBeDefined();
      const fresh = await registerUser(ctx, 'nophone@example.com');
      const r4 = await ctx.http().post('/v1/requests').set(bearer(fresh.accessToken)).send({ tourId: 'pyramids-nile-cruise', flexible: true, adults: 1, children: 0 }).expect(400);
      expect(r4.body.fields.phone).toBeDefined();
    });

    it('sends a request (#TR-xxxx), defaults contact from profile and computes end date', async () => {
      const start = futureDate(30);
      const res = await ctx
        .http()
        .post('/v1/requests')
        .set(bearer(user.accessToken))
        .send({ tourId: 'pyramids-nile-cruise', flexible: false, startDate: start, adults: 2, children: 1 })
        .expect(201);
      requestId = res.body.id;
      expect(res.body.code).toMatch(/^TR-\d{4,}$/);
      expect(res.body.status).toBe('pending');
      expect(res.body.statusLabel).toBe('Waiting for operator');
      expect(res.body.contactPhone).toBe('+994 50 123 45 67');
      expect(res.body.contactEmail).toBe('yusif@example.com');
      expect(res.body.totalAZN).toBe(980 * 2 + 690);
      expect(res.body.endDate).toBe(new Date(new Date(`${start}T00:00:00Z`).getTime() + 4 * 86400_000).toISOString().slice(0, 10));
      expect(res.body.nextSteps).toHaveLength(3);
      expect(res.body.disclaimer).toMatch(/Requests are not bookings/);
    });

    it('lists My requests with tabs and profile stats', async () => {
      const h = bearer(user.accessToken);
      await ctx.http().post('/v1/requests').set(h).send({ tourId: 'tbilisi-kazbegi', flexible: true, adults: 1, children: 0 }).expect(201);
      const all = await ctx.http().get('/v1/requests').set(h).expect(200);
      expect(all.body.counts).toMatchObject({ all: 2, pending: 2 });
      expect(all.body.items[1].datesLabel).toBeDefined();
      const me = await ctx.http().get('/v1/me').set(h).expect(200);
      expect(me.body.stats.requests.label).toBe('2 tour requests · 2 waiting for operator');
    });

    it('only admins/operators can change status; confirming notifies the traveler', async () => {
      await ctx.http().patch(`/v1/admin/requests/${requestId}`).set(bearer(user.accessToken)).send({ status: 'confirmed' }).expect(403);
      ctx.push.sendToUser.mockClear();
      await ctx.http().patch(`/v1/admin/requests/${requestId}`).set(bearer(admin.accessToken)).send({ status: 'confirmed', operatorNote: 'See you in Cairo' }).expect(200);
      expect(ctx.push.sendToUser).toHaveBeenCalledWith(user.user.id, expect.objectContaining({ title: expect.stringMatching(/Confirmed by operator/) }));
      const confirmed = await ctx.http().get('/v1/requests?status=confirmed').set(bearer(user.accessToken)).expect(200);
      expect(confirmed.body.items).toHaveLength(1);
      expect(confirmed.body.items[0].operatorNote).toBe('See you in Cairo');
      const inbox = await ctx.http().get('/v1/admin/requests?status=confirmed').set(bearer(admin.accessToken)).expect(200);
      expect(inbox.body[0].customerName).toBe('Yusif Nasibli');
    });

    it('cancelled requests move to Past', async () => {
      const h = bearer(user.accessToken);
      await ctx.http().post(`/v1/requests/${requestId}/cancel`).set(h).expect(200);
      const past = await ctx.http().get('/v1/requests?status=past').set(h).expect(200);
      expect(past.body.items.map((r: { id: string }) => r.id)).toContain(requestId);
      await ctx.http().post(`/v1/requests/${requestId}/cancel`).set(h).expect(400);
    });

    it('users cannot read other users’ requests', async () => {
      const other = await registerUser(ctx, 'other@example.com');
      await ctx.http().get(`/v1/requests/${requestId}`).set(bearer(other.accessToken)).expect(404);
    });
  });

  describe('AI trip planner (rule-based engine)', () => {
    type ChatRes = { reply: string; slots: Record<string, unknown>; slotChips: { label: string }[]; missingSlots: string[]; readyToPlan: boolean; quickReplies: string[]; plan: any };
    const chat = async (token: string | null, body: Record<string, unknown>) => {
      const req = ctx.http().post('/v1/ai/chat');
      if (token) req.set(bearer(token));
      return (await req.send(body).expect(200)).body as ChatRes;
    };

    it('turns free text into chips and asks for missing details', async () => {
      const r = await chat(user.accessToken, { messages: [{ role: 'user', content: '2 people, 5 days, around 1,500 AZN. Nature and city walks' }] });
      expect(r.slotChips.map((c) => c.label)).toEqual(expect.arrayContaining(['2 people', '5 days', '1,500 AZN', 'Nature', 'City walks']));
      expect(r.missingSlots).toEqual(['departureCity', 'flightsIncluded']);
      expect(r.quickReplies).toContain('Baku');
    });

    it('collects the remaining slots and builds a priced, catalog-based plan', async () => {
      const messages: { role: string; content: string }[] = [{ role: 'user', content: '2 people, 5 days, around 1,500 AZN. Nature and city walks' }];
      let r = await chat(user.accessToken, { messages });
      messages.push({ role: 'assistant', content: r.reply }, { role: 'user', content: 'From Baku, flexible dates' });
      r = await chat(user.accessToken, { messages, slots: r.slots });
      expect(r.slots).toMatchObject({ departureCity: 'Baku', dates: { flexible: true } });
      expect(r.quickReplies).toEqual(['Included', 'Not included']);
      messages.push({ role: 'assistant', content: r.reply }, { role: 'user', content: 'Not included' });
      r = await chat(user.accessToken, { messages, slots: r.slots });
      expect(r.readyToPlan).toBe(true);
      expect(r.plan).toBeNull();

      r = await chat(user.accessToken, { messages, slots: r.slots, action: 'create_plan' });
      const plan = r.plan;
      expect(plan.label).toBe('Estimate');
      expect(plan.subtitle).toBe('5 days · 2 people · flights not included');
      expect(plan.dayPlans).toHaveLength(5);
      expect(plan.breakdown.map((b: { label: string }) => b.label)).toEqual(['Stay', 'Food', 'Transport', 'Activities']);
      const sum = plan.breakdown.reduce((a: number, b: { amountAZN: number }) => a + b.amountAZN, 0);
      expect(sum).toBe(plan.estimatedTotalAZN);
      expect(plan.withinBudget).toBe(true);
      expect(plan.note).toBe('Prices are estimates and are not confirmed.');
      expect(plan.relatedTours.length).toBeGreaterThan(0);

      // Refine: "Make it cheaper"
      messages.push({ role: 'assistant', content: r.reply }, { role: 'user', content: 'Make it cheaper' });
      const cheaper = await chat(user.accessToken, { messages, slots: r.slots, draft: plan.draft });
      expect(cheaper.plan.estimatedTotalAZN).toBeLessThan(plan.estimatedTotalAZN);

      // Refine: "Add one more day"
      messages.push({ role: 'assistant', content: cheaper.reply }, { role: 'user', content: 'Add one more day' });
      const longer = await chat(user.accessToken, { messages, slots: cheaper.slots, draft: cheaper.plan.draft });
      expect(longer.plan.days).toBe(6);

      // Save → Your plans
      const saved = await ctx.http().post('/v1/ai/plans').set(bearer(user.accessToken)).send({ draft: plan.draft, slots: plan.slots }).expect(201);
      expect(saved.body.saved).toBe(true);
      expect(saved.body.estimatedTotalAZN).toBe(plan.estimatedTotalAZN);
      const list = await ctx.http().get('/v1/ai/plans').set(bearer(user.accessToken)).expect(200);
      expect(list.body[0].id).toBe(saved.body.id);
      const discover = await ctx.http().get('/v1/ai/discover').set(bearer(user.accessToken)).expect(200);
      expect(discover.body.plans).toHaveLength(1);
      expect(discover.body.examples).toContain('Weekend city break under 800 AZN');
      await ctx.http().get(`/v1/ai/plans/${saved.body.id}?currency=USD`).set(bearer(user.accessToken)).expect(200);
      await ctx.http().delete(`/v1/ai/plans/${saved.body.id}`).set(bearer(user.accessToken)).expect(204);
    });

    it('includes flights when they are part of the budget', async () => {
      const r = await chat(user.accessToken, {
        messages: [{ role: 'user', content: 'Beach week for 2 people in Egypt, 3,000 AZN, from Baku, flights included' }],
        action: 'create_plan',
      });
      expect(r.plan.flightsIncluded).toBe(true);
      expect(r.plan.breakdown.find((b: { key: string }) => b.key === 'flights').amountAZN).toBe(900 * 2);
      expect(r.plan.cities[0].id).toMatch(/cairo|luxor|hurghada/);
    });

    it('limits guests per day', async () => {
      const body = { messages: [{ role: 'user', content: 'hi' }] };
      for (let i = 0; i < 3; i++) await ctx.http().post('/v1/ai/chat').send(body).expect(200);
      const res = await ctx.http().post('/v1/ai/chat').send(body).expect(429);
      expect(res.body.error).toBe('AiGuestLimit');
    });
  });

  describe('admin catalog', () => {
    it('non-admins are forbidden', async () => {
      await ctx.http().put('/v1/admin/catalog/regions/oceania').set(bearer(user.accessToken)).send({ name: 'Oceania' }).expect(403);
    });

    it('admin upserts a tour and it appears on Home immediately', async () => {
      const h = bearer(admin.accessToken);
      await ctx
        .http()
        .put('/v1/admin/catalog/tours/cairo-weekend')
        .set(h)
        .send({ title: 'Cairo Weekend', cityIds: ['cairo'], days: 3, nights: 2, priceAZN: 450, travelTypes: ['city_walks'], tags: ['History'] })
        .expect(200);
      const res = await ctx.http().get('/v1/tours?duration=1-3&country=egypt').expect(200);
      expect(res.body.items.map((t: { id: string }) => t.id)).toContain('cairo-weekend');
      await ctx.http().put('/v1/admin/catalog/tours/bad-tour').set(h).send({ title: 'X', cityIds: ['atlantis'], days: 1, nights: 0, priceAZN: 1 }).expect(400);
      await ctx.http().put('/v1/admin/catalog/tours/Bad_Slug').set(h).send({ title: 'X', cityIds: ['cairo'], days: 1, nights: 0, priceAZN: 1 }).expect(400);
      await ctx.http().delete('/v1/admin/catalog/tours/cairo-weekend').set(h).expect(200);
      await ctx.http().get('/v1/tours/cairo-weekend').expect(404);
      await ctx.http().delete('/v1/admin/catalog/cities/cairo').set(h).expect(400); // still referenced
    });

    it('admin can set exchange rates manually', async () => {
      const res = await ctx.http().put('/v1/admin/rates').set(bearer(admin.accessToken)).send({ aznPerUsd: 1.7, aznPerEur: 1.9 }).expect(200);
      expect(res.body.aznPer.EUR).toBe(1.9);
      expect(res.body.source).toBe('manual');
    });
  });

  describe('account deletion', () => {
    it('deletes the account and its data', async () => {
      const u = await registerUser(ctx, 'bye@example.com');
      await ctx.http().post('/v1/favorites').set(bearer(u.accessToken)).send({ type: 'place', itemId: 'giza' }).expect(201);
      await ctx.http().delete('/v1/me').set(bearer(u.accessToken)).expect(204);
      await ctx.http().get('/v1/me').set(bearer(u.accessToken)).expect(401);
      await ctx.http().post('/v1/auth/login').send({ email: 'bye@example.com', password: 'password123' }).expect(401);
    });
  });
});
