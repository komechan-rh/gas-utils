import type { CalendarEvent } from "./types";

const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDateLabel(date: Date): string {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const dow = DAY_LABELS[date.getDay()];
  return `【${dow}】${m}/${d}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatWeeklyMessage(events: CalendarEvent[], from: Date): string {
  const to = new Date(from);
  to.setDate(to.getDate() + 6);

  const fromLabel = `${from.getMonth() + 1}/${from.getDate()}`;
  const toLabel = `${to.getMonth() + 1}/${to.getDate()}`;
  const lines: string[] = [`📅 今週のスケジュール（${fromLabel}〜${toLabel}）`];

  for (let i = 0; i < 7; i++) {
    const day = new Date(from);
    day.setDate(day.getDate() + i);

    const dayEvents = events.filter((e) => isSameDay(e.startTime, day));
    lines.push("");
    lines.push(formatDateLabel(day));

    if (dayEvents.length === 0) {
      lines.push("・予定なし");
    } else {
      const sorted = [...dayEvents].sort((a, b) => {
        if (a.isAllDay && !b.isAllDay) return -1;
        if (!a.isAllDay && b.isAllDay) return 1;
        return a.startTime.getTime() - b.startTime.getTime();
      });

      for (const event of sorted) {
        if (event.isAllDay) {
          lines.push(`・終日 ${event.title}`);
        } else {
          lines.push(`・${formatTime(event.startTime)} ${event.title}`);
        }
      }
    }
  }

  return lines.join("\n");
}

export { formatWeeklyMessage };
