import schedule from 'node-schedule';
import upbit from './services/upbit';
import TelegramBot from 'node-telegram-bot-api';
import { addComma } from './services/util';
import { logger, tail } from './config/winston';

let targetCoins = ['BTC', 'BTT', 'ETH', 'XRP'];
let targetPercent = 3;
let account = {};
const buyCounter = {};
let isWork = true;
let buy = false;

let bot;
if (process.env.TELEGRAM_BOT_ENABLED === 'true' && process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  // 정보
  bot.onText(/\/\?|help|도움말|h/, (msg /*, match*/) => {
    // eslint-disable-next-line
    const command = [
      "/? : 도움말",
      "자산정보 /info",
      "bot멈춤 /stop",
      "bot시작 /start",
      "코인추가 /push",
      "코인제거 /pop",
      "자동구매 /buy",
      "로그보기 /log",
    ];

    bot.sendMessage(msg.chat.id, command.join('\n\n'));
  });
  bot.onText(/\/log[\s]?(\d+)?/, (msg, match) => {
    const lines = match[1] ? match[1] * 1 : targetCoins.length * 2;
    tail(lines).then((data) => {
      bot.sendMessage(msg.chat.id, `LOGS\n${data}`);
    });
  });
  bot.onText(/\/buy/, (msg) => {
    buy = !buy;
    logger.info(`자동구매 : ${buy ? 'ON' : 'OFF'}`);
    bot.sendMessage(msg.chat.id, `자동구매 : ${buy ? 'ON' : 'OFF'}`);
  });
  bot.onText(/\/stop/, (msg) => {
    isWork = false;
    logger.info('봇을 정지합니다.');
    bot.sendMessage(msg.chat.id, '봇을 정지합니다.');
  });
  bot.onText(/\/start/, (msg) => {
    isWork = true;
    logger.info('봇을 시작합니다.');
    bot.sendMessage(msg.chat.id, '봇을 시작합니다.');
  });
  // 실시간 코인 추가
  bot.onText(/\/push (.+)/, (msg, match) => {
    const coin = match[1] ? match[1].toUpperCase() : '';

    // 중복 체크
    if (targetCoins.indexOf(coin) < 0) {
      targetCoins.push(coin);
    }
    bot.sendMessage(msg.chat.id, `지정코인\n${targetCoins.join(', ')}`);
  });
  // 실시간 코인 제거
  bot.onText(/\/pop (.+)/, (msg, match) => {
    const coin = match[1] ? match[1].toUpperCase() : '';
    const index = targetCoins.indexOf(coin);

    if (index > -1) {
      targetCoins.splice(index, 1);
    }
    bot.sendMessage(msg.chat.id, `지정코인\n${targetCoins.join(', ')}`);
  });
  bot.onText(/\/i|\/info/, (msg) => {
    // bot.sendMessage(msg.chat.id, `자산정보\n${JSON.stringify(account, null, 2)}`);
    bot.sendMessage(msg.chat.id, `봇 동작 ${isWork ? 'True' : 'False'}`);
    bot.sendMessage(msg.chat.id, `지정코인\n${targetCoins.join(', ')}`);
  });
}

const sayBot = (message) => {
  if (bot) {
    bot.sendMessage(process.env.TELEGRAM_BOT_CHAT_ID, message);
  }
};

const main = async () => {
  if (!isWork) return;
  // 1. 내 자산 update
  account = await upbit.updateAccount();
  // console.info('account', account);

  for (let i = 0; i < targetCoins.length; i++) {
    const coinName = targetCoins[i];
    const direction = account[coinName] ? 'SELL' : 'BUY';
    logger.info(`${coinName} ${direction}`);
    // 2. 현재가 조회
    let currentCoinTick = await upbit.getTicker(`KRW-${coinName}`);
    // console.info('현재가', coinName, currentCoinTick);

    if (direction === 'BUY') {
      // 매수
      let candles = await upbit.getCandlesMinutes(15, `KRW-${coinName}`, 2);
      const current = candles[0];
      const previous = candles[1]; // 이전
      const range = previous.high_price - previous.low_price; // 변동폭 = (전일고가 - 전일저가)
      const targetPrice = current.opening_price + range * 0.35;

      logger.info(
        `${coinName} - 현재가 ${addComma(currentCoinTick['trade_price'])}원 목표기준가 ${addComma(targetPrice)}원 차이 ${addComma(targetPrice - currentCoinTick['trade_price'])}`
      );

      if (currentCoinTick['trade_price'] > targetPrice) {
        const cashKRW = Math.floor(account['KRW'].balance);
        if (cashKRW < 5000) {
          // 잔액부족
          logger.error(`현금이 부족합니다. 현재 자금 ${addComma(cashKRW, 0)}원`);
          return;
        }

        if (!buyCounter[coinName]) {
          buyCounter[coinName] = 0;
        }
        buyCounter[coinName] += 1;
        if (buyCounter[coinName] < 3) {
          // 3분동안 현재가격이 유지가 되면 구매 - 구매금액이 최소 3분이상 유지되야함
          return;
        }
        buyCounter[coinName] = 0;

        const buyCnt = targetCoins.filter((targetCoin) => !account[targetCoin]).length;
        const orderMoney = Math.floor(cashKRW / buyCnt);
        if (buy) {
          const orderResponse = await upbit.order('BUY', account, currentCoinTick, orderMoney);
          const { price, volume } = orderResponse;
          logger.info(`매수 ${JSON.stringify(orderResponse)}`);
          sayBot(`매수 ${coinName} ${addComma(price * volume)}원`);
        } else {
          sayBot(`매수하세요!\n${coinName} - 현재가 ${addComma(currentCoinTick['trade_price'])}원 목표기준가 ${addComma(targetPrice)}원 차이 ${addComma(orderMoney)}`);
        }
      }
    } else {
      // 매도
      // 매수평균
      const avgBuyPrice = account[coinName]['avg_buy_price'] * 1;
      const nowPrice = currentCoinTick['trade_price'] * 1;
      const targetPrice = (avgBuyPrice * (100 + targetPercent)) / 100;
      logger.info(`${coinName} - 매수평균 : ${avgBuyPrice}, 목표가: ${targetPrice}, 현재가 : ${nowPrice}`);

      if (nowPrice > targetPrice) {
        // 매도 실행
        const orderResponse = await upbit.order('SELL', account, currentCoinTick);
        const { price, volume } = orderResponse;
        logger.info(`매도 ${addComma(price * volume)}원`);
        sayBot(`매도 ${coinName} ${addComma(price * volume)}원`);
      } else {
        // 존버
      }
    }
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
if (new Date().getSeconds() < 50) {
  main();
}
schedule.scheduleJob('*/1 * * * *', () => {
  main().catch((err) => {
    logger.error(err);
    sayBot(`에러\n${JSON.stringify(err, null, 2)}`);
  });
});
