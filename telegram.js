module.exports = {
  // 🔑 TELEGRAM BOT TOKEN (замените на ваш токен)
  JWT_SECRET: 'ab_super_secret_key_2025',
  BOT_TOKEN: '7938436710:AAH_aYM3W9qMrkmwKu-FiGo6SxwjF1nyKAI',
  
  // 💬 CHAT IDs для отправки уведомлений
  CHAT_IDS: {
    MANAGEMENT: '-4842669912', // ID группового чата руководителей
    ALERTS: '-4842669912'          // ID чата для алертов (может быть тот же)
  },
  
  // ⏰ РАСПИСАНИЕ УВЕДОМЛЕНИЙ
  SCHEDULE: {
    DAILY_REPORT: '0 9 * * *',      // Ежедневно в 9:00
    WEEKLY_REPORT: '0 10 * * 1',    // По понедельникам в 10:00  
    HOURLY_CHECK: '0 * * * *'       // Каждый час для алертов
  },
  
  // 🎯 НАСТРОЙКИ АЛЕРТОВ
  ALERTS: {
    LOW_CONVERSION_THRESHOLD: 5,     // Алерт если конверсия < 5%
    NO_MEETINGS_HOURS: 4,           // Алерт если нет встреч 4+ часов
    HIGH_JUNK_THRESHOLD: 70         // Алерт если брак > 70%
  }
};
