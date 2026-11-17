import SwiftUI
struct ReportSchedule:Decodable,Identifiable {
    let id:String;let name:String;let period:String;let branch_id:String;let enabled:Int;let next_due:Double
}
struct ReportSnapshot:Decodable,Identifiable {
    let id:String;let name:String;let period:String;let period_key:String;let created_at:Double
}
struct PeriodicReportsView:View {
    @EnvironmentObject var store:RoyalStore
    @State private var schedules:[ReportSchedule]=[]
    @State private var snapshots:[ReportSnapshot]=[]
    @State private var name=""
    @State private var period="weekly"
    @State private var busy=false
    @State private var export:URL?
    var body:some View {
        List {
            Section("جدول جديد") {
                TextField("اسم التقرير",text:$name)
                Picker("الدورية",selection:$period){Text("يومي").tag("daily");Text("أسبوعي").tag("weekly");Text("شهري").tag("monthly")}
                Button("إضافة تقرير لكل الفروع"){Task{await create()}}.disabled(name.trimmingCharacters(in:.whitespaces).count<2 || schedules.count>=3 || busy)
                Text("عن الفترة المكتملة السابقة. بعد ٨ صباحًا بتوقيت البحرين خلال دورة المزامنة التالية. ٣ جداول للحساب، وحفظ النسخ ٩٠ يومًا.").font(.caption).foregroundStyle(.secondary)
            }
            Section("الجداول") {
                ForEach(schedules){s in
                    VStack(alignment:.leading,spacing:8){
                        Text(s.name).bold();Text(s.enabled==1 ? "مفعّل":"متوقف").font(.caption)
                        Text("الموعد التالي: \(Date(timeIntervalSince1970:s.next_due).formatted())").font(.caption)
                        Button("إنشاء تقرير الفترة السابقة الآن"){Task{busy=true;_=await store.action("report-run",["id":s.id]);await load();busy=false}}.disabled(busy || s.enabled==0)
                        Button(s.enabled==1 ? "إيقاف الجدول":"تشغيل الجدول"){Task{busy=true;_=await store.action("report-schedules",["id":s.id,"name":s.name,"period":s.period,"branch_id":s.branch_id,"enabled":s.enabled==0]);await load();busy=false}}.disabled(busy)
                    }
                }
            }
            Section("النسخ المحفوظة") {
                ForEach(snapshots){s in VStack(alignment:.leading){Text(s.name);Text(s.period_key).font(.caption);Button("تصدير Excel"){Task{await download(s.id)}}.disabled(busy)}}
                if let export{ShareLink(item:export){Label("مشاركة آخر ملف",systemImage:"square.and.arrow.up")}}
            }
            if !store.error.isEmpty{Text(store.error).foregroundStyle(.red)}
        }.navigationTitle("تقارير دورية").task{await load()}.refreshable{await load()}
    }
    private func load() async {
        do{
            struct Schedules:Decodable{let schedules:[ReportSchedule]}
            struct Snapshots:Decodable{let snapshots:[ReportSnapshot]}
            schedules=try JSONDecoder().decode(Schedules.self,from:await store.call("admin/report-schedules")).schedules
            snapshots=try JSONDecoder().decode(Snapshots.self,from:await store.call("admin/report-snapshots")).snapshots
        }catch{store.error=error.localizedDescription}
    }
    private func create() async {
        busy=true;defer{busy=false}
        if await store.action("report-schedules",["name":name,"period":period,"branch_id":"","enabled":true]){name="";await load()}
    }
    private func download(_ id:String) async {
        busy=true;defer{busy=false}
        do{let data=try await store.call("admin/report-snapshot?id="+id+"&format=xlsx"),url=FileManager.default.temporaryDirectory.appendingPathComponent("CoffeeRoyal-periodic-"+id+".xlsx");try data.write(to:url,options:.atomic);export=url}catch{store.error=error.localizedDescription}
    }
}
