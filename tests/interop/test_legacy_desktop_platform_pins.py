"""Architecture mismatches must fail before any installed-state mutation."""
import unittest
from pathlib import Path
from unittest.mock import patch

from legacy_desktop_platform_rehearsal import inspect_debian_candidate, linux_legacy_pins


class LegacyArchitecturePins(unittest.TestCase):
    def test_native_arm_never_substitutes_x64_package_or_helpers(self):
        arm_package, arm_helpers = linux_legacy_pins("aarch64")
        x64_package, x64_helpers = linux_legacy_pins("x86_64")
        self.assertNotEqual(arm_package, x64_package)
        self.assertTrue(set(arm_helpers).isdisjoint(x64_helpers))
        self.assertEqual(linux_legacy_pins("arm64"), (arm_package, arm_helpers))

    def test_unsupported_architecture_is_refused(self):
        for machine in ("", "i686", "armv7l", "riscv64"):
            with self.assertRaisesRegex(ValueError, "unsupported"):
                linux_legacy_pins(machine)

    def test_debian_wrong_platform_or_updater_refuses_before_package_command(self):
        with patch("legacy_desktop_platform_rehearsal.subprocess.check_output") as command:
            for platform, architecture, trial in (
                ("windows", "aarch64", False), ("macos", "aarch64", False),
                ("linux", "aarch64", True), ("linux", "riscv64", False),
            ):
                with self.assertRaises(ValueError):
                    inspect_debian_candidate(platform, architecture, trial, Path("candidate.deb"))
            command.assert_not_called()

    def test_debian_native_architecture_mismatch_refuses(self):
        with patch("legacy_desktop_platform_rehearsal.subprocess.check_output", return_value="amd64\n"):
            with self.assertRaisesRegex(ValueError, "does not match"):
                inspect_debian_candidate("linux", "aarch64", False, Path("candidate.deb"))

    def test_debian_metadata_command_is_bounded_and_literal(self):
        package = Path("/tmp/owned package/candidate.deb")
        with patch("legacy_desktop_platform_rehearsal.subprocess.check_output", return_value="arm64\n") as command:
            self.assertEqual(inspect_debian_candidate("linux", "aarch64", False, package), "arm64")
            command.assert_called_once_with(
                ["dpkg-deb", "--field", str(package), "Architecture"], text=True, timeout=15)


if __name__ == "__main__":
    unittest.main()
