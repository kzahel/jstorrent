import assert from 'node:assert/strict';
import test from 'node:test';
import { APP_ID, BUNDLE_ID, getPackageId, submitNotarization } from './asc-notarization.mjs';

function apple({ reviewType = 'NOTARIZATION', attached, build = '10', existingReview, packageId } = {}) {
  const writes = [];
  let version;
  if (reviewType) {
    version = {
      id: 'version-id', attributes: { versionString: '1.0.8', reviewType, appVersionState: 'PREPARE_FOR_SUBMISSION' },
      relationships: { build: { data: attached && { id: attached } }, alternativeDistributionPackage: { data: packageId && { id: packageId } } },
    };
  }
  let items = existingReview ? [{ relationships: { appStoreVersion: { data: { id: 'version-id' } } } }] : [];
  const api = async (path, { query = {}, method = 'GET', data } = {}) => {
    if (method === 'GET') {
      switch (path) {
        case `apps/${APP_ID}`: return { attributes: { bundleId: BUNDLE_ID } };
        case `apps/${APP_ID}/appStoreVersions`: return version ? [version] : [];
        case 'builds':
          assert.equal(query['filter[preReleaseVersion.version]'], '1.0.8');
          assert.equal(query['filter[version]'], '10');
          return [{ id: 'exact-build', attributes: { version: build, processingState: 'VALID' } }];
        case `apps/${APP_ID}/reviewSubmissions`:
          return existingReview ? [{ id: 'submission', attributes: { state: existingReview } }] : [];
        case 'reviewSubmissions/submission/items': return items;
        default: throw new Error(`unexpected Apple read ${path}`);
      }
    }
    writes.push({ path, method, data });
    switch (path) {
      case 'appStoreVersions':
        assert.equal(data.attributes.reviewType, 'NOTARIZATION');
        version = { id: 'version-id', attributes: { ...data.attributes, appVersionState: 'PREPARE_FOR_SUBMISSION' }, relationships: {} };
        return version;
      case 'appStoreVersions/version-id/relationships/build':
        version.relationships.build = { data };
        break;
      case 'reviewSubmissions': return { id: 'submission' };
      case 'reviewSubmissionItems': items = [{ relationships: data.relationships }]; break;
      case 'reviewSubmissions/submission': assert.equal(data.attributes.submitted, true); break;
      default: throw new Error(`unexpected Apple write ${path}`);
    }
  };
  return { api, writes };
}

test('creates notarization, attaches the exact build, then submits its sole review item', async () => {
  const { api, writes } = apple({ reviewType: false });
  assert.match(await submitNotarization(api, '1.0.8', '10'), /Submitted .* for Notarization/);
  assert.deepEqual(writes.map(({ path }) => path), [
    'appStoreVersions', 'appStoreVersions/version-id/relationships/build', 'reviewSubmissions',
    'reviewSubmissionItems', 'reviewSubmissions/submission',
  ]);
});

test('refuses a wrong version mode, attached build, or returned build before writing', async () => {
  for (const [options, error] of [
    [{ reviewType: 'APP_STORE' }, /must be Notarization/],
    [{ attached: 'another-build' }, /another build is attached/],
    [{ build: '11' }, /ambiguous Apple build/],
  ]) {
    const { api, writes } = apple(options);
    await assert.rejects(submitNotarization(api, '1.0.8', '10'), error);
    assert.deepEqual(writes, []);
  }
});

test('resumes a matching draft or recognizes a submission already in review', async () => {
  const draft = apple({ attached: 'exact-build', existingReview: 'READY_FOR_REVIEW' });
  await submitNotarization(draft.api, '1.0.8', '10');
  assert.deepEqual(draft.writes.map(({ path }) => path), ['reviewSubmissions/submission']);
  const submitted = apple({ attached: 'exact-build', existingReview: 'IN_REVIEW' });
  assert.match(await submitNotarization(submitted.api, '1.0.8', '10'), /already IN_REVIEW/);
  assert.deepEqual(submitted.writes, []);
});

test('only yields package IDs for the requested notarized build', async () => {
  const ready = apple({ attached: 'exact-build', packageId: 'package' });
  assert.equal(await getPackageId(ready.api, '1.0.8', '10'), 'package');
  const pending = apple({ attached: 'exact-build' });
  await assert.rejects(getPackageId(pending.api, '1.0.8', '10'), /package is unavailable/);
  const wrong = apple({ attached: 'another-build', packageId: 'package' });
  await assert.rejects(getPackageId(wrong.api, '1.0.8', '10'), /another build is attached/);
});
