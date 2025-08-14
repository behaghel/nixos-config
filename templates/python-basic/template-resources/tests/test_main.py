"""Tests for main module."""

import pytest

from python_basic.main import greet


def test_greet_default() -> None:
    """Test greet function with default parameter."""
    result = greet()
    assert result == "Hello, World!"


def test_greet_with_name() -> None:
    """Test greet function with custom name."""
    result = greet("Alice")
    assert result == "Hello, Alice!"


@pytest.mark.parametrize(
    "name,expected",
    [
        ("Bob", "Hello, Bob!"),
        ("", "Hello, !"),
        ("Python", "Hello, Python!"),
    ],
)
def test_greet_parametrized(name: str, expected: str) -> None:
    """Test greet function with various inputs."""
    result = greet(name)
    assert result == expected
