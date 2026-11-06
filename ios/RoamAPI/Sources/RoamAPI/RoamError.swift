import Foundation

/// Error body returned by the backend:
/// `{ "statusCode": 400, "error": "ValidationError", "message": "...", "fields": { "email": "Enter a valid email address." } }`
public struct APIErrorBody: Decodable, Sendable, Hashable {
    public let statusCode: Int
    public let error: String?
    public let message: String
    /// Per-field messages — show them in red under the matching text field (PDF §3).
    public let fields: [String: String]?

    enum CodingKeys: String, CodingKey { case statusCode, error, message, fields }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        statusCode = try c.decode(Int.self, forKey: .statusCode)
        error = try c.decodeIfPresent(String.self, forKey: .error)
        // Nest's default errors may send `message` as an array.
        if let s = try? c.decode(String.self, forKey: .message) {
            message = s
        } else {
            message = (try? c.decode([String].self, forKey: .message).first) ?? "Something went wrong."
        }
        fields = try c.decodeIfPresent([String: String].self, forKey: .fields)
    }
}

public enum RoamError: Error, Sendable, LocalizedError {
    /// Guest tried a protected action (favorite, request, save plan) — present the login sheet.
    case loginRequired
    /// Refresh failed; tokens were cleared — send the user to Login.
    case sessionExpired
    case server(status: Int, body: APIErrorBody)
    case http(status: Int)
    case offline
    case timedOut
    case cancelled
    case transport(URLError)
    case decoding(String)
    case invalidResponse

    public var errorDescription: String? {
        switch self {
        case .loginRequired: "Log in to continue."
        case .sessionExpired: "Session expired. Please log in again."
        case let .server(_, body): body.message
        case let .http(status): "Server error (\(status))."
        case .offline: "You’re offline. Check your connection and try again."
        case .timedOut: "The request timed out. Please try again."
        case .cancelled: nil
        case .transport: "Network error. Please try again."
        case .decoding: "Unexpected response from the server."
        case .invalidResponse: "Unexpected response from the server."
        }
    }

    /// Field-level validation messages, if any.
    public var fieldErrors: [String: String] {
        if case let .server(_, body) = self { return body.fields ?? [:] }
        return [:]
    }

    /// Machine-readable error code from the backend, e.g. "AiGuestLimit", "InvalidCredentials".
    public var code: String? {
        if case let .server(_, body) = self { return body.error }
        return nil
    }

    static func from(_ error: URLError) -> RoamError {
        switch error.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed: .offline
        case .timedOut: .timedOut
        case .cancelled: .cancelled
        default: .transport(error)
        }
    }
}
