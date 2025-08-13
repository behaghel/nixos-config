
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

  # Combine bootstrap and greeting for complete enterShell
  standardEnterShell = { projectTypeMsg, keyFile, greeting, extraBootstrapSteps ? "" }: ''
    ${lib.strings.removeSuffix "\n" (bootstrapFromTemplateResources projectTypeMsg keyFile)}
      
      ${extraBootstrapSteps}
      
      echo "✅ Project bootstrapped successfully!"
      echo ""
    fi

    ${showGreetingInInteractiveShell greeting}
  '';
}
