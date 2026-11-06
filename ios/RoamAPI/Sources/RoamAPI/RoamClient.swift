import Foundation
import os

/// Typed client for the Roam backend (`/v1`).
///
/// - Guests can browse the catalog and use the AI planner; protected calls throw `RoamError.loginRequired`
///   so the UI can show the login sheet (PDF §3, guest mode).
/// - Access tokens are refreshed automatically (proactively before expiry and once on a 401), single-flight.
/// - Prices come back in the user's Profile currency; guests can choose with `displayCurrency`.
public final class RoamClient: Sendable {
    public enum AuthMode: Sendable { case none, optional, required }

    public let baseURL: URL
    private let session: URLSession
    private let tokens: any TokenStorage
    private let refresher = RefreshCoordinator()
    private let currencyLock = OSAllocatedUnfairLock<Currency?>(initialState: nil)

    /// - Parameter baseURL: e.g. `https://api.roam.az/v1` (use `http://localhost:3000/v1` in the simulator during development).
    public init(baseURL: URL, tokens: any TokenStorage = KeychainTokenStore(), session: URLSession? = nil) {
        self.baseURL = baseURL
        self.tokens = tokens
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 30
            config.timeoutIntervalForResource = 90
            config.waitsForConnectivity = false
            config.requestCachePolicy = .useProtocolCachePolicy
            self.session = URLSession(configuration: config)
        }
    }

    /// Display currency for guests (signed-in users get their Profile currency unless this is set).
    public var displayCurrency: Currency? {
        get { currencyLock.withLock { $0 } }
        set { currencyLock.withLock { $0 = newValue } }
    }

    public func isLoggedIn() async -> Bool {
        (try? await tokens.load()) != nil
    }

    // MARK: - Core

    struct Empty: Decodable, Sendable {}

    static func makeDecoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let c = try decoder.singleValueContainer()
            let s = try c.decode(String.self)
            if let date = try? Date(s, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) { return date }
            if let date = try? Date(s, strategy: .iso8601) { return date }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Invalid date: \(s)")
        }
        return d
    }

    private func url(_ path: String, _ query: [URLQueryItem]) throws -> URL {
        var comps = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)
        var items = query
        if let currency = displayCurrency, !items.contains(where: { $0.name == "currency" }) {
            items.append(URLQueryItem(name: "currency", value: currency.rawValue))
        }
        if !items.isEmpty { comps?.queryItems = items }
        guard let url = comps?.url else { throw RoamError.invalidResponse }
        return url
    }

    func send<T: Decodable & Sendable>(
        _ method: String,
        _ path: String,
        query: [URLQueryItem] = [],
        body: (any Encodable & Sendable)? = nil,
        auth: AuthMode = .optional
    ) async throws -> T {
        var request = URLRequest(url: try url(path, query))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        var usedToken: AuthTokens?
        if auth != .none {
            // Optional auth degrades to guest if the session can't be restored; required auth surfaces the error.
            if auth == .required {
                usedToken = try await validTokens()
            } else {
                usedToken = try? await validTokens()
            }
            if auth == .required, usedToken == nil { throw RoamError.loginRequired }
            if let usedToken { request.setValue("Bearer \(usedToken.accessToken)", forHTTPHeaderField: "Authorization") }
        }

        let (data, http) = try await execute(request)
        if http.statusCode == 401, let used = usedToken {
            // One refresh + one retry, never a loop.
            let fresh = try await refresh(after: used)
            request.setValue("Bearer \(fresh.accessToken)", forHTTPHeaderField: "Authorization")
            let (retryData, retryHttp) = try await execute(request)
            return try decode(T.self, data: retryData, http: retryHttp)
        }
        return try decode(T.self, data: data, http: http)
    }

    private func execute(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw RoamError.invalidResponse }
            return (data, http)
        } catch let e as URLError {
            throw RoamError.from(e)
        } catch is CancellationError {
            throw RoamError.cancelled
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, data: Data, http: HTTPURLResponse) throws -> T {
        guard (200..<300).contains(http.statusCode) else {
            if let body = try? Self.makeDecoder().decode(APIErrorBody.self, from: data) {
                if http.statusCode == 401, body.error == "LoginRequired" { throw RoamError.loginRequired }
                throw RoamError.server(status: http.statusCode, body: body)
            }
            throw RoamError.http(status: http.statusCode)
        }
        if T.self == Empty.self || data.isEmpty, let empty = Empty() as? T { return empty }
        do {
            return try Self.makeDecoder().decode(T.self, from: data)
        } catch {
            throw RoamError.decoding(String(describing: error))
        }
    }

    // MARK: - Tokens

    private func validTokens() async throws -> AuthTokens? {
        guard let current = try await tokens.load() else { return nil }
        if current.accessTokenExpiresAt.timeIntervalSinceNow > 30 { return current }
        return try await refresh(after: current)
    }

    private func refresh(after used: AuthTokens) async throws -> AuthTokens {
        try await refresher.run { [tokens, self] in
            // Another caller may already have rotated the pair.
            if let latest = try await tokens.load(), latest.refreshToken != used.refreshToken { return latest }
            do {
                let res: AuthResponse = try await self.send("POST", "auth/refresh", body: ["refreshToken": used.refreshToken], auth: .none)
                let fresh = AuthTokens(res)
                try await tokens.save(fresh)
                return fresh
            } catch RoamError.server(status: 401, _) {
                try? await tokens.clear()
                throw RoamError.sessionExpired
            }
        }
    }

    @discardableResult
    private func storeSession(_ res: AuthResponse) async throws -> AuthResponse {
        try await tokens.save(AuthTokens(res))
        return res
    }
}

/// Ensures concurrent 401s trigger a single refresh request.
actor RefreshCoordinator {
    private var inFlight: Task<AuthTokens, Error>?

    func run(_ work: @escaping @Sendable () async throws -> AuthTokens) async throws -> AuthTokens {
        if let inFlight { return try await inFlight.value }
        let task = Task { try await work() }
        inFlight = task
        defer { inFlight = nil }
        return try await task.value
    }
}

// MARK: - Auth

public extension RoamClient {
    func register(fullName: String, email: String, password: String, acceptTerms: Bool) async throws -> AuthResponse {
        struct Body: Encodable, Sendable { let fullName, email, password: String; let acceptTerms: Bool }
        let res: AuthResponse = try await send("POST", "auth/register", body: Body(fullName: fullName, email: email, password: password, acceptTerms: acceptTerms), auth: .none)
        return try await storeSession(res)
    }

    func login(email: String, password: String) async throws -> AuthResponse {
        let res: AuthResponse = try await send("POST", "auth/login", body: ["email": email, "password": password], auth: .none)
        return try await storeSession(res)
    }

    /// `GIDGoogleUser.idToken.tokenString`
    func signInWithGoogle(idToken: String) async throws -> AuthResponse {
        let res: AuthResponse = try await send("POST", "auth/google", body: ["idToken": idToken], auth: .none)
        return try await storeSession(res)
    }

    /// From `ASAuthorizationAppleIDCredential`. Pass `fullName` on first sign-in (Apple only sends it once) and the raw nonce you hashed into the request.
    func signInWithApple(identityToken: Data, rawNonce: String?, fullName: PersonNameComponents?) async throws -> AuthResponse {
        struct Body: Encodable, Sendable { let identityToken: String; let nonce: String?; let fullName: String? }
        guard let token = String(data: identityToken, encoding: .utf8) else { throw RoamError.invalidResponse }
        let name = fullName.map { PersonNameComponentsFormatter().string(from: $0) }.flatMap { $0.isEmpty ? nil : $0 }
        let res: AuthResponse = try await send("POST", "auth/apple", body: Body(identityToken: token, nonce: rawNonce, fullName: name), auth: .none)
        return try await storeSession(res)
    }

    func forgotPassword(email: String) async throws {
        let _: Empty = try await send("POST", "auth/forgot-password", body: ["email": email], auth: .none)
    }

    func resetPassword(token: String, newPassword: String) async throws {
        let _: Empty = try await send("POST", "auth/reset-password", body: ["token": token, "newPassword": newPassword], auth: .none)
    }

    func logout() async {
        if let current = try? await tokens.load() {
            let _: Empty? = try? await send("POST", "auth/logout", body: ["refreshToken": current.refreshToken], auth: .none)
        }
        try? await tokens.clear()
    }
}

// MARK: - Catalog

public extension RoamClient {
    func regions() async throws -> [Ref] {
        try await send("GET", "regions", auth: .none)
    }

    func countries(regionId: String? = nil) async throws -> [CountryCard] {
        try await send("GET", "countries", query: regionId.map { [URLQueryItem(name: "regionId", value: $0)] } ?? [], auth: .none)
    }

    func country(_ id: String) async throws -> CountryDetail {
        try await send("GET", "countries/\(id)")
    }

    func city(_ id: String) async throws -> CityDetail {
        try await send("GET", "cities/\(id)")
    }

    func place(_ id: String) async throws -> Place {
        try await send("GET", "places/\(id)")
    }

    func tours(_ filter: TourFilter = TourFilter(), page: Int = 1, limit: Int = 20) async throws -> ToursPage {
        var q: [URLQueryItem] = [.init(name: "page", value: "\(page)"), .init(name: "limit", value: "\(limit)")]
        if let r = filter.region, r != "all" { q.append(.init(name: "region", value: r)) }
        if !filter.countries.isEmpty { q.append(.init(name: "country", value: filter.countries.joined(separator: ","))) }
        if let c = filter.city { q.append(.init(name: "city", value: c)) }
        if let v = filter.budgetMin { q.append(.init(name: "budgetMin", value: "\(v)")) }
        if let v = filter.budgetMax { q.append(.init(name: "budgetMax", value: "\(v)")) }
        if filter.duration != "any" { q.append(.init(name: "duration", value: filter.duration)) }
        if !filter.travelTypes.isEmpty { q.append(.init(name: "type", value: filter.travelTypes.joined(separator: ","))) }
        if filter.sort != "recommended" { q.append(.init(name: "sort", value: filter.sort)) }
        if let s = filter.query, !s.isEmpty { q.append(.init(name: "q", value: s)) }
        return try await send("GET", "tours", query: q)
    }

    func filterOptions(regionId: String? = nil) async throws -> FilterOptions {
        try await send("GET", "tours/filters", query: regionId.map { [URLQueryItem(name: "regionId", value: $0)] } ?? [])
    }

    func tour(_ id: String) async throws -> TourDetail {
        try await send("GET", "tours/\(id)")
    }
}

// MARK: - Favorites

public extension RoamClient {
    func favorites(type: FavoriteType? = nil, search: String? = nil, region: String? = nil, maxPrice: Int? = nil, category: String? = nil) async throws -> Favorites {
        var q: [URLQueryItem] = []
        if let type { q.append(.init(name: "type", value: type.rawValue)) }
        if let search, !search.isEmpty { q.append(.init(name: "q", value: search)) }
        if let region { q.append(.init(name: "region", value: region)) }
        if let maxPrice { q.append(.init(name: "maxPrice", value: "\(maxPrice)")) }
        if let category { q.append(.init(name: "category", value: category)) }
        return try await send("GET", "favorites", query: q, auth: .required)
    }

    /// Heart (also used for "Undo").
    @discardableResult
    func addFavorite(_ type: FavoriteType, itemId: String) async throws -> FavoriteState {
        struct Body: Encodable, Sendable { let type: FavoriteType; let itemId: String }
        return try await send("POST", "favorites", body: Body(type: type, itemId: itemId), auth: .required)
    }

    @discardableResult
    func removeFavorite(_ type: FavoriteType, itemId: String) async throws -> FavoriteState {
        try await send("DELETE", "favorites", query: [.init(name: "type", value: type.rawValue), .init(name: "itemId", value: itemId)], auth: .required)
    }
}

// MARK: - Profile

public extension RoamClient {
    func me() async throws -> Profile {
        try await send("GET", "me", auth: .required)
    }

    func updateProfile(_ update: ProfileUpdate) async throws -> Profile {
        try await send("PATCH", "me", body: update, auth: .required)
    }

    /// Call on "Show results" so the last-used filter becomes Travel preferences.
    func savePreferences(_ prefs: PreferencesUpdate) async throws -> Profile {
        try await send("PUT", "me/preferences", body: prefs, auth: .required)
    }

    func changePassword(current: String?, new: String) async throws {
        struct Body: Encodable, Sendable { let currentPassword: String?; let newPassword: String }
        let res: AuthResponse = try await send("POST", "me/password", body: Body(currentPassword: current, newPassword: new), auth: .required)
        try await storeSession(res)
    }

    /// From `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.
    func registerPushToken(_ deviceToken: Data, sandbox: Bool) async throws {
        struct Body: Encodable, Sendable { let token: String; let environment: String }
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        let _: Empty = try await send("POST", "me/devices", body: Body(token: hex, environment: sandbox ? "sandbox" : "production"), auth: .required)
    }

    func deleteAccount() async throws {
        let _: Empty = try await send("DELETE", "me", auth: .required)
        try? await tokens.clear()
    }
}

// MARK: - Tour requests

public extension RoamClient {
    func quote(tourId: String, adults: Int, children: Int) async throws -> RequestQuote {
        try await send("GET", "requests/quote", query: [.init(name: "tourId", value: tourId), .init(name: "adults", value: "\(adults)"), .init(name: "children", value: "\(children)")], auth: .required)
    }

    /// “Send request” → payload for the “Request sent” screen (code + next steps).
    func sendRequest(_ request: NewTourRequest) async throws -> TourRequest {
        try await send("POST", "requests", body: request, auth: .required)
    }

    func requests(_ tab: RequestsTab = .all) async throws -> RequestList {
        try await send("GET", "requests", query: [.init(name: "status", value: tab.rawValue)], auth: .required)
    }

    func request(_ id: String) async throws -> TourRequest {
        try await send("GET", "requests/\(id)", auth: .required)
    }

    func cancelRequest(_ id: String) async throws -> TourRequest {
        try await send("POST", "requests/\(id)/cancel", auth: .required)
    }
}

// MARK: - AI planner

public extension RoamClient {
    func discover() async throws -> DiscoverContent {
        try await send("GET", "ai/discover")
    }

    /// One planner turn. Echo `slots` (and `plan.draft` when refining) from the previous response.
    func chat(messages: [ChatMessage], slots: PlanSlots? = nil, draft: PlanDraft? = nil, createPlan: Bool = false) async throws -> ChatResponse {
        struct Body: Encodable, Sendable {
            let messages: [ChatMessage]
            let slots: PlanSlots?
            let draft: PlanDraft?
            let action: String
        }
        return try await send("POST", "ai/chat", body: Body(messages: messages, slots: slots, draft: draft, action: createPlan ? "create_plan" : "message"))
    }

    /// “Save plan” (login required).
    func savePlan(_ plan: Plan) async throws -> Plan {
        struct Body: Encodable, Sendable { let draft: PlanDraft; let slots: PlanSlots }
        return try await send("POST", "ai/plans", body: Body(draft: plan.draft, slots: plan.slots), auth: .required)
    }

    func plans() async throws -> [PlanSummary] {
        try await send("GET", "ai/plans", auth: .required)
    }

    func plan(_ id: String) async throws -> Plan {
        try await send("GET", "ai/plans/\(id)", auth: .required)
    }

    func deletePlan(_ id: String) async throws {
        let _: Empty = try await send("DELETE", "ai/plans/\(id)", auth: .required)
    }
}

// MARK: - Rates

public extension RoamClient {
    /// Fetch once a day and cache; keep using the last value offline (PDF §8).
    func rates() async throws -> ExchangeRates {
        try await send("GET", "rates", auth: .none)
    }
}
