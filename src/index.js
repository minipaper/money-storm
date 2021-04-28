import schedule from 'node-schedule';
import TelegramBot from 'node-telegram-bot-api';
import upbit from './services/upbit';
import { addComma, delay } from './services/util';
import { logger, tail } from './config/winston';

const orderTable = {
  BTT: 700000,
  ETH: 700000,
  SNT: 400000,
  CHZ: 400000,
  MED: 300000,
};
const coins = Object.keys(orderTable);

let account = {};
let isWorking = true;

let bot;
if (process.env.TELEGRAM_BOT_ENABLED === 'true' && process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  // 정보
  bot.onText(/\/\?|help|도움말|h/, () => {
    const command = ['도움말 : /help', 'Account : /info', 'bot시작 : /start', 'bot정지 : /stop', '로그 : /log', '일괄매도'];
    sayBot(command.join('\n\n'));
  });
  // info
  bot.onText(/\/info/, () => {
    const info = {
      account,
      coins,
      isWorking,
    };
    sayBot(`INFO\n${JSON.stringify(info, null, 2)}`);
  });
  // log
  bot.onText(/\/log[\s]?(\d+)?/, (msg, match) => {
    const lines = match[1] ? match[1] * 1 : (coins.length + 1) * 2;
    tail(lines).then((data) => {
      sayBot(`LOGS\n${data}`);
    });
  });
  // 일괄매도
  bot.onText(/\/일괄매도/, async () => {
    account = await upbit.updateAccount();

    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i];
      if (account[coin]) {
        // 매도
        const currentCoinTick = await upbit.getTicker(`KRW-${coin}`);
        const orderResponse = await upbit.order('SELL', account, currentCoinTick);
        const { price, volume } = orderResponse;
        logger.info(`매도 ${coin} ${addComma(price * volume)}원`);
        sayBot(`매도 ${coin} ${addComma(price * volume)}원`);
      }
    }
  });
  bot.onText(/\/stop/, () => {
    isWorking = false;
    logger.info('봇을 정지합니다.');
    sayBot('봇을 정지합니다.');
  });
  bot.onText(/\/start/, () => {
    isWorking = true;
    logger.info('봇을 시작합니다.');
    sayBot('봇을 시작합니다.');
  });
}

const sayBot = (message) => {
  if (bot) {
    bot.sendMessage(process.env.TELEGRAM_BOT_CHAT_ID, message).catch((err) => {
      logger.error(`${JSON.stringify(err)}`);
    });
  }
};

const main = async () => {
  if (!isWorking) return;
  // 로직 시작
  account = await upbit.updateAccount();
  console.info(account);

  for (let i = 0; i < coins.length; i++) {
    const coin = coins[i];
    const isBuy = !account[coin];
    const isSell = !isBuy;

    const hours = await upbit.getHeikinAshi(60, `KRW-${coin}`, 3);
    if (isBuy && hours[0] === 'DOWN' && hours[1] === 'UP' && hours[2] === 'UP') {
      // 매수
      const currentCoinTick = await upbit.getTicker(`KRW-${coin}`);
      const orderResponse = await upbit.order('BUY', account, currentCoinTick, orderTable[coin]);
      const { price, volume } = orderResponse;
      logger.info(`매수 ${coin} ${JSON.stringify(orderResponse)}`);
      sayBot(`매수 ${coin} ${addComma(price * volume)}원`);
    } else if (isSell && hours[0] === 'UP' && hours[1] === 'DOWN' && hours[2] === 'DOWN') {
      // 매도
      const currentCoinTick = await upbit.getTicker(`KRW-${coin}`);
      const orderResponse = await upbit.order('SELL', account, currentCoinTick);
      const { price, volume } = orderResponse;
      logger.info(`매도 ${coin} ${addComma(price * volume)}원`);
      sayBot(`매도 ${coin} ${addComma(price * volume)}원`);
    } else {
      const msg = `SKIP ${coin} = ${JSON.stringify(hours)}`;
      logger.info(msg);
      sayBot(msg);
    }

    await delay(300);
  }
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
// 30분마다 체크
schedule.scheduleJob('10 */30 * * * *', (fireDate) => {
  logger.info(`RUN ${fireDate}`);
  main().catch((err) => {
    logger.error(err);
    sayBot(`에러\n${JSON.stringify(err, null, 2)}`);
  });
});
