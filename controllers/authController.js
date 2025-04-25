// Arquivo: controllers/authController.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { clearCacheForUser } = require('../helpers/keyHelper');
require('dotenv').config();

// Função para registrar um novo usuário
const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    // Verificar se o usuário já existe
    const userExists = await pool.query('SELECT * FROM "user" WHERE email = $1', [email]);
    
    if (userExists.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'Email já registrado' });
    }
    
    // Criptografar a senha
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Inserir novo usuário no banco de dados
    const newUser = await pool.query(
      'INSERT INTO "user" (name, email, password) VALUES ($1, $2, $3) RETURNING id_user, name, email',
      [name, email, hashedPassword]
    );
    
    res.status(201).json({
      success: true,
      message: 'Usuário registrado com sucesso!',
      user: {
        id: newUser.rows[0].id_user,
        name: newUser.rows[0].name,
        email: newUser.rows[0].email
      }
    });
  } catch (error) {
    console.error('Erro ao registrar usuário:', error);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
};

// Função para login
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Buscar usuário pelo email
    const result = await pool.query('SELECT * FROM "user" WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'Email ou senha incorretos' });
    }
    
    const user = result.rows[0];
    
    // Verificar se a senha está correta
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(400).json({ success: false, message: 'Email ou senha incorretos' });
    }
    
    // Criar e atribuir um token JWT
    const token = jwt.sign(
      { id: user.id_user, email: user.email },
      process.env.JWT_SECRET || 'seu_segredo_jwt',
      { expiresIn: '1h' }
    );
    
    // Configurar o cookie
    res.cookie('jwt', token, {
      httpOnly: true,
      maxAge: 3600000, // 1 hora em milissegundos
      // Em produção, adicione: secure: true (para HTTPS apenas)
    });
    
    res.status(200).json({
      success: true,
      message: 'Login realizado com sucesso!',
      user: {
        id: user.id_user,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Erro ao fazer login:', error);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
};

// Função para obter dados do perfil
const getUserProfile = async (req, res) => {
  try {
    // Buscar dados do usuário no banco
    const result = await pool.query('SELECT id_user, name, email, created_at FROM "user" WHERE id_user = $1', [req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    }
    
    const user = result.rows[0];
    
    res.status(200).json({
      success: true,
      message: 'Dados do perfil recuperados com sucesso',
      user
    });
  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
};

// Função para logout
const logoutUser = (req, res) => {
  const id_user = req.user?.id;
  if (id_user) clearCacheForUser(id_user);

  res.clearCookie('jwt');
  res.status(200).json({ success: true, message: 'Logout realizado com sucesso' });
};

module.exports = {
  registerUser,
  loginUser,
  getUserProfile,
  logoutUser
};