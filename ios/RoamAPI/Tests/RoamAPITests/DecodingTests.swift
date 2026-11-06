import Foundation
import Testing
@testable import RoamAPI

/// Fixtures are real responses captured from the Roam backend, so these tests catch contract drift.
private func fixture<T: Decodable>(_ name: String, as type: T.Type = T.self) throws -> T {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
    return try RoamClient.makeDecoder().decode(T.self, from: Data(contentsOf: url))
}

@Suite("Catalog decoding")
struct CatalogDecodingTests {
    @Test func toursPage() throws {
        let page: ToursPage = try fixture("tours")
        #expect(!page.items.isEmpty)
        #expect(page.items.allSatisfy { $0.region.id == "africa" })
        #expect(page.activeFilterCount == 1)
    }

    @Test func tourDetail() throws {
        let tour: TourDetail = try fixture("tour-detail")
        #expect(tour.card.title == "Pyramids & Nile Cruise")
        #expect(tour.breadcrumb.map(\.name) == ["Africa", "Egypt", "Cairo"])
        #expect(tour.card.priceLabel == "From 980 AZN / person")
        #expect(tour.card.isFavorite)
        #expect(tour.itinerary.first?.items.contains { $0.priceLabel == "+35 AZN" } == true)
        #expect(tour.budget.packagePriceAZN == 980)
    }

    @Test func countriesAndCities() throws {
        let countries: [CountryCard] = try fixture("countries")
        #expect(countries.contains { $0.id == "egypt" && $0.cityCount == 3 })
        let egypt: CountryDetail = try fixture("country-detail")
        #expect(egypt.info.map(\.title) == ["Currency", "Language", "Best season"])
        let cairo: CityDetail = try fixture("city-detail")
        #expect(cairo.dailyBudgetLabel == "~85 AZN / person")
        #expect(cairo.places.contains { $0.id == "giza" && $0.isFavorite })
    }

    @Test func filterOptions() throws {
        let options: FilterOptions = try fixture("filters")
        #expect(options.regions.first?.name == "All")
        #expect(options.durations.map(\.label) == ["Any", "1–3 days", "4–7 days", "8+ days"])
    }
}

@Suite("Personal data decoding")
struct PersonalDecodingTests {
    @Test func auth() throws {
        let auth: AuthResponse = try fixture("auth")
        #expect(auth.user.initials == "YN")
        #expect(auth.expiresIn > 0)
    }

    @Test func profile() throws {
        let me: Profile = try fixture("me")
        #expect(me.currency == .AZN)
        #expect(me.phone == "+994 50 123 45 67")
    }

    @Test func favorites() throws {
        let favs: Favorites = try fixture("favorites")
        #expect(favs.counts.tours == 1)
        #expect(favs.places.first?.place.name == "Giza Pyramids")
    }

    @Test func requests() throws {
        let sent: TourRequest = try fixture("request-sent")
        #expect(sent.code.hasPrefix("TR-"))
        #expect(sent.status == .pending)
        #expect(sent.nextSteps?.count == 3)
        let list: RequestList = try fixture("requests")
        #expect(list.counts.pending >= 1)
        let quote: RequestQuote = try fixture("quote")
        #expect(quote.total.formatted == "1,960 AZN")
    }

    @Test func validationError() throws {
        let body: APIErrorBody = try fixture("error-validation")
        #expect(body.statusCode == 400)
        #expect(body.fields?["email"] == "Enter a valid email address.")
    }

    @Test func rates() throws {
        let rates: ExchangeRates = try fixture("rates")
        #expect(rates.base == .AZN)
        #expect(rates.convert(azn: 1000, to: .AZN) == 1000)
    }
}

@Suite("AI planner decoding")
struct PlannerDecodingTests {
    @Test func question() throws {
        let res: ChatResponse = try fixture("chat-question")
        #expect(res.plan == nil)
        #expect(!res.readyToPlan)
        #expect(res.slotChips.map(\.label).contains("800 AZN"))
    }

    @Test func plan() throws {
        let res: ChatResponse = try fixture("chat-plan")
        let plan = try #require(res.plan)
        #expect(plan.label == "Estimate")
        #expect(plan.dayPlans.count == 5)
        #expect(plan.breakdown.reduce(0) { $0 + $1.amountAZN } == plan.estimatedTotalAZN)
        #expect(plan.serverId == nil)
        // Round-trip the draft + slots the way `savePlan` sends them.
        let encoded = try JSONEncoder().encode(plan.draft)
        #expect(try JSONDecoder().decode(PlanDraft.self, from: encoded) == plan.draft)
    }
}
