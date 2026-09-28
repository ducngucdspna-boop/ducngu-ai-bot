const express = require('express');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// ⚠️ ĐỔI LINK NÀY THÀNH LINK CLOUDFLARE TUNNEL ĐANG CHẠY TRÊN MÁY TÍNH CỦA BẠN
const HIS_BASE_URL = 'https://conservation-unknown-got-manga.trycloudflare.com';

// Danh sách mã quầy tương ứng với từng hình thức khám
const COUNTER_MAP = {
  'vienphi': 'cnt_9a545709',
  'yeucau': 'cnt_e6cce8f3',
  'uutien': 'cnt_0c9973ab',
  'baohiem': 'cnt_ca177a18',
  'default': 'cnt_ca177a18'
};

// Hàm gửi tin nhắn Telegram thông thường
async function sendMessage(chatId, text, replyMarkup = null) {
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

// --- LOGIC API LẤY SỐ & THAO TÁC QUẦY ---

// Lấy 1 số mới
async function createTicket(departmentId) {
  try {
    const res = await axios.post(`${HIS_BASE_URL}/api/tickets`, { departmentId }, { timeout: 10000 });
    return res.data;
  } catch (error) {
    console.error("Lỗi POST /api/tickets:", error.message);
    return null;
  }
}

// Thao tác điều khiển quầy
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

// --- XỬ LÝ LỆNH BẤM NÚT (CALLBACK QUERY) THAY VÌ GÕ TAY ---
async function handleCallbackQuery(callbackQuery) {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data; // Ví dụ: 'layso_dept_bh' hoặc 'goiso_vienphi'

  // Phản hồi cho Telegram biết đã nhận được lệnh bấm nút
  try {
    await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, { callback_query_id: callbackQuery.id });
  } catch (e) {}

  // LẤY SỐ
  if (data.startsWith('layso_')) {
    const deptId = data.replace('layso_', '');
    await sendMessage(chatId, "⏳ Đang cấp số thứ tự...");
    const result = await createTicket(deptId);
    if (result && result.code) {
      await sendMessage(
        chatId,
        `🎉 **CẤP SỐ THÀNH CÔNG!**\n\n` +
        `🏥 **Chuyên khoa/Đối tượng:** ${result.departmentName || deptId}\n` +
        `🔢 **Số thứ tự:** \`${result.code}\`\n` +
        `👥 **Đang chờ phía trước:** \`${result.waitingAhead || 0}\` người`
      );
    } else {
      await sendMessage(chatId, "❌ Không thể lấy số. Mã khoa không đúng hoặc máy chủ phòng khám chưa bật.");
    }
  } 
  // GỌI SỐ
  else if (data.startsWith('goiso_')) {
    const counterKey = data.replace('goiso_', '');
    await sendMessage(chatId, `⏳ Đang gọi số cho quầy [${counterKey}]...`);
    const res = await controlCounter('call-next', counterKey);
    if (res?.data?.empty) {
      await sendMessage(chatId, `⚠️ **Hàng đợi trống!** Không có bệnh nhân nào đang chờ tại quầy này.`);
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

  // Xử lý sự kiện bấm Nút (Inline Keyboard)
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
    } 
    // 1. LỆNH /LAYSO: HIỆN DANH SÁCH NÚT BẤM CÁC KHOA / ĐỐI TƯỢNG
    else if (userText.startsWith('/layso')) {
      const param = userText.replace('/layso', '').trim();

      if (!param) {
        // Tạo nút bấm chọn nhanh đối tượng
        const keyboard = {
          inline_keyboard: [
            [{ text: "🛡️ Bảo hiểm y tế (dept_bh)", callback_data: "layso_dept_bh" }],
            [{ text: "💵 Viện phí (dept_vp)", callback_data: "layso_dept_vp" }],
            [{ text: "⭐ Khám theo yêu cầu (dept_yc)", callback_data: "layso_dept_yc" }],
            [{ text: "❤️ Ưu tiên (dept_ut)", callback_data: "layso_dept_ut" }]
          ]
        };

        await sendMessage(
          chatId,
          "🏥 **BẤM NÚT DƯỚI ĐÂY HOẶC GÕ CÚ PHÁP ĐỂ LẤY SỐ:**\n\n" +
          "• `/layso dept_bh` : Lấy số Bảo hiểm y tế\n" +
          "• `/layso dept_vp` : Lấy số Viện phí\n" +
          "• `/layso dept_yc` : Lấy số Yêu cầu\n" +
          "• `/layso dept_ut` : Lấy số Ưu tiên",
          keyboard
        );
      } else {
        await sendMessage(chatId, "⏳ Đang cấp số...");
        const result = await createTicket(param);
        if (result && result.code) {
          await sendMessage(
            chatId,
            `🎉 **CẤP SỐ THÀNH CÔNG!**\n\n` +
            `🏥 **Đối tượng:** ${result.departmentName || param}\n` +
            `🔢 **Số thứ tự:** \`${result.code}\`\n` +
            `👥 **Chờ phía trước:** \`${result.waitingAhead || 0}\` người`
          );
        } else {
          await sendMessage(chatId, "❌ Lỗi cấp số, vui lòng kiểm tra mã khoa/đối tượng.");
        }
      }
    }
    // 2. LỆNH /GOISO: HIỆN DANH SÁCH NÚT BẤM CHO CÁC QUẦY
    else if (userText.startsWith('/goiso') || userText.startsWith('/next')) {
      const counterKey = userText.replace(/\/goiso|\/next/, '').trim();

      if (!counterKey) {
        // Tạo nút bấm chọn nhanh quầy gọi số
        const keyboard = {
          inline_keyboard: [
            [{ text: "📢 Gọi quầy Bảo hiểm", callback_data: "goiso_baohiem" }],
            [{ text: "📢 Gọi quầy Viện phí", callback_data: "goiso_vienphi" }],
            [{ text: "📢 Gọi quầy Yêu cầu", callback_data: "goiso_yeucau" }],
            [{ text: "📢 Gọi quầy Ưu tiên", callback_data: "goiso_uutien" }]
          ]
        };

        await sendMessage(
          chatId,
          "📢 **CHỌN QUẦY CẦN GỌI SỐ (BẤM NÚT DƯỚI HOẶC GÕ CÚ PHÁP):**\n\n" +
          "• `/goiso baohiem` : Gọi quầy Bảo hiểm\n" +
          "• `/goiso vienphi` : Gọi quầy Viện phí\n" +
          "• `/goiso yeucau` : Gọi số quầy Yêu cầu\n" +
          "• `/goiso uutien` : Gọi số quầy Ưu tiên",
          keyboard
        );
      } else {
        await sendMessage(chatId, `⏳ Đang gọi số cho quầy [${counterKey}]...`);
        const res = await controlCounter('call-next', counterKey);
        if (res?.data?.empty) {
          await sendMessage(chatId, `⚠️ **Hàng đợi trống!** Không có bệnh nhân nào đang chờ.`);
        } else if (res?.data?.ticket) {
          await sendMessage(chatId, `📢 **ĐÃ GỌI SỐ:** \`${res.data.ticket.code}\` lên màn hình quầy \`${res.counterId}\`!`);
        } else {
          await sendMessage(chatId, "❌ Không thể thực hiện lệnh gọi số.");
        }
      }
    }
    // LỆNH GÕ CHAT AI KHÁC
    else if (userText) {
      const result = await askGroq(userText);
      if (result.text) await sendMessage(chatId, result.text);
      else await sendMessage(chatId, `❌ Lỗi Groq API: ${result.error}`);
    }
  } catch (error) {
    console.error("Lỗi hệ thống:", error.message);
    await sendMessage(chatId, `❌ Lỗi hệ thống: ${error.message}`);
  }
});

app.get('/', (req, res) => res.send('Server Telegram Bot đang chạy!'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server đang chạy port ${PORT}`));
