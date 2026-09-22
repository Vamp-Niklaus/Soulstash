const { MongoClient } = require('mongodb');
(async () => {
  const client = new MongoClient('mongodb://127.0.0.1:27017');
  await client.connect();
  const db = client.db('test');
  const coll = db.collection('test_coll');
  await coll.insertOne({ username: 'testuser', collections: [] });
  const latest = await coll.findOneAndUpdate(
    { username: 'testuser' },
    { $inc: { collectionVersion: 1 } },
    { returnDocument: 'after' }
  );
  console.log('Keys in returned object:', Object.keys(latest));
  console.log('Is value inside?', !!latest.value);
  await client.close();
})();
