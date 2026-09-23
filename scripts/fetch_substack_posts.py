"""Fetch the latest posts from the Substack RSS feed and write them to data/substack-posts.json."""
import html
import json
import re
import sys
import urllib.request
from pathlib import Path
from xml.etree import ElementTree as ET

FEED_URL = "https://ianwpedersen.substack.com/feed"
OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "substack-posts.json"
POST_LIMIT = 3
EXCERPT_LENGTH = 160


def strip_html(text):
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def excerpt(text, length=EXCERPT_LENGTH):
    text = strip_html(text)
    if len(text) <= length:
        return text
    return text[:length].rsplit(" ", 1)[0] + "…"


def main():
    request = urllib.request.Request(
        FEED_URL,
        headers={"User-Agent": "Mozilla/5.0 (compatible; ianwpedersen.com site builder)"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        feed_xml = response.read()

    root = ET.fromstring(feed_xml)
    items = root.findall("./channel/item")[:POST_LIMIT]

    posts = []
    for item in items:
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub_date = (item.findtext("pubDate") or "").strip()
        description = item.findtext("description") or ""
        posts.append({
            "title": title,
            "url": link,
            "pub_date": pub_date,
            "excerpt": excerpt(description),
        })

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(posts, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(posts)} post(s) to {OUTPUT_PATH}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"Failed to fetch Substack posts: {exc}", file=sys.stderr)
        sys.exit(1)
