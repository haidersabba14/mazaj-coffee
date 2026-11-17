import SwiftUI
import UniformTypeIdentifiers

struct BranchDay:Decodable,Identifiable {
    let branch_id:String;let weekday:Int;var opening_minute:Int;var closing_minute:Int;var closed:Int
    var id:Int{weekday}
    init(branch:String,weekday:Int,opening:Int,closing:Int){branch_id=branch;self.weekday=weekday;opening_minute=opening;closing_minute=closing;closed=0}
}
struct PlanningSettingsView:View {
    @EnvironmentObject var store:RoyalStore
    @State private var branches:[RoyalBranch]=[]
    @State private var branch=""
    @State private var hours:[BranchDay]=[]
    @State private var days:[BranchDay]=[]
    @State private var capacity=8
    @State private var advance=7
    private let names=["الأحد","الإثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"]
    var body:some View {
        Form {
            Section("الجدولة") {
                Stepper("سعة الموعد: \(capacity)",value:$capacity,in:1...50)
                Stepper("الأيام المتاحة: \(advance)",value:$advance,in:1...7)
                Button("حفظ سعة الجدولة"){Task{_=await store.action("schedule-settings",["slot_capacity":capacity,"schedule_days":advance])}}
                Text("كل موعد ربع ساعة. المكونات تُحجز عند الطلب، والتحضير يمنعه الخادم قبل وقته.").font(.caption)
            }
            Section("ساعات الفرع") {
                Picker("الفرع",selection:$branch){ForEach(branches){Text($0.name).tag($0.id)}}.onChange(of:branch){_,_ in fill()}
                ForEach($days){$day in
                    VStack(alignment:.leading,spacing:8){Text(names[day.weekday]).font(.headline);Toggle("مغلق",isOn:Binding(get:{day.closed==1},set:{day.closed=$0 ? 1:0}));Stepper("الفتح \(clock(day.opening_minute))",value:$day.opening_minute,in:0...1425,step:15);Stepper("الإغلاق \(clock(day.closing_minute))",value:$day.closing_minute,in:15...1440,step:15)}.padding(.vertical,5)
                }
                Button("حفظ أيام الفرع"){Task{await saveHours()}}.disabled(days.count != 7 || days.contains{$0.closing_minute<=$0.opening_minute})
                Text("الأوقات بتوقيت البحرين، وتُقاطع مع الساعات العامة للمقهى.").font(.caption)
            }
            if !store.error.isEmpty{Text(store.error).foregroundStyle(.red)}
        }.navigationTitle("المواعيد والفروع").task{capacity=store.data?.settings.slot_capacity ?? 8;advance=store.data?.settings.schedule_days ?? 7;await load()}
    }
    private func clock(_ minute:Int)->String{String(format:"%02d:%02d",minute/60,minute%60)}
    private func fill(){guard let b=branches.first(where:{$0.id==branch})else{return};days=(0..<7).map{i in hours.first(where:{$0.branch_id==branch && $0.weekday==i}) ?? BranchDay(branch:branch,weekday:i,opening:b.opening_hour*60,closing:b.closing_hour*60)}}
    private func load() async {do{struct B:Decodable{let branches:[RoyalBranch]};struct H:Decodable{let hours:[BranchDay]};branches=try JSONDecoder().decode(B.self,from:await store.call("admin/branches")).branches;hours=try JSONDecoder().decode(H.self,from:await store.call("admin/branch-hours")).hours;if branch.isEmpty{branch=branches.first?.id ?? ""};fill()}catch{store.error=error.localizedDescription}}
    private func saveHours() async{let payload=days.map{["weekday":$0.weekday,"opening_minute":$0.opening_minute,"closing_minute":$0.closing_minute,"closed":$0.closed==1] as [String:Any]};if await store.action("branch-hours",["branch_id":branch,"days":payload]){await load()}}
}
struct ProductSeasonView:View {
    @EnvironmentObject var store:RoyalStore
    let product:RoyalProduct
    @State private var start=Date();@State private var end=Date().addingTimeInterval(7*86400)
    @State private var hasStart=false;@State private var hasEnd=false;@State private var featured=false;@State private var label="";@State private var prep=10
    var body:some View {
        Form {
            Section(product.name){Toggle("بداية محددة",isOn:$hasStart);if hasStart{DatePicker("البداية",selection:$start)};Toggle("نهاية محددة",isOn:$hasEnd);if hasEnd{DatePicker("النهاية",selection:$end)};TextField("عنوان الموسم",text:$label);Toggle("مشروب المقهى المميز",isOn:$featured);Stepper("التحضير: \(prep) دقيقة",value:$prep,in:1...120)}
            Button("حفظ الموسم"){Task{let payload:[String:Any]=["id":product.id,"available_from":hasStart ? Int(start.timeIntervalSince1970) as Any:NSNull(),"available_until":hasEnd ? Int(end.timeIntervalSince1970) as Any:NSNull(),"seasonal_label":label,"featured":featured,"prep_minutes":prep];_=await store.action("product-season",payload)}}.disabled(store.busy || (hasStart&&hasEnd&&end<=start))
            if !store.error.isEmpty{Text(store.error).foregroundStyle(.red)}
        }.navigationTitle("الموسم والتحضير").onAppear{hasStart=product.available_from != nil;hasEnd=product.available_until != nil;start=Date(timeIntervalSince1970:product.available_from ?? Date().timeIntervalSince1970);end=Date(timeIntervalSince1970:product.available_until ?? Date().addingTimeInterval(7*86400).timeIntervalSince1970);label=product.seasonal_label ?? "";featured=product.featured==1;prep=product.prep_minutes}
    }
}
struct RestorePreview:Decodable {let id:String;let summary:[String:Int];let active_orders:Int;let mode:String}
struct RestoreSettingsView:View {
    @EnvironmentObject var store:RoyalStore
    @State private var importing=false;@State private var preview:RestorePreview?;@State private var confirm=""
    var body:some View {
        Form {
            Section("استعادة تشغيلية"){Text("دمج منتجات وفروع ومكونات ووصفات وإعدادات، دون حذف العملاء أو الطلبات. ملف SQL الكامل يُدار في Cloudflare.").font(.caption);Button("اختيار نسخة JSON"){importing=true}}
            if let preview {
                Section("المعاينة"){ForEach(preview.summary.keys.sorted(),id:\.self){key in LabeledContent(key,value:String(preview.summary[key] ?? 0))};Text("طلبات نشطة: \(preview.active_orders)");Text(preview.mode).font(.caption);TextField("اكتب استعادة الإعدادات",text:$confirm);Button("تطبيق الاستعادة",role:.destructive){Task{do{_=try await store.call("admin/restore-apply",body:["id":preview.id,"confirm":confirm]);self.preview=nil;confirm="";store.notice="تم دمج الإعدادات";await store.refresh()}catch{store.error=error.localizedDescription}}}.disabled(confirm != "استعادة الإعدادات" || preview.active_orders>0 || store.busy)}
            }
            if !store.error.isEmpty{Text(store.error).foregroundStyle(.red)}
        }.navigationTitle("النسخ والاستعادة").fileImporter(isPresented:$importing,allowedContentTypes:[.json]){result in
            Task{do{let url=try result.get(),access=url.startAccessingSecurityScopedResource();defer{if access{url.stopAccessingSecurityScopedResource()}};let data=try Data(contentsOf:url);guard data.count<=4*1024*1024,let full=try JSONSerialization.jsonObject(with:data) as? [String:Any],let source=full["tables"] as? [String:Any] else{throw APIError(message:"ملف غير صالح أو أكبر من ٤ ميغابايت")};let tables=source.filter{["products","settings","branches","ingredients","recipes"].contains($0.key)};preview=try JSONDecoder().decode(RestorePreview.self,from:await store.call("admin/restore-preview",body:["tables":tables]));confirm=""}catch{store.error=error.localizedDescription}}
        }
    }
}
