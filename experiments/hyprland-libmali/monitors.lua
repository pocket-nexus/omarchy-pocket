-- RG DS Plus: two 1024x768 DSI panels, DSI-1 on top, DSI-2 below.
-- See https://wiki.hypr.land/Configuring/Basics/Monitors/
hl.monitor({ output = "DSI-1", mode = "1024x768@60.2", position = "0x0", scale = 1 })
hl.monitor({ output = "DSI-2", mode = "1024x768@60.2", position = "0x768", scale = 1 })

-- GTK draws at this whole-number scale (see Omarchy's default monitors.lua).
hl.env("GDK_SCALE", "1")

hl.config({
  -- The VOP2 display controller rejects atomic commits that carry the cursor plane.
  cursor = { no_hardware_cursors = 1 },
})
