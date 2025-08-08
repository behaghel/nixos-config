
"""Main module with hello world example."""


def greet(name: str = "World") -> str:
    """Return a greeting message.
    
    Args:
        name: The name to greet. Defaults to "World".
        
    Returns:
        A greeting message.
    """
    return f"Hello, {name}!"


def main() -> None:
    """Main entry point."""
    message = greet()
    print(message)


if __name__ == "__main__":
    main()
