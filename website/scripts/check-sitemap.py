"""Check that the generated sitemap points to indexable pages in the build."""

import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree


ORIGIN = "https://jstorrent.com"
SITEMAP_INDEX = f"{ORIGIN}/sitemap-index.xml"
XML_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


class SearchMetadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.canonicals = []
        self.noindex = False

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == "link" and "canonical" in (attrs.get("rel") or "").lower().split():
            self.canonicals.append(attrs.get("href"))
        if tag == "meta" and (attrs.get("name") or "").lower() in {"robots", "googlebot"}:
            directives = re.split(r"[\s,]+", (attrs.get("content") or "").lower())
            self.noindex |= bool({"noindex", "none"}.intersection(directives))


def site_path(url):
    parsed = urlsplit(url)
    path = unquote(parsed.path)
    if (
        f"{parsed.scheme}://{parsed.netloc}" != ORIGIN
        or not path.startswith("/")
        or "?" in url
        or "#" in url
        or "\\" in path
        or ".." in path.split("/")
    ):
        raise ValueError(f"Expected a canonical {ORIGIN} URL, got {url!r}")
    return path


def sitemap_locations(file, root_tag, entry_tag):
    root = ElementTree.parse(file).getroot()
    entries = root.findall(f"{XML_NS}{entry_tag}")
    if root.tag != f"{XML_NS}{root_tag}" or not entries:
        raise ValueError(f"Expected a non-empty {root_tag} in {file}")
    for entry in entries:
        url = entry.findtext(f"{XML_NS}loc", "").strip()
        if not url:
            raise ValueError(f"Missing <loc> in {file}")
        yield url


def check(dist):
    robots = (dist / "robots.txt").read_text(encoding="utf-8")
    if f"Sitemap: {SITEMAP_INDEX}" not in robots.splitlines():
        raise ValueError(f"robots.txt must advertise {SITEMAP_INDEX}")

    pages = set()
    for sitemap in sitemap_locations(dist / "sitemap-index.xml", "sitemapindex", "sitemap"):
        file = dist / site_path(sitemap).lstrip("/")
        for url in sitemap_locations(file, "urlset", "url"):
            if url in pages:
                raise ValueError(f"Duplicate sitemap URL: {url}")
            pages.add(url)
            path = site_path(url)
            page = dist / path.lstrip("/")
            if path.endswith("/"):
                page /= "index.html"
            if not page.is_file():
                raise ValueError(f"Sitemap URL has no built page: {url} ({page})")
            metadata = SearchMetadata()
            metadata.feed(page.read_text(encoding="utf-8"))
            if metadata.noindex or metadata.canonicals != [url]:
                raise ValueError(f"Sitemap URL must be indexable and self-canonical: {url}")
    if f"{ORIGIN}/" not in pages:
        raise ValueError("Homepage is missing from the sitemap")
    print(f"Validated sitemap and robots.txt for {len(pages)} pages.")


if __name__ == "__main__":
    try:
        check(Path(sys.argv[1]))
    except (OSError, ValueError, ElementTree.ParseError) as error:
        sys.exit(f"Sitemap validation failed: {error}")
