import schedule from 'node-schedule';
import TelegramBot from 'node-telegram-bot-api';
import upbit from './services/upbit';
import HeikinAshi from 'heikinashi';
import { addComma } from './services/util';
import { logger, tail } from './config/winston';

const coins = ['XRP', 'BTT', 'MFT', 'MED', 'ETH'];
const orderMoney = {
  XRP: 1000000,
  BTT: 1000000,
  MFT: 130000,
  MED: 130000,
  ETH: 500000,
};

let bot;
if (process.env.TELEGRAM_BOT_ENABLED === 'true' && process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  // 정보
  bot.onText(/\/\?|help|도움말|h/, (msg /*, match*/) => {
    const command = ['도움말 : /help', '로그 : /log'];
    bot.sendMessage(msg.chat.id, command.join('\n\n'));
  });
  // log
  bot.onText(/\/log[\s]?(\d+)?/, (msg, match) => {
    const lines = match[1] ? match[1] * 1 : (coins.length + 1) * 2;
    tail(lines).then((data) => {
      bot.sendMessage(msg.chat.id, `LOGS\n${data}`);
    });
  });
}

const sayBot = (message) => {
  if (bot) {
    bot.sendMessage(process.env.TELEGRAM_BOT_CHAT_ID, message);
  }
};
let account = {};
const main = async () => {
  // 로직 시작
  account = await upbit.updateAccount();

  for (let i = 0; i < coins.length; i++) {
    const coin = coins[i];
    const isBuy = !account[coin];
    const isSell = !isBuy;

    const candles = await upbit.getCandlesMinutes(60, `KRW-${coin}`, 200);

    const items = HeikinAshi(
      candles.reverse().map((bar) => {
        const { trade_price, opening_price, high_price, low_price, timestamp, candle_acc_trade_volume, candle_date_time_kst } = bar;
        const item = {
          time: timestamp,
          close: trade_price,
          high: high_price,
          low: low_price,
          open: opening_price,
          volume: candle_acc_trade_volume,
          kst_time: candle_date_time_kst,
        };

        return item;
      }),
      {
        overWrite: false, //overwrites the original data or create a new array
        formatNumbers: false, //formats the numbers and reduces their significant digits based on the values
        decimals: 4, //number of significant digits
        forceExactDecimals: false, //force the number of significant digits or reduce them if the number is high
      }
    ).map((item) => {
      if (item.close > item.open) {
        item.change = 'UP';
      } else if (item.close < item.open) {
        item.change = 'DOWN';
      } else {
        item.change = 'SAME';
      }
      return item;
    });
    items.splice(0, items.length - 3);

    const result = items.map((item) => item.change);

    if (result[0] === 'DOWN' && result[1] === 'UP' && result[2] === 'UP' && isBuy) {
      // 매수
      const currentCoinTick = await upbit.getTicker(`KRW-${coin}`);
      const orderResponse = await upbit.order('BUY', account, currentCoinTick, orderMoney[coin]);
      const { price, volume } = orderResponse;
      logger.info(`매수 ${coin} ${JSON.stringify(orderResponse)}`);
      sayBot(`매수 ${coin} ${addComma(price * volume)}원`);
    } else if (result[0] === 'UP' && result[1] === 'DOWN' && result[2] === 'DOWN' && isSell) {
      // 매도
      const currentCoinTick = await upbit.getTicker(`KRW-${coin}`);
      const orderResponse = await upbit.order('SELL', account, currentCoinTick);
      const { price, volume } = orderResponse;
      logger.info(`매도 ${coin} ${addComma(price * volume)}원`);
      sayBot(`매도 ${coin} ${addComma(price * volume)}원`);
    } else {
      logger.info(`SKIP ${coin} = ${JSON.stringify(result)}`);
      sayBot(`SKIP ${coin} = ${JSON.stringify(result)}`);
    }

    // console.info(`${isBuy} - ${coin} = ${result}`);
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
// 정시 1분마다 체크
schedule.scheduleJob('1 * * * *', (fireDate) => {
  logger.info(`RUN ${fireDate}`);
  main().catch((err) => {
    logger.error(err);
    sayBot(`에러\n${JSON.stringify(err, null, 2)}`);
  });
});
