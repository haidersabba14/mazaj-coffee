import SwiftUI
struct ManagementView:View{
    @EnvironmentObject var store:RoyalStore
    var body:some View{NavigationStack{List{
        Section("الحساب"){Text(store.user?.name ?? "");Text(store.owner ? "مالك":"موظف").foregroundStyle(.secondary);Button("تفعيل إشعارات الخلفية"){Task{await store.askNotifications()}};Text(store.deviceStatus).font(.caption).foregroundStyle(.secondary)}
        Section("المظهر والصوت"){Picker("المظهر",selection:$store.preferences.theme){Text("ليلي").tag("dark");Text("نهاري").tag("light")};Picker("البطاقات",selection:$store.preferences.cards){Text("عادي").tag("normal");Text("مدمج").tag("compact");Text("دائري").tag("rounded")};Picker("النغمة",selection:$store.preferences.tone){Text("ملكي").tag("royal");Text("جرس").tag("bell")};Toggle("الصوت داخل التطبيق",isOn:$store.preferences.sound);Toggle("الاهتزاز",isOn:$store.preferences.vibration);Slider(value:$store.preferences.volume,in:0...1){Text("مستوى صوت التطبيق")};Button("تجربة الصوت"){store.playSound()};Button("حفظ ومزامنة التخصيص"){Task{await store.savePreferences()}};Text("إعدادات الصوت هنا تخص التطبيق المفتوح. تنبيهات النظام تخضع للصامت والتركيز وإعدادات iOS.").font(.caption).foregroundStyle(.secondary)}
        Section("متابعة العمليات"){NavigationLink("مركز الإشعارات"){NotificationsView()};NavigationLink("الأجهزة والجلسات"){SessionsView()};if store.owner{NavigationLink("التشغيل وساعات العمل"){OperationsSettingsView()};NavigationLink("الفريق والصلاحيات"){TeamView()};NavigationLink("سجل العمليات"){AuditView()};NavigationLink("الإحصائيات والتقارير"){ReportsView()}}}
        if !store.error.isEmpty{Section{Text(store.error).foregroundStyle(.red)}}
        Section{Text("الإصدار \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "3.0.0") · بناء \(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "3")").font(.caption);Text("اتصال آمن بقاعدة البيانات السحابية. تحديث كل ٥ ثوانٍ أثناء فتح التطبيق.").font(.caption).foregroundStyle(.secondary);Button("قفل الإدارة الآن"){store.lock()};Button("تسجيل الخروج",role:.destructive){Task{await store.logout()}}}
    }.navigationTitle("الإدارة")}}
}
struct OperationsSettingsView:View{
    @EnvironmentObject var store:RoyalStore
    @State private var accepting=true;@State private var opening=15;@State private var closing=24;@State private var busy=false;@State private var maintenance=false;@State private var auto=false;@State private var capacity=30;@State private var brand="COFFEE ROYAL"
    var body:some View{Form{Section("المقهى"){TextField("الاسم التجاري",text:$brand);Toggle("استقبال الطلبات",isOn:$accepting);Stepper("الفتح: \(opening):00 بتوقيت البحرين",value:$opening,in:0...23);Stepper("الإغلاق: \(closing):00",value:$closing,in:1...24);Stepper("سعة الطلبات النشطة: \(capacity)",value:$capacity,in:1...200)};Section("التشغيل"){Toggle("وضع مشغول — نصف السعة",isOn:$busy);Toggle("وضع الصيانة",isOn:$maintenance);Toggle("قبول تلقائي ضمن السعة",isOn:$auto)};Button("حفظ الإعدادات"){Task{if await store.action("settings",["accepting":accepting,"opening_hour":opening]){_=await store.action("operations-settings",["busy_mode":busy,"maintenance":maintenance,"auto_accept":auto,"capacity":capacity,"brand_name":brand,"closing_hour":closing])}}}.disabled(store.busy);if !store.error.isEmpty{Text(store.error).foregroundStyle(.red)};Text("لكل فرع ساعات مستقلة، تُدار من اللوحة السحابية. هذه الساعات عامة ويجب أن يكون الفرع أيضًا مفتوحًا.").font(.caption)}.navigationTitle("التشغيل").onAppear{if let s=store.data?.settings{accepting=s.accepting==1;opening=s.opening_hour;closing=s.closing_hour;busy=s.busy_mode==1;maintenance=s.maintenance==1;auto=s.auto_accept==1;capacity=s.capacity;brand=s.brand_name}}}
}
struct TeamView:View{
    @EnvironmentObject var store:RoyalStore
    @State private var adding=false;@State private var editing:RoyalStaff?
    var body:some View{List{ForEach(store.team){s in Button{editing=s}label:{VStack(alignment:.leading){Text(s.name);Text("\(s.username) · \(s.role=="owner" ? "مالك":"موظف") · \(s.active==1 ? "مفعّل":"موقوف")").font(.caption).foregroundStyle(.secondary)}}}}.navigationTitle("الفريق").toolbar{Button{adding=true}label:{Image(systemName:"plus")}}.sheet(isPresented:$adding){StaffEditor(staff:nil)}.sheet(item:$editing){StaffEditor(staff:$0)}}
}
struct StaffEditor:View{
    @EnvironmentObject var store:RoyalStore
    @Environment(\.dismiss) private var dismiss
    let staff:RoyalStaff?
    @State private var name="";@State private var username="";@State private var password="";@State private var role="staff";@State private var active=true
    var body:some View{NavigationStack{Form{TextField("الاسم",text:$name);TextField("اسم المستخدم بالإنجليزية",text:$username).textInputAutocapitalization(.never).autocorrectionDisabled();SecureField(staff==nil ? "كلمة مرور — ١٠ أحرف على الأقل":"كلمة مرور جديدة (اختياري)",text:$password);Picker("الصلاحية",selection:$role){Text("موظف").tag("staff");Text("مالك").tag("owner")};Toggle("حساب مفعّل",isOn:$active);Button("حفظ وإلغاء جلساته السابقة"){Task{var b:[String:Any]=["name":name,"username":username,"password":password,"role":role,"active":active];if let staff{b["id"]=staff.id};if await store.action("staff",b){dismiss()}}}.disabled(store.busy||name.count<2||username.count<3);if !store.error.isEmpty{Text(store.error).foregroundStyle(.red)}}.navigationTitle(staff==nil ? "حساب جديد":"تعديل الحساب").toolbar{Button("إغلاق"){dismiss()}}.onAppear{name=staff?.name ?? "";username=staff?.username ?? "";role=staff?.role ?? "staff";active=staff?.active != 0}}}
}
struct NotificationsView:View{
    @EnvironmentObject var store:RoyalStore
    @State private var jobs:[PushJob]=[]
    var body:some View{List{Section{Text("قبول المزوّد للإشعار لا يؤكد وصوله للجهاز. تأكيد الزبون يظهر داخل الطلب.").font(.caption)};ForEach(jobs){j in VStack(alignment:.leading,spacing:8){Text(j.order_id.flatMap{id in store.data?.orders.first{$0.id==id}?.number} ?? "طلب مؤرشف");Text(notificationTitle(j.state));Text("\(j.kind) · \(j.attempts)/4").font(.caption).foregroundStyle(.secondary);if ["failed","retry","unconfigured","no_subscription"].contains(j.state)&&j.attempts<4{Button("إعادة المحاولة"){Task{_=await store.action("notification-retry",["id":j.id]);await load()}}}}}.navigationTitle("الإشعارات").task{await load()}.refreshable{await load()}}
    private func load() async{do{struct Reply:Decodable{let jobs:[PushJob]};jobs=try JSONDecoder().decode(Reply.self,from:await store.call("admin/notifications")).jobs}catch{store.error=error.localizedDescription}}
}
struct SessionsView:View{
    @EnvironmentObject var store:RoyalStore
    @State private var sessions:[DeviceSession]=[]
    var body:some View{List{ForEach(sessions){s in VStack(alignment:.leading){Text(s.device_name);Text("تنتهي: "+Date(timeIntervalSince1970:s.expires).formatted()).font(.caption)}};Button("تسجيل الخروج من الأجهزة الأخرى",role:.destructive){Task{_=await store.action("revoke-sessions",[:]);await load()}}}.navigationTitle("الأجهزة").task{await load()}}
    private func load() async{do{struct Reply:Decodable{let sessions:[DeviceSession]};sessions=try JSONDecoder().decode(Reply.self,from:await store.call("admin/sessions")).sessions}catch{store.error=error.localizedDescription}}
}
struct AuditView:View{
    @EnvironmentObject var store:RoyalStore
    @State private var events:[AuditEvent]=[]
    var body:some View{List(events){a in VStack(alignment:.leading,spacing:7){Text(a.action);Text(a.user_name).font(.caption);Text(Date(timeIntervalSince1970:a.created_at),style:.date).font(.caption2).foregroundStyle(.secondary)}}.navigationTitle("سجل العمليات").task{do{struct Reply:Decodable{let events:[AuditEvent]};events=try JSONDecoder().decode(Reply.self,from:await store.call("admin/audit")).events}catch{store.error=error.localizedDescription}}}
}
struct ReportsView:View{
    @EnvironmentObject var store:RoyalStore
    var body:some View{List{Section("الطلبات"){LabeledContent("اليوم",value:String(store.data?.stats.daily ?? 0));LabeledContent("آخر ٧ أيام",value:String(store.data?.stats.weekly ?? 0))};Section("الأكثر طلبًا"){ForEach(store.data?.popular ?? [],id:\.name){p in LabeledContent(p.name,value:String(p.quantity))}};Section{Text("تقارير زمن التحضير والانتظار وتصدير CSV متاحة في اللوحة السحابية المحمية.").font(.caption)}}.navigationTitle("الإحصائيات")}
}
