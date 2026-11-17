import SwiftUI
struct RoyalGiftCard:Decodable,Identifiable {let id:String;let label:String;let expires_at:Double;let revoked:Int;let redeemed_at:Double?}
struct GiftCreated:Decodable {let code:String;let drinks:Int;let expires_at:Double}
struct GiftCardsView:View {
    @EnvironmentObject var store:RoyalStore
    @State private var gifts:[RoyalGiftCard]=[]
    @State private var label="هدية المقهى"
    @State private var days=30
    @State private var code=""
    @State private var pending:RoyalGiftCard?
    @State private var working=false
    var body:some View {
        Form {
            Section("إصدار هدية") {
                TextField("العنوان",text:$label)
                Stepper("صالحة \(days) يومًا",value:$days,in:1...90)
                Text("رمز خاص لمشروبين يضافان لبطاقة العميل المرتبطة بحسابه. لا يضيف ختمات. يظهر الكود مرة واحدة.").font(.caption)
                Button("إنشاء بطاقة هدية"){Task{await create()}}.disabled(working || label.count<2)
                if !code.isEmpty {Text(code).font(.system(.caption,design:.monospaced)).textSelection(.enabled);ShareLink(item:"COFFEE ROYAL — مشروبان\n"+code+"\nhttps://mazaj-cafe-995.pages.dev/account.html"){Label("حفظ أو مشاركة الهدية الخاصة",systemImage:"square.and.arrow.up")}}
            }
            Section("بطاقات صادرة") {
                ForEach(gifts){gift in
                    VStack(alignment:.leading,spacing:8){Text(gift.label);Text(Date(timeIntervalSince1970:gift.expires_at),style:.date).font(.caption);Text(gift.redeemed_at != nil ? "استُبدلت":gift.revoked==1 ? "ملغاة":gift.expires_at<Date().timeIntervalSince1970 ? "منتهية":"متاحة").foregroundStyle(.secondary);if gift.redeemed_at==nil && gift.revoked==0{Button("إلغاء الهدية",role:.destructive){pending=gift}}}
                }
            }
            if !store.error.isEmpty{Text(store.error).foregroundStyle(.red)}
        }.navigationTitle("بطاقات الهدايا").task{await load()}.refreshable{await load()}.alert("إلغاء الهدية؟",isPresented:Binding(get:{pending != nil},set:{if !$0{pending=nil}})){Button("رجوع",role:.cancel){pending=nil};Button("إلغاء الهدية",role:.destructive){guard let gift=pending else{return};pending=nil;Task{if await store.action("gift-revoke",["id":gift.id]){await load()}}}}.onDisappear{code=""}
    }
    private func load() async{do{struct Reply:Decodable{let gifts:[RoyalGiftCard]};gifts=try JSONDecoder().decode(Reply.self,from:await store.call("admin/gifts")).gifts}catch{store.error=error.localizedDescription}}
    private func create() async{guard !working else{return};working=true;defer{working=false};do{let gift=try JSONDecoder().decode(GiftCreated.self,from:await store.call("admin/gifts",body:["label":label,"days":days]));code=gift.code;await load()}catch{store.error=error.localizedDescription}}
}
