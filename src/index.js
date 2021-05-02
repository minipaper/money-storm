import schedule from 'node-schedule';
import TelegramBot from 'node-telegram-bot-api';
import upbit from './services/upbit';
import util, { addComma, delay } from './services/util';
import moment from 'moment';
import { logger, tail } from './config/winston';

const priceTotal = 2000000;
let coinCnt = 5;
const pricePerCoin = priceTotal / coinCnt; // 코인한종목당 가격
const targetRate = 0.55; // 수익률 0.5퍼센트 이상이면 일괄 매도
const targetRatePerCoin = 1.5; // 코인 한개당 수익매도 수익률

const exceptionCoins = []; // 제외하고 싶은 코인

let targetCoins = [];
let account = {};
let isWorking = true;

let bot;
if (process.env.TELEGRAM_BOT_ENABLED === 'true' && process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  // 정보
  bot.onText(/\/\?|help|도움말|h/, () => {
    const command = ['도움말 : /help', 'Account : /info', 'bot시작 : /start', 'bot정지 : /stop', '추천 : /추천', '로그 : /log', '일괄매도', '실행'];
    sayBot(command.join('\n\n'));
  });
  // info
  bot.onText(/\/info/, () => {
    const info = {
      account,
      targetCoins,
      isWorking,
      exceptionCoins,
    };
    sayBot(`INFO\n${JSON.stringify(info, null, 2)}`);
  });
  // log
  bot.onText(/\/log[\s]?(\d+)?/, (msg, match) => {
    const lines = match[1] ? match[1] * 1 : (targetCoins.length + 1) * 2;
    tail(lines).then((data) => {
      sayBot(`LOGS\n${data}`);
    });
  });
  // 추천
  bot.onText(/\/추천/, async () => {
    const market = await upbit.recommendCoins(3, [], true);
    if (market.length === 0) {
      sayBot('추천할 코인이 없습니다.');
    }
    sayBot(market.map((m) => `${m.korean_name}(${m.market})`).join(', '));
  });
  // 일괄매도
  bot.onText(/\/일괄매도/, async () => {
    account = await upbit.updateAccount();
    const coins = Object.keys(account).filter((c) => c !== 'KRW');
    await sellAll(coins);
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

async function sellAll(coins) {
  // 일괄매도
  logger.info(`일괄매도를 진행합니다.\n${coins.join(',')}`);
  sayBot(`일괄매도를 진행합니다.\n${coins.join(',')}`);
  for (let i = 0; i < coins.length; i++) {
    const coin = coins[i];
    if (account[coin]) {
      // 매도
      const currentCoinTick = await upbit.getTicker(`KRW-${coin}`);
      const orderResponse = await upbit.order('SELL', account, currentCoinTick);
      const { price, volume } = orderResponse;

      const msg = `매도 ${coin} ${addComma(price * volume)}원 평가손익 ${price * volume - pricePerCoin}원`;
      logger.info(msg);
      sayBot(msg);
      await delay(100);
    }
    const idx = targetCoins.indexOf(coin);
    if (idx > -1) {
      targetCoins.splice(idx, 1);
    }
  }
}

const main = async () => {
  if (!isWorking) return;
  // 로직 시작
  account = await upbit.updateAccount();
  let coins = Object.keys(account).filter((c) => c !== 'KRW');
  if (coinCnt > coins.length) {
    // 추천 코인 추가
    console.info('추천코인추가');
    const exception = [...coins, ...exceptionCoins]; // 기존 가지고있는 코인
    let recommend = await upbit.recommendCoins(coinCnt - coins.length, exception, true);
    recommend = recommend.map((c) => c.market.replace('KRW-', ''));
    logger.info(`추천코인 ${JSON.stringify(recommend)}`);
    targetCoins = [...targetCoins, ...recommend];
    const uniqArr = new Set(targetCoins);
    targetCoins = [...uniqArr];
    if (targetCoins.length > coinCnt) {
      targetCoins.length = coinCnt;
    }
  }

  // 전체 수익률 체크
  let proceeds = 0; // 전체수익금
  let rate = 0; // 전체수익률
  const currentRate = {};
  if (coins.length === 0) {
    console.log(`소유한 코인이 없습니다.`);
  } else {
    const snapshot = await upbit.getTickers(coins.map((coin) => `KRW-${coin}`));
    // let sum = 0;
    let 내가산금액Sum = 0;
    let 현재금액Sum = 0;
    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i];
      const { balance, avg_buy_price } = account[coin];
      const ticker = snapshot.find((m) => m.market === `KRW-${coin}`);
      const 내가산금액 = balance * avg_buy_price;
      const 현재금액 = balance * ticker.trade_price;

      const result = 현재금액 - 내가산금액;
      console.log(`수익금 ${coin} : ${result}원`);
      // sum += result;
      내가산금액Sum += 내가산금액;
      현재금액Sum += 현재금액;

      // 현재 코인
      currentRate[coin] = ((현재금액 - 내가산금액) / 내가산금액) * 100;
    }
    if (coins.length > 0) {
      proceeds = 현재금액Sum - 내가산금액Sum;
      rate = (proceeds / 내가산금액Sum) * 100;
      logger.info(`총 수익금 ${util.addComma(proceeds)}원 - 총 수익률 ${rate}%`);
    }
  }

  // 전체 수익률이 지정된 수익 이상이면
  if (rate >= targetRate) {
    // 일괄매도
    let recommend = await upbit.recommendCoins(coinCnt, [], true);
    recommend = recommend.map((c) => c.market.replace('KRW-', '')).filter((c) => coins.includes(c));
    if (recommend.length > 0) {
      // 추천코인에 포함되어있으면 한틱 skip
      // skip
    } else {
      await sellAll(coins);
      logger.info(`총 수익금 ${util.addComma(proceeds)}원 - 총 수익률 ${rate}%`);
    }
  } else {
    //
    console.log('일괄매도 조건 안됨');
    // 혼자서 2프로 이상 수익률이 있으면 익절
    const rateCoins = Object.keys(currentRate);
    for (let i = 0; i < rateCoins.length; i++) {
      const rateCoin = rateCoins[i];
      if (currentRate[rateCoin] >= targetRatePerCoin) {
        // 매도
        const currentCoinTick = await upbit.getTicker(`KRW-${rateCoin}`);
        const orderResponse = await upbit.order('SELL', account, currentCoinTick);
        const { price, volume } = orderResponse;
        const msg = `[${targetRatePerCoin}프로 수익달성] - 매도 ${rateCoin} ${addComma(price * volume)}원`;
        logger.info(msg);
        sayBot(msg);
        // 급등 코인 당분간 BAN
        exceptionCoins.push(rateCoin);
        const minutes = 10 * 60 * 1000; // 10분 뒤까지 ban
        setTimeout(() => {
          const idx = exceptionCoins.indexOf(rateCoin);
          exceptionCoins.splice(idx, 1);
        }, minutes);
        if (targetCoins.includes(rateCoin)) {
          const idx = targetCoins.indexOf(rateCoin);
          targetCoins.splice(idx, 1);
        }

        await delay(100);
      }
    }

    for (let i = 0; i < targetCoins.length; i++) {
      const targetCoin = targetCoins[i];
      if (account[targetCoin]) {
        // 코인이 있으면 skip
      } else {
        // 추천종목중 없는 코인 구매
        // 종목시작떄 거래량이 튀어서 이상한거 살수있어서 막음
        const now = moment();
        const periodA = moment().hour(8).minute(55).second(0);
        const periodB = moment().hour(9).minute(30).second(0);
        if (now.isBetween(periodA, periodB)) {
          logger.info(`${periodA.format('LT')} 부터 ${periodB.format('LT')} 까지 구매를 멈춥니다.`);
          return;
        }

        console.log(`코인 매수 진행 : ${targetCoin}`);
        const currentCoinTick = await upbit.getTicker(`KRW-${targetCoin}`);
        const orderResponse = await upbit.order('BUY', account, currentCoinTick, pricePerCoin);
        const { price, volume } = orderResponse;
        logger.info(`매수 ${targetCoin} ${JSON.stringify(orderResponse)}`);
        sayBot(`매수 ${targetCoin} ${addComma(price * volume)}원`);
        await delay(300);
      }
    }

    // 급락하는 코인 찾아서 손절
    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i];
      console.log(`급락체크 중 ${coin}`);
      const hours = await upbit.getHeikinAshi(60, `KRW-${coin}`, 3);
      if (hours[0] === 'UP' && hours[1] === 'DOWN' && hours[2] === 'DOWN') {
        // 매도
        const currentCoinTick = await upbit.getTicker(`KRW-${coin}`);
        const orderResponse = await upbit.order('SELL', account, currentCoinTick);
        const { price, volume } = orderResponse;
        const msg = `[급락] - 매도 ${coin} ${addComma(price * volume)}원`;
        // 급락 코인 당분간 BAN
        exceptionCoins.push(coin);
        const minutes = 70 * 60 * 1000; // 70분 뒤까지 ban
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
        await delay(300);
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
schedule.scheduleJob('20 * * * * *', (fireDate) => {
  logger.info(`RUN ${fireDate}`);
  main().catch((err) => {
    logger.error(err);
    sayBot(`에러\n${JSON.stringify(err, null, 2)}`);
  });
});
