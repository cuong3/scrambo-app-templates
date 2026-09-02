import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectDir = path.dirname(fileURLToPath(import.meta.url));

const hashFile = async (file) => {
  const hash = createHash('sha256');
  hash.update(await readFile(file));
  return hash.digest('hex');
};

const mapLookup = (map, key) => {
  if (!map || !key) return undefined;
  return typeof map.get === 'function' ? map.get(key) : map[key];
};

const localAssetPath = async (asset, assets, resolveAsset) => {
  const explicitlyResolved = resolveAsset ? await resolveAsset(asset) : undefined;
  if (explicitlyResolved) return explicitlyResolved;
  if (asset.origin?.type === 'v2-upload') {
    return (
      mapLookup(assets?.byAssetId, asset.origin.assetId) ??
      mapLookup(assets?.bySha256, asset.sha256)
    );
  }
  if (asset.origin) return undefined;
  return asset.localPath;
};

export const renderScrambo = async ({handoff: sourceHandoff, output, assets, resolveAsset}) => {
  const handoff = structuredClone(sourceHandoff);
  if (handoff.schema !== 'scrambo.render-ir.v1') {
    throw new Error(`Unsupported handoff schema: ${handoff.schema}`);
  }
  if (handoff.rendererProfile !== 'scrambo-remotion-scene-v1') {
    throw new Error(`Unsupported renderer profile: ${handoff.rendererProfile}`);
  }
  if (handoff.compatibility?.unsupported?.length) {
    throw new Error(`Handoff contains unsupported features: ${handoff.compatibility.unsupported.join(', ')}`);
  }

  const outputPath = path.resolve(output);
  await mkdir(path.dirname(outputPath), {recursive: true});
  const stagingRoot = await mkdtemp(path.join(tmpdir(), 'scrambo-remotion-'));
  const publicDir = path.join(stagingRoot, 'public');
  await mkdir(path.join(publicDir, 'assets'), {recursive: true});
  await mkdir(path.join(publicDir, 'fonts'), {recursive: true});

  try {
    for (const asset of handoff.assets) {
      const resolved = await localAssetPath(asset, assets, resolveAsset);
      if (!resolved) {
        throw new Error(`Could not resolve local bytes for ${asset.id} (${asset.sha256})`);
      }
      const localPath = path.resolve(resolved);
      const fileStat = await stat(localPath);
      if (asset.size !== undefined && fileStat.size !== asset.size) {
        throw new Error(`Asset size mismatch for ${asset.id}: ${localPath}`);
      }
      const actualHash = await hashFile(localPath);
      if (actualHash !== asset.sha256) {
        throw new Error(`Asset hash mismatch for ${asset.id}: ${localPath}`);
      }
      const extension = path.extname(localPath) || '.bin';
      const relative = `assets/${asset.id}${extension}`;
      await copyFile(localPath, path.join(publicDir, relative));
      asset.src = relative;
    }

    for (const font of handoff.fonts) {
      if (!font.uri) throw new Error(`Font ${font.id} has no URI`);
      const response = await fetch(font.uri);
      if (!response.ok) throw new Error(`Could not fetch ${font.id}: HTTP ${response.status}`);
      const extension = path.extname(new URL(font.uri).pathname) || '.woff2';
      const relative = `fonts/${font.id}${extension}`;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (font.sha256) {
        const actualHash = createHash('sha256').update(bytes).digest('hex');
        if (actualHash !== font.sha256) throw new Error(`Font hash mismatch for ${font.id}`);
      }
      await writeFile(path.join(publicDir, relative), bytes);
      font.src = relative;
    }

    const inputProps = {handoff};
    const serveUrl = await bundle({
      entryPoint: path.join(projectDir, 'src/index.tsx'),
      rootDir: projectDir,
      publicDir,
    });
    const composition = await selectComposition({serveUrl, id: 'ScramboScene', inputProps});
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      audioCodec: 'aac',
      outputLocation: outputPath,
      inputProps,
      overwrite: true,
    });
    return outputPath;
  } finally {
    await rm(stagingRoot, {recursive: true, force: true});
  }
};
