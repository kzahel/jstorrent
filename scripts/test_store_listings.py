import copy
import importlib.util
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parent))
spec = importlib.util.spec_from_file_location('store_listings', Path(__file__).with_name('store-listings.py'))
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)


class FakePlay:
    def __init__(self, listings, *, fail_commit=False, corrupt=False):
        self.listings = copy.deepcopy(listings)
        self.calls = []
        self.fail_commit = fail_commit
        self.corrupt = corrupt
        self.wrote = False

    def call(self, method, url, body=None):
        self.calls.append((method, url, copy.deepcopy(body)))
        if method == 'POST' and url.endswith('/edits'):
            self.draft = copy.deepcopy(self.listings)
            return {'id': 'owned-edit'}
        if method == 'GET' and url.endswith('/listings'):
            draft = copy.deepcopy(self.draft)
            if self.corrupt and self.wrote:
                draft['de-DE']['video'] = 'changed'
            return {'listings': list(draft.values())}
        if method in ('PATCH', 'PUT') and '/listings/' in url:
            language = url.rsplit('/', 1)[1]
            self.draft[language] = {**self.draft.get(language, {'language': language}), **body}
            self.wrote = True
            return self.draft[language]
        if ':commit?' in url:
            if self.fail_commit:
                raise RuntimeError('unknown outcome')
            self.listings = self.draft
            return {}
        if url.endswith(':validate') or method == 'DELETE':
            return {}
        raise AssertionError((method, url, body))


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.current = {
            'de-DE': {'language': 'de-DE', 'title': 'JSTorrent', 'shortDescription': 'Old', 'fullDescription': 'Old full', 'video': 'https://youtu.be/keep'},
            'fi-FI': {'language': 'fi-FI', 'title': 'Keep', 'shortDescription': 'Untouched', 'fullDescription': 'Untouched'},
        }
        self.desired = {'de-DE': {'title': 'JSTorrent', 'shortDescription': 'New', 'fullDescription': 'New full'},
                        'zh-TW': {'title': 'JSTorrent', 'shortDescription': 'Chinese', 'fullDescription': 'Chinese full'}}

    def test_export_and_diff_delete_without_committing(self):
        for operation in [lambda api: store.export_listings(api), lambda api: store.diff_listings(api, self.desired)]:
            api = FakePlay(self.current)
            operation(api)
            self.assertEqual(api.calls[-1][0], 'DELETE')
            self.assertFalse(any(':commit' in url for _, url, _ in api.calls))
            self.assertEqual(api.listings, self.current)

    def test_apply_patches_only_owned_fields_creates_language_and_preserves_other_data(self):
        api = FakePlay(self.current)
        receipt = store.apply_listings(api, self.desired, store.plan_changes(self.current, self.desired))
        self.assertEqual(receipt['status'], 'submitted')
        self.assertEqual(api.listings['de-DE']['video'], self.current['de-DE']['video'])
        self.assertEqual(api.listings['fi-FI'], self.current['fi-FI'])
        self.assertEqual(api.listings['zh-TW']['fullDescription'], 'Chinese full')
        mutations = [(method, url) for method, url, _ in api.calls if method in ('PATCH', 'PUT')]
        self.assertEqual([method for method, _ in mutations], ['PATCH', 'PUT'])
        self.assertTrue(all('/listings/' in url for _, url in mutations))
        self.assertIn('changesInReviewBehavior=ERROR_IF_IN_REVIEW', api.calls[-1][1])

    def test_remote_or_local_drift_refuses_before_writing(self):
        approved = store.plan_changes(self.current, self.desired)
        for remote, desired in [(dict(self.current, extra={'language': 'extra'}), self.desired),
                                (self.current, {'de-DE': {'title': 'Different'}})]:
            api = FakePlay(remote)
            with self.assertRaises(ValueError):
                store.apply_listings(api, desired, approved)
            self.assertFalse(api.wrote)
            self.assertFalse(any(':commit' in url for _, url, _ in api.calls))

    def test_noop_never_commits(self):
        desired = {'de-DE': {key: self.current['de-DE'][key] for key in store.FIELDS.values()}}
        api = FakePlay(self.current)
        self.assertEqual(store.apply_listings(api, desired, store.plan_changes(self.current, desired))['status'], 'unchanged')
        self.assertEqual(api.calls[-1][0], 'DELETE')

    def test_readback_corruption_discards_before_commit(self):
        api = FakePlay(self.current, corrupt=True)
        with self.assertRaisesRegex(ValueError, 'readback'):
            store.apply_listings(api, self.desired, store.plan_changes(self.current, self.desired))
        self.assertEqual(api.calls[-1][0], 'DELETE')
        self.assertFalse(any(':commit' in url for _, url, _ in api.calls))

    def test_uncertain_commit_is_never_retried_or_deleted(self):
        api = FakePlay(self.current, fail_commit=True)
        with self.assertRaisesRegex(RuntimeError, 'unknown outcome'):
            store.apply_listings(api, self.desired, store.plan_changes(self.current, self.desired))
        self.assertEqual(sum(':commit?' in url for _, url, _ in api.calls), 1)
        self.assertNotEqual(api.calls[-1][0], 'DELETE')

    def test_constraints_enforce_brand_length_and_exact_named_slots(self):
        for platform, locale, key, text in [('store', 'de', 'play_title', 'A different name'),
                                          ('store', 'de', 'play_short', 'x' * 81),
                                          ('extension', 'de', 'extension_summary', 'x' * 133),
                                          ('extension', 'de', 'metrics_summary', '{days} missing other arguments')]:
            workspace = store.localization.Workspace(store.ROOT, platform, locale)
            with self.assertRaises(ValueError):
                workspace.validate_values({key: text})


if __name__ == '__main__':
    unittest.main()
