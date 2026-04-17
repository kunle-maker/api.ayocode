require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const keyRoutes = require('./routes/keys');
const chatRoutes = require('./routes/chat');

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

app.use('/v1/chat', chatRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/keys', keyRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AyoCode API running on port ${PORT}`);
});