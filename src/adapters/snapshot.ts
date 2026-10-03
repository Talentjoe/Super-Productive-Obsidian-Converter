import type { AppSnapshot, HostAPI } from '../types';

// The native API exposes a read-only store snapshot, including optional project
// IDs on older/imported Inbox tasks. Never mutate its objects or entity maps.
export function normalizeSnapshot(raw: AppSnapshot): AppSnapshot {
  const snapshot = structuredClone(raw);
  const clean = <T>(entities: Record<string, T>) => Object.fromEntries(Object.entries(entities || {}).filter(([, entity]) => entity)) as Record<string, T>;
  snapshot.tasks = clean(snapshot.tasks); snapshot.projects = clean(snapshot.projects);
  snapshot.tags = clean(snapshot.tags); snapshot.notes = clean(snapshot.notes);
  for (const project of Object.values(snapshot.projects)) { project.taskIds ||= []; project.backlogTaskIds ||= []; }
  const resolveProject = (id: string, visiting = new Set<string>()): string => {
    const task = snapshot.tasks[id]; if (!task || visiting.has(id)) return '';
    if (task.projectId) return task.projectId;
    visiting.add(id);
    const parent = task.parentId ? resolveProject(task.parentId, visiting) : '';
    const membership = Object.values(snapshot.projects).filter((project) => [...project.taskIds, ...project.backlogTaskIds].includes(id));
    return parent || (membership.length === 1 ? membership[0].id : snapshot.projects.INBOX_PROJECT ? 'INBOX_PROJECT' : '');
  };
  for (const task of Object.values(snapshot.tasks)) {
    task.projectId = resolveProject(task.id); task.tagIds ||= []; task.subTaskIds ||= [];
  }
  return snapshot;
}
export const readSnapshot = async (api: HostAPI): Promise<AppSnapshot> => normalizeSnapshot(await api.getAppState());
