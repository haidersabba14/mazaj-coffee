import SwiftUI
struct BranchesView:View{
    @EnvironmentObject var store:RoyalStore
    @State private var branches:[RoyalBranch]=[]
    @State private var editing:RoyalBranch?;@State private var adding=false
    var body:some View{List(branches){b in Button{editing=b}label:{VStack(alignment:.leading,spacing:7){Text(b.name);Text("\(b.active==1 ? "مفعّل":"موقوف") · \(b.opening_hour):00 — \(b.closing_hour):00").font(.caption).foregroundStyle(.secondary)}}}.navigationTitle("الفروع").toolbar{Button{adding=true}label:{Image(systemName:"plus")}}.task{await load()}.refreshable{await load()}.sheet(item:$editing,onDismiss:{Task{await load()}}){BranchEditor(branch:$0)}.sheet(isPresented:$adding,onDismiss:{Task{await load()}}){BranchEditor(branch:nil)}}
    private func load() async{do{struct Reply:Decodable{let branches:[RoyalBranch]};branches=try JSONDecoder().decode(Reply.self,from:await store.call("admin/branches")).branches}catch{store.error=error.localizedDescription}}
}
struct BranchEditor:View{
    @EnvironmentObject var store:RoyalStore
    @Environment(\.dismiss) private var dismiss
    let branch:RoyalBranch?
    @State private var name="";@State private var opening=15;@State private var closing=24;@State private var active=true
    var body:some View{NavigationStack{Form{TextField("اسم الفرع",text:$name);Stepper("الفتح: \(opening):00",value:$opening,in:0...23);Stepper("الإغلاق: \(closing):00",value:$closing,in:1...24);Toggle("فرع مفعّل",isOn:$active);Text("الساعات بتوقيت البحرين. يجب أن يكون استقبال الطلبات العام مفتوحًا أيضًا.").font(.caption);Button("حفظ الفرع"){Task{if await store.action("branches",["id":branch?.id ?? UUID().uuidString.lowercased(),"name":name,"opening_hour":opening,"closing_hour":closing,"active":active]){dismiss()}}}.disabled(name.count<2||closing<=opening||store.busy);if !store.error.isEmpty{Text(store.error).foregroundStyle(.red)}}.navigationTitle(branch==nil ? "فرع جديد":"تعديل الفرع").toolbar{Button("إغلاق"){dismiss()}}.onAppear{name=branch?.name ?? "";opening=branch?.opening_hour ?? 15;closing=branch?.closing_hour ?? 24;active=branch?.active != 0}}}
}
struct IngredientsView:View{
    @EnvironmentObject var store:RoyalStore
    @State private var ingredients:[Ingredient]=[]
    @State private var editing:Ingredient?;@State private var adding=false
    var body:some View{List{Section("المكونات"){ForEach(ingredients){i in Button{editing=i}label:{VStack(alignment:.leading,spacing:7){Text(i.name);Text("المخزون: \(Double(i.stock_milli)/1000,specifier:"%.3f") \(unitTitle(i.unit))").font(.caption);if i.stock_milli<=i.reorder_level_milli&&i.active==1{Label("بلغ حد تنبيه النقص",systemImage:"exclamationmark.triangle").font(.caption).foregroundStyle(.orange)}}}};Section("وصفات المشروبات"){ForEach(store.data?.products ?? []){p in NavigationLink(p.name){RecipeEditor(product:p)}}}}}.navigationTitle("المكونات والوصفات").toolbar{Button{adding=true}label:{Image(systemName:"plus")}}.task{await load()}.refreshable{await load()}.sheet(item:$editing,onDismiss:{Task{await load()}}){IngredientEditor(ingredient:$0)}.sheet(isPresented:$adding,onDismiss:{Task{await load()}}){IngredientEditor(ingredient:nil)}}
    private func load() async{do{ingredients=try JSONDecoder().decode(IngredientsReply.self,from:await store.call("admin/ingredients")).ingredients}catch{store.error=error.localizedDescription}}
}
func unitTitle(_ unit:String)->String{["g":"غرام","ml":"مل","piece":"قطعة"][unit] ?? unit}
struct IngredientEditor:View{
    @EnvironmentObject var store:RoyalStore
    @Environment(\.dismiss) private var dismiss
    let ingredient:Ingredient?
    @State private var name="";@State private var unit="g";@State private var stock=0.0;@State private var threshold=0.0;@State private var active=true
    var body:some View{NavigationStack{Form{TextField("الاسم",text:$name);Picker("الوحدة",selection:$unit){Text("غرام").tag("g");Text("مل").tag("ml");Text("قطعة").tag("piece")};TextField("الرصيد",value:$stock,format:.number).keyboardType(.decimalPad);TextField("حد تنبيه النقص",value:$threshold,format:.number).keyboardType(.decimalPad);Toggle("مفعّل",isOn:$active);Button("حفظ المكوّن"){Task{var payload:[String:Any]=["name":name,"unit":unit,"stock_milli":Int((stock*1000).rounded()),"reorder_level_milli":Int((threshold*1000).rounded()),"active":active];if let ingredient{payload["id"]=ingredient.id};if await store.action("ingredients",payload){dismiss()}}}.disabled(name.count<2 || !stock.isFinite || !threshold.isFinite || stock<0 || threshold<0||stock>1e9||threshold>1e9||store.busy);if !store.error.isEmpty{Text(store.error).foregroundStyle(.red)}}.navigationTitle(ingredient==nil ? "مكوّن جديد":"تعديل المكوّن").toolbar{Button("إغلاق"){dismiss()}}.onAppear{name=ingredient?.name ?? "";unit=ingredient?.unit ?? "g";stock=Double(ingredient?.stock_milli ?? 0)/1000;threshold=Double(ingredient?.reorder_level_milli ?? 0)/1000;active=ingredient?.active != 0}}}
}
struct RecipeEditor:View{
    @EnvironmentObject var store:RoyalStore
    let product:RoyalProduct
    @State private var ingredients:[Ingredient]=[]
    @State private var amounts:[String:Double]=[:]
    var body:some View{Form{Section("كمية المكوّن لكل كوب"){ForEach(ingredients){i in HStack{Text(i.name+" ("+unitTitle(i.unit)+")");Spacer();TextField("0",value:Binding(get:{amounts[i.id] ?? 0},set:{amounts[i.id]=$0}),format:.number).keyboardType(.decimalPad).multilineTextAlignment(.trailing)}}};Button("حفظ الوصفة"){Task{let items=amounts.filter{$0.value>0}.map{["id":$0.key,"quantity_milli":Int(($0.value*1000).rounded())] as [String:Any]};_=await store.action("recipe",["id":product.id,"ingredients":items])}}.disabled(store.busy||amounts.values.contains{!$0.isFinite||$0<0||$0>1e6});Text("الصفر يستبعد المكوّن. الطلب يسجل الكميات الأصلية حتى لو تغيرت الوصفة لاحقًا.").font(.caption);if !store.error.isEmpty{Text(store.error).foregroundStyle(.red)}}.navigationTitle(product.name).task{do{let r=try JSONDecoder().decode(IngredientsReply.self,from:await store.call("admin/ingredients"));ingredients=r.ingredients.filter{$0.active==1};amounts=Dictionary(uniqueKeysWithValues:r.recipes.filter{$0.product_id==product.id}.map{($0.ingredient_id,Double($0.quantity_milli)/1000)})}catch{store.error=error.localizedDescription}}}
}
struct ArchivesView:View{
    @EnvironmentObject var store:RoyalStore
    @State private var orders:[ArchiveOrder]=[]
    var body:some View{List{ForEach(orders){o in VStack(alignment:.leading,spacing:10){Text("CR-\(o.order_number ?? 0)").font(.headline);Text(o.name);Text(Stage(rawValue:o.status)?.title ?? o.status).foregroundStyle(.secondary);Button("إعادة للقائمة"){Task{if await store.action("archive",["id":o.id,"archived":false]){await load()}}}}}}.navigationTitle("الأرشيف").task{await load()}.refreshable{await load()}}
    private func load() async{do{struct Reply:Decodable{let orders:[ArchiveOrder]};orders=try JSONDecoder().decode(Reply.self,from:await store.call("admin/archives")).orders}catch{store.error=error.localizedDescription}}
}
struct ReportsView:View{
    @EnvironmentObject var store:RoyalStore
    @State private var report:RoyalReport?
    @State private var from=Calendar.current.date(byAdding:.day,value:-7,to:Date()) ?? Date()
    @State private var to=Date()
    @State private var branches:[RoyalBranch]=[]
    @State private var branch=""
    @State private var file:URL?
    var body:some View{Form{
        Section("الفترة والفرع"){DatePicker("من",selection:$from,displayedComponents:.date);DatePicker("إلى",selection:$to,displayedComponents:.date);Picker("الفرع",selection:$branch){Text("جميع الفروع").tag("");ForEach(branches){Text($0.name).tag($0.id)}};Button("عرض التقرير"){Task{await load()}}}
        if let report{
            Section("الإجماليات"){LabeledContent("الطلبات",value:String(report.summary.orders));LabeledContent("الملغاة",value:String(report.summary.cancelled ?? 0));LabeledContent("متوسط الانتظار",value:minutes(report.summary.average_wait));LabeledContent("متوسط التحضير",value:minutes(report.summary.average_prep))}
            Section("أداء الموظفين"){ForEach(report.performance,id:\.employee){p in VStack(alignment:.leading,spacing:7){Text(p.employee);Text("\(p.orders) طلب · انتظار \(minutes(p.average_wait)) · تحضير \(minutes(p.average_prep))").font(.caption)}}}
            Section("المشروبات"){ForEach(report.drinks,id:\.drink){d in LabeledContent(d.drink,value:"\(d.quantity) · \(minutes(d.average_prep))")}}
            Section("ساعات الازدحام — البحرين"){ForEach(report.hourly,id:\.hour){h in LabeledContent(h.hour+":00",value:String(h.orders))}}
        }
        Section("تصدير"){Button("تجهيز ملف Excel"){Task{do{file=try await store.downloadReport(query)}catch{store.error=error.localizedDescription}}};if let file{ShareLink(item:file){Label("مشاركة تقرير Excel",systemImage:"square.and.arrow.up")}}}
        if !store.error.isEmpty{Text(store.error).foregroundStyle(.red)}
    }.navigationTitle("التقارير").task{do{struct Reply:Decodable{let branches:[RoyalBranch]};branches=try JSONDecoder().decode(Reply.self,from:await store.call("admin/branches")).branches}catch{store.error=error.localizedDescription};await load()}}
    private var query:String{let formatter=DateFormatter();formatter.locale=Locale(identifier:"en_US_POSIX");formatter.timeZone=TimeZone(identifier:"Asia/Bahrain");formatter.dateFormat="yyyy-MM-dd";var c=URLComponents();c.queryItems=[URLQueryItem(name:"from",value:formatter.string(from:from)),URLQueryItem(name:"to",value:formatter.string(from:to)),URLQueryItem(name:"branch",value:branch)];return c.percentEncodedQuery ?? ""}
    private func minutes(_ value:Double?)->String{value.map{String(format:"%.1f دقيقة",$0)} ?? "—"}
    private func load() async{do{report=try JSONDecoder().decode(RoyalReport.self,from:await store.call("admin/report?"+query))}catch{store.error=error.localizedDescription}}
}
