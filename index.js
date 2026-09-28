const express = require('express');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// ⚠️ ĐỔI LINK NÀY THÀNH LINK CLOUDFLARE TUNNEL DANG CHẠY TRÊN MÁY TÍNH CỦA BẠN
const HIS_BASE_URL = 'https://verse-july-cable-inflation.trycloudflare.com';

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
    const errorMsg = errObj ? `[${errObj.code || 'Error'}] ${errObj.message}` : err.message;
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

// Hàm gửi video ngắn từ Pollinations AI (Kiểm tra định dạng MP4)
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
    await sendMessage(chatId, "❌ Máy chủ tạo video miễn phí đang quá tải hoặc hết băng thông. Vui lòng thử lại sau!");
  }
}

// --- LOGIC GỌI API LẤY SỐ BỆNH NHÂN ---

// 1. Đọc danh sách khoa khám từ API
async function getDepartments() {
  try {
    const res = await axios.get(`${HIS_BASE_URL}/api/state`, { timeout: 10000 });
    return res.data?.departments || [];
  } catch (error) {
    console.error("Lỗi kết nối GET /api/state:", error.message);
    return null;
  }
}

// 2. Tạo số thứ tự mới qua API
async function createTicket(departmentId) {
  try {
    const res = await axios.post(`${HIS_BASE_URL}/api/tickets`, {
      departmentId: departmentId
    }, { timeout: 10000 });
    return res.data;
  } catch (error) {
    console.error("Lỗi kết nối POST /api/tickets:", error.message);
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
        "👋 **HỆ THỐNG TRỢ LÝ AI & LẤY SỐ KHÁM BỆNH**\n\n" +
        "• Xem danh sách khoa & Lấy số: Dùng lệnh `/layso`\n" +
        "• Bấm lấy số trực tiếp: `/layso <Mã_Khoa>`\n" +
        "• Dùng `/image <mô tả>` để tạo ảnh AI.\n" +
        "• Dùng `/video <mô tả>` để tạo video AI.\n" +
        "• Nhắn tin bất kỳ để trò chuyện với AI."
      );
    } 
    // Xử lý lệnh lấy số khám bệnh
    else if (userText.startsWith('/layso')) {
      const param = userText.replace('/layso', '').trim();

      // Trường hợp 1: Người dùng chỉ nhập /layso -> Hiển thị danh sách các hình thức/khoa khám
      if (!param) {
        await sendMessage(chatId, "⏳ Đang kết nối tới máy chủ phòng khám...");
        const depts = await getDepartments();

        if (!depts) {
          await sendMessage(chatId, "❌ **Không thể kết nối tới máy tính phòng khám!**\n⚠️ Vui lòng kiểm tra lại phần mềm trên máy tính hoặc cửa sổ `cloudflared`.");
          return;
        }

        if (depts.length === 0) {
          await sendMessage(chatId, "⚠️ Hệ thống phòng khám chưa có danh sách hình thức khám nào.");
          return;
        }

        let msg = "🏥 **DANH SÁCH CHUYÊN KHOA KHÁM**\n\n";
        depts.forEach((d, index) => {
          msg += `${index + 1}. **${d.name}**\n` +
                 `   • Lệnh bấm số: \`/layso ${d.id}\`\n` +
                 `   • Đang chờ: \`${d.waitingCount || 0}\` người\n\n`;
        });
        msg += "👉 *Bạn hãy nhập hoặc chọn lệnh `/layso <Mã_Khoa>` tương ứng ở trên để nhận số thứ tự.*";

        await sendMessage(chatId, msg);
      } 
      // Trường hợp 2: Người dùng nhập /layso <departmentId> -> Bấm số trực tiếp
      else {
        await sendMessage(chatId, "⏳ Đang tiến hành cấp số thứ tự...");
        const result = await createTicket(param);

        if (result && result.code) {
          await sendMessage(
            chatId,
            `🎉 **CẤP SỐ THÀNH CÔNG!**\n\n` +
            `🏥 **Cơ sở:** ${result.clinicName || 'Phòng khám'}\n` +
            `🏥 **Chuyên khoa:** ${result.departmentName}\n` +
            `🔢 **Số thứ tự:** \`${result.code}\`\n` +
            `👥 **Số người chờ phía trước:** \`${result.waitingAhead}\` người\n\n` +
            `*Vui lòng chú ý theo dõi bảng hiển thị khi đến lượt khám!*`
          );
        } else {
          await sendMessage(chatId, "❌ **Cấp số thất bại!** Mã chuyên khoa không hợp lệ hoặc máy chủ phòng khám bị gián đoạn.");
        }
      }
    } 
    else if (userText.startsWith('/image')) {
      const prompt = userText.replace('/image', '').trim();
      if (!prompt) {
        await sendMessage(chatId, "⚠️ Vui lòng nhập mô tả sau lệnh /image.");
      } else {
        await sendMessage(chatId, "⏳ Đang tạo ảnh chất lượng cao, vui lòng đợi giây lát...");
        await sendPhoto(chatId, prompt);
      }
    } 
    else if (userText.startsWith('/video')) {
      const prompt = userText.replace('/video', '').trim();
      if (!prompt) {
        await sendMessage(chatId, "⚠️ Vui lòng nhập mô tả sau lệnh /video.");
      } else {
        await sendMessage(chatId, "⏳ Đang gửi yêu cầu tạo video AI, tiến trình có thể mất 1-2 phút...");
        await sendVideo(chatId, prompt);
      }
    } 
    else if (userText) {
      // Trò chuyện bằng Groq AI
      const result = await askGroq(userText);
      if (result.text) {
        await sendMessage(chatId, result.text);
      } else {
        await sendMessage(chatId, `❌ Lỗi Groq API: ${result.error}`);
      }
    }
  } catch (error) {
    console.error("Lỗi hệ thống:", error.message);
    await sendMessage(chatId, `❌ Lỗi hệ thống: ${error.message}`);
  }
});

app.get('/', (req, res) => {
  res.send('Server Telegram Bot đang chạy!');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server đang lắng nghe tại port ${PORT}`);
});
