import SwiftUI
import MapKit

struct OrdersView:View {
    @EnvironmentObject var store:RoyalStore
    @State private var mode="orders"
    var orders:[RoyalOrder]{let all=store.data?.orders ?? [];return mode=="pickup" ? all.filter{$0.status=="ready"}:mode=="kitchen" ? all.filter{["accepted","preparing"].contains($0.status)}:all}
    var body:some View { NavigationStack {ScrollView{VStack(alignment:.leading,spacing:18){
        ScrollView(.horizontal,showsIndicators:false){HStack{ForEach(store.preferences.metrics.isEmpty ? ["daily","ready"]:store.preferences.metrics,id:\.self){key in stat(metricTitle(key),metricValue(key)).frame(minWidth:140)}}}
        Picker("طريقة العرض",selection:$mode){Text("الطلبات").tag("orders");Text("المطبخ").tag("kitchen");Text("الاستلام").tag("pickup")}.pickerStyle(.segmented)
        if !store.notice.isEmpty{Text(store.notice).font(.callout).padding().frame(maxWidth:.infinity,alignment:.leading).background(store.accent.opacity(0.12),in:RoundedRectangle(cornerRadius:12))}
        if !store.error.isEmpty{Text(store.error).font(.caption).foregroundStyle(.red)}
        if mode=="orders" { Picker("الحالة",selection:$store.status){Text("كل الحالات").tag("");ForEach(Stage.allCases){Text($0.title).tag($0.rawValue)}}.onChange(of:store.status){_,_ in Task{await store.refresh()}} }
        if orders.isEmpty{ContentUnavailableView("لا توجد طلبات",systemImage:"tray",description:Text("تظهر الطلبات المحفوظة هنا. التحديث كل ٥ ثوانٍ أثناء فتح التطبيق."))}
        LazyVStack(spacing:14){ForEach(orders){order in NavigationLink{OrderDetailView(identity:order.id,fallback:order)}label:{OrderSummary(order:order,pickup:mode=="pickup")}.buttonStyle(.plain)}}
        Text("تحديث كل ٥ ثوانٍ أثناء فتح التطبيق · أحدث ٢٠٠ نتيجة").font(.caption2).foregroundStyle(.secondary)
    }.padding()}}.navigationTitle(mode=="kitchen" ? "المطبخ":mode=="pickup" ? "الاستلام":"مركز الطلبات").searchable(text:$store.query,prompt:"الاسم أو الهاتف أو CR-1042").onSubmit(of:.search){Task{await store.refresh()}}.refreshable{await store.refresh()}.toolbar{Button{Task{await store.refresh()}}label:{Image(systemName:"arrow.clockwise")}}}
    private func metricTitle(_ key:String)->String{["daily":"طلبات اليوم","weekly":"آخر ٧ أيام","waiting":"بانتظار القبول","preparing":"قيد التحضير","ready":"جاهز للاستلام"][key] ?? key}
    private func metricValue(_ key:String)->Int{guard let s=store.data?.stats else{return 0};switch key{case "weekly":return s.weekly ?? 0;case "waiting":return s.waiting ?? 0;case "preparing":return s.preparing ?? 0;case "ready":return s.ready ?? 0;default:return s.daily ?? 0}}
    private func stat(_ title:String,_ number:Int)->some View{VStack(alignment:.leading,spacing:10){Text(title).font(.caption).foregroundStyle(.secondary);Text(String(number)).font(.largeTitle).foregroundStyle(store.accent)}.frame(maxWidth:.infinity,alignment:.leading).padding().background(Color.royalGreen.opacity(0.18),in:RoundedRectangle(cornerRadius:15))}
}
struct OrderSummary:View{
    @EnvironmentObject var store:RoyalStore
    let order:RoyalOrder;var pickup=false
    var body:some View{VStack(alignment:.leading,spacing:12){HStack{Text(order.number).font(pickup ? .largeTitle:.title2).monospaced().foregroundStyle(store.accent);Spacer();Text(Stage(rawValue:order.status)?.title ?? order.status).font(.caption)};if !pickup{Text(order.name).font(.headline);ForEach(order.items){Text("\($0.name) × \($0.quantity)").font(.callout)};if order.priority==2{Label("طلب عاجل",systemImage:"bolt.fill").font(.caption).foregroundStyle(.orange)};if order.overdue{Label("متأخر عن وقت الجاهزية المتوقع",systemImage:"exclamationmark.triangle").font(.caption).foregroundStyle(.orange)}};if order.acknowledged_at != nil{Label("أكد الزبون استلام التنبيه",systemImage:"checkmark.seal").font(.caption).foregroundStyle(.green)}else if order.called_at != nil{Label("تم الاستدعاء · بانتظار تأكيد الزبون",systemImage:"bell.badge").font(.caption)};if let scheduled=order.scheduled_at{Text("مجدول: "+Date(timeIntervalSince1970:scheduled).formatted()).font(.caption).foregroundStyle(store.accent)};if order.arrived_at != nil{Label("وصل الزبون بالسيارة",systemImage:"car.fill").font(.caption)};Text(Date(timeIntervalSince1970:order.created_at),style:.time).font(.caption2).foregroundStyle(.secondary)}.padding(store.preferences.cards=="compact" ? 12:19).frame(maxWidth:.infinity,alignment:.leading).background(Color.royalGreen.opacity(0.15),in:RoundedRectangle(cornerRadius:store.preferences.cards=="rounded" ? 25:13)).overlay(RoundedRectangle(cornerRadius:13).stroke(order.overdue ? Color.orange.opacity(0.5):Color.secondary.opacity(0.15)))}
}
struct OrderDetailView:View{
    @EnvironmentObject var store:RoyalStore
    let identity:String;let fallback:RoyalOrder
    @State private var eta=15
    @State private var reason=""
    @State private var rejecting=false
    @State private var message=""
    @State private var priority=0
    @State private var assignee=""
    var order:RoyalOrder{store.data?.orders.first{$0.id==identity} ?? fallback}
    var body:some View{Form{Section{Text(order.number).font(.system(size:44,weight:.medium,design:.serif)).foregroundStyle(store.accent);Text(order.name).font(.title2);Link(order.phone,destination:URL(string:"tel:"+order.phone.filter{$0.isNumber||$0=="+"})!);Text(Stage(rawValue:order.status)?.title ?? order.status)}
        if let group=order.group_label{Section("مجموعة الاستلام"){Text(group)}};Section("المشروبات"){ForEach(order.items){Text("\($0.name) × \($0.quantity)")};if let options=order.customization {ForEach(options.keys.sorted(),id:\.self){key in HStack{Text(optionKey(key));Spacer();Text(optionValue(options[key] ?? "")).foregroundStyle(.secondary)}}};if !order.notes.isEmpty{Text(order.notes)};Text("الإجمالي: مجاني · 0.000 د.ب.")}
        Section("الاستلام"){Text(order.fulfillment=="delivery" ? "توصيل للبيت":order.fulfillment=="curbside" ? "استلام من السيارة":"استلام من المقهى");if let car=order.car_description,!car.isEmpty{Text(car)};if let arrived=order.arrived_at{Text("وصل الزبون: "+Date(timeIntervalSince1970:arrived).formatted())};if let scheduled=order.scheduled_at{Text("موعد الطلب: "+Date(timeIntervalSince1970:scheduled).formatted())};if let address=order.address,!address.isEmpty{Text(address)};if let lat=order.location_lat,let lng=order.location_lng{Map(initialPosition:.region(MKCoordinateRegion(center:CLLocationCoordinate2D(latitude:lat,longitude:lng),span:MKCoordinateSpan(latitudeDelta:0.015,longitudeDelta:0.015)))){Marker("موقع الزبون",coordinate:CLLocationCoordinate2D(latitude:lat,longitude:lng))}.frame(height:210);Link("فتح في الخرائط",destination:URL(string:"https://maps.apple.com/?ll=\(lat),\(lng)")!)}}
        Section("التحضير والاستدعاء"){
            if ["new","accepted"].contains(order.status){Stepper("التجهيز خلال \(eta) دقيقة",value:$eta,in:1...120)}
            ForEach(store.preferences.actions(for:order.status),id:\.self){key in
                Button(role:key=="cancelled" ? .destructive:nil){
                    if key=="cancelled" {rejecting=true}
                    else {Task{if key=="call" {_=await store.action("call",["id":order.id])}else if let stage=Stage(rawValue:key){await store.transition(order,stage,eta:eta)}}}
                }label:{Text(["accepted":"قبول الطلب","preparing":"بدء التحضير","ready":"🔔 جاهز — نادِ الزبون","delivered":"تم التسليم","cancelled":"إلغاء أو رفض الطلب","call":"نادِ الزبون"][key] ?? key)}.disabled(store.busy || (key=="preparing" && (order.preparation_due_at ?? 0)>Date().timeIntervalSince1970))
            }
            if let reason=order.rejection_reason,!reason.isEmpty{Text(reason).foregroundStyle(.red)}
        }
        Section("حالة التنبيه"){if order.notification_permission=="denied"{Label("الزبون رفض صلاحية الإشعارات",systemImage:"bell.slash").foregroundStyle(.orange)};Text(order.called_at==nil ? "لم يتم الاستدعاء":"تم تسجيل الاستدعاء");if let job=order.notification{Text(notificationTitle(job.state));Text("المحاولات: \(job.attempts) / ٤").font(.caption)};if let ack=order.acknowledged_at{Text("أكد الزبون التنبيه: "+Date(timeIntervalSince1970:ack).formatted(date:.omitted,time:.shortened)).foregroundStyle(.green)}else{Text("لم يؤكد الزبون استلام التنبيه بعد.").foregroundStyle(.secondary)};Text("قبول مزوّد الإشعارات لا يثبت وصول التنبيه للجهاز.").font(.caption2).foregroundStyle(.secondary)}
        Section("التخصيص والأولوية"){Picker("الأولوية",selection:$priority){Text("عادي").tag(0);Text("مهم").tag(1);Text("عاجل").tag(2)};Picker("الموظف",selection:$assignee){Text("غير مخصص").tag("");Text("المالك").tag("owner");ForEach(store.team){Text($0.name).tag($0.id)}};Button("حفظ التخصيص"){Task{_=await store.action("queue",["id":order.id,"priority":priority,"position":order.queue_position,"assigned_to":assignee])}}}
        Section("رسالة متعلقة بالطلب"){TextField("رسالتك للزبون",text:$message);Button("إرسال الرسالة"){Task{if await store.action("message",["id":order.id,"message":message]){message=""}}}.disabled(message.isEmpty||store.busy)}
        if !store.error.isEmpty{Section{Text(store.error).foregroundStyle(.red)}}
    }.navigationTitle(order.number).onAppear{priority=order.priority;assignee=order.assigned_to ?? ""}.alert("سبب الإلغاء",isPresented:$rejecting){TextField("السبب الظاهر للزبون",text:$reason);Button("تأكيد الإلغاء",role:.destructive){Task{await store.transition(order,.cancelled,reason:reason.isEmpty ? "نعتذر، تعذر تجهيز الطلب":reason)}};Button("رجوع",role:.cancel){}}}
    private func optionKey(_ key:String)->String{["temperature":"الحرارة","milk":"الحليب","sugar":"السكر","size":"الحجم","strength":"قوة القهوة"][key] ?? key}
    private func optionValue(_ key:String)->String{["hot":"حار","cold":"بارد","whole":"كامل الدسم","none":"بدون","light":"خفيف","normal":"عادي","extra":"زيادة","medium":"وسط","small":"صغير","strong":"قوي"][key] ?? key}
}
