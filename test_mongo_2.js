const { MongoClient } = require('mongodb');
(async () => {
  const client = new MongoClient('mongodb://127.0.0.1:27017');
  await client.connect();
  const db = client.db('test_db_delete');
  const coll = db.collection('test_coll_delete');
  await coll.deleteMany({});
  await coll.insertOne({ username: 'testuser', collections: [{_id: 'a', name: 'col_a'}], collectionVersion: 1 });
  let latest = await coll.findOneAndUpdate(
    { username: 'testuser' },
    { $pull: { collections: { _id: 'a' } }, $inc: { collectionVersion: 1 } },
    { returnDocument: 'after' }
  );
  console.log('latest 1 keys:', Object.keys(latest));
  latest = await coll.findOneAndUpdate(
    { username: 'testuser' },
    { $pull: { collections: { name: 'a' } }, $inc: { collectionVersion: 1 } },
    { returnDocument: 'after' }
  );
  console.log('latest 2 keys:', Object.keys(latest));
  console.log('latest 2 collections:', latest.collections);
  await client.close();
})();
