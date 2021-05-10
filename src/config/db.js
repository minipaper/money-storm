import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync';

const db = low(new FileSync('db.json'));
const init = {
  orders: [],
};

db.defaults(init).write();

export default db;
