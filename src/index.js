import schedule from 'node-schedule';
import TelegramBot from 'node-telegram-bot-api';
import { logger } from './config/winston';

let bot;
if (process.env.TELEGRAM_BOT_ENABLED === 'true' && process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  // 정보
  bot.onText(/\/\?|help|도움말|h/, (msg /*, match*/) => {
    const command = ['/? : 도움말', '/info : 현재 자산정보', '/stop : bot 멈춤', '/start : bot 시작', '/target : 코인변경'];
    bot.sendMessage(msg.chat.id, command.join('\n\n'));
  });
}

const sayBot = (message) => {
  if (bot) {
    bot.sendMessage(process.env.TELEGRAM_BOT_CHAT_ID, message);
  }
};

const main = async () => {
  // 로직 시작
};

/*
*    *    *    *    *    *
┬    ┬    ┬    ┬    ┬    ┬
│    │    │    │    │    │
│    │    │    │    │    └ day of week (0 - 7) (0 or 7 is Sun)
│    │    │    │    └───── month (1 - 12)
│    │    │    └────────── day of month (1 - 31)
│    │    └─────────────── hour (0 - 23)
│    └──────────────────── minute (0 - 59)
└───────────────────────── second (0 - 59, OPTIONAL)*/
// 1분 주기
logger.info(`APP START`);
if (new Date().getSeconds() < 55) {
  main();
}
schedule.scheduleJob('*/1 * * * *', (fireDate) => {
  logger.info(`RUN ${fireDate}`);
  main().catch((err) => {
    logger.error(err);
    sayBot(`에러\n${JSON.stringify(err, null, 2)}`);
  });
});
