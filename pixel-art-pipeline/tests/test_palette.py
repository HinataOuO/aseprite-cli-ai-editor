import unittest

from pixel_pipeline.palette import extract_palette


class PaletteTests(unittest.TestCase):
    def test_first_appearance_order_and_indexes(self):
        transparent = (0, 0, 0, 0)
        red = (255, 0, 0, 255)
        palette, pixels = extract_palette([[transparent, red], [red, transparent]])
        self.assertEqual(palette, [transparent, red])
        self.assertEqual(pixels, [[0, 1], [1, 0]])

    def test_quantization_respects_max_colors(self):
        colors = [[(value, value, value, 255) for value in range(0, 240, 20)]]
        palette, pixels = extract_palette(colors, max_colors=4)
        self.assertLessEqual(len(palette), 4)
        self.assertTrue(all(0 <= index < len(palette) for index in pixels[0]))

    def test_quantization_keeps_transparency(self):
        colors = [[(0, 0, 0, 0), (255, 0, 0, 255), (0, 255, 0, 255)]]
        palette, _ = extract_palette(colors, max_colors=2)
        self.assertIn(0, [color[3] for color in palette])

    def test_rejects_invalid_limit(self):
        with self.assertRaises(ValueError):
            extract_palette([[(0, 0, 0, 255)]], max_colors=0)


if __name__ == "__main__":
    unittest.main()
