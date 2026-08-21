import unittest

from pixel_pipeline.artifacts import cleanup_artifacts


BG = (20, 30, 40, 255)
INK = (220, 80, 60, 255)


class ArtifactCleanupTests(unittest.TestCase):
    def test_normalizes_background_and_removes_small_components(self):
        colors = [[BG for _ in range(7)] for _ in range(5)]
        colors[0][3] = (24, 27, 42, 255)
        for x, y in ((1, 1), (2, 1), (1, 2), (2, 2)):
            colors[y][x] = INK
        colors[2][5] = INK
        colors[3][5] = INK

        cleaned = cleanup_artifacts(
            colors, background_tolerance=4, min_component_pixels=3, prune_passes=0
        )

        self.assertEqual(cleaned[0][3], (0, 0, 0, 0))
        self.assertEqual(cleaned[1][1], INK)
        self.assertEqual(cleaned[2][5], (0, 0, 0, 0))
        self.assertEqual(cleaned[3][5], (0, 0, 0, 0))

    def test_uses_eight_way_components_and_prunes_only_endpoints(self):
        colors = [[BG for _ in range(7)] for _ in range(5)]
        for x, y in ((1, 1), (2, 2), (3, 3)):
            colors[y][x] = INK
        connected = cleanup_artifacts(
            colors, background_tolerance=0, min_component_pixels=3, prune_passes=0
        )
        self.assertEqual([connected[1][1], connected[2][2], connected[3][3]], [INK] * 3)

        colors = [[BG for _ in range(7)] for _ in range(5)]
        for x, y in ((1, 1), (2, 1), (1, 2), (2, 2), (3, 2), (4, 2)):
            colors[y][x] = INK
        pruned = cleanup_artifacts(
            colors, background_tolerance=0, min_component_pixels=0, prune_passes=1
        )
        self.assertEqual(pruned[2][4], (0, 0, 0, 0))
        self.assertEqual(pruned[1][1], INK)
        self.assertEqual(pruned[2][3], INK)

    def test_preserves_transparency_and_is_deterministic(self):
        transparent = (0, 0, 0, 0)
        colors = [[transparent for _ in range(4)] for _ in range(4)]
        colors[0][2] = (3, 2, 1, 0)
        for x, y in ((1, 1), (2, 1), (1, 2), (2, 2)):
            colors[y][x] = INK

        first = cleanup_artifacts(
            colors, background_tolerance=3, min_component_pixels=4, prune_passes=1
        )
        second = cleanup_artifacts(
            colors, background_tolerance=3, min_component_pixels=4, prune_passes=1
        )

        self.assertEqual(first, second)
        self.assertEqual(first, colors)
        self.assertEqual(first[0][2], (3, 2, 1, 0))
        self.assertEqual(first[1][1], INK)

    def test_only_removes_compatible_background_connected_to_border(self):
        near = (22, 30, 40, 255)
        colors = [[BG for _ in range(5)] for _ in range(5)]
        for x, y in ((2, 1), (1, 2), (3, 2), (2, 3)):
            colors[y][x] = INK
        colors[2][2] = near
        cleaned = cleanup_artifacts(colors, background_tolerance=2)
        self.assertEqual(cleaned[2][2], near)
        self.assertEqual(cleaned[4][4], (0, 0, 0, 0))

    def test_rejects_negative_thresholds_and_multiple_prune_passes(self):
        with self.assertRaises(ValueError):
            cleanup_artifacts([[BG]], background_tolerance=-1)
        with self.assertRaises(ValueError):
            cleanup_artifacts([[BG]], min_component_pixels=-1)
        with self.assertRaises(ValueError):
            cleanup_artifacts([[BG]], prune_passes=2)


if __name__ == "__main__":
    unittest.main()
