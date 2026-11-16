import SwiftUI

struct RoyalCustomer: Decodable, Identifiable {
    let id: String
    let username: String
    let name: String
    let phone: String
    let blocked: Int
    let created_at: Double
    let order_count: Int
    let last_order_at: Double?
    let card_number: String?
    var isBlocked: Bool { blocked == 1 }
}
struct CustomersReply: Decodable {
    let customers: [RoyalCustomer]
    let has_more: Bool
    let offset: Int
}
struct CustomersView: View {
    @EnvironmentObject var store: RoyalStore
    @State private var customers: [RoyalCustomer] = []
    @State private var query = ""
    @State private var offset = 0
    @State private var hasMore = false
    @State private var loading = false
    @State private var pending: RoyalCustomer?
    @State private var confirmingSessions = false
    @State private var requestID = UUID()
    var body: some View {
        List {
            Section {
                Text("إيقاف الحساب يلغي جلساته ويمنع دخوله. لا يحذف طلباته أو بطاقته، ولا يمنع الطلب كضيف.").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(customers) { customer in
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(customer.name).font(.headline)
                        Spacer()
                        Text(customer.isBlocked ? "موقوف" : "نشط").font(.caption).foregroundStyle(customer.isBlocked ? .red : store.accent)
                    }
                    Text("@" + customer.username).font(.caption).foregroundStyle(.secondary)
                    if !customer.phone.isEmpty { Text(customer.phone).font(.callout).textSelection(.enabled) }
                    Text("\(customer.order_count) طلب").font(.caption)
                    if let date = customer.last_order_at { Text("آخر طلب: " + Date(timeIntervalSince1970: date).formatted()).font(.caption).foregroundStyle(.secondary) }
                    if let card = customer.card_number { Text("بطاقة الولاء: " + card).font(.caption) }
                    HStack {
                        Button(customer.isBlocked ? "تفعيل الحساب" : "إيقاف الحساب") { pending = customer; confirmingSessions = false }.buttonStyle(.bordered)
                        Button("إلغاء جلساته") { pending = customer; confirmingSessions = true }.buttonStyle(.bordered)
                    }.font(.caption).disabled(loading || store.busy)
                }.padding(.vertical, 8)
            }
            if customers.isEmpty && !loading { Text("لا توجد حسابات تطابق البحث.").foregroundStyle(.secondary) }
            Section {
                HStack {
                    Button("السابق") { offset = max(0, offset - 50); Task { await load() } }.disabled(offset == 0 || loading)
                    Spacer()
                    if loading { ProgressView() }
                    Button("التالي") { offset += 50; Task { await load() } }.disabled(!hasMore || loading)
                }
            }
            if !store.error.isEmpty { Text(store.error).foregroundStyle(.red) }
        }
        .navigationTitle("العملاء")
        .searchable(text: $query, prompt: "الاسم أو اليوزر أو الهاتف")
        .onSubmit(of: .search) { offset = 0; Task { await load() } }
        .task { await load() }
        .refreshable { await load() }
        .alert(confirmingSessions ? "إلغاء جلسات العميل؟" : "تغيير حالة الحساب؟", isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } })) {
            Button("إلغاء", role: .cancel) { pending = nil }
            Button("تأكيد", role: .destructive) {
                guard let customer = pending else { return }
                let sessions = confirmingSessions
                pending = nil
                Task {
                    let path = sessions ? "customer-sessions" : "customer-block"
                    var payload: [String: Any] = ["id": customer.id]
                    if !sessions { payload["blocked"] = !customer.isBlocked }
                    if await store.action(path, payload) { await load() }
                }
            }
        } message: { Text("تحتاج العملية صلاحية المالك. لن تُحذف بيانات العميل أو طلباته.") }
    }
    private func load() async {
        guard store.owner else { return }
        let current = UUID()
        requestID = current
        loading = true
        do {
            var components = URLComponents()
            components.queryItems = [URLQueryItem(name: "q", value: query), URLQueryItem(name: "offset", value: String(offset))]
            let reply = try JSONDecoder().decode(CustomersReply.self, from: await store.call("admin/customers?" + (components.percentEncodedQuery ?? "")))
            guard requestID == current else { return }
            customers = reply.customers
            hasMore = reply.has_more
            offset = reply.offset
        } catch { if requestID == current { store.error = error.localizedDescription } }
        if requestID == current { loading = false }
    }
}
