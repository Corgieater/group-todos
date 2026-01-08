import { startOfDay, endOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import type { Prisma } from 'src/generated/prisma/client';
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

export interface ITimeBasedTaskEntity {
  id: number;
  title: string;
  status: string; // 實際為 Status enum，但用 string 確保通用性
  priority: number;
  description: string | null;
  location: string | null;

  // 時間欄位
  dueAtUtc: Date | null;
  allDay: boolean;
  allDayLocalDate: Date | null;
  sourceTimeZone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TaskVM<T extends ITimeBasedTaskEntity> = T & {
  dueLabel: string | null; // 顯示用 (日期和時間的組合)
  dueDateLocal: string | null; // 表單 date 用：YYYY-MM-DD
  dueTimeLocal: string | null; // 表單 time 用：HH:mm
  createdLabel: string;
  updatedLabel: string;
  priorityLabel: string;
  statusLabel: string;
  isAdminish: boolean;
  groupId?: number | null;
};

export function toCapital(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

type timeUnit = 'm' | 'h' | 'd';

export function addTime(
  date: Date | number,
  amount: number,
  unit: timeUnit,
): Date {
  const d = new Date(date);
  switch (unit) {
    case 'm':
      return new Date(d.getTime() + amount * 60_000);
    case 'h':
      return new Date(d.getTime() + amount * 3_600_000);
    case 'd':
      return new Date(d.getTime() + amount * 86_400_000);
  }
}

export function buildTaskVM<T extends ITimeBasedTaskEntity>(
  task: T,
  tz: string,
  isAdminish: boolean,
): TaskVM<T> {
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

  const groupId = (task as any).groupId || (task as any).task?.groupId || null;

  return {
    ...task,
    dueLabel,
    dueDateLocal,
    dueTimeLocal,
    createdLabel: formatInTimeZone(task.createdAt, tz, 'yyyy/MM/dd HH:mm:ss'),
    updatedLabel: formatInTimeZone(task.updatedAt, tz, 'yyyy/MM/dd HH:mm:ss'),
    priorityLabel: toCapital(TaskPriority[task.priority] || 'Medium'),
    statusLabel: toCapital((TaskStatus as any)[task.status] || 'Open'),
    isAdminish,
    groupId: groupId,
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
