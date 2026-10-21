import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Gauge, Languages, Maximize, Minimize, Pause, PictureInPicture2, Play, RotateCcw, Settings, Volume1, Volume2, VolumeX } from 'lucide-react';
import type { AudioVariant, CaptionSource, StreamSource } from '../types';

type MediaMode = 'mp4' | 'hls' | 'dash';
type QualityOption = { value: string; label: string; index: number };
type TrackOption = { id: string | number; label: string; language?: string };

function modeFor(source: StreamSource): MediaMode | null {
  const format = source.format?.toLowerCase() ?? '';
  const url = source.url.toLowerCase().split('?')[0];
  if (format.includes('dash') || format.includes('mpd') || url.endsWith('.mpd')) return 'dash';
  if (format.includes('hls') || format.includes('m3u8') || url.endsWith('.m3u8')) return 'hls';
  if (/mp4|video/i.test(format) || /\.(mp4|m4v|mov|webm)$/.test(url)) return 'mp4';
  return null;
}

function sourceRank(source: StreamSource) {
  const mode = modeFor(source);
  const codec = source.codec?.toLowerCase() ?? '';
  const resolution = Number(source.resolution?.match(/\d+/)?.[0] ?? 0);
  const codecScore = /h.?264|avc/.test(codec) ? 400 : /h.?265|hevc/.test(codec) ? 180 : 280;
  const formatScore = mode === 'mp4' ? 250 : mode === 'hls' ? 170 : mode === 'dash' ? 150 : -1000;
  return codecScore + formatScore + Math.min(resolution, 2160) / 10;
}

function formatBytes(value?: number | string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return bytes > 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`;
}

function subtitleTextToVtt(text: string, delay = 0) {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const shifted = clean.replace(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/g, (_match, hours: string, minutes: string, seconds: string, milliseconds: string) => {
    const total = Math.max(0, (((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(milliseconds)) + Math.round(delay * 1000));
    const nextHours = Math.floor(total / 3_600_000);
    const nextMinutes = Math.floor(total % 3_600_000 / 60_000);
    const nextSeconds = Math.floor(total % 60_000 / 1000);
    const nextMilliseconds = total % 1000;
    return `${String(nextHours).padStart(2, '0')}:${String(nextMinutes).padStart(2, '0')}:${String(nextSeconds).padStart(2, '0')}.${String(nextMilliseconds).padStart(3, '0')}`;
  });
  return /^WEBVTT/i.test(shifted) ? shifted : `WEBVTT\n\n${shifted}`;
}

export function VideoPlayer({ sources, captions, audioVariants = [], initialAudioVariantId = '', onAudioVariantChange, poster, title, initialPosition = 0, onProgress, onEnded }: {
  sources: StreamSource[];
  captions: CaptionSource[];
  audioVariants?: AudioVariant[];
  initialAudioVariantId?: string;
  onAudioVariantChange?: (variant: AudioVariant) => Promise<{ sources: StreamSource[]; captions: CaptionSource[] }>;
  poster?: string;
  title: string;
  initialPosition?: number;
  onProgress?: (position: number, duration: number) => void;
  onEnded?: () => void;
}) {
  const shell = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<any>(null);
  const dashRef = useRef<any>(null);
  const pendingPosition = useRef(initialPosition);
  const resumeAfterSwitch = useRef(false);
  const objectUrl = useRef<string | null>(null);
  const progressSentAt = useRef(0);
  const controlsTimer = useRef<number | undefined>(undefined);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [playbackSources, setPlaybackSources] = useState(sources);
  const [playbackCaptions, setPlaybackCaptions] = useState(captions);
  const [selectedAudioVariantId, setSelectedAudioVariantId] = useState(initialAudioVariantId);
  const [audioSwitching, setAudioSwitching] = useState(false);
  const [requestedAudioVariantId, setRequestedAudioVariantId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qualityOptions, setQualityOptions] = useState<QualityOption[]>([]);
  const [qualityValue, setQualityValue] = useState('auto');
  const [audioTracks, setAudioTracks] = useState<TrackOption[]>([]);
  const [audioValue, setAudioValue] = useState<string>('');
  const [subtitleTracks, setSubtitleTracks] = useState<TrackOption[]>([]);
  const [subtitleValue, setSubtitleValue] = useState('off');
  const [subtitleError, setSubtitleError] = useState('');
  const [audioVariantError, setAudioVariantError] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);
  const [externalTrackUrl, setExternalTrackUrl] = useState('');
  const [externalTrackLabel, setExternalTrackLabel] = useState('');
  const subtitleValueRef = useRef(subtitleValue);
  const audioValueRef = useRef(audioValue);
  const audioSwitchRequest = useRef(0);

  const orderedSources = useMemo(() => playbackSources.filter((source) => modeFor(source) !== null && /^https?:\/\//i.test(source.url)).sort((a, b) => sourceRank(b) - sourceRank(a)), [playbackSources]);
  const activeSource = orderedSources[sourceIndex];
  const activeMode = activeSource ? modeFor(activeSource) : null;
  const canFullscreen = typeof document !== 'undefined' && (Boolean(document.fullscreenEnabled) || Boolean((video.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void } | null)?.webkitEnterFullscreen));
  const canPip = typeof document !== 'undefined' && (Boolean(document.pictureInPictureEnabled) || Boolean((video.current as HTMLVideoElement & { webkitSetPresentationMode?: (mode: string) => void } | null)?.webkitSetPresentationMode));

  const clearEngines = useCallback(() => {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (dashRef.current) { dashRef.current.reset(); dashRef.current = null; }
  }, []);

  const tryFallback = useCallback((message: string) => {
    setBuffering(false);
    if (sourceIndex + 1 < Math.min(orderedSources.length, 3)) {
      pendingPosition.current = video.current?.currentTime ?? 0;
      resumeAfterSwitch.current = Boolean(video.current && !video.current.paused);
      setSourceIndex((index) => index + 1);
      setError(`This source could not play. Trying another available source…`);
    } else {
      setError(message || 'This stream could not be played directly in your browser. The provider may restrict browser playback or CORS access.');
    }
  }, [sourceIndex, orderedSources.length]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    clearEngines();
    setError(''); setSubtitleError(''); setLoading(true); setBuffering(false); setQualityOptions([]); setAudioTracks([]); setSubtitleTracks([]);
    if (!activeSource || !activeMode) { setLoading(false); setError('No browser-compatible video source was returned by the API.'); return; }
    let cancelled = false;
    const sourceFailed = () => { if (!cancelled) tryFallback('The provider source or playback relay could not load this stream. It may be temporarily unavailable.'); };
    element.addEventListener('error', sourceFailed);
    if (activeMode === 'mp4') {
      element.src = activeSource.url; element.load();
      setQualityOptions(orderedSources.filter((source) => modeFor(source) === 'mp4').map((source, index) => ({ value: `source-${orderedSources.indexOf(source)}`, index: orderedSources.indexOf(source), label: source.resolution ?? `Source ${index + 1}` })).sort((a, b) => Number(b.label.match(/\d+/)?.[0] ?? 0) - Number(a.label.match(/\d+/)?.[0] ?? 0)));
    } else if (activeMode === 'hls') {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return;
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true, capLevelToPlayerSize: true, maxBufferLength: 30 });
          hlsRef.current = hls;
          hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
            setQualityOptions([{ value: 'auto', label: 'Auto', index: -1 }, ...data.levels.map((level: { height?: number; bitrate?: number }, index: number) => ({ value: `level-${index}`, index, label: level.height ? `${level.height}p` : `${Math.round((level.bitrate ?? 0) / 1000)} kbps` }))]);
            setAudioTracks(hls.audioTracks.map((track: { id: number; name?: string; lang?: string }, index: number) => ({ id: index, label: track.name || track.lang || `Audio ${index + 1}`, language: track.lang })));
            setSubtitleTracks(hls.subtitleTracks.map((track: { name?: string; lang?: string }, index: number) => ({ id: index, label: track.name || track.lang || `Subtitle ${index + 1}`, language: track.lang })));
            const selectedSubtitle = subtitleValueRef.current;
            if (selectedSubtitle.startsWith('hls-')) hls.subtitleTrack = Number(selectedSubtitle.replace('hls-', ''));
            else if (selectedSubtitle !== 'off' && !selectedSubtitle.startsWith('caption-')) setSubtitleValue('off');
            if (audioValueRef.current !== '') hls.audioTrack = Number(audioValueRef.current);
            setLoading(false);
          });
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => setAudioTracks(hls.audioTracks.map((track: { name?: string; lang?: string }, index: number) => ({ id: index, label: track.name || track.lang || `Audio ${index + 1}`, language: track.lang }))));
          hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => setSubtitleTracks(hls.subtitleTracks.map((track: { name?: string; lang?: string }, index: number) => ({ id: index, label: track.name || track.lang || `Subtitle ${index + 1}`, language: track.lang }))));
          hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) sourceFailed(); });
          hls.loadSource(activeSource.url); hls.attachMedia(element);
        } else if (element.canPlayType('application/vnd.apple.mpegurl')) {
          element.src = activeSource.url; element.load(); setLoading(false);
        } else sourceFailed();
      }).catch(sourceFailed);
    } else {
      import('dashjs').then((dashjs) => {
        if (cancelled) return;
        const player = dashjs.MediaPlayer().create();
        dashRef.current = player;
        player.initialize(element, activeSource.url, false);
        player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
          const engine = player as any;
          const levels = engine.getBitrateInfoListFor('video') ?? [];
          setQualityOptions([{ value: 'auto', label: 'Auto', index: -1 }, ...levels.map((level: { height?: number; bitrate?: number }, index: number) => ({ value: `level-${index}`, index, label: level.height ? `${level.height}p` : `${Math.round((level.bitrate ?? 0) / 1000)} kbps` }))]);
          const audio = engine.getTracksFor('audio') ?? [];
          setAudioTracks(audio.map((track: { id?: string | null; lang?: string | null; labels?: Array<{ text?: string | null }> }, index: number) => ({ id: track.id ?? index, label: track.labels?.[0]?.text ?? track.lang ?? `Audio ${index + 1}`, language: track.lang ?? undefined })));
          const text = engine.getTracksFor('text') ?? [];
          setSubtitleTracks(text.map((track: { id?: string | null; lang?: string | null; labels?: Array<{ text?: string | null }> }, index: number) => ({ id: track.id ?? index, label: track.labels?.[0]?.text ?? track.lang ?? `Subtitle ${index + 1}`, language: track.lang ?? undefined })));
          const selectedSubtitle = subtitleValueRef.current;
          if (selectedSubtitle.startsWith('dash-')) engine.setTextTrack(Number(selectedSubtitle.replace('dash-', '')));
          else if (selectedSubtitle !== 'off' && !selectedSubtitle.startsWith('caption-')) { engine.setTextTrack(-1); setSubtitleValue('off'); }
          if (audioValueRef.current !== '') {
            const selectedAudio = audio[Number(audioValueRef.current)];
            if (selectedAudio) engine.setCurrentTrack(selectedAudio);
          }
          setLoading(false);
        });
        player.on(dashjs.MediaPlayer.events.ERROR, sourceFailed);
      }).catch(sourceFailed);
    }
    const onMetadata = () => {
      setDuration(Number.isFinite(element.duration) ? element.duration : 0);
      if (pendingPosition.current > 0 && Number.isFinite(element.duration)) {
        element.currentTime = Math.min(pendingPosition.current, Math.max(0, element.duration - 1));
        pendingPosition.current = 0;
      }
      if (resumeAfterSwitch.current) { resumeAfterSwitch.current = false; void element.play().catch(() => setPlaying(false)); }
    };
    element.addEventListener('loadedmetadata', onMetadata);
    return () => {
      cancelled = true; element.removeEventListener('error', sourceFailed); element.removeEventListener('loadedmetadata', onMetadata);
      clearEngines(); element.pause(); element.removeAttribute('src'); element.load();
    };
  }, [activeSource, activeMode, sourceIndex, orderedSources, clearEngines, tryFallback, retryNonce]);

  useEffect(() => {
    if (!externalTrackUrl || !video.current) return;
    const element = video.current;
    const track = document.createElement('track');
    track.kind = 'subtitles'; track.label = externalTrackLabel; track.srclang = 'und'; track.src = externalTrackUrl; track.default = true;
    element.appendChild(track); track.track.mode = 'showing';
    return () => { element.removeChild(track); };
  }, [externalTrackUrl, externalTrackLabel]);

  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); if (controlsTimer.current) window.clearTimeout(controlsTimer.current); clearEngines(); }, [clearEngines]);

  useEffect(() => {
    if (!video.current) return;
    video.current.muted = muted;
    video.current.volume = volume;
    video.current.playbackRate = speed;
  }, [muted, volume, speed]);

  useEffect(() => { subtitleValueRef.current = subtitleValue; audioValueRef.current = audioValue; }, [subtitleValue, audioValue]);

  useEffect(() => {
    if (qualityOptions.length && !qualityOptions.some((option) => option.value === qualityValue)) setQualityValue(qualityOptions[0].value);
  }, [qualityOptions, qualityValue]);

  const selectQuality = (value: string) => {
    const level = Number(value.split('-')[1]);
    if (value === 'auto') {
      if (hlsRef.current) hlsRef.current.currentLevel = -1;
      if (dashRef.current) dashRef.current.setAutoSwitchQualityFor('video', true);
      setQualityValue('auto'); return;
    }
    if (value.startsWith('source-')) {
      const next = Number(value.split('-')[1]);
      if (next !== sourceIndex && orderedSources[next]) {
        pendingPosition.current = video.current?.currentTime ?? 0;
        resumeAfterSwitch.current = Boolean(video.current && !video.current.paused);
        setSourceIndex(next);
      }
    } else if (Number.isFinite(level)) {
      if (hlsRef.current) hlsRef.current.currentLevel = level;
      if (dashRef.current) { dashRef.current.setAutoSwitchQualityFor('video', false); dashRef.current.setQualityFor('video', level); }
    }
    setQualityValue(value);
  };

  const selectAudio = (value: string) => {
    const index = Number(value);
    if (!Number.isFinite(index)) return;
    if (hlsRef.current) hlsRef.current.audioTrack = index;
    if (dashRef.current) {
      const track = (dashRef.current.getTracksFor('audio') ?? [])[index];
      if (track) dashRef.current.setCurrentTrack(track);
    }
    const nativeTracks = video.current as (HTMLVideoElement & { audioTracks?: { selectedIndex: number } }) | null;
    if (!hlsRef.current && !dashRef.current && nativeTracks?.audioTracks) nativeTracks.audioTracks.selectedIndex = index;
    setAudioValue(value);
  };

  const selectAudioVariant = async (subjectId: string) => {
    const variant = audioVariants.find((candidate) => candidate.subject_id === subjectId);
    if (!variant || !onAudioVariantChange || subjectId === selectedAudioVariantId || audioSwitching) return;
    const requestId = ++audioSwitchRequest.current;
    setAudioSwitching(true);
    setRequestedAudioVariantId(subjectId);
    setAudioVariantError('');
    try {
      const nextPlayback = await onAudioVariantChange(variant);
      if (requestId !== audioSwitchRequest.current) return;
      if (!nextPlayback.sources.length) throw new Error('No playable source was returned for this language.');
      pendingPosition.current = video.current?.currentTime ?? 0;
      resumeAfterSwitch.current = Boolean(video.current && !video.current.paused);
      if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; }
      setExternalTrackUrl('');
      setPlaybackSources(nextPlayback.sources);
      setPlaybackCaptions(nextPlayback.captions);
      setSourceIndex(0);
      setQualityValue('auto');
      setAudioTracks([]); setAudioValue(''); setSubtitleTracks([]); setSubtitleValue('off');
      setSelectedAudioVariantId(subjectId);
    } catch (reason) {
      if (requestId === audioSwitchRequest.current) setAudioVariantError(reason instanceof Error ? reason.message : 'Could not switch audio language. The current stream is still playing.');
    } finally {
      if (requestId === audioSwitchRequest.current) { setAudioSwitching(false); setRequestedAudioVariantId(''); }
    }
  };

  const selectSubtitle = async (value: string) => {
    setSubtitleError('');
    if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; }
    setExternalTrackUrl('');
    if (hlsRef.current) hlsRef.current.subtitleTrack = value.startsWith('hls-') ? Number(value.replace('hls-', '')) : -1;
    if (dashRef.current) {
      const trackIndex = value.startsWith('dash-') ? Number(value.replace('dash-', '')) : -1;
      dashRef.current.setTextTrack(trackIndex);
    }
    if (value.startsWith('caption-')) {
      const caption = playbackCaptions[Number(value.replace('caption-', ''))];
      if (!caption) return;
      setLoading(true);
      try {
        const response = await fetch(caption.url);
        if (!response.ok) throw new Error('Subtitle could not be loaded.');
        const text = await response.text();
        const body = subtitleTextToVtt(text, caption.delay ?? 0);
        const blob = new Blob([body], { type: 'text/vtt;charset=utf-8' });
        objectUrl.current = URL.createObjectURL(blob);
        setExternalTrackLabel(caption.label ?? caption.language); setExternalTrackUrl(objectUrl.current);
      } catch {
        setSubtitleError('The provider blocked direct subtitle access in this browser.');
      } finally { setLoading(false); }
    }
    setSubtitleValue(value);
  };

  const playPause = async () => {
    if (!video.current) return;
    if (video.current.paused) { try { if (video.current.ended) video.current.currentTime = 0; await video.current.play(); setError(''); setEnded(false); } catch { setError('Playback was blocked by the browser. Press Play to try again.'); } }
    else video.current.pause();
  };
  const seekBy = (amount: number) => { if (video.current && Number.isFinite(video.current.duration)) video.current.currentTime = Math.max(0, Math.min(video.current.duration, video.current.currentTime + amount)); };
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (shell.current?.requestFullscreen) await shell.current.requestFullscreen();
    else (video.current as HTMLVideoElement & { webkitEnterFullscreen?: () => void } | null)?.webkitEnterFullscreen?.();
  };
  const togglePip = async () => {
    const element = video.current as HTMLVideoElement & { webkitSetPresentationMode?: (mode: string) => void } | null;
    if (!element) return;
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (element.requestPictureInPicture) await element.requestPictureInPicture();
    else element.webkitSetPresentationMode?.('picture-in-picture');
  };
  const changeSpeed = (rate: number) => { if (video.current) video.current.playbackRate = rate; setSpeed(rate); };
  const seekRatio = duration ? current / duration * 100 : 0;
  const currentQualityTracks: TrackOption[] = activeMode === 'hls' ? subtitleTracks.map((track, index) => ({ ...track, id: `hls-${index}` })) : activeMode === 'dash' ? subtitleTracks.map((track, index) => ({ ...track, id: `dash-${index}` })) : [];
  const allSubtitleTracks = [...currentQualityTracks, ...playbackCaptions.map((caption, index) => ({ id: `caption-${index}`, label: caption.label ?? caption.language }))];
  const hasPlaybackSettings = qualityOptions.length > 0 || allSubtitleTracks.length > 0 || audioTracks.length > 1 || (audioVariants.length > 1 && Boolean(onAudioVariantChange));

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (!shell.current?.contains(target)) return;
      if (event.code === 'Space') { event.preventDefault(); void playPause(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); seekBy(-10); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); seekBy(10); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); const next = Math.min(1, (video.current?.volume ?? 0) + .05); if (video.current) video.current.volume = next; setVolume(next); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); const next = Math.max(0, (video.current?.volume ?? 0) - .05); if (video.current) video.current.volume = next; setVolume(next); }
      else if (event.key.toLowerCase() === 'm') { setMuted((value) => !value); }
      else if (event.key.toLowerCase() === 'f') { void toggleFullscreen(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  const controlTouch = () => {
    setControlsVisible(true);
    if (controlsTimer.current) window.clearTimeout(controlsTimer.current);
    if (playing) controlsTimer.current = window.setTimeout(() => setControlsVisible(false), 2600);
  };
  return <div className={`video-shell ${controlsVisible ? '' : 'controls-hidden'}`} ref={shell} onMouseMove={controlTouch} onTouchStart={controlTouch} onMouseLeave={() => playing && setControlsVisible(false)}>
    <video ref={video} className="video-element" poster={poster} preload="none" playsInline crossOrigin="anonymous" aria-label={title}
      onLoadedMetadata={(event) => { const element = event.currentTarget; setDuration(Number.isFinite(element.duration) ? element.duration : 0); if (pendingPosition.current > 0 && Number.isFinite(element.duration)) { element.currentTime = Math.min(pendingPosition.current, Math.max(0, element.duration - 1)); pendingPosition.current = 0; } if (resumeAfterSwitch.current) { resumeAfterSwitch.current = false; void element.play().catch(() => setPlaying(false)); } const tracks = (element as HTMLVideoElement & { audioTracks?: ArrayLike<{ id?: string; language?: string; label?: string }> }).audioTracks; if (tracks?.length) setAudioTracks(Array.from(tracks, (track, index) => ({ id: track.id ?? index, label: track.label || track.language || `Audio ${index + 1}`, language: track.language }))); }}
      onTimeUpdate={(event) => { const element = event.currentTarget; setCurrent(element.currentTime); const now = Date.now(); if (now - progressSentAt.current > 8000) { progressSentAt.current = now; onProgress?.(element.currentTime, element.duration || 0); } }}
      onPlay={() => { setPlaying(true); setEnded(false); setLoading(false); }} onPause={() => setPlaying(false)} onWaiting={() => setBuffering(true)} onPlaying={() => { setBuffering(false); setLoading(false); setError(''); }} onCanPlay={() => setLoading(false)} onDurationChange={(event) => setDuration(event.currentTarget.duration)} onEnded={() => { setPlaying(false); setEnded(true); onEnded?.(); }} />
    <button className={`player-center ${playing ? 'center-playing' : ''}`} aria-label={ended ? 'Replay' : playing ? 'Pause' : 'Play'} onClick={() => void playPause()}>{playing ? <Pause fill="currentColor" /> : ended ? <RotateCcw /> : <Play fill="currentColor" />}</button>
    {poster && !playing && current === 0 && <div className="player-poster-tint" style={{ backgroundImage: `linear-gradient(0deg,rgba(0,0,0,.72),transparent 50%),url("${poster}")` }} />}
    {(loading || buffering) && <div className="player-spinner" aria-label="Loading video"><span /></div>}
    {error && <div className="player-error"><AlertTriangle size={25} /><strong>Playback issue</strong><span>{error}</span>{orderedSources.length > 0 && <button className="button button-quiet" onClick={() => { setSourceIndex(0); setRetryNonce((value) => value + 1); setError(''); }}>Retry source</button>}</div>}
    <div className="player-controls">
      <div className="player-progress"><span style={{ width: `${seekRatio}%` }} /><input aria-label="Video progress" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(current, duration || 0)} onChange={(event) => { if (video.current) video.current.currentTime = Number(event.target.value); }} /></div>
      <div className="control-bar"><div className="control-group"><button className="control-button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => void playPause()}>{playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><button className="control-button" aria-label="Back 10 seconds" onClick={() => seekBy(-10)}><RotateCcw size={18} /><small>10</small></button><div className="volume-control"><button className="control-button" aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted((value) => !value)}>{muted || volume === 0 ? <VolumeX /> : volume < .5 ? <Volume1 /> : <Volume2 />}</button><input aria-label="Volume" type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); setMuted(next === 0); if (video.current) video.current.volume = next; }} /></div><span className="time-readout">{clock(current)} <i>/</i> {clock(duration)}</span></div>
        <div className="control-group"><button className="control-button speed-button" aria-label="Playback speed" onClick={() => changeSpeed(speed >= 2 ? .75 : speed + .25)}><Gauge size={16} /> {speed}x</button>{allSubtitleTracks.length > 0 && <button className={`control-button ${subtitleValue !== 'off' ? 'control-active' : ''}`} aria-label="Subtitles" onClick={() => setSettingsOpen((value) => !value)}><Languages /></button>}
          {canPip && <button className="control-button" aria-label="Picture in picture" onClick={() => void togglePip()}><PictureInPicture2 /></button>}
          {hasPlaybackSettings && <div className="settings-anchor"><button className="control-button" aria-label="Player settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((value) => !value)}><Settings /></button>{settingsOpen && <div className="settings-menu"><div className="settings-head"><strong>Playback settings</strong><button className="control-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><ChevronDown /></button></div>
            {qualityOptions.length > 1 && <label>Quality<select value={qualityValue} onChange={(event) => selectQuality(event.target.value)}>{qualityOptions.map((option) => <option value={option.value} key={option.value}>{option.label}{option.value.startsWith('source-') && formatBytes(orderedSources[option.index]?.size) ? ` · ${formatBytes(orderedSources[option.index]?.size)}` : ''}</option>)}</select></label>}
            {audioVariants.length > 1 && onAudioVariantChange && <label>Audio language<select value={selectedAudioVariantId} disabled={audioSwitching} onChange={(event) => void selectAudioVariant(event.target.value)}>{audioVariants.map((variant) => <option value={variant.subject_id} key={variant.subject_id}>{variant.language}{variant.subject_id === selectedAudioVariantId ? ' · current' : ''}</option>)}</select></label>}
            {allSubtitleTracks.length > 0 && <label>Subtitles<select value={subtitleValue} onChange={(event) => void selectSubtitle(event.target.value)}><option value="off">Off</option>{allSubtitleTracks.map((track) => <option value={String(track.id)} key={track.id}>{track.label}</option>)}</select></label>}
            {audioTracks.length > 1 && <label>Audio<select value={audioValue} onChange={(event) => selectAudio(event.target.value)}>{audioTracks.map((track, index) => <option key={track.id} value={index}>{track.label}</option>)}</select></label>}
            {audioSwitching && <p className="subtitle-error">Loading {audioVariants.find((variant) => variant.subject_id === requestedAudioVariantId)?.language ?? 'audio'} stream…</p>}
            {audioVariantError && <p className="subtitle-error">{audioVariantError}</p>}
            {subtitleError && <p className="subtitle-error">{subtitleError}</p>}
            <label>Playback speed<select value={speed} onChange={(event) => changeSpeed(Number(event.target.value))}>{[.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => <option value={rate} key={rate}>{rate}x</option>)}</select></label>
          </div>}</div>}
          {canFullscreen && <button className="control-button" aria-label="Toggle fullscreen" onClick={() => void toggleFullscreen()}>{document.fullscreenElement ? <Minimize /> : <Maximize />}</button>}
        </div>
      </div>
    </div>
    <span className="visually-hidden" aria-live="polite">{playing ? 'Playing' : 'Paused'} {clock(current)} of {clock(duration)}{error ? `. ${error}` : ''}</span>
  </div>;
}

function clock(value: number) {
  if (!Number.isFinite(value) || value < 0) return '00:00';
  const hours = Math.floor(value / 3600); const minutes = Math.floor(value % 3600 / 60); const seconds = Math.floor(value % 60);
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
