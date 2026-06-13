import api from './api';

export interface JobCategory {
  id: string;
  name: string;
  color: string;
  includeInPnl: boolean;
  system: boolean;
}

/** Names shown in the planner dropdown before the API resolves (and as a
 *  hard fallback if the request fails). Non-system, sensible defaults. */
export const FALLBACK_CATEGORY_NAMES = [
  'Loading', 'Moving', 'Unloading', 'Packing', 'Box Drop off',
  'Box Collection', 'Survey', 'Sundry', 'Quick Job',
];

export async function fetchJobCategories(): Promise<JobCategory[]> {
  const r = await api.get<JobCategory[]>('/settings/job-categories');
  return r.data;
}
