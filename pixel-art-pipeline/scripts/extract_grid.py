#!/usr/bin/env python3
"""Extract a canonical sprite JSON from a local PNG."""

import argparse
import sys

from pixel_pipeline.pipeline import extract_sprite, load_config


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("--output", required=True)
    parser.add_argument("--size", type=int, choices=(16, 32, 64, 128), required=True)
    parser.add_argument("--sampling-method", choices=("dominant", "center"))
    parser.add_argument("--sample-offset-x", type=int)
    parser.add_argument("--sample-offset-y", type=int)
    parser.add_argument("--max-colors", type=int)
    parser.add_argument("--background-tolerance", type=int)
    parser.add_argument("--config")
    args = parser.parse_args()
    try:
        config = load_config(args.config)
        sprite = extract_sprite(
            args.input,
            size=args.size,
            sampling_method=(
                args.sampling_method
                if args.sampling_method is not None
                else config["grid"]["sampling_method"]
            ),
            sample_offset_x=(
                args.sample_offset_x
                if args.sample_offset_x is not None
                else config["grid"]["sample_offset_x"]
            ),
            sample_offset_y=(
                args.sample_offset_y
                if args.sample_offset_y is not None
                else config["grid"]["sample_offset_y"]
            ),
            max_colors=(
                args.max_colors
                if args.max_colors is not None
                else config["palette"]["max_colors"]
            ),
            background_tolerance=(
                args.background_tolerance
                if args.background_tolerance is not None
                else config["cleanup"]["background_tolerance"]
            ),
        )
        sprite.save(args.output)
    except (KeyError, OSError, TypeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
