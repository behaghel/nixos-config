
#!/bin/bash
# Dark theme configuration for all terminals and applications

# Terminal color scheme preferences
export TERM_THEME="dark"
export COLORTERM="truecolor"

# GTK applications (including some terminals)
export GTK_THEME="Adwaita:dark"

# Qt applications
export QT_STYLE_OVERRIDE="Adwaita-dark"

# For applications that respect XDG color scheme
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"

# Some terminals check these specific variables
export DARK_MODE=1
export THEME="dark"

# ls colors for dark backgrounds
export LS_COLORS="di=34:ln=35:so=32:pi=33:ex=31:bd=34;46:cd=34;43:su=30;41:sg=30;46:tw=30;42:ow=30;43"
