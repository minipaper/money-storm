import http from '../config/http';
import { logger } from '../config/winston';

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
 */
const order = (orderType, account, targetTick) => {
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
    const orderMoney = Math.floor(account['KRW'].balance);
    params.volume = (orderMoney / params.price).toFixed(8); // 주문량
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
  getCandlesMinutes,
  getTicker,
  getTickers,
  ordersChance,
  order,
};
