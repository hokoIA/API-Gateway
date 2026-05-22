// Arquivo: controllers/authController.js
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { pool } = require('../config/db');
const { clearCacheForUser } = require('../helpers/keyHelper');
const { s3, BUCKET_NAME } = require('../config/s3Config');
const {
  getJwtCookieOptions,
  getJwtClearCookieOptions
} = require('../config/security');
const { FRONTEND_BASE_URL, FRONTEND_PATHS, buildFrontendUrl } = require('../config/urls');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Função para registrar um novo usuário
const registerUser = async (req, res) => {
  const client = await pool.connect();

  try {
    const { name, email, password } = req.body;

    const mailer = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    // Verificar se o usuário já existe
    const userExists = await client.query(
      'SELECT id_user, email_verified, name FROM "user" WHERE lower(email) = lower($1)',
      [email]
    );

    if (userExists.rows.length > 0) {
      const existing = userExists.rows[0];

      if (existing.email_verified) {
        return res.status(400).json({
          success: false,
          message: 'Email já registrado'
        });
      }

      // Reenvia verificação para cadastro pendente
      await client.query(
        'UPDATE email_verification_tokens SET used = TRUE WHERE user_id = $1',
        [existing.id_user]
      );

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await client.query(
        `INSERT INTO email_verification_tokens (user_id, token, expires_at)
         VALUES ($1, $2, $3)`,
        [existing.id_user, token, expiresAt]
      );

      const baseUrl = FRONTEND_BASE_URL;
      const verifyLink = `${baseUrl}/verify-email?token=${token}`;

      await mailer.sendMail({
        from: process.env.SMTP_USER,
        to: email,
        subject: 'Confirme seu email - ho.ko AI.nalytics',
        html: `
          <p>Olá, ${existing.name || name}!</p>
          <p>Você já tinha um cadastro pendente na ho.ko AI.nalytics.</p>
          <p>Reenviamos o link para confirmação do seu email:</p>
          <p><a href="${verifyLink}">${verifyLink}</a></p>
          <p>Este novo link é válido por 24 horas.</p>
        `
      });

      return res.json({
        success: true,
        message: 'Você já tinha um cadastro pendente. Reenviamos o link de confirmação para seu email.'
      });
    }

    await client.query('BEGIN');

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 1) cria account
    const accountResult = await client.query(
      `
      INSERT INTO accounts (name, status, created_at, updated_at)
      VALUES ($1, 'active', now(), now())
      RETURNING id_account
      `,
      [name]
    );

    const id_account = accountResult.rows[0].id_account;

    // 2) cria user vinculado à account
    const newUser = await client.query(
      `
      INSERT INTO "user" (name, email, password, email_verified, id_account)
      VALUES ($1, $2, $3, FALSE, $4)
      RETURNING id_user, name, email
      `,
      [name, email, hashedPassword, id_account]
    );

    const userId = newUser.rows[0].id_user;

    // 3) cria roles Admin e Equipe
    const adminRoleResult = await client.query(
      `
      INSERT INTO roles (id_account, name, is_system, created_at)
      VALUES ($1, 'Admin', true, now())
      RETURNING id_role
      `,
      [id_account]
    );

    const equipeRoleResult = await client.query(
      `
      INSERT INTO roles (id_account, name, is_system, created_at)
      VALUES ($1, 'Equipe', true, now())
      RETURNING id_role
      `,
      [id_account]
    );

    const adminRoleId = adminRoleResult.rows[0].id_role;
    const equipeRoleId = equipeRoleResult.rows[0].id_role;

    // 4) associa permissions
    await client.query(
      `
      INSERT INTO role_permissions (id_role, id_permission)
      SELECT $1, id_permission
      FROM permissions
      ON CONFLICT DO NOTHING
      `,
      [adminRoleId]
    );

    await client.query(
      `
      INSERT INTO role_permissions (id_role, id_permission)
      SELECT $1, id_permission
      FROM permissions
      WHERE lower(code) IN (
        'page:dashboard:view',
        'page:analyses:view',
        'page:customers:view',
        'page:chat:view',
        'customers:manage',
        'analyses:run'
      )
      ON CONFLICT DO NOTHING
      `,
      [equipeRoleId]
    );

    // 5) cria team_member do próprio dono da conta
    const teamMemberResult = await client.query(
      `
      INSERT INTO team_members (id_account, id_user, status, joined_at, created_at)
      VALUES ($1, $2, 'active', now(), now())
      RETURNING id_team_member
      `,
      [id_account, userId]
    );

    const id_team_member = teamMemberResult.rows[0].id_team_member;

    // 6) vincula como Admin
    await client.query(
      `
      INSERT INTO member_roles (id_team_member, id_role)
      VALUES ($1, $2)
      `,
      [id_team_member, adminRoleId]
    );

    // 7) token de verificação de email
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await client.query(
      `
      INSERT INTO email_verification_tokens (user_id, token, expires_at)
      VALUES ($1, $2, $3)
      `,
      [userId, token, expiresAt]
    );

    await client.query('COMMIT');

    const baseUrl = FRONTEND_BASE_URL;
    const verifyLink = `${baseUrl}/verify-email?token=${token}`;

    await mailer.sendMail({
      from: process.env.SMTP_USER,
      to: email,
      subject: 'Confirme seu email - ho.ko AI.nalytics',
      html: `
        <p>Olá, ${name}!</p>
        <p>Obrigado por se cadastrar na ho.ko AI.nalytics.</p>
        <p>Para ativar sua conta, clique no link abaixo:</p>
        <p><a href="${verifyLink}">${verifyLink}</a></p>
        <p>Este link é válido por 24 horas.</p>
      `
    });

    return res.status(201).json({
      success: true,
      message: 'Conta criada! Verifique seu email para ativar o acesso.',
      user: {
        id: userId,
        name: newUser.rows[0].name,
        email: newUser.rows[0].email
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao registrar usuário:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  } finally {
    client.release();
  }
};

const verifyEmail = async (req, res) => {
  try {
    const { token, format } = req.query;
    const shouldReturnJson = format === 'json';

    if (!token) {
      if (shouldReturnJson) {
        return res.status(400).json({
          success: false,
          message: 'Token de verificação inválido.'
        });
      }
      return res.status(400).send('Token de verificação inválido.');
    }

    const result = await pool.query(
      `SELECT * FROM email_verification_tokens 
       WHERE token = $1 AND used = FALSE`,
      [token]
    );

    if (result.rows.length === 0) {
      if (shouldReturnJson) {
        return res.status(400).json({
          success: false,
          message: 'Link de verificação inválido ou já utilizado.'
        });
      }
      return res.status(400).send('Link de verificação inválido ou já utilizado.');
    }

    const row = result.rows[0];

    if (new Date() > row.expires_at) {
      if (shouldReturnJson) {
        return res.status(400).json({
          success: false,
          message: 'Link de verificação expirado. Faça um novo cadastro.'
        });
      }
      return res.status(400).send('Link de verificação expirado. Faça um novo cadastro.');
    }

    // Marca email como verificado
    await pool.query(
      `UPDATE "user" SET email_verified = TRUE WHERE id_user = $1`,
      [row.user_id]
    );

    // Marca token como usado
    await pool.query(
      `UPDATE email_verification_tokens SET used = TRUE WHERE id = $1`,
      [row.id]
    );

    if (shouldReturnJson) {
      return res.status(200).json({
        success: true,
        message: 'E-mail confirmado com sucesso. Agora você pode entrar.'
      });
    }

    // Redireciona para login no frontend atual.
    return res.redirect(`${FRONTEND_BASE_URL}/login?verified=1`);
  } catch (error) {
    console.error('Erro ao verificar email:', error);
    if (req.query.format === 'json') {
      return res.status(500).json({
        success: false,
        message: 'Erro interno ao verificar email.'
      });
    }
    return res.status(500).send('Erro interno ao verificar email.');
  }
};

// Função para login
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Buscar usuário pelo email
    const result = await pool.query('SELECT * FROM "user" WHERE email = $1', [email]);

    if (result.rows.length === 0) return res.status(400).json({ success: false, message: 'Email ou senha incorretos' });

    const user = result.rows[0];

    // Verificar se email foi confirmado
    if (!user.email_verified) {
      return res.status(403).json({
        success: false,
        message: 'Confirme seu email antes de fazer login. Verifique sua caixa de entrada.'
      });
    }

    // Verificar se a senha está correta
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) return res.status(400).json({ success: false, message: 'Email ou senha incorretos' });

    // ====== RBAC context (Account + Team Member + Role) ======
    const tmResult = await pool.query(
      `
        SELECT tm.id_team_member, tm.status, r.name AS role_name
        FROM team_members tm
        JOIN member_roles mr ON mr.id_team_member = tm.id_team_member
        JOIN roles r ON r.id_role = mr.id_role
        WHERE tm.id_user = $1 AND tm.id_account = $2
        LIMIT 1
      `,
      [user.id_user, user.id_account]
    );

    if (tmResult.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: 'Seu acesso não está vinculado a nenhuma conta. Contate o suporte.'
      });
    }

    const teamMember = tmResult.rows[0];

    if (teamMember.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Seu acesso está desativado. Contate o administrador da conta.'
      });
    }

    const tokenPayload = {
      id: user.id_user,               // mantém compatibilidade com req.user.id
      email: user.email,
      id_account: user.id_account,
      id_team_member: teamMember.id_team_member,
      role: teamMember.role_name      // "Admin" ou "Equipe"
    };

    // Criar e atribuir um token JWT
    const token = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET || 'seu_segredo_jwt',
      { expiresIn: '1h' }
    );

    // Configurar o cookie
    res.cookie('jwt', token, getJwtCookieOptions(req));

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

// Função para trocar senha com token
const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // Verifica token
    const tokenQuery = await pool.query(
      `SELECT * FROM password_reset_tokens 
       WHERE token = $1 AND used = FALSE`,
      [token]
    );

    if (tokenQuery.rows.length === 0) return res.status(400).json({ success: false, message: "Token inválido" });

    const row = tokenQuery.rows[0];

    if (new Date() > row.expires_at) return res.status(400).json({ success: false, message: "Token expirado" });

    // Atualiza senha
    const hash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `UPDATE "user" SET password = $1 WHERE email = $2`,
      [hash, row.email]
    );

    // Marca token como usado
    await pool.query(
      `UPDATE password_reset_tokens SET used = TRUE WHERE token = $1`,
      [token]
    );

    res.json({ success: true, message: "Senha alterada com sucesso!" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Erro ao alterar senha" });
  }
};

// Função para enviar email com link
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Verifica se usuario existe
    const userQuery = await pool.query(
      'SELECT id_user FROM "user" WHERE email = $1',
      [email]
    );

    if (userQuery.rows.length === 0) return res.status(400).json({ success: false, message: "Email não encontrado" });

    // Gera token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    // Salva token
    await pool.query(
      `INSERT INTO password_reset_tokens (email, token, expires_at)
       VALUES ($1, $2, $3)`,
      [email, token, expiresAt]
    );

    // URL do reset
    const resetLink = buildFrontendUrl(FRONTEND_PATHS.resetPassword, { token });

    // Envio de email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: email,
      subject: "Recuperação de senha",
      html: `
        <p>Você solicitou a recuperação de senha.</p>
        <p>Clique no link abaixo para redefinir sua senha:</p>
        <a href="${resetLink}">${resetLink}</a>
        <p>Este link expira em 1 hora.</p>
      `
    });

    res.json({ success: true, message: "Email enviado!" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Erro ao enviar email" });
  }
};

// Função para obter dados do perfil
const getUserProfile = async (req, res) => {
  try {
    // Buscar dados do usuário no banco
    const result = await pool.query('SELECT id_user, name, email, created_at, foto_perfil FROM "user" WHERE id_user = $1', [req.user.id]);

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

  res.clearCookie('jwt', getJwtClearCookieOptions(req));
  res.status(200).json({ success: true, message: 'Logout realizado com sucesso' });
};

const checkAuthStatus = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(200).json({
        success: false,
        authenticated: false,
        message: 'Usuário não está logado'
      });
    }

    // Buscar dados atualizados do usuário no banco
    const result = await pool.query('SELECT id_user, name, email, id_account FROM "user" WHERE id_user = $1', [req.user.id]);

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: false,
        authenticated: false,
        message: 'Usuário não encontrado'
      });
    }

    const user = result.rows[0];

    res.status(200).json({
      success: true,
      authenticated: true,
      message: 'Usuário está logado',
      user: {
        id: user.id_user,
        name: user.name,
        email: user.email,
        id_account: user.id_account,
        role: req.user.role
      }
    });
  } catch (error) {
    console.error('Erro ao verificar status de autenticação:', error);
    res.status(500).json({
      success: false,
      authenticated: false,
      message: 'Erro interno do servidor'
    });
  }
};

const addAvatarProfileBucket = async (req, res) => {
  try {
    // Verifica se um arquivo foi enviado
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Nenhum arquivo de imagem foi enviado'
      });
    }

    // URL da imagem no S3
    const imageUrl = req.file.location;

    // Opcional: Deletar avatar antigo se existir
    try {
      const userResult = await pool.query('SELECT foto_perfil FROM "user" WHERE id_user = $1', [req.user.id]);

      if (userResult.rows.length > 0 && userResult.rows[0].foto_perfil) {
        const oldImageUrl = userResult.rows[0].foto_perfil;

        // Extrair a chave (nome do arquivo) da URL antiga
        if (oldImageUrl.includes(BUCKET_NAME)) {
          const oldKey = oldImageUrl.split('/').pop();

          // Deletar arquivo antigo do S3
          await s3.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: oldKey
          }));
        }
      }
    } catch (deleteError) {
      console.warn('Erro ao deletar imagem anterior:', deleteError);
      // Não interrompe o processo se não conseguir deletar a imagem antiga
    }

    // Atualizar URL da foto no banco de dados
    const updateResult = await pool.query(
      'UPDATE "user" SET foto_perfil = $1 WHERE id_user = $2 RETURNING id_user, name, email, foto_perfil',
      [imageUrl, req.user.id]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Avatar enviado com sucesso!',
      url: imageUrl,
      user: updateResult.rows[0]
    });

  } catch (error) {
    console.error('Erro ao fazer upload do avatar:', error);

    // Se houve erro, tenta deletar o arquivo que foi enviado
    if (req.file && req.file.key) {
      try {
        await s3.deleteObject({
          Bucket: BUCKET_NAME,
          Key: req.file.key
        }).promise();
      } catch (deleteError) {
        console.error('Erro ao deletar arquivo após falha:', deleteError);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor ao fazer upload da imagem'
    });
  }
};

const updateUserProfile = async (req, res) => {
  try {
    const { name, email, foto_perfil } = req.body;
    const userId = req.user.id;

    // Validações básicas
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Nome e email são obrigatórios'
      });
    }

    // Verificar se o email já está sendo usado por outro usuário
    const emailExists = await pool.query('SELECT id_user FROM "user" WHERE email = $1 AND id_user != $2', [email, userId]);

    if (emailExists.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Este email já está sendo usado por outro usuário'
      });
    }

    // Atualizar os dados do usuário
    const updateResult = await pool.query(
      'UPDATE "user" SET name = $1, email = $2, foto_perfil = $3 WHERE id_user = $4 RETURNING id_user, name, email, foto_perfil',
      [name, email, foto_perfil, userId]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Perfil atualizado com sucesso!',
      user: updateResult.rows[0]
    });

  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
};

const deleteUserAccount = async (req, res) => {
  try {
    const userId = req.user.id;

    // Buscar dados do usuário (incluindo foto de perfil)
    const userResult = await pool.query('SELECT foto_perfil FROM "user" WHERE id_user = $1', [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado'
      });
    }

    const user = userResult.rows[0];

    // Deletar foto de perfil do S3 se existir
    if (user.foto_perfil && user.foto_perfil.includes(BUCKET_NAME)) {
      try {
        const imageKey = user.foto_perfil.split('/').pop();
        await s3.send(new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: imageKey
        }));
      } catch (deleteError) {
        console.warn('Erro ao deletar imagem do S3:', deleteError);
        // Não interrompe o processo se não conseguir deletar a imagem
      }
    }

    // Deletar usuário do banco de dados
    await pool.query('DELETE FROM "user" WHERE id_user = $1', [userId]);

    // Limpar cache do usuário
    clearCacheForUser(userId);

    // Limpar cookie
    res.clearCookie('jwt', getJwtClearCookieOptions(req));

    res.status(200).json({
      success: true,
      message: 'Conta deletada com sucesso'
    });

  } catch (error) {
    console.error('Erro ao deletar conta:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
};

const validateInviteToken = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') return res.status(400).json({ success: false, message: 'Token é obrigatório.' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const invite = await pool.query(
      `
      SELECT id_invite, id_account, email, expires_at, accepted_at
      FROM invites
      WHERE token_hash = $1
      LIMIT 1
      `,
      [tokenHash]
    );

    if (invite.rows.length === 0) return res.status(404).json({ success: false, message: 'Convite inválido.' });

    const row = invite.rows[0];

    if (row.accepted_at) return res.status(409).json({ success: false, message: 'Este convite já foi utilizado.' });

    const now = new Date();
    if (new Date(row.expires_at) < now) return res.status(410).json({ success: false, message: 'Convite expirado.' });

    return res.json({
      success: true,
      invite: {
        id_invite: row.id_invite,
        email: row.email,
        expires_at: row.expires_at
      }
    });
  } catch (err) {
    console.error('validateInviteToken error:', err);
    return res.status(500).json({ success: false, message: 'Erro ao validar convite.' });
  }
};

const acceptInvite = async (req, res) => {
  const client = await pool.connect();
  try {
    const { token, password, confirmPassword, name } = req.body;

    if (!token || typeof token !== 'string') return res.status(400).json({ success: false, message: 'Token é obrigatório.' });
    if (!password || typeof password !== 'string' || password.length < 6) return res.status(400).json({ success: false, message: 'Senha inválida (mínimo 6 caracteres).' });
    if (password !== confirmPassword) return res.status(400).json({ success: false, message: 'As senhas não conferem.' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    await client.query('BEGIN');

    // 1) Carrega convite (trava linha)
    const inviteRes = await client.query(
      `
      SELECT id_invite, id_account, email, expires_at, accepted_at
      FROM invites
      WHERE token_hash = $1
      FOR UPDATE
      `,
      [tokenHash]
    );

    if (inviteRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Convite inválido.' });
    }

    const invite = inviteRes.rows[0];

    if (invite.accepted_at) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Este convite já foi utilizado.' });
    }

    if (new Date(invite.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.status(410).json({ success: false, message: 'Convite expirado.' });
    }

    const email = String(invite.email).toLowerCase().trim();

    // 2) Busca ou cria user
    const userRes = await client.query(
      `SELECT id_user, id_account, email FROM "user" WHERE lower(email) = $1 LIMIT 1`,
      [email]
    );

    let id_user;

    const hashed = await bcrypt.hash(password, 10);

    if (userRes.rows.length === 0) {
      // cria user já na account do convite
      const created = await client.query(
        `
        INSERT INTO "user" (name, email, password, id_account, created_at, email_verified)
        VALUES ($1, $2, $3, $4, now(), $5)
        RETURNING id_user
        `,
        [name || email, email, hashed, invite.id_account, true]
      );
      id_user = created.rows[0].id_user;

      await client.query('DELETE FROM invites WHERE id_invite = $1', [invite.id_invite]);
    } else {
      // user existe: não deixa "mudar" de account
      const u = userRes.rows[0];

      if (Number(u.id_account) !== Number(invite.id_account)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'Este email já pertence a outra conta. Não é possível aceitar este convite.'
        });
      }

      id_user = u.id_user;

      // atualiza senha (e nome se vier)
      await client.query(
        `UPDATE "user" SET password = $1, name = COALESCE($2, name) WHERE id_user = $3`,
        [hashed, name || null, id_user]
      );
    }

    // 3) cria/garante team_member
    const tmRes = await client.query(
      `
      INSERT INTO team_members (id_account, id_user, status, invited_at, joined_at, created_at)
      VALUES ($1, $2, 'active', now(), now(), now())
      ON CONFLICT (id_account, id_user)
      DO UPDATE SET status = 'active', joined_at = COALESCE(team_members.joined_at, now())
      RETURNING id_team_member
      `,
      [invite.id_account, id_user]
    );

    const id_team_member = tmRes.rows[0].id_team_member;

    // 4) atribui role "Equipe"
    const roleRes = await client.query(
      `SELECT id_role FROM roles WHERE id_account = $1 AND lower(name) = 'equipe' LIMIT 1`,
      [invite.id_account]
    );

    if (roleRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({ success: false, message: 'Role Equipe não encontrada para a conta.' });
    }

    const id_role = roleRes.rows[0].id_role;

    // member_roles tem UNIQUE(team_member) no seu modelo (1 role por membro)
    await client.query(
      `
      INSERT INTO member_roles (id_team_member, id_role)
      VALUES ($1, $2)
      ON CONFLICT (id_team_member, id_role) DO NOTHING
      `,
      [id_team_member, id_role]
    );

    // 5) marca convite como aceito
    await client.query(
      `UPDATE invites SET accepted_at = now() WHERE id_invite = $1`,
      [invite.id_invite]
    );

    await client.query('COMMIT');

    // 6) gera JWT + cookie e finaliza
    const tokenPayload = {
      id: id_user,
      email,
      id_account: invite.id_account,
      id_team_member,
      role: 'Equipe'
    };

    const jwtToken = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET || 'seu_segredo_jwt',
      { expiresIn: '1h' }
    );

    res.cookie('jwt', jwtToken, getJwtCookieOptions(req));

    return res.json({
      success: true,
      message: 'Acesso ativado com sucesso.',
      redirectTo: FRONTEND_PATHS.dashboard
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('acceptInvite error:', err);
    return res.status(500).json({ success: false, message: 'Erro ao aceitar convite.' });
  } finally {
    client.release();
  }
};

module.exports = {
  addAvatarProfileBucket,
  checkAuthStatus,
  deleteUserAccount,
  forgotPassword,
  getUserProfile,
  loginUser,
  logoutUser,
  registerUser,
  resetPassword,
  updateUserProfile,
  verifyEmail,
  validateInviteToken,
  acceptInvite
};