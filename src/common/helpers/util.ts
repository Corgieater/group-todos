import { startOfDay, endOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import type { Task, Prisma } from '@prisma/client';
import { TaskPriority } from 'src/tasks/types/enum';
import { TaskStatus } from 'src/tasks/types/enum';

// TODO: NOTE:
// I think stuff here is to messy, tidy it up
export function dayBoundsUtc(tz: string, baseDate: Date = new Date()) {
  const zoned = toZonedTime(baseDate, tz);
  const startZoned = startOfDay(zoned);
  const endZoned = endOfDay(zoned);
  return {
    startUtc: fromZonedTime(startZoned, tz),
    endUtc: fromZonedTime(endZoned, tz),
  };
}

export type TaskVM<T extends Task> = T & {
  dueLabel: string | null; // 顯示用（全日=YYYY-MM-DD；非全日=YYYY-MM-DD HH:mm）
  dueDateLocal: string | null; // 表單 date 用：YYYY-MM-DD
  dueTimeLocal: string | null; // 表單 time 用：HH:mm（全日= null）
  createdLabel: string;
  updatedLabel: string;
  priorityLabel: string;
  statusLabel: string;
};

export function toCapital(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function buildTaskVM<T extends Task>(task: T, tz: string): TaskVM<T> {
  const toYMD = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

  const dueDateLocal = task.allDay
    ? toYMD(task.allDayLocalDate)
    : task.dueAtUtc
      ? formatInTimeZone(task.dueAtUtc, tz, 'yyyy-MM-dd')
      : null;

  const dueTimeLocal = task.allDay
    ? null
    : task.dueAtUtc
      ? formatInTimeZone(task.dueAtUtc, tz, 'HH:mm')
      : null;

  const dueLabel = task.allDay
    ? dueDateLocal
    : dueDateLocal && dueTimeLocal
      ? `${dueDateLocal} ${dueTimeLocal}`
      : null;

  toCapital(TaskPriority[task.priority]);
  return {
    ...task,
    dueLabel,
    dueDateLocal,
    dueTimeLocal,
    createdLabel: formatInTimeZone(task.createdAt, tz, 'yyyy/MM/dd HH:mm:ss'),
    updatedLabel: formatInTimeZone(task.updatedAt, tz, 'yyyy/MM/dd HH:mm:ss'),
    priorityLabel: toCapital(TaskPriority[task.priority]),
    statusLabel: toCapital(TaskStatus[task.status]),
  };
}

export type GroupDetails = Prisma.GroupGetPayload<{
  include: {
    owner: { select: { id: true; name: true; email: true } };
    members: {
      include: { user: { select: { id: true; name: true; email: true } } };
    };
  };
}>;

export type GroupMemberVM = GroupDetails['members'][number] & {
  joinedAtLabel: string;
};

export type GroupVM = Omit<GroupDetails, 'members'> & {
  createdAtLabel: string;
  updatedAtLabel: string;
  members: GroupMemberVM[];
};

export function buildGroupVM(group: GroupDetails, tz: string): GroupVM {
  return {
    ...group,
    createdAtLabel: formatInTimeZone(group.createdAt, tz, 'yyyy/MM/dd HH:mm'),
    updatedAtLabel: formatInTimeZone(group.updatedAt, tz, 'yyyy/MM/dd HH:mm'),
    members: group.members.map((m) => ({
      ...m,
      joinedAtLabel: formatInTimeZone(m.joinedAt, tz, 'yyyy/MM/dd HH:mm'),
    })),
  };
}
