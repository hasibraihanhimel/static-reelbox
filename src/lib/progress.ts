import type { WatchProgress } from '../types';

const KEY = 'reel-house:continue-watching:v1';

export function readProgress(): WatchProgress[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is WatchProgress => !!item && typeof item.id === 'string' && typeof item.slug === 'string' && Number.isFinite(item.position)) : [];
  } catch {
    return [];
  }
}

export function saveProgress(item: WatchProgress) {
  const previous = readProgress().filter((entry) => entry.id !== item.id || entry.type !== item.type);
  localStorage.setItem(KEY, JSON.stringify([item, ...previous].slice(0, 12)));
}

export function forgetProgress(id: string, type: WatchProgress['type']) {
  localStorage.setItem(KEY, JSON.stringify(readProgress().filter((item) => item.id !== id || item.type !== type)));
}
