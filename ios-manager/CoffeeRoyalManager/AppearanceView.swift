import SwiftUI
struct AppearanceView:View{
    @EnvironmentObject var store:RoyalStore
    private let sectionNames=["orders":"الطلبات","loyalty":"الولاء","products":"المشروبات","management":"الإدارة"]
    private let metricNames=["daily":"اليوم","weekly":"الأسبوع","waiting":"الانتظار","preparing":"التحضير","ready":"الجاهز"]
    private let shortcutNames=["accepted":"قبول","preparing":"تحضير","ready":"جاهز واستدعاء","delivered":"تسليم","cancelled":"إلغاء","call":"استدعاء"]
    @State private var accent=Color.royalGold
    var body:some View{
        Form{
            Section("ثيمات جاهزة"){HStack{Button("ملكي"){preset("dark","forest","#D3AD80")};Button("عاجي"){preset("light","forest","#946C43")};Button("إسبريسو"){preset("dark","coffee","#D6AA82")}}}
            Section("الألوان والمظهر"){
                ColorPicker("لون التطبيق",selection:$accent,supportsOpacity:false).onChange(of:accent){_,value in store.preferences.accent=hex(value)}
                Picker("المظهر",selection:$store.preferences.theme){Text("ليلي").tag("dark");Text("نهاري").tag("light");Text("حسب الجهاز").tag("system")}
                Picker("الخلفية",selection:$store.preferences.background){Text("أخضر ملكي").tag("forest");Text("فحمي").tag("charcoal");Text("قهوة").tag("coffee")}
                Picker("الخط",selection:$store.preferences.font){Text("عصري").tag("system");Text("تقليدي").tag("serif");Text("ناعم").tag("rounded")}
                Picker("الأيقونات",selection:$store.preferences.icons){Text("خطية").tag("outline");Text("ممتلئة").tag("filled")}
                Picker("البطاقات",selection:$store.preferences.cards){Text("عادي").tag("normal");Text("مدمج").tag("compact");Text("دائري").tag("rounded")}
            }
            Section("ترتيب تبويبات التطبيق"){ForEach(store.preferences.sections.filter{sectionNames[$0] != nil},id:\.self){key in moveRow(key,names:sectionNames,path:\.sections)}}
            Section("ترتيب الإحصائيات"){ForEach(store.preferences.metrics,id:\.self){key in moveRow(key,names:metricNames,path:\.metrics)};ForEach(metricNames.keys.sorted().filter{!store.preferences.metrics.contains($0)},id:\.self){key in Button("إضافة "+metricNames[key]!){store.preferences.metrics.append(key)}}}
            Section("ترتيب إجراءات الطلب"){ForEach(store.preferences.shortcuts,id:\.self){key in moveRow(key,names:shortcutNames,path:\.shortcuts)}}
            Section("الصوت"){Toggle("تفعيل الصوت",isOn:$store.preferences.sound);Toggle("اهتزاز",isOn:$store.preferences.vibration);Picker("النغمة",selection:$store.preferences.tone){Text("ملكي").tag("royal");Text("جرس").tag("bell");Text("واضح").tag("bright")};Slider(value:$store.preferences.volume,in:0...1);Button("تجربة النغمة"){store.playSound()};Text("صوت النظام في الخلفية يُدار من إعدادات iOS.").font(.caption)}
            Section{Button("حفظ ومزامنة لحسابي"){Task{await store.savePreferences()}};Button("تحديث التخصيص من السحابة"){Task{do{try await store.loadPreferences();accent=store.accent}catch{store.error=error.localizedDescription}}};if !store.error.isEmpty{Text(store.error).foregroundStyle(.red)}}
        }.navigationTitle("محرر الإدارة").onAppear{accent=store.accent;for key in ["orders","loyalty","products","management"] where !store.preferences.sections.contains(key){store.preferences.sections.append(key)}}
    }
    private func moveRow(_ key:String,names:[String:String],path:WritableKeyPath<RoyalPreferences,[String]>)->some View{HStack{Text(names[key] ?? key);Spacer();Button{move(key,path:path,delta:-1)}label:{Image(systemName:"arrow.up")}.buttonStyle(.borderless);Button{move(key,path:path,delta:1)}label:{Image(systemName:"arrow.down")}.buttonStyle(.borderless)}}
    private func move(_ key:String,path:WritableKeyPath<RoyalPreferences,[String]>,delta:Int){var values=store.preferences[keyPath:path];guard let index=values.firstIndex(of:key),values.indices.contains(index+delta)else{return};values.swapAt(index,index+delta);store.preferences[keyPath:path]=values}
    private func preset(_ theme:String,_ background:String,_ color:String){store.preferences.theme=theme;store.preferences.background=background;store.preferences.accent=color;accent=store.accent}
    private func hex(_ color:Color)->String{var r:CGFloat=0,g:CGFloat=0,b:CGFloat=0,a:CGFloat=0;UIColor(color).getRed(&r,green:&g,blue:&b,alpha:&a);return String(format:"#%02X%02X%02X",Int(r*255),Int(g*255),Int(b*255))}
}
