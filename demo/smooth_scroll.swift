// Smoothly scrolls whatever is under the given screen point, for the demo's
// browser scenes (AppleScript has no scroll-wheel command).
//
//   smooth_scroll <x> <y> <pixels> <seconds>    (positive pixels scroll down)
import CoreGraphics
import Foundation

let a = CommandLine.arguments
guard a.count == 5, let x = Double(a[1]), let y = Double(a[2]), let px = Double(a[3]), let secs = Double(a[4]) else {
    FileHandle.standardError.write("usage: smooth_scroll <x> <y> <pixels> <seconds>\n".data(using: .utf8)!)
    exit(2)
}
CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(150_000)
let steps = max(1, Int(secs * 60))
var done = 0.0
for i in 1...steps {
    // Ease in/out so the motion reads as a person scrolling.
    let t = Double(i) / Double(steps)
    let target = px * (0.5 - 0.5 * cos(Double.pi * t))
    let delta = Int32((target - done).rounded())
    done += Double(delta)
    CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: -delta, wheel2: 0, wheel3: 0)?.post(tap: .cghidEventTap)
    usleep(useconds_t(secs / Double(steps) * 1_000_000))
}
