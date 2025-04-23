// app.js
const express = require('express');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const path = require('path');
const { testConnection } = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const { authenticatePageAccess } = require('./middleware/authMiddleware');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware para processar JSON, formulários e cookies
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Rotas da API
app.use('/api', authRoutes);

// Proteger páginas que requerem autenticação
app.get('/profile.html', authenticatePageAccess, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// Página inicial
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar o servidor
app.listen(port, async () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
  
  // Testar conexão com o banco de dados
  await testConnection();
});

module.exports = app;