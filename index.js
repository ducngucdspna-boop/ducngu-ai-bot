const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const cron = require('node-cron');

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// ⚠️ CẬP NHẬT LINK CLOUDFLARE TUNNEL ĐANG CHẠY TRÊN MÁY BẠN
const HIS_BASE_URL = ' https://rides-coast-favourite-handbook.trycloudflare.com';

// ID Chat Telegram của Bạn để nhận bản tin & nhắc nhở
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '';

// Danh sách mã quầy tương ứng với từng hình thức khám
const COUNTER_MAP = {
  'vienphi': 'cnt_9a545709',
  'yeucau': 'cnt_e6cce8f3',
  'uutien': 'cnt_0c9973ab',
  'baohiem': 'cnt_ca177a18',
  'default': 'cnt_ca177a18'
};

// Hàm gửi tin nhắn Telegram
async function sendMessage(chatId, text, replyMarkup = null) {
  if (!chatId) return;
  try {
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    };
    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }
    await axios.post(`${TELEGRAM_API}/sendMessage`, payload);
  } catch (error) {
    console.error('Lỗi gửi tin nhắn Telegram:', error.response?.data || error.message);
  }
}

// Hàm gọi Groq AI
async function askGroq(promptText) {
  if (!GROQ_API_KEY) {
    return { error: "Chưa cấu hình GROQ_API_KEY trên Render!" };
  }

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
        headers: {
          'Authorization': `Bearer ${cleanKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    const content = response.data?.choices?.[0]?.message?.content?.trim();
    if (content) return { text: content };
    return { error: "Groq không trả về nội dung." };
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    return { error: errorMsg };
  }
}

// --- HÀM LẤY THÔNG TIN THỜI TIẾT, BITCOIN, GIÁ VÀNG ---

// 1. Lấy thời tiết TP. Vinh (Dùng Open-Meteo API miễn phí)
async function getWeatherVinh() {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=18.6734&longitude=105.6923&current_weather=true&timezone=Asia%2FHo_Chi_Minh';
    const res = await axios.get(url, { timeout: 10000 });
    const weather = res.data?.current_weather;
    if (weather) {
      return `🌤️ **Nhiệt độ:** ${weather.temperature}°C \vert{} **Tốc độ gió:** ${weather.windspeed} km/h`;
    }
    return "⚠️ Không thể lấy thông tin thời tiết.";
  } catch (e) {
    return "⚠️ Lỗi kết nối thời tiết.";
  }
}

// 2. Lấy giá Bitcoin (Dùng CoinGecko API miễn phí)
async function getBitcoinPrice() {
  try {
    const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,vnd';
    const res = await axios.get(url, { timeout: 10000 });
    const btc = res.data?.bitcoin;
    if (btc) {
      const usd = btc.usd.toLocaleString('en-US');
      const vnd = btc.vnd.toLocaleString('vi-VN');
      return `🪙 **BTC/USD:** $${usd}\n🇻🇳 **BTC/VND:** ${vnd} VNĐ`;
    }
    return "⚠️ Không thể lấy giá Bitcoin.";
  } catch (e) {
    return "⚠️ Lỗi kết nối giá Bitcoin.";
  }
}

// 3. Lấy thông tin giá Vàng từ AI / API công khai
async function getGoldPrice() {
  try {
    const prompt = "Hãy tổng hợp ngắn gọn giá vàng SJC (Mua vào - Bán ra) mới nhất hôm nay tại Việt Nam. Chỉ đưa ra con số ước tính ngắn gọn trong 2 dòng, không giải thích dài dòng.";
    const result = await askGroq(prompt);
    return result.text || "⚠️ Chưa cập nhật được giá vàng.";
  } catch (e) {
    return "⚠️ Lỗi cập nhật giá vàng.";
  }
}

// --- API LẤY SỐ MỚI & ĐIỀU KHIỂN QUẦY ---
async function createTicket(departmentId) {
  try {
    const res = await axios.post(`${HIS_BASE_URL}/api/tickets`, { departmentId }, { timeout: 10000 });
    return res.data;
  } catch (error) {
    console.error("Lỗi POST /api/tickets:", error.message);
    return null;
  }
}

async function controlCounter(action, counterKey) {
  const counterId = COUNTER_MAP[counterKey?.toLowerCase()] || counterKey || COUNTER_MAP['default'];
  try {
    const res = await axios.post(`${HIS_BASE_URL}/api/counters/${counterId}/${action}`, {}, { timeout: 10000 });
    return { data: res.data, counterId };
  } catch (error) {
    console.error(`Lỗi thao tác quầy (${action}):`, error.message);
    return null;
  }
}

// --- TỰ ĐỘNG LẬP LỊCH BẢN TIN SÁNG LÚC 07:00 ---
cron.schedule('0 7 * * *', async () => {
  if (!ADMIN_CHAT_ID) {
    console.log("Chưa cài đặt ADMIN_CHAT_ID để gửi bản tin.");
    return;
  }

  // 1. Lấy thông tin tổng hợp
  const weatherText = await getWeatherVinh();
  const btcText = await getBitcoinPrice();
  const goldText = await getGoldPrice();

  // 2. Tạo giao diện nút bấm lấy số đầu ngày
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
    "📍 **Thời tiết TP. Vinh - Nghệ An:**\n" + `${weatherText}\n\n` +
    "📈 **Giá Bitcoin hôm nay:**\n" + `${btcText}\n\n` +
    "🏆 **Giá Vàng tham khảo:**\n" + `${goldText}\n\n` +
    "───────────────────\n" +
    "⏰ **NHẮC NHỞ LẤY SỐ KHÁM BỆNH:**\n" +
    "Đã đến giờ mở sổ bấm số ngày mới. Bấm chọn đối tượng bên dưới để cấp số mở hàng:";

  // Gửi bản tin qua Telegram
  await sendMessage(ADMIN_CHAT_ID, morningMessage, keyboard);
}, {
  timezone: "Asia/Ho_Chi_Minh"
});

// --- XỬ LÝ SỰ KIỆN BẤM NÚT TELEGRAM ---
async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  try {
    await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, { callback_query_id: callbackQuery.id });
  } catch (e) {}

  if (data.startsWith('layso_')) {
    const deptId = data.replace('layso_', '');
    await sendMessage(chatId, "⏳ Đang cấp số thứ tự...");
    const result = await createTicket(deptId);
    if (result && result.code) {
      await sendMessage(
        chatId,
        `🎉 **CẤP SỐ THÀNH CÔNG!**\n\n` +
        `🏥 **Đối tượng:** ${result.departmentName || deptId}\n` +
        `🔢 **Số thứ tự:** \`${result.code}\`\n` +
        `👥 **Đang chờ phía trước:** \`${result.waitingAhead || 0}\` người`
      );
    } else {
      await sendMessage(chatId, "❌ Không thể lấy số. Kiểm tra lại kết nối máy chủ.");
    }
  } else if (data.startsWith('goiso_')) {
    const counterKey = data.replace('goiso_', '');
    await sendMessage(chatId, `⏳ Đang gọi số cho quầy [${counterKey}]...`);
    const res = await controlCounter('call-next', counterKey);
    if (res?.data?.empty) {
      await sendMessage(chatId, `⚠️ **Hàng đợi trống!** Không có bệnh nhân nào đang chờ.`);
    } else if (res?.data?.ticket) {
      await sendMessage(chatId, `📢 **ĐÃ GỌI SỐ:** \`${res.data.ticket.code}\` lên màn hình quầy \`${res.counterId}\`!`);
    } else {
      await sendMessage(chatId, "❌ Thao tác gọi số thất bại.");
    }
  }
}

// Route nhận Webhook từ Telegram
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
        `👋 Chào bạn! Chat ID của bạn là: \`${chatId}\`\n\n` +
        "• Dùng lệnh `/layso` để mở danh sách bấm số.\n" +
        "• Dùng lệnh `/goiso` để mở danh sách gọi số."
      );
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
        if (result && result.code) {
          await sendMessage(chatId, `🎉 **CẤP SỐ THÀNH CÔNG!** Số: \`${result.code}\``);
        } else {
          await sendMessage(chatId, "❌ Lỗi cấp số.");
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
