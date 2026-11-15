// Disegna l'icona dell'app in un PNG 1024×1024: due schede sovrapposte, una del colore di Claude
// e una di quello di Codex, con le stesse righe (le stesse skill) e un segno di spunta: allineate.
// Uso: swift Scripts/make-icon.swift Resources/AppIcon.png
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.png"
let size = 1024
guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
                                 bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                 colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { exit(1) }
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

func rgb(_ hex: Int, _ a: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
            blue: CGFloat(hex & 255) / 255, alpha: a)
}

// quadrato arrotondato secondo la griglia delle icone macOS (824 px, margine 100)
let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
let tilePath = NSBezierPath(roundedRect: tile, xRadius: 186, yRadius: 186)

NSGraphicsContext.saveGraphicsState()
let drop = NSShadow()
drop.shadowColor = rgb(0x000000, 0.45)
drop.shadowOffset = NSSize(width: 0, height: -14)
drop.shadowBlurRadius = 30
drop.set()
rgb(0xf6f6f4).setFill()
tilePath.fill()
NSGraphicsContext.restoreGraphicsState()

NSGraphicsContext.saveGraphicsState()
tilePath.addClip()
NSGradient(colors: [rgb(0xfdfdfb), rgb(0xeeede8)])!.draw(in: tile, angle: -90)
NSGraphicsContext.restoreGraphicsState()

// una scheda con le righe delle skill
func card(_ rect: NSRect, color: NSColor, angle: CGFloat) {
    NSGraphicsContext.saveGraphicsState()
    let t = NSAffineTransform()
    t.translateX(by: rect.midX, yBy: rect.midY)
    t.rotate(byDegrees: angle)
    t.translateX(by: -rect.midX, yBy: -rect.midY)
    t.concat()
    let path = NSBezierPath(roundedRect: rect, xRadius: 56, yRadius: 56)
    NSGraphicsContext.saveGraphicsState()
    let s = NSShadow()
    s.shadowColor = rgb(0x000000, 0.22)
    s.shadowOffset = NSSize(width: 0, height: -10)
    s.shadowBlurRadius = 28
    s.set()
    color.setFill()
    path.fill()
    NSGraphicsContext.restoreGraphicsState()
    NSGraphicsContext.saveGraphicsState()
    path.addClip()
    NSGradient(colors: [color.blended(withFraction: 0.15, of: .white)!, color.blended(withFraction: 0.12, of: .black)!])!
        .draw(in: rect, angle: -90)
    NSGraphicsContext.restoreGraphicsState()
    // righe
    rgb(0xffffff, 0.85).setFill()
    let widths: [CGFloat] = [0.70, 0.52, 0.62, 0.44]
    for (i, w) in widths.enumerated() {
        let y = rect.maxY - 110 - CGFloat(i) * 78
        NSBezierPath(roundedRect: NSRect(x: rect.minX + 60, y: y, width: (rect.width - 120) * w, height: 30),
                     xRadius: 15, yRadius: 15).fill()
    }
    NSGraphicsContext.restoreGraphicsState()
}

card(NSRect(x: 190, y: 270, width: 400, height: 500), color: rgb(0xc8643a), angle: 7)   // Claude
card(NSRect(x: 420, y: 230, width: 400, height: 500), color: rgb(0x2d5fa8), angle: -6)  // Codex

// spunta verde: le due schede sono allineate
let badge = NSRect(x: 600, y: 170, width: 250, height: 250)
NSGraphicsContext.saveGraphicsState()
let bs = NSShadow()
bs.shadowColor = rgb(0x000000, 0.28)
bs.shadowOffset = NSSize(width: 0, height: -8)
bs.shadowBlurRadius = 22
bs.set()
rgb(0x1f9d61).setFill()
NSBezierPath(ovalIn: badge).fill()
NSGraphicsContext.restoreGraphicsState()
rgb(0xffffff).setStroke()
let tick = NSBezierPath()
tick.move(to: NSPoint(x: badge.minX + 68, y: badge.midY + 2))
tick.line(to: NSPoint(x: badge.minX + 108, y: badge.midY - 40))
tick.line(to: NSPoint(x: badge.maxX - 62, y: badge.midY + 46))
tick.lineWidth = 30
tick.lineCapStyle = .round
tick.lineJoinStyle = .round
tick.stroke()

// bordo sottile per staccare dal Dock chiaro
NSGraphicsContext.saveGraphicsState()
tilePath.addClip()
rgb(0x000000, 0.08).setStroke()
let rim = NSBezierPath(roundedRect: tile.insetBy(dx: 1.5, dy: 1.5), xRadius: 185, yRadius: 185)
rim.lineWidth = 3
rim.stroke()
NSGraphicsContext.restoreGraphicsState()

NSGraphicsContext.restoreGraphicsState()
guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: URL(fileURLWithPath: out))
print("Icona disegnata: \(out)")
