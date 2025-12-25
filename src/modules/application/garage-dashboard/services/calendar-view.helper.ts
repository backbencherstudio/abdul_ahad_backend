import { RestrictionDto } from '../dto/schedule.dto';

// Types
export interface WeekDay {
  date: string;
  day_of_week: number;
  day_name: string;
  start_time: string | null;
  end_time: string | null;
  is_holiday: boolean;
  is_today: boolean;
  description: string;
  breaks: BreakInfo[];
}

export interface BreakInfo {
  start_time: string;
  end_time: string;
  description: string;
}

export interface CurrentWeekInfo {
  weekNumber: number;
  todayDate: string;
  isCurrentMonth: boolean;
}

export interface WeekDateRange {
  start: Date;
  end: Date;
}

// Helper Functions

function formatLocalYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculate which week of the month a date belongs to
 */
export function calculateWeekNumber(
  date: Date,
  year: number,
  month: number,
): number {
  // Get first day of the month
  const firstDayOfMonth = new Date(year, month - 1, 1);

  // Find the Sunday of the week containing the first day
  const firstWeekStart = new Date(firstDayOfMonth);
  const dayOfWeek = firstDayOfMonth.getDay();
  firstWeekStart.setDate(firstDayOfMonth.getDate() - dayOfWeek);

  // Calculate week difference
  const timeDiff = date.getTime() - firstWeekStart.getTime();
  const weekDiff = Math.floor(timeDiff / (7 * 24 * 60 * 60 * 1000));

  return weekDiff + 1; // 1-based week numbering
}

/**
 * Get start and end dates for a specific week
 */
export function getWeekDateRange(
  year: number,
  month: number,
  weekNumber: number,
): WeekDateRange {
  // Get first day of month
  const firstDayOfMonth = new Date(year, month - 1, 1);

  // Find the Sunday of the week containing the first day
  const firstWeekStart = new Date(firstDayOfMonth);
  const dayOfWeek = firstDayOfMonth.getDay();
  firstWeekStart.setDate(firstDayOfMonth.getDate() - dayOfWeek);

  // Calculate target week start
  const targetWeekStart = new Date(firstWeekStart);
  targetWeekStart.setDate(firstWeekStart.getDate() + (weekNumber - 1) * 7);

  // Calculate target week end
  const targetWeekEnd = new Date(targetWeekStart);
  targetWeekEnd.setDate(targetWeekStart.getDate() + 6);

  return { start: targetWeekStart, end: targetWeekEnd };
}

/**
 * Get current week information
 */
export function getCurrentWeekInfo(
  year: number,
  month: number,
): CurrentWeekInfo {
  const today = new Date();
  const todayDate = formatLocalYMD(today);

  // Check if today is in the requested month
  const isCurrentMonth =
    today.getFullYear() === year && today.getMonth() === month - 1;

  if (isCurrentMonth) {
    // Calculate which week today belongs to
    const weekNumber = calculateWeekNumber(today, year, month);
    return {
      weekNumber,
      todayDate,
      isCurrentMonth: true,
    };
  } else {
    // Today is not in the requested month, return week 1
    return {
      weekNumber: 1,
      todayDate,
      isCurrentMonth: false,
    };
  }
}

/**
 * Validate if week number is valid for the given month
 */
export function validateWeekNumber(
  weekNumber: number,
  year: number,
  month: number,
): boolean {
  if (weekNumber < 1) return false;

  // Get the last day of the month
  const lastDayOfMonth = new Date(year, month, 0);

  // Calculate the maximum week number for this month
  const maxWeekNumber = calculateWeekNumber(lastDayOfMonth, year, month);

  return weekNumber <= maxWeekNumber;
}

/**
 * Get day name from day of week number
 */
export function getDayName(dayOfWeek: number): string {
  const dayNames = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  return dayNames[dayOfWeek];
}

/**
 * Check if a day is restricted (holiday)
 */
function isDayRestricted(restrictions: RestrictionDto[], date: Date): boolean {
  const dayOfWeek = date.getDay();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if (!Array.isArray(restrictions)) {
    return false;
  }

  return restrictions.some((r) => {
    if (r.type !== 'HOLIDAY') {
      return false;
    }

    // Handle specific date (month/day)
    if (r.month !== undefined && r.day !== undefined) {
      if (r.month === month && r.day === day) {
        return true;
      }
    }

    // Handle both single day and array of days
    if (Array.isArray(r.day_of_week)) {
      return r.day_of_week.includes(dayOfWeek);
    }

    // Handle string vs number comparison
    const restrictionDay =
      typeof r.day_of_week === 'string'
        ? parseInt(r.day_of_week, 10)
        : r.day_of_week;

    return restrictionDay === dayOfWeek;
  });
}

/**
 * Get breaks for a specific day
 */
function getBreaksForDay(
  restrictions: RestrictionDto[],
  dayOfWeek: number,
): BreakInfo[] {
  if (!Array.isArray(restrictions)) {
    return [];
  }

  return restrictions
    .filter(
      (r) =>
        r.type === 'BREAK' &&
        Array.isArray(r.day_of_week) &&
        r.day_of_week.includes(dayOfWeek),
    )
    .map((r) => ({
      start_time: r.start_time!,
      end_time: r.end_time!,
      description: r.description || 'Break Time',
    }));
}

/**
 * Generate week schedule with working hours, holidays, and breaks
 */
export function generateWeekSchedule(
  weekStart: Date,
  weekEnd: Date,
  schedule: any,
  restrictions: RestrictionDto[],
  todayDate: string,
): WeekDay[] {
  const weekDays: WeekDay[] = [];
  const currentDate = new Date(weekStart);

  // Generate 7 days
  for (let i = 0; i < 7; i++) {
    const dateString = formatLocalYMD(currentDate);
    const dayOfWeek = currentDate.getDay();
    const isHoliday = isDayRestricted(restrictions, currentDate);
    const isToday = dateString === todayDate;

    // Get working hours (null if holiday)
    let startTime: string | null = null;
    let endTime: string | null = null;
    let description = '';

    if (isHoliday) {
      description = 'Holiday';
    } else if (schedule && schedule.is_active) {
      startTime = schedule.start_time;
      endTime = schedule.end_time;
      description = 'Normal Working Day';
    }

    // Get breaks for this day
    const breaks = getBreaksForDay(restrictions, dayOfWeek);

    weekDays.push({
      date: dateString,
      day_of_week: dayOfWeek,
      day_name: getDayName(dayOfWeek),
      start_time: startTime,
      end_time: endTime,
      is_holiday: isHoliday,
      is_today: isToday,
      description,
      breaks,
    });

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return weekDays;
}

/**
 * Generate holidays for a specific month
 */
export function generateHolidaysForMonth(
  restrictions: RestrictionDto[],
  year: number,
  month: number,
  schedule?: any,
) {
  const holidays = [];
  const added = new Set<string>();

  // Get all dates in the month
  const daysInMonth = new Date(year, month, 0).getDate();

  // Determine closed weekdays from schedule.daily_hours (0..6)
  const closedWeekdays = new Set<number>();
  try {
    const daily = schedule?.daily_hours as Record<
      string,
      { is_closed?: boolean }
    >;
    if (daily && typeof daily === 'object') {
      for (const key of Object.keys(daily)) {
        const dayNum = parseInt(key, 10);
        if (!Number.isNaN(dayNum) && dayNum >= 0 && dayNum <= 6) {
          if (daily[key]?.is_closed) closedWeekdays.add(dayNum);
        }
      }
    }
  } catch {}

  for (let day = 1; day <= daysInMonth; day++) {
    // Use noon to avoid timezone issues
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    const dayOfWeek = date.getDay();

    const ymd = formatLocalYMD(date);

    // 1) Closed weekdays from daily_hours
    if (closedWeekdays.has(dayOfWeek) && !added.has(ymd)) {
      holidays.push({
        date: ymd,
        day_of_week: dayOfWeek,
        description: 'Closed',
        type: 'CLOSED',
      });
      added.add(ymd);
    }

    // 2) Restriction-based holidays
    const holidayRestriction = restrictions.find((r) => {
      if (r.type !== 'HOLIDAY') return false;

      // Check for specific date (YYYY-MM-DD)
      if (r.date === ymd) {
        return true;
      }

      // Check for specific date (month/day)
      if (
        r.month !== undefined &&
        r.month === month &&
        r.day !== undefined &&
        r.day === day
      ) {
        return true;
      }
      return false;
    });

    if (holidayRestriction && !added.has(ymd)) {
      holidays.push({
        date: ymd,
        day_of_week: dayOfWeek,
        description: holidayRestriction.description || 'Holiday',
        type: 'HOLIDAY',
      });
      added.add(ymd);
    }
  }

  return holidays;
}

/**
 * Get month name
 */
export function getMonthName(month: number): string {
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return monthNames[month - 1];
}
