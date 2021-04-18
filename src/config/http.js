import env from './env';
import axios from 'axios';
import Qs from 'qs';
import { v4 as uuidv4 } from 'uuid';
import { sign } from 'jsonwebtoken';
import crypto from 'crypto';
import querystring from 'querystring';

const { accessKey, secretKey, serverUrl } = env;

const payload = {
  access_key: accessKey,
  nonce: uuidv4(),
};

const token = sign(payload, secretKey);
const authorizationToken = `Bearer ${token}`;

const instance = axios.create({
  baseURL: serverUrl,
  timeout: 1000,
  headers: { Authorization: authorizationToken },
  paramsSerializer: (params) => Qs.stringify(params, { arrayFormat: 'brackets' }),
});

instance.interceptors.request.use((config) => {
  const { params, data } = config;
  if (params || data) {
    const query = querystring.encode(params || data);
    const hash = crypto.createHash('sha512');
    const queryHash = hash.update(query, 'utf-8').digest('hex');
    const payload = {
      access_key: accessKey,
      nonce: uuidv4(),
      query_hash: queryHash,
      query_hash_alg: 'SHA512',
    };
    const jwtToken = sign(payload, secretKey);
    config.headers.Authorization = `Bearer ${jwtToken}`;
  }
  return config;
});

instance.interceptors.response.use((response) => {
  // 응답받은 후 추가 처리 필요하면 작업
  return response;
});

export default instance;
