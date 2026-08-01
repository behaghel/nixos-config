#!/usr/bin/env python3
"""Check internal links in a generated Hugo site."""

from __future__ import annotations

import argparse
import html.parser
import sys
import urllib.parse
from pathlib import Path

IGNORED_SCHEMES = {"http", "https", "mailto", "tel", "sms", "javascript", "data"}


class LinkParser(html.parser.HTMLParser):
    """Collect anchors and element IDs from one HTML document."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.hrefs: list[tuple[int, str]] = []
        self.ids: set[str] = set()
        self.names: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key.lower(): value for key, value in attrs}
        element_id = attrs_dict.get("id")
        if element_id:
            self.ids.add(element_id)
        name = attrs_dict.get("name")
        if name:
            self.names.add(name)
        if tag.lower() in {"a", "area"}:
            href = attrs_dict.get("href")
            if href:
                self.hrefs.append((self.getpos()[0], href))


def page_url(root: Path, html_file: Path) -> str:
    """Return the URL path represented by HTML_FILE under ROOT."""
    rel = html_file.relative_to(root).as_posix()
    if rel == "index.html":
        return "/"
    if rel.endswith("/index.html"):
        return "/" + rel[: -len("index.html")]
    return "/" + rel


def resolve_target(root: Path, url_path: str) -> Path | None:
    """Resolve URL_PATH to an existing generated file under ROOT."""
    path = urllib.parse.unquote(url_path)
    if path.startswith("/"):
        path = path[1:]
    candidate = (root / path).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None

    candidates = []
    if candidate.is_dir() or url_path.endswith("/") or not candidate.suffix:
        candidates.append(candidate / "index.html")
    candidates.append(candidate)
    if candidate.suffix == "":
        candidates.append(candidate.with_suffix(".html"))

    for item in candidates:
        if item.exists():
            return item
    return None


def should_ignore(href: str) -> bool:
    """Return True when HREF is not an internal navigational link."""
    href = href.strip()
    if not href:
        return True
    parsed = urllib.parse.urlsplit(href)
    return bool(parsed.scheme in IGNORED_SCHEMES or parsed.netloc)


def check_site(root: Path) -> list[str]:
    """Return internal-link failures for generated site ROOT."""
    html_files = sorted(root.rglob("*.html"))
    documents: dict[Path, LinkParser] = {}
    failures: list[str] = []

    for html_file in html_files:
        parser = LinkParser()
        parser.feed(html_file.read_text(encoding="utf-8", errors="replace"))
        documents[html_file.resolve()] = parser

    resolved_root = root.resolve()
    for html_file in html_files:
        source_url = page_url(root, html_file)
        source_parser = documents[html_file.resolve()]
        for line, href in source_parser.hrefs:
            if should_ignore(href):
                continue
            parsed = urllib.parse.urlsplit(href)
            absolute = urllib.parse.urljoin(source_url, parsed.path or "")
            if not absolute.startswith("/"):
                absolute = "/" + absolute
            target = resolve_target(root, absolute)
            source_rel = html_file.relative_to(root).as_posix()
            if target is None:
                failures.append(f"{source_rel}:{line}: broken link {href!r} (missing target {absolute})")
                continue
            target = target.resolve()
            try:
                target.relative_to(resolved_root)
            except ValueError:
                failures.append(f"{source_rel}:{line}: broken link {href!r} escapes site root")
                continue
            if parsed.fragment and target.suffix == ".html":
                target_parser = documents.get(target)
                anchors = (target_parser.ids | target_parser.names) if target_parser else set()
                fragment = urllib.parse.unquote(parsed.fragment)
                if fragment not in anchors:
                    target_rel = target.relative_to(root).as_posix()
                    failures.append(
                        f"{source_rel}:{line}: broken anchor {href!r} "
                        f"(missing #{fragment} in {target_rel})"
                    )
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path, help="Generated site directory, e.g. public/")
    args = parser.parse_args()
    failures = check_site(args.root)
    if failures:
        print("Internal link check failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1
    print("internal link check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
