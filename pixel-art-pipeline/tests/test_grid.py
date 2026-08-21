import unittest

from PIL import Image

from pixel_pipeline.grid import extract_grid, proportional_dimensions


class GridTests(unittest.TestCase):
    def test_dominant_rgba_and_yx_coordinates(self):
        image = Image.new("RGBA", (4, 2))
        image.putdata(
            [
                (255, 0, 0, 255),
                (255, 0, 0, 255),
                (0, 255, 0, 128),
                (0, 0, 0, 0),
                (255, 0, 0, 255),
                (0, 0, 255, 255),
                (0, 255, 0, 128),
                (0, 255, 0, 128),
            ]
        )
        pixels = extract_grid(image, 2, 1)
        self.assertEqual(pixels[0][0], (255, 0, 0, 255))
        self.assertEqual(pixels[0][1], (0, 255, 0, 128))

    def test_non_divisible_dimensions_cover_proportional_cells(self):
        image = Image.new("RGBA", (5, 3))
        image.putdata(
            [(x * 10, y * 20, 0, 255) for y in range(3) for x in range(5)]
        )
        pixels = extract_grid(image, 3, 2)
        self.assertEqual(len(pixels), 2)
        self.assertEqual([len(row) for row in pixels], [3, 3])
        self.assertEqual(pixels[0][0], (0, 0, 0, 255))
        self.assertEqual(pixels[1][2], (30, 20, 0, 255))

    def test_center_sampling_selects_cell_centers(self):
        image = Image.new("RGBA", (4, 4))
        image.putdata(
            [(x, y, 0, 255) for y in range(image.height) for x in range(image.width)]
        )
        pixels = extract_grid(image, 2, 2, "center")
        self.assertEqual(
            pixels,
            [
                [(1, 1, 0, 255), (3, 1, 0, 255)],
                [(1, 3, 0, 255), (3, 3, 0, 255)],
            ],
        )

    def test_center_sampling_applies_independent_offsets(self):
        image = Image.new("RGBA", (6, 6))
        image.putdata(
            [(x, y, 0, 255) for y in range(image.height) for x in range(image.width)]
        )
        self.assertEqual(
            extract_grid(image, 1, 1, "center", 1, 0)[0][0], (4, 3, 0, 255)
        )
        self.assertEqual(
            extract_grid(image, 1, 1, "center", 0, -2)[0][0], (3, 1, 0, 255)
        )

    def test_rejects_invalid_sampling_options(self):
        image = Image.new("RGBA", (2, 2))
        with self.assertRaisesRegex(ValueError, "unknown sampling method"):
            extract_grid(image, 1, 1, "median")
        with self.assertRaisesRegex(TypeError, "offsets must be integers"):
            extract_grid(image, 1, 1, "center", 0.5, 0)
        with self.assertRaisesRegex(ValueError, "offsets require center"):
            extract_grid(image, 1, 1, "dominant", 1, 0)
        with self.assertRaisesRegex(ValueError, "outside image"):
            extract_grid(image, 1, 1, "center", 1, 0)

    def test_upsamples_input_with_nearest_neighbor(self):
        image = Image.new("RGBA", (2, 1))
        image.putdata([(255, 0, 0, 255), (0, 0, 255, 255)])
        self.assertEqual(
            extract_grid(image, 4, 2),
            [[(255, 0, 0, 255)] * 2 + [(0, 0, 255, 255)] * 2] * 2,
        )

    def test_proportional_dimensions_use_allowed_max_side_and_half_up_rounding(self):
        for size in (16, 32, 64, 128):
            self.assertEqual(proportional_dimensions(8, 4, size), (size, size // 2))
            self.assertEqual(proportional_dimensions(4, 8, size), (size // 2, size))
            self.assertEqual(proportional_dimensions(5, 5, size), (size, size))
        self.assertEqual(proportional_dimensions(32, 1, 16), (16, 1))
        self.assertEqual(proportional_dimensions(3, 2, 16), (16, 11))
        for invalid in (0, 15, 17, 256, True):
            with self.assertRaises(ValueError):
                proportional_dimensions(4, 2, invalid)


if __name__ == "__main__":
    unittest.main()
