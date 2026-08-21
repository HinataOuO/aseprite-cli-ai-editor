#!/usr/bin/env python3
"""Render native and optional preview PNG files from sprite JSON."""

import argparse
import sys

from pixel_pipeline import SpriteMatrix, render_png, render_preview


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("sprite")
    parser.add_argument("--output", required=True)
    parser.add_argument("--preview")
    parser.add_argument("--scale", type=int, default=8)
    args = parser.parse_args()
    try:
        sprite = SpriteMatrix.load(args.sprite)
        render_png(sprite, args.output)
        if args.preview:
            render_preview(sprite, args.preview, args.scale)
    except (OSError, TypeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
