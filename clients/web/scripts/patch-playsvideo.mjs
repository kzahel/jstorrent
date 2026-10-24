// Bounded, independently authored product adaptations of MIT playsvideo 0.4.7.
// Fail closed if the pinned upstream files change. See Tacticals 313 and 362 / notices.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = new URL("../node_modules/playsvideo/dist/", import.meta.url);
const replacements = {
  "index.js": [
    [
      "export { WasmFfmpegRunner } from './adapters/wasm-ffmpeg.js';",
      "// FFmpeg is deliberately outside this product integration.",
    ],
    [
      "export { createCustomControls } from './custom-controls.js';",
      "// Native media controls are used by this product integration.",
    ],
  ],
  "engine.js": [
    [
      "import { WasmFfmpegRunner } from './adapters/wasm-ffmpeg.js';",
      "const unavailableWorker = () => { throw new Error('Worker playback is not supported by this integration.'); };",
    ],
    [
      "new WasmFfmpegRunner()",
      "{ run: async () => { throw new Error('Audio transcoding is not supported by this integration.'); } }",
    ],
    [
      "new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })",
      "unavailableWorker()",
    ],
    [
      "new Worker(new URL('./transcode-worker.js', import.meta.url), {\n                type: 'module',\n            })",
      "unavailableWorker()",
    ],
    [
      "enableWorker: false,",
      "enableWorker: false,\n            maxBufferLength: 12, maxMaxBufferLength: 12, maxBufferSize: 16 * 1024 * 1024, backBufferLength: 8, frontBufferFlushThreshold: 16,",
    ],
    [
      "this._sourceDemux = await demuxSource(source);",
      "const openedDemux = await demuxSource(source);\n            if (this._source !== source) { openedDemux.dispose(); return; }\n            this._sourceDemux = openedDemux;",
    ],
    [
      "this._sourceDoTranscode = hlsEvaluation.pipelineAudioRequiresTranscode === true;",
      "if (hlsEvaluation.pipelineAudioRequiresTranscode) throw new Error('This audio codec needs transcoding, which video playback does not support yet.');\n            this._sourceDoTranscode = false;",
    ],
    [
      "const seg0Result = await processSegmentWithAbort(this.makeSourceProcessorConfig(), 0);",
      "const seg0Result = await processSegmentWithAbort(this.makeSourceProcessorConfig(), 0);\n            if (this._source !== source) return;\n            if (seg0Result.mediaData.length > 16 * 1024 * 1024) throw new Error('Video segment exceeds the playback memory limit.');",
    ],
  ],
  "pipeline/segment-processor.js": [
    [
      "const mediaData = new Uint8Array(totalLen);",
      "if (totalLen > 16 * 1024 * 1024) throw new Error('Video segment exceeds the playback memory limit.');\n    const mediaData = new Uint8Array(totalLen);",
    ],
  ],
  "pipeline/demux.js": [
    ["import { ALL_FORMATS,", "import { MP4, MATROSKA, ALL_FORMATS,"],
    [
      "formats: ALL_FORMATS, source: new SourceAdapter(source)",
      "formats: [MP4, MATROSKA], source: new SourceAdapter(source)",
    ],
    [
      "const duration = Number(await videoTrack.computeDuration());",
      "let duration = Number(await videoTrack.computeDuration());\n    const audioDuration = audioTrack ? Number(await audioTrack.computeDuration()) : duration;\n    if (Number.isFinite(audioDuration) && audioDuration > 0 && audioDuration < duration && duration - audioDuration <= 1) duration = audioDuration;\n    if (!Number.isFinite(duration) || duration <= 0 || duration > 12 * 60 * 60) throw new Error('Video duration is outside the supported playback limit.');",
    ],
    [
      "while (packet) {\n        const ts = packet.timestamp;",
      "while (packet) {\n        if (keyframes.length >= 100000) throw new Error('Video keyframe index exceeds the playback limit.');\n        const ts = packet.timestamp;",
    ],
  ],
};
// Populated from the published tarball, never from a deployed mutable checkout.
const hashes = {
  "index.js": {
    "original": "20fbbc79f222faf6e39e1395aa977755d525c0f686f5f447ce7adaeb614cfa41",
    "patched": "2a4c1ca1ea82957df21168f06bb09a8613bdb994f1fb3811f9ba58e9cf45a061"
  },
  "engine.js": {
    "original": "6bfc1b795920ecb6564ceac84f0f6d6e6c42d1b0e20f0879de8b6adc0280487c",
    "patched": "ddfc185177199cc8303e5c811ca58e58aa05b18fef1cce3f1da4adc1eb899be5"
  },
  "pipeline/segment-processor.js": {
    "original": "2a85323798bc38b1116077effab7df567ceb23df14d2ccb7282d318074f9310d",
    "patched": "12da06c577465c38eee2eaccea7c2bd85e0e9ceb1a3368b222e1c284ecf2837d"
  },
  "pipeline/demux.js": {
    "original": "862f2650aa491538d49f25e8cfca68d465582cd6e99723bb5e18d7442ae5335e",
    "patched": "2ce2622428c21f60e3d56b47edf01d29b04a2765c9866c7b8446354d65f4912f"
  }
};
// Earlier patch outputs left in existing installs, with the edits that bring
// each to the current output without reinstalling the package.
const upgrades = {
  "engine.js": {
    "patched": "4835fc83c9170682a330d3f939240f0e8ef7bb1e080573806607ee179839ad40",
    "edits": [
      ["which remote playback does not support yet.", "which video playback does not support yet."],
    ],
  },
  "pipeline/demux.js": {
    "patched": "728e2b1589ef31ee65f4aa373751b1a5eb55651daecbf45a59b730d627944142",
    "edits": [
      ["import { MP4, ALL_FORMATS,", "import { MP4, MATROSKA, ALL_FORMATS,"],
      ["formats: [MP4], source", "formats: [MP4, MATROSKA], source"],
    ],
  },
};
function applyEdits(path, code, edits) {
  for (const [before, after] of edits) {
    if (code.split(before).length !== 2)
      throw new Error(`Ambiguous playsvideo patch: ${path}`);
    code = code.replace(before, after);
  }
  return code;
}
for (const [path, edits] of Object.entries(replacements)) {
  const url = new URL(path, base);
  let code = await readFile(url, "utf8");
  const hash = createHash("sha256").update(code).digest("hex");
  if (hash === hashes[path].patched) continue;
  const upgrade = upgrades[path];
  if (upgrade !== undefined && hash === upgrade.patched) {
    code = applyEdits(path, code, upgrade.edits);
    if (createHash("sha256").update(code).digest("hex") !== hashes[path].patched)
      throw new Error("Invalid playsvideo patch upgrade output");
    await writeFile(url, code);
    continue;
  }
  if (hash !== hashes[path].original)
    throw new Error(`Unexpected playsvideo source: ${path}`);
  code = applyEdits(path, code, edits);
  if (createHash("sha256").update(code).digest("hex") !== hashes[path].patched)
    throw new Error("Invalid playsvideo patch output");
  await writeFile(url, code);
}
