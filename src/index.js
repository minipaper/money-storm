import schedule from 'node-schedule';
import upbit from './services/upbit';
import TelegramBot from 'node-telegram-bot-api';
import { addComma } from './services/util';
import { logger } from './config/winston';

let targetCoin = 'VET';
let account = {};
let orderType = 'BUY';
let isWork = true;

let bot;
if (process.env.TELEGRAM_BOT_ENABLED === 'true' && process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  // 정보
  bot.onText(/\/\?|help|도움말|h/, (msg /*, match*/) => {
    const command = ['/? : 도움말', '/info : 현재 자산정보', '/stop : bot 멈춤', '/start : bot 시작', '/target : 코인변경'];
    bot.sendMessage(msg.chat.id, command.join('\n\n'));
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
  bot.onText(/\/i|\/info/, (msg) => {
    bot.sendMessage(msg.chat.id, `자산정보\n${JSON.stringify(account, null, 2)}`);
    bot.sendMessage(msg.chat.id, `목표코인\n${targetCoin}`);
  });
  bot.onText(/\/target (.+)/, (msg, match) => {
    const coin = match[1] ? match[1].toUpperCase() : '';
    if (coin !== '') {
      targetCoin = coin;
      bot.sendMessage(msg.chat.id, `${coin}으로 코인을 변경합니다.`);
    }
  });
}

const sayBot = (message) => {
  if (bot) {
    bot.sendMessage(process.env.TELEGRAM_BOT_CHAT_ID, message);
  }
};

const main = async () => {
  if (!isWork) return;
  // 매수시간인지 매도 시간인지 판단
  const now = new Date().getMinutes();
  orderType = now < 58 ? 'BUY' : 'SELL';

  // 1. 계좌정보 업데이트
  account = await upbit.updateAccount().catch((err) => {
    logger.error(err);
  });
  logger.info(`account ${JSON.stringify(account[targetCoin] ? account[targetCoin] : account)}`);

  if (orderType === 'BUY') {
    // 매수해야하는 시간
    if (account[targetCoin]) {
      // 이미 구매함
      logger.debug('이미 구매함' + JSON.stringify(account[targetCoin]));
      return;
    }

    // 2. 현재가 조회
    let currentCoinTick = await upbit.getTicker(`KRW-${targetCoin}`);
    logger.info('현재가' + JSON.stringify(currentCoinTick));

    // 3. 변동성 돌파 전략 적용
    // 최근 60분 시세 캔들 조회
    let candles = await upbit.getCandlesMinutes(60, `KRW-${targetCoin}`, 2);
    const current = candles[0];
    const previous = candles[1]; // 이전
    const range = previous.high_price - previous.low_price; // 변동폭 = (전일고가 - 전일저가)
    const targetPrice = current.opening_price + range * 0.5;

    logger.info(`현재가 ${addComma(currentCoinTick['trade_price'])}원 목표기준가 ${targetPrice}원 차이 ${addComma(targetPrice - currentCoinTick['trade_price'])}`);

    if (currentCoinTick['trade_price'] > targetPrice) {
      logger.info('사자');
      const orderResponse = await upbit.order('BUY', account, currentCoinTick).catch((err) => {
        logger.error(`${err.response.data}`);
        logger.error(`${JSON.stringify(err.response.data.error.message)}`);
      });
      const { price, volume } = orderResponse;
      logger.info(`매수 ${JSON.stringify(orderResponse)}`);
      sayBot(`매수 ${addComma(price * volume)}원`);
    } else {
      logger.debug('가격이 맞지 않아 SKIP');
      // sayBot(`매수 SKIP\n현재가 ${currentCoinTick['trade_price']}\n목표기준가 ${targetPrice}`);
    }
  } else if (orderType === 'SELL') {
    // 매도해야하는 시간
    if (account[targetCoin]) {
      // 2. 현재가 조회
      let currentCoinTick = await upbit.getTicker(`KRW-${targetCoin}`);
      logger.info('현재가' + JSON.stringify(currentCoinTick));
      const orderResponse = await upbit.order('SELL', account, currentCoinTick);
      const { price, volume } = orderResponse;
      logger.info(`매도 ${addComma(price * volume)}원`);
      sayBot(`매도 ${addComma(price * volume)}원`);
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
// 1분 주기
logger.info(`APP START - 변동성 돌파 전략`);
if (new Date().getSeconds() < 50) {
  main();
}
schedule.scheduleJob('*/1 * * * *', (fireDate) => {
  logger.info(`RUN ${fireDate}`);
  main().catch((err) => {
    logger.error(err);
    sayBot(`에러\n${JSON.stringify(err, null, 2)}`);
  });
});
