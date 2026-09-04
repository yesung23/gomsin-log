import { runServerMutationBehindDeletionBarrier } from '@/lib/accountDeletion';
import { supabase } from '@/lib/supabase';
import type { CoupleTask } from '@/types';

export type TasksResult =
  | { ok: true; tasks: CoupleTask[] }
  | { ok: false; reason: 'forbidden' | 'error' };

function mapTask(row: Record<string, unknown>): CoupleTask {
  return {
    id: row.id as string,
    coupleId: row.couple_id as string,
    createdBy: row.created_by as string,
    title: row.title as string,
    dueDate: row.due_date as string,
    dueTime: typeof row.due_time === 'string' ? row.due_time.slice(0, 5) : undefined,
    assigneeId: (row.assignee_id as string | null) || undefined,
    completed: Boolean(row.completed),
    isPrivate: Boolean(row.is_private),
    createdAt: row.created_at as string,
  };
}

function failed(error?: { code?: string } | null): TasksResult {
  return { ok: false, reason: error?.code === '42501' ? 'forbidden' : 'error' };
}

export function validateTaskTitle(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return '할 일을 입력해 주세요.';
  if (trimmed.length > 120) return '할 일은 120자 이내로 입력해 주세요.';
  return null;
}

export async function fetchTasks(coupleId: string): Promise<TasksResult> {
  if (!supabase || !coupleId) return failed();
  // A SELECT hidden by RLS can legitimately return `[]` when the caller no
  // longer belongs to this couple. Verify the workspace first so an empty list
  // cannot be mistaken for write authority by the schedule UI.
  const { data: activeCoupleId, error: membershipError } = await supabase
    .rpc('get_my_active_couple_id');
  if (membershipError) {
    console.error('[gomsinlog] Failed to verify task workspace.');
    return failed(membershipError);
  }
  if (activeCoupleId !== coupleId) return failed({ code: '42501' });

  const { data, error } = await supabase.from('couple_tasks').select('*')
    .eq('couple_id', coupleId)
    .order('due_date', { ascending: true })
    .order('due_time', { ascending: true, nullsFirst: false });
  if (error) return failed(error);
  return { ok: true, tasks: (data || []).map(mapTask) };
}

export async function createTask(
  task: Omit<CoupleTask, 'id' | 'createdAt' | 'completed'>,
): Promise<CoupleTask | null> {
  if (!supabase || validateTaskTitle(task.title)) return null;
  const result = await runServerMutationBehindDeletionBarrier(async ({ assertCurrent }) => {
    assertCurrent();
    const { data, error } = await supabase!.from('couple_tasks').insert({
      couple_id: task.coupleId,
      created_by: task.createdBy,
      title: task.title.trim(),
      due_date: task.dueDate,
      due_time: task.dueTime || null,
      assignee_id: task.assigneeId || null,
      is_private: task.isPrivate,
    }).select().single();
    assertCurrent();
    return error || !data ? null : mapTask(data);
  }, { expectedUserId: task.createdBy });
  return result.kind === 'executed' ? result.value : null;
}

export async function updateTask(
  task: CoupleTask,
  updates: Partial<Pick<CoupleTask, 'title' | 'dueDate' | 'dueTime' | 'assigneeId' | 'completed' | 'isPrivate'>>,
): Promise<CoupleTask | null> {
  if (!supabase || !task.coupleId) return null;
  if (updates.title !== undefined && validateTaskTitle(updates.title)) return null;
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.title !== undefined) payload.title = updates.title.trim();
  if (updates.dueDate !== undefined) payload.due_date = updates.dueDate;
  if (updates.dueTime !== undefined) payload.due_time = updates.dueTime || null;
  if (updates.assigneeId !== undefined) payload.assignee_id = updates.assigneeId || null;
  if (updates.completed !== undefined) payload.completed = updates.completed;
  if (updates.isPrivate !== undefined) payload.is_private = updates.isPrivate;
  const result = await runServerMutationBehindDeletionBarrier(async ({ assertCurrent }) => {
    assertCurrent();
    const { data, error } = await supabase!.from('couple_tasks').update(payload)
      .eq('id', task.id).eq('couple_id', task.coupleId).select().maybeSingle();
    assertCurrent();
    return error || !data ? null : mapTask(data);
  }, { expectedUserId: 'current' });
  return result.kind === 'executed' ? result.value : null;
}

export async function deleteTask(task: CoupleTask): Promise<boolean> {
  if (!supabase || !task.coupleId) return false;
  const result = await runServerMutationBehindDeletionBarrier(async ({ assertCurrent }) => {
    assertCurrent();
    const { data, error } = await supabase!.from('couple_tasks').delete()
      .eq('id', task.id).eq('couple_id', task.coupleId).select('id').maybeSingle();
    assertCurrent();
    return !error && Boolean(data);
  }, { expectedUserId: 'current' });
  return result.kind === 'executed' ? result.value : false;
}
