
"""Main module for the Python basic project."""


def greet(name: str = "World") -> str:
    """Return a greeting message.
    
    Args:
        name: The name to greet. Defaults to "World".
        
    Returns:
        A greeting message.
    """
    return f"Hello, {name}!"


def main() -> None:
    """Main entry point of the application."""
    print(greet())


if __name__ == "__main__":
    main()
