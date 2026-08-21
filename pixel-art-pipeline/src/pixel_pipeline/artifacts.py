"""Deterministic border-connected background removal and optional pruning."""

from collections import Counter

from .grid import ColorGrid, RGBA

_NEIGHBORS = tuple(
    (dx, dy)
    for dy in (-1, 0, 1)
    for dx in (-1, 0, 1)
    if dx != 0 or dy != 0
)
_CARDINAL = ((-1, 0), (1, 0), (0, -1), (0, 1))
_TRANSPARENT = (0, 0, 0, 0)


def _validate(colors: ColorGrid, background_tolerance: int, min_component_pixels: int, prune_passes: int) -> None:
    if not colors or not colors[0] or any(len(row) != len(colors[0]) for row in colors):
        raise ValueError("color grid must be non-empty and rectangular")
    if type(background_tolerance) is not int or background_tolerance < 0:
        raise ValueError("background_tolerance must be a non-negative integer")
    if type(min_component_pixels) is not int or min_component_pixels < 0:
        raise ValueError("min_component_pixels must be a non-negative integer")
    if type(prune_passes) is not int or not 0 <= prune_passes <= 1:
        raise ValueError("prune_passes must be 0 or 1")


def cleanup_artifacts(
    colors: ColorGrid,
    *,
    background_tolerance: int = 12,
    min_component_pixels: int = 0,
    prune_passes: int = 0,
) -> ColorGrid:
    """Remove an opaque border background; optionally remove detached artifacts."""
    _validate(colors, background_tolerance, min_component_pixels, prune_passes)
    cleaned = [row.copy() for row in colors]
    if any(color[3] != 255 for row in colors for color in row):
        return cleaned

    height, width = len(colors), len(colors[0])
    border_points = [
        (x, y)
        for y in range(height)
        for x in range(width)
        if x in (0, width - 1) or y in (0, height - 1)
    ]
    background = Counter(colors[y][x] for x, y in border_points).most_common(1)[0][0]

    def near_background(color: RGBA) -> bool:
        return max(
            abs(color[channel] - background[channel]) for channel in range(3)
        ) <= background_tolerance

    removed = {(x, y) for x, y in border_points if near_background(colors[y][x])}
    stack = list(removed)
    while stack:
        x, y = stack.pop()
        for dx, dy in _CARDINAL:
            neighbor = (x + dx, y + dy)
            if (
                0 <= neighbor[0] < width
                and 0 <= neighbor[1] < height
                and neighbor not in removed
                and near_background(colors[neighbor[1]][neighbor[0]])
            ):
                removed.add(neighbor)
                stack.append(neighbor)
    for x, y in removed:
        cleaned[y][x] = _TRANSPARENT

    foreground = {
        (x, y)
        for y, row in enumerate(cleaned)
        for x, color in enumerate(row)
        if color[3] != 0
    }
    unseen = set(foreground)
    while unseen:
        start = min(unseen, key=lambda point: (point[1], point[0]))
        component = {start}
        stack = [start]
        unseen.remove(start)
        while stack:
            x, y = stack.pop()
            for dx, dy in _NEIGHBORS:
                neighbor = (x + dx, y + dy)
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    component.add(neighbor)
                    stack.append(neighbor)
        if len(component) < min_component_pixels:
            for x, y in component:
                cleaned[y][x] = _TRANSPARENT
                foreground.remove((x, y))

    if prune_passes:
        for x, y in {
            point
            for point in foreground
            if sum((point[0] + dx, point[1] + dy) in foreground for dx, dy in _NEIGHBORS)
            <= 1
        }:
            cleaned[y][x] = _TRANSPARENT

    return cleaned
