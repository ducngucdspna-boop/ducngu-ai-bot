const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// Hàm gửi tin nhắn Telegram
async function sendMessage(chatId, text) {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: text
    });
  } catch (error) {
    console.error('Lỗi gửi tin nhắn Telegram:', error.response?.data || error.message);
  }
}

// Hàm gọi Groq AI với model OpenAI (gpt-oss-20b) đang hoạt động chuẩn nhất
async function askGroq(promptText) {
  if (!GROQ_API_KEY) {
    return { error: "Chưa cấu hình GROQ_API_KEY trên Render!" };
  }

  const cleanKey = GROQ_API_KEY.trim();

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'openai/gpt-oss-20b', // Sử dụng model OpenAI đang chạy chuẩn trên tài khoản của bạn
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
        }
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

// Hàm gửi video từ Pollinations AI (Định dạng video MP4)
async function sendVideo(chatId, userPrompt) {
  try {
    const translatePrompt = `Translate this video description into a concise English prompt for video generation. Output ONLY the translated English text, no explanation: "${userPrompt}"`;
    const translationResult = await askGroq(translatePrompt);
    let englishPrompt = translationResult.text || userPrompt;

    const videoUrl = `https://video.pollinations.ai/prompt/${encodeURIComponent(englishPrompt)}?seed=${Math.floor(Math.random() * 1000000)}`;

    await axios.post(`${TELEGRAM_API}/sendVideo`, {
      chat_id: chatId,
      video: videoUrl,
      caption: `🎬 Video tạo theo yêu cầu: "${userPrompt}"`
    });
  } catch (err) {
    console.error('Lỗi tạo video:', err.message);
    await sendMessage(chatId, "❌ Không thể tạo video lúc này (API video free có thể bận/timeout). Vui lòng thử lại sau ít phút!");
  }
}

// Route nhận Webhook
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const message = req.body?.message;
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const userText = message.text.trim();

  try {
    if (userText.startsWith('/start')) {
      await sendMessage(
        chatId, 
        "👋 Chào mừng bạn!\n\n" +
        "• Nhắn tin bất kỳ để chat với AI.\n" +
        "• Dùng lệnh `/image <mô tả>` để tạo ảnh.\n" +
        "• Dùng lệnh `/video <mô tả>` để tạo video AI ngắn."
      );
    } else if (userText.startsWith('/image')) {
      const prompt = userText.replace('/image', '').trim();
      if (!prompt) {
        await sendMessage(chatId, "⚠️ Vui lòng nhập mô tả sau lệnh /image. Ví dụ: /image con chó golden");
      } else {
        await sendMessage(chatId, "⏳ Đang tạo ảnh chất lượng cao, vui lòng đợi giây lát...");
        await sendPhoto(chatId, prompt);
      }
    } else if (userText.startsWith('/video')) {
      const prompt = userText.replace('/video', '').trim();
      if (!prompt) {
        await sendMessage(chatId, "⚠️ Vui lòng nhập mô tả sau lệnh /video. Ví dụ: /video con mèo đang chạy trên cỏ");
      } else {
        await sendMessage(chatId, "⏳ Đang khởi tạo video AI (tiến trình render mất từ 30s - 1 phút), vui lòng kiên nhẫn đợi nhé...");
        await sendVideo(chatId, prompt);
      }
    } else {
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
