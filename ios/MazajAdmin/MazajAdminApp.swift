import SwiftUI
import Foundation
import MapKit
import AudioToolbox
import VisionKit

private let cafeBase = URL(string: "https://mazaj-cafe-995.pages.dev")!
private let gold = Color(red: 0.83, green: 0.70, blue: 0.51)
private let cafeBackground = Color(red: 0.07, green: 0.065, blue: 0.055)

@main
struct MazajAdminApp: App {
    var body: some Scene {
        WindowGroup {
            AdminRoot().environment(\.layoutDirection, .rightToLeft)
                .preferredColorScheme(.dark).tint(gold)
        }
    }
}

struct DrinkLine: Decodable, Identifiable {
    let id: String; let name: String; let quantity: Int
}
struct CoffeeOrder: Decodable, Identifiable {
    let id: String; let name: String; let phone: String; let notes: String
    let items: [DrinkLine]; let status: String; let created_at: Double
    let email_status: String; let email_attempts: Int; let total: Int
    let fulfillment: String?; let location_lat: Double?; let location_lng: Double?; let address: String?
    let estimated_ready_at: Double?; let rejection_reason: String?
    let customization: [String:String]?
}
struct Drink: Decodable, Identifiable {
    let id: String; let name: String; let description: String
    let category: String; let image: String; let available: Int
}
struct ShopSettings: Decodable { let accepting: Int; let opening_hour: Int }
struct Statistics: Decodable { let daily: Int?; let weekly: Int? }
struct PopularDrink: Decodable { let name: String; let quantity: Int }
struct LoyaltyCard: Decodable {
    let id: String; let card_number: String; let name: String; let stamps: Int; let reward_drinks: Int; let total_stamps: Int; let remaining: Int
}
struct AdminData: Decodable {
    let orders: [CoffeeOrder]; let stats: Statistics; let popular: [PopularDrink]
    let products: [Drink]; let settings: ShopSettings
}
private struct ErrorReply: Decodable { let error: String }
private struct AdminError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
enum OrderStatus: String, CaseIterable, Identifiable {
    case new, preparing, ready, delivered, cancelled
    var id: String { rawValue }
    var title: String {
        switch self {
        case .new: return "بانتظار القبول"
        case .preparing: return "قيد التجهيز"
        case .ready: return "جاهز للاستلام"
        case .delivered: return "تم التسليم"
        case .cancelled: return "ملغي"
        }
    }
}

@MainActor
final class AdminModel: ObservableObject {
    @Published var loggedIn = false
    @Published var busy = false
    @Published var error = ""
    @Published var notice = ""
    @Published var data: AdminData?
    @Published var loyalty: LoyaltyCard?
    @Published var cardNumber = ""
    private var stampEvents: [String:String] = [:]
    @Published var query = ""
    @Published var status = ""
    @Published var dateFilter = ""
    private var seen = Set<String>()
    private var loaded = false

    private func call(_ path: String, payload: [String: Any]? = nil) async throws -> Data {
        guard var parts = URLComponents(url: cafeBase.appendingPathComponent("api/" + path), resolvingAgainstBaseURL: false) else {
            throw AdminError(message: "تعذر الاتصال")
        }
        if path == "admin/data" {
            parts.queryItems = [URLQueryItem(name: "q", value: query), URLQueryItem(name: "status", value: status), URLQueryItem(name: "date", value: dateFilter)]
        }
        if path == "admin/cards" { parts.queryItems = [URLQueryItem(name: "number", value: cardNumber)] }
        guard let url = parts.url else { throw AdminError(message: "تعذر الاتصال") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 25)
        request.setValue("https://" + (cafeBase.host ?? ""), forHTTPHeaderField: "Origin")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let payload {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        }
        let (body, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw AdminError(message: "تعذر الاتصال") }
        if response.statusCode == 401 { loggedIn = false }
        guard (200...299).contains(response.statusCode) else {
            let server = try? JSONDecoder().decode(ErrorReply.self, from: body)
            throw AdminError(message: server?.error ?? "تعذر إتمام العملية، حاول مجددًا.")
        }
        return body
    }
    func login(password: String) async {
        guard !busy else { return }
        busy = true; error = ""
        defer { busy = false }
        do {
            _ = try await call("login", payload: ["password": password])
            try await fetchData()
        } catch { self.error = error.localizedDescription }
    }
    private func fetchData() async throws {
        let result = try JSONDecoder().decode(AdminData.self, from: await call("admin/data"))
        let unseen = result.orders.filter { !seen.contains($0.id) && $0.status == "new" }
        if loaded && !unseen.isEmpty { notice = "☕ وصلت طلبات بانتظار قبولك: \(unseen.count)"; if UserDefaults.standard.object(forKey: "orderSound") as? Bool ?? true { AudioServicesPlaySystemSound(1007) } }
        seen.formUnion(result.orders.map(\.id)); loaded = true
        data = result; loggedIn = true
    }
    func refresh() async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        do { try await fetchData(); error = "" }
        catch { if loggedIn { self.error = error.localizedDescription } }
    }
    func action(_ endpoint: String, payload: [String: Any]) async -> Bool {
        guard !busy else { return false }
        busy = true; error = ""; defer { busy = false }
        do { _ = try await call("admin/" + endpoint, payload: payload); try await fetchData(); return true }
        catch { self.error = error.localizedDescription; return false }
    }
    func findCard() async {
        guard !busy else { return }; busy = true; error = ""; defer { busy = false }
        cardNumber = cardNumber.replacingOccurrences(of: "MAZAJ:", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        do { loyalty = try JSONDecoder().decode(LoyaltyCard.self, from: await call("admin/cards")) }
        catch { self.error = error.localizedDescription; loyalty = nil }
    }
    func stampCard() async {
        guard !busy, let card = loyalty else { return }; busy = true; error = ""; defer { busy = false }
        let event = stampEvents[card.id] ?? UUID().uuidString.lowercased(); stampEvents[card.id] = event
        do { loyalty = try JSONDecoder().decode(LoyaltyCard.self, from: await call("admin/stamp", payload: ["id":card.id,"event_id":event])); stampEvents.removeValue(forKey: card.id) }
        catch { self.error = error.localizedDescription }
    }
    func scanAndStamp(_ raw: String) async {
        guard !busy else { return }; busy = true; error = ""; defer { busy = false }
        cardNumber = raw.replacingOccurrences(of: "MAZAJ:", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let card = try JSONDecoder().decode(LoyaltyCard.self, from: await call("admin/cards"))
            let event = stampEvents[card.id] ?? UUID().uuidString.lowercased(); stampEvents[card.id] = event
            loyalty = try JSONDecoder().decode(LoyaltyCard.self, from: await call("admin/stamp", payload: ["id":card.id,"event_id":event]))
            stampEvents.removeValue(forKey: card.id); notice = "تمت إضافة ختم واحد للبطاقة"
        } catch { self.error = error.localizedDescription }
    }
    func logout() async {
        do { _ = try await call("admin/logout", payload: [:]) }
        catch { self.error = error.localizedDescription }
        for cookie in HTTPCookieStorage.shared.cookies ?? [] where cookie.domain.contains(cafeBase.host ?? "") {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
        loggedIn = false; data = nil; notice = ""; seen = []; loaded = false
    }
}

struct AdminRoot: View {
    @StateObject private var model = AdminModel()
    @Environment(\.scenePhase) private var phase
    private let timer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()
    var body: some View {
        Group {
            if model.loggedIn {
                TabView {
                    OrdersScreen(model: model).tabItem { Label("الطلبات", systemImage: "tray.full") }
                    LoyaltyScreen(model: model).tabItem { Label("بطاقات الولاء", systemImage: "qrcode.viewfinder") }
                    ProductsScreen(model: model).tabItem { Label("المشروبات", systemImage: "cup.and.saucer") }
                    SettingsScreen(model: model).tabItem { Label("الإدارة", systemImage: "slider.horizontal.3") }
                }
            } else { LoginScreen(model: model) }
        }
        .background(cafeBackground)
        .task { await model.refresh() }
        .onReceive(timer) { _ in if phase == .active && model.loggedIn { Task { await model.refresh() } } }
        .onChange(of: phase) { _, next in if next == .active && model.loggedIn { Task { await model.refresh() } } }
    }
}

struct LoginScreen: View {
    @ObservedObject var model: AdminModel
    @State private var password = ""
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 13) {
                        Image(systemName: "cup.and.saucer.fill").font(.system(size: 43)).foregroundStyle(gold)
                        Text("مزاج · الإدارة").font(.largeTitle.bold())
                        Text("مساحتك الخاصة لاستقبال الطلبات وتجهيزها.").foregroundStyle(.secondary)
                    }.padding(.vertical, 20)
                }
                Section("دخول المسؤول") {
                    SecureField("رمز دخول الإدارة", text: $password).textContentType(.password).keyboardType(.numberPad)
                    Button { Task { await model.login(password: password); password = "" } } label: {
                        HStack { Text("تسجيل الدخول"); Spacer(); if model.busy { ProgressView() } else { Image(systemName: "arrow.left") } }
                    }.disabled(model.busy || password.isEmpty)
                }
                Section { Text("دخول إدارة المقهى بكلمة المرور فقط. لا يوجد موقع العملاء داخل التطبيق.").font(.caption).foregroundStyle(.secondary) }
                if !model.error.isEmpty { Section { Text(model.error).foregroundStyle(.red) } }
            }.navigationTitle("أهلًا بمزاجك")
        }
    }
}

struct OrdersScreen: View {
    @ObservedObject var model: AdminModel
    @State private var filterDay = Date()
    @State private var useDate = false
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 12) {
                        stat("اليوم", value: String(model.data?.stats.daily ?? 0))
                        stat("آخر ٧ أيام", value: String(model.data?.stats.weekly ?? 0))
                    }
                    if let popular = model.data?.popular.first { Label("الأكثر طلبًا: \(popular.name)", systemImage: "star.fill").font(.caption).foregroundStyle(gold) }
                    if !model.notice.isEmpty { Text(model.notice).padding().frame(maxWidth: .infinity, alignment: .leading).background(gold.opacity(0.12), in: RoundedRectangle(cornerRadius: 12)) }
                    if !model.error.isEmpty { Text(model.error).font(.caption).foregroundStyle(.red) }
                    Picker("الحالة", selection: $model.status) {
                        Text("كل الحالات").tag("")
                        ForEach(OrderStatus.allCases) { Text($0.title).tag($0.rawValue) }
                    }.pickerStyle(.menu).onChange(of: model.status) { _, _ in Task { await model.refresh() } }
                    Toggle("فلترة حسب التاريخ", isOn: $useDate)
                        .onChange(of: useDate) { _, value in updateDate(enabled: value) }
                    if useDate { DatePicker("تاريخ الطلب — البحرين", selection: $filterDay, displayedComponents: .date)
                        .onChange(of: filterDay) { _, _ in updateDate(enabled: true) } }
                    if model.data?.orders.isEmpty != false {
                        ContentUnavailableView("لا توجد طلبات", systemImage: "tray", description: Text("ستظهر الطلبات الجديدة هنا. اسحب لتحديث القائمة."))
                    }
                    ForEach(model.data?.orders ?? []) { order in OrderCard(order: order, model: model) }
                    Text("تحديث كل ٣٠ ثانية أثناء فتح التطبيق · أحدث ٢٠٠ نتيجة").font(.caption2).foregroundStyle(.secondary)
                }.padding()
            }
            .navigationTitle("الطلبات")
            .searchable(text: $model.query, prompt: "الاسم، الهاتف، أو رقم الطلب")
            .onSubmit(of: .search) { Task { await model.refresh() } }
            .onChange(of: model.query) { _, value in if value.isEmpty { Task { await model.refresh() } } }
            .refreshable { await model.refresh() }
            .toolbar { Button { Task { await model.refresh() } } label: { Image(systemName: "arrow.clockwise") }.disabled(model.busy) }
        }
    }
    private func updateDate(enabled: Bool) {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Bahrain")
        model.dateFilter = enabled ? f.string(from: filterDay) : ""
        Task { await model.refresh() }
    }
    private func stat(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 9) { Text(title).font(.caption).foregroundStyle(.secondary); Text(value).font(.largeTitle.bold()).foregroundStyle(gold) }
            .frame(maxWidth: .infinity, alignment: .leading).padding().background(.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 15))
    }
}

struct OrderCard: View {
    let order: CoffeeOrder
    @ObservedObject var model: AdminModel
    @State private var showMap = false
    @State private var rejecting = false
    @State private var reason = ""
    private var time: String {
        let f = DateFormatter(); f.locale = Locale(identifier: "ar_BH"); f.timeZone = TimeZone(identifier: "Asia/Bahrain"); f.dateStyle = .short; f.timeStyle = .short
        return f.string(from: Date(timeIntervalSince1970: order.created_at))
    }
    private var emailLabel: String {
        ["pending":"بانتظار الإرسال", "sending":"جارٍ الإرسال", "sent":"تم قبول الإرسال", "failed":"فشل الإرسال"][order.email_status] ?? order.email_status
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) { Text(order.name).font(.title3.bold()); Spacer(); Text(OrderStatus(rawValue: order.status)?.title ?? order.status).font(.caption).foregroundStyle(gold) }
            HStack { if let url = URL(string: "tel:" + order.phone.filter { $0.isNumber || $0 == "+" }) { Link(order.phone, destination: url) }; Spacer(); Text(time).font(.caption2).foregroundStyle(.secondary) }
            Text(order.id).font(.caption2.monospaced()).textSelection(.enabled).foregroundStyle(.secondary)
            Divider()
            ForEach(order.items) { item in HStack { Text(item.name); Spacer(); Text("× \(item.quantity)").foregroundStyle(gold) } }
            if let options = order.customization, !options.isEmpty { Text(options.values.sorted().joined(separator: " · ")).font(.caption).foregroundStyle(.secondary) }
            if !order.notes.isEmpty { Text("ملاحظات: " + order.notes).font(.subheadline).foregroundStyle(.secondary) }
            HStack { Text(order.fulfillment == "delivery" ? "توصيل للبيت — مجانًا" : "استلام من المقهى"); Spacer(); Text(String(format: "%.3f د.ب.", Double(order.total) / 1000)).foregroundStyle(gold) }.font(.caption)
            if order.fulfillment == "delivery" {
                if let address = order.address, !address.isEmpty { Text(address).font(.caption).foregroundStyle(.secondary) }
                if order.location_lat != nil && order.location_lng != nil { Button("عرض موقع البيت على الخريطة") { showMap = true } }
            }
            if order.status == "preparing", let eta = order.estimated_ready_at { Text("الجاهزية المتوقعة: " + Date(timeIntervalSince1970: eta).formatted(date: .omitted, time: .shortened)).font(.caption).foregroundStyle(gold) }
            if order.status == "cancelled", let rejection = order.rejection_reason { Text("سبب الرفض: " + rejection).font(.caption).foregroundStyle(.red) }
            if order.status == "new" {
                HStack {
                    Menu("قبول الطلب") { ForEach([5,10,15,20,30], id: \.self) { minutes in Button("تجهيز خلال \(minutes) دقيقة") { Task { _ = await model.action("status", payload: ["id":order.id,"status":"preparing","eta_minutes":minutes]) } } } }.buttonStyle(.borderedProminent)
                    Button("رفض", role: .destructive) { rejecting = true }.buttonStyle(.bordered)
                }
            }
            Menu("تغيير حالة الطلب") {
                ForEach(OrderStatus.allCases) { value in Button(value.title) { update(value.rawValue) } }
            }
            Text("البريد: \(emailLabel) · المحاولات: \(order.email_attempts)").font(.caption2).foregroundStyle(.secondary)
            if order.email_status != "sent" { Button("إعادة محاولة إشعار البريد") { Task { _ = await model.action("retry", payload: ["id":order.id]) } }.font(.caption) }
        }.padding(18).background(.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 16)).disabled(model.busy)
        .alert("سبب رفض الطلب", isPresented: $rejecting) {
            TextField("اكتب السبب للزبون", text: $reason)
            Button("تأكيد الرفض", role: .destructive) { Task { _ = await model.action("status", payload: ["id":order.id,"status":"cancelled","reason":reason.isEmpty ? "نعتذر، تعذر تجهيز الطلب حاليًا" : reason]); reason = "" } }
            Button("رجوع", role: .cancel) { }
        }
        .sheet(isPresented: $showMap) { if let lat = order.location_lat, let lng = order.location_lng { CustomerMap(latitude: lat, longitude: lng) } }
    }
    private func update(_ status: String) { if status == "cancelled" { rejecting = true; return }; Task { _ = await model.action("status", payload: ["id":order.id, "status":status]) } }
}

struct ProductsScreen: View {
    @ObservedObject var model: AdminModel
    @State private var editing: Drink?
    @State private var adding = false
    var body: some View {
        NavigationStack {
            List {
                if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
                ForEach(model.data?.products ?? []) { drink in
                    Button { editing = drink } label: {
                        HStack(spacing: 14) {
                            AsyncImage(url: URL(string: drink.image.hasPrefix("/") ? cafeBase.absoluteString + drink.image : drink.image)) { image in image.resizable().scaledToFill() } placeholder: { Image(systemName: "cup.and.saucer").foregroundStyle(gold) }
                                .frame(width: 65, height: 65).clipShape(RoundedRectangle(cornerRadius: 10))
                            VStack(alignment: .leading, spacing: 6) { Text(drink.name).foregroundStyle(.primary); Text(drink.available == 1 ? "متاح" : "مخفي").font(.caption).foregroundStyle(.secondary) }
                            Spacer(); Image(systemName: "pencil").foregroundStyle(gold)
                        }
                    }
                }
                Text("جميع طلبات المشروبات مجانية. الطلب العادي مشروب واحد، ومكافأة الولاء مشروبان.").font(.caption).foregroundStyle(.secondary)
            }
            .navigationTitle("المشروبات")
            .toolbar { Button { adding = true } label: { Image(systemName: "plus") } }
            .sheet(item: $editing) { drink in ProductEditor(model: model, drink: drink) }
            .sheet(isPresented: $adding) { ProductEditor(model: model, drink: nil) }
        }
    }
}

struct ProductEditor: View {
    @ObservedObject var model: AdminModel
    let drink: Drink?
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var image = ""
    @State private var category = "hot"
    @State private var available = true
    var body: some View {
        NavigationStack {
            Form {
                Section("تفاصيل المشروب") {
                    TextField("اسم المشروب", text: $name)
                    TextField("الوصف", text: $description, axis: .vertical)
                    Picker("القسم", selection: $category) { Text("ساخن").tag("hot"); Text("بارد").tag("cold"); Text("خاص").tag("signature") }
                    Toggle("متاح للعملاء", isOn: $available)
                }
                Section("الصورة") {
                    TextField("رابط صورة HTTPS أو مسار صورة محلية", text: $image).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                }
                if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
                Button("حفظ المشروب") {
                    Task { if await model.action("product", payload: ["id":drink?.id ?? UUID().uuidString, "name":name, "description":description, "image":image, "category":category, "available":available]) { dismiss() } }
                }.disabled(model.busy || name.trimmingCharacters(in: .whitespaces).isEmpty || description.isEmpty || image.isEmpty)
            }
            .navigationTitle(drink == nil ? "إضافة مشروب" : "تعديل المشروب")
            .toolbar { Button("إغلاق") { dismiss() } }
            .onAppear { if let drink { name = drink.name; description = drink.description; image = drink.image; category = drink.category; available = drink.available == 1 } }
        }.environment(\.layoutDirection, .rightToLeft)
    }
}

struct SettingsScreen: View {
    @AppStorage("orderSound") private var sound = true
    @ObservedObject var model: AdminModel
    @State private var accepting = true
    @State private var hour = 15
    var body: some View {
        NavigationStack {
            Form {
                Section("استقبال الطلبات") {
                    Toggle("تشغيل استقبال الطلبات", isOn: $accepting)
                    Stepper("ساعة الفتح بتوقيت البحرين: \(hour):00", value: $hour, in: 0...23)
                    Button("حفظ إعدادات المقهى") { Task { _ = await model.action("settings", payload: ["accepting":accepting, "opening_hour":hour]) } }.disabled(model.busy)
                }
                if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
                Section("التنبيهات") {
                    Toggle("تنبيه صوتي عند وصول طلب جديد", isOn: $sound)
                    Text("تصل الطلبات أثناء فتح التطبيق بتحديث تلقائي كل ٣٠ ثانية. اسحب صفحة الطلبات للتحديث فورًا. الإشعارات والتطبيق مغلق غير مفعّلة بعد.").font(.caption)
                    Text("حالة البريد تعني قبول مزوّد الإرسال، وليست تأكيد وصول الرسالة إلى صندوق الوارد.").font(.caption).foregroundStyle(.secondary)
                }
                Section("الخصوصية") { Text("بيانات الطلبات محفوظة لمدة ٣٠ يومًا. كلمة المرور لا تُحفظ في كود التطبيق.").font(.caption) }
                Button("تسجيل الخروج", role: .destructive) { Task { await model.logout() } }
            }
            .navigationTitle("إدارة المقهى")
            .onAppear { accepting = model.data?.settings.accepting == 1; hour = model.data?.settings.opening_hour ?? 15 }
        }
    }
}

struct CustomerMap: View {
    let latitude: Double
    let longitude: Double
    @Environment(\.dismiss) private var dismiss
    private var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: latitude, longitude: longitude) }
    var body: some View {
        NavigationStack {
            Map(initialPosition: .region(MKCoordinateRegion(center: coordinate, span: MKCoordinateSpan(latitudeDelta: 0.008, longitudeDelta: 0.008)))) { Marker("موقع بيت الزبون", coordinate: coordinate) }
                .safeAreaInset(edge: .bottom) { Button("فتح الاتجاهات في الخرائط") { let item = MKMapItem(placemark: MKPlacemark(coordinate: coordinate)); item.name = "موقع بيت الزبون"; item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey:MKLaunchOptionsDirectionsModeDriving]) }.buttonStyle(.borderedProminent).padding() }
                .navigationTitle("موقع التوصيل").navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("إغلاق") { dismiss() } }
        }
    }
}

struct LoyaltyScreen: View {
    @ObservedObject var model: AdminModel
    @State private var scanning = false
    var body: some View {
        NavigationStack {
            Form {
                Section("بطاقة الزبون") {
                    TextField("رقم البطاقة", text: $model.cardNumber).keyboardType(.numberPad)
                    Button("سكان وإضافة ختم") { scanning = true }
                    Button("عرض البطاقة") { Task { await model.findCard() } }.disabled(model.busy || model.cardNumber.isEmpty)
                }
                if let card = model.loyalty {
                    Section(card.name) {
                        Text("رقم البطاقة: " + card.card_number)
                        HStack { ForEach(0..<5) { index in Image(systemName: index < card.stamps ? "cup.and.saucer.fill" : "cup.and.saucer").font(.title2).foregroundStyle(index < card.stamps ? gold : .gray) } }
                        Text("متبقي \(card.remaining) ختمات على مشروبين هدية")
                        Text("رصيد مشروبات المكافأة: \(card.reward_drinks)").foregroundStyle(gold)
                        Text("إجمالي الختمات: \(card.total_stamps)").font(.caption)
                        Button("إضافة ختم واحد") { Task { await model.stampCard() } }.disabled(model.busy)
                    }
                }
                if !model.error.isEmpty { Text(model.error).foregroundStyle(.red) }
                Section { Text("كل خمس ختمات تمنح الزبون مشروبين من اختياره. الختم يضاف من الإدارة فقط، ولا يستطيع الزبون إضافة ختم لنفسه.").font(.caption).foregroundStyle(.secondary) }
            }
            .navigationTitle("بطاقات الولاء")
            .sheet(isPresented: $scanning) {
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    CardScanner { value in scanning = false; Task { await model.scanAndStamp(value) } }.ignoresSafeArea()
                } else { VStack(spacing: 20) { Text("يمكنك كتابة رقم البطاقة يدويًا على هذا الجهاز."); Button("رجوع") { scanning = false } }.padding() }
            }
        }
    }
}
struct CardScanner: UIViewControllerRepresentable {
    let onCode: (String) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }
    func makeUIViewController(context: Context) -> DataScannerViewController {
        let view = DataScannerViewController(recognizedDataTypes: [.barcode()], qualityLevel: .balanced, recognizesMultipleItems: false, isHighlightingEnabled: true)
        view.delegate = context.coordinator
        DispatchQueue.main.async { try? view.startScanning() }
        return view
    }
    func updateUIViewController(_ controller: DataScannerViewController, context: Context) { }
    static func dismantleUIViewController(_ controller: DataScannerViewController, coordinator: Coordinator) { controller.stopScanning() }
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Void
        private var handled = false
        init(onCode: @escaping (String) -> Void) { self.onCode = onCode }
        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !handled else { return }
            for item in addedItems { if case .barcode(let code) = item, let value = code.payloadStringValue, value.hasPrefix("MAZAJ:") { handled = true; dataScanner.stopScanning(); onCode(value); return } }
        }
    }
}
