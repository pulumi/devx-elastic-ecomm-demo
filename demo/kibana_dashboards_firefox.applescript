-- Browser scene for demo-recorder (kind: live): the two Kibana dashboards
-- Pulumi created, in Firefox. Firefox must already be signed in to Elastic
-- Cloud. Same window bounds as the Safari scenes (1280x720 pt at 100,60), so
-- segments.shopfront.json crops to the same region.
--
--   osascript demo/kibana_dashboards_firefox.applescript \
--     "$(pulumi -C infra/pulumi stack output kibanaDashboards --json | jq -r .agentsVsHumans)" \
--     "$(pulumi -C infra/pulumi stack output kibanaDashboards --json | jq -r .agentFriction)"
--
-- Firefox has almost no AppleScript dictionary: the window is opened with its
-- command line (which hands off to a running instance) and placed and driven
-- through System Events, so this needs Accessibility permission.

-- Smooth wheel scroll over the page (centre of the window's content area).
-- Arrow keys don't reach Kibana's dashboard reliably; a real wheel event
-- does. The helper is compiled from smooth_scroll.swift on first use.
on scrollBy(px)
	set here to POSIX path of ((path to me as text) & "::")
	do shell script "cd " & quoted form of here & " && ([ -x .smooth_scroll ] || swiftc -O smooth_scroll.swift -o .smooth_scroll) && ./.smooth_scroll 740 460 " & px & " 1.4"
end scrollBy

on placeFrontWindow()
	tell application "System Events" to tell process "firefox"
		set frontmost to true
		set position of front window to {100, 60}
		set size of front window to {1280, 720}
	end tell
end placeFrontWindow

on run argv
	set firstURL to item 1 of argv

	do shell script "/Applications/Firefox.app/Contents/MacOS/firefox -new-window " & quoted form of firstURL & " > /dev/null 2>&1 &"
	-- Wait for the new window to exist before moving it.
	delay 3
	my placeFrontWindow()
	-- Dashboards render panel by panel; give them time before moving.
	delay 9
	my scrollBy(520)
	delay 5
	my scrollBy(520)
	delay 5

	if (count of argv) > 1 then
		do shell script "/Applications/Firefox.app/Contents/MacOS/firefox -new-tab " & quoted form of (item 2 of argv) & " > /dev/null 2>&1 &"
		delay 9
		my scrollBy(520)
		delay 5
		my scrollBy(600)
		delay 6
	end if
end run
