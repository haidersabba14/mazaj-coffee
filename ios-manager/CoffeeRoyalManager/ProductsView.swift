import SwiftUI
struct ProductsView: View {
    @EnvironmentObject var store: RoyalStore
    @State private var editing: RoyalProduct?
    @State private var adding = false
    var body: some View {
        NavigationStack {
            List {
                if !store.error.isEmpty { Text(store.error).foregroundStyle(.red) }
                ForEach(store.data?.products ?? []) { product in
                    HStack(spacing: 14) {
                        AsyncImage(url: URL(string: product.image, relativeTo: royalBase)) { image in
                            image.resizable().scaledToFill()
                        } placeholder: { Color.royalGreen }
                            .frame(width: 62, height: 62).clipShape(RoundedRectangle(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 7) {
                            Text(product.name).font(.headline)
                            Text("\(product.available == 1 ? "متاح" : "مخفي") · المخزون: \(product.stock < 0 ? "غير محدود" : String(product.stock))")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if store.owner { Button("تعديل") { editing = product } }
                    }
                }
            }
            .navigationTitle("المشروبات والمخزون")
            .refreshable { await store.refresh() }
            .toolbar { if store.owner { Button { adding = true } label: { Image(systemName: "plus") } } }
            .sheet(item: $editing) { ProductEditor(product: $0) }
            .sheet(isPresented: $adding) { ProductEditor(product: nil) }
        }
    }
}
struct ProductEditor:View{
    @EnvironmentObject var store:RoyalStore
    @Environment(\.dismiss) private var dismiss
    let product:RoyalProduct?
    @State private var name="";@State private var description="";@State private var image="";@State private var category="hot";@State private var available=true;@State private var stock = -1
    var body:some View{NavigationStack{Form{Section("بيانات المشروب"){TextField("الاسم",text:$name);TextField("الوصف",text:$description,axis:.vertical);TextField("رابط الصورة HTTPS",text:$image).textInputAutocapitalization(.never).keyboardType(.URL);Picker("القسم",selection:$category){Text("ساخن").tag("hot");Text("بارد").tag("cold");Text("مميز").tag("signature")};Toggle("متاح للطلب",isOn:$available)};Section("المخزون"){TextField("عدد الأكواب (-1 غير محدود)",value:$stock,format:.number).keyboardType(.numbersAndPunctuation);Text("يُخصم المخزون عند حفظ الطلب ويُعاد عند الإلغاء مرة واحدة.").font(.caption).foregroundStyle(.secondary)};if !store.error.isEmpty{Text(store.error).foregroundStyle(.red)};Button("حفظ التغييرات"){Task{let id=product?.id ?? UUID().uuidString.lowercased();if await store.action("product",["id":id,"name":name,"description":description,"image":image,"category":category,"available":available]){if await store.action("stock",["id":id,"stock":stock]){dismiss()}}}}.disabled(store.busy||name.count<2||description.isEmpty)}.navigationTitle(product==nil ? "مشروب جديد":"تعديل المشروب").toolbar{Button("إغلاق"){dismiss()}}.onAppear{name=product?.name ?? "";description=product?.description ?? "";image=product?.image ?? "/images/cappuccino.webp";category=product?.category ?? "hot";available=product?.available != 0;stock=product?.stock ?? -1}}}
}
