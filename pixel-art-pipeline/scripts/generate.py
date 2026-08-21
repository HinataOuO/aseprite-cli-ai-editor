#!/usr/bin/env python3
"""Run the complete local PNG processing pipeline (no AI generation)."""

import argparse
import sys

from pixel_pipeline import run_pipeline


def non_negative(value: str) -> int:
    parsed = int(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("must be non-negative")
    return parsed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Process a local PNG into canonical JSON and rendered PNG outputs."
    )
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--size", type=int, choices=(16, 32, 64, 128), required=True)
    parser.add_argument("--sampling-method", choices=("dominant", "center"))
    parser.add_argument("--sample-offset-x", type=int)
    parser.add_argument("--sample-offset-y", type=int)
    parser.add_argument("--max-colors", type=int)
    parser.add_argument("--preview-scale", type=int)
    parser.add_argument("--background-tolerance", type=non_negative)
    parser.add_argument("--min-component-pixels", type=non_negative, default=0)
    parser.add_argument("--prune-passes", type=int, choices=(0, 1), default=0)
    parser.add_argument("--config")
    args = parser.parse_args()
    try:
        _, validation = run_pipeline(
            args.input,
            args.output,
            config_path=args.config,
            size=args.size,
            sampling_method=args.sampling_method,
            sample_offset_x=args.sample_offset_x,
            sample_offset_y=args.sample_offset_y,
            max_colors=args.max_colors,
            preview_scale=args.preview_scale,
            background_tolerance=args.background_tolerance,
            min_component_pixels=args.min_component_pixels,
            prune_passes=args.prune_passes,
        )
    except (OSError, KeyError, TypeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    if not validation.valid:
        for error in validation.errors:
            print(f"{error.code}: {error.message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
