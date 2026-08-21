"""Read-only validation for canonical sprite data and rendered PNG files."""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image

from .matrix import SpriteMatrix
from .palette import hex_to_rgba
from .renderer import render_image


@dataclass(frozen=True)
class ValidationError:
    code: str
    message: str
    path: str = ""


@dataclass
class ValidationResult:
    errors: list[ValidationError] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not self.errors


def validate_sprite(
    value: SpriteMatrix | dict[str, Any],
    *,
    png_path: str | Path | None = None,
    max_colors: int | None = None,
    require_binary_alpha: bool = False,
) -> ValidationResult:
    result = ValidationResult()
    try:
        sprite = value if isinstance(value, SpriteMatrix) else SpriteMatrix.from_dict(value)
        sprite.validate()
    except (TypeError, ValueError) as error:
        result.errors.append(ValidationError("invalid_structure", str(error)))
        return result

    if max_colors is not None:
        if max_colors <= 0:
            result.errors.append(
                ValidationError("invalid_max_colors", "max_colors must be positive")
            )
        elif len(sprite.palette) > max_colors:
            result.errors.append(
                ValidationError(
                    "too_many_colors",
                    f"palette has {len(sprite.palette)} colors; maximum is {max_colors}",
                    "palette",
                )
            )

    if require_binary_alpha:
        for index, color in enumerate(sprite.palette):
            if hex_to_rgba(color)[3] not in (0, 255):
                result.errors.append(
                    ValidationError(
                        "partial_alpha",
                        "palette contains partial alpha",
                        f"palette[{index}]",
                    )
                )

    if png_path is not None:
        try:
            with Image.open(png_path) as image:
                actual = image.convert("RGBA")
                actual.load()
        except (OSError, ValueError) as error:
            result.errors.append(ValidationError("invalid_png", str(error), str(png_path)))
        else:
            expected = render_image(sprite)
            if actual.size != expected.size:
                result.errors.append(
                    ValidationError(
                        "png_dimensions",
                        f"PNG is {actual.width}x{actual.height}; expected {sprite.width}x{sprite.height}",
                        str(png_path),
                    )
                )
            elif list(actual.getdata()) != list(expected.getdata()):
                result.errors.append(
                    ValidationError(
                        "png_mismatch",
                        "PNG pixels do not match the canonical matrix",
                        str(png_path),
                    )
                )
    return result
