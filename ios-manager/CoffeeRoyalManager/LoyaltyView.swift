import SwiftUI
import VisionKit
struct LoyaltyView:View{
    @EnvironmentObject var store:RoyalStore
    @State private var number=""
    @State private var scanning=false
    var body:some View{NavigationStack{Form{Section("ختم بطاقة الزبون"){TextField("رقم البطاقة",text:$number).keyboardType(.numberPad);Button("مسح QR وإضافة ختم"){scanning=true}.disabled(store.busy);Button("إضافة ختم للرقم"){Task{await store.stamp(number)}}.disabled(number.isEmpty||store.busy)};if let card=store.card{Section("البطاقة"){Text(card.name).font(.title2);Text(card.card_number).monospaced();Text("الختمات: \(card.stamps) / ٥");Text("مشروبات المكافأة: \(card.reward_drinks)").foregroundStyle(Color.royalGold)}};if !store.notice.isEmpty{Text(store.notice).foregroundStyle(.green)};if !store.error.isEmpty{Text(store.error).foregroundStyle(.red)};Section{Text("خمس ختمات تمنح مشروبين. لا يحصل الزبون على ختم من الموقع؛ الإضافة من الإدارة فقط. لا تعِد مسح البطاقة لنفس الزيارة.").font(.caption)}}.navigationTitle("الولاء").sheet(isPresented:$scanning){if DataScannerViewController.isSupported&&DataScannerViewController.isAvailable{RoyalScanner{raw in scanning=false;number=raw;Task{await store.stamp(raw)}}.ignoresSafeArea()}else{ContentUnavailableView("الكاميرا غير متاحة",systemImage:"camera",description:Text("أدخل رقم البطاقة يدويًا أو اسمح بالكاميرا في إعدادات الجهاز."))}}}}
}
struct RoyalScanner:UIViewControllerRepresentable{
    let onCode:(String)->Void
    func makeCoordinator()->Coordinator{Coordinator(onCode:onCode)}
    func makeUIViewController(context:Context)->DataScannerViewController{let vc=DataScannerViewController(recognizedDataTypes:[.barcode(symbologies:[.qr])],qualityLevel:.balanced,recognizesMultipleItems:false,isHighFrameRateTrackingEnabled:false,isPinchToZoomEnabled:true,isGuidanceEnabled:true,isHighlightingEnabled:true);vc.delegate=context.coordinator;try? vc.startScanning();return vc}
    func updateUIViewController(_ vc:DataScannerViewController,context:Context){}
    static func dismantleUIViewController(_ vc:DataScannerViewController,coordinator:Coordinator){vc.stopScanning()}
    class Coordinator:NSObject,DataScannerViewControllerDelegate{let onCode:(String)->Void;var handled=false;init(onCode:@escaping(String)->Void){self.onCode=onCode};func dataScanner(_ scanner:DataScannerViewController,didAdd addedItems:[RecognizedItem],allItems:[RecognizedItem]){guard !handled else{return};for item in addedItems{if case .barcode(let barcode)=item,let raw=barcode.payloadStringValue,raw.hasPrefix("MAZAJ:"){handled=true;scanner.stopScanning();onCode(raw);return}}}}
}
