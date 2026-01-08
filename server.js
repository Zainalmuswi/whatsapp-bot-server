const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// تخزين مؤقت في الذاكرة (بدون قاعدة بيانات)
const sessions = new Map();
const clients = new Map();

// الصفحة الرئيسية
app.get('/', (req, res) => {
  res.json({
    message: '🤖 WhatsApp Multi-Session Server',
    status: 'online',
    version: '1.0.0 (No Database)',
    activeSessions: sessions.size,
    endpoints: {
      createSession: 'POST /api/session/create',
      getQR: 'GET /api/session/qr/:userId',
      viewQR: 'GET /qr/:userId',
      checkStatus: 'GET /api/session/status/:userId',
      sendMessages: 'POST /api/messages/send',
      logout: 'POST /api/session/logout'
    }
  });
});

// صفحة عرض QR Code
app.get('/qr/:userId', async (req, res) => {
  const { userId } = req.params;
  const client = clients.get(userId);

  if (!client || !client.qrCode) {
    return res.send(`
      <!DOCTYPE html>
      <html dir="rtl">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>WhatsApp QR Code</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 20px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              text-align: center;
              max-width: 500px;
            }
            .loader {
              border: 5px solid #f3f3f3;
              border-top: 5px solid #25D366;
              border-radius: 50%;
              width: 60px;
              height: 60px;
              animation: spin 1s linear infinite;
              margin: 20px auto;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
            h2 { color: #128C7E; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="loader"></div>
            <h2>جاري تحميل QR Code...</h2>
            <p>الرجاء الانتظار قليلاً</p>
          </div>
          <script>
            setTimeout(() => location.reload(), 3000);
          </script>
        </body>
      </html>
    `);
  }

  res.send(`
    <!DOCTYPE html>
    <html dir="rtl">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>WhatsApp QR Code</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
          }
          .container {
            background: white;
            padding: 30px;
            border-radius: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 450px;
          }
          .qr-image {
            width: 100%;
            max-width: 300px;
            height: auto;
            border: 5px solid #25D366;
            border-radius: 15px;
            margin: 20px 0;
          }
          h1 { color: #128C7E; margin-bottom: 10px; }
          .icon { font-size: 60px; margin: 10px 0; }
          .instructions {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            margin-top: 20px;
            text-align: right;
          }
          .step {
            margin: 10px 0;
            padding: 12px;
            background: white;
            border-radius: 8px;
            border-right: 4px solid #25D366;
          }
          .warning {
            background: #fff3cd;
            color: #856404;
            padding: 15px;
            border-radius: 10px;
            margin-top: 20px;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">📱</div>
          <h1>امسح الكود من هاتفك</h1>
          <img src="${client.qrCode}" alt="QR Code" class="qr-image">
          
          <div class="instructions">
            <h3 style="color: #128C7E;">📋 خطوات المسح:</h3>
            <div class="step">1️⃣ افتح تطبيق واتساب</div>
            <div class="step">2️⃣ الإعدادات ⚙️</div>
            <div class="step">3️⃣ الأجهزة المرتبطة</div>
            <div class="step">4️⃣ ربط جهاز</div>
            <div class="step">5️⃣ امسح الكود ✅</div>
          </div>
          
          <div class="warning">
            ⏰ الكود صالح لدقيقتين فقط
          </div>
        </div>
        <script>
          setTimeout(() => location.reload(), 30000);
        </script>
      </body>
    </html>
  `);
});

// إنشاء جلسة
app.post('/api/session/create', async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId required' });
  }

  try {
    // حفظ الجلسة في الذاكرة
    if (!sessions.has(userId)) {
      sessions.set(userId, {
        userId,
        isActive: false,
        createdAt: new Date(),
        messagesSentToday: 0
      });
    }

    if (!clients.has(userId)) {
      const client = new Client({
        authStrategy: new LocalAuth({ clientId: userId }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
          ]
        }
      });

      client.on('qr', async (qr) => {
        const qrImage = await qrcode.toDataURL(qr);
        client.qrCode = qrImage;
        console.log('QR Code ready for:', userId);
      });

      client.on('ready', async () => {
        console.log('Client ready:', userId);
        const session = sessions.get(userId);
        session.isActive = true;
        sessions.set(userId, session);
      });

      client.on('authenticated', () => {
        console.log('Authenticated:', userId);
      });

      client.on('disconnected', async () => {
        console.log('Disconnected:', userId);
        const session = sessions.get(userId);
        if (session) {
          session.isActive = false;
          sessions.set(userId, session);
        }
        clients.delete(userId);
      });

      clients.set(userId, client);
      await client.initialize();

      await new Promise(resolve => setTimeout(resolve, 5000));

      return res.json({
        message: 'Session created',
        needsQR: true,
        sessionId: userId,
        qrUrl: `/qr/${userId}`
      });
    }

    const client = clients.get(userId);
    if (client.qrCode) {
      return res.json({
        message: 'Session exists',
        needsQR: true,
        sessionId: userId,
        qrUrl: `/qr/${userId}`
      });
    }

    const session = sessions.get(userId);
    return res.json({
      message: 'Session active',
      needsQR: false,
      isActive: session.isActive
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// الحصول على QR Code
app.get('/api/session/qr/:userId', (req, res) => {
  const { userId } = req.params;
  const client = clients.get(userId);

  if (!client || !client.qrCode) {
    return res.status(404).json({ error: 'QR Code not available' });
  }

  res.json({ qrCode: client.qrCode });
});

// حالة الجلسة
app.get('/api/session/status/:userId', async (req, res) => {
  const { userId } = req.params;
  const session = sessions.get(userId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const client = clients.get(userId);
  let isReady = false;
  
  if (client) {
    try {
      const state = await client.getState();
      isReady = state === 'CONNECTED';
    } catch (e) {
      isReady = false;
    }
  }

  res.json({
    userId,
    isActive: session.isActive && isReady,
    messagesSentToday: session.messagesSentToday
  });
});

// إرسال رسائل
app.post('/api/messages/send', async (req, res) => {
  const { userId, messages } = req.body;

  if (!userId || !messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid data' });
  }

  const client = clients.get(userId);
  
  if (!client) {
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    const state = await client.getState();
    if (state !== 'CONNECTED') {
      return res.status(400).json({ error: 'WhatsApp not connected' });
    }

    const session = sessions.get(userId);
    const DAILY_LIMIT = 30;
    const remaining = DAILY_LIMIT - session.messagesSentToday;

    if (messages.length > remaining) {
      return res.status(429).json({
        error: 'Daily limit exceeded',
        sentToday: session.messagesSentToday,
        limit: DAILY_LIMIT,
        remaining: remaining
      });
    }

    const results = [];

    for (const msg of messages) {
      try {
        let phoneNumber = msg.phone.replace(/[^0-9]/g, '');
        
        if (!phoneNumber.startsWith('964')) {
          if (phoneNumber.startsWith('0')) {
            phoneNumber = '964' + phoneNumber.substring(1);
          } else {
            phoneNumber = '964' + phoneNumber;
          }
        }
        
        const chatId = phoneNumber + '@c.us';
        
        await client.sendMessage(chatId, msg.message);
        
        results.push({
          phone: msg.phone,
          status: 'success',
          message: 'Sent'
        });

        const delay = Math.floor(Math.random() * 5000) + 3000;
        await new Promise(resolve => setTimeout(resolve, delay));

      } catch (error) {
        results.push({
          phone: msg.phone,
          status: 'failed',
          error: error.message
        });
      }
    }

    session.messagesSentToday += messages.filter(r => 
      results.find(res => res.phone === r.phone && res.status === 'success')
    ).length;
    sessions.set(userId, session);

    res.json({
      message: 'Messages processed',
      results,
      sentToday: session.messagesSentToday,
      remaining: DAILY_LIMIT - session.messagesSentToday
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to send messages' });
  }
});

// تسجيل الخروج
app.post('/api/session/logout', async (req, res) => {
  const { userId } = req.body;
  
  const client = clients.get(userId);
  if (client) {
    try {
      await client.logout();
      await client.destroy();
    } catch (e) {
      console.log('Logout error:', e);
    }
    clients.delete(userId);
  }

  sessions.delete(userId);
  
  res.json({ message: 'Logged out successfully' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Server is running on port', PORT);
  console.log('No database - using memory storage');
});
