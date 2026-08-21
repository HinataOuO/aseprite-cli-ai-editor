"""Local deterministic PNG processing pipeline."""

from pathlib import Path
from typing import Any

from .artifacts import cleanup_artifacts
from .grid import extract_grid, load_rgba, proportional_dimensions
from .matrix import SpriteMatrix
from .palette import extract_palette, rgba_to_hex
from .renderer import render_png, render_preview
from .validator import ValidationResult, validate_sprite

DEFAULTS: dict[str, Any] = {
    "grid": {
        "sampling_method": "dominant",
        "sample_offset_x": 0,
        "sample_offset_y": 0,
    },
    "palette": {"max_colors": 256},
    "cleanup": {"background_tolerance": 12},
    "render": {"preview_scale": 8},
    "validation": {"require_binary_alpha": False, "max_colors": None},
}


def _merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = {key: value.copy() if isinstance(value, dict) else value for key, value in base.items()}
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    if path is None:
        return _merge({}, DEFAULTS)
    import yaml

    try:
        loaded = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError) as error:
        raise ValueError(f"cannot read config: {error}") from error
    if not isinstance(loaded, dict):
        raise ValueError("config root must be a mapping")
    return _merge(DEFAULTS, loaded)


def extract_sprite(
    input_path: str | Path,
    *,
    size: int,
    sampling_method: str = "dominant",
    sample_offset_x: int = 0,
    sample_offset_y: int = 0,
    max_colors: int | None = None,
    background_tolerance: int = 12,
    min_component_pixels: int = 0,
    prune_passes: int = 0,
) -> SpriteMatrix:
    image = load_rgba(input_path)
    width, height = proportional_dimensions(image.width, image.height, size)
    colors = extract_grid(
        image,
        width,
        height,
        sampling_method,
        sample_offset_x,
        sample_offset_y,
    )
    colors = cleanup_artifacts(
        colors,
        background_tolerance=background_tolerance,
        min_component_pixels=min_component_pixels,
        prune_passes=prune_passes,
    )
    palette, pixels = extract_palette(colors, max_colors)
    sprite = SpriteMatrix(
        width=width,
        height=height,
        palette=[rgba_to_hex(color) for color in palette],
        pixels=pixels,
    )
    sprite.validate()
    return sprite


def run_pipeline(
    input_path: str | Path,
    output_dir: str | Path,
    *,
    size: int | None = None,
    config_path: str | Path | None = None,
    sampling_method: str | None = None,
    sample_offset_x: int | None = None,
    sample_offset_y: int | None = None,
    max_colors: int | None = None,
    preview_scale: int | None = None,
    background_tolerance: int | None = None,
    min_component_pixels: int = 0,
    prune_passes: int = 0,
) -> tuple[SpriteMatrix, ValidationResult]:
    if size is None:
        raise ValueError("size is required")
    config = load_config(config_path)
    sampling_method = sampling_method if sampling_method is not None else config["grid"]["sampling_method"]
    sample_offset_x = sample_offset_x if sample_offset_x is not None else config["grid"]["sample_offset_x"]
    sample_offset_y = sample_offset_y if sample_offset_y is not None else config["grid"]["sample_offset_y"]
    max_colors = max_colors if max_colors is not None else config["palette"]["max_colors"]
    preview_scale = preview_scale if preview_scale is not None else config["render"]["preview_scale"]
    background_tolerance = (
        background_tolerance
        if background_tolerance is not None
        else config["cleanup"]["background_tolerance"]
    )

    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    sprite = extract_sprite(
        input_path,
        size=size,
        sampling_method=sampling_method,
        sample_offset_x=sample_offset_x,
        sample_offset_y=sample_offset_y,
        max_colors=max_colors,
        background_tolerance=background_tolerance,
        min_component_pixels=min_component_pixels,
        prune_passes=prune_passes,
    )
    json_path = output / "sprite.json"
    png_path = output / "sprite.png"
    sprite.save(json_path)
    render_png(sprite, png_path)
    render_preview(sprite, output / "preview.png", preview_scale)
    validation = validate_sprite(
        sprite,
        png_path=png_path,
        max_colors=config["validation"]["max_colors"],
        require_binary_alpha=config["validation"]["require_binary_alpha"],
    )
    return sprite, validation
