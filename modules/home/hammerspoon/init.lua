local settings = require("settings")

require("hotkeys").setup()
require("fellow").setup()
require("windows").setup()
require("mail").setup(settings.mail)
require("draw").setup()

hs.alert.show("Hammerspoon ready", 0.3)
