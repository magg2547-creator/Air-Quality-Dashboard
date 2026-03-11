// data.js â€” State, data normalisation, timestamp parsing

// State â€” centralised into a single object to avoid scattered globals
const AppState = {
  allData:    [],
  sortCol:    0,
  sortAsc:    false,
  datePicker: null,
};

// Backward-compatible aliases (used throughout script.js)
// Reading: use AppState.xxx directly where possible
// Writing: assign to both alias and AppState so existing code keeps working
let allData    = AppState.allData;   // NOTE: re-assign AppState.allData when replacing the array
let sortCol    = AppState.sortCol;
let sortAsc    = AppState.sortAsc;
let datePicker = AppState.datePicker;

const COL_MAP = {
  'Timestamp':   ['timestamp', 'time', 'datetime', 'date'],
  'PM2.5':       ['pm2.5', 'pm25', 'pm2_5', 'pm2-5'],
  'PM10':        ['pm10', 'pm_10'],
  'Temperature': ['temperature', 'temp', 'tmp'],
  'Humidity':    ['humidity', 'humi', 'humid', 'rh']
};

function parseTimestamp(value) {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (value === null || value === undefined || String(value).trim() === '') {
      return null;
    }

    const raw = String(value).trim();

    // à¸à¸³à¸«à¸™à¸”à¸£à¸¹à¸›à¹à¸šà¸šà¸§à¸±à¸™à¸—à¸µà¹ˆà¸—à¸µà¹ˆà¸¡à¸±à¸à¸ˆà¸°à¸¡à¸²à¸ˆà¸²à¸ Google Sheets à¹€à¸žà¸·à¹ˆà¸­à¹ƒà¸«à¹‰ Day.js à¸Šà¹ˆà¸§à¸¢à¹à¸›à¸¥à¸‡
    const formats = [
      'YYYY-MM-DDTHH:mm:ss.SSSZ', // ISO Format
      'YYYY-MM-DD HH:mm:ss',
      'YYYY-MM-DD',
      'DD/MM/YYYY HH:mm:ss',
      'DD/MM/YYYY',
      'MM/DD/YYYY HH:mm:ss',
      'MM/DD/YYYY'
    ];

    // à¹ƒà¸Šà¹‰ dayjs à¸žà¸£à¹‰à¸­à¸¡ plugin (à¸—à¸µà¹ˆà¸”à¸¶à¸‡à¸¡à¸²à¸ˆà¸²à¸ index.html) à¸Šà¹ˆà¸§à¸¢à¸›à¸£à¸°à¸¡à¸§à¸¥à¸œà¸¥
    // strict: true à¸›à¹‰à¸­à¸‡à¸à¸±à¸™ false-positive à¹€à¸Šà¹ˆà¸™ "99/99/9999" à¸—à¸µà¹ˆà¸­à¸²à¸ˆà¸œà¹ˆà¸²à¸™à¹„à¸”à¹‰à¹‚à¸”à¸¢à¹„à¸¡à¹ˆà¸•à¸±à¹‰à¸‡à¹ƒà¸ˆ
    const parsed = dayjs(raw, formats, true); 

    if (parsed.isValid()) {
      return parsed.toDate();
    }

    // à¸à¸£à¸“à¸µà¸—à¸µà¹ˆà¹€à¸ˆà¸­ Format à¹à¸›à¸¥à¸à¹† à¹ƒà¸«à¹‰ Fallback à¸à¸¥à¸±à¸šà¹„à¸›à¹ƒà¸Šà¹‰à¸§à¸´à¸˜à¸µà¸žà¸·à¹‰à¸™à¸à¸²à¸™à¸‚à¸­à¸‡ JavaScript
    const fallbackDate = new Date(raw);
    return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate;
  }

  // data.js â€” Optimized Data Handling

// à¸Ÿà¸±à¸‡à¸à¹Œà¸Šà¸±à¸™à¸Šà¹ˆà¸§à¸¢à¸—à¸³à¸„à¸§à¸²à¸¡à¸ªà¸°à¸­à¸²à¸”à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸•à¸±à¸§à¹€à¸¥à¸‚
function cleanNum(val, fallback = 0) {
  const n = parseFloat(val);
  return isNaN(n) ? fallback : n;
}

function normaliseRows(rows) {
  if (!rows || !rows.length) return rows;

  const sample = rows[0];
  const keyMap = {};

  Object.keys(sample).forEach(origKey => {
    const trimmed = origKey.trim();
    const lc = trimmed.toLowerCase();
    
    // à¸„à¹‰à¸™à¸«à¸² Column à¸—à¸µà¹ˆà¸•à¸£à¸‡à¸à¸±à¸šà¸Šà¸¸à¸”à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸—à¸µà¹ˆà¸•à¹‰à¸­à¸‡à¸à¸²à¸£
    let matchedKey = trimmed;
    for (const [canonical, aliases] of Object.entries(COL_MAP)) {
      if (canonical === trimmed || aliases.includes(lc)) {
        matchedKey = canonical;
        break;
      }
    }
    keyMap[origKey] = matchedKey;
  });

  return rows.map(row => {
    const out = {};
    Object.entries(row).forEach(([k, v]) => {
      const newKey = keyMap[k];
      // à¸–à¹‰à¸²à¹€à¸›à¹‡à¸™à¸„à¹ˆà¸²à¸•à¸±à¸§à¹€à¸¥à¸‚ à¹ƒà¸«à¹‰à¸—à¸³à¸à¸²à¸£ Clean à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸à¹ˆà¸­à¸™
      if (['PM2.5', 'PM10', 'Temperature', 'Humidity'].includes(newKey)) {
        out[newKey] = cleanNum(v);
      } else {
        out[newKey] = v;
      }
    });
    return out;
  });
}


