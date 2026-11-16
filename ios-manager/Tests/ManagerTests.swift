import XCTest
import UIKit
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
extension ManagerTests{
    @MainActor func testPhotoEncoderUsesActualPixelsAndFitsServerLimit() async throws {
        let format=UIGraphicsImageRendererFormat();format.scale=1
        let image=UIGraphicsImageRenderer(size:CGSize(width:2400,height:1600),format:format).image{context in UIColor.brown.setFill();context.fill(CGRect(x:0,y:0,width:2400,height:1600))}
        let data=try XCTUnwrap(ProductPhotoEncoder.encode(image))
        let decoded=try XCTUnwrap(UIImage(data:data))
        XCTAssertLessThanOrEqual(data.count,200*1024)
        XCTAssertLessThanOrEqual(max(decoded.size.width,decoded.size.height),1000)
    }
}
