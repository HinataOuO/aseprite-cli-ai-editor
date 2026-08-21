import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from pixel_pipeline import SpriteMatrix, run_pipeline
from pixel_pipeline.grid import load_rgba
from pixel_pipeline.renderer import render_image


class PipelineTests(unittest.TestCase):
    @staticmethod
    def _opaque_source(path: Path, dimensions: tuple[int, int]) -> None:
        image = Image.new("RGBA", dimensions, (30, 40, 50, 255))
        left, top = dimensions[0] // 4, dimensions[1] // 4
        right, bottom = max(left + 1, dimensions[0] * 3 // 4), max(top + 1, dimensions[1] * 3 // 4)
        for y in range(top, bottom):
            for x in range(left, right):
                image.putpixel((x, y), (220, 80, 60, 255))
        image.save(path, format="PNG")

    def test_all_targets_accept_large_and_small_rectangular_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for size in (16, 32, 64, 128):
                for label, dimensions in (("large", (256, 128)), ("small", (4, 8))):
                    source = root / f"{size}-{label}.png"
                    output = root / f"out-{size}-{label}"
                    self._opaque_source(source, dimensions)
                    sprite, validation = run_pipeline(source, output, size=size)
                    self.assertTrue(validation.valid, validation.errors)
                    expected = (size, size // 2) if dimensions[0] > dimensions[1] else (size // 2, size)
                    self.assertEqual((sprite.width, sprite.height), expected)
                    self.assertEqual(SpriteMatrix.load(output / "sprite.json"), sprite)
                    with Image.open(output / "sprite.png") as png:
                        self.assertEqual(list(png.convert("RGBA").getdata()), list(render_image(sprite).getdata()))
                    with Image.open(output / "preview.png") as preview:
                        self.assertEqual(preview.size, (sprite.width * 8, sprite.height * 8))

    def test_square_source_and_required_allowed_target(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "square.png"
            self._opaque_source(source, (9, 9))
            sprite, _ = run_pipeline(source, root / "out", size=32)
            self.assertEqual((sprite.width, sprite.height), (32, 32))
            with self.assertRaisesRegex(ValueError, "size is required"):
                run_pipeline(source, root / "missing")
            for invalid in (1, 15, 17, 256, True):
                with self.assertRaisesRegex(ValueError, "size must be one of"):
                    run_pipeline(source, root / "invalid", size=invalid)

    def test_public_clis_require_an_allowed_size(self):
        root = Path(__file__).parents[1]
        environment = {**os.environ, "PYTHONPATH": str(root / "src")}
        commands = (
            [sys.executable, str(root / "scripts" / "generate.py"), "--input", "x", "--output", "y"],
            [sys.executable, str(root / "scripts" / "extract_grid.py"), "x", "--output", "y"],
        )
        for command in commands:
            missing = subprocess.run(command, env=environment, capture_output=True, text=True)
            invalid = subprocess.run(command + ["--size", "17"], env=environment, capture_output=True, text=True)
            self.assertEqual(missing.returncode, 2)
            self.assertIn("required: --size", missing.stderr)
            self.assertEqual(invalid.returncode, 2)
            self.assertIn("invalid choice", invalid.stderr)

        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            source = temporary / "input.png"
            self._opaque_source(source, (8, 4))
            generated = subprocess.run(
                commands[0][:-4] + ["--input", str(source), "--output", str(temporary / "out"), "--size", "16"],
                env=environment,
                capture_output=True,
                text=True,
            )
            extracted = subprocess.run(
                [*commands[1][:-3], str(source), "--output", str(temporary / "sprite.json"), "--size", "16"],
                env=environment,
                capture_output=True,
                text=True,
            )
            self.assertEqual(generated.returncode, 0, generated.stderr)
            self.assertEqual(extracted.returncode, 0, extracted.stderr)

    def test_accepts_only_real_static_png(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            static = root / "static.png"
            Image.new("RGBA", (2, 2), (1, 2, 3, 255)).save(static, format="PNG")
            self.assertEqual(load_rgba(static).size, (2, 2))

            renamed = root / "renamed.png"
            Image.new("RGB", (2, 2)).save(renamed, format="JPEG")
            with self.assertRaisesRegex(ValueError, "real PNG"):
                load_rgba(renamed)

            animated = root / "animated.png"
            frames = [Image.new("RGBA", (2, 2), color) for color in ((255, 0, 0, 255), (0, 0, 255, 255))]
            frames[0].save(animated, format="PNG", save_all=True, append_images=frames[1:], duration=100)
            with self.assertRaisesRegex(ValueError, "animated PNG"):
                load_rgba(animated)


if __name__ == "__main__":
    unittest.main()
