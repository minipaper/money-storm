// 토큰발급 데모
import dotenv from 'dotenv'; // .env 환경변수 설정
import { sign } from 'jsonwebtoken';// const jwt = require("jsonwebtoken");
import { v4 as uuidv4 } from 'uuid'; // const uuidv4 = require("uuid/v4");
// import qs from 'qs'; // 파라미터 전달 용
import axios from 'axios';

dotenv.config(); // 환경변수 import

const accessKey = process.env.UPBIT_OPEN_API_ACCESS_KEY;
const secretKey = process.env.UPBIT_OPEN_API_SECRET_KEY;
const serverUrl = process.env.UPBIT_OPEN_API_SERVER_URL;


const payload = {
  access_key: accessKey,
  nonce: uuidv4(),
};

const token = sign(payload, secretKey);
const authorizationToken = `Bearer ${token}`;

axios.defaults.baseURL = serverUrl;
axios.defaults.headers.common['Authorization'] = authorizationToken;

axios.get('/v1/accounts').then(({ data }) => {
  console.info('계좌정보', data)
})
