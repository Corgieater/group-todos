import { startOfDay, endOfDay } from 'date-fns';
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { Status, Task } from '@prisma/client';
import { TaskPriority } from 'src/tasks/types/enum';

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
};

export function toCatpital(str: string) {
  const originalStr = str;
  return originalStr.charAt(0) + originalStr.slice(1).toLocaleLowerCase();
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

  toCatpital(TaskPriority[task.priority]);
  return {
    ...task,
    dueLabel,
    dueDateLocal,
    dueTimeLocal,
    createdLabel: formatInTimeZone(task.createdAt, tz, 'yyyy/MM/dd HH:mm:ss'),
    updatedLabel: formatInTimeZone(task.updatedAt, tz, 'yyyy/MM/dd HH:mm:ss'),
    priorityLabel: toCatpital(TaskPriority[task.priority]),
    statusLabel: toCatpital(Status[task.status]),
  };
}
