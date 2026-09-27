const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
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

// Hàm gọi Gemini AI chuẩn
async function askGemini(promptText) {
  const models = ['gemini-1.5-flash', 'gemini-1.5-pro'];

  for (const model of models) {
    try {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const response = await axios.post(geminiUrl, {
        contents: [{ parts: [{ text: promptText }] }]
      });
      const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (reply) return reply.trim();
    } catch (err) {
      console.error(`Thử model ${model} thất bại:`, err.response?.data?.error?.message || err.message);
    }
  }
  return null;
}

// Hàm gửi ảnh từ Pollinations AI
async function sendPhoto(chatId, userPrompt) {
  try {
    // Dịch prompt tiếng Việt sang tiếng Anh
    const translatePrompt = `Translate this image description into a clear English prompt for image generation. Return ONLY the English translation, no other text: "${userPrompt}"`;
    let englishPrompt = await askGemini(translatePrompt);

    if (!englishPrompt) {
      englishPrompt = userPrompt;
    }

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

// Route nhận Webhook
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const message = req.body?.message;
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const userText = message.text.trim();

  try {
    if (userText.startsWith('/start')) {
      await sendMessage(chatId, "👋 Chào mừng bạn! Hãy nhắn tin bất kỳ để trò chuyện với AI, hoặc dùng lệnh /image <mô tả> để tạo ảnh.");
    } else if (userText.startsWith('/image')) {
      const prompt = userText.replace('/image', '').trim();
      if (!prompt) {
        await sendMessage(chatId, "⚠️ Vui lòng nhập mô tả sau lệnh /image. Ví dụ: /image con chó golden");
      } else {
        await sendMessage(chatId, "⏳ Đang tạo ảnh chất lượng cao, vui lòng đợi giây lát...");
        await sendPhoto(chatId, prompt);
      }
    } else {
      // Trò chuyện văn bản thường
      const reply = await askGemini(userText);
      if (reply) {
        await sendMessage(chatId, reply);
      } else {
        await sendMessage(chatId, "🤖 AI đang bận hoặc Key chưa sẵn sàng, vui lòng thử lại sau!");
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
