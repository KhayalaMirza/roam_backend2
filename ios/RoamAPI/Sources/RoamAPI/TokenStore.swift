import Foundation
import Security

public struct AuthTokens: Codable, Sendable, Equatable {
    public let accessToken: String
    public let refreshToken: String
    public let accessTokenExpiresAt: Date

    public init(accessToken: String, refreshToken: String, accessTokenExpiresAt: Date) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.accessTokenExpiresAt = accessTokenExpiresAt
    }

    init(_ r: AuthResponse, now: Date = .now) {
        self.init(accessToken: r.accessToken, refreshToken: r.refreshToken, accessTokenExpiresAt: now.addingTimeInterval(TimeInterval(r.expiresIn)))
    }
}

public protocol TokenStorage: Sendable {
    func load() async throws -> AuthTokens?
    func save(_ tokens: AuthTokens) async throws
    func clear() async throws
}

public struct KeychainError: Error, Sendable, Equatable {
    public let status: OSStatus
}

/// Stores the token pair in the Keychain (never UserDefaults). Off the main actor by construction.
public actor KeychainTokenStore: TokenStorage {
    private let service: String
    private let account: String
    private var cache: AuthTokens??

    public init(service: String = "az.roam.app.auth", account: String = "session") {
        self.service = service
        self.account = account
    }

    private var identity: [CFString: Any] {
        [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account]
    }

    public func load() throws -> AuthTokens? {
        if let cache { return cache }
        var query = identity
        query[kSecReturnData] = true
        query[kSecMatchLimit] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        switch status {
        case errSecSuccess:
            guard let data = out as? Data else { throw KeychainError(status: errSecDecode) }
            let tokens = try JSONDecoder().decode(AuthTokens.self, from: data)
            cache = .some(tokens)
            return tokens
        case errSecItemNotFound:
            cache = .some(nil)
            return nil
        default:
            // e.g. errSecInteractionNotAllowed before first unlock — don't cache, try again later.
            throw KeychainError(status: status)
        }
    }

    public func save(_ tokens: AuthTokens) throws {
        let data = try JSONEncoder().encode(tokens)
        var add = identity
        add[kSecValueData] = data
        add[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        switch SecItemAdd(add as CFDictionary, nil) {
        case errSecSuccess:
            break
        case errSecDuplicateItem:
            let status = SecItemUpdate(identity as CFDictionary, [kSecValueData: data] as CFDictionary)
            guard status == errSecSuccess else { throw KeychainError(status: status) }
        case let status:
            throw KeychainError(status: status)
        }
        cache = .some(tokens)
    }

    public func clear() throws {
        let status = SecItemDelete(identity as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
        cache = .some(nil)
    }
}

/// In-memory storage for previews and tests.
public actor InMemoryTokenStore: TokenStorage {
    private var tokens: AuthTokens?
    public init(_ tokens: AuthTokens? = nil) { self.tokens = tokens }
    public func load() -> AuthTokens? { tokens }
    public func save(_ tokens: AuthTokens) { self.tokens = tokens }
    public func clear() { tokens = nil }
}
