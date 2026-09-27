const express = require('express');
const axios = require('axios');
const FormData = require('form-data');

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

// Hàm gửi video ngắn từ Pollinations AI (Kiểm tra định dạng MP4 để tránh gửi nhầm ảnh)
async function sendVideo(chatId, userPrompt) {
  try {
    const translatePrompt = `Translate this video description into a concise English prompt for video generation. Output ONLY the translated English text, no explanation: "${userPrompt}"`;
    const translationResult = await askGroq(translatePrompt);
    let englishPrompt = translationResult.text || userPrompt;

    // Endpoint render video của Pollinations
    const videoUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(englishPrompt)}?model=cogvideox&width=512&height=512&seed=${Math.floor(Math.random() * 1000000)}&video=true`;

    // Tải dữ liệu về để kiểm tra định dạng trước khi gửi
    const response = await axios.get(videoUrl, { timeout: 120000, responseType: 'arraybuffer' });
    const contentType = response.headers['content-type'] || '';

    // Nếu server trả về ảnh JPG/PNG thay vì MP4 thì báo lỗi không gửi
    if (!contentType.includes('video') && !contentType.includes('mp4')) {
      await sendMessage(chatId, "⚠️ Server tạo video miễn phí hiện đang bị quá tải nên không thể render dạng MP4. Bạn vui lòng thử lại sau hoặc chuyển sang dùng lệnh /image nhé!");
      return;
    }

    // Gửi đúng file video MP4 sang Telegram
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
    await sendMessage(chatId, "❌ Máy chủ tạo video miễn phí đang quá tải hoặc hết băng thông. Bạn vui lòng thử lại sau ít phút nhé!");
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
        await sendMessage(chatId, "⏳ Đang gửi yêu cầu tạo video AI, tiến trình có thể mất từ 1 - 2 phút tùy độ bận của máy chủ...");
        await sendVideo(chatId, prompt);
      }
    } else if (userText) {
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
