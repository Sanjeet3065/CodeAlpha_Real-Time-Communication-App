import mongoose from 'mongoose';

async function inspectDb() {
  await mongoose.connect('mongodb://127.0.0.1:27017/connectly');
  const collections = await mongoose.connection.db.listCollections().toArray();
  console.log('Collections in connectly:');
  for (const col of collections) {
    const count = await mongoose.connection.db.collection(col.name).countDocuments();
    const indexes = await mongoose.connection.db.collection(col.name).indexes();
    console.log(`- ${col.name}: ${count} document(s)`);
    for (const idx of indexes) {
      console.log(`    index: ${JSON.stringify(idx.key)} unique=${!!idx.unique} name=${idx.name}`);
    }
  }
  await mongoose.disconnect();
}

inspectDb().catch(console.error);
