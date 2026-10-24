import unittest
from chromeos_android_startup_profile import startup_measurement


class StartupMeasurementTests(unittest.TestCase):
    def test_incomplete_startup_is_not_ready(self):
        self.assertIsNone(startup_measurement(
            'product_startup stage=opening elapsed_ms=0\n'
            'product_startup stage=root_probe elapsed_ms=15000'))

    def test_provider_cost_is_distinct_from_wall_time(self):
        result = startup_measurement(
            'product_startup stage=opening elapsed_ms=0\n'
            'saf_startup_request operation=OBSERVE elapsed_ms=80\n'
            'saf_startup_request operation=OBSERVE elapsed_ms=100\n'
            'product_startup stage=ready elapsed_ms=120')
        self.assertEqual(result['stages_ms']['ready'], 120)
        self.assertEqual(result['provider_requests'],
                         {'OBSERVE': {'count': 2, 'total_ms': 180, 'max_ms': 100}})


if __name__ == '__main__':
    unittest.main()
