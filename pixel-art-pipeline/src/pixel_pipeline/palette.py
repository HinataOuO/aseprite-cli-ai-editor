"""Deterministic palette extraction and optional Pillow quantization."""

from PIL import Image

from .grid import ColorGrid, RGBA


def _quantize(colors: ColorGrid, max_colors: int) -> ColorGrid:
    if not 1 <= max_colors <= 256:
        raise ValueError("max_colors must be between 1 and 256")
    height = len(colors)
    width = len(colors[0]) if height else 0
    image = Image.new("RGBA", (width, height))
    image.putdata([color for row in colors for color in row])
    quantized = image.quantize(
        colors=max_colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE
    ).convert("RGBA")
    data = list(quantized.getdata())
    return [data[y * width : (y + 1) * width] for y in range(height)]


def extract_palette(
    colors: ColorGrid, max_colors: int | None = None
) -> tuple[list[RGBA], list[list[int]]]:
    if not colors or not colors[0] or any(len(row) != len(colors[0]) for row in colors):
        raise ValueError("color grid must be non-empty and rectangular")

    if max_colors is not None:
        unique_count = len({color for row in colors for color in row})
        if unique_count > max_colors:
            colors = _quantize(colors, max_colors)
        elif not 1 <= max_colors <= 256:
            raise ValueError("max_colors must be between 1 and 256")

    palette: list[RGBA] = []
    indexes: dict[RGBA, int] = {}
    pixels: list[list[int]] = []
    for row in colors:
        indexed_row: list[int] = []
        for color in row:
            if color not in indexes:
                indexes[color] = len(palette)
                palette.append(color)
            indexed_row.append(indexes[color])
        pixels.append(indexed_row)
    return palette, pixels


def rgba_to_hex(color: RGBA) -> str:
    return "#" + "".join(f"{channel:02X}" for channel in color)


def hex_to_rgba(color: str) -> RGBA:
    if len(color) != 9 or not color.startswith("#"):
        raise ValueError(f"invalid RGBA color: {color!r}")
    try:
        channels = tuple(int(color[index : index + 2], 16) for index in range(1, 9, 2))
    except ValueError as error:
        raise ValueError(f"invalid RGBA color: {color!r}") from error
    return channels  # type: ignore[return-value]
