import path from 'path';
import dotenv from 'dotenv'; // .env 환경변수 설정

if (process.env.NODE_ENV) {
  dotenv.config({
    path: path.join(__dirname, `../../.env.${process.env.NODE_ENV}`),
  });
} else {
  dotenv.config(); // 환경변수 import
}

const accessKey = process.env.UPBIT_OPEN_API_ACCESS_KEY;
const secretKey = process.env.UPBIT_OPEN_API_SECRET_KEY;
const serverUrl = process.env.UPBIT_OPEN_API_SERVER_URL;

export default {
  accessKey,
  secretKey,
  serverUrl,
};
