import {readFile} from 'node:fs/promises';
import path from 'node:path';

import {renderScrambo} from './render-scrambo.mjs';

const [handoffArg, outputArg] = process.argv.slice(2);
if (!handoffArg) {
  throw new Error('Usage: pnpm render <render_handoff.json> [output.mp4]');
}

const handoffPath = path.resolve(handoffArg);
const outputPath = path.resolve(
  outputArg ?? path.join(path.dirname(handoffPath), 'render_handoff.mp4'),
);
const handoff = JSON.parse(await readFile(handoffPath, 'utf8'));
console.log(await renderScrambo({handoff, output: outputPath}));
