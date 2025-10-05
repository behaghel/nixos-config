
# Home Manager Modules

This directory contains Home Manager modules for user-specific configurations.

## Video Editing Helpers

See `modules/home/video-editing/README.md` for CLI helpers that denoise audio (`video-denoise`) and automatically trim filler words from talking-head footage (`video-trim-fillers`).

## Emacs Configuration Workflow

The Emacs configuration uses a hybrid approach that preserves Emacs' dynamic philosophy while leveraging Nix flakes for reproducible package management.

### Architecture

- **External Repository**: Your Emacs config lives in a separate Git repository (referenced as `my-emacs-config` flake input)
- **Flake Integration**: The external repo is included as a flake input with `flake = false`
- **Writable Configuration**: Local `~/.emacs.d` is a regular directory (not read-only symlink)
- **Sync Script**: `emacs-config-sync` command manages syncing between flake input and local config

### Initial Setup

1. **Configure flake input** in `flake.nix`:
   ```nix
   my-emacs-config = {
     url = "github:yourusername/your-emacs-config-repo";
     flake = false;
   };
   ```

2. **Apply configuration**:
   ```bash
   nix run .#switch
   ```

3. **Your `~/.emacs.d` is automatically synced** on first activation or when the directory doesn't exist.

### Development Workflow

#### Making Configuration Changes

**For immediate experimentation:**
- Edit files directly in `~/.emacs.d/`
- Changes take effect immediately (Emacs' dynamic nature preserved)
- Test and iterate freely

**For persistent changes:**
1. When satisfied with changes, commit them to your external Emacs config repository
2. Update the flake input:
   ```bash
   nix flake update
   ```
3. Sync the updated configuration:
   ```bash
   emacs-config-sync
   ```

#### Sync Commands

- **`emacs-config-sync`** - Syncs your external config to `~/.emacs.d`
  - Creates backup of existing config (if not a symlink)
  - Copies fresh config from flake input
  - Makes all files writable
  - Safe to run multiple times

#### Recovery and Rollback

- **Backup restoration**: If sync creates a backup, restore with:
  ```bash
  mv ~/.emacs.d.backup ~/.emacs.d
  ```

- **Clean sync**: Force a fresh sync by removing current config:
  ```bash
  rm -rf ~/.emacs.d
  emacs-config-sync
  ```

### Key Benefits

1. **Dynamic Development**: Edit and reload Emacs config in real-time
2. **Version Control**: All changes tracked in external Git repository  
3. **Reproducibility**: Flake input pins exact configuration version
4. **Package Management**: Emacs packages managed declaratively via Nix
5. **Multi-machine Sync**: Same config across all machines via flake updates

### File Structure

```
modules/home/emacs/
├── default.nix          # Emacs module with sync script
└── README.md           # This documentation

~/.emacs.d/             # Your writable Emacs configuration
├── init.el             # Synced from external repo
├── config/             # Synced from external repo
└── ...                 # All other config files
```

### Troubleshooting

**Sync script not found:**
```bash
nix run .#switch  # Rebuild home configuration
```

**Config not updating:**
```bash
nix flake update          # Update flake inputs
emacs-config-sync         # Sync updated config
```

**Package conflicts:**
- Emacs packages should be managed in `modules/home/emacs/default.nix`
- Avoid package management within your external Emacs config
- Use `extraPackages` for additional Emacs Lisp packages

This workflow provides the best of both worlds: Emacs' traditional flexibility with modern reproducible infrastructure.
