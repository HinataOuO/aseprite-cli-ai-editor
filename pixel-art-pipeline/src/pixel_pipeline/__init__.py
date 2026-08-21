"""Public API for the deterministic pixel-art pipeline."""

from .matrix import SpriteMatrix
from .pipeline import extract_sprite, run_pipeline
from .renderer import render_image, render_png, render_preview
from .validator import ValidationError, ValidationResult, validate_sprite

__all__ = [
    "SpriteMatrix",
    "ValidationError",
    "ValidationResult",
    "extract_sprite",
    "render_image",
    "render_png",
    "render_preview",
    "run_pipeline",
    "validate_sprite",
]
