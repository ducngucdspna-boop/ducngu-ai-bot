const express = require('express');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// ⚠️ ĐỔI LINK NÀY THÀNH LINK CLOUDFLARE TUNNEL ĐANG CHẠY TRÊN MÁY TÍNH CỦA BẠN
const HIS_BASE_URL = 'https://verse-july-cable-inflation.trycloudflare.com';

// ID Quầy mặc định của bạn (lấy từ link display)
const DEFAULT_COUNTER_ID = 'cnt_ca177a18';

// Hàm gửi tin nhắn Telegram
async function sendMessage(chatId, text) {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    });
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
    const errObj = err.response?.data?.error;
    const errorMsg = errObj ? `[${errObj.code \vert{}\vert{} 'Error'}]${errObj.message}` : err.message;
    return { error: errorMsg };
  }
}

// Hàm gửi ảnh từ Pollinations AI
async function sendPhoto(chatId, userPrompt) {
  try {
    const translatePrompt = `Translate this image description into a concise English prompt for image generation. Output ONLY the translated English text, no explanation: "${userPrompt}"`;
    const translationResult = await askGroq(translatePrompt);
    let englishPrompt = translationResult.text || userPrompt;

    const finalPrompt = `${englishPrompt}, photorealistic, highly detailed, 8k resolution`;
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?model=flux&width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;

    await axios.post(`${TELEGRAM_API}/sendPhoto`, {
      chat_id: chatId,
      photo: imageUrl,
      caption: `🎨 Ảnh tạo theo yêu cầu: "${userPrompt}"`
    });
  } catch (err) {
    console.error('Lỗi tạo ảnh:', err.message);
    await sendMessage(chatId, "❌ Không thể tạo ảnh lúc này, vui lòng thử lại sau!");
  }
}

// Hàm gửi video từ Pollinations AI
async function sendVideo(chatId, userPrompt) {
  try {
    const translatePrompt = `Translate this video description into a concise English prompt for video generation. Output ONLY the translated English text, no explanation: "${userPrompt}"`;
    const translationResult = await askGroq(translatePrompt);
    let englishPrompt = translationResult.text || userPrompt;

    const videoUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(englishPrompt)}?model=cogvideox&width=512&height=512&seed=${Math.floor(Math.random() * 1000000)}&video=true`;

    const response = await axios.get(videoUrl, { timeout: 120000, responseType: 'arraybuffer' });
    const contentType = response.headers['content-type'] || '';

    if (!contentType.includes('video') && !contentType.includes('mp4')) {
      await sendMessage(chatId, "⚠️ Server tạo video miễn phí hiện đang quá tải. Vui lòng thử lại sau hoặc chuyển sang dùng lệnh /image!");
      return;
    }

    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('video', Buffer.from(response.data), { filename: 'video.mp4', contentType: 'video/mp4' });
    form.append('caption', `🎬 Video tạo theo yêu cầu: "${userPrompt}"`);

    await axios.post(`${TELEGRAM_API}/sendVideo`, form, {
      headers: form.getHeaders(),
      timeout: 60000
    });

  } catch (err) {
    console.error('Lỗi tạo video:', err.message);
    await sendMessage(chatId, "❌ Máy chủ tạo video miễn phí đang quá tải. Vui lòng thử lại sau!");
  }
}

// --- LOGIC GỌI API LẤY SỐ & THAO TÁC QUẦY ---

// 1. Đọc danh sách khoa
async function getDepartments() {
  try {
    const res = await axios.get(`${HIS_BASE_URL}/api/state`, { timeout: 10000 });
    return res.data?.departments || [];
  } catch (error) {
    console.error("Lỗi GET /api/state:", error.message);
    return null;
  }
}

// 2. Lấy 1 số mới
async function createTicket(departmentId) {
  try {
    const res = await axios.post(`${HIS_BASE_URL}/api/tickets`, { departmentId }, { timeout: 10000 });
    return res.data;
  } catch (error) {
    console.error("Lỗi POST /api/tickets:", error.message);
    return null;
  }
}

// 3. Thao tác điều khiển quầy (Call Next / Recall / Skip / Done)
async function controlCounter(action, counterId = DEFAULT_COUNTER_ID) {
  try {
    const res = await axios.post(`${HIS_BASE_URL}/api/counters/${counterId}/${action}`, {}, { timeout: 10000 });
    return res.data;
  } catch (error) {
    console.error(`Lỗi thao tác quầy (${action}):`, error.message);
    return null;
  }
}

// Route nhận Webhook từ Telegram
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const message = req.body?.message;
  if (!message) return;

  const chatId = message.chat.id;
  const userText = message.text ? message.text.trim() : '';

  try {
    if (userText.startsWith('/start')) {
      await sendMessage(
        chatId, 
        "👋 **HỆ THỐNG ĐIỀU KHIỂN BẤM SỐ & QUẦY KHÁM**\n\n" +
        "📌 **Dành cho Bệnh nhân:**\n" +
        "• `/layso`: Xem danh sách khoa & bấm lấy số\n\n" +
        "📌 **Dành cho Bác sĩ / Quầy khám (`cnt_ca177a18`):**\n" +
        "• `/goiso` hoặc `/next`: Gọi số tiếp theo vào quầy\n" +
        "• `/goilai` hoặc `/recall`: Gọi lại số hiện tại\n" +
        "• `/boqua` hoặc `/skip`: Bỏ qua lượt hiện tại\n" +
        "• `/hoanthanh` hoặc `/done`: Hoàn thành lượt hiện tại\n\n" +
        "🎨 **Công cụ AI:**\n" +
        "• `/image <mô tả>`: Tạo ảnh AI\n" +
        "• `/video <mô tả>`: Tạo video AI"
      );
    } 
    // LẤY SỐ
    else if (userText.startsWith('/layso')) {
      const param = userText.replace('/layso', '').trim();

      if (!param) {
        await sendMessage(chatId, "⏳ Đang lấy danh sách chuyên khoa...");
        const depts = await getDepartments();

        if (!depts) {
          await sendMessage(chatId, "❌ Không thể kết nối tới máy tính phòng khám!");
          return;
        }

        let msg = "🏥 **DANH SÁCH CHUYÊN KHOA KHÁM**\n\n";
        depts.forEach((d, index) => {
          msg += `${index + 1}. **${d.name}**\n` +
                 `   • Cú pháp bấm: \`/layso ${d.id}\`\n` +
                 `   • Đang chờ: \`${d.waitingCount || 0}\` người\n\n`;
        });
        await sendMessage(chatId, msg);
      } else {
        await sendMessage(chatId, "⏳ Đang cấp số...");
        const result = await createTicket(param);
        if (result && result.code) {
          await sendMessage(
            chatId,
            `🎉 **CẤP SỐ THÀNH CÔNG!**\n\n` +
            `🏥 **Khoa:** ${result.departmentName}\n` +
            `🔢 **Số thứ tự:** \`${result.code}\`\n` +
            `👥 **Chờ phía trước:** \`${result.waitingAhead}\` người`
          );
        } else {
          await sendMessage(chatId, "❌ Mã khoa không hợp lệ hoặc máy chủ lỗi.");
        }
      }
    }
    // GỌI SỐ TIẾP THEO
    else if (userText.startsWith('/goiso') || userText.startsWith('/next')) {
      await sendMessage(chatId, "⏳ Đang gọi số tiếp theo...");
      const res = await controlCounter('call-next');
      if (res?.empty) {
        await sendMessage(chatId, "⚠️ **Hàng đợi trống!** Không có bệnh nhân nào đang chờ.");
      } else if (res?.ticket) {
        await sendMessage(chatId, `📢 **ĐÃ GỌI SỐ:** \`${res.ticket.code}\` vào Quầy!`);
      } else {
        await sendMessage(chatId, "❌ Không thể thực hiện lệnh gọi số.");
      }
    }
    // GỌI LẠI SỐ HIỆN TẠI
    else if (userText.startsWith('/goilai') || userText.startsWith('/recall')) {
      await sendMessage(chatId, "⏳ Đang gọi lại số...");
      const res = await controlCounter('recall');
      if (res?.ticket) {
        await sendMessage(chatId, `📢 **ĐÃ GỌI LẠI SỐ:** \`${res.ticket.code}\``);
      } else {
        await sendMessage(chatId, "⚠️ Hiện tại quầy chưa có số nào để gọi lại.");
      }
    }
    // BỎ QUA SỐ HIỆN TẠI
    else if (userText.startsWith('/boqua') || userText.startsWith('/skip')) {
      const res = await controlCounter('skip');
      if (res) {
        await sendMessage(chatId, "⏭️ **Đã bỏ qua** số hiện tại.");
      } else {
        await sendMessage(chatId, "❌ Thao tác bỏ qua thất bại.");
      }
    }
    // HOÀN THÀNH
    else if (userText.startsWith('/hoanthanh') || userText.startsWith('/done')) {
      const res = await controlCounter('done');
      if (res) {
        await sendMessage(chatId, "✅ **Đã hoàn thành** lượt khám.");
      } else {
        await sendMessage(chatId, "❌ Thao tác hoàn thành thất bại.");
      }
    }
    // LỆNH TẠO ÁNH / VIDEO / CHAT AI
    else if (userText.startsWith('/image')) {
      const prompt = userText.replace('/image', '').trim();
      if (!prompt) await sendMessage(chatId, "⚠️ Vui lòng nhập mô tả sau lệnh /image");
      else {
        await sendMessage(chatId, "⏳ Đang tạo ảnh...");
        await sendPhoto(chatId, prompt);
      }
    } else if (userText.startsWith('/video')) {
      const prompt = userText.replace('/video', '').trim();
      if (!prompt) await sendMessage(chatId, "⚠️ Vui lòng nhập mô tả sau lệnh /video");
      else {
        await sendMessage(chatId, "⏳ Đang tạo video...");
        await sendVideo(chatId, prompt);
      }
    } else if (userText) {
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
