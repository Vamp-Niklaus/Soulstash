const { MongoClient, ObjectId } = require('mongodb');

(async () => {
  const client = new MongoClient('mongodb+srv://soulstash:yX08qX277Jp8qC8u@cluster0.3x1g2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0');
  await client.connect();
  const db = client.db('tmdb'); // or whatever DB Soulstash uses
  const coll = db.collection('Users'); // Actually, what is the collection name?
  
  console.log('Connected');
  await client.close();
})();
