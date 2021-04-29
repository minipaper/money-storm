export const addComma = (x) => {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

export const delay = (milliseconds) => {
  return new Promise((resolve) => setTimeout(() => resolve(), milliseconds));
};

export const getPercentBalance = (balance, percent) => {
  return balance * ((100 + percent) / 100);
};

export default {
  addComma,
  delay,
  getPercentBalance,
};
