require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const keyRoutes = require('./routes/keys');
const chatRoutes = require('./routes/chat');
const db_url = "mongodb+srv://ayocode_admin:sYa.85EMSf%25myex@ayocode-cluster.uijpz1t.mongodb.net/ayocode?retryWrites=true&w=majority&appName=ayocode-cluster" 
const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(db_url)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

app.use('/v1/chat', chatRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/keys', keyRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AyoCode API running on port ${PORT}`);
});