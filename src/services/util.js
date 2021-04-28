export const addComma = (x) => {
  return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

export const delay = (milliseconds) => {
  return new Promise((resolve) => setTimeout(() => resolve(), milliseconds));
};
