import {
  AssignmentStatus,
  GroupRole,
  Prisma,
} from 'src/generated/prisma/client';
import { OrderKey, TaskUpdatePayload } from './types/tasks';
import { TaskStatus } from './types/enum';
import { dayBoundsUtc } from 'src/common/helpers/util';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

type TaskModelFields = Pick<
  Prisma.TaskUpdateInput,
  | 'title'
  | 'description'
  | 'location'
  | 'priority'
  | 'allDay'
  | 'allDayLocalDate'
  | 'dueAtUtc'
  | 'sourceTimeZone'
>;
type SubTaskModelFields = Pick<
  Prisma.SubTaskUpdateInput,
  | 'title'
  | 'description'
  | 'location'
  | 'priority'
  | 'allDay'
  | 'allDayLocalDate'
  | 'dueAtUtc'
  | 'sourceTimeZone'
>;

export const ASSIGNMENT_RULES: Record<AssignmentStatus, AssignmentStatus[]> = {
  [AssignmentStatus.PENDING]: [
    AssignmentStatus.ACCEPTED,
    AssignmentStatus.DECLINED,
    AssignmentStatus.SKIPPED,
  ],
  [AssignmentStatus.ACCEPTED]: [
    AssignmentStatus.COMPLETED,
    AssignmentStatus.DECLINED,
    AssignmentStatus.PENDING,
    AssignmentStatus.DROPPED,
  ],
  [AssignmentStatus.DECLINED]: [
    AssignmentStatus.ACCEPTED,
    AssignmentStatus.PENDING,
  ],
  [AssignmentStatus.SKIPPED]: [],
  [AssignmentStatus.DROPPED]: [],
  [AssignmentStatus.COMPLETED]: [],
};

const TASK_STATUS_MAP: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.OPEN]: [TaskStatus.CLOSED, TaskStatus.ARCHIVED],
  [TaskStatus.CLOSED]: [TaskStatus.OPEN, TaskStatus.ARCHIVED],
  [TaskStatus.ARCHIVED]: [TaskStatus.OPEN],
};

export class TasksUtils {
  static getCommonUpdateData<T extends TaskModelFields | SubTaskModelFields>(
    payload: TaskUpdatePayload,
    timeZone: string,
  ): T {
    const data: any = {};

    if (payload['title'] !== undefined) {
      data['title'] = payload.title;
    }
    if (payload['description'] !== undefined) {
      data['description'] = payload.description;
    }
    if (payload['location'] !== undefined) {
      data['location'] = payload.location;
    }
    if (payload['priority'] !== undefined) {
      data['priority'] = payload.priority;
    }

    // Deal with date and time
    const { dueAtUtc, allDayLocalDate } = this.calculateTaskDates(
      !!payload.allDay,
      payload.dueDate,
      payload.dueTime,
      timeZone,
    );

    if (payload.dueDate !== undefined) {
      data.allDay = !!payload.allDay;
      data.dueAtUtc = dueAtUtc;
      data.allDayLocalDate = allDayLocalDate;
    }

    return data as T;
  }

  static getAssigneeUpdateData(next: AssignmentStatus, reason?: string) {
    /**
     * Generates the structured data object for updating TaskAssignee records.
     * * @param next - The target AssignmentStatus to transition to.
     * @param reason - An optional reason, typically required when the status is 'DECLINED'.
     * * @description
     * This helper method encapsulates the side effects of status transitions:
     * 1. **State-Driven Mapping**: Uses a lookup table to define which timestamps (acceptedAt,
     * completedAt, etc.) should be set or reset based on the new status.
     * 2. **Audit Integrity**: Ensures that the `updatedAt` field is consistently refreshed and
     * irrelevant timestamps are cleared when a task is reset to 'PENDING'.
     * 3. **Data Normalization**: Returns a partial update object compatible with Prisma's update operations.
     * * @returns {Record<string, any>} A data object containing the status and its associated field updates.
     */
    const now = new Date();

    // 1. Define field operations associated with each status
    const statusEffects = {
      [AssignmentStatus.ACCEPTED]: {
        acceptedAt: now,
        declinedAt: null,
        completedAt: null,
      },
      [AssignmentStatus.DECLINED]: {
        declinedAt: now,
        completedAt: null,
        reason: reason ?? null,
      },
      [AssignmentStatus.COMPLETED]: {
        completedAt: now,
      },
      [AssignmentStatus.PENDING]: {
        acceptedAt: null,
        declinedAt: null,
        completedAt: null,
        reason: null,
      },
    };

    // 2. Retrieve state-specific data or fallback to an empty object
    const effect = statusEffects[next] || {};

    return {
      status: next,
      ...effect,
      updatedAt: now, // Ensure the global update timestamp is always refreshed
    };
  }

  static isAdminish(role: GroupRole) {
    const IS_ADMIN = new Set<GroupRole>([GroupRole.OWNER, GroupRole.ADMIN]);
    return IS_ADMIN.has(role);
  }

  static isValidAssignmentTransition(
    prev: AssignmentStatus,
    next: AssignmentStatus,
    taskStatus: string,
  ): boolean {
    if (prev === next) return true;

    // Deal with dynamic COMPLETED logic
    if (prev === AssignmentStatus.COMPLETED) {
      // Only when the parent task is still OPEN, allow transition from COMPLETED back to ACCEPTED
      return taskStatus === 'OPEN' && next === AssignmentStatus.ACCEPTED;
    }

    // Deal with other status rules
    const allowed = ASSIGNMENT_RULES[prev];
    return allowed?.includes(next) ?? false;
  }

  static taskStatusCanTransition(from: TaskStatus, to: TaskStatus): boolean {
    if (from === to) return true; // Staying in the same status is usually okay
    const allowed = TASK_STATUS_MAP[from];
    return allowed ? allowed.includes(to) : false;
  }

  static mapPriorityToString(priority: number): string {
    const map = {
      1: 'URGENT',
      2: 'HIGH',
      3: 'MEDIUM',
      4: 'LOW',
    };
    return map[priority];
  }

  static getTaskBounds = (timeZone: string) => {
    const now = new Date();

    // Get the start and end UTC time of today in the specified time zone
    const { startUtc, endUtc } = dayBoundsUtc(timeZone);

    // Get the date-only object for today in that time zone
    // (e.g. 2024-05-20T00:00:00.000Z) for matching the allDayLocalDate field in Prisma
    const todayStr = formatInTimeZone(now, timeZone, 'yyyy-MM-dd');
    const todayDateOnlyUtc = new Date(`${todayStr}T00:00:00.000Z`);

    return {
      startUtc, // start of today time (UTC)
      endUtc, // end of today time (UTC)
      todayDateOnlyUtc, // date today (Date-only)
      timeZone,
    };
  };

  static resolveOrderBy(
    orderByKey: OrderKey,
  ): Prisma.TaskOrderByWithRelationInput[] {
    switch (orderByKey) {
      case 'dueAtAscNullsLast':
        return [
          { dueAtUtc: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'asc' },
        ];

      case 'expiredPriority':
        return [
          { allDay: 'asc' }, // Non-all-day tasks go first
          { allDayLocalDate: 'asc' }, // The earlier the date, the higher the priority
          { dueAtUtc: 'asc' }, // Arrange by due date for tasks with the same allDay and allDayLocalDate
        ];

      case 'createdAsc': // default
      default:
        return [{ createdAt: 'asc' }];
    }
  }

  /**
   * Processes local date and time input into database-ready UTC and Local Date formats.
   * * @param isAllDay - Whether the task is an all-day event.
   * @param dueDate - The local date string (YYYY-MM-DD).
   * @param dueTime - The local time string (HH:mm), optional.
   * @param userTz - The user's IANA time zone identifier.
   * @returns An object containing the absolute UTC point and the localized calendar date.
   */
  static calculateTaskDates(
    isAllDay: boolean,
    dueDate: string | null | undefined,
    dueTime: string | null | undefined,
    userTz: string = 'UTC',
  ): { dueAtUtc: Date | null; allDayLocalDate: Date | null } {
    // Defensive check: If no date is provided, both are null
    if (!dueDate) {
      return { dueAtUtc: null, allDayLocalDate: null };
    }

    if (isAllDay) {
      const allDayLocalDate = new Date(`${dueDate}T00:00:00.000Z`);
      const localEndOfDay = `${dueDate}T23:59:59.999`;

      const dueAtUtc = fromZonedTime(localEndOfDay, userTz);

      return { allDayLocalDate, dueAtUtc };
    }

    // Non all-day: Specific time logic
    const timePart = dueTime || '00:00';
    const localISO = `${dueDate}T${timePart}:00`;

    return {
      dueAtUtc: fromZonedTime(localISO, userTz),
      allDayLocalDate: null,
    };
  }
}
