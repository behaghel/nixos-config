
# Utility functions for devenv templates
{ pkgs, lib }:

{
  # Standard bootstrap function that copies template-resources and cleans up
  # Usage: ${bootstrapFromTemplateResources "🚀 Bootstrapping new project..." "pyproject.toml"}
  bootstrapFromTemplateResources = projectTypeMsg: keyFile: ''
    # Initialize project if not already initialized
    if [ ! -f "${keyFile}" ]; then
      echo "${projectTypeMsg}"
      
      # Copy template resources to project root
      if [ -d "template-resources" ]; then
        echo "📁 Copying template files..."
        cp -r template-resources/* .
        rm -rf template-resources
        echo "  ✓ Template files copied and template-resources cleaned up"
      fi
    fi
  '';

  # Standard greeting message for interactive shells
  showGreetingInInteractiveShell = greeting: ''
    # Show greeting in interactive shells
    if [[ $- == *i* ]]; then
      echo "${greeting}"
    fi
  '';

  # Move contents from a subdirectory to root and remove the subdirectory
  # Usage: ${moveSubdirectoryToRoot "project-name"}
  moveSubdirectoryToRoot = subdirName: ''
    # Move files from subdirectory to root
    if [ -d "${subdirName}" ]; then
      # Use cp to avoid overwrite issues, then remove source
      cp -r ${subdirName}/* . 2>/dev/null || true
      cp -r ${subdirName}/.* . 2>/dev/null || true
      rm -rf ${subdirName}
      echo "  ✓ Moved files from ${subdirName}/ to root directory"
    fi
  '';

  # Combine bootstrap and greeting for complete enterShell
  standardEnterShell = { projectTypeMsg, keyFile, greeting, extraBootstrapSteps ? "", extraShellSteps ? "" }: ''
    ${lib.strings.removeSuffix "\n" (bootstrapFromTemplateResources projectTypeMsg keyFile)}
      
      ${extraBootstrapSteps}
      
      echo "✅ Project bootstrapped successfully!"
      echo ""
    fi

    ${extraShellSteps}

    ${showGreetingInInteractiveShell greeting}
  '';
}
