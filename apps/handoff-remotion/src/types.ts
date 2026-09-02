export type Timing = {
  startUs: number;
  endUs: number;
  firstFrame: number;
  endFrameExclusive: number;
};

export type Asset = {
  id: string;
  kind: 'video' | 'audio' | 'image';
  src: string;
  sha256?: string;
  size?: number;
  mimeType?: string;
  origin?: {
    type: 'v2-upload' | 'unresolved-cloud-resource';
    assetId?: string;
  };
  widthPx: number;
  heightPx: number;
};

export type Track = {
  id: string;
  kind: string;
  zIndex: number;
  visible: boolean;
  muted: boolean;
  solo: boolean;
  clipIds: string[];
};

export type AnimationSample = {
  positionXPx: number;
  positionYPx: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  opacity: number;
  color?: string;
  visibleText?: string;
};

export type Keyframe = {
  atUs: number;
  value: unknown;
  interpolation?: {type?: string};
};

export type Channel = {
  property: string;
  valueType: string;
  keyframes: Keyframe[];
};

export type BaseClip = {
  id: string;
  kind: 'video' | 'audio' | 'image' | 'text';
  trackId: string;
  timing: Timing;
};

export type MediaSource = {
  inUs: number;
  outUs: number;
  playbackRate: number;
  reverse: boolean;
};

export type VideoClip = BaseClip & {
  kind: 'video' | 'image';
  assetId: string;
  source: MediaSource;
  transform: {
    positionXPx: number;
    positionYPx: number;
    widthPx: number;
    heightPx: number;
    scaleX: number;
    scaleY: number;
    rotationDeg: number;
    opacity: number;
    anchor: {x: number; y: number};
    fit: 'contain' | 'cover' | 'stretch' | 'none';
    crop: {x: number; y: number; width: number; height: number};
  };
  animation: {channels: Channel[]};
};

export type AudioClip = BaseClip & {
  kind: 'audio';
  assetId: string;
  source: MediaSource;
  mix: {
    volume: number;
    pan: number;
    fadeInUs: number;
    fadeOutUs: number;
  };
  automation: {
    volume?: {time: number; value: number}[];
    pan?: {time: number; value: number}[];
  };
};

export type TextClip = BaseClip & {
  kind: 'text';
  content: {text: string};
  geometry: {
    anchor: {x: number; y: number};
  };
  style: {
    fontId: string;
    fontFamily: string;
    fontSizePx: number;
    fontWeight: number | string;
    fontStyle: string;
    fill:
      | {kind: 'solid'; color: string}
      | {kind: 'linear-gradient'; angleDeg: number; stops: {offset: number; color: string}[]};
    stroke: {color: string; widthPx: number};
    shadow: {color: string; blurPx: number; offsetXPx: number; offsetYPx: number};
    letterSpacingPx: number;
    lineHeightPx: number;
    textAlign: CanvasTextAlign;
    decoration: string;
  };
  baseTransform: {
    positionXPx: number;
    positionYPx: number;
    scaleX: number;
    scaleY: number;
    rotationDeg: number;
    opacity: number;
  };
  animation: {
    channels: Channel[];
    samples: {sampleRate: 'composition-frame'; values: AnimationSample[]};
  };
};

export type Font = {
  id: string;
  family: string;
  weight: number | string;
  style: string;
  src: string;
};

export type RenderHandoff = {
  schema: 'scrambo.render-ir.v1';
  rendererProfile: 'scrambo-remotion-scene-v1';
  composition: {
    widthPx: number;
    heightPx: number;
    fps: number;
    durationFrames: number;
    backgroundColor: string;
  };
  assets: Asset[];
  fonts: Font[];
  tracks: Track[];
  clips: (VideoClip | AudioClip | TextClip)[];
  audio: {masterVolume: number};
  compatibility: {unsupported: string[]};
};
