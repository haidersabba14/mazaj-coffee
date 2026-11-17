import Foundation
import SwiftUI
import AVFoundation
import UserNotifications
import UIKit

let royalBase = URL(string:"https://mazaj-cafe-995.pages.dev")!
struct APIError: LocalizedError { let message: String; var errorDescription: String? { message } }
struct ErrorReply: Decodable { let error: String }

@MainActor final class RoyalStore: ObservableObject {
    @Published var user: RoyalUser?
    @Published var data: RoyalData?
    @Published var error = ""
    @Published var notice = ""
    @Published var needsSecondFactor = false
    @Published var busy = false
    @Published var locked = true
    @Published var preferences = RoyalPreferences()
    @Published var query = ""
    @Published var status = ""
    @Published var card: LoyaltyCard?
    @Published var team: [RoyalStaff] = []
    @Published var deviceStatus = "إشعارات الخلفية تحتاج توقيع Apple وإعداد APNs."
    private var cookie: String?
    private var seen = Set<String>()
    private var loaded = false
    private var stampEvent: String?
    private var stampNumber = ""
    private var audio = AVAudioEngine()
    private var player = AVAudioPlayerNode()
    private var soundReady = false
    private let session = URLSession(configuration:.ephemeral)
    var accent:Color { Color(royalHex:preferences.accent) }
    var background:Color { if preferences.theme=="system" {return Color(uiColor:.systemGroupedBackground)};return preferences.theme == "light" ? Color(royalHex:"#F6F3EB") : Color(royalHex:preferences.background == "coffee" ? "#211A17":preferences.background == "charcoal" ? "#16191D":"#101F1B") }
    var fontDesign:Font.Design { preferences.font == "serif" ? .serif:preferences.font == "rounded" ? .rounded:.default }
    var owner: Bool { user?.role == "owner" }
    var savedSession: Bool { SessionVault.read() != nil }

    func call(_ path: String, body: [String:Any]? = nil) async throws -> Data {
        guard let url = URL(string:"api/"+path,relativeTo:royalBase)?.absoluteURL else { throw APIError(message:"عنوان غير صالح") }
        var req = URLRequest(url:url,cachePolicy:.reloadIgnoringLocalCacheData,timeoutInterval:20)
        req.setValue(royalBase.absoluteString.trimmingCharacters(in:CharacterSet(charactersIn:"/")),forHTTPHeaderField:"Origin")
        req.setValue("application/json",forHTTPHeaderField:"Accept")
        if let cookie { req.setValue(cookie,forHTTPHeaderField:"Cookie") }
        if let body { req.httpMethod="POST";req.setValue("application/json",forHTTPHeaderField:"Content-Type");req.httpBody=try JSONSerialization.data(withJSONObject:body) }
        let (data,response) = try await session.data(for:req)
        guard let http = response as? HTTPURLResponse else { throw APIError(message:"تعذر الاتصال") }
        if http.statusCode==428 {needsSecondFactor=true}
        if http.statusCode==401 { user=nil;locked=true;cookie=nil;SessionVault.clear() }
        guard (200...299).contains(http.statusCode) else { throw APIError(message:(try? JSONDecoder().decode(ErrorReply.self,from:data).error) ?? "تعذر إتمام العملية") }
        if let value=http.value(forHTTPHeaderField:"Set-Cookie"),let first=value.components(separatedBy:";").first, first.hasPrefix("session=") { cookie=first;SessionVault.save(first) }
        return data
    }
    func uploadImage(_ data:Data) async throws -> String {
        guard data.count<=200*1024 else {throw APIError(message:"حجم الصورة أكبر من الحد")}
        var req=URLRequest(url:royalBase.appendingPathComponent("api/admin/images"));req.httpMethod="POST";req.httpBody=data;req.setValue("image/jpeg",forHTTPHeaderField:"Content-Type");req.setValue(royalBase.absoluteString.trimmingCharacters(in:CharacterSet(charactersIn:"/")),forHTTPHeaderField:"Origin");if let cookie{req.setValue(cookie,forHTTPHeaderField:"Cookie")}
        let(body,response)=try await session.data(for:req);guard let http=response as? HTTPURLResponse,(200...299).contains(http.statusCode) else{throw APIError(message:(try? JSONDecoder().decode(ErrorReply.self,from:body).error) ?? "تعذر رفع الصورة")};struct Reply:Decodable{let url:String};return try JSONDecoder().decode(Reply.self,from:body).url
    }
    func downloadReport(_ query:String) async throws -> URL {
        let data=try await call("admin/export?format=xlsx&"+query);let file=FileManager.default.temporaryDirectory.appendingPathComponent("CoffeeRoyal-Report.xlsx");try data.write(to:file,options:.atomic);return file
    }
    func login(username: String,password: String,otp:String="",backupCode:String="") async {
        guard !busy else { return };busy=true;error="";defer{busy=false}
        do { _=try await call("login",body:["username":username,"password":password,"otp":otp,"backup_code":backupCode,"device_name":UIDevice.current.name+" · iOS"]);locked=false;try await load();try await loadPreferences();needsSecondFactor=false }
        catch { self.error=error.localizedDescription }
    }
    func unlock() async {
        guard savedSession,await SessionVault.unlock() else { error="تعذر فتح الجلسة. يمكنك تسجيل الدخول بكلمة المرور.";return }
        cookie=SessionVault.read();locked=false
        do { try await load();try await loadPreferences();needsSecondFactor=false }catch{self.error=error.localizedDescription;locked=true}
    }
    func lock() { if user != nil { locked=true } }
    private func load() async throws {
        let path="admin/data?q="+(query.addingPercentEncoding(withAllowedCharacters:.urlQueryAllowed) ?? "")+"&status="+status
        let result=try JSONDecoder().decode(RoyalData.self,from:await call(path))
        let arrivals=result.orders.filter { !seen.contains($0.id) && $0.status=="new" }
        if loaded && !arrivals.isEmpty { notice="☕ وصل \(arrivals.count) طلب جديد بانتظار القبول"; playSound(urgent:arrivals.contains{$0.priority==2}) }
        seen.formUnion(result.orders.map(\.id));loaded=true;data=result;user=result.user
        if owner { struct StaffReply:Decodable{let staff:[RoyalStaff]};team=(try? JSONDecoder().decode(StaffReply.self,from:await call("admin/staff")).staff) ?? [] }
    }
    func refresh() async { guard !busy,!locked,user != nil else{return};busy=true;defer{busy=false};do{try await load();error=""}catch{self.error=error.localizedDescription} }
    @discardableResult func action(_ endpoint:String,_ body:[String:Any]) async -> Bool {
        guard !busy else{return false};busy=true;error="";defer{busy=false}
        do{_=try await call("admin/"+endpoint,body:body);try await load();return true}catch{self.error=error.localizedDescription;return false}
    }
    func transition(_ order:RoyalOrder,_ stage:Stage,eta:Int=15,reason:String="") async {
        _=await action("status",["id":order.id,"status":stage.rawValue,"eta_minutes":eta,"version":order.version,"reason":reason])
    }
    func loadPreferences() async throws { struct Reply:Decodable{let settings:RoyalPreferences};preferences=try JSONDecoder().decode(Reply.self,from:await call("admin/preferences")).settings }
    func savePreferences() async {
        do{let encoded=try JSONEncoder().encode(preferences);let object=try JSONSerialization.jsonObject(with:encoded);_=try await call("admin/preferences",body:["settings":object]);notice="تمت مزامنة الإعدادات"}catch{self.error=error.localizedDescription}
    }
    func stamp(_ number:String) async {
        guard !busy else{return};busy=true;error="";defer{busy=false}
        do{
            let cleaned=number.replacingOccurrences(of:"MAZAJ:",with:"").trimmingCharacters(in:.whitespacesAndNewlines)
            guard cleaned.range(of:"^[0-9]{7}$",options:.regularExpression) != nil else { throw APIError(message:"رقم بطاقة غير صالح") }
            let found=try JSONDecoder().decode(LoyaltyCard.self,from:await call("admin/cards?number="+cleaned))
            if stampNumber != cleaned || stampEvent == nil { stampEvent=UUID().uuidString.lowercased();stampNumber=cleaned }
            card=try JSONDecoder().decode(LoyaltyCard.self,from:await call("admin/stamp",body:["id":found.id,"event_id":stampEvent!]))
            stampEvent=nil;notice="أُضيف ختم واحد للبطاقة";playSound()
        }catch{self.error=error.localizedDescription}
    }
    func registerPush(_ token:String) async {
        guard user != nil,!locked else{return}
        do{_=try await call("admin/device",body:["token":token]);deviceStatus="تم ربط الجهاز بخدمة APNs."}catch{deviceStatus=error.localizedDescription}
    }
    func askNotifications() async {
        do{let allowed=try await UNUserNotificationCenter.current().requestAuthorization(options:[.alert,.sound,.badge]);if allowed { UIApplication.shared.registerForRemoteNotifications();deviceStatus="طُلب تسجيل الجهاز. النسخة غير الموقعة لا تدعم APNs قبل توقيعها." }else{deviceStatus="الإشعارات مرفوضة من إعدادات الجهاز."}}catch{deviceStatus=error.localizedDescription}
    }
    func playSound(urgent:Bool=false) {
        guard preferences.sound else{return}
        do {
            // ambient respects the system silent switch and other apps' audio.
            try AVAudioSession.sharedInstance().setCategory(.ambient,mode:.default);try AVAudioSession.sharedInstance().setActive(true)
            if !soundReady { audio.attach(player);audio.connect(player,to:audio.mainMixerNode,format:AVAudioFormat(standardFormatWithSampleRate:44100,channels:1));soundReady=true }
            if !audio.isRunning { try audio.start() }
            let notes:[Double]=urgent ? [880,1174,880,1174] : preferences.tone=="bell" ? [660,880] : preferences.tone=="bright" ? [880,1174,1318] : [523,659,784]
            let frames=AVAudioFrameCount(Double(notes.count)*0.25*44100)
            guard let format=AVAudioFormat(standardFormatWithSampleRate:44100,channels:1),let buffer=AVAudioPCMBuffer(pcmFormat:format,frameCapacity:frames),let samples=buffer.floatChannelData?[0] else{return}
            buffer.frameLength=frames
            for i in 0..<Int(frames){let t=Double(i)/44100;let note=Int(t/0.25);let phase=t-Double(note)*0.25;let envelope=min(1,phase*100)*exp(-phase*16);samples[i]=Float(sin(2*Double.pi*notes[min(note,notes.count-1)]*t)*envelope*0.3*preferences.volume)}
            player.scheduleBuffer(buffer);player.play();if preferences.vibration{UINotificationFeedbackGenerator().notificationOccurred(.success)}
        }catch{self.error="تعذر تشغيل الصوت؛ التنبيه المرئي يعمل."}
    }
    func logout() async { do{_=try await call("admin/logout",body:[:])}catch{self.error=error.localizedDescription};cookie=nil;user=nil;data=nil;locked=true;SessionVault.clear();seen=[];loaded=false;session.reset{} }
}
