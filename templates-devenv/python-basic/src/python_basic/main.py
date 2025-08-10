
"""Main module for the python-basic template."""


def greet(name: str = "World") -> str:
    """Generate a greeting message.
    
    Args:
        name: The name to greet. Defaults to "World".
        
    Returns:
        A greeting message string.
    """
    return f"Hello, {name}!"


def main() -> None:
    """Main entry point for the application."""
    message = greet()
    print(message)


if __name__ == "__main__":
    main()
