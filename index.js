const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const cron = require('node-cron');
const Parser = require('rss-parser');

const app = express();
app.use(express.json());

// Khởi tạo RSS Parser
const parser = new Parser({
  timeout: 5000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  }
});

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const HIS_BASE_URL = 'https://tied-discounted-engineer-suspected.trycloudflare.com';

const KIOSK_CODE = process.env.KIOSK_CODE || 'quay01';
const KIOSK_PASSWORD = process.env.KIOSK_PASSWORD || '68686868';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '';

// Biến điều khiển lấy số tự động
let autoTicketInterval = null;
let currentDeptIndex = 0;
const AUTO_DEPTS = [
  { id: 'dept_bh', name: 'Bảo hiểm y tế' },
  { id: 'dept_vp', name: 'Viện phí' },
  { id: 'dept_yc', name: 'Khám theo yêu cầu' },
  { id: 'dept_ut', name: 'Ưu tiên' }
];

const COUNTER_MAP = {
  'vienphi': 'cnt_9a545709',
  'yeucau': 'cnt_e6cce8f3',
  'uutien': 'cnt_0c9973ab',
  'baohiem': 'cnt_ca177a18',
  'default': 'cnt_ca177a18'
};

async function sendMessage(chatId, text, replyMarkup = null) {
  if (!chatId) return;
  try {
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    await axios.post(`${TELEGRAM_API}/sendMessage`, payload);
  } catch (error) {
    console.error('Lỗi gửi tin nhắn Telegram:', error.response?.data || error.message);
  }
}

async function askGroq(promptText) {
  if (!GROQ_API_KEY) return { error: "Chưa cấu hình GROQ_API_KEY trên Render!" };
  const cleanKey = GROQ_API_KEY.trim();
  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: 'Bạn là một trợ lý AI thông minh, lịch sự và trả lời bằng tiếng Việt.' },
          { role: 'user', content: promptText }
        ],
        temperature: 0.7
      },
      {
        headers: { 'Authorization': `Bearer ${cleanKey}`, 'Content-Type': 'application/json' },
        timeout: 30000
      }
    );
    const content = response.data?.choices?.[0]?.message?.content?.trim();
    if (content) return { text: content };
    return { error: "Groq không trả về nội dung." };
  } catch (err) {
    return { error: err.response?.data?.error?.message || err.message };
  }
}

async function getNewsFromSource(rssUrl, sourceName, limit = 3) {
  try {
    let feed;
    if (rssUrl.includes('24h.com.vn')) {
      const response = await axios.get(rssUrl, {
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cache-Control': 'no-cache'
        }
      });
      feed = await parser.parseStringPromise(response.data);
    } else {
      feed = await parser.parseURL(rssUrl);
    }

    let resultText = `📰 **TIN MỚI TỪ ${sourceName.toUpperCase()}**:\n`;
    const items = feed.items ? feed.items.slice(0, limit) : [];
    if (items.length === 0) return `⚠️ Không có bài viết mới từ ${sourceName}.`;

    items.forEach((item, index) => {
      const title = item.title ? item.title.trim() : 'Không có tiêu đề';
      const link = item.link ? item.link.trim() : '#';
      resultText += `${index + 1}. [${title}](${link})\n`;
    });
    return resultText;
  } catch (error) {
    return `⚠️ Không thể lấy tin từ ${sourceName}.`;
  }
}

async function getAllLatestNews() {
  const [vnexpress, dantri, h24] = await Promise.allSettled([
    getNewsFromSource('https://vnexpress.net/rss/tin-moi-nhat.rss', 'VnExpress', 3),
    getNewsFromSource('https://dantri.com.vn/rss/home.rss', 'Dân Trí', 3),
    getNewsFromSource('https://cdn.24h.com.vn/upload/rss/tintuctrongngay.rss', '24h.com.vn', 3)
  ]);

  const vnVal = vnexpress.status === 'fulfilled' ? vnexpress.value : '';
  const dtVal = dantri.status === 'fulfilled' ? dantri.value : '';
  const h24Val = h24.status === 'fulfilled' ? h24.value : '';

  return `🔥 **CẬP NHẬT TIN TỨC NỔI BẬT HÔM NAY** 🔥\n\n` +
         (vnVal ? `${vnVal}\n\n` : '') +
         (dtVal ? `${dtVal}\n\n` : '') +
         (h24Val ? `${h24Val}\n\n` : '') +
         `👉 *Bấm vào tiêu đề để xem bài viết chi tiết!*`;
}

async function getWeatherVinh() {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=18.6734&longitude=105.6923&current_weather=true&timezone=Asia%2FHo_Chi_Minh';
    const res = await axios.get(url, { timeout: 10000 });
    const weather = res.data?.current_weather;
    if (weather) {
      return `🌤️ **Thời tiết TP. Vinh - Nghệ An:**\n• Nhiệt độ: **${weather.temperature}°C**\n• Tốc độ gió: **${weather.windspeed} km/h**`;
    }
    return "⚠️ Không thể lấy thông tin thời tiết.";
  } catch (e) {
    return "⚠️ Lỗi kết nối thời tiết.";
  }
}

async function getBitcoinPrice() {
  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,vnd';
    const res = await axios.get(url, { timeout: 10000 });
    const btc = res.data?.bitcoin;
    if (btc) {
      return `📈 **Giá Bitcoin hôm nay:**\n• BTC/USD: **$${btc.usd.toLocaleString('en-US')}**\n• BTC/VND: **${btc.vnd.toLocaleString('vi-VN')} VNĐ**`;
    }
    return "⚠️ Không thể lấy giá Bitcoin.";
  } catch (e) {
    return "⚠️ Lỗi kết nối giá Bitcoin.";
  }
}

async function getGoldPrice() {
  try {
    const prompt = "Hãy tổng hợp ngắn gọn giá vàng SJC / PNJ mới nhất hôm nay tại Việt Nam. Chỉ đưa ra con số Mua vào - Bán ra ước tính trong 2 dòng.";
    const result = await askGroq(prompt);
    return `🏆 **Giá Vàng hôm nay tại Việt Nam:**\n${result.text || "⚠️ Chưa cập nhật được giá vàng."}`;
  } catch (e) {
    return "⚠️ Lỗi cập nhật giá vàng.";
  }
}

// --- API LẤY SỐ KHÁM BỆNH ---
async function createTicket(departmentId) {
  try {
    let kioskToken = null;

    try {
      const unlockRes = await axios.post(
        `${HIS_BASE_URL}/api/kiosk/unlock`,
        { code: KIOSK_CODE, kioskCode: KIOSK_CODE, password: KIOSK_PASSWORD },
        { headers: { 'Content-Type': 'application/json' }, timeout: 5000 }
      );
      kioskToken = unlockRes.data?.token || unlockRes.data?.data?.token || unlockRes.data?.access_token;
    } catch (e) {
      console.warn("Mở khóa Kiosk thất bại:", e.response?.data || e.message);
    }

    const headers = { 'Content-Type': 'application/json' };
    const bodyPayload = { departmentId, kioskCode: KIOSK_CODE };

    if (kioskToken) {
      headers['X-Kiosk-Token'] = kioskToken;
      headers['Authorization'] = `Bearer ${kioskToken}`;
      headers['token'] = kioskToken;
      bodyPayload.kioskToken = kioskToken;
      bodyPayload.token = kioskToken;
    }

    const res = await axios.post(
      `${HIS_BASE_URL}/api/tickets`,
      bodyPayload,
      { headers, timeout: 10000 }
    );

    return res.data;
  } catch (error) {
    return {
      error: true,
      message: error.response?.data?.message || error.response?.data?.error || error.message
    };
  }
}

async function controlCounter(action, counterKey) {
  const counterId = COUNTER_MAP[counterKey?.toLowerCase()] || counterKey || COUNTER_MAP['default'];
  try {
    const res = await axios.post(`${HIS_BASE_URL}/api/counters/${counterId}/${action}`, {}, { timeout: 10000 });
    return { data: res.data, counterId };
  } catch (error) {
    return null;
  }
}

function getInfoMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🌤️ Thời tiết TP. Vinh", callback_data: "info_weather" }],
      [{ text: "🪙 Giá Bitcoin hôm nay", callback_data: "info_btc" }],
      [{ text: "🏆 Giá Vàng Việt Nam", callback_data: "info_gold" }],
      [{ text: "📰 Tin tức 24h, Dân Trí, VnExpress", callback_data: "info_news" }],
      [{ text: "⏰ Nhắc nhở / Bấm số khám bệnh", callback_data: "info_layso" }],
      [{ text: "📊 Xem tất cả Bản tin tổng hợp", callback_data: "info_all" }]
    ]
  };
}

// Lập lịch bản tin sáng 07:00
cron.schedule('0 7 * * *', async () => {
  if (!ADMIN_CHAT_ID) return;

  const weatherText = await getWeatherVinh();
  const btcText = await getBitcoinPrice();
  const goldText = await getGoldPrice();

  const keyboard = {
    inline_keyboard: [
      [{ text: "🛡️ Bảo hiểm y tế (dept_bh)", callback_data: "layso_dept_bh" }],
      [{ text: "💵 Viện phí (dept_vp)", callback_data: "layso_dept_vp" }],
      [{ text: "⭐ Khám theo yêu cầu (dept_yc)", callback_data: "layso_dept_yc" }],
      [{ text: "❤️ Ưu tiên (dept_ut)", callback_data: "layso_dept_ut" }]
    ]
  };

  const morningMessage = 
    "☀️ **BẢN TIN SÁNG & NHẮC NHỞ ĐẦU NGÀY** ☀️\n\n" +
    `${weatherText}\n\n${btcText}\n\n${goldText}\n\n` +
    "───────────────────\n" +
    "⏰ **NHẮC NHỞ LẤY SỐ KHÁM BỆNH:**\n" +
    "Bấm chọn đối tượng bên dưới để cấp số mở hàng:";

  await sendMessage(ADMIN_CHAT_ID, morningMessage, keyboard);
}, { timezone: "Asia/Ho_Chi_Minh" });

// --- XỬ LÝ SỰ KIỆN NÚT BẤM TELEGRAM ---
async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  try { await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, { callback_query_id: callbackQuery.id }); } catch (e) {}

  if (data === 'info_weather') {
    await sendMessage(chatId, await getWeatherVinh());
  } else if (data === 'info_btc') {
    await sendMessage(chatId, await getBitcoinPrice());
  } else if (data === 'info_gold') {
    await sendMessage(chatId, await getGoldPrice());
  } else if (data === 'info_news') {
    await sendMessage(chatId, await getAllLatestNews());
  } else if (data === 'info_layso') {
    const keyboard = {
      inline_keyboard: [
        [{ text: "🛡️ Bảo hiểm y tế (dept_bh)", callback_data: "layso_dept_bh" }],
        [{ text: "💵 Viện phí (dept_vp)", callback_data: "layso_dept_vp" }],
        [{ text: "⭐ Khám theo yêu cầu (dept_yc)", callback_data: "layso_dept_yc" }],
        [{ text: "❤️ Ưu tiên (dept_ut)", callback_data: "layso_dept_ut" }]
      ]
    };
    await sendMessage(chatId, "⏰ **BẤM SỐ KHÁM BỆNH:** Chọn đối tượng:", keyboard);
  } else if (data === 'info_all') {
    const weather = await getWeatherVinh();
    const btc = await getBitcoinPrice();
    const goldText = await getGoldPrice();
    await sendMessage(chatId, `📊 **BẢN TIN TỔNG HỢP HÔM NAY**\n\n${weather}\n\n${btc}\n\n${goldText}`);
  } else if (data.startsWith('layso_')) {
    const deptId = data.replace('layso_', '');
    await sendMessage(chatId, "⏳ Đang cấp số thứ tự...");
    const result = await createTicket(deptId);
    if (result && !result.error && result.code) {
      await sendMessage(chatId, `🎉 **CẤP SỐ THÀNH CÔNG!**\n🏥 Đối tượng: ${result.departmentName || deptId}\n🔢 Số: \`${result.code}\``);
    } else {
      await sendMessage(chatId, `❌ Lỗi cấp số: ${result?.message || 'Không kết nối được HIS'}`);
    }
  } else if (data.startsWith('goiso_')) {
    const counterKey = data.replace('goiso_', '');
    const res = await controlCounter('call-next', counterKey);
    if (res?.data?.ticket) {
      await sendMessage(chatId, `📢 **ĐÃ GỌI SỐ:** \`${res.data.ticket.code}\`!`);
    } else {
      await sendMessage(chatId, "⚠️ Hàng đợi trống hoặc không thể gọi.");
    }
  }
}

// WEBHOOK
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  if (req.body?.callback_query) {
    await handleCallbackQuery(req.body.callback_query);
    return;
  }

  const message = req.body?.message;
  if (!message) return;

  const chatId = message.chat.id;
  const userText = message.text ? message.text.trim() : '';

  try {
    if (userText.startsWith('/start')) {
      await sendMessage(
        chatId, 
        `👋 **TRỢ LÝ AI - HỆ THỐNG LẤY SỐ KHÁM BỆNH**\n\n` +
        "• `/thongtin` : Menu Tin tức, Thời tiết, Giá vàng.\n" +
        "• `/layso` : Danh sách đối tượng lấy số thủ công.\n" +
        "• `/tudong` : 🤖 **Bật chế độ tự động lấy số 1 phút/lần xoay vòng**.\n" +
        "• `/dungtudong` : 🛑 **Dừng lấy số tự động**.\n" +
        "• `/goiso` : Menu gọi số quầy."
      );
    } 
    // --- LỆNH TỰ ĐỘNG LẤY SỐ XOAY VÒNG 1 PHÚT/LẦN ---
    else if (userText.startsWith('/tudong')) {
      if (autoTicketInterval) {
        await sendMessage(chatId, "⚠️ **Chế độ tự động lấy số ĐANG CHẠY RỒI!**\nGõ `/dungtudong` để dừng lại.");
        return;
      }

      await sendMessage(chatId, "🤖 **ĐÃ BẬT TỰ ĐỘNG LẤY SỐ!**\nCứ **1 phút/lần** bot sẽ lần lượt bấm số cho: *BHYT -> Viện phí -> Khám yêu cầu -> Ưu tiên*.\nGõ `/duntudong` để dừng.");

      currentDeptIndex = 0;
      autoTicketInterval = setInterval(async () => {
        const targetDept = AUTO_DEPTS[currentDeptIndex];
        console.log(`[AUTO] Đang tự động bấm số cho: ${targetDept.name}`);

        const result = await createTicket(targetDept.id);
        if (result && !result.error && result.code) {
          await sendMessage(
            chatId,
            `🤖 **[TỰ ĐỘNG LẤY SỐ] SUCCESS!**\n\n` +
            `🏥 **Đối tượng:** ${targetDept.name}\n` +
            `🔢 **Số thứ tự:** \`${result.code}\`\n` +
            `👥 **Đang chờ:** \`${result.waitingAhead || 0}\` người`
          );
        } else {
          await sendMessage(chatId, `🤖 **[TỰ ĐỘNG LẤY SỐ] FAIL:** Không lấy được số cho *${targetDept.name}* (${result?.message || 'Lỗi connection'})`);
        }

        // Chuyển sang đối tượng tiếp theo cho phút tiếp theo
        currentDeptIndex = (currentDeptIndex + 1) % AUTO_DEPTS.length;
      }, 60000); // 60000 ms = 1 phút
    } 
    // --- LỆNH DỪNG LẤY SỐ TỰ ĐỘNG ---
    else if (userText.startsWith('/dungtudong') || userText.startsWith('/stoptudong')) {
      if (autoTicketInterval) {
        clearInterval(autoTicketInterval);
        autoTicketInterval = null;
        await sendMessage(chatId, "🛑 **ĐÃ DỪNG CHẾ ĐỘ TỰ ĐỘNG LẤY SỐ.**");
      } else {
        await sendMessage(chatId, "ℹ️ Chế độ tự động hiện chưa được bật.");
      }
    }
    else if (userText.startsWith('/thongtin1')) {
      await sendMessage(chatId, await getAllLatestNews());
    } else if (userText.startsWith('/thongtin')) {
      await sendMessage(chatId, "📌 **CHỌN THÔNG TIN CẦN TRA CỨU:**", getInfoMenuKeyboard());
    } else if (userText.startsWith('/layso')) {
      const param = userText.replace('/layso', '').trim();
      if (!param) {
        const keyboard = {
          inline_keyboard: [
            [{ text: "🛡️ Bảo hiểm y tế (dept_bh)", callback_data: "layso_dept_bh" }],
            [{ text: "💵 Viện phí (dept_vp)", callback_data: "layso_dept_vp" }],
            [{ text: "⭐ Khám theo yêu cầu (dept_yc)", callback_data: "layso_dept_yc" }],
            [{ text: "❤️ Ưu tiên (dept_ut)", callback_data: "layso_dept_ut" }]
          ]
        };
        await sendMessage(chatId, "🏥 **CHỌN ĐỐI TƯỢNG ĐỂ BẤM LẤY SỐ:**", keyboard);
      } else {
        const result = await createTicket(param);
        if (result && !result.error && result.code) {
          await sendMessage(chatId, `🎉 **CẤP SỐ THÀNH CÔNG!** Số: \`${result.code}\``);
        } else {
          await sendMessage(chatId, `❌ Lỗi cấp số.`);
        }
      }
    } else if (userText.startsWith('/goiso')) {
      const counterKey = userText.replace('/goiso', '').trim();
      if (!counterKey) {
        const keyboard = {
          inline_keyboard: [
            [{ text: "📢 Gọi quầy Bảo hiểm", callback_data: "goiso_baohiem" }],
            [{ text: "📢 Gọi quầy Viện phí", callback_data: "goiso_vienphi" }],
            [{ text: "📢 Gọi quầy Yêu cầu", callback_data: "goiso_yeucau" }],
            [{ text: "📢 Gọi quầy Ưu tiên", callback_data: "goiso_uutien" }]
          ]
        };
        await sendMessage(chatId, "📢 **CHỌN QUẦY CẦN GỌI SỐ:**", keyboard);
      } else {
        const res = await controlCounter('call-next', counterKey);
        if (res?.data?.ticket) {
          await sendMessage(chatId, `📢 **ĐÃ GỌI SỐ:** \`${res.data.ticket.code}\`!`);
        } else {
          await sendMessage(chatId, "⚠️ Hàng đợi trống hoặc không thể gọi.");
        }
      }
    } else if (userText) {
      const result = await askGroq(userText);
      if (result.text) await sendMessage(chatId, result.text);
    }
  } catch (error) {
    console.error("Lỗi hệ thống:", error.message);
  }
});

app.get('/', (req, res) => res.send('Server Telegram Bot đang chạy!'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server đang chạy port ${PORT}`));
