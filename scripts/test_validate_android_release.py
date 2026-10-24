import importlib.util
from pathlib import Path
import struct
import unittest

spec = importlib.util.spec_from_file_location('validate_android', Path(__file__).with_name('validate-android-release.py'))
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class ArtifactTests(unittest.TestCase):
    manifest = '''<manifest xmlns:android="http://schemas.android.com/apk/res/android"
        package="com.jstorrent.app" android:versionName="0.1.0" android:versionCode="1">
        <uses-sdk android:minSdkVersion="28" android:targetSdkVersion="36"/>
        <application android:debuggable="false">
          <activity-alias android:name="com.jstorrent.app.MainActivity"
              android:targetActivity="org.rstorrent.bootstrap.MainActivity" android:exported="true">
            <intent-filter><action android:name="android.intent.action.MAIN"/>
              <category android:name="android.intent.category.LAUNCHER"/></intent-filter>
          </activity-alias>
        </application></manifest>'''

    def test_rejects_bootstrap_debug_or_diagnostic_release(self):
        validator.check_manifest(self.manifest, '0.1.0', 1)
        for text in (self.manifest.replace('com.jstorrent.app', 'org.rstorrent.bootstrap'),
                     self.manifest.replace('debuggable="false"', 'debuggable="true"'),
                     self.manifest.replace('</application>',
                         '<receiver android:name="org.rstorrent.bootstrap.CommandReceiver"/></application>'),
                     self.manifest.replace('versionCode="1"', 'versionCode="2"')):
            with self.assertRaises(AssertionError):
                validator.check_manifest(text, '0.1.0', 1)

    def test_rejects_lost_or_duplicate_launcher(self):
        for text in (self.manifest.replace('com.jstorrent.app.MainActivity', 'org.rstorrent.bootstrap.MainActivity'),
                     self.manifest.replace('android.intent.category.LAUNCHER', 'android.intent.category.DEFAULT'),
                     self.manifest.replace('android:exported="true"', 'android:exported="false"'),
                     self.manifest.replace('</intent-filter>', '</intent-filter><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>')):
            with self.assertRaises(AssertionError):
                validator.check_manifest(text, '0.1.0', 1)

    def test_native_alignment(self):
        elf = bytearray(120)
        elf[:6] = b'\x7fELF\x02\x01'
        struct.pack_into('<Q', elf, 32, 64)
        struct.pack_into('<HH', elf, 54, 56, 1)
        struct.pack_into('<I', elf, 64, 1)
        for alignment in (16384, 65536):
            struct.pack_into('<Q', elf, 112, alignment)
            validator.check_elf(elf, 'fixture')
        for alignment in (0, 4096, 20000):
            struct.pack_into('<Q', elf, 112, alignment)
            with self.assertRaises(AssertionError):
                validator.check_elf(elf, 'fixture')

    def test_resolved_application_labels(self):
        manifest = self.manifest.replace('<application ', '<application android:label="@string/app_name" ')
        badging = "application-label:'JSTorrent'\napplication-label-de:'JSTorrent'\n"
        resources = 'Package \'com.jstorrent.app\':\n0x7f0c003d - string/app_name\n\t(default) - [STR] "JSTorrent"\n'
        validator.check_application_labels(badging, manifest, resources)
        for apk, bundle, names in (
            (badging.replace('JSTorrent', 'RSTorrent Canary'), manifest, resources),
            (badging.replace("application-label-de:'JSTorrent'", "application-label-de:'Canary'"), manifest, resources),
            ('', manifest, resources),
            (badging, manifest.replace('@string/app_name', '@string/canary_name'), resources),
            (badging, manifest, resources.replace('JSTorrent', 'RSTorrent Canary')),
            (badging, manifest, ''),
            (badging, manifest, resources + '\t(de) - [STR] "Canary"\n'),
        ):
            with self.subTest(apk=apk, manifest=bundle, resources=names):
                with self.assertRaises(AssertionError):
                    validator.check_application_labels(apk, bundle, names)


if __name__ == '__main__':
    unittest.main()
