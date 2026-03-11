/* exported AppState, parseTimestamp, normaliseRows */
// data.js — State, data normalisation, timestamp parsing

// State — centralised into a single object to avoid scattered globals
const AppState = {
  allData:    [],
  sortCol:    0,
  sortAsc:    false,
  datePicker: null,
  debug: false,
};

// Use AppState directly to avoid divergent copies in memory/UI

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

    // กำหนดรูปแบบวันที่ที่มักจะมาจาก Google Sheets เพื่อให้ Day.js ช่วยแปลง
    const formats = [
      'YYYY-MM-DDTHH:mm:ss.SSSZ', // ISO Format
      'YYYY-MM-DD HH:mm:ss',
      'YYYY-MM-DD',
      'DD/MM/YYYY HH:mm:ss',
      'DD/MM/YYYY',
      'MM/DD/YYYY HH:mm:ss',
      'MM/DD/YYYY'
    ];

    // ใช้ dayjs พร้อม plugin (ที่ดึงมาจาก index.html) ช่วยประมวลผล
    // strict: true ป้องกัน false-positive เช่น "99/99/9999" ที่อาจผ่านได้โดยไม่ตั้งใจ
    const parsed = dayjs(raw, formats, true); 

    if (parsed.isValid()) {
      return parsed.toDate();
    }

    // กรณีที่เจอ Format แปลกๆ ให้ Fallback กลับไปใช้วิธีพื้นฐานของ JavaScript
    const fallbackDate = new Date(raw);
    return Number.isNaN(fallbackDate.getTime()) ? null : fallbackDate;
  }

  // data.js — Optimized Data Handling

// ฟังก์ชันช่วยทำความสะอาดข้อมูลตัวเลข
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
    
    // ค้นหา Column ที่ตรงกับชุดข้อมูลที่ต้องการ
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
      // ถ้าเป็นค่าตัวเลข ให้ทำการ Clean ข้อมูลก่อน
      if (['PM2.5', 'PM10', 'Temperature', 'Humidity'].includes(newKey)) {
        out[newKey] = cleanNum(v);
      } else {
        out[newKey] = v;
      }
    });
    return out;
  });
}


