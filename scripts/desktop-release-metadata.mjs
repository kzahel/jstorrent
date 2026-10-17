/** Read release metadata without buffering an unbounded remote response. */
export async function readReleaseMetadata(response, maximum = 65536) {
  if (!response.ok || !response.body) throw new Error('Cannot read release metadata');
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    await response.body.cancel();
    throw new Error('Oversized release metadata');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error('Oversized release metadata');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
