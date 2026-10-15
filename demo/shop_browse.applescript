-- Browser scene for demo-recorder (kind: live): a person using the deployed
-- shop. Mirrors demo-recorder/config/fixtures/chat_demo.applescript.
--
--   osascript demo/shop_browse.applescript "$(pulumi -C infra/pulumi stack output shopUrl)"
--
-- Needs Accessibility permission for the app running osascript (typing goes
-- through System Events) plus Screen Recording for the capture itself.

on typeSlowly(msg)
	tell application "System Events"
		repeat with c in characters of msg
			keystroke c
			delay 0.07
		end repeat
	end tell
end typeSlowly

on clickAt(x, y)
	tell application "System Events" to tell process "Safari" to click at {x, y}
end clickAt

on run argv
	set shopURL to item 1 of argv

	-- Launch Safari and wait until it is up; "make new document" right after
	-- a cold start fails with -600 (application isn't running).
	tell application "Safari" to launch
	repeat until application "Safari" is running
		delay 0.2
	end repeat
	delay 1
	tell application "Safari"
		activate
		-- A cold launch can open an empty window of its own; close only
		-- windows with no page loaded (never the presenter's own tabs).
		repeat with w in (every window)
			set u to missing value
			try
				set u to URL of current tab of w
			end try
			if u is missing value or u is "" or u starts with "favorites:" then close w
		end repeat
		make new document with properties {URL:shopURL}
		-- Fixed 16:9 window (1280x720 pt); segments.shopfront.json crops to
		-- these bounds x2 for Retina.
		set bounds of front window to {100, 60, 1380, 780}
	end tell
	-- The first load over the ALB takes several seconds; the segment's trim
	-- cuts this lead-in.
	delay 9

	-- Click targets are screen points: window origin (100, 60) + Safari's
	-- 52 pt toolbar + the element's centre in a 1280x668 viewport (measured
	-- with Playwright against the live shop).
	-- The first click only focuses the web view; the second focuses the box.
	my clickAt(1138, 222) -- search box
	delay 0.4
	my clickAt(1138, 222)
	delay 0.6
	my typeSlowly("candle")
	delay 2.5
	my clickAt(368, 443) -- first result
	delay 3.5
	my clickAt(813, 377) -- Add to cart
	delay 2
	my clickAt(1203, 142) -- Cart
	delay 3.5
end run
