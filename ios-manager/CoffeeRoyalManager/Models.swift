import Foundation

struct RoyalUser: Codable { let id: String; let name: String; let role: String }
struct DrinkLine: Decodable, Identifiable { let id: String; let name: String; let quantity: Int }
struct NotificationState: Decodable { let state: String; let attempts: Int }
struct RoyalOrder: Decodable, Identifiable {
    let id: String; let order_number: Int?; let order_label: String?
    let name: String; let phone: String; let notes: String; let items: [DrinkLine]; let status: String; let created_at: Double
    let fulfillment: String; let location_lat: Double?; let location_lng: Double?; let address: String?
    let customization: [String:String]?; let estimated_ready_at: Double?; let rejection_reason: String?
    let called_at: Double?; let acknowledged_at: Double?; let ready_at: Double?; let notification_permission: String?
    let priority: Int; let queue_position: Int; let assigned_to: String?; let version: Int
    let notification: NotificationState?; let email_status: String
    var number: String { order_label ?? order_number.map { "CR-\($0)" } ?? String(id.prefix(8)) }
    var overdue: Bool { !["ready","delivered","cancelled"].contains(status) && (estimated_ready_at ?? .greatestFiniteMagnitude) < Date().timeIntervalSince1970 }
}
struct RoyalProduct: Decodable, Identifiable { let id: String; let name: String; let description: String; let category: String; let image: String; let available: Int; let stock: Int; let prep_minutes: Int }
struct RoyalSettings: Decodable { let accepting: Int; let opening_hour: Int; let closing_hour: Int; let busy_mode: Int; let maintenance: Int; let capacity: Int; let auto_accept: Int; let brand_name: String }
struct RoyalStats: Decodable { let daily: Int?; let weekly: Int? }
struct RoyalPopular: Decodable { let name: String; let quantity: Int }
struct RoyalData: Decodable { let orders: [RoyalOrder]; let products: [RoyalProduct]; let settings: RoyalSettings; let stats: RoyalStats; let popular: [RoyalPopular]; let user: RoyalUser }
struct LoyaltyCard: Decodable { let id: String; let name: String; let card_number: String; let stamps: Int; let reward_drinks: Int; let remaining: Int }
struct RoyalStaff: Decodable, Identifiable { let id: String; let username: String; let name: String; let role: String; let active: Int }
struct AuditEvent: Decodable, Identifiable { let id: String; let user_name: String; let action: String; let order_id: String?; let created_at: Double }
struct PushJob: Decodable, Identifiable { let id: String; let order_id: String?; let kind: String; let state: String; let attempts: Int }
struct DeviceSession: Decodable, Identifiable { let id: String; let device_name: String; let expires: Double }
struct RoyalPreferences: Codable {
    var theme = "dark"; var accent = "#D3AD80"; var cards = "normal"; var view = "board"; var tone = "royal"
    var sound = true; var vibration = true; var volume = 0.65
    enum CodingKeys: String, CodingKey { case theme,accent,cards,view,tone,sound,vibration,volume }
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        theme = try c.decodeIfPresent(String.self, forKey: .theme) ?? "dark"
        accent = try c.decodeIfPresent(String.self, forKey: .accent) ?? "#D3AD80"
        cards = try c.decodeIfPresent(String.self, forKey: .cards) ?? "normal"
        view = try c.decodeIfPresent(String.self, forKey: .view) ?? "board"
        tone = try c.decodeIfPresent(String.self, forKey: .tone) ?? "royal"
        sound = try c.decodeIfPresent(Bool.self, forKey: .sound) ?? true
        vibration = try c.decodeIfPresent(Bool.self, forKey: .vibration) ?? true
        volume = try c.decodeIfPresent(Double.self, forKey: .volume) ?? 0.65
    }
}
enum Stage: String, CaseIterable, Identifiable {
    case new, accepted, preparing, ready, delivered, cancelled
    var id: String { rawValue }
    var title: String { switch self { case .new: return "بانتظار القبول"; case .accepted: return "مقبول"; case .preparing: return "قيد التحضير"; case .ready: return "جاهز للاستلام"; case .delivered: return "تم التسليم"; case .cancelled: return "ملغي" } }
    var next: [Stage] { switch self { case .new: return [.accepted,.preparing,.cancelled]; case .accepted: return [.preparing,.cancelled]; case .preparing: return [.ready,.cancelled]; case .ready: return [.delivered,.cancelled]; default: return [] } }
}
func notificationTitle(_ state: String) -> String {
    ["pending":"بانتظار الإرسال","sending":"جارٍ الإرسال","sent":"قبله مزوّد الإشعارات","no_subscription":"لا يوجد جهاز مشترك","unconfigured":"الخدمة غير مهيأة","retry":"إعادة محاولة مجدولة","failed":"فشل الإرسال","expired":"انتهى الاشتراك"][state] ?? state
}
