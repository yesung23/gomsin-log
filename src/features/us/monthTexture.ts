import type { Attachment, CoupleEvent, DailyRecord, Trip } from '@/types';

/**
 * What a month of this relationship looked like, one cell per day.
 *
 * ## Why the unit is a DAY and not a photo
 *
 * A photo-unit grid is what Instagram does, and copying it here fails: a couple
 * who rarely photographs their day gets a grid full of holes, and the screen that
 * is supposed to say "look how much of this is here" says the opposite. It is the
 * same density failure that sank the conversation-shaped home.
 *
 * A month is always 28-31 cells. A day with nothing in it is a QUIET cell, not a
 * gap. And it is the honest unit anyway -- PRODUCT_V3 §7.2 already defines a
 * record as `하루의 작은 조각 하나`. It also turns `함께한 N일` from a number into
 * something you can see.
 *
 * ## Not a calendar
 *
 * Cells are packed in date order and NOT aligned to weekdays. Weekday alignment
 * is calendar grammar, and the calendar belongs to 일정, which owns the future.
 * 우리 owns the past, and its grid is a texture rather than a lookup table.
 *
 * ## Pure
 *
 * No clock, no storage, no network. `today` is passed in so the same inputs
 * always give the same output, which is what makes this testable and what keeps
 * it agreeing with every other surface about what day it is.
 */

export interface DayCell {
  /** `YYYY-MM-DD`. */
  date: string;
  /** The day of the month, for the label. */
  day: number;
  /** Any record this viewer may see, including their own private ones. */
  hasRecord: boolean;
  /**
   * Both people wrote that day.
   *
   * The most meaningful signal this relationship has, and the reason it is
   * computed here rather than left to the renderer: it is the first rule
   * `이 달 다시 보기` selects on.
   */
  bothWrote: boolean;
  /** An event or trip covered this date. */
  special: boolean;
  /**
   * The thumbnail, from a SHARED record only.
   *
   * A private record still counts toward `hasRecord`, but never supplies the
   * picture. A `나만 보기` photo becoming the visual identity of a day on a screen
   * called 우리 -- glanceable across a room, and the most glanceable thing on it --
   * is a surprise the author did not agree to. They marked it private.
   */
  photo: { attachment: Attachment; recordId: string } | null;
  isToday: boolean;
}

export interface MonthTexture {
  /** `YYYY-MM`, and the React key. */
  key: string;
  year: number;
  /** 1-12, as people say it. */
  month: number;
  cells: DayCell[];
  /** Counts for the month header. Derived here so the header cannot disagree. */
  recordCount: number;
  photoCount: number;
  /** Days both people wrote. The number worth showing. */
  togetherCount: number;
}

function daysInMonth(year: number, month: number): number {
  // `month` is 1-12; day 0 of the next month is the last day of this one.
  return new Date(year, month, 0).getDate();
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `YYYY-MM` for a `YYYY-MM-DD`. Substring rather than `Date`, to avoid timezone drift. */
export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

function coversDate(start: string, end: string | undefined, date: string): boolean {
  return start <= date && (end || start) >= date;
}

export interface BuildMonthTextureInput {
  year: number;
  /** 1-12. */
  month: number;
  /** ALREADY narrowed by `visibleRecordsForViewer`. This function does not filter. */
  records: DailyRecord[];
  events: CoupleEvent[];
  trips: Trip[];
  /** The viewer's local today, as `YYYY-MM-DD`. */
  today: string;
  /**
   * The day they started, when the couple set one.
   *
   * Marked special like an event rather than merely forcing its month into the
   * list. Including a month because the anniversary happens to fall in it, while
   * nothing else does, just produces thirty-one grey cells again -- and the day
   * itself is genuinely a special day, which the star already means.
   */
  anniversary?: string;
}

export function buildMonthTexture(input: BuildMonthTextureInput): MonthTexture {
  const { year, month, records, events, trips, today, anniversary } = input;
  const prefix = `${year}-${pad(month)}`;

  const byDate = new Map<string, DailyRecord[]>();
  for (const record of records) {
    if (!record.date.startsWith(prefix)) continue;
    const list = byDate.get(record.date);
    if (list) list.push(record);
    else byDate.set(record.date, [record]);
  }

  const total = daysInMonth(year, month);
  const cells: DayCell[] = [];
  let recordCount = 0;
  let photoCount = 0;
  let togetherCount = 0;

  for (let day = 1; day <= total; day += 1) {
    const date = `${prefix}-${pad(day)}`;
    const dayRecords = byDate.get(date) ?? [];

    // Distinct authors. `userId` is authoritative; a queued offline record can
    // still be missing one, so `authorRole` is the fallback identity the rest of
    // the app already uses for exactly that case.
    const authors = new Set(dayRecords.map((record) => record.userId || record.authorRole));
    const bothWrote = authors.size >= 2;

    let photo: DayCell['photo'] = null;
    for (const record of dayRecords) {
      if (record.isPrivate) continue;
      for (const attachment of record.attachments ?? []) {
        // Voice has no frame to put in a square.
        if (attachment.type === 'voice') continue;
        photoCount += 1;
        if (!photo) photo = { attachment, recordId: record.id };
      }
    }

    const special = date === anniversary
      || events.some((event) => coversDate(event.startDate, event.endDate, date))
      || trips.some((trip) => coversDate(trip.startDate, trip.endDate, date));

    recordCount += dayRecords.length;
    if (bothWrote) togetherCount += 1;

    cells.push({
      date,
      day,
      hasRecord: dayRecords.length > 0,
      bothWrote,
      special,
      photo,
      isToday: date === today,
    });
  }

  return {
    key: prefix,
    year,
    month,
    cells,
    recordCount,
    photoCount,
    togetherCount,
  };
}

/**
 * Which months this relationship has, newest first.
 *
 * Months that hold something, plus the CURRENT month always -- so a couple on day
 * one sees this month waiting to be filled rather than an empty screen.
 *
 * ## Why not a contiguous range
 *
 * The first version returned every month from the earliest onward, on the theory
 * that a day-unit grid has no holes and a quiet month is quiet rather than
 * missing. That holds INSIDE a month with content. A month with none is thirty-one
 * identical grey squares, and rendering two of those in a row does not read as
 * "quiet" -- it reads as "this relationship had nothing for two months", which is
 * the exact thing 우리 exists to not say. Found by looking at it.
 *
 * Contiguity was worth something and is genuinely lost here: scrolling August to
 * June with no July is a small discontinuity. A screen of grey is a bigger cost.
 *
 * Bounded at 60. A relationship long enough to exceed that has a scrolling problem
 * this function cannot solve, and an unbounded list would make the caller
 * responsible for a limit it has no context to choose.
 */
export function monthsWithContent(input: {
  records: DailyRecord[];
  events: CoupleEvent[];
  trips: Trip[];
  /** `YYYY-MM-DD`. */
  today: string;
  /** `YYYY-MM-DD`, when the couple set one. Its month counts as holding something. */
  anniversary?: string;
}): Array<{ year: number; month: number }> {
  const { records, events, trips, today, anniversary } = input;
  const todayKey = monthKeyOf(today);

  const withContent = new Set<string>();
  const note = (date: unknown) => {
    if (typeof date !== 'string' || date.length < 7) return;
    const key = monthKeyOf(date);
    // Nothing in the future: 우리 is the past, and 일정 owns what has not happened.
    if (key <= todayKey) withContent.add(key);
  };

  for (const record of records) note(record.date);
  for (const event of events) note(event.startDate);
  for (const trip of trips) note(trip.startDate);
  note(anniversary);
  // The month in progress is always offered, empty or not.
  withContent.add(todayKey);

  const out = [...withContent]
    .sort()
    .reverse()
    .slice(0, 60)
    .map((key) => {
      const [year, month] = key.split('-').map(Number);
      return { year, month };
    });

  return out;
}

/**
 * How many months sit between two rendered months, holding nothing.
 *
 * `monthsWithContent` returns only months that hold something, which is right --
 * a month rendered as 31 identical empty squares says "this relationship had
 * nothing in it", which is both untrue and unkind. But dropping those months
 * silently makes the ones that remain look adjacent, so a couple who wrote in
 * March and again in August sees two blocks touching and five months of waiting
 * disappear.
 *
 * 우리 is the evidence of time spent apart. Time that passed quietly still
 * passed, and this is what lets the surface say so instead of editing it out.
 *
 * `newer` and `older` are `{ year, month }` with a 1-based month, in the order
 * the list renders them (newest first). Returns 0 when they are adjacent, when
 * they are the same month, or when they arrive in the wrong order -- the caller
 * renders nothing for 0, so a bad pair degrades to today's behaviour.
 */
export function monthsMissingBetween(
  newer: { year: number; month: number },
  older: { year: number; month: number },
): number {
  const distance =
    (newer.year - older.year) * 12 + (newer.month - older.month);
  return distance > 1 ? distance - 1 : 0;
}
