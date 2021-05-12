import schedule from 'node-schedule';
import TelegramBot from 'node-telegram-bot-api';
import upbit from './services/upbit';
import util, { addComma } from './services/util';
import { logger, tail } from './config/winston';
import db from './config/db';
import moment from 'moment';

let bot;
if (process.env.TELEGRAM_BOT_ENABLED === 'true' && process.env.TELEGRAM_BOT_TOKEN) {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  // 정보
  bot.onText(/\/\?|help|도움말|h/, () => {
    const command = [];
    command.push('도움말 : /help');
    command.push('수익금 : /profit');
    command.push('코인매도 : /sell coinname');
    command.push('로그 : /log');
    command.push('손절가 : /loss');
    command.push('코인추천 : /recommend');
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
  // profit
  bot.onText(/\/profit/, () => {
    sayBot(`${getProfit()}`);
  });
  // loss
  bot.onText(/\/loss/, () => {
    const items = db.get('orders').value();
    sayBot(`손절가\n${JSON.stringify(items, null, 2)}`);
  });
  // sell
  bot.onText(/\/sell (.+)/, async (msg, match) => {
    const coin = match[1] ? match[1].toUpperCase().trim() : '';
    if (coin !== '' && account[coin]) {
      const ticker = await upbit.getTicker(`KRW-${coin}`);
      await util.delay();
      await sellCoin(coin, ticker, '수동 매도');
    } else {
      sayBot(`${coin}을 찾을수 없습니다.`);
    }
  });
  bot.onText(/\/recommend/, async () => {
    const botStatus = isWorking;
    isWorking = false;
    sayBot(`추천코인을 찾으러 갑니다.`);
    let items = await upbit.recommendCoins(4, []);
    items = items.map((c) => c.market.replace('KRW-', ''));
    if (items.length > 0) {
      sayBot(`추천코인\n${JSON.stringify(items.join(', '))}`);
    } else {
      sayBot(`추천 코인이 없습니다.`);
    }
    isWorking = botStatus;
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
      logger.error(`${JSON.stringify(err, null, 2)}`);
    });
  }
};

const getProfit = () => {
  const day = moment().format('YYYYMMDD');
  const msgs = [];
  const items = db.get('history').value();
  const item = items.find((item) => item.day === day);
  console.log('items', items);
  if (item) {
    msgs.push(`${moment().format('YYYY년 MM월 DD일')} 수익금 ${util.printCash(item.profit)}원`);
  }
  const total = items.reduce((a, b) => a + b.profit, 0);
  msgs.push(`봇으로 계산된 전체 수익금 ${util.printCash(total)}원`);
  return msgs.join('\n');
};

/************************
 * 변수 설정
 ************************/
const manualCoins = ['BTT', 'ETC', 'DOGE']; // 앱으로 수동으로 관리하는 코인들
const exceptionCoins = [...manualCoins, 'MVL']; // 제외하고 싶은 코인들
const pricePerCoin = 20 * 10000;
let coinCnt = 6 + manualCoins.length;
let bunbong = 15;
let account = {};
let targetCoins = [];
let isWorking = true;

const sellCoin = async (coin, ticker, msgHeader = '매도') => {
  const orderResponse = await upbit.order('SELL', account, ticker);
  await util.delay();
  const { price, volume } = orderResponse;
  // 수익률 체크
  const { balance, avg_buy_price } = account[coin];
  const 내가판금액 = price * volume;
  const 내가산금액 = balance * avg_buy_price;
  const 수익금 = 내가판금액 - 내가산금액;
  const 수익률 = (수익금 / 내가산금액) * 100;

  const msg = `${msgHeader} ${coin} 수익금 ${Math.round(수익금 * 100) / 100}원, (${수익률}%)`;

  exceptionCoins.push(coin);
  const minutes = bunbong * 2 * 60 * 1000; // 분봉2배만큼
  setTimeout(() => {
    const idx = exceptionCoins.indexOf(coin);
    exceptionCoins.splice(idx, 1);
  }, minutes);

  logger.info(msg);
  sayBot(msg);

  db.get('orders').remove({ name: coin }).write();

  const day = moment().format('YYYYMMDD');
  let history = db.get('history').find({ day }).value();
  if (!history) {
    db.get('history')
      .push({
        day,
        buy: 0,
        sell: 0,
        profit: 0,
      })
      .write();
  }
  history = db.get('history').find({ day }).value();
  const { buy, sell, profit } = db.get('history').find({ day }).value();
  const item = {
    day,
    buy: buy + 내가산금액,
    sell: sell + 내가판금액,
    profit: profit + 수익금,
  };
  db.get('history').find({ day }).assign(item).write();
  sayBot(`${getProfit()}`);
};

const main = async () => {
  if (!isWorking) return;
  account = await upbit.updateAccount();
  // 보유코인
  let coins = Object.keys(account).filter((c) => c !== 'KRW');
  targetCoins = [...coins];
  // 손절테이블 내용 맞추기
  const lossItems = db
    .get('orders')
    .value()
    .map((row) => row.name);
  for (let i = 0; i < lossItems.length; i++) {
    const item = lossItems[i];
    if (!coins.includes(item)) {
      // 내 계정에 없으면 삭제
      db.get('orders').remove({ name: item }).write();
    }
  }

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
  await util.delay(1000);

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
        await util.delay();
        await sellCoin(coin, ticker, '매도');
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
          await sellCoin(coin, ticker, '손절가 매도');
        }
      }
    } else {
      // 매수 체크
      // 1. DOWN - DOWN - UP - UP 일 경우 산다
      if (heikin[0].change === 'DOWN' && heikin[1].change === 'DOWN' && heikin[2].change === 'UP' && heikin[3].change === 'UP') {
        console.log('매수', coin);
        const currentCoinTick = await upbit.getTicker(`KRW-${coin}`);
        await util.delay();
        const orderResponse = await upbit.order('BUY', account, currentCoinTick, pricePerCoin);
        await util.delay();
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

        // 매수 주문을 걸었는데 바로 코인이 결제가 안되는 경우
        exceptionCoins.push(coin);
        const minutes = 5 * 60 * 1000; // 5분동안 재구매 금지
        setTimeout(() => {
          const idx = exceptionCoins.indexOf(coin);
          exceptionCoins.splice(idx, 1);
        }, minutes);
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
  logger.info(`RUN STATUS ${isWorking} ${fireDate}`);
  main().catch((err) => {
    logger.error(err);
    sayBot(`에러\n${JSON.stringify(err, null, 2)}`);
  });
});
