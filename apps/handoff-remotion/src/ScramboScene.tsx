import React, {useEffect, useMemo, useState} from 'react';
import {
  AbsoluteFill,
  Audio,
  cancelRender,
  continueRender,
  delayRender,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type {
  AnimationSample,
  Asset,
  AudioClip,
  Channel,
  RenderHandoff,
  TextClip,
  Track,
  VideoClip,
} from './types';

const Fonts: React.FC<{handoff: RenderHandoff}> = ({handoff}) => {
  const [handle] = useState(() => delayRender('Loading Scrambo handoff fonts'));

  useEffect(() => {
    Promise.all(
      handoff.fonts.map(async (font) => {
        const face = new FontFace(font.family, `url(${staticFile(font.src)})`, {
          weight: String(font.weight),
          style: font.style,
        });
        await face.load();
        (document.fonts as FontFaceSet & {add(font: FontFace): void}).add(face);
      }),
    )
      .then(() => continueRender(handle))
      .catch((error: unknown) => cancelRender(error));
  }, [handle, handoff.fonts]);

  return null;
};

const easing = (value: number, name = 'linear'): number => {
  if (name === 'ease-in') return value * value;
  if (name === 'ease-out') return 1 - (1 - value) * (1 - value);
  if (name === 'ease-in-out') {
    return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
  }
  return value;
};

const channelValue = (channel: Channel | undefined, localUs: number, fallback: number): number => {
  if (!channel || channel.keyframes.length === 0) return fallback;
  const keyframes = channel.keyframes;
  if (localUs <= keyframes[0].atUs) return Number(keyframes[0].value);
  if (localUs >= keyframes[keyframes.length - 1].atUs) {
    return Number(keyframes[keyframes.length - 1].value);
  }
  const leftIndex = keyframes.findIndex((keyframe, index) => {
    const right = keyframes[index + 1];
    return right && localUs >= keyframe.atUs && localUs < right.atUs;
  });
  const left = keyframes[leftIndex];
  const right = keyframes[leftIndex + 1];
  const progress = (localUs - left.atUs) / (right.atUs - left.atUs);
  const eased = easing(progress, left.interpolation?.type);
  return Number(left.value) + (Number(right.value) - Number(left.value)) * eased;
};

const findChannel = (channels: Channel[], property: string): Channel | undefined =>
  channels.find((channel) => channel.property === property);

const cropStyle = (clip: VideoClip): React.CSSProperties => {
  const crop = clip.transform.crop;
  const objectFit = clip.transform.fit === 'stretch' ? 'fill' : clip.transform.fit;
  if (crop.x === 0 && crop.y === 0 && crop.width === 1 && crop.height === 1) {
    return {width: '100%', height: '100%', objectFit};
  }
  return {
    position: 'absolute',
    width: `${100 / crop.width}%`,
    height: `${100 / crop.height}%`,
    left: `${(-100 * crop.x) / crop.width}%`,
    top: `${(-100 * crop.y) / crop.height}%`,
    objectFit,
  };
};

const VisualMedia: React.FC<{clip: VideoClip; asset: Asset}> = ({clip, asset}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localUs = (frame / fps) * 1_000_000;
  const channels = clip.animation.channels;
  const transform = clip.transform;
  const positionX = channelValue(findChannel(channels, 'position.x'), localUs, transform.positionXPx);
  const positionY = channelValue(findChannel(channels, 'position.y'), localUs, transform.positionYPx);
  const scaleX = channelValue(findChannel(channels, 'scale.x'), localUs, transform.scaleX);
  const scaleY = channelValue(findChannel(channels, 'scale.y'), localUs, transform.scaleY);
  const rotation = channelValue(findChannel(channels, 'rotation'), localUs, transform.rotationDeg);
  const opacity = channelValue(findChannel(channels, 'opacity'), localUs, transform.opacity);
  const common = {
    src: staticFile(asset.src),
    style: cropStyle(clip),
  };
  return (
    <div
      style={{
        position: 'absolute',
        left: positionX - transform.widthPx * transform.anchor.x,
        top: positionY - transform.heightPx * transform.anchor.y,
        width: transform.widthPx,
        height: transform.heightPx,
        overflow: 'hidden',
        opacity,
        transform: `rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`,
        transformOrigin: `${transform.anchor.x * 100}% ${transform.anchor.y * 100}%`,
      }}
    >
      {clip.kind === 'video' ? (
        <OffthreadVideo
          {...common}
          muted
          trimBefore={Math.round((clip.source.inUs / 1_000_000) * fps)}
          playbackRate={clip.source.playbackRate}
        />
      ) : (
        <Img {...common} />
      )}
    </div>
  );
};

const gradient = (clip: TextClip): React.CSSProperties => {
  if (clip.style.fill.kind === 'solid') return {color: clip.style.fill.color};
  const stops = clip.style.fill.stops
    .map((stop) => `${stop.color} ${stop.offset * 100}%`)
    .join(', ');
  return {
    color: 'transparent',
    backgroundImage: `linear-gradient(${clip.style.fill.angleDeg}deg, ${stops})`,
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
  };
};

const sampleAt = (clip: TextClip, frame: number): AnimationSample =>
  clip.animation.samples.values[Math.min(frame, clip.animation.samples.values.length - 1)] ?? {
    ...clip.baseTransform,
  };

const Text: React.FC<{clip: TextClip}> = ({clip}) => {
  const frame = useCurrentFrame();
  const sample = sampleAt(clip, frame);
  return (
    <div
      style={{
        position: 'absolute',
        left: sample.positionXPx,
        top: sample.positionYPx,
        whiteSpace: 'pre',
        fontFamily: clip.style.fontFamily,
        fontSize: clip.style.fontSizePx,
        fontWeight: clip.style.fontWeight,
        fontStyle: clip.style.fontStyle,
        lineHeight: `${clip.style.lineHeightPx}px`,
        letterSpacing: clip.style.letterSpacingPx,
        textAlign: clip.style.textAlign as React.CSSProperties['textAlign'],
        textDecoration: clip.style.decoration,
        WebkitTextStroke: `${clip.style.stroke.widthPx}px ${clip.style.stroke.color}`,
        paintOrder: 'stroke fill',
        textShadow: `${clip.style.shadow.offsetXPx}px ${clip.style.shadow.offsetYPx}px ${clip.style.shadow.blurPx}px ${clip.style.shadow.color}`,
        opacity: sample.opacity,
        transform: `translate(-50%, -50%) rotate(${sample.rotationDeg}deg) scale(${sample.scaleX}, ${sample.scaleY})`,
        transformOrigin: 'center center',
        ...gradient(clip),
      }}
    >
      {sample.visibleText ?? clip.content.text}
    </div>
  );
};

const valueAtAutomation = (
  points: {time: number; value: number}[] | undefined,
  time: number,
  fallback: number,
): number => {
  if (!points || points.length === 0) return fallback;
  if (time <= points[0].time) return points[0].value;
  if (time >= points[points.length - 1].time) return points[points.length - 1].value;
  const index = points.findIndex((point, i) => points[i + 1] && time < points[i + 1].time);
  const left = points[index];
  const right = points[index + 1];
  const progress = (time - left.time) / (right.time - left.time);
  return left.value + (right.value - left.value) * progress;
};

const Sound: React.FC<{clip: AudioClip; asset: Asset; masterVolume: number}> = ({
  clip,
  asset,
  masterVolume,
}) => {
  const {fps} = useVideoConfig();
  const durationUs = clip.timing.endUs - clip.timing.startUs;
  return (
    <Audio
      src={staticFile(asset.src)}
      trimBefore={Math.round((clip.source.inUs / 1_000_000) * fps)}
      playbackRate={clip.source.playbackRate}
      volume={(frame) => {
        const localUs = (frame / fps) * 1_000_000;
        const automated = valueAtAutomation(
          clip.automation.volume,
          localUs / 1_000_000,
          clip.mix.volume,
        );
        const fadeIn = clip.mix.fadeInUs > 0 ? Math.min(1, localUs / clip.mix.fadeInUs) : 1;
        const fadeOut =
          clip.mix.fadeOutUs > 0
            ? Math.min(1, (durationUs - localUs) / clip.mix.fadeOutUs)
            : 1;
        return Math.max(0, automated * masterVolume * fadeIn * fadeOut);
      }}
    />
  );
};

const RenderClip: React.FC<{
  clip: RenderHandoff['clips'][number];
  handoff: RenderHandoff;
}> = ({clip, handoff}) => {
  const asset = 'assetId' in clip
    ? handoff.assets.find((candidate) => candidate.id === clip.assetId)
    : undefined;
  if ((clip.kind === 'video' || clip.kind === 'image') && asset) {
    return <VisualMedia clip={clip} asset={asset} />;
  }
  if (clip.kind === 'audio' && asset) {
    return <Sound clip={clip} asset={asset} masterVolume={handoff.audio.masterVolume} />;
  }
  if (clip.kind === 'text') return <Text clip={clip} />;
  return null;
};

const orderedClips = (handoff: RenderHandoff): RenderHandoff['clips'] => {
  const trackById = new Map<string, Track>(handoff.tracks.map((track) => [track.id, track]));
  const soloed = handoff.tracks.some((track) => track.solo);
  return handoff.clips
    .filter((clip) => {
      const track = trackById.get(clip.trackId);
      if (!track || !track.visible || track.muted) return false;
      return !soloed || track.solo;
    })
    .sort((left, right) =>
      (trackById.get(left.trackId)?.zIndex ?? 0) - (trackById.get(right.trackId)?.zIndex ?? 0),
    );
};

export const ScramboScene: React.FC<{handoff: RenderHandoff}> = ({handoff}) => {
  const clips = useMemo(() => orderedClips(handoff), [handoff]);
  return (
    <AbsoluteFill style={{backgroundColor: handoff.composition.backgroundColor}}>
      <Fonts handoff={handoff} />
      {clips.map((clip) => (
        <Sequence
          key={clip.id}
          name={clip.id}
          from={clip.timing.firstFrame}
          durationInFrames={clip.timing.endFrameExclusive - clip.timing.firstFrame}
          layout="none"
        >
          <RenderClip clip={clip} handoff={handoff} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
