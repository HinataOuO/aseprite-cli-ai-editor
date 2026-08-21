import tempfile
import unittest
from pathlib import Path

from pixel_pipeline import SpriteMatrix, extract_sprite, render_png


class RoundTripTests(unittest.TestCase):
    def test_matrix_png_extraction_is_exact(self):
        original = SpriteMatrix(
            width=32,
            height=16,
            palette=["#00000000", "#FF0000FF", "#00FF0080"],
            pixels=[
                [0 if (x + y) % 3 == 0 else 1 if x % 2 else 2 for x in range(32)]
                for y in range(16)
            ],
        )
        with tempfile.TemporaryDirectory() as directory:
            png = Path(directory) / "sprite.png"
            render_png(original, png)
            extracted = extract_sprite(png, size=32)
        self.assertEqual(extracted, original)


if __name__ == "__main__":
    unittest.main()
