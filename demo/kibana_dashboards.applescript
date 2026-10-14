-- Browser scene for demo-recorder (kind: live): the two Kibana dashboards
-- Pulumi created. Safari must already be signed in to Elastic Cloud.
--
--   osascript demo/kibana_dashboards.applescript \
--     "$(pulumi -C infra/pulumi stack output kibanaDashboards --json | jq -r .agentsVsHumans)" \
--     "$(pulumi -C infra/pulumi stack output kibanaDashboards --json | jq -r .agentFriction)"
--
-- Pass only the first URL to record the Agents vs Humans dashboard alone.

on scrollDown(n)
	tell application "System Events"
		repeat n times
			key code 125 -- down arrow
			delay 0.08
		end repeat
	end tell
end scrollDown

on run argv
	set firstURL to item 1 of argv

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
		make new document with properties {URL:firstURL}
		set bounds of front window to {100, 60, 1380, 780}
	end tell
	-- Dashboards render panel by panel; give them time before moving.
	delay 9
	my scrollDown(12)
	delay 5
	my scrollDown(12)
	delay 5

	if (count of argv) > 1 then
		tell application "Safari" to set URL of front document to (item 2 of argv)
		delay 9
		my scrollDown(12)
		delay 5
		my scrollDown(14)
		delay 6
	end if
end run
