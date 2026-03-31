export PATH=$HOME/.local/bin:$PATH

# set PATH so it includes user's private bin if it exists
if [ -d "$HOME/bin" ] ; then
    PATH="$HOME/bin:$PATH"
fi

if [ -d "/opt/homebrew/bin" ] ; then
    case ":$PATH:" in
      *:/opt/homebrew/bin:*) ;;
      *) PATH="/opt/homebrew/bin:$PATH" ;;
    esac
fi

if [ -d "/opt/homebrew/sbin" ] ; then
    case ":$PATH:" in
      *:/opt/homebrew/sbin:*) ;;
      *) PATH="/opt/homebrew/sbin:$PATH" ;;
    esac
fi
