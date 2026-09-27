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

// Hàm gửi ảnh từ Pollinations AI
async function sendPhoto(chatId, prompt) {
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;
  try {
    await axios.post(`${TELEGRAM_API}/sendPhoto`, {
      chat_id: chatId,
      photo: imageUrl,
      caption: `🎨 Ảnh tạo theo yêu cầu: "${prompt}"`
    });
  } catch (err) {
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
        await sendMessage(chatId, "⚠️ Vui lòng nhập mô tả sau lệnh /image. Ví dụ: /image con mèo đeo kính");
      } else {
        await sendMessage(chatId, "⏳ Đang tạo ảnh, vui lòng đợi...");
        await sendPhoto(chatId, prompt);
      }
    } else {
      // Gọi trực tiếp REST API của Gemini
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      
      const response = await axios.post(geminiUrl, {
        contents: [{ parts: [{ text: userText }] }]
      });

      const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (reply) {
        await sendMessage(chatId, reply);
      } else {
        await sendMessage(chatId, "🤖 AI không đưa ra phản hồi, thử lại nhé!");
      }
    }
  } catch (error) {
    console.error("Lỗi Gemini AI:", error.response?.data || error.message);
    const errObj = error.response?.data?.error;
    const msg = errObj ? `[${errObj.code}] ${errObj.message}` : error.message;
    await sendMessage(chatId, `❌ Lỗi Gemini: ${msg}`);
  }
});

app.get('/', (req, res) => {
  res.send('Server Telegram Bot đang chạy!');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server đang lắng nghe tại port ${PORT}`);
});
