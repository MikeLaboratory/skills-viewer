// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SkillsViewer",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "SkillsViewer", targets: ["SkillsViewer"])
    ],
    targets: [
        .executableTarget(name: "SkillsViewer")
    ]
)
