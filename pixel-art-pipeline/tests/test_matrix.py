import tempfile
import unittest
from pathlib import Path

from pixel_pipeline import SpriteMatrix


class MatrixTests(unittest.TestCase):
    def setUp(self):
        self.sprite = SpriteMatrix(
            width=2,
            height=1,
            palette=["#00000000", "#FFFFFFFF"],
            pixels=[[0, 1]],
            metadata={"name": "test"},
        )

    def test_json_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sprite.json"
            self.sprite.save(path)
            self.assertEqual(SpriteMatrix.load(path), self.sprite)

    def test_rejects_wrong_dimensions(self):
        self.sprite.width = 3
        with self.assertRaises(ValueError):
            self.sprite.validate()

    def test_rejects_aseprite_limits_and_missing_metadata(self):
        with self.assertRaises(ValueError):
            SpriteMatrix(width=129, height=1, palette=["#00000000"], pixels=[[0] * 129]).validate()
        with self.assertRaises(ValueError):
            SpriteMatrix(width=1, height=1, palette=["#00000000"] * 257, pixels=[[0]]).validate()
        with self.assertRaises(ValueError):
            SpriteMatrix.from_dict({"version": 1, "width": 1, "height": 1, "palette": ["#00000000"], "pixels": [[0]]})

    def test_rejects_invalid_color(self):
        self.sprite.palette[0] = "#000000"
        with self.assertRaises(ValueError):
            self.sprite.validate()

    def test_rejects_invalid_index(self):
        self.sprite.pixels[0][0] = 2
        with self.assertRaises(ValueError):
            self.sprite.validate()


if __name__ == "__main__":
    unittest.main()
