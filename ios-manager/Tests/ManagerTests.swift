import XCTest
@testable import CoffeeRoyalManager
final class ManagerTests:XCTestCase{
    func testTerminalOrdersCannotBeReopened(){XCTAssertTrue(Stage.delivered.next.isEmpty);XCTAssertTrue(Stage.cancelled.next.isEmpty);XCTAssertFalse(Stage.new.next.contains(.ready));XCTAssertTrue(Stage.preparing.next.contains(.ready))}
    func testPreferencesDecodeServerDefaults()throws{let p=try JSONDecoder().decode(RoyalPreferences.self,from:Data("{}".utf8));XCTAssertTrue(p.sound);XCTAssertEqual(p.theme,"dark");XCTAssertEqual(p.volume,0.65)}
    func testProviderAcceptanceIsNotAcknowledgement(){XCTAssertEqual(notificationTitle("sent"),"قبله مزوّد الإشعارات");XCTAssertFalse(notificationTitle("sent").contains("استلم"))}
}
extension ManagerTests{
    func testExtendedPreferencesRemainCompatible()throws{
        let json=Data(#"{"theme":"system","font":"serif","background":"coffee","icons":"filled","sections":["products","orders","management"],"shortcuts":["ready","accepted"],"metrics":["weekly","daily"]}"#.utf8)
        let p=try JSONDecoder().decode(RoyalPreferences.self,from:json)
        XCTAssertEqual(p.font,"serif");XCTAssertEqual(p.metrics,["weekly","daily"]);XCTAssertEqual(p.sections.first,"products")
        let encoded=try JSONEncoder().encode(p);let restored=try JSONDecoder().decode(RoyalPreferences.self,from:encoded);XCTAssertEqual(restored.icons,"filled")
    }
}
extension ManagerTests{
    func testCustomerCallAndCancellationFollowShortcutOrder(){
        var p=RoyalPreferences();p.shortcuts=["call","cancelled","delivered"]
        XCTAssertEqual(p.actions(for:"ready"),["call","cancelled","delivered"])
        XCTAssertTrue(p.actions(for:"delivered").isEmpty)
        XCTAssertTrue(p.actions(for:"cancelled").isEmpty)
    }
}
