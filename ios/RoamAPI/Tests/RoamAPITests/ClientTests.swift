import Foundation
import Testing
@testable import RoamAPI

/// URLProtocol stub: routes by path, records requests.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) -> (Int, Data))?
    nonisolated(unsafe) static var seen: [URLRequest] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.seen.append(request)
        let (status, data) = Self.handler?(request) ?? (500, Data())
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private func makeClient(tokens: AuthTokens?) -> (RoamClient, InMemoryTokenStore) {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubProtocol.self]
    let store = InMemoryTokenStore(tokens)
    return (RoamClient(baseURL: URL(string: "https://api.test/v1")!, tokens: store, session: URLSession(configuration: config)), store)
}

private let authJSON = #"{"accessToken":"new-access","refreshToken":"new-refresh","expiresIn":900,"isNewUser":false,"user":{"id":"u1","fullName":"Yusif Nasibli","email":"y@example.com","initials":"YN"}}"#

@Suite("RoamClient", .serialized)
struct ClientTests {
    @Test func guestProtectedCallThrowsLoginRequired() async throws {
        let (client, _) = makeClient(tokens: nil)
        StubProtocol.handler = { _ in (200, Data("{}".utf8)) }
        await #expect(throws: RoamError.self) { try await client.favorites() }
    }

    @Test func refreshesOnceOn401AndRetries() async throws {
        let old = AuthTokens(accessToken: "old-access", refreshToken: "old-refresh", accessTokenExpiresAt: .now.addingTimeInterval(600))
        let (client, store) = makeClient(tokens: old)
        StubProtocol.seen = []
        StubProtocol.handler = { req in
            if req.url!.path.hasSuffix("/auth/refresh") { return (200, Data(authJSON.utf8)) }
            if req.value(forHTTPHeaderField: "Authorization") == "Bearer old-access" {
                return (401, Data(#"{"statusCode":401,"error":"TokenInvalid","message":"Session expired."}"#.utf8))
            }
            return (200, Data(#"[{"id":"all","name":"All"}]"#.utf8))
        }
        let regions: [Ref] = try await client.send("GET", "regions", auth: .required)
        #expect(regions.first?.name == "All")
        #expect(await store.load()?.accessToken == "new-access")
        #expect(StubProtocol.seen.filter { $0.url!.path.hasSuffix("/auth/refresh") }.count == 1)
    }

    @Test func failedRefreshClearsSession() async throws {
        let old = AuthTokens(accessToken: "a", refreshToken: "r", accessTokenExpiresAt: .now.addingTimeInterval(-10))
        let (client, store) = makeClient(tokens: old)
        StubProtocol.handler = { _ in (401, Data(#"{"statusCode":401,"error":"RefreshInvalid","message":"Session expired."}"#.utf8)) }
        await #expect(throws: RoamError.self) { try await client.me() }
        #expect(await store.load() == nil)
    }

    @Test func surfacesFieldErrors() async throws {
        let (client, _) = makeClient(tokens: nil)
        StubProtocol.handler = { _ in
            (400, Data(#"{"statusCode":400,"error":"ValidationError","message":"Enter a valid email address.","fields":{"email":"Enter a valid email address."}}"#.utf8))
        }
        do {
            _ = try await client.login(email: "bad", password: "x")
            Issue.record("expected an error")
        } catch let error as RoamError {
            #expect(error.fieldErrors["email"] == "Enter a valid email address.")
        }
    }
}
