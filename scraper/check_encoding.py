#!/usr/bin/env python3
"""Fail if any tracked text file has mojibake in it.

The site's JS and HTML were once committed after a round trip through Latin-1,
which turned every em dash, middle dot and star into the usual garbage - and
that garbage rendered verbatim on the live page. The corruption is mechanical
and easy to spot: text that is valid UTF-8 but whose bytes, re-encoded as
Latin-1, are *also* valid UTF-8 has almost certainly been double-encoded.

Run from CI (and locally) so a bad editor or a bad paste cannot ship it again.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGETS = ["*.html", "*.js", "*.css", "*.md", "*.py", "*.json", "*.yml"]
SKIP_DIRS = {".git", "node_modules", "assets"}

# The punctuation this site actually uses. Each one is encoded to UTF-8 and
# read back as Latin-1 to build the exact garbage string a double-encode
# produces, so the markers stay derived rather than pasted - which also keeps
# this file pure ASCII and stops it from flagging itself.
PUNCTUATION = [
    0x2013, 0x2014,          # en dash, em dash
    0x2018, 0x2019,          # curly single quotes
    0x201C, 0x201D,          # curly double quotes
    0x2026,                  # ellipsis
    0x00B7,                  # middle dot
    0x2022,                  # bullet
    0x2605, 0x2606,          # filled and hollow star
    0x2713,                  # check mark
    0x00D7,                  # multiplication sign
    0x2190, 0x2192,          # arrows
    0x2039, 0x203A,          # single angle quotes
]
MARKERS = [chr(c).encode("utf-8").decode("latin-1") for c in PUNCTUATION]
MARKERS.append(chr(0xFFFD))  # replacement character: text already lost


def suspect(text):
    if any(m in text for m in MARKERS):
        return ["known mojibake sequence"]
    # A whole-file Latin-1 round trip that succeeds and changes something means
    # every non-ASCII run in the file is a valid mojibake sequence.
    if any(ord(c) > 127 for c in text):
        try:
            if text.encode("latin-1").decode("utf-8") != text:
                return ["whole-file double-encoding"]
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return []


def main():
    bad = []
    checked = 0
    for pattern in TARGETS:
        for path in sorted(ROOT.rglob(pattern)):
            if SKIP_DIRS & set(path.relative_to(ROOT).parts):
                continue
            checked += 1
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                bad.append((path, ["not valid UTF-8"]))
                continue
            hits = suspect(text)
            if hits:
                bad.append((path, hits))
    for path, hits in bad:
        print(f"mojibake in {path.relative_to(ROOT)}: {', '.join(hits)}")
    if bad:
        print("\nFix by re-saving the file as UTF-8, or recover the original "
              "text with: text.encode('latin-1').decode('utf-8')")
        return 1
    print(f"Encoding check passed: {checked} files, no mojibake.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
