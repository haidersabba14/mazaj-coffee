import SwiftUI
import UIKit
import CoreImage.CIFilterBuiltins

struct MFAStatus:Decodable {let enabled:Bool;let remaining_backup_codes:Int}
struct MFAReply:Decodable {let secret:String?;let uri:String?;let backup_codes:[String]?}
struct MFASettingsView:View {
    @EnvironmentObject var store:RoyalStore
    @State private var status:MFAStatus?
    @State private var password=""
    @State private var otp=""
    @State private var backup=""
    @State private var secret=""
    @State private var uri=""
    @State private var codes:[String]=[]
    @State private var working=false
    var body:some View {
        Form {
            Section("حماية حساب الإدارة") {
                Text(status?.enabled == true ? "مفعلة · رموز متبقية: \(status?.remaining_backup_codes ?? 0)":"غير مفعلة")
                Text("لا تُفعّل قبل إضافة السر إلى تطبيق TOTP وتأكيد الرمز. احفظ رموز الاسترداد؛ لا تظهر مجددًا.").font(.caption).foregroundStyle(.secondary)
                SecureField("كلمة المرور الحالية",text:$password).textContentType(.password)
                TextField("رمز تطبيق المصادقة",text:$otp).keyboardType(.numberPad).textContentType(.oneTimeCode)
                SecureField("أو رمز استرداد",text:$backup)
            }
            if status?.enabled != true {
                Section {
                    Button("بدء إعداد المصادقة"){Task{await perform("setup")}}
                    if !secret.isEmpty {
                        Text(secret).font(.system(.caption,design:.monospaced)).textSelection(.enabled)
                        if let image=qrImage(uri){Image(uiImage:image).interpolation(.none).resizable().scaledToFit().frame(maxWidth:220).padding(12).background(.white)}
                        Text("أضف السر لتطبيق المصادقة وأكد الرمز خلال خمس دقائق.").font(.caption)
                        Button("تأكيد تفعيل المصادقة"){Task{await perform("confirm")}}
                    }
                }
            } else {
                Section {
                    Button("إصدار رموز استرداد جديدة"){Task{await perform("recovery")}}
                    Button("تعطيل المصادقة الثنائية",role:.destructive){Task{await perform("disable")}}
                }
            }
            if !codes.isEmpty {
                Section("احفظ الرموز الآن") {
                    Text(codes.joined(separator:"\n")).font(.system(.body,design:.monospaced)).textSelection(.enabled)
                    ShareLink(item:codes.joined(separator:"\n")){Label("حفظ رموز الاسترداد في مكان خاص",systemImage:"square.and.arrow.up")}
                    Text("رمز واحد لكل دخول. هذه ليست كلمة المرور. لا تشاركها مع أحد.").font(.caption)
                }
            }
            if !store.error.isEmpty {Text(store.error).foregroundStyle(.red)}
        }.navigationTitle("المصادقة الثنائية").disabled(working).task{await load()}.onDisappear{password="";otp="";backup="";secret="";uri="";codes=[]}
    }
    private func qrImage(_ value:String)->UIImage? {
        guard !value.isEmpty else{return nil}
        let filter=CIFilter.qrCodeGenerator();filter.message=Data(value.utf8)
        guard let output=filter.outputImage?.transformed(by:CGAffineTransform(scaleX:5,y:5)),let image=CIContext().createCGImage(output,from:output.extent) else{return nil}
        return UIImage(cgImage:image)
    }
    private func load() async {do{status=try JSONDecoder().decode(MFAStatus.self,from:await store.call("admin/mfa"))}catch{store.error=error.localizedDescription}}
    private func perform(_ endpoint:String) async {
        guard !working else{return};working=true;defer{working=false}
        do{
            let data=try await store.call("admin/mfa/"+endpoint,body:["password":password,"otp":otp,"backup_code":backup])
            let reply=try JSONDecoder().decode(MFAReply.self,from:data)
            secret=reply.secret ?? "";uri=reply.uri ?? "";codes=reply.backup_codes ?? [];otp="";backup=""
            if endpoint != "setup"{password=""};await load();store.error=""
        }catch{store.error=error.localizedDescription}
    }
}
