export const addComma = (x) => {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

export const delay = (milliseconds = 200) => {
  return new Promise((resolve) => setTimeout(() => resolve(), milliseconds));
};

export const getPercentBalance = (balance, percent) => {
  return balance * ((100 + percent) / 100);
};

export const printCash = (cash) => {
  return addComma(Math.round(cash * 100) / 100);
};

export default {
  addComma,
  delay,
  getPercentBalance,
  printCash,
};
