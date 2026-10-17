import test from 'node:test';
import assert from 'node:assert/strict';
import { readReleaseMetadata } from './desktop-release-metadata.mjs';
test('bounded metadata refuses declared and streamed overflow and cancels the source', async () => {
  assert.deepEqual(await readReleaseMetadata(new Response('{"version":"0.3.2"}')), {version:'0.3.2'});
  await assert.rejects(readReleaseMetadata(new Response('{}',{headers:{'content-length':'65537'}})), /Oversized/);
  let canceled=false;
  const stream=new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(8192));},cancel(){canceled=true;}});
  await assert.rejects(readReleaseMetadata(new Response(stream)), /Oversized/);
  assert(canceled);
  await assert.rejects(readReleaseMetadata(new Response('{}',{status:500})), /Cannot read/);
});
