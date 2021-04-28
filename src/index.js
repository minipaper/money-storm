import schedule from 'node-schedule';
import TelegramBot from 'node-telegram-bot-api';
import upbit from './services/upbit';
import HeikinAshi from 'heikinashi';
import { addComma } from './services/util';
import { logger, tail } from './config/winston';

const orderTable = {
  BTT: 900000,
  ETH: 900000,
  BTC: 700000,
  XRP: 300000,
  MED: 300000,
  SNT: 300000,
  CHZ: 300000,
};
const coins = Object.keys(orderTable);

let account = {};

let bot;
if (process.env.TELEGRAM_BOT_ENABLED === 'true' && process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  // 정보
  bot.onText(/\/\?|help|도움말|h/, () => {
    const command = ['도움말 : /help', 'Account : /info', '로그 : /log'];
    sayBot(command.join('\n\n'));
  });
  // info
  bot.onText(/\/info/, () => {
    sayBot(`INFO\n${JSON.stringify(account, null, 2)}`);
  });
  // log
  bot.onText(/\/log[\s]?(\d+)?/, (msg, match) => {
    const lines = match[1] ? match[1] * 1 : (coins.length + 1) * 2;
    tail(lines).then((data) => {
      sayBot(`LOGS\n${data}`);
    });
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

        return {
          time: timestamp,
          close: trade_price,
          high: high_price,
          low: low_price,
          open: opening_price,
          volume: candle_acc_trade_volume,
          kst_time: candle_date_time_kst,
        };
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
    items.pop(); // 마지막 틱은 완성이 아니기 때문에 제거
    const currentCoinTick = await upbit.getTicker(`KRW-${coin}`);

    const result = items.map((item) => item.change);

    const previousTick = items[1]; // 하이킨 아시 - 이전틱
    const currentOpen = (previousTick.open + previousTick.close) / 2; // 하이킨 아시 - 현재 시작가
    // 시작가보다 현재 거래가가 높아졌으면 UP
    if (currentOpen < currentCoinTick['trade_price']) {
      result.push('UP');
    } else if (currentOpen > currentCoinTick['trade_price']) {
      result.push('DOWN');
    } else {
      result.push('SAME');
    }

    if ((isBuy && result[0] === 'DOWN' && result[1] === 'UP' && result[2] === 'UP') || (isBuy && result[0] === 'UP' && result[1] === 'UP' && result[2] === 'UP')) {
      // 매수
      const orderResponse = await upbit.order('BUY', account, currentCoinTick, orderTable[coin]);
      const { price, volume } = orderResponse;
      logger.info(`매수 ${coin} ${JSON.stringify(orderResponse)}`);
      sayBot(`매수 ${coin} ${addComma(price * volume)}원`);
    } else if ((isSell && result[0] === 'UP' && result[1] === 'DOWN' && result[1] === 'DOWN') || (isSell && result[0] === 'DOWN' && result[1] === 'DOWN' && result[1] === 'DOWN')) {
      // 매도
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
// 10분마다 체크
schedule.scheduleJob('30 */10 * * * *', (fireDate) => {
  logger.info(`RUN ${fireDate}`);
  main().catch((err) => {
    logger.error(err);
    sayBot(`에러\n${JSON.stringify(err, null, 2)}`);
  });
});
