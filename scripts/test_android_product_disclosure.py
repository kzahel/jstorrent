"""First-use completion in the owned Android product smoke."""
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import Mock, patch
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "clients/android"))
import run_bootstrap as bootstrap


def nodes(xml):
    return list(ET.fromstring(xml).iter("node"))


class ProductDisclosureTest(unittest.TestCase):
    def test_opt_out_saves_with_fresh_geometry_then_observes_all_library(self):
        target = Mock()
        probe = SimpleNamespace(
            ui_nodes=Mock(side_effect=[
                nodes('<h><node text="All"/><node text="Save and continue"/>'
                      '<node checkable="true" checked="true" bounds="[1,2][3,4]"/></h>'),
                nodes('<h><node text="All"/><node text="Save and continue" bounds="[5,6][7,8]"/>'
                      '<node checkable="true" checked="false"/></h>'),
                nodes('<h><node text="All"/></h>'),
            ]),
            parse_bounds=Mock(return_value=(2, 3)),
            click_from_nodes=Mock(),
        )
        with patch.object(bootstrap.time, "monotonic", side_effect=[0, 0, 0, 0, 31]), \
             patch.object(bootstrap.time, "sleep"):
            bootstrap.dismiss_owned_product_disclosure(target, probe)
        self.assertEqual(probe.ui_nodes.call_count, 3)
        target.shell.assert_called_once_with(["input", "tap", "2", "3"])
        saved_nodes = probe.click_from_nodes.call_args.args[1]
        self.assertEqual(saved_nodes[1].attrib["bounds"], "[5,6][7,8]")
        self.assertEqual(probe.click_from_nodes.call_args.args[2], ["Save and continue"])

    def test_acknowledged_disclosure_reaches_current_library_without_taps(self):
        target = Mock()
        probe = Mock()
        probe.ui_nodes.return_value = nodes('<h><node text="All"/></h>')
        with patch.object(bootstrap.time, "monotonic", side_effect=[0, 0, 31]), \
             patch.object(bootstrap.time, "sleep"):
            bootstrap.dismiss_owned_product_disclosure(target, probe)
        self.assertEqual(probe.ui_nodes.call_count, 1)
        target.shell.assert_not_called()
        probe.click_from_nodes.assert_not_called()

    def test_missing_library_fails_at_existing_deadline(self):
        target = Mock()
        probe = Mock()
        probe.ui_nodes.return_value = nodes('<h><node text="Connecting"/></h>')
        with patch.object(bootstrap.time, "monotonic", side_effect=[0, 0, 31]), \
             patch.object(bootstrap.time, "sleep"):
            with self.assertRaisesRegex(bootstrap.BootstrapFailure, "did not reach"):
                bootstrap.dismiss_owned_product_disclosure(target, probe)
        target.shell.assert_not_called()


if __name__ == "__main__":
    unittest.main()
