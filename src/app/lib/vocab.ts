/**
 * Axis and tech-role names for filters and theme pickers, read from the engine's own tables
 * (src/engine/features/axes.ts, tech.ts) so the UI never keeps a second list.
 */
import { AXES } from '@/engine/features/axes';
import { TECH_ROLES } from '@/engine/features/tech';

export const AXIS_OPTIONS: { id: string; label: string; heuristic: boolean }[] = AXES.map((a) => ({ id: a.id, label: a.label, heuristic: a.heuristic }))
  .sort((a, b) => a.label.localeCompare(b.label, 'en'));
export const axisLabel = (id: string): string => AXES.find((a) => a.id === id)?.label ?? id;

export const TECH_OPTIONS: { id: string; label: string; answers: string }[] = TECH_ROLES.map((t) => ({ id: t.id, label: t.label, answers: t.answers }));
export const techLabel = (id: string): string => TECH_ROLES.find((t) => t.id === id)?.label ?? id;
