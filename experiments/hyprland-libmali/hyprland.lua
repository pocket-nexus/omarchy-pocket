-- GPU spike: both DSI panels stacked like a DS, one terminal.
hl.monitor({ output = "DSI-1", mode = "preferred", position = "0x0", scale = 1 })
hl.monitor({ output = "DSI-2", mode = "preferred", position = "0x768", scale = 1 })

hl.on("hyprland.start", function()
  hl.exec_cmd("foot")
end)

hl.config({
  debug = { enable_stdout_logs = true, disable_logs = false },
  -- VOP2 rejects the atomic commit that carries the cursor plane
  cursor = { no_hardware_cursors = 1 },
})
