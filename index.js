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
const HIS_BASE_URL = 'https://conservation-unknown-got-manga.trycloudflare.com';

// ID Chat Telegram của Bạn để nhận tin nhắn nhắc nhở
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

// API LẤY SỐ MỚI
async function createTicket(departmentId) {
  try {
    const res = await axios.post(`${HIS_BASE_URL}/api/tickets`, { departmentId }, { timeout: 10000 });
    return res.data;
  } catch (error) {
    console.error("Lỗi POST /api/tickets:", error.message);
    return null;
  }
}

// API ĐIỀU KHIỂN QUẦY
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

// --- TỰ ĐỘNG LẬP LỊCH NHẮC NHỞ (CRON JOB) ---
// Chạy đúng 07:00 sáng mỗi ngày ('0 7 * * *') theo múi giờ Việt Nam
cron.schedule('0 7 * * *', async () => {
  if (!ADMIN_CHAT_ID) {
    console.log("Chưa cài đặt ADMIN_CHAT_ID để gửi tin nhắn nhắc nhở.");
    return;
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: "🛡️ Bảo hiểm y tế (dept_bh)", callback_data: "layso_dept_bh" }],
      [{ text: "💵 Viện phí (dept_vp)", callback_data: "layso_dept_vp" }],
      [{ text: "⭐ Khám theo yêu cầu (dept_yc)", callback_data: "layso_dept_yc" }],
      [{ text: "❤️ Ưu tiên (dept_ut)", callback_data: "layso_dept_ut" }]
    ]
  };

  // Gửi tin nhắn nhắc nhở tới Telegram
  await sendMessage(
    ADMIN_CHAT_ID,
    "⏰ **BÁO THỨC ĐẦU NGÀY KHÁM BỆNH!**\n\n" +
    "Đã đến giờ mở sổ bấm số ngày mới. Vui lòng chọn đối tượng bên dưới để bắt đầu bấm số mở hàng:",
    keyboard
  );
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
        "👋 **HỆ THỐNG QUẢN LÝ BẤM SỐ KHÁM BỆNH**\n\n" +
        "• Gõ `/layso` để mở danh sách chọn đối tượng lấy số.\n" +
        "• Gõ `/goiso` để mở menu gọi số theo từng quầy màn hình."
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
