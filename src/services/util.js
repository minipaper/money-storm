export const addComma = (x, fractionDigits = 2) => {
  let n = (x * 1).toFixed(fractionDigits) * 1; // 소수점 두자리
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};
