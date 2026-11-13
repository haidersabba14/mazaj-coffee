import SwiftUI
import WebKit

@main
struct MazajAdminApp: App {
    var body: some Scene {
        WindowGroup { AdminHome().environment(\.layoutDirection, .rightToLeft).preferredColorScheme(.dark) }
    }
}

struct AdminHome: View {
    @AppStorage("cafeURL") private var savedURL = "https://mazaj-coffee.haider-sabba.workers.dev"
    @State private var draftURL = ""
    @State private var editing = false
    @State private var message = ""
    @State private var error = ""
    private var baseURL: URL? {
        guard let u = URL(string: savedURL), u.scheme == "https", u.host != nil,
              u.user == nil, u.password == nil else { return nil }
        return u
    }
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if !message.isEmpty {
                    Text(message).font(.subheadline).padding().frame(maxWidth: .infinity)
                        .background(Color.yellow.opacity(0.12)).accessibilityAddTraits(.updatesFrequently)
                }
                if let url = baseURL {
                    AdminWebView(url: url.appendingPathComponent("admin.html"), message: $message)
                        .id(savedURL)
                } else {
                    ContentUnavailableView("اربط المقهى أولًا", systemImage: "cup.and.saucer",
                                           description: Text("أضف رابط موقعك المنشور على Cloudflare من الإعدادات. التطبيق لا يتضمن مفتاح API أو كلمة مرور."))
                }
            }
            .background(Color(red: 0.09, green: 0.11, blue: 0.09))
            .navigationTitle("مزاج · الإدارة")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { draftURL = savedURL; editing = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel("إعدادات الاتصال")
                }
            }
            .sheet(isPresented: $editing) {
                NavigationStack {
                    Form {
                        Section("رابط المقهى المنشور") {
                            TextField("https://your-worker.workers.dev", text: $draftURL)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .keyboardType(.URL).environment(\.layoutDirection, .leftToRight)
                            Text("استخدم رابط المقهى الذي تملكه فقط. ستُدخل كلمة المرور في صفحة الإدارة الآمنة.")
                                .font(.caption)
                        }
                        if !error.isEmpty { Text(error).foregroundStyle(.red) }
                        Button("حفظ الاتصال") {
                            guard let u = URL(string: draftURL.trimmingCharacters(in: .whitespacesAndNewlines)),
                                  u.scheme == "https", u.host != nil, u.user == nil, u.password == nil,
                                  u.query == nil, u.fragment == nil else { error = "أدخل رابط HTTPS صحيحًا دون بيانات دخول أو معاملات."; return }
                            var components = URLComponents(url: u, resolvingAgainstBaseURL: false)!
                            components.path = ""; components.query = nil; components.fragment = nil
                            savedURL = components.url!.absoluteString; error = ""; message = ""; editing = false
                        }
                        Section("الإشعارات") {
                            Text("تصل تنبيهات الطلبات داخل التطبيق أثناء فتح لوحة الطلبات، بالتحديث كل ٣٠ ثانية. الإشعارات والتطبيق مغلق تحتاج خدمة APNs منفصلة ولم تُفعّل في هذه النسخة.")
                        }
                    }
                    .navigationTitle("إعدادات مزاج")
                    .toolbar { Button("إغلاق") { editing = false } }
                }.environment(\.layoutDirection, .rightToLeft)
            }
        }
    }
}

struct AdminWebView: UIViewRepresentable {
    let url: URL
    @Binding var message: String
    func makeCoordinator() -> Coordinator { Coordinator(host: url.host ?? "", message: $message) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(context.coordinator, name: "mazajOrders")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false; view.backgroundColor = .black
        view.allowsBackForwardNavigationGestures = true
        view.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) { }
    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "mazajOrders")
        view.stopLoading(); view.navigationDelegate = nil
    }
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let host: String
        var message: Binding<String>
        init(host: String, message: Binding<String>) { self.host = host; self.message = message }
        func userContentController(_ userContentController: WKUserContentController, didReceive scriptMessage: WKScriptMessage) {
            guard scriptMessage.frameInfo.isMainFrame, scriptMessage.frameInfo.securityOrigin.host == host,
                  let data = scriptMessage.body as? [String: Any], let count = data["count"] as? Int, count > 0 else { return }
            DispatchQueue.main.async { self.message.wrappedValue = "☕ وصلت طلبات جديدة — يرجى مراجعتها وقبولها" }
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let u = action.request.url else { decisionHandler(.cancel); return }
            if action.targetFrame?.isMainFrame != true { decisionHandler(.allow); return }
            if u.scheme == "https" && u.host == host { decisionHandler(.allow); return }
            if ["tel", "mailto"].contains(u.scheme ?? "") { UIApplication.shared.open(u) }
            decisionHandler(.cancel)
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            DispatchQueue.main.async { self.message.wrappedValue = "تعذر الاتصال بالمقهى. تحقق من الإنترنت ثم افتح الإعدادات وأعد حفظ الرابط." }
        }
    }
}
