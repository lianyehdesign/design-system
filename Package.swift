// swift-tools-version: 5.9
import PackageDescription

// iOS 端透過 Swift Package Manager 直接指向這個 repo 使用:
//   https://github.com/lianyehdesign/design-system
// 匯入後即可 import DesignTokens，使用 DesignTokens.colorPrimary060 等常數。
let package = Package(
  name: "DesignTokens",
  platforms: [.iOS(.v15), .macOS(.v12)],
  products: [
    .library(name: "DesignTokens", targets: ["DesignTokens"])
  ],
  targets: [
    .target(name: "DesignTokens", path: "platform/ios")
  ]
)
