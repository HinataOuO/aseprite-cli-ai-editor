"""Render canonical matrices to native and nearest-neighbor PNG files."""

from pathlib import Path

from PIL import Image

from .matrix import SpriteMatrix
from .palette import hex_to_rgba


def render_image(sprite: SpriteMatrix) -> Image.Image:
    sprite.validate()
    palette = [hex_to_rgba(color) for color in sprite.palette]
    image = Image.new("RGBA", (sprite.width, sprite.height))
    image.putdata([palette[index] for row in sprite.pixels for index in row])
    return image


def render_png(sprite: SpriteMatrix, path: str | Path) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    render_image(sprite).save(destination, format="PNG")


def render_preview(sprite: SpriteMatrix, path: str | Path, scale: int = 8) -> None:
    if scale <= 0:
        raise ValueError("preview scale must be positive")
    image = render_image(sprite).resize(
        (sprite.width * scale, sprite.height * scale), Image.Resampling.NEAREST
    )
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, format="PNG")
