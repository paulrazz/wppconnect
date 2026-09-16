const DB = require('./server/lib/db');
(async () => {
  try {
    const res = await DB.all("SELECT json_extract('{\"a\": 1}', '$.a') as val");
    console.log(res);
  } catch (e) {
    console.error(e);
  }
})();
