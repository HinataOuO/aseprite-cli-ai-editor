#!/usr/bin/env python3
"""Validate sprite JSON and optionally compare it with a PNG."""

import argparse
import json
import sys
from pathlib import Path

from pixel_pipeline import validate_sprite


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("sprite")
    parser.add_argument("--png")
    parser.add_argument("--max-colors", type=int)
    parser.add_argument("--require-binary-alpha", action="store_true")
    args = parser.parse_args()
    try:
        data = json.loads(Path(args.sprite).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    result = validate_sprite(
        data,
        png_path=args.png,
        max_colors=args.max_colors,
        require_binary_alpha=args.require_binary_alpha,
    )
    if result.valid:
        print("valid")
        return 0
    for error in result.errors:
        location = f" [{error.path}]" if error.path else ""
        print(f"{error.code}{location}: {error.message}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
