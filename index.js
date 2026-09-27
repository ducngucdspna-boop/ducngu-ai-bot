const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// Hàm gửi tin nhắn văn bản
async function sendMessage(chatId, text) {
  try {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    });
  } catch (error) {
    // Nếu lỗi định dạng Markdown thì gửi văn bản thuần
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: text
    });
  }
}

// Hàm tạo và gửi ảnh từ Pollinations AI
async function sendPhoto(chatId, prompt) {
  const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;
  try {
    await axios.post(`${TELEGRAM_API}/sendPhoto`, {
      chat_id: chatId,
      photo: imageUrl,
      caption: `🎨 *Ảnh tạo theo yêu cầu:* "${prompt}"`,
      parse_mode: 'Markdown'
    });
  } catch (err) {
    await sendMessage(chatId, "❌ Không thể tải ảnh. Vui lòng thử lại với mô tả khác!");
  }
}

// Route xử lý Webhook từ Telegram
app.post('/webhook', async (req, res) => {
  const message = req.body.message;

  // Nếu không có tin nhắn hoặc văn bản thì bỏ qua
  if (!message || !message.text) {
    return res.sendStatus(200);
  }

  const chatId = message.chat.id;
  const userText = message.text.trim();

  try {
    // Lệnh /start
    if (userText.startsWith('/start')) {
      const welcomeText = `👋 *Chào mừng bạn đến với AI Assistant!*\n\n` +
        `🤖 *Các tính năng bạn có thể dùng:*\n` +
        `1. *Trò chuyện / Hỏi đáp:* Nhắn nội dung bất kỳ.\n` +
        `2. *Tạo ảnh bằng AI:* Nhập lệnh \`/image <mô tả ảnh bằng tiếng Anh hoặc Việt>\`\n\n` +
        `*Ví dụ:* \`/image a futuristic cybernetic city at night, 8k resolution\``;
      await sendMessage(chatId, welcomeText);
    } 
    // Lệnh /image để tạo ảnh
    else if (userText.startsWith('/image')) {
      const prompt = userText.replace('/image', '').trim();
      if (!prompt) {
        await sendMessage(chatId, "⚠️ Vui lòng nhập mô tả sau lệnh `/image`. Ví dụ: `/image con mèo đeo kính râm`");
      } else {
        await sendMessage(chatId, "⏳ *Đang tạo hình ảnh của bạn, vui lòng đợi vài giây...*");
        await sendPhoto(chatId, prompt);
      }
    } 
    // Trò chuyện bằng Google Gemini AI
    else {
      // Gửi thông báo đang xử lý
      await axios.post(`${TELEGRAM_API}/sendChatAction`, {
        chat_id: chatId,
        action: 'typing'
      });

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
      const response = await axios.post(geminiUrl, {
        contents: [{ parts: [{ text: userText }] }]
      });

      const aiReply = response.data.candidates[0].content.parts[0].text;
      await sendMessage(chatId, aiReply);
    }
  } catch (error) {
    console.error("Lỗi xử lý:", error.response?.data || error.message);
    await sendMessage(chatId, "❌ Có lỗi xảy ra khi xử lý yêu cầu của bạn. Vui lòng thử lại!");
  }

  res.sendStatus(200);
});

// Kiểm tra trạng thái Server
app.get('/', (req, res) => {
  res.send('Bot Server đang chạy hoàn hảo!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server đang lắng nghe tại port ${PORT}`);
});
