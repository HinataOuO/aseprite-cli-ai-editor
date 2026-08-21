"""Versioned canonical sprite matrix model."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .palette import hex_to_rgba


@dataclass(eq=True)
class SpriteMatrix:
    width: int
    height: int
    palette: list[str]
    pixels: list[list[int]]
    version: int = 1
    metadata: dict[str, Any] = field(default_factory=dict)

    def validate(self) -> None:
        if type(self.version) is not int or self.version != 1:
            raise ValueError("version must be integer 1")
        if type(self.width) is not int or type(self.height) is not int:
            raise ValueError("width and height must be integers")
        if not 1 <= self.width <= 128 or not 1 <= self.height <= 128 or self.width * self.height > 16384:
            raise ValueError("width and height must be 1..128 with area <= 16384")
        if not isinstance(self.palette, list) or not 1 <= len(self.palette) <= 256:
            raise ValueError("palette must contain 1..256 colors")
        for color in self.palette:
            if not isinstance(color, str):
                raise ValueError("palette colors must be RGBA strings")
            hex_to_rgba(color)
        if not isinstance(self.pixels, list):
            raise ValueError("pixels must be a list")
        if len(self.pixels) != self.height:
            raise ValueError("pixel row count does not match height")
        for row in self.pixels:
            if not isinstance(row, list) or len(row) != self.width:
                raise ValueError("pixel column count does not match width")
            for index in row:
                if type(index) is not int or not 0 <= index < len(self.palette):
                    raise ValueError(f"invalid palette index: {index!r}")
        if not isinstance(self.metadata, dict):
            raise ValueError("metadata must be an object")

    def to_dict(self) -> dict[str, Any]:
        self.validate()
        return {
            "version": self.version,
            "width": self.width,
            "height": self.height,
            "palette": self.palette,
            "pixels": self.pixels,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> SpriteMatrix:
        if not isinstance(data, dict):
            raise ValueError("sprite JSON must be an object")
        required = {"version", "width", "height", "palette", "pixels", "metadata"}
        missing = required - data.keys()
        if missing:
            raise ValueError(f"missing fields: {', '.join(sorted(missing))}")
        sprite = cls(
            version=data["version"],
            width=data["width"],
            height=data["height"],
            palette=data["palette"],
            pixels=data["pixels"],
            metadata=data.get("metadata", {}),
        )
        sprite.validate()
        return sprite

    def save(self, path: str | Path) -> None:
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            json.dumps(self.to_dict(), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    @classmethod
    def load(cls, path: str | Path) -> SpriteMatrix:
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError(f"cannot read sprite JSON: {error}") from error
        return cls.from_dict(data)
