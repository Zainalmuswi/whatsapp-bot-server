const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// الاتصال بقاعدة البيانات
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/whatsapp_sessions';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ متصل بقاعدة البيانات'))
  .catch(err => console.error('❌ خطأ في الاتصال بقاعدة البيانات:', err));

// نموذج الجلسة
const SessionSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  phoneNumber: String,
  isActive: { type: Boolean, default: false },
  lastActivity: Date,
  messagesSentToday: { type: Number, default: 0 },
  lastResetDate: { type: String, default: () => new Date().toDateString() },
  createdAt: { type: Date, default: Date.now }
});

const Session = mongoose.model('Session', SessionSchema);

// تخزين عملاء WhatsApp النشطين
const clients = new Map();

// الصفحة الرئيسية
app.get('/', (req, res) => {
  res.json({
    message: '🤖 WhatsApp Multi-Session Server',
    status: 'online',
    version: '1.0.0',
    endpoints: {
      createSession: 'POST /api/session/create',
      getQR: 'GET /api/session/qr/:userId',
      viewQR: 'GET /qr/:userId (في المتصفح)',
      checkStatus: 'GET /api/session/status/:userId',
      sendMessages: 'POST /api/messages/send',
      logout: 'POST /api/session/logout'
    }
  });
});

// صفحة عرض QR Code في المتصفح
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
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
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
            h2 { color: #128C7E; margin-bottom: 20px; }
            p { color: #666; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="loader"></div>
            <h2>⏳ جاري تحميل QR Code...</h2>
            <p>الرجاء الانتظار قليلاً</p>
            <p style="font-size: 14px; color: #999;">سيتم تحديث الصفحة تلقائياً</p>
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
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
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
            animation: fadeIn 0.5s;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .qr-image {
            width: 100%;
            max-width: 300px;
            height: auto;
            border: 5px solid #25D366;
            border-radius: 15px;
            margin: 20px 0;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
          }
          h1 {
            color: #128C7E;
            margin-bottom: 10px;
            font-size: 28px;
          }
          .icon {
            font-size: 60px;
            margin: 10px 0;
          }
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
            transition: transform 0.2s;
          }
          .step:hover {
            transform: translateX(-5px);
          }
          .warning {
            background: #fff3cd;
            color: #856404;
            padding: 15px;
            border-radius: 10px;
            margin-top: 20px;
            font-size: 14px;
            border: 1px solid #ffeaa7;
          }
          .download-btn {
            background: #25D366;
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 25px;
            font-size: 16px;
            cursor: pointer;
            margin-top: 15px;
            transition: background 0.3s;
          }
          .download-btn:hover {
            background: #128C7E;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">📱</div>
          <h1>امسح الكود من هاتفك</h1>
          <img src="${client.qrCode}" alt="QR Code" class="qr-image" id="qrImage">
          
          <button class="download-btn" onclick="downloadQR()">💾 حفظ الصورة</button>
          
          <div class="instructions">
            <h3 style="color: #128C7E; margin-top: 0;">📋 خطوات المسح:</h3>
            <div class="step">1️⃣ افتح تطبيق واتساب في هاتفك</div>
            <div class="step">2️⃣ اذهب إلى: <strong>الإعدادات ⚙️</strong></div>
            <div class="step">3️⃣ اختر: <strong>الأجهزة المرتبطة</strong></div>
            <div class="step">4️⃣ اضغط: <strong>ربط جهاز</strong></div>
            <div class="step">5️⃣ وجّه الكاميرا نحو الكود أعلاه ✅</div>
          </div>
          
          <div class="warning">
            ⏰ الكود صالح لمدة دقيقتين فقط<br>
            سيتم تحديث الصفحة تلقائياً كل 30 ثانية
          </div>
        </div>
        
        <script>
          // تحديث تلقائي كل 30 ثانية
          setTimeout(() => {
            location.reload();
          }, 30000);
          
          // وظيفة تحميل الصورة
          function downloadQR() {
            const link = document.createElement('a');
            link.href = document.getElementById('qrImage').src;
            link.download = 'whatsapp_qr_code.png';
            link.click();
          }
        </script>
      </body>
    </html>
  `);
});

// إنشاء أو استرجاع جلسة
app.post('/api/session/create', async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId مطلوب' });
  }

  try {
    let session = await Session.findOne({ userId });
    
    if (!session) {
      session = new Session({ userId });
      await session.save();
    }

    if (!clients.has(userId)) {
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: userId
        }),
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
        console.log(✅ QR Code جاهز للمستخدم: ${userId});
      });

      client.on('ready', async () => {
        console.log(✅ العميل جاهز: ${userId});
        session.isActive = true;
        session.lastActivity = new Date();
        await session.save();
      });

      client.on('authenticated', () => {
        console.log(✅ تمت المصادقة: ${userId});
      });

      client.on('auth_failure', () => {
        console.log(❌ فشلت المصادقة: ${userId});
      });

      client.on('disconnected', async () => {
        console.log(⚠️ تم قطع الاتصال: ${userId});
        session.isActive = false;
        await session.save();
        clients.delete(userId);
      });

      clients.set(userId, client);
      await client.initialize();

      await new Promise(resolve => setTimeout(resolve, 5000));

      return res.json({
        message: 'تم إنشاء الجلسة',
        needsQR: true,
        sessionId: userId,
        qrUrl: /qr/${userId}
      });
    }

    const client = clients.get(userId);
    if (client.qrCode) {
      return res.json({
        message: 'الجلسة موجودة',
        needsQR: true,
        sessionId: userId,
        qrUrl: /qr/${userId}
      });
    }

    return res.json({
      message: 'الجلسة نشطة',
      needsQR: false,
      isActive: session.isActive
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في إنشاء الجلسة' });
  }
});

// الحصول على QR Code (JSON)
app.get('/api/session/qr/:userId', (req, res) => {
  const { userId } = req.params;
  const client = clients.get(userId);

  if (!client || !client.qrCode) {
    return res.status(404).json({ error: 'QR Code غير متاح' });
  }

  res.json({ qrCode: client.qrCode });
});

// حالة الجلسة
app.get('/api/session/status/:userId', async (req, res) => {
  const { userId } = req.params;
  const session = await Session.findOne({ userId });

  if (!session) {
    return res.status(404).json({ error: 'الجلسة غير موجودة' });
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
    lastActivity: session.lastActivity,
    messagesSentToday: session.messagesSentToday
  });
});

// إرسال رسائل جماعية
app.post('/api/messages/send', async (req, res) => {
  const { userId, messages } = req.body;

  if (!userId || !messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'بيانات غير صحيحة' });
  }

  const client = clients.get(userId);
  
  if (!client) {
    return res.status(404).json({ error: 'الجلسة غير موجودة أو غير نشطة' });
  }

  try {
    const state = await client.getState();
    if (state !== 'CONNECTED') {
      return res.status(400).json({ error: 'WhatsApp غير متصل' });
    }

    const session = await Session.findOne({ userId });
    const today = new Date().toDateString();
    
    // إعادة تعيين العداد إذا كان يوم جديد
    if (session.lastResetDate !== today) {
      session.messagesSentToday = 0;
      session.lastResetDate = today;
    }

    // فحص الحد اليومي
    const DAILY_LIMIT = 30;
    const remaining = DAILY_LIMIT - session.messagesSentToday;

    if (messages.length > remaining) {
      return res.status(429).json({
        error: 'تجاوزت الحد اليومي الآمن',
        sentToday: session.messagesSentToday,
        limit: DAILY_LIMIT,
        remaining: remaining,
        suggestion: يمكنك إرسال ${remaining} رسالة فقط اليوم
      });
    }

    const results = [];

    for (const msg of messages) {
      try {
        let phoneNumber = msg.phone.replace(/[^0-9]/g, '');
        
        if (!phoneNumber.startsWith('966')) {
          if (phoneNumber.startsWith('0')) {
            phoneNumber = '966' + phoneNumber.substring(1);
          } else {
            phoneNumber = '966' + phoneNumber;
          }
        }
        
        const chatId = phoneNumber + '@c.us';
        
        await client.sendMessage(chatId, msg.message);
        
        results.push({
          phone: msg.phone,
          status: 'success',
          message: 'تم الإرسال'
        });

        // تأخير عشوائي بين 3-8 ثواني
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

    // تحديث العداد
    session.messagesSentToday += messages.filter(r => 
      results.find(res => res.phone === r.phone && res.status === 'success')
    ).length;
    session.lastActivity = new Date();
    await session.save();

    res.json({
      message: 'تم معالجة الرسائل',
      results,
      sentToday: session.messagesSentToday,
      remaining: DAILY_LIMIT - session.messagesSentToday
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'خطأ في إرسال الرسائل' });
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
      console.log('خطأ في تسجيل الخروج:', e);
    }
    clients.delete(userId);
  }

  await Session.updateOne({ userId }, { isActive: false });
  
  res.json({ message: 'تم تسجيل الخروج بنجاح' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(🚀 السيرفر يعمل على المنفذ ${PORT});
  console.log(🌐 الرابط: http://localhost:${PORT});
