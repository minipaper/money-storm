export const addComma = (x, fractionDigits = 0) => {
  let n = (x * 1).toFixed(fractionDigits); // 소수점 두자리
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};
