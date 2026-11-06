import Foundation

// MARK: - Shared

public enum Currency: String, Codable, Sendable, CaseIterable {
    case AZN, EUR, USD
}

/// Every price comes with a ready-to-show string ("980 AZN", "€520", "$576").
public struct Money: Codable, Sendable, Hashable {
    public let amount: Double
    public let currency: Currency
    public let formatted: String
}

public struct Ref: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
}

public struct Option: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let label: String
}

public struct Coordinate: Codable, Sendable, Hashable {
    public let lat: Double
    public let lng: Double
}

public struct EmptyState: Codable, Sendable, Hashable {
    public let title: String
    public let action: String
}

// MARK: - Catalog

public struct TourCard: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
    public let summary: String
    public let region: Ref
    public let country: Ref
    public let city: Ref
    /// "Egypt · Cairo"
    public let locationLabel: String
    public let days: Int
    public let nights: Int
    /// "5 days / 4 nights"
    public let durationLabel: String
    public let priceAZN: Int
    public let price: Money
    /// "From 980 AZN / person"
    public let priceLabel: String
    public let travelTypes: [Option]
    public let tags: [String]
    public let coverImageUrl: URL?
    public var isFavorite: Bool
}

public struct ToursPage: Codable, Sendable {
    public let items: [TourCard]
    public let page: Int
    public let limit: Int
    public let total: Int
    public let hasMore: Bool
    public let currency: Currency
    /// Badge on the Home filter button.
    public let activeFilterCount: Int
    public let emptyState: EmptyState?
}

public struct Place: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let category: String
    public let description: String
    public let durationHours: Double
    public let priceAZN: Int
    public let price: Money?
    /// "+25 AZN" or "Free"
    public let priceLabel: String
    public let city: Ref?
    public let country: Ref?
    public let imageUrl: URL?
    public let coordinate: Coordinate?
    public var isFavorite: Bool
}

public struct Stay: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let kind: String
    public let stars: Int?
    public let description: String
    public let pricePerNight: Money?
    public let pricePerNightAZN: Int?
    public let websiteUrl: URL?
    public let imageUrl: URL?
    public let coordinate: Coordinate?
    /// Present on tour stays only.
    public let nights: Int?
    public let city: Ref?
}

public struct ItineraryItem: Codable, Sendable, Hashable {
    public let placeId: String?
    public let name: String
    public let category: String?
    public let durationHours: Double?
    public let included: Bool
    public let optional: Bool
    public let extraPriceAZN: Int?
    /// "Included" | "+35 AZN" | "Free"
    public let priceLabel: String
    public let coordinate: Coordinate?
}

public struct ItineraryDay: Codable, Sendable, Hashable, Identifiable {
    public var id: Int { day }
    public let day: Int
    public let title: String
    public let description: String
    public let city: Ref?
    public let items: [ItineraryItem]
}

public struct TourBudget: Codable, Sendable, Hashable {
    public struct Extra: Codable, Sendable, Hashable {
        public let name: String
        public let day: Int
        public let price: Money
        public let priceAZN: Int
    }
    public let packagePrice: Money
    public let packagePriceAZN: Int
    public let childPrice: Money
    public let childPriceAZN: Int
    public let perLabel: String
    public let optionalExtras: [Extra]
}

public struct MapPoint: Codable, Sendable, Hashable {
    public let kind: String // "place" | "stay"
    public let id: String?
    public let name: String
    public let day: Int?
    public let lat: Double
    public let lng: Double
}

/// Tour detail + Full plan. Card fields are decoded from the same JSON object.
public struct TourDetail: Decodable, Sendable, Identifiable {
    public var id: String { card.id }
    public let card: TourCard
    public let description: String
    /// Africa · Egypt · Cairo
    public let breadcrumb: [Ref]
    public let cities: [Ref]
    public let images: [URL]
    public let operatorName: String?
    public let itinerary: [ItineraryDay]
    public let stays: [Stay]
    public let budget: TourBudget
    /// "What the price covers"
    public let included: [String]
    /// "Not included"
    public let excluded: [String]
    public let map: Map

    public struct Map: Codable, Sendable, Hashable { public let points: [MapPoint] }

    enum CodingKeys: String, CodingKey { case description, breadcrumb, cities, images, operatorName, itinerary, stays, budget, included, excluded, map }

    public init(from decoder: Decoder) throws {
        card = try TourCard(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        description = try c.decode(String.self, forKey: .description)
        breadcrumb = try c.decode([Ref].self, forKey: .breadcrumb)
        cities = try c.decode([Ref].self, forKey: .cities)
        images = try c.decode([URL].self, forKey: .images)
        operatorName = try c.decodeIfPresent(String.self, forKey: .operatorName)
        itinerary = try c.decode([ItineraryDay].self, forKey: .itinerary)
        stays = try c.decode([Stay].self, forKey: .stays)
        budget = try c.decode(TourBudget.self, forKey: .budget)
        included = try c.decode([String].self, forKey: .included)
        excluded = try c.decode([String].self, forKey: .excluded)
        map = try c.decode(Map.self, forKey: .map)
    }
}

public struct CountryCard: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let region: Ref?
    public let imageUrl: URL?
    public let cityCount: Int
    /// "6 cities"
    public let subtitle: String
    public let tourCount: Int
}

public struct InfoItem: Codable, Sendable, Hashable {
    public let title: String
    public let value: String
}

public struct CityCard: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let name: String
    public let shortDescription: String
    public let imageUrl: URL?
    public let recommendedDays: Int
    public let dailyBudget: Money
    public let dailyBudgetAZN: Int
    public let tourCount: Int
}

public struct CountryDetail: Decodable, Sendable, Identifiable {
    public var id: String { card.id }
    public let card: CountryCard
    public let description: String
    /// Currency · Language · Best season cards
    public let info: [InfoItem]
    public let cities: [CityCard]

    enum CodingKeys: String, CodingKey { case description, info, cities }

    public init(from decoder: Decoder) throws {
        card = try CountryCard(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        description = try c.decode(String.self, forKey: .description)
        info = try c.decode([InfoItem].self, forKey: .info)
        cities = try c.decode([CityCard].self, forKey: .cities)
    }
}

public struct CityDetail: Decodable, Sendable, Identifiable {
    public struct Breakdown: Codable, Sendable, Hashable {
        public let stay: Money
        public let food: Money
        public let transport: Money
        public let activities: Money
    }
    public var id: String { card.id }
    public let card: CityCard
    public let description: String
    public let country: Ref?
    public let region: Ref?
    /// "3 days"
    public let recommendedStayLabel: String
    /// "~85 AZN / person"
    public let dailyBudgetLabel: String
    public let dailyBudgetNote: String
    public let dailyBudgetBreakdown: Breakdown
    public let transport: [String]
    public let coordinate: Coordinate?
    public let places: [Place]
    public let stays: [Stay]

    enum CodingKeys: String, CodingKey {
        case description, country, region, recommendedStayLabel, dailyBudgetLabel, dailyBudgetNote, dailyBudgetBreakdown, transport, coordinate, places, stays
    }

    public init(from decoder: Decoder) throws {
        card = try CityCard(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        description = try c.decode(String.self, forKey: .description)
        country = try c.decodeIfPresent(Ref.self, forKey: .country)
        region = try c.decodeIfPresent(Ref.self, forKey: .region)
        recommendedStayLabel = try c.decode(String.self, forKey: .recommendedStayLabel)
        dailyBudgetLabel = try c.decode(String.self, forKey: .dailyBudgetLabel)
        dailyBudgetNote = try c.decode(String.self, forKey: .dailyBudgetNote)
        dailyBudgetBreakdown = try c.decode(Breakdown.self, forKey: .dailyBudgetBreakdown)
        transport = try c.decode([String].self, forKey: .transport)
        coordinate = try c.decodeIfPresent(Coordinate.self, forKey: .coordinate)
        places = try c.decode([Place].self, forKey: .places)
        stays = try c.decode([Stay].self, forKey: .stays)
    }
}

public struct FilterOptions: Codable, Sendable {
    public struct CountryOption: Codable, Sendable, Hashable, Identifiable {
        public let id: String
        public let name: String
        public let regionId: String
    }
    public struct Budget: Codable, Sendable, Hashable {
        public let currency: Currency
        public let min: Int
        public let max: Int
        public let step: Int
        public let minAZN: Int
        public let maxAZN: Int
    }
    public let regions: [Ref]
    public let countries: [CountryOption]
    public let budget: Budget
    public let durations: [Option]
    public let travelTypes: [Option]
    public let sortOptions: [Option]
}

/// Home + Filter sheet state. Region chips on Home and the Filter sheet share this value (PDF §4.3).
public struct TourFilter: Sendable, Hashable {
    public var region: String? = nil // nil / "all" = All
    public var countries: [String] = []
    public var city: String? = nil
    /// Per person, in `currency`.
    public var budgetMin: Int? = nil
    public var budgetMax: Int? = nil
    public var duration: String = "any" // any | 1-3 | 4-7 | 8+
    public var travelTypes: [String] = [] // sea | nature | city_walks | adventure
    public var sort: String = "recommended" // recommended | price_asc | duration
    public var query: String? = nil
    public init() {}
}

// MARK: - Auth & profile

public struct AuthUser: Codable, Sendable, Hashable {
    public let id: String
    public let fullName: String
    public let email: String
    public let initials: String
}

public struct AuthResponse: Codable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let expiresIn: Int
    public let isNewUser: Bool
    public let user: AuthUser
}

public struct TravelPreferences: Codable, Sendable, Hashable {
    public let regions: [Ref]
    public let budgetMinAZN: Int?
    public let budgetMaxAZN: Int?
    public let budgetMin: Money?
    public let budgetMax: Money?
    public let travelTypes: [Option]
}

public struct Profile: Codable, Sendable {
    public struct Stats: Codable, Sendable {
        public struct Requests: Codable, Sendable { public let total: Int; public let pending: Int; public let label: String }
        public struct Favorites: Codable, Sendable { public let tours: Int; public let places: Int }
        public let requests: Requests
        public let favorites: Favorites
    }
    public let id: String
    public let fullName: String
    public let email: String
    /// "YN"
    public let initials: String
    public let phone: String?
    public let currency: Currency
    public let notificationsEnabled: Bool
    public let language: String
    public let role: String
    public let authProviders: [String]
    public let hasPassword: Bool
    public let preferences: TravelPreferences
    public let stats: Stats
    public let createdAt: Date
}

public struct ProfileUpdate: Encodable, Sendable {
    public var fullName: String?
    public var phone: String?
    public var currency: Currency?
    public var notificationsEnabled: Bool?
    public var preferences: PreferencesUpdate?
    public init(fullName: String? = nil, phone: String? = nil, currency: Currency? = nil, notificationsEnabled: Bool? = nil, preferences: PreferencesUpdate? = nil) {
        self.fullName = fullName
        self.phone = phone
        self.currency = currency
        self.notificationsEnabled = notificationsEnabled
        self.preferences = preferences
    }
}

public struct PreferencesUpdate: Encodable, Sendable {
    public var regions: [String]?
    public var budgetMin: Int?
    public var budgetMax: Int?
    public var travelTypes: [String]?
    /// Currency of budgetMin/budgetMax.
    public var currency: Currency?
    public init(regions: [String]? = nil, budgetMin: Int? = nil, budgetMax: Int? = nil, travelTypes: [String]? = nil, currency: Currency? = nil) {
        self.regions = regions
        self.budgetMin = budgetMin
        self.budgetMax = budgetMax
        self.travelTypes = travelTypes
        self.currency = currency
    }

    /// Last-used Home filter → Travel preferences (PDF §4.5).
    public init(filter: TourFilter, currency: Currency) {
        self.init(
            regions: filter.region.map { $0 == "all" ? [] : [$0] },
            budgetMin: filter.budgetMin,
            budgetMax: filter.budgetMax,
            travelTypes: filter.travelTypes,
            currency: currency
        )
    }
}

// MARK: - Favorites

public enum FavoriteType: String, Codable, Sendable { case tour, place }

public struct FavoriteState: Codable, Sendable, Hashable {
    public let type: FavoriteType
    public let itemId: String
    public let isFavorite: Bool
}

public struct Favorites: Codable, Sendable {
    public struct Counts: Codable, Sendable { public let tours: Int; public let places: Int }
    public struct SavedTour: Codable, Sendable, Identifiable {
        public var id: String { favoriteId }
        public let favoriteId: String
        public let addedAt: Date
        public let tour: TourCard
    }
    public struct SavedPlace: Codable, Sendable, Identifiable {
        public var id: String { favoriteId }
        public let favoriteId: String
        public let addedAt: Date
        public let place: Place
    }
    public let counts: Counts
    public let tours: [SavedTour]
    public let places: [SavedPlace]
    public let currency: Currency
    public let emptyState: EmptyState?
}

// MARK: - Requests

public enum RequestStatus: String, Codable, Sendable { case pending, confirmed, completed, cancelled }

public struct RequestQuote: Codable, Sendable {
    public struct Line: Codable, Sendable, Hashable { public let label: String; public let amount: Money }
    public let tourId: String
    /// "980 AZN × 2 adults"
    public let lines: [Line]
    public let total: Money
    public let totalAZN: Int
    public let totalInAZN: Money
    public let note: String
}

public struct NewTourRequest: Encodable, Sendable {
    public var tourId: String
    public var flexible: Bool
    /// "yyyy-MM-dd"
    public var startDate: String?
    public var endDate: String?
    public var adults: Int
    public var children: Int
    public var phone: String?
    public var email: String?
    public var note: String?
    public var currency: Currency?
    public init(tourId: String, flexible: Bool, startDate: String? = nil, endDate: String? = nil, adults: Int, children: Int = 0, phone: String? = nil, email: String? = nil, note: String? = nil, currency: Currency? = nil) {
        self.tourId = tourId
        self.flexible = flexible
        self.startDate = startDate
        self.endDate = endDate
        self.adults = adults
        self.children = children
        self.phone = phone
        self.email = email
        self.note = note
        self.currency = currency
    }
}

public struct TourRequest: Codable, Sendable, Identifiable {
    public struct TourInfo: Codable, Sendable {
        public let id: String
        public let title: String
        public let country: Ref?
        public let city: Ref?
        public let durationLabel: String?
        public let coverImageUrl: URL?
    }
    public struct NextStep: Codable, Sendable, Hashable { public let step: Int; public let title: String; public let body: String }

    public let id: String
    /// "TR-2481"
    public let code: String
    public let status: RequestStatus
    /// Waiting for operator / Confirmed by operator / Completed
    public let statusLabel: String
    public let isPast: Bool
    public let tour: TourInfo
    public let startDate: String?
    public let endDate: String?
    public let flexible: Bool
    public let datesLabel: String
    public let adults: Int
    public let children: Int
    public let travelersLabel: String
    public let contactPhone: String
    public let contactEmail: String
    public let note: String?
    public let total: Money
    public let totalAZN: Int
    public let operatorNote: String?
    public let createdAt: Date
    public let updatedAt: Date
    public let disclaimer: String
    /// Only on the "Request sent" response.
    public let nextSteps: [NextStep]?
    public let noPaymentNote: String?
}

public enum RequestsTab: String, Sendable, CaseIterable { case all, pending, confirmed, past }

public struct RequestList: Codable, Sendable {
    public struct Counts: Codable, Sendable { public let all: Int; public let pending: Int; public let confirmed: Int; public let past: Int }
    public let counts: Counts
    public let items: [TourRequest]
    public let disclaimer: String
}

// MARK: - AI planner

public struct PlanSlots: Codable, Sendable, Hashable {
    public struct Dates: Codable, Sendable, Hashable {
        public let flexible: Bool
        public let start: String?
        public let end: String?
    }
    public var destination: String?
    public var travelers: Int?
    public var durationDays: Int?
    public var budgetAZN: Int?
    public var travelTypes: [String]
    public var departureCity: String?
    public var dates: Dates?
    public var flightsIncluded: Bool?
}

public struct SlotChip: Codable, Sendable, Hashable { public let key: String; public let label: String }

public struct PlanDraft: Codable, Sendable, Hashable {
    public struct Day: Codable, Sendable, Hashable {
        public let day: Int
        public let cityId: String
        public let title: String
        public let placeIds: [String]
        public let notes: String?
    }
    public let title: String
    public let summary: String
    public let days: [Day]
    public let relatedTourIds: [String]
}

public struct Plan: Codable, Sendable, Identifiable {
    public struct BreakdownItem: Codable, Sendable, Hashable, Identifiable {
        public var id: String { key }
        public let key: String
        public let label: String
        public let amountAZN: Int
        public let amount: Money
    }
    public struct DayItem: Codable, Sendable, Hashable {
        public let placeId: String?
        public let name: String
        public let category: String?
        public let durationHours: Double?
        public let priceAZN: Int
        public let price: Money?
        public let priceLabel: String
        public let isFavorite: Bool
    }
    public struct Day: Codable, Sendable, Hashable, Identifiable {
        public var id: Int { day }
        public let day: Int
        public let city: Ref?
        public let title: String
        public let notes: String?
        public let items: [DayItem]
    }

    /// Server id once saved; a fresh plan uses its title for identity.
    public var id: String { serverId ?? "draft-\(title)" }
    public let serverId: String?
    public let saved: Bool
    public let title: String
    public let summary: String
    /// Always "Estimate"
    public let label: String
    public let days: Int
    public let travelers: Int
    public let flightsIncluded: Bool
    public let departureCity: String?
    /// "5 days · 2 people · flights not included"
    public let subtitle: String
    public let currency: Currency
    public let estimatedTotal: Money
    public let estimatedTotalAZN: Int
    /// "~1,420 AZN"
    public let estimatedTotalLabel: String
    public let userBudget: Money?
    public let withinBudget: Bool
    public let breakdown: [BreakdownItem]
    public let cities: [Ref]
    public let dayPlans: [Day]
    public let relatedTours: [TourCard]
    /// "Prices are estimates and are not confirmed."
    public let note: String
    /// Send back to refine in chat or to save.
    public let draft: PlanDraft
    public let slots: PlanSlots
    public let createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case serverId = "id"
        case saved, title, summary, label, days, travelers, flightsIncluded, departureCity, subtitle, currency, estimatedTotal, estimatedTotalAZN,
             estimatedTotalLabel, userBudget, withinBudget, breakdown, cities, dayPlans, relatedTours, note, draft, slots, createdAt
    }
}

public struct ChatMessage: Codable, Sendable, Hashable {
    public enum Role: String, Codable, Sendable { case user, assistant }
    public let role: Role
    public let content: String
    public init(role: Role, content: String) {
        self.role = role
        self.content = content
    }
}

public struct ChatResponse: Codable, Sendable {
    public let reply: String
    /// Tappable answers for the current question.
    public let quickReplies: [String]
    public let slots: PlanSlots
    /// "2 people · 5 days · 1,500 AZN · Nature"
    public let slotChips: [SlotChip]
    public let missingSlots: [String]
    /// Enables the “Create my plan” button.
    public let readyToPlan: Bool
    public let plan: Plan?
    public let remainingToday: Int
    public let engine: String
}

public struct PlanSummary: Codable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let subtitle: String
    public let estimatedTotal: Money
    public let cities: [Ref]
    public let createdAt: Date
}

public struct DiscoverContent: Codable, Sendable {
    public let title: String
    public let prompt: String
    public let examples: [String]
    public let plans: [PlanSummary]
}

// MARK: - Rates

public struct ExchangeRates: Codable, Sendable {
    public let base: Currency
    /// Units of each currency per 1 AZN — multiply AZN prices by these.
    public let rates: [String: Double]
    public let aznPer: [String: Double]
    public let rateDate: String
    public let source: String
    public let updatedAt: Date

    public func convert(azn: Int, to currency: Currency) -> Double {
        Double(azn) * (rates[currency.rawValue] ?? 1)
    }
}
