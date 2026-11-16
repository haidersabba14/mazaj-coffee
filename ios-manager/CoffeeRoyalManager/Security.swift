import Foundation
import Security
import LocalAuthentication

// Only the session cookie is kept. The password and APNs keys are never stored in the app.
enum SessionVault {
    private static let service = "com.coffeeroyal.manager.session"
    static func save(_ value: String) {
        clear()
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"session",kSecValueData as String:Data(value.utf8),kSecAttrAccessible as String:kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        SecItemAdd(query as CFDictionary,nil)
    }
    static func read() -> String? {
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrAccount as String:"session",kSecReturnData as String:true,kSecMatchLimit as String:kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary,&result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data:data,encoding:.utf8)
    }
    static func clear() { SecItemDelete([kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service] as CFDictionary) }
    static func unlock() async -> Bool {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication,error:&error) else { return false }
        return (try? await context.evaluatePolicy(.deviceOwnerAuthentication,localizedReason:"فتح لوحة إدارة المقهى بأمان")) ?? false
    }
}
