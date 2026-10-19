import Foundation
import HapiClient
import Testing

@MainActor
@Suite("Image compression prefs")
struct ImageCompressionPrefsTests {

    private func makeDefaults() throws -> (UserDefaults, String) {
        let suiteName = "ImageCompressionPrefsTests-\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        return (defaults, suiteName)
    }

    @Test func defaultsMatchTheUploadPolicy() throws {
        let (defaults, suiteName) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        #expect(ImageCompressionPrefs(defaults: defaults).settings == .default)
        #expect(ImageCompressionSettings.default.enabled)
        #expect(ImageCompressionSettings.default.thresholdBytes == 1 * 1024 * 1024)
        #expect(ImageCompressionSettings.default.maxDimension == 2560)
        #expect(ImageCompressionSettings.default.jpegQuality == 0.90)
    }

    @Test func choicesRoundTripThroughUserDefaults() throws {
        let (defaults, suiteName) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let prefs = ImageCompressionPrefs(defaults: defaults)
        prefs.setEnabled(false)
        prefs.setThresholdBytes(2 * 1024 * 1024)
        prefs.setMaxDimension(4096)
        prefs.setJPEGQuality(0.70)

        #expect(ImageCompressionPrefs(defaults: defaults).settings == ImageCompressionSettings(
            enabled: false,
            thresholdBytes: 2 * 1024 * 1024,
            maxDimension: 4096,
            jpegQuality: 0.70
        ))
    }

    @Test func invalidStoredValuesFallBackToDefaults() throws {
        let (defaults, suiteName) = try makeDefaults()
        defer { defaults.removePersistentDomain(forName: suiteName) }

        defaults.set(999, forKey: ImageCompressionPrefs.thresholdBytesKey)
        defaults.set(123, forKey: ImageCompressionPrefs.maxDimensionKey)
        defaults.set(0.13, forKey: ImageCompressionPrefs.jpegQualityKey)

        #expect(ImageCompressionPrefs(defaults: defaults).settings == .default)
    }
}
