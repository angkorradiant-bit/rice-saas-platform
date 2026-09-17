// lib/telegramConfig.ts

export const TELEGRAM_CONFIG = {
  // Replace with your actual Bot Token from @BotFather
  botToken: process.env.TELEGRAM_BOT_TOKEN || '8456983531:AAFtJFEQKQrvRQ9XitoItMKCYbfGkcf2cyU',

  // Replace with your actual Telegram Chat ID
  chatId: process.env.TELEGRAM_CHAT_ID || '-1004455507954',

  newGroupChatId: process.env.TELEGRAM_STOCK_CHAT_ID || '-5395498078',

  // Set default fallback toggles if you aren't reading from Supabase
  autoSendDaily: true,
  autoSendMonthly: true,

  // 📦 STOCK ALERTS TOPICS (Used by the POS)
  stockTopics: {
    1: 12, // SMC Stock Alerts
    2: 11, // Chukmeas Stock Alerts
  } as Record<number, number>,

  // 💰 FINANCIAL REPORTS TOPICS (Used by the Report Dashboard)
  reportTopics: {
    1: 2, // SMC Daily Data & COGS
    2: 3, // Chukmeas Daily Data & COGS
  } as Record<number, number>,

  // 🚚 DELIVERY ALERTS TOPICS 
  // Format: [database_branch_id]: telegram_topic_thread_id
  deliveryTopics: {
    1: 19, // SMC Delivery Topic
    2: 22, // Chukmeas Delivery Topic
  } as Record<number, number>
}