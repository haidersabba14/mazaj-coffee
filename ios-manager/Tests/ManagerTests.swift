import XCTest
@testable import CoffeeRoyalManager
final class ManagerTests:XCTestCase{
    func testTerminalOrdersCannotBeReopened(){XCTAssertTrue(Stage.delivered.next.isEmpty);XCTAssertTrue(Stage.cancelled.next.isEmpty);XCTAssertFalse(Stage.new.next.contains(.ready));XCTAssertTrue(Stage.preparing.next.contains(.ready))}
    func testPreferencesDecodeServerDefaults()throws{let p=try JSONDecoder().decode(RoyalPreferences.self,from:Data("{}".utf8));XCTAssertTrue(p.sound);XCTAssertEqual(p.theme,"dark");XCTAssertEqual(p.volume,0.65)}
    func testProviderAcceptanceIsNotAcknowledgement(){XCTAssertEqual(notificationTitle("sent"),"قبله مزوّد الإشعارات");XCTAssertFalse(notificationTitle("sent").contains("استلم"))}
}
