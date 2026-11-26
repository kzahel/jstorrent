import assert from 'node:assert/strict';
import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const APP_ID = '6760584856';
export const BUNDLE_ID = 'com.jstorrent.ios';
const NOTARIZATION = 'NOTARIZATION';
const reviewInProgress = new Set(['WAITING_FOR_REVIEW', 'IN_REVIEW', 'COMPLETING']);
const reviewConflicted = new Set(['UNRESOLVED_ISSUES', 'CANCELING']);
const versionEditable = new Set(['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW']);

export function assertRelease(version, build) {
  assert(/^\d+\.\d+\.\d+$/.test(version ?? ''), 'expected numeric iOS release version');
  assert(/^[1-9]\d*$/.test(build ?? ''), 'expected positive integer build number');
}

export function describeAppleErrors(value) {
  if (value === null || typeof value !== 'object') return [];
  const message = typeof value.code === 'string' ? [`${value.code}: ${value.detail ?? value.title ?? ''}`] : [];
  return [...message, ...Object.values(value).flatMap(describeAppleErrors)];
}

export function appleClient(env = process.env) {
  const { ASC_API_KEY_ID: keyId, ASC_API_ISSUER_ID: issuer, ASC_API_KEY_PATH: path } = env;
  assert(keyId && issuer && path, 'App Store Connect credentials are required');
  const key = readFileSync(path);
  const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
  return async (path, { query, method = 'GET', data } = {}) => {
    const url = new URL(`https://api.appstoreconnect.apple.com/v1/${path}`);
    url.search = new URLSearchParams(query);
    const jwt = `${encode({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${encode({
      iss: issuer, exp: Math.floor(Date.now() / 1000) + 120, aud: 'appstoreconnect-v1',
    })}`;
    const signature = sign('sha256', Buffer.from(jwt), { key, dsaEncoding: 'ieee-p1363' });
    const response = await fetch(url, {
      method,
      redirect: 'error',
      headers: { Authorization: `Bearer ${jwt}.${signature.toString('base64url')}`, 'Content-Type': 'application/json' },
      body: data && JSON.stringify({ data }),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 204) return undefined;
    const body = await response.json();
    if (!response.ok) {
      const details = describeAppleErrors(body.errors).join('\n');
      throw new Error(`Apple ${method} ${path} returned ${response.status}${details ? `\n${details}` : ''}`);
    }
    assert(!body.links?.next, `Apple ${path} returned incomplete results`);
    return body.data;
  };
}

const reference = (type, id) => ({ data: { type, id } });

export async function releaseState(api, version, buildNumber) {
  assertRelease(version, buildNumber);
  const app = await api(`apps/${APP_ID}`, { query: { 'fields[apps]': 'bundleId' } });
  assert.equal(app.attributes.bundleId, BUNDLE_ID, 'unexpected App Store Connect app');
  const [versions, builds] = await Promise.all([
    api(`apps/${APP_ID}/appStoreVersions`, { query: {
      'filter[platform]': 'IOS', 'filter[versionString]': version, limit: '5',
      include: 'build,alternativeDistributionPackage',
      'fields[appStoreVersions]': 'versionString,reviewType,appVersionState,build,alternativeDistributionPackage',
    } }),
    api('builds', { query: {
      'filter[app]': APP_ID, 'filter[preReleaseVersion.platform]': 'IOS',
      'filter[preReleaseVersion.version]': version, 'filter[version]': buildNumber, limit: '5',
      'fields[builds]': 'version,processingState,expired',
    } }),
  ]);
  assert(versions.length <= 1 && versions.every(item => item.attributes.versionString === version), 'ambiguous Apple app version');
  assert(builds.length <= 1 && builds.every(item => item.attributes.version === buildNumber), 'ambiguous Apple build');
  return { version: versions[0], build: builds[0] };
}

function verifySelection(version, build) {
  assert.equal(version.attributes.reviewType, NOTARIZATION, 'Apple review type must be Notarization');
  const attached = version.relationships?.build?.data?.id;
  assert(!attached || attached === build.id, 'another build is attached to this version');
  return attached;
}

function reviewItems(api, submissionId) {
  return api(`reviewSubmissions/${submissionId}/items`, { query: {
    include: 'appStoreVersion', 'fields[reviewSubmissionItems]': 'appStoreVersion',
    'fields[appStoreVersions]': 'versionString', limit: '10',
  } });
}

export async function submitNotarization(api, number, buildNumber) {
  let { version, build } = await releaseState(api, number, buildNumber);
  assert(build?.attributes.processingState === 'VALID' && !build.attributes.expired, 'exact build must finish Apple processing before submission');
  if (!version) {
    version = await api('appStoreVersions', { method: 'POST', data: {
      type: 'appStoreVersions',
      attributes: { platform: 'IOS', versionString: number, reviewType: NOTARIZATION, usesIdfa: false },
      relationships: { app: reference('apps', APP_ID) },
    } });
  }
  const attached = verifySelection(version, build);
  if (attached && version.relationships?.alternativeDistributionPackage?.data?.id) {
    return 'Apple already notarized this exact build.';
  }

  const submissions = await api(`apps/${APP_ID}/reviewSubmissions`, { query: {
    'filter[platform]': 'IOS', limit: '50', 'fields[reviewSubmissions]': 'state,items',
  } });
  let draft;
  for (const submission of submissions) {
    const state = submission.attributes.state;
    assert(!reviewConflicted.has(state), `Apple review is ${state} and requires inspection`);
    if (state !== 'READY_FOR_REVIEW' && !reviewInProgress.has(state)) continue;
    const items = await reviewItems(api, submission.id);
    const matches = items.length === 1 && items[0].relationships?.appStoreVersion?.data?.id === version.id;
    if (matches && attached && reviewInProgress.has(state)) return `Apple review is already ${state}.`;
    assert(state === 'READY_FOR_REVIEW' && (matches || items.length === 0) && !draft,
      'another or ambiguous Apple review submission requires inspection');
    draft = { submission, matches };
  }
  assert(versionEditable.has(version.attributes.appVersionState), `Apple version is ${version.attributes.appVersionState}`);
  if (!attached) {
    await api(`appStoreVersions/${version.id}/relationships/build`, { method: 'PATCH', data: { type: 'builds', id: build.id } });
  }
  let submission = draft?.submission;
  if (!submission) {
    submission = await api('reviewSubmissions', { method: 'POST', data: {
      type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: reference('apps', APP_ID) },
    } });
  }
  if (!draft?.matches) {
    await api('reviewSubmissionItems', { method: 'POST', data: {
      type: 'reviewSubmissionItems', relationships: {
        reviewSubmission: reference('reviewSubmissions', submission.id),
        appStoreVersion: reference('appStoreVersions', version.id),
      },
    } });
  }
  const current = await releaseState(api, number, buildNumber);
  assert.equal(current.version?.id, version.id, 'Apple version changed before submission');
  assert.equal(verifySelection(current.version, build), build.id, 'Apple build attachment changed before submission');
  const items = await reviewItems(api, submission.id);
  assert(items.length === 1 && items[0].relationships?.appStoreVersion?.data?.id === version.id,
    'Apple submission includes another item');
  await api(`reviewSubmissions/${submission.id}`, { method: 'PATCH', data: {
    type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true },
  } });
  return `Submitted ${number} (${buildNumber}) for Notarization.`;
}

export async function getPackageId(api, version, buildNumber) {
  const state = await releaseState(api, version, buildNumber);
  assert(state.version && state.build, 'exact Apple version and build must exist');
  assert.equal(verifySelection(state.version, state.build), state.build.id, 'exact build must be attached');
  const id = state.version.relationships?.alternativeDistributionPackage?.data?.id;
  assert(id, `Apple package is unavailable (${state.version.attributes.appVersionState}). Retry after notarization.`);
  return id;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [operation, version, build] = process.argv.slice(2);
  try {
    const api = appleClient();
    if (operation === 'submit') console.log(await submitNotarization(api, version, build));
    else if (operation === 'package-id') console.log(await getPackageId(api, version, build));
    else if (operation === 'status') {
      const state = await releaseState(api, version, build);
      console.log(JSON.stringify({
        version: state.version?.attributes ?? null,
        build: state.build?.attributes ?? null,
        packageAvailable: Boolean(state.version?.relationships?.alternativeDistributionPackage?.data?.id),
      }, null, 2));
    } else throw new Error('usage: asc-notarization.mjs (status|submit|package-id) VERSION BUILD');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
