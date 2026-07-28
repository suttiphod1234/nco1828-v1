import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Gemini AI Client Helper (Lazy Initialization)
let aiClient = null;
function getGeminiClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not configured');
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return aiClient;
}

// In-memory store for registrations (pre-populated with default sample records)
const registrations = [
  {
    rowNum: 1,
    timestamp: "2026-08-01 10:30:00",
    fullName: "จ.ส.อ. สมชาย ใจดี",
    email: "somchai@example.com",
    phoneMasked: "089-***-1550",
    memberStatus: "เป็นสมาชิก",
    packageSelected: "คนเดียว (ไม่เอาห้องพัก) (800 บ.)",
    mainShirtSize: "L",
    followerCount: 0,
    followerRoom: "ไม่รับห้องพัก",
    extraShirts: "ไม่มี",
    totalAmount: 800,
    paymentStatus: "ลงทะเบียนแล้ว (รอตรวจสอบสลิป)"
  },
  {
    rowNum: 2,
    timestamp: "2026-08-02 14:15:00",
    fullName: "ร.ต. วันชัย มีชาญ",
    email: "wanchai@example.com",
    phoneMasked: "081-***-9876",
    memberStatus: "เป็นสมาชิก",
    packageSelected: "2 คน (พร้อมห้องพัก) (1500 บ.)",
    mainShirtSize: "XL",
    followerCount: 1,
    followerRoom: "รับห้องพัก (+200B)",
    extraShirts: "M (1 ตัว)",
    totalAmount: 2200,
    paymentStatus: "ลงทะเบียนแล้ว (รอตรวจสอบสลิป)"
  }
];

// Helper to parse Google Sheets CSV export
function parseCSV(text) {
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentVal.trim());
      if (currentRow.some(c => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }
  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some(c => c.length > 0)) {
      rows.push(currentRow);
    }
  }
  return rows;
}

// Fetch Live Registrations from Google Sheets API / CSV Export
async function getLiveRegistrations() {
  const sheetId = "1N4E2U1sXdU7HMCDASg5s8hxceXLJ_aRigan-pYsh-p0";
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('รายการจอง')}`;
  
  try {
    const response = await fetch(csvUrl, { signal: AbortSignal.timeout(4000) });
    if (response.ok) {
      const csvText = await response.text();
      const rawRows = parseCSV(csvText);
      if (rawRows.length > 1) {
        const sheetRegistrations = [];
        for (let i = 1; i < rawRows.length; i++) {
          const row = rawRows[i];
          const timestamp = row[0] || "";
          const name = row[1] || "";
          if (!name) continue;

          let email = "";
          let phone = "";
          let offset = 0;

          if (String(row[2] || "").includes("@")) {
            email = row[2] || "";
            phone = row[3] || "";
            offset = 0;
          } else {
            email = "-";
            phone = row[2] || "";
            offset = -1;
          }

          const memberStatus = row[4 + offset] || "";
          const packageSelected = row[5 + offset] || "";
          const mainShirtSize = row[6 + offset] || "";
          const followerCount = parseInt(row[7 + offset]) || 0;
          const followerRoom = row[8 + offset] || "";
          const extraShirts = row[9 + offset] || "ไม่มี";
          const totalAmount = parseInt(row[10 + offset]) || 0;
          const paymentStatus = row[11 + offset] || "ลงทะเบียนแล้ว (รอตรวจสอบสลิป)";

          let maskedPhone = phone;
          if (phone.length >= 9) {
            maskedPhone = phone.substring(0, 3) + "-***-" + phone.substring(phone.length - 4);
          }

          sheetRegistrations.push({
            rowNum: i,
            timestamp,
            fullName: name,
            email,
            phoneMasked: maskedPhone,
            memberStatus,
            packageSelected,
            mainShirtSize,
            followerCount,
            followerRoom,
            extraShirts,
            totalAmount,
            paymentStatus
          });
        }

        if (sheetRegistrations.length > 0) {
          const namesInSheet = new Set(sheetRegistrations.map(s => s.fullName.trim()));
          const newLocal = registrations.filter(r => !namesInSheet.has(r.fullName.trim()));
          return [...sheetRegistrations, ...newLocal];
        }
      }
    }
  } catch (err) {
    // Fallback quietly to server registrations store if Google Sheet is private or offline
  }
  return registrations;
}

// API Endpoint for Google Apps Script replacement / local backend
app.get('/api/booking', async (req, res) => {
  const action = req.query.action || 'list';
  const keyword = (req.query.keyword || '').trim().toLowerCase();

  if (action === 'search' || action === 'list') {
    const liveData = await getLiveRegistrations();
    let filtered = liveData;
    if (keyword) {
      filtered = liveData.filter(r =>
        r.fullName.toLowerCase().includes(keyword) ||
        r.phoneMasked.toLowerCase().includes(keyword) ||
        (r.email && r.email.toLowerCase().includes(keyword)) ||
        (r.packageSelected && r.packageSelected.toLowerCase().includes(keyword)) ||
        (r.mainShirtSize && r.mainShirtSize.toLowerCase().includes(keyword))
      );
    }
    return res.json({ status: "success", data: filtered });
  }

  res.json({ status: "success", message: "NCO.1828 Booking Web App API is running" });
});

app.post('/api/booking', (req, res) => {
  try {
    const data = req.body;
    const name = data.fullName || '';
    const email = data.email || '';
    const phone = data.phone || '';
    const memberStatus = data.memberStatus || '';
    const packageSelected = data.packageSelected || '';
    const mainShirtSize = data.mainShirtSize || '';
    const followerCount = parseInt(data.followerCount) || 0;
    const followerRoom = data.followerRoom ? "รับห้องพัก (+200B)" : "ไม่รับห้องพัก";
    const extraShirts = data.extraShirtsDetail || "ไม่มี";
    const totalAmount = data.totalAmount || 0;
    const paymentOption = data.paymentOption || "ชำระเงินทันที";

    let paymentStatus = "รับข้อมูลแล้ว (รอตรวจสอบสลิป)";
    if (paymentOption === "ไว้ชำระเงินทีหลัง") {
      paymentStatus = "ลงทะเบียนแล้ว (ไว้ชำระเงินทีหลัง)";
    }

    let maskedPhone = phone;
    if (phone.length >= 9) {
      maskedPhone = phone.substring(0, 3) + "-***-" + phone.substring(phone.length - 4);
    }

    const newEntry = {
      rowNum: registrations.length + 1,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      fullName: name,
      email: email,
      phoneMasked: maskedPhone,
      memberStatus: memberStatus,
      packageSelected: packageSelected,
      mainShirtSize: mainShirtSize,
      followerCount: followerCount,
      followerRoom: followerRoom,
      extraShirts: extraShirts,
      totalAmount: totalAmount,
      paymentStatus: paymentStatus
    };

    registrations.push(newEntry);

    res.json({ status: "success", message: "ลงทะเบียนเรียบร้อยแล้ว" });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.toString() });
  }
});

// AI Chat Assistant Endpoint (using free model gemini-3.6-flash)
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ status: "error", message: "กรุณาระบุข้อความที่ต้องการสอบถาม" });
    }

    const ai = getGeminiClient();

    const systemInstruction = `คุณคือผู้ช่วยตอบคำถาม AI อัตโนมัติประจำงานเลี้ยงรุ่น NCO.1828 เหล่าทหารปืนใหญ่ (ศป. / โรงเรียนทหารปืนใหญ่)
คอยตอบคำถามและให้ข้อมูลแก่เพื่อนๆ ศิษย์เก่าหรือผู้สนใจเกี่ยวกับการลงทะเบียนงานเลี้ยงรุ่น NCO.1828

ข้อมูลงานและรายละเอียดสำคัญ:
- ชื่องาน: งานเลี้ยงรุ่น NCO.1828 เหล่าทหารปืนใหญ่
- แพ็กเกจสมาชิก (เป็นสมาชิก):
  1. คนเดียว (ไม่เอาห้องพัก): 800 บาท (ได้เสื้อรุ่น 1 ตัว)
  2. คนเดียว (พร้อมห้องพัก): 1,300 บาท (ได้เสื้อรุ่น 1 ตัว + เตียงเดี่ยว/ห้องพัก)
  3. 2 คน (พร้อมห้องพัก): 1,500 บาท (ได้เสื้อรุ่น 1 ตัวสำหรับผู้เข้าพัก + เตียงคู่/ห้องพัก)
- แพ็กเกจผู้ไม่ได้เป็นสมาชิก (ไม่เป็นสมาชิก):
  1. คนเดียว (ไม่เอาห้องพัก): 1,000 บาท
  2. คนเดียว (พร้อมห้องพัก): 1,500 บาท
  3. 2 คน (พร้อมห้องพัก): 1,700 บาท
- ผู้ติดตาม: สามารถเพิ่มผู้ติดตามได้ หากผู้ติดตามรับห้องพัก คิดเพิ่ม 200 บาท/คน
- เสื้อรุ่นเพิ่มเติม: ตัวละ 330 บาท (ขนาด XS, S, M, L, XL, 2L, 3L) และตัวละ 400 บาท (ขนาดพิเศษ 5L/รอบอก 52 นิ้ว และ 7L/รอบอก 56 นิ้ว)
- บัญชีโอนเงิน: ธนาคารไทยพาณิชย์ (SCB) เลขที่บัญชี 560-286-0945 ชื่อบัญชี ร.ต.วันชัย มีชาญ
- ตัวเลือกการชำระเงิน: สามารถโอนชำระเงินทันที (พร้อมแนบสลิป) หรือเลือก "ไว้ชำระเงินทีหลัง" ก็ได้ (โอนชำระได้จนถึง 31 ธ.ค. 2569)
- สอบถามผู้จัดงานเพิ่มเติม: โทร 089-208-1550 (ร.ต.วันชัย มีชาญ)

คำแนะนำในการตอบ:
- ตอบด้วยภาษาไทย สุภาพ เป็นกันเอง กระชับ และอบอุ่น สไตล์เพื่อนทหารร่วมรุ่น NCO.1828
- หากผู้ใช้ถามเรื่องราคา, เสื้อ, ห้องพัก หรือการโอนเงิน ให้ตอบข้อมูลที่ถูกต้องตามรายละเอียดด้านบน`;

    const contents = [];
    if (Array.isArray(history) && history.length > 0) {
      for (const item of history) {
        if (item.role && item.content) {
          contents.push({
            role: item.role === 'user' ? 'user' : 'model',
            parts: [{ text: item.content }]
          });
        }
      }
    }

    contents.push({
      role: 'user',
      parts: [{ text: message }]
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7
      }
    });

    const reply = response.text || 'ขออภัยครับ ไม่สามารถสร้างคำตอบได้ในขณะนี้';
    res.json({ status: "success", reply });
  } catch (err) {
    console.error("Gemini Chat API Error:", err);
    res.status(500).json({
      status: "error",
      message: err.message || "เกิดข้อผิดพลาดในการประมวลผลระบบ AI แชท"
    });
  }
});

// Serve static files from root directory
app.use(express.static(__dirname));

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
