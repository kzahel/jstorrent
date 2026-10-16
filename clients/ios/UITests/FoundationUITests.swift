import XCTest

final class ProductSurfaceUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLibraryAddAndSettingsNavigation() {
        let app = XCUIApplication()
        app.launchArguments.append("--ui-testing")
        app.launch()
        waitUntilReady(app)

        XCTAssertEqual(
            app.descendants(matching: .any)["product-name"].firstMatch.label,
            "JSTorrent"
        )
        XCTAssertEqual(app.staticTexts["torrent-list-empty"].label, "No torrents")

        app.buttons["add-torrent"].tap()
        XCTAssertTrue(app.navigationBars["Add Torrent"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["magnet-input"].exists)
        app.swipeUp()
        XCTAssertTrue(app.buttons["browse-torrent"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.firstMatch.tap()

        app.buttons["open-settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["choose-download-folder"].exists)
        XCTAssertTrue(app.descendants(matching: .any)["storage-root-ios-documents"].exists)
        XCTAssertFalse(app.switches["Prevent sleep while downloading"].exists)
    }

    func testDarkAccessibilityTextAndLandscapeRemainNavigable() {
        let app = XCUIApplication()
        app.launchArguments += [
            "--ui-testing",
            "-AppleInterfaceStyle", "Dark",
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge",
        ]
        app.launch()
        waitUntilReady(app)

        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(app.buttons["add-torrent"].waitForExistence(timeout: 5))
        app.buttons["add-torrent"].tap()
        XCTAssertTrue(app.navigationBars["Add Torrent"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.firstMatch.tap()

        XCUIDevice.shared.orientation = .portrait
        XCTAssertTrue(app.buttons["open-settings"].waitForExistence(timeout: 5))
        app.buttons["open-settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
    }

    // Retain actual simulator screens for cross-surface visual review.
    func testBrandAuditScreens() {
        let app = XCUIApplication()
        app.launchArguments += ["--ui-testing", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        waitUntilReady(app)
        captureAuditScreen("ios-library")
        app.buttons["add-torrent"].tap()
        XCTAssertTrue(app.navigationBars["Add Torrent"].waitForExistence(timeout: 5))
        captureAuditScreen("ios-add")
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["open-settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        captureAuditScreen("ios-settings")
        app.swipeUp()
        captureAuditScreen("ios-settings-background")
    }

    private func captureAuditScreen(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func waitUntilReady(_ app: XCUIApplication) {
        let ready = NSPredicate(format: "label == %@", "Ready")
        expectation(for: ready, evaluatedWith: app.staticTexts["Ready"])
        waitForExpectations(timeout: 30)
    }
}

final class LocalizationUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
    }

    func testExpandedPseudoLocaleKeepsAddAndSettingsReachable() {
        let app = launchExpandedPseudoLocale()
        let empty = app.staticTexts["torrent-list-empty"]
        XCTAssertTrue(empty.waitForExistence(timeout: 30))
        XCTAssertNotEqual(empty.label, "No torrents")
        XCTAssertFalse(empty.label.contains("torrent_list_empty"))

        app.buttons["add-torrent"].tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["add-torrent-sheet"].waitForExistence(timeout: 5)
        )
        XCTAssertTrue(app.textFields["magnet-input"].exists)
        app.swipeUp()
        XCTAssertTrue(app.buttons["browse-torrent"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["browse-torrent"].isHittable)
        app.navigationBars.buttons.firstMatch.tap()

        app.buttons["open-settings"].tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["settings-screen"].waitForExistence(timeout: 5)
        )
        scrollToSettingsElement(
            app.descendants(matching: .any)["storage-root-ios-documents"].firstMatch,
            in: app,
            requireHittable: false
        )
        scrollToSettingsElement(app.switches["background-notifications"], in: app)
    }

    func testMirroredPseudoLocaleMirrorsTopBarWithoutRawKeys() {
        let app = launchMirroredPseudoLocale()
        let empty = app.staticTexts["torrent-list-empty"]
        XCTAssertTrue(empty.waitForExistence(timeout: 30))
        XCTAssertFalse(empty.label.contains("torrent_list_empty"))

        let settings = app.buttons["open-settings"]
        let add = app.buttons["add-torrent"]
        XCTAssertTrue(settings.exists)
        XCTAssertTrue(add.exists)
        XCTAssertGreaterThan(settings.frame.minX, add.frame.minX)

        add.tap()
        XCTAssertTrue(app.textFields["magnet-input"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["magnet-input"].placeholderValue?.contains("dialog_") ?? true)
        app.navigationBars.buttons.firstMatch.tap()
        settings.tap()
        XCTAssertTrue(
            app.descendants(matching: .any)["settings-screen"].waitForExistence(timeout: 5)
        )
        scrollToSettingsElement(app.switches["background-notifications"], in: app)
    }

    private func scrollToSettingsElement(
        _ element: XCUIElement,
        in app: XCUIApplication,
        requireHittable: Bool = true,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        // SwiftUI Form materializes lower rows as they scroll into view.
        // Added sections and expanded text can move these below the fold.
        for _ in 0..<12 {
            if element.exists && (!requireHittable || element.isHittable) { return }
            app.swipeUp()
        }
        XCTAssertTrue(
            element.exists && (!requireHittable || element.isHittable), file: file, line: line
        )
    }

    private func launchExpandedPseudoLocale() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += [
            "--ui-testing",
            "-AppleLanguages", "(en)",
            "-AppleLocale", "en_US",
            "-NSDoubleLocalizedStrings", "YES",
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityExtraExtraLarge",
        ]
        app.launch()
        return app
    }

    private func launchMirroredPseudoLocale() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += [
            "--ui-testing",
            "-AppleLanguages", "(en)",
            "-AppleLocale", "en_US",
            "-AppleTextDirection", "YES",
            "-NSForceRightToLeftWritingDirection", "YES",
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityExtraExtraLarge",
        ]
        app.launch()
        return app
    }
}
