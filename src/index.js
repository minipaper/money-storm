import schedule from 'node-schedule';
import TelegramBot from 'node-telegram-bot-api';
import upbit from './services/upbit';
import util, { addComma } from './services/util';
import { logger, tail } from './config/winston';
import db from './config/db';

let bot;
if (process.env.TELEGRAM_BOT_ENABLED === 'true' && process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  // 정보
  bot.onText(/\/\?|help|도움말|h/, () => {
    const command = [];
    command.push('도움말 : /help');
    command.push('로그 : /log');
    command.push('손절가 : /stoploss');
    command.push('봇시작 : /start');
    command.push('봇중단 : /stop');
    sayBot(command.join('\n\n'));
  });
  // info
  bot.onText(/\/info/, () => {
    const info = {};
    sayBot(`INFO\n${JSON.stringify(info, null, 2)}`);
  });
  // log
  bot.onText(/\/log[\s]?(\d+)?/, (msg, match) => {
    const lines = match[1] ? match[1] * 1 : 20;
    tail(lines).then((data) => {
      sayBot(`LOGS\n${data}`);
    });
  });
  bot.onText(/\/stoploss/, () => {
    const items = db.get('orders').value();
    sayBot(`손절가\n${JSON.stringify(items, null, 2)}`);
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

/************************
 * 변수 설정
 ************************/
const pricePerCoin = 1 * 10000;
let coinCnt = 5;
let bunbong = 15;
let account = {};
// let targetCoins = ['BTC', 'BCH', 'ETH', 'ETC', 'DOT'];
let targetCoins = [];
const exceptionCoins = ['BTT', 'ETC', 'DOGE']; // 제외하고 싶은 코인
let isWorking = true;

const main = async () => {
  if (!isWorking) return;
  account = await upbit.updateAccount();
  // 보유코인
  let coins = Object.keys(account).filter((c) => c !== 'KRW');
  if (coinCnt > coins.length) {
    // 추천 코인 추가
    const exception = [...coins, ...exceptionCoins]; // 기존 가지고있는 코인
    let recommend = await upbit.recommendCoins(coinCnt - coins.length, exception);
    recommend = recommend.map((c) => c.market.replace('KRW-', ''));
    logger.info(`추천코인 ${JSON.stringify(recommend)}`);
    targetCoins = [...targetCoins, ...recommend];
    const uniqArr = new Set(targetCoins);
    targetCoins = [...uniqArr];
    if (targetCoins.length > coinCnt) {
      targetCoins.length = coinCnt;
    }
  }

  for (let i = 0; i < targetCoins.length; i++) {
    const coin = targetCoins[i];
    if (exceptionCoins.includes(coin)) continue;

    const heikin = await upbit.getHeikinAshi(bunbong, `KRW-${coin}`, 4);
    await util.delay();
    if (account[coin]) {
      // 매도체크
      // 1. UP - UP - DOWN - DOWN 일때 판다
      if (heikin[0].change === 'UP' && heikin[1].change === 'UP' && heikin[2].change === 'DOWN' && heikin[3].change === 'DOWN') {
        console.log('매도', coin);
        const ticker = await upbit.getTicker(`KRW-${coin}`);
        const orderResponse = await upbit.order('SELL', account, ticker);
        const { price, volume } = orderResponse;
        const msg = `매도 ${coin} ${addComma(price * volume)}원`;

        exceptionCoins.push(coin);
        const minutes = bunbong * 2 * 60 * 1000; // 분봉2배만큼
        setTimeout(() => {
          const idx = exceptionCoins.indexOf(coin);
          exceptionCoins.splice(idx, 1);
        }, minutes);
        if (targetCoins.includes(coin)) {
          const idx = targetCoins.indexOf(coin);
          targetCoins.splice(idx, 1);
        }

        logger.info(msg);
        sayBot(msg);

        db.get('orders').remove({ name: coin }).write();
        continue;
      }
      // 2. 혹은 손절가가 지정되어있는 경우 아래인 경우 판다
      const item = db.get('orders').find({ name: coin }).value();
      if (item && item.stopLoss) {
        const ticker = await upbit.getTicker(`KRW-${coin}`);
        await util.delay();
        const tradePrice = ticker['trade_price'];
        if (tradePrice < item.stopLoss) {
          console.log('매도', coin);
          const orderResponse = await upbit.order('SELL', account, ticker);
          const { price, volume } = orderResponse;
          const msg = `손절가 매도 ${coin} ${addComma(price * volume)}원`;

          exceptionCoins.push(coin);
          const minutes = bunbong * 2 * 60 * 1000; // 분봉2배만큼
          setTimeout(() => {
            const idx = exceptionCoins.indexOf(coin);
            exceptionCoins.splice(idx, 1);
          }, minutes);
          if (targetCoins.includes(coin)) {
            const idx = targetCoins.indexOf(coin);
            targetCoins.splice(idx, 1);
          }

          logger.info(msg);
          sayBot(msg);

          db.get('orders').remove({ name: coin }).write();
        }
      }
    } else {
      // 매수 체크
      // 1. DOWN - DOWN - UP - UP 일 경우 산다
      if (heikin[0].change === 'DOWN' && heikin[1].change === 'DOWN' && heikin[2].change === 'UP' && heikin[3].change === 'UP') {
        console.log('매수', coin);
        const currentCoinTick = await upbit.getTicker(`KRW-${coin}`);
        const orderResponse = await upbit.order('BUY', account, currentCoinTick, pricePerCoin);
        const { price, volume } = orderResponse;
        logger.info(`매수 ${coin} ${JSON.stringify(orderResponse)}`);
        sayBot(`매수 ${coin} ${addComma(price * volume)}원`);
        await util.delay(300);

        // 2. 이때 손절가도 같이 세팅 DOWN DOWN 중 Math.Min(haLow) 으로 세팅
        db.get('orders')
          .push({
            name: coin,
            stopLoss: Math.min(heikin[0].low, heikin[1].low),
          })
          .write();
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
// 1분마다 체크
schedule.scheduleJob('10 * * * * *', (fireDate) => {
  logger.info(`RUN ${fireDate}`);
  main().catch((err) => {
    logger.error(err);
    sayBot(`에러\n${JSON.stringify(err, null, 2)}`);
  });
});
