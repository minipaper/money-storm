import 'babel-polyfill'; // mocha에서 async await 지원
import assert from 'assert';
import upbit from '../src/services/upbit';
import util from '../src/services/util';

describe('UPBIT', () => {
  let account = null;
  it.skip('계좌조회', async () => {
    account = await upbit.updateAccount();
    console.log(account);
    assert.notStrictEqual(account, null);
  });

  it.skip('총매수 금액', () => {
    const coins = Object.keys(account).filter((c) => c !== 'KRW');
    console.log(coins);
    const 총매수 = coins
      .map((c) => {
        const { balance, avg_buy_price } = account[c];
        return balance * avg_buy_price;
      })
      .reduce((a, b) => a + b, 0);
    console.log(`총매수 ${총매수}`);
  });

  it.skip('업비트에서 거래 가능한 마켓 목록', function (done) {
    this.timeout(2000);
    upbit.getMarkets().then((data) => {
      console.log(data.map((m) => m.korean_name).join(', '));
      // console.info(data);
      done();
    });
  });

  it.skip('추천 코인 찾기', async () => {
    const markets = await upbit.getMarkets();

    const limit = 3; // 3개 찾기
    const result = [];
    for (let i = 0; i < markets.length; i++) {
      if (result.length >= limit) {
        console.log('코인 찾기 종료');
        break;
      }
      const m = markets[i];
      // console.log(`체크중 ${m.korean_name} 찾은 개수 ${result.length}`);
      const hours = await upbit.getHeikinAshi(60, m.market, 3);
      if (hours[0] === 'DOWN' && hours[1] === 'UP' && hours[2] === 'UP') {
        // console.log(`60 mininutes Pass ${m.korean_name}`);
        const thirty = await upbit.getHeikinAshi(15, m.market, 3);
        if (thirty[0] === 'DOWN' && thirty[1] === 'UP' && thirty[2] === 'UP') {
          // console.log(`30 mininutes Pass ${m.korean_name}`);
          result.push(m);
        }
      } else {
        console.log(`SKIP ${m.korean_name}`);
      }
      await util.delay(100); // upbit request timeout
    }
    console.log(`추천 코인 ${result.map((m) => m.korean_name).join(', ')}`);
  }).timeout(120 * 1000);

  it.skip('현재 수익금', async () => {
    const account = await upbit.updateAccount();
    const coins = Object.keys(account).filter((c) => c !== 'KRW');
    if (coins.length === 0) {
      console.log(`소유한 코인이 없습니다.`);
      return;
    }
    const snapshot = await upbit.getTickers(coins.map((coin) => `KRW-${coin}`));
    console.log(snapshot);
    let sum = 0;
    for (let i = 0; i < coins.length; i++) {
      const coin = coins[i];
      const { balance, avg_buy_price } = account[coin];
      const ticker = snapshot.find((m) => m.market === `KRW-${coin}`);

      const result = balance * ticker.trade_price - balance * avg_buy_price;
      console.log(`수익금 ${coin} : ${result}`);
      sum += result;
    }
    console.log(`총 수익금 ${util.addComma(sum)}원`);
  });

  it('추천코인찾기', async () => {
    const exceptCoin = []; //['QTUM', 'BTT'];
    const market = await upbit.recommendCoins(5, exceptCoin, true);
    if (market.length === 0) {
      console.log('추천할 코인이 없습니다.');
    }
    console.log(market.map((m) => `${m.korean_name}(${m.market})`).join(', '));
  }).timeout(60 * 1000);

  it.skip('거래량 100만이상 코인', async () => {
    const market = await upbit.getTickers(['KRW-MFT']);
    console.log(market);
  });

  it.skip('채결강도', async () => {
    // const market = await upbit.getTickers(['KRW-MANA']);
    // console.log(market);
  });
});
