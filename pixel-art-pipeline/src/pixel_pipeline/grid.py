"""Extract logical RGBA pixels from a raster image."""

from pathlib import Path

from PIL import Image

RGBA = tuple[int, int, int, int]
ColorGrid = list[list[RGBA]]


SIZES = (16, 32, 64, 128)


def load_rgba(path: str | Path) -> Image.Image:
    with Image.open(path) as image:
        if image.format != "PNG":
            raise ValueError("input must be a real PNG file")
        if getattr(image, "n_frames", 1) != 1:
            raise ValueError("animated PNG input is not supported")
        image.load()
        return image.convert("RGBA")


def proportional_dimensions(width: int, height: int, size: int) -> tuple[int, int]:
    if type(width) is not int or type(height) is not int or width <= 0 or height <= 0:
        raise ValueError("source dimensions must be positive integers")
    if type(size) is not int or size not in SIZES:
        raise ValueError(f"size must be one of {SIZES}")
    if width >= height:
        return size, max(1, (height * size + width // 2) // width)
    return max(1, (width * size + height // 2) // height), size


def extract_grid(
    image: Image.Image,
    width: int,
    height: int,
    sampling_method: str = "dominant",
    sample_offset_x: int = 0,
    sample_offset_y: int = 0,
) -> ColorGrid:
    if width <= 0 or height <= 0:
        raise ValueError("grid dimensions must be positive")
    if sampling_method not in {"dominant", "center"}:
        raise ValueError(f"unknown sampling method: {sampling_method}")
    if type(sample_offset_x) is not int or type(sample_offset_y) is not int:
        raise TypeError("sample offsets must be integers")
    if sampling_method != "center" and (sample_offset_x or sample_offset_y):
        raise ValueError("sample offsets require center sampling")
    source = image.convert("RGBA")
    if source.width < width or source.height < height:
        resized = source.resize((width, height), Image.Resampling.NEAREST)
        pixels = resized.load()
        return [[pixels[x, y] for x in range(width)] for y in range(height)]

    pixels = source.load()
    rows: ColorGrid = []
    for y in range(height):
        y0, y1 = y * source.height // height, (y + 1) * source.height // height
        row: list[RGBA] = []
        for x in range(width):
            x0, x1 = x * source.width // width, (x + 1) * source.width // width
            if sampling_method == "center":
                source_x = (x0 + x1) // 2 + sample_offset_x
                source_y = (y0 + y1) // 2 + sample_offset_y
                if not (0 <= source_x < source.width and 0 <= source_y < source.height):
                    raise ValueError(
                        f"sample coordinate ({source_x}, {source_y}) is outside image"
                    )
                row.append(pixels[source_x, source_y])
                continue
            counts: dict[RGBA, int] = {}
            for source_y in range(y0, y1):
                for source_x in range(x0, x1):
                    color = pixels[source_x, source_y]
                    counts[color] = counts.get(color, 0) + 1
            row.append(max(counts, key=counts.get))
        rows.append(row)
    return rows
