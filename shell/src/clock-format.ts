// Omarchy's clock formats are Qt date-time formats ("dddd HH:mm",
// "h:mm AP", "d MMMM 'W'ww yyyy"): the subset Omarchy's menu offers, with
// English names.
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const TOKEN = /'[^']*'|dddd|ddd|dd|d|MMMM|MMM|MM|M|yyyy|yy|HH|H|hh|h|mm|m|ss|s|AP|ap|ww|w/g;

const two = (n: number) => (n < 10 ? `0${n}` : String(n));

/** ISO 8601 week number. */
function week(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - start) / 86400000 + 1) / 7);
}

export function formatClock(format: string, date: Date): string {
  const h12 = date.getHours() % 12 || 12;
  return format.replace(TOKEN, (t) => {
    switch (t) {
      case "dddd": return DAYS[date.getDay()]!;
      case "ddd": return DAYS[date.getDay()]!.slice(0, 3);
      case "dd": return two(date.getDate());
      case "d": return String(date.getDate());
      case "MMMM": return MONTHS[date.getMonth()]!;
      case "MMM": return MONTHS[date.getMonth()]!.slice(0, 3);
      case "MM": return two(date.getMonth() + 1);
      case "M": return String(date.getMonth() + 1);
      case "yyyy": return String(date.getFullYear());
      case "yy": return two(date.getFullYear() % 100);
      case "HH": return two(date.getHours());
      case "H": return String(date.getHours());
      case "hh": return two(h12);
      case "h": return String(h12);
      case "mm": return two(date.getMinutes());
      case "m": return String(date.getMinutes());
      case "ss": return two(date.getSeconds());
      case "s": return String(date.getSeconds());
      case "AP": return date.getHours() < 12 ? "AM" : "PM";
      case "ap": return date.getHours() < 12 ? "am" : "pm";
      case "ww": return two(week(date));
      case "w": return String(week(date));
      default: return t.slice(1, -1); // 'literal'
    }
  });
}
