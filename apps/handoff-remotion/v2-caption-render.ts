import {mkdir, writeFile} from 'node:fs/promises';
import path, {extname} from 'node:path';

import {
  ScramboClient,
  StatefulSession,
} from '@scrambo/shared';
import {renderScrambo} from './render-scrambo.mjs';

function mimeType(filePath: string): string {
  const types: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  return types[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

const inputPaths = process.argv.slice(2);
if (inputPaths.length === 0) {
  throw new Error('Usage: pnpm caption:v2 <asset> [asset ...]');
}

const outputDir = path.resolve(process.env.SCRAMBO_RENDER_OUTPUT_DIR ?? 'output');
const handoffPath = path.join(outputDir, 'render_handoff.json');
const videoPath = path.join(outputDir, 'render_handoff.mp4');
await mkdir(outputDir, {recursive: true});

const client = ScramboClient.fromEnv();
const created = await client.createSession({project: 'handoff-remotion-v2'});
const session = new StatefulSession(client, created);
const progress = {onEvent: (event: {message: string}) => console.error(event.message)};

let handoff;
try {
  for (const inputPath of inputPaths) {
    await session.uploadFile(inputPath, mimeType(inputPath));
  }

  await session.edit({
    agent: 'source.work',
    message: `
Transcribe all spoken dialogue and inspect the uploaded footage. Prepare a
concise source brief grounded only in the uploaded media. Do not generate or
derive replacement media.
`,
    tools: ['transcribe'],
  }, progress);

  await session.edit({
    agent: 'timeline.author',
    message: `
Build a clean, concise timeline from the uploaded footage. Preserve the spoken
story, use only uploaded source media, and do not add graphics, titles, effects,
transitions, generated media, or speed changes.
`,
  }, progress);

  await session.edit({
    agent: 'timeline.captions',
    message: `
Add readable, well-timed captions for all spoken dialogue. Keep the visual
treatment compatible with a straightforward Remotion render handoff.
`,
  }, progress);

  handoff = await session.createRenderHandoff(progress);
  await writeFile(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`);
} finally {
  await session.close();
}

const rendered = await renderScrambo({
  handoff,
  output: videoPath,
  assets: session.localAssets,
});
console.log(`Render handoff: ${handoffPath}`);
console.log(`Rendered video: ${rendered}`);
