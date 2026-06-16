const HOLIDAYS = {
  US: {
    name: 'United States',
    fixed: [
      { month: 1,  day: 1,  name: "New Year's Day" },
      { month: 2,  day: 2,  name: "Groundhog Day" },
      { month: 2,  day: 14, name: "Valentine's Day" },
      { month: 3,  day: 17, name: "St. Patrick's Day" },
      { month: 4,  day: 22, name: "Earth Day" },
      { month: 5,  day: 5,  name: "Cinco de Mayo" },
      { month: 6,  day: 14, name: "Flag Day" },
      { month: 6,  day: 19, name: "Juneteenth" },
      { month: 7,  day: 4,  name: "Independence Day" },
      { month: 9,  day: 11, name: "Patriot Day" },
      { month: 10, day: 31, name: "Halloween" },
      { month: 11, day: 11, name: "Veterans Day" },
      { month: 12, day: 24, name: "Christmas Eve" },
      { month: 12, day: 25, name: "Christmas Day" },
      { month: 12, day: 31, name: "New Year's Eve" },
    ],
    dynamic: [
      { month: 1,  week: 3,  weekday: 1, name: "Martin Luther King Jr. Day" },
      { month: 2,  week: 3,  weekday: 1, name: "Presidents' Day" },
      { month: 4,  week: -1, weekday: 0, name: "Easter Sunday", easter: 0 },
      { month: 5,  week: 2,  weekday: 0, name: "Mother's Day" },
      { month: 5,  week: -1, weekday: 1, name: "Memorial Day" },
      { month: 6,  week: 3,  weekday: 0, name: "Father's Day" },
      { month: 9,  week: 1,  weekday: 1, name: "Labor Day" },
      { month: 10, week: 2,  weekday: 1, name: "Columbus Day" },
      { month: 11, week: 4,  weekday: 4, name: "Thanksgiving Day" },
    ]
  },
  CA: {
    name: 'Canada',
    fixed: [
      { month: 1,  day: 1,  name: "New Year's Day" },
      { month: 2,  day: 14, name: "Valentine's Day" },
      { month: 7,  day: 1,  name: "Canada Day" },
      { month: 10, day: 31, name: "Halloween" },
      { month: 11, day: 11, name: "Remembrance Day" },
      { month: 12, day: 24, name: "Christmas Eve" },
      { month: 12, day: 25, name: "Christmas Day" },
      { month: 12, day: 26, name: "Boxing Day" },
      { month: 12, day: 31, name: "New Year's Eve" },
    ],
    dynamic: [
      { month: 2, week: 3,  weekday: 1, name: "Family Day" },
      { month: 4, week: -1, weekday: 0, name: "Easter Sunday", easter: 0 },
      { month: 4, week: -1, weekday: 5, name: "Good Friday", easter: -2 },
      { month: 5, week: 2,  weekday: 0, name: "Mother's Day" },
      { month: 5, week: -1, weekday: 1, name: "Victoria Day" },
      { month: 6, week: 3,  weekday: 0, name: "Father's Day" },
      { month: 9, week: 1,  weekday: 1, name: "Labour Day" },
      { month: 10, week: 2, weekday: 1, name: "Thanksgiving Day" },
    ]
  },
  UK: {
    name: 'United Kingdom',
    fixed: [
      { month: 1,  day: 1,  name: "New Year's Day" },
      { month: 2,  day: 14, name: "Valentine's Day" },
      { month: 10, day: 31, name: "Halloween" },
      { month: 12, day: 24, name: "Christmas Eve" },
      { month: 12, day: 25, name: "Christmas Day" },
      { month: 12, day: 26, name: "Boxing Day" },
      { month: 12, day: 31, name: "New Year's Eve" },
    ],
    dynamic: [
      { month: 3, week: 3,  weekday: 0, name: "Mother's Day" },
      { month: 4, week: -1, weekday: 5, name: "Good Friday", easter: -2 },
      { month: 4, week: -1, weekday: 0, name: "Easter Sunday", easter: 0 },
      { month: 4, week: -1, weekday: 1, name: "Easter Monday", easter: 1 },
      { month: 5, week: 1,  weekday: 1, name: "Early May Bank Holiday" },
      { month: 5, week: -1, weekday: 1, name: "Spring Bank Holiday" },
      { month: 6, week: 3,  weekday: 0, name: "Father's Day" },
      { month: 8, week: -1, weekday: 1, name: "Summer Bank Holiday" },
    ]
  },
  AU: {
    name: 'Australia',
    fixed: [
      { month: 1,  day: 1,  name: "New Year's Day" },
      { month: 1,  day: 26, name: "Australia Day" },
      { month: 4,  day: 25, name: "ANZAC Day" },
      { month: 10, day: 31, name: "Halloween" },
      { month: 12, day: 24, name: "Christmas Eve" },
      { month: 12, day: 25, name: "Christmas Day" },
      { month: 12, day: 26, name: "Boxing Day" },
      { month: 12, day: 31, name: "New Year's Eve" },
    ],
    dynamic: [
      { month: 4, week: -1, weekday: 5, name: "Good Friday", easter: -2 },
      { month: 4, week: -1, weekday: 0, name: "Easter Sunday", easter: 0 },
      { month: 4, week: -1, weekday: 1, name: "Easter Monday", easter: 1 },
      { month: 5, week: 2,  weekday: 0, name: "Mother's Day" },
      { month: 6, week: 2,  weekday: 0, name: "Queen's Birthday" },
      { month: 9, week: 1,  weekday: 0, name: "Father's Day" },
    ]
  }
};

function getEasterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function getNthWeekday(year, month, week, weekday) {
  // week: 1-4 for nth occurrence, -1 for last
  // weekday: 0=Sun, 1=Mon ... 6=Sat
  if (week > 0) {
    const first = new Date(year, month - 1, 1);
    const firstWeekday = first.getDay();
    let day = 1 + ((weekday - firstWeekday + 7) % 7) + (week - 1) * 7;
    return new Date(year, month - 1, day);
  } else {
    // Last occurrence
    const last = new Date(year, month, 0);
    const lastWeekday = last.getDay();
    let day = last.getDate() - ((lastWeekday - weekday + 7) % 7);
    return new Date(year, month - 1, day);
  }
}

function getHolidaysForYear(year, countryCodes) {
  const holidays = [];

  countryCodes.forEach(code => {
    const country = HOLIDAYS[code];
    if (!country) return;

    // Fixed holidays
    country.fixed.forEach(h => {
      const date = new Date(year, h.month - 1, h.day);
      holidays.push({
        id: `holiday-${code}-${h.month}-${h.day}-${year}`,
        title: h.name,
        date: `${year}-${String(h.month).padStart(2, '0')}-${String(h.day).padStart(2, '0')}`,
        type: 'holiday',
        source: 'holiday',
        country: code,
        time: '',
        notes: country.name
      });
    });

    // Dynamic holidays
    country.dynamic.forEach(h => {
      let date;
      if (h.easter !== undefined) {
        const easter = getEasterDate(year);
        date = new Date(easter);
        date.setDate(easter.getDate() + h.easter);
      } else {
        date = getNthWeekday(year, h.month, h.week, h.weekday);
      }
      if (date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        holidays.push({
          id: `holiday-${code}-${h.name.replace(/\s/g, '')}-${year}`,
          title: h.name,
          date: `${y}-${m}-${d}`,
          type: 'holiday',
          source: 'holiday',
          country: code,
          time: '',
          notes: country.name
        });
      }
    });
  });

  return holidays;
}

function getHolidaysForMonth(year, month, countryCodes) {
  if (!countryCodes || countryCodes.length === 0) return [];
  const allHolidays = getHolidaysForYear(year, countryCodes);
  const monthStr = String(month + 1).padStart(2, '0');
  return allHolidays.filter(h => h.date.startsWith(`${year}-${monthStr}`));
}