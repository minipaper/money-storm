import http from '../config/http';
import { logger } from '../config/winston';
import HeikinAshi from 'heikinashi';
import util from './util';

// 금액에 따른 틱당 금액
const tickInfo = [
  { start: 2000000, end: 9999999999999, step: 1000 },
  { start: 1000000, end: 2000000, step: 500 },
  { start: 500000, end: 1000000, step: 100 },
  { start: 100000, end: 500000, step: 50 },
  { start: 10000, end: 100000, step: 10 },
  { start: 1000, end: 10000, step: 5 },
  { start: 100, end: 1000, step: 1 },
  { start: 10, end: 100, step: 0.1 },
  { start: 0, end: 10, step: 0.01 },
];
/**
 * 계정 업데이트
 */
const updateAccount = () => {
  return new Promise((resolve, reject) => {
    http
      .get('/v1/accounts')
      .then(({ data }) => {
        const accounts = {};
        data.forEach((item) => {
          accounts[item.currency] = item;
        });
        resolve(accounts);
      })
      .catch((err) => reject(err));
  });
};

/**
 업비트에서 거래 가능한 마켓 목록(원화마켓만)
 */
const getMarkets = () => {
  return new Promise((resolve) => {
    http.get(`/v1/market/all?isDetails=true`).then(({ data }) => {
      const markets = data.filter((m) => m.market.includes('KRW-') && m.market_warning === 'NONE');
      resolve(markets);
    });
  });
};
/**
 * 추천 코인목록
 * @param cnt 추천 최대 개수
 * @param exceptCoin 예외코인 ['BTC', 'ABC']
 * @param checkSecondCandle 두번째 봉까지 확인
 */
const recommendCoins = async (cnt = 1, exceptCoin = [], checkSecondCandle = true) => {
  // 거래하고 있는 모든 코인 조회
  let markets = await getMarkets();

  // 예외하고 싶은 코인
  if (exceptCoin.length > 0) {
    markets = markets.filter((m) => {
      if (exceptCoin.includes(m.market.replace('KRW-', ''))) {
        return false;
      }
      return true;
    });
  }
  let result = [];
  for (let i = 0; i < markets.length; i++) {
    // 1.5배수까지 추천항목받음
    if (result.length >= cnt * 1.5) {
      break;
    }
    const m = markets[i];
    const hours = await getHeikinAshi(60, m.market, 3);
    if (hours[0] === 'DOWN' && hours[1] === 'UP' && hours[2] === 'UP') {
      if (!checkSecondCandle) {
        m.ticker = await getTicker(m.market);
        result.push(m);
        continue;
      }
      // const thirty = await getHeikinAshi(15, m.market, 3);
      // if (thirty[0] === 'DOWN' && thirty[1] === 'UP' && thirty[2] === 'UP') {
      //   m.ticker = await getTicker(m.market);
      //   result.push(m);
      // }

      const minute = await getHeikinAshi(1, m.market, 2);
      if (minute[0] === 'UP' && minute[1] === 'UP') {
        m.ticker = await getTicker(m.market);
        result.push(m);
      }
    }
    await util.delay(100); // upbit request timeout
  }

  // order by 거래량 높은순
  result.sort((m1, m2) => {
    return m2.ticker.acc_trade_price_24h - m1.ticker.acc_trade_price_24h;
  });

  if (result.length > cnt) {
    result.length = cnt;
  }

  return result;
};

/**
 * 분 캔들 조회
 * @param unit {number}분 단위. 가능한 값 : 1, 3, 5, 15, 10, 30, 60, 240
 * @param market {string} 마켓 코드 (ex. KRW-BTC)
 * @param count {number}캔들 개수(최대 200개까지 요청 가능)
 */
const getCandlesMinutes = (unit = 5, market, count) => {
  const params = {
    market,
    count,
  };
  return http.get(`/v1/candles/minutes/${unit}`, { params }).then(({ data }) => data);
};

const getHeikinAshi = (unit, market, cnt) => {
  return new Promise((resolve) => {
    getCandlesMinutes(unit, market, 200).then((candles) => {
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
      items.splice(0, items.length - cnt);
      resolve(items.map((item) => item.change));
    });
  });
};

/**
 * 현재가 정보
 * @param markets {array} 반점으로 구분되는 마켓 코드 (ex. KRW-BTC, BTC-BCC)
 */
const getTickers = (markets = []) => {
  return http.get('/v1/ticker', { params: { markets: markets.join(',') } }).then(({ data }) => data);
};

const getTicker = (market = '') => {
  return getTickers([market]).then((data) => data[0]);
};
/**
 * 주문 가능 정보
 마켓별 주문 가능 정보를 확인한다.
 * @param market
 */
const ordersChance = (market) => {
  const params = {
    market,
  };
  return http.get(`/v1/order/chance?market=${market}`, { params }).then(({ data }) => data);
};
/**
 *
 * @param orderType
 * @param account
 * @param targetTick
 * @param orderMoney {number} 주문할 금액, 값이 없으면 현금보유 모두 구매
 */
const order = (orderType, account, targetTick, orderMoney = 0) => {
  const currentPrice = targetTick['trade_price'];
  // 시장가는 위험하니 1틱 차이로 매매
  const roughTickPrice =
    tickInfo.filter((obj) => {
      return obj.start <= currentPrice && obj.end > currentPrice;
    })[0].step * 1;

  const params = {
    market: targetTick.market,
    side: 'bid', // bid : 매수 / ask : 매도
    volume: '0', // 주문량 (지정가, 시장가 매도 시 필수)
    price: '0', // 주문 가격. (지정가, 시장가 매수 시 필수)
    ord_type: 'limit', // limit : 지정가 주문 / price : 시장가 주문(매수) / market : 시장가 주문(매도)
  };

  if (orderType === 'BUY') {
    // 매수
    params.side = 'bid';
    params.price = (currentPrice + roughTickPrice).toFixed(2);
    let balance = Math.floor(account['KRW'].balance);
    if (orderMoney !== 0) {
      balance = orderMoney;
    }
    // 수수료
    balance = Math.floor(balance * (1 - 0.0005));
    // const orderMoney = Math.floor(account['KRW'].balance);
    params.volume = (balance / params.price).toFixed(8); // 주문량
  } else {
    // 매도
    params.side = 'ask';
    params.price = currentPrice - roughTickPrice;
    const market = targetTick.market.replace('KRW-', '');
    params.volume = account[market].balance;
  }

  logger.info(`주문 파라미터 ${JSON.stringify(params)}`);

  return http.post('/v1/orders', params).then(({ data }) => data);
};

export default {
  updateAccount,
  getMarkets,
  recommendCoins,
  getCandlesMinutes,
  getHeikinAshi,
  getTicker,
  getTickers,
  ordersChance,
  order,
};
