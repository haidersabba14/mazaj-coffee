import SwiftUI
import UserNotifications

final class PushDelegate:NSObject,UIApplicationDelegate,UNUserNotificationCenterDelegate {
    static var onToken:((String)->Void)?
    func application(_ application:UIApplication,didFinishLaunchingWithOptions launchOptions:[UIApplication.LaunchOptionsKey:Any]?=nil)->Bool{UNUserNotificationCenter.current().delegate=self;return true}
    func application(_ application:UIApplication,didRegisterForRemoteNotificationsWithDeviceToken deviceToken:Data){let token=deviceToken.map{String(format:"%02x",$0)}.joined();Task{@MainActor in PushDelegate.onToken?(token)}}
    func application(_ application:UIApplication,didFailToRegisterForRemoteNotificationsWithError error:Error){NotificationCenter.default.post(name:Notification.Name("RoyalPushError"),object:error.localizedDescription)}
    func userNotificationCenter(_ center:UNUserNotificationCenter,willPresent notification:UNNotification,withCompletionHandler completionHandler:@escaping(UNNotificationPresentationOptions)->Void){completionHandler([.banner,.sound])}
}
@main struct CoffeeRoyalManagerApp:App {
    @UIApplicationDelegateAdaptor(PushDelegate.self) var delegate
    @StateObject private var store=RoyalStore()
    @Environment(\.scenePhase) private var phase
    var body:some Scene{WindowGroup{RoyalRoot().environmentObject(store).environment(\.layoutDirection,.rightToLeft).tint(store.accent).preferredColorScheme(store.preferences.theme=="system" ? nil:store.preferences.theme=="light" ? .light:.dark).font(.system(.body,design:store.fontDesign)).task{PushDelegate.onToken={token in Task{await store.registerPush(token)}}}.onReceive(NotificationCenter.default.publisher(for:Notification.Name("RoyalPushError"))){store.deviceStatus=$0.object as? String ?? "تعذر تسجيل APNs"}.onChange(of:phase){_,next in if next == .background { store.lock() }}}}
}
extension Color {
    init(royalHex:String){let value=UInt64(royalHex.trimmingCharacters(in:CharacterSet(charactersIn:"#")),radix:16) ?? 0xD3AD80;self.init(red:Double((value>>16)&255)/255,green:Double((value>>8)&255)/255,blue:Double(value&255)/255)}
 static let royalGold=Color(red:0.83,green:0.68,blue:0.49);static let royalGreen=Color(red:0.08,green:0.24,blue:0.20) }
struct RoyalRoot:View {
    @EnvironmentObject var store:RoyalStore
    @Environment(\.scenePhase) private var phase
    private let timer=Timer.publish(every:5,on:.main,in:.common).autoconnect()
    private var tabs:[String]{var values=store.preferences.sections.filter{["orders","loyalty","products","management"].contains($0)};for v in ["orders","loyalty","products","management"] where !values.contains(v){values.append(v)};return values}
    var body:some View{
        Group {
            if store.user != nil && !store.locked {
                TabView {ForEach(tabs,id:\.self){tab in
                    switch tab {
                    case "orders":OrdersView().tabItem{Label("الطلبات",systemImage:"square.grid.2x2")}
                    case "loyalty":LoyaltyView().tabItem{Label("الولاء",systemImage:"qrcode.viewfinder")}
                    case "products":ProductsView().tabItem{Label("المخزون",systemImage:"cup.and.saucer")}
                    default:ManagementView().tabItem{Label("الإدارة",systemImage:"slider.horizontal.3")}
                    }
                }}.symbolVariant(store.preferences.icons=="filled" ? .fill:.none)
            } else {RoyalLogin()}
        }.scrollContentBackground(.hidden).background(store.background)
        .onReceive(timer){_ in if phase == .active {Task{await store.refresh()}}}
    }
}
struct RoyalLogin:View{
    @EnvironmentObject var store:RoyalStore
    @State private var username=""
    @State private var password=""
    var body:some View{NavigationStack{ScrollView{VStack(alignment:.leading,spacing:25){Image(systemName:"crown").font(.system(size:50)).foregroundStyle(store.accent);Text("COFFEE ROYAL\nMANAGER").font(.system(size:30,weight:.semibold,design:.serif));Text("الطلبات، الفريق، وكل تفاصيل القهوة.").foregroundStyle(.secondary);TextField("اسم المستخدم",text:$username).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled();SecureField("كلمة المرور",text:$password).textContentType(.password);Button{Task{await store.login(username:username,password:password);password=""}}label:{HStack{Text("تسجيل الدخول");Spacer();if store.busy{ProgressView()}else{Image(systemName:"arrow.left")}}}.buttonStyle(.borderedProminent).disabled(store.busy||password.isEmpty);if store.savedSession{Button{Task{await store.unlock()}}label:{Label("فتح الجلسة بـ Face ID أو رمز الجهاز",systemImage:"faceid")}};if !store.error.isEmpty{Text(store.error).font(.caption).foregroundStyle(.red)};Text("اتصال مشفر بنفس قاعدة بيانات الموقع. لا تُحفظ كلمة المرور داخل التطبيق.").font(.caption).foregroundStyle(.secondary)}.textFieldStyle(.roundedBorder).padding(30)}.navigationTitle("أهلًا بالمدير")}}
}
