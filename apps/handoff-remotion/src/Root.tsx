import React from 'react';
import {Composition} from 'remotion';
import {ScramboScene} from './ScramboScene';
import type {RenderHandoff} from './types';

const emptyHandoff: RenderHandoff = {
  schema: 'scrambo.render-ir.v1',
  rendererProfile: 'scrambo-remotion-scene-v1',
  composition: {
    widthPx: 1920,
    heightPx: 1080,
    fps: 30,
    durationFrames: 1,
    backgroundColor: '#000000',
  },
  assets: [],
  fonts: [],
  tracks: [],
  clips: [],
  audio: {masterVolume: 1},
  compatibility: {unsupported: []},
};

export const Root: React.FC = () => (
  <Composition
    id="ScramboScene"
    component={ScramboScene}
    width={1920}
    height={1080}
    fps={30}
    durationInFrames={1}
    defaultProps={{handoff: emptyHandoff}}
    calculateMetadata={({props}) => ({
      width: props.handoff.composition.widthPx,
      height: props.handoff.composition.heightPx,
      fps: props.handoff.composition.fps,
      durationInFrames: props.handoff.composition.durationFrames,
    })}
  />
);

