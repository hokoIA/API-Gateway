// app.js

const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const path = require('path');
const dotenv = require('dotenv');

const { testConnection } = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const customerRoutes = require('./routes/customerRoutes');
const metricsRoutes = require('./routes/metricsRoutes'); // ✅ Importa rota de métricas

const { authenticatePageAccess } = require('./middleware/authMiddleware');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// Arquivos estáticos
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// === Rotas da API ===
app.use('/api', authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/metrics', metricsRoutes);

// === Páginas protegidas ===
app.get('/dashboardPage.html', authenticatePageAccess, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboardPage.html'));
});

app.get('/profile.html', authenticatePageAccess, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// === Páginas públicas ===
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === Inicialização do servidor ===
app.listen(port, async () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
  await testConnection(); // Verifica conexão com o banco ao iniciar
});

module.exports = app;
