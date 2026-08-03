import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repoRoot);
const { streamResponseToFile } = await import('./prepare-runtime-cache.mjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gamedeck-runtime-limit-'));

async function expectSizeLimit(promise) {
  await assert.rejects(promise, error => {
    assert.equal(error?.code, 'ERR_RUNTIME_SIZE_LIMIT');
    assert.match(String(error?.message || ''), /safety limit/i);
    return true;
  });
}

try {
  const advertisedTarget = path.join(root, 'advertised.part');
  await expectSizeLimit(streamResponseToFile(
    new Response(Uint8Array.from([1]), { headers: { 'content-length': '9' } }),
    advertisedTarget,
    { label: 'Advertised package', maxBytes: 8 }
  ));
  assert.equal(fs.existsSync(advertisedTarget), false, 'advertised oversize partial must be removed');

  const understatedTarget = path.join(root, 'understated.part');
  const understatedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from([1, 2, 3, 4]));
      controller.enqueue(Uint8Array.from([5, 6, 7, 8, 9]));
      controller.close();
    }
  });
  await expectSizeLimit(streamResponseToFile(
    new Response(understatedBody, { headers: { 'content-length': '4' } }),
    understatedTarget,
    { label: 'Understated package', maxBytes: 8 }
  ));
  assert.equal(fs.existsSync(understatedTarget), false, 'streamed oversize partial must be removed');

  const boundaryTarget = path.join(root, 'boundary.part');
  const boundaryBody = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.from([1, 2, 3, 4]));
      controller.enqueue(Uint8Array.from([5, 6, 7, 8]));
      controller.close();
    }
  });
  const result = await streamResponseToFile(
    new Response(boundaryBody, { headers: { 'content-length': '4' } }),
    boundaryTarget,
    { label: 'Boundary package', maxBytes: 8 }
  );
  assert.equal(result.received, 8);
  assert.equal(fs.statSync(boundaryTarget).size, 8, 'exact boundary should succeed');

  console.log('Runtime cache streamed-byte limit test passed.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
